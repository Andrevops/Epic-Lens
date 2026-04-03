import * as vscode from "vscode";
import type { EpicManager } from "../services/epicManager";
import { FilterProvider } from "../providers/filterProvider";

export function registerFilterCommands(
  context: vscode.ExtensionContext,
  manager: EpicManager
): void {
  const filterProvider = new FilterProvider(manager);

  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.filterByStatus", () =>
      filterProvider.showStatusFilter()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.filterByType", () =>
      filterProvider.showTypeFilter()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.toggleHideDone", () =>
      manager.toggleHideDone()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("epicLens.clearFilters", () =>
      manager.clearFilters()
    )
  );
}
