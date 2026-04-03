import type { StatusCategory } from "./constants";

/** Epic with child issues — sourced from Jira API */
export interface EpicData {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  file?: string; // absolute path to epic markdown (if local file exists)
  dir?: string; // absolute path to epic directory (if local file exists)
  repoPath?: string; // nearest git root or parent dir
  repoName?: string; // display name for repo grouping
  issues: IssueData[];
  timestamp?: string;
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
  // Local file info (optional — only present when local markdown exists)
  fileName?: string;
  filePath?: string; // absolute path to issue markdown
  workingOrder?: number;
  // Local acceptance criteria (from markdown checkboxes)
  checkedCount: number;
  totalCount: number;
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
  | { type: "openFile"; filePath: string }
  | { type: "openInJira"; key: string }
  | { type: "copyKey"; key: string }
  | { type: "setFilter"; filters: Partial<FilterState> };
