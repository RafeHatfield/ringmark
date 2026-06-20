Check Sentry for new unresolved errors in the Ringmark project and, for any with a clear code fix, implement the fix and open a pull request.

## Steps

### 1. Fetch issues
Use `mcp__sentry__search_issues` to query org `rafe-hatfield`, project `ringmark` for unresolved issues. Focus on issues with recent activity.

### 2. Assess each issue
For each issue, fetch the full stack trace and event details using `mcp__sentry__search_issue_events`.

Classify:
- **Actionable** — stack trace points to a specific file/line in this codebase and the fix is clear
- **Skip** — external service failure, infrastructure noise, one-off with no reproduction, or fix is speculative

### 3. Fix and PR (actionable issues only)
For each actionable issue:
1. Read the relevant source files. Understand the bug before touching anything.
2. Make the minimal targeted fix — no refactoring beyond what's needed.
3. Run `npx tsc --noEmit` and confirm clean (ignore errors under `.next/`).
4. Pull latest main and create a branch: `git checkout main && git pull && git checkout -b fix/sentry-<issue-short-id>`
5. Stage only the changed files — check `git status` first, never blindly `git add -A`.
6. Commit: `fix(<area>): <description>\n\nFixes Sentry issue <issue-url>\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
7. Push and open a PR with `gh pr create`. PR body should include the Sentry issue URL, a one-paragraph summary of the root cause, and what the fix does.
8. Call `mcp__sentry__update_issue` to mark the Sentry issue as `in_progress`.

### 4. Report back
Finish with a clear summary:
- How many issues were found
- Which were actionable vs skipped (and why each was skipped)
- For each fix: PR link, root cause in one sentence, what changed

## Rules
- Never push directly to main
- Never create a PR without a real code change that fixes a real bug
- Never touch migrations, e2e tests, or env config speculatively
- If multiple issues share a root cause, batch them into one PR
- When in doubt about a fix, skip it and explain why in the report
