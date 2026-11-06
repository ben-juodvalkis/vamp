<script lang="ts">
  /**
   * DrumBussCentralView — what the Drum tile opens (2026-09-10).
   *
   * Seven EQUAL columns (user's layout, 2026-09-12), in Live's own signal
   * order, with a seam before Boom — Live's separate low-end section and the
   * only pad here (2026-09-13):
   *
   *   [Trim over Comp] [Soft/Medium/Hard] [Drive over Crunch over Damp]
   *   | [Boom  Boom  Boom  Boom]
   *
   * Drive, Crunch and Damp are value boxes (ADR-477), three in one column:
   * each sweeps over a fixed finger travel at least, so a third of a fader's
   * height is as fine as the fader was. Boom took the two columns they
   * spread over (it was two columns wide).
   *
   * On the face grid (ADR-510) since 2026-11-06, sections [5, 2]: Drive
   * (Trim over Comp, the drive type, Drive, Crunch, Damp) and Boom, seven
   * columns of about 137px. One knob a column, large.
   *
   * The Drum XY (transients x dry/wet) is the chain cell's control (the
   * `drum` control, deviceControls, ADR-479), drawn above this view, so the
   * view no longer draws it too (user, 2026-11-06); its two columns went
   * to the knobs. Same slot machinery as every device view — ghost until the track
   * carries a Drum Buss, and a first write loads `Drum Buss.adv` through
   * `sendParam`.
   */

  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

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

  // Drive, Crunch and Damp, top to bottom: the column of value boxes.
  let distortion = $derived([
    { value: drive, title: 'Drive', icon: 'drive', param: PARAM.drive },
    { value: crunch, title: 'Crunch', icon: 'crunch', param: PARAM.crunch },
    { value: damp, title: 'Damp', icon: 'cutoff', param: PARAM.damp }
  ] as const);

</script>

<div class="drum-buss-layout" class:slot-ghost={drum.isGhost}>
  <FaceGrid sections={[5, 2]}>
  <!-- Live's chain, in its order: Trim, Comp, the drive type, Drive, Crunch, Damp. -->
  <FaceSection span={5} class={drum.isGhost ? 'drum-buss-faces-ghost' : ''}>
    {#snippet head()}<PanelEyebrow title="Drive" color={drumInk.primary} />{/snippet}
    <!-- Input Trim, first in Live's chain, over the Comp switch. -->
    <div class="col trim-comp">
      <div class="trim">
        <DeviceSlider
          value={trim}
          title="Trim"
          face="knob"
          knobSize="l"
          icon="gain"
          orientation="vertical"
          labelSize="small"
          isGhost={drum.isGhost}
          color={drumInk}
          readout={drum.paramDisplay(PARAM.trim)}
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

    <!-- Drive type is a VERTICAL tab that scrubs, Soft → Medium → Hard. -->
    <ScrubTabs
      options={DRIVE_TYPES}
      selected={driveType}
      onSelect={(step) => drum.sendParam(PARAM.driveType, step)}
      cols={1}
      tint={drumInk.primary}
      inked
      label={(t) => `Drive type ${t}`}
      name="drive-type"
      style="height: 100%; --scrub-font-size: 0.8125rem; --scrub-font-weight: var(--font-weight-medium);"
    >
      {#snippet item(t)}{t}{/snippet}
    </ScrubTabs>

    <!-- The distortion and its tone in Live's order, as knobs (ADR-509),
         one to a column on the face's own columns. -->
    {#each distortion as box (box.param)}
      <div class="col knob">
        <DeviceSlider
          value={box.value}
          title={box.title}
          face="knob"
          knobSize="l"
          icon={box.icon}
          isGhost={drum.isGhost}
          color={drumInk}
          readout={drum.paramDisplay(box.param)}
          onInteraction={(t) => writeT(box.param, t)}
        />
      </div>
    {/each}
  </FaceSection>
  <FaceSeam ink={drumInk.primary} />

  <!-- Boom is Live's separate low-end section, and the only pad here. -->
  <FaceSection span={2} class={drum.isGhost ? 'drum-buss-faces-ghost' : ''}>
    {#snippet head()}<PanelEyebrow title="Boom" color={drumInk.primary} />{/snippet}
    <div class="col boom face-span-2">
      <DeviceXY
        xValue={boomDecay}
        yValue={boomAmount}
        title="Boom"
        icon="boom"
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
  </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): seven equal columns, Trim, the
     drive type, Drive, Crunch and Damp one each, Boom two. */
  .drum-buss-layout {
    height: 100%;
    width: 100%;
  }
  /* The ghost dim on each face (the Boom pad draws its own). */
  :global(.drum-buss-faces-ghost) > :global(.face-body) > :global(*) {
    opacity: var(--opacity-ghost);
  }

  .col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    height: 100%;
  }
  .knob > :global(*),
  .boom > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }

  /* Trim takes the column; Comp is one touch row at its foot (ADR-509). */
  .trim-comp {
    gap: var(--face-gutter);
  }
  .trim {
    flex: 1 1 0;
    min-height: 0;
  }
  .comp-toggle {
    flex: 0 0 var(--height-touch);
    min-height: var(--height-touch);
    font-size: 1rem;
    text-transform: uppercase;
  }


  /* Flat grammar: Live sets control text at medium weight and mixed-case. */
  :global([data-grammar="flat"]) .physical-button {
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
  :global([data-grammar="flat"]) .comp-toggle.active {
    background: var(--btn-tint);
    border-color: var(--btn-tint);
    color: var(--flat-on-fg);
  }
  :global([data-grammar="flat"]) .comp-toggle:not(.active) {
    color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
  }
</style>
