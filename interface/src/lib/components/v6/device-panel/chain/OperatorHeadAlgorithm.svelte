<script lang="ts">
  /**
   * Operator's current algorithm, small, in its chain cell's header:
   * read off the device by parameter NAME (Operator's indices move with
   * its sections), each oscillator filled while its switch is on.
   */
  import OperatorAlgorithm from './OperatorAlgorithm.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';

  let { device }: { device: DeviceRecord } = $props();

  const names = $derived(selectedTrackStore.paramNamesForDevice(device));
  function raw(name: string, fallback: number): number {
    const i = names.indexOf(name);
    if (i < 0) return fallback;
    return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, i)) ?? fallback;
  }
  const algorithm = $derived(raw('Algorithm', 0));
  const on = $derived((['A', 'B', 'C', 'D'] as const).map((o) => raw(`Osc-${o} On`, 1) >= 0.5) as [boolean, boolean, boolean, boolean]);
</script>

<span class="op-head-alg"><OperatorAlgorithm {algorithm} {on} /></span>

<style>
  .op-head-alg {
    position: relative;
    display: block;
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
  }

  .op-head-alg :global(.op-alg) {
    opacity: 1;
  }

  .op-head-alg :global(.op-alg svg) {
    width: 100cqmin;
    height: 100cqmin;
  }
</style>
