# Epic Lens — VS Code Extension

## What this is
A VS Code extension that fetches Jira epics and issues via the REST API and displays them in a sidebar tree view and interactive dashboard. All data comes from Jira — there is no local file scanning.

## Architecture
- `src/extension.ts` — Activation, service wiring, status bar
- `src/services/jiraClient.ts` — Jira REST API client (search/jql endpoint, cursor-based pagination)
- `src/services/epicManager.ts` — Core state: epics, orphan issues, filters, config watchers
- `src/providers/epicTreeProvider.ts` — TreeDataProvider for the sidebar (epics + orphans)
- `src/providers/filterProvider.ts` — QuickPick UI for status/type filters
- `src/commands/` — Command registrations (scan, filter, open, credentials)
- `src/views/dashboardPanel.ts` — Webview panel with inline HTML/JS + React build fallback
- `src/constants.ts` — Config keys, status mappings, context keys, CMD constants
- `src/types.ts` — TypeScript interfaces for Jira data and extension messages
- `webview-ui/` — React dashboard (built with Vite, output to webview-ui/dist/)

## Data flow
1. `EpicManager.scan()` calls `JiraClient.fetchAll()`
2. `fetchAll()` runs 3 JQL queries: epics, children, orphans
3. Returns `{ epics: EpicData[], orphans: IssueData[] }`
4. Tree provider renders epics (collapsible) then orphans (flat) at root level
5. All clicks open in Jira browser — no local file opening

## Key decisions
- Jira API v3 `search/jql` endpoint (the old `/search` was removed by Atlassian)
- Cursor-based pagination with `nextPageToken` (not offset-based `startAt`)
- Token auth: SecretStorage (OS keychain) with `ATLASSIAN_TOKEN` env var fallback
- Default scope is "mine" (assignee OR reporter = currentUser())
- Done epics excluded from default JQL (`statusCategory != Done`)
- Orphan issues (no epic parent) shown at same level as epics, after them
- No local file scanning — all data sourced from Jira API

## Config settings
- `epicLens.jiraBaseUrl` — Jira Cloud instance URL
- `epicLens.jiraEmail` — Account email
- `epicLens.jiraProject` — Project key
- `epicLens.jiraScope` — `"mine"` (default) or `"all"`
- `epicLens.jiraJql` — Custom JQL override (bypasses project + scope)
- `epicLens.hideDoneIssues` — Hide done issues in tree
- `epicLens.scanOnStartup` — Auto-fetch on activation

## Build
```bash
npm install && npm install --prefix webview-ui
node esbuild.mjs          # dev build
make build                 # production (webview + extension)
make release               # auto-bump, build, package .vsix
```

## Release flow
`make release` → detects bump from conventional commits → bumps package.json → commits + tags → builds .vsix.
Push tag to trigger GitHub Actions release workflow (`publish.yml`).

## Keyboard shortcuts
All use `Alt+E` chord prefix: `S` scan, `R` refresh, `D` dashboard, `F` filter status, `T` filter type, `H` hide done, `C` clear filters.
