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
   *   Kit [Gain/Trnsp] · Envelope [Time] · Filter
   *
   * on the face grid (ADR-510), the Drum Rack's Gain and Filter passed in
   * as snippets: eight columns, as on a DrumCell kit, so Gain over Trnsp
   * is on the same pixels on both.
   *
   * Not a registry view: it drops the `*CentralView` suffix the
   * reachability test enforces, like `SamplerControlsRow`.
   */
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import Lock from '@lucide/svelte/icons/lock';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import type { Snippet } from 'svelte';
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
    /** The Drum Rack's Gain, drawn over Trnsp. */
    gain?: Snippet;
    /** The Drum Rack's Filter pad, the face's last section. */
    filter?: Snippet;
  }

  let { values, states = {}, badges = {}, color, onWrite, gain, filter }: Props = $props();

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

<!-- The face (ADR-510), on the Drum Rack's kit columns: Kit (the view's
     Gain over Trnsp, the first column on every kit) · Envelope (the Time
     pad, four columns) · Filter (the view's, three columns, where the
     DrumCell kit's Time / Filter section sits). Eight columns, as on a
     DrumCell kit, so Gain and Trnsp land on its pixels. No padding of
     its own: the Drum Rack owns the inset. -->
<FaceGrid sections={filter ? [1, 4, 3] : [1, 4]} class="simpler-row">
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Kit" color={color.primary} />{/snippet}
    <div class="kit-col">
      {#if gain}{@render gain()}{/if}
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
          icon="transpose"
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
    </div>
  </FaceSection>
  <FaceSeam ink={color.primary} />

  <!-- Time: Attack across, Release up (the regular Simpler view's axes). -->
  <FaceSection span={4}>
    {#snippet head()}<PanelEyebrow title="Envelope" color={color.primary} />{/snippet}
    <div
      class="vm-slot time-column face-span-all min-w-0 h-full"
      class:vm-none={timeState === 'none'}
      class:vm-held={timeState === 'held'}
      data-vm-state={timeState}
      data-vm-function="attack|release"
    >
      <DeviceXY
        xValue={t('attack', 0.5)}
        yValue={t('release', 0.5)}
        title="Time"
        icon="envelope"
        {color}
        isGhost={timeState === 'none'}
        onInteraction={(x, y) => {
          write('attack', x);
          write('release', y);
        }}
      />
      {#if badges.time}{@render heldBadge(badges.time)}{/if}
    </div>
  </FaceSection>

  {#if filter}
    <FaceSeam ink={color.primary} />
    <FaceSection span={3}>
      {#snippet head()}<PanelEyebrow title="Filter" color={color.primary} />{/snippet}
      <div class="filter-cell face-span-all">{@render filter()}</div>
    </FaceSection>
  {/if}
</FaceGrid>

<style>
  /* Gain over Trnsp, sharing the column's height evenly. */
  .kit-col {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .kit-col > :global(*) {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .filter-cell {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .filter-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
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
