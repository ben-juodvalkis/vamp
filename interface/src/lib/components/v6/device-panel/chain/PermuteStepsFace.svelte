<script lang="ts">
  /**
   * A Permute's face in the chain overview (2026-10-25): its mute row over
   * its pitch row, each step a switch, on THIS device — read and written
   * through its own parameters by name (`resolvePermuteLayout`), never
   * through `sequencerStore`, which follows the selected track's (or the
   * scoped pad's) Permute and would steer every copy at once. The running
   * step is the device's telemetry (`permuteStepStore`). Length and rate
   * stay in the Permute view.
   */
  import SequencerPatternGrid from '$lib/components/v6/clips/SequencerPatternGrid.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { permuteStepStore } from '$lib/stores/v3/permuteSteps.svelte';
  import { session } from '$lib/stores/session.svelte';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
  import {
    MUTE_STEP_ROLES,
    PITCH_STEP_ROLES,
    PERMUTE_PARAM_DEFAULTS,
    resolvePermuteLayout,
    type PermuteRole
  } from '$lib/config/permuteLayout';

  interface Props {
    device: DeviceRecord;
    /** The cell's ink, for the mute row. */
    color?: string;
  }

  let { device, color }: Props = $props();

  const layout = $derived(resolvePermuteLayout(device));

  function read(role: PermuteRole): number {
    return selectedTrackStore.paramValueArmed(layout.paths[role]) ?? PERMUTE_PARAM_DEFAULTS[role];
  }

  const muteSteps = $derived(MUTE_STEP_ROLES.map((r) => read(r) === 1));
  const pitchSteps = $derived(PITCH_STEP_ROLES.map((r) => read(r) === 1));
  const muteLength = $derived(read('muteLength'));
  const pitchLength = $derived(read('pitchLength'));
  const running = $derived(permuteStepStore.get(device.devicePath));

  function setStep(role: PermuteRole, on: boolean) {
    void selectedTrackStore.setParamValue(layout.paths[role], on ? 1 : 0);
  }
</script>

<div class="permute-face" data-debug="permute-face">
  <div class="row">
    <SequencerPatternGrid
      variant="mute"
      steps={muteSteps}
      length={muteLength}
      currentStep={running.mute}
      playing={session.isPlaying}
      muteColor={color}
      showLengthSlider={false}
      showRateSlider={false}
      onStepToggle={(i) => setStep(MUTE_STEP_ROLES[i], !muteSteps[i])}
      onStepSet={(i, v) => setStep(MUTE_STEP_ROLES[i], v)}
    />
  </div>
  <div class="row">
    <SequencerPatternGrid
      variant="pitch"
      steps={pitchSteps}
      length={pitchLength}
      currentStep={running.pitch}
      playing={session.isPlaying}
      showLengthSlider={false}
      showRateSlider={false}
      onStepToggle={(i) => setStep(PITCH_STEP_ROLES[i], !pitchSteps[i])}
      onStepSet={(i, v) => setStep(PITCH_STEP_ROLES[i], v)}
    />
  </div>
</div>

<style>
  .permute-face {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .row {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
  }
  .row > :global(*) {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
