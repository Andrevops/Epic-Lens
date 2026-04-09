import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CONFIG, SECRET_KEY_GITHUB_TOKEN } from "../constants";
import type {
  GitHubSearchItem,
  GitHubPR,
  GitHubReview,
  MergeRequestData,
  MrStatusCategory,
} from "../types";

export class GitHubClient implements vscode.Disposable {
  private _secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this._secretStorage = secretStorage;
  }

  dispose(): void {}

  /**
   * Fetch all open PRs authored by the current user, enriched with review info.
   */
  async fetchMyOpenPRs(
    output: vscode.OutputChannel
  ): Promise<MergeRequestData[]> {
    const { host, token } = await this._getCredentials();
    output.appendLine(
      `  GitHub credentials — host: ${host ? "set" : "MISSING"}, token: ${token ? "set" : "MISSING"}`
    );
    if (!host || !token) {
      vscode.window
        .showWarningMessage(
          "Epic Lens: GitHub token not found. You need a Personal Access Token or Fine-grained token with repo scope.",
          "Configure"
        )
        .then((choice) => {
          if (choice === "Configure") {
            vscode.commands.executeCommand("epicLens.configureGithub");
          }
        });
      return [];
    }

    // Step 1: Get authenticated user's login
    const userResp = await this._fetch(`${host}/user`, token, output);
    if (!userResp) return [];
    const userData = await userResp.json();
    const username: string = userData.login;
    output.appendLine(`  GitHub user: ${username}`);

    // Step 2: Search for open PRs authored by this user
    const searchUrl = `${host}/search/issues?q=type:pr+state:open+author:${username}&per_page=100&sort=updated&order=desc`;
    const searchResp = await this._fetch(searchUrl, token, output);
    if (!searchResp) return [];
    const searchData = await searchResp.json();
    const items: GitHubSearchItem[] = searchData.items ?? [];
    output.appendLine(`  Open PRs found: ${items.length}`);

    // Filter to only actual PRs (safety check)
    const prItems = items.filter((i) => i.pull_request);

    // Step 3: Fetch PR details + reviews in parallel
    const detailPromises = prItems.map(async (item) => {
      const { owner, repo } = this._parseRepoUrl(item.repository_url);
      const [prDetail, reviews] = await Promise.all([
        this._fetchPRDetail(host, token, owner, repo, item.number, output),
        this._fetchReviews(host, token, owner, repo, item.number, output),
      ]);
      return this._toMergeRequestData(item, owner, repo, prDetail, reviews);
    });

    const results = await Promise.allSettled(detailPromises);
    return results
      .filter((r): r is PromiseFulfilledResult<MergeRequestData> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  private async _fetchPRDetail(
    host: string,
    token: string,
    owner: string,
    repo: string,
    number: number,
    output: vscode.OutputChannel
  ): Promise<GitHubPR | null> {
    const url = `${host}/repos/${owner}/${repo}/pulls/${number}`;
    const resp = await this._fetch(url, token, output);
    if (!resp) return null;
    return resp.json();
  }

  private async _fetchReviews(
    host: string,
    token: string,
    owner: string,
    repo: string,
    number: number,
    output: vscode.OutputChannel
  ): Promise<GitHubReview[]> {
    const url = `${host}/repos/${owner}/${repo}/pulls/${number}/reviews`;
    const resp = await this._fetch(url, token, output);
    if (!resp) return [];
    return resp.json();
  }

  private _toMergeRequestData(
    item: GitHubSearchItem,
    owner: string,
    repo: string,
    prDetail: GitHubPR | null,
    reviews: GitHubReview[]
  ): MergeRequestData {
    const draft = prDetail?.draft ?? item.draft ?? false;
    const hasConflicts = prDetail?.mergeable_state === "dirty";
    const mergeableState = prDetail?.mergeable_state ?? "unknown";
    const sourceBranch = prDetail?.head?.ref ?? "";
    const targetBranch = prDetail?.base?.ref ?? "";

    // Determine reviews: take the latest review per user
    const latestReviews = new Map<string, string>();
    for (const review of reviews) {
      if (review.state === "COMMENTED" || review.state === "PENDING") continue;
      latestReviews.set(review.user.login, review.state);
    }

    const approvedBy = [...latestReviews.entries()]
      .filter(([, state]) => state === "APPROVED")
      .map(([login]) => login);
    const hasChangesRequested = [...latestReviews.values()].some(
      (s) => s === "CHANGES_REQUESTED"
    );

    // Pipeline status from mergeable_state
    let pipelineStatus: string | undefined;
    if (mergeableState === "unstable") pipelineStatus = "failed";
    else if (mergeableState === "clean") pipelineStatus = "success";

    const status = this._categorizeStatus(
      draft,
      hasConflicts,
      mergeableState,
      approvedBy.length,
      hasChangesRequested
    );

    const projectPath = `${owner}/${repo}`;

    return {
      provider: "github",
      id: item.id,
      iid: item.number,
      title: item.title,
      webUrl: item.html_url,
      sourceBranch,
      targetBranch,
      draft,
      hasConflicts,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      projectId: item.id,
      projectPath,
      projectName: repo,
      pipelineStatus,
      approvedBy,
      approvalsRequired: 0, // GitHub doesn't expose this in the API easily
      status,
    };
  }

  private _categorizeStatus(
    draft: boolean,
    hasConflicts: boolean,
    mergeableState: string,
    approvalCount: number,
    hasChangesRequested: boolean
  ): MrStatusCategory {
    if (draft) return "draft";
    if (hasConflicts) return "has_conflicts";
    if (mergeableState === "unstable") return "ci_failed";
    if (hasChangesRequested) return "changes_requested";
    if (mergeableState === "clean" && approvalCount > 0) return "ready";
    if (approvalCount > 0) return "approved";
    return "needs_review";
  }

  private _parseRepoUrl(repositoryUrl: string): {
    owner: string;
    repo: string;
  } {
    // "https://api.github.com/repos/owner/repo" → { owner, repo }
    const parts = repositoryUrl.split("/");
    return {
      owner: parts[parts.length - 2],
      repo: parts[parts.length - 1],
    };
  }

  private async _fetch(
    url: string,
    token: string,
    output: vscode.OutputChannel
  ): Promise<Response | null> {
    output.appendLine(`  GitHub fetch: ${url.replace(/\?.*/, "?...")}`);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      output.appendLine(`  GitHub response: ${response.status}`);

      if (response.status === 401) {
        vscode.window
          .showWarningMessage(
            "Epic Lens: GitHub authentication failed. Reconfigure credentials?",
            "Configure"
          )
          .then((choice) => {
            if (choice === "Configure") {
              vscode.commands.executeCommand("epicLens.configureGithub");
            }
          });
        return null;
      }

      if (response.status === 403) {
        const remaining = response.headers.get("X-RateLimit-Remaining");
        if (remaining === "0") {
          const resetAt = response.headers.get("X-RateLimit-Reset");
          const resetDate = resetAt
            ? new Date(parseInt(resetAt, 10) * 1000).toLocaleTimeString()
            : "soon";
          output.appendLine(`  GitHub rate limited, resets at ${resetDate}`);
          vscode.window.showWarningMessage(
            `Epic Lens: GitHub API rate limit reached. Resets at ${resetDate}.`
          );
        }
        return null;
      }

      if (!response.ok) {
        const body = await response.text();
        output.appendLine(
          `  GitHub API error ${response.status}: ${body.slice(0, 200)}`
        );
        return null;
      }

      return response;
    } catch (err) {
      output.appendLine(`  GitHub fetch error: ${err}`);
      return null;
    }
  }

  private async _getCredentials(): Promise<{
    host: string;
    token: string;
  }> {
    const config = vscode.workspace.getConfiguration();
    const host = (
      config.get<string>(CONFIG.githubHost) ?? "https://api.github.com"
    ).replace(/\/$/, "");

    // 1. SecretStorage
    let token = await this._secretStorage.get(SECRET_KEY_GITHUB_TOKEN);

    // 2. Env var fallback
    if (!token) {
      token = process.env.GITHUB_TOKEN;
    }

    // 3. gh CLI config fallback
    if (!token) {
      token = this._readGhToken(host);
    }

    return { host, token: token ?? "" };
  }

  /**
   * Attempt to read the token from gh CLI config (~/.config/gh/hosts.yml).
   */
  private _readGhToken(host: string): string | undefined {
    try {
      const configPath = path.join(
        os.homedir(),
        ".config",
        "gh",
        "hosts.yml"
      );
      if (!fs.existsSync(configPath)) return undefined;

      const content = fs.readFileSync(configPath, "utf-8");
      // Derive hostname: "https://api.github.com" → "github.com"
      const hostname = host
        .replace(/^https?:\/\//, "")
        .replace(/^api\./, "");

      const lines = content.split("\n");
      let inHostBlock = false;
      for (const line of lines) {
        if (line.trim() === `${hostname}:`) {
          inHostBlock = true;
          continue;
        }
        if (inHostBlock) {
          const tokenMatch = line.match(
            /^\s+(?:oauth_token|token):\s*(.+)/
          );
          if (tokenMatch) {
            const raw = tokenMatch[1].trim();
            if (raw.startsWith("!!null")) return undefined;
            return raw;
          }
          if (
            line.length > 0 &&
            !line.startsWith(" ") &&
            !line.startsWith("\t")
          ) {
            break;
          }
        }
      }
    } catch {
      // Silently fail
    }
    return undefined;
  }

  async hasCredentials(): Promise<boolean> {
    const { token } = await this._getCredentials();
    return !!token;
  }

  async storeToken(token: string): Promise<void> {
    await this._secretStorage.store(SECRET_KEY_GITHUB_TOKEN, token);
  }

  async deleteToken(): Promise<void> {
    await this._secretStorage.delete(SECRET_KEY_GITHUB_TOKEN);
  }
}
