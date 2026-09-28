<script lang="ts">
  import { FX_GRID_LAYOUT, SQUASH_CELL, AUDIO_GUITAR_CELL, cellFor, cellStyle } from '$lib/config/fxGridLayout';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BassControl from './BassControl.svelte';
  import GuitarControl from './GuitarControl.svelte';
  import OttControl from './OttControl.svelte';
  import SquashControl from './SquashControl.svelte';
  import { provideFxScope } from '$lib/components/v6/central/fxScope';
  import { usePadChainRows } from '$lib/components/v6/central/usePadChainRows.svelte';
  import { activeDrumRackScope, selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
  import { padTileLabel } from '$lib/services/drumVirtualMacros';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  /**
   * FX Grid - Data-driven layout from FX_GRID_LAYOUT configuration
   *
   * Architecture:
   * - Layout defined in fxGridLayout.ts (11 slots, explicit cells on a
   *   12-column ruler the TotalMix status strip in +page.svelte shares)
   * - Each slot has: position, deviceType, component, span, rowSpan, config
   * - `device` per slot is resolved via selectedTrackStore.getFxGridSlot
   *   (FXGridState), which reads v3 `devicesByPath` and matches on
   *   className+name from DEVICE_PRESETS. The legacy `slotRegistry`
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
  const scope = $derived(activeDrumRackScope());
  const scopeKey = $derived(scope?.padPath ?? '');

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

  // Squash and, on audio, the Guitar have full-height columns of their own
  // but no layout entry (the Bass and OTT tiles reach their slots the same
  // way), resolving `squash` / `guitar` through BaseDeviceControl's slotKey
  // path. Their cells are SQUASH_CELL and AUDIO_GUITAR_CELL.
  const squashDevice = $derived(selectedTrackStore.getFxGridSlot('squash', scopeKey).device);
  const guitarDevice = $derived(selectedTrackStore.getFxGridSlot('guitar', scopeKey).device);

  // Track kind decides two things (2026-09-15): what fx1 holds, and how the
  // two leftmost columns are arranged. MIDI: Rand Oct and Variation, each
  // full height. Audio: the Guitar full height, then the Bass (in fx1's
  // slot) over Variation. Both are twelve columns, so nothing to the right
  // moves when the selected track changes kind.
  const isAudioTrack = $derived(selectedTrackStore.trackType === 'audio');

  // Master takes OTT in that slot, for the same reason: no MIDI for Rand
  // Oct, and no clip of its own (the Mastering rack OTT replaced is the
  // tile's history, below).
  // Keyed off the track index, not trackType — master reports neither
  // hasMidiInput nor hasAudioInput, so trackType is null there.
  const isMasterTrack = $derived(selectedTrackStore.trackIndex === -1);
  const gridKind = $derived(isAudioTrack ? ('audio' as const) : ('midi' as const));

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
    scope && scope.color !== null ? trackInk(rgbToHex(scope.color), paintModeReactive()) : null
  );
  const scopeLabel = $derived(scope ? padTileLabel(scope.name) || `Pad ${scope.note}` : '');
</script>

<div class="w-full h-full" data-fx-scope={scope?.note} style={scopeInk ? `--scope-ink: ${scopeInk}` : undefined}>
  <!-- 12-column grid, 2 rows, every cell placed explicitly (cellFor in
       fxGridLayout.ts): the two leftmost columns are arranged differently
       on audio and MIDI, and auto-placement cannot do both from one DOM
       order. Squash and Gain are full height on every track; on MIDI so are
       Rand Oct and Variation, on audio the Guitar (2026-09-15).

       gap-2 (8px) is deliberate, on the app's interior ladder (16 frames a
       panel, 8 separates tiles inside one, 4 separates rows inside a tile).
       A DeviceXY fills its slot exactly - no inset - so this IS the ink-to-ink
       trough between two pads, and the pads are WELLS: their fill sits darker
       than the grid behind them, so the trough reads as the sheet they are cut
       into rather than as empty space between cards. Below ~6px that reading
       collapses and the two 1px hairlines merge into one doubled line.

       It is NOT bounded by label wrapping - "Rand Oct" going to two lines is
       fine, so do not treat the wrap point as a cap if you revisit this. -->
  <div class="h-full grid grid-cols-12 grid-rows-2 gap-2 fx-grid" class:fx-scoped={scope !== null}>
    {#if isAudioTrack}
      <!-- Audio: the Guitar rack's drive, full height at the far left
           (2026-09-15). On MIDI it is reached through the Pedal view's last
           column instead. GuitarControl resolves its own `guitar` slot. -->
      <div data-cell="guitar" data-col={AUDIO_GUITAR_CELL.col} data-row={AUDIO_GUITAR_CELL.row} data-span={AUDIO_GUITAR_CELL.span} data-row-span={AUDIO_GUITAR_CELL.rowSpan} style={cellStyle(AUDIO_GUITAR_CELL)}>
        <GuitarControl device={guitarDevice} />
      </div>
    {/if}
    {#each FX_GRID_LAYOUT as slot, i (slot.position)}
      {@const Component = slot.component}
      {@const cell = cellFor(slot, gridKind)}
      <div data-cell={slot.position} data-col={cell.col} data-row={cell.row} data-span={cell.span} data-row-span={cell.rowSpan} style={cellStyle(cell)}>
        {#if slot.position === 'fx1' && isMasterTrack}
          <!-- Master track: fx1 is the Multiband Dynamics Amount knob
               (OTT). It replaced the Mastering rack's first named macro on
               2026-09-11. Master-only: OttControl has no layout entry, so
               this branch is its only mount. -->
          <OttControl />
        {:else if slot.position === 'fx1' && isAudioTrack}
          <!-- Audio track: fx1 is the Bass, the one grid device only useful
               on audio, whose other face is the Bass panel in the Guitar
               view. Rand Oct is a MIDI-effect control and would sit inert
               here. BassControl resolves its own `bass` slot. -->
          <BassControl />
        {:else}
          <Component device={devices[i]} position={slot.position} />
        {/if}
      </div>
    {/each}
    <!-- Squash, the Glue Compressor's one-finger threshold + makeup: a
         full-height column of its own beside Gain since 2026-09-15 (it rode
         the top half of the Gain column from 2026-09-10). -->
    <div data-cell="squash" data-col={SQUASH_CELL.col} data-row={SQUASH_CELL.row} data-span={SQUASH_CELL.span} data-row-span={SQUASH_CELL.rowSpan} style={cellStyle(SQUASH_CELL)}>
      <SquashControl device={squashDevice} />
    </div>
    {#if scope}
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
     +page.svelte) and the grid fills it edge to edge, so anything painted
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
    right: 4px;
    z-index: 3;
    pointer-events: none;
  }
</style>
