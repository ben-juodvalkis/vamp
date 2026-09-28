<script lang="ts">
  /**
   * DrumPadGrid — the pads in play, beside the Drum Rack controls.
   *
   * **The pads in play, and only those** (2026-09-09): the playing clip's,
   * Live's selected pad, and any pad a finger is holding. Names come from
   * the census (`vm.members.pads`), the highlight from `vm.selectedPad`.
   *
   * They STACK, and each column stacks **bottom-up** — the lowest note at
   * the foot, pitch climbing as the eye does, the way a rack reads. Up to
   * four down one column, a fifth starting a second rather than
   * rebalancing the first, so a column keeps its length as pads arrive
   * and a finger keeps its place (user's call, 2026-09-09;
   * `padGridShape` / `padGridCell`). The column is exactly as wide as its
   * columns need, which is what gives the controls beside it the rest,
   * and the tiles fill whatever height the section has: one pad on its
   * own is one full-height tile.
   *
   * This replaced Live's own pad view — four columns of consecutive
   * notes, lowest bottom-left, sixteen to a page with two arrows, so the
   * muscle memory would transfer. Sixteen tiles turned out to be small
   * and cluttered and mostly pads nothing was doing anything with. What
   * went with the paging: reaching an arbitrary pad from the interface.
   * A pad the clip does not play and Live has not selected is not drawn,
   * so it cannot be tapped or held; the way to it is Live's own rack, and
   * this follows.
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
   * `clipNotes` are the pitches the track's playing clip uses; `litNotes`
   * are the pads the playhead just crossed, which flash for
   * `PAD_FLASH_MS`. Nothing playing is not a special case — the grid is
   * then simply the selected pad.
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
    padGridShape,
    padGridNotes,
    padGridSlots,
    padGridCell,
    type VmPad
  } from '$lib/services/drumVirtualMacros';

  interface Props {
    pads: readonly VmPad[];
    /** Live's selected pad (`vm.selectedPad`), or null. */
    selectedNote?: number | null;
    /** The pads currently held on this device, in press order. */
    heldNotes?: readonly number[];
    color: DeviceColorScheme;
    /** The pitches the track's playing clip uses, ascending; null or empty = show the whole kit. */
    clipNotes?: readonly number[] | null;
    /** Pads the playhead just crossed (flashing). */
    litNotes?: ReadonlySet<number>;
    /** ADR-435: the pads that carry a Permute of their own, with what it is doing — drawn as a step strip on the tile. */
    padSequencers?: ReadonlyMap<number, TinySequencerState>;
    onPress?: (note: number, pointerId: number) => void;
    onRelease?: (pointerId: number, reason: MomentaryReleaseReason) => void;
  }

  let {
    pads,
    selectedNote = null,
    heldNotes = [],
    color,
    clipNotes = null,
    litNotes = new Set<number>(),
    padSequencers = new Map<number, TinySequencerState>(),
    onPress,
    onRelease
  }: Props = $props();

  // The pads in play: the clip's, Live's selection, and every held pad —
  // all three equals, no basis and no fallback. They stack, and each
  // column stacks BOTTOM-UP: the lowest note at the foot of the first
  // column, pitch climbing as the eye does. DOM order stays ascending
  // (it is the reading order for a screen reader, and what the tests
  // assert); `padGridCell` places each tile.
  let notes = $derived(padGridNotes(clipNotes, [selectedNote, ...heldNotes]));
  let slots = $derived(padGridSlots(pads, notes));
  let shape = $derived(padGridShape(slots.length));

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

{#if slots.length}
<div
  class="pad-grid"
  data-pads={slots.length}
  data-columns={shape.columns}
  style="--pad-ink: {color.primary}; --pad-columns: {shape.columns}; --pad-rows: {shape.rows};"
>
  <div class="pad-tiles" role="group" aria-label="Pads in play">
    {#each slots as slot, i (slot.note)}
      {@const cell = padGridCell(i, shape.rows)}
      <button
        type="button"
        class="pad-tile"
        class:pad-selected={selectedNote === slot.note}
        class:pad-held={held.has(slot.note)}
        class:pad-lit={litNotes.has(slot.note)}
        class:pad-empty={slot.pad === null}
        data-note={slot.note}
        class:pad-colored={slot.pad !== null && slot.pad.color !== null}
        style="grid-column: {cell.column}; grid-row: {cell.row};{slot.pad &&
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
  /* The column is exactly as wide as its columns need, and no wider: a
     fixed 200px for a fixed four columns was the old paged grid's, and
     with the grid down to the pads in play (2026-09-09) that would be
     mostly empty. One column is 68px, two 140px, three 212px — the
     controls beside it take whatever is left, which is the point of
     stacking before widening. */
  .pad-grid {
    --pad-col-w: 68px;
    --pad-grid-w: calc(var(--pad-columns, 1) * var(--pad-col-w) + (var(--pad-columns, 1) - 1) * 4px);
    flex: 0 0 var(--pad-grid-w);
    /* The same figure as a width, for a host that sizes its column off the
       content rather than a flex basis — the Drum Rack's lead grid, whose
       pads column is `auto` (2026-09-16). */
    width: var(--pad-grid-w);
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
  /* Explicit rows and columns; every tile places itself (`padGridCell`),
     which is what puts each column's lowest note on the BOTTOM row —
     partial columns included, where an auto column flow would have left a
     lone fifth pad at the top of its column, out of line with the note
     beside it.

     The rows are `1fr` and uncapped: the tiles fill whatever height the
     central section gives them, so one pad on its own is one full-height
     tile (user's call, 2026-09-09). */
  .pad-tiles {
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-rows: repeat(var(--pad-rows, 1), minmax(0, 1fr));
    grid-template-columns: repeat(var(--pad-columns, 1), minmax(0, 1fr));
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
  /* Few tiles, so each one carries a bigger label than the old sixteen
     could. */
  .pad-tile {
    font-size: 13px;
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
