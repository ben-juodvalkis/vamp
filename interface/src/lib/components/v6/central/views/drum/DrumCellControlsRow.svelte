<script lang="ts">
  /**
   * DrumCellControlsRow — the `full` profile's row: a DrumCell kit's FX
   * pad (titled with the current FX type) over a 3x3 of the nine types,
   * the Time pad over the view's Filter pad, Start and Trnsp (ADR-428;
   * split out of the Drum Rack view on 2026-09-10, issue #491 E0;
   * columns stacked 2026-10-04).
   *
   * A dumb row, the shape `SimplerControlsRow` and `SamplerControlsRow`
   * already have: it takes values, states and badges and reports a write;
   * the parent decides what a write means (the kit, or the held pads) and
   * hands in its Filter pad as a snippet.
   *
   * One ruler for the whole row (2026-09-12, user's call: "each XY should
   * be equal width and the sliders be half width of the XY"). The row's
   * own box is `display: contents`, and so is the slider group's, so the
   * FX pad, the Time pad, Start, Trnsp and the view's own Filter pad and
   * Gain slider are all flex items of ONE container — every pad `2fr`,
   * every slider `1fr`, sharing one gap. Nested, the gaps inside this row
   * came out of its share alone and the pads landed a few px narrower than
   * the Filter beside them; that is also what the Filter's 160px cap was
   * compensating for, and the cap is gone with it.
   */
  import DeviceXY from '../../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import VmSlot from './VmSlot.svelte';
  import type { Snippet } from 'svelte';
  import {
    VM_PITCH_MIN,
    VM_PITCH_MAX,
    combineVmStates,
    vmStateAcceptsWrites,
    type VmFunction,
    type VmState
  } from '$lib/services/drumVirtualMacros';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import { press } from '$lib/actions';
  import type { ControlGlyphName } from '$lib/config/controlGlyphMap';

  // The FX pad's icon by the selected type's name; Sub is Drum Sampler's sub-boom.
  const FX_TYPE_ICONS: Record<string, ControlGlyphName> = {
    Stretch: 'stretch', Loop: 'loop', Pitch: 'transpose', Punch: 'punch', '8-Bit': 'redux',
    FM: 'fm', Ring: 'ringmod', Sub: 'boom', Noise: 'noise'
  };

  export type DrumCellRowControl = 'fx1' | 'fx2' | 'fxType' | 'attack' | 'decay' | 'start' | 'pitch';
  export type DrumCellRowSlot = 'fx' | 'fxType' | 'time' | 'start' | 'pitch';

  interface Props {
    /** `t` for the pads and Start, the 0..8 index for fxType, semitones for pitch. A missing entry shows the control at rest. */
    values: Partial<Record<DrumCellRowControl, number>>;
    /** Per control; a missing entry is `live`. */
    states?: Partial<Record<DrumCellRowControl, VmState>>;
    /** Per slot: the "held by macro" text, or nothing. */
    badges?: Partial<Record<DrumCellRowSlot, string | null>>;
    color: DeviceColorScheme;
    /** The FX type names, in index order — one button each. */
    fxTypes: readonly string[];
    onWrite: (control: DrumCellRowControl, value: number) => void;
    /** The view's Filter pad, drawn under the Time pad. */
    filter?: Snippet;
  }

  let {
    values,
    states = {},
    badges = {},
    color,
    fxTypes,
    onWrite,
    filter
  }: Props = $props();

  function t(control: DrumCellRowControl, atRest: number): number {
    const v = values[control];
    return typeof v === 'number' && Number.isFinite(v) ? v : atRest;
  }
  function stateOf(control: DrumCellRowControl): VmState {
    return states[control] ?? 'live';
  }
  function write(control: DrumCellRowControl, value: number) {
    if (!vmStateAcceptsWrites(stateOf(control))) return;
    onWrite(control, value);
  }

  let fxState = $derived(combineVmStates(stateOf('fx1'), stateOf('fx2')));
  let fxTypeState = $derived(stateOf('fxType'));
  let timeState = $derived(combineVmStates(stateOf('attack'), stateOf('decay')));
  let startState = $derived(stateOf('start'));
  let pitchState = $derived(stateOf('pitch'));
  let selectedFxType = $derived(Math.max(0, Math.min(fxTypes.length - 1, Math.round(t('fxType', 0)))));
</script>

