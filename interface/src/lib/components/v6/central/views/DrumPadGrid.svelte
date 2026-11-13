<script lang="ts">
  /**
   * DrumPadGrid — the Drum Rack's pads, beside its controls.
   *
   * **Live's sixteen, where Live has them** (2026-11-13, the user's call):
   * the pads Live's rack is showing (`vm.padScroll`, its visible window),
   * four rows of four consecutive notes, the lowest along the bottom, left
   * to right — every one drawn, an empty pad as an empty tile, so a pad is
   * always in the same place and the muscle memory is Live's. Every other
   * pad the kit holds, and a selected or held pad outside the window, sits
   * in columns to the RIGHT of the sixteen, in the same reading order; the
   * grid widens by half of what those columns would take at full size and
   * the tiles shrink into the rest. The geometry is `padRackGrid`; this
   * component draws what it decides.
   *
   * This reverses 2026-09-09, when the grid drew only the pads in play
   * (the playing clip's, the selection, the holds) stacked four to a
   * column — which moved a pad whenever the clip changed, and left any
   * other pad out of reach. Before that it was this same Live layout,
   * paged with two arrows; now the window follows Live's own scroll and
   * the rest of the kit is always on screen.
   *
   * HOLD SCOPES, LIFT RETURNS. Touch-down on a tile is reported at once
   * (`onPress`) and the parent selects the pad in Live and scopes its
   * controls to the held pads; touch-up (`onRelease`) returns them to the
   * kit. A tap and a hold are one gesture at two lengths — there is no
   * mode to forget. Each finger is its own pointer, captured on its tile,
   * so two or three pads can be held at once and released independently.
   * The grid is never a target for a drag: `touch-action: none` and no
   * pointermove.
   *
   * `litNotes` are the pads the playing clip's playhead just crossed, which
   * flash for `PAD_FLASH_MS`.
   *
   * COLOUR (2026-09-08). A tile is FILLED with its pad's chain colour —
   * the colour Live paints the pad with, carried on the census as
   * `color` — the way the rack itself is, with the label in whichever of
   * dark or light text that fill leaves readable (`padTextCss`). At rest
   * the fill is slightly dimmed; Live's selection brings it to full and
   * frames it; a held pad brightens and takes a thicker frame; a
   * triggered pad flashes brighter still. A pad Live left uncoloured
   * keeps the well and the track's ink.
   */
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import type { MomentaryReleaseReason } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
  import type { TinySequencerState } from '$lib/components/v6/tracks/composables/useTinySequencer.svelte';
  import PadStepStrip from './drum/PadStepStrip.svelte';
  import {
    padTileLabels,
    padColorCss,
    padTextCss,
    PAD_PAGE_COLUMNS,
    type PadGridSlot,
    type VmPad
  } from '$lib/services/drumVirtualMacros';

  interface Props {
    /** Where every tile goes (`padRackGrid`): Live's window, then the extras. */
    grid: { slots: readonly PadGridSlot[]; columns: number; rows: number };
    /** The whole kit (the census), which the labels are decided over. */
    pads: readonly VmPad[];
    /** Live's selected pad (`vm.selectedPad`), or null. */
    selectedNote?: number | null;
    /** The pads currently held on this device, in press order. */
    heldNotes?: readonly number[];
    color: DeviceColorScheme;
    /** Pads the playhead just crossed (flashing). */
    litNotes?: ReadonlySet<number>;
    /** ADR-435: the pads that carry a Permute of their own, with what it is doing — drawn as a step strip on the tile. */
    padSequencers?: ReadonlyMap<number, TinySequencerState>;
    onPress?: (note: number, pointerId: number) => void;
    onRelease?: (pointerId: number, reason: MomentaryReleaseReason) => void;
  }

  let {
    grid,
    pads,
    selectedNote = null,
    heldNotes = [],
    color,
    litNotes = new Set<number>(),
    padSequencers = new Map<number, TinySequencerState>(),
    onPress,
    onRelease
  }: Props = $props();

  // The extras sit past a zero-width track, so the gap either side of it
  // doubles: Live's sixteen read as one block, the rest beside it.
  let extraColumns = $derived(grid.columns - PAD_PAGE_COLUMNS);
  let template = $derived(
    extraColumns > 0
      ? `repeat(${PAD_PAGE_COLUMNS}, minmax(0, 1fr)) 0px repeat(${extraColumns}, minmax(0, 1fr))`
      : `repeat(${grid.columns}, minmax(0, 1fr))`
  );
  const columnLine = (column: number) => (column > PAD_PAGE_COLUMNS ? column + 1 : column);

  // The width SPLITS THE DIFFERENCE (the user's call, 2026-11-13): Live's
  // sixteen are four 68px columns; a kit with more pads gets a grid
  // halfway between that and every column at 68px, so the tiles shrink
  // but stay a finger's width (a 32-pad kit: ~50px tiles in 430px, not
  // ~32px in 284px or 68px in 576px). The label scales with the tile.
  const COL_W = 68;
  const GAP = 4;
  let gaps = $derived((grid.columns - 1 + (extraColumns > 0 ? 1 : 0)) * GAP);
  let gridWidth = $derived.by(() => {
    const live = PAD_PAGE_COLUMNS * COL_W + (PAD_PAGE_COLUMNS - 1) * GAP;
    if (extraColumns <= 0) return live;
    return Math.round((live + grid.columns * COL_W + gaps) / 2);
  });
  let fontPx = $derived(Math.max(9, Math.min(13, Math.round((13 * (gridWidth - gaps)) / grid.columns / COL_W))));

  // Labels are decided for the kit at once: shared words dropped, a name
  // that says nothing replaced by the note, a name two pads share given
  // the note as a second line. Decided over the WHOLE kit, not the pads
  // on screen, so a tile does not rename itself when a clip changes which
  // of its neighbours are drawn.
  let labels = $derived(padTileLabels(pads));
  let held = $derived(new Set(heldNotes));

  function press(event: PointerEvent, note: number) {
    // Capture per pointer, so the release lands here even if the finger
    // wanders off the tile — and so a second finger on another tile is
    // its own gesture.
    const el = event.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* a synthetic event without a pointer id */
    }
    event.preventDefault();
    onPress?.(note, event.pointerId);
  }

  // WHY a press ended decides what it meant (2026-09-09): a clean `up`
  // under the hold threshold latches, anything else restores. `pointerup`
  // fires before `lostpointercapture` on a normal release, so the tap wins
  // and the capture-release that follows finds the hold already gone.
  function release(event: PointerEvent, reason: MomentaryReleaseReason = 'up') {
    onRelease?.(event.pointerId, reason);
  }
