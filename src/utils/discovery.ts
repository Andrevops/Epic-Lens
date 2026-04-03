import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { JiraUploadState, EpicData, IssueData } from "../types";
import type { StatusCategory } from "../constants";

const STATE_FILE = ".jira-upload-state.json";
const MAX_DEPTH = 8;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".vscode",
  "__pycache__",
  ".terraform",
  ".serverless",
]);

/**
 * BFS scan directories for .jira-upload-state.json files.
 * Returns parsed EpicData[] with local info (no Jira status yet).
 */
export async function discoverEpics(
  roots: string[]
): Promise<EpicData[]> {
  const epics: EpicData[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    await scanDir(root, 0, epics, seen);
  }

  return epics;
}

async function scanDir(
  dir: string,
  depth: number,
  epics: EpicData[],
  seen: Set<string>
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  const realDir = fs.realpathSync(dir);
  if (seen.has(realDir)) return;
  seen.add(realDir);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Check if this directory has a state file
  const hasState = entries.some(
    (e) => e.isFile() && e.name === STATE_FILE
  );

  if (hasState) {
    const epic = parseStateFile(dir);
    if (epic) {
      epics.push(epic);
    }
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    await scanDir(path.join(dir, entry.name), depth + 1, epics, seen);
  }
}

function parseStateFile(dir: string): EpicData | null {
  const filePath = path.join(dir, STATE_FILE);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const state: JiraUploadState = JSON.parse(raw);

    if (!state.epicKey || !Array.isArray(state.createdIssues)) {
      return null;
    }

    const repoPath = findGitRoot(dir) ?? path.dirname(dir);
    const repoName = deriveRepoName(repoPath, dir);

    const issues: IssueData[] = state.createdIssues.map((ci) => {
      const issueFilePath = path.join(dir, ci.fileName);
      const { checked, total } = parseAcceptanceCriteria(issueFilePath);
      const { status, statusCategory } = deriveStatus(checked, total);
      return {
        key: ci.key,
        summary: ci.summary,
        type: ci.type,
        fileName: ci.fileName,
        filePath: issueFilePath,
        workingOrder: ci.workingOrder,
        checkedCount: checked,
        totalCount: total,
        status,
        statusCategory,
      };
    });

    return {
      key: state.epicKey,
      summary: state.epicSummary ?? state.epicKey,
      file: path.join(dir, state.epicFile),
      dir,
      repoPath,
      repoName,
      issues,
      timestamp: state.timestamp,
    };
  } catch {
    return null;
  }
}

function findGitRoot(dir: string): string | null {
  let current = dir;
  const root = path.parse(current).root;
  while (current !== root) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function deriveRepoName(repoPath: string, epicDir: string): string {
  // Use the relative path from repo root to the epic's parent
  // e.g., /home/user/projects/iac/aws/ecr → projects/iac/aws/ecr
  const home = process.env.HOME ?? "";
  let display = repoPath;

  // Strip common prefixes for readability
  for (const prefix of [
    home,
  ]) {
    if (display.startsWith(prefix + path.sep)) {
      display = display.slice(prefix.length + 1);
      break;
    }
  }

  return display || path.basename(repoPath);
}

/**
 * Parse acceptance criteria checkboxes from a markdown file.
 * Counts `- [x]` (checked) and `- [ ]` (unchecked) lines.
 */
function parseAcceptanceCriteria(filePath: string): {
  checked: number;
  total: number;
} {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const checkedMatches = content.match(/^[ \t]*-\s+\[x\]/gim);
    const uncheckedMatches = content.match(/^[ \t]*-\s+\[ \]/gm);
    const checked = checkedMatches?.length ?? 0;
    const unchecked = uncheckedMatches?.length ?? 0;
    return { checked, total: checked + unchecked };
  } catch {
    return { checked: 0, total: 0 };
  }
}

/**
 * Derive status category from acceptance criteria completion.
 */
function deriveStatus(
  checked: number,
  total: number
): { status: string; statusCategory: StatusCategory } {
  if (total === 0) {
    return { status: "No Criteria", statusCategory: "backlog" };
  }
  if (checked === total) {
    return { status: "Done", statusCategory: "done" };
  }
  if (checked > 0) {
    return {
      status: `In Progress (${checked}/${total})`,
      statusCategory: "in_progress",
    };
  }
  return { status: "To Do", statusCategory: "backlog" };
}

/**
 * Collect scan roots from workspace folders, config, and Diffchestrator.
 */
export function collectScanRoots(): string[] {
  const roots = new Set<string>();

  // Workspace folders
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.add(folder.uri.fsPath);
  }

  // epicLens.rootPath — primary root
  const rootPath =
    vscode.workspace
      .getConfiguration()
      .get<string>("epicLens.rootPath");
  if (rootPath && fs.existsSync(rootPath)) roots.add(rootPath);

  // epicLens.scanPaths
  const extraPaths =
    vscode.workspace
      .getConfiguration()
      .get<string[]>("epicLens.scanPaths") ?? [];
  for (const p of extraPaths) {
    if (fs.existsSync(p)) roots.add(p);
  }

  // Diffchestrator scanRoots (optional integration)
  try {
    const diffScanRoots =
      vscode.workspace
        .getConfiguration()
        .get<string[]>("diffchestrator.scanRoots") ?? [];
    for (const p of diffScanRoots) {
      if (fs.existsSync(p)) roots.add(p);
    }
  } catch {
    // Diffchestrator not installed — ignore
  }

  return [...roots];
}
