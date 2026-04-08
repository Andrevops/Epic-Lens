import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CONFIG, SECRET_KEY_GITLAB_TOKEN, categorizeMrStatus } from "../constants";
import type {
  GitLabMR,
  GitLabApprovalResponse,
  MergeRequestData,
} from "../types";

export class GitLabClient implements vscode.Disposable {
  private _secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this._secretStorage = secretStorage;
  }

  dispose(): void {}

  /**
   * Fetch all open MRs authored by the current user, enriched with approval info.
   */
  async fetchMyOpenMRs(
    output: vscode.OutputChannel
  ): Promise<MergeRequestData[]> {
    const { host, token } = await this._getCredentials();
    output.appendLine(
      `  GitLab credentials — host: ${host ? "set" : "MISSING"}, token: ${token ? "set" : "MISSING"}`
    );
    if (!host || !token) {
      vscode.window
        .showWarningMessage(
          "Epic Lens: GitLab token not found. You need a Personal Access Token with read_api scope.",
          "Configure"
        )
        .then((choice) => {
          if (choice === "Configure") {
            vscode.commands.executeCommand("epicLens.configureGitlab");
          }
        });
      return [];
    }

    const url = `${host}/api/v4/merge_requests?scope=created_by_me&state=opened&per_page=100`;
    const response = await this._fetch(url, token, output);
    if (!response) return [];

    const rawMRs: GitLabMR[] = await response.json();
    output.appendLine(`  Open MRs fetched: ${rawMRs.length}`);

    // Fetch approvals in parallel for all MRs
    const approvalResults = await Promise.allSettled(
      rawMRs.map((mr) =>
        this._fetchApprovals(host, token, mr.project_id, mr.iid, output)
      )
    );

    const mrs: MergeRequestData[] = rawMRs.map((raw, i) => {
      const approvalResult = approvalResults[i];
      const approvals: GitLabApprovalResponse | null =
        approvalResult.status === "fulfilled" ? approvalResult.value : null;
      return this._toMergeRequestData(raw, approvals);
    });

    return mrs;
  }

  private async _fetchApprovals(
    host: string,
    token: string,
    projectId: number,
    mrIid: number,
    output: vscode.OutputChannel
  ): Promise<GitLabApprovalResponse | null> {
    const url = `${host}/api/v4/projects/${projectId}/merge_requests/${mrIid}/approvals`;
    const response = await this._fetch(url, token, output);
    if (!response) return null;
    return response.json();
  }

  private _toMergeRequestData(
    raw: GitLabMR,
    approvals: GitLabApprovalResponse | null
  ): MergeRequestData {
    const approvedBy =
      approvals?.approved_by?.map((a) => a.user.name) ?? [];
    const approvalsRequired = approvals?.approvals_required ?? 0;

    // Extract project name from full reference (e.g. "group/sub/repo!123" → "repo")
    const refParts = raw.references.full.split("!");
    const projectPath = refParts[0];
    const projectName = projectPath.split("/").pop() ?? projectPath;

    return {
      id: raw.id,
      iid: raw.iid,
      title: raw.title,
      webUrl: raw.web_url,
      sourceBranch: raw.source_branch,
      targetBranch: raw.target_branch,
      draft: raw.draft,
      hasConflicts: raw.has_conflicts,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      projectId: raw.project_id,
      projectPath,
      projectName,
      pipelineStatus: raw.head_pipeline?.status,
      approvedBy,
      approvalsRequired,
      status: categorizeMrStatus(raw, approvedBy.length, approvalsRequired),
    };
  }

  private async _fetch(
    url: string,
    token: string,
    output: vscode.OutputChannel
  ): Promise<Response | null> {
    output.appendLine(`  GitLab fetch: ${url.replace(/\?.*/, "?...")}`);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "PRIVATE-TOKEN": token,
          Accept: "application/json",
        },
      });

      output.appendLine(`  GitLab response: ${response.status}`);

      if (response.status === 401) {
        vscode.window
          .showWarningMessage(
            "Epic Lens: GitLab authentication failed. Reconfigure credentials?",
            "Configure"
          )
          .then((choice) => {
            if (choice === "Configure") {
              vscode.commands.executeCommand("epicLens.configureGitlab");
            }
          });
        return null;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        await new Promise((r) => setTimeout(r, waitMs));
        return null;
      }

      if (!response.ok) {
        const body = await response.text();
        output.appendLine(
          `  GitLab API error ${response.status}: ${body.slice(0, 200)}`
        );
        return null;
      }

      return response;
    } catch (err) {
      output.appendLine(`  GitLab fetch error: ${err}`);
      return null;
    }
  }

  private async _getCredentials(): Promise<{
    host: string;
    token: string;
  }> {
    const config = vscode.workspace.getConfiguration();
    const host = (
      config.get<string>(CONFIG.gitlabHost) ?? "https://gitlab.com"
    ).replace(/\/$/, "");

    // 1. SecretStorage
    let token = await this._secretStorage.get(SECRET_KEY_GITLAB_TOKEN);

    // 2. Env var fallback
    if (!token) {
      token = process.env.GITLAB_TOKEN;
    }

    // 3. glab CLI config fallback
    if (!token) {
      token = this._readGlabToken(host);
    }

    return { host, token: token ?? "" };
  }

  /**
   * Attempt to read a Personal Access Token from glab CLI config
   * (~/.config/glab-cli/config.yml).
   *
   * Only returns the token if it looks like a real PAT (not an OAuth2 null placeholder).
   * glab OAuth2 sessions store `token: !!null <hash>` which isn't usable as a PRIVATE-TOKEN.
   */
  private _readGlabToken(host: string): string | undefined {
    try {
      const configPath = path.join(
        os.homedir(),
        ".config",
        "glab-cli",
        "config.yml"
      );
      if (!fs.existsSync(configPath)) return undefined;

      const content = fs.readFileSync(configPath, "utf-8");
      // Extract hostname from URL (e.g. "https://gitlab.com" → "gitlab.com")
      const hostname = host.replace(/^https?:\/\//, "");

      // Simple YAML parsing: find the host block and extract token
      const lines = content.split("\n");
      let inHostBlock = false;
      for (const line of lines) {
        if (line.trim() === `${hostname}:`) {
          inHostBlock = true;
          continue;
        }
        if (inHostBlock) {
          const tokenMatch = line.match(/^\s+token:\s*(.+)/);
          if (tokenMatch) {
            const raw = tokenMatch[1].trim();
            // Skip OAuth2 null tokens (!!null <hash>) — these don't work with PRIVATE-TOKEN
            if (raw.startsWith("!!null")) return undefined;
            return raw;
          }
          // If we hit a non-indented line, we've left the host block
          if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
            break;
          }
        }
      }
    } catch {
      // Silently fail — glab config is a convenience fallback
    }
    return undefined;
  }

  async hasCredentials(): Promise<boolean> {
    const { token } = await this._getCredentials();
    return !!token;
  }

  async storeToken(token: string): Promise<void> {
    await this._secretStorage.store(SECRET_KEY_GITLAB_TOKEN, token);
  }

  async deleteToken(): Promise<void> {
    await this._secretStorage.delete(SECRET_KEY_GITLAB_TOKEN);
  }
}
