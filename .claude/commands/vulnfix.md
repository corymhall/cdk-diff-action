---
description: Review and fix Dependabot vulnerability alerts
---

## Context

- **Branch:** !`git branch --show-current`
- **Repo:** !`gh repo view --json owner,name --jq '.owner.login + "/" + .name'`

## Your Task

You are reviewing and triaging all open Dependabot vulnerability alerts for this repository. Your job is to assess each alert with the help of security-focused subagents, present findings to the user, dismiss approved alerts via the GitHub API, and plan fixes for the rest.

**Phases 1–4 are read-only analysis.** Do not modify any files during these phases. Phase 5 dismisses alerts via API (with explicit user confirmation). Phase 6 plans fixes.

**Create a todo list before starting any work.**

## Phase 1: Fetch Alerts

Extract OWNER and REPO from Context above.

1. Fetch all open Dependabot alerts:

```
gh api repos/OWNER/REPO/dependabot/alerts --paginate --jq '.[] | select(.state == "open") | {number, severity: .security_vulnerability.severity, package: .security_vulnerability.package.name, ecosystem: .security_vulnerability.package.ecosystem, vulnerable_range: .security_vulnerability.vulnerable_version_range, patched_version: .security_vulnerability.first_patched_version.identifier, ghsa_id: .security_advisory.ghsa_id, cve_id: .security_advisory.cve_id, summary: .security_advisory.summary, created_at}'
```

2. If no alerts are returned, report "No open Dependabot alerts found." and stop.

3. **Group alerts by package name.** Many alerts target the same package at different severity levels or for different CVEs. Group them so a single subagent can assess all vulnerabilities for one package together.

4. Present a summary:

```
Found N open Dependabot alert(s) across M package(s):

| Package | Alerts | Severities | Patched Version |
|---------|--------|------------|-----------------|
| lodash  | 3      | critical, high | 4.17.21    |
| axios   | 1      | medium     | 1.6.0           |
...
```

## Phase 2: Assess Alerts

Launch parallel subagents using the `vulnfix-reviewer` agent definition (via the Agent tool with `subagent_type: "vulnfix-reviewer"`). **One agent per package group.**

Each subagent receives:
- The package name and current version (check `package.json` files and lockfile to determine the installed version)
- All Dependabot alerts for that package (full details: severity, CVE/GHSA, vulnerable range, patched version, advisory summary)
- Repository context (repo name, what the project does)

The `vulnfix-reviewer` agent has its own assessment criteria and instructions. It returns one of two verdicts for each alert:
- `Fix` — The vulnerability poses a real or plausible risk.
- `Uncertain` — Cannot conclusively determine the risk level; needs user input.

**There is no "Dismiss" verdict.** Only the user can decide to dismiss an alert.

Each verdict includes a **pivot condition** — the specific fact or assumption that would change the verdict. This helps you frame questions for the user.

## Phase 3: Ask the User

After all subagents complete, present findings via **AskUserQuestion**.

### Progress Tracking

Before asking any questions, create a task list to track each batch. Each task represents one AskUserQuestion call (up to 4 questions). For example, if there are 9 items to ask about, create 3 tasks: "Ask user about items 1-4", "Ask user about items 5-8", "Ask user about item 9". Mark each task in_progress before calling AskUserQuestion and completed after the user responds.

### Mandatory Rules

1. **Every finding MUST be presented to the user via AskUserQuestion.** There are zero exceptions — even for confident `Fix` verdicts.
2. **Use the subagent's pivot condition** to frame each question. Present the pivot as concrete options the user can choose between.
3. **Batch questions efficiently.** AskUserQuestion supports up to 4 questions per call. Group related items (e.g., multiple alerts for the same package). Make multiple AskUserQuestion calls if there are more than 4 items.

### Framing Questions

For each alert presented to the user:
- Summarize the vulnerability (1-2 sentences)
- State the package, severity, and CVE/GHSA ID
- Include the subagent's reachability and fix complexity assessment

**Option ordering:** The first option is the agent's recommendation. Order remaining options by relevance.

**For `Fix` verdicts (confident the vulnerability is real):** Present fix approaches. Always include exactly 3 options:
  - Two different fix strategies (e.g., version bump vs. replace package, or bump direct dep vs. pnpm override for transitive)
  - A "Dismiss" option (with brief note on what risk is being accepted)

