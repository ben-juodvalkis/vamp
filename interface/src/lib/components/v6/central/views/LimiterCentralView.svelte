<script lang="ts">
  /**
   * Live's Limiter (the `limiter` slot, 2026-11-06), its panel left to right
   * (Live 12 manual §29.24):
   *
   *   Gain [the level box] | Release [Release / Auto]
   *   | Ceiling [Ceiling · Link / Maximize] | Lookahead | Mode [Mode / Routing]
   *
   * on one face grid (ADR-510), seven columns, sections 2 · 1 · 2 · 1 · 1.
   * Every column is an amount or a pick over one touch row at the foot, so
   * the three knobs stand on one line at one size and the switches and the
   * routing tab on another (ADR-544).
   *
   * The level box is the `limiter` control (deviceControls), the amount
   * that is ridden, on two columns and the band's whole height: Input
   * Gain, 0 dB at the middle, and under Maximize the Output, as in Live,
   * where Maximize also turns Ceiling into Threshold. It draws its
   * device's picture, as its chain cell does, so its section carries its
   * name. Release, Ceiling (or Threshold) and Link are set and left: three
   * large knobs. (Ceiling and Link were value boxes until ADR-544's
   * rollout, a ridden amount's face, their names cut by their own fills.)
   * Maximize sits under the pair it renames; it stood under the level box.
   * Live's display (the ceiling and its gain reduction meter) is not
   * drawn. Indices and labels are `delayParams.ts` (LIMITER), measured on
   * the rig. M/S Link, which Live's panel does not show, is not drawn
   * either.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import { setContext } from 'svelte';
  import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { PICTURE_CONTEXT } from '$lib/components/v6/browser/devicePictures';
  import { LIMITER, LIMITER_LOOKAHEAD, LIMITER_MODES, LIMITER_ROUTING } from '$lib/components/v6/device-panel/delayParams';

  // The level box draws its device's picture here as it does on its chain cell.
  setContext(PICTURE_CONTEXT, true);

  const fx = useFxGridSlot('limiter');

  const value = (index: number, rest = 0) => fx.paramValue(index) ?? rest;
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => fx.sendParam(index, on(index) ? 0 : 1);

  let maximize = $derived(on(LIMITER.maximize));
  /** Live's fresh values, what a ghost draws. */
  let ceiling = $derived(
    maximize ? { index: LIMITER.threshold, title: 'Threshold', rest: 1 } : { index: LIMITER.ceiling, title: 'Ceiling', rest: 0.9701 }
  );
  const LINK = { index: LIMITER.link, title: 'Link', rest: 1 };
  const RELEASE = { index: LIMITER.release, title: 'Release', rest: 0.7303 };
</script>

<!-- A knob in its cell over the foot row: large, the three of them one size. -->
{#snippet knob(k: { index: number; title: string; rest: number })}
  <div class="knob" class:slot-ghost={fx.isGhost}>
    <DeviceSlider
      value={value(k.index, k.rest)}
      title={k.title}
      face="knob"
      knobSize="l"
      knobFit
      knobCaptionBelow
      orientation="vertical"
      isGhost={fx.isGhost}
      color={fx.color}
      readout={fx.paramDisplay(k.index)}
      onInteraction={(v) => fx.sendParam(k.index, v)}
    />
  </div>
{/snippet}

<!-- One face grid (ADR-510), seven columns of ~131px at 1366 x 1024, in
     Live's order. -->
<div class="face-root" data-view="limiter">
<FaceGrid sections={[2, 1, 2, 1, 1]}>
  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title={maximize ? 'Output' : 'Gain'} color={fx.color.primary} />{/snippet}
    <div class="level face-span-all" class:slot-ghost={fx.isGhost}>
      <ControlTile type="limiter" device={fx.device} disableCentralViewOnTap tapLoads />
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Release" color={fx.color.primary} />{/snippet}
    <div class="cell">
      {@render knob(RELEASE)}
      <ParamSwitch row label="Auto" on={on(LIMITER.auto)} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.auto)} />
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
    {#snippet head()}<PanelEyebrow title={maximize ? 'Threshold' : 'Ceiling'} color={fx.color.primary} />{/snippet}
    <div class="cell face-span-all">
      <div class="pair">
        {@render knob(ceiling)}
        {@render knob(LINK)}
      </div>
      <ParamSwitch row label="Maximize" on={maximize} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.maximize)} />
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Lookahead" color={fx.color.primary} />{/snippet}
    <ScrubTabs
      options={LIMITER_LOOKAHEAD}
      selected={Math.round(value(LIMITER.lookahead))}
      onSelect={(i) => fx.sendParam(LIMITER.lookahead, i)}
      cols={1}
      ghost={fx.isGhost}
      label={(m) => `Lookahead ${m}`}
      groupLabel="Lookahead"
      name="lookahead"
      style="--scrub-font-size: 0.9375rem;"
    >
      {#snippet item(m)}{m}{/snippet}
    </ScrubTabs>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Mode" color={fx.color.primary} />{/snippet}
    <div class="cell">
      <ScrubTabs
        options={LIMITER_MODES}
        selected={Math.round(value(LIMITER.mode))}
        onSelect={(i) => fx.sendParam(LIMITER.mode, i)}
        cols={1}
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Mode"
        name="mode"
        class="grow"
        style="--scrub-font-size: 0.9375rem;"
      />
      <ScrubTabs
        options={LIMITER_ROUTING}
        selected={Math.round(value(LIMITER.routing))}
        onSelect={(i) => fx.sendParam(LIMITER.routing, i)}
        cols={2}
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Routing"
        name="routing"
        class="foot"
        style="--scrub-font-size: 0.9375rem;"
      />
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510); a cell is how one column fills its
     height: what it sets over one touch row at its foot. */
  .face-root {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .level {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .level > :global(*) {
    flex: 1 1 0;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }
  .cell > :global(.grow),
  .cell > .knob,
  .cell > .pair {
    flex: 1 1 0;
    min-height: 0;
  }
  .cell > :global(.foot) {
    flex: 0 0 var(--height-touch);
  }

  /* Ceiling beside Link, on the face's two columns. */
  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--face-gutter);
  }
  .knob {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .knob > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
