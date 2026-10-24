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
   * Pedal is mounted here, beside its type tabs — since 2026-10-07 its tone
   * stack on the EQ tile's pad and one Drive/Mix slider. Of the
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
   * Room. Neither the Amp Switch nor Macro 7 has a control here (the
   * Dirty/Clean pair was removed 2026-10-22, the user's call). On an audio track the FX grid's Gtr column
   * already draws Gain, so the view leaves it out.
   *
   * The Wah (ADR-445, 2026-09-19) has no tile and no view of its own — the
   * expression pedal is how it is played. Since 2026-10-05 it is a slider on
   * the macro the pedal sweeps, under the Guitar's Gain in the left column
   * (a load/remove button before). A tap on a ghost loads `Wah.adg` at the
   * head of the track's audio effects, the pedal's own placement. Since
   * 2026-10-12 the slider is titled with the chain the toe switch selected
   * (Wah · Volume · Ring), read from the rack's `chain_names` property.
   *
   * The grid draws its Gtr slider on every track (MIDI since 2026-10-23,
   * Main since 2026-10-24, the user's calls) and it is the Guitar's door,
   * so the view splits in two: the Gtr (and
   * Bass) tile opens `GuitarCentralView`, which draws this view's `guitar`
   * part (the Pedal, then the Guitar rack with the Wah), and the Saturator
   * tile draws its `effects` part (the Shifter, the Saturator's Color,
   * Output and Mix, Redux at full height, and a Drum button where the Drum
   * cell holds the Chorus). `all`, the whole view with the Gain, is for a host that asks.
   *
   * NO {#if device} gate - always renders, handles its own state.
   * `part` is optional: left out, it follows the track (see above).
   */

  import ReduxControl from '$lib/components/v6/device-panel/ReduxControl.svelte';
  import ToneCurvePad from '$lib/components/v6/device-panel/ToneCurvePad.svelte';
  import GuitarControl from '$lib/components/v6/device-panel/GuitarControl.svelte';
  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
  import { drumCellHoldsChorus } from '$lib/components/v6/device-panel/drumCell.svelte';
  import { openDeviceView } from '$lib/services/deviceViewRouter.svelte';

  interface Props {
    part?: 'all' | 'guitar' | 'effects';
  }
  let { part }: Props = $props();
  // Every track has the grid's Gtr since Main took one (2026-10-24), so
  // the view is always split; `all` is the whole view, for a host that
  // asks for it.
  const shown = $derived(part ?? 'effects');
  const withGuitar = $derived(shown !== 'effects');
  const withEffects = $derived(shown !== 'guitar');
  // Where the Drum cell holds the Chorus (audio, Main and non-drum tracks)
  // the grid has no door to the Drum Buss, so this view ends in one: a Drum
  // button that inserts it if the track has none and opens its view, which
  // carries the Drum XY there (2026-10-24, the user's call; the whole Drum
  // Buss was embedded here the day before).
  const withDrum = $derived(shown === 'effects' && drumCellHoldsChorus());
  function openDrum() {
    drum.loadIfGhost();
    openDeviceView('drum', { device: drum.device, color: drum.color });
  }
  const drum = useFxGridSlot('drum');

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

  let drumInk = $derived(trackInk(drum.color.primary, paintModeReactive()));
  let reduxInk = $derived(trackInk(redux.color.primary, paintModeReactive()));

  let saturatorInk = $derived({
    primary: trackInk(saturator.color.primary, paintModeReactive()),
    secondary: saturator.color.secondary,
    accent: trackInk(saturator.color.accent, paintModeReactive())
  });

  // Index, label, and the value a fader rests at before the device answers.
  // Indices match the tile's PARAM_CONFIG (10 / 11); 10 was confirmed as
  // Output against the running device (2026-08-22). Nothing is remapped:
  // what a fader shows is what the device stores. Drive (1) has no fader:
  // it is the grid tile's.
  // Color Hi (8) joined them 2026-10-24, when the tile became a Drive
  // slider and lost the XY's Color axis.
  const SATURATOR_FADERS = [
    { index: 8, title: 'Color', fallback: 0.5, icon: 'tone' },
    { index: 10, title: 'Output', fallback: 1, icon: 'output' },
    { index: 11, title: 'Mix', fallback: 1, icon: 'mix' }
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
  const GTR = { spring: 2, tremRate: 3, tremAmount: 4, room: 5 } as const;
  const MACRO_MAX = 127;
  // The Gain is the grid's Gtr slider wherever the view is split; whole
  // (`all`), the view carries it.
  const showGuitarGain = $derived(shown === 'all');
  const gtrValue = (macro: number) => (guitar.paramValue(macro) ?? 0) / MACRO_MAX;
  const sendGtr = (macro: number, normalized: number) => guitar.sendParam(macro, normalized * MACRO_MAX);

  let pedalType = $derived(fx.paramValue(1) ?? 0);

  // The Pedal's tone stack on the EQ tile's pad (user, 2026-10-07), and its
  // Drive and Dry/Wet together on one slider, as the old pad's Y was.
  // Indices and ranges measured off the running device: 2 Drive 0..1,
  // 4 Bass / 5 Mid / 6 Treble -1..1 (0 flat), 7 Mid Freq quantized
  // Low · Mid · High, 9 Dry/Wet 0..1. The pad's X snaps to Mid Freq's three
  // steps; the curve draws them an octave apart, 315 Hz / 630 Hz /
  // 1.26 kHz, all inside the pad's middle third (user, 2026-10-07) — a
  // picture only: Live does not say what the three frequencies are.
  const PEDAL = { drive: 2, bass: 4, mid: 5, treble: 6, midFreq: 7, dryWet: 9 } as const;
  const MID_FREQ_STEPS = 2;
  const pedalMidFreqHz = (f: number) => 630 * Math.pow(2, (f - 0.5) * 2);
  const toneValue = (index: number) => ((fx.paramValue(index) ?? 0) + 1) / 2;
  const sendTone = (index: number, normalized: number) => fx.sendParam(index, normalized * 2 - 1);
  let pedalMidFreq = $derived((fx.paramValue(PEDAL.midFreq) ?? 1) / MID_FREQ_STEPS);
  let pedalDrive = $derived(fx.paramValue(PEDAL.drive) ?? 0);

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

  // The slider is titled with the chain the toe switch has selected
  // (2026-10-12): Macro 2 is mapped across the rack's chain selector, and
  // the toe switch steps it through the chains at even spacing — 3 chains
  // at 0 / 64 / 127 — so the chain is the macro's position rounded to the
  // nearest of those steps (the surface's `_step_values`). The names are
  // the rack's own (`chain_names`, Wah · Volume · Ring in Wah.adg).
  const WAH_CHAIN_MACRO = 2;
  let wahChainNames = $derived.by(() => {
    const value = wah.devicePath ? selectedTrackStore.propertyValue(wah.devicePath, 'chain_names') : undefined;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  let wahTitle = $derived.by(() => {
    const names = wahChainNames;
    if (wah.isGhost || names.length === 0) return 'Wah';
    const t = (wah.paramValue(WAH_CHAIN_MACRO) ?? 0) / MACRO_MAX;
    const index = Math.min(names.length - 1, Math.max(0, Math.round(t * (names.length - 1))));
    return names[index] || 'Wah';
  });
  $effect(() => {
    const path = wah.devicePath;
    if (!path || !showWah) return;
    return selectedTrackStore.subscribeProperty(path, 'chain_names');
  });

  // The Gain-over-Wah column, at the head of the Guitar group: each half
  // its height, either one alone at full height. Its grid track exists only
  // while it holds something.
  const showLeftColumn = $derived(showGuitarGain || showWah);
  // The Guitar group's width in tracks, so its name can span all of it:
  // Gain over Wah when shown, and the pads' two.
  const guitarSpan = $derived(showLeftColumn ? 3 : 2);
  // One unit per slider, two per XY pad, every seam its hairline: the
  // tracks share the width in that ratio and nothing has a fixed size
  // (user, 2026-10-05). A pad spans two slider tracks, so it is exactly two
  // sliders and the gap between them. The Pedal and Guitar groups are
  // subgrids, so each of their controls is still one track of this grid;
  // Output and Mix split a pad-wide column with the same gap.
  const SLIDER = 'minmax(0, 1fr)';
  const XY = 'minmax(0, 1fr) minmax(0, 1fr)'; // two slider tracks; a pad spans both
  const SEAM = 'auto';
  const gridColumns = $derived(
    [
      ...(withGuitar
        ? [
            SLIDER, XY, SEAM, // pedal: drive, then the tone pad over its type switch
            ...(showLeftColumn ? [SLIDER] : []), // gain over wah, heading the guitar group
            XY // spring/room over tremolo
          ]
        : []),
      ...(withGuitar && withEffects ? [SEAM] : []),
      ...(withEffects
        ? [
            SLIDER, SEAM, // shifter
            'minmax(0, 3fr)', SEAM, // the Saturator's Color · Output · Mix
            XY // redux, full height
          ]
        : []),
      // the Drum button
      ...(withDrum ? [SEAM, SLIDER] : [])
    ].join(' ')
  );
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="pedal-central-layout relative" style="grid-template-columns: {gridColumns};">
  {#if withGuitar}
  <!-- COLUMN 1: the Pedal — one Drive/Mix slider at the left, full
       height, then its tone stack on the EQ tile's pad over its type
       switch. -->
  <div class="column pedal-column">
    <span
      class="group-eyebrow"
      style="color: {pedalInk.primary};{fx.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
    >Pedal</span>
    <div class="pedal-drive" class:slot-ghost={fx.isGhost}>
      <DeviceSlider
        value={pedalDrive}
        title="Drive"
        icon="drive"
        orientation="vertical"
        labelOrientation="vertical"
        isGhost={fx.isGhost}
        color={pedalInk}
        min={0}
        max={1}
        onTap={() => fx.loadIfGhost()}
        onInteraction={(v) => {
          fx.sendParam(PEDAL.drive, v);
          fx.sendParam(PEDAL.dryWet, v);
        }}
      />
    </div>
    <div class="pedal-tone" class:slot-ghost={fx.isGhost}>
      <ToneCurvePad
        title="Tone"
        ariaLabel="Pedal tone: bass, mid and treble"
        low={toneValue(PEDAL.bass)}
        mid={toneValue(PEDAL.mid)}
        midFreq={pedalMidFreq}
        high={toneValue(PEDAL.treble)}
        isGhost={fx.isGhost}
        color={pedalInk}
        curveColor={pedalInk.primary}
        midFreqHz={pedalMidFreqHz}
        onTap={() => fx.loadIfGhost()}
        onLow={(v) => sendTone(PEDAL.bass, v)}
        onHigh={(v) => sendTone(PEDAL.treble, v)}
        onMid={(x, y) => {
          const step = Math.round(x * MID_FREQ_STEPS);
          if (step !== fx.paramValue(PEDAL.midFreq)) fx.sendParam(PEDAL.midFreq, step);
          sendTone(PEDAL.mid, y);
        }}
      />
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

  <!-- COLUMN 3: the Guitar rack — its Gain over the Wah, then its
       Spring/Room pad over its Tremolo pad. -->
  <div class="guitar-section" style="grid-column: span {guitarSpan};">
    <span
      class="group-eyebrow"
      style="color: {guitarInk.primary};{guitar.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
    >Guitar Amp</span>
    {#if showLeftColumn}
      <!-- The Guitar's Gain (MIDI tracks only — on audio the grid's Gtr
           column draws it) over the Wah, the macro the expression pedal
           sweeps (only while features.expressionPedal is on): the head of the
           Guitar's controls, no seam between (user, 2026-10-05). -->
      <div class="column left-stack">
        {#if showGuitarGain}
          <div class="left-cell" class:slot-ghost={guitar.isGhost}>
            <GuitarControl device={guitar.device} disableCentralViewOnTap={true} icon="amp" />
          </div>
        {/if}
        {#if showWah}
          <div class="left-cell wah-cell" class:slot-ghost={wah.isGhost}>
            <DeviceSlider
              value={wahValue}
              title={wahTitle}
              icon="wah"
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
    <div class="column pad guitar-xy-stack" class:slot-ghost={guitar.isGhost}>
      <div class="guitar-xy">
        <DeviceXY
          xValue={gtrValue(GTR.spring)}
          yValue={gtrValue(GTR.room)}
          title="Spring/Room"
          icon="reverb"
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
          icon="tremolo"
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
  </div>

  {/if}

  {#if withGuitar && withEffects}
  <SectionDivider orientation="vertical" ink={shifterInk.primary} />
  {/if}

  {#if withEffects}

  <!-- COLUMN 4: the Shifter's ring-mod frequency, one fader. A tap on a
       ghost loads it; a drag loads it and writes the value. -->
  <div class="column shifter-column" class:slot-ghost={shifter.isGhost}>
    <DeviceSlider
      value={Math.min(shifter.paramValue(SHIFTER_RM_COARSE) ?? 0, SHIFTER_RM_MAX)}
      title="Shifter"
      icon="ringmod"
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

  <!-- COLUMN 5: the Saturator's Color, Output and Mix side by side, full
       height, then Redux in a column of its own (2026-10-24, the user's
       call; the faders sat over Redux before). The Saturator's Drive is the
       grid slider that opened this view. -->
  <SectionDivider orientation="vertical" ink={saturatorInk.primary} />

  <div class="column saturator-column">
    <div class="saturator-faders" style={saturator.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
      {#each SATURATOR_FADERS as fader (fader.index)}
        <div class="slider-col">
          <DeviceSlider
            value={saturator.paramValue(fader.index) ?? fader.fallback}
            title={fader.title}
            icon={fader.icon}
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
  </div>

  <SectionDivider orientation="vertical" ink={reduxInk} />

  <div class="column pad redux-column" class:slot-ghost={redux.isGhost}>
    <div class="xy-wrapper">
      <ReduxControl device={redux.device} icon="redux" />
    </div>
  </div>

  {/if}

  {#if withDrum}
  <SectionDivider orientation="vertical" ink={drumInk} />
  <!-- The Drum Buss's door: inserts it if the track has none, then opens
       its view (the Drum XY and its controls). Controls nothing itself. -->
  <div class="column drum-col">
    <button
      type="button"
      class="physical-button drum-door"
      class:is-ghost={drum.isGhost}
      data-debug="drum-door"
      style="--btn-tint: {drumInk};"
      aria-label={drum.isGhost ? 'Add a Drum Buss and open it' : 'Open the Drum Buss'}
      onclick={openDrum}
    >Drum</button>
  </div>
  {/if}
</div>

<style>
  .drum-col {
    min-width: 0;
  }
  .drum-door {
    flex: 1 1 0;
    min-height: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--btn-tint);
  }
  .drum-door.is-ghost {
    opacity: var(--opacity-ghost);
  }

  .pedal-central-layout {
    display: grid;
    /* pedal XY over pedal-type tabs | guitar (gain over wah ·
       spring/room pad over tremolo pad) | shifter | saturator output · mix
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

  /* The Pedal on the view's own tracks (subgrid): Drive on one, at the left
     and full height, then the tone pad on two with the type switch under it
     (2026-10-23, the user's layout). */
  .pedal-column {
    grid-column: span 3;
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    row-gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }

  .pedal-drive {
    grid-column: 1;
    grid-row: 2 / span 2;
    min-width: 0;
    min-height: 0;
  }

  .pedal-tone {
    grid-column: 2 / span 2;
    grid-row: 2;
    min-width: 0;
    min-height: 0;
  }

  .pedal-column .pedal-type-buttons {
    grid-column: 2 / span 2;
    grid-row: 3;
  }

  /* The Guitar group on the view's own tracks (subgrid), like the Pedal:
     its name across the top, its controls below, each still one track of
     the grid. The span comes from `guitarSpan`. */
  .guitar-section {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: auto minmax(0, 1fr);
    row-gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }

  /* The eyebrow every named group in a central view wears (EnvelopeGroup's),
     across the group's full width. Its gap to the controls it names is the
     control's own (--spacing-xs), not the view's. */
  .group-eyebrow {
    grid-column: 1 / -1;
    grid-row: 1;
    margin-bottom: calc(var(--spacing-xs) - var(--central-gap));
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-align: center;
    white-space: nowrap;
  }
  :global([data-grammar="flat"]) .group-eyebrow {
    letter-spacing: normal;
    font-weight: var(--font-weight-medium);
  }

  /* Color · Output · Mix at full height; the three faders split the
     column's width with the same gap as the grid's, so each is one slider
     wide. */
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