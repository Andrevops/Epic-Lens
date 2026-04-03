# Epic Lens

Jira Epic status visualizer for VS Code. Fetch epics and issues directly from Jira, track progress with a sidebar tree view and interactive dashboard.

## Features

- **Sidebar tree view** — Epics with collapsible child issues, standalone issues listed below
- **Dashboard** — Board and list views with status columns, progress bars, and stats
- **Live Jira data** — Pulls real statuses, assignees, and priorities from the Jira REST API
- **Scope filter** — Show only your epics (`mine`) or everything in the project (`all`)
- **Status/type filters** — Filter by status category, issue type, or hide done issues
- **Keyboard shortcuts** — Chord-based shortcuts with `Alt+E` as the leader key
- **Click to open** — Click any issue or epic to open it directly in Jira

## Quick Start

1. Install the extension
2. Open the command palette (`Ctrl+Shift+P`) and run **Epic Lens: Configure Jira Credentials**
3. Enter your Jira base URL, email, API token, and project key
4. Epics load automatically

### Generating a Jira API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Copy the token and paste it when prompted by the configure command

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `epicLens.jiraBaseUrl` | `""` | Jira Cloud instance URL (e.g. `https://yourorg.atlassian.net`) |
| `epicLens.jiraEmail` | `""` | Jira account email for API authentication |
| `epicLens.jiraProject` | `""` | Jira project key (e.g. `MYPROJ`) |
| `epicLens.jiraScope` | `"mine"` | `"mine"` = your epics only, `"all"` = entire project |
| `epicLens.jiraJql` | `""` | Custom JQL (overrides project and scope when set) |
| `epicLens.hideDoneIssues` | `false` | Hide completed/done issues from the tree |
| `epicLens.scanOnStartup` | `true` | Automatically fetch from Jira when VS Code starts |

### Authentication

The API token is resolved in this order:

1. VS Code SecretStorage (OS keychain) — set via the configure command
2. `ATLASSIAN_TOKEN` environment variable — useful for CLI/CI environments

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
