import * as vscode from "vscode";
import type { EpicManager } from "../services/epicManager";

export function registerScanCommands(
  context: vscode.ExtensionContext,
  manager: EpicManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.scan", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Epic Lens: Scanning for epics...",
          cancellable: false,
        },
        async () => {
          await manager.scan();
          const count = manager.epics.length;
          vscode.window.showInformationMessage(
            `Epic Lens: Found ${count} epic${count !== 1 ? "s" : ""}`
          );
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.refresh", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Epic Lens: Rescanning local files...",
          cancellable: false,
        },
        async () => {
          await manager.scan();
        }
      );
    })
  );
}