<div class="flex-1 flex gap-(--central-gap) min-h-0 vm-full-row">
  <!-- The FX column: the FX pad over its nine types as a 3x3 of buttons
       (user, 2026-10-04), each half the column, so the type grid sits
       level with the Filter pad beside it. -->
  <div class="vm-full-col vm-full-col-fx">
    <!-- FX XY pad. SWAPPED on purpose: X is FX2 (character), Y is FX1 (amount). -->
    <VmSlot state={fxState} class="vm-slot-fx min-w-0" badge={badges.fx}>
      <DeviceXY
        xValue={t('fx2', 0.5)}
        yValue={t('fx1', 0.5)}
        title={fxTypes[selectedFxType] ?? 'FX'}
        icon={FX_TYPE_ICONS[fxTypes[selectedFxType]]}
        onInteraction={(x, y) => {
          write('fx2', x);
          write('fx1', y);
        }}
        {color}
        isGhost={fxState === 'none'}
      />
    </VmSlot>

    <!-- The FX type, one button per effect — the Drift waveform grid's
         buttons. A `use:press` each, not an `onclick`: this row is worked
         with a pad held under another finger, the multi-pointer case
         ADR-427 exists for. A choice writes through the scope rule, so
         with a pad held it is that pad's type. -->
    <VmSlot state={fxTypeState} class="vm-slot-fx-type min-w-0" fn="fxType" badge={badges.fxType}>
      <div class="fx-type-grid" role="group" aria-label="FX type">
        {#each fxTypes as fxTypeName, index}
          <button
            type="button"
            class="physical-button fx-type-option"
            class:active={selectedFxType === index}
            style="--btn-tint: {color.primary};"
            aria-pressed={selectedFxType === index}
            use:press={{ onPress: () => write('fxType', index), touchAction: 'none' }}
          >
            {fxTypeName}
          </button>
        {/each}
      </div>
    </VmSlot>
  </div>

  <!-- The Time column: the Time pad (attack across, decay up) over the
       view's Filter pad (user, 2026-10-04). -->
  <div class="vm-full-col vm-full-col-time">
    <VmSlot state={timeState} class="vm-slot-time min-w-0" badge={badges.time}>
      <DeviceXY
        xValue={t('attack', 0.5)}
        yValue={t('decay', 0.5)}
        title="Time"
        icon="envelope"
        onInteraction={(x, y) => {
          write('attack', x);
          write('decay', y);
        }}
        {color}
        isGhost={timeState === 'none'}
      />
    </VmSlot>
    {#if filter}
      <div class="vm-full-filter">
        {@render filter()}
      </div>
    {/if}
  </div>

  <!-- Start and Trnsp: slider-width slots. -->
  <div class="flex gap-(--central-gap) h-full vm-full-sliders">
    <VmSlot state={startState} class="vm-slot-start flex-1 flex flex-col" badge={badges.start}>
      <DeviceSlider
        value={t('start', 0.5)}
        labelOrientation="horizontal"
        title="Start"
        icon="start"
        {color}
        isGhost={startState === 'none'}
        onInteraction={(value) => write('start', value)}
      />
    </VmSlot>

    <!-- Trnsp, always (user, 2026-09-12). From 2026-09-08 it was drawn only
         while the FX grid was off, because the grid's top-left Pitch slider
         is the same knob; with the grid on — the default — the kit's pitch
         was simply missing from its own view. Both now show it: they read
         and write the same `vm.pitch` and obey the same hold, so they
         cannot disagree. -->
    <VmSlot state={pitchState} class="vm-slot-pitch flex-1 flex flex-col" badge={badges.pitch}>
      <DeviceSlider
        value={t('pitch', 0)}
        labelOrientation="horizontal"
        title="Trnsp"
        icon="transpose"
        {color}
        min={VM_PITCH_MIN}
        max={VM_PITCH_MAX}
        centerOrigin={true}
        centerValue={0}
        isGhost={pitchState === 'none'}
        onInteraction={(value) => write('pitch', Math.round(value))}
      />
    </VmSlot>
  </div>
</div>

<style>
  /* ---- The full (DrumCell) row lays out on the VIEW's grid, not its own:
     both wrappers are `display: contents`, so the two columns and the
     sliders here are cells beside the view's pads and Gain slider. This row
     only NAMES its cells; the view's template places and sizes them —
     pads · Gain · Trnsp · Start under the swap pill, then the FX column
     (FX pad over the type grid) and the Time column (Time pad over Filter)
     (user, 2026-10-04). Each column is two equal halves, so the type grid
     and the Filter pad sit level. */
  .vm-full-row {
    display: contents;
  }
  .vm-full-col {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .vm-full-col > :global(*) {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .vm-full-col-fx {
    grid-area: fx;
  }
  .vm-full-col-time {
    grid-area: time;
  }
  .vm-full-filter {
    display: flex;
  }
  .vm-full-filter > :global(.vm-slot) {
    flex: 1 1 0;
    min-width: 0;
  }
  .vm-full-sliders {
    display: contents;
  }
  .vm-full-sliders > :global(.vm-slot) {
    min-width: 0;
  }
  .vm-full-sliders > :global(.vm-slot-start) {
    grid-area: start;
  }
  .vm-full-sliders > :global(.vm-slot-pitch) {
    grid-area: trnsp;
  }

  /* ---- FX type: nine buttons, 3x3, filling the slot. */
  .fx-type-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(3, minmax(0, 1fr));
    gap: var(--spacing-sm, 6px);
    height: 100%;
    min-height: 0;
  }
  .fx-type-option {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    min-width: 0;
    min-height: 0;
    font-size: 0.8125rem;
    line-height: 1.1;
    overflow: hidden;
  }
  /* ---- Live skin (flat grammar): the FX-type buttons wear the focused
     track's ink (ADR-402) as label and, when active, solid fill with Live's
     ClipText — never the GRATICULE wash/glow. Live never bolds a pad. */
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
    color: var(--btn-tint, var(--foreground));
  }
  :global([data-grammar="flat"]) .physical-button.active {
    background: var(--btn-tint, var(--phosphor));
    border-color: var(--btn-tint, var(--phosphor));
    color: var(--flat-clip-text);
  }
  :global(.light[data-grammar="flat"]) .physical-button:not(.active) {
    color: color-mix(in oklab, var(--btn-tint, var(--foreground)) 55%, var(--foreground));
  }
  :global(.light[data-grammar="flat"]) .physical-button.active {
    border-color: var(--line-strong);
  }
</style>
