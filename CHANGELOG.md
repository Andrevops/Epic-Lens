# Changelog

All notable changes to Epic Lens are documented here. Generated from conventional commits.

## 0.19.0

### Features
- cancel pipelines and hide canceled from the list

## 0.18.1

### Bug Fixes
- await workspaceState persistence for dismissed pipelines

## 0.18.0

### Features
- add pipelineMaxAgeDays setting to control pipeline age window

## 0.17.0

### Features
- dismiss pipelines with auto-cleanup of stale entries

## 0.16.0

### Features
- pipeline scope toggle (Mine/All) and dashboard settings tab

## 0.15.4

### Bug Fixes
- fetch pipelines from all member projects without branch/user filter

## 0.15.3

### Bug Fixes
- hide failed pipelines that are superseded by a newer success

## 0.15.2

### Bug Fixes
- always group pipelines by project and show repo name on each item

## 0.15.1

### Bug Fixes
- show pending/running pipelines even if a newer one succeeded

## 0.15.0

### Features
- filter pipeline view to only show actionable pipelines
- add standalone Pipelines view for CI/CD on default branches
- add CI/pipeline status per MR with individual job details

### Other
- fix stale references missing GitHub in scanOnStartup and emoji mismatch

## 0.14.0

### Features
- add standalone Pipelines view for CI/CD on default branches

## 0.13.0

### Features
- add CI/pipeline status per MR with individual job details

### Other
- fix stale references missing GitHub in scanOnStartup and emoji mismatch

## 0.12.0

### Features
- animate individual SVG elements — lightning flicker, sparkle drift, lens shimmer

### Bug Fixes
- regenerate animated icon with transparent background

### Other
- add Andrevops ecosystem section
- add animated icon to README header

## 0.11.2

### Bug Fixes
- auto-install webview deps before build

## 0.11.1

### Other
- reframe Epic Lens around AI-accelerated development visibility

## 0.11.0

### Features
- new extension icon — purple lens with lightning bolt

## 0.10.4

### Bug Fixes
- use env context instead of secrets in step-level if condition

## 0.10.3

### Other
- add release signing public key for checksum verification

## 0.10.1

### Bug Fixes
- add MR/PR section to React dashboard (was only in inline fallback)

## 0.10.0

### Features
- add auto-refresh, stale MR flags, reviewer view, notifications, Jira-MR linking, and MR dashboard

### Other
- document auto-refresh, stale MRs, reviewer view, notifications, Jira-MR linking, and MR dashboard

## 0.9.0

### Features
- show both issue and MR/PR counts in status bar

## 0.8.0

### Features
- show badge counts on Epics and Merge Requests view headers

## 0.7.1

### Bug Fixes
- silently skip unconfigured providers instead of showing warnings

## 0.7.0

### Features
- add GitHub PR support and provider cycling (Both/GitLab/GitHub)

## 0.6.2

### Other
- update package metadata and docs for GitLab MR integration

## 0.6.1

### Bug Fixes
- handle OAuth2 glab config and show clear token-missing message

## 0.6.0

### Features
- add GitLab merge request tracking in sidebar

## 0.5.2

### Bug Fixes
- replace spinning loader with static play-circle icon for in-progress issues

## 0.5.1

### Bug Fixes
- use standard JQL for orphan detection instead of ScriptRunner

### Other
- remove all stale local-file-scanning references
- add README and CLAUDE.md project documentation

## 0.5.0

### Features
- show standalone issues (no epic) alongside epics in tree

## 0.4.0

### Features
- add scope filter (mine/all) and exclude done epics by default

## 0.3.0

### Features
- add project key prompt to configure credentials command

## 0.2.3

### Bug Fixes
- route all diagnostic logging through shared output channel

## 0.2.2

### Bug Fixes
- add diagnostic logging to Jira fetch pipeline

## 0.2.1

### Bug Fixes
- migrate to Jira search/jql endpoint (v3 API deprecation)

## 0.2.0

### Features
- replace local file scanning with Jira API as data source

