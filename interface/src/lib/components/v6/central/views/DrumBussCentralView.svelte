<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * DrumBussCentralView — what the Drum tile opens (2026-09-10).
   *
   * Ten EQUAL columns on the face grid (ADR-510), in Live's own signal
   * order, four sections [1, 5, 3, 1] (every parameter Live lists since
   * 2026-11-18, the user's call: Transients, Boom Freq and Audition,
   * Output and Dry/Wet were missing):
   *
   *   Input [Trim over Comp] | Drive [Soft/Medium/Hard] [Drive] [Crunch]
   *   [Damp] [Transients] | Boom [Boom  Boom] [Freq over Audition] |
   *   Output [Output over Dry/Wet]
   *
   * Input has its own seam since the Ink rollout (ADR-544): Trim stands
   * over its Comp switch, so it sits higher than the three distortion
   * knobs, and inside one section that read as a knob out of line. The
   * drive type is a tab beside the Drive knob it belongs to; Drive, Crunch
   * and Damp are one row of large knobs, the size Trim draws. Boom is
   * Live's separate low-end section and the only pad here (2026-09-13).
   *
   * One ink (ADR-544): the amounts are the selected track's (the slot's
   * scheme), a lit Comp and the chosen drive type are on's block, every
   * name a label.
   *
   * The Drum XY (transients x dry/wet) is the chain cell's control (the
   * `drum` control, deviceControls, ADR-479), drawn above this view, so the
   * view draws no such PAD (user, 2026-11-06); the two are knobs here,
   * each in its place in Live's order. Same slot machinery as every device view — ghost until the track
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
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';

  const drum = useFxGridSlot('drum');

  // The selected track's ink, as the slot's scheme hands it over (ADR-544).
  let drumInk = $derived(drum.color);

  // Every index dumped off the running Drum Buss (device_dump, 2026-11-18),
  // Live's names beside them. All 0..1 but Transients (-1..1) and the
  // quantized Drive Type (0..2) and switches.
  const PARAM = {
    compressorOn: 1, // 'Compressor On'
    drive: 2, //        'Drive'
    driveType: 3, //    'Drive Type' Soft / Medium / Hard
    crunch: 4, //       'Crunch'
    damp: 5, //         'Damping Freq' 500 Hz .. 20 kHz
    transients: 6, //   'Transients' -1..1
    boomFreq: 7, //     'Boom Freq' 30 .. 90 Hz
    boomAmount: 8, //   'Boom Amt'
    boomDecay: 9, //    'Boom Decay'
    boomAudition: 10, // 'Boom Audition'
    trim: 11, //        'Trim'
    output: 12, //      'Output' -40 .. +3 dB (0 dB at 0.925)
    dryWet: 13 //       'Dry/Wet'
  } as const;

  /** Top to bottom, in the order Live lists them — the value is the index. */
  const DRIVE_TYPES = ['Soft', 'Medium', 'Hard'] as const;

  let boomDecay = $derived(drum.paramValue(PARAM.boomDecay) ?? 0.5);
  let boomAmount = $derived(drum.paramValue(PARAM.boomAmount) ?? 0);
  let compressorOn = $derived((drum.paramValue(PARAM.compressorOn) ?? 1) >= 0.5);
  let driveType = $derived(Math.round(drum.paramValue(PARAM.driveType) ?? 0));
  let audition = $derived((drum.paramValue(PARAM.boomAudition) ?? 0) >= 0.5);

  function toggleComp() {
    drum.sendParam(PARAM.compressorOn, compressorOn ? 0 : 1);
  }
  function toggleAudition() {
    drum.sendParam(PARAM.boomAudition, audition ? 0 : 1);
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
  let transients = $derived(readT(PARAM.transients, 0.5));
  let boomFreq = $derived(readT(PARAM.boomFreq, 0.465));
  let output = $derived(readT(PARAM.output, 0.925));
  let dryWet = $derived(readT(PARAM.dryWet, 1));

  // Output over Dry/Wet, the chain's last two.
  let outputs = $derived([
    { value: output, title: 'Output', icon: 'output', param: PARAM.output },
    { value: dryWet, title: 'Dry/Wet', icon: 'mix', param: PARAM.dryWet }
  ] as const);

  // Drive, Crunch, Damp and Transients, in Live's order: a knob a column.
  let distortion = $derived([
    { value: drive, title: 'Drive', icon: 'drive', param: PARAM.drive, bipolar: false },
    { value: crunch, title: 'Crunch', icon: 'crunch', param: PARAM.crunch, bipolar: false },
    { value: damp, title: 'Damp', icon: 'cutoff', param: PARAM.damp, bipolar: false },
    { value: transients, title: 'Transients', icon: 'attack', param: PARAM.transients, bipolar: true }
  ] as const);

</script>

<div class="drum-buss-layout" class:slot-ghost={drum.isGhost}>
  <FaceGrid sections={[1, 5, 3, 1]}>
  <!-- Live's chain, in its order: Trim and Comp, then the drive type,
       Drive, Crunch and Damp, then Boom. -->
  <FaceSection span={1} class={drum.isGhost ? 'drum-buss-faces-ghost' : ''}>
    {#snippet head()}<PanelEyebrow title="Input" color={drumInk.primary} />{/snippet}
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
          isGhost={drum.isGhost}
          color={drumInk}
          readout={drum.paramDisplay(PARAM.trim)}
          onInteraction={(t) => writeT(PARAM.trim, t)}
        />
      </div>
      <button
        class="physical-button btn-toggle comp-toggle w-full"
        class:active={compressorOn}
        use:press={{ onPress: () => toggleComp() }}
      >
        Comp
      </button>
    </div>
  </FaceSection>
  <FaceSeam ink={drumInk.primary} />

  <FaceSection span={5} class={drum.isGhost ? 'drum-buss-faces-ghost' : ''}>
    {#snippet head()}<PanelEyebrow title="Drive" color={drumInk.primary} />{/snippet}
    <!-- Drive type is a VERTICAL tab that scrubs, Soft → Medium → Hard,
         beside the Drive knob it belongs to. -->
    <ScrubTabs
      options={DRIVE_TYPES}
      selected={driveType}
      onSelect={(step) => drum.sendParam(PARAM.driveType, step)}
      cols={1}
      label={(t) => `Drive type ${t}`}
      name="drive-type"
      style="height: 100%; --scrub-font-size: 1rem; --scrub-font-weight: var(--font-weight-medium);"
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
          centerOrigin={box.bipolar}
          isGhost={drum.isGhost}
          color={drumInk}
          readout={drum.paramDisplay(box.param)}
          onInteraction={(t) => writeT(box.param, t)}
        />
      </div>
    {/each}
  </FaceSection>
  <FaceSeam ink={drumInk.primary} />

  <!-- Boom is Live's separate low-end section, and the only pad here:
       Decay across, Amount up; then its Freq over the Audition switch,
       built as Trim over Comp is. -->
  <FaceSection span={3} class={drum.isGhost ? 'drum-buss-faces-ghost' : ''}>
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
    <div class="col trim-comp">
      <div class="trim" data-param="boom-freq">
        <DeviceSlider
          value={boomFreq}
          title="Freq"
          face="knob"
          knobSize="l"
          icon="cutoff"
          isGhost={drum.isGhost}
          color={drumInk}
          readout={drum.paramDisplay(PARAM.boomFreq)}
          onInteraction={(t) => writeT(PARAM.boomFreq, t)}
        />
      </div>
      <button
        class="physical-button btn-toggle comp-toggle w-full"
        class:active={audition}
        aria-pressed={audition}
        use:press={{ onPress: () => toggleAudition() }}
      >
        Audition
      </button>
    </div>
  </FaceSection>
  <FaceSeam ink={drumInk.primary} />

  <!-- Output over Dry/Wet, last in Live's chain. Dry/Wet is also the chain
       cell's Drum XY's up axis. -->
  <FaceSection span={1} class={drum.isGhost ? 'drum-buss-faces-ghost' : ''}>
    {#snippet head()}<PanelEyebrow title="Output" color={drumInk.primary} />{/snippet}
    <div class="col out-col">
      {#each outputs as box (box.param)}
        <div class="knob" data-param={box.title}>
          <DeviceSlider
            value={box.value}
            title={box.title}
            face="knob"
            knobSize="m"
            icon={box.icon}
            isGhost={drum.isGhost}
            color={drumInk}
            readout={drum.paramDisplay(box.param)}
            onInteraction={(t) => writeT(box.param, t)}
          />
        </div>
      {/each}
    </div>
  </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): ten equal columns, Trim, the
     drive type, Drive, Crunch, Damp and Transients one each, the Boom pad
     two and its Freq one, Output and Dry/Wet stacked in one. */
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
  .out-col {
    gap: var(--face-gutter);
  }
  .out-col > .knob {
    flex: 1 1 0;
    min-height: 0;
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
    font-weight: 700;
    text-transform: uppercase;
  }

  /* Flat grammar: control text at medium weight and mixed-case. A lit Comp
     is on's block and an unlit one a label, by app.css's own law
     (ADR-544): the view passes no tint. */
  :global([data-grammar="flat"]) .comp-toggle {
    font-weight: var(--font-weight-medium);
    text-transform: none;
  }
</style>
