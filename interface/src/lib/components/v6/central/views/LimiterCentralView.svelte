<script lang="ts">
  /**
   * Live's Limiter (the `limiter` slot, 2026-11-06), its panel left to right
   * (Live 12 manual §29.24):
   *
   *   [Input Gain · Maximize] [Release · Auto] [Ceiling / Link]
   *   [Lookahead] [Mode · Routing]
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

<div class="fx-layout" data-view="limiter">
  <div class="cell">
    <div class="grow" class:slot-ghost={fx.isGhost}>
      <ControlTile type="limiter" device={fx.device} disableCentralViewOnTap tapLoads />
    </div>
    <ParamSwitch label="Maximize" on={maximize} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.maximize)} />
  </div>

  <div class="cell">
    <div class="grow"><ParamColumn {fx} ink={fx.color} boxes={RELEASE} /></div>
    <ParamSwitch label="Auto" on={on(LIMITER.auto)} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.auto)} />
  </div>

  <ParamColumn {fx} ink={fx.color} boxes={display} />

  <div class="cell">
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
      class="flex-1"
    >
      {#snippet item(m)}{m}{/snippet}
    </ScrubTabs>
  </div>

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
</div>

<style>
  .fx-layout {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--central-gap);
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
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
