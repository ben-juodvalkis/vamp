<script lang="ts">
  /**
   * PedalCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Renders immediately with ghost/loading/active states.
   * Displays pedal controls with virtual devices (digital, redux).
   *
   * The Saturator is back (2026-09-10, ADR-431): its XY — the FX-grid
   * tile, mounted here standalone — and its four parameters on faders
   * (Drive, Color Hi, Output, Mix — what SaturatorCentralView broke out
   * before it went). The Drum Buss, once column 1 here and then a rail
   * beside the instrument views (ADR-424), is a grid tile with its own
   * view now.
   *
   * The Guitar came the same way on 2026-09-15, when the FX grid went to
   * ten columns: the amp rack's drive slider is mounted standalone like the
   * Saturator. Unlike the Saturator its tap is NOT disabled — the Saturator
   * is home here, the Guitar is not, and this mount is the only door left to
   * `GuitarCentralView` on a MIDI track.
   *
   * The Wah is the last column (ADR-445, 2026-09-19): one button, because
   * the wah has no tile and no view — the expression pedal is how it is
   * played, and this button is its only door on the iPad. Tap loads
   * `Wah.adg` onto the selected track at the head of its audio effects, the
   * pedal's own placement (`device/load` lands the wah preset there since
   * the same change); the pedal then drives it — on a synth track too, where
   * it otherwise drives the Expression Pedal rack. Hold removes the wah and
   * hands the pedal back. Lit while the track carries one.
   *
   * NO {#if device} gate - always renders, handles its own state.
   * NO props required - queries selectedTrackStore directly.
   */

  import DigitalControl from '$lib/components/v6/device-panel/DigitalControl.svelte';
  import ReduxControl from '$lib/components/v6/device-panel/ReduxControl.svelte';
  import SaturatorControl from '$lib/components/v6/device-panel/SaturatorControl.svelte';
  import GuitarControl from '$lib/components/v6/device-panel/GuitarControl.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { press, HOLD_MS, type PressOptions } from '$lib/actions';
  import { deleteDevice } from '$lib/services/deviceMoveService';
  import SectionDivider from '../SectionDivider.svelte';
  import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

  const fx = useFxGridSlot('pedal');
  const digital = useFxGridSlot('digital');
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

  let saturatorInk = $derived({
    primary: trackInk(saturator.color.primary, paintModeReactive()),
    secondary: saturator.color.secondary,
    accent: trackInk(saturator.color.accent, paintModeReactive())
  });

  // Index, label, and the value a fader rests at before the device answers.
  // Indices match the tile's PARAM_CONFIG (1 / 8 / 10 / 11); 10 was confirmed
  // as Output against the running device (2026-08-22). Nothing is remapped:
  // what a fader shows is what the device stores.
  const SATURATOR_FADERS = [
    { index: 1, title: 'Drive', fallback: 0.5 },
    { index: 8, title: 'Color Hi', fallback: 0.5 },
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

  let pedalType = $derived(fx.paramValue(1) ?? 0);

  function selectPedalType(typeValue: number) {
    fx.sendParam(1, typeValue);
  }

  let wahInk = $derived({
    primary: trackInk(wah.color.primary, paintModeReactive()),
    secondary: wah.color.secondary,
    accent: trackInk(wah.color.accent, paintModeReactive())
  });

  // Tap loads when the slot is a ghost (a no-op while loading or present);
  // hold removes the wah when the track has one. `press` never fires
  // `onPress` for a press that reported a hold, so a long press cannot load
  // back what it just removed. `touch-action: none`: the button owns the
  // gesture — there is nothing to scroll here.
  const wahPress: PressOptions = {
    holdMs: HOLD_MS,
    touchAction: 'none',
    onPress: () => wah.loadIfGhost(),
    onHold: () => {
      const path = wah.devicePath;
      if (path) void deleteDevice(path);
    }
  };

  let wahTitle = $derived(
    wah.device
      ? 'Wah on this track — the expression pedal drives it. Hold to remove.'
      : 'Tap to load the Wah onto this track; the expression pedal then drives it.'
  );
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<div class="pedal-central-layout relative" class:no-wah={!showWah}>
  <!-- COLUMN 1: Digital/Shifter Controls -->
  <div class="column digital-column">
    <div class="xy-wrapper flex-1">
      <DigitalControl device={digital.device} />
    </div>
  </div>

  <!-- Digital and Redux are two devices too — same size, same ink as the
       Saturator beside them — so every device boundary gets its seam, the
       Chorus rule (user's call, 2026-09-13). -->
  <SectionDivider orientation="vertical" ink={redux.color.primary} />

  <!-- COLUMN 2: Redux Controls -->
  <div class="column redux-column">
    <div class="xy-wrapper flex-1">
      <ReduxControl device={redux.device} />
    </div>
  </div>

  <!-- The Saturator starts here: its pad and its four faders are one device,
       and the three pads are the same size in the same distortion ink, so
       without this line the Saturator's pad read as a third sibling of
       Digital and Redux (user's call, 2026-09-13). -->
  <SectionDivider orientation="vertical" ink={saturatorInk.primary} />

  <!-- COLUMN 3: the Saturator's XY — the grid tile, mounted standalone; a
       tap goes nowhere because this view is its home. -->
  <div class="column saturator-column">
    <div class="xy-wrapper flex-1">
      <SaturatorControl device={saturator.device} disableCentralViewOnTap={true} />
    </div>
  </div>

  <!-- COLUMN 4: the Saturator's four parameters, one fader each -->
  <div class="column saturator-faders" style={saturator.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
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

  <!-- Everything right of this seam is the Pedal itself. The Saturator's
       faders and the type tabs are both narrow stacks of the same width, so
       without a line between them they read as one control group belonging
       to one device (2026-09-13). -->
  <SectionDivider orientation="vertical" ink={pedalInk.primary} />

  <!-- COLUMN 5: Pedal Controls -->
  <div class="column pedal-column" style={fx.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
    <!-- Pedal Type Tabs (stacked vertically, full height) -->
    <div class="pedal-type-buttons">
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

  <!-- The Guitar is a fourth device on this page, so it takes a seam of its
       own in its own ink — the same rule the Saturator and the Pedal keep
       above. -->
  <SectionDivider orientation="vertical" ink={guitarInk.primary} />

  <!-- COLUMN 6: the Guitar amp rack's drive, the grid tile mounted
       standalone. A tap opens GuitarCentralView (macros 2-8 and Macro 1),
       and a drag on a ghost still loads Guitar.adg — both behaviours come
       with the tile, which is why this is the tile and not a bare fader. -->
  <div class="column guitar-column">
    <GuitarControl device={guitar.device} />
  </div>

  {#if showWah}
    <!-- The Wah is a fifth device on this page, so it takes a seam of its own
         in its own ink — the filter family the wah preset wears. -->
    <SectionDivider orientation="vertical" ink={wahInk.primary} />

    <!-- COLUMN 7: the Wah button (ADR-445). Tap loads Wah.adg onto the
         selected track at the head of its audio effects, hold removes it.
         Ghost-dim while the track has none, like every other empty slot here;
         lit (the ChosenDefault ON fill) while it does. -->
    <div class="column wah-column" style={wah.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
      <button
        class="physical-button wah-button w-full px-2 text-xs text-center font-medium"
        class:active={wah.device !== null}
        class:loading={wah.isLoading}
        style="--btn-tint: {wahInk.primary};"
        aria-pressed={wah.device !== null}
        title={wahTitle}
        use:press={wahPress}
      >
        Wah
      </button>
    </div>
  {/if}

</div>

<style>
  .pedal-central-layout {
    display: grid;
    /* digital | redux | saturator XY · saturator faders | pedal-type tabs
       | guitar drive | wah. The faders column is as wide as its four
       sliders need, the tabs as wide as their labels, the Guitar and the
       Wah one slider wide each, each seam as wide as its hairline; the
       three pads share the rest. */
    grid-template-columns: 1fr auto 1fr auto 1fr auto auto auto auto auto auto auto;
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  /* No wah (features.expressionPedal off): its seam and column go, and so
     must their two tracks — an empty explicit track still takes a gap. */
  .pedal-central-layout.no-wah {
    grid-template-columns: 1fr auto 1fr auto 1fr auto auto auto auto auto;
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

  .saturator-faders {
    flex-direction: row;
  }

  /* Four faders at the Drum Rack view's slider width; the label runs up
     the fader (as Gain's does there) — at this width a horizontal
     "Output" clips and "Color Hi" wraps. */
  .slider-col {
    width: var(--vm-slider-w, 56px);
    min-height: 0;
  }

  /* One slider wide, like the Saturator's faders beside it. */
  .guitar-column {
    width: var(--vm-slider-w, 56px);
  }

  /* The Wah button: one slider wide too, the column's full height, its
     label centred — the pedal-type tabs' shape, one tab tall. */
  .wah-column {
    width: var(--vm-slider-w, 56px);
  }

  .wah-button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pedal-type-buttons {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    flex: 1;
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