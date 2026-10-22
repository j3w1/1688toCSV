# Development and verification

[Documentation](README.md) · [Agent instructions](../AGENTS.md) · [Data contracts](data-model.md)

Use Node.js 24, PowerShell and native Windows runtimes on the local host. Edit source, build explicitly and test the generated **dist** extension. The root manifest is source; there is no watch mode. Remote Linux work remains separate from local Windows execution.

## Local development

The owner's [local-first delivery rule](../AGENTS.md#delivery-local-first) controls push, merge and deployment. `npm run try` runs units, creates a development build, stages complete `dist`, reloads the registered CE Dev Browser extension, checks every database store count and reopens the workspace closed by reload. Load once per ready batch, preserving installed path, manifest key, ID and library.

Machine configuration belongs outside Git at `~/.config/1688topl/try.json`, with legacy `~/.config/1688tocsv/try.json` accepted as a fallback. Required fields are `installDir` (registered `dist`), `extensionId`, `browserMcp` (server command) and `stagingDir` (same filesystem). Keep an existing registered path even if it contains the previous project name. Do not move its storage or register another ID merely to match repository branding.

| Command                               | Purpose                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run try`                         | Unit tests, development build, installed staging/reload and count comparison.   |
| `npm run try -- --quick`              | Same load loop without unit tests; reuse valid test evidence.                   |
| `npm run try -- --smoke`              | Add the packaged browser smoke subset.                                          |
| `npm run try -- --dry-run`            | Build without installed staging.                                                |
| `npm run try -- --rollback`           | Restore the previously staged build.                                            |
| `npm run verify`                      | Source/docs checks, units, production rebuild and isolated Chromium tests.      |
| `npm run build` / `npm run build:dev` | One production/development build into dist.                                     |
| `npm run test:browser`                | Test the current packaged build with synthetic pages.                           |
| `npm run test:excel`                  | Native Windows Excel check with disposable workbooks and clipboard restoration. |
| `npm run preview`                     | Synthetic preview; `/library.html` opens the workspace.                         |
| `npm run screenshots`                 | Refresh documented workspace/label/settings images with synthetic data.         |
| `npm run check:docs`                  | Check local targets, required screenshots and package commands.                 |

The installed loop refuses an unregistered/wrong folder, running import, incompatible identity or changed library counts. A supported rename can migrate display branding while retaining key/path/ID. Do not reset, import or restore the owner's library for tests. Honor tool-policy refusals and report the blocked installed step separately from local test success.

[CI](../.github/workflows/ci.yml) routes documentation-only changes to docs checks and code changes to full verification; mixed changes get both. The stable `required` job rejects failures, cancellations and unexpected skips. Run full verification once at final deploy, and locally when build/test/CI machinery changes. Documentation-only work does not require reloading the installed extension.

## Runtime ownership

| Responsibility                                           | Source                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout extraction, complete snapshot validation          | Page adapters, [order-snapshot.js](../src/order-snapshot.js), [money.js](../src/money.js)                                                                                                                                |
| Durable imports, bounded retries and reader navigation   | [import-controller.js](../src/import-controller.js), [background.js](../src/background.js)                                                                                                                               |
| Records, restore transactions, edit clocks and ownership | [database.js](../src/database.js), [packing-backup.js](../src/packing-backup.js)                                                                                                                                         |
| Preparation membership, codes, grouping/history          | [packing-model.js](../src/packing-model.js), [preparation-history.js](../src/preparation-history.js), [packing-grouping.js](../src/packing-grouping.js)                                                                  |
| Physical cartons and source projection                   | [carton-batches.js](../src/carton-batches.js), [carton-details.js](../src/carton-details.js)                                                                                                                             |
| Image/cache identities and photo composition             | [images.js](../src/images.js), [product-photo.js](../src/product-photo.js), [photo-viewer.js](../src/photo-viewer.js)                                                                                                    |
| XLSX/PDF and export options                              | [packing-workbook.js](../src/packing-workbook.js), [packing-workbook-images.js](../src/packing-workbook-images.js), [pdf-writer.js](../src/pdf-writer.js), [packing-export-options.js](../src/packing-export-options.js) |

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

Continuous lists retain logical full scope independently of mounted DOM: about 100 Orders/Products/rules/variants, 20 normal packing groups or 100 Organize cards. [virtual-list.js](../src/virtual-list.js), [virtual-table.js](../src/virtual-table.js) and [vocabulary-table.js](../src/vocabulary-table.js) preserve measured scroll anchors, focused editors, dirty drafts and reorder sources. Mounting must not trigger saves/history or reset media. Navigation/reveal mounts its destination; selection/output use logical keys, not DOM indices. Small lists mount completely. Workspace lists have no pagers; physical print/gallery navigation remains.

[row-selection.js](../src/row-selection.js) separates native controls and nested selections. Shift ranges use complete keys; double-click's second click cannot undo the first selection. Selecting never writes preparation. Main chronology remains newest first; packing manual arrangement is independent. Store/order identity bands are nonselectable and appear once, outside source/copy rows. Keep responsive summary tracks stable between clicks and preserve readable compact order cards at narrow widths.

Shared source-entry Pcs/box controllers mount in both views, preserve invalid/pending drafts and use source identity after grouping. Physical projections remain read-only. Numeric editors flush before navigation/export. No capacity-only edit creates cartons. Organize has separate management selection and no normal packing drag/trash gutters; movement preserves hidden rank slots and cannot move variants/groups outside their allowed owner scope.

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

Do not run clipboard suites/native Excel concurrently. Playwright clicks do not await clipboard completion: wait for the completed Copied state before native readback. For held database writes, use the fieldset's native disabled property as the persistence barrier; Playwright's enabled matcher ignores disabled fieldsets. Wait for old dialog removal and current controls before advancing. Preserve substantive layout, selection, exact-image and financial assertions when correcting fixtures.

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
