import * as vscode from "vscode";
import { VIEW_EPICS, VIEW_MRS, VIEW_PIPELINES, CONFIG, CTX } from "./constants";
import { EpicManager } from "./services/epicManager";
import { EpicTreeProvider } from "./providers/epicTreeProvider";
import { MrTreeProvider } from "./providers/mrTreeProvider";
import { PipelineTreeProvider } from "./providers/pipelineTreeProvider";
import { DashboardPanel } from "./views/dashboardPanel";
import { registerScanCommands } from "./commands/scan";
import { registerFilterCommands } from "./commands/filter";
import { registerOpenCommands } from "./commands/open";
import { registerCredentialCommands } from "./commands/credentials";
import { registerMrCommands } from "./commands/gitlab";
import { registerPipelineCommands } from "./commands/pipelines";
import { JiraClient } from "./services/jiraClient";
import { GitLabClient } from "./services/gitlabClient";
import { GitHubClient } from "./services/githubClient";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Epic Lens");
  output.appendLine("Epic Lens activating...");

  // Services
  const jiraClient = new JiraClient(context.secrets);
  const manager = new EpicManager(context, jiraClient);
  const gitlabClient = new GitLabClient(context.secrets);
  const githubClient = new GitHubClient(context.secrets);

  // Jira TreeView
  const treeProvider = new EpicTreeProvider(manager);
  const treeView = vscode.window.createTreeView(VIEW_EPICS, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // GitLab MR TreeView
  const mrTreeProvider = new MrTreeProvider(gitlabClient, githubClient, output);
  treeProvider.setMrTreeProvider(mrTreeProvider);
  const mrTreeView = vscode.window.createTreeView(VIEW_MRS, {
    treeDataProvider: mrTreeProvider,
  });

  // Pipeline TreeView
  const pipelineTreeProvider = new PipelineTreeProvider(gitlabClient, githubClient, output);
  const pipelineTreeView = vscode.window.createTreeView(VIEW_PIPELINES, {
    treeDataProvider: pipelineTreeProvider,
    showCollapseAll: true,
  });

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBar.command = "epicLens.openDashboard";
  context.subscriptions.push(statusBar);

  const refreshStatusBar = () =>
    updateStatusBar(manager, mrTreeProvider, pipelineTreeProvider, statusBar);

  manager.onDidChangeEpics(() => {
    refreshStatusBar();
    // Badge: total open issues (epic children + orphans)
    const allIssues = [
      ...manager.epics.flatMap((e) => e.issues),
      ...manager.orphans,
    ];
    const openCount = allIssues.filter(
      (i) => i.statusCategory !== "done"
    ).length;
    treeView.badge = openCount > 0
      ? { value: openCount, tooltip: `${openCount} open issue${openCount !== 1 ? "s" : ""}` }
      : undefined;
  });

  mrTreeProvider.onDidChangeTreeData(() => {
    refreshStatusBar();
    const mrCount = mrTreeProvider.mrs.length;
    mrTreeView.badge = mrCount > 0
      ? { value: mrCount, tooltip: `${mrCount} open MR/PR${mrCount !== 1 ? "s" : ""}` }
      : undefined;
  });

  pipelineTreeProvider.onDidChangeTreeData(() => {
    refreshStatusBar();
    const pipelineCount = pipelineTreeProvider.pipelines.length;
    pipelineTreeView.badge = pipelineCount > 0
      ? { value: pipelineCount, tooltip: `${pipelineCount} recent pipeline${pipelineCount !== 1 ? "s" : ""}` }
      : undefined;
  });

  // Dashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.openDashboard", () => {
      DashboardPanel.createOrShow(context.extensionUri, manager, mrTreeProvider);
    })
  );

  // Register all command groups
  registerScanCommands(context, manager);
  registerFilterCommands(context, manager);
  registerOpenCommands(context);
  registerCredentialCommands(context, jiraClient);
  registerMrCommands(context, gitlabClient, githubClient, mrTreeProvider);
  registerPipelineCommands(context, pipelineTreeProvider, gitlabClient, githubClient, output);

  // Subscriptions
  context.subscriptions.push(
    manager, jiraClient, gitlabClient, githubClient, treeView, mrTreeView, pipelineTreeView, output
  );

  // Auto-fetch on startup
  const scanOnStartup =
    vscode.workspace
      .getConfiguration()
      .get<boolean>(CONFIG.scanOnStartup) ?? true;

  const fetchAll = () => {
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Epic Lens: Loading..." },
      async () => {
        await Promise.all([
          manager.scan(),
          mrTreeProvider.fetch(),
          pipelineTreeProvider.fetch(),
        ]);
      }
    );
  };

  if (scanOnStartup) {
    // Small delay to let workspace fully load
    setTimeout(fetchAll, 1500);
  }

  // Auto-refresh interval
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  const setupAutoRefresh = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    const minutes =
      vscode.workspace
        .getConfiguration()
        .get<number>(CONFIG.autoRefreshInterval) ?? 5;
    if (minutes > 0) {
      const ms = minutes * 60_000;
      refreshTimer = setInterval(() => {
        output.appendLine(`Auto-refresh triggered (every ${minutes}m)`);
        fetchAll();
      }, ms);
      output.appendLine(`Auto-refresh set to ${minutes} minutes`);
    }
  };

  setupAutoRefresh();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG.autoRefreshInterval)) {
        setupAutoRefresh();
      }
      if (e.affectsConfiguration(CONFIG.pipelineScope)) {
        pipelineTreeProvider.fetch();
      }
    }),
    { dispose: () => { if (refreshTimer) clearInterval(refreshTimer); } }
  );

  output.appendLine("Epic Lens activated");
}

