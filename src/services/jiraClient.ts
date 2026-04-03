import * as vscode from "vscode";
import { CONFIG, SECRET_KEY_TOKEN, categorizeStatus } from "../constants";
import type { JiraSearchResponse, IssueData } from "../types";

export class JiraClient implements vscode.Disposable {
  private _secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this._secretStorage = secretStorage;
  }

  dispose(): void {}

  /**
   * Fetch live status for a batch of issue keys via JQL bulk search.
   * Returns a map of key → partial IssueData with status fields populated.
   */
  async fetchStatuses(
    keys: string[]
  ): Promise<Map<string, Partial<IssueData>>> {
    const result = new Map<string, Partial<IssueData>>();
    if (keys.length === 0) return result;

    const { baseUrl, email, token } = await this._getCredentials();
    if (!baseUrl || !email || !token) return result;

    // Batch into chunks of 50 keys (Jira JQL IN clause limit is ~100)
    const chunks = chunkArray(keys, 50);

    for (const chunk of chunks) {
      try {
        const jql = `key IN (${chunk.join(",")})`;
        const fields = "status,issuetype,assignee,priority,updated";
        const url = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${chunk.length}`;

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
          return result;
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          await new Promise((r) => setTimeout(r, waitMs));
          // Skip this chunk — will be retried on next refresh
          continue;
        }

        if (!response.ok) continue;

        const data = (await response.json()) as JiraSearchResponse;

        for (const issue of data.issues) {
          const statusName = issue.fields.status.name;
          result.set(issue.key, {
            status: statusName,
            statusCategory: categorizeStatus(statusName),
            assignee: issue.fields.assignee?.displayName,
            priority: issue.fields.priority?.name,
            updated: issue.fields.updated,
          });
        }
      } catch (err) {
        // Network error — return what we have so far
        const output = vscode.window.createOutputChannel("Epic Lens");
        output.appendLine(`Jira fetch error: ${err}`);
      }
    }

    return result;
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
