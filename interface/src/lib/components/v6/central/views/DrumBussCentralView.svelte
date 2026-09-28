<script lang="ts">
  /**
   * DrumBussCentralView — what the Drum tile opens (2026-09-10).
   *
   * Seven EQUAL columns, the Boom pad taking two (user's layout,
   * 2026-09-12), in Live's own signal order, with a seam before Boom —
   * Live's separate low-end section and the only pad here (2026-09-13):
   *
   *   [Trim over Comp] [Soft/Medium/Hard] [Drive] [Crunch] [Damp] | [Boom  Boom]
   *
   * The Drum XY (transients x dry/wet) is the grid tile, so it is not
   * repeated here. Same slot machinery as every device view — ghost until
   * the track carries a Drum Buss, and a first write loads
   * `Drum Buss.adv` through `sendParam`. Squash (the Glue Compressor) is
   * not here; the Gain / Utility view mounts it.
   */

  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import SectionDivider from '$lib/components/v6/central/SectionDivider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

  const drum = useFxGridSlot('drum');

  let drumInk = $derived({
    primary: trackInk(drum.color.primary, paintModeReactive()),
    secondary: drum.color.secondary,
    accent: trackInk(drum.color.accent, paintModeReactive())
  });

  // Comp and Boom were measured off the running Drum Buss. Drive, its
  // type, Crunch, Damp and Trim are the user's indices (2026-09-12).
  const PARAM = {
    compressorOn: 1,
    drive: 2,
    driveType: 3,
    crunch: 4,
    damp: 5,
    boomAmount: 8,
    boomDecay: 9,
    trim: 11
  } as const;

  /** Top to bottom, in the order Live lists them — the value is the index. */
  const DRIVE_TYPES = ['Soft', 'Medium', 'Hard'] as const;

  let boomDecay = $derived(drum.paramValue(PARAM.boomDecay) ?? 0.5);
  let boomAmount = $derived(drum.paramValue(PARAM.boomAmount) ?? 0);
  let compressorOn = $derived((drum.paramValue(PARAM.compressorOn) ?? 1) >= 0.5);
  let driveType = $derived(Math.round(drum.paramValue(PARAM.driveType) ?? 0));

  function toggleComp() {
    drum.sendParam(PARAM.compressorOn, compressorOn ? 0 : 1);
  }

  /**
   * A continuous control as `t` in 0..1 through the parameter's OWN range.
   * Drive and Trim were given as 0..1, where this is the identity; Crunch
   * and Damp came without a range, and Damp in particular is a frequency
   * on Live's panel — a raw 0..1 pass-through would reach only the bottom
   * of its rail. Before the device exists (ghost) there is no range to
   * ask, so a first drag writes `t` raw and loads the device, the same as
   * every other view.
   */
  function rangeOf(param: number) {
    if (!drum.device) return null;
    const r = selectedTrackStore.paramRange(selectedTrackStore.paramPath(drum.device, param));
    return r && r.max > r.min ? r : null;
  }

  function readT(param: number, atRest: number): number {
    const raw = drum.paramValue(param);
    if (raw === undefined) return atRest;
    const r = rangeOf(param);
    const t = r ? (raw - r.min) / (r.max - r.min) : raw;
    return Math.max(0, Math.min(1, t));
  }

  function writeT(param: number, t: number) {
    const r = rangeOf(param);
    drum.sendParam(param, r ? r.min + t * (r.max - r.min) : t);
  }

  let drive = $derived(readT(PARAM.drive, 0));
  let crunch = $derived(readT(PARAM.crunch, 0));
  let damp = $derived(readT(PARAM.damp, 1));
  let trim = $derived(readT(PARAM.trim, 1));

  /**
   * Drive type is a VERTICAL tab, the grammar of Drift's waveform list,
   * and it scrubs up and down: the column owns one pointer and resolves
   * the step from geometry (the shared segmentScrub helper, on Y), so a
   * finger slides Soft → Medium → Hard. Only a step EDGE reaches Live.
   */
  let typeStrip = $state<HTMLElement | null>(null);
  let typeBox: ScrubBox | null = null;

  function driveTypeAt(clientY: number) {
    if (!typeBox) return;
    const step = segmentIndex(clientY, typeBox.top, typeBox.height, DRIVE_TYPES.length);
    if (step === driveType) return;
    drum.sendParam(PARAM.driveType, step);
  }

  function driveTypeDown(info: DragInfo) {
    typeBox = scrubBoxOf(typeStrip);
    driveTypeAt(info.y);
  }
</script>

