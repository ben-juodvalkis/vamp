<script lang="ts" module>
  import type { BoardRow } from '../../InstrumentBoard.svelte';

  /**
   * Multiband Dynamics at full screen (ADR-515), as Live lays it: a row a
   * band, High over Mid over Low, each its switch (and crossover), its
   * Input, its Below and Above blocks, its Output and its times; then the
   * device's globals and its sidechain.
   */
  export const MULTIBAND_BOARD: readonly BoardRow[] = [
    { tiles: [{ id: 'band-High', cols: 11 }], weight: 1 },
    { tiles: [{ id: 'band-Mid', cols: 11 }], weight: 1 },
    { tiles: [{ id: 'band-Low', cols: 11 }], weight: 1 },
    { tiles: [{ id: 'global', cols: 5 }, { id: 'sidechain', cols: 3 }], weight: 0.85 }
  ];
</script>

<script lang="ts">
  /**
   * One tile of Multiband Dynamics' board (ADR-515), bound by Live's
   * parameter names (`usePanelParams`, the dump of 2026-11-07). A band's
   * display is `BandDynamicsDisplay`: thresholds dragged across, ratios up
   * and down, on Live's own picture of the device.
   */
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import BandDynamicsDisplay from './BandDynamicsDisplay.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    page: string;
    params: PanelParams;
    ink: DeviceColorScheme;
  }

  let { page, params, ink }: Props = $props();

  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
  const isOn = (p: string) => params.has(p) && (params.raw(p) ?? 0) >= 0.5;
  /** The crossover a band's row carries: High the upper, Low the lower; Mid none. */
  const CROSSOVER: Record<string, string | undefined> = { High: 'Mid-High Crossover', Low: 'Low-Mid Crossover' };
</script>

<!-- A knob bound by name; a range either side of zero draws from zero. -->
{#snippet knob(param: string, title: string, size: 's' | 'm' | 'l' = 'm', switchName?: string)}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = l < 0 && h > 0}
  <div class="cell" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? l}
      {title}
      face="knob"
      knobSize={size}
      min={l}
      max={h}
      centerOrigin={bipolar}
      centerValue={bipolar ? 0 : undefined}
      orientation="vertical"
      labelSize="small"
      isGhost={!params.has(param) || !params.isOn(switchName)}
      color={ink}
      readout={params.display(param)}
      onInteraction={(v) => params.write(param, v, switchName)}
    />
  </div>
{/snippet}

{#snippet sw(param: string, title: string)}
  {@const on = isOn(param)}
  <div class="cell sw-cell">
    <button
      class="physical-button btn-toggle switch"
      class:active={on}
      aria-pressed={on}
      disabled={!params.has(param)}
      style="--btn-tint: {ink.primary};"
      data-param={param}
      onclick={() => params.write(param, on ? lo(param) : hi(param))}
    >{title}</button>
  </div>
{/snippet}

{#snippet title(text: string)}<span class="sub" style="color: {ink.primary};">{text}</span>{/snippet}

<div class="mb-tile" data-multiband-tile={page}>
{#if page.startsWith('band-')}
  {@const band = page.slice(5) as 'Low' | 'Mid' | 'High'}
  {@const active = `Band Activator (${band})`}
  {@const crossover = CROSSOVER[band]}
  <FaceGrid sections={[1, 1, 6, 1, 2]}>
    <FaceSection span={1}>
      {#snippet head()}{@render title(band)}{/snippet}
      {#if crossover}
        <div class="stack">{@render sw(active, band)}{@render knob(crossover, 'X-Over', 's')}</div>
      {:else}
        {@render sw(active, band)}
      {/if}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render title('Input')}{/snippet}
      {@render knob(`Input Gain (${band})`, 'Input', 'm', active)}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={6}>
      {#snippet head()}{@render title('Below · Above')}{/snippet}
      <div class="face-span-all"><BandDynamicsDisplay {params} {band} ink={ink.primary} sw={active} /></div>
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={1}>
      {#snippet head()}{@render title('Output')}{/snippet}
      {@render knob(`Output Gain (${band})`, 'Output', 'm', active)}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render title('Time')}{/snippet}
      {@render knob(`Attack Time (${band})`, 'Attack', 'm', active)}
      {@render knob(`Release Time (${band})`, 'Release', 'm', active)}
    </FaceSection>
  </FaceGrid>
{:else if page === 'global'}
  <FaceGrid sections={[5]}>
    <FaceSection span={5}>
      {#snippet head()}{@render title('Global')}{/snippet}
      {@render knob('Output', 'Output')}
      {@render knob('Amount', 'Amount')}
      {@render knob('Time Scaling', 'Time')}
      {@render sw('Soft Knee On/Off', 'Soft Knee')}
      {@render sw('Peak/RMS Mode', 'Peak')}
    </FaceSection>
  </FaceGrid>
{:else if page === 'sidechain'}
  <FaceGrid sections={[3]}>
    <FaceSection span={3}>
      {#snippet head()}{@render title('Sidechain')}{/snippet}
      {@render sw('S/C On', 'S/C')}
      {@render knob('S/C Gain', 'Gain', 'm', 'S/C On')}
      {@render knob('S/C Mix', 'Mix', 'm', 'S/C On')}
    </FaceSection>
  </FaceGrid>
{/if}
</div>

<style>
  .mb-tile {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .stack > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .sw-cell {
    display: flex;
    align-items: center;
  }
  .switch {
    width: 100%;
    height: var(--height-touch);
    font-size: 0.8125rem;
  }
  .sub {
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1rem;
    white-space: nowrap;
  }
</style>
