import * as vscode from "vscode";
import { CMD, PROVIDER_LABELS, PIPELINE_SCOPE_LABELS } from "../constants";
import type { PipelineTreeProvider } from "../providers/pipelineTreeProvider";
import type { GitLabClient } from "../services/gitlabClient";
import type { GitHubClient } from "../services/githubClient";
import type { StandalonePipelineData } from "../types";

export function registerPipelineCommands(
  context: vscode.ExtensionContext,
  pipelineTreeProvider: PipelineTreeProvider,
  gitlabClient: GitLabClient,
  githubClient: GitHubClient,
  output: vscode.OutputChannel
): void {
  // Fetch pipelines (with progress notification)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.fetchPipelines, async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Epic Lens: Fetching pipelines...",
          cancellable: false,
        },
        async () => {
          const count = await pipelineTreeProvider.fetch();
          vscode.window.showInformationMessage(
            `Epic Lens: Found ${count} pipeline${count !== 1 ? "s" : ""}`
          );
        }
      );
    })
  );

  // Refresh pipelines (with toast)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.refreshPipelines, async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Epic Lens: Refreshing pipelines...",
          cancellable: false,
        },
        async () => {
          await pipelineTreeProvider.fetch();
        }
      );
    })
  );

  // Cycle provider filter: both → gitlab → github → both
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cyclePipelineProvider, () => {
      const next = pipelineTreeProvider.cycleProvider();
      vscode.window.showInformationMessage(
        `Epic Lens: Pipelines showing ${PROVIDER_LABELS[next]}`
      );
    })
  );

  // Cycle pipeline scope: mine → all
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cyclePipelineScope, () => {
      const next = pipelineTreeProvider.cycleScope();
      vscode.window.showInformationMessage(
        `Epic Lens: Pipelines showing ${PIPELINE_SCOPE_LABELS[next]}`
      );
    })
  );

  // Cancel a running/pending pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.cancelPipeline, async (arg: unknown) => {
      const pipeline = resolvePipeline(arg);
      if (!pipeline) return;

      if (pipeline.status !== "running" && pipeline.status !== "pending") {
        vscode.window.showWarningMessage(
          `Pipeline #${pipeline.id} is already ${pipeline.status}`
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Cancel pipeline #${pipeline.id} on ${pipeline.projectName}?`,
        { modal: true },
        "Cancel Pipeline"
      );
      if (confirm !== "Cancel Pipeline") return;

      let success = false;
      if (pipeline.provider === "gitlab") {
        success = await gitlabClient.cancelPipeline(
          pipeline.projectId, pipeline.id, output
        );
      } else {
        // GitHub: parse owner/repo from projectPath
        const [owner, repo] = pipeline.projectPath.split("/");
        success = await githubClient.cancelPipeline(
          owner, repo, pipeline.id, output
        );
      }

      if (success) {
        vscode.window.showInformationMessage(
          `Pipeline #${pipeline.id} cancelled`
        );
        // Refresh to pick up the new status
        pipelineTreeProvider.fetch();
      } else {
        vscode.window.showErrorMessage(
          `Failed to cancel pipeline #${pipeline.id}`
        );
      }
    })
  );

  // Open pipeline in browser
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.openPipeline, (arg: unknown) => {
      const pipeline = resolvePipeline(arg);
      if (!pipeline) return;
      vscode.env.openExternal(vscode.Uri.parse(pipeline.webUrl));
    })
  );
}

function resolvePipeline(arg: unknown): StandalonePipelineData | undefined {
  if (!arg || typeof arg !== "object") return undefined;
  const obj = arg as Record<string, unknown>;

  // Direct StandalonePipelineData (from command argument)
  if (typeof obj.webUrl === "string" && typeof obj.ref === "string" && typeof obj.status === "string") {
    return arg as StandalonePipelineData;
  }

  // PipelineNode from tree
  if (obj.kind === "pipeline" && obj.pipeline) {
    return obj.pipeline as StandalonePipelineData;
  }

  return undefined;
}
