<script lang="ts">
  /**
   * The chain's palette bar (ADR-523, ADR-547..549): a fixed set of effect
   * chips in family blocks above the chain, the same on every track of a
   * kind, closed by the chevron. Lives in `ChainOverview`'s grid: the bar
   * on its first row (or two at rest, `restRows`), and, while latched open,
   * `.palette-catch` over the chain so a touch there only closes it.
   */
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import PaletteChip from './PaletteChip.svelte';
  import { addEffectToChain, type ChainEffect } from '$lib/services/chainEffects.svelte';
  import { drag as dragGesture } from '$lib/actions/drag';
  import { press } from '$lib/actions/press';
  import { fitBlocks, PALETTE_ROWS, paletteBlocks, paletteColumns, paletteLabel, paletteTail, type PaletteKind } from '$lib/services/effectPalette';
  import { shouldRestoreOnRelease } from '../../tracks/TrackStrip/utils/momentaryPress';
  import { swallowNextClick } from '$lib/utils/swallowNextClick';
  import { DEVICE_FAMILY_INKS, type DeviceFamily } from '$lib/config/devicePresets';

  interface Props {
    /** Which effects: by the kind of track (or a pad's chain). */
    kind: PaletteKind;
    /** Rows of chips at rest: two while the chain is one row, one once it wraps. */
    restRows: number;
    /** Out: the bar is open over the chain, latched or held. */
    barOpen?: boolean;
  }

  let { kind, restRows, barOpen = $bindable(false) }: Props = $props();

  /*
   * The palette bar (the user, 2026-11-11; `services/effectPalette`): ghost
   * effects across the top in family blocks, each family's main effects on
   * the first row and its others under them, a seam between blocks. The
   * chain's own + is the way to anything else (the user, 2026-11-11). Which effects depends on the kind of track
   * alone; how many blocks fit on the width, chips at least
   * `PALETTE_TILE_MIN` wide (whole blocks, dropped from the end).
   */
  const PALETTE_TILE_MIN = 60;
  let paletteWidth = $state(0);
  /*
   * The bar is one row (ADR-548): its first row of chips and the chevron,
   * the chain under it taking the rest. The chevron opens it to four rows
   * and closes it, lit while open; a finger on a chip opens it for as long
   * as it is down: slide to any chip and let go to load it, and the bar
   * closes again. The bar has no way to the browser (Ben, 2026-11-18).
   * Open, held or latched, it lies over the chain, which never moves
   * (ADR-549); latched, a touch anywhere outside it closes it, and on the
   * chain (`.palette-catch`) presses nothing under it.
   */
  let paletteOpen = $state(false);
  let paletteEl = $state<HTMLElement | null>(null);
  /* The chevron is a press on the bar's own gesture, so its finger can
   * slide down onto a chip (Ben, 2026-11-20). It opens the bar at
   * finger-down. Let go on a chip and that chip loads; the bar then closes
   * unless it was latched before the press. Let go anywhere else and it is
   * Solo's rule (ADR-427): a tap latches, a hold past MOMENTARY_HOLD_MS (or
   * a slide that found no chip) closes it again. On an open bar the
   * chevron closes it, unless the finger slides off to load a chip. */
  let chevron: { wasOpen: boolean; downAt: number; held: boolean } | null = null;
  function onChevron(event: PointerEvent | null): boolean {
    return event?.target instanceof Element && !!event.target.closest('[data-debug="chain-add"]');
  }
  function startChevron() {
    swallowNextClick();
    chevron = { wasOpen: paletteOpen, downAt: Date.now(), held: false };
    paletteOpen = true;
  }
  function endChevron(reason: 'up' | 'cancel', moved: boolean) {
    if (!chevron) return;
    const { wasOpen, downAt } = chevron;
    chevron = null;
    const target = reason === 'up' ? hotChip : null;
    hotChip = null;
    if (target) {
      loadChip(target);
      paletteOpen = wasOpen;
    } else if (wasOpen) {
      paletteOpen = false;
    } else if (moved || shouldRestoreOnRelease({ elapsedMs: Date.now() - downAt, reason })) {
      paletteOpen = false;
    }
  }
  /** A keyboard press on the chevron (a pointer's press is the gesture's).
   *  Taken on keydown, not click: click is no input on the performance
   *  surface (ADR-427); preventing the default keeps the button from
   *  clicking as well. */
  function keyToggle(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    paletteOpen = !paletteOpen;
  }
  function closePalette() {
    swallowNextClick();
    paletteOpen = false;
  }
  /* Latched, the bar stays open until the chevron closes it or a touch
   * lands outside it (Ben, 2026-11-19). Outside the chain that touch also
   * does its own job (Record still records); on the chain, `.palette-catch`
   * takes it, so it only closes the bar. */
  $effect(() => {
    if (!paletteOpen) return;
    const onDown = (event: PointerEvent) => {
      if (paletteEl && event.target instanceof Node && paletteEl.contains(event.target)) return;
      paletteOpen = false;
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
  /* A tap loads the chip it lands on; a release off the
   * chips loads nothing. It opens on a short hold (a quick tap only loads)
   * or at once on a slide; 300ms felt laggy (Ben, 2026-11-18). One gesture
   * on the whole bar, so the chips take no press of their own and the
   * finger can cross them.
   */
  const PEEK_HOLD_MS = 120;
  let palettePeek = $state(false);
  let hotChip = $state<string | null>(null);
  let chipGesture = false;
  const isOpen = $derived(paletteOpen || palettePeek);
  // The chain under an open bar dims (the host's `.palette-open`).
  $effect.pre(() => {
    barOpen = isOpen;
  });
  /* At rest the bar shows two rows of chips while the chain fits one row,
   * and one once the chain wraps to two (Ben, 2026-11-20). The phone keeps
   * its one fixed row (CSS hides the second there). */
  const shownRows = $derived(isOpen ? PALETTE_ROWS : restRows);
  const chipById = $derived.by(() => {
    const map = new Map<string, ChainEffect>();
    for (const { block, start } of placed.blocks) {
      block.rows.forEach((row, r) => row.forEach((fx, i) => fx && map.set(`${r + 1}:${start + i}`, fx)));
    }
    for (const { fx, row } of placed.tailChips) if (fx) map.set(`${row}:${placed.tail}`, fx);
    return map;
  });
  function chipAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-chip-id]');
    return el?.dataset.chipId ?? null;
  }
  function loadChip(id: string | null) {
    const fx = id ? chipById.get(id) : undefined;
    if (fx) void addEffectToChain(fx);
  }
  function endChipGesture(load: boolean) {
    if (chipGesture && load) loadChip(hotChip);
    chipGesture = false;
    palettePeek = false;
    hotChip = null;
  }
  /** The blocks that fit, each placed: its first column, after the seams before it. */
  const placed = $derived.by(() => {
    const all = paletteBlocks(kind);
    const room = paletteColumns(paletteWidth, PALETTE_TILE_MIN, 0);
    // The chevron closes the bar, a chip's width, three chips under it.
    const blocks = paletteWidth > 0 ? fitBlocks(all, room - 1) : all;
    // One grid, no seams between the families: their washes divide them.
    let col = 1;
    const out = blocks.map((block) => {
      const start = col;
      col += block.cols;
      return { block, start };
    });
    const template = `repeat(${col}, minmax(0, 1fr))`;
    const tailChips = paletteTail().map((chip, i) => ({ ...chip, row: i + 2 }));
    return { blocks: out, template, tail: col, tailChips };
  });
  /** A chip's ink: its device's family colour, as the cell it would become wears it. */
  /* A chip's faint wash is its palette block's family colour (ADR-547):
     the raw table, since a preset's scheme answers with the track's ink. */
  const BLOCK_FAMILY: Record<string, DeviceFamily> = {
    midi: 'pitchSeq', guitar: 'guitar', tone: 'filter', dynamics: 'dynamics',
    distortion: 'distortion', modulation: 'modulation', glitch: 'glitch', time: 'timeSpace',
    utility: 'utility'
  };
  function chipInk(blockFamily: string): string | undefined {
    const family = BLOCK_FAMILY[blockFamily];
    return family ? DEVICE_FAMILY_INKS[family].primary : undefined;
  }
</script>

<!-- The palette bar: family blocks, a seam between them. Every chip in a
     fixed place; the + at its end opens the second and third rows, Gain
     beside it. -->
<div
  class="palette"
  class:open={isOpen}
  class:rest-two={restRows === 2}
  bind:this={paletteEl}
  bind:clientWidth={paletteWidth}
  style:grid-template-columns={placed.template}
  data-debug="chain-palette"
  data-palette-kind={kind}
  data-palette-open={isOpen}
  role="group"
  aria-label="Effects to add"
  use:dragGesture={{
    commit: 'either',
    holdMs: PEEK_HOLD_MS,
    onDown: ({ downX, downY, event }) => {
      if (onChevron(event)) {
        startChevron();
        hotChip = null;
        chipGesture = false;
        return;
      }
      hotChip = chipAt(downX, downY);
      chipGesture = hotChip !== null;
    },
    onHold: () => {
      if (chevron) chevron.held = true;
      else if (chipGesture) palettePeek = true;
    },
    onStart: ({ x, y }) => {
      if (chevron) hotChip = chipAt(x, y);
      else if (chipGesture) palettePeek = true;
    },
    onMove: ({ x, y }) => {
      if (chevron || chipGesture) hotChip = chipAt(x, y);
    },
    onTap: () => {
      if (chevron) endChevron('up', false);
      else endChipGesture(true);
    },
    onEnd: ({ reason }) => {
      if (chevron) endChevron(reason === 'up' ? 'up' : 'cancel', true);
      else endChipGesture(reason === 'up');
    },
    onPressEnd: ({ mode, event }) => {
      if (chevron) {
        // A hold let go without moving ends here; a quick tap ends in onTap.
        if (mode === 'undecided' && event?.type === 'pointerup' && chevron.held) endChevron('up', false);
        else if (mode === 'undecided' && event?.type === 'pointercancel') endChevron('cancel', false);
        return;
      }
      // A hold let go without moving: the release is here, not in onEnd.
      if (mode === 'undecided' && palettePeek && event?.type === 'pointerup') endChipGesture(true);
      else if (mode === 'undecided' && event?.type === 'pointercancel') endChipGesture(false);
    }
  }}
>
  {#each placed.blocks as { block, start } (block.family)}
    {#each block.rows.slice(0, shownRows) as row, r (r)}
      {#each Array.from({ length: block.cols }, (_, i) => row[i] ?? null) as fx, i (i)}
        <div class="palette-slot" class:rest-extra={!isOpen && r > 0} class:blank={!fx} class:family-head={r === 0} style:grid-column={start + i} style:grid-row={r + 1} data-family={block.family} data-chip-id={fx ? `${r + 1}:${start + i}` : undefined}>
          {#if fx}<PaletteChip {fx} label={paletteLabel(fx)} ink={chipInk(block.family)} passive hot={hotChip === `${r + 1}:${start + i}`} />{/if}
        </div>
      {/each}
    {/each}
  {/each}
  {#if shownRows > 1}
    {#each placed.tailChips.filter((c) => c.row <= shownRows) as { family, fx, row } (row)}
      <div class="palette-slot" class:rest-extra={!isOpen} class:blank={!fx} style:grid-column={placed.tail} style:grid-row={row} data-family={family} data-chip-id={fx ? `${row}:${placed.tail}` : undefined}>
        {#if fx}<PaletteChip {fx} label={paletteLabel(fx)} ink={chipInk(family)} passive hot={hotChip === `${row}:${placed.tail}`} />{/if}
      </div>
    {/each}
  {/if}
  <div class="palette-slot" style:grid-column={placed.tail} style:grid-row="1">
    <button
      type="button"
      class="chain-add palette-add"
      class:open={paletteOpen}
      aria-label={paletteOpen ? 'Fewer effects' : 'More effects'}
      aria-expanded={paletteOpen}
      data-debug="chain-add"
      onkeydown={keyToggle}
    >
      <span class="chain-add-plus" aria-hidden="true">{#if paletteOpen}<ChevronUp />{:else}<ChevronDown />{/if}</span>
    </button>
  </div>
</div>
{#if paletteOpen}
  <div
    class="palette-catch"
    aria-hidden="true"
    data-debug="chain-palette-catch"
    use:press={{ onPress: closePalette, touchAction: 'none', fireOn: 'down', stopPropagation: true }}
  ></div>
{/if}

<style>
  /* Two rows of chips at rest: the bar takes two sixths (the chain the
     other four), and an open bar still covers four, over the chain's first
     two rows. */
  .palette.rest-two {
    grid-row: 1 / span 2;
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  :global([data-phone-layout]) .palette.rest-two {
    grid-row: 1;
    grid-template-rows: minmax(0, 1fr);
  }

  :global([data-phone-layout]) .palette-slot.rest-extra {
    display: none;
  }

  /* The + cell: the strips row's add buttons' dashed ghost (NewTrackButtons),
     the firmest of the ghosts, since it is the one that always does
     something. */
  .chain-add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 1px dashed var(--ghost-line-strong);
    border-radius: var(--ghost-radius);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--t-fast) var(--ease-precise), color var(--t-fast) var(--ease-precise);
  }
  .chain-add > span {
    opacity: 0.7;
  }
  .chain-add:active {
    background: var(--secondary);
    color: var(--foreground);
  }
  .chain-add:active > span {
    opacity: 1;
  }

  /* A big +, as tall as the tile allows (the user, 2026-11-05). */
  .chain-add-plus {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  .chain-add-plus :global(svg) {
    width: auto;
    height: min(60%, 56px);
    aspect-ratio: 1;
    stroke-width: 1.5;
  }
  /* The chevron: a chip's height, its mark sized to the chip; lit while
     the bar is open (on has no hue, ADR-544). */
  .palette-add .chain-add-plus :global(svg) {
    height: min(70%, 32px);
  }
  .palette-add.open {
    border-style: solid;
    border-color: var(--on-bg);
    background: var(--on-bg);
    color: var(--on-fg);
  }


  /* The palette bar: the MIDI chips, a seam, the audio chips and +, one
     row of chips of one size, each placed by its slot. */
  /* The bar runs to the right edge, its + and Gain chips last. */
  /* One grid with no gaps (ADR-548, the experiment): a finger sliding
     across it never falls between two chips. Each chip draws half a
     hairline on its own edges, so two together make one line. */
  .palette {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    gap: 0;
    border-radius: var(--ghost-radius);
    overflow: hidden;
  }
  .palette :global(.palette-chip) {
    border: 0;
    border-radius: 0;
    box-shadow: inset 0 0 0 0.5px var(--line);
  }
  /* Each family's column wears a stripe of its ink across the top of its
     first-row chips, so the blocks read at a glance while the chips stay
     quiet. */
  .palette .palette-slot.family-head :global(.palette-chip) {
    box-shadow:
      inset 0 3px 0 color-mix(in srgb, var(--chip-ink) 85%, transparent),
      inset 0 0 0 0.5px var(--line);
  }
  .palette .palette-slot.blank {
    border: 0;
    border-radius: 0;
    box-shadow: inset 0 0 0 0.5px var(--line);
  }
  .palette .chain-add {
    border-radius: 0;
  }
  /* Four rows and the three gaps they replace, so the bar ends on the
     section's fourth sixth. */
  /* Open, the bar lies OVER the chain (ADR-549): the chain keeps its five
     sixths and never moves, held or latched. The bar is opaque and casts
     a shadow on the chain's cells under it. */
  .palette.open {
    grid-row: 1 / span 4;
    grid-template-rows: repeat(4, minmax(0, 1fr));
    position: relative;
    z-index: 3;
    background: var(--background);
    box-shadow: 0 6px 16px -4px color-mix(in srgb, black 55%, transparent);
  }
  :global([data-phone-layout]) .palette.open {
    grid-row: 1;
    align-self: start;
    height: 186px;
    /* Restated: the phone's one-row rest rule outranks the open bar's,
       which left the first row tall and the others squeezed. */
    grid-template-rows: repeat(4, minmax(0, 1fr));
  }

  /* A latched bar: the rest of the chain takes one tap, which closes the
     bar and presses nothing under it. */
  .palette-catch {
    grid-column: 1;
    grid-row: 2 / span 5;
    position: relative;
    z-index: 2;
  }
  :global([data-phone-layout]) .palette-catch {
    grid-row: 2 / span 2;
  }
  .palette-slot {
    min-width: 0;
    min-height: 0;
    display: grid;
  }
  /* A slot a block leaves empty (a shorter row, an effect not on this
     Mac): a faint outline, so the chips beside it read as where they are. */
  .palette-slot.blank {
    border: 1px dashed color-mix(in oklab, var(--ghost-line) 45%, transparent);
    border-radius: var(--ghost-radius);
  }
</style>
