import * as vscode from "vscode";
import { CONFIG, STATUS_EMOJI, CMD } from "../constants";
import type { EpicData, IssueData } from "../types";
import type { EpicManager } from "../services/epicManager";

type TreeNode = EpicNode | IssueNode;

interface EpicNode {
  kind: "epic";
  epic: EpicData;
}

interface IssueNode {
  kind: "issue";
  issue: IssueData;
  epicKey: string;
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
      case "epic":
        return this._epicItem(node);
      case "issue":
        return this._issueItem(node);
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) return this._getRootNodes();

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
          epicKey: node.epic.key,
          jiraBaseUrl,
        })) ?? [];
    }

    return [];
  }

  private _getRootNodes(): TreeNode[] {
    const epics = this._manager.getFilteredEpics();
    return epics.map((epic) => ({ kind: "epic" as const, epic }));
  }

  private _epicItem(node: EpicNode): vscode.TreeItem {
    const { epic } = node;
    const done = epic.issues.filter(
      (i) => i.statusCategory === "done"
    ).length;
    const total = epic.issues.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const emoji = STATUS_EMOJI[epic.statusCategory] ?? "📋";
    const label = `${emoji} ${epic.key} ${epic.summary}`;
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

    // Click opens in Jira
    item.command = {
      command: CMD.openInJira,
      title: "Open in Jira",
      arguments: [epic.key],
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
    md.appendMarkdown(`**Status:** ${epic.status}`);
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

    const label = `${emoji} ${issue.key} ${issue.type}: ${issue.summary}`;
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = issue.status;
    item.iconPath = this._issueIcon(issue);
    item.tooltip = this._issueTooltip(issue, node.jiraBaseUrl);
    item.contextValue = "issue";

    // Click opens in Jira
    item.command = {
      command: CMD.openInJira,
      title: "Open in Jira",
      arguments: [issue.key],
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
    if (issue.assignee) {
      md.appendMarkdown(`**Assignee:** ${issue.assignee}\n\n`);
    }
    if (issue.priority) {
      md.appendMarkdown(`**Priority:** ${issue.priority}\n\n`);
    }
    if (jiraBaseUrl) {
      md.appendMarkdown(
        `[Open in Jira](${jiraBaseUrl}/browse/${issue.key})`
      );
    }
    return md;
  }
}
