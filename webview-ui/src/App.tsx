import { useState, useEffect, useCallback } from "react";
import { vscode } from "./vscode";

// Mirror of extension types — keep in sync
interface IssueData {
  key: string;
  summary: string;
  type: string;
  status: string;
  statusCategory: string;
  assignee?: string;
  priority?: string;
  updated?: string;
}

interface EpicData {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  issues: IssueData[];
}

interface FilterState {
  statusFilter: string;
  typeFilter: string;
  hideDone: boolean;
}

interface PipelineJobData {
  name: string;
  stage?: string;
  status: string;
  durationSeconds?: number;
  webUrl?: string;
}

interface PipelineDetails {
  pipelineUrl?: string;
  overallStatus: string;
  jobs: PipelineJobData[];
  failedJobs: PipelineJobData[];
}

interface MergeRequestData {
  provider: "gitlab" | "github";
  role: "author" | "reviewer";
  iid: number;
  title: string;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
  hasConflicts: boolean;
  createdAt: string;
  updatedAt: string;
  projectPath: string;
  projectName: string;
  pipelineStatus?: string;
  pipelineDetails?: PipelineDetails;
  approvedBy: string[];
  approvalsRequired: number;
  status: string;
}

const STATUS_EMOJI: Record<string, string> = {
  done: "\u2705",
  in_progress: "\uD83D\uDD04",
  review: "\uD83D\uDC40",
  qa: "\uD83E\uDDEA",
  blocked: "\uD83D\uDEAB",
  rejected: "\u274C",
  backlog: "\uD83D\uDCCB",
};

const STATUS_LABELS: Record<string, string> = {
  done: "Done",
  in_progress: "In Progress",
  review: "Review",
  qa: "QA / Testing",
  blocked: "Blocked",
  rejected: "Rejected",
  backlog: "Backlog / To Do",
};

const STATUS_ORDER = [
  "backlog",
  "in_progress",
  "review",
  "qa",
  "blocked",
  "done",
  "rejected",
];

const MR_STATUS_EMOJI: Record<string, string> = {
  ready: "\u2705",
  approved: "\uD83D\uDC4D",
  needs_review: "\uD83D\uDC40",
  draft: "\u270F\uFE0F",
  ci_failed: "\u274C",
  ci_running: "\uD83D\uDD04",
  has_conflicts: "\u26A0\uFE0F",
  changes_requested: "\uD83D\uDD03",
  discussions_open: "\uD83D\uDCAC",
};

const MR_STATUS_LABELS: Record<string, string> = {
  ready: "Ready to merge",
  approved: "Approved",
  needs_review: "Needs review",
  draft: "Draft",
  ci_failed: "Pipeline failed",
  ci_running: "Pipeline running",
  has_conflicts: "Has conflicts",
  changes_requested: "Changes requested",
  discussions_open: "Unresolved discussions",
};

const MR_STATUS_COLORS: Record<string, string> = {
  ready: "done",
  approved: "in_progress",
  needs_review: "review",
  draft: "rejected",
  ci_failed: "blocked",
  ci_running: "in_progress",
  has_conflicts: "blocked",
  changes_requested: "qa",
  discussions_open: "qa",
};