**For `Uncertain` verdicts:** Present the key uncertainty. Always include exactly 3 options:
  - Two different approaches (fix strategies or investigation steps)
  - A "Dismiss" option (with the subagent's reasoning for why it might be safe)

**When the user selects Dismiss**, they must provide a reason. Only two dismiss reasons are valid:
  - **inaccurate** — The alert is wrong or does not apply to this project
  - **tolerable_risk** — The risk is understood and accepted

Never use "fix_started", "no_bandwidth", or "not_used" as dismiss reasons. If a dependency is unused, the fix is to remove it, not to dismiss the alert.

## Phase 4: Report Findings

After all user decisions are collected, compile results into a single report:

```
## Vulnerability Alert Triage — OWNER/REPO

**Alerts reviewed:** N across M packages
**Fix:** X | **Dismiss:** X

### Findings

| # | Package | CVE/GHSA | Severity | Verdict | Summary |
|---|---------|----------|----------|---------|---------|
| 1 | lodash  | GHSA-xxx | critical | Fix     | RCE via prototype pollution |
| 2 | lodash  | GHSA-yyy | high     | Dismiss | tolerable_risk — only affects server-side |
...

### Fix Details

(For each Fix item: package, alert number, strategy the user chose, fix complexity)

#### 1. lodash — GHSA-xxx — critical
**Strategy:** Bump to 4.17.21
**Complexity:** Simple bump, no breaking changes expected

### Dismiss Details

(For each Dismiss item: alert number, package, CVE, user's rationale and dismiss reason)

#### 2. lodash — GHSA-yyy — high
**Reason:** tolerable_risk
**Rationale:** Only affects server-side rendering which this project does not use
```

After printing the report, **clear the todo list** — mark all remaining tasks as completed. The review phase is done.

## Phase 5: Dismiss Alerts

If there are any Dismiss verdicts, present the full list one more time and ask for **final confirmation** before proceeding. This is a destructive action — be explicit about what will happen.

For each confirmed dismissal, call:

```
gh api --method PATCH repos/OWNER/REPO/dependabot/alerts/ALERT_NUMBER -f state=dismissed -f dismissed_reason=REASON -f dismissed_comment="COMMENT"
```

Where:
- `ALERT_NUMBER` is the Dependabot alert number
- `REASON` is `inaccurate` or `tolerable_risk`
- `COMMENT` is the user's rationale from Phase 3

Report each dismissal result (success or failure). If any fail, report the error and continue with the rest.

## Phase 6: Plan Fixes

If there are any findings with a **Fix** verdict, immediately enter plan mode using `EnterPlanMode` and plan the implementation of all fixes.

**Critical: Include full Q&A context.** When entering plan mode, include the **complete verbatim transcript** of every question you asked and every answer the user gave during Phase 3. Do not summarize, paraphrase, or omit any of it. The user's answers often contain specific implementation guidance, preferred approaches, and constraints that get lost in summarization. The planning agent needs every word.

In plan mode:
1. Read the relevant source files, `package.json` files, and lockfile for each Fix finding.
2. Group fixes by strategy (version bumps together, code changes together, package removals together).
3. Design a concrete implementation plan:
   - For version bumps: specify exact version changes and note that `pnpm install` + full verification (`pnpm typecheck && pnpm test && pnpm check`) is needed after.
   - For code changes: specify exactly what to change and where.
   - For package removals: identify all usage sites that need updating.
4. **Prefer approaches the user specified or endorsed during Q&A over alternatives.**
5. Exit plan mode with `ExitPlanMode` so the user can approve the plan before implementation begins.

If there are **no Fix findings**, skip this phase entirely and end the command.

## Guidelines

- **Read-only during Phases 1–4** — Do not modify any files during review and reporting.
- **Confirm before dismissing** — Phase 5 requires explicit user confirmation. Never dismiss without it.
- **Be thorough** — Subagents must read actual usage code, not just check if a package is installed.
- **Respect project patterns** — This repo uses pnpm exclusively. Version bumps go through `pnpm install`. Never use npm or yarn.
- **Do NOT push** — The user will push when ready.
- **Do NOT close or comment on GitHub issues/PRs** related to the alerts.
