# FX Device Controls

When adding new FX device controls, refer to the comprehensive guide:

📖 **[Adding Device Guide](../../../../../../documentation/adding-device-guide.md)**

## Key Points for Device Controls:

### Tap-to-Load Support
All controls use the modular `handleTap` from BaseDeviceControl:

```svelte
<BaseDeviceControl slotKey="echo" {device} title="Echo">
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, openView, isGhost, isLoading, color })}
    <DeviceXY
      onTap={handleTap}  <!-- Simple: just pass the function -->
      onInteraction={(x, y) => {
        openView();      // the view follows the gesture; a no-op once it is up
        // parameter control logic
      }}
    />
  {/snippet}
</BaseDeviceControl>
```

`handleTap` automatically:
- **Opens the device's central view** through `openView()` — the
  top-level device view, or the Drum Rack view's pane while a pad is
  scoped (issue #491; see "The pad scope" below). Never call
  `centralDisplayStore.setView('device', …)` from a tile yourself.
- **Selects the device** in Live (the blue hand) when the slot has one.
- **Never loads.** A ghost tile loads on its **first drag frame**
  (`triggerLoad`, called from `onInteraction`), not on a tap — ADR-167.
  This line used to say the opposite; a tile whose tap should load is a
  design change, not a forgotten call.

A tile whose type has no registered view passes
`disableCentralViewOnTap` (OTT is the one such tile, 2026-09-12): the
router resolves an unknown type to the placeholder view, which on master
would swap the System view out from under the tile.

### Component Types
- **DeviceXY**: For 2-parameter controls (most FX)
- **DeviceSlider**: For 1-parameter controls (Compressor, Variation, etc.)
- **Custom**: For complex controls (EQ, Sequencer)

See the full guide for complete implementation patterns, parameter mapping, and central view integration.

### The fx1 column — one slot, three track types (ADR-438)

**The grid is TWELVE columns, every cell placed explicitly** (2026-09-15, ADR-438 addendum). `fxGridLayout.ts` gives each entry `col` / `row` / `span` / `rowSpan`; `cellFor(slot, kind)` moves two of them on audio, and `SQUASH_CELL` / `AUDIO_GUITAR_CELL` place the two tiles with no entry. **MIDI and master:** Rand Oct (OTT on master) and Variation full height in columns 1–2, the four XY pairs over the other four in 3–10, Squash and Gain full height in 11–12. **Audio:** the Guitar full height in column 1, the Bass (in fx1's slot) over Variation in column 2, the rest identical. Both kinds tile the same 12×2 grid, so the XY tiles and the TotalMix status strip's ruler in `layouts/default/Layout.svelte` (hard-coupled to the column count, no shared constant) never move when the track changes kind; `FXGrid.scope.test.ts` pins the tiling for both.

`fx1` holds a different control per track type, and on audio the Guitar joins the left edge. All three branches live in `FXGrid.svelte`, and none of the three has a `fxGridLayout` entry except the MIDI one:

- **MIDI → Rand Oct**, the layout entry's own `RandomControl`.
- **Audio → `BassControl.svelte`** when `selectedTrackStore.trackType === 'audio'`. The `bass` slot — the `Bass Amp.adg` rack — param **1**, its one macro (the mix), rail 0..127, resting at **0** (see the fill note below). It is the one device on the grid that is *only* useful on audio: `fxGridStore.loadDevice` renames the track "Bass" on an audio track and leaves a MIDI track's name alone. `slotKey="bass"`, like Squash and OTT.
- **Master → `OttControl.svelte`** when `selectedTrackStore.trackIndex === -1` (master reports neither `hasMidiInput` nor `hasAudioInput`, so `trackType` is `null` there and the audio branch never catches it). The **Multiband Dynamics** Amount knob — param **6** (`GlobalAmount`, rail 0..1), measured off the `.adv`; the device's nested `<SideChain>` sits at child 60, after every flat param, so nothing at or below 6 drifts the way `Compressor2`'s indices do. It goes through the FX-grid slot (`slotKey="ott"`), so a master carrying no Multiband Dynamics yet shows a ghost the first DRAG loads — a tap opens nothing (`ott` has no registered view, so the tile passes `disableCentralViewOnTap`; before 2026-09-12 a tap swapped the System view for the placeholder). Master-only by construction: no layout entry, so this branch is its only mount. It replaced `MasterRackControl.svelte` (deleted), which drove the first *named* macro of an Audio Effect Rack called `Mastering` — not how this rig masters any more (user's call). `AudioEffectRackCentralView` is untouched and still reachable from its own tiles.

**Squash and Gain are separate full-height columns** (11 and 12): `SquashControl.svelte` (the Glue Compressor's threshold + makeup on one 0..1 slider, indices 1 and 3 measured off the `.adv`, no layout entry, resolving its own `squash` slot through `slotKey`) and the Gain tile. A tap on Squash opens the Gain / Utility view (registered as `device/squash`). They shared one split column from 2026-09-10 until the twelve-column refinement.

**Three tiles left the grid with the ten-column cut**, and only one of them moved:

- **The instrument slider** (`InstrumentControl.svelte` + `config/instrumentSliderMap.ts`) — **deleted**. It drove one expressive parameter of the selected track's instrument and opened that instrument's central view on tap (ADR-383). The track strip's **device band** (`TrackDeviceView`, `data-section="device"`, PR #496) took the tap-to-open job on every track at once; the parameter is in the instrument's own view. Adding a new instrument type now needs no grid work — give it a `config/instrumentGlanceMap.ts` entry so the band draws its controls.
- **`ClipPitchControl.svelte`** — **deleted**. It was the focused clip's absolute `pitch_coarse` as a −12..+12 semitone slider on the same store and setter as ClipCentralView's PITCH column (`clipPropertiesStore.pitchCoarse` / `setAudioClipPitch`) — a literal second copy, and the strip's Clip band opens that view in one tap. It was the audio candidate to cut for exactly that reason; the Bass stayed because it is a door as well as a control, and Variation because Beat Repeat is an audio effect.
- **`GuitarControl.svelte` (`fx2`) — MOVED, not deleted.** It is the last column of `PedalCentralView` now, and on **audio** tracks only it is also back on the grid as the full-height first column (no layout entry, `AUDIO_GUITAR_CELL`), mounted standalone the way `SaturatorControl` has been since ADR-431 — same distortion family, and the Pedal view is where a hand already goes for drive. It keeps `slotKey="guitar"`, so it keeps its ghost state and its drag-to-load, which is why it is the tile and not a bare fader. **Its tap is NOT disabled**, unlike the Saturator beside it: the Saturator is home in that view and the Guitar is not. After `fx2` left the grid this mount is the **only** door to `GuitarCentralView` on a MIDI track — the audio track's device band opens its chain *head's* view (an Auto Filter on the guitar track), and the Bass tile answers only on audio. `GuitarCentralView` also draws **Macro 1** now (a dedicated `drivePanel` snippet ahead of the dynamic layout, kept out of `buildMacroLayout`, which runs over 2-8); it had skipped it while the grid tile owned it.

A tap on the Bass tile opens **`GuitarCentralView`**, which `viewRegistry` aliases to `bass` for the purpose — the Bass panel beside the Guitar rack's macros IS this slot, carrying the same fader plus the Amp and +12 toggles the tile has no room for. The alias is required, not cosmetic: an unregistered type resolves to the placeholder view (the defect a830a7a fixed for `random` and the 2026-09-12 review caught on `ott`).

**Gtr and Bass draw the ordinary coloured fill (user, 2026-09-15).** Both had borrowed GAIN's split handle line, which made three of the grid's tiles read in a grammar the rest of them don't. **Gain cannot do otherwise:** its cell IS the track's meter (`track` on the `DeviceSlider`, which forces `showHandleLine` and suppresses `showFill`), so the fill is spoken for and the line is the only way left to show where the fader sits. A plain 0..127 drive or a 0..1 mix has its fill free. **This is why Bass rests at 0 rather than the 1.0 the preset stores:** as a fill, a cold slot at the ceiling painted the whole cell solid orange, which reads as a lit state rather than a value at the top of its rail. Every fill tile on this grid rests at the floor; that is the rule the exception was breaking. The rest value is only the cold read — once the slot has a device the slider shows whatever Live has.

**`useBassChainPosition` (`central/useBassChainPosition.svelte.ts`) is shared by both faces.** A browser load lands at the END of the chain and the Bass belongs at its head, so the gesture that might load arms a one-shot move that fires when the device arrives — the UI-layer twin of `WahPedalComponent._pending_move_to_top`. It was a local `let` + `$effect` in `GuitarCentralView` until the tile needed the same twenty lines. **Arm only where a load can actually follow**: the tile arms in `onInteraction` and *not* on tap, because a tap loads nothing (ADR-167) and a latch left standing would fire on the next bass device to arrive from anywhere, including one dragged in by hand.

**Grid re-deal history.** 2026-08-22: Pitch-Helix left the grid (its central view is still registered and reachable) and the Saturator took a tile for two weeks; `fx1`/`fx2` swapped so `RandomControl` held the tall column and `GuitarControl` the single cell. 2026-09-10 (ADR-431): **the Drum Buss took that tile** — `DrumBussControl.svelte` (`fx6`, transients across, dry/wet up — the Drum XY the instrument-view rail carried, ADR-424; the rail is deleted) opens `DrumBussCentralView` (the Comp switch + the Boom XY) — and **the Saturator went back into `PedalCentralView`** as its XY plus its four parameters on faders; `SaturatorCentralView` is gone and `device/saturator` is no longer registered. Same day, Squash took the top of the Gain column. The Drum tile is `padScoped` (since 2026-09-11; it shipped inert under a scope for a day) — a kick with its own Drum Buss is the ordinary case, and the insert-by-name path puts one straight into the pad's chain.

Row 1 now reads **fx1 · EQ · Filter · Pedal · Drum · Squash-over-Gain**; row 2 reads **Var · Chorus · Tremolo · Echo · Reverb** (plus the Gain column). The Pedal view is six columns: digital · redux · saturator XY · saturator faders · pedal-type tabs · **guitar drive**.

### Parameter reads (post-ADR-359)

**Read with `paramValueArmed`, not `paramValue`. No component-local `$state` shadows.**

```svelte
let cutoffValue = $derived(
  device
    ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 1)) ?? 1
    : 1
);
```

The armed-aware reader returns the UI's last-written value during a drag's round-trip and the v3 store value otherwise. Pre-load FX-grid gestures land in the store via `fxGridStore`'s new-device hook before any reactive consumer can observe the device-arrival, so the read above is consistent across pre-load → post-load handoff.

**Don't write `param1Value = x` inside `onInteraction`.** With `$derived` reads the assignment is invalid; the `sendParam` (or `selectedTrackStore.setParamValue`) call below it already arms+writes the store. The `$derived` re-runs and the visual updates.

**Lossy controls (Echo time, Pitch step) snap to the actual quantized value** during drag. ADR-140's component-local-state trick that hid this is gone — the new behavior matches what Live actually applied. The arm prevents the visual from jumping on the surface's confirmation echo; the snap happens because subsequent finger frames send new (unquantized) inputs that the surface keeps quantizing.
### The pad scope (issue #491, 2026-09-10)

While a pad is held or latched on the selected track's Drum Rack, **the
grid is that pad's**. `FXGrid.svelte` provides the `fxScope` context
(`central/fxScope.ts`, a getter — the scoped pad can move under a
mounted tile) from `activeDrumRackScope()`, subscribes the rack's
`vm.padFx` presence row so the flip is instant at touch-down, subscribes
the scoped pad's own `vm.padChain.<note>` row for exactly as long as it
is scoped (the surface answers with the pad's D/P bundle and keeps its
values live; refcounted with the Drum Rack view, which holds the same
row for its pane — keyed on the rack path and note, never on the scope
object, which a census re-emit rebuilds), draws a frame in the pad's
ink (an `outline` drawn INSIDE the box — the FX section scrolls, so
anything outside it is clipped) and a **scope chip** naming the pad,
absolutely placed so it takes no cell from the tiles (a pad Live left
uncoloured would otherwise leave the grid looking unchanged while
meaning something else). Tiles keep their family inks (ADR-400).

**`FXGrid` resolves every tile's `device` prop against the scope too**
(`getFxGridSlot(position, scopeKey)`, 2026-09-11): a tile derives the
values it draws from that prop, and the first cut resolved it against
the track only — so under a held pad the XY showed the track's device
(or the defaults) while `BaseDeviceControl` wrote to the pad's, and
every release snapped the dot home; Live had the right value the whole
time. Reads and writes must resolve the same record.
`BaseDeviceControl` reads the scope: its slot is
`getFxGridSlot(key, padPath)`, `triggerLoad` loads INTO the pad,
`storePendingParam` queues in the pad's slot table, and **`openView()`**
— a new snippet parameter every control now calls instead of
`centralDisplayStore.setView('device', …)` — goes through
`services/deviceViewRouter.svelte.ts`, which sets the Drum Rack view's
pane under a scope and swaps the top-level view otherwise. A preset
without `padScoped: true` wears `.device-unscoped` under a scope:
ghost-dimmed, inert — since 2026-09-11 that is Permute alone; every
grid tile may live on a pad. The amp racks and plug-in presets load
through the browser and are moved into the chain, a MIDI effect goes in
after the MIDI effects already at the chain's head, directly before
the pad's instrument (which the surface finds by type, never by
position), a native device by name. Through the browser fallback a MIDI
effect transits the track at index 0, so the rack's path shifts for
~200 ms: the scope drops for that window (its latch is keyed on the
rack path, which returns) and the pad's records come from the
re-subscription's cold read rather than the composite — measured
2026-09-11; the by-name path has no such window.
A pad with a load in flight keeps its chain row subscribed after the
finger lifts (the store's `watchLoadingPads`, 2026-09-11): the load completes
against the pad's map, which only refreshes while the row is held, so a
lift inside the surface's 150 ms composite window used to leave the slot
`loading` until the timeout.
A track change clears every scope, so the grid is always the track's on
arrival (2026-09-11).
A pad held on the Move scopes the grid the same way (ADR-432): the hold
arrives from the surface and is pressed on `drumPadScope` as an external
hold, so no tile needs to know where the finger is.
`data-fx-scope` on the tile root carries the pad note for tests and
shot recipes.
