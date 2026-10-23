# Data, backups and restore

[Documentation](README.md) · [Developer data contract](data-model.md)

## Choose a backup

| Action                    | Includes                                                                                                                                                                                                                         | Use for                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Settings → Data → Back up | Complete retained source/history, annotations, preparation/checkpoints, current assignments, physical cartons, containers/revisions, report originals, drafts, code locks, referenced original photos and global settings/rules. | Moving computers, protecting the whole library.  |
| Orders → Back up packing  | Captured source/preparation selection, complete source/financial dependencies, scoped edits/checkpoints/ownership and relevant label/photo data.                                                                                 | Moving or continuing selected prepared products. |

Packing backup captures the Orders source/preparation scope before export. Review codes for unprepared products first. It keeps complete current source orders needed for money/source evidence, every local original referenced by those retained orders and relevant remote-photo cache entries. Removed scope entries and unrelated preparations are excluded. It omits unnecessary scrape history, unrelated orders/assets/allocations and global naming/size/color/material catalogs. Label settings/logo and assigned tag definitions support the scoped labels. A partial physical record is explicitly disclosed as omitted; use a full library backup to protect the complete operational history.

Both actions download lossless **`.json.gz`** archives. Restore accepts them directly and legacy plain **`.json`**; no manual unzip is needed. Library format v5 includes shipment/revision and report evidence; v1–4 remain supported. Keep the original file until you verify the restored library. Import reports and export summaries use different formats and cannot replace a backup.

Modern order-owned cartons do not need a shipment month to appear in a backup. Their complete order, physical facts, tombstones and required dependencies are retained. A partial product selection that would split this evidence requires a reviewed full-library backup; it cannot silently omit those cartons.

## Restore a library or packing scope

Use **Settings → Data** for full-library restore, or **Restore packing** in Orders for a scoped packing archive. Review the file's scope before restoring. Scoped restore returns to Orders without assigning new codes or silently changing container membership.

Restore decodes and validates the whole file before writing. Invalid references, duplicate manual supplier/reference pairs, conflicting current code ownership or contradictory same-time values reject atomically. A failed restore does not partially import the file. Libraries do not coordinate numbering; use one buyer account per library.

Changed source observations and newer-source restores retain authored inventory exclusions, explicit clears, supplier/date resolutions, code-identity reviews and their clocks/history. A source change that contradicts an authored exclusion or removes/reduces positively shipped goods rejects atomically. Review the named purchase or shipment before retrying; the retained library and unrelated operations remain usable.

Scoped restore preserves unrelated products, newer local edits, explicit clears and existing global settings. Its label settings can initialize an otherwise empty library **once**; later scoped files preserve those initialized settings even before you save Settings manually. A complete backup can supply global catalogs omitted by scoped files under the normal full-restore rules.

Compatible same-time monthly backups can complete missing disjoint preparation data. Restoring October then November from one preparation revision is allowed when their overlapping fields/checkpoints agree. Contradictions in shared data still reject; a revision change invalidates stale open drafts. Restore the full affected group/variant when a shared edit would otherwise change unselected products.

Saved preparation names/materials survive scoped restore, reload and reopening. Passive source refresh and unrelated settings retain them; editing naming rules explicitly updates automatic suggestions. Full restore retains its explicit naming recomputation while preserving authored fields. Ordinary inactive preparation checkpoints do not reserve codes, but historical shipment codes remain reserved. Older files cannot replace newer edits, revive cleared dispositions/supplier resolutions, or remove permanent first-consumption lineage locks.

## Physical cartons and dependencies

Scoped backups include a batch only when all its contents, month and actual carton-mark group are covered. A mark owner contributing zero pieces still needs that context. `omittedCartonBatchIds` reports intersecting batches excluded for incomplete contents or mark ownership. Full backups preserve independent mark context. Partial batches are rejected on restore.

Batch revisions, provenance and deletion tombstones merge independently of preparation time. Newer deletions prevent an older backup or refresh from recreating a removed carton. Historical default conversion preserves original supplier evidence and does not turn new planning-only capacity/measurement values into physical allocations.

