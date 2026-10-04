<script lang="ts">
  /**
   * GuitarCentralView - Dynamic Macro Layout
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   *
   * One slider per named macro:
   * - Macro 1 (drive) is rendered on its own, ahead of the dynamic layout,
   *   which still runs over 2-8. It used to be left out because the FX
   *   grid's Gtr tile owned it, and this view was the only place the rest
   *   of the rack could be reached. That tile left the grid on 2026-09-15
   *   (the ten-column cut) for `PedalCentralView`, so the rack's own view
   *   would otherwise have been the one surface that could NOT move its
   *   first macro.
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import {
    buildMacroLayout,
    cleanParameterName,
    isEmptyMacroName,
    pairMacros,
    type ControlLayout,
    type XYPairRule
  } from '$lib/utils/macroLayoutUtils';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { useBassChainPosition } from '$lib/components/v6/central/useBassChainPosition.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectDevice, moveDeviceToTop, moveDeviceToEnd } from '$lib/services/deviceMoveService';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import { logger } from '$lib/utils/logger';
  import SectionDivider from '../SectionDivider.svelte';
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

  /** Macro 1 is drawn by `drivePanel`; the dynamic layout starts after it. */
  const DRIVE_MACRO = 1;
  const MACRO_START = 2;
  const MACRO_END = 8;
  const MACRO_MIN = 0;
  const MACRO_MAX = 127;

  // Props are accepted for API compatibility but the slot is the
  // canonical source — `color` overrides the slot color when supplied.
  interface Props {
    device?: any;
    color?: DeviceColorScheme;
  }
  let { color }: Props = $props();

  const fx = useFxGridSlot('guitar');
  const octave = useFxGridSlot('octave');

  // ===== OCTAVE =====
  // A Helix Native set up as an octave pedal (2026-10-03), in the panel
  // the Bass had until the Bass tile moved to the Bass Amp rack — whose
  // mix the FX grid's Bass tile drives, so nothing of it is repeated
  // here. Two knobs, measured off the running device: 1 the mix (0..1),
  // 2 the pitch, 0..1 over -12..+12 semitones. The pitch is a four-way
  // tab rather than a fader: the four intervals are the only useful
  // stops, listed top-down as they draw. +12 is the preset's own.
  const OCTAVE_MIX_PARAM = 1;
  const OCTAVE_PITCH_PARAM = 2;
  const PITCH_STEPS = [
    { label: '+12', value: 1 },
    { label: '+7', value: 19 / 24 },
    { label: '-5', value: 7 / 24 },
    { label: '-12', value: 0 }
  ];
  let octaveMix = $derived(octave.paramValue(OCTAVE_MIX_PARAM) ?? 0);
  let octavePitch = $derived(octave.paramValue(OCTAVE_PITCH_PARAM) ?? 1);
  // The step nearest the device's value, so a pitch set by hand in the
  // plug-in still lights the closest stop.
  let pitchStep = $derived(
    PITCH_STEPS.reduce(
      (best, step, i) =>
        Math.abs(step.value - octavePitch) < Math.abs(PITCH_STEPS[best].value - octavePitch) ? i : best,
      0
    )
  );

  // A browser load lands at the END of the chain; an octave pedal belongs
  // at its head, ahead of the amp. `useBassChainPosition` is that one-shot
  // rule (the Bass tile's too). Arm it before any gesture that might load.
  const octaveChain = useBassChainPosition(octave, 'GuitarCentralView');
  const armOctaveLoad = () => octaveChain.arm();

  function setPitch(step: number) {
    armOctaveLoad();
    octave.sendParam(OCTAVE_PITCH_PARAM, PITCH_STEPS[step].value);
  }

  // The tab SCRUBS, like the Glue stepped rows in SquashCentralView: the
  // stack owns one pointer and resolves the step under it from geometry,
  // so a finger slides between intervals. The box is measured at press.
  let pitchBox: ScrubBox | null = null;

  function pitchScrub(clientY: number) {
    if (!pitchBox) return;
    const step = segmentIndex(clientY, pitchBox.top, pitchBox.height, PITCH_STEPS.length);
    if (step === pitchStep && !octave.isGhost) return;
    setPitch(step);
  }

  function pitchDown(info: DragInfo) {
    pitchBox = scrubBoxOf(info.event?.currentTarget as Element | null);
    pitchScrub(info.y);
  }

  // The reorder arrows are the TRACK chain's, the same rule
  // `BaseDeviceControl` states: a pad's chain is its instrument and an
  // effect or two, so "first position" there would put an audio effect
  // ahead of the instrument. Hidden under a scope — and `armOctaveLoad`
  // declines to arm there for the same reason.
  let showOctaveMove = $derived(octave.device !== null && octave.scope === null);

  let isMovingOctaveLeft = $state(false);
  let moveOctaveLeftResult = $state<'idle' | 'success' | 'error'>('idle');
  let isMovingOctaveRight = $state(false);
  let moveOctaveRightResult = $state<'idle' | 'success' | 'error'>('idle');

  function moveButtonClasses(isMoving: boolean, result: 'idle' | 'success' | 'error') {
    const base = 'octave-move-btn rounded transition-colors duration-200';
    if (result === 'success') return `${base} move-ok`;
    if (result === 'error') return `${base} move-err`;
    if (isMoving) return `${base} text-muted-foreground`;
    return `${base} text-muted-foreground hover:text-foreground cursor-pointer`;
  }

  async function moveOctave(edge: 'top' | 'end') {
    const path = octave.devicePath;
    const busy = edge === 'top' ? isMovingOctaveLeft : isMovingOctaveRight;
    if (busy || !path) return;
    if (edge === 'top') isMovingOctaveLeft = true;
    else isMovingOctaveRight = true;
    const settle = (result: 'success' | 'error') => {
      if (edge === 'top') moveOctaveLeftResult = result;
      else moveOctaveRightResult = result;
      setTimeout(() => {
        if (edge === 'top') moveOctaveLeftResult = 'idle';
        else moveOctaveRightResult = 'idle';
      }, 1000);
    };
    try {
      await (edge === 'top' ? moveDeviceToTop(path) : moveDeviceToEnd(path));
      await selectDevice(path);
      settle('success');
    } catch (error) {
      logger.error('Failed to move the octave device', {
        component: 'GuitarCentralView',
        edge,
        error
      });
      settle('error');
    } finally {
      if (edge === 'top') isMovingOctaveLeft = false;
      else isMovingOctaveRight = false;
    }
  }

  // GRATICULE (§5.5): calibrate the slot palettes through trackInk at injection.
  let fxInk = $derived({
    primary: trackInk(fx.color.primary, paintModeReactive()),
    secondary: fx.color.secondary,
    accent: trackInk(fx.color.accent, paintModeReactive())
  });
  let octaveInk = $derived({
    primary: trackInk(octave.color.primary, paintModeReactive()),
    secondary: octave.color.secondary,
    accent: trackInk(octave.color.accent, paintModeReactive())
  });

  let rawEffectiveColor = $derived(color ?? fx.color);
  let effectiveColor = $derived({
    primary: trackInk(rawEffectiveColor.primary, paintModeReactive()),
    secondary: rawEffectiveColor.secondary,
    accent: trackInk(rawEffectiveColor.accent, paintModeReactive())
  });

  let parameterNames = $derived(
    fx.device ? selectedTrackStore.paramNamesForDevice(fx.device) : []
  );

  // Macro values: snapshotted into $state via $effect so the array
  // identity is stable across reads. Pre-existing pattern kept as-is.
  let macroValues = $state<number[]>(Array(8).fill(MACRO_MIN));

  const controlLayout = $derived<ControlLayout>(buildMacroLayout(parameterNames, MACRO_START, MACRO_END));

  $effect(() => {
    const d = fx.device;
    if (d) {
      macroValues = Array.from({ length: 8 }, (_, i) =>
        selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(d, i + 1)) ?? MACRO_MIN
      );
    } else {
      macroValues = Array(8).fill(MACRO_MIN);
    }
  });

  // XY PAIRS — two macros that play as one gesture share a pad, found by
  // the rack's own macro names (Guitar.adg: 2 Drive, 3 Fuzz, 5 Tremolo
  // Rate, 6 Tremolo Amount) so a rack that renames or drops one falls back
  // to plain sliders instead of driving the wrong knob. The pad sits where
  // its first macro's slider was.
  const XY_PAIRS: XYPairRule[] = [
    { title: 'Drive/Fuzz', x: /^drive$/i, y: /^fuzz$/i },
    { title: 'Tremolo', x: /^trem\w*\s+rate$/i, y: /^trem\w*\s+(amount|depth)$/i }
  ];

  // DIRTY/CLEAN — macro 8 is a two-way switch, not a sweep: it drives the
  // chain selector of a rack holding two TONE3000 chains, and Live labels
  // it 0 below the midpoint and 1 above (measured 2026-10-01). The low half
  // is Dirty, the high half Clean, in the order the rack's own name gives.
  // Found by name, like the XY pairs, so a rack without it keeps a slider.
  const TONE_MACRO = 8;
  let hasToneSwitch = $derived(/dirty|clean/i.test(parameterNames[TONE_MACRO] ?? ''));
  let toneClean = $derived(getNormalizedValue(TONE_MACRO) >= 0.5);

  function setTone(clean: boolean) {
    fx.sendParam(TONE_MACRO, clean ? MACRO_MAX : MACRO_MIN);
  }

  const layoutItems = $derived(
    pairMacros(
      hasToneSwitch ? controlLayout.filter((c) => c.macroIndex !== TONE_MACRO) : controlLayout,
      XY_PAIRS
    )
  );

  function getNormalizedValue(macroIndex: number): number {
    const value = macroValues[macroIndex - 1] ?? MACRO_MIN;
    return value / MACRO_MAX;
  }

  function handleSliderChange(paramIndex: number, normalizedValue: number) {
    fx.sendParam(paramIndex, normalizedValue * MACRO_MAX);
  }

  // The rack names macro 1 itself; "Drive" is the fallback for a ghost or
  // a not-yet-answered slot, and matches what the tile in the Pedal view
  // calls it.
  let driveName = $derived.by(() => {
    const raw = parameterNames[DRIVE_MACRO];
    return isEmptyMacroName(raw) ? 'Drive' : cleanParameterName(raw);
  });
