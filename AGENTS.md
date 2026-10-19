# 1688toCSV agent instructions

Inspect the worktree, [README](README.md), extension manifest, and package scripts before editing.
Preserve unrelated work and keep order extraction/export behavior, calculations, permissions, and
release decisions inside an explicitly authorized change. Never commit credentials, private order
data, downloaded exports, or personal/provider configuration. Metadata work does not authorize an
extension build, package update, publication, store release, or production mutation.

## Delivery: local first

Standing owner rule (2026-10-19, issue #10). It overrides older wording that asked for full
verification after every edit.

- **"Implement X"** means: build it on a local integration branch, run the fast loop below, and load
  it into the owner's installed extension in CE Dev Browser for the owner to try. No push, pull
  request, hosted CI, remote merge, store publication or deploy. Accepted changes accumulate as
  local commits.
- **"Deploy it"** (or the owner's equivalent words) means: publish exactly the owner-accepted local
  changes as one pull request, run `npm run verify`, get hosted CI green, merge to main, then
  refresh the installed extension from main and confirm the library counts.
- Yolo or any standing authorization covers delegable decisions only. It never replaces the owner's
  deploy word, and the owner's local acceptance happens in the coordinator's own tab.

## Development workflow

**Fast local loop.** `npm run try` runs the unit tests, makes a development build, stages the
complete `dist` into the installed extension, reloads it through the CE Dev Browser MCP server, and
then checks read-only that every library store count is unchanged. It reopens the workspace tab
that the reload closed. `--quick` skips the unit tests (a few seconds), `--smoke` adds the browser
smoke subset, `--dry-run` only builds, and `--rollback` restores the previously staged build. It
refuses when the extension is not registered from the configured folder, an import is running,
the manifest name or key would change the extension id, or the counts change. Machine settings
live outside the repository in `~/.config/1688tocsv/try.json`: `installDir` (the registered `dist`
folder), `extensionId`, `browserMcp` (the CE Dev Browser MCP server command) and `stagingDir` (same
filesystem as `installDir`). Never commit them. Do not add watch mode or leave rebuilding to the user.

**Visual checks.** Owner rule (2026-10-19): "let the implementation agents or coordinator visually
test using ce browser only if needed". Check changes with the fast tests and the automated Chromium
tests first. Open the shared CE Dev Browser for a visual check only when nothing else can judge it,
and keep it brief. Loading a ready build with `npm run try` for the owner to try stays part of the
loop: load once per ready batch, not after every edit.

**The owner's library.** The installed extension holds the owner's real orders. Always reload that
same install so its id and storage stay. Never reset, re-import or restore it for testing. If the id
ever has to change, first take a backup with the extension's own Backup, restore it into the new
install and verify the counts before abandoning the old one. Automated tests use synthetic
fixtures and temporary profiles only.

**Full verification** (`npm run verify`) runs once on the final candidate at deploy, and locally when
a change touches the build, test or CI setup. It checks source and documentation, runs regression
tests, rebuilds the complete extension in `dist`, and tests that build in Chromium. Load the
generated `dist` folder as the unpacked extension; the root manifest remains source.

For UI changes, run `npm run screenshots` to regenerate the README screenshots from synthetic data,
then run `npm run check:docs`, before deploy. Use `npm run preview` when inspecting the page download
control locally. Keep fixtures and screenshots synthetic; never commit real orders, downloaded
exports, credentials, or unsanitized page captures. Preserve documented calculation limitations
unless their correction is explicitly within scope.

Automated Chromium tests use a temporary profile, a test copy of the manifest with localhost access
and test-only permissions for download inspection and script reinjection. They exercise actual
extraction and one-click page downloads against synthetic content. Do not claim this proves live
1688 compatibility.

When browser policy prevents live-site access, have the user perform the reload, refresh, and
download step and inspect the supplied CSV or error. Report builds, regression tests, automated
browser tests, and live-site acceptance separately, identifying passed, failed, blocked, and
not-run checks. A preview or ready state alone does not verify a completed download.

Documentation-only changes use `npm run check:docs`; code and mixed changes use the fast loop while
iterating and full verification at deploy. Keep GitHub CI routing and its stable `required` check
aligned with this process. CI routing is independent of the CE Meta label and Project authority
described below. Local commits are fine; push, pull requests, merge and release follow the
local-first rule above.

## CE Meta integration

This repository is managed by the CE Meta. Nothing is installed here: the GitHub
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
[`policy/surface-dispositions.yaml`](https://github.com/j3w1/ce-meta/blob/main/policy/surface-dispositions.yaml).

**You do not need to run the classifier, and it is no longer only evidence.** Every sweep
classifies uncovered objects automatically, and since [ADR 0038](https://github.com/j3w1/ce-meta/blob/main/docs/adr/0038-reviewed-classification-rules-as-label-authority.md)
a complete, canonical, unambiguous classification derived from reviewed rules *is* label
authority in all six managed repositories: it becomes the object's exact managed label set where
no explicit reviewed rule already covers it. An earlier version of this section said
classification is evidence and never authority. That was true when it was written and is false
now, which is the single most important correction here.

What has not changed is the half that fails closed. An object whose evidence does not decide a
single `type:` and a single `area:` sits at `NEEDS_REVIEW` writing nothing until somebody reviews
it. An incomplete changed-file list is a narrower case than it sounds: it fails a *universal* fact
closed - "every path here is documentation" cannot be established from a truncated list - but an
*existential* one can still hold, so a truncated list does not by itself withhold.

Since [ADR 0039](https://github.com/j3w1/ce-meta/blob/main/docs/adr/0039-semantic-pr-evidence.md)
a pull request is classified from the files it changed **as well as** its title, and those are two
evidence classes with a precedence between them rather than one replacing the other: where they
disagree in an exclusive namespace structure wins and the title rule's whole contribution is set
aside, and where they agree they merge - so a title rule can still supply an `area:` that structure
is silent about, which is how the cooperation-contract pull requests took `area:metadata`. Within a
class there is no principled winner, so two conflicting title rules and two conflicting structural
rules both fail closed. A `CE-####` prefix implies neither a type nor an area. A reviewed answer
becomes a reusable rule rather than a one-off, so the next object of that shape is decided too. See
[How an Object Becomes Governed](https://github.com/j3w1/ce-meta/blob/main/docs/operator-handbook/How-an-Object-Becomes-Governed.md).

An earlier version of this section said a pull request is classified from its changed files
*rather than* its title, and that incomplete evidence withholds. Independent review of
`casaelida.com#118` found both overstated, against ADR 0039 and against
`test_existential_structure_still_decides_on_a_truncated_list`. The wording above is the correction.

The reconciler owns only metadata surfaces explicitly activated by protected policy and rollout
authority. Do not create competing label, dashboard, or Project automation. Its output never
grants source, task, review, merge, release, deployment, or production authority.

**This repository's own profile is reviewed policy, not a claim made here.** Its role is
`procurement-adjacent`, its membership writer is `OWNER_AUTHENTICATED_BRIDGE`, and the label prefixes above are
what protected policy currently allows it. Read them from
[`policy/repositories.yaml`](https://github.com/j3w1/ce-meta/blob/main/policy/repositories.yaml)
rather than from this file, and verify the current surface grant and proven writer before any
operation - a grant names exact repositories and, at a canary ring, exact objects, so being in
the allowlist is not the same as being covered by a live grant.

Report `HOLD`, `CONFLICT`, `NEEDS_REVIEW`, or policy/installation drift to
[`ce-meta#7`](https://github.com/j3w1/ce-meta/issues/7), the
operational dashboard. Earlier versions of this contract pointed at `#2`, which is now closed.
Canonical manual: [casaelida.com/docs/operations/metadata](https://github.com/j3w1/casaelida.com/tree/main/docs/operations/metadata).
Machine policy: [`ce-meta/policy`](https://github.com/j3w1/ce-meta/tree/main/policy).
