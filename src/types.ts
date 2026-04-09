import type { StatusCategory } from "./constants";

/** Epic with child issues — sourced from Jira API */
export interface EpicData {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  issues: IssueData[];
}

export interface IssueData {
  key: string;
  summary: string;
  type: string;
  status: string;
  statusCategory: StatusCategory;
  assignee?: string;
  priority?: string;
  updated?: string;
}

/** Jira REST API search/jql response */
export interface JiraSearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    issuetype: { name: string };
    assignee?: { displayName: string } | null;
    priority?: { name: string } | null;
    updated?: string;
    parent?: { key: string } | null;
  };
}

/** Result of a Jira fetch — epics with children + standalone issues */
export interface JiraFetchResult {
  epics: EpicData[];
  orphans: IssueData[];
}

/** Filter state */
export interface FilterState {
  statusFilter: StatusCategory | "all";
  typeFilter: string | "all"; // "Story" | "Task" | "Bug" | etc. | "all"
  hideDone: boolean;
}

/** Messages between extension and dashboard webview */
export type ExtensionMessage =
  | { type: "setData"; epics: EpicData[]; filters: FilterState }
  | { type: "refreshing" }
  | { type: "filtersChanged"; filters: FilterState };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "openInJira"; key: string }
  | { type: "copyKey"; key: string }
  | { type: "setFilter"; filters: Partial<FilterState> };

/* ── Merge Request / Pull Request types ── */

export type MrProvider = "gitlab" | "github";

export type MrStatusCategory =
  | "ready"
  | "approved"
  | "needs_review"
  | "draft"
  | "ci_failed"
  | "ci_running"
  | "has_conflicts"
  | "changes_requested"
  | "discussions_open";

export type MrProviderFilter = "both" | "gitlab" | "github";

export interface MergeRequestData {
  provider: MrProvider;
  id: number;
  iid: number;
  title: string;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
  hasConflicts: boolean;
  createdAt: string;
  updatedAt: string;
  projectId: number;
  projectPath: string;
  projectName: string;
  pipelineStatus?: string;
  approvedBy: string[];
  approvalsRequired: number;
  status: MrStatusCategory;
}

/** Raw GitLab API merge request shape (fields we use) */
export interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  draft: boolean;
  has_conflicts: boolean;
  created_at: string;
  updated_at: string;
  project_id: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  references: { full: string };
  head_pipeline?: { status: string } | null;
  detailed_merge_status?: string;
}

/** Raw GitLab approval response */
export interface GitLabApprovalResponse {
  approved_by: { user: { username: string; name: string } }[];
  approvals_required: number;
  approvals_left: number;
}

/* ── GitHub API types ── */

/** GitHub search result item (PR via issues search) */
export interface GitHubSearchItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  created_at: string;
  updated_at: string;
  pull_request?: { url: string; html_url: string };
  repository_url: string; // e.g. "https://api.github.com/repos/owner/repo"
}

/** GitHub PR detail response */
export interface GitHubPR {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable: boolean | null;
  mergeable_state: string; // "clean" | "dirty" | "unstable" | "blocked" | "unknown"
  user: { login: string };
}

/** GitHub review object */
export interface GitHubReview {
  user: { login: string };
  state: string; // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
}
