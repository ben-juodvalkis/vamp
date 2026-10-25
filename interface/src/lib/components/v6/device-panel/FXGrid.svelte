<script lang="ts">
  import { FX_GRID_LAYOUT, SQUASH_CELL, PITCH_CELL, GLITCH_CELL, GUITAR_CELL, cellFor, cellStyle } from '$lib/config/fxGridLayout';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
  import { v3Store } from '$lib/stores/v3/normalized.svelte';
  import BassControl from './BassControl.svelte';
  import GuitarControl from './GuitarControl.svelte';
  import SquashControl from './SquashControl.svelte';
  import GlitchControl from './GlitchControl.svelte';
  import PitchControl from './PitchControl.svelte';
  import ChorusControl from './ChorusControl.svelte';
  import { drumCellHoldsChorus } from './drumCell.svelte';
  import { provideFxScope } from '$lib/components/v6/central/fxScope';
  import { usePadChainRows } from '$lib/components/v6/central/usePadChainRows.svelte';
  import { activeDrumRackScope, selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
  import { padTileLabel } from '$lib/services/drumVirtualMacros';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { DEVICE_PRESETS } from '$lib/config/devicePresets';
  import { pickSlotDevice, slotCandidates } from '$lib/utils/deviceSlotMatch';
  import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';

  /**
   * FX Grid - Data-driven layout from FX_GRID_LAYOUT configuration
   *
   * Architecture:
   * - Layout defined in fxGridLayout.ts (11 slots, explicit cells on a
   *   10-column ruler the TotalMix status strip in layouts/default/Layout.svelte shares)
   * - Each slot has: position, deviceType, component, span, rowSpan, config
   * - `device` per slot is resolved via selectedTrackStore.getFxGridSlot
   *   (FXGridState), which reads v3 `devicesByPath` and matches on
   *   the type first (the name only for racks, Max devices and plug-ins;
   *   utils/deviceSlotMatch, ADR-478) from DEVICE_PRESETS. The legacy `slotRegistry`
   *   sync path (v2 `handleDeviceList` / `handleCompleteDeviceState`)
   *   went away with closeout-2/3, leaving `slotRegistry.getSlot().device`
   *   permanently null — so we resolve directly from the live v3 tree.
   *
   * THE GRID IS THE HELD PAD'S (issue #491, 2026-09-10). While a pad is
   * held or latched on the selected track's Drum Rack, every tile below
   * resolves against that pad's chain: a tile reads ghost where the pad
   * has no such effect and active where it has one, a touch on a ghost
   * tile loads the effect INTO the pad's chain, a drag moves the pad's
   * copy alone. Lift the finger and the grid is the track's again. That
   * is the `fxScope` context, provided here as a getter — the scoped pad
   * can change while a tile is mid-gesture — and read by every
   * `BaseDeviceControl` (and, through the same hook, every effect view
   * the Drum Rack view's pane mounts). Effect presence for the flip comes
   * from the rack's `vm.padFx` row, subscribed whenever a Drum Rack is
   * the selected instrument so it is already here when a finger lands;
   * the pad's own records and values come from its `vm.padChain.<note>`
   * row, subscribed for exactly as long as the pad is scoped.
   *
   * A pad Live left uncoloured falls back to the track ink, so a scoped
   * grid could look unchanged while meaning something else: the **scope
   * chip** names the pad, in its chain colour, and the grid wears a frame
   * in that ink. Tiles keep their family inks (ADR-400: device colour is
   * module identity); the frame and the chip say whose they are.
   */

  // The held pad, if any, as the tiles' scope (issue #491). Declared
  // before the slot reads below because they resolve against it: a tile
  // reads its values off the `device` prop, and under a scope that has
  // to be the PAD's device — the same record BaseDeviceControl writes to
  // — or the pad's values never show and every release snaps the dot
  // back to the track's (found 2026-09-11 on the rig: an Auto Filter on
  // the kick pad moved in Live but its XY jumped home on every lift).
  // A held track strip (track hold) outranks a held pad: the grid is that
  // track's, top level, and no pad scope applies.
  const heldTracks = $derived(trackHoldScope.heldTracks());
  const heldTrack = $derived(heldTracks.length ? v3Store.tracks.get(heldTracks[0]) ?? null : null);
  const scope = $derived(heldTracks.length ? null : activeDrumRackScope());
  const scopeKey = $derived(scope?.padPath ?? trackHoldScope.scopeKey());

  const slot1Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[0].position, scopeKey).device);
  const slot2Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[1].position, scopeKey).device);
  const slot3Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[2].position, scopeKey).device);
  const slot4Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[3].position, scopeKey).device);
  const slot5Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[4].position, scopeKey).device);
  const slot6Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[5].position, scopeKey).device);
  const slot7Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[6].position, scopeKey).device);
  const slot8Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[7].position, scopeKey).device);
  const slot9Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[8].position, scopeKey).device);
  const slot10Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[9].position, scopeKey).device);
  const slot11Device = $derived(selectedTrackStore.getFxGridSlot(FX_GRID_LAYOUT[10].position, scopeKey).device);

  const devices = $derived([
    slot1Device, slot2Device, slot3Device, slot4Device, slot5Device,
    slot6Device, slot7Device, slot8Device, slot9Device, slot10Device,
    slot11Device
  ]);

  // Squash and the Guitar (every track but master) have cells of their own
  // but no layout entry (the Bass and OTT tiles reach their slots the same
  // way), resolving `squash` / `guitar` through BaseDeviceControl's slotKey
  // path. Their cells are SQUASH_CELL and GUITAR_CELL.
  const squashDevice = $derived(selectedTrackStore.getFxGridSlot('squash', scopeKey).device);
  // Glitch (2026-10-15) the same way: GLITCH_CELL; Pitch (2026-10-24): PITCH_CELL.
  const glitchLoopDevice = $derived(selectedTrackStore.getFxGridSlot('glitchLoop', scopeKey).device);
  const octaveDevice = $derived(selectedTrackStore.getFxGridSlot('octave', scopeKey).device);
  const guitarDevice = $derived(selectedTrackStore.getFxGridSlot('guitar', scopeKey).device);

  // Track kind decides two things (2026-09-15): what fx1 holds, and how the
  // leftmost column is arranged. MIDI: Rand Oct, full height. Audio: the
  // Bass (in fx1's slot) over the Guitar, since 2026-10-19. Both are ten
  // columns, so nothing to the right moves when the selected track changes
  // kind.
  // Under a track hold the HELD track's kind decides, so its Bass/Guitar
  // column is the one it has.
  const isAudioTrack = $derived(
    heldTrack
      ? !heldTrack.isFoldable && !heldTrack.hasMidiInput && heldTrack.hasAudioInput
      : selectedTrackStore.trackType === 'audio'
  );

  // Main is an audio track to the grid (2026-10-24, the user's call): Bass
  // over Gtr. Keyed off the track index, not trackType — Main reports
  // neither hasMidiInput nor hasAudioInput, so trackType is null there.
  const isMasterTrack = $derived(heldTrack ? heldTrack.trackPath === 'master' : selectedTrackStore.trackIndex === -1);
  const audioColumn = $derived(isAudioTrack || isMasterTrack);
  const gridKind = $derived(audioColumn ? ('audio' as const) : ('midi' as const));

  // The Drum cell holds the Chorus on any track that is not a drum track
  // (2026-10-23, the user's call; `drumCellHoldsChorus`). Chorus keeps its
  // own slot (fx9), so the swap is only which tile is drawn there.
  const chorusInDrumCell = $derived(drumCellHoldsChorus());
  const chorusIndex = FX_GRID_LAYOUT.findIndex((s) => s.position === 'fx9');

  provideFxScope(() => scope);

  // Effect presence per pad, ready before a finger lands (subscribed for
  // as long as a Drum Rack is the selected instrument), and the scoped
  // pad's own records for exactly as long as it is held or latched
  // (issue #491) — the same two rows the Drum Rack view holds for its
  // pane; the property manager refcounts them.
  usePadChainRows(() => selectedDrumRack()?.rackPath, () => scope?.note);

  // A pad with a load in flight keeps its chain row subscribed after the
  // finger lifts — held by the FX-grid store's own effect root
  // (`watchLoadingPads`), not here, so it needs no section on screen.

  const scopeInk = $derived(
    heldTrack
      ? trackInk(rgbToHex(heldTrack.color), paintModeReactive())
      : scope && scope.color !== null ? trackInk(rgbToHex(scope.color), paintModeReactive()) : null
  );
  const scopeLabel = $derived(
    heldTrack
      ? `${heldTrack.name}${heldTracks.length > 1 ? ` ×${heldTracks.length}` : ''}`
      : scope ? padTileLabel(scope.name) || `Pad ${scope.note}` : ''
  );
  const scoped = $derived(scope !== null || heldTrack !== null);

  /**
   * "1/2" on a tile whose type the track carries more than once: which of
   * them the tile controls, in chain order. The chain overview is where the
   * other one is picked. The track's own grid only — a scoped grid is a
   * pad's or another track's.
   */
  function multiOf(deviceType: string): string | null {
    if (scoped) return null;
    const config = DEVICE_PRESETS[deviceType];
    if (!config) return null;
    const trackDevices = selectedTrackStore.devicesByPath;
    const candidates = slotCandidates(trackDevices, config);
    if (candidates.length < 2) return null;
    const chosen = pickSlotDevice(trackDevices, config, fxChainStore.pickFor(selectedTrackStore.selectedTrackPath, deviceType));
    return `${candidates.indexOf(chosen!) + 1}/${candidates.length}`;
  }
