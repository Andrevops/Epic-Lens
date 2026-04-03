import * as vscode from "vscode";
import { CONFIG, SECRET_KEY_TOKEN, categorizeStatus } from "../constants";
import type { JiraSearchResponse, JiraIssue, JiraFetchResult, EpicData, IssueData } from "../types";

export class JiraClient implements vscode.Disposable {
  private _secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this._secretStorage = secretStorage;
  }

  dispose(): void {}

  /**
   * Fetch epics (with children) and standalone issues from Jira.
   */
  async fetchAll(output: vscode.OutputChannel): Promise<JiraFetchResult> {
    const empty: JiraFetchResult = { epics: [], orphans: [] };
    const { baseUrl, email, token } = await this._getCredentials();
    output.appendLine(`  Credentials — baseUrl: ${baseUrl ? "set" : "MISSING"}, email: ${email ? "set" : "MISSING"}, token: ${token ? "set" : "MISSING"}`);
    if (!baseUrl || !email || !token) return empty;

    const config = vscode.workspace.getConfiguration();
    const customJql = config.get<string>(CONFIG.jiraJql) ?? "";
    const project = config.get<string>(CONFIG.jiraProject) ?? "";
    const scope = config.get<string>(CONFIG.jiraScope) ?? "mine";
    output.appendLine(`  Config — project: "${project}", scope: "${scope}", jql: "${customJql}"`);

    if (!customJql && !project) {
      output.appendLine("  No project or JQL configured — skipping");
      return empty;
    }

    // Build scope/status filters (reused for epics and orphans)
    const scopeFilter = scope === "mine"
      ? "(assignee = currentUser() OR reporter = currentUser())"
      : "";
    const statusFilter = "statusCategory != Done";

    // Step 1: Fetch epics
    let epicJql: string;
    if (customJql) {
      epicJql = customJql;
    } else {
      const parts = [`project = ${project}`, "issuetype = Epic", statusFilter];
      if (scopeFilter) parts.push(scopeFilter);
      epicJql = parts.join(" AND ") + " ORDER BY created DESC";
    }
    output.appendLine(`  Epic JQL: ${epicJql}`);
    const epicIssues = await this._searchAll(baseUrl, email, token, epicJql, output);
    output.appendLine(`  Epics fetched: ${epicIssues.length}`);

    // Step 2: Fetch children for epics
    let childIssues: JiraIssue[] = [];
    const epicKeys = epicIssues.map((e) => e.key);
    if (epicKeys.length > 0) {
      const childrenJql = `"Epic Link" in (${epicKeys.join(",")}) OR parent in (${epicKeys.join(",")}) ORDER BY rank ASC`;
      childIssues = await this._searchAll(baseUrl, email, token, childrenJql, output);
      output.appendLine(`  Children fetched: ${childIssues.length}`);
    }

    // Group children by parent epic
    const childrenByEpic = new Map<string, JiraIssue[]>();
    for (const child of childIssues) {
      const parentKey = child.fields.parent?.key;
      if (parentKey && epicKeys.includes(parentKey)) {
        const list = childrenByEpic.get(parentKey) ?? [];
        list.push(child);
        childrenByEpic.set(parentKey, list);
      }
    }

    // Build EpicData[]
    const epics: EpicData[] = epicIssues.map((epic) => {
      const children = childrenByEpic.get(epic.key) ?? [];
      const statusName = epic.fields.status.name;
      return {
        key: epic.key,
        summary: epic.fields.summary,
        status: statusName,
        statusCategory: categorizeStatus(statusName),
        issues: children.map((child) => this._toIssueData(child)),
      };
    });

    // Step 3: Fetch orphan issues (no epic parent)
    let orphans: IssueData[] = [];
    if (!customJql) {
      const orphanParts = [
        `project = ${project}`,
        "issuetype != Epic",
        "issuetype not in subtaskIssueTypes()",
        '"Epic Link" is EMPTY',
        statusFilter,
      ];
      if (scopeFilter) orphanParts.push(scopeFilter);
      const orphanJql = orphanParts.join(" AND ") + " ORDER BY created DESC";
      output.appendLine(`  Orphan JQL: ${orphanJql}`);
      const orphanIssues = await this._searchAll(baseUrl, email, token, orphanJql, output);
      output.appendLine(`  Orphans fetched: ${orphanIssues.length}`);
      orphans = orphanIssues.map((issue) => this._toIssueData(issue));
    }

    return { epics, orphans };
  }

  private _toIssueData(issue: JiraIssue): IssueData {
    const statusName = issue.fields.status.name;
    return {
      key: issue.key,
      summary: issue.fields.summary,
      type: issue.fields.issuetype.name,
      status: statusName,
      statusCategory: categorizeStatus(statusName),
      assignee: issue.fields.assignee?.displayName,
      priority: issue.fields.priority?.name,
      updated: issue.fields.updated,
    };
  }

  private async _searchAll(
    baseUrl: string,
    email: string,
    token: string,
    jql: string,
    output: vscode.OutputChannel
  ): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    const maxResults = 100;
    const fields = "summary,status,issuetype,assignee,priority,updated,parent";
    let nextPageToken: string | undefined;

    while (true) {
      let url = `${baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${maxResults}`;
      if (nextPageToken) {
        url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;
      }

      const response = await this._fetch(url, email, token, output);
      if (!response) break;

      const data = (await response.json()) as JiraSearchResponse;
      all.push(...data.issues);

      if (data.isLast || data.issues.length === 0) break;
      nextPageToken = data.nextPageToken;
      if (!nextPageToken) break;
    }

    return all;
  }

  private async _fetch(
    url: string,
    email: string,
    token: string,
    output: vscode.OutputChannel
  ): Promise<Response | null> {
    output.appendLine(`  Fetch: ${url.replace(/\?.*/, "?...")}`);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
          Accept: "application/json",
        },
      });

      output.appendLine(`  Response: ${response.status}`);

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
        const body = await response.text();
        output.appendLine(`  Jira API error ${response.status}: ${body.slice(0, 200)}`);
        return null;
      }

      return response;
    } catch (err) {
      output.appendLine(`  Jira fetch error: ${err}`);
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
