<script lang="ts">
  /**
   * The Sampler row — Live's Pitch/Osc tab as one row of controls
   * (2026-09-07). Drawn for a single Sampler by `SamplerCentralView`
   * (its own parameters, by name) and for a Sampler kit by
   * `DrumRackCentralView` (the `vm.*` functions fanned out to every
   * pad). Unit-free: every value is `t` in 0..1 except `pitch`, whole
   * semitones on ±48. The host decides what a write means.
   *
   * Its face (ADR-510; the cells are the user's, 2026-09-07, the
   * envelope rebuilt 2026-09-12):
   *
   *   Kit [Gain/Trnsp | Spread/Select] · Pitch/Osc [Osc over Pitch]
   *   · Amp Envelope [A D S R] · Filter
   *
   * on one grid of equal columns, the host's Gain and Filter passed in as
   * snippets. Gain over Trnsp is the first column on every Drum Rack kit.
   *
   * The amp envelope is four sliders in ADSR order in their own section.
   * It used to be a Time XY pad (Attack across, Release up) with Decay
   * and Sustain as two separate sliders further along — one envelope
   * split across two idioms, read out of order. Four sliders costs a
   * gesture and buys the whole envelope in one place; the section's name and
   * seams say where it stops, which in turn lets each slider be one letter.
   * A KIT hides Decay and Sustain, so there it holds A and R.
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
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import type { Snippet } from 'svelte';
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
    /** The amp envelope drawn in place of its four stages (ADR-514), by a host that reaches the device's parameters. */
    envelope?: Snippet;
    onWrite: (control: SamplerRowControl, value: number) => void;
    /**
     * Sliders to leave out. A Sampler KIT hides Decay and Sustain (user's
     * call, 2026-09-08 — on the Abbey Road kits the amp envelope's middle
     * is not what a performer reaches for); the single-Sampler view keeps
     * them; the single-Sampler view hides Select. The pads and Trnsp are
     * not hideable.
     */
    hidden?: readonly SamplerRowControl[];
    /** The host's Gain, a knob beside the full-height Trnsp (`gain(true)`). */
    gain?: Snippet<[knob?: boolean]>;
    /** The host's Filter pad, the face's last section. */
    filter?: Snippet;
    /** Drawn across the top of the kit section (the single Sampler's swap pill). */
    lead?: Snippet;
    /** The kit section's name. */
    kitTitle?: string;
    /** A class for the face, for the host to fit it into its own box. */
    faceClass?: string;
  }

  let {
    values,
    states = {},
    badges = {},
    envelope,
    color,
    onWrite,
    hidden = [],
    gain,
    filter,
    lead,
    kitTitle = 'Kit',
    faceClass = ''
  }: Props = $props();
  let hide = $derived(new Set(hidden));

  // The face's columns (ADR-510): the kit section is Gain / Trnsp plus a
  // column for Spread / Select when either shows; the envelope one column
  // a stage; Osc / Pitch and Filter two each. A kit: [2, 2, 2, 2]; the
  // single Sampler: [2, 2, 4, 2].
  let voiceCount = $derived((hide.has('spread') ? 0 : 1) + (hide.has('selector') ? 0 : 1));
  /** Select gets a column of its own on a kit (the single Sampler hides it). */
  let showSelect = $derived(voiceCount > 0 && !hide.has('selector'));
  let kitSpan = 2;
  let stageCount = $derived(2 + (hide.has('decay') ? 0 : 1) + (hide.has('sustain') ? 0 : 1));
  let sectionSpans = $derived(filter ? [kitSpan, 2, stageCount, 2] : [kitSpan, 2, stageCount]);

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

