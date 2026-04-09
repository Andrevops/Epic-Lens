import * as vscode from "vscode";
import { CMD, CTX, MR_STATUS_EMOJI, MR_STATUS_LABELS, PROVIDER_LABELS } from "../constants";
import type { MergeRequestData, MrStatusCategory, MrProviderFilter } from "../types";
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

export class MrTreeProvider
  implements vscode.TreeDataProvider<MrTreeNode>
{
  private _allMrs: MergeRequestData[] = [];
  private _providerFilter: MrProviderFilter = "both";
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

    this._allMrs = [...gitlabMrs, ...githubPrs];
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
    if (this._providerFilter === "both") return this._allMrs;
    return this._allMrs.filter((mr) => mr.provider === this._providerFilter);
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

  private _mrItem(node: MrNode): vscode.TreeItem {
    const { mr } = node;
    const emoji = MR_STATUS_EMOJI[mr.status];
    const prefix = mr.provider === "github" ? "#" : "!";
    const label = `${emoji} ${prefix}${mr.iid} ${mr.title}`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = `→ ${mr.targetBranch}`;
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
