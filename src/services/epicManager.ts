import * as vscode from "vscode";
import { CONFIG, CTX } from "../constants";
import type { EpicData, IssueData, FilterState } from "../types";
import { discoverEpics, collectScanRoots } from "../utils/discovery";

export class EpicManager implements vscode.Disposable {
  private _epics: EpicData[] = [];
  private _rootFilter: string | undefined;
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
    private _context: vscode.ExtensionContext
  ) {
    this._output = vscode.window.createOutputChannel("Epic Lens");

    // Restore filter state
    const saved = _context.workspaceState.get<FilterState>(
      "epicLens.filters"
    );
    if (saved) this._filters = saved;

    // Apply rootPath config as initial root filter
    const configRoot = vscode.workspace
      .getConfiguration()
      .get<string>(CONFIG.rootPath);
    if (configRoot) {
      this._rootFilter = configRoot;
    }

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
        // Update root filter when rootPath changes
        if (e.affectsConfiguration(CONFIG.rootPath)) {
          const newRoot = vscode.workspace
            .getConfiguration()
            .get<string>(CONFIG.rootPath);
          this._rootFilter = newRoot || undefined;
          this._updateContexts();
          this._onDidChangeEpics.fire();
          this.scan();
        }
        // Rescan if scanPaths or diffchestrator roots change
        if (
          e.affectsConfiguration(CONFIG.scanPaths) ||
          e.affectsConfiguration("diffchestrator.scanRoots")
        ) {
          this.scan();
        }
      })
    );

    // File watcher for .jira-upload-state.json changes
    const stateWatcher = vscode.workspace.createFileSystemWatcher(
      "**/.jira-upload-state.json"
    );
    stateWatcher.onDidChange(() => this.scan());
    stateWatcher.onDidCreate(() => this.scan());
    stateWatcher.onDidDelete(() => this.scan());
    this._disposables.push(stateWatcher);

    // File watcher for markdown file changes (acceptance criteria updates)
    const mdWatcher = vscode.workspace.createFileSystemWatcher(
      "**/docs/**/*.md"
    );
    mdWatcher.onDidChange(() => this.scan());
    this._disposables.push(mdWatcher);
  }

  get epics(): EpicData[] {
    return this._epics;
  }

  get filters(): FilterState {
    return { ...this._filters };
  }

  get rootFilter(): string | undefined {
    return this._rootFilter;
  }

  /** Set the root filter — only show epics under this path */
  setRootFilter(root: string | undefined): void {
    this._rootFilter = root;
    this._updateContexts();
    this._onDidChangeEpics.fire();
  }

  /** Get epics with filters applied (root + status + type) */
  getFilteredEpics(): EpicData[] {
    let epics = this._epics;

    // Filter by Diffchestrator root path
    if (this._rootFilter) {
      const root = this._rootFilter;
      epics = epics.filter(
        (e) => e.repoPath.startsWith(root) || e.dir.startsWith(root)
      );
    }

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

  /** Scan all roots for .jira-upload-state.json files */
  async scan(): Promise<void> {
    this._output.appendLine(
      `[${new Date().toISOString()}] Scanning for epics...`
    );
    const roots = collectScanRoots();
    this._output.appendLine(`  Scan roots: ${roots.join(", ")}`);

    this._epics = await discoverEpics(roots);

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

  /** Detect if Diffchestrator extension is installed */
  detectDiffchestrator(): boolean {
    const ext = vscode.extensions.getExtension(
      "andrevops-com.diffchestrator"
    );
    return !!ext;
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
        this._filters.hideDone ||
        !!this._rootFilter
    );
    vscode.commands.executeCommand(
      "setContext",
      CTX.hideDone,
      this._filters.hideDone
    );
    vscode.commands.executeCommand(
      "setContext",
      CTX.hasDiffchestrator,
      this.detectDiffchestrator()
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
