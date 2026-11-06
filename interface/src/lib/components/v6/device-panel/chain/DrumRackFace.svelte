<script lang="ts">
  /**
   * A Drum Rack's face in the chain overview: the kit's Trnsp, the one
   * control every native kit gets — `vm.pitch`, whole semitones on ±48, the
   * surface fanning it out to every pad's Transpose. Under a held or latched
   * pad it is that pad's, by `useDrumVm`'s rule, as the Drum Rack view's own
   * Trnsp is. It is labelled with the kit's own name, large (the user,
   * 2026-11-05; "Trnsp" before), with the drum mark beside it.
   *
   * Back from the pads (2026-10-27 to 2026-11-05, the user's call: one
   * important control, not the pads). The pads, and holding one to scope
   * the chain, are the Drum Rack view's.
   */
  import DeviceSlider from '../DeviceSlider.svelte';
  import VmSlot from '$lib/components/v6/central/views/drum/VmSlot.svelte';
  import { useDrumVm } from '$lib/components/v6/central/useDrumVm.svelte';
  import { VM_PITCH_MIN, VM_PITCH_MAX } from '$lib/services/drumVirtualMacros';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    device: DeviceRecord;
    color: DeviceColorScheme;
  }

  let { device, color }: Props = $props();

  const vm = useDrumVm(() => device.devicePath, { kitFunctions: ['pitch'], functions: () => ['pitch'] });
  const pitchState = $derived(vm.state('pitch'));
</script>

<VmSlot state={pitchState} fn="pitch" class="flex-1 flex flex-col" badge={vm.badge('pitch')}>
  <DeviceSlider
    value={vm.value('pitch') ?? 0}
    labelOrientation="horizontal"
    title={device.name}
    icon="drum"
    {color}
    min={VM_PITCH_MIN}
    max={VM_PITCH_MAX}
    centerOrigin={true}
    centerValue={0}
    isGhost={pitchState === 'none'}
    onInteraction={(value) => vm.write('pitch', Math.round(value))}
  />
</VmSlot>
