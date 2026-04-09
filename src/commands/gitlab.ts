import * as vscode from "vscode";
import { CONFIG, CMD, PROVIDER_LABELS } from "../constants";
import type { GitLabClient } from "../services/gitlabClient";
import type { GitHubClient } from "../services/githubClient";
import type { MrTreeProvider } from "../providers/mrTreeProvider";
import type { MergeRequestData } from "../types";

export function registerMrCommands(
  context: vscode.ExtensionContext,
  gitlabClient: GitLabClient,
  githubClient: GitHubClient,
  mrTreeProvider: MrTreeProvider
): void {
  // Fetch MRs/PRs (with progress notification)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fetchMRs, async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Epic Lens: Fetching merge requests...",
          cancellable: false,
        },
        async () => {
          const count = await mrTreeProvider.fetch();
          vscode.window.showInformationMessage(
            `Epic Lens: Found ${count} open MR/PR${count !== 1 ? "s" : ""}`
          );
        }
      );
    })
  );

  // Refresh MRs (silent)
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

  // Cycle provider filter: both → gitlab → github → both
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cycleMRProvider, () => {
      const next = mrTreeProvider.cycleProvider();
      vscode.window.showInformationMessage(
        `Epic Lens: Showing ${PROVIDER_LABELS[next]}`
      );
    })
  );

  // Open MR/PR in browser
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.openMR, (arg: unknown) => {
      const mr = resolveMr(arg);
      if (!mr) return;
      vscode.env.openExternal(vscode.Uri.parse(mr.webUrl));
    })
  );

  // Copy MR/PR URL
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.copyMRUrl, async (arg: unknown) => {
      const mr = resolveMr(arg);
      if (!mr) return;
      const prefix = mr.provider === "github" ? "#" : "!";
      await vscode.env.clipboard.writeText(mr.webUrl);
      vscode.window.showInformationMessage(
        `Copied ${prefix}${mr.iid} URL to clipboard`
      );
    })
  );

  // Configure GitLab credentials
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.configureGitlab, async () => {
      const config = vscode.workspace.getConfiguration();

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

  // Configure GitHub credentials
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.configureGithub, async () => {
      const config = vscode.workspace.getConfiguration();

      const currentHost =
        config.get<string>(CONFIG.githubHost) ?? "https://api.github.com";
      const host = await vscode.window.showInputBox({
        title: "GitHub API Host",
        prompt: "Enter your GitHub API URL (default for github.com)",
        value: currentHost,
        placeHolder: "https://api.github.com",
        validateInput: (v) =>
          v.startsWith("http") ? null : "Must be a valid URL",
      });
      if (host === undefined) return;

      if (host !== currentHost) {
        await config.update(
          CONFIG.githubHost,
          host.replace(/\/$/, ""),
          true
        );
      }

      const token = await vscode.window.showInputBox({
        title: "GitHub Personal Access Token",
        prompt:
          "Enter your GitHub token (stored securely in OS keychain). Leave empty to use GITHUB_TOKEN env var or gh CLI config.",
        password: true,
      });
      if (token === undefined) return;

      if (token) {
        await githubClient.storeToken(token);
      }

      vscode.window.showInformationMessage(
        "Epic Lens: GitHub configuration saved"
      );
    })
  );
}

/**
 * Resolve an MR/PR from a command argument — can be a MergeRequestData
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
