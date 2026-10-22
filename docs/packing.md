# Packing lists and codes

[Documentation](README.md) · [Cartons](cartons.md) · [Exports](exports.md)

## Assign products

Orders owns product/code/label preparation. Select source products with their checkboxes and choose **Review purchase-month codes**. The review shows proposed identities; **Assign purchase codes** commits them atomically. Cancel reserves nothing. New `CEYYMMGGII` codes use the original purchase calendar month, regardless of import, assignment or container date. Resolve missing/ambiguous purchase dates before assignment. Seller identity must be known.

Existing issued codes remain stable. A repeat link may reuse an eligible unconsumed identity from the same identified account/store with matching variants. Source prices, quantities, purchase references and physical carton IDs remain separate. A positive sealed loading freezes the consumed lineage against new links and unrelated code reuse, including after amendments. Selecting/reserving an order or a zero-loaded seal does not consume it.

There is no product-selected Prepare action or shipment-month code input. Leaving goods out of a container never removes them from Backlog. Only reviewed non-goods/fee/payment/canceled dispositions affect eligible stock; linked-payment evidence remains separate from source money.

## Edit and review

Click a product for source details; checkboxes select. **Edit product** opens contextual Orders fields for Spanish name, Chinese category, material and base/variant/size codes. Source descriptions, purchase quantities/prices and discounts remain read-only evidence. Photos, tags, supplier workflow, WeChat and financial additions are edited in Orders.

The existing label editor retains preview validation, physical label settings and exact copying. Variant letters and size endings remain separate. Invalid/conflicting values keep the draft, revoke invalid preview output and require correction. **Resolve code conflict** reviews all affected final codes and saves them together after revision/ownership checks; failed corrections save neither order. Manual blanks remain intentional.

Valid authoring edits autosave; later typing survives an earlier acknowledgement. Pending edits flush before navigation/output. Failed raw authoring drafts remain recoverable in this browser with their source revision. Undo/Redo is scoped to the current Orders session; carton-grid history additionally survives draft recovery. Another tab's changes require revision review rather than silent replacement.

## Organize and group

**Grouping tools** belongs to Orders. It can share a barcode within a group, separate original source rows, move variants into a product group or merge eligible complete groups in one order. Review preserves individual financial/source rows and all physical evidence; guarded storage rejects incompatible or historically sealed changes. Repeat links use their own reviewed eligibility checks.

Packing has no Organize, manifest drag order, product removal, capacity/code/photo/tag editor or grouping shortcut. Output uses stable source/prepared-code order. View filters and selection are display state, never shipment membership.

## Containers and loading

Packing contains named container history and **Loading / Packing list / Se quedó**. Include whole orders from current Backlog. Previously shipped orders contribute only their eligible remainder. Inclusion reserves current evidence without loading any box; later purchases/cartons require **Review availability changes** and explicit apply.

Loading uses actual stable carton references and Unconfirmed / Loaded / Left behind decisions. **Mark all loaded** covers the full included logical scope, including offscreen/filtered rows. A count shortcut appears only when the authoritative projection permits interchangeable boxes. Uneven contents or different measured boxes require their identities. Product loads derive from these decisions: loading A20+B72 loads 92 pieces across both products.

Review & seal checks complete decisions, revisions, known loaded quantities and exclusivity. Missing kg/CBM is disclosed; unknown loaded product quantities or contradictions cannot verified-seal. Complete aggregate product coverage may support full loading without inventing per-box variants. Numerical equality alone does not establish coverage.

Se quedó freezes remaining goods from this container's included orders at the selected revision. Global Backlog also includes untouched and new purchases. **Amend sealed container** keeps the previous effective revision active until reviewed atomic apply; Cancel changes no shipment. Historical names, prices, codes, photos and Se quedó remain reproducible.

## Code ownership and conflicts

`CEYYMMGGII` contains purchase year/month, monthly seller group and product number. Shared identities retain separate source rows. Display underlines only product-number digits; copied strings remain literal. Current assignments and consumed historical lineage are validated at commit. Checkpoints do not reserve retired unconsumed assignments, and historical consumed codes cannot be recycled for unrelated goods.

Packing details and photos are read-only. **Edit in Orders** retains the exact container/revision return target. Returning does not silently add new cartons or rewrite a sealed manifest; relevant facts need reviewed revalidation or amendment.
