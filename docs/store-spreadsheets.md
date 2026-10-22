# Store spreadsheets and import markers

[Documentation](README.md) · [Importing](importing.md)

## Prepare the workbook

Choose **Import spreadsheet** for a marked `.xlsx` or genuine Excel `.xls` workbook. A numeric filename such as `12345.xlsx` identifies a market store; a company-name filename identifies a factory. Windows copy suffixes preserve store identity. Confirm the purchase date and display name during review. You can edit the display name later without changing the underlying store identity.

Every successful import creates a separate purchase. When content appears to match an earlier import, a nonblocking warning asks you to review the date before continuing. It does not merge purchases or prevent a deliberate repeat order. Changing only the filename suffix or date does not make identical content a different match.

Use **Download template** beside Purchase date for a blank **Orders / Guide** workbook. It includes markers, 20 photo-ready rows, frozen headings, numeric formats and quantity/amount formulas. Save a completed copy under the store number or factory name, embed photos in each product's photo cell, recalculate/save in Excel or WPS, then select **Orders** when importing. Enter the supplier's invoice total independently of the calculated comparison. For a manually supplied total quantity, replace that row's quantity formula and leave Pcs/box blank.

To adapt a seller workbook, add one marker row above its headers. Read only the columns you mark; unmarked columns are ignored. Column order is flexible. Only `desc` may repeat. Leave `group` blank on notes, totals and unused product rows to skip them.

<a href="../screenshots/store-spreadsheet-import.png"><img src="../screenshots/store-spreadsheet-import.png" alt="Synthetic workbook import with review cards, template download and the tabbed format guide" width="800" /></a>

## Marker reference

Markers ignore case and surrounding whitespace. Use these exact English spellings; pinyin names and alternatives such as `variants` or `totalp` are not aliases.

| Marker                 | Required                | Meaning                                                                                               |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `pic`                  | Yes                     | Embedded product pictures; multiple pictures are retained.                                            |
| `desc`                 | No                      | Description fragment; repeat across columns to retain all useful text.                                |
| `boxes`                | Yes                     | Positive whole carton count for the source row.                                                       |
| `perbox`               | One of `perbox` / `qty` | Whole pieces per carton.                                                                              |
| `qty`                  | One of `perbox` / `qty` | Positive whole total pieces.                                                                          |
| `price`                | Yes                     | Nonnegative unit price in yuan.                                                                       |
| `amount`               | No                      | Source-row amount, checked against price × quantity.                                                  |
| `group`                | Yes                     | Source product-group identity; blank skips the row.                                                   |
| `var`                  | No                      | Explicit variant/size declaration.                                                                    |
| `kg`                   | No                      | Kilograms per carton.                                                                                 |
| `cbm`                  | No                      | Supplied cubic metres per carton.                                                                     |
| `cbmx`, `cbmy`, `cbmz` | No                      | Complete length, width and height in centimetres. Calculated volume takes priority over supplied CBM. |
| `total`                | Exactly two             | Surround the independent invoice amount in one row or column: `total` · amount · `total`.             |

When both capacity and total quantity are present, `boxes × perbox` must equal `qty`. With quantity alone, a capacity is derived only when division by boxes is an exact whole number. Ordinary unit text such as `6元`, `8RMB`, `20.5 K.G.` and `0.14 CBM` is accepted. Multiple numbers, calculations and dimensions stuffed into one numeric cell are ambiguous and rejected. Workbook decimals use a point; commas are thousands separators.

## Review before saving

The **Setup / Markers / Checks** sidebar supplies the same copyable guide available in **Settings → Data → Store spreadsheet guide**. It scrolls independently from review and stacks below it on narrow screens.

Review cards identify source cells, groups, photos and arithmetic. **Check all** acknowledges eligible review items only. It does not resolve quantity allocations, missing pictures, financial errors, an unconfirmed date or final photo/total confirmation. A complete validated order saves atomically; closing during parsing cancels the reader, while saving locks dismissal.

Financial and quantity mismatches block import. Formula cells need saved results without Excel errors; the importer never runs formulas or macros. Recalculate and save the workbook when those results are absent.

Every included row needs a readable linked picture. A picture whose anchor or merged `pic` cell covers several included rows can serve all covered groups after explicit shared-photo review. Blank groups stay skipped. Picture proximity or another row's group does not fill an uncovered row. Shared originals are retained once, while gallery associations remain separate.

## Variants and descriptions

Equal `group` values collect source rows even when not adjacent; they are not CE codes. A row marked `abcd` declares A/B/C/D sharing one source quantity, amount and carton record. Supply actual positive per-variant quantities during review, summing to the source quantity and preserving its rounded total. Do not divide equally by assumption or use picture count as a split. `abs`, `abm`, `abl` mean A/B in S/M/L; ambiguous nested or repeated assortments are refused.

The reviewed split does not duplicate source cartons. Printing only part of a shared carton record needs explicit carton-count review. Physical contents are recorded separately in [Cartons](cartons.md).

All marked `desc` text is joined with `·` and retained. Seller headers help recognize article/model IDs, Color, Size and Material. Leading zeroes in article codes remain. Clear measurements such as `25cm` or `8.5"` feed size recognition even without seller headers; complete comparable measurements receive size suggestions during preparation. Incompatible measurements stay for review and unitless values stay unitless. Older imports use these same retained descriptions without reimporting; saved codes change only through an explicit reset or correction review.

Spreadsheet orders use the same packing, labels, costs and backup features as 1688 orders. They retain their source descriptions and original photos, have no fabricated 1688 links, and are excluded from 1688 refresh. See [photo editing](settings-and-photos.md#product-photos) and the [developer contract](development.md#china-store-spreadsheets) for persistence and template details.
