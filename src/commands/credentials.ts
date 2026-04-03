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
        if (email === undefined) return; // cancelled

        if (email !== currentEmail) {
          await config.update(CONFIG.jiraEmail, email, true);
        }

        // Base URL
        const currentUrl =
          config.get<string>(CONFIG.jiraBaseUrl) ?? "";
        const baseUrl = await vscode.window.showInputBox({
          title: "Jira Base URL",
          prompt: "Enter your Jira Cloud instance URL",
          value: currentUrl,
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

        // API Token
        const token = await vscode.window.showInputBox({
          title: "Jira API Token",
          prompt:
            "Enter your Jira API token (stored securely in OS keychain)",
          password: true,
          validateInput: (v) =>
            v.length > 0 ? null : "Token cannot be empty",
        });
        if (token === undefined) return;

        await jiraClient.storeToken(token);

        vscode.window.showInformationMessage(
          "Epic Lens: Jira credentials configured successfully"
        );
      }
    )
  );
}
