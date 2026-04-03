import type { StatusCategory } from "./constants";

/** Raw shape of .jira-upload-state.json */
export interface JiraUploadState {
  epicKey: string;
  epicFile: string;
  epicSummary: string | null;
  createdIssues: CreatedIssue[];
  timestamp: string;
}

export interface CreatedIssue {
  fileName: string;
  key: string;
  summary: string;
  type: string; // Story | Task | Bug | Subtask | Subtarea
  workingOrder: number;
}

/** Enriched epic with live Jira status */
export interface EpicData {
  key: string;
  summary: string;
  file: string; // absolute path to epic markdown
  dir: string; // absolute path to epic directory
  repoPath: string; // nearest git root or parent dir
  repoName: string; // display name for repo grouping
  issues: IssueData[];
  timestamp: string;
}

export interface IssueData {
  key: string;
  summary: string;
  type: string;
  fileName: string;
  filePath: string; // absolute path to issue markdown
  workingOrder: number;
  // Local status derived from acceptance criteria checkboxes
  checkedCount: number; // number of [x] items
  totalCount: number; // total checkbox items ([x] + [ ])
  status: string; // "Done" | "In Progress" | "To Do" | "No Criteria"
  statusCategory: StatusCategory;
}

/** Jira REST API search response */
export interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
}

export interface JiraIssue {
  key: string;
  fields: {
    status: { name: string };
    issuetype: { name: string };
    assignee?: { displayName: string } | null;
    priority?: { name: string } | null;
    updated?: string;
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
