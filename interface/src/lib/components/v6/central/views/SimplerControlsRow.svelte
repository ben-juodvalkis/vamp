<script lang="ts">
  /**
   * The Simpler row — what a Simpler kit gets of the regular Simpler
   * view's bottom row, for now (user's decision, 2026-09-07): the Time
   * pad (Ve Attack across, Ve Release up — the regular Simpler view's
   * own axes) and Trnsp (Transpose, ±48).
   * Unit-free like the Sampler row: `t` in 0..1 for the pad, whole
   * semitones for pitch. The host decides what a write means — on a kit
   * each control is a function fanned out to every pad by name.
   *
   *   Trnsp  [Time]
   *
   * The Drum Rack lays it out on its own grid (`.simpler-row` is `display:
   * contents` there), on the DrumCell kit's cells: Trnsp beside the view's
   * Gain, the Time pad where Start, FX and Time are (2026-09-27).
   *
   * Not a registry view: it drops the `*CentralView` suffix the
   * reachability test enforces, like `SamplerControlsRow`.
   */
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import Lock from '@lucide/svelte/icons/lock';
  import {
    VM_PITCH_MIN,
    VM_PITCH_MAX,
    combineVmStates,
    vmStateAcceptsWrites,
    type SimplerRowControl,
    type SimplerRowSlot,
    type VmState
  } from '$lib/services/drumVirtualMacros';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    /** `t` for attack / release; `pitch` in semitones. A missing entry shows the control at rest. */
    values: Partial<Record<SimplerRowControl, number>>;
    /** Per control; a missing entry is `live`. */
    states?: Partial<Record<SimplerRowControl, VmState>>;
    /** Per slot: the "held by macro" text, or nothing. */
    badges?: Partial<Record<SimplerRowSlot, string | null>>;
    color: DeviceColorScheme;
    onWrite: (control: SimplerRowControl, value: number) => void;
  }

  let { values, states = {}, badges = {}, color, onWrite }: Props = $props();

  function t(control: SimplerRowControl, atRest: number): number {
    const v = values[control];
    return typeof v === 'number' && Number.isFinite(v) ? v : atRest;
  }
  function stateOf(control: SimplerRowControl): VmState {
    return states[control] ?? 'live';
  }
  function write(control: SimplerRowControl, value: number) {
    if (!vmStateAcceptsWrites(stateOf(control))) return;
    onWrite(control, value);
  }

  let timeState = $derived(combineVmStates(stateOf('attack'), stateOf('release')));
  let pitchState = $derived(stateOf('pitch'));
</script>

{#snippet heldBadge(text: string)}
  <span class="vm-held-badge" aria-label="held by macro">
    <Lock size={9} strokeWidth={2.5} aria-hidden="true" />{text}
  </span>
{/snippet}

<!-- No padding of its own, like the DrumCell and rack-macros rows beside
     it: an 8px p-2 here set the first control 16px off the pad grid's seam
     against 8 on the seam's other side (measured, 2026-09-14). -->
<div class="simpler-row flex-1 flex gap-(--central-gap) min-h-0">
  <!-- Trnsp where it always sits: beside the view's Gain. -->
  <div
    class="vm-slot slider-column min-w-0 flex flex-col"
    class:vm-none={pitchState === 'none'}
    class:vm-held={pitchState === 'held'}
    data-vm-state={pitchState}
    data-vm-function="pitch"
  >
    <DeviceSlider
      value={t('pitch', 0)}
      labelOrientation="horizontal"
      title="Trnsp"
      {color}
      min={VM_PITCH_MIN}
      max={VM_PITCH_MAX}
      centerOrigin={true}
      centerValue={0}
      isGhost={pitchState === 'none'}
      onInteraction={(value) => write('pitch', Math.round(value))}
    />
    {#if badges.pitch}{@render heldBadge(badges.pitch)}{/if}
  </div>

  <!-- Time: Attack across, Release up (the regular Simpler view's axes). -->
  <div
    class="vm-slot time-column min-w-0 h-full"
    class:vm-none={timeState === 'none'}
    class:vm-held={timeState === 'held'}
    data-vm-state={timeState}
    data-vm-function="attack|release"
  >
    <DeviceXY
      xValue={t('attack', 0.5)}
      yValue={t('release', 0.5)}
      title="Time"
      {color}
      isGhost={timeState === 'none'}
      onInteraction={(x, y) => {
        write('attack', x);
        write('release', y);
      }}
    />
    {#if badges.time}{@render heldBadge(badges.time)}{/if}
  </div>
</div>

<style>
  /* Cell names for the Drum Rack's grid, which places them. */
  .time-column {
    grid-area: time;
  }
  .slider-column[data-vm-function='pitch'] {
    grid-area: trnsp;
  }
  /* Same slot grammar as DrumRackCentralView. */
  .vm-slot {
    position: relative;
  }
  .vm-slot.vm-none {
    opacity: var(--opacity-ghost);
    pointer-events: none;
  }
  .vm-slot.vm-held {
    pointer-events: none;
  }
  .vm-slot.vm-held > :global(*:not(.vm-held-badge)) {
    opacity: 0.8;
  }
  .vm-held-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px 1px 5px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--card);
    color: var(--signal-dim);
    font-family: var(--font-sans);
    font-size: 9px;
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1.4;
    pointer-events: none;
  }
</style>
