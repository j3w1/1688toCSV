# Chrome Web Store Listing — 1688toPL

Last updated: 2026-10-23. **SEAL implementation, version 2.10.0; unpublished to the store.** This file is the store metadata source of truth, not authorization to submit or release. Current verification is tracked below; historical test counts do not establish acceptance of this candidate.

## Store Listing

**Extension name:** 1688toPL, matching the production manifest.

**Short description:** Keep local 1688 and store spreadsheet orders, prepare packing lists, and copy product data and pictures to Excel.

**Detailed description — draft:**

```text
Turn 1688 purchases and supplier spreadsheets into accurate container packing lists, barcode labels and carton marks.

Import selected 1688 orders or a marked supplier workbook. Add purchases from other sources manually or from JSON. Keep original product descriptions, quantities, prices and photos together in a local order library.

Prepare products in Orders with CE codes, Spanish names and Chinese categories using editable local rules. New codes use the original purchase calendar month. Review size/material suggestions, paste a 1688 supplier packing report or enter Pcs/box once, then review carton/remainder proposals. Preserve actual uneven cartons and honest unknown contents or measurements. Eligible repeat purchases can share reviewed codes while retaining separate purchase values; shipped code lineages cannot accept new members.

Packing selects whole orders into a named container. Confirm loaded/left-behind cartons, inspect the derived read-only packing list and seal a versioned manifest. Global Backlog updates automatically; historical Se quedó remains reproducible. Reviewed amendments preserve prior revisions and protect cartons committed elsewhere.

Copy values, photos, chosen columns or table pictures into Excel. Download the complete container revision as an editable workbook with Packing list, Cartons and Se quedó sheets. Optional detailed automation JSON contains full costs, charge reasons and source identifiers independently of workbook column choices. Print barcode labels and carton marks as offline PDFs.

Open your 1688 order list, select purchases and choose Import selected. Manage products/cartons in Orders, include whole purchases in Packing, review loading and export the selected revision. Supplier purchase workbook import retains its template and cell-level review; a matching-content warning helps identify accidental repeat imports without blocking deliberate new purchases.

Orders, source/report history, original photos, container revisions, notes and settings stay in your browser. Back up the whole library or a reviewed preparation scope to a lossless local file. Importing uses your existing 1688 session; uncached product pictures may load from Alibaba CDN. No analytics, online translation or developer-operated order upload is used.

Use one buyer account per library. Unsupported page layouts or inconsistent totals fail without replacing the last good saved order. Review suggestions and physical carton counts before relying on labels. Keep a full backup before clearing your browser profile or uninstalling.
```

**Category:** Shopping, proposed; confirm in Dashboard.

**Single purpose:** Prepare locally stored purchase orders, product codes and packing labels for Excel and printing.

**Primary language:** English, with Chinese/Spanish interface choices and preserved source text.

## Graphics & Assets

| Asset                  | Required dimensions     | Status / source                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Icon                   | 128 × 128 PNG           | [Present](icons/icon128.png); rights/store suitability not established.                                                                                                                                                                                                       |
| Screenshot             | 1280 × 800 or 640 × 400 | [Orders](screenshots/order-library.png), [dark Orders](screenshots/order-library-dark.png), [Orders carton reconciliation](screenshots/order-cartons.png), [container loading](screenshots/container-loading.png); synthetic documentation images, store composition pending. |
| Additional screenshots | Same store sizes        | [Spreadsheet import](screenshots/store-spreadsheet-import.png), [label editor](screenshots/label-editor.png), [Settings](screenshots/settings.png).                                                                                                                           |
| Small promo tile       | 440 × 280               | Not created.                                                                                                                                                                                                                                                                  |
| Optional marquee       | 1400 × 560              | Not created.                                                                                                                                                                                                                                                                  |

Synthetic documentation images were refreshed for the renamed candidate, including the [packing export dialog](screenshots/packing-export.png). Store-sized composition is still pending. Confirm rights for 1688/Alibaba, spreadsheet and Casa Elida artwork or replace it before submission. A user-selected logo also needs appropriate rights. Do not imply affiliation.

## Permissions Justification

The production [manifest](manifest.json) requests these permissions; test-only localhost/inspection permissions do not ship.

| Permission / match                                                          | Type           | User-facing purpose                                                                                                          |
| --------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                                                                      | Permission     | Open/reuse order readers and selected source orders; detect interruptions and close only owned reader tabs.                  |
| `alarms`                                                                    | Permission     | Continue checkpointed steps during a requested import.                                                                       |
| `clipboardWrite`                                                            | Permission     | Copy chosen values, pictures and generated labels after the user's copy action.                                              |
| `unlimitedStorage`                                                          | Permission     | Retain local orders, history, preparations and original pictures beyond small default limits; storage failures still report. |
| `https://cbu01.alicdn.com/*`                                                | Host           | Fetch/cache public product originals without credentials.                                                                    |
| `https://trade.1688.com/order/new_step_order_detail.htm*`                   | Content script | Read supported legacy detail pages and offer save/CSV controls.                                                              |
| `https://air.1688.com/app/ctf-page/trade-order-detail/index.html*`          | Content script | Read supported detail pages, save/refresh and offer CSV.                                                                     |
| `https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html*` | Content script | Discover selected/filtered orders and follow list pagination.                                                                |
| `https://work.1688.com/*`                                                   | Content script | Mount import controls only when a supported buyer list is found, including embedded matching frames.                         |

