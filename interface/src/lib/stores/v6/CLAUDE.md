# V6 Stores

All stores use Svelte 5 runes (`$state`, `$derived`, `$effect`).

## Store Files

| Store | Purpose |
|-------|---------|
| `selectedTrackStore.svelte.ts` | **Core** - Selected track index, all devices on track, parameters. Proxies reads to v3 `normalized.svelte.ts` (post-Python-surface migration). |
| `clipStateStore.svelte.ts` | Clip playback state, recording status, loop positions. **Group-aware (ADR-410):** `getVisibleTracks` drops tracks hidden inside a folded group — the filter runs last, in both `all` and `active` modes, so it outranks even "selected". `emptyMidiTracks` / `emptyAudioTracks` and `trackTypeFromV3` gate on `isFoldable`, because a Group Track reports `hasAudioInput === true` and never holds a clip of its own, making it indistinguishable from an empty audio track otherwise. The same two lists also gate on `isMetronomeTrackFromV3` (2026-09-21) — an Instrument Rack whose macro 1 reads "Pattern N" (`isPatternRackMacroName`, `$lib/utils/macroLayoutUtils.ts`), in practice the Skaka Metronome Rack, which free-runs off the transport and so also carries no clips of its own. This structural test is deliberately not "is this track 0" — the metronome track's old protection was purely positional (ADR-385) and broke the moment it was grouped off the first slot; Python's `TrackPrepareComponent._is_metronome_track` is the authority, this is advisory. `groupBands(visibleTracks)` returns the bracket-band geometry `TracksPanelV6` draws over open groups (ADR-413). Tree math lives in `$lib/utils/trackGroups`. |
| `clipPropertiesStore.svelte.ts` | Clip metadata (name, length, tempo) |
| `clipGrooveStore.svelte.ts` | Groove/timing quantization settings |
| `sequencerStore.svelte.ts` | Sequencer pattern state, note data. Pattern/length/rate/chance/temperature read from `paramByPath` (real params), addressed by **role and resolved by name** through `$lib/config/permuteLayout.ts` (permute ADR-020 / ADR-429; the measured positional table is only a per-role fallback for records without names). **Step position does not** — `muteCurrentStep`/`pitchCurrentStep` read `permuteStepStore` (`stores/v3/permuteSteps.svelte.ts`), telemetry the surface's sequencer engine emits. Same resolver in `useTinySequencer`. **ADR-435 (2026-09-14): the store follows the pad scope** — `activeDrumRackScope()` names a pad held or latched on the selected track's Drum Rack, and the store's device is then the Permute in that pad's map (`selectedTrackStore.padDevices`, by class and name through `findPermute`; a presence stand-in before the bundle lands reads as the device's defaults), the ghost is the pad without one, pending ghost edits are keyed by the pad path, the ghost load names the pad as its target and a landed device flushes only its own scope's edits. `scope` and `temperatureInert` (Temperature does nothing on a pad) are the new getters; every write is the same `param/set` wire on a pad-shaped path. |
| `browserModeStore.svelte.ts` | Current browse mode (vendor/type), persistent/replace/scale/lock. `openForReplace(trackPath, presetPath)` freezes **two** things at arm time (ADR-441): the pin Python swaps against, and the track's recorded patch (`TrackRecord.preset`) the browser opens ON — `replaceInstrumentPresetPath`, cleared wherever the pin is. `''` (a track whose instrument is no longer the one its last load left) reads as no patch. |
| `browserNavigationStore.svelte.ts` | Folder navigation, breadcrumb tracking. Also holds the browser's **per-button path memory**: a rail tap resumes that button's last drill-down location, except a tap on the Place already open on screen, which restarts at its root. `rememberPath` / `getRememberedPath` / `forgetPath` keyed by the exported `rememberedPathKey(buttonId, isAudioSource)` — per rail *button* and per half of the browse switch: a Place keeps one vendorId whichever half it shows, and a preset path means nothing among its samples. Both getter and setter copy the array (it becomes a `currentPath` that navigation then mutates). Session-lived; wiped by `clearVendorNavigationState` / `resetAllVendorStates`. |
| `centralDisplayStore.svelte.ts` | Which device detail view is currently showing |
| `clipEditorStore.svelte.ts` | Clip-view-mirror M1 toggle (single boolean). When `active`, `ClipCentralView` shows `ClipEditorView` (the canvas) instead of the button rail. Manual only — focusing a clip never flips it (decision 8). |
| `focusedNotesStore.svelte.ts` | Clip-view-mirror M3/M4 (ADR-382). Id-keyed `Map<noteId, RichNote>` for the central editor's focused clip — fed by `clipRichNotesService` (the rich, identity-carrying channel), the editor's note source instead of the cheap blob. `reconcile()` (fresh rich pull replaces the map — the external-edit/rejection reconcile point), `optimisticAdd/Modify/Remove` (M4 edits), `nextTempId`/`swapTempId` (add mints a temp negative id, swapped for Live's real id on `notes/added`). `clearAll()` fired on focus change by `session.handleFocusedClipPath`. |
| `fxGridStore.svelte.ts` | FX grid device loading state, ghost devices, parameters |
| `fxSlotStore.svelte.ts` | Individual FX slot states |
| `currentInstrumentStore.svelte.ts` | Current instrument type on selected track |
| `recentInstrumentsStore.svelte.ts` | Recently loaded instruments for quick access |
| `captureStore.svelte.ts` | Recording/capture state |
| `slotRegistry.svelte.ts` | Maps device slots to their definitions |
| `uiPrefsStore.svelte.ts` | Persistent UI display toggles (localStorage, browserModeStore's guarded read/write pattern). Pure display prefs; carry no Live state and never reach the wire. **Since 2026-09-26 `showCentralView`, `flipLayout`, `showDrumPads` and `showDeviceBand` are not prefs: no switch, no setter, no storage key; the getters answer `true` (a stored `'0'` is ignored), and the Sections card is Header · FX · Clips (the Solo row and `showSoloButtons` went 2026-10-01: two fingers on a strip solo it). The history below describes them as switches.** **ADR-415/416** add the three **section toggles** — `sessionMode` (clip grid, default off), `showCentralView` and `showFxGrid` (both default **on**) — all set from the **Sections card in `SystemCentralView`** (the master-track central view), where they render as identical switches alongside `showSoloButtons`, `showTransportHeader` and `flipLayout`, ordered the way the things they control appear down the screen: Header · Solo · Clips · View · Pads · FX · Flip. They have lived at the foot of the right sidebar and at the top of the browser rail before this; the card is the first home that couples to no other geometry. Because the card sits *inside* the central section, **VIEW can hide its own control** — the way back is a master-strip tap (`MasterTrack.handleSelect`, the direct one), a strip's Clip/Permute tap (`TrackStrip.selectThen`) or a long press on a grid cell (`TracksPanelV6.focusSlot`), all of which turn the section on. They are independent switches on a fixed stack (strips · clip grid · central view · FX grid), not a chooser for one slot: each adds or removes a whole section and the visible ones split the height evenly. The two default-on prefs read **inverted** from storage (`readBoolFromStorageDefaultOn` — only an explicit `'0'` is off), so absent storage lands on the familiar three sections. `showTransportHeader` (slim top transport strip, deliberately independent of all three) is the first row of that same Sections card. The **mini session column** in `ClipCentralView` — the selected track's clip slots in that rail's leading column, `MiniSessionGrid` — has **no pref of its own**: `miniSessionActive` is simply `!sessionMode`, so it is the full grid or the miniature, never neither. It had a `showMiniSession` switch, whose only reachable extra layout was "no clips visible anywhere"; both it and its storage key are retired, and a stored `'0'` from an older install is now ignored (pinned by a test). Kept as a named getter rather than inlined `!sessionMode` because it is a different QUESTION from "is the clip grid up", because the sceneWindowStore ownership rule depends on it living in exactly one place, and because it stays testable without a layout. It is not a section, so `visibleSectionCount` deliberately ignores it. It says nothing about `showCentralView` or which view is selected — those decide whether the HOST is on screen, and folding them in would make the getter claim to mean "is it visible", which it cannot know. **ADR-421 adds `flipLayout` (default on, same inverted read)** — the last row of that same Sections card. It mirrors the stack's **order** and nothing else: FX grid on top, central view, clip grid, track strips against the bottom edge, with each track's name band moved to the foot of its own card above its Solo button. Order-only is the whole point — `flex-direction: column-reverse` at four containers plus one `order: 1` leaves every flex share, gap and measured row pitch here untouched, so a capture with the switch off is bit-identical to the pre-flip build. It deliberately does **not** reach `visibleSectionCount` (turning the screen over adds no room for scenes) and never mirrors row CONTENT — scene rows read downward in both orders, and the clip grid's stop row / scene rail's footer stay at the foot of their sections, which keeps the matched `renderedRows + 1` intact. **PADS (`showDrumPads`, 2026-09-08, default on, same inverted read)** is the fifth row and the only one that is not a section: it switches the pad column inside the Drum Rack central view (`DrumPadGrid`), so it takes 200px of WIDTH off one view rather than height off the stack, and deliberately does not reach `visibleSectionCount`. It sits after VIEW because that is where the thing it controls sits on the screen. Off, the Drum Rack view is what it was before the grid landed — full-width controls moving the whole kit — and since hold-to-scope is the grid's only door, per-pad editing goes with it everywhere, the FX grid's Pitch slider included; the view clears `drumPadScope` on the off edge so a hold cannot outlive the pads that made it. **INST (`showDeviceBand`, 2026-09-14, default on, same inverted read)** is the other row that is not a section: it is the third band inside every non-group track strip's card, between Clip and Permute, so the strip reads Clip · Inst · Permute · Name in four equal bands and the trade is real — that band's height comes out of the clip render and the Permute thumbnail beside it. It draws the track's sound source wordlessly (a Drum Rack's pads, any other instrument's four leading controls as knobs, a glyph for anything else) and its tap selects the track and opens that device's central view. Like PADS it never reaches `visibleSectionCount`: it changes a strip's internal proportions, not the stack's. `visibleSectionCount` (1..4) is the stack's own arithmetic exposed as a getter — `sceneWindowStore` reads it to size the scene window, since a taller clip-grid section should show more scenes. Full map in `docs/reference/toggles.md`. |
| `sceneWindowStore.svelte.ts` | The one shared scene-scroll window for session mode (ADR-415). Every track's `SlotGrid` column and the `SceneRail` read this single offset, which is what makes them scroll together and stay row-aligned. `visibleCount` is **derived from the section stack** — the clip grid's section is `1/N` of the height, so hiding sections makes it taller and the window spends that height on more scenes rather than taller cells: **4 sections → 4 rows, 3 → 6, 2 → 8** (`visibleCountForSections()`, a pure exported mapping over `uiPrefsStore.visibleSectionCount`, which keeps the row pitch ~48–56px in every configuration). `renderedRows` (`min(sceneCount, visibleCount)`) is the divisor both the grid and the rail use to turn their section into a row pitch, so a set with fewer scenes than the window draws taller rows rather than leaving dead space. Offset is in **scene rows** (not px): float during a drag, snapped to a whole row on release, so the grid never rests mid-row. Callers do the px→rows conversion (they own the measured row height). `sceneCount` is **derived** — the widest `track.slots` map across tracks, since Live's grid is rectangular and scene add/remove arrives as a `state/full` re-ride. Clamped on **read** as well as write: deleting scenes — or *growing the window* by switching a section off — strands a stored offset with nobody writing, and a read-side clamp fixes that without an `$effect` (a module-level store has no component to own one). `SceneRail`'s effect watches BOTH counts and calls `clampToSceneCount()` to persist it, since either can shrink `maxOffset` — and `MiniSessionGrid` runs the same effect, because the rail is mounted only in session mode while the mini is mounted only outside it, so exactly one of the two always owns this. **`ensureRowVisible(row)` (ADR-417)** scrolls the *minimum* distance to bring a row on screen and nothing if it is already there — `SceneRail` (and `MiniSessionGrid`, in the layouts without a rail) drives it off `session.selectedSceneIndex` so the foot pedal's target can never walk off the window (the arrows can step it past the edge, and an invisible cursor is the exact problem the highlight exists to fix). Minimal rather than centring, because re-centring on every arrow press would move every other row under the performer's hand; it no-ops entirely while a drag is in flight, since the finger owns the window then. Resets on `bridge-resync`. Pure helpers `clampOffset` / `maxOffsetFor` are exported for direct testing. |
| `playingClipsStore.svelte.ts` | Per-track playing-clip state for the `TrackClipView` strip render (ADR-360). Keyed by `trackPath`. Each entry carries clip identity (`slotIdx`, `clipPath`, `isAudioClip`, `filePath`), render extent (`lengthBeats`, loop bounds, `looping`), `status`, and `positionBeats` — painted as-is from the surface's 30 Hz `playhead` emit (no client-side extrapolation). Cross-subscribes to `clipPropertiesStore` via `patchLoopWindowFromProperty` so loop-bound edits on the playing clip update the visible window without waiting for the next slot change. Cleared on `bridge-resync`. |
| `groupGestureStore.svelte.ts` | The hold-Group-button, tap-track-strips gesture (`ClipCentralView`'s Group button). **Nothing touches Live until `commit`** (2026-09-20 rewrite): `start`/`tap`/`cancel` are pure local bookkeeping — `active`, `latched`, `anchorPath`, and a `tapped` map, all `$state` — and `interceptForGroupGesture` (`tracks/composables/useTrackData.svelte.ts`) is the one place every track-tap entry point (a strip, the session grid, the master strip) checks `active` and routes into `tap()` instead of a real selection. `commit()` is the only wire call, sending the anchor plus every tap that stuck as one `commitGroupGesture(members)` (`trackOperations.ts` → `/looping/v3/track/group`, `handlers/liveGroupTracks.js`) — see `interface/bridge/CLAUDE.md` for why this used to be four addresses that clicked Live's real selection on every tap and crashed racing itself. `latch()` records a quick first release (button tapped, not held) so the gesture stays open with no pointer down — the single-pointer path a mouse needs, since the original design assumed a second finger free to tap strips while the first held Group. |

## Patterns

```typescript
// Store pattern - exported reactive state
let selectedTrack = $state(0);
let devices = $state<Device[]>([]);
let currentDevice = $derived(devices[0]);

// Update functions modify $state directly
function selectTrack(index: number) {
  selectedTrack = index;
}

// Export as object
export const trackStore = {
  get selectedTrack() { return selectedTrack; },
  get devices() { return devices; },
  selectTrack,
};
```

## Important Notes

- `selectedTrackStore` is the most central store - most other stores depend on it
- Stores communicate with Ableton via OSC through `simpleClient.ts`
- `/looping/v3/device/load` is unchanged on the UI side by the surface's insert-by-name path (2026-09-10): the same wire, the same `load-failed` reset; a native device whose Live default is the app's preset simply lands faster, in one undo step, and a pad-targeted load lands in the chain directly.
- `/looping/v3/device/load` requires an explicit non-empty `trackPath` (2026-04-26). Python's `DeviceLoadComponent` no longer falls back to `song.view.selected_track` for empty paths — such loads reject with `track-not-found / empty-path`. UI senders (`fxGridStore`, `fxSlotStore`, `sequencerStore`) must pass `selectedTrackStore.selectedTrackPath` or a constructed `tracks/<N>` path. `trackPreparation` no longer fires `/looping/v3/device/load` itself — Python's `TrackPrepareComponent` appends Permute internally on every successful prep (2026-04-30)
- **Param reads from FX components must use `paramValueArmed`, not `paramValue`** (ADR-359, 2026-04-29). The armed-aware reader returns the UI's last-written value during a drag's round-trip, falling back to `v3Store.paramByPath` once the surface confirms. Components no longer keep local `$state` shadows — `let foo = $derived(selectedTrackStore.paramValueArmed(...))` is the pattern. Pre-load FX-grid gestures land in the v3 store via the new-device hook in `fxGridStore`; components don't see a separate "pending" state.


## `drumPadScope.svelte.ts` — which Drum Rack pads are held (2026-09-08)

The pad grid (`central/views/DrumPadGrid.svelte`) reports a finger landing
on and leaving a tile; this store keeps the holds (pointer id → `{devicePath,
note}`, press order, a SvelteMap so `heldNotes` / `scopeNote` are reactive)
and owns the one **scoped-write rule** every virtual-macro writer shares —
the Drum Rack view's controls and the FX grid's Pitch slider, which live in
different component trees. `writeScoped(devicePath, fn, value)` writes the
LAST pressed pad's row (`vm.pad.<note>.<fn>`) absolutely and every other
held pad by the same delta from its own value (an enum lands on all of them
as is; a nil row is left alone), remembering what it wrote per pad
(`padLocal`) so the delta never chases an echo; it returns `false` when
nothing is held so the caller falls back to the kit row. Deliberately not
on the surface: two clients cannot fight over a scope each keeps for itself.
**A tap latches, a hold is momentary (2026-09-09)** — the same split Solo and mute make, through their own pure rule (`shouldRestoreOnRelease`, `MOMENTARY_HOLD_MS` 300) rather than a second threshold, because a performer cannot learn two. `press` records when the finger landed and what was latched before it; `release(pointerId, reason, now)` then either latches (a clean `up` under 300ms — toggling, so tapping a latched pad lets it go and tapping another moves the latch) or leaves the latch exactly as it finds it (a hold, or any release that was not a clean `up`: the browser claiming the gesture or the grid unmounting is not a deliberate latch). A hold never moved the latch, so there is nothing of its own to put back — and the first cut, which wrote the pre-press snapshot back, destroyed a latch tapped during the hold, an ordinary interleaving once a Move hold (ADR-432) spans the other hand's taps (2026-09-12). One latch per device (`latchedPads`), and `heldNotes` puts it FIRST so `scopeNote` is the last thing a finger touched, falling back to the latch — a latched pad is in the scope, takes the multi-pad delta and wears the held treatment, the only difference being that nothing is holding it there. `pressedNotes` is the finger-only list, which is what gates clearing `padLocal`: the per-gesture memory exists for the multi-pad delta, and a lone latched pad is written absolutely. `retainLatched(devicePath, notes)` drops a latch the kit can no longer answer for — a rack hot-swapped in place keeps its device path, so the note would otherwise stay scoped over a kit with no such pad. `DrumRackCentralView` calls `clear()` on the edge where the Sections card's
**PADS** switch goes off (2026-09-08) — the grid is hold-to-scope's only door,
so a hold left standing would point every writer at a pad nobody can see.
**A track change clears every scope (user's call, 2026-09-11):** the
store listens for the `track-changed` window event `handleTrackSelected`
dispatches and calls `clear()` — latches, holds, external holds and the
pane, on every rack — so arriving at a track always starts unscoped, even
one the performer latched a pad on and is coming back to. Live's own
selected pad is not touched (shared state; what the Move hold and the CC 72
knob read). The event keeps this store off the selection store's import
graph.
**External holds (ADR-432, 2026-09-11):** a pad held on the Move arrives
from the surface as `/looping/v3/drum/pad_hold [rackPath, note, held]`
(`api/handlers/v3DrumPadHold.ts`) and is pressed with `pressExternal` /
released with `releaseExternal(rackPath, note)` — the same `holds` map as
fingers, under `externalPointerId(note)`, an id at or below
`EXTERNAL_POINTER_BASE` (−1000) that no browser can mint, so `heldNotes`,
`scopeNote`, the multi-pad delta and the pane need no second code path. The
identity is the pad on its rack, as the surface keys it: the same note
announced on another rack replaces the hold, and a release for another rack
is not ours. The release is always a `cancel`,
so a Move hold never latches — a latch is a tap on the glass — and it puts
back whatever was latched before. `releaseExternalHolds` drops the external
holds and nothing else; `v3DrumPadHold.ts` registers it with
`onHandshakeAccepted` so it runs on every accept (the handshake module
itself imports no store), because the surface that announced them may
have restarted, and a release lost in a reconnect gap would otherwise
leave a scope no gesture can clear.
**The gesture pin (ADR-436, 2026-09-15):** a hold lifted while a finger is
down on something that is not a pad keeps its scope until that finger lifts
too — otherwise the next drag frame wrote `vm.<fn>` and moved the WHOLE KIT
at the pad's value, a ghost FX tile loaded its effect onto the track, and
the pane unmounted under the finger. Window `pointerdown` / `pointerup` /
`pointercancel` listeners in the **capture** phase feed `glassPointers`
(`pointerDown` / `pointerUp` on the store, which is what the tests drive); a
pad tile's own finger is counted like any other and discounted because it is
in `holds`, so what makes a pointer an EDITING one is that it is not holding
a pad. `heldNotes` falls back to `pinnedScopes` when nothing is pressed or
latched, which is the whole fix: `scopeNote`, `writeScoped`,
`activeDrumRackScope` (so the FX grid, the pane and `sequencerStore`), the
lit tile and the pad rows all follow without knowing. Taken at the FIRST
lift with the scope as it stood including the pad going, and not overwritten,
so a two-pad edit keeps its multi-pad delta; a TAP is exempt (it either
latches or deliberately unlatches, and neither is a gesture interrupted); a
pad pressed again DROPS the pin rather than releasing it, so `padLocal`
carries into the new hold. `padLocal` and the pane are deferred to the pin's
end. It cannot stick: the last editing pointer, a `pointercancel`,
`clearPointers()` on `window.blur` (an up that never arrives when the app
goes to the background mid-drag), `clear()` and `retainLatched` all drop it.
Momentary, never a latch — it dies with the finger that earned it.
Tests: `__tests__/unit/stores/drumPadScope.test.ts`, and in a real browser
with two real contacts, `npm run multitouch -- --scenario
pad-hold-survives-the-lift` (which fails against the tree without the pin).

## The pad scope's pane, and scoped FX-grid slots (issue #491, 2026-09-10)

`drumPadScope` gained **`pane(devicePath)` / `setPane(devicePath, type)`**:
the device TYPE (`reverb`, `delay`, …) the Drum Rack view shows for the
scoped pad in place of its controls — never an instance, because the
scoped pad supplies the instance, so a momentary hold over a latch shows
the held pad's Reverb (ghosted if it has none). **Pane lifetime is scope
lifetime**: a release with nothing latched beneath, an unlatch, a latch
`retainLatched` drops and `clear()` all close it, and `setPane` under no
scope is refused. `services/deviceViewRouter.svelte.ts` is what sets it.

`fxGridStore` keeps **one slot table per pad path** beside the track's.
`getSlot(key, scope)` matches the slot's class + default name against
`selectedTrackStore.padDevices(scope)` — **presence decides which effects
the pad carries, the map supplies their records** (2026-09-12): each entry
of the rack's `vm.padFx` row is the v3 store's record from the pad's map
(`mergePadChain`) when the map has that class at that index, else a
stand-in built from presence, so a tile flips to active the instant a
finger lands and a drag already has a valid parameter path to write. The
map is fresh only while the pad's `vm.padChain.<note>` row is held;
presence is the rack's row and stays live while the rack is the selected
instrument, which is why it outranks a map for a pad that was held once,
let go, and changed in Live meanwhile (the first cut let an existing map
win, and a Reverb added that way read ghost until the cold read landed). `loadDevice(key, scope)` sends
`device/load` with the pad path as its target; `storePendingParam` and
the speculative store key on `${scope}|${slot}`; `checkLoadingCompletion`
reads the scope off the arriving device's path; `handleLoadFailed(path,
scope)` resets one scope; `resetForTrackChange` drops every scope. Slot
state is deliberately not cleared on release — a load outlives a
typical hold, so a finger that lifts before the device lands still gets
its load and its pending values on the pad; only what the grid displays
follows the finger. Tests: `stores/fxGridStore.scope.test.ts`,
`stores/padChain.test.ts`, `stores/drumPadScope.test.ts`. **Two rules from
the branch's code review (2026-09-11):** a pad map follows its rack — a
dropped track or device takes its maps with it, and every whole-song
replace and scoped merge prunes maps whose rack path no longer holds a
`DrumGroupDevice` — and a pad with a load in flight keeps its chain row
subscribed after the finger lifts (`fxGrid.loadingPadScopes()`, held from
the store's own effect root — `watchLoadingPads`, diffed per pad — so no
section has to be on screen), because the load completes against the pad's
map and the map only refreshes while the row is held. **That hold lives
only while the rack still sits at its path** (2026-09-12): the surface tears
a property row down when something else lands at its path and tells the UI
nothing, so a hold that survived the transit pinned the manager's count and
the FX grid's own release/re-acquire around it (2→1→2) never sent the
subscribe the surface needed. Dropped while the rack is away and taken
again when it returns, the count passes through zero and the wire follows.