</script>

<div class="w-full h-full" data-fx-scope={scope?.note} data-fx-track-scope={heldTrack?.trackPath} style={scopeInk ? `--scope-ink: ${scopeInk}` : undefined}>
  <!-- 10-column grid, 2 rows, every cell placed explicitly (cellFor in
       fxGridLayout.ts): the leftmost column is arranged differently on
       audio and MIDI, and auto-placement cannot do both from one DOM
       order. Column 1 is Rand Oct (MIDI) or the Bass (audio) over the Gtr,
       one empty cell on master; column 2 Pitch over the Saturator; three XYs
       a row; column 9 Glitch over Variation; column 10 Squash over Gain
       (2026-10-24). The Drum cell holds the Chorus on audio and non-drum
       tracks (ADR-465).

       gap-2 (8px) is deliberate, on the app's interior ladder (16 frames a
       panel, 8 separates tiles inside one, 4 separates rows inside a tile).
       A DeviceXY fills its slot exactly - no inset - so this IS the ink-to-ink
       trough between two pads, and the pads are WELLS: their fill sits darker
       than the grid behind them, so the trough reads as the sheet they are cut
       into rather than as empty space between cards. Below ~6px that reading
       collapses and the two 1px hairlines merge into one doubled line.

       It is NOT bounded by label wrapping - "Rand Oct" going to two lines is
       fine, so do not treat the wrap point as a cap if you revisit this. -->
  <div class="h-full grid grid-cols-10 grid-rows-2 gap-2 fx-grid" class:fx-scoped={scoped}>
    <!-- The Guitar rack's drive at the foot of column 1 on every track:
         under the Bass on audio (2026-10-19) and Main (2026-10-24), under
         Rand Oct on MIDI (2026-10-23). GuitarControl resolves its own
         `guitar` slot. -->
    <div data-cell="guitar" data-col={GUITAR_CELL.col} data-row={GUITAR_CELL.row} data-span={GUITAR_CELL.span} data-row-span={GUITAR_CELL.rowSpan} style={cellStyle(GUITAR_CELL)}>
      <GuitarControl device={guitarDevice} />
    </div>
    {#each FX_GRID_LAYOUT as slot, i (slot.position)}
      {#if !slot.hidden}
      {@const Component = slot.component}
      {@const cell = cellFor(slot, gridKind)}
      {@const multi = multiOf(slot.position === 'fx1' && audioColumn ? 'bass' : slot.position === 'fx6' && chorusInDrumCell ? 'chorus' : slot.deviceType)}
      <div data-cell={slot.position} data-col={cell.col} data-row={cell.row} data-span={cell.span} data-row-span={cell.rowSpan} style={cellStyle(cell)} class:has-multi={multi !== null}>
        {#if slot.position === 'fx1' && audioColumn}
          <!-- Audio track or Main: fx1 is the Bass. Rand Oct is a MIDI-effect
               control and would sit inert here. BassControl resolves its
               own `bass` slot. -->
          <BassControl />
        {:else if slot.position === 'fx6' && chorusInDrumCell}
          <!-- Not a drum track: the Chorus in the Drum's cell. -->
          <ChorusControl device={devices[chorusIndex]} position="fx9" />
        {:else}
          <Component device={devices[i]} position={slot.position} />
        {/if}
        {#if multi}
          <span class="pad-chip multi-chip" aria-label="Controls device {multi} of this type">{multi}</span>
        {/if}
      </div>
      {/if}
    {/each}
    <!-- Squash, the Glue Compressor's one-finger threshold + makeup: the
         top of the last column, over Gain (2026-10-15). -->
    <!-- Pitch (the Octave's Mix), column 2 over the Saturator, and Glitch
         (GlitchLoop's Dry/Wet), column 9 over Variation (2026-10-24). -->
    <div data-cell="pitch" data-col={PITCH_CELL.col} data-row={PITCH_CELL.row} data-span={PITCH_CELL.span} data-row-span={PITCH_CELL.rowSpan} style={cellStyle(PITCH_CELL)}>
      <PitchControl device={octaveDevice} />
    </div>
    <div data-cell="glitch" data-col={GLITCH_CELL.col} data-row={GLITCH_CELL.row} data-span={GLITCH_CELL.span} data-row-span={GLITCH_CELL.rowSpan} style={cellStyle(GLITCH_CELL)}>
      <GlitchControl device={glitchLoopDevice} />
    </div>
    <div data-cell="squash" data-col={SQUASH_CELL.col} data-row={SQUASH_CELL.row} data-span={SQUASH_CELL.span} data-row-span={SQUASH_CELL.rowSpan} style={cellStyle(SQUASH_CELL)}>
      <SquashControl device={squashDevice} />
    </div>
    {#if heldTrack}
      <!-- Track hold: whose grid this is while a strip is held, and how
           many tracks the controls fan out to. -->
      <div class="pad-chip fx-scope-chip" aria-label="FX grid scoped to track {heldTrack.name}">{scopeLabel}</div>
    {:else if scope}
      <!-- The scope chip: whose grid this is, while a pad is held or latched.
           Out of flow — a grid item, however placed, steals its cell from
           the auto-placed tiles and pushes them into a third row. The grid
           becomes its containing block ONLY while scoped: a permanent
           `position: relative` re-rasterised every coloured label on the
           page by a level or two, which the fixture diffs reported. -->
      <div class="pad-chip fx-scope-chip" aria-label="FX grid scoped to pad {scope.note}">{scopeLabel}</div>
    {/if}
  </div>
</div>

<style>
  /* Issue #491: under a pad scope the grid wears a frame in the pad's ink
     (the track's when Live left the pad uncoloured) — the tiles keep their
     family inks, so this and the chip are what say the grid is the pad's.
     An outline, not a border: it takes no layout and moves no tile. Drawn
     INSIDE the box — the FX section is a scroller (`overflow: auto` in
     layouts/default/Layout.svelte) and the grid fills it edge to edge, so anything painted
     outside the box is clipped; the first cut had a 3px offset and no
     frame ever reached a capture. */
  .fx-grid.fx-scoped {
    position: relative;
    outline: 2px solid var(--scope-ink, var(--track-ink, var(--phosphor)));
    outline-offset: -2px;
    border-radius: var(--radius-sm, 2px);
  }
  /* The chip's face is the global `.pad-chip` (app.css); where it sits and
     whose ink it wears — the pad's, else the track's — is the grid's. */
  .fx-scope-chip {
    --chip-ink: var(--scope-ink, var(--track-ink));
    position: absolute;
    top: 4px;
    /* Left of the FX section's switch (DevicesPanelV6). */
    right: calc(4px + var(--fx-switch-w, 0px));
    z-index: 3;
    pointer-events: none;
  }
  /* A tile controlling one of several of its type. Only these cells take a
     containing block, for the reason the scope comment above gives. */
  .has-multi {
    position: relative;
  }
  .multi-chip {
    position: absolute;
    bottom: 6px;
    right: 6px;
    z-index: 2;
    font-size: 10px;
    padding: 1px 6px;
    pointer-events: none;
  }
</style>
