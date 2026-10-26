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
- **Appoints the device** in Live (the blue hand) when the slot has one —
  and so does every drag frame, through `openView()`, so a controller
  following the hand follows the iPad. `fxChainStore.appoint` sends only
  when the surface's last report (`/looping/v3/device/appointed`) puts
  the hand elsewhere; a tap always sends. Not under a track hold.
- **Never loads.** A ghost tile loads on its **first drag frame**
  (`triggerLoad`, called from `onInteraction`), not on a tap — ADR-167.
  This line used to say the opposite; a tile whose tap should load is a
  design change, not a forgotten call.

A tile whose type has no registered view passes
`disableCentralViewOnTap`: the router resolves an unknown type to the
placeholder view.

### One definition per device control (ADR-479)

**A device's control lives in `deviceControls.ts` and nowhere else**: its
kind (XY, slider, the EQ's tone pad), the parameters it reads and writes,
the math, its rest values and how a preset file reads onto it. `ControlTile`
draws any entry as a live tile (`BaseDeviceControl` + `browser/FaceControl`),
and it is what the tiles (most tile files are one-line wrappers), the
chain overview's cells and the central views' mounts are; the browser's
preset tiles draw the same entry at the file's values. A tile that draws
something of its own (Reverb's portrait, Utility's meter) takes its
parameters and math from its entry. Never write a parameter index, a range
or a conversion in a component. The procedure is the `add-looping-device`
skill.

**A control may name a picture** (`picture`, `browser/devicePictures.ts`,
2026-10-26): a sketch of what the device does drawn behind it from the
values it shows — Echo's rings, a compressor's transfer curve, Redux's
stepped sine, Pedal's clipped sine, the Arpeggiator's run. Drawn on the chain
overview's cells and the browser's tiles (they provide `PICTURE_CONTEXT`),
never in a central view; a control's
`icon` (the Gtr, Bass and Wah racks' marks) follows the same rule.

### The FX section is the chain overview (ADR-485)

**The FX grid is gone (2026-10-26, the user's call).** The FX section is
`ChainOverview` alone: the selected track's chain (or a scoped pad's), one
cell per device, each drawing its tile, then the Recent ghosts and + Effect
(ADR-484); the track's Utility is the right sidebar's top row (ADR-482).
`FXGrid.svelte`, the grid/chain switch (`FxPanelSwitch`), the ten-column
placement (`col` / `row` / `span`, `cellFor`, the `*_CELL`s) and the Drum
cell's Chorus rule (`drumCell.svelte.ts`) went with it.

What stays: `fxGridLayout.ts` is the **slot table** (a position per device
type and the tile it is drawn with), which tiles, chain cells and central
views resolve their device through (`getFxGridSlot`, `useFxGridSlot`). A
position is a name, not a place. The tiles (`*Control.svelte`) are the chain
cells' faces. **Every device type has its own central view**, registered
under its `DEVICE_PRESETS` key, because a chain cell opens its device by
that key: a view draws its own device and no other. A view for a device the
track does not hold is reached only by loading one (a Recent button, the
browser); its controls are ghosts until then.

**Gtr and Bass draw the ordinary coloured fill (user, 2026-09-15).** Gain
cannot: its cell IS the track's meter (`track` on the `DeviceSlider`), so
its line shows the fader. Bass rests at 0 rather than the 1.0 the preset
stores: a cold slot at the ceiling painted the whole cell solid, which reads
as a lit state. The rest value is only the cold read.

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
chain is that pad's**. `ChainOverview` provides the `fxScope` context
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

**Every tile's `device` prop is resolved against the scope too**
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
