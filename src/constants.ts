export const EXTENSION_ID = "epicLens";

export const VIEW_EPICS = "epicLens.epics";
export const VIEW_MRS = "epicLens.mergeRequests";
export const VIEW_PIPELINES = "epicLens.pipelines";

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
  // MR/PR commands
  fetchMRs: "epicLens.fetchMRs",
  refreshMRs: "epicLens.refreshMRs",
  openMR: "epicLens.openMR",
  copyMRUrl: "epicLens.copyMRUrl",
  configureGitlab: "epicLens.configureGitlab",
  configureGithub: "epicLens.configureGithub",
  cycleMRProvider: "epicLens.cycleMRProvider",
  cycleMRScope: "epicLens.cycleMRScope",
  // Pipeline commands
  fetchPipelines: "epicLens.fetchPipelines",
  refreshPipelines: "epicLens.refreshPipelines",
  openPipeline: "epicLens.openPipeline",
  cyclePipelineProvider: "epicLens.cyclePipelineProvider",
  cyclePipelineScope: "epicLens.cyclePipelineScope",
} as const;

export const CONFIG = {
  jiraBaseUrl: "epicLens.jiraBaseUrl",
  jiraEmail: "epicLens.jiraEmail",
  jiraProject: "epicLens.jiraProject",
  jiraJql: "epicLens.jiraJql",
  jiraScope: "epicLens.jiraScope",
  hideDoneIssues: "epicLens.hideDoneIssues",
  scanOnStartup: "epicLens.scanOnStartup",
  // GitLab
  gitlabHost: "epicLens.gitlabHost",
  // GitHub
  githubHost: "epicLens.githubHost",
  // Behavior
  autoRefreshInterval: "epicLens.autoRefreshInterval",
  staleMRDays: "epicLens.staleMRDays",
} as const;

export const CTX = {
  hasEpics: "epicLens.hasEpics",
  hasFilters: "epicLens.hasFilters",
  hideDone: "epicLens.hideDone",
  hasMRs: "epicLens.hasMRs",
  hasPipelines: "epicLens.hasPipelines",
} as const;

export const SECRET_KEY_TOKEN = "epicLens.jiraToken";
export const SECRET_KEY_GITLAB_TOKEN = "epicLens.gitlabToken";
export const SECRET_KEY_GITHUB_TOKEN = "epicLens.githubToken";

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

/* ── GitLab MR status helpers ── */

import type { MrStatusCategory, GitLabMR } from "./types";

export const MR_STATUS_EMOJI: Record<MrStatusCategory, string> = {
  ready: "✅",
  approved: "👍",
  needs_review: "👀",
  draft: "✏️",
  ci_failed: "❌",
  ci_running: "🔄",
  has_conflicts: "⚠️",
  changes_requested: "🔃",
  discussions_open: "💬",
};

export const MR_STATUS_LABELS: Record<MrStatusCategory, string> = {
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

/* ── Pipeline status helpers ── */

import type { PipelineStatusCategory } from "./types";

export const PIPELINE_STATUS_EMOJI: Record<PipelineStatusCategory, string> = {
  success: "✅",
  failed: "❌",
  running: "🔄",
  pending: "⏳",
  canceled: "⏹️",
  skipped: "⏭️",
};

export const PIPELINE_STATUS_LABELS: Record<PipelineStatusCategory, string> = {
  success: "Passed",
  failed: "Failed",
  running: "Running",
  pending: "Pending",
  canceled: "Canceled",
  skipped: "Skipped",
};

export const PROVIDER_LABELS: Record<import("./types").MrProviderFilter, string> = {
  both: "All Providers",
  gitlab: "GitLab Only",
  github: "GitHub Only",
};

export const PROVIDER_ICONS: Record<import("./types").MrProviderFilter, string> = {
  both: "$(layers)",
  gitlab: "$(git-merge)",
  github: "$(mark-github)",
};

export const SCOPE_LABELS: Record<import("./types").MrScopeFilter, string> = {
  authored: "Authored by me",
  reviewing: "Reviewing",
  all: "All (authored + reviewing)",
};

export const PIPELINE_SCOPE_LABELS: Record<import("./types").PipelineScopeFilter, string> = {
  mine: "My Pipelines",
  all: "All Pipelines",
};

export function categorizeMrStatus(
  mr: GitLabMR,
  approvalCount: number,
  approvalsRequired: number
): MrStatusCategory {
  if (mr.draft) return "draft";
  if (mr.has_conflicts) return "has_conflicts";
  if (mr.head_pipeline?.status === "failed") return "ci_failed";
  if (mr.head_pipeline?.status === "running" || mr.head_pipeline?.status === "pending")
    return "ci_running";
  if (mr.detailed_merge_status === "discussions_not_resolved") return "discussions_open";
  if (approvalsRequired > 0 && approvalCount >= approvalsRequired) return "ready";
  if (approvalCount > 0) return "approved";
  return "needs_review";
}
