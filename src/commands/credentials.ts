import * as vscode from "vscode";
import { CONFIG } from "../constants";
import type { JiraClient } from "../services/jiraClient";

export function registerCredentialCommands(
  context: vscode.ExtensionContext,
  jiraClient: JiraClient
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "epicLens.configureCredentials",
      async () => {
        const config = vscode.workspace.getConfiguration();

        // Base URL
        const currentUrl =
          config.get<string>(CONFIG.jiraBaseUrl) ?? "";
        const baseUrl = await vscode.window.showInputBox({
          title: "Jira Base URL",
          prompt: "Enter your Jira Cloud instance URL",
          value: currentUrl,
          placeHolder: "https://yourorg.atlassian.net",
          validateInput: (v) =>
            v.includes("atlassian.net") ? null : "Must be an Atlassian URL",
        });
        if (baseUrl === undefined) return;

        if (baseUrl !== currentUrl) {
          await config.update(
            CONFIG.jiraBaseUrl,
            baseUrl.replace(/\/$/, ""),
            true
          );
        }

        // Email
        const currentEmail =
          config.get<string>(CONFIG.jiraEmail) ?? "";
        const email = await vscode.window.showInputBox({
          title: "Jira Email",
          prompt: "Enter your Jira account email",
          value: currentEmail,
          validateInput: (v) =>
            v.includes("@") ? null : "Must be a valid email",
        });
        if (email === undefined) return;

        if (email !== currentEmail) {
          await config.update(CONFIG.jiraEmail, email, true);
        }

        // API Token
        const token = await vscode.window.showInputBox({
          title: "Jira API Token",
          prompt:
            "Enter your Jira API token (stored securely in OS keychain). Leave empty to use ATLASSIAN_TOKEN env var.",
          password: true,
        });
        if (token === undefined) return;

        if (token) {
          await jiraClient.storeToken(token);
        }

        // Project
        const currentProject =
          config.get<string>(CONFIG.jiraProject) ?? "";
        const project = await vscode.window.showInputBox({
          title: "Jira Project Key",
          prompt: "Enter the Jira project key to fetch epics from",
          value: currentProject,
          placeHolder: "MYPROJ",
          validateInput: (v) =>
            v.length > 0 ? null : "Project key is required",
        });
        if (project === undefined) return;

        if (project !== currentProject) {
          await config.update(CONFIG.jiraProject, project, true);
        }

        vscode.window.showInformationMessage(
          "Epic Lens: Jira configuration saved"
        );
      }
    )
  );
}
