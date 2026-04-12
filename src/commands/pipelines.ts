import * as vscode from "vscode";
import { CMD, PROVIDER_LABELS } from "../constants";
import type { PipelineTreeProvider } from "../providers/pipelineTreeProvider";
import type { StandalonePipelineData } from "../types";

export function registerPipelineCommands(
  context: vscode.ExtensionContext,
  pipelineTreeProvider: PipelineTreeProvider
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

  // Refresh pipelines (silent)
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.refreshPipelines, async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Refreshing pipelines...",
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