The action opens a full workspace tab. No downloads, scripting, activeTab, cookies, history or clipboard-read permission is declared.

## Privacy & Data Use

**Handles user data: yes, locally.** No developer-operated upload or analytics endpoint is used.

| Data                                                                                                            | Local handling / network boundary                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Supplier/store/member IDs, references, purchase dates, products, prices, quantities, discounts/freight/payables | Validated snapshots/history for reconciliation and requested copying/export.                                                    |
| Supplier workbooks, filenames, source rows, embedded photos                                                     | Parsed locally; originals and chosen source evidence retained. No parsing service/file upload.                                  |
| Notes/tags, optional WeChat IDs, workflow, features, payment references and costs                               | Stored separately from source and retained in appropriate backups. No WeChat contact, payment processing or supplier messaging. |
| Preparations, codes/shared identities, carton contents/marks/measurements/confirmations and checkpoints         | Stored locally; relevant backup/exports preserve ownership and physical evidence.                                               |
| Photo edits, label settings/logos, vocabularies, themes and tag colors                                          | Local display/label rules and full backups; scoped backups retain their documented subset.                                      |
| Job diagnostics                                                                                                 | Bounded financial failure evidence exported only on request; no HTML, descriptions/photos or session data in reports.           |
| Mode/language/filter/copy choices and Activity read state                                                       | Browser preferences, outside library backups; panel minimization is tab-session state.                                          |
| Supported source pages / remote photos                                                                          | Normal requests reach 1688 using the signed-in browser; public photo requests reach Alibaba CDN. No credential extraction.      |

Full backups include only cached photos reachable from retained orders/history/ownership/container revisions; scoped backups retain canonical originals needed for the scope. Identical images are losslessly deduplicated in compressed files. Deleting orders removes source/history/preparation and unused local originals after reference checks; shared photos and carton deletion history may remain. Restores validate atomically and preserve newer edits. Jobs are not restored. Uninstalling/clearing a profile can delete local data.

Detailed packing automation JSON is default-off. When enabled it includes full costs, charge reasons and IDs for the complete selected container revision, including frozen Se quedó, regardless of XLSX columns. Label/mark PDFs retain their existing companion summaries. User-copied clipboard contents and downloaded files are controlled subsequently by the operating system/user.

### Data Use Certification

Publisher confirmation in Dashboard is outstanding:

- [ ] Data is not sold to third parties.
- [ ] Data is used only for the order-library purpose.
- [ ] Data is not used for creditworthiness or lending.

## Privacy Policy

**Public policy URL:** not provided/published. Before submission, publish the practices above with effective date, publisher identity and contact. Match the Dashboard disclosure to local financial/website-content handling and 1688/CDN requests. Do not claim the extension stores no user data.

## Distribution

Visibility/regions are unselected. Repository rename, local implementation or Git push does not authorize store submission.

## Developer Info

**Publisher/contact email:** not supplied; do not infer legal identity from repository ownership.

**Support route:** not confirmed.

