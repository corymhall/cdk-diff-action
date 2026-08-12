---
description: Merge all open dependabot PRs into the current branch
allowed-tools: Bash(git *), Bash(gh *), Bash(pnpm *)
---

## Merge Dependabot PRs

Merge all open dependabot pull requests into the current branch by merging their git branches directly. This preserves git history so that when the branch is pushed, GitHub automatically closes the corresponding PRs.

## Context

- **Branch:** !`git branch --show-current`
- **Git Status:** !`git status --short`
- **Repo:** !`gh repo view --json owner,name --jq '.owner.login + "/" + .name'`

## Prerequisites

1. **Clean working tree required.** If git status shows uncommitted changes, stop and tell the user to commit or stash first.
2. **Fetch latest remote refs:** Run `git fetch origin`

## Step 1: Discover Dependabot PRs

Run `gh pr list --author "app/dependabot" --state open --json number,title,headRefName --limit 100` to find all open dependabot PRs.

- If no PRs are found, report "No open dependabot PRs found." and stop.
- Present the list to the user:
  ```
  Found N dependabot PR(s):
  - #123: Bump foo from 1.0 to 2.0 (dependabot/npm_and_yarn/foo-2.0)
  - #124: Bump bar from 3.0 to 4.0 (dependabot/npm_and_yarn/bar-4.0)
  ...
  ```

If any updates jump a major version you must do research to determine if there are breaking changes first. cjs to esm is not a breaking change. Breaking changes are specifically any changes that impact the API surface area our app or our app's dependencies are using.

If there are no breaking changes, simply proceed to step 2. If there are breaking changes, report the breaking changes to the user, and proceed to step 2 with only those packages who's major version didn't change.

## Step 2: Merge Each Branch

For each dependabot PR (in order by PR number, lowest first):

1. Run `git merge origin/<headRefName> --no-edit`
2. If the merge succeeds, report it and continue to the next branch.
3. **If the merge conflicts on `pnpm-lock.yaml` only:** Resolve automatically by keeping the current branch's lockfile (`git checkout HEAD -- pnpm-lock.yaml`), run `pnpm install` to fix collapse and correct the lockfile based on this new addition, stage it (`git add pnpm-lock.yaml`), complete the merge (`git commit --no-edit`).
   - **Warning:** This resolution silently discards *in-range* bumps. If the PR's version bump is already satisfied by the existing `package.json` range (dependabot only changed the lockfile), `pnpm install` keeps the old resolved version. Step 4 catches and repairs this — do not skip it.
4. **If the merge conflicts on files other than `pnpm-lock.yaml`:** Stop immediately. Report which branch caused the conflict and ask the user for guidance before proceeding. Do NOT run `git merge --abort` unless the user tells you to.

After all branches are merged successfully, report the summary of merged branches.

## Step 3: Install Dependencies

Run `pnpm install` to update the lockfile with the merged dependency changes.

If `pnpm install` fails, report the error and ask the user for guidance.

## Step 4: Verify Resolved Versions (catch silent discards)

**Mandatory.** For every merged PR, confirm the target package actually resolves at (or above) the PR's bumped version in `pnpm-lock.yaml`:

```
grep -oE "<package>@[0-9][0-9.]*" pnpm-lock.yaml | sort -u
```

(For scoped packages, match the full name, e.g. `@deck.gl/geo-layers@[0-9.]+`. Multiple resolved versions can be fine when a dependency privately bundles its own copy — what matters is that OUR resolution reaches the bumped version.)

**If a package still resolves at the old version**, the lockfile-conflict resolution discarded an in-range bump. Repair it:

1. Find which workspace declares the dependency (root vs `apps/*` vs `packages/*`).
2. Run `pnpm update <package>` for root deps, or `pnpm --filter <workspace> update <package>` for workspace deps. This bumps both the lockfile and the declared caret range.
3. Re-verify with the grep above.
4. Commit the repair: `chore(deps): apply in-range bumps for <packages>` with a body explaining the bumps were dropped during lockfile-conflict resolution.

Do not proceed to Step 5 until every merged PR's package verifiably resolves at its bumped version.

## Step 5: Full Verification

Run verification in this order. If any step fails, report the failure and ask the user what to do before continuing to the next step.

1. **Typecheck:** `pnpm typecheck`
2. **Tests:** `pnpm test`
3. **Lint:** `pnpm check`

## Step 6: Report

Present a final summary:

```
## Dependabot Merge Summary

Merged N dependabot PR(s) into <current-branch>:
- #123: Bump foo from 1.0 to 2.0 ✓
- #124: Bump bar from 3.0 to 4.0 ✓

Verification:
- Resolved versions: ✓ (all merged packages resolve at their bumped versions)
- Typecheck: ✓
- Tests: ✓
- Lint: ✓

Ready to push. The merged PRs will auto-close when pushed to origin.
```

## Important

- Do NOT push to the remote. The user will push when ready.
- Do NOT close or comment on the GitHub PRs.
- Do NOT create a new branch. Merge directly into the current branch.
- If the working tree is dirty at the start, refuse to proceed.
