<script lang="ts">
  /**
   * Ben's Adaptive Tone Shaper's view (the `toneShaper` slot): its graph,
   * full size. It sat beside the Channel EQ in the EQ view from 2026-10-07
   * until the FX chain overview gave every device a view of its own
   * (2026-10-26).
   *
   * A tap on a ghost loads it; a drag loads it and writes.
   * NO {#if device} gate - always renders, handles its own state.
   */

  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { familyScheme } from '$lib/config/devicePresets';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { toneShaperStore } from '$lib/stores/v3/toneShaper.svelte';
  import ToneShaperGraph from './eq/ToneShaperGraph.svelte';
  import { TS_PARAM, TS_HANDLE } from './eq/toneShaper';

  const ts = useFxGridSlot('toneShaper');

  let tsInk = $derived({
    primary: deviceInk(ts.color.primary, paintModeReactive()),
    secondary: ts.color.secondary,
    accent: deviceInk(ts.color.accent, paintModeReactive())
  });
  // Ghost ink — the neutral utility family (ADR-400).
  let ghostInk = $derived({
    primary: deviceInk(familyScheme('utility').primary, paintModeReactive()),
    secondary: 'color-mix(in oklab, var(--signal-dim) 10%, transparent)',
    accent: deviceInk(familyScheme('utility').accent, paintModeReactive())
  });

  // The Tone Shaper's parameters in their own units (`TS_PARAM`). Unloaded
  // it draws Amount 0 (the user's call for bloom, 2026-10-06), the handles
  // flat at their rest centers, ZERO on, as the device loads.
  let tsAmount = $derived(ts.paramValue(TS_PARAM.amount) ?? 0);
  let tsLevels = $derived(TS_HANDLE.map((_, i) => ts.paramValue(TS_PARAM.levels[i]) ?? 0));
  let tsHz = $derived(TS_HANDLE.map((h, i) => ts.paramValue(TS_PARAM.hz[i]) ?? h.rest));
  let tsZero = $derived((ts.paramValue(TS_PARAM.latency) ?? 1) >= 0.5);
  let tsEco = $derived((ts.paramValue(TS_PARAM.quality) ?? 0) >= 0.5);
  let tsFrame = $derived(ts.devicePath ? toneShaperStore.get(ts.devicePath) : undefined);

  // Tell the bridge which device's frames to relay: this one's while the
  // view is up, none when it goes.
  $effect(() => {
    toneShaperStore.watch(ts.devicePath ?? '');
    return () => toneShaperStore.watch('');
  });
</script>

<div class="ts-layout" data-view="toneShaper" class:slot-ghost={ts.isGhost}>
  <div class="graph">
  <ToneShaperGraph
    frame={tsFrame}
    amount={tsAmount}
    levels={tsLevels}
    hz={tsHz}
    zero={tsZero}
    eco={tsEco}
    color={ts.isGhost ? ghostInk : tsInk}
    isGhost={ts.isGhost}
    onWrite={(index, value) => ts.sendParam(index, value)}
    onTap={() => ts.loadIfGhost()}
  />
  </div>
</div>

<style>
  .ts-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    padding: var(--central-inset);
  }
  .graph {
    flex: 1 1 0;
    min-height: 0;
  }
</style>