**Homepage candidate:** [j3w1/1688toPL](https://github.com/j3w1/1688toPL).

## Version History

| Version | Date       | Changes                                                                                                                                                                                                             | Status                                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 2.10.0  | 2026-10-22 | Orders smart carton reconciliation, purchase-calendar codes, container loading/seal/amendments, immutable three-sheet output and compatible shipment/report backups.                                                | Local implementation; unpublished. No store submission.                                                     |
| 2.9.0   | 2026-10-22 | 1688toPL branding; opt-in detailed JSON; reachable/canonical backup photos; compatible scoped restore/settings initialization; shared XLSX/PDF media; repeat-workbook warning; organized illustrated documentation. | Historical local handoff: 1,047 unit tests and all 538 Chromium tests passed. No store submission.          |
| 2.9.0   | 2026-10-22 | Integrated manual/JSON/store orders, physical cartons, inline capacity planning, Organize, photo tools, operational costs and two-sheet packing exports.                                                            | Historical repository integration; [PR #20](https://github.com/j3w1/1688toPL/pull/20). No store submission. |

Earlier release and verification chronology remains in Git history. It is not current-candidate acceptance.

## Review Notes

### SEAL 2.10.0 local verification — 2026-10-23

The local candidate was checked with native Node.js 24 on Linux using synthetic fixtures and temporary browser profiles. These results cover the Orders/container implementation; they do not establish owner workflow acceptance or store readiness. The complete verification, **npm run verify run as 4 serialized CI shards**, belongs to commit `8de6633adc03f5089c3157d53c9f2f3eaf7c516f`, tree `e64a3cf59a24f6b061e62d7fbf790791feff47e6`; the four browser parts use the same frozen commit and build, with `CI=1`, trace off, full Chromium and no headless-shell browser. This follow-up changes only this verification record and the browser CI job budget from 15 to 25 minutes so dependency setup does not cancel a passing shard. Application, tests, assets and all test/case budgets remain unchanged; hosted verification runs again on the exact follow-up head.

| Evidence                                  | Result                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source syntax and documentation           | Passed.                                                                                                                                                                                                                                                       |
| Unit regressions                          | Passed: 1,435 tests; zero failures, cancellations or skips.                                                                                                                                                                                                   |
| Production rebuild                        | Passed: complete extension 2.10.0; 30 manifest resources checked.                                                                                                                                                                                             |
| Complete Chromium suite                   | Passed: all 567 unique tests in four serialized CI shards (142 + 142 + 142 + 141); zero failures, skips, retries or flaky results.                                                                                                                            |
| Real synthetic operator paths             | Passed: China 1,350-unit/15-carton import; exact uneven 1688 report (63 pieces, 57.22 kg, 0.461256 m³); and 100/45 remainder reconciliation, each through loading and seal.                                                                                   |
| Migration, restore and immutable evidence | Passed automated synthetic checks, including actual pre-SEAL 2.9/464 full/monthly archives, original photo bytes, semantic quantities/value, held legacy evidence, ownership/witness dependencies and stale/forged-write refusal.                             |
| Physical marks and PDF generation         | Passed automated recorded/current mark, fresh relabel/keep, returned-carton recovery, historical reprint and stale-render/no-side-effect checks. PDF evidence is separate from physical printing.                                                             |
| Portable local trial                      | Passed tests and complete development build, then reported `no local trial target: nothing loaded`; loaded, staged and verified were all false. No installation or owner database was touched.                                                                |
| Synthetic screenshots                     | Passed generation of 13 repository images and two narrow captures. Changed images were viewed; the complete export-preview image was retained from its reviewed, byte-identical prior capture after a loading race in regeneration. No older UI was restored. |
| Installed extension / owner acceptance    | Not run: no local trial target is configured; the old owner install/database were deleted by owner order and were excluded.                                                                                                                                   |
| Native Excel                              | Not run. Actual XLSX, formula, media and clipboard assertions are automated evidence.                                                                                                                                                                         |
| Physical print / hardware scanner         | Not run.                                                                                                                                                                                                                                                      |

The extension key and durable `1688-order-library` database/backup compatibility identifiers remain unchanged. Fresh physical relabel confirmation inside a cancelable shipment amendment is refused; keep/history and proposed printing remain available. Complete the amendment or use unsealed cartons before recording actual relabeling. The SEAL remains open for owner workflow acceptance; no store submission is claimed.

### Historical 2.9.0 handoff verification

The renamed 2.9.0 handoff and its verification corrections were checked on 2026-10-22 using native Node.js 24 on Linux and synthetic data in temporary browser profiles. The export tests explicitly opt into detailed automation JSON while retaining workbook, cost and summary-content assertions. Narrow export controls remain clickable without forcing pointer actions.

| Evidence                               | Result                                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source syntax and documentation        | Passed.                                                                                                                                                                                                                                               |
| Unit regressions                       | Passed: 1,047 tests; zero failures or skips.                                                                                                                                                                                                          |
| Production rebuild                     | Passed: complete extension; 28 manifest resources checked.                                                                                                                                                                                            |
| Chromium                               | Passed: all 538 tests, serialized; zero failures or skips. The 23-test affected packet also passed.                                                                                                                                                   |
| Backup/restore                         | Passed synthetic browser checks: referenced original photos and history retained, unreferenced cache images omitted, a backup above 64 MiB restored/exported, compressed restore/corruption checks and scoped annotation/month equivalence preserved. |
| Installed extension / owner acceptance | Not run: no local trial target configured. No installed library was used for tests.                                                                                                                                                                   |
| Synthetic screenshot regeneration      | Not run for this verification batch; existing documentation images are synthetic.                                                                                                                                                                     |
| Native Excel                           | Not run for this candidate. Downloaded XLSX content checks are browser evidence.                                                                                                                                                                      |
| Physical print / hardware scanner      | Not run. Generated PDF checks do not establish physical acceptance.                                                                                                                                                                                   |

Earlier Chromium/Edge/native-Excel results apply only to their checked snapshots. These local results do not establish live 1688 compatibility, owner acceptance or store-publication readiness.

### Known limitations

- One buyer account per library; unsupported layouts, installments, unknown adjustments or unreconciled totals fail explicitly.
- Local naming is rule-based; unknown or ambiguous products/sizes/materials need review.
- Independent libraries do not coordinate code numbering. Current assignments and sealed code history reserve identities within each library.
- Capacity proposals require physical confirmation. Partial aggregate measurements remain unknown unless supported by actual evidence; missing measurements retain their coverage disclosure.
- Excel pictures float; other spreadsheet apps, custom row heights and native in-cell conversion require their own verification. Packing export creates a new XLSX.
- Unique originals still consume backup/storage memory. Uncached remote photos need a connection.
- Publisher details, live policy, rights-cleared/store-sized assets and Dashboard choices remain unfinished.

### Rejection history

No supplied or verified store review/rejection history. No submission package or publication is claimed.
