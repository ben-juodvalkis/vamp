# ADR-441: A replace opens on the track's own patch

## Status
**Accepted** (extends ADR-390, narrows ADR-397 for one path)

## Context

ClipCentralView's **Replace Inst** hold (800 ms, column 9, MIDI track with a
clip) arms replace mode and opens the browser. Until now `openForReplace` did
four things — arm the mode, pin the target track, force the instruments source,
set the browser persistent — and *nothing* about navigation. The browser's only
reaction was `isExpanded = true`.

So the browser reopened wherever the last browse ended: the per-button path
memory (ADR-397) and `browserNavigationStore`'s vendor state were untouched.
For the gesture that means "swap the instrument on THIS track", that is the
least useful place it could land. The patch you are replacing is a known point
in the catalog, and the folder around it is exactly the set of alternatives the
performer is reaching for — the same list, in the same order, the swap pill's
folder-next already steps through (ADR-439 phase 2).

A second, sharper problem rode along. `openForReplace` forces
`sourceMode = 'instruments'` (it must, since ADR-397 made the browse mode
persist across opens — an audio/Simpler pick ignores the pin and spawns a new
track). But nothing re-skins the pane when it does: the level-load effect keys
on the effective vendorId and the path, not on the source. A replace launched
after a sample browse therefore reopened **showing samples** under a "Replace
inst" pill, in a tree whose source had been flipped out from under it.

## Decision

**1. The patch is frozen with the pin.** `openForReplace(targetTrackPath,
targetPresetPath)` takes the track's recorded patch — protocol 3.9.0's
`TrackRecord.preset` — alongside the track path, read at the same moment and
for the same reason: both describe the track as it stood when the hold fired,
not as a live read. An unrecorded patch (`''`, which the surface reports once
the track no longer holds the instrument its last load left) is stored as
`null` and simply means "no landing".

**2. The browser lands on that patch's catalog folder.** `presetSiblings` — the
lookup the swap pill already uses — now also returns the **folder path** to the
leaf holding the preset (`findPresetInTree` carries the segments down its walk).
That path *is* the browser's `currentPath`: both are the tree's own key names,
and the depth cap is baked into the tree, so the leaf and the browser's grid
screen are the same thing by construction. `selectCategory(vendor, { at })`
lands there and remembers it as that rail button's location. The patch's tile
wears the existing `.loaded` outline.

**3. The landing is not awaited.** A cold catalog is a multi-MB
`/data/{type}.json`; holding the browser shut behind it would make an 800 ms
hold feel like it missed. The browser expands immediately where it was and
re-skins when the folder resolves — the same trade the folder long-press makes
with its speculative pick. A `revealToken` guards a slow read against a newer
open, and a mode dropped mid-lookup (a different track selected) cancels it.

**4. Failing to resolve still leaves the pane in instrument mode.** When there
is no folder to land on — no record, a Place the generator never scans, a
catalog that moved — the open re-skins a *sample* pane back onto its own type
button, closing the drift above. An instrument pane is left exactly where it
is. That three-way decision is `replaceLanding` in `drillDownModel`, pure and
table-tested, because both of its wrong answers are decisions rather than
plumbing.

The rule is deliberately scoped to **replace-instrument**. A rail tap still
resumes that button's last location (ADR-397) — the two gestures mean different
things, and only this one names a track whose patch is the obvious starting
point.

## Consequences

**Positive**
- The gesture lands where the work is: the folder of alternatives to the patch
  being replaced, with the current one marked.
- Continuity with the swap pill — `presetSiblings` answers both, so the
  browser's landing folder and the pill's step list are the same list.
- The sample-pane-under-a-Replace-inst-pill drift is closed, including on the
  path where no patch resolves.
- The landing becomes that rail button's remembered location, so backing out
  and reopening stays where the replace put you.

**Negative / accepted**
- A visible re-skin: the browser opens where it was and jumps when the lookup
  lands. Warm (the common case, the catalog already parsed) this is within a
  frame or two; cold it is the catalog fetch. The alternative — a hold that
  appears to do nothing for a second — is worse.
- A first-ever replace on a cold catalog fetches a type file the performer might
  not otherwise have opened. One file, cached for the session by
  `presetSwapCatalog`'s per-type adapter. Note that is a *different* adapter
  from the browser's own (`getAdapter(vendorId)`), so landing on a type warms
  two parsed copies of its catalog rather than one — already true of the swap
  pill, and now reachable one gesture earlier. Bounded by `clearVendorCache` on
  the browser side; if it ever bites, the fix is one shared adapter registry,
  not a smaller cache.
- `PresetSiblings` and `findPresetInTree` grew a field, so the two stubbed
  `find` fixtures in the swap tests had to grow one too.

## Tags
`browser`, `replace-instrument`, `preset-catalog`, `clip-view`, `adr-390`,
`adr-397`, `adr-439`
