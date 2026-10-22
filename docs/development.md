# Development and verification

[Documentation](README.md) · [Agent instructions](../AGENTS.md) · [Data contracts](data-model.md)

Use Node.js 24 and the host's native shell. On Windows use PowerShell and Windows-native Node; WSL is not required. Edit source, build explicitly and test the generated **dist** extension. The root manifest is source; there is no watch mode. The project `.npmrc` opts into only URL dependencies declared by this package (`allow-remote=root`), including the integrity-pinned SheetJS tarball; npm 12 otherwise refuses URL dependencies. No host npm configuration change is needed.

## Local development

The owner's [local-first delivery rule](../AGENTS.md#delivery-local-first) controls push, merge and deployment. `npm run try` runs units and creates a development build on any supported host. With a configured local trial target, it stages the complete build, reloads the same registered extension, checks every database store count and reopens its workspace. With no target config, checks/build still run, it prints **no local trial target: nothing loaded**, emits a `localTrial` summary with `loaded:false`, and exits successfully. This is local build evidence, not an installed trial. `--dry-run` never reads target configuration or contacts a browser.

Configuration belongs outside Git. Discovery uses `--config FILE`, then `LOCAL_TRIAL_CONFIG`, then `$XDG_CONFIG_HOME/<package-name>/try.json` (or `~/.config/<package-name>/try.json`). For this package the default is `~/.config/1688topl/try.json`; the old `1688tocsv` directory remains a fallback with a deprecation message. An explicit missing file is a missing target, not permission to use a different config. Invalid config is reported as an error without loading.

Supply the actual machine's absolute `installDir`, absolute disjoint `stagingDir` on the same filesystem, registered `extensionId`, and `browserMcp` command/argument array. The install folder can have any name and must remain outside the active checkout. Resolved paths are checked, including symlinks; the loop never stages into its own source or a nested install/staging folder. Keep an existing registered path even if it contains an older project name.

`browserMcp` is a machine-provided browser MCP command. CE Dev Browser is one example. The command must support its browser guide/lease, registered-extension list/reload, tabs, snapshot and read-only evaluation tools; the repository assumes no executable location or installed browser. Refusals stop the loop rather than select another transport. The database name and reviewed compatible display names come from `package.json`'s `localTrial` metadata, with optional target overrides. Copying the loop to another extension requires that extension's own metadata, not a machine-specific edit to the script. A display-name transition still checks the unchanged key and registered path/ID.

First installation is separate: build, use the host's supported browser installation flow with an explicitly chosen stable folder, confirm its new ID/registration, and open the workspace to initialize that new library. Only then configure a reload target. The reload loop refuses an unregistered/disabled extension or missing database and never creates, resets, imports or restores a library. When a managed browser supplies an install target, its machine config can point to that target; no target is assumed before it exists.

