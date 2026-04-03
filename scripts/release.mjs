#!/usr/bin/env node

/**
 * Auto-detect semver bump from conventional commits since last version tag,
 * bump package.json, commit, tag, build, and package the .vsix.
 *
 * Usage:
 *   node scripts/release.mjs          # auto-detect from commits
 *   node scripts/release.mjs patch    # force patch
 *   node scripts/release.mjs minor    # force minor
 *   node scripts/release.mjs major    # force major
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");

function run(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf-8" }).trim();
}

// ── Find last version tag ───────────────────────────────────────────
function lastTag() {
  try {
    return run("git describe --tags --abbrev=0 --match 'v*'");
  } catch {
    return null;
  }
}

// ── Detect bump type from conventional commits ──────────────────────
function detectBump(since) {
  const range = since ? `${since}..HEAD` : "HEAD";
  const log = run(`git log ${range} --pretty=format:"%s"`);
  const lines = log.split("\n").filter(Boolean);

  if (lines.length === 0) {
    console.error("No commits found since last tag. Nothing to release.");
    process.exit(1);
  }

  let bump = "patch"; // default

  for (const msg of lines) {
    if (/^feat(\(.+\))?!:|BREAKING[ -]CHANGE/i.test(msg)) {
      return "major";
    }
    if (/^feat(\(.+\))?:/.test(msg)) {
      bump = "minor";
    }
  }

  return bump;
}

// ── Bump version ────────────────────────────────────────────────────
function bumpVersion(bump) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const [major, minor, patch] = pkg.version.split(".").map(Number);

  switch (bump) {
    case "major":
      pkg.version = `${major + 1}.0.0`;
      break;
    case "minor":
      pkg.version = `${major}.${minor + 1}.0`;
      break;
    case "patch":
      pkg.version = `${major}.${minor}.${patch + 1}`;
      break;
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return pkg.version;
}

// ── Update CHANGELOG ────────────────────────────────────────────────
function updateChangelog(version, since) {
  const range = since ? `${since}..HEAD` : "HEAD";
  const log = run(`git log ${range} --pretty=format:"%s" --no-merges`);
  const lines = log.split("\n").filter(Boolean);

  const feats = [];
  const fixes = [];
  const perfs = [];
  const others = [];

  for (const msg of lines) {
    if (/^chore\(release\)/.test(msg)) continue;
    if (/^feat/.test(msg)) feats.push(msg.replace(/^feat[^:]*:\s*/, ""));
    else if (/^fix/.test(msg)) fixes.push(msg.replace(/^fix[^:]*:\s*/, ""));
    else if (/^perf/.test(msg)) perfs.push(msg.replace(/^perf[^:]*:\s*/, ""));
    else if (/^ci/.test(msg)) continue;
    else others.push(msg.replace(/^\w+[^:]*:\s*/, ""));
  }

  if (feats.length + fixes.length + perfs.length + others.length === 0) return;

  const sections = [];
  if (feats.length) sections.push("### Features\n" + feats.map((f) => `- ${f}`).join("\n"));
  if (fixes.length) sections.push("### Bug Fixes\n" + fixes.map((f) => `- ${f}`).join("\n"));
  if (perfs.length) sections.push("### Performance\n" + perfs.map((f) => `- ${f}`).join("\n"));
  if (others.length) sections.push("### Other\n" + others.map((f) => `- ${f}`).join("\n"));

  const entry = `## ${version}\n\n${sections.join("\n\n")}`;

  const changelogPath = join(root, "CHANGELOG.md");
  let existing = "";
  try {
    existing = readFileSync(changelogPath, "utf-8");
  } catch {
    // No changelog yet
  }
  const header = "# Changelog\n\nAll notable changes to Epic Lens are documented here. Generated from conventional commits.\n";
  const body = existing.replace(/^# Changelog\n+.*Generated from conventional commits\.\n*/m, "");
  writeFileSync(changelogPath, `${header}\n${entry}\n\n${body}`);
}

// ── Commit and tag ──────────────────────────────────────────────────
function commitAndTag(version) {
  run("git add package.json CHANGELOG.md");

  try {
    run("git diff --cached --quiet -- package.json");
    return;
  } catch {
    // Staged changes exist — proceed
  }

  run(`git commit -m "chore(release): v${version}"`);
  run(`git tag v${version}`);
}

// ── Main ────────────────────────────────────────────────────────────
const forced = process.argv[2];
if (forced && !["patch", "minor", "major"].includes(forced)) {
  console.error(`Invalid bump type: ${forced}. Use patch, minor, or major.`);
  process.exit(1);
}

const tag = lastTag();
const bump = forced || detectBump(tag);
const version = bumpVersion(bump);

console.log(`\n${tag ? `Last tag: ${tag}` : "No previous tag found"}`);
console.log(`Bump:     ${bump}`);
console.log(`Version:  v${version}\n`);

updateChangelog(version, tag);
commitAndTag(version);
console.log(`Committed and tagged v${version}\n`);

execSync("npm run package", { cwd: root, stdio: "inherit" });

console.log(`\nReady: epic-lens-${version}.vsix`);
console.log(`Install: code --install-extension epic-lens-${version}.vsix --force`);
