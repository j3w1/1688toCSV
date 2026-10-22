# Chrome Web Store Listing — 1688toPL

Last updated: 2026-10-23. **Local candidate, version 2.9.0; unpublished.** This file is the store metadata source of truth, not authorization to submit or release. Current verification is tracked below; historical test counts do not establish acceptance of this candidate.

## Store Listing

**Extension name:** 1688toPL, matching the production manifest.

**Short description:** Keep local 1688 and store spreadsheet orders, prepare packing lists, and copy product data and pictures to Excel.

**Detailed description — draft:**

```text
Turn 1688 purchases and supplier spreadsheets into packing lists, barcode labels and carton marks.

Import selected 1688 orders or a marked supplier workbook. Add purchases from other sources manually or from JSON. Keep original product descriptions, quantities, prices and photos together in a local order library.

Prepare products with CE codes, Spanish names and Chinese categories using editable local rules. Review size and material suggestions, arrange packing groups and record actual carton contents, dimensions, weight and receipt/loading counts. Repeat purchases can share reviewed product codes while retaining separate purchase values.

Copy values, photos, selected columns or table pictures into Excel. Download an editable packing workbook with Products and Cartons sheets. Optional detailed automation JSON contains costs, charge reasons and source identifiers independently of workbook column choices. Print barcode labels and carton marks as offline PDFs.

Open your 1688 order list, select purchases and choose Import selected. In the workspace, select products, set Packing month and choose Prepare packing list. Review codes, copy/export your packing list, then save a backup. Supplier workbook import includes a template and cell-level review; a matching-content warning helps identify accidental repeat imports without blocking deliberate new purchases.

Orders, source history, photos, notes and settings stay in your browser. Back up the whole library or an open packing scope to a lossless local file. Importing uses your existing 1688 session; uncached product pictures may load from Alibaba CDN. No analytics, online translation or developer-operated order upload is used.

Use one buyer account per library. Unsupported page layouts or inconsistent totals fail without replacing the last good saved order. Review suggestions and physical carton counts before relying on labels. Keep a full backup before clearing your browser profile or uninstalling.
```

**Category:** Shopping, proposed; confirm in Dashboard.

**Single purpose:** Prepare locally stored purchase orders, product codes and packing labels for Excel and printing.

**Primary language:** English, with Chinese/Spanish interface choices and preserved source text.

## Graphics & Assets

| Asset                  | Required dimensions     | Status / source                                                                                                                                                                                |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Icon                   | 128 × 128 PNG           | [Present](icons/icon128.png); rights/store suitability not established.                                                                                                                        |
| Screenshot             | 1280 × 800 or 640 × 400 | [Orders](screenshots/order-library.png), [dark Orders](screenshots/order-library-dark.png), [packing](screenshots/preparation.png); synthetic documentation images, store composition pending. |
| Additional screenshots | Same store sizes        | [Spreadsheet import](screenshots/store-spreadsheet-import.png), [label editor](screenshots/label-editor.png), [Settings](screenshots/settings.png).                                            |
| Small promo tile       | 440 × 280               | Not created.                                                                                                                                                                                   |
| Optional marquee       | 1400 × 560              | Not created.                                                                                                                                                                                   |

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

Full backups include only cached photos reachable from retained orders/history/ownership; scoped backups retain canonical originals needed for the scope. Identical images are losslessly deduplicated in compressed files. Deleting orders removes source/history/preparation and unused local originals after reference checks; shared photos and carton deletion history may remain. Restores validate atomically and preserve newer edits. Jobs are not restored. Uninstalling/clearing a profile can delete local data.

Detailed packing automation JSON is default-off. When enabled it includes full costs, charge reasons and IDs for chosen products/related cartons regardless of XLSX columns. Label/mark PDFs retain their existing companion summaries. User-copied clipboard contents and downloaded files are controlled subsequently by the operating system/user.

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
| 2.9.0   | 2026-10-23 | 1688toPL branding; opt-in detailed JSON; reachable/canonical backup photos; compatible scoped restore/settings initialization; shared XLSX/PDF media; repeat-workbook warning; organized illustrated documentation. | Local candidate; current validation pending. No store submission.                                           |
| 2.9.0   | 2026-10-22 | Integrated manual/JSON/store orders, physical cartons, inline capacity planning, Organize, photo tools, operational costs and two-sheet packing exports.                                                            | Historical repository integration; [PR #20](https://github.com/j3w1/1688toPL/pull/20). No store submission. |

Earlier release and verification chronology remains in Git history. It is not current-candidate acceptance.

## Review Notes

### Development verification

The 2026-10-23 local candidate requires final source/docs, focused regressions, build, synthetic screenshot and supported installed-load results. Record passed, failed, blocked and not-run checks separately at delivery. Previous synthetic Chromium/Edge/native-Excel checks apply only to the snapshots they tested; they do not establish live 1688 compatibility or current installed acceptance. Current physical printing and hardware scanner acceptance are not established.

### Known limitations

- One buyer account per library; unsupported layouts, installments, unknown adjustments or unreconciled totals fail explicitly.
- Local naming is rule-based; unknown or ambiguous products/sizes/materials need review.
- Independent libraries do not coordinate code numbering; only current assignments reserve codes.
- Capacity planning does not establish actual carton contents; partial batch-total weight is not prorated. Container manifests within one month are outside the model.
- Excel pictures float; other spreadsheet apps, custom row heights and native in-cell conversion require their own verification. Packing export creates a new XLSX.
- Unique originals still consume backup/storage memory. Uncached remote photos need a connection.
- Publisher details, live policy, rights-cleared/store-sized assets and Dashboard choices remain unfinished.

### Rejection history

No supplied or verified store review/rejection history. No submission package or publication is claimed.
