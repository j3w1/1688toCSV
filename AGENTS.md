# 1688toPL agent instructions

Inspect the worktree, [README](README.md), manifest and package scripts before editing. Preserve unrelated work. Never commit credentials, private orders, exports, captures, browser profiles or machine configuration. Read the relevant contract in the [documentation index](docs/README.md); update that source of truth when behavior changes.

## Delivery: local first

Standing owner rule, 2026-10-19, issue #10:

- **Implement** means a local integration branch, focused tests and the fast installed-load loop for the owner to try. Accepted changes accumulate as local commits. It does not request push, pull request, hosted CI, merge, store release or deployment.
- **Deploy**, or equivalent explicit owner wording, means publish exactly the owner-accepted local changes as one pull request, run `npm run verify`, obtain green hosted CI, merge to main, refresh the installed extension and confirm library counts.
- Standing autonomy covers delegable choices. It does not replace owner acceptance in the coordinator's own tab or the deploy instruction.

## Working loop

Use PowerShell and Windows-native Node.js 24 on this host. Do not start WSL unless explicitly requested. Build explicitly; never add watch mode or leave rebuilding to the user.

`npm run try` tests, makes a development build, stages the complete `dist`, reloads the registered extension through CE Dev Browser and compares every library store count. Run it once per ready batch. See [development](docs/development.md#local-development) for flags and machine-local configuration. Prefer `~/.config/1688topl/try.json`; the older configuration directory remains a compatibility fallback.

The owner's installed library contains real orders. Preserve its folder, manifest key and extension ID. A display-name migration must retain identity. Never reset, reimport or restore the owner library for tests. If an ID change is unavoidable, first use the extension's own Backup, restore into the new install and verify counts before abandoning the old one. Automated tests use synthetic data and temporary profiles.

Check with focused tests first. Use shared CE Dev Browser visual inspection briefly only when automated checks cannot judge the result. Loading the ready batch for the owner stays part of delivery. Honor browser-tool denials; report the exact blocked step and retain the useful local candidate.

Documentation-only work requires `npm run check:docs`. Mixed/code work follows the fast loop. Run `npm run verify` once on the final deploy candidate, and locally when build, test or CI setup changes. For UI work, regenerate synthetic screenshots with `npm run screenshots` and check docs before deploy. Keep the stable CI `required` check aligned with these rules. Report source, unit, browser, installed-extension, native Excel and physical-print evidence separately as passed, failed, blocked or not run.

## Data and compatibility

- Read [data contracts](docs/data-model.md) before changing persistence, calculations, restore or ownership. Preserve complete source snapshots, reconciliation history, separate purchase quantities/prices, authored preparation and physical carton evidence.
- Read the [spreadsheet guide](docs/store-spreadsheets.md) and [developer contract](docs/development.md#china-store-spreadsheets) before changing supplier imports, identity, cartons or photos. Keep parser, in-app guide, downloadable template and regressions aligned. Infer no markers from unmarked columns and no physical contents from carton averages.
- Only current assignments reserve codes. Check revisions and final ownership atomically; checkpoints retain values without reserving retired codes. Shared purchases keep separate source and financial records.
- The persisted database and backup format names beginning `1688-order-library` are compatibility identifiers. Branding changes do not rename them or discard data. Backups retain referenced original photos and metadata; do not downsample originals or delete reconciliation evidence as a size optimization.
- Detailed packing automation JSON is explicit opt-in and contains full costs/reasons/identifiers independently of XLSX columns. Preserve that disclosure in the export UI and documentation.
- Do not weaken substantive assertions to make checks pass. Keep browser suites with clipboard access serialized and avoid competing native Excel checks. Use bounded test concurrency as described in development.

## CE Meta

The CE Meta programme is stopped. Do not restart its schedules, classification, label reconciliation or Project writes from historical repository instructions. Fresh owner authorization is required to resume it. Historical policy lives in [ce-meta/policy](https://github.com/j3w1/ce-meta/tree/main/policy); it grants no source, review, merge, release or production authority. This stopped programme is separate from the repository's own CI.
