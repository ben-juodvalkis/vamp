<script lang="ts">
  /**
   * ReductionMeter — the gain reduction a device's meter shows in Live
   * (ADR-541), as a bar on Live's own 0–20 dB scale.
   *
   * Live puts no reduction on the LOM; Vamp for Mac reads the needle Live
   * draws. While this is mounted it holds a watch on its device
   * (`reductionMeterStore.hold`), and it says why when there is no reading:
   * the device is not in Live's device view, Live is on another Space, or
   * macOS has not let Vamp for Mac read the screen. Draws nothing while the
   * `reductionMeter` switch is off.
   */
  import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
  import { reductionMeterStore, STALE_MS } from '$lib/stores/v6/reductionMeterStore.svelte';

  interface Props {
    devicePath: string | undefined;
    color: string;
    /** A thinner bar with no ticks, for a chain cell. */
    compact?: boolean;
  }

  let { devicePath, color, compact = false }: Props = $props();

  const MAX_DB = 20;
  const TICKS = [0, 5, 10, 15, 20];
  const WHY: Record<string, string> = {
    'not-shown': "Not in Live's device view",
    'no-needle': 'Live is hidden',
    'no-meter': 'No meter',
    'no-accessibility': 'Allow Vamp in Accessibility',
    'no-screen-recording': 'Allow Vamp in Screen Recording',
    'no-live': 'Live is not running'
  };

  let on = $derived(bridgeStatus.isFeatureOn('reductionMeter'));
  let now = $state(Date.now());

  $effect(() => {
    if (!on || !devicePath) return;
    const release = reductionMeterStore.hold(devicePath);
    const clock = setInterval(() => (now = Date.now()), 500);
    return () => {
      clearInterval(clock);
      release();
    };
  });

  let reading = $derived(devicePath ? reductionMeterStore.readingFor(devicePath) : null);
  let fresh = $derived(reading !== null && now - reading.at < STALE_MS);
  let ok = $derived(fresh && reading?.status === 'ok');
  let db = $derived(ok && reading ? reading.db : 0);
  let note = $derived(ok ? `${db.toFixed(1)} dB` : !fresh ? '' : (WHY[reading?.status ?? ''] ?? ''));
</script>

{#if on}
  <div class="reduction" class:compact data-reduction-meter={ok ? 'ok' : (reading?.status ?? 'none')} style="--gr-ink: {color};">
    <div class="label">
      <span class="name">GR</span>
      <span class="value" class:dim={!ok}>{note || '—'}</span>
    </div>
    <div class="track" role="meter" aria-label="Gain reduction" aria-valuemin={0} aria-valuemax={MAX_DB} aria-valuenow={db}>
      <div class="fill" style="width: {(Math.min(db, MAX_DB) / MAX_DB) * 100}%;"></div>
      {#if !compact}
        {#each TICKS as t (t)}
          <span class="tick" style="left: {(t / MAX_DB) * 100}%;"></span>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .reduction {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--spacing-sm);
    font-size: 0.8rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
  }
  .name {
    font-weight: 600;
    color: var(--gr-ink);
  }
  .value {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .value.dim {
    opacity: 0.6;
  }
  .track {
    position: relative;
    height: 12px;
    border-radius: 3px;
    background: color-mix(in oklab, currentColor 12%, transparent);
    overflow: hidden;
  }
  .compact .track {
    height: 6px;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--gr-ink);
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: color-mix(in oklab, currentColor 30%, transparent);
  }
</style>
