<script lang="ts">
  /**
   * Electric in Live's arrangement (ADR-487): Hammer · Fork · Damper/Pickup ·
   * Global, two value boxes each as Live's panel has two knobs, and each
   * section's eyebrow opening its detail, as Live's display does. The panel
   * is data (`panel/electricPanel.ts`), bound by Live's parameter names.
   * Until 2026-10-27 the view was two XY pads, Hammer and Fork, bound by
   * index.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { ELECTRIC_PANEL } from './panel/electricPanel';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Electric color scheme (amber/orange - matches electric piano aesthetic)
  const electricColor = {
    primary: '#f59e0b',
    secondary: 'rgba(245, 158, 11, 0.1)',
    accent: '#fbbf24'
  };

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let electricInk = $derived(trackScheme ?? {
    primary: trackInk(electricColor.primary, paintModeReactive()),
    secondary: electricColor.secondary,
    accent: trackInk(electricColor.accent, paintModeReactive())
  });

  const params = usePanelParams(() => device);
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <InstrumentPanelView panel={ELECTRIC_PANEL} {params} color={electricInk} />
  {:else}
    <!-- Default state when no Electric present -->
    <DeviceEmptyState glyph="~" message="Load Electric to access controls" color={electricInk.primary} />
  {/if}
</div>
