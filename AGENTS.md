# 1688toCSV agent instructions

Inspect the worktree, [README](README.md), extension manifest, and package scripts before editing.
Preserve unrelated work and keep order extraction/export behavior, calculations, permissions, and
release decisions inside an explicitly authorized change. Never commit credentials, private order
data, downloaded exports, or personal/provider configuration. Metadata work does not authorize an
extension build, package update, publication, store release, or production mutation.

## CE Metadata Reconciler integration

This active-managed repository uses profile `procurement-adjacent`; protected CE label prefixes
are `ce-systems`, `cross-repo`, `historical-evidence`, `type:`, `area:`, and `concern:`. Project
membership is currently `MANUAL_OWNER`; the protected post-cutover target is
`OWNER_AUTHENTICATED_BRIDGE`. Follow the
[canonical manual](https://github.com/j3w1/casaelida.com/tree/main/docs/operations/metadata-reconciler)
and [machine policy](https://github.com/j3w1/ce-metadata-reconciler/tree/main/policy); report
`HOLD`, `CONFLICT`, `NEEDS_REVIEW`, or policy/installation drift to
[`ce-metadata-reconciler#2`](https://github.com/j3w1/ce-metadata-reconciler/issues/2).

CE Metadata Reconciler owns only metadata surfaces explicitly activated by protected policy and
rollout authority. Do not create competing label, dashboard, or Project automation. Its output
never grants source, task, review, merge, release, deployment, or production authority.
