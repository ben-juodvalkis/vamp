<script lang="ts">
  /**
   * The Sampler row — Live's Pitch/Osc tab as one row of controls
   * (2026-09-07). Drawn for a single Sampler by `SamplerCentralView`
   * (its own parameters, by name) and for a Sampler kit by
   * `DrumRackCentralView` (the `vm.*` functions fanned out to every
   * pad). Unit-free: every value is `t` in 0..1 except `pitch`, whole
   * semitones on ±48. The host decides what a write means.
   *
   * Its cells (user's layout, 2026-09-07; the envelope rebuilt 2026-09-12):
   *
   *   [Osc over Pitch]  [Amp Envelope: A D S R]  Spread  Select  Trnsp
   *
   * Both hosts lay them out on their own grid, where `.sampler-row` is
   * `display: contents` and each cell names its `grid-area` — on the
   * DrumCell kit's cells since 2026-09-27: Trnsp and Spread lead, beside
   * the host's Gain, and the host's Filter closes the row.
   *
   * The amp envelope is four sliders in ADSR order inside their own card.
   * It used to be a Time XY pad (Attack across, Release up) with Decay
   * and Sustain as two separate sliders further along — one envelope
   * split across two idioms, read out of order. Four sliders costs a
   * gesture and buys the whole envelope in one place; the card is what
   * says where it stops, which in turn lets each slider be one letter.
   * A KIT hides Decay and Sustain, so there the card holds A and R.
   *
   * Every pad reads its amount up and its time or tune across: Osc —
   * coarse tune across (O Coarse), oscillator amount up (O Volume);
   * Pitch — envelope attack across (Pe Attack), envelope amount up
   * (Pe < Env, centre is no envelope).
   * A slot's state and badge come from the host (`vm-none` dims and
   * disables, `vm-held` marks a macro-held control); a host with no
   * census passes nothing and everything is live.
   *
   * Not a registry view: it drops the `*CentralView` suffix the
   * reachability test enforces, like `DrumRackMacroGrid`.
   */
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import type { ControlGlyphName } from '$lib/config/controlGlyphMap';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import Lock from '@lucide/svelte/icons/lock';
  import {
    VM_PITCH_MIN,
    VM_PITCH_MAX,
    combineVmStates,
    vmStateAcceptsWrites,
    type SamplerRowControl,
    type SamplerRowSlot,
    type VmState
  } from '$lib/services/drumVirtualMacros';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    /** `t` per control (0..1); `pitch` in semitones. A missing entry shows the control at rest. */
    values: Partial<Record<SamplerRowControl, number>>;
    /** Per control; a missing entry is `live`. */
    states?: Partial<Record<SamplerRowControl, VmState>>;
    /** Per slot: the "held by macro" text, or nothing. */
    badges?: Partial<Record<SamplerRowSlot, string | null>>;
    color: DeviceColorScheme;
    onWrite: (control: SamplerRowControl, value: number) => void;
    /**
     * Sliders to leave out. A Sampler KIT hides Decay and Sustain (user's
     * call, 2026-09-08 — on the Abbey Road kits the amp envelope's middle
     * is not what a performer reaches for); the single-Sampler view keeps
     * them; the single-Sampler view hides Select. The pads and Trnsp are
     * not hideable.
     */
    hidden?: readonly SamplerRowControl[];
  }

  let { values, states = {}, badges = {}, color, onWrite, hidden = [] }: Props = $props();
  let hide = $derived(new Set(hidden));

  function t(control: SamplerRowControl, atRest: number): number {
    const v = values[control];
    return typeof v === 'number' && Number.isFinite(v) ? v : atRest;
  }
  function stateOf(control: SamplerRowControl): VmState {
    return states[control] ?? 'live';
  }
  function pairState(a: SamplerRowControl, b: SamplerRowControl): VmState {
    return combineVmStates(stateOf(a), stateOf(b));
  }
  function write(control: SamplerRowControl, value: number) {
    if (!vmStateAcceptsWrites(stateOf(control))) return;
    onWrite(control, value);
  }

  let oscState = $derived(pairState('oscAmount', 'oscCoarse'));
  let pitchEnvState = $derived(pairState('pitchEnvAmount', 'pitchEnvAttack'));
  let attackState = $derived(stateOf('attack'));
  let decayState = $derived(stateOf('decay'));
  let sustainState = $derived(stateOf('sustain'));
  let releaseState = $derived(stateOf('release'));
  let spreadState = $derived(stateOf('spread'));
  let selectorState = $derived(stateOf('selector'));
  let pitchState = $derived(stateOf('pitch'));
</script>

