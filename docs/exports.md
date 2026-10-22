# Copying and exports

[Documentation](README.md) · [Packing](packing.md) · [Printing](printing.md)

## Choose scope and format

Orders and Packing share **Copy…**, with **Excel image** directly beside it. Orders copies selected source rows, or all filtered rows when none are selected. Packing copies only selected groups/products within displayed orders and is disabled without selection. **Ctrl+A** includes offscreen products in that displayed packing scope. Back up packing has a separate whole-preparation scope.

The preview freezes the products selected when you opened it. Packing flushes valid pending edits first; later selection/filter changes do not replace its scope. Every copy control confirms success only after writing the clipboard. Failed image loads or validation leave the clipboard unchanged.

| Action                                    | Output                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Copy values                               | Five source columns: photo placeholder, description, price, quantity, discount. |
| Product photos / Copy images              | Separate floating pictures.                                                     |
| Excel cells / Copy to Excel               | Source columns with floating pictures.                                          |
| Chosen columns / Copy preparation columns | Selected packing/source fields in your chosen order.                            |
| Group codes                               | One base code per product group.                                                |
| Barcodes / Carton marks                   | Generated label pictures with physical dimensions.                              |
| Excel image                               | One table picture per preview batch.                                            |

**Headers** starts off and is remembered. Text-column choices/order are shared between views and survive reloads. They are separate from image columns and workbook export options. **Chosen columns** groups searchable fields under Codes & packing, Product details, Amounts, Order & supplier, and Tags & links. Use arrows in **Paste order** to arrange checked columns. New fields start unchecked.

**Size** is the saved packing size or original unprepared size/specification; **Size code** is only an assigned barcode ending. Measurements, units and leading zeroes stay intact. Product tags belong to their source product. Whole-order money repeated on product rows must not be summed as product subtotals. Source-value copying retains original text; translated display helpers are presentation only.

## Copy pictures in batches

Bulk photos, Excel cells, table images and labels use one preview dialog. Choose **Copy current batch**, paste into Excel, then return to the open popup. Previous/Next or numbered buttons change previews without copying; check marks identify completed batches. **Done / Close / Escape** ends the session. Retry appears in the popup after a failed preview or write.

Each image also has a small top-right copy button on hover or keyboard focus, always available on touch. It copies that prepared image at export quality and confirms success without marking the whole batch copied. Barcode/carton copies retain their physical dimensions. Clicking the rest of a source photo opens its viewer.

Photos paste as floating pictures. Standard-height Excel rows are the verified bulk-copy layout; custom heights, other spreadsheet apps and native in-cell conversion need separate checks. Individual source photos preserve their original pixels; bulk copies use smaller display sizes. Cached photos work offline; missing originals still require a connection.

<a href="../screenshots/copy-label-batches.png"><img src="../screenshots/copy-label-batches.png" alt="Synthetic carton-mark batch preview with copy and navigation controls" width="800" /></a>

## Excel table images

**Excel image columns** sits beside the preview and collapses on narrow screens. Check fields, drag or use arrows to reorder, and inspect the updated preview. Changes save automatically for both views. A column change starts new batches and clears copied markers. **Supplier details** adds blank dimension, kg and carton-number cells for your supplier; these start enabled.

**Image details** independently controls store/order identity, date, status, order tags, title, specifications, article number and product tags. Unavailable fields explain why. Resetting details preserves columns; hiding all store/order details retains purchase separators.

Headings and recognized categories/materials/attributes follow the popup's **EN / ES / 中文** choice. Source titles, unknown seller wording and saved label text stay intact. **Category & material** puts material in bold below category. Spreadsheet descriptions use larger, fuller wrapping; 1688 descriptions retain compact text. Photos fill square cells without stretching. Consecutive variants with the same carton mark share its actual image; it repeats at batch boundaries. Included CE carton marks need a Chinese category. Omitted photos/marks do not need loading.

The image uses the selected workspace theme's light palette, with saved light tag/status colors. Code badges retain the black/white design and product-number underline. Scroll to zoom, drag to inspect, or use **− / + / Fit image**; zoom never changes output dimensions. The copied picture remains resizable in Excel. Shaded store/order headings separate purchases without entering source data.

<a href="../screenshots/excel-image-columns.png"><img src="../screenshots/excel-image-columns.png" alt="Excel-image preview with column choices and ordering controls" width="800" /></a>

## Packing workbook

**Export packing list** opens a preview from the bottom packing toolbar. Choose **All packing products** or **Selected products**, columns/order, photo size, description width, store/order headings, totals, frozen headers and filters. Download includes every product in the chosen logical scope; All includes hidden display orders and offscreen groups. Preview shows the first five products. Choices persist across reloads; restoring default columns keeps scope and other layout choices.

The editable XLSX has two localized sheets with independent column choices:

- **Products:** 14 available fields, 13 defaults: Photo → Product code → Carton mark → Product → Details → Model → Size → Quantity → Pcs/box → Carton references → Price + fees → Discount → Subtotal. Source unit price is optional. Separate purchases sharing barcodes keep separate quantities, prices and cost rows. Order headings show store identity, selected purchase quantity, freight and goods amount once. Payment/deposit/balance columns are omitted.
- **Cartons:** one row per exact numbered carton or aggregate batch, with Batch, actual mark, full contents, carton/received/loaded counts, L/W/H, weight basis, weight, per-carton volume and total/loaded kg/m³. Product references link to these rows and differing actual marks; contents link back to source purchases. Each physical record counts once.

<a href="../screenshots/packing-export.png"><img src="../screenshots/packing-export.png" alt="Synthetic packing export preview with scope, worksheet columns and explicit optional detailed JSON" width="800" /></a>

Only fully covered batches contribute physical totals in Selected products exports. Intersecting partial batches retain full contents under **Shared context — excluded from totals**. Cartons are not attributed wholesale to an arbitrary purchase. [Capacity rules](cartons.md#review-and-output) preserve numeric evidence or Shared/Varies/Batch, without inferring uniform contents from divisibility. Unknown values stay blank, explicit zero stays numeric, and batch-total weight does not imply partial loaded weight.

Money and measurement units use native numeric formats. Formula inputs retain unrounded values; omitted/reordered dependencies use valid formulas or exact cached results. Full descriptions remain editable with bounded wrapping; 1688 Details uses left-aligned 10pt text and spreadsheet descriptions remain centered. Square photo rows, standard code artwork and carton marks use the selected theme's light palette. Small embedded photos do not replace originals in the library. Identical artwork is reused across worksheets while repeated cells remain visible.

### Detailed automation JSON

**Include detailed automation JSON** is unchecked initially and remembered with export preferences. Without it, Download Excel saves only the workbook. Enable it only when you want the companion machine-readable file.

Its scope is **the chosen products and related cartons**, and its fields include **full costs, additional/feature/linked-payment charge amounts and reasons, source identifiers and physical coverage**. Excel column selection does not redact this JSON. For example, a Product + Quantity workbook can still have detailed costs in the optional JSON. Review the [summary contract](automation.md#export-files) before sharing either file.

The browser download folder receives time-stamped files. Packing filenames use `packing-list-YYYY-MM-DD-HHMMSS-<seller>.xlsx` or a seller-count suffix; optional JSON shares the stem. Same-second repeats receive `-2` and so on. Writing into an existing open workbook is not implemented.
