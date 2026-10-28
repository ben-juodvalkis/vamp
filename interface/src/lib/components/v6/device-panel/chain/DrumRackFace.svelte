<script lang="ts">
  /**
   * A Drum Rack's face in the chain overview: its pads, laid out as Live's
   * rack lays them (rows, lowest along the bottom; 2026-10-28), lit as the
   * Drum Rack view lights them (2026-10-27, in place of the kit's Trnsp) — the pads in
   * play (the playing clip's, Live's selection, the held), flashing as the
   * clip plays them. A hold scopes the chain to that pad and lifting
   * returns; a tap latches, by `drumPadScope`'s rule, the view's own.
   *
   * The chain keeps this cell, first, while a pad is scoped (ChainOverview's
   * kit cell), so the pads stay under the finger as the chain turns into
   * the pad's.
   */
  import DrumPadGrid from '$lib/components/v6/central/views/DrumPadGrid.svelte';
  import { useClipPads } from '$lib/components/v6/central/views/drum/useClipPads.svelte';
  import { useDrumVm } from '$lib/components/v6/central/useDrumVm.svelte';
  import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { VM } from '$lib/services/drumVirtualMacros';
  import type { MomentaryReleaseReason } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    device: DeviceRecord;
    color: DeviceColorScheme;
  }

  let { device, color }: Props = $props();

  /** The narrowest face that still gets four pads across (four 56px tiles and their gaps). */
  const RACK_FOUR_MIN_WIDTH = 236;

  const devicePath = $derived(device.devicePath);
  const clip = useClipPads(() => devicePath.split('/devices/')[0]);
  const vm = useDrumVm(() => devicePath, { kitFunctions: [], functions: () => [] });

  // A rack hot-swapped in place keeps its path, so a latch could outlive
  // the pad it named. As the view does.
  $effect(() => {
    const notes = (vm.members?.pads ?? []).map((p) => p.note);
    if (notes.length) drumPadScope.retainLatched(devicePath, notes);
  });

  function onPress(note: number, pointerId: number) {
    drumPadScope.press(devicePath, note, pointerId);
    selectedTrackStore.setPropertyValue(devicePath, VM.selectedPad, note);
  }

  // Live's layout, four across as the rack is, or two where the cell is
  // too narrow for four tiles to take a name (user, 2026-10-28).
  let faceWidth = $state(0);
  const rackColumns = $derived(faceWidth >= RACK_FOUR_MIN_WIDTH || faceWidth === 0 ? 4 : 2);

  function onRelease(pointerId: number, reason: MomentaryReleaseReason = 'up') {
    drumPadScope.release(pointerId, reason);
  }
</script>

<div class="drum-face" bind:clientWidth={faceWidth}>
  <DrumPadGrid
    pads={vm.members?.pads ?? []}
    selectedNote={vm.selectedNote}
    heldNotes={vm.heldNotes}
    clipNotes={clip.clipNotes}
    litNotes={clip.litNotes}
    {color}
    {rackColumns}
    {onPress}
    {onRelease}
  />
</div>

<style>
  /* The grid sizes itself for a column beside the view's controls; here
     it has the cell, so it takes the whole of it. */
  .drum-face {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .drum-face :global(.pad-grid) {
    flex: 1 1 auto;
    width: 100%;
  }
</style>
