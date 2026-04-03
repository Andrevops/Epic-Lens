import * as vscode from "vscode";
import { CONFIG, SECRET_KEY_TOKEN, categorizeStatus } from "../constants";
import type { JiraSearchResponse, JiraIssue, EpicData, IssueData } from "../types";

export class JiraClient implements vscode.Disposable {
  private _secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this._secretStorage = secretStorage;
  }

  dispose(): void {}

  /**
   * Fetch all epics (with child issues) for the configured project or JQL.
   * Returns fully-populated EpicData[] ready for the tree.
   */
  async fetchEpics(): Promise<EpicData[]> {
    const { baseUrl, email, token } = await this._getCredentials();
    if (!baseUrl || !email || !token) return [];

    const config = vscode.workspace.getConfiguration();
    const customJql = config.get<string>(CONFIG.jiraJql) ?? "";
    const project = config.get<string>(CONFIG.jiraProject) ?? "";

    if (!customJql && !project) return [];

    // Step 1: Fetch epics
    const epicJql = customJql || `project = ${project} AND issuetype = Epic ORDER BY created DESC`;
    const epicIssues = await this._searchAll(baseUrl, email, token, epicJql);

    if (epicIssues.length === 0) return [];

    // Step 2: Fetch all child issues for these epics in one query
    const epicKeys = epicIssues.map((e) => e.key);
    const childrenJql = `"Epic Link" in (${epicKeys.join(",")}) OR parent in (${epicKeys.join(",")}) ORDER BY rank ASC`;
    const childIssues = await this._searchAll(baseUrl, email, token, childrenJql);

    // Group children by parent epic
    const childrenByEpic = new Map<string, JiraIssue[]>();
    for (const child of childIssues) {
      // parent field or epic link — Jira uses parent.key for next-gen, epic link for classic
      const parentKey = child.fields.parent?.key;
      if (parentKey && epicKeys.includes(parentKey)) {
        const list = childrenByEpic.get(parentKey) ?? [];
        list.push(child);
        childrenByEpic.set(parentKey, list);
      }
    }

    // Step 3: Build EpicData[]
    return epicIssues.map((epic) => {
      const children = childrenByEpic.get(epic.key) ?? [];
      const statusName = epic.fields.status.name;

      const issues: IssueData[] = children.map((child, idx) => {
        const childStatus = child.fields.status.name;
        return {
          key: child.key,
          summary: child.fields.summary,
          type: child.fields.issuetype.name,
          status: childStatus,
          statusCategory: categorizeStatus(childStatus),
          assignee: child.fields.assignee?.displayName,
          priority: child.fields.priority?.name,
          updated: child.fields.updated,
          workingOrder: idx,
          checkedCount: 0,
          totalCount: 0,
        };
      });

      return {
        key: epic.key,
        summary: epic.fields.summary,
        status: statusName,
        statusCategory: categorizeStatus(statusName),
        issues,
      };
    });
  }

  /**
   * Paginated JQL search — fetches all results across pages.
   */
  private async _searchAll(
    baseUrl: string,
    email: string,
    token: string,
    jql: string
  ): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    let startAt = 0;
    const maxResults = 100;
    const fields = "summary,status,issuetype,assignee,priority,updated,parent";

    while (true) {
      const url = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${maxResults}&startAt=${startAt}`;

      const response = await this._fetch(url, email, token);
      if (!response) break;

      const data = (await response.json()) as JiraSearchResponse;
      all.push(...data.issues);

      if (all.length >= data.total || data.issues.length === 0) break;
      startAt += data.issues.length;
    }

    return all;
  }

  private async _fetch(
    url: string,
    email: string,
    token: string
  ): Promise<Response | null> {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
          Accept: "application/json",
        },
      });

      if (response.status === 401) {
        vscode.window
          .showWarningMessage(
            "Epic Lens: Jira authentication failed. Reconfigure credentials?",
            "Configure"
          )
          .then((choice) => {
            if (choice === "Configure") {
              vscode.commands.executeCommand("epicLens.configureCredentials");
            }
          });
        return null;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        await new Promise((r) => setTimeout(r, waitMs));
        return null;
      }

      if (!response.ok) {
        const output = vscode.window.createOutputChannel("Epic Lens");
        output.appendLine(`Jira API error ${response.status}: ${url}`);
        return null;
      }

      return response;
    } catch (err) {
      const output = vscode.window.createOutputChannel("Epic Lens");
      output.appendLine(`Jira fetch error: ${err}`);
      return null;
    }
  }

  private async _getCredentials(): Promise<{
    baseUrl: string;
    email: string;
    token: string;
  }> {
    const config = vscode.workspace.getConfiguration();
    const baseUrl = (
      config.get<string>(CONFIG.jiraBaseUrl) ?? ""
    ).replace(/\/$/, "");
    const email = config.get<string>(CONFIG.jiraEmail) ?? "";

    // Try SecretStorage first, then env var fallback
    let token = await this._secretStorage.get(SECRET_KEY_TOKEN);
    if (!token) {
      token = process.env.ATLASSIAN_TOKEN ?? "";
    }

    return { baseUrl, email, token };
  }

  async hasCredentials(): Promise<boolean> {
    const { baseUrl, email, token } = await this._getCredentials();
    return !!(baseUrl && email && token);
  }

  async storeToken(token: string): Promise<void> {
    await this._secretStorage.store(SECRET_KEY_TOKEN, token);
  }

  async deleteToken(): Promise<void> {
    await this._secretStorage.delete(SECRET_KEY_TOKEN);
  }
}