Physical mark aliases and their keep-mark/relabel choices, reasons, attestations, original code namespaces and retirement/revival/supersession history travel with retained cartons. Current aliases use normal current code ownership; an independent mark can reference its exact original primary while that assignment remains current. Sealed references retain permanent history. If all related goods retire/cancel before any verified historical reference, an unused alias may be released. A free alias can revive. If another product or shipment now owns the released code, returning goods can be prepared with current/fresh purchase-month codes while the old alias stays superseded history, naming the actual conflicting owner/shipment and new identity. Reimporting never recreates deleted cartons.

Any retained or explicitly restored carton still carrying that superseded code requires fresh labels and actual physical relabel confirmation before sealing. Keeping that recorded mark is refused; old decisions and caller/backup claims cannot attest the physical act. A full restore corroborates supersession against actual current/historical ownership and retains known local supersession even when an older archive omits it. A newer restored record cannot discard existing physical-mark ownership, superseded artwork/decision history or actual prior carton history/source facts. Legacy backups without aliases keep their existing compatibility rules; restoring them never fabricates a physical relabel or removes sealed locks. Use a full library backup when recovery depends on another purchase's shipment evidence.

Original and last recorded mark text/category snapshots remain distinct from current-product text. A guarded logical keep-mark history restoration reuses existing server confirmation provenance only when the actual recorded code and known artwork still match. Relabel attestations are never replayed from a backup or Undo snapshot; missing evidence stays for review.

Recorded artwork may retain exact source-entry IDs for original photo/source association even after an independent zero-piece mark owner is retired. Choosing a new current mark owner stays within the same purchase and changes no physical contents or source snapshots. The alias remains reserved while its current contained/related goods remain; canceling only the old mark product does not release it.

Container reservations, effective revisions and immutable historical manifests restore together with their source/report dependencies and original photos. Restore cannot make a shipped physical entitlement available again or silently replace a newer shipment decision. Conflicting effective state rejects with a reviewable error before any write. Earlier manifests and Se quedó remain reproducible after later shipments and amendments.

Old loaded-count annotations do not become verified sealed containers during upgrade. Uncertain legacy loading and cross-order cartons remain visible for review, with their original measurements preserved and their affected stock held from confident availability. A reviewed correction retains the original evidence. New operational cartons always belong to one source purchase.

Payment links retain complete supporting source orders without adding their preparation to the opened scope. Shared repeat-code backups keep only selected ownership aliases; surviving local purchases keep their ownership. Capacity edits and clears retain source-entry scope instead of replacing newer edits elsewhere.

## Photos and file size

Archives store each identical embedded image once, keeping all original pixels and metadata. Full backup selects photos reachable from retained orders, history and other retained owners, rather than exporting orphan cache entries from deleted purchases. Scoped backup uses the same canonical image identity as loading/cache, so a thumbnail URL such as `photo.jpg_250x250.jpg` can include its already cached `photo.jpg` original. Owned photos/history remain preserved.

Compression changes file transport, not live database representation. Unique originals still consume space, export still reads a complete snapshot and restore still parses the compact decompressed archive. This does not make arbitrarily large libraries memory-free. No old photo is downsampled or silently re-encoded. Uncached remote photos require a connection; local originals have no remote fallback.

## Retention and privacy

Orders, source history, notes/tags, workflow/cost links, photos, preparations, code ownership and settings stay in your browser. Import/refresh navigates 1688 using the existing signed-in session; product photos may be fetched from Alibaba CDN. No analytics, online translation, developer uploads, payment processing or supplier messaging are used.

Deleting an unused order removes its history/preparation and releases unused assignments. Active carton contents/group/independent-mark references must be resolved first; linked financial records require unlinking unless removed as a complete linked set. Active or historical container references block source deletion. Photos required by historical manifests remain retained even after current product photo edits. Carton deletion tombstones remain to protect restore.

Browser preferences are separate from backups: active mode/language, purchase-month filters, Headers, copy/image/workbook options and Activity read state. Theme palettes, badge/tag colors and local vocabularies belong to backed-up library settings. Import jobs are not restored. Uninstalling, changing extension ID or clearing a profile can remove local data; keep full backups before those operations.

The extension/repository is named **1688toPL**. Persistent database/backup identifiers such as `1688-order-library` remain unchanged for compatibility; old files do not need renaming.