</script>

<!-- The Octave panel is a snippet because both branches below (named macros /
     unnamed fallback) render the identical column — it belongs to the `octave`
     slot, not to the Guitar rack's macro layout, so nothing about it changes
     between the two. -->
{#snippet drivePanel()}
  <div class="control-slot slider-slot">
    <DeviceSlider
      value={getNormalizedValue(DRIVE_MACRO)}
      title={driveName}
      orientation="vertical"
      labelOrientation="horizontal"
      isGhost={fx.isGhost}
      color={effectiveColor}
      onTap={() => fx.loadIfGhost()}
      onInteraction={(val) => handleSliderChange(DRIVE_MACRO, val)}
    />
  </div>
{/snippet}

{#snippet toneSwitch()}
  <div class="control-slot tone-slot" style="--btn-tint: {effectiveColor.primary};">
    <button
      class="physical-button tone-btn"
      class:active={!toneClean}
      aria-pressed={!toneClean}
      onclick={() => setTone(false)}
    >
      Dirty
    </button>
    <button
      class="physical-button tone-btn"
      class:active={toneClean}
      aria-pressed={toneClean}
      onclick={() => setTone(true)}
    >
      Clean
    </button>
  </div>
{/snippet}

{#snippet octavePanel()}
  <div class="control-slot octave-slot">
    <div class="octave-panel" style="--btn-tint: {octaveInk.primary};">
      <!-- The arrows FLANK the title rather than sitting absolute in the
           panel's corners the way BaseDeviceControl's do: this column is
           112px at its narrowest and a corner button would land on top of
           the label. Left = head of the chain, right = end, the same
           bearing they have on every FX tile. -->
      <div class="octave-head">
        {#if showOctaveMove}
          <button
            class={moveButtonClasses(isMovingOctaveLeft, moveOctaveLeftResult)}
            onclick={() => moveOctave('top')}
            disabled={isMovingOctaveLeft || moveOctaveLeftResult !== 'idle'}
            aria-label="Move octave device to first position"
          >
            {#if isMovingOctaveLeft}
              <div class="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full"></div>
            {:else if moveOctaveLeftResult === 'success'}
              <Check class="w-3 h-3" />
            {:else if moveOctaveLeftResult === 'error'}
              <X class="w-3 h-3" />
            {:else}
              <ArrowLeft class="w-3 h-3" />
            {/if}
          </button>
        {/if}
        <span class="octave-title" style="color: {octaveInk.primary};">Octave</span>
        {#if showOctaveMove}
          <button
            class={moveButtonClasses(isMovingOctaveRight, moveOctaveRightResult)}
            onclick={() => moveOctave('end')}
            disabled={isMovingOctaveRight || moveOctaveRightResult !== 'idle'}
            aria-label="Move octave device to last position"
          >
            {#if isMovingOctaveRight}
              <div class="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full"></div>
            {:else if moveOctaveRightResult === 'success'}
              <Check class="w-3 h-3" />
            {:else if moveOctaveRightResult === 'error'}
              <X class="w-3 h-3" />
            {:else}
              <ArrowRight class="w-3 h-3" />
            {/if}
          </button>
        {/if}
      </div>
      <div class="octave-body">
        <div class="octave-fader">
          <DeviceSlider
            value={octaveMix}
            title="Mix"
            orientation="vertical"
            labelOrientation="horizontal"
            labelSize="small"
            isGhost={octave.isGhost}
            color={octaveInk}
            min={0}
            max={1}
            onTap={() => {
              armOctaveLoad();
              octave.loadIfGhost();
            }}
            onInteraction={(val) => {
              armOctaveLoad();
              octave.sendParam(OCTAVE_MIX_PARAM, val);
            }}
          />
        </div>
        <!-- The house segmented control (app.css .device-segmented), the
             Glue stepped rows' component stood upright: +12 at the top,
             -12 at the bottom. -->
        <div
          class="device-segmented pitch-stack"
          class:is-ghost-tab={octave.isGhost}
          style="grid-template-rows: repeat({PITCH_STEPS.length}, 1fr);"
          use:drag={{
            commit: 'immediate',
            onDown: (info) => pitchDown(info),
            onMove: (info) => pitchScrub(info.y)
          }}
        >
          {#each PITCH_STEPS as step, i}
            <button
              class="device-segment pitch-step num"
              class:active={!octave.isGhost && pitchStep === i}
              aria-label="Octave pitch {step.label}"
              aria-pressed={!octave.isGhost && pitchStep === i}
              onclick={() => setPitch(i)}
            >{step.label}</button>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/snippet}

<div class="guitar-central-layout relative" class:is-ghost={fx.isGhost}>
  {#if controlLayout.length > 0}
    <div class="controls-panel">
      {@render octavePanel()}
      <SectionDivider orientation="vertical" ink={effectiveColor.primary} />
      {@render drivePanel()}
      {#each layoutItems as item}
        {#if item.kind === 'xy'}
          <div class="control-slot xy-slot">
            <DeviceXY
              xValue={getNormalizedValue(item.x.macroIndex)}
              yValue={getNormalizedValue(item.y.macroIndex)}
              title={item.title}
              isGhost={fx.isGhost}
              color={effectiveColor}
              onTap={() => fx.loadIfGhost()}
              onInteraction={(x, y) => {
                handleSliderChange(item.x.macroIndex, x);
                handleSliderChange(item.y.macroIndex, y);
              }}
            />
          </div>
        {:else}
          {@const control = item.control}
          <div class="control-slot slider-slot">
            <DeviceSlider
              value={getNormalizedValue(control.macroIndex)}
              title={control.name}
              orientation="vertical"
              labelOrientation="horizontal"
              isGhost={fx.isGhost}
              color={effectiveColor}
              onTap={() => fx.loadIfGhost()}
              onInteraction={(val) => handleSliderChange(control.macroIndex, val)}
            />
          </div>
        {/if}
      {/each}
      {#if hasToneSwitch}
        {@render toneSwitch()}
      {/if}
    </div>
  {:else}
    <!-- Fallback: drive, then simple sliders for macros 2-8, when no names yet -->
    <div class="controls-panel">
      {@render octavePanel()}
      <SectionDivider orientation="vertical" ink={effectiveColor.primary} />
      {@render drivePanel()}
      {#each { length: MACRO_END - MACRO_START + 1 } as _, i}
        {@const paramIndex = MACRO_START + i}
        <div class="control-slot slider-slot">
          <DeviceSlider
            value={getNormalizedValue(paramIndex)}
            title={`Macro ${paramIndex}`}
            orientation="vertical"
            labelOrientation="horizontal"
            isGhost={fx.isGhost}
            color={effectiveColor}
            onTap={() => fx.loadIfGhost()}
            onInteraction={(val) => handleSliderChange(paramIndex, val)}
          />
        </div>
      {/each}
    </div>
  {/if}

</div>

<style>
  .guitar-central-layout {
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
  }

  .controls-panel {
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .control-slot {
    display: flex;
    min-height: 0;
    min-width: 0;
    height: 100%;
    flex-shrink: 1;
  }

  .slider-slot {
    flex: 1 1 0;
    min-width: 40px;
  }

  /* An XY pad stands in for two sliders, so it takes their two columns. */
  .xy-slot {
    flex: 2 1 0;
    min-width: 80px;
  }

  /* Octave is a PANEL, not a bare fader: its controls belong to a device
     that is not the Guitar rack every other column reads from, so its own
     title and ink say "different device". Two columns wide — the Mix fader
     and the pitch tab each get a full slider column. */
  .octave-slot {
    flex: 2 1 0;
    min-width: 112px;
  }

  /* Frame off (2026-09-13): the Octave slot keeps its own title and ink,
     and the seam between it and the Guitar rack's macros is the
     `SectionDivider` beside it rather than a box around this one. Without
     the card's padding the fader runs the full height of the band. */
  .octave-panel {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    width: 100%;
    height: 100%;
    min-height: 0;
  }



  /* Title row: the two reorder arrows flank the label, which keeps the
     label centred in the column whether the arrows are drawn or not —
     the spans either side are equal and both `flex: 1 1 0`. */
  .octave-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-xs);
    flex: 0 0 auto;
    min-height: 1rem;
  }

  /* The house eyebrow for a named group in a central view: 0.75rem,
     centred, the size Squash's and Drift's titles already were. It was
     0.625rem in rotated-label territory and read as fine print. */
  .octave-title {
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    font-weight: 700;
    text-align: center;
    flex: 1 1 0;
    min-width: 0;
  }

  .octave-move-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    padding: 2px;
  }
  .octave-move-btn:disabled {
    cursor: default;
  }
  /* Status inks are tokens in every skin, the same pair
     `BaseDeviceControl` and the Arpeggiator view flash. */
  .octave-move-btn.move-ok {
    color: var(--act-play);
  }
  .octave-move-btn.move-err {
    color: var(--act-rec);
  }

  /* Dirty over Clean, one slider column wide, its height split evenly. */
  .tone-slot {
    flex: 1 1 0;
    min-width: 56px;
    flex-direction: column;
    gap: var(--central-gap);
  }

  .tone-btn {
    flex: 1 1 0;
    min-height: 0;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .octave-body {
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
    flex: 1 1 0;
    min-height: 0;
  }

  .octave-fader {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

  .pitch-stack {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: grid;
  }

  /* The stack owns the pointer; the steps are its face. Keyboard focus
     and Enter still activate one. */
  .pitch-step {
    pointer-events: none;
    min-height: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .is-ghost-tab {
    opacity: var(--opacity-ghost);
  }



  .is-ghost {
    opacity: 0.85;
  }

  .loading-pulse {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    animation: undulate 2s ease-in-out infinite;
  }

  @keyframes undulate {
    0%, 100% {
      opacity: 0.2;
      transform: scale(0.8);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.1);
    }
  }

  /* ---- Live skin (flat grammar): no whole-view opacity dim for the ghost
     state — the controls inside carry it on their own field (DeviceSlider
     ghost = --signal-dim label + --flat-disabled-fg fill under flat), so a
     second 0.85 wash over the top only muddies the ladder. Everything else
     here is a bare flex wrapper around DeviceSlider (already flat) — no
     frame / shadow / wash re-added. Graticule is untouched —
     every rule sits under [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .is-ghost {
    opacity: 1;
  }

  /* Flat grammar: titles are authored mixed-case and only GRATICULE
     upper-cases them (§8.1). The panel frame and the AMP button are
     .glass-panel-subtle / .physical-button, which already carry their own
     flat forks in app.css — nothing to re-add here. */
  /* One ink per device, as Auto Pan and the Drum Buss do: a lit button
     takes its device's ink (Octave violet, Guitar orange) rather than the
     house --phosphor, which put a third colour in the view. */
  :global([data-grammar="flat"]) .tone-btn.active,
  :global([data-grammar="flat"]) .pitch-step.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }

  :global([data-grammar="flat"]) .octave-title {
    text-transform: none;
    letter-spacing: normal;
  }
</style>
