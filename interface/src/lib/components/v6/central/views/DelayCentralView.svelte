<script lang="ts">
  /**
   * Live's Delay (the `delay` slot, 2026-11-06), its panel left to right:
   *
   *   [pad: time across, feedback up] [L (R) time: Sync · 16ths or Time]
   *   [Link · Ping Pong · Freeze · Repitch/Fade/Jump] [Filter: On · Freq / Width]
   *   [LFO > Delay / LFO > Filter / Dry/Wet]
   *
   * The pad is the `delay` control (deviceControls): L's time, its 16th
   * step when synced, and the feedback. With Link on, R follows L and the
   * time column is L's alone; with it off, R's time stands beside L's, as
   * in Live. Indices and labels are `delayParams.ts`, measured on the rig.
   * Not drawn: the LFO's own rate and wave, and the channels' Offset.
   *
   * NO {#if device} gate - every control handles its own ghost state.
   */
  import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
  import ScrubTabs from '$lib/components/v6/device-panel/ScrubTabs.svelte';
  import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
  import ParamColumn from './fx/ParamColumn.svelte';
  import ParamSwitch from './fx/ParamSwitch.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { DELAY, DELAY_SIXTEENTHS, DELAY_SMOOTHING } from '$lib/components/v6/device-panel/delayParams';

  const fx = useFxGridSlot('delay');

  /** A fresh insert on the rig (its User Library default): linked, synced, L 2/16, R 4/16, Fade, filter on. */
  const REST: Record<number, number> = {
    [DELAY.smoothing]: 1,
    [DELAY.link]: 1,
    [DELAY.pingPong]: 0,
    [DELAY.syncL]: 1,
    [DELAY.syncR]: 1,
    [DELAY.timeL]: 0.5954,
    [DELAY.timeR]: 0.5954,
    [DELAY.sixteenthL]: 1,
    [DELAY.sixteenthR]: 3,
    [DELAY.freeze]: 0,
    [DELAY.filterOn]: 1
  };
  const value = (index: number) => fx.paramValue(index) ?? REST[index] ?? 0;
  const on = (index: number) => value(index) >= 0.5;
  const toggle = (index: number) => fx.sendParam(index, on(index) ? 0 : 1);

  let linked = $derived(on(DELAY.link));
  let sides = $derived(
    linked
      ? [{ name: 'L', sync: DELAY.syncL, sixteenth: DELAY.sixteenthL, time: DELAY.timeL }]
      : [
          { name: 'L', sync: DELAY.syncL, sixteenth: DELAY.sixteenthL, time: DELAY.timeL },
          { name: 'R', sync: DELAY.syncR, sixteenth: DELAY.sixteenthR, time: DELAY.timeR }
        ]
  );

  const SWITCHES = [
    { index: DELAY.link, label: 'Link' },
    { index: DELAY.pingPong, label: 'Ping Pong' },
    { index: DELAY.freeze, label: 'Freeze' }
  ];
  const FILTER = [
    { index: DELAY.filterFreq, title: 'Freq', rest: 0.5089 },
    { index: DELAY.filterWidth, title: 'Width', rest: 0.8824 }
  ];
  const MIX = [
    { index: DELAY.lfoToDelay, title: 'Mod Time', rest: 0 },
    { index: DELAY.lfoToFilter, title: 'Mod Filter', rest: 0 },
    { index: DELAY.dryWet, title: 'Dry/Wet', rest: 0.5 }
  ];
</script>

<div class="fx-layout" data-view="delay">
  <div class="cell" class:slot-ghost={fx.isGhost}>
    <ControlTile type="delay" device={fx.device} disableCentralViewOnTap tapLoads />
  </div>

  <div class="cell time-cell">
    {#each sides as side (side.name)}
      <div class="side">
        <ParamSwitch
          label={on(side.sync) ? `${side.name} Sync` : `${side.name} Time`}
          on={on(side.sync)}
          tint={fx.color.primary}
          ghost={fx.isGhost}
          onToggle={() => toggle(side.sync)}
        />
        {#if on(side.sync)}
          <ScrubTabs
            options={DELAY_SIXTEENTHS}
            selected={Math.round(value(side.sixteenth))}
            onSelect={(i) => fx.sendParam(side.sixteenth, i)}
            cols={1}
            tint={fx.color.primary}
            inked
            ghost={fx.isGhost}
            label={(s) => `${s} sixteenths`}
            groupLabel={`${side.name} time`}
            name={`sixteenth-${side.name}`}
            style="flex: 7 1 0;"
          >
            {#snippet item(s)}{s}{/snippet}
          </ScrubTabs>
        {:else}
          <div class="fill" class:slot-ghost={fx.isGhost}>
            <DeviceSlider
              value={value(side.time)}
              title="Time"
              orientation="vertical"
              isGhost={fx.isGhost}
              color={fx.color}
              readout={fx.paramDisplay(side.time)}
              onInteraction={(v) => fx.sendParam(side.time, v)}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="cell">
    {#each SWITCHES as s (s.index)}
      <ParamSwitch label={s.label} on={on(s.index)} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(s.index)} />
    {/each}
    <ScrubTabs
      options={DELAY_SMOOTHING}
      selected={Math.round(value(DELAY.smoothing))}
      onSelect={(i) => fx.sendParam(DELAY.smoothing, i)}
      cols={1}
      tint={fx.color.primary}
      inked
      ghost={fx.isGhost}
      label={(m) => m}
      groupLabel="Smoothing"
      name="smoothing"
      style="flex: 3 1 0;"
    />
  </div>

  <div class="cell">
    <ParamSwitch label="Filter" on={on(DELAY.filterOn)} tint={fx.color.primary} ghost={fx.isGhost} onToggle={() => toggle(DELAY.filterOn)} />
    <div class="fill"><ParamColumn {fx} ink={fx.color} boxes={FILTER} /></div>
  </div>

  <ParamColumn {fx} ink={fx.color} boxes={MIX} />
</div>

<style>
  /* The pad two shares; the time, switches, filter and mix columns one each. */
  .fx-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) repeat(4, minmax(0, 1fr));
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

  /* L and R side by side when unlinked. */
  .time-cell {
    flex-direction: row;
  }

  .side {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
  }

  .fill {
    flex: 7 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .fill > :global(*) {
    flex: 1 1 0;
  }
</style>
