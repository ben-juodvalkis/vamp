<script lang="ts">
  /**
   * Electric in Live's arrangement (ADR-487): Live's five sections, Hammer ·
   * Fork · Damper · Pickup · Global, each two rows of medium knobs (ADR-517),
   * the pickup's model a tab beside its knobs. A section's eyebrow is its
   * name; the band opens no page (ADR-513). The panel is data
   * (`panel/electricPanel.ts`), bound by Live's parameter names. Until
   * 2026-10-27 the view was two XY pads, Hammer and Fork, bound by index.
   * At full screen it draws the panel's board (ADR-512): every section's
   * detail at once, every knob one size. Its amounts are the selected
   * track's ink (ADR-544).
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { selectedAmountScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { ELECTRIC_PANEL } from './panel/electricPanel';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Every amount is the selected track's ink (ADR-544): the view has no
  // colour of its own.
  let electricInk = $derived(selectedAmountScheme());

  const params = usePanelParams(() => device);
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <InstrumentPanelView panel={ELECTRIC_PANEL} {params} color={electricInk} board={centralDisplayStore.expanded} />
  {:else}
    <!-- Default state when no Electric present -->
    <DeviceEmptyState glyph="~" message="Load Electric to access controls" color={electricInk.primary} />
  {/if}
</div>
