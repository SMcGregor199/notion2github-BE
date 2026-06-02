# Agent Instructions for notion2github-BE

Backend and Netlify Functions layer for `shaynemcgregor.dev`.

## Read Before Work

- `../system_context.md`
- `../WORKFLOW.md`
- `../DECISIONS.md`
- `README.md`

## Repo-Specific Cautions

- Source hub for shared blog JSON and image URLs.
- Netlify-configured through `netlify.toml`, `netlify/functions/`, and `@netlify/*` dependencies.
- `dist/` is currently treated as generated output unless proven otherwise.
- Prefer `npm run clean` when removing compiled output.
- Do not change backend data contracts without considering downstream frontend and RSS consumers.
- Do not inspect `.env`, `.netlify/state.json`, or secret files.
- Do not run `npm run seed:airtable` or any production write flow without explicit approval.

## Verification Expectations

- For source changes, prefer `npm run test` and `npm run build` when appropriate.
- For documentation-only changes, read back the edited docs and check `git status --short`.
- Report any skipped verification command and why it was skipped.

## Cleanup Expectations

- Leave user-owned dirty files untouched.
- Treat `dist/` as generated output unless a task explicitly says otherwise.
- Do not commit generated output or external-service writes.
- Do not modify `.gitignore` to ignore `AGENTS.md`.

## Final Handoff Expectations

- State which files changed.
- State which commands ran and which were skipped.
- Call out any downstream frontend or RSS follow-up.
- Do not create commits, branches, PRs, releases, or tags unless Shayne asks.
