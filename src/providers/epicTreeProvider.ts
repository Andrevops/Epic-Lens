import * as vscode from "vscode";
import * as path from "path";
import { CONFIG, STATUS_EMOJI, CMD } from "../constants";
import type { EpicData, IssueData } from "../types";
import type { EpicManager } from "../services/epicManager";

type TreeNode = RepoNode | EpicNode | IssueNode;

interface RepoNode {
  kind: "repo";
  name: string;
  epics: EpicData[];
}

interface EpicNode {
  kind: "epic";
  epic: EpicData;
}

interface IssueNode {
  kind: "issue";
  issue: IssueData;
  epicDir: string;
  jiraBaseUrl: string;
}

export class EpicTreeProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private _manager: EpicManager) {
    _manager.onDidChangeEpics(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "repo":
        return this._repoItem(node);
      case "epic":
        return this._epicItem(node);
      case "issue":
        return this._issueItem(node);
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) return this._getRootNodes();

    if (node.kind === "repo") {
      return node.epics.map((epic) => ({ kind: "epic" as const, epic }));
    }

    if (node.kind === "epic") {
      const jiraBaseUrl = (
        vscode.workspace
          .getConfiguration()
          .get<string>(CONFIG.jiraBaseUrl) ?? ""
      ).replace(/\/$/, "");

      return this._manager
        .getFilteredEpics()
        .find((e) => e.key === node.epic.key)
        ?.issues.map((issue) => ({
          kind: "issue" as const,
          issue,
          epicDir: node.epic.dir,
          jiraBaseUrl,
        })) ?? [];
    }

    return [];
  }

  private _getRootNodes(): TreeNode[] {
    const epics = this._manager.getFilteredEpics();
    const showGrouping =
      vscode.workspace
        .getConfiguration()
        .get<boolean>(CONFIG.showRepoGrouping) ?? true;

    if (!showGrouping || epics.length === 0) {
      return epics.map((epic) => ({ kind: "epic" as const, epic }));
    }

    // Group by repoName
    const groups = new Map<string, EpicData[]>();
    for (const epic of epics) {
      const existing = groups.get(epic.repoName) ?? [];
      existing.push(epic);
      groups.set(epic.repoName, existing);
    }

    // If single repo, flatten
    if (groups.size === 1) {
      return epics.map((epic) => ({ kind: "epic" as const, epic }));
    }

    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, repoEpics]) => ({
        kind: "repo" as const,
        name,
        epics: repoEpics,
      }));
  }

  private _repoItem(node: RepoNode): vscode.TreeItem {
    const totalIssues = node.epics.reduce(
      (sum, e) => sum + e.issues.length,
      0
    );
    const item = new vscode.TreeItem(
      node.name,
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.iconPath = new vscode.ThemeIcon("folder");
    item.description = `${node.epics.length} epic${node.epics.length !== 1 ? "s" : ""}, ${totalIssues} issues`;
    item.contextValue = "repo";
    return item;
  }

  private _epicItem(node: EpicNode): vscode.TreeItem {
    const { epic } = node;
    const done = epic.issues.filter(
      (i) => i.statusCategory === "done"
    ).length;
    const total = epic.issues.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const label = `${epic.key} ${epic.summary}`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.Collapsed
    );

    item.description = `${done}/${total} done (${pct}%)`;
    item.iconPath = new vscode.ThemeIcon(
      "symbol-class",
      new vscode.ThemeColor("charts.purple")
    );
    item.tooltip = this._epicTooltip(epic, done, total, pct);
    item.contextValue = "epic";

    // Click to open epic markdown
    item.command = {
      command: CMD.openFile,
      title: "Open Epic File",
      arguments: [epic.file],
    };

    return item;
  }

  private _epicTooltip(
    epic: EpicData,
    done: number,
    total: number,
    pct: number
  ): vscode.MarkdownString {
    const bar = this._progressBar(pct);
    const md = new vscode.MarkdownString();
    md.appendMarkdown(
      `**${epic.key}** — ${epic.summary}\n\n`
    );
    md.appendMarkdown(`${bar} ${done}/${total} (${pct}%)\n\n`);
    md.appendMarkdown(`📁 \`${epic.repoName}\`\n\n`);
    md.appendMarkdown(
      `🕐 Created: ${new Date(epic.timestamp).toLocaleDateString()}`
    );
    return md;
  }

  private _progressBar(pct: number): string {
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
  }

  private _issueItem(node: IssueNode): vscode.TreeItem {
    const { issue } = node;
    const emoji = STATUS_EMOJI[issue.statusCategory];
    const statusText = issue.totalCount > 0
      ? `${issue.status} [${issue.checkedCount}/${issue.totalCount}]`
      : issue.status;

    const label = `${emoji} ${issue.key} ${issue.type}: ${issue.summary}`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = statusText;
    item.iconPath = this._issueIcon(issue);
    item.tooltip = this._issueTooltip(issue, node.jiraBaseUrl);
    item.contextValue = "issue";

    // Click to open the markdown file
    item.command = {
      command: CMD.openFile,
      title: "Open Issue File",
      arguments: [issue.filePath],
    };

    return item;
  }

  private _issueIcon(issue: IssueData): vscode.ThemeIcon {
    switch (issue.statusCategory) {
      case "done":
        return new vscode.ThemeIcon(
          "pass-filled",
          new vscode.ThemeColor("testing.iconPassed")
        );
      case "in_progress":
        return new vscode.ThemeIcon(
          "loading~spin",
          new vscode.ThemeColor("charts.blue")
        );
      case "review":
        return new vscode.ThemeIcon(
          "eye",
          new vscode.ThemeColor("charts.yellow")
        );
      case "qa":
        return new vscode.ThemeIcon(
          "beaker",
          new vscode.ThemeColor("charts.orange")
        );
      case "blocked":
        return new vscode.ThemeIcon(
          "error",
          new vscode.ThemeColor("testing.iconFailed")
        );
      case "rejected":
        return new vscode.ThemeIcon(
          "circle-slash",
          new vscode.ThemeColor("disabledForeground")
        );
      default:
        return new vscode.ThemeIcon("circle-outline");
    }
  }

  private _issueTooltip(
    issue: IssueData,
    jiraBaseUrl: string
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(
      `**${issue.key}** — ${issue.summary}\n\n`
    );
    md.appendMarkdown(`**Type:** ${issue.type}\n\n`);
    md.appendMarkdown(`**Status:** ${issue.status}\n\n`);
    if (issue.totalCount > 0) {
      const pct = Math.round(
        (issue.checkedCount / issue.totalCount) * 100
      );
      const bar = this._progressBar(pct);
      md.appendMarkdown(
        `**Criteria:** ${bar} ${issue.checkedCount}/${issue.totalCount} (${pct}%)\n\n`
      );
    }
    if (jiraBaseUrl) {
      md.appendMarkdown(
        `[Open in Jira](${jiraBaseUrl}/browse/${issue.key})`
      );
    }
    return md;
  }
}
