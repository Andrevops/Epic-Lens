import * as vscode from "vscode";
import { CMD, CTX, CONFIG, MR_STATUS_EMOJI, MR_STATUS_LABELS, PROVIDER_LABELS } from "../constants";
import type { MergeRequestData, MrStatusCategory, MrProviderFilter, MrScopeFilter } from "../types";
import type { GitLabClient } from "../services/gitlabClient";
import type { GitHubClient } from "../services/githubClient";

/* ── Tree node types ── */

interface ProjectNode {
  kind: "project";
  projectPath: string;
  projectName: string;
  providerIcon: string;
  mrs: MergeRequestData[];
}

interface MrNode {
  kind: "mr";
  mr: MergeRequestData;
}

type MrTreeNode = ProjectNode | MrNode;

const PROVIDER_CYCLE: MrProviderFilter[] = ["both", "gitlab", "github"];
const SCOPE_CYCLE: MrScopeFilter[] = ["authored", "reviewing", "all"];

export class MrTreeProvider
  implements vscode.TreeDataProvider<MrTreeNode>
{
  private _allMrs: MergeRequestData[] = [];
  private _previousStatuses = new Map<string, MrStatusCategory>();
  private _providerFilter: MrProviderFilter = "both";
  private _scopeFilter: MrScopeFilter = "all";
  private _onDidChangeTreeData = new vscode.EventEmitter<
    MrTreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private _gitlabClient: GitLabClient,
    private _githubClient: GitHubClient,
    private _output: vscode.OutputChannel
  ) {}

  get mrs(): MergeRequestData[] {
    return this._filteredMrs();
  }

  get providerFilter(): MrProviderFilter {
    return this._providerFilter;
  }

  get scopeFilter(): MrScopeFilter {
    return this._scopeFilter;
  }

  cycleProvider(): MrProviderFilter {
    const idx = PROVIDER_CYCLE.indexOf(this._providerFilter);
    this._providerFilter = PROVIDER_CYCLE[(idx + 1) % PROVIDER_CYCLE.length];
    vscode.commands.executeCommand(
      "setContext",
      "epicLens.mrProvider",
      this._providerFilter
    );
    this._updateContext();
    this._onDidChangeTreeData.fire();
    return this._providerFilter;
  }

  cycleScope(): MrScopeFilter {
    const idx = SCOPE_CYCLE.indexOf(this._scopeFilter);
    this._scopeFilter = SCOPE_CYCLE[(idx + 1) % SCOPE_CYCLE.length];
    this._updateContext();
    this._onDidChangeTreeData.fire();
    return this._scopeFilter;
  }

  async fetch(): Promise<number> {
    // Fetch from both providers in parallel
    const [gitlabMrs, githubPrs] = await Promise.all([
      this._gitlabClient.fetchMyOpenMRs(this._output).catch((e) => {
        this._output.appendLine(`  GitLab fetch failed: ${e}`);
        return [] as MergeRequestData[];
      }),
      this._githubClient.fetchMyOpenPRs(this._output).catch((e) => {
        this._output.appendLine(`  GitHub fetch failed: ${e}`);
        return [] as MergeRequestData[];
      }),
    ]);

    const newMrs = [...gitlabMrs, ...githubPrs];
    this._notifyChanges(newMrs);
    this._allMrs = newMrs;
    this._updateContext();
    this._onDidChangeTreeData.fire();
    return this._filteredMrs().length;
  }

  getTreeItem(node: MrTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "project":
        return this._projectItem(node);
      case "mr":
        return this._mrItem(node);
    }
  }

  getChildren(node?: MrTreeNode): MrTreeNode[] {
    if (!node) return this._getRootNodes();

    if (node.kind === "project") {
      return node.mrs.map((mr) => ({ kind: "mr" as const, mr }));
    }

    return [];
  }

  private _filteredMrs(): MergeRequestData[] {
    let mrs = this._allMrs;
    if (this._providerFilter !== "both") {
      mrs = mrs.filter((mr) => mr.provider === this._providerFilter);
    }
    if (this._scopeFilter !== "all") {
      const role = this._scopeFilter === "authored" ? "author" : "reviewer";
      mrs = mrs.filter((mr) => mr.role === role);
    }
    return mrs;
  }

  private _updateContext(): void {
    const filtered = this._filteredMrs();
    vscode.commands.executeCommand("setContext", CTX.hasMRs, filtered.length > 0);
    vscode.commands.executeCommand(
      "setContext",
      "epicLens.mrProvider",
      this._providerFilter
    );
  }

  private _notifyChanges(newMrs: MergeRequestData[]): void {
    // Skip notifications on first fetch (no previous data)
    if (this._previousStatuses.size === 0 && this._allMrs.length === 0) {
      for (const mr of newMrs) {
        this._previousStatuses.set(mr.webUrl, mr.status);
      }
      return;
    }

    for (const mr of newMrs) {
      const prev = this._previousStatuses.get(mr.webUrl);
      if (prev && prev !== mr.status) {
        const prefix = mr.provider === "github" ? "#" : "!";
        const label = MR_STATUS_LABELS[mr.status];
        vscode.window
          .showInformationMessage(
            `${MR_STATUS_EMOJI[mr.status]} ${prefix}${mr.iid} ${mr.title} → ${label}`,
            "Open"
          )
          .then((choice) => {
            if (choice === "Open") {
              vscode.env.openExternal(vscode.Uri.parse(mr.webUrl));
            }
          });
      }
    }

    // Update stored statuses
    this._previousStatuses.clear();
    for (const mr of newMrs) {
      this._previousStatuses.set(mr.webUrl, mr.status);
    }
  }

  private _getRootNodes(): MrTreeNode[] {
    const mrs = this._filteredMrs();

    // Group MRs by project (prefixed with provider)
    const byProject = new Map<string, MergeRequestData[]>();
    for (const mr of mrs) {
      const key = `${mr.provider}:${mr.projectPath}`;
      const list = byProject.get(key) ?? [];
      list.push(mr);
      byProject.set(key, list);
    }

    // Single project: show MRs flat
    if (byProject.size === 1) {
      return mrs.map((mr) => ({ kind: "mr" as const, mr }));
    }

    // Multiple projects: group under collapsible nodes
    const nodes: MrTreeNode[] = [];
    for (const [, projectMrs] of byProject) {
      const first = projectMrs[0];
      const providerIcon = first.provider === "github" ? "🐙" : "🦊";
      nodes.push({
        kind: "project" as const,
        projectPath: first.projectPath,
        projectName: first.projectName,
        providerIcon,
        mrs: projectMrs,
      });
    }
    return nodes;
  }

  private _projectItem(node: ProjectNode): vscode.TreeItem {
    const count = node.mrs.length;
    const label = `${node.providerIcon} ${node.projectName} (${count})`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.Expanded
    );

    item.iconPath = new vscode.ThemeIcon(
      "repo",
      new vscode.ThemeColor("charts.purple")
    );
    item.tooltip = `${node.projectPath} (${node.mrs[0].provider})`;
    item.contextValue = "mrProject";

    return item;
  }

  private _isStale(mr: MergeRequestData): boolean {
    const staleDays =
      vscode.workspace
        .getConfiguration()
        .get<number>(CONFIG.staleMRDays) ?? 7;
    if (staleDays <= 0) return false;
    const ageMs = Date.now() - new Date(mr.createdAt).getTime();
    return ageMs > staleDays * 86_400_000;
  }

  private _mrItem(node: MrNode): vscode.TreeItem {
    const { mr } = node;
    const stale = this._isStale(mr);
    const emoji = MR_STATUS_EMOJI[mr.status];
    const staleTag = stale ? " ⏰" : "";
    const reviewTag = mr.role === "reviewer" ? " 📋" : "";
    const prefix = mr.provider === "github" ? "#" : "!";
    const label = `${emoji} ${prefix}${mr.iid} ${mr.title}${reviewTag}${staleTag}`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );

    const ageDays = Math.floor(
      (Date.now() - new Date(mr.createdAt).getTime()) / 86_400_000
    );
    const ageStr = stale ? ` (${ageDays}d old)` : "";
    item.description = `→ ${mr.targetBranch}${ageStr}`;
    item.iconPath = this._mrIcon(mr.status);
    item.tooltip = this._mrTooltip(mr);
    item.contextValue = "mergeRequest";

    const openLabel = mr.provider === "github" ? "Open in GitHub" : "Open in GitLab";
    item.command = {
      command: CMD.openMR,
      title: openLabel,
      arguments: [mr],
    };

    return item;
  }

  private _mrIcon(status: MrStatusCategory): vscode.ThemeIcon {
    switch (status) {
      case "ready":
        return new vscode.ThemeIcon(
          "pass-filled",
          new vscode.ThemeColor("testing.iconPassed")
        );
      case "approved":
        return new vscode.ThemeIcon(
          "check",
          new vscode.ThemeColor("charts.green")
        );
      case "needs_review":
        return new vscode.ThemeIcon(
          "eye",
          new vscode.ThemeColor("charts.yellow")
        );
      case "draft":
        return new vscode.ThemeIcon(
          "edit",
          new vscode.ThemeColor("disabledForeground")
        );
      case "ci_failed":
        return new vscode.ThemeIcon(
          "error",
          new vscode.ThemeColor("testing.iconFailed")
        );
      case "ci_running":
        return new vscode.ThemeIcon(
          "play-circle",
          new vscode.ThemeColor("charts.blue")
        );
      case "has_conflicts":
        return new vscode.ThemeIcon(
          "warning",
          new vscode.ThemeColor("charts.orange")
        );
      case "changes_requested":
        return new vscode.ThemeIcon(
          "request-changes",
          new vscode.ThemeColor("charts.orange")
        );
      case "discussions_open":
        return new vscode.ThemeIcon(
          "comment-discussion",
          new vscode.ThemeColor("charts.orange")
        );
      default:
        return new vscode.ThemeIcon("git-pull-request");
    }
  }

  private _mrTooltip(mr: MergeRequestData): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const prefix = mr.provider === "github" ? "#" : "!";
    const providerName = mr.provider === "github" ? "GitHub" : "GitLab";

    md.appendMarkdown(`**${prefix}${mr.iid}** — ${mr.title}\n\n`);
    md.appendMarkdown(
      `**Provider:** ${providerName}\n\n`
    );
    md.appendMarkdown(
      `**Status:** ${MR_STATUS_LABELS[mr.status]} ${MR_STATUS_EMOJI[mr.status]}\n\n`
    );
    md.appendMarkdown(
      `**Branch:** \`${mr.sourceBranch}\` → \`${mr.targetBranch}\`\n\n`
    );

    // Pipeline
    if (mr.pipelineStatus) {
      const pipeEmoji =
        mr.pipelineStatus === "success"
          ? "✅"
          : mr.pipelineStatus === "failed"
            ? "❌"
            : "🔄";
      md.appendMarkdown(
        `**Pipeline:** ${pipeEmoji} ${mr.pipelineStatus}\n\n`
      );
    } else {
      md.appendMarkdown(`**Pipeline:** none\n\n`);
    }

    // Approvals / Reviews
    const approved = mr.approvedBy.length;
    if (mr.provider === "github") {
      md.appendMarkdown(`**Reviews:** ${approved} approved`);
    } else {
      md.appendMarkdown(`**Approvals:** ${approved}/${mr.approvalsRequired}`);
    }
    if (mr.approvedBy.length > 0) {
      md.appendMarkdown(` (${mr.approvedBy.join(", ")})`);
    }
    md.appendMarkdown("\n\n");

    // Flags
    if (mr.draft) md.appendMarkdown("**Draft:** yes\n\n");
    if (mr.hasConflicts)
      md.appendMarkdown("**Conflicts:** ⚠️ has merge conflicts\n\n");

    // Dates
    const created = new Date(mr.createdAt).toLocaleDateString();
    const updated = new Date(mr.updatedAt).toLocaleDateString();
    md.appendMarkdown(`**Created:** ${created} · **Updated:** ${updated}\n\n`);

    // Project path
    md.appendMarkdown(`**Project:** ${mr.projectPath}\n\n`);

    md.appendMarkdown(`[Open in ${providerName}](${mr.webUrl})`);

    return md;
  }
}