{#snippet heldBadge(text: string)}
  <span class="vm-held-badge" aria-label="held by macro">
    <Lock size={9} strokeWidth={2.5} aria-hidden="true" />{text}
  </span>
{/snippet}

{#snippet slider(control: SamplerRowControl, title: string, icon: ControlGlyphName, state: VmState, badge: string | null | undefined, atRest: number)}
  <div
    class="vm-slot slider-column min-w-0 flex flex-col"
    class:vm-none={state === 'none'}
    class:vm-held={state === 'held'}
    data-vm-state={state}
    data-vm-function={control}
  >
    <DeviceSlider
      value={t(control, atRest)}
      {title}
      {icon}
      orientation="vertical"
      labelOrientation="horizontal"
      {color}
      isGhost={state === 'none'}
      onInteraction={(value) => write(control, value)}
    />
    {#if badge}{@render heldBadge(badge)}{/if}
  </div>
{/snippet}

<!-- One row: the two pitch-side pads stacked in one pad-width column,
     then the sliders at one width each — the amp envelope in ADSR order,
     then Spread and Trnsp. Every pad reads the "amount" up and the
     "time/tune" across. No padding of its own: the host owns the inset.
     Its old p-2 put 16px between this row and a seam beside it where the
     seam's other side had 8 — the Drum Rack's pad grid, the Sampler
     view's wheels (measured, 2026-09-14). -->
<div class="sampler-row flex-1 flex gap-(--central-gap) min-h-0">
  <!-- Osc over Pitch. Osc: coarse tune across, oscillator amount up.
       Pitch: envelope attack across, envelope amount up (centre = none). -->
  <div class="pad-column flex flex-col gap-(--central-gap) min-w-0 h-full">
    <div
      class="vm-slot min-w-0 min-h-0 flex-1"
      class:vm-none={oscState === 'none'}
      class:vm-held={oscState === 'held'}
      data-vm-state={oscState}
      data-vm-function="oscAmount|oscCoarse"
    >
      <DeviceXY
        xValue={t('oscCoarse', 0)}
        yValue={t('oscAmount', 0)}
        title="Osc"
        icon="oscillator"
        xIcon="tune"
        yIcon="depth"
        {color}
        isGhost={oscState === 'none'}
        onInteraction={(x, y) => {
          write('oscCoarse', x);
          write('oscAmount', y);
        }}
      />
      {#if badges.osc}{@render heldBadge(badges.osc)}{/if}
    </div>
    <div
      class="vm-slot min-w-0 min-h-0 flex-1"
      class:vm-none={pitchEnvState === 'none'}
      class:vm-held={pitchEnvState === 'held'}
      data-vm-state={pitchEnvState}
      data-vm-function="pitchEnvAmount|pitchEnvAttack"
    >
      <DeviceXY
        xValue={t('pitchEnvAttack', 0.5)}
        yValue={t('pitchEnvAmount', 0.5)}
        title="Pitch"
        icon="pitchdrop"
        xIcon="attack"
        yIcon="depth"
        {color}
        isGhost={pitchEnvState === 'none'}
        onInteraction={(x, y) => {
          write('pitchEnvAttack', x);
          write('pitchEnvAmount', y);
        }}
      />
      {#if badges.pitchEnv}{@render heldBadge(badges.pitchEnv)}{/if}
    </div>
  </div>

  <!-- The amp envelope: four sliders in ADSR order, bracketed by two
       hairlines, replacing the Time XY pad (user's call, 2026-09-12). The
       pad read Attack across and Release up and reached neither Decay nor
       Sustain, which had to ride as two more sliders further along the row
       — so the envelope was split across two idioms and read out of order.
       A KIT still hides Decay and Sustain, so there the bracket holds A
       and R. -->
  <div class="envelope-column min-w-0 h-full flex gap-(--central-gap)">
    <EnvelopeGroup ink={color.primary}>
      {@render slider('attack', 'A', 'attack', attackState, badges.attack, 0.5)}
      {#if !hide.has('decay')}{@render slider('decay', 'D', 'decay', decayState, badges.decay, 0.5)}{/if}
      {#if !hide.has('sustain')}{@render slider('sustain', 'S', 'sustain', sustainState, badges.sustain, 1)}{/if}
      {@render slider('release', 'R', 'release', releaseState, badges.release, 0.5)}
    </EnvelopeGroup>
  </div>
  {#if !hide.has('spread')}{@render slider('spread', 'Spread', 'width', spreadState, badges.spread, 0)}{/if}
  <!-- Sample Selector (0..127): which zone of the Sel editor plays. A
       kit's control (2026-10-04); the single-Sampler view hides it. -->
  {#if !hide.has('selector')}{@render slider('selector', 'Select', 'select', selectorState, badges.selector, 0)}{/if}
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

<style>
  /* Cell names for the host's grid, which places them. */
  .pad-column {
    grid-area: osc;
  }
  .envelope-column {
    grid-area: env;
  }
  .slider-column[data-vm-function='spread'] {
    grid-area: spread;
  }
  .slider-column[data-vm-function='selector'] {
    grid-area: sel;
  }
  .vm-slot[data-vm-function='pitch'] {
    grid-area: trnsp;
  }
  /* The envelope's stages share its bracket (`EnvelopeGroup` is a flex row);
     on the host's grid the other sliders are sized by their cells. */
  .slider-column {
    flex: 1 1 0;
    min-width: 40px;
  }
  /* Same slot grammar as DrumRackCentralView: `vm-none` ghosts and
     takes no input, `vm-held` keeps the reading and takes no input. */
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