</script>

{#if grid.slots.length}
<div
  class="pad-grid"
  data-pads={grid.slots.length}
  data-columns={grid.columns}
  style="--pad-ink: {color.primary}; --pad-rows: {grid.rows}; --pad-template: {template}; --pad-font: {fontPx}px; --pad-grid-w: {gridWidth}px;"
>
  <div class="pad-tiles" role="group" aria-label="Pads">
    {#each grid.slots as slot (slot.note)}
      <button
        type="button"
        class="pad-tile"
        class:pad-selected={selectedNote === slot.note}
        class:pad-held={held.has(slot.note)}
        class:pad-lit={litNotes.has(slot.note)}
        class:pad-empty={slot.pad === null}
        data-note={slot.note}
        data-extra={slot.extra ? '' : undefined}
        class:pad-colored={slot.pad !== null && slot.pad.color !== null}
        style="grid-column: {columnLine(slot.column)}; grid-row: {slot.row};{slot.pad &&
        slot.pad.color !== null
          ? ` --pad-fill: ${padColorCss(slot.pad)}; --pad-fg: ${padTextCss(slot.pad.color)};`
          : ''}"
        aria-label={slot.pad ? `${slot.pad.name || 'Pad'} (${slot.note})` : `Empty pad ${slot.note}`}
        aria-pressed={held.has(slot.note)}
        onpointerdown={(e) => press(e, slot.note)}
        onpointerup={(e) => release(e, 'up')}
        onpointercancel={(e) => release(e, 'cancel')}
        onlostpointercapture={(e) => release(e, 'cancel')}
        oncontextmenu={(e) => e.preventDefault()}
      >
        {#if slot.pad}
          {@const text = labels.get(slot.note)}
          {@const seq = padSequencers.get(slot.note)}
          <span class="pad-label">{text?.label ?? ''}</span>
          {#if text?.sub}<span class="pad-sub">{text.sub}</span>{/if}
          {#if seq}<PadStepStrip state={seq} />{/if}
        {:else}
          <span class="pad-label"></span>
        {/if}
      </button>
    {/each}
  </div>
</div>
{/if}

<style>
  /* Live's four columns at 68px each; a kit with more pads widens it by
     half of what its extra columns would take at full size, and the tiles
     shrink into the rest (`gridWidth`, the user's call, 2026-11-13). */
  .pad-grid {
    flex: 0 0 var(--pad-grid-w, 284px);
    /* The same figure as a width, for a host that sizes its column off the
       content rather than a flex basis — the Drum Rack's lead grid, whose
       pads column is `auto` (2026-09-16). */
    width: var(--pad-grid-w, 284px);
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  /* Explicit rows and columns; every tile places itself (`padRackGrid`),
     Live's way: rows of four, the lowest note bottom-left. The rows are
     `1fr` and uncapped, so the tiles fill whatever height the central
     section gives them. */
  .pad-tiles {
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-rows: repeat(var(--pad-rows, 4), minmax(0, 1fr));
    grid-template-columns: var(--pad-template);
    gap: 4px;
  }
  .pad-tile {
    position: relative;
    min-width: 0;
    min-height: 0;
    padding: 2px 3px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    color: var(--pad-ink, var(--foreground));
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.02em;
    line-height: 1.1;
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
    transition:
      background-color 110ms ease-out,
      filter 110ms ease-out;
  }
  /* 13px on Live's four columns, smaller as extra columns narrow the tiles. */
  .pad-tile {
    font-size: var(--pad-font, 13px);
  }
  .pad-tile.pad-empty {
    color: var(--signal-dim);
    background: transparent;
    border-style: dashed;
    opacity: var(--opacity-ghost);
  }
  /* Live's selection: a frame of the ink. Held or latched: a solid block
     of it, like an active FX-type pad — the finger is on it and the
     controls are its — wearing the ON ring below. */
  .pad-tile.pad-selected {
    border-color: var(--pad-ink, var(--phosphor));
    box-shadow: inset 0 0 0 1px var(--pad-ink, var(--phosphor));
  }
  .pad-tile.pad-held {
    background: var(--pad-ink, var(--phosphor));
    border-color: var(--phosphor);
    color: var(--flat-clip-text, var(--background));
    opacity: 1;
    box-shadow:
      inset 0 0 0 4px var(--phosphor),
      inset 0 0 0 5px var(--flat-clip-text, var(--background));
  }
  /* Triggered: the ink, lifted — on for PAD_FLASH_MS, then the transition
     above lets it fall back. A held pad that is also triggered brightens. */
  .pad-tile.pad-lit {
    background: var(--pad-ink, var(--phosphor));
    border-color: var(--pad-ink, var(--phosphor));
    color: var(--flat-clip-text, var(--background));
    filter: brightness(1.35);
    opacity: 1;
  }
  /* A pad Live coloured: the fill IS the colour, as in the rack. States
     ride brightness and a frame in the text colour, which the fill
     already guarantees is readable against it. */
  .pad-tile.pad-colored {
    background: var(--pad-fill);
    border-color: color-mix(in oklab, var(--pad-fill) 70%, black);
    color: var(--pad-fg);
    filter: brightness(0.82);
  }
  .pad-tile.pad-colored.pad-selected {
    filter: brightness(1);
    box-shadow: inset 0 0 0 2px var(--pad-fg);
  }
  /* Held or latched: the ON ring — the phosphor, the colour a switch that
     is on wears everywhere else — 4px inside the edge, with a 1px hairline
     of the text colour inside it so the ring reads on a pad of any colour,
     the phosphor's own included. It used to be a 3px frame in the text
     colour alone, which on a white pad was a black outline and nothing
     else (user, 2026-09-10). */
  .pad-tile.pad-colored.pad-held {
    background: var(--pad-fill);
    border-color: var(--phosphor);
    color: var(--pad-fg);
    filter: brightness(1.15);
    box-shadow:
      inset 0 0 0 4px var(--phosphor),
      inset 0 0 0 5px var(--pad-fg);
  }
  .pad-tile.pad-colored.pad-lit {
    background: var(--pad-fill);
    border-color: var(--pad-fg);
    color: var(--pad-fg);
    filter: brightness(1.5);
  }
  /* The name wraps to two lines rather than clipping (user's call,
     2026-09-08: "TOM: To" was "TOM: Tom 1" cut off). */
  .pad-label {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.15;
    text-align: center;
  }
  /* The note name under a label two pads share. */
  .pad-sub {
    display: block;
    margin-top: 1px;
    font-size: 9px;
    letter-spacing: 0.06em;
    opacity: 0.8;
  }
</style>
