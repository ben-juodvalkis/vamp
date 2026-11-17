<script lang="ts">
  /**
   * The Saturator's view (the `saturator` slot, the Drive tile). Its own
   * file since the FX chain overview took over from the grid (2026-10-26);
   * it was the `effects` part of the Pedal view.
   *
   *   Color [Color pad: Freq across, Hi up][Bass] | Output [Output][Mix]
   *
   * On the face grid (ADR-510), sections [4, 2], six equal columns. The
   * Color pad leads, the one thing played, over three columns, its name at
   * its foot (a fresh Saturator rests the dot in the pad's middle, where
   * its mark and name hid it), Live's frequency in the name's place while a
   * finger moves it; then the two
   * amounts set and left, Bass and Output, two knobs of one size on one
   * line either side of the seam; Mix, the level that is ridden, a box at
   * the right edge (ADR-509). Until the Ink rollout (ADR-544) Bass stood
   * ahead of the pad, one knob beside a field four times its size, and
   * Output and Mix were a section each, named twice.
   *
   * The Color section as a slider and a pad (user, 2026-10-26; one Color Hi
   * fader before). Indices and rails measured on the rig the same day (the
   * Saturator preset loaded and dumped): 4 Color On, 5 Color Amt Low and
   * 8 Color Amt Hi -100..100 % on 0..1 (0 % at 0.5), 6 Color Freq 30 Hz..
   * 18.5 kHz on 0..1, 10 Output, 11 Dry/Wet. The Color amounts are heard
   * only while Color is on, so a gesture on either turns it on. What a
   * control shows is what the device stores. Drive (1) is the tile's,
   * which the chain cell carries.
   *
   * NO {#if device} gate - always renders, handles its own state.
   */

  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const saturator = useFxGridSlot('saturator');

  // The selected track's ink, as the slot's scheme hands it over (ADR-544).
  let saturatorInk = $derived(saturator.color);

  const COLOR = { on: 4, low: 5, freq: 6, hi: 8 } as const;
  /** Live's values on a fresh Saturator, what a ghost shows. */
  const REST = { low: 0.4956, freq: 0.5458, hi: 0.5044 } as const;

  const value = (index: number, rest: number) => saturator.paramValue(index) ?? rest;
  /** A Color write is heard only with Color on: turn it on first when it is off. */
  function writeColor(writes: Array<[number, number]>) {
    if ((saturator.paramValue(COLOR.on) ?? 1) < 0.5) saturator.sendParam(COLOR.on, 1);
    for (const [index, v] of writes) saturator.sendParam(index, v);
  }

  // The pad says Live's frequency in place of its name while a finger moves
  // it, as a box does, and no number at rest (ADR-544).
  let colorDragging = $state(false);
  let colorReadout = $derived(colorDragging && !saturator.isGhost ? saturator.paramDisplay(COLOR.freq) : undefined);

  // Index, label, and the value a fader rests at before the device answers.
  const SATURATOR_FADERS = [
    { index: 10, title: 'Output', fallback: 1, icon: 'output' },
    { index: 11, title: 'Mix', fallback: 1, icon: 'mix' }
  ] as const;
</script>

{#snippet fader(f: (typeof SATURATOR_FADERS)[number])}
  <div class="slider-col" class:slot-ghost={saturator.isGhost}>
    <DeviceSlider
      value={saturator.paramValue(f.index) ?? f.fallback}
      title={f.title}
      face={f.title === 'Mix' ? 'slider' : 'knob'}
      knobSize="l"
      icon={f.icon}
      orientation="vertical"
      isGhost={saturator.isGhost}
      color={saturatorInk}
      readout={saturator.paramDisplay(f.index)}
      min={0}
      max={1}
      onTap={() => saturator.loadIfGhost()}
      onInteraction={(v) => saturator.sendParam(f.index, v)}
    />
  </div>
{/snippet}

<div class="saturator-layout" data-view="saturator">
  <FaceGrid sections={[4, 2]}>
    <FaceSection span={4}>
      {#snippet head()}<PanelEyebrow title="Color" color={saturatorInk.primary} />{/snippet}
      <div class="pad-col face-span-3" class:slot-ghost={saturator.isGhost}>
        <DeviceXY
          xValue={value(COLOR.freq, REST.freq)}
          yValue={value(COLOR.hi, REST.hi)}
          title={colorReadout ?? 'Color'}
          titleAt="bottom"
          isGhost={saturator.isGhost}
          showCurve={false}
          color={saturatorInk}
          onTap={() => saturator.loadIfGhost()}
          onInteraction={(x, y) => {
            colorDragging = true;
            writeColor([[COLOR.freq, x], [COLOR.hi, y]]);
          }}
          onRelease={() => (colorDragging = false)}
        />
      </div>

      <div class="slider-col" class:slot-ghost={saturator.isGhost}>
        <DeviceSlider
          value={value(COLOR.low, REST.low)}
          title="Bass"
          face="knob"
          knobSize="l"
          icon="tone"
          orientation="vertical"
          isGhost={saturator.isGhost}
          color={saturatorInk}
          readout={saturator.paramDisplay(COLOR.low)}
          min={0}
          max={1}
          centerOrigin={true}
          centerValue={0.5}
          onTap={() => saturator.loadIfGhost()}
          onInteraction={(v) => writeColor([[COLOR.low, v]])}
        />
      </div>
    </FaceSection>
    <FaceSeam ink={saturatorInk.primary} />

    <FaceSection span={2}>
      {#snippet head()}<PanelEyebrow title="Output" color={saturatorInk.primary} />{/snippet}
      {#each SATURATOR_FADERS as f (f.index)}{@render fader(f)}{/each}
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): six equal columns, the pad three. */
  .saturator-layout {
    height: 100%;
    width: 100%;
  }

  .slider-col,
  .pad-col {
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  .slider-col > :global(*),
  .pad-col > :global(*) {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
