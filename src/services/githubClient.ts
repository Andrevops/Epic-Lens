import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CONFIG, SECRET_KEY_GITHUB_TOKEN } from "../constants";
import type {
  GitHubSearchItem,
  GitHubPR,
  GitHubReview,
  GitHubCheckRun,
  GitHubCheckRunsResponse,
  GitHubRepo,
  GitHubWorkflowRun,
  GitHubWorkflowRunsResponse,
  GitHubWorkflowJob,
  GitHubWorkflowJobsResponse,
  MergeRequestData,
  StandalonePipelineData,
  PipelineStatusCategory,
  MrStatusCategory,
  PipelineJobData,
  PipelineDetails,
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
      output.appendLine("  GitHub: no credentials configured, skipping");
      return [];
    }

    // Step 1: Get authenticated user's login
    const userResp = await this._fetch(`${host}/user`, token, output);
    if (!userResp) return [];
    const userData = (await userResp.json()) as { login: string };
    const username: string = userData.login;
    output.appendLine(`  GitHub user: ${username}`);

    // Step 2: Search for authored + review-requested PRs in parallel
    const [authoredResp, reviewResp] = await Promise.all([
      this._fetch(
        `${host}/search/issues?q=type:pr+state:open+author:${username}&per_page=100&sort=updated&order=desc`,
        token,
        output
      ),
      this._fetch(
        `${host}/search/issues?q=type:pr+state:open+review-requested:${username}&per_page=100&sort=updated&order=desc`,
        token,
        output
      ),
    ]);

    const authoredData = authoredResp ? (await authoredResp.json()) as { items: GitHubSearchItem[] } : { items: [] as GitHubSearchItem[] };
    const reviewData = reviewResp ? (await reviewResp.json()) as { items: GitHubSearchItem[] } : { items: [] as GitHubSearchItem[] };

    const authoredItems: GitHubSearchItem[] = (authoredData.items ?? []).filter(
      (i: GitHubSearchItem) => i.pull_request
    );
    const reviewItems: GitHubSearchItem[] = (reviewData.items ?? []).filter(
      (i: GitHubSearchItem) => i.pull_request
    );

    output.appendLine(`  GitHub authored PRs: ${authoredItems.length}`);
    output.appendLine(`  GitHub review-requested PRs: ${reviewItems.length}`);

    // Deduplicate: authored wins over reviewer
    const seenIds = new Set<number>();
    const allItems: { item: GitHubSearchItem; role: "author" | "reviewer" }[] = [];

    for (const item of authoredItems) {
      seenIds.add(item.id);
      allItems.push({ item, role: "author" });
    }
    for (const item of reviewItems) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push({ item, role: "reviewer" });
      }
    }

    // Step 3: Fetch PR details + reviews + check runs in parallel
    const detailPromises = allItems.map(async ({ item, role }) => {
      const { owner, repo } = this._parseRepoUrl(item.repository_url);
      const [prDetail, reviews] = await Promise.all([
        this._fetchPRDetail(host, token, owner, repo, item.number, output),
        this._fetchReviews(host, token, owner, repo, item.number, output),
      ]);
      const checkRuns = prDetail?.head?.sha
        ? await this._fetchCheckRuns(host, token, owner, repo, prDetail.head.sha, output)
        : [];
      return this._toMergeRequestData(item, owner, repo, prDetail, reviews, role, checkRuns);
    });

    const results = await Promise.allSettled(detailPromises);
    return results
      .filter((r): r is PromiseFulfilledResult<MergeRequestData> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  /**
   * Fetch recent workflow runs on default branches triggered by the current user.
   */
  async fetchMyPipelines(
    output: vscode.OutputChannel,
    filterByUser: boolean = true
  ): Promise<StandalonePipelineData[]> {
    const { host, token } = await this._getCredentials();
    output.appendLine(
      `  GitHub pipeline credentials — host: ${host ? "set" : "MISSING"}, token: ${token ? "set" : "MISSING"}`
    );
    if (!host || !token) {
      output.appendLine("  GitHub: no credentials configured, skipping pipelines");
      return [];
    }

    // Get current user
    const userResp = await this._fetch(`${host}/user`, token, output);
    if (!userResp) return [];
    const userData = (await userResp.json()) as { login: string };
    output.appendLine(`  GitHub pipeline user: ${userData.login}`);

    // Get user's repos
    const repos = await this._fetchUserRepos(host, token, output);
    output.appendLine(`  GitHub repos for pipelines: ${repos.length}`);
    if (repos.length === 0) return [];

    // Fetch workflow runs per repo on default branch, optionally by current user
    const actor = filterByUser ? userData.login : undefined;
    const runResults = await Promise.allSettled(
      repos.map((repo) =>
        this._fetchWorkflowRuns(
          host, token, repo.owner.login, repo.name,
          repo.default_branch, actor, output
        )
      )
    );

    // Flatten and sort by updated_at desc
    const allRuns: { run: GitHubWorkflowRun; repo: GitHubRepo }[] = [];
    for (let i = 0; i < repos.length; i++) {
      const result = runResults[i];
      if (result.status === "fulfilled") {
        for (const run of result.value) {
          allRuns.push({ run, repo: repos[i] });
        }
      }
    }
    allRuns.sort(
      (a, b) => new Date(b.run.updated_at).getTime() - new Date(a.run.updated_at).getTime()
    );

    output.appendLine(`  GitHub total workflow runs found: ${allRuns.length}`);

    // Fetch jobs for each run in parallel
    const jobResults = await Promise.allSettled(
      allRuns.map(({ run, repo }) =>
        this._fetchWorkflowJobs(
          host, token, repo.owner.login, repo.name, run.id, output
        )
      )
    );

    return allRuns.map(({ run, repo }, i) => {
      const jobs =
        jobResults[i].status === "fulfilled" ? jobResults[i].value : [];
      return this._toStandalonePipelineFromRun(run, repo, jobs);
    });
  }

  private async _fetchUserRepos(
    host: string,
    token: string,
    output: vscode.OutputChannel
  ): Promise<GitHubRepo[]> {
    const url = `${host}/user/repos?sort=pushed&per_page=20&type=owner`;
    const resp = await this._fetch(url, token, output);
    if (!resp) return [];
    return (await resp.json()) as GitHubRepo[];
  }

  private async _fetchWorkflowRuns(
    host: string,
    token: string,
    owner: string,
    repo: string,
    branch: string,
    actor: string | undefined,
    output: vscode.OutputChannel
  ): Promise<GitHubWorkflowRun[]> {
    let url = `${host}/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`;
    if (actor) url += `&actor=${encodeURIComponent(actor)}`;
    const resp = await this._fetch(url, token, output);
    if (!resp) return [];
    const data = (await resp.json()) as GitHubWorkflowRunsResponse;
    return data.workflow_runs ?? [];
  }

  private async _fetchWorkflowJobs(
    host: string,
    token: string,
    owner: string,
    repo: string,
    runId: number,
    output: vscode.OutputChannel
  ): Promise<GitHubWorkflowJob[]> {
    const url = `${host}/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`;
    const resp = await this._fetch(url, token, output);
    if (!resp) return [];
    const data = (await resp.json()) as GitHubWorkflowJobsResponse;
    return data.jobs ?? [];
  }

  private _toStandalonePipelineFromRun(
    run: GitHubWorkflowRun,
    repo: GitHubRepo,
    jobs: GitHubWorkflowJob[]
  ): StandalonePipelineData {
    const mappedJobs: PipelineJobData[] = jobs.map((j) => {
      let jobStatus: string;
      if (j.status !== "completed") {
        jobStatus = "running";
      } else if (j.conclusion === "success") {
        jobStatus = "success";
      } else if (j.conclusion === "failure") {
        jobStatus = "failed";
      } else if (j.conclusion === "cancelled") {
        jobStatus = "cancelled";
      } else if (j.conclusion === "skipped") {
        jobStatus = "skipped";
      } else {
        jobStatus = j.conclusion ?? "unknown";
      }
      const duration =
        j.started_at && j.completed_at
          ? Math.round(
              (new Date(j.completed_at).getTime() -
                new Date(j.started_at).getTime()) /
                1000
            )
          : undefined;
      return {
        name: j.name,
        status: jobStatus,
        durationSeconds: duration,
        webUrl: j.html_url,
      };
    });

    let status: PipelineStatusCategory;
    if (run.status !== "completed") {
      status = "running";
    } else if (run.conclusion === "success") {
      status = "success";
    } else if (run.conclusion === "failure") {
      status = "failed";
    } else if (run.conclusion === "cancelled") {
      status = "canceled";
    } else if (run.conclusion === "skipped") {
      status = "skipped";
    } else {
      status = "pending";
    }

    return {
      provider: "github",
      id: run.id,
      projectId: repo.id,
      projectPath: repo.full_name,
      projectName: repo.name,
      ref: run.head_branch,
      status,
      webUrl: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      duration: undefined,
      jobs: mappedJobs,
      failedJobs: mappedJobs.filter((j) => j.status === "failed"),
    };
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
    return (await resp.json()) as GitHubPR;
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
    return (await resp.json()) as GitHubReview[];
  }

  private async _fetchCheckRuns(
    host: string,
    token: string,
    owner: string,
    repo: string,
    sha: string,
    output: vscode.OutputChannel
  ): Promise<GitHubCheckRun[]> {
    const url = `${host}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`;
    const resp = await this._fetch(url, token, output);
    if (!resp) return [];
    const data = (await resp.json()) as GitHubCheckRunsResponse;
    return data.check_runs ?? [];
  }

  private _toMergeRequestData(
    item: GitHubSearchItem,
    owner: string,
    repo: string,
    prDetail: GitHubPR | null,
    reviews: GitHubReview[],
    role: "author" | "reviewer" = "author",
    checkRuns: GitHubCheckRun[] = []
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

    // Build pipeline details from check runs
    let pipelineDetails: PipelineDetails | undefined;
    if (checkRuns.length > 0) {
      const mappedJobs: PipelineJobData[] = checkRuns.map((cr) => {
        let jobStatus: string;
        if (cr.status !== "completed") {
          jobStatus = "running";
        } else if (cr.conclusion === "success") {
          jobStatus = "success";
        } else if (cr.conclusion === "failure") {
          jobStatus = "failed";
        } else if (cr.conclusion === "cancelled") {
          jobStatus = "cancelled";
        } else {
          jobStatus = cr.conclusion ?? "unknown";
        }
        const duration =
          cr.started_at && cr.completed_at
            ? Math.round(
                (new Date(cr.completed_at).getTime() -
                  new Date(cr.started_at).getTime()) /
                  1000
              )
            : undefined;
        return {
          name: cr.name,
          status: jobStatus,
          durationSeconds: duration,
          webUrl: cr.html_url,
        };
      });

      const failedJobs = mappedJobs.filter((j) => j.status === "failed");
      const hasRunning = mappedJobs.some((j) => j.status === "running");
      const hasFailed = failedJobs.length > 0;
      const overallStatus = hasFailed
        ? "failed"
        : hasRunning
          ? "running"
          : "success";

      const checksUrl = item.html_url + "/checks";

      pipelineDetails = {
        pipelineUrl: checksUrl,
        overallStatus,
        jobs: mappedJobs,
        failedJobs,
      };

      // Override pipelineStatus with more accurate check-run based status
      pipelineStatus = overallStatus;
    }

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
      role,
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
      pipelineDetails,
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