{#snippet slider(control: SamplerRowControl, title: string, icon: ControlGlyphName, state: VmState, badge: string | null | undefined, atRest: number, knob = false)}
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
      face={knob ? 'knob' : 'slider'}
      knobSize="m"
      knobCaption={!knob}
      orientation="vertical"
      labelOrientation="horizontal"
      {color}
      isGhost={state === 'none'}
      onInteraction={(value) => write(control, value)}
    />
    {#if badge}{@render heldBadge(badge)}{/if}
  </div>
{/snippet}

<!-- The face (ADR-510): one grid of equal columns, a header line every
     section shares, identical seams. Left to right: the kit's own column
     (the host's Gain over Trnsp, with Spread over Select beside it, the
     host's swap pill across the two where it places one), Osc over Pitch,
     the amp envelope's stages one column each, and the host's Filter.
     Gain over Trnsp is the face's first column on every Drum Rack kit, so
     it sits on the same pixels whichever kit is loaded. The section's
     header and its two seams are the envelope's bracket (it was
     `EnvelopeGroup`'s hairlines until ADR-510), and what lets each stage
     be one letter. No padding of its own on a kit: the Drum Rack owns the
     inset there. -->
<FaceGrid sections={sectionSpans} class="sampler-row {faceClass}">
  <FaceSection span={kitSpan}>
    {#snippet head()}<PanelEyebrow title={kitTitle} color={color.primary} />{/snippet}
    <div class="kit-stack face-span-all" class:kit-has-lead={!!lead}>
      {#if lead}
        <div class="kit-lead">{@render lead()}</div>
      {/if}
      <!-- Kit (user, 2026-11-06): Trnsp the full-height column; Gain, Spread
           and Select knobs stacked in the next, an icon inside each and no
           caption, so three hold their size in one column. Gain and Trnsp sit
           on the same pixels on every kit. -->
      <div class="kit-col">
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
      <div class="kit-col">
        {#if gain}{@render gain(true)}{/if}
        {#if voiceCount > 0 && !hide.has('spread')}{@render slider('spread', 'Spread', 'width', spreadState, badges.spread, 0, true)}{/if}
        {#if showSelect}{@render slider('selector', 'Select', 'select', selectorState, badges.selector, 0, true)}{/if}
      </div>
    </div>
  </FaceSection>
  <FaceSeam ink={color.primary} />

  <!-- Osc over Pitch. Osc: coarse tune across, oscillator amount up.
       Pitch: envelope attack across, envelope amount up (centre = none). -->
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title="Pitch / Osc" color={color.primary} />{/snippet}
    <div class="pad-column face-span-all flex flex-col gap-(--central-gap) min-w-0 h-full">
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
  </FaceSection>
  <FaceSeam ink={color.primary} />

  <!-- The amp envelope: its stages in ADSR order, one column each (user's
       call, 2026-09-12, replacing a Time XY pad that reached neither Decay
       nor Sustain). A KIT hides Decay and Sustain, so there it holds A and R. -->
  <FaceSection span={stageCount} data-envelope-group="amp">
    {#snippet head()}<PanelEyebrow title="Amp Envelope" color={color.primary} />{/snippet}
    {#if envelope}
      <!-- A host that reaches the device's own parameters draws the envelope
           as Live does (ADR-514): the single Sampler. -->
      <div class="face-span-all">{@render envelope()}</div>
    {:else}
      {@render slider('attack', 'A', 'attack', attackState, badges.attack, 0.5)}
      {#if !hide.has('decay')}{@render slider('decay', 'D', 'decay', decayState, badges.decay, 0.5)}{/if}
      {#if !hide.has('sustain')}{@render slider('sustain', 'S', 'sustain', sustainState, badges.sustain, 1)}{/if}
      {@render slider('release', 'R', 'release', releaseState, badges.release, 0.5)}
    {/if}
  </FaceSection>

  {#if filter}
    <FaceSeam ink={color.primary} />
    <FaceSection span={2}>
      {#snippet head()}<PanelEyebrow title="Filter" color={color.primary} />{/snippet}
      <div class="filter-cell face-span-all">{@render filter()}</div>
    </FaceSection>
  {/if}
</FaceGrid>

<style>
  /* The kit section: its columns on the face's own (subgrid), the host's
     swap pill across them where it places one. */
  .kit-stack {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: minmax(0, 1fr);
    row-gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }
  .kit-stack.kit-has-lead {
    grid-template-rows: auto minmax(0, 1fr);
  }
  .kit-lead {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  /* A column of value boxes sharing its height evenly (Gain over Trnsp). */
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
