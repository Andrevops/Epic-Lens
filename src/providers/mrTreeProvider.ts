import * as vscode from "vscode";
import { CMD, CTX, MR_STATUS_EMOJI, MR_STATUS_LABELS } from "../constants";
import type { MergeRequestData, MrStatusCategory } from "../types";
import type { GitLabClient } from "../services/gitlabClient";

/* ── Tree node types ── */

interface ProjectNode {
  kind: "project";
  projectPath: string;
  projectName: string;
  mrs: MergeRequestData[];
}

interface MrNode {
  kind: "mr";
  mr: MergeRequestData;
}

type MrTreeNode = ProjectNode | MrNode;

export class MrTreeProvider
  implements vscode.TreeDataProvider<MrTreeNode>
{
  private _mrs: MergeRequestData[] = [];
  private _onDidChangeTreeData = new vscode.EventEmitter<
    MrTreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private _gitlabClient: GitLabClient,
    private _output: vscode.OutputChannel
  ) {}

  get mrs(): MergeRequestData[] {
    return this._mrs;
  }

  async fetch(): Promise<number> {
    this._mrs = await this._gitlabClient.fetchMyOpenMRs(this._output);
    vscode.commands.executeCommand(
      "setContext",
      CTX.hasMRs,
      this._mrs.length > 0
    );
    this._onDidChangeTreeData.fire();
    return this._mrs.length;
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

  private _getRootNodes(): MrTreeNode[] {
    // Group MRs by project
    const byProject = new Map<string, MergeRequestData[]>();
    for (const mr of this._mrs) {
      const list = byProject.get(mr.projectPath) ?? [];
      list.push(mr);
      byProject.set(mr.projectPath, list);
    }

    // If single project, show MRs flat (no grouping)
    if (byProject.size === 1) {
      return this._mrs.map((mr) => ({ kind: "mr" as const, mr }));
    }

    // Multiple projects: group under collapsible nodes
    const nodes: MrTreeNode[] = [];
    for (const [projectPath, mrs] of byProject) {
      const projectName = projectPath.split("/").pop() ?? projectPath;
      nodes.push({
        kind: "project" as const,
        projectPath,
        projectName,
        mrs,
      });
    }
    return nodes;
  }

  private _projectItem(node: ProjectNode): vscode.TreeItem {
    const count = node.mrs.length;
    const label = `${node.projectName} (${count})`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.Expanded
    );

    item.iconPath = new vscode.ThemeIcon(
      "repo",
      new vscode.ThemeColor("charts.purple")
    );
    item.tooltip = node.projectPath;
    item.contextValue = "mrProject";

    return item;
  }

  private _mrItem(node: MrNode): vscode.TreeItem {
    const { mr } = node;
    const emoji = MR_STATUS_EMOJI[mr.status];
    const label = `${emoji} !${mr.iid} ${mr.title}`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = `→ ${mr.targetBranch}`;
    item.iconPath = this._mrIcon(mr.status);
    item.tooltip = this._mrTooltip(mr);
    item.contextValue = "mergeRequest";

    // Click opens MR in browser
    item.command = {
      command: CMD.openMR,
      title: "Open in GitLab",
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

    md.appendMarkdown(`**!${mr.iid}** — ${mr.title}\n\n`);
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

    // Approvals
    const approved = mr.approvedBy.length;
    const required = mr.approvalsRequired;
    md.appendMarkdown(`**Approvals:** ${approved}/${required}`);
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

    md.appendMarkdown(`[Open in GitLab](${mr.webUrl})`);

    return md;
  }
}
