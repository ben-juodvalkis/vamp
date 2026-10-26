<script lang="ts">
  /**
   * The Saturator's view (the `saturator` slot, the Drive tile). Its own
   * file since the FX chain overview took over from the grid (2026-10-26);
   * it was the `effects` part of the Pedal view.
   *
   *   [Bass] [Color pad: Freq across, Hi up] [Output] [Mix]
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
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  const saturator = useFxGridSlot('saturator');

  let saturatorInk = $derived({
    primary: trackInk(saturator.color.primary, paintModeReactive()),
    secondary: saturator.color.secondary,
    accent: trackInk(saturator.color.accent, paintModeReactive())
  });

  const COLOR = { on: 4, low: 5, freq: 6, hi: 8 } as const;
  /** Live's values on a fresh Saturator, what a ghost shows. */
  const REST = { low: 0.4956, freq: 0.5458, hi: 0.5044 } as const;

  const value = (index: number, rest: number) => saturator.paramValue(index) ?? rest;
  /** A Color write is heard only with Color on: turn it on first when it is off. */
  function writeColor(writes: Array<[number, number]>) {
    if ((saturator.paramValue(COLOR.on) ?? 1) < 0.5) saturator.sendParam(COLOR.on, 1);
    for (const [index, v] of writes) saturator.sendParam(index, v);
  }

  // Index, label, and the value a fader rests at before the device answers.
  const SATURATOR_FADERS = [
    { index: 10, title: 'Output', fallback: 1, icon: 'output' },
    { index: 11, title: 'Mix', fallback: 1, icon: 'mix' }
  ] as const;
</script>

<div class="saturator-layout" data-view="saturator">
  <div class="slider-col" class:slot-ghost={saturator.isGhost}>
    <DeviceSlider
      value={value(COLOR.low, REST.low)}
      title="Bass"
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

  <div class="pad-col" class:slot-ghost={saturator.isGhost}>
    <DeviceXY
      xValue={value(COLOR.freq, REST.freq)}
      yValue={value(COLOR.hi, REST.hi)}
      title="Color"
      icon="tone"
      rateLabel={saturator.paramDisplay(COLOR.freq)}
      isGhost={saturator.isGhost}
      showCurve={false}
      color={saturatorInk}
      onTap={() => saturator.loadIfGhost()}
      onInteraction={(x, y) => writeColor([[COLOR.freq, x], [COLOR.hi, y]])}
    />
  </div>

  {#each SATURATOR_FADERS as fader (fader.index)}
    <div class="slider-col" class:slot-ghost={saturator.isGhost}>
      <DeviceSlider
        value={saturator.paramValue(fader.index) ?? fader.fallback}
        title={fader.title}
        icon={fader.icon}
        orientation="vertical"
        isGhost={saturator.isGhost}
        color={saturatorInk}
        readout={saturator.paramDisplay(fader.index)}
        min={0}
        max={1}
        onTap={() => saturator.loadIfGhost()}
        onInteraction={(v) => saturator.sendParam(fader.index, v)}
      />
    </div>
  {/each}
</div>

<style>
  /* A slider one share, the pad two. */
  .saturator-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) repeat(2, minmax(0, 1fr));
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
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
