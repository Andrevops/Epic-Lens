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
