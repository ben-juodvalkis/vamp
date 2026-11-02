<script lang="ts" module>
  import type { CellSize } from './cellSize';

  /**
   * The pitch row is drawn only in a wide, tall cell. A medium or narrow
   * cell, or a two-row chain's short one, keeps the mute row alone, so its
   * switches stay big enough to tap (2026-11-01). No cell at all (outside
   * the chain) draws both.
   */
  export function permuteShowsPitch(size: CellSize | null): boolean {
    if (!size || size.widthClass === null || size.heightClass === null) return true;
    return size.widthClass === 'wide' && size.heightClass === 'tall';
  }

  /**
   * How many lines a chain cell lays the mute row out in when it draws it
   * alone (2026-11-02): one, two or four (the bar, its halves, its
   * quarters: three would split 8 steps 3 · 3 · 2), whichever makes a step
   * closest to square, its shorter side as long as it can be. The steps stay
   * live however small that leaves them: a swipe across a run of them still
   * mutes it. A cell drawing the pitch row too, or no cell (outside the
   * chain, unmeasured), keeps one line.
   */
  export function permuteMuteLines(size: CellSize | null, length: number): number {
    if (!size || size.width <= 0 || size.height <= 0 || permuteShowsPitch(size)) return 1;
    const n = Math.max(1, Math.round(length));
    let best = { lines: 1, side: 0 };
    for (const lines of [1, 2, 4]) {
      if (lines > n) break;
      const side = Math.min(size.width / Math.ceil(n / lines), size.height / lines);
      if (side > best.side) best = { lines, side };
    }
    return best.lines;
  }
</script>

<script lang="ts">
  /**
   * A Permute's face in the chain overview (2026-10-25): its mute row over
   * its pitch row, each step a switch, on THIS device — read and written
   * through its own parameters by name (`resolvePermuteLayout`), never
   * through `sequencerStore`, which follows the selected track's (or the
   * scoped pad's) Permute and would steer every copy at once. The running
   * step is the device's telemetry (`permuteStepStore`). Length and rate
   * stay in the Permute view. A medium or narrow cell, or a two-row
   * chain, draws the mute row alone (`permuteShowsPitch`), in as many
   * lines as make its steps squarest (`permuteMuteLines`).
   */
  import { useCellSize } from './cellSize';
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

  const cellSize = useCellSize();
  const showPitch = $derived(permuteShowsPitch(cellSize()));

  const layout = $derived(resolvePermuteLayout(device));

  function read(role: PermuteRole): number {
    return selectedTrackStore.paramValueArmed(layout.paths[role]) ?? PERMUTE_PARAM_DEFAULTS[role];
  }

  const muteSteps = $derived(MUTE_STEP_ROLES.map((r) => read(r) === 1));
  const pitchSteps = $derived(PITCH_STEP_ROLES.map((r) => read(r) === 1));
  const muteLength = $derived(read('muteLength'));
  const muteLines = $derived(permuteMuteLines(cellSize(), muteLength));
  const pitchLength = $derived(read('pitchLength'));
  const running = $derived(permuteStepStore.get(device.devicePath));

  function setStep(role: PermuteRole, on: boolean) {
    void selectedTrackStore.setParamValue(layout.paths[role], on ? 1 : 0);
  }
</script>

<div class="permute-face" data-debug="permute-face" data-pitch={showPitch} data-mute-lines={muteLines}>
  <div class="row">
    <SequencerPatternGrid
      variant="mute"
      lines={muteLines}
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
  {#if showPitch}
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
  {/if}
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
