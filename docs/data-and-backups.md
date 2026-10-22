# Data, backups and restore

[Documentation](README.md) · [Developer data contract](data-model.md)

## Choose a backup

| Action                            | Includes                                                                                                                                                                           | Use for                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Settings → Data → Back up         | Complete retained orders/history, annotations, preparation/checkpoints, current assignments, physical cartons, local originals/referenced cached photos and global settings/rules. | Moving computers, protecting the whole library. |
| Packing → Copy… → Back up packing | Whole open preparation across display filters, its current source/financial dependencies, scoped edits/checkpoints/ownership and relevant label/photo data.                        | Moving or continuing one packing scope.         |

Packing backup ignores export selection but excludes removed scope entries and unrelated preparation. It keeps complete current source orders needed for money/source evidence, every local original referenced by those retained orders and relevant remote-photo cache entries. It omits unnecessary scrape history, unrelated orders/assets/allocations and global naming/size/color/material catalogs. Label settings/logo and assigned tag definitions support the scoped labels.

Both actions download lossless **`.json.gz`** archives. Restore accepts them directly and legacy plain **`.json`**; no manual unzip is needed. Library format v4 includes physical cartons; v1–3 remain supported. Keep the original file until you verify the restored library. Import reports and export summaries use different formats and cannot replace a backup.

## Restore a library or packing scope

Use **Settings → Data** for full-library restore. In Orders, the upload icon beside Prepare is **Restore packing**. It is unavailable while an active preparation is open. Review the file's scope, then restore; packing restore opens saved groups without assigning new codes.

Restore decodes and validates the whole file before writing. Invalid references, duplicate manual supplier/reference pairs, conflicting current code ownership or contradictory same-time values reject atomically. A failed restore does not partially import the file. Libraries do not coordinate numbering; use one buyer account per library.

Scoped restore preserves unrelated products, newer local edits, explicit clears and existing global settings. Its label settings can initialize an otherwise empty library **once**; later scoped files preserve those initialized settings even before you save Settings manually. A complete backup can supply global catalogs omitted by scoped files under the normal full-restore rules.

Compatible same-time monthly backups can complete missing disjoint preparation data. Restoring October then November from one preparation revision is allowed when their overlapping fields/checkpoints agree. Contradictions in shared data still reject; a revision change invalidates stale open drafts. Restore the full affected group/variant when a shared edit would otherwise change unselected products.

Saved preparation names/materials survive scoped restore, reload and reopening. Passive source refresh and unrelated settings retain them; editing naming rules explicitly updates automatic suggestions. Full restore retains its explicit naming recomputation while preserving authored fields. Older files cannot revive inactive reservations or replace newer edits.

## Physical cartons and dependencies

Scoped backups include a batch only when all its contents, month and actual carton-mark group are covered. A mark owner contributing zero pieces still needs that context. `omittedCartonBatchIds` reports intersecting batches excluded for incomplete contents or mark ownership. Full backups preserve independent mark context. Partial batches are rejected on restore.

Batch revisions, provenance and deletion tombstones merge independently of preparation time. Newer deletions prevent an older backup or refresh from recreating a removed carton. Historical default conversion preserves original supplier evidence and does not turn new planning-only capacity/measurement values into physical allocations.

Payment links retain complete supporting source orders without adding their preparation to the opened scope. Shared repeat-code backups keep only selected ownership aliases; surviving local purchases keep their ownership. Capacity edits and clears retain source-entry scope instead of replacing newer edits elsewhere.

## Photos and file size

Archives store each identical embedded image once, keeping all original pixels and metadata. Full backup selects photos reachable from retained orders, history and other retained owners, rather than exporting orphan cache entries from deleted purchases. Scoped backup uses the same canonical image identity as loading/cache, so a thumbnail URL such as `photo.jpg_250x250.jpg` can include its already cached `photo.jpg` original. Owned photos/history remain preserved.

Compression changes file transport, not live database representation. Unique originals still consume space, export still reads a complete snapshot and restore still parses the compact decompressed archive. This does not make arbitrarily large libraries memory-free. No old photo is downsampled or silently re-encoded. Uncached remote photos require a connection; local originals have no remote fallback.

## Retention and privacy

Orders, source history, notes/tags, workflow/cost links, photos, preparations, code ownership and settings stay in your browser. Import/refresh navigates 1688 using the existing signed-in session; product photos may be fetched from Alibaba CDN. No analytics, online translation, developer uploads, payment processing or supplier messaging are used.

Deleting an order also removes its history/preparation and releases unused assignments. Active carton contents/group/independent-mark references must be resolved first; linked financial records require unlinking unless removed as a complete linked set. Photos owned elsewhere remain. Carton deletion tombstones remain to protect restore.

Browser preferences are separate from backups: active mode/language, purchase-month filters, Headers, copy/image/workbook options and Activity read state. Theme palettes, badge/tag colors and local vocabularies belong to backed-up library settings. Import jobs are not restored. Uninstalling, changing extension ID or clearing a profile can remove local data; keep full backups before those operations.

The extension/repository is named **1688toPL**. Persistent database/backup identifiers such as `1688-order-library` remain unchanged for compatibility; old files do not need renaming.
