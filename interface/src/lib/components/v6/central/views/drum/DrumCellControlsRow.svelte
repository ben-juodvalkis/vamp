<script lang="ts">
  /**
   * DrumCellControlsRow — the `full` profile's row: a DrumCell kit's FX
   * pad (with the FX-type button at its foot), the Time pad, Start, and
   * Trnsp while the FX grid is switched off (ADR-428; split out of the
   * Drum Rack view on 2026-09-10, issue #491 E0).
   *
   * A dumb row, the shape `SimplerControlsRow` and `SamplerControlsRow`
   * already have: it takes values, states and badges and reports a write;
   * the parent decides what a write means (the kit, or the held pads) and
   * owns the FX-type picker, which dims the WHOLE view when open.
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
  import { Lock } from '@lucide/svelte';
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
    /** The FX type names, in index order — the button shows the current one. */
    fxTypes: readonly string[];
    onWrite: (control: DrumCellRowControl, value: number) => void;
    /** A tap on the FX-type button; the parent opens its picker. */
    onOpenFxPicker: () => void;
    fxPickerOpen?: boolean;
  }

  let {
    values,
    states = {},
    badges = {},
    color,
    fxTypes,
    onWrite,
    onOpenFxPicker,
    fxPickerOpen = false
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
  <!-- FX XY pad. SWAPPED on purpose: X is FX2 (character), Y is FX1 (amount). -->
  <VmSlot state={fxState} class="vm-slot-fx min-w-0 h-full" badge={badges.fx}>
    <DeviceXY
      xValue={t('fx2', 0.5)}
      yValue={t('fx1', 0.5)}
      title="FX"
      onInteraction={(x, y) => {
        write('fx2', x);
        write('fx1', y);
      }}
      {color}
      isGhost={fxState === 'none'}
    />
    <!-- The current FX type, and the way to change it. Sits over the
         pad's bottom-left corner; the pad's own drag never starts there
         because the button takes the pointer (`stopPropagation` on the
         down). A `use:press`, not an `onclick`: this row is worked with a
         pad held under another finger, the multi-pointer case ADR-427
         exists for. -->
    <button
      type="button"
      class="fx-type-button physical-button"
      class:fx-type-none={fxTypeState === 'none'}
      class:fx-type-held={fxTypeState === 'held'}
      style="--btn-tint: {color.primary};"
      aria-label="FX type: {fxTypes[selectedFxType] ?? 'FX'}"
      aria-haspopup="dialog"
      aria-expanded={fxPickerOpen}
      aria-disabled={!vmStateAcceptsWrites(fxTypeState)}
      data-vm-state={fxTypeState}
      use:press={{
        onPress: () => {
          if (vmStateAcceptsWrites(fxTypeState)) onOpenFxPicker();
        },
        stopPropagation: true,
        touchAction: 'none'
      }}
    >
      {fxTypes[selectedFxType] ?? 'FX'}
    </button>
    {#if badges.fxType}
      <span class="fx-type-badge">
        <span class="vm-held-badge" aria-label="held by macro">
          <Lock size={9} strokeWidth={2.5} aria-hidden="true" />{badges.fxType}
        </span>
      </span>
    {/if}
  </VmSlot>

  <!-- Time XY pad: attack across, decay up. -->
  <VmSlot state={timeState} class="vm-slot-time min-w-0 h-full" badge={badges.time}>
    <DeviceXY
      xValue={t('attack', 0.5)}
      yValue={t('decay', 0.5)}
      title="Time"
      onInteraction={(x, y) => {
        write('attack', x);
        write('decay', y);
      }}
      {color}
      isGhost={timeState === 'none'}
    />
  </VmSlot>

  <!-- Start and Trnsp: slider-width slots. -->
  <div class="flex gap-(--central-gap) h-full vm-full-sliders">
    <VmSlot state={startState} class="vm-slot-start flex-1 flex flex-col" badge={badges.start}>
      <DeviceSlider
        value={t('start', 0.5)}
        title="Start"
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
        title="Trnsp"
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
     both wrappers are `display: contents`, so every pad and slider here is
     a cell beside the view's pads, Filter pad and Gain slider. This row
     only NAMES its cells; the view's template places them and sizes them —
     a pad 2fr, a slider 1fr (2026-09-12) — pads · Gain · Trnsp · Start
     under the swap pill, then FX · Time · Filter (user, 2026-09-16). */
  .vm-full-row {
    display: contents;
  }
  .vm-full-row > :global(.vm-slot) {
    min-width: 0;
  }
  .vm-full-row > :global(.vm-slot-fx) {
    grid-area: fx;
  }
  .vm-full-row > :global(.vm-slot-time) {
    grid-area: time;
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

  /* ---- FX type: one round button at the foot of the FX pad (layout
     pass, 2026-09-08). The button wears the pad's ink; `none` ghosts it,
     `held` keeps it readable but inert. */
  .fx-type-button {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 2;
    width: 58px;
    height: 58px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.02em;
    line-height: 1.1;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    pointer-events: auto;
  }
  .fx-type-button.fx-type-none {
    opacity: var(--opacity-ghost);
    pointer-events: none;
  }
  .fx-type-button.fx-type-held {
    pointer-events: none;
  }
  .fx-type-badge {
    position: absolute;
    left: 6px;
    bottom: 72px;
  }
  /* ---- Live skin (flat grammar): the FX-type button wears the focused
     track's ink (ADR-402) as label and, when active, solid fill — never
     the GRATICULE wash/glow. Tailwind `font-semibold` comes down to medium;
     Live never bolds a pad. */
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
    color: var(--btn-tint, var(--foreground));
  }
  :global(.light[data-grammar="flat"]) .physical-button:not(.active) {
    color: color-mix(in oklab, var(--btn-tint, var(--foreground)) 55%, var(--foreground));
  }
</style>