| Command                               | Purpose                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run try`                         | Unit tests and development build; configured staging/reload/count comparison, or explicit no-target result. |
| `npm run try -- --quick`              | Same load loop without unit tests; reuse valid test evidence.                                               |
| `npm run try -- --smoke`              | Add the packaged browser smoke subset.                                                                      |
| `npm run try -- --dry-run`            | Build without installed staging.                                                                            |
| `npm run try -- --rollback`           | Restore the previously staged build.                                                                        |
| `npm run verify`                      | Source/docs checks, units, production rebuild and isolated Chromium tests.                                  |
| `npm run build` / `npm run build:dev` | One production/development build into dist.                                                                 |
| `npm run test:browser`                | Test the current packaged build with synthetic pages.                                                       |
| `npm run test:excel`                  | Native Windows Excel check with disposable workbooks and clipboard restoration.                             |
| `npm run preview`                     | Synthetic preview; `/library.html` opens the workspace.                                                     |
| `npm run screenshots`                 | Refresh documented workspace/label/settings images with synthetic data.                                     |
| `npm run check:docs`                  | Check local targets, required screenshots and package commands.                                             |

The installed loop refuses an unregistered/wrong folder, running import, incompatible identity or changed library counts. It preserves an interrupted staging journal and rollback build, refuses recovery paths outside staging or bound to another target, and reports uncertain reloads with `loaded:null` rather than inventing a result. A supported rename can migrate display branding while retaining key/path/ID. Do not reset, import or restore an owner's library for tests. Report a blocked installed step separately from local test success.

[CI](../.github/workflows/ci.yml) routes documentation-only changes to docs checks and code changes to full verification; mixed changes get both. The stable `required` job rejects failures, cancellations and unexpected skips. Run full verification once at final deploy, and locally when build/test/CI machinery changes. Documentation-only work does not require reloading the installed extension.

## Runtime ownership

| Responsibility                                           | Source                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout extraction, complete snapshot validation          | Page adapters, [order-snapshot.js](../src/order-snapshot.js), [money.js](../src/money.js)                                                                                                                                |
| Durable imports, bounded retries and reader navigation   | [import-controller.js](../src/import-controller.js), [background.js](../src/background.js)                                                                                                                               |
| Records, restore transactions, edit clocks and ownership | [database.js](../src/database.js), [packing-backup.js](../src/packing-backup.js)                                                                                                                                         |
| Preparation membership, codes, grouping/history          | [packing-model.js](../src/packing-model.js), [preparation-history.js](../src/preparation-history.js), [packing-grouping.js](../src/packing-grouping.js)                                                                  |
| Physical cartons, reconciliation and global Backlog      | [carton-batches.js](../src/carton-batches.js), [carton-reconciliation.js](../src/carton-reconciliation.js), [inventory-model.js](../src/inventory-model.js)                                                              |
| Container transactions and immutable shipment revisions | [container-model.js](../src/container-model.js), [container-repository.js](../src/container-repository.js), [purchase-codes.js](../src/purchase-codes.js)                                                              |
| Separate 1688 packing-report evidence and review         | [packing-report-model.js](../src/packing-report-model.js), [packing-report-client.js](../src/packing-report-client.js), [carton-report-repository.js](../src/carton-report-repository.js)                                |
| Image/cache identities and photo composition             | [images.js](../src/images.js), [product-photo.js](../src/product-photo.js), [photo-viewer.js](../src/photo-viewer.js)                                                                                                    |
| XLSX/PDF and export options                              | [container-export.js](../src/container-export.js), [packing-workbook.js](../src/packing-workbook.js), [packing-workbook-images.js](../src/packing-workbook-images.js), [pdf-writer.js](../src/pdf-writer.js)          |

Keep source-layout selectors in adapters/fixtures, not library UI. Full order/entry IDs remain strings. Failed reads preserve the last good snapshot; a changed valid snapshot creates history. Purchase time is source evidence and remains stable once established. Notes, tags, workflow and preparation remain separate authored state.

Imports use one marked reader: background tab, unfocused window, then visible fallback. Verify new IDs with `tabs.get()` before checkpointing. Missing IDs permit supported fallback/reopen; real failures stay actionable. Sign-in pauses with reader attention. Cleanup closes only owned readers and preserves user-navigated/login tabs. Workspace opening never resumes paused bulk jobs. `IMPORT_PROGRESS` updates jobs; `LIBRARY_CHANGED` reloads records. Progress must not rescan the library or mutate the import queue.

## China-store spreadsheets

The [user marker guide](store-spreadsheets.md) is the canonical usage reference. Keep `STORE_IMPORT_MARKERS`, [store-spreadsheet-guide.js](../src/store-spreadsheet-guide.js), template and tests aligned. No inferred columns or additional aliases.

[store-workbook-worker.js](../src/store-workbook-worker.js) uses bundled SheetJS for XLSX/BIFF8. [store-workbook-reader.js](../src/store-workbook-reader.js) retains images, anchors and merges. [store-workbook-model.js](../src/store-workbook-model.js) validates selected-sheet cells, exact totals and source groups. Formulas/macros never execute; cached results must exist. Only `desc` repeats; exactly two `total` controls surround one value in a row/column. Blank group rows skip. Required quantities are positive integers; money uses exact helpers. `parseStoreNumber()` accepts one number plus ordinary unit text, never ambiguous calculations; workbook decimals differ from interactive decimal-comma input.

`parseStoreFilename()` repeatedly strips familiar Windows copy suffixes. Market keys are `market:<number>`; factory keys use the lowercased remaining stem. A spreadsheet snapshot keeps `sourceType: 'spreadsheet'`, `store: {key,name,number,kind}` and `spreadsheet: {filename,sheetName,importedAt,total,rows}`. Its member login is `store:<key>`; source URL is empty. Purchase date is explicitly confirmed and stored at noon `+08:00`, independently of import time. Renaming display names/contacts joins by known source/store/account identity, never display name alone.

`importStoreOrder()` creates a new purchase with original assets and capacities in one transaction. Content-match warnings are nonblocking and work with older records without a schema migration: compare the same store/sheet, numeric source-row evidence, descriptions/product numbers, declarations and original photo keys, ignoring filename suffix/purchase date. Never collapse deliberate repeat purchases or their financial rows.

`store-order.js` preserves authoritative source rows once, with source group/row and optional variant/size identities. Combined declarations need explicit positive allocations whose quantities and rounded amounts sum to source evidence. Shared photo anchors/merged cells cover only actual included rows; zero-offset endpoints stay exclusive. No group/proximity fallback fills uncovered rows. [spreadsheet-properties.js](../src/spreadsheet-properties.js) feeds all retained marked descriptions into shared recognition, including older imports; article IDs never become measurements.

[store-import-dialog.js](../src/store-import-dialog.js) terminates parsing on close, locks dismissal during save and separates acknowledgments from blocking validation/allocation. Template download is [store-order-template.xlsx](../src/assets/store-order-template.xlsx): marker row 5, headers 6, data 7–26; invoice L30 between K30/M30, calculated comparison L32. Notes keep Group blank. Preserve cached results and Guide; recalculate/save after reauthoring.

Focused tests: [model](../tests/store-workbook-model.test.mjs), [reader](../tests/store-workbook-reader.test.mjs), [source/order allocations](../tests/store-order.test.mjs), [packing](../tests/store-packing.test.mjs), [template](../tests/store-template.test.mjs), [import dialog](../tests/store-import-dialog.test.mjs), [browser import](../tests/browser/store-import.spec.mjs), [template download](../tests/browser/template-download.spec.mjs), [guide](../tests/browser/store-spreadsheet-guide.spec.mjs), and [shared contacts](../tests/store-wechat.test.mjs).

## Workspace and UI contracts

Orders owns Products, Cartons and Backlog, purchase-month codes and product authoring. Packing owns a named container's Loading, read-only Packing list and frozen Se quedó. Whole-order membership is independent of product selection. Single click inspects; explicit controls select. Edit in Orders retains a return route to the container/revision. Obsolete product-selected Prepare, repeated packing forms, Organize/drag and per-product removal paths are absent from the active shell.

Continuous lists retain logical full scope independently of mounted DOM. [virtual-list.js](../src/virtual-list.js), [virtual-table.js](../src/virtual-table.js) and [vocabulary-table.js](../src/vocabulary-table.js) preserve measured scroll anchors, focused editors and dirty drafts. Mounting must not trigger saves/history or reset media. Navigation/reveal mounts its destination; selection/output use logical keys, not DOM indices. Small lists mount completely. Workspace lists have no pagers; physical print/gallery navigation remains.

[row-selection.js](../src/row-selection.js) separates native controls and nested selections. Shift ranges use complete keys; double-click's second click cannot undo the first selection. Selecting never writes preparation. Main chronology remains newest first; container products use stable sorting. Store/order identity bands are nonselectable and appear once, outside source/copy rows. Keep responsive summary tracks stable between clicks and preserve readable compact order cards at narrow widths.

The Orders smart grid persists raw invalid cells, selected-key paste alignment, generation and compound Undo/Redo separately from effective physical facts. One-column paste previews its captured logical target; changed filtering/sorting/scope invalidates it. Tab/Enter and IME retain the focused editor across virtualization. Only affected order dependencies recalculate. No capacity-only edit creates physical cartons; one order confirmation validates the current planner draft. Packing contains no duplicate code/capacity editor.

1688 packing reports use a separate local, cancellable worker/client and order-scoped review. Preserve exact original TSV/XLS/XLSX assets, cell evidence and reviewed mappings. Shared workbook decoding never executes formulas/macros; missing formula caches reject in both importer paths. New report aliases do not alter China marker recognition. A stale parse/save result cannot replace a newer edit. Historically used report/carton corrections route to an amendment, not ordinary replacement.

[i18n.js](../src/i18n.js) translates explicitly marked messages/attributes without arbitrary text replacement. `createLanguageScope()` owns popup-local language, including portalled children and frozen exports, and disposes observers. Settings shares a draft across sections, locks while validating/saving, waits for tag renames and reveals offscreen invalid rules. Tag rename/delete is atomic across catalogs/current/history assignments; annotation autosave flushes typed tags and retains failed drafts.

Helpers use shared pointer/focus lifecycles, follow mouse or anchor keyboard focus, and release listeners on close. They do not intercept underlying clicks or select parents. Errors identify the actual issue, keep drafts and route recovery to a live scope. Long comparison/column dialogs pin actions above one scroll body. Native/fallback dialog/popover positioning supports the declared browser baseline.

Shared photos are 74 × 74 CSS px; copy control is 24px, inset 2px in the visible photo, scaled for tiny thumbnails. Keep touch/keyboard reachability. `code-design.js/css` defines scaled black/white typography, padding/corners; `code-display.js` underlines only the four product digits without changing strings/native inputs. Printed labels remain plain black/white code artwork; Excel-image barcode cells use an opaque pixel-aligned underline. Use warm interface surfaces, amber/coral/sage cues and semantic foregrounds; actual product-color swatches can be blue.

XLSX and Excel images use `workspaceExportStyle()` and the current theme's light palette. Native 1688 Details is left-aligned 10pt; spreadsheet descriptions retain larger centered typography. Full wrapping, square photo rows and exact numbers survive output. Bounded image planning releases canvases/URLs and loads only included photos/marks. Clipboard preview changes never write; explicit copy locks navigation until completion. Source-photo clipboard budgets count each actual placement; XLSX media budgets count unique embedded payloads workbook-wide.

## Focused verification

Use synthetic fixtures/temporary profiles; never modify supplier originals or the owner library. Bound large units with:

```powershell
node --test --test-concurrency=2 tests/*.test.mjs
npm run test:browser -- --workers=1
```

These limits are defaults: `npm test` uses unit concurrency 2 and Playwright uses one worker because the OS clipboard is shared even across isolated profiles. CI retains four independent runner shards, each serialized. Do not run competing clipboard suites/native Excel concurrently. Playwright clicks do not await clipboard completion: wait for the completed Copied state before native readback. For held database writes, use the fieldset's native disabled property as the persistence barrier; Playwright's enabled matcher ignores disabled fieldsets. Wait for old dialog removal and current controls before advancing. Preserve substantive layout, selection, exact-image and financial assertions when correcting fixtures.

Packaged tests use a temporary manifest with reserved test domains/localhost and inspection permissions. Remote requests are blocked; these permissions do not ship. Coverage includes real extraction, IndexedDB, download contents, clipboard completion, delayed saves, large logical lists and retries. It does not prove live layouts or installed-owner acceptance. Private offline replays use inert captures in ignored `work/` and remain distinct evidence.

To run an affected Edge packet:

```powershell
$env:EXTENSION_TEST_CHANNEL = 'msedge'
try {
  npm run test:browser -- tests/browser/import-flow.spec.mjs --workers=1
} finally {
  Remove-Item Env:\EXTENSION_TEST_CHANNEL
}
```

Regenerate synthetic screenshots for UI delivery and run docs checks. Verify Markdown fragments as well as file paths; the current checker only covers paths. Report passed/failed/blocked/not-run checks against the final candidate. Historical results remain in Git history and linked PRs; [store readiness](../CHROMEWEBSTORE.md#development-verification) must distinguish them from current verification.
