<script lang="ts">
  /**
   * RoarCentralView — Roar's view (slot `roar`, ADR-515).
   *
   * The band is one face (ADR-513): Input's tone, the routing, the first
   * stage, the feedback and the compressor. Full screen (ADR-511) is the
   * board: every stage, the feedback, the four modulation sources, as
   * Live's expanded Roar shows them (`roar/RoarPages.svelte`). Drive and
   * Dry/Wet are the chain cell's XY, so the face leaves them out.
   *
   * Parameters bind by Live's name (`usePanelParams`); the routing mode is
   * the device property `routing_mode_index`. A ghost draws the face's
   * controls dimmed, and the first touch loads Roar.
   */
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import InstrumentBoard from '../InstrumentBoard.svelte';
  import RoarPages, { ROAR_BOARD } from './roar/RoarPages.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { ROAR_ROUTING_PROPERTY } from '../../device-panel/roarParams';

  const fx = useFxGridSlot('roar');
  const params = usePanelParams(() => fx.device ?? undefined);

  let devicePath = $derived(fx.devicePath);
  let routing = $derived(
    devicePath ? (selectedTrackStore.propertyValue(devicePath, ROAR_ROUTING_PROPERTY) as number | undefined) : undefined
  );

  $effect(() => {
    if (!devicePath) return;
    return selectedTrackStore.subscribeProperty(devicePath, ROAR_ROUTING_PROPERTY);
  });

  function setRouting(index: number) {
    if (devicePath) selectedTrackStore.setPropertyValue(devicePath, ROAR_ROUTING_PROPERTY, index);
  }
</script>

<!-- NO {#if device} gate: a ghost draws the face, and a touch loads it. -->
<div
  class="roar-root h-full w-full overflow-hidden relative"
  class:slot-ghost={fx.isGhost}
  data-device="roar"
  onpointerdowncapture={() => fx.loadIfGhost()}
>
  {#if fx.device && centralDisplayStore.expanded}
    <InstrumentBoard rows={ROAR_BOARD} ink={fx.color.primary}>
      {#snippet tile(id)}
        <RoarPages page={id} {params} ink={fx.color} {routing} {setRouting} />
      {/snippet}
    </InstrumentBoard>
  {:else}
    <div class="roar-face">
      <RoarPages page="face" {params} ink={fx.color} {routing} {setRouting} />
    </div>
  {/if}
</div>

<style>
  .roar-face {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
</style>
