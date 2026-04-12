import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CONFIG, SECRET_KEY_GITLAB_TOKEN, categorizeMrStatus } from "../constants";
import type {
  GitLabMR,
  GitLabApprovalResponse,
  GitLabPipeline,
  GitLabProject,
  MergeRequestData,
  StandalonePipelineData,
  PipelineStatusCategory,
  PipelineJobData,
  PipelineDetails,
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
      output.appendLine("  GitLab: no credentials configured, skipping");
      return [];
    }

    // Fetch authored + reviewer MRs in parallel
    const [authoredResp, reviewerResp] = await Promise.all([
      this._fetch(
        `${host}/api/v4/merge_requests?scope=created_by_me&state=opened&per_page=100`,
        token,
        output
      ),
      this._fetch(
        `${host}/api/v4/merge_requests?scope=all&state=opened&reviewer_username=&reviewer_id=&per_page=100`,
        token,
        output
      ).catch(() => null), // graceful fallback if reviewer endpoint fails
    ]);

    // For reviewer MRs we need the current user's id first
    let reviewerMRs: GitLabMR[] = [];
    const userResp = await this._fetch(`${host}/api/v4/user`, token, output);
    if (userResp) {
      const user = (await userResp.json()) as { id: number };
      const reviewResp = await this._fetch(
        `${host}/api/v4/merge_requests?reviewer_id=${user.id}&state=opened&per_page=100`,
        token,
        output
      );
      if (reviewResp) {
        reviewerMRs = (await reviewResp.json()) as GitLabMR[];
        output.appendLine(`  GitLab reviewer MRs fetched: ${reviewerMRs.length}`);
      }
    }

    const authoredMRs: GitLabMR[] = authoredResp ? (await authoredResp.json()) as GitLabMR[] : [];
    output.appendLine(`  GitLab authored MRs fetched: ${authoredMRs.length}`);

    // Deduplicate: if an MR appears in both, keep as "author"
    const seenIds = new Set<number>();
    const allRaw: { raw: GitLabMR; role: "author" | "reviewer" }[] = [];

    for (const mr of authoredMRs) {
      seenIds.add(mr.id);
      allRaw.push({ raw: mr, role: "author" });
    }
    for (const mr of reviewerMRs) {
      if (!seenIds.has(mr.id)) {
        seenIds.add(mr.id);
        allRaw.push({ raw: mr, role: "reviewer" });
      }
    }

    // Fetch approvals in parallel
    const approvalResults = await Promise.allSettled(
      allRaw.map(({ raw }) =>
        this._fetchApprovals(host, token, raw.project_id, raw.iid, output)
      )
    );

    // Fetch pipeline jobs in parallel (only for MRs with a pipeline)
    const pipelineResults = await Promise.allSettled(
      allRaw.map(({ raw }) => {
        if (!raw.head_pipeline?.id) return Promise.resolve([]);
        return this._fetchPipelineJobs(
          host, token, raw.project_id, raw.head_pipeline.id, output
        );
      })
    );

    return allRaw.map(({ raw, role }, i) => {
      const approvals =
        approvalResults[i].status === "fulfilled"
          ? approvalResults[i].value
          : null;
      const jobs =
        pipelineResults[i].status === "fulfilled"
          ? pipelineResults[i].value
          : [];
      return this._toMergeRequestData(raw, approvals, role, jobs);
    });
  }

  /**
   * Fetch recent pipelines on default branches triggered by the current user.
   */
  async fetchMyPipelines(
    output: vscode.OutputChannel,
    filterByUser: boolean = true
  ): Promise<StandalonePipelineData[]> {
    const { host, token } = await this._getCredentials();
    output.appendLine(
      `  GitLab pipeline credentials — host: ${host ? "set" : "MISSING"}, token: ${token ? "set" : "MISSING"}`
    );
    if (!host || !token) {
      output.appendLine("  GitLab: no credentials configured, skipping pipelines");
      return [];
    }

    // Get current user
    const userResp = await this._fetch(`${host}/api/v4/user`, token, output);
    if (!userResp) return [];
    const user = (await userResp.json()) as { username: string };
    output.appendLine(`  GitLab pipeline user: ${user.username}`);

    // Get user's active projects
    const projects = await this._fetchProjects(host, token, output);
    output.appendLine(`  GitLab projects for pipelines: ${projects.length}`);
    if (projects.length === 0) return [];

    // Fetch pipelines per project — optionally filtered by current user
    const pipelineResults = await Promise.allSettled(
      projects.map((project) =>
        this._fetchProjectPipelines(
          host, token, project, filterByUser ? user.username : undefined, output
        )
      )
    );

    // Flatten and sort by updated_at desc
    const allPipelines: { raw: GitLabPipeline; project: GitLabProject }[] = [];
    for (let i = 0; i < projects.length; i++) {
      const result = pipelineResults[i];
      if (result.status === "fulfilled") {
        for (const raw of result.value) {
          allPipelines.push({ raw, project: projects[i] });
        }
      }
    }
    allPipelines.sort(
      (a, b) => new Date(b.raw.updated_at).getTime() - new Date(a.raw.updated_at).getTime()
    );

    output.appendLine(`  GitLab total pipelines found: ${allPipelines.length}`);

    // Fetch jobs for each pipeline in parallel
    const jobResults = await Promise.allSettled(
      allPipelines.map(({ raw, project }) =>
        this._fetchPipelineJobs(host, token, project.id, raw.id, output)
      )
    );

    return allPipelines.map(({ raw, project }, i) => {
      const jobs =
        jobResults[i].status === "fulfilled" ? jobResults[i].value : [];
      return this._toStandalonePipelineData(raw, project, jobs);
    });
  }

  private async _fetchProjects(
    host: string,
    token: string,
    output: vscode.OutputChannel
  ): Promise<GitLabProject[]> {
    // Fetch up to 100 projects the user is a member of, sorted by recent activity
    const url = `${host}/api/v4/projects?membership=true&order_by=last_activity_at&per_page=100&simple=true`;
    const response = await this._fetch(url, token, output);
    if (!response) return [];
    const projects = (await response.json()) as GitLabProject[];
    output.appendLine(
      `  GitLab projects fetched: ${projects.length} — ${projects.map((p) => p.name).join(", ")}`
    );
    return projects;
  }

  private async _fetchProjectPipelines(
    host: string,
    token: string,
    project: GitLabProject,
    username: string | undefined,
    output: vscode.OutputChannel
  ): Promise<GitLabPipeline[]> {
    const maxAgeDays = vscode.workspace
      .getConfiguration()
      .get<number>(CONFIG.pipelineMaxAgeDays) ?? 7;
    const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();

    let url = `${host}/api/v4/projects/${project.id}/pipelines?per_page=5&order_by=updated_at&sort=desc&updated_after=${since}`;
    if (username) {
      url += `&username=${encodeURIComponent(username)}`;
    }
    const response = await this._fetch(url, token, output);
    if (!response) return [];
    return (await response.json()) as GitLabPipeline[];
  }

  private _toStandalonePipelineData(
    raw: GitLabPipeline,
    project: GitLabProject,
    jobs: { name: string; stage: string; status: string; duration: number | null; web_url: string }[]
  ): StandalonePipelineData {
    const mappedJobs: PipelineJobData[] = jobs.map((j) => ({
      name: j.name,
      stage: j.stage,
      status: j.status,
      durationSeconds: j.duration ?? undefined,
      webUrl: j.web_url,
    }));

    const statusMap: Record<string, PipelineStatusCategory> = {
      success: "success",
      failed: "failed",
      running: "running",
      pending: "pending",
      canceled: "canceled",
      cancelled: "canceled",
      skipped: "skipped",
    };

    return {
      provider: "gitlab",
      id: raw.id,
      projectId: project.id,
      projectPath: project.path_with_namespace,
      projectName: project.name,
      ref: raw.ref,
      status: statusMap[raw.status] ?? "pending",
      webUrl: raw.web_url,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      duration: raw.duration ?? undefined,
      jobs: mappedJobs,
      failedJobs: mappedJobs.filter((j) => j.status === "failed"),
    };
  }

  async cancelPipeline(
    projectId: number,
    pipelineId: number,
    output: vscode.OutputChannel
  ): Promise<boolean> {
    const { host, token } = await this._getCredentials();
    if (!host || !token) return false;
    const url = `${host}/api/v4/projects/${projectId}/pipelines/${pipelineId}/cancel`;
    output.appendLine(`  GitLab cancel pipeline: ${url}`);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": token },
      });
      output.appendLine(`  GitLab cancel response: ${response.status}`);
      return response.ok;
    } catch (err) {
      output.appendLine(`  GitLab cancel error: ${err}`);
      return false;
    }
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
    return (await response.json()) as GitLabApprovalResponse;
  }

  private async _fetchPipelineJobs(
    host: string,
    token: string,
    projectId: number,
    pipelineId: number,
    output: vscode.OutputChannel
  ): Promise<{ name: string; stage: string; status: string; duration: number | null; web_url: string }[]> {
    const url = `${host}/api/v4/projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100`;
    const response = await this._fetch(url, token, output);
    if (!response) return [];
    return (await response.json()) as { name: string; stage: string; status: string; duration: number | null; web_url: string }[];
  }

  private _toMergeRequestData(
    raw: GitLabMR,
    approvals: GitLabApprovalResponse | null,
    role: "author" | "reviewer" = "author",
    jobs: { name: string; stage: string; status: string; duration: number | null; web_url: string }[] = []
  ): MergeRequestData {
    const approvedBy =
      approvals?.approved_by?.map((a) => a.user.name) ?? [];
    const approvalsRequired = approvals?.approvals_required ?? 0;

    // Extract project name from full reference (e.g. "group/sub/repo!123" → "repo")
    const refParts = raw.references.full.split("!");
    const projectPath = refParts[0];
    const projectName = projectPath.split("/").pop() ?? projectPath;

    // Build pipeline details from jobs
    let pipelineDetails: PipelineDetails | undefined;
    if (raw.head_pipeline) {
      const mappedJobs: PipelineJobData[] = jobs.map((j) => ({
        name: j.name,
        stage: j.stage,
        status: j.status,
        durationSeconds: j.duration ?? undefined,
        webUrl: j.web_url,
      }));
      pipelineDetails = {
        pipelineUrl: raw.head_pipeline.web_url,
        overallStatus: raw.head_pipeline.status,
        jobs: mappedJobs,
        failedJobs: mappedJobs.filter((j) => j.status === "failed"),
      };
    }

    return {
      provider: "gitlab",
      role,
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
      pipelineDetails,
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
