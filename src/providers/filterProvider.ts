import * as vscode from "vscode";
import {
  STATUS_LABELS,
  STATUS_EMOJI,
  type StatusCategory,
} from "../constants";
import type { EpicManager } from "../services/epicManager";

/**
 * QuickPick-based filter UI for status and type filtering.
 */
export class FilterProvider {
  constructor(private _manager: EpicManager) {}

  async showStatusFilter(): Promise<void> {
    const current = this._manager.filters.statusFilter;
    const categories: (StatusCategory | "all")[] = [
      "all",
      "backlog",
      "in_progress",
      "review",
      "qa",
      "blocked",
      "done",
      "rejected",
    ];

    const items: vscode.QuickPickItem[] = categories.map((cat) => ({
      label:
        cat === "all"
          ? "$(list-unordered) All Statuses"
          : `${STATUS_EMOJI[cat]} ${STATUS_LABELS[cat]}`,
      description: cat === current ? "(active)" : undefined,
      detail: cat === "all" ? "Show issues in any status" : undefined,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: "Filter by Status",
      placeHolder: "Select a status category to filter",
    });

    if (!selected) return;

    const idx = items.indexOf(selected);
    this._manager.setStatusFilter(categories[idx]);
  }

  async showTypeFilter(): Promise<void> {
    const current = this._manager.filters.typeFilter;
    const types = this._manager.getIssueTypes();

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(list-unordered) All Types",
        description: current === "all" ? "(active)" : undefined,
      },
      ...types.map((t) => ({
        label: `$(symbol-${this._typeIcon(t)}) ${t}`,
        description:
          t.toLowerCase() === current.toLowerCase()
            ? "(active)"
            : undefined,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: "Filter by Issue Type",
      placeHolder: "Select an issue type to filter",
    });

    if (!selected) return;

    const idx = items.indexOf(selected);
    if (idx === 0) {
      this._manager.setTypeFilter("all");
    } else {
      this._manager.setTypeFilter(types[idx - 1]);
    }
  }

  private _typeIcon(type: string): string {
    switch (type.toLowerCase()) {
      case "story":
        return "book";
      case "task":
        return "gear";
      case "bug":
        return "bug";
      case "subtask":
      case "subtarea":
        return "list-tree";
      default:
        return "file";
    }
  }
}
