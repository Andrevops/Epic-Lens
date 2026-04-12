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

/** Settings shape sent to the webview */
export interface SettingsData {
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraProject: string;
  jiraScope: string;
  jiraJql: string;
  hideDoneIssues: boolean;
  scanOnStartup: boolean;
  gitlabHost: string;
  githubHost: string;
  autoRefreshInterval: number;
  staleMRDays: number;
}

/** Messages between extension and dashboard webview */
export type ExtensionMessage =
  | { type: "setData"; epics: EpicData[]; filters: FilterState; mrs: MergeRequestData[] }
  | { type: "setSettings"; settings: SettingsData }
  | { type: "refreshing" }
  | { type: "filtersChanged"; filters: FilterState };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "openInJira"; key: string }
  | { type: "copyKey"; key: string }
  | { type: "openMR"; url: string }
  | { type: "setFilter"; filters: Partial<FilterState> }
  | { type: "updateSettings"; settings: Partial<SettingsData> };

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
export type MrRole = "author" | "reviewer";
export type MrScopeFilter = "authored" | "reviewing" | "all";
export type PipelineScopeFilter = "mine" | "all";

/** A single CI job (GitLab) or check run (GitHub) */
export interface PipelineJobData {
  name: string;
  stage?: string;
  status: string; // "success" | "failed" | "running" | "pending" | "cancelled" | "skipped"
  durationSeconds?: number;
  webUrl?: string;
}

/** Pipeline/CI details attached to an MR/PR */
export interface PipelineDetails {
  pipelineUrl?: string;
  overallStatus: string; // "success" | "failed" | "running" | "pending"
  jobs: PipelineJobData[];
  failedJobs: PipelineJobData[];
}

export interface MergeRequestData {
  provider: MrProvider;
  role: MrRole;
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
  pipelineDetails?: PipelineDetails;
  approvedBy: string[];
  approvalsRequired: number;
  status: MrStatusCategory;
}

/* ── Standalone Pipeline types ── */

export type PipelineStatusCategory =
  | "success"
  | "failed"
  | "running"
  | "pending"
  | "canceled"
  | "skipped";

/** A standalone pipeline (not attached to an MR) */
export interface StandalonePipelineData {
  provider: MrProvider;
  id: number;
  projectId: number;
  projectPath: string;
  projectName: string;
  ref: string;
  status: PipelineStatusCategory;
  webUrl: string;
  createdAt: string;
  updatedAt: string;
  duration?: number;
  jobs: PipelineJobData[];
  failedJobs: PipelineJobData[];
}

/** Raw GitLab pipeline list item */
export interface GitLabPipeline {
  id: number;
  project_id: number;
  status: string;
  ref: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  duration: number | null;
}

/** Raw GitLab project (fields we use for pipelines) */
export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string;
}

/** Raw GitHub repo (fields we use for pipelines) */
export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
}

/** Raw GitHub workflow run */
export interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
}

/** Raw GitHub workflow runs API response */
export interface GitHubWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
}

/** Raw GitHub workflow run job */
export interface GitHubWorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
}

/** Raw GitHub workflow run jobs response */
export interface GitHubWorkflowJobsResponse {
  total_count: number;
  jobs: GitHubWorkflowJob[];
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
  head_pipeline?: { status: string; id?: number; web_url?: string } | null;
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

/** GitHub check run */
export interface GitHubCheckRun {
  id: number;
  name: string;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped"
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
}

/** GitHub check runs API response */
export interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}
