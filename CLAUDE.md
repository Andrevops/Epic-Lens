# Epic Lens — VS Code Extension

## What this is
A VS Code extension that fetches Jira epics and issues via the REST API and displays them in a sidebar tree view and interactive dashboard.

## Architecture
- `src/extension.ts` — Activation, service wiring, status bar
- `src/services/jiraClient.ts` — Jira REST API client (search/jql endpoint, paginated)
- `src/services/epicManager.ts` — Core state: epics, orphans, filters, config watchers
- `src/providers/epicTreeProvider.ts` — TreeDataProvider for the sidebar
- `src/providers/filterProvider.ts` — QuickPick UI for status/type filters
- `src/commands/` — Command registrations (scan, filter, open, credentials)
- `src/views/dashboardPanel.ts` — Webview panel with inline HTML/JS + React build
- `src/constants.ts` — Config keys, status mappings, context keys
- `src/types.ts` — TypeScript interfaces for Jira data and extension messages
- `webview-ui/` — React dashboard (built with Vite, output to webview-ui/dist/)

## Key decisions
- Jira API v3 `search/jql` endpoint (the old `/search` was deprecated)
- Cursor-based pagination with `nextPageToken` (not offset-based)
- Token auth: SecretStorage (OS keychain) with `ATLASSIAN_TOKEN` env var fallback
- Orphan issues (no epic parent) shown at same level as epics, after them
- Default scope is "mine" (assignee OR reporter = currentUser)
- Done epics excluded from default JQL (`statusCategory != Done`)

## Build
```bash
npm install && npm install --prefix webview-ui
node esbuild.mjs          # dev build
make build                 # production (webview + extension)
make release               # auto-bump, build, package .vsix
```

## Release flow
`make release` → detects bump from conventional commits → bumps package.json → commits + tags → builds .vsix
Push tag to trigger GitHub Actions release workflow.
