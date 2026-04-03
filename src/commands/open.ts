import * as vscode from "vscode";
import { CONFIG } from "../constants";

/**
 * Extract a value from a command argument that may be:
 * - A raw string (from programmatic calls / webview)
 * - A TreeNode object (from context menu clicks)
 */
function resolveKey(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const node = arg as Record<string, unknown>;
    // IssueNode → node.issue.key, EpicNode → node.epic.key
    if (node.kind === "issue") {
      const issue = node.issue as Record<string, unknown>;
      return issue?.key as string;
    }
    if (node.kind === "epic") {
      const epic = node.epic as Record<string, unknown>;
      return epic?.key as string;
    }
  }
  return undefined;
}

function resolveFilePath(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const node = arg as Record<string, unknown>;
    if (node.kind === "issue") {
      const issue = node.issue as Record<string, unknown>;
      return issue?.filePath as string;
    }
    if (node.kind === "epic") {
      const epic = node.epic as Record<string, unknown>;
      return epic?.file as string;
    }
  }
  return undefined;
}

export function registerOpenCommands(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "epicLens.openFile",
      async (arg: unknown) => {
        const filePath = resolveFilePath(arg);
        if (!filePath) return;
        try {
          const uri = vscode.Uri.file(filePath);
          await vscode.window.showTextDocument(uri);
        } catch {
          vscode.window.showErrorMessage(
            `Epic Lens: Could not open file: ${filePath}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "epicLens.openInJira",
      (arg: unknown) => {
        const key = resolveKey(arg);
        if (!key) return;
        const baseUrl = (
          vscode.workspace
            .getConfiguration()
            .get<string>(CONFIG.jiraBaseUrl) ?? ""
        ).replace(/\/$/, "");
        if (!baseUrl) {
          vscode.window.showWarningMessage(
            "Epic Lens: Jira base URL not configured"
          );
          return;
        }
        vscode.env.openExternal(
          vscode.Uri.parse(`${baseUrl}/browse/${key}`)
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "epicLens.copyKey",
      async (arg: unknown) => {
        const key = resolveKey(arg);
        if (!key) return;
        await vscode.env.clipboard.writeText(key);
        vscode.window.showInformationMessage(
          `Copied ${key} to clipboard`
        );
      }
    )
  );
}
