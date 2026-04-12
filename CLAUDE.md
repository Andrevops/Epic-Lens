# Epic Lens — VS Code Extension

## What this is
A VS Code extension that gives developers visibility over their work when AI-assisted coding accelerates delivery. Fetches Jira epics/issues, GitLab merge requests, GitHub pull requests, and CI/CD pipelines via their REST APIs and displays them in sidebar tree views and an interactive dashboard. All data comes from Jira, GitLab, and GitHub APIs — there is no local file scanning.

## Architecture
- `src/extension.ts` — Activation, service wiring, status bar
- `src/services/jiraClient.ts` — Jira REST API client (search/jql endpoint, cursor-based pagination)
- `src/services/gitlabClient.ts` — GitLab REST API client (MR list, approvals, standalone pipelines, 3-tier token resolution)
- `src/services/githubClient.ts` — GitHub REST API client (PR search, details, reviews, workflow runs, 3-tier token resolution)
- `src/services/epicManager.ts` — Core state: epics, orphan issues, filters, config watchers
- `src/providers/epicTreeProvider.ts` — TreeDataProvider for the sidebar (epics + orphans)
- `src/providers/mrTreeProvider.ts` — TreeDataProvider for GitLab MRs + GitHub PRs (grouped by project, provider cycling)
- `src/providers/pipelineTreeProvider.ts` — TreeDataProvider for standalone CI/CD pipelines (3-level: project > pipeline > job)
- `src/providers/filterProvider.ts` — QuickPick UI for status/type filters
- `src/commands/` — Command registrations (scan, filter, open, credentials, gitlab, pipelines)
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
8. Scope cycling button: Authored → Reviewing → All (reviewer MRs fetched via GitLab `reviewer_id` / GitHub `review-requested`)
9. Stale MR detection compares `created_at` against `staleMRDays` threshold; stale MRs show ⏰ + age
10. Status change detection diffs previous vs current MR statuses and fires toast notifications with "Open" action

### Standalone Pipelines
1. `PipelineTreeProvider.fetch()` calls both `GitLabClient.fetchMyPipelines()` and `GitHubClient.fetchMyPipelines()` in parallel
2. GitLab: fetches user's projects (`GET /projects?membership=true`), then per project `GET /projects/:id/pipelines?ref=<default_branch>&username=<user>&per_page=5`, then jobs per pipeline
3. GitHub: fetches user's repos (`GET /user/repos?sort=pushed`), then per repo `GET /repos/:owner/:repo/actions/runs?actor=<user>&branch=<default_branch>&per_page=5`, then jobs per run
4. Results flattened, sorted by `updatedAt` desc, rendered in 3-level tree: Project > Pipeline > Job
5. Provider cycling button: Both → GitLab → GitHub → Both
6. Status change detection fires toast notifications when pipeline status transitions (e.g. running → failed)
7. All clicks open pipeline/job in browser

### Jira-MR Linking
1. After MR/PR fetch, branch names are parsed for Jira issue keys (regex: project key + `-` + number)
2. Matched keys are cross-referenced against loaded epics/issues in `EpicManager`
3. Linked issues display a 🔗 count; tooltip shows linked MR titles, statuses, and URLs
4. Linking is best-effort — unmatched keys are silently ignored

### Dashboard MR Section
1. `dashboardPanel.ts` receives MR/PR data alongside epic data via webview messages
2. MR cards rendered below the Kanban board, grouped by project with status colors
3. Cards include stale flags (⏰) and reviewer tags (📋) when applicable

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
- Auto-refresh uses `setInterval` gated by `autoRefreshInterval` config; timer resets on manual fetch or config change
- Jira-MR linking parses branch names with regex, not commit messages or MR descriptions
- Status change notifications compare serialized MR/pipeline status maps between fetch cycles
- Standalone pipelines query user's projects/repos (top 20 by activity) and fetch 5 pipelines per project on default branch
- GitLab pipeline user filtering uses `username` param; GitHub uses `actor` param on workflow runs API

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
- `epicLens.autoRefreshInterval` — Auto-refresh interval in minutes (default: `5`, `0` to disable)
- `epicLens.staleMRDays` — Flag MRs older than N days as stale (default: `7`, `0` to disable)

## Build
```bash
npm install && npm install --prefix webview-ui
node esbuild.mjs          # extension only (no webview)
make build                 # full build (webview + extension)
make release               # auto-bump, build, package .vsix
```

## Release flow
`make release` → detects bump from conventional commits → bumps package.json → commits + tags → builds .vsix.
Push tag to trigger GitHub Actions release workflow (`publish.yml`).

## Keyboard shortcuts
All use `Alt+E` chord prefix: `S` scan, `R` refresh, `D` dashboard, `F` filter status, `T` filter type, `H` hide done, `C` clear filters, `M` fetch merge requests, `P` fetch pipelines.
