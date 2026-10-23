# Cartons: planning and physical packing

[Documentation](README.md) · [Packing](packing.md) · [Exports](exports.md)

## Plan with Pcs/box

Open **Orders → Cartons**, choose a purchase and use its single reconciliation table. Product calculations show purchased/available units, reported Pcs/box, proposed full cartons, unassigned pieces and actual packing references. The sticky summary keeps reported, confirmed and proposed carton counts distinct, with unresolved contents, count difference and kg/CBM coverage. Unknown is shown as unknown; negative differences remain discrepancies.

| Units / Pcs/box          | Proposal                                   |
| ------------------------ | ------------------------------------------ |
| 50 / 10                  | Five full cartons.                         |
| 40 / 30                  | One full carton and 10 unassigned pieces.  |
| 100 / 45                 | Two full cartons and 10 unassigned pieces. |
| Missing/invalid capacity | Unallocated quantity stays visible.        |

Safe capacity edits autosave independently. They never create physical cartons or change confirmed contents. Exact supplier rows outrank nominal capacity. Source quantities remain read-only. Each purchase retains its own capacity and physical ownership even when codes are shared.

## Record actual contents

The order table retains exact cartons, explicitly confirmed uniform sets and genuine aggregates without asking for an Exact/Batch mode. Every physical unit belongs to one purchase. Marks, supplier numbers and internal identities are distinct; repeated supplier #1 values across purchases never collide. Internal references are labelled.

**Separate box for these N** and **Place remainder in carton** obtain the current remainder from the planner. No quantity is retyped. Moving goods updates both destinations atomically. Mixed suggestions require explicit confirmation; piece sums do not prove physical fit. Unknown variant claims retain their candidate coverage and cannot be allocated again as free goods.

Changes to an arrangement use **Confirm order cartons** once for the order. An exceptional contents/measurement edit stays in this same draft and revision context. Failed validation/save retains raw cells and alignment, including invalid values, for recovery. Confirmed facts keep stable IDs; historically used corrections require container amendment.

Open a carton row to correct its literal supplier reference or choose an independent mark from that purchase's product codes. Closing this panel stages the change; it does not copy contents, weight or loading decisions into another carton. For confirmed sets, the entitlement picker exposes only retained physical units and supported facts. Drafts from an older amendment require explicit review before recovery, and a delayed save keeps its original amendment token.

Recovery also compares the order revision captured with the draft. If another tab has changed it, the saved facts stay visible and **Review recovered carton draft** retains the earlier raw values for comparison. Choose **Use these reviewed edits** to recover them under current validation, or **Keep saved version** to keep the current facts. Focusing a field or reopening the table does not erase that pending review.

## Purchase codes and size mapping

Purchase-code review can assign the original purchase-month product code while a variant's size mapping remains pending. Its barcode stays blank, and barcode copy/print asks for mapping first. Use **No size difference** or a manual size ending in the existing Orders editor; source quantities, prices and physical carton evidence stay separate.

## 1688 packing reports

**Paste or import carton list** augments the existing 1688 purchase. Paste table cells or choose a local XLSX/XLS workbook. The original text/bytes are retained locally before cancellable parsing. A compact review asks only for ambiguous worksheet/header/number/unit/basis/range/code meanings; known facts fill the preview automatically. China purchase-marker rules remain unchanged.

Unknown supplier codes map only to products in this order. Variant-unknown coverage can stay unresolved. Optional complete-set product totals need actual report/owner confirmation; matching purchased totals alone is insufficient. Formula caches must exist; macros/formulas/remote links never execute. Invalid selected facts cannot partly commit.

Re-import reviews added, changed, removed and unchanged evidence. Stable confident matches retain physical identity and manual facts. Uncertain matches/removals need explicit review. An unchanged report adds no cartons. Changes affecting sealed facts require amendment, preserving old evidence.

## Spreadsheet controls

A keyed rectangular paste matches codes only inside the selected purchase. Duplicate/ambiguous/foreign keys require review. A single-column capacity paste captures selected **visible** source keys in current order and previews each alignment. Changed filtering, sorting, scope or newer edits invalidate the preview; scrolling never changes identity. Derived totals are read-only.

Tab/Shift+Tab and Enter/Shift+Enter reveal the next logical editable cell, including offscreen rows. Fill acts on the captured selected range. One paste/fill/remainder operation is one Undo/Redo step. Raw invalid drafts, generations and history persist separately from physical facts. Parsing is local/cancellable, and stale results/acknowledgements cannot replace newer typing. The table mounts a bounded window while totals and selection retain full logical scope.

## Measurements and confirmations

Dimensions are complete positive Length / Width / Height in centimetres; paste `60×50×40` as one value. Dimension fill copies only dimensions. Equal sizes never imply equal weight. Weight and supplied volume retain their per-carton/combined bases; partial aggregate totals stay unknown. Reuse is explicit evidence, never a fresh supplier observation.

Volume from centimetres is `L × W × H ÷ 1,000,000`. Supplied CBM remains separate evidence; discrepancies are disclosed. Product size never becomes carton size. The six uneven synthetic cartons keep 13, 12, 11, 9, 9, 9 pieces; weights 16.75, 14.62, 10.40, 5.63, 5.18, 4.64 kg; and totals 63 pieces, 57.22 kg and 0.461256 m³. Display grouping never replaces those six records with an average.

Known explicit dimensions supply the measured volume used in totals. Reconciliation and seal review show a differing supplied whole-set volume and its original value/basis as retained evidence. Unit or basis ambiguity and quantity/ownership conflicts still require resolution.

Receipts and seller delivery remain independent. Container loading uses physical references and derives product quantities; it has no per-product loaded-quantity or capacity editor. A shared box counts/weighs once. Product participation differs from additive count attribution; mixed kg/CBM allocations are labelled allocated and conserve physical totals.

## Review and output

Loading starts Unconfirmed. Count selection is allowed only for proven interchangeability; different measured boxes need exact identities. Unknown loaded quantities block verified sealing. Missing kg/CBM alone may be disclosed when product quantities/counts are established. Full aggregate coverage may establish product totals without inventing per-box variants; a partial unresolved set cannot.

Source refresh preserves physical facts and flags targeted conflicts. Legacy uncertain/cross-order evidence stays review-held, retains original measurements and is not offered as confidently available. Capacity-only data never becomes physical inventory during migration. Source deletion/restore guards preserve historical references and tombstones.

Packing exports lock complete container membership and revision, independent of display filters or product selection. Default sheets are Packing list, Cartons and Se quedó. Historical output resolves snapshot media and source-line prices. Optional detailed JSON starts off and discloses all cost/reason/identifier data independently of workbook columns.
