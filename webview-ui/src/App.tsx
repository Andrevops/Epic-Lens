import { useState, useEffect, useCallback } from "react";
import { vscode } from "./vscode";

// Mirror of extension types — keep in sync
interface IssueData {
  key: string;
  summary: string;
  type: string;
  fileName: string;
  filePath: string;
  workingOrder: number;
  checkedCount: number;
  totalCount: number;
  status: string;
  statusCategory: string;
}

interface EpicData {
  key: string;
  summary: string;
  file: string;
  dir: string;
  repoPath: string;
  repoName: string;
  issues: IssueData[];
  timestamp: string;
}

interface FilterState {
  statusFilter: string;
  typeFilter: string;
  hideDone: boolean;
}

const STATUS_EMOJI: Record<string, string> = {
  done: "✅",
  in_progress: "🔄",
  review: "👀",
  qa: "🧪",
  blocked: "🚫",
  rejected: "❌",
  backlog: "📋",
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

export function App() {
  const [epics, setEpics] = useState<EpicData[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    statusFilter: "all",
    typeFilter: "all",
    hideDone: false,
  });
  const [viewMode, setViewMode] = useState<"board" | "list">("board");

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "setData") {
        setEpics(msg.epics);
        setFilters(msg.filters);
      } else if (msg.type === "filtersChanged") {
        setFilters(msg.filters);
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
      <div className="toolbar">
        <h1>⚡ Epic Lens Dashboard</h1>
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
        <button onClick={() => vscode.postMessage({ type: "refresh" })}>
          ⟳ Refresh
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

      {viewMode === "board" ? (
        <BoardView epics={epics} />
      ) : (
        <ListView epics={epics} />
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
        No epics found. Run &quot;Epic Lens: Scan for Epics&quot; to discover
        them.
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
                  vscode.postMessage({ type: "openFile", filePath: epic.file })
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
  const emoji = STATUS_EMOJI[cat] || "📋";
  const criteria =
    issue.totalCount > 0
      ? ` · ${issue.checkedCount}/${issue.totalCount} criteria`
      : "";

  return (
    <div
      className={`card ${cat}`}
      onClick={() =>
        vscode.postMessage({ type: "openFile", filePath: issue.filePath })
      }
    >
      <div className="card-key">
        {emoji} {issue.key} · {issue.type}
      </div>
      <div className="card-title">{issue.summary}</div>
      <div className="card-meta">
        <span>
          {issue.status}
          {criteria}
        </span>
      </div>
    </div>
  );
}