function updateStatusBar(
  manager: EpicManager,
  mrTreeProvider: MrTreeProvider,
  pipelineTreeProvider: PipelineTreeProvider,
  statusBar: vscode.StatusBarItem
): void {
  const epics = manager.epics;
  const orphans = manager.orphans;
  const mrCount = mrTreeProvider.mrs.length;
  const pipelineCount = pipelineTreeProvider.pipelines.length;
  const failedPipelines = pipelineTreeProvider.pipelines.filter(
    (p) => p.status === "failed"
  ).length;

  if (epics.length === 0 && orphans.length === 0 && mrCount === 0 && pipelineCount === 0) {
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

  const parts: string[] = [];

  if (epics.length > 0 || orphans.length > 0) {
    parts.push(`$(telescope) ${epics.length} epics`);
    if (total > 0) {
      parts.push(`${done}/${total} done`);
      if (inProgress > 0) parts.push(`${inProgress} active`);
      if (blocked > 0) parts.push(`${blocked} blocked`);
    }
  }

  if (mrCount > 0) {
    parts.push(`$(git-pull-request) ${mrCount} MR/PR`);
  }

  if (pipelineCount > 0) {
    if (failedPipelines > 0) {
      parts.push(`$(error) ${failedPipelines} failed`);
    } else {
      parts.push(`$(play-circle) ${pipelineCount} pipelines`);
    }
  }

  statusBar.text = parts.join(" · ");

  const tooltipLines = ["Epic Lens: Click to open dashboard"];
  if (epics.length > 0) {
    tooltipLines.push(
      "",
      "Epics:",
      ...epics.map((e) => `  ${e.key}: ${e.summary}`)
    );
  }
  if (mrCount > 0) {
    tooltipLines.push(
      "",
      `Open MRs/PRs: ${mrCount}`
    );
  }
  if (pipelineCount > 0) {
    tooltipLines.push(
      "",
      `Pipelines: ${pipelineCount}${failedPipelines > 0 ? ` (${failedPipelines} failed)` : ""}`
    );
  }
  statusBar.tooltip = tooltipLines.join("\n");
  statusBar.show();
}

export function deactivate(): void {}
