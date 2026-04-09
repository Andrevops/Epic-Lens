# Changelog

All notable changes to Epic Lens are documented here. Generated from conventional commits.

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

