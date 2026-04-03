export const EXTENSION_ID = "epicLens";

export const VIEW_EPICS = "epicLens.epics";

export const CMD = {
  scan: "epicLens.scan",
  refresh: "epicLens.refresh",
  filterByStatus: "epicLens.filterByStatus",
  filterByType: "epicLens.filterByType",
  toggleHideDone: "epicLens.toggleHideDone",
  clearFilters: "epicLens.clearFilters",
  openInJira: "epicLens.openInJira",
  copyKey: "epicLens.copyKey",
  configureCredentials: "epicLens.configureCredentials",
  openDashboard: "epicLens.openDashboard",
} as const;

export const CONFIG = {
  jiraBaseUrl: "epicLens.jiraBaseUrl",
  jiraEmail: "epicLens.jiraEmail",
  jiraProject: "epicLens.jiraProject",
  jiraJql: "epicLens.jiraJql",
  jiraScope: "epicLens.jiraScope",
  hideDoneIssues: "epicLens.hideDoneIssues",
  scanOnStartup: "epicLens.scanOnStartup",
} as const;

export const CTX = {
  hasEpics: "epicLens.hasEpics",
  hasFilters: "epicLens.hasFilters",
  hideDone: "epicLens.hideDone",
} as const;

export const SECRET_KEY_TOKEN = "epicLens.jiraToken";

export type StatusCategory =
  | "done"
  | "in_progress"
  | "review"
  | "qa"
  | "blocked"
  | "rejected"
  | "backlog";

export const STATUS_MAP: Record<string, StatusCategory> = {
  done: "done",
  closed: "done",
  resolved: "done",
  complete: "done",
  completed: "done",
  "in progress": "in_progress",
  "in development": "in_progress",
  working: "in_progress",
  review: "review",
  "in review": "review",
  "code review": "review",
  "pr review": "review",
  qa: "qa",
  testing: "qa",
  "in qa": "qa",
  "ready for qa": "qa",
  blocked: "blocked",
  "on hold": "blocked",
  waiting: "blocked",
  "won't do": "rejected",
  "wont do": "rejected",
  cancelled: "rejected",
  rejected: "rejected",
  backlog: "backlog",
  "to do": "backlog",
  open: "backlog",
  new: "backlog",
  queued: "backlog",
};

export const STATUS_EMOJI: Record<StatusCategory, string> = {
  done: "✅",
  in_progress: "🔄",
  review: "👀",
  qa: "🧪",
  blocked: "🚫",
  rejected: "❌",
  backlog: "📋",
};

export const STATUS_LABELS: Record<StatusCategory, string> = {
  done: "Done",
  in_progress: "In Progress",
  review: "Review",
  qa: "QA / Testing",
  blocked: "Blocked",
  rejected: "Rejected",
  backlog: "Backlog / To Do",
};

export function categorizeStatus(jiraStatus: string): StatusCategory {
  return STATUS_MAP[jiraStatus.toLowerCase()] ?? "backlog";
}
