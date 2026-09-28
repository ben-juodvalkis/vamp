# ADR-343: Per-Track Preset Path in the Instrument Central View

## Status
**Accepted**

## Context

When a user taps a patch in the gesture browser, `loadPresetWithVariant` in `interface/src/lib/components/v6/browser/utils/presetLoader.ts` receives a `Preset` object whose `path` field is the full browser-relative path, e.g. `Synths/Analog/Bass/MyPatch.adv`. That path is already being written to `browserNavigationStore.loadedPresetPath` — but purely to highlight the selected row in the browser column. It is a single global slot, not per-track, and it never reaches the central view.

The result: the instrument central views (InstrumentRackCentralView and ~15 sibling views under `interface/src/lib/components/v6/central/views/`) show only macro controls and parameter names. When the user navigates between tracks, there is no indication of *which* preset the current track is playing. For a performance interface that exists to let the user browse dozens of patches quickly, losing the name of what you just loaded the moment you move to another track is a real navigational gap.

Ableton does surface the loaded device's `name` (e.g. "Analog Bass" or "Wavetable") via the Max4Live observer, and it's already in `InstrumentInfo.name`. But that's only the top-level device label — it carries no context about the *folder hierarchy* the preset came from. A user who loaded `Synths/Analog/Bass/Deep Reese` and then loaded `Synths/Analog/Bass/Sub Punch` onto a different track sees the same `Analog` device name on both and has to open the browser again to tell them apart.

The fix has to solve three problems at once:

1. **Capture the path** at the moment of browser load, where it is known.
2. **Retain the path per-track**, so switching between tracks restores each track's own context rather than showing a single global "last loaded."
3. **Display the path in the central view** without editing every single instrument view component.

## Decision

Store per-track preset paths on the existing `allTracksDeviceCache`, write to it from `presetLoader`, read from it in `instrumentDisplayCoordinator`, and pipe the formatted result through `centralDisplayStore.setView`'s existing `title` argument so `CentralDisplay.svelte`'s existing header slot renders it for every instrument view.

### Why `allTracksDeviceCache` is the right home

The codebase already has a clear per-track persistence layer at `interface/src/lib/stores/v6/allTracksDeviceCache.svelte.ts`. It is keyed by `trackIndex`, has LRU eviction (`MAX_CACHED_TRACKS = 30`), and — crucially — already handles the tricky lifecycle cases:

- **Track deletion**: `handleTrackCountChange(newTrackCount)` is already invoked from `interface/src/lib/api/handlers/maxObserverHandler.ts:180` whenever Ableton's track count shifts, and conservatively invalidates all regular entries to avoid stale shifted indices.
- **Session reconnect / full reset**: `clear()` already wipes the map.
- **Per-track device additions and removals**: already maintained by `addDevice()` / `removeDevice()`.

Adding `presetPath?: string` as a new optional field on `CachedTrackDeviceState` means the per-track preset path inherits all of that lifecycle machinery for free. A new dedicated store, or a new Map on `currentInstrumentStore`, would have required re-implementing all of it.

Other candidates were rejected:

- **`browserNavigationStore.loadedPresetPath`** is a single global used for browser-row highlighting. Conflating it with per-track state would have broken the browser's own UI semantics.
- **`currentInstrumentStore`** only tracks the *selected* track's instrument. A per-track map doesn't belong there — it is a different cardinality (1 vs. N) and a different lifetime (selection-scoped vs. track-scoped).
- **`recentInstrumentsStore`** is a flat, deduped recency list keyed by `fullPath`, for a "recently used" picker. Different data shape and different purpose.
- **`selectedTrackStore`** holds only the current track's data. Not per-track.

### Preserving `presetPath` across `complete_state` refreshes

This is the single non-obvious correctness issue in the change. `AllTracksDeviceCache.set(...)` is called whenever Ableton sends a full `complete_state` message — which happens every time the user twiddles a macro, switches devices, or the M4L observer refreshes. The original `set()` constructed a new cache entry from scratch:

```ts
this.cache.set(trackIndex, {
  trackIndex, hasMidiInput, hasAudioInput, devices, parameters, /* ... */
  lastUpdated: now, lastAccessed: now
});
```

If we naively added `presetPath` to that shape and left `set()` unchanged, the preset path we'd just written would be wiped the next time `complete_state` arrived — which in practice is within a few seconds of the load.

The fix is a two-line preservation step:

```ts
const existingPresetPath = this.cache.get(trackIndex)?.presetPath;
// ...
this.cache.set(trackIndex, {
  /* ... existing fields ... */
  presetPath: existingPresetPath,
  lastUpdated: now, lastAccessed: now
});
```

This is called out explicitly here because it's easy to miss when reviewing the diff: the new field *has* to be read back out and carried forward on every refresh, or the feature silently degrades from "per-track memory" to "per-track memory that forgets after one parameter tweak."

### Write path: `presetLoader` → cache

`loadPresetWithVariant` already sets `browserNavigationStore.loadedPresetPath = preset.path` for the browser row highlight. Immediately after, we now also capture per-track:

```ts
const trackIndex = selectedTrackStore.trackIndex;
if (trackIndex >= 0) {
  allTracksDeviceCache.setPresetPath(trackIndex, preset.path);
}
```

