# Epic Lens

Jira Epic status visualizer and GitLab merge request tracker for VS Code. Fetch epics and issues from Jira, monitor your open merge requests from GitLab, and track progress with a sidebar tree view and interactive dashboard.

## Features

- **Sidebar tree view** — Epics with collapsible child issues, standalone issues listed below
- **Merge request tracking** — See all your open GitLab MRs with approval, pipeline, and conflict status
- **Dashboard** — Board and list views with status columns, progress bars, and stats
- **Live Jira data** — Pulls real statuses, assignees, and priorities from the Jira REST API
- **Scope filter** — Show only your epics (`mine`) or everything in the project (`all`)
- **Status/type filters** — Filter by status category, issue type, or hide done issues
- **Keyboard shortcuts** — Chord-based shortcuts with `Alt+E` as the leader key
- **Click to open** — Click any issue, epic, or MR to open it directly in the browser

## Quick Start

### Jira Setup

1. Install the extension
2. Open the command palette (`Ctrl+Shift+P`) and run **Epic Lens: Configure Jira Credentials**
3. Enter your Jira base URL, email, API token, and project key
4. Epics load automatically

### GitLab Setup

The extension shows your open merge requests in a dedicated sidebar section. Authentication is resolved automatically in this order:

1. **VS Code SecretStorage** (OS keychain) — set via **Epic Lens: Configure GitLab Credentials**
2. **`GITLAB_TOKEN` environment variable**
3. **`glab` CLI config** (`~/.config/glab-cli/config.yml`) — if you've already authenticated with `glab auth login`, it just works

For most users who already have `glab` installed and authenticated, **no additional configuration is needed**.

#### Manual setup (if needed)

1. Run **Epic Lens: Configure GitLab Credentials** from the command palette
2. Enter your GitLab host URL (defaults to `https://gitlab.com`)
3. Enter a [Personal Access Token](https://gitlab.com/-/user_settings/personal_access_tokens) with `read_api` scope

### Generating a Jira API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Copy the token and paste it when prompted by the configure command

## Settings

### Jira

| Setting | Default | Description |
|---------|---------|-------------|
| `epicLens.jiraBaseUrl` | `""` | Jira Cloud instance URL (e.g. `https://yourorg.atlassian.net`) |
| `epicLens.jiraEmail` | `""` | Jira account email for API authentication |
| `epicLens.jiraProject` | `""` | Jira project key (e.g. `MYPROJ`) |
| `epicLens.jiraScope` | `"mine"` | `"mine"` = your epics only, `"all"` = entire project |
| `epicLens.jiraJql` | `""` | Custom JQL (overrides project and scope when set) |
| `epicLens.hideDoneIssues` | `false` | Hide completed/done issues from the tree |
| `epicLens.scanOnStartup` | `true` | Automatically fetch from Jira and GitLab when VS Code starts |

### GitLab

| Setting | Default | Description |
|---------|---------|-------------|
| `epicLens.gitlabHost` | `"https://gitlab.com"` | GitLab instance URL (for self-hosted, e.g. `https://gitlab.example.com`) |

### Authentication

**Jira** token is resolved in this order:

1. VS Code SecretStorage (OS keychain) — set via the configure command
2. `ATLASSIAN_TOKEN` environment variable — useful for CLI/CI environments

**GitLab** token is resolved in this order:

1. VS Code SecretStorage (OS keychain) — set via **Configure GitLab Credentials**
2. `GITLAB_TOKEN` environment variable
3. `glab` CLI config file (`~/.config/glab-cli/config.yml`)

## Keyboard Shortcuts

All shortcuts use `Alt+E` as a chord prefix:

| Shortcut | Command |
|----------|---------|
| `Alt+E S` | Fetch Epics from Jira |
| `Alt+E R` | Refresh Status |
| `Alt+E D` | Open Dashboard |
| `Alt+E F` | Filter by Status |
| `Alt+E T` | Filter by Type |
| `Alt+E H` | Toggle Hide Done |
| `Alt+E C` | Clear All Filters |
| `Alt+E M` | Fetch Merge Requests |

## Commands

| Command | Description |
|---------|-------------|
| Epic Lens: Fetch Epics from Jira | Pull latest epics and issues |
| Epic Lens: Refresh Status | Re-fetch from Jira |
| Epic Lens: Open Dashboard | Open the interactive dashboard panel |
| Epic Lens: Filter by Status | Quick pick to filter by status category |
| Epic Lens: Filter by Type | Quick pick to filter by issue type |
| Epic Lens: Toggle Hide Done | Show/hide completed issues |
| Epic Lens: Clear All Filters | Reset all active filters |
| Epic Lens: Configure Jira Credentials | Guided setup for Jira connection |
| Epic Lens: Open in Jira | Open the selected issue in your browser |
| Epic Lens: Copy Issue Key | Copy the issue key to clipboard |
| Epic Lens: Fetch Merge Requests from GitLab | Pull your open MRs from GitLab |
| Epic Lens: Refresh Merge Requests | Re-fetch MR statuses |
| Epic Lens: Open in GitLab | Open the selected MR in your browser |
| Epic Lens: Copy MR URL | Copy the MR URL to clipboard |
| Epic Lens: Configure GitLab Credentials | Guided setup for GitLab connection |

## Status Categories

Jira statuses are mapped to these categories for filtering and display:

| Category | Statuses | Icon |
|----------|----------|------|
| Backlog | Backlog, To Do, Open, New, Queued | :clipboard: |
| In Progress | In Progress, In Development, Working | :arrows_counterclockwise: |
| Review | Review, In Review, Code Review, PR Review | :eyes: |
| QA | QA, Testing, In QA, Ready for QA | :test_tube: |
| Blocked | Blocked, On Hold, Waiting | :no_entry_sign: |
| Done | Done, Closed, Resolved, Complete | :white_check_mark: |
| Rejected | Won't Do, Cancelled, Rejected | :x: |

## Merge Request Status Indicators

Each MR in the sidebar shows a status based on its current state:

| Status | Icon | Meaning |
|--------|------|---------|
| Ready to merge | :white_check_mark: | Approved, pipeline passed, no conflicts |
| Approved | :+1: | Has approvals but may need other checks |
| Needs review | :eyes: | Waiting for reviewer approval |
| Draft | :pencil2: | Marked as draft, not ready for review |
| Pipeline failed | :x: | CI/CD pipeline failed |
| Pipeline running | :arrows_counterclockwise: | CI/CD pipeline in progress |
| Has conflicts | :warning: | Merge conflicts need resolution |
| Unresolved discussions | :speech_balloon: | Open review threads to address |

MRs are grouped by project when you have open MRs across multiple repositories. Click any MR to open it in GitLab, or right-click for additional options.

## Development

```bash
# Install dependencies
npm install
npm install --prefix webview-ui

# Build
make build

# Watch mode
make watch

# Package .vsix
make package

# Release (auto-bump from conventional commits)
make release

# Install locally
make install
```

## License

MIT
