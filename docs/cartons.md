# Cartons: planning and physical packing

[Documentation](README.md) · [Packing](packing.md) · [Exports](exports.md)

## Plan with Pcs/box

Enter **Pcs/box** beside Quantity in either Orders Products or Packing. Positive whole values autosave; blank is unknown. It remains editable after codes and physical cartons exist. A known value shows `/box` in English, `/ctn` in Spanish or `/箱` in Chinese; copying uses its number.

| Units / Pcs/box                                        | Calculated result                    |
| ------------------------------------------------------ | ------------------------------------ |
| 150 / 10                                               | 15 full cartons.                     |
| 105 / 10                                               | 10 full cartons plus 5 loose pieces. |
| 5 / 10                                                 | No full carton plus 5 loose pieces.  |
| Zero units                                             | Zero calculated cartons.             |
| Missing/invalid capacity or fractional source quantity | Unknown; review rather than round.   |

Each source row retains its own capacity, including purchases sharing a barcode. Leftovers across variants/groups are not pooled automatically. These calculations never create or resize physical cartons, change contents/confirmations or update received product pieces. A separate **Recorded cartons** readout shows actual saved count and Shared/Varies/Batch or review status, and opens its editor.

## Record actual contents

Before preparation, the compact carton panel stores defaults. Once prepared, choose **Cartons** beside a group for physical batches. This is needed for actual mixed/uneven packing, measurements or confirmations, not ordinary capacity planning.

- **Batch** records a carton mark, count and combined product contents without assuming an individual distribution.
- **Exact carton** records one numbered carton, with count fixed at one and its actual contents/measurements.

Choose source-photo/code entries and their actual quantities. Remaining-piece values prevent over-allocation. **Pack together**, **Separate variants** and **Use all remaining** fill a proposal; check it and choose **Apply carton contents**. A new number, mode, mark or membership also requires Apply. Failed saves retain the draft.

The **actual carton mark** is independent of its contents. A product with barcode group `1005` can be packed under mark `1001`; the mark's group may contribute no pieces. Carton marks use the group code, such as `CE26101001`; product labels retain endings such as S/M/L.

Contents may span groups from the same purchase, account, known store and packing month. Other purchases qualify only through explicitly linked repeat-product counterparts in that same scope. Matching printed codes alone are insufficient.

For example, S3/M30/L30 can occupy six exact cartons containing 13, 12, 11, 9, 9 and 9 pieces. Recording those cartons retains all 63 pieces and each carton's measurements; a combined count of six does not imply 10.5 pieces per carton. Likewise, 14 pieces across two cartons could mean 8 + 6.

## Measurements and confirmations

Enter complete **Length / Width / Height** in centimetres. Pasting `40 × 30 × 25` fills all three. Volume is calculated as `L × W × H ÷ 1,000,000` cubic metres; click an m³ readout to edit dimensions. Product-description dimensions never become carton dimensions. Legacy/imported decimal CBM remains read-only **Supplied volume** until complete dimensions supersede it.

Weight defaults to **Per carton**. Choose **Batch total** when the supplier gives one total. Partial received/loaded batch-total weight remains unknown; it is never prorated into confirmed weight. Dimensions retain precision and totals are calculated before display rounding.

**Reuse measurements** copies dimensions/weight from another batch at that store without copying counts or contents. Valid measurement changes on an unchanged saved allocation autosave. Partial/invalid dimensions remain drafts. Capacity/measurement defaults save independently of physical contents.

Received and loaded counts are independent packing-month confirmations: blank is unknown; zero confirms none. They neither follow 1688 delivery status nor alter received product pieces. Counts beyond planned packing receive a warning. A product's per-carton kg/m³ appears numerically only when it describes that product accurately; otherwise the workspace shows Shared or the batch count.

## Review and output

Mixed contents display **Shared**, uneven exact cartons **Varies**, and unspecified/contradictory aggregate capacity **Batch**. Complete identical single-product exact cartons can establish numeric capacity. An aggregate can retain an explicitly saved capacity only when its contents/counts agree and cover the full source quantity. Divisibility alone is insufficient; incomplete exact allocations stay blank. See [workbook scope](exports.md#packing-workbook) for physical totals and shared context.

Source refresh preserves authored batches and flags missing/reduced products or changed context for review. Historical carton defaults convert once on an older database upgrade, and older backups retain that conversion. New capacity-only defaults remain planning values. Legacy uncertain shared rows are marked for review and counted once.

You cannot delete an order referenced by active contents, group context or an independent carton mark until those cartons are explicitly resolved. Deletions retain tombstones so older files cannot recreate them. Scoped backups include only completely covered batches and their actual mark context. Separate container manifests within a packing month are not modeled.
