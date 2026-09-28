# ADR-420: Per-Folder Keep-Nesting Override in Catalog Generation

## Status
**Accepted** (2026-08-26)

## Context

`catalog.maxFolderDepth` (2) caps instrument folder nesting globally: a folder
at the cap keeps its own presets, absorbs every preset below it, de-dupes by
name, and drops its subfolder nodes (ADR-392). ADR-403 then recovers those
subfolders at render time as headed sections, and ADR-408 added
`catalog.flattenFolders` to force *earlier* flattening on named branches.

Every lever so far points one way — flatten more. Nothing lets a specific
branch stay deeper than the global cap, and some branches want exactly that.
`Drum → Prod → NI Acoustic / NI Analog / NI Digital` are three depth-2 folders
whose subfolders each hold a coherent, substantial set of kits. Collapsing them
costs more than the tap it saves:

- Each rolls up into one screen of hundreds of tiles. ADR-403's re-grouping
  keeps it readable, but the subfolders stop being *navigable* — no drill, and
  no long-press "random preset from this folder", which only exists on folder
  tiles.
- `dedupePresetsByName` is first-wins across the whole roll-up, and drum
  libraries reuse names heavily across kit folders (`Kit 01`, `Room`,
  `Brushes`). Flattening silently drops the duplicates.

Raising `maxFolderDepth` to 3 fixes these three folders by deepening *every*
type — the same granularity complaint ADR-408 was written to answer, in the
opposite direction.

The exemption pattern already exists: `isAudioVendorNode` is a hard-coded path
predicate that keeps sample folders fully nested regardless of the cap. This
generalizes it to a config list.

## Decision

Add `catalog.keepNestingFolders`: folder chains exempt from the depth cap. A
node matching an entry — or sitting under one — is returned untouched, keeping
its full nesting.

- `KEEP_NESTING_FOLDERS` + `isKeepNestingNode(path, list)` /
  `keepNestingEntryFor(path, list)` in `generate-type-first-json.ts`, checked in
  `capFolderDepthNode` **after** the audio-vendor arm and **before** both the
  forced-flatten and depth arms — so a keep entry wins over a contradictory
  `flattenFolders` entry and over the global cap.
- Returning the subtree as-is exempts every descendant implicitly (the
  recursion never reaches them), exactly as the audio-vendor arm behaves.
- Logs `[KeepNesting] Preserving "X" (full nesting)`, once, on the folder the
  entry names — `keepNestingEntryFor` is the node-only match, so descendants
  don't each log.

**Entries are label chains, not vendor-qualified paths.** This deliberately
diverges from `flattenFolders`. An entry is matched as a run of whole
`/`-separated segments anywhere in a node's merged path, so `Prod/NI Acoustic`
matches `NI/Drum/Prod/NI Acoustic`, and the `Vendor/Type` prefix is optional.
The reason is a real trap in the merged tree: `mergeVendorTrees` merges
same-named folders across vendors and the surviving node keeps the **first**
vendor's path, so a fully-qualified `NI/Drum/Prod/…` misses whenever an
earlier-sorted vendor also ships a `Prod`. A chain read straight off the
browser breadcrumb is both easier to author and more robust. Full paths still
work when a bare chain would be ambiguous across types.

Matching stays boundary-safe: `Prod/NI Acoustic` matches neither
`Prod/NI AcousticX` nor `Old Prod/NI Acoustic`.

**Unmatched entries are reported.** `flattenFolders` documents its silent-no-op
hazard and leaves the author to diff the generation log. Here, entries that
named a folder are recorded during capping and `main()` prints any that matched
nothing after the totals. A typo announces itself. The hit set is a *parameter*
of `capFolderDepth`, defaulting to the module singleton, so a test can cap a
tree against its own set and assert what was recorded — the guarantee is
covered rather than resting on generation-time observation.

**No browser change.** The browser reads whatever tree the catalog carries: an
exempted folder simply arrives with its subfolder nodes intact and renders as a
normal folder screen. ADR-403 grouping is origin-driven and unaffected.

Shipped list: `Prod/NI Acoustic`, `Prod/NI Analog`, `Prod/NI Digital`.

## Consequences

- Those three Drum folders keep one more drill level, their per-subfolder
  long-press random, and their same-named kits across subfolders.
- The two overrides now read as a pair: `flattenFolders` (flatten below the
  cap) and `keepNestingFolders` (nest past it), with `maxFolderDepth` as the
  default for everything unlisted.
- Deep exempted branches are unbounded by construction — that is the point, but
  it means `oversizeLeafWarn` is the only guard left on a branch listed here.
- **A nested entry is redundant, and reported as such.** Listing both
  `Prod/NI Acoustic` and `Prod/NI Acoustic/Kits` exempts the subtree at the
  broader entry, so capping returns before the recursion reaches the node the
  narrower one names and it can never record a hit. It is covered, not a typo,
  so it is listed separately (`redundantKeepNestingEntries`) rather than
  warned about as unmatched — otherwise the warning sends the author hunting a
  folder that is already exempt. "Broader" follows the matcher, not just path
  ancestry: a shorter chain covers a longer one ending with it, so a bare
  `NI Acoustic` makes `Prod/NI Acoustic` redundant too.
- **An entry only protects itself and what's below it, not its ancestors.**
  Listing `Prod/Vintage/Tape` while `Prod/Vintage` still hits the cap collapses
  Vintage first, so the recursion never reaches Tape and the entry reports as
  unmatched. List the shallowest folder you want to keep drillable.

## Rejected alternatives

- **Raise `maxFolderDepth` to 3.** Deepens every type to fix three folders.
- **Path + explicit depth** (`{"Prod/NI Acoustic": 4}`). Same per-folder depth
  arithmetic ADR-408 rejected for the flatten side; "keep this branch as it is
  on disk" needs no number.
- **Vendor-qualified paths, for symmetry with `flattenFolders`.** Symmetric but
  wrong here: the merged-path-keeps-first-vendor behavior makes qualified paths
  fragile, and the failure is silent. (The reporting added here would make a
  future `flattenFolders` switch to chains safe, if that's ever wanted.)
- **Marker file on disk.** Same objection as ADR-408 — scatters the rules and
  pollutes the library.
