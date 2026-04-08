import * as vscode from "vscode";
import { CONFIG, CMD } from "../constants";
import type { GitLabClient } from "../services/gitlabClient";
import type { MrTreeProvider } from "../providers/mrTreeProvider";
import type { MergeRequestData } from "../types";

export function registerGitlabCommands(
  context: vscode.ExtensionContext,
  gitlabClient: GitLabClient,
  mrTreeProvider: MrTreeProvider
): void {
  // Fetch MRs (with progress notification)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fetchMRs, async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Epic Lens: Fetching merge requests from GitLab...",
          cancellable: false,
        },
        async () => {
          const count = await mrTreeProvider.fetch();
          vscode.window.showInformationMessage(
            `Epic Lens: Found ${count} open merge request${count !== 1 ? "s" : ""}`
          );
        }
      );
    })
  );

  // Refresh MRs (silent, no success message)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.refreshMRs, async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Refreshing MRs...",
        },
        async () => {
          await mrTreeProvider.fetch();
        }
      );
    })
  );

  // Open MR in browser
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.openMR, (arg: unknown) => {
      const mr = resolveMr(arg);
      if (!mr) return;
      vscode.env.openExternal(vscode.Uri.parse(mr.webUrl));
    })
  );

  // Copy MR URL
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.copyMRUrl, async (arg: unknown) => {
      const mr = resolveMr(arg);
      if (!mr) return;
      await vscode.env.clipboard.writeText(mr.webUrl);
      vscode.window.showInformationMessage(
        `Copied !${mr.iid} URL to clipboard`
      );
    })
  );

  // Configure GitLab credentials
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.configureGitlab, async () => {
      const config = vscode.workspace.getConfiguration();

      // Host
      const currentHost =
        config.get<string>(CONFIG.gitlabHost) ?? "https://gitlab.com";
      const host = await vscode.window.showInputBox({
        title: "GitLab Host",
        prompt: "Enter your GitLab instance URL",
        value: currentHost,
        placeHolder: "https://gitlab.com",
        validateInput: (v) =>
          v.startsWith("http") ? null : "Must be a valid URL",
      });
      if (host === undefined) return;

      if (host !== currentHost) {
        await config.update(
          CONFIG.gitlabHost,
          host.replace(/\/$/, ""),
          true
        );
      }

      // Token
      const token = await vscode.window.showInputBox({
        title: "GitLab Personal Access Token",
        prompt:
          "Enter your GitLab token (stored securely in OS keychain). Leave empty to use GITLAB_TOKEN env var or glab CLI config.",
        password: true,
      });
      if (token === undefined) return;

      if (token) {
        await gitlabClient.storeToken(token);
      }

      vscode.window.showInformationMessage(
        "Epic Lens: GitLab configuration saved"
      );
    })
  );
}

/**
 * Resolve an MR from a command argument — can be a MergeRequestData
 * directly or a tree node containing one.
 */
function resolveMr(arg: unknown): MergeRequestData | undefined {
  if (!arg || typeof arg !== "object") return undefined;
  const obj = arg as Record<string, unknown>;

  // Direct MergeRequestData (from command argument)
  if (typeof obj.webUrl === "string" && typeof obj.iid === "number") {
    return arg as MergeRequestData;
  }

  // MrNode from tree
  if (obj.kind === "mr" && obj.mr) {
    return obj.mr as MergeRequestData;
  }

  return undefined;
}
