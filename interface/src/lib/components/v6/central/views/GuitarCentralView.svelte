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
  const bass = useFxGridSlot('bass');

  let bassValue = $derived(bass.paramValue(1) ?? 1.0);

  // AMP — one button over three Helix params (2/3/4), which move together:
  // there is no single "amp on" parameter on the plugin, so the button IS
  // the abstraction. Reads param 2 as the group's state and defaults to ON,
  // because that is how the Bass preset ships and a cold slot (no v3 value
  // yet, or a ghost device) should show the sound you are about to get
  // rather than an off state that was never written.
  const AMP_PARAMS = [2, 3, 4];
  let ampOn = $derived((bass.paramValue(AMP_PARAMS[0]) ?? 1) > 0.5);

  function toggleAmp() {
    armBassLoad();
    const next = ampOn ? 0 : 1;
    for (const index of AMP_PARAMS) bass.sendParam(index, next);
  }

  // +12 — the octave-up voice (param 5), a single param and OFF by default:
  // unlike AMP it is an addition to the sound, so a cold slot should not
  // claim it is already on.
  const OCTAVE_UP_PARAM = 5;
  let octaveUpOn = $derived((bass.paramValue(OCTAVE_UP_PARAM) ?? 0) > 0.5);

  function toggleOctaveUp() {
    armBassLoad();
    bass.sendParam(OCTAVE_UP_PARAM, octaveUpOn ? 0 : 1);
  }

  // ===== BASS CHAIN POSITION =====
  // A browser load lands at the END of the chain and the Bass belongs at
  // its head; `useBassChainPosition` is that one-shot rule, shared with
  // the `BassControl` tile in the audio track's fx1 column since
  // 2026-09-14 (it was a local `let` + `$effect` here before the tile
  // needed the same twenty lines). Arm the move before any gesture that
  // might load.
  const bassChain = useBassChainPosition(bass, 'GuitarCentralView');
  const armBassLoad = () => bassChain.arm();

  // The reorder arrows are the TRACK chain's, the same rule
  // `BaseDeviceControl` states: a pad's chain is its instrument and an
  // effect or two, so "first position" there would put an audio effect
  // ahead of the instrument. Hidden under a scope — and `armBassLoad`
  // declines to arm there for the same reason.
  let showBassMove = $derived(bass.device !== null && bass.scope === null);

  let isMovingBassLeft = $state(false);
  let moveBassLeftResult = $state<'idle' | 'success' | 'error'>('idle');
  let isMovingBassRight = $state(false);
  let moveBassRightResult = $state<'idle' | 'success' | 'error'>('idle');

  function moveButtonClasses(isMoving: boolean, result: 'idle' | 'success' | 'error') {
    const base = 'bass-move-btn rounded transition-colors duration-200';
    if (result === 'success') return `${base} move-ok`;
    if (result === 'error') return `${base} move-err`;
    if (isMoving) return `${base} text-muted-foreground`;
    return `${base} text-muted-foreground hover:text-foreground cursor-pointer`;
  }

  async function moveBass(edge: 'top' | 'end') {
    const path = bass.devicePath;
    const busy = edge === 'top' ? isMovingBassLeft : isMovingBassRight;
    if (busy || !path) return;
    if (edge === 'top') isMovingBassLeft = true;
    else isMovingBassRight = true;
    const settle = (result: 'success' | 'error') => {
      if (edge === 'top') moveBassLeftResult = result;
      else moveBassRightResult = result;
      setTimeout(() => {
        if (edge === 'top') moveBassLeftResult = 'idle';
        else moveBassRightResult = 'idle';
      }, 1000);
    };
    try {
      await (edge === 'top' ? moveDeviceToTop(path) : moveDeviceToEnd(path));
      await selectDevice(path);
      settle('success');
    } catch (error) {
      logger.error('Failed to move the bass device', {
        component: 'GuitarCentralView',
        edge,
        error
      });
      settle('error');
    } finally {
      if (edge === 'top') isMovingBassLeft = false;
      else isMovingBassRight = false;
    }
  }

  // GRATICULE (§5.5): calibrate the slot palettes through trackInk at injection.
  let fxInk = $derived({
    primary: trackInk(fx.color.primary, paintModeReactive()),
    secondary: fx.color.secondary,
    accent: trackInk(fx.color.accent, paintModeReactive())
  });
  let bassInk = $derived({
    primary: trackInk(bass.color.primary, paintModeReactive()),
    secondary: bass.color.secondary,
    accent: trackInk(bass.color.accent, paintModeReactive())
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

  const layoutItems = $derived(pairMacros(controlLayout, XY_PAIRS));

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

<!-- The Bass panel is a snippet because both branches below (named macros /
     unnamed fallback) render the identical column — it belongs to the `bass`
     slot, not to the Guitar rack's macro layout, so nothing about it changes
     between the two. -->
{#snippet drivePanel()}
  <div class="control-slot slider-slot">
    <DeviceSlider
      value={getNormalizedValue(DRIVE_MACRO)}
      title={driveName}
      orientation="vertical"
      isGhost={fx.isGhost}
      color={effectiveColor}
      onTap={() => fx.loadIfGhost()}
      onInteraction={(val) => handleSliderChange(DRIVE_MACRO, val)}
    />
  </div>
{/snippet}

{#snippet bassPanel()}
  <div class="control-slot bass-slot">
    <div class="bass-panel" style="--btn-tint: {bassInk.primary};">
      <!-- The arrows FLANK the title rather than sitting absolute in the
           panel's corners the way BaseDeviceControl's do: this column is
           112px at its narrowest and a corner button would land on top of
           the label. Left = head of the chain, right = end, the same
           bearing they have on every FX tile. -->
      <div class="bass-head">
        {#if showBassMove}
          <button
            class={moveButtonClasses(isMovingBassLeft, moveBassLeftResult)}
            onclick={() => moveBass('top')}
            disabled={isMovingBassLeft || moveBassLeftResult !== 'idle'}
            aria-label="Move bass device to first position"
          >
            {#if isMovingBassLeft}
              <div class="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full"></div>
            {:else if moveBassLeftResult === 'success'}
              <Check class="w-3 h-3" />
            {:else if moveBassLeftResult === 'error'}
              <X class="w-3 h-3" />
            {:else}
              <ArrowLeft class="w-3 h-3" />
            {/if}
          </button>
        {/if}
        <span class="bass-title" style="color: {bassInk.primary};">Bass</span>
        {#if showBassMove}
          <button
            class={moveButtonClasses(isMovingBassRight, moveBassRightResult)}
            onclick={() => moveBass('end')}
            disabled={isMovingBassRight || moveBassRightResult !== 'idle'}
            aria-label="Move bass device to last position"
          >
            {#if isMovingBassRight}
              <div class="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full"></div>
            {:else if moveBassRightResult === 'success'}
              <Check class="w-3 h-3" />
            {:else if moveBassRightResult === 'error'}
              <X class="w-3 h-3" />
            {:else}
              <ArrowRight class="w-3 h-3" />
            {/if}
          </button>
        {/if}
      </div>
      <div class="bass-body">
        <div class="bass-fader">
          <DeviceSlider
            value={bassValue}
            title="Octave mix"
            orientation="vertical"
            labelSize="small"
            isGhost={bass.isGhost}
            color={bassInk}
            min={0}
            max={1}
            onTap={() => {
              armBassLoad();
              bass.loadIfGhost();
            }}
            onInteraction={(val) => {
              armBassLoad();
              bass.sendParam(1, val);
            }}
          />
        </div>
        <div class="bass-buttons">
          <button
            class="physical-button bass-btn"
            class:active={ampOn}
            aria-pressed={ampOn}
            onclick={toggleAmp}
          >
            Amp
          </button>
          <button
            class="physical-button bass-btn"
            class:active={octaveUpOn}
            aria-pressed={octaveUpOn}
            onclick={toggleOctaveUp}
          >
            +12
          </button>
        </div>
      </div>
    </div>
  </div>
{/snippet}

<div class="guitar-central-layout relative" class:is-ghost={fx.isGhost}>
  {#if controlLayout.length > 0}
    <div class="controls-panel">
      {@render bassPanel()}
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
              isGhost={fx.isGhost}
              color={effectiveColor}
              onTap={() => fx.loadIfGhost()}
              onInteraction={(val) => handleSliderChange(control.macroIndex, val)}
            />
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <!-- Fallback: drive, then simple sliders for macros 2-8, when no names yet -->
    <div class="controls-panel">
      {@render bassPanel()}
      <SectionDivider orientation="vertical" ink={effectiveColor.primary} />
      {@render drivePanel()}
      {#each { length: MACRO_END - MACRO_START + 1 } as _, i}
        {@const paramIndex = MACRO_START + i}
        <div class="control-slot slider-slot">
          <DeviceSlider
            value={getNormalizedValue(paramIndex)}
            title={`Macro ${paramIndex}`}
            orientation="vertical"
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

  /* Bass is a PANEL, not a bare fader: its two controls belong to a device
     that is not the Guitar rack every other column reads from, so the frame
     is what says "different device" before the label does. Sized like a
     slider column (it holds one fader) plus the button's own band. */
  .bass-slot {
    /* Two columns wide — the fader and the button stack each get a full
       slider column, so neither is squeezed into a half-width lane. */
    flex: 2 1 0;
    min-width: 112px;
  }

  /* Frame off (2026-09-13): the Bass slot keeps its own title and ink,
     and the seam between it and the Guitar rack's macros is the
     `SectionDivider` beside it rather than a box around this one. Without
     the card's padding the fader runs the full height of the band. */
  .bass-panel {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .bass-body {
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
    flex: 1 1 0;
    min-height: 0;
  }

  .bass-buttons {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

  /* Title row: the two reorder arrows flank the label, which keeps the
     label centred in the column whether the arrows are drawn or not —
     the spans either side are equal and both `flex: 1 1 0`. */
  .bass-head {
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
  .bass-title {
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    font-weight: 700;
    text-align: center;
    flex: 1 1 0;
    min-width: 0;
  }

  .bass-move-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    padding: 2px;
  }
  .bass-move-btn:disabled {
    cursor: default;
  }
  /* Status inks are tokens in every skin, the same pair
     `BaseDeviceControl` and the Arpeggiator view flash. */
  .bass-move-btn.move-ok {
    color: var(--act-play);
  }
  .bass-move-btn.move-err {
    color: var(--act-rec);
  }

  .bass-fader {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

  /* The two toggles split the button column evenly rather than sitting at a
     fixed touch height: the view is a full central section, so an even split
     is always well above the 44px floor and reads as one pair. */
  .bass-btn {
    flex: 1 1 0;
    min-height: 0;
    font-size: 0.8125rem;
    font-weight: 600;
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
  :global([data-grammar="flat"]) .bass-title {
    text-transform: none;
    letter-spacing: normal;
  }
</style>
