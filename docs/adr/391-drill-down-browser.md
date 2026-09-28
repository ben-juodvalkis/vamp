# ADR-391: Drill-Down Instrument/Preset Browser

## Status
**Accepted**

## Context

The instrument/preset browser (`UnifiedGestureBrowser`, ADR-186 consolidated
type-first + its gesture layer) presented every navigation layer at once as a
Miller-column / NSBrowser cascade: a left rail of type buttons, then side-by-side
folder columns, then a preset card grid — all visible simultaneously. A
hold-to-drag gesture let you sweep across columns, with a random-pick-on-release
affordance.

During live performance this imposed real cognitive load: the eye has to parse a
wide matrix and hold the whole path in working memory to make one choice. The
gesture and random-chooser were liked, but the *layout* slowed decisions down.

The ask was a lower-parse interaction: **one decision per screen** — tap a layer,
see the next, until you reach presets — while keeping the existing visual language
(matte-slab category rail, vendor colours) and the reusable load/prep plumbing.

## Decision

Replace the Miller-column browser with a **drill-down browser**
(`DrillDownBrowser.v6.svelte`), mounted in place of `UnifiedGestureBrowser` at the
sidebar slot. `UnifiedGestureBrowser` and its gesture utils remain on disk but are
no longer mounted.

**Interaction model — one layer per screen (strict).**
- A persistent left rail (faithful reproduction of the old `VendorButtonGrid`:
  Record button + three groups Recent/Audio · Drum/Bass/FX · Inst/Key/Synth, matte
  slabs) stays visible. Tapping a category opens the browser and drills into it.
- To the right, the stage shows exactly one layer at a time: folder tiles → (deeper
  folders →) preset tiles. **Strict one-type-per-screen** — a level with subfolders
  shows folders only; only a leaf level shows presets (`screenKind`).
- A breadcrumb across the top is both orientation and fast-travel: tap any segment
  to jump back up. This is what keeps deep drilling from feeling slow.
- The old cross-column drag is dropped (there are no side-by-side columns).
  **Hold-a-folder → load a random preset** from it is kept (long-press).

**Reused plumbing (unchanged).** `loadPresetWithVariant` + `TrackPrepManager`
(atomic `prepare_for_preset` load), `adapter.getFolders/getPresets/getRandomPreset`,
`browserModeStore` (persistent/lock/replace + external Audio/Scale triggers),
`createRevealController` (reveal-then-close after a load). Scale/Key mode delegates
to the existing session scale sends; it has no rail button and is opened externally
via `isScalePersistent`, faithful to the old UI. The data model is already a
`FolderNode` tree, so the drill reads `currentPath` directly instead of maintaining
per-column arrays.

**Adaptive tile grid (shared by folders and presets).**
`computeGridLayout` (pure, in `utils/drillDownModel.ts`, unit-tested) measures the
stage and picks the column count that makes tiles as close as possible to a
comfortable touch target while staying roughly square. Tiles **grow to fill** the
stage when the content fits; the grid **scrolls** only when filling would shrink
tiles below the minimum tap size (~150px). The scorer favours a squarish aspect and
**fully-packed grids** (9 items → 3×3, no dead trailing row). One algorithm drives
both grids; the component feeds it the measured stage size via a `ResizeObserver`.

**Tile styling.** Colour-coded by vendor/instrument type on the *outline* (not a
fill wash); centred name that scales to tile size via container-query units; no
suffix badge (variant count kept as a corner marker). Rail slabs are
black/transparent with coloured outline + ink label.

**Alphabetical ordering baked at generation time, not runtime.**
Folders and presets read A→Z at every level. Rather than sort on every navigation
in the adapter (wasteful, scatters logic), the order is baked into the generated
JSON: `scripts/typeFirstSort.ts` `sortFolderKeys` is now pure case-insensitive
alphabetical (the former vendor-group → pinned → Omni-library precedence from
ADR-175 / ADR-334 was dropped in favour of predictable, scannable order), and
`generate-type-first-json.ts` sorts every folder's presets recursively after the
multi-vendor merge (concatenation there had broken the earlier per-vendor sort).
The runtime adapter stays dumb — it reads key order as-is.

**Interaction/snappiness details.** Rail category taps fire on `pointerdown` (open
in the same task as the touch); `touch-action: manipulation` kills the iPad Safari
tap delay; no enter animation (layers appear instantly). Expanded overlay honours
the main layout's insets (safe-area top, 16px sides) as inner padding so the rail
never hangs off the bottom on iPad. The rail keeps exactly the closed
`--sidebar-width` so buttons don't shrink on open. The header omits a redundant
"Browser" label; while open, the top rail slot swaps the Record button for a large
red **X** that closes — on `onclick` (after the full tap) with the X consuming its
own pointer events, so a close tap can never fall through and start a recording.

## Consequences

**Positive.**
- One decision per screen: far lower parse cost mid-performance.
- Breadcrumb fast-travel makes deep paths cheap to escape.
- Predictable alphabetical order everywhere; sorted once at generation, so runtime
  navigation does zero sort work.
- A single tested grid algorithm sizes both folders and presets comfortably and
  fills/scrolls sensibly across item counts.
- Kept the liked affordances (hold-for-random, lock, reveal-then-close) and the
  established visual language.

**Negative / trade-offs.**
- Reaching a leaf can take one more tap than a Miller column that showed everything
  at once (mitigated by the breadcrumb + strict one-type-per-screen).
- The cross-column drag gesture is gone.
- The curated vendor-group/pinned/Omni-library folder ordering (ADR-175, ADR-334) is
  dropped in favour of pure alphabetical. Those ADRs are superseded for ordering.
- `UnifiedGestureBrowser` + its entire gesture stack were **deleted** once the
  drill-down browser replaced them: 9 components (`UnifiedGestureBrowser`,
  `BrowserInteractionController`, `FolderNavigationColumn`, `VendorButtonGrid`,
  `VendorBrowserMode`, `PresetGrid`, `ScaleBrowserMode`, `ScaleGrid`,
  `SelectedTrackMeter`), 6 utils (`gapPlacement`, `presetFolderPath`,
  `vendorStateManager`, `pathAtRelease`, `presetResolver`, `touchHandlers`), the
  `browserGestureStore`, and the now-orphaned `tracks/TrackVolumeMeter` (its only
  consumer was the deleted `SelectedTrackMeter`) — plus their tests. Surviving
  browser utils reused by the new component: `presetLoader`, `vendorModel`,
  `revealController`, `drillDownModel`.

## Tags
`browser`, `preset-browser`, `drill-down`, `ui`, `ipad`, `touch`, `type-first`,
`grid-layout`, `alphabetical-sort`, `supersedes-175`, `supersedes-334`
