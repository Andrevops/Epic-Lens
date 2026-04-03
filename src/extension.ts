import * as vscode from "vscode";
import { VIEW_EPICS, CONFIG, CTX } from "./constants";
import { EpicManager } from "./services/epicManager";
import { EpicTreeProvider } from "./providers/epicTreeProvider";
import { DashboardPanel } from "./views/dashboardPanel";
import { registerScanCommands } from "./commands/scan";
import { registerFilterCommands } from "./commands/filter";
import { registerOpenCommands } from "./commands/open";
import { registerCredentialCommands } from "./commands/credentials";
import { JiraClient } from "./services/jiraClient";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Epic Lens");
  output.appendLine("Epic Lens activating...");

  // Services
  const jiraClient = new JiraClient(context.secrets);
  const manager = new EpicManager(context, jiraClient);

  // TreeView
  const treeProvider = new EpicTreeProvider(manager);
  const treeView = vscode.window.createTreeView(VIEW_EPICS, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBar.command = "epicLens.openDashboard";
  context.subscriptions.push(statusBar);

  manager.onDidChangeEpics(() => {
    updateStatusBar(manager, statusBar);
  });

  // Dashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.openDashboard", () => {
      DashboardPanel.createOrShow(context.extensionUri, manager);
    })
  );

  // Register all command groups
  registerScanCommands(context, manager);
  registerFilterCommands(context, manager);
  registerOpenCommands(context);
  registerCredentialCommands(context, jiraClient);

  // Subscriptions
  context.subscriptions.push(manager, jiraClient, treeView, output);

  // Auto-fetch on startup
  const scanOnStartup =
    vscode.workspace
      .getConfiguration()
      .get<boolean>(CONFIG.scanOnStartup) ?? true;

  if (scanOnStartup) {
    // Small delay to let workspace fully load
    setTimeout(() => manager.scan(), 1500);
  }

  output.appendLine("Epic Lens activated");
}

function updateStatusBar(
  manager: EpicManager,
  statusBar: vscode.StatusBarItem
): void {
  const epics = manager.epics;
  const orphans = manager.orphans;
  if (epics.length === 0 && orphans.length === 0) {
    statusBar.hide();
    return;
  }

  const allIssues = [...epics.flatMap((e) => e.issues), ...orphans];
  const total = allIssues.length;
  const done = allIssues.filter(
    (i) => i.statusCategory === "done"
  ).length;
  const inProgress = allIssues.filter(
    (i) => i.statusCategory === "in_progress"
  ).length;
  const blocked = allIssues.filter(
    (i) => i.statusCategory === "blocked"
  ).length;

  const parts: string[] = [`$(telescope) ${epics.length} epics`];
  if (total > 0) {
    parts.push(`${done}/${total} done`);
    if (inProgress > 0) parts.push(`${inProgress} active`);
    if (blocked > 0) parts.push(`${blocked} blocked`);
  }

  statusBar.text = parts.join(" · ");
  statusBar.tooltip = `Epic Lens: Click to open dashboard\n${epics.map((e) => `  ${e.key}: ${e.summary}`).join("\n")}`;
  statusBar.show();
}

export function deactivate(): void {}