export function App() {
  const [epics, setEpics] = useState<EpicData[]>([]);
  const [mrs, setMrs] = useState<MergeRequestData[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    statusFilter: "all",
    typeFilter: "all",
    hideDone: false,
  });
  const [viewMode, setViewMode] = useState<"board" | "list" | "settings">("board");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "refreshing") {
        setLoading(true);
      } else if (msg.type === "setData") {
        setEpics(msg.epics);
        setMrs(msg.mrs || []);
        setFilters(msg.filters);
        setLoading(false);
      } else if (msg.type === "filtersChanged") {
        setFilters(msg.filters);
      } else if (msg.type === "setSettings") {
        setSettings(msg.settings);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const issueTypes = [
    ...new Set(epics.flatMap((e) => e.issues.map((i) => i.type))),
  ].sort();

  const allIssues = epics.flatMap((e) => e.issues);
  const done = allIssues.filter((i) => i.statusCategory === "done").length;
  const active = allIssues.filter(
    (i) => i.statusCategory === "in_progress"
  ).length;
  const blocked = allIssues.filter(
    (i) => i.statusCategory === "blocked"
  ).length;
  const review = allIssues.filter(
    (i) => i.statusCategory === "review"
  ).length;
  const pct =
    allIssues.length > 0 ? Math.round((done / allIssues.length) * 100) : 0;

  const updateFilter = useCallback((partial: Partial<FilterState>) => {
    vscode.postMessage({ type: "setFilter", filters: partial });
  }, []);

  return (
    <>
      {loading && <LoadingOverlay />}
      <div className="toolbar">
        <h1>Epic Lens Dashboard</h1>
        <div className="view-toggle">
          <button
            className={viewMode === "board" ? "active" : ""}
            onClick={() => setViewMode("board")}
          >
            Board
          </button>
          <button
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
          >
            List
          </button>
          <button
            className={viewMode === "settings" ? "active" : ""}
            onClick={() => setViewMode("settings")}
          >
            Settings
          </button>
        </div>
        <select
          value={filters.statusFilter}
          onChange={(e) => updateFilter({ statusFilter: e.target.value })}
        >
          <option value="all">All Statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_EMOJI[s]} {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={filters.typeFilter}
          onChange={(e) => updateFilter({ typeFilter: e.target.value })}
        >
          <option value="all">All Types</option>
          {issueTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filters.hideDone}
            onChange={(e) => updateFilter({ hideDone: e.target.checked })}
          />
          Hide Done
        </label>
        <button
          onClick={() => {
            setLoading(true);
            vscode.postMessage({ type: "refresh" });
          }}
          disabled={loading}
        >
          {loading ? "\u21BB Loading..." : "\u21BB Refresh"}
        </button>
      </div>

      <div className="stats">
        <StatCard value={epics.length} label="Epics" />
        <StatCard value={allIssues.length} label="Total Issues" />
        <StatCard
          value={`${done}/${allIssues.length}`}
          label={`Done (${pct}%)`}
        />
        <StatCard value={active} label="In Progress" />
        <StatCard value={review} label="In Review" />
        <StatCard value={blocked} label="Blocked" />
      </div>

      {viewMode === "settings" ? (
        <SettingsView settings={settings} />
      ) : (
        <>
          {viewMode === "board" ? (
            <BoardView epics={epics} />
          ) : (
            <ListView epics={epics} />
          )}
          {mrs.length > 0 && <MrSection mrs={mrs} />}
        </>
      )}
    </>
  );
}

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat-card">
      <div className="number">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function BoardView({ epics }: { epics: EpicData[] }) {
  const allIssues = epics.flatMap((e) =>
    e.issues.map((i) => ({ ...i, epicKey: e.key, epicSummary: e.summary }))
  );

  const columns: Record<string, typeof allIssues> = {};
  STATUS_ORDER.forEach((s) => (columns[s] = []));
  allIssues.forEach((i) => {
    const cat = i.statusCategory || "backlog";
    if (!columns[cat]) columns[cat] = [];
    columns[cat].push(i);
  });

  return (
    <div className="board">
      {STATUS_ORDER.map((status) => {
        const items = columns[status] || [];
        return (
          <div className="column" key={status}>
            <div className="column-header">
              {STATUS_EMOJI[status]} {STATUS_LABELS[status]}
              <span className="count">{items.length}</span>
            </div>
            <div className="column-body">
              {items.length === 0 ? (
                <div className="empty">No issues</div>
              ) : (
                items.map((issue) => (
                  <IssueCard key={issue.key} issue={issue} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ epics }: { epics: EpicData[] }) {
  if (epics.length === 0) {
    return (
      <div className="empty">
        No epics found. Run &quot;Epic Lens: Fetch Epics from Jira&quot; to
        load them.
      </div>
    );
  }

  return (
    <>
      {epics.map((epic) => {
        const done = epic.issues.filter(
          (i) => i.statusCategory === "done"
        ).length;
        const total = epic.issues.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        return (
          <div className="epic-section" key={epic.key}>
            <div className="epic-header">
              <h2
                onClick={() =>
                  vscode.postMessage({ type: "openInJira", key: epic.key })
                }
              >
                {epic.key} — {epic.summary}
              </h2>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="progress-text">
                {done}/{total} ({pct}%)
              </span>
            </div>
            {epic.issues.map((issue) => (
              <IssueCard key={issue.key} issue={issue} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function IssueCard({ issue }: { issue: IssueData }) {
  const cat = issue.statusCategory || "backlog";
  const emoji = STATUS_EMOJI[cat] || "\uD83D\uDCCB";

  return (
    <div
      className={`card ${cat}`}
      onClick={() =>
        vscode.postMessage({ type: "openInJira", key: issue.key })
      }
    >
      <div className="card-key">
        {emoji} {issue.key} · {issue.type}
      </div>
      <div className="card-title">{issue.summary}</div>
      <div className="card-meta">
        <span>{issue.status}</span>
        {issue.assignee && <span>{issue.assignee}</span>}
      </div>
    </div>
  );
}

function MrSection({ mrs }: { mrs: MergeRequestData[] }) {
  // Group by project
  const byProject = new Map<string, MergeRequestData[]>();
  for (const mr of mrs) {
    const key = `${mr.provider}:${mr.projectPath}`;
    const list = byProject.get(key) ?? [];
    list.push(mr);
    byProject.set(key, list);
  }

  // Stats
  const byStatus = new Map<string, number>();
  for (const mr of mrs) {
    byStatus.set(mr.status, (byStatus.get(mr.status) ?? 0) + 1);
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div className="toolbar">
        <h1>{"\uD83D\uDD00"} Merge Requests / Pull Requests ({mrs.length})</h1>
      </div>

      <div className="stats">
        {[...byStatus.entries()].map(([status, count]) => (
          <StatCard
            key={status}
            value={`${MR_STATUS_EMOJI[status] || ""} ${count}`}
            label={MR_STATUS_LABELS[status] || status}
          />
        ))}
      </div>

      {[...byProject.entries()].map(([key, projectMrs]) => {
        const first = projectMrs[0];
        const icon = first.provider === "github" ? "\uD83D\uDC19" : "\uD83E\uDD8A";
        return (
          <div className="epic-section" key={key}>
            <div className="epic-header">
              <h2>
                {icon} {first.projectName} ({projectMrs.length})
              </h2>
            </div>
            {projectMrs.map((mr) => (
              <MrCard key={mr.webUrl} mr={mr} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PipelineSummary({ details }: { details: PipelineDetails }) {
  const passed = details.jobs.filter((j) => j.status === "success").length;
  const failed = details.failedJobs.length;
  const running = details.jobs.filter((j) => j.status === "running").length;
  const pipeEmoji =
    details.overallStatus === "success"
      ? "\u2705"
      : details.overallStatus === "failed"
        ? "\u274C"
        : "\uD83D\uDD04";

  return (
    <span>
      {pipeEmoji} {passed}/{details.jobs.length} passed
      {failed > 0 && ` \u00B7 ${failed} failed`}
      {running > 0 && ` \u00B7 ${running} running`}
      {details.pipelineUrl && (
        <>
          {" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              vscode.postMessage({ type: "openMR", url: details.pipelineUrl! });
            }}
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            view
          </a>
        </>
      )}
    </span>
  );
}

function MrCard({ mr }: { mr: MergeRequestData }) {
  const colorClass = MR_STATUS_COLORS[mr.status] || "backlog";
  const emoji = MR_STATUS_EMOJI[mr.status] || "\uD83D\uDCCB";
  const prefix = mr.provider === "github" ? "#" : "!";
  const providerIcon = mr.provider === "github" ? "\uD83D\uDC19" : "\uD83E\uDD8A";
  const ageDays = Math.floor(
    (Date.now() - new Date(mr.createdAt).getTime()) / 86_400_000
  );
  const stale = ageDays > 7 ? ` \u23F0 ${ageDays}d` : "";

  return (
    <div
      className={`card ${colorClass}`}
      onClick={() => vscode.postMessage({ type: "openMR", url: mr.webUrl })}
    >
      <div className="card-key">
        {emoji} {providerIcon} {prefix}
        {mr.iid}
        {mr.role === "reviewer" ? " \uD83D\uDCCB reviewer" : ""}
        {stale}
      </div>
      <div className="card-title">{mr.title}</div>
      <div className="card-meta">
        <span>
          {mr.sourceBranch} → {mr.targetBranch}
        </span>
        {mr.approvedBy.length > 0 && <span>{"\uD83D\uDC4D"} {mr.approvedBy.length}</span>}
        {mr.pipelineDetails ? (
          <PipelineSummary details={mr.pipelineDetails} />
        ) : mr.pipelineStatus ? (
          <span>CI: {mr.pipelineStatus}</span>
        ) : null}
      </div>
      {mr.pipelineDetails && mr.pipelineDetails.failedJobs.length > 0 && (
        <div className="card-meta" style={{ color: "var(--badge-blocked, #e74c3c)" }}>
          <span>
            {"\u274C"} Failed: {mr.pipelineDetails.failedJobs.map((j) => j.name).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Settings View ── */

const SETTINGS_FIELDS: {
  key: string;
  label: string;
  group: string;
  type: "text" | "number" | "boolean" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  description?: string;
}[] = [
  { key: "jiraBaseUrl", label: "Jira Base URL", group: "Jira", type: "text", placeholder: "https://yourorg.atlassian.net" },
  { key: "jiraEmail", label: "Jira Email", group: "Jira", type: "text", placeholder: "you@example.com" },
  { key: "jiraProject", label: "Jira Project Key", group: "Jira", type: "text", placeholder: "MYPROJ" },
  { key: "jiraScope", label: "Jira Scope", group: "Jira", type: "select", options: [{ value: "mine", label: "Mine" }, { value: "all", label: "All" }] },
  { key: "jiraJql", label: "Custom JQL", group: "Jira", type: "text", placeholder: "project = X AND issuetype = Epic", description: "Overrides project and scope when set" },
  { key: "hideDoneIssues", label: "Hide Done Issues", group: "Jira", type: "boolean" },
  { key: "gitlabHost", label: "GitLab Host", group: "GitLab / GitHub", type: "text", placeholder: "https://gitlab.com" },
  { key: "githubHost", label: "GitHub API Host", group: "GitLab / GitHub", type: "text", placeholder: "https://api.github.com" },
  { key: "autoRefreshInterval", label: "Auto-Refresh (minutes)", group: "Behavior", type: "number", description: "0 to disable" },
  { key: "staleMRDays", label: "Stale MR Threshold (days)", group: "Behavior", type: "number", description: "0 to disable" },
  { key: "pipelineMaxAgeDays", label: "Pipeline Max Age (days)", group: "Behavior", type: "number", description: "Only show pipelines within this many days" },
  { key: "pipelineScope", label: "Pipeline Scope", group: "Behavior", type: "select", options: [{ value: "mine", label: "Mine" }, { value: "all", label: "All" }], description: "Mine = your pipelines, All = everyone's" },
  { key: "scanOnStartup", label: "Fetch on Startup", group: "Behavior", type: "boolean" },
];

function SettingsView({ settings }: { settings: Record<string, unknown> }) {
  const [local, setLocal] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setLocal({ ...settings });
  }, [settings]);

  const handleChange = (key: string, value: unknown) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    // Only send fields that changed
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(local)) {
      if (settings[key] !== value) {
        changed[key] = value;
      }
    }
    if (Object.keys(changed).length > 0) {
      vscode.postMessage({ type: "updateSettings", settings: changed });
    }
  };

  const groups = [...new Set(SETTINGS_FIELDS.map((f) => f.group))];

  return (
    <div style={{ maxWidth: 600 }}>
      {groups.map((group) => (
        <div key={group} className="epic-section">
          <div className="epic-header">
            <h2>{group}</h2>
          </div>
          {SETTINGS_FIELDS.filter((f) => f.group === group).map((field) => (
            <div key={field.key} style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ minWidth: 180, fontWeight: 500 }}>{field.label}</label>
              {field.type === "text" && (
                <input
                  type="text"
                  value={(local[field.key] as string) ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  style={{
                    flex: 1,
                    background: "var(--vscode-input-background)",
                    color: "var(--vscode-input-foreground)",
                    border: "1px solid var(--vscode-input-border)",
                    padding: "4px 8px",
                    borderRadius: 4,
                  }}
                />
              )}
              {field.type === "number" && (
                <input
                  type="number"
                  value={(local[field.key] as number) ?? 0}
                  onChange={(e) => handleChange(field.key, parseInt(e.target.value, 10) || 0)}
                  style={{
                    width: 80,
                    background: "var(--vscode-input-background)",
                    color: "var(--vscode-input-foreground)",
                    border: "1px solid var(--vscode-input-border)",
                    padding: "4px 8px",
                    borderRadius: 4,
                  }}
                />
              )}
              {field.type === "boolean" && (
                <input
                  type="checkbox"
                  checked={!!local[field.key]}
                  onChange={(e) => handleChange(field.key, e.target.checked)}
                />
              )}
              {field.type === "select" && (
                <select
                  value={(local[field.key] as string) ?? ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  style={{
                    background: "var(--vscode-input-background)",
                    color: "var(--vscode-input-foreground)",
                    border: "1px solid var(--vscode-input-border)",
                    padding: "4px 8px",
                    borderRadius: 4,
                  }}
                >
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              {field.description && (
                <span style={{ fontSize: "0.8em", opacity: 0.6 }}>{field.description}</span>
              )}
            </div>
          ))}
        </div>
      ))}
      <button
        onClick={handleSave}
        style={{
          marginTop: 16,
          padding: "8px 24px",
          background: "var(--vscode-button-background)",
          color: "var(--vscode-button-foreground)",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: "1em",
          fontWeight: 600,
        }}
      >
        Save Settings
      </button>
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.3)",
        zIndex: 999,
        backdropFilter: "blur(2px)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 40,
            height: 40,
            border: "3px solid var(--vscode-panel-border, #444)",
            borderTopColor: "var(--vscode-button-background, #007acc)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            margin: "0 auto 12px",
          }}
        />
        <div style={{ fontSize: "0.9em", opacity: 0.8 }}>Loading...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
