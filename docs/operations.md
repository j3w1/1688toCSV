# Store operations and costs

[Documentation](README.md) · [Packing](packing.md)

Small icons beside stores/products open **Operations workflow**. Product, Order and Store tabs record supplier services, delays, instructions, warehouse receipt, label issues and shipping-refund promises independently of preparation and the supplier's source delivery status.

## Record workflow and contacts

Store defaults cover label printing/application and explicitly agreed shipping-refund services. Orders track sending labels, carton marks and written requirements; **Ready** means those instructions were sent. Warehouse receipt is separate. Product exceptions override order defaults; returning to the default restores inheritance. Keep approximate seller promises as notes until a date is confirmed.

Inactive details stay collapsed. **Today / Yesterday / Clear** set dates only when clicked. Notes and known same-store feature names provide explicit fill shortcuts; a previous feature name does not provide its current cost. **Source payable / Source freight** fill actual-amount drafts only when available and chosen; zero remains zero. All workflow changes remain drafts until **Save workflow**.

Click a store name for order details, including **View all orders from this store** and editable spreadsheet store names. Names do not establish store identity. Optional **WeChat ID** is shared across the same known store/account, copied through its small icon and cleared by saving blank. Contacts stay local/in backups; the extension never contacts WeChat. Compact Save controls preserve other unsaved fields.

**Settings → Tags → Review operational tags** previews recognized wording and proposed fields. Select and confirm conversions explicitly. Original text is retained; descriptive tags, payment/code references and unresolved conflicts remain for manual handling. Tag text alone never creates payment links or shared products.

## Product features and additional charges

**Product features → Add feature** accepts names such as lighting, engraving or waterproofing and an exact yuan cost per piece:

- **Additional cost** adds the feature to effective unit price and packing value. A ¥10 product with a ¥1.20 feature becomes ¥11.20; ten pieces add ¥12.
- **Already recorded** retains the cost as information when the source price, linked payment or additional charges already includes it.

Source prices/payables remain unchanged. Older lighting/rotation flags retain their meaning without invented costs. Feature names stay as authored. Each purchase keeps its own costs even when sharing a barcode. Copy/export can include feature details and added amounts.

The small red order-card amount opens **Additional charges**, also always visible in order details. Enter a reason and amount, review affected products/costs and save. Allocation uses exact cents and preserves source invoice totals. Use this for external costs; use Linked payments for already recorded payments.

## Linked payments

In order details, **Linked payments** connects an existing payment order or fee row to the goods it funded. Search source cards from the same known store/account, choose the whole payment or a fee row, then all eligible goods or specified products. A same-order fee can work without known store identity. Whole-payment proposals start at the full recorded payable. Photos, amounts, reason shortcuts and before/after costs support explicit review before **Save reviewed links**.

Receiving products gain attributed costs without adding another payment or altering source totals. Same-order fees are removed from their source attribution before redistribution. Linked payment-only sources stay outside eligible goods and bulk labels/printing until unlinked; source money remains recorded once. A source with no positive amount or no other goods explains the missing scope; use another recorded source or Additional charges.

Duplicate/oversubscribed payments, cycles, cross-account references and unavailable goods are rejected atomically. Later source-money changes retain the reviewed allocation and flag it for review. Unlink before deleting one side; deleting the complete linked set is supported. Unlink restores only link-owned skips that have not since been edited. Packing exports retain attributed costs/reasons and scoped backups include required payment evidence.

## Repeat purchases

The chain control beside an assigned product opens **Link repeat purchase**. Choose its original group in the same known store/account/purchase month, check variants, sizes and features, then confirm. One new variant can link to a matching variant in an original multi-size group; other original variants keep their codes.

Linked purchases share matching codes while keeping separate source descriptions, prices, quantities and financial rows. Selected quantities combine for label printing. Unlink before changing shared identity/code/name/grouping or feature names/membership; cost-only and receipt/delay edits remain independent. Unlinking assigns the chosen purchase a free code. Unrelated products cannot take the shared code, and cross-month sharing is unsupported. [Carton eligibility](cartons.md#record-actual-contents) requires these explicit links for cross-purchase physical contents.

Product, supplier, code, label, photo and tag authoring belongs in Orders. Packing shows revision details read-only and offers Edit in Orders. Receipts, supplier delivery, readiness, reservations and shipment remain separate states. Only a committed positive loaded seal consumes a code lineage; new repeat links into that lineage are then frozen even after an amendment releases loading.
