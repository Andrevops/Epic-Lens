import * as vscode from "vscode";
import { CMD, CTX, PIPELINE_STATUS_EMOJI, PIPELINE_STATUS_LABELS, PROVIDER_LABELS } from "../constants";
import type { StandalonePipelineData, PipelineStatusCategory, PipelineJobData, MrProviderFilter } from "../types";
import type { GitLabClient } from "../services/gitlabClient";
import type { GitHubClient } from "../services/githubClient";

/* ── Tree node types ── */

interface PipelineProjectNode {
  kind: "pipelineProject";
  projectPath: string;
  projectName: string;
  providerIcon: string;
  pipelines: StandalonePipelineData[];
}

interface PipelineNode {
  kind: "pipeline";
  pipeline: StandalonePipelineData;
}

interface PipelineJobNode {
  kind: "pipelineJob";
  job: PipelineJobData;
}

type PipelineTreeNode = PipelineProjectNode | PipelineNode | PipelineJobNode;

const PROVIDER_CYCLE: MrProviderFilter[] = ["both", "gitlab", "github"];

export class PipelineTreeProvider
  implements vscode.TreeDataProvider<PipelineTreeNode>
{
  private _allPipelines: StandalonePipelineData[] = [];
  private _previousStatuses = new Map<string, PipelineStatusCategory>();
  private _providerFilter: MrProviderFilter = "both";
  private _onDidChangeTreeData = new vscode.EventEmitter<
    PipelineTreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private _gitlabClient: GitLabClient,
    private _githubClient: GitHubClient,
    private _output: vscode.OutputChannel
  ) {}

  get pipelines(): StandalonePipelineData[] {
    return this._filteredPipelines();
  }

  get providerFilter(): MrProviderFilter {
    return this._providerFilter;
  }

  cycleProvider(): MrProviderFilter {
    const idx = PROVIDER_CYCLE.indexOf(this._providerFilter);
    this._providerFilter = PROVIDER_CYCLE[(idx + 1) % PROVIDER_CYCLE.length];
    vscode.commands.executeCommand(
      "setContext",
      "epicLens.pipelineProvider",
      this._providerFilter
    );
    this._updateContext();
    this._onDidChangeTreeData.fire();
    return this._providerFilter;
  }

  async fetch(): Promise<number> {
    const [gitlabPipelines, githubPipelines] = await Promise.all([
      this._gitlabClient.fetchMyPipelines(this._output).catch((e) => {
        this._output.appendLine(`  GitLab pipeline fetch failed: ${e}`);
        return [] as StandalonePipelineData[];
      }),
      this._githubClient.fetchMyPipelines(this._output).catch((e) => {
        this._output.appendLine(`  GitHub pipeline fetch failed: ${e}`);
        return [] as StandalonePipelineData[];
      }),
    ]);

    const newPipelines = [...gitlabPipelines, ...githubPipelines];
    newPipelines.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    this._notifyChanges(newPipelines);
    this._allPipelines = newPipelines;
    this._updateContext();
    this._onDidChangeTreeData.fire();
    return this._filteredPipelines().length;
  }

  getTreeItem(node: PipelineTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "pipelineProject":
        return this._projectItem(node);
      case "pipeline":
        return this._pipelineItem(node);
      case "pipelineJob":
        return this._jobItem(node);
    }
  }

  getChildren(node?: PipelineTreeNode): PipelineTreeNode[] {
    if (!node) return this._getRootNodes();

    if (node.kind === "pipelineProject") {
      return node.pipelines.map((p) => ({ kind: "pipeline" as const, pipeline: p }));
    }

    if (node.kind === "pipeline") {
      return node.pipeline.jobs.map((j) => ({ kind: "pipelineJob" as const, job: j }));
    }

    return [];
  }

  private _filteredPipelines(): StandalonePipelineData[] {
    let pipelines = this._allPipelines;
    if (this._providerFilter !== "both") {
      pipelines = pipelines.filter((p) => p.provider === this._providerFilter);
    }

    // Group by project, sorted by date desc within each group
    const byProject = new Map<string, StandalonePipelineData[]>();
    for (const p of pipelines) {
      const key = `${p.provider}:${p.projectPath}`;
      const list = byProject.get(key) ?? [];
      list.push(p);
      byProject.set(key, list);
    }

    const result: StandalonePipelineData[] = [];
    for (const [, projectPipelines] of byProject) {
      // Sort newest first
      projectPipelines.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      // If the most recent pipeline succeeded, skip this project entirely
      if (projectPipelines[0]?.status === "success") continue;

      // Filter out completed (success) pipelines, cap at 5
      const active = projectPipelines
        .filter((p) => p.status !== "success")
        .slice(0, 5);
      result.push(...active);
    }

    return result;
  }

  private _updateContext(): void {
    const filtered = this._filteredPipelines();
    vscode.commands.executeCommand("setContext", CTX.hasPipelines, filtered.length > 0);
    vscode.commands.executeCommand(
      "setContext",
      "epicLens.pipelineProvider",
      this._providerFilter
    );
  }

  private _notifyChanges(newPipelines: StandalonePipelineData[]): void {
    if (this._previousStatuses.size === 0 && this._allPipelines.length === 0) {
      for (const p of newPipelines) {
        this._previousStatuses.set(p.webUrl, p.status);
      }
      return;
    }

    for (const p of newPipelines) {
      const prev = this._previousStatuses.get(p.webUrl);
      if (prev && prev !== p.status) {
        const label = PIPELINE_STATUS_LABELS[p.status];
        vscode.window
          .showInformationMessage(
            `${PIPELINE_STATUS_EMOJI[p.status]} ${p.projectName} #${p.id} → ${label}`,
            "Open"
          )
          .then((choice) => {
            if (choice === "Open") {
              vscode.env.openExternal(vscode.Uri.parse(p.webUrl));
            }
          });
      }
    }

    this._previousStatuses.clear();
    for (const p of newPipelines) {
      this._previousStatuses.set(p.webUrl, p.status);
    }
  }

  private _getRootNodes(): PipelineTreeNode[] {
    const pipelines = this._filteredPipelines();

    const byProject = new Map<string, StandalonePipelineData[]>();
    for (const p of pipelines) {
      const key = `${p.provider}:${p.projectPath}`;
      const list = byProject.get(key) ?? [];
      list.push(p);
      byProject.set(key, list);
    }

    // Single project: show pipelines flat
    if (byProject.size === 1) {
      return pipelines.map((p) => ({ kind: "pipeline" as const, pipeline: p }));
    }

    // Multiple projects: group
    const nodes: PipelineTreeNode[] = [];
    for (const [, projectPipelines] of byProject) {
      const first = projectPipelines[0];
      const providerIcon = first.provider === "github" ? "🐙" : "🦊";
      nodes.push({
        kind: "pipelineProject" as const,
        projectPath: first.projectPath,
        projectName: first.projectName,
        providerIcon,
        pipelines: projectPipelines,
      });
    }
    return nodes;
  }

  private _projectItem(node: PipelineProjectNode): vscode.TreeItem {
    const count = node.pipelines.length;
    const label = `${node.providerIcon} ${node.projectName} (${count})`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.Expanded
    );

    item.iconPath = new vscode.ThemeIcon(
      "repo",
      new vscode.ThemeColor("charts.purple")
    );
    item.tooltip = `${node.projectPath} (${node.pipelines[0].provider})`;
    item.contextValue = "pipelineProject";

    return item;
  }

  private _pipelineItem(node: PipelineNode): vscode.TreeItem {
    const { pipeline } = node;
    const emoji = PIPELINE_STATUS_EMOJI[pipeline.status];
    const label = `${emoji} #${pipeline.id} ${pipeline.ref}`;
    const hasJobs = pipeline.jobs.length > 0;
    const item = new vscode.TreeItem(
      label,
      hasJobs
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    item.description = this._timeAgo(pipeline.updatedAt);
    item.iconPath = this._pipelineIcon(pipeline.status);
    item.tooltip = this._pipelineTooltip(pipeline);
    item.contextValue = "pipeline";

    item.command = {
      command: CMD.openPipeline,
      title: "Open Pipeline",
      arguments: [pipeline],
    };

    return item;
  }

  private _jobItem(node: PipelineJobNode): vscode.TreeItem {
    const { job } = node;
    const emoji = this._jobEmoji(job.status);
    const label = `${emoji} ${job.name}`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );

    if (job.durationSeconds) {
      item.description = _formatDuration(job.durationSeconds);
    }
    item.contextValue = "pipelineJob";

    if (job.webUrl) {
      item.command = {
        command: "vscode.open",
        title: "Open Job",
        arguments: [vscode.Uri.parse(job.webUrl)],
      };
    }

    return item;
  }

  private _pipelineIcon(status: PipelineStatusCategory): vscode.ThemeIcon {
    switch (status) {
      case "success":
        return new vscode.ThemeIcon(
          "pass-filled",
          new vscode.ThemeColor("testing.iconPassed")
        );
      case "failed":
        return new vscode.ThemeIcon(
          "error",
          new vscode.ThemeColor("testing.iconFailed")
        );
      case "running":
        return new vscode.ThemeIcon(
          "play-circle",
          new vscode.ThemeColor("charts.blue")
        );
      case "pending":
        return new vscode.ThemeIcon(
          "clock",
          new vscode.ThemeColor("charts.yellow")
        );
      case "canceled":
        return new vscode.ThemeIcon(
          "circle-slash",
          new vscode.ThemeColor("disabledForeground")
        );
      case "skipped":
        return new vscode.ThemeIcon(
          "debug-step-over",
          new vscode.ThemeColor("disabledForeground")
        );
      default:
        return new vscode.ThemeIcon("play-circle");
    }
  }

  private _jobEmoji(status: string): string {
    switch (status) {
      case "success": return "✅";
      case "failed": return "❌";
      case "running": return "🔄";
      case "pending": return "⏳";
      case "canceled":
      case "cancelled": return "⏹️";
      case "skipped": return "⏭️";
      default: return "⏳";
    }
  }

  private _pipelineTooltip(pipeline: StandalonePipelineData): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const providerName = pipeline.provider === "github" ? "GitHub" : "GitLab";

    md.appendMarkdown(`**Pipeline #${pipeline.id}** — ${pipeline.projectName}\n\n`);
    md.appendMarkdown(`**Provider:** ${providerName}\n\n`);
    md.appendMarkdown(
      `**Status:** ${PIPELINE_STATUS_EMOJI[pipeline.status]} ${PIPELINE_STATUS_LABELS[pipeline.status]}\n\n`
    );
    md.appendMarkdown(`**Branch:** \`${pipeline.ref}\`\n\n`);

    if (pipeline.duration) {
      md.appendMarkdown(`**Duration:** ${_formatDuration(pipeline.duration)}\n\n`);
    }

    if (pipeline.failedJobs.length > 0) {
      md.appendMarkdown("**Failed:**\n\n");
      for (const job of pipeline.failedJobs) {
        const link = job.webUrl ? `[${job.name}](${job.webUrl})` : job.name;
        const dur = job.durationSeconds
          ? ` (${_formatDuration(job.durationSeconds)})`
          : "";
        md.appendMarkdown(`- ❌ ${link}${dur}\n`);
      }
      md.appendMarkdown("\n");
    }

    const otherJobs = pipeline.jobs.filter((j) => j.status !== "failed");
    if (otherJobs.length > 0) {
      const summary = otherJobs
        .map((j) => {
          const icon =
            j.status === "success"
              ? "✅"
              : j.status === "running"
                ? "🔄"
                : j.status === "pending"
                  ? "⏳"
                  : "⏭️";
          return `${icon} ${j.name}`;
        })
        .join(" · ");
      md.appendMarkdown(`**Jobs:** ${summary}\n\n`);
    }

    const created = new Date(pipeline.createdAt).toLocaleDateString();
    const updated = new Date(pipeline.updatedAt).toLocaleDateString();
    md.appendMarkdown(`**Created:** ${created} · **Updated:** ${updated}\n\n`);
    md.appendMarkdown(`**Project:** ${pipeline.projectPath}\n\n`);
    md.appendMarkdown(`[Open in ${providerName}](${pipeline.webUrl})`);

    return md;
  }

  private _timeAgo(dateString: string): string {
    const ms = Date.now() - new Date(dateString).getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}

function _formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
