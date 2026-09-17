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

**You do not need to run the classifier, and it is no longer only evidence.** Every sweep
classifies uncovered objects automatically, and since [ADR 0038](https://github.com/j3w1/ce-metadata-reconciler/blob/main/docs/adr/0038-reviewed-classification-rules-as-label-authority.md)
a complete, canonical, unambiguous classification derived from reviewed rules *is* label
authority in all six managed repositories: it becomes the object's exact managed label set where
no explicit reviewed rule already covers it. An earlier version of this section said
classification is evidence and never authority. That was true when it was written and is false
now, which is the single most important correction here.

What has not changed is the half that fails closed. An object whose evidence is incomplete or
conflicting, or that does not decide a single `type:` and a single `area:`, sits at
`NEEDS_REVIEW` writing nothing until somebody reviews it - and since
[ADR 0039](https://github.com/j3w1/ce-metadata-reconciler/blob/main/docs/adr/0039-semantic-pr-evidence.md)
a pull request is classified from the files it changed rather than the shape of its title, with
structure outranking wording and a `CE-####` prefix implying neither a type nor an area. A
reviewed answer becomes a reusable rule rather than a one-off, so the next object of that shape
is decided too. See
[How an Object Becomes Governed](https://github.com/j3w1/ce-metadata-reconciler/blob/main/docs/operator-handbook/How-an-Object-Becomes-Governed.md).

The reconciler owns only metadata surfaces explicitly activated by protected policy and rollout
authority. Do not create competing label, dashboard, or Project automation. Its output never
grants source, task, review, merge, release, deployment, or production authority.

**This repository's own profile is reviewed policy, not a claim made here.** Its role is
`procurement-adjacent`, its membership writer is `OWNER_AUTHENTICATED_BRIDGE`, and the label prefixes above are
what protected policy currently allows it. Read them from
[`policy/repositories.yaml`](https://github.com/j3w1/ce-metadata-reconciler/blob/main/policy/repositories.yaml)
rather than from this file, and verify the current surface grant and proven writer before any
operation - a grant names exact repositories and, at a canary ring, exact objects, so being in
the allowlist is not the same as being covered by a live grant.

Report `HOLD`, `CONFLICT`, `NEEDS_REVIEW`, or policy/installation drift to
[`ce-metadata-reconciler#7`](https://github.com/j3w1/ce-metadata-reconciler/issues/7), the
operational dashboard. Earlier versions of this contract pointed at `#2`, which is now closed.
Canonical manual: [casaelida.com/docs/operations/metadata-reconciler](https://github.com/j3w1/casaelida.com/tree/main/docs/operations/metadata-reconciler).
Machine policy: [`ce-metadata-reconciler/policy`](https://github.com/j3w1/ce-metadata-reconciler/tree/main/policy).