<div class="drum-buss-layout" class:slot-ghost={drum.isGhost} style={drum.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
  <!-- Column 1: input Trim, first in Live's chain, over the Comp switch. -->
  <div class="col trim-comp">
    <div class="trim">
      <DeviceSlider
        value={trim}
        title="Trim"
        orientation="vertical"
        labelSize="small"
        isGhost={drum.isGhost}
        color={drumInk}
        onInteraction={(t) => writeT(PARAM.trim, t)}
      />
    </div>
    <button
      class="physical-button comp-toggle w-full font-bold"
      class:active={compressorOn}
      style="--btn-tint: {drumInk.primary};"
      onclick={toggleComp}
    >
      Comp
    </button>
  </div>

  <!-- Column 2: drive type, the house segmented control in its native
       stacked direction — no border overrides needed. -->
  <div
    class="col device-segmented drive-type"
    style="--btn-tint: {drumInk.primary}; grid-template-rows: repeat({DRIVE_TYPES.length}, 1fr);"
    bind:this={typeStrip}
    use:drag={{ commit: 'immediate', onDown: driveTypeDown, onMove: (i) => driveTypeAt(i.y) }}
  >
    {#each DRIVE_TYPES as label, step}
      <button
        class="device-segment drive-type-step"
        class:active={driveType === step}
        aria-label="Drive type {label}"
        aria-pressed={driveType === step}
        onclick={() => drum.sendParam(PARAM.driveType, step)}
      >{label}</button>
    {/each}
  </div>

  <div class="col">
    <DeviceSlider
      value={drive}
      title="Drive"
      orientation="vertical"
      labelSize="small"
      isGhost={drum.isGhost}
      color={drumInk}
      onInteraction={(t) => writeT(PARAM.drive, t)}
    />
  </div>

  <div class="col">
    <DeviceSlider
      value={crunch}
      title="Crunch"
      orientation="vertical"
      labelSize="small"
      isGhost={drum.isGhost}
      color={drumInk}
      onInteraction={(t) => writeT(PARAM.crunch, t)}
    />
  </div>

  <div class="col">
    <DeviceSlider
      value={damp}
      title="Damp"
      orientation="vertical"
      labelSize="small"
      isGhost={drum.isGhost}
      color={drumInk}
      onInteraction={(t) => writeT(PARAM.damp, t)}
    />
  </div>

  <!-- Boom is Live's separate low-end section, and the only pad here. -->
  <SectionDivider orientation="vertical" />

  <div class="col boom">
    <DeviceXY
      xValue={boomDecay}
      yValue={boomAmount}
      title="Boom"
      isGhost={drum.isGhost}
      showCurve={false}
      color={drumInk}
      onTap={() => drum.loadIfGhost()}
      onInteraction={(x, y) => {
        drum.sendParam(PARAM.boomDecay, x);
        drum.sendParam(PARAM.boomAmount, y);
      }}
    />
  </div>
</div>

<style>
  /* Seven equal columns; Boom spans the last two, past an `auto` track for
     the seam before it. */
  .drum-buss-layout {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr)) auto repeat(2, minmax(0, 1fr));
    gap: var(--central-gap);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
  }

  .col {
    min-height: 0;
    min-width: 0;
    height: 100%;
  }

  .boom {
    grid-column: span 2;
  }

  /* Trim takes most of the column; Comp is a button at its foot. */
  .trim-comp {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
  }
  .trim {
    flex: 3 1 0;
    min-height: 0;
  }
  .comp-toggle {
    flex: 1 1 0;
    min-height: var(--height-touch);
    font-size: 1rem;
    text-transform: uppercase;
  }

  .drive-type {
    display: grid;
  }
  /* The column owns the pointer; the steps are its face. Keyboard focus
     and Enter still activate one. */
  .drive-type-step {
    pointer-events: none;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  /* Flat grammar: Live sets control text at medium weight and mixed-case. */
  :global([data-grammar="flat"]) .physical-button,
  :global([data-grammar="flat"]) .drive-type-step {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .comp-toggle {
    text-transform: none;
  }

  /* ONE ink for the whole view (user, 2026-09-12: "can the colors be more
     consistent?"). The flat grammar lights every active `.physical-button`
     and `.device-segment` with the house ON colour, `--phosphor`, and
     ignores `--btn-tint` — so the lit Comp button and the lit drive type
     read a lighter amber beside faders and a pad drawn in the Drum Buss's
     own ink: two oranges in one view. Both take `--btn-tint` (the device
     ink) here, and an unlit step's word takes a mix of it, the same
     override DriftCentralView makes for its oscillator controls. */
  :global([data-grammar="flat"]) .comp-toggle.active,
  :global([data-grammar="flat"]) .drive-type .device-segment.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .drive-type .device-segment:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
  :global([data-grammar="flat"]) .comp-toggle:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
