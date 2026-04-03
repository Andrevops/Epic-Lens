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
   */
  async fetchEpics(output: vscode.OutputChannel): Promise<EpicData[]> {
    const { baseUrl, email, token } = await this._getCredentials();
    output.appendLine(`  Credentials — baseUrl: ${baseUrl ? "set" : "MISSING"}, email: ${email ? "set" : "MISSING"}, token: ${token ? "set" : "MISSING"}`);
    if (!baseUrl || !email || !token) return [];

    const config = vscode.workspace.getConfiguration();
    const customJql = config.get<string>(CONFIG.jiraJql) ?? "";
    const project = config.get<string>(CONFIG.jiraProject) ?? "";
    const scope = config.get<string>(CONFIG.jiraScope) ?? "mine";
    output.appendLine(`  Config — project: "${project}", scope: "${scope}", jql: "${customJql}"`);

    if (!customJql && !project) {
      output.appendLine("  No project or JQL configured — skipping");
      return [];
    }

    // Step 1: Build JQL and fetch epics
    let epicJql: string;
    if (customJql) {
      epicJql = customJql;
    } else {
      const parts = [
        `project = ${project}`,
        "issuetype = Epic",
        "statusCategory != Done",
      ];
      if (scope === "mine") {
        parts.push("(assignee = currentUser() OR reporter = currentUser())");
      }
      epicJql = parts.join(" AND ") + " ORDER BY created DESC";
    }
    output.appendLine(`  Epic JQL: ${epicJql}`);
    const epicIssues = await this._searchAll(baseUrl, email, token, epicJql, output);
    output.appendLine(`  Epics fetched: ${epicIssues.length}`);

    if (epicIssues.length === 0) return [];

    // Step 2: Fetch all child issues for these epics in one query
    const epicKeys = epicIssues.map((e) => e.key);
    const childrenJql = `"Epic Link" in (${epicKeys.join(",")}) OR parent in (${epicKeys.join(",")}) ORDER BY rank ASC`;
    const childIssues = await this._searchAll(baseUrl, email, token, childrenJql, output);
    output.appendLine(`  Children fetched: ${childIssues.length}`);

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
