<script lang="ts">
  /**
   * Live's Limiter (the `limiter` slot, 2026-11-06), its panel left to right:
   *
   *   [Gain] [Ceiling, or Threshold / Output under Maximize] [Release · Auto]
   *   [Maximize · Mode] [Lookahead · Routing] [Link / M/S Link]
   *
   * Gain is the `limiter` control (deviceControls), 0 dB at the middle.
   * Maximize swaps Ceiling for Threshold and Output, as Live's panel does.
   * Indices and labels are `delayParams.ts` (LIMITER), measured on the rig.
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
  let level = $derived(
    maximize
      ? [
          { index: LIMITER.threshold, title: 'Threshold', rest: 1 },
          { index: LIMITER.output, title: 'Output', rest: 1 }
        ]
      : [{ index: LIMITER.ceiling, title: 'Ceiling', rest: 0.9701 }]
  );
  const RELEASE = [{ index: LIMITER.release, title: 'Release', rest: 0.7303 }];
  const LINK = [
    { index: LIMITER.link, title: 'Link', rest: 1 },
    { index: LIMITER.msLink, title: 'M/S Link', rest: 0 }
  ];
</script>

<div class="fx-layout" data-view="limiter">
  <div class="cell" class:slot-ghost={fx.isGhost}>
    <ControlTile type="limiter" device={fx.device} disableCentralViewOnTap tapLoads />
  </div>

  <ParamColumn {fx} ink={fx.color} boxes={level} />

  <div class="cell">
    <div class="fill"><ParamColumn {fx} ink={fx.color} boxes={RELEASE} /></div>
    <ParamSwitch label="Auto" on={on(LIMITER.auto)} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.auto)} />
  </div>

  <div class="cell">
    <ParamSwitch label="Maximize" on={maximize} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(LIMITER.maximize)} />
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
  </div>

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
      style="flex: 3 1 0;"
    >
      {#snippet item(m)}{m}{/snippet}
    </ScrubTabs>
    <ScrubTabs
      options={LIMITER_ROUTING}
      selected={Math.round(value(LIMITER.routing))}
      onSelect={(i) => fx.sendParam(LIMITER.routing, i)}
      cols={1}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(m) => m}
      groupLabel="Routing"
      name="routing"
      style="flex: 2 1 0;"
    />
  </div>

  <ParamColumn {fx} ink={fx.color} boxes={LINK} />
</div>

<style>
  .fx-layout {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
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

  .fill {
    flex: 3 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .fill > :global(*) {
    flex: 1 1 0;
  }
</style>