The `>= 0` guard skips master track (`-1`). Audio clip loads go through `replaceAudioClip`, a separate code path, so they are naturally excluded.

`AllTracksDeviceCache.setPresetPath(trackIndex, presetPath)` mutates the existing entry in place. If no entry exists yet (first preset load on a brand-new track before the observer has fired), it bails silently — a `complete_state` will arrive shortly and the user's next load will succeed. The half-populated-placeholder alternative was rejected as too clever for the actual failure mode.

### Read path: coordinator → `setView` title

`instrumentDisplayCoordinator` already calls `centralDisplayStore.setView('instrument', ...)` in three places: the `handleTrackChange` switch on new tracks, the "clearing instrument data, keeping view type" branch, and `showCurrentInstrument`. `centralDisplayStore.setView`'s signature is `setView(type, subType?, data?, title?, wide?)` — the `title` parameter already existed for the clip view (which passes `'Clip'`) and was simply unused by the instrument branches.

A small helper reads the cache and falls back to the device name:

```ts
private resolveInstrumentTitle(trackIndex: number, fallbackName: string): string {
  const path = allTracksDeviceCache.get(trackIndex)?.presetPath;
  return path ? formatPresetPath(path) : fallbackName;
}
```

The fallback to `instrument.name` matters: on startup, after a page reload, or for any preset the user loaded outside the browser (e.g. directly in Ableton), the cache has no entry and we show the device name. That is strictly better than an empty header strip.

The three `setView` calls now pass the resolved title. The "instrument-cleared" branch passes `undefined` so `CentralDisplay.svelte`'s `{#if view.title}` conditional hides the header strip cleanly when an instrument vanishes.

### Path formatting

A new pure utility at `interface/src/lib/utils/presetPathFormatter.ts` transforms the raw path:

```
formatPresetPath("Synths/Analog/Bass/MyPatch.adv")
  → "Synths › Analog › Bass › MyPatch"
```

The logic is three steps: (1) strip a trailing extension if it matches a conservative allow-list (`.adv`, `.adg`, `.alp`, `.als`, `.wav`, `.aif`, `.aiff`, `.mp3`) so filenames containing dots aren't mangled; (2) split on `/`; (3) join with `' › '` (U+203A). The breadcrumb separator reads more naturally than `/` in a small header strip and is narrow enough to fit long paths.

### Display: no per-view changes

`CentralDisplay.svelte` already renders `view.title` in a conditional header strip:

```svelte
{#if view.title}
  <div class="px-4 py-2 bg-muted/50 border-b border-border flex-shrink-0">
    <h3 class="text-sm font-medium text-muted-foreground">{view.title}</h3>
  </div>
{/if}
```

Every instrument view (InstrumentRack, Operator, Analog, Wavetable, Omnisphere, Drift, Collision, Sampler, Simpler, Meld, Electric, DrumRack, KompleteKontrol, ...) renders *inside* `CentralDisplay`, so piping the path into `view.title` gives all of them the header simultaneously. **No per-view component was touched.**

## Consequences

**Positive**

- Every instrument central view shows the full browser path of the loaded preset, with per-track memory, using one title string fed through infrastructure that already existed end-to-end.
- No changes to any of the ~15 central view components. Adding a new instrument view in the future automatically inherits the header strip.
- The per-track preset path participates in all the existing lifecycle events (track deletion, session reset, LRU eviction) because it lives on the same cache entry as the track's devices and parameters.
- Fallback to `instrument.name` means the header is meaningful even for presets loaded outside the browser, on page reload, or on first startup.
- The formatting utility is pure and trivially unit-testable in isolation.

**Negative / tradeoffs**

- **In-memory only.** The cache resets on page reload. A user who refreshes the interface sees device-name fallbacks until they visit each track and reload its preset. Persisting to localStorage was considered and deferred: the volume of preset data, the correctness concerns around stale paths after Ableton sessions change, and the limited value (browser state is ephemeral anyway) didn't justify it for a first pass.
- **`complete_state` preservation is load-bearing.** If a future change to `AllTracksDeviceCache.set()` accidentally drops the `existingPresetPath = this.cache.get(trackIndex)?.presetPath` read, the feature degrades silently — the header still shows on initial load, then blanks out on the first macro tweak. The risk is mitigated by the inline comment in `set()` explaining why the read exists, but reviewers of future edits to this file should watch for it.
- **Variant presets share a single stored path.** Multi-variant `.adg` groups resolve to `preset.path` (the group), not the randomly selected variant filename. This matches the semantic intent (the variants all belong to the same preset) but means the header won't tell you which variant is playing. Acceptable — the variant selection is already hidden from the user and exposing it in the header would create more confusion than it resolves.
- **No preset-path clearing on instrument deletion.** We deliberately leave the stored path untouched if the user removes the instrument device from a track. The fallback-to-device-name logic handles the display correctly, and if the user re-adds an instrument the old path reappears as additional context. If this turns out to be surprising in practice we can add a `clearPresetPath` call to the "no instrument" branch in the coordinator — but the current behavior is the less-surprising default.
- **Audio tracks bypass this entirely.** Audio tracks always show the clip view (`'Clip'` title) regardless of any cache state. This matches existing behavior and is intentional: an audio track doesn't have a browser-loaded instrument whose path to display.

## Tags
`central-view`, `browser`, `preset-loading`, `per-track-state`, `ui`, `svelte`
