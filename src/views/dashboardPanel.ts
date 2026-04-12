import * as vscode from "vscode";
import * as path from "path";
import type { EpicManager } from "../services/epicManager";
import type { MrTreeProvider } from "../providers/mrTreeProvider";
import type { ExtensionMessage, WebviewMessage, MergeRequestData } from "../types";

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private static readonly _viewType = "epicLens.dashboard";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private _manager: EpicManager,
    private _mrTreeProvider?: MrTreeProvider
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtml();

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this._handleMessage(msg),
      null,
      this._disposables
    );

    // Refresh when data changes
    this._disposables.push(
      this._manager.onDidChangeEpics(() => this._sendData())
    );
    if (this._mrTreeProvider) {
      this._disposables.push(
        this._mrTreeProvider.onDidChangeTreeData(() => this._sendData())
      );
    }
    this._disposables.push(
      this._manager.onDidChangeFilters((filters) => {
        this._postMessage({ type: "filtersChanged", filters });
      })
    );

    this._panel.onDidDispose(
      () => this.dispose(),
      null,
      this._disposables
    );
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    manager: EpicManager,
    mrTreeProvider?: MrTreeProvider
  ): void {
    const column = vscode.ViewColumn.One;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel._viewType,
      "Epic Lens Dashboard",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist"),
          vscode.Uri.joinPath(extensionUri, "webview-ui", "dist"),
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(
      panel,
      extensionUri,
      manager,
      mrTreeProvider
    );
  }

  private _handleMessage(msg: WebviewMessage): void {
    switch (msg.type) {
      case "ready":
        this._sendData();
        break;
      case "refresh":
        this._manager.scan();
        break;
      case "openInJira":
        vscode.commands.executeCommand("epicLens.openInJira", msg.key);
        break;
      case "copyKey":
        vscode.commands.executeCommand("epicLens.copyKey", msg.key);
        break;
      case "openMR":
        if (msg.url) {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
      case "setFilter":
        if (msg.filters.statusFilter !== undefined) {
          this._manager.setStatusFilter(msg.filters.statusFilter);
        }
        if (msg.filters.typeFilter !== undefined) {
          this._manager.setTypeFilter(msg.filters.typeFilter);
        }
        if (msg.filters.hideDone !== undefined && msg.filters.hideDone !== this._manager.filters.hideDone) {
          this._manager.toggleHideDone();
        }
        break;
    }
  }

  private _sendData(): void {
    const epics = this._manager.getFilteredEpics();
    const filters = this._manager.filters;
    const mrs = this._mrTreeProvider?.mrs ?? [];
    this._postMessage({ type: "setData", epics, filters, mrs });
  }

  private _postMessage(msg: ExtensionMessage): void {
    this._panel.webview.postMessage(msg);
  }

  private _getHtml(): string {
    const webview = this._panel.webview;
    const nonce = getNonce();

    // Try to load built webview assets
    const webviewDist = vscode.Uri.joinPath(
      this._extensionUri,
      "webview-ui",
      "dist"
    );

    let scriptUri: vscode.Uri;
    let styleUri: vscode.Uri;
    let useBuiltAssets = false;

    try {
      scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(webviewDist, "index.js")
      );
      styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(webviewDist, "index.css")
      );
      useBuiltAssets = true;
    } catch {
      // Fallback to inline
      scriptUri = vscode.Uri.parse("");
      styleUri = vscode.Uri.parse("");
    }

    if (useBuiltAssets) {
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Epic Lens Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    // Inline fallback (works without webview build)
    return this._getInlineHtml(nonce);
  }

  private _getInlineHtml(nonce: string): string {
    const webview = this._panel.webview;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Epic Lens Dashboard</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --card-bg: var(--vscode-editorWidget-background);
      --badge-done: #2ea043;
      --badge-progress: #388bfd;
      --badge-review: #d29922;
      --badge-qa: #db6d28;
      --badge-blocked: #f85149;
      --badge-rejected: #6e7681;
      --badge-backlog: #8b949e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      padding: 16px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .toolbar h1 {
      font-size: 1.4em;
      font-weight: 600;
      flex: 1;
    }
    .toolbar select, .toolbar button {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.9em;
      cursor: pointer;
    }
    .toolbar button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 20px;
      min-width: 120px;
      text-align: center;
    }
    .stat-card .number { font-size: 1.8em; font-weight: 700; }
    .stat-card .label { font-size: 0.8em; opacity: 0.7; margin-top: 4px; }
    .board {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .column {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .column-header {
      padding: 10px 14px;
      font-weight: 600;
      font-size: 0.95em;
      border-bottom: 2px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .column-header .count {
      background: var(--border);
      border-radius: 10px;
      padding: 2px 8px;
      font-size: 0.8em;
      font-weight: 400;
    }
    .column-body {
      padding: 8px;
      max-height: 70vh;
      overflow-y: auto;
    }
    .card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: border-color 0.15s;
      border-left: 3px solid transparent;
    }
    .card:hover { border-color: var(--vscode-focusBorder); }
    .card.done { border-left-color: var(--badge-done); }
    .card.in_progress { border-left-color: var(--badge-progress); }
    .card.review { border-left-color: var(--badge-review); }
    .card.qa { border-left-color: var(--badge-qa); }
    .card.blocked { border-left-color: var(--badge-blocked); }
    .card.rejected { border-left-color: var(--badge-rejected); }
    .card.backlog { border-left-color: var(--badge-backlog); }
    .card-key {
      font-size: 0.8em;
      opacity: 0.6;
      font-family: var(--vscode-editor-font-family);
    }
    .card-title {
      font-size: 0.9em;
      margin-top: 4px;
      line-height: 1.3;
    }
    .card-meta {
      display: flex;
      gap: 8px;
      margin-top: 6px;
      font-size: 0.75em;
      opacity: 0.6;
    }
    .badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: 500;
    }
    .epic-section {
      margin-bottom: 24px;
    }
    .epic-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .epic-header h2 {
      font-size: 1.1em;
      font-weight: 600;
      cursor: pointer;
    }
    .epic-header h2:hover { text-decoration: underline; }
    .progress-bar {
      flex: 1;
      max-width: 200px;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--badge-done);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .progress-text { font-size: 0.8em; opacity: 0.7; }
    .empty { text-align: center; padding: 40px; opacity: 0.5; }
    .context-menu {
      position: absolute;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 100;
      min-width: 160px;
    }
    .context-menu-item {
      padding: 6px 14px;
      cursor: pointer;
      font-size: 0.9em;
    }
    .context-menu-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .view-toggle { display: flex; gap: 4px; }
    .view-toggle button {
      padding: 4px 10px;
      border-radius: 4px;
    }
    .view-toggle button.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="toolbar">
      <h1>⚡ Epic Lens Dashboard</h1>
      <div class="view-toggle">
        <button id="btn-board" class="active" title="Board View">Board</button>
        <button id="btn-list" title="List View">List</button>
      </div>
      <select id="filter-status">
        <option value="all">All Statuses</option>
        <option value="backlog">📋 Backlog / To Do</option>
        <option value="in_progress">🔄 In Progress</option>
        <option value="review">👀 Review</option>
        <option value="qa">🧪 QA / Testing</option>
        <option value="blocked">🚫 Blocked</option>
        <option value="done">✅ Done</option>
        <option value="rejected">❌ Rejected</option>
      </select>
      <select id="filter-type">
        <option value="all">All Types</option>
      </select>
      <label style="display:flex;align-items:center;gap:4px;">
        <input type="checkbox" id="filter-hide-done"> Hide Done
      </label>
      <button id="btn-refresh" title="Refresh">⟳ Refresh</button>
    </div>
    <div class="stats" id="stats"></div>
    <div id="content"></div>
    <div id="mr-section" style="margin-top:32px;"></div>
  </div>

  <div id="context-menu" class="context-menu" style="display:none;"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let epics = [];
    let mrs = [];
    let filters = { statusFilter: 'all', typeFilter: 'all', hideDone: false };
    let viewMode = 'board';
    let contextMenuTarget = null;

    const STATUS_EMOJI = {
      done: '✅', in_progress: '🔄', review: '👀',
      qa: '🧪', blocked: '🚫', rejected: '❌', backlog: '📋'
    };
    const STATUS_LABELS = {
      done: 'Done', in_progress: 'In Progress', review: 'Review',
      qa: 'QA / Testing', blocked: 'Blocked', rejected: 'Rejected', backlog: 'Backlog / To Do'
    };
    const STATUS_ORDER = ['backlog', 'in_progress', 'review', 'qa', 'blocked', 'done', 'rejected'];

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'setData') {
        epics = msg.epics;
        mrs = msg.mrs || [];
        filters = msg.filters;
        syncFilterUI();
        render();
        renderMRSection();
      } else if (msg.type === 'filtersChanged') {
        filters = msg.filters;
        syncFilterUI();
      }
    });

    // Filter controls
    document.getElementById('filter-status').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setFilter', filters: { statusFilter: e.target.value } });
    });
    document.getElementById('filter-type').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setFilter', filters: { typeFilter: e.target.value } });
    });
    document.getElementById('filter-hide-done').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setFilter', filters: { hideDone: e.target.checked } });
    });
    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-board').addEventListener('click', () => {
      viewMode = 'board'; render(); updateViewToggle();
    });
    document.getElementById('btn-list').addEventListener('click', () => {
      viewMode = 'list'; render(); updateViewToggle();
    });

    // Context menu
    document.addEventListener('click', () => {
      document.getElementById('context-menu').style.display = 'none';
    });

    function updateViewToggle() {
      document.getElementById('btn-board').className = viewMode === 'board' ? 'active' : '';
      document.getElementById('btn-list').className = viewMode === 'list' ? 'active' : '';
    }

    function syncFilterUI() {
      document.getElementById('filter-status').value = filters.statusFilter;
      document.getElementById('filter-type').value = filters.typeFilter;
      document.getElementById('filter-hide-done').checked = filters.hideDone;
    }

    function render() {
      renderStats();
      populateTypeFilter();
      if (viewMode === 'board') renderBoard();
      else renderList();
    }

    function renderStats() {
      const all = epics.flatMap(e => e.issues);
      const done = all.filter(i => i.statusCategory === 'done').length;
      const active = all.filter(i => i.statusCategory === 'in_progress').length;
      const blocked = all.filter(i => i.statusCategory === 'blocked').length;
      const review = all.filter(i => i.statusCategory === 'review').length;
      const pct = all.length > 0 ? Math.round((done / all.length) * 100) : 0;

      document.getElementById('stats').innerHTML =
        statCard(epics.length, 'Epics') +
        statCard(all.length, 'Total Issues') +
        statCard(done + '/' + all.length, 'Done (' + pct + '%)') +
        statCard(active, 'In Progress') +
        statCard(review, 'In Review') +
        statCard(blocked, 'Blocked');
    }

    function statCard(num, label) {
      return '<div class="stat-card"><div class="number">' + num + '</div><div class="label">' + label + '</div></div>';
    }

    function populateTypeFilter() {
      const types = new Set();
      epics.forEach(e => e.issues.forEach(i => types.add(i.type)));
      const sel = document.getElementById('filter-type');
      const current = sel.value;
      sel.innerHTML = '<option value="all">All Types</option>';
      [...types].sort().forEach(t => {
        sel.innerHTML += '<option value="' + t + '">' + t + '</option>';
      });
      sel.value = current;
    }

    function renderBoard() {
      const allIssues = epics.flatMap(e =>
        e.issues.map(i => ({ ...i, epicKey: e.key, epicSummary: e.summary }))
      );

      const columns = {};
      STATUS_ORDER.forEach(s => { columns[s] = []; });
      allIssues.forEach(i => {
        const cat = i.statusCategory || 'backlog';
        if (!columns[cat]) columns[cat] = [];
        columns[cat].push(i);
      });

      let html = '<div class="board">';
      STATUS_ORDER.forEach(status => {
        const items = columns[status] || [];
        html += '<div class="column">';
        html += '<div class="column-header">' +
          STATUS_EMOJI[status] + ' ' + STATUS_LABELS[status] +
          ' <span class="count">' + items.length + '</span></div>';
        html += '<div class="column-body">';
        if (items.length === 0) {
          html += '<div class="empty">No issues</div>';
        } else {
          items.forEach(i => { html += cardHtml(i); });
        }
        html += '</div></div>';
      });
      html += '</div>';

      document.getElementById('content').innerHTML = html;
      attachCardListeners();
    }

    function renderList() {
      if (epics.length === 0) {
        document.getElementById('content').innerHTML = '<div class="empty">No epics found. Run "Epic Lens: Scan for Epics" to discover them.</div>';
        return;
      }

      let html = '';
      epics.forEach(epic => {
        const done = epic.issues.filter(i => i.statusCategory === 'done').length;
        const total = epic.issues.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        html += '<div class="epic-section">';
        html += '<div class="epic-header">';
        html += '<h2 data-key="' + epic.key + '">' + epic.key + ' — ' + esc(epic.summary) + '</h2>';
        html += '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>';
        html += '<span class="progress-text">' + done + '/' + total + ' (' + pct + '%)</span>';
        html += '</div>';

        epic.issues.forEach(i => {
          html += cardHtml({ ...i, epicKey: epic.key, epicSummary: epic.summary });
        });
        html += '</div>';
      });

      document.getElementById('content').innerHTML = html;
      attachCardListeners();

      // Epic header click
      document.querySelectorAll('.epic-header h2').forEach(el => {
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'openInJira', key: el.dataset.key });
        });
      });
    }

    function cardHtml(issue) {
      const cat = issue.statusCategory || 'backlog';
      const emoji = STATUS_EMOJI[cat] || '📋';
      return '<div class="card ' + cat + '" data-key="' + issue.key + '" oncontextmenu="showContextMenu(event, this)">' +
        '<div class="card-key">' + emoji + ' ' + issue.key + ' · ' + issue.type + '</div>' +
        '<div class="card-title">' + esc(issue.summary) + '</div>' +
        '<div class="card-meta">' +
          '<span>' + (issue.status || 'Unknown') + '</span>' +
        '</div>' +
      '</div>';
    }

    function attachCardListeners() {
      document.querySelectorAll('.card').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.button !== 0) return;
          vscode.postMessage({ type: 'openInJira', key: el.dataset.key });
        });
      });
    }

    function showContextMenu(e, el) {
      e.preventDefault();
      e.stopPropagation();
      const menu = document.getElementById('context-menu');
      const key = el.dataset.key;
      menu.innerHTML =
        '<div class="context-menu-item" onclick="vscode.postMessage({type:\\'openInJira\\',key:\\'' + key + '\\'})">🔗 Open in Jira</div>' +
        '<div class="context-menu-item" onclick="vscode.postMessage({type:\\'copyKey\\',key:\\'' + key + '\\'})">📋 Copy Key</div>';
      menu.style.left = e.pageX + 'px';
      menu.style.top = e.pageY + 'px';
      menu.style.display = 'block';
    }

    function esc(s) {
      if (!s) return '';
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    const MR_STATUS_EMOJI = {
      ready: '✅', approved: '👍', needs_review: '👀', draft: '✏️',
      ci_failed: '❌', ci_running: '🔄', has_conflicts: '⚠️',
      changes_requested: '🔃', discussions_open: '💬'
    };
    const MR_STATUS_LABELS = {
      ready: 'Ready to merge', approved: 'Approved', needs_review: 'Needs review',
      draft: 'Draft', ci_failed: 'Pipeline failed', ci_running: 'Pipeline running',
      has_conflicts: 'Has conflicts', changes_requested: 'Changes requested',
      discussions_open: 'Unresolved discussions'
    };
    const MR_STATUS_ORDER = ['needs_review', 'changes_requested', 'discussions_open', 'ci_failed', 'ci_running', 'has_conflicts', 'draft', 'approved', 'ready'];

    function renderMRSection() {
      const section = document.getElementById('mr-section');
      if (!mrs || mrs.length === 0) {
        section.innerHTML = '';
        return;
      }

      const providerIcon = (p) => p === 'github' ? '🐙' : '🦊';
      const prefix = (mr) => mr.provider === 'github' ? '#' : '!';

      // Stats
      let html = '<h1 style="margin-bottom:16px;">🔀 Merge Requests / Pull Requests (' + mrs.length + ')</h1>';
      html += '<div class="stats">';
      const byStatus = {};
      mrs.forEach(mr => {
        byStatus[mr.status] = (byStatus[mr.status] || 0) + 1;
      });
      MR_STATUS_ORDER.forEach(s => {
        if (byStatus[s]) {
          html += statCard((MR_STATUS_EMOJI[s] || '') + ' ' + byStatus[s], MR_STATUS_LABELS[s] || s);
        }
      });
      html += '</div>';

      // Cards grouped by project
      const byProject = {};
      mrs.forEach(mr => {
        const key = mr.provider + ':' + mr.projectPath;
        if (!byProject[key]) byProject[key] = { name: mr.projectName, provider: mr.provider, mrs: [] };
        byProject[key].mrs.push(mr);
      });

      html += '<div style="margin-top:16px;">';
      Object.values(byProject).forEach(group => {
        html += '<div class="epic-section">';
        html += '<div class="epic-header"><h2>' + providerIcon(group.provider) + ' ' + esc(group.name) + ' (' + group.mrs.length + ')</h2></div>';
        group.mrs.forEach(mr => {
          const statusColor = mr.status === 'ready' ? 'done' : mr.status === 'approved' ? 'in_progress' : mr.status === 'ci_failed' || mr.status === 'has_conflicts' ? 'blocked' : mr.status === 'draft' ? 'rejected' : 'review';
          const emoji = MR_STATUS_EMOJI[mr.status] || '📋';
          const ageDays = Math.floor((Date.now() - new Date(mr.createdAt).getTime()) / 86400000);
          const stale = ageDays > 7 ? ' ⏰ ' + ageDays + 'd' : '';
          html += '<div class="card ' + statusColor + '" style="cursor:pointer;" onclick="window.openMR(\\'' + mr.webUrl + '\\')">';
          html += '<div class="card-key">' + emoji + ' ' + providerIcon(mr.provider) + ' ' + prefix(mr) + mr.iid + (mr.role === 'reviewer' ? ' 📋 reviewer' : '') + stale + '</div>';
          html += '<div class="card-title">' + esc(mr.title) + '</div>';
          html += '<div class="card-meta">';
          html += '<span>' + esc(mr.sourceBranch) + ' → ' + esc(mr.targetBranch) + '</span>';
          if (mr.approvedBy && mr.approvedBy.length > 0) html += '<span>👍 ' + mr.approvedBy.length + '</span>';
          if (mr.pipelineDetails) {
            var pd = mr.pipelineDetails;
            var pipeEmoji = pd.overallStatus === 'success' ? '✅' : pd.overallStatus === 'failed' ? '❌' : '🔄';
            var ciHtml = '<span>' + pipeEmoji + ' CI';
            if (pd.pipelineUrl) {
              ciHtml += ' <a href="#" onclick="event.stopPropagation();window.openMR(\\'+ JSON.stringify(pd.pipelineUrl) +'\\');return false;" style="color:inherit;text-decoration:underline;">view</a>';
            }
            ciHtml += '</span>';
            html += ciHtml;
            if (pd.failedJobs && pd.failedJobs.length > 0) {
              html += '<span style="color:var(--badge-blocked);">❌ ' + pd.failedJobs.map(function(j){ return esc(j.name); }).join(', ') + '</span>';
            }
            var passed = pd.jobs.filter(function(j){ return j.status === 'success'; }).length;
            var failed = pd.failedJobs ? pd.failedJobs.length : 0;
            var running = pd.jobs.filter(function(j){ return j.status === 'running'; }).length;
            if (pd.jobs.length > 0) {
              html += '<span>Jobs: ' + passed + '✅' + (failed > 0 ? ' ' + failed + '❌' : '') + (running > 0 ? ' ' + running + '🔄' : '') + '</span>';
            }
          } else if (mr.pipelineStatus) {
            html += '<span>CI: ' + mr.pipelineStatus + '</span>';
          }
          html += '</div></div>';
        });
        html += '</div>';
      });
      html += '</div>';

      section.innerHTML = html;
    }

    window.openMR = function(url) {
      vscode.postMessage({ type: 'openMR', url: url });
    };

    // Signal ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) d.dispose();
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
