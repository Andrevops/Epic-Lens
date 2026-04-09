# Epic Lens — VS Code Extension

## What this is
A VS Code extension that fetches Jira epics/issues, GitLab merge requests, and GitHub pull requests via their REST APIs and displays them in a sidebar tree view and interactive dashboard. All data comes from Jira, GitLab, and GitHub APIs — there is no local file scanning.

## Architecture
- `src/extension.ts` — Activation, service wiring, status bar
- `src/services/jiraClient.ts` — Jira REST API client (search/jql endpoint, cursor-based pagination)
- `src/services/gitlabClient.ts` — GitLab REST API client (MR list, approvals, 3-tier token resolution)
- `src/services/githubClient.ts` — GitHub REST API client (PR search, details, reviews, 3-tier token resolution)
- `src/services/epicManager.ts` — Core state: epics, orphan issues, filters, config watchers
- `src/providers/epicTreeProvider.ts` — TreeDataProvider for the sidebar (epics + orphans)
- `src/providers/mrTreeProvider.ts` — TreeDataProvider for GitLab MRs + GitHub PRs (grouped by project, provider cycling)
- `src/providers/filterProvider.ts` — QuickPick UI for status/type filters
- `src/commands/` — Command registrations (scan, filter, open, credentials, gitlab)
- `src/views/dashboardPanel.ts` — Webview panel with inline HTML/JS + React build fallback
- `src/constants.ts` — Config keys, status mappings, context keys, CMD constants
- `src/types.ts` — TypeScript interfaces for Jira/GitLab data and extension messages
- `webview-ui/` — React dashboard (built with Vite, output to webview-ui/dist/)

## Data flow

### Jira Epics
1. `EpicManager.scan()` calls `JiraClient.fetchAll()`
2. `fetchAll()` runs 3 JQL queries: epics, children, orphans
3. Returns `{ epics: EpicData[], orphans: IssueData[] }`
4. Tree provider renders epics (collapsible) then orphans (flat) at root level
5. All clicks open in Jira browser — no local file opening

### GitLab Merge Requests + GitHub Pull Requests
1. `MrTreeProvider.fetch()` calls both `GitLabClient.fetchMyOpenMRs()` and `GitHubClient.fetchMyOpenPRs()` in parallel
2. GitLab: `GET /merge_requests?scope=created_by_me&state=opened` + approval fetches per MR
3. GitHub: `GET /search/issues?q=type:pr+state:open+author:{username}` + PR detail + reviews per PR
4. Categorizes status (ready, approved, needs_review, draft, ci_failed, changes_requested, etc.)
5. Tree provider groups by project with provider icons (🦊 GitLab / 🐙 GitHub), flat if single project
6. Provider cycling button: Both → GitLab → GitHub → Both
7. All clicks open MR/PR in browser

## Key decisions
- Jira API v3 `search/jql` endpoint (the old `/search` was removed by Atlassian)
- Cursor-based pagination with `nextPageToken` (not offset-based `startAt`)
- Jira token auth: SecretStorage (OS keychain) with `ATLASSIAN_TOKEN` env var fallback
- GitLab token auth: SecretStorage → `GITLAB_TOKEN` env var → glab CLI config fallback (PAT only, not OAuth2)
- GitHub token auth: SecretStorage → `GITHUB_TOKEN` env var → gh CLI config fallback
- GitLab uses `PRIVATE-TOKEN` header (not Bearer) per GitLab API v4 convention
- GitHub uses `Bearer` token with `application/vnd.github+json` accept header
- Default scope is "mine" (assignee OR reporter = currentUser())
- Done epics excluded from default JQL (`statusCategory != Done`)
- Orphan issues (no epic parent) shown at same level as epics, after them
- GitLab MR status derived from `detailed_merge_status` + `head_pipeline.status` + approval count
- GitHub PR status derived from `mergeable_state` + reviews (APPROVED/CHANGES_REQUESTED)
- No local file scanning — all data sourced from Jira/GitLab APIs

## Config settings
- `epicLens.jiraBaseUrl` — Jira Cloud instance URL
- `epicLens.jiraEmail` — Account email
- `epicLens.jiraProject` — Project key
- `epicLens.jiraScope` — `"mine"` (default) or `"all"`
- `epicLens.jiraJql` — Custom JQL override (bypasses project + scope)
- `epicLens.hideDoneIssues` — Hide done issues in tree
- `epicLens.scanOnStartup` — Auto-fetch epics and MRs on activation
- `epicLens.gitlabHost` — GitLab instance URL (default: `https://gitlab.com`)
- `epicLens.githubHost` — GitHub API URL (default: `https://api.github.com`)

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
All use `Alt+E` chord prefix: `S` scan, `R` refresh, `D` dashboard, `F` filter status, `T` filter type, `H` hide done, `C` clear filters, `M` fetch merge requests.
