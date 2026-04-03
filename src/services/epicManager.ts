import * as vscode from "vscode";
import { CONFIG, CTX } from "../constants";
import type { EpicData, IssueData, FilterState } from "../types";
import type { JiraClient } from "./jiraClient";

export class EpicManager implements vscode.Disposable {
  private _epics: EpicData[] = [];
  private _filters: FilterState = {
    statusFilter: "all",
    typeFilter: "all",
    hideDone: false,
  };

  private _disposables: vscode.Disposable[] = [];

  private _onDidChangeEpics = new vscode.EventEmitter<void>();
  readonly onDidChangeEpics = this._onDidChangeEpics.event;

  private _onDidChangeFilters = new vscode.EventEmitter<FilterState>();
  readonly onDidChangeFilters = this._onDidChangeFilters.event;

  private _output: vscode.OutputChannel;

  constructor(
    private _context: vscode.ExtensionContext,
    private _jiraClient: JiraClient
  ) {
    this._output = vscode.window.createOutputChannel("Epic Lens");

    // Restore filter state
    const saved = _context.workspaceState.get<FilterState>(
      "epicLens.filters"
    );
    if (saved) this._filters = saved;

    // Watch config changes
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG.hideDoneIssues)) {
          this._filters.hideDone =
            vscode.workspace
              .getConfiguration()
              .get<boolean>(CONFIG.hideDoneIssues) ?? false;
          this._persistFilters();
          this._onDidChangeFilters.fire(this._filters);
          this._onDidChangeEpics.fire();
        }
        // Rescan when Jira config changes
        if (
          e.affectsConfiguration(CONFIG.jiraProject) ||
          e.affectsConfiguration(CONFIG.jiraJql) ||
          e.affectsConfiguration(CONFIG.jiraBaseUrl) ||
          e.affectsConfiguration(CONFIG.jiraEmail)
        ) {
          this.scan();
        }
      })
    );
  }

  get epics(): EpicData[] {
    return this._epics;
  }

  get filters(): FilterState {
    return { ...this._filters };
  }

  /** Get epics with filters applied */
  getFilteredEpics(): EpicData[] {
    let epics = this._epics;

    return epics
      .map((epic) => ({
        ...epic,
        issues: this._filterIssues(epic.issues),
      }))
      .filter((epic) => epic.issues.length > 0);
  }

  private _filterIssues(issues: IssueData[]): IssueData[] {
    return issues.filter((issue) => {
      if (
        this._filters.hideDone &&
        issue.statusCategory === "done"
      ) {
        return false;
      }
      if (
        this._filters.statusFilter !== "all" &&
        issue.statusCategory !== this._filters.statusFilter
      ) {
        return false;
      }
      if (
        this._filters.typeFilter !== "all" &&
        issue.type.toLowerCase() !== this._filters.typeFilter.toLowerCase()
      ) {
        return false;
      }
      return true;
    });
  }

  setStatusFilter(filter: FilterState["statusFilter"]): void {
    this._filters.statusFilter = filter;
    this._persistFilters();
    this._updateContexts();
    this._onDidChangeFilters.fire(this._filters);
    this._onDidChangeEpics.fire();
  }

  setTypeFilter(filter: FilterState["typeFilter"]): void {
    this._filters.typeFilter = filter;
    this._persistFilters();
    this._updateContexts();
    this._onDidChangeFilters.fire(this._filters);
    this._onDidChangeEpics.fire();
  }

  toggleHideDone(): void {
    this._filters.hideDone = !this._filters.hideDone;
    vscode.workspace
      .getConfiguration()
      .update(CONFIG.hideDoneIssues, this._filters.hideDone, true);
    this._persistFilters();
    this._updateContexts();
    this._onDidChangeFilters.fire(this._filters);
    this._onDidChangeEpics.fire();
  }

  clearFilters(): void {
    this._filters = { statusFilter: "all", typeFilter: "all", hideDone: false };
    this._persistFilters();
    this._updateContexts();
    this._onDidChangeFilters.fire(this._filters);
    this._onDidChangeEpics.fire();
  }

  /** Fetch epics and issues from Jira */
  async scan(): Promise<void> {
    this._output.appendLine(
      `[${new Date().toISOString()}] Fetching epics from Jira...`
    );

    const hasCredentials = await this._jiraClient.hasCredentials();
    if (!hasCredentials) {
      this._output.appendLine("  No Jira credentials configured — skipping");
      return;
    }

    this._epics = await this._jiraClient.fetchEpics();

    const totalIssues = this._epics.reduce((s, e) => s + e.issues.length, 0);
    const doneIssues = this._epics.reduce(
      (s, e) => s + e.issues.filter((i) => i.statusCategory === "done").length,
      0
    );
    this._output.appendLine(
      `  Found ${this._epics.length} epics, ${totalIssues} issues (${doneIssues} done)`
    );

    this._updateContexts();
    this._onDidChangeEpics.fire();
  }

  /** Get unique issue types across all epics */
  getIssueTypes(): string[] {
    const types = new Set<string>();
    for (const epic of this._epics) {
      for (const issue of epic.issues) {
        types.add(issue.type);
      }
    }
    return [...types].sort();
  }

  private _updateContexts(): void {
    vscode.commands.executeCommand(
      "setContext",
      CTX.hasEpics,
      this._epics.length > 0
    );
    vscode.commands.executeCommand(
      "setContext",
      CTX.hasFilters,
      this._filters.statusFilter !== "all" ||
        this._filters.typeFilter !== "all" ||
        this._filters.hideDone
    );
    vscode.commands.executeCommand(
      "setContext",
      CTX.hideDone,
      this._filters.hideDone
    );
  }

  private _persistFilters(): void {
    this._context.workspaceState.update("epicLens.filters", this._filters);
  }

  dispose(): void {
    this._onDidChangeEpics.dispose();
    this._onDidChangeFilters.dispose();
    this._output.dispose();
    for (const d of this._disposables) d.dispose();
  }
}
