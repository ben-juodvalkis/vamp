<script lang="ts">
  /**
   * PedalCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   * Displays pedal controls with virtual devices (shifter, redux).
   *
   * The Shifter is its first column (2026-10-05, in place of the Digital
   * rack's XY): one fader on Live's Shifter, param 18 RM Coarse over
   * 0..0.75 — measured off the running device, 0 = 1.00 Hz, 0.25 = 10 Hz,
   * 0.5 = 100 Hz, 0.75 = 1.00 kHz. RM Coarse is heard only in Ring mode
   * (32 Mode: 0 Pitch, 1 Freq, 2 Ring), so a gesture that loads the
   * Shifter also sets Ring.
   *
   * 2026-10-05: the Saturator and the Pedal traded places. The Saturator's
   * XY is the FX grid's fx5 tile, and a tap on it opens this view; the
   * Pedal's XY is mounted here standalone, beside its type tabs. Of the
   * Saturator's faders only Output and Mix stay — Drive and Color Hi are
   * the tile's two axes.
   *
   * The Guitar came the same way on 2026-09-15, when the FX grid went to
   * ten columns: the amp rack's drive slider is mounted standalone like the
   * Pedal. Unlike the Pedal its tap is NOT disabled — the Pedal is home
   * here, the Guitar is not, and this mount is the only door left to
   * `GuitarCentralView` on a MIDI track.
   *
   * 2026-10-05: the Guitar rack's whole face lives here now and
   * GuitarCentralView is gone — the Gtr tile (the grid's on audio tracks,
   * this view's Gain on MIDI) opens this view. Guitar.adg's six visible
   * macros, read from the saved preset: 1 Gain, 2 Spring, 3 Trem Rate,
   * 4 Trem Amount, 5 Room, 6 Amp Switch (Live labels it 0 below the
   * midpoint and 1 above: Dirty, Clean). Macro 7 is a hidden duplicate
   * Room and has no control. On an audio track the FX grid's Gtr column
   * already draws Gain, so the view leaves it out.
   *
   * The Wah (ADR-445, 2026-09-19) has no tile and no view of its own — the
   * expression pedal is how it is played. Since 2026-10-05 it is a slider on
   * the macro the pedal sweeps, under the Guitar's Gain in the left column
   * (a load/remove button before). A tap on a ghost loads `Wah.adg` at the
   * head of the track's audio effects, the pedal's own placement.
   *
   * NO {#if device} gate - always renders, handles its own state.
   * NO props required - queries selectedTrackStore directly.
   */

  import ReduxControl from '$lib/components/v6/device-panel/ReduxControl.svelte';
  import PedalControl from '$lib/components/v6/device-panel/PedalControl.svelte';
  import GuitarControl from '$lib/components/v6/device-panel/GuitarControl.svelte';
  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

  const fx = useFxGridSlot('pedal');
  const shifter = useFxGridSlot('shifter');
  const redux = useFxGridSlot('redux');
  const saturator = useFxGridSlot('saturator');
  const guitar = useFxGridSlot('guitar');
  // The wah is a virtual slot (no grid position); its device resolves by
  // class + name on the selected track, the same match the surface's
  // pedal component uses to re-find it.
  const wah = useFxGridSlot('wah');
  // The wah is played by the owner's expression pedal and nothing else, so
  // its button exists only while `features.expressionPedal` is on — off, the
  // surface does not even listen for the pedal (general-release audit §7b).
  const showWah = $derived(bridgeStatus.isFeatureOn('expressionPedal'));

  const SHIFTER_RM_COARSE = 18;
  const SHIFTER_RM_MAX = 0.75;
  const SHIFTER_MODE = 32;
  const SHIFTER_MODE_RING = 2;

  let shifterInk = $derived({
    primary: trackInk(shifter.color.primary, paintModeReactive()),
    secondary: shifter.color.secondary,
    accent: trackInk(shifter.color.accent, paintModeReactive())
  });

  // A ghost slot's first write loads the Shifter; Ring goes with it as a
  // pending write, so the fader is heard the moment the device lands.
  // RM Coarse starts at 0 (1 Hz) rather than Live's 0.75 (user, 2026-10-05):
  // a tap writes it, a drag writes its own value after.
  function armShifterLoad() {
    if (!shifter.isGhost) return;
    shifter.sendParam(SHIFTER_MODE, SHIFTER_MODE_RING);
    shifter.sendParam(SHIFTER_RM_COARSE, 0);
  }

  let saturatorInk = $derived({
    primary: trackInk(saturator.color.primary, paintModeReactive()),
    secondary: saturator.color.secondary,
    accent: trackInk(saturator.color.accent, paintModeReactive())
  });

  // Index, label, and the value a fader rests at before the device answers.
  // Indices match the tile's PARAM_CONFIG (10 / 11); 10 was confirmed as
  // Output against the running device (2026-08-22). Nothing is remapped:
  // what a fader shows is what the device stores. Drive (1) and Color Hi
  // (8) have no fader: they are the grid tile's two axes (2026-10-05).
  const SATURATOR_FADERS = [
    { index: 10, title: 'Output', fallback: 1 },
    { index: 11, title: 'Mix', fallback: 1 }
  ] as const;

  // GRATICULE (§2.4 / §5.5): normalize the pedal palette through trackInk
  // at injection — hue preserved, luminance/chroma calibrated. secondary (the
  // alpha wash) is left untouched. Normalized at injection since the slot config
  // may override the fallback above.
  let pedalInk = $derived({
    primary: trackInk(fx.color.primary, paintModeReactive()),
    secondary: fx.color.secondary,
    accent: trackInk(fx.color.accent, paintModeReactive())
  });

  const PEDAL_TYPE_OPTIONS = [
    { value: 0, label: 'Drive' },
    { value: 1, label: 'Distort' },
    { value: 2, label: 'Fuzz' }
  ];

  let guitarInk = $derived({
    primary: trackInk(guitar.color.primary, paintModeReactive()),
    secondary: guitar.color.secondary,
    accent: trackInk(guitar.color.accent, paintModeReactive())
  });

  // Guitar.adg's macros (see the header). Macros are 0..127 on the wire.
  const GTR = { spring: 2, tremRate: 3, tremAmount: 4, room: 5, ampSwitch: 6 } as const;
  const MACRO_MAX = 127;
  const showGuitarGain = $derived(selectedTrackStore.trackType !== 'audio');
  const gtrValue = (macro: number) => (guitar.paramValue(macro) ?? 0) / MACRO_MAX;
  const sendGtr = (macro: number, normalized: number) => guitar.sendParam(macro, normalized * MACRO_MAX);
  let gtrClean = $derived(gtrValue(GTR.ampSwitch) >= 0.5);

  let pedalType = $derived(fx.paramValue(1) ?? 0);

  function selectPedalType(typeValue: number) {
    fx.sendParam(1, typeValue);
  }

  let wahInk = $derived({
    primary: trackInk(wah.color.primary, paintModeReactive()),
    secondary: wah.color.secondary,
    accent: trackInk(wah.color.accent, paintModeReactive())
  });

  // The Wah is a slider on the macro the expression pedal sweeps (2026-10-05,
  // a load/remove button before): Wah.adg's Macro 1, which the rack names
  // "Pedal", 0..127 — the surface's `devices.wah.freqMacroIndex`. A tap on a
  // ghost loads Wah.adg, a drag loads it and writes; the surface puts it at
  // the head of the audio effects either way.
  const WAH_PEDAL_MACRO = 1;
  let wahValue = $derived((wah.paramValue(WAH_PEDAL_MACRO) ?? 0) / MACRO_MAX);

  // The Gain-over-Wah column, at the head of the Guitar group: each half
  // its height, either one alone at full height. Its grid track exists only
  // while it holds something.
  const showLeftColumn = $derived(showGuitarGain || showWah);
  // One unit per slider, two per XY pad, every seam its hairline: the
  // tracks share the width in that ratio and nothing has a fixed size
  // (user, 2026-10-05). A pad spans two slider tracks, so it is exactly two
  // sliders and the gap between them. The Guitar section is `display:
  // contents`, so each of its controls is a grid item of its own; Output and
  // Mix split a pad-wide column with the same gap.
  const SLIDER = 'minmax(0, 1fr)';
  const XY = 'minmax(0, 1fr) minmax(0, 1fr)'; // two slider tracks; a pad spans both
  const SEAM = 'auto';
  const gridColumns = $derived(
    [
      XY, SEAM, // pedal pad over its type switch
      ...(showLeftColumn ? [SLIDER] : []), // gain over wah, heading the guitar group
      XY, SLIDER, SEAM, // spring/room over tremolo · dirty/clean
      SLIDER, SEAM, // shifter
      XY // output · mix over redux
    ].join(' ')
  );
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="pedal-central-layout relative" style="grid-template-columns: {gridColumns};">
  <!-- COLUMN 1: the Pedal's XY — the old grid tile, mounted standalone; a
       tap goes nowhere because this view is its home — over its type
       switch, laid out across (2026-10-05). -->
  <div class="column pad pedal-xy-column">
    <div class="xy-wrapper flex-1">
      <PedalControl device={fx.device} disableCentralViewOnTap={true} />
    </div>
    <div class="pedal-type-buttons" style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
      {#each PEDAL_TYPE_OPTIONS as option}
        <button
          class="physical-button w-full px-2 text-xs text-center font-medium"
          class:active={pedalType === option.value}
          style="--btn-tint: {pedalInk.primary};"
          onclick={() => selectPedalType(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Every device boundary gets a seam in the ink of the device it
       introduces (the Chorus rule, user's call, 2026-09-13). -->
  <SectionDivider orientation="vertical" ink={guitarInk.primary} />

  <!-- COLUMN 3: the Guitar rack's Spring/Room pad over its Tremolo pad, and
       the Dirty/Clean switch. Its Gain is in the left column. -->
  <div class="guitar-section">
    {#if showLeftColumn}
      <!-- The Guitar's Gain (MIDI tracks only — on audio the grid's Gtr
           column draws it) over the Wah, the macro the expression pedal
           sweeps (only while features.expressionPedal is on): the head of the
           Guitar group, no seam between (user, 2026-10-05). -->
      <div class="column left-stack">
        {#if showGuitarGain}
          <div class="left-cell">
            <GuitarControl device={guitar.device} disableCentralViewOnTap={true} />
          </div>
        {/if}
        {#if showWah}
          <div class="left-cell wah-cell">
            <DeviceSlider
              value={wahValue}
              title="Wah"
              orientation="vertical"
              labelOrientation="horizontal"
              labelSize="small"
              isGhost={wah.isGhost}
              color={wahInk}
              onTap={() => wah.loadIfGhost()}
              onInteraction={(v) => wah.sendParam(WAH_PEDAL_MACRO, v * MACRO_MAX)}
            />
          </div>
        {/if}
      </div>
    {/if}
    <!-- Two pads stacked: Spring (X) / Room (Y) over Tremolo, rate (X) /
         amount (Y) (user, 2026-10-05). -->
    <div class="column pad guitar-xy-stack">
      <div class="guitar-xy">
        <DeviceXY
          xValue={gtrValue(GTR.spring)}
          yValue={gtrValue(GTR.room)}
          title="Spring/Room"
          isGhost={guitar.isGhost}
          showCurve={false}
          color={guitarInk}
          onTap={() => guitar.loadIfGhost()}
          onInteraction={(x, y) => {
            sendGtr(GTR.spring, x);
            sendGtr(GTR.room, y);
          }}
        />
      </div>
      <div class="guitar-xy">
        <DeviceXY
          xValue={gtrValue(GTR.tremRate)}
          yValue={gtrValue(GTR.tremAmount)}
          title="Tremolo"
          isGhost={guitar.isGhost}
          showCurve={false}
          color={guitarInk}
          onTap={() => guitar.loadIfGhost()}
          onInteraction={(x, y) => {
            sendGtr(GTR.tremRate, x);
            sendGtr(GTR.tremAmount, y);
          }}
        />
      </div>
    </div>
    <div class="column tone-stack" style={guitar.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
      <button
        class="physical-button tone-btn"
        class:active={!guitar.isGhost && !gtrClean}
        aria-pressed={!guitar.isGhost && !gtrClean}
        style="--btn-tint: {guitarInk.primary};"
        onclick={() => sendGtr(GTR.ampSwitch, 0)}
      >Dirty</button>
      <button
        class="physical-button tone-btn"
        class:active={!guitar.isGhost && gtrClean}
        aria-pressed={!guitar.isGhost && gtrClean}
        style="--btn-tint: {guitarInk.primary};"
        onclick={() => sendGtr(GTR.ampSwitch, 1)}
      >Clean</button>
    </div>
  </div>

  <SectionDivider orientation="vertical" ink={shifterInk.primary} />

  <!-- COLUMN 4: the Shifter's ring-mod frequency, one fader. A tap on a
       ghost loads it; a drag loads it and writes the value. -->
  <div class="column shifter-column">
    <DeviceSlider
      value={Math.min(shifter.paramValue(SHIFTER_RM_COARSE) ?? 0, SHIFTER_RM_MAX)}
      title="Shifter"
      orientation="vertical"
      labelOrientation="vertical"
      isGhost={shifter.isGhost}
      color={shifterInk}
      min={0}
      max={SHIFTER_RM_MAX}
      onTap={() => armShifterLoad()}
      onInteraction={(v) => {
        armShifterLoad();
        shifter.sendParam(SHIFTER_RM_COARSE, v);
      }}
    />
  </div>

  <!-- COLUMN 5: the Saturator's Output and Mix side by side over the Redux
       pad, the column two sliders wide (user, 2026-10-05). Its XY is the
       grid tile that opened this view. -->
  <SectionDivider orientation="vertical" ink={saturatorInk.primary} />

  <div class="column pad sat-redux-column">
    <div class="saturator-faders" style={saturator.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
      {#each SATURATOR_FADERS as fader (fader.index)}
        <div class="slider-col">
          <DeviceSlider
            value={saturator.paramValue(fader.index) ?? fader.fallback}
            title={fader.title}
            orientation="vertical"
            labelOrientation="vertical"
            isGhost={saturator.isGhost}
            color={saturatorInk}
            min={0}
            max={1}
            onTap={() => saturator.loadIfGhost()}
            onInteraction={(v) => saturator.sendParam(fader.index, v)}
          />
        </div>
      {/each}
    </div>
    <div class="xy-wrapper redux-column">
      <ReduxControl device={redux.device} />
    </div>
  </div>

</div>

<style>
  .pedal-central-layout {
    display: grid;
    /* pedal XY over pedal-type tabs | guitar (gain over wah · spring/room
       pad over tremolo pad · dirty/clean) | shifter | saturator output · mix
       over redux.
       grid-template-columns comes from `gridColumns`: a slider is one
       share of the width, a pad two, a seam its hairline. */
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
    position: relative;
  }

  .xy-wrapper {
    flex: 1;
    min-height: 0;
  }

  .pad {
    grid-column: span 2;
  }

  /* A wrapper only: its controls are tracks of the grid itself. */
  .guitar-section {
    display: contents;
  }

  /* Output · Mix over Redux, each half the column's height; the two
     faders split its width with the same gap as the grid's, so each is
     one slider wide. */
  .saturator-faders {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
  }

  /* Every grid item may shrink below its content: the fr ratio, not the
     content, sets the widths. */
  .column {
    min-width: 0;
  }

  .slider-col {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

  .guitar-xy {
    flex: 1 1 0;
    min-height: 0;
  }

  .tone-btn {
    flex: 1 1 0;
    min-height: 0;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  /* Gain over Wah: each half the column's height, or the whole of it alone. */
  .left-cell {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Drive · Distort · Fuzz across the foot of the Pedal pad, one row a
     slider-label tall. */
  .pedal-type-buttons {
    display: flex;
    flex-direction: row;
    gap: var(--spacing-xs);
    flex: 0 0 auto;
    height: 3rem;
  }

  .pedal-type-buttons button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ---- Live skin (flat grammar): pedal-type buttons drop bold — Live
     sets button text at regular/medium weight (app.css already gives
     .physical-button its flat control field + ChosenDefault ON fill, so
     only the weight is local). The Digital / Redux modules are already
     flat inside bare flex wrappers — no frame / shadow / wash re-added
     here. The column ghost dim keeps the shared --opacity-ghost ramp (an
     app-wide idiom, not touched here). Graticule is untouched — every
     rule sits under [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
  }
</style>