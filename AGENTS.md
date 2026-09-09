# 1688toCSV agent instructions

Inspect the worktree, [README](README.md), extension manifest, and package scripts before editing.
Preserve unrelated work and keep order extraction/export behavior, calculations, permissions, and
release decisions inside an explicitly authorized change. Never commit credentials, private order
data, downloaded exports, or personal/provider configuration. Metadata work does not authorize an
extension build, package update, publication, store release, or production mutation.

## CE Metadata Reconciler integration

This repository is managed by the CE Metadata Reconciler. Nothing is installed here: the GitHub
App already reads this repository, and this section is the cooperation contract an agent working
in it needs to know.

**Protected CE label prefixes:** ce-systems, cross-repo, historical-evidence, type:, area:, concern:. Labels outside them are never touched.
Within them the reconciler is authoritative: a reviewed rule states an object's whole managed
label set, so a CE label added by hand and absent from that rule is drift, and the next sweep
removes it.

**Project membership** is written by the owner-authenticated Project bridge, over a reviewed
enumerated set of objects. The native *Item added to project* workflow is retired, so there is
exactly one writer. **Project Status** is *not* the reconciler's: GitHub's own native Project
workflows own it, and building a competing writer is ruled out rather than pending. The full
per-surface answer is
[`policy/surface-dispositions.yaml`](https://github.com/j3w1/ce-metadata-reconciler/blob/main/policy/surface-dispositions.yaml).

**You do not need to run the classifier.** Every sweep classifies uncovered objects automatically.
Classification is evidence and never authority: a new issue or pull request sits at
`NEEDS_REVIEW`, writing nothing, until protected policy covers it - a reviewed rule, an override,
or a recorded governance exclusion. See
[How an Object Becomes Governed](https://github.com/j3w1/ce-metadata-reconciler/blob/main/docs/operator-handbook/How-an-Object-Becomes-Governed.md).

The reconciler owns only metadata surfaces explicitly activated by protected policy and rollout
authority. Do not create competing label, dashboard, or Project automation. Its output never
grants source, task, review, merge, release, deployment, or production authority.

Report `HOLD`, `CONFLICT`, `NEEDS_REVIEW`, or policy/installation drift to
[`ce-metadata-reconciler#2`](https://github.com/j3w1/ce-metadata-reconciler/issues/2). Canonical
manual: [casaelida.com/docs/operations/metadata-reconciler](https://github.com/j3w1/casaelida.com/tree/main/docs/operations/metadata-reconciler).
Machine policy: [`ce-metadata-reconciler/policy`](https://github.com/j3w1/ce-metadata-reconciler/tree/main/policy).
