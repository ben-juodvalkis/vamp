<script lang="ts">
  /**
   * Test fixture: CentralDisplay's swap-pill hand-off, and nothing else. It
   * provides a host, draws the column only while nothing claims it, and
   * replaces one hosted pill with another when `view` changes — the new
   * view's pill mounts and claims before the old one's teardown releases, in
   * one flush, which is what a tap from one instrument's view to another does.
   */
  import HostedSwapPill from '$lib/components/v6/central/HostedSwapPill.svelte';
  import { provideSwapHost } from '$lib/components/v6/central/swapHost.svelte';

  let { view }: { view: string } = $props();

  const model = {
    scopeLabel: 'Preset',
    label: 'Aurora Lead',
    detail: '',
    working: false,
    disabled: false,
    error: null
  };
  const host = provideSwapHost(() => ({ model, act: () => {}, open: null, ink: null }));
</script>

{#if !host.claimed}<div data-testid="swap-column"></div>{/if}
{#key view}<HostedSwapPill />{/key}
