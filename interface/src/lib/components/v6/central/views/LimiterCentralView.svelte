<script lang="ts">
  /**
   * Live's Limiter (the `limiter` slot, 2026-11-06), its panel left to right
   * (Live 12 manual §29.24):
   *
   *   [Input Gain · Maximize] | [Release · Auto] | [Ceiling / Link]
   *   | [Lookahead] | [Mode · Routing]
   *
   * on one face grid (ADR-510), five sections of one column.
   *
   * The level knob is the `limiter` control (deviceControls): Input Gain,
   * 0 dB at the middle, and under Maximize the Output, as in Live, where
   * Maximize also turns Ceiling into Threshold. Live's display (the ceiling
   * and its gain reduction meter, Link under it) is the Ceiling box over
   * Link; the meter is not drawn. Indices and labels are `delayParams.ts`
   * (LIMITER), measured on the rig. M/S Link, which Live's panel does not
   * show, is not drawn either.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { LIMITER, LIMITER_LOOKAHEAD, LIMITER_MODES, LIMITER_ROUTING } from '$lib/components/v6/device-panel/delayParams';

  const fx = useFxGridSlot('limiter');

  const value = (index: number, rest = 0) => fx.paramValue(index) ?? rest;
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => fx.sendParam(index, on(index) ? 0 : 1);

  let maximize = $derived(on(LIMITER.maximize));
  let display = $derived([
    maximize ? { index: LIMITER.threshold, title: 'Threshold', rest: 1 } : { index: LIMITER.ceiling, title: 'Ceiling', rest: 0.9701 },
    { index: LIMITER.link, title: 'Link', rest: 1 }
  ]);
  const RELEASE = [{ index: LIMITER.release, title: 'Release', rest: 0.7303 }];
</script>

<!-- One face grid (ADR-510), five columns of ~167px at 1366 x 1024, one
     a section, in Live's order. -->
<div class="face-root" data-view="limiter">
<FaceGrid sections={[1, 1, 1, 1, 1]}>
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Gain" color={fx.color.primary} />{/snippet}
    <div class="cell">
      <div class="grow" class:slot-ghost={fx.isGhost}>
        <ControlTile type="limiter" device={fx.device} disableCentralViewOnTap tapLoads />
      </div>
      <ParamSwitch row label="Maximize" on={maximize} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.maximize)} />
    </div>
  </FaceSection>
  <FaceSeam />

  <!-- One knob over its switch: large (ADR-509). -->
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Release" color={fx.color.primary} />{/snippet}
    <div class="cell">
      <div class="grow"><ParamColumn face="knob" knobSize="l" {fx} ink={fx.color} boxes={RELEASE} /></div>
      <ParamSwitch row label="Auto" on={on(LIMITER.auto)} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.auto)} />
    </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title={maximize ? 'Threshold' : 'Ceiling'} color={fx.color.primary} />{/snippet}
    <ParamColumn {fx} ink={fx.color} boxes={display} />
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Lookahead" color={fx.color.primary} />{/snippet}
    <ScrubTabs
      options={LIMITER_LOOKAHEAD}
      selected={Math.round(value(LIMITER.lookahead))}
      onSelect={(i) => fx.sendParam(LIMITER.lookahead, i)}
      cols={1}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(m) => `Lookahead ${m}`}
      groupLabel="Lookahead"
      name="lookahead"
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
        tint={fx.color.primary}
        inked
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Mode"
        name="mode"
        style="flex: 3 1 0;"
      />
      <ScrubTabs
        options={LIMITER_ROUTING}
        selected={Math.round(value(LIMITER.routing))}
        onSelect={(i) => fx.sendParam(LIMITER.routing, i)}
        cols={2}
        tint={fx.color.primary}
        inked
        ghost={fx.isGhost}
        label={(m) => m}
        groupLabel="Routing"
        name="routing"
        style="flex: 1 1 0;"
      />
    </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510); a cell is how one column fills its height. */
  .face-root {
    height: 100%;
    width: 100%;
    min-height: 0;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--face-gutter);
    min-height: 0;
    min-width: 0;
  }

  .grow {
    flex: 3 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grow > :global(*) {
    flex: 1 1 0;
  }
</style>
