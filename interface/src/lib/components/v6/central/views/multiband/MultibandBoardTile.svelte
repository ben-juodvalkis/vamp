<script lang="ts" module>
  import type { BoardRow } from '../../InstrumentBoard.svelte';

  /**
   * Multiband Dynamics at full screen (ADR-515), as Live lays it: a row a
   * band, High over Mid over Low, each a panel with its switch on its bar
   * (ADR-516), its Below and Above blocks, its gains (Input, Output) and
   * its times (Attack over Release); then the device's globals with the
   * two crossovers, and its sidechain.
   * Sized by rank, as Live's panel ranks them (manual 29.26): the display
   * is the device and takes the width; the gains are medium, the times,
   * which Live shows as numbers, small; of the globals Amount leads.
   */
  export const MULTIBAND_BOARD: readonly BoardRow[] = [
    { tiles: [{ id: 'band-High', cols: 10 }], weight: 1 },
    { tiles: [{ id: 'band-Mid', cols: 10 }], weight: 1 },
    { tiles: [{ id: 'band-Low', cols: 10 }], weight: 1 },
    { tiles: [{ id: 'global', cols: 6 }, { id: 'sidechain', cols: 2 }], weight: 0.72 }
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
  import BoardTile from '../../BoardTile.svelte';
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
  const flip = (p: string) => params.write(p, isOn(p) ? lo(p) : hi(p));
</script>

<!-- A knob bound by name; a range either side of zero draws from zero. -->
{#snippet knob(param: string, title: string, size: 's' | 'm' | 'l' | 'xl' = 'm', switchName?: string)}
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
  <!-- A band (ADR-516): its switch on its bar; its display across seven
       columns, its gains and its times beside it. The crossovers are on
       the Global tile, between no band in particular. -->
  {@const band = page.slice(5) as 'Low' | 'Mid' | 'High'}
  {@const active = `Band Activator (${band})`}
  <BoardTile title="{band} Band" ink={ink.primary} on={isOn(active)} onToggle={() => flip(active)} switchParam={active} switchDisabled={!params.has(active)}>
    <FaceGrid sections={[7, 2, 1]}>
      <FaceSection span={7}>
        {#snippet head()}{@render title('Below · Above')}{/snippet}
        <div class="face-span-all"><BandDynamicsDisplay {params} {band} ink={ink.primary} sw={active} /></div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {#snippet head()}{@render title('Gain')}{/snippet}
        {@render knob(`Input Gain (${band})`, 'Input', 'm', active)}
        {@render knob(`Output Gain (${band})`, 'Output', 'm', active)}
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={1}>
        {#snippet head()}{@render title('Time')}{/snippet}
        <div class="stack">{@render knob(`Attack Time (${band})`, 'Attack', 's', active)}{@render knob(`Release Time (${band})`, 'Release', 's', active)}</div>
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'global'}
  <!-- The device's globals, Amount the lead, and the two crossovers. -->
  <BoardTile title="Global" ink={ink.primary}>
    <FaceGrid sections={[4, 2]} heads={false}>
      <FaceSection span={4}>
        {@render knob('Amount', 'Amount', 'l')}
        {@render knob('Time Scaling', 'Time', 'm')}
        {@render knob('Output', 'Output', 'm')}
        <div class="stack">{@render sw('Soft Knee On/Off', 'Soft Knee')}{@render sw('Peak/RMS Mode', 'Peak')}</div>
      </FaceSection>
      <FaceSeam ink={ink.primary} />
      <FaceSection span={2}>
        {@render knob('Low-Mid Crossover', 'Low/Mid', 'm')}
        {@render knob('Mid-High Crossover', 'Mid/High', 'm')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{:else if page === 'sidechain'}
  <BoardTile title="Sidechain" ink={ink.primary} on={isOn('S/C On')} onToggle={() => flip('S/C On')} switchParam="S/C On" switchDisabled={!params.has('S/C On')}>
    <FaceGrid sections={[2]} heads={false}>
      <FaceSection span={2}>
        {@render knob('S/C Gain', 'Gain', 'm', 'S/C On')}
        {@render knob('S/C Mix', 'Mix', 'm', 'S/C On')}
      </FaceSection>
    </FaceGrid>
  </BoardTile>
{/if}
</div>

<style>
  .mb-tile {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
  }
  .mb-tile > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  .stack {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .stack > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }
  .stack > .sw-cell {
    flex: none;
    height: var(--height-touch);
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
