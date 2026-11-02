<script lang="ts" module>
  import type { CellSize } from './cellSize';

  /** The step size both lanes must keep for the pitch lane to be drawn. */
  export const PERMUTE_PITCH_FLOOR = 44;
  /** The face's gap between the two lanes (`.permute-face`'s `gap`). */
  const LANE_GAP = 6;

  /**
   * One lane in a box: one, two or four lines (the bar, its halves, its
   * quarters: three would split 8 steps 3 · 3 · 2), whichever makes a step
   * closest to square, and that step's shorter side.
   */
  export function permuteLaneLines(
    width: number,
    height: number,
    length: number,
    maxLines = 4
  ): { lines: number; side: number } {
    const n = Math.max(1, Math.round(length));
    let best = { lines: 1, side: 0 };
    for (const lines of [1, 2, 4]) {
      if (lines > n || lines > maxLines) break;
      const side = Math.min(width / Math.ceil(n / lines), height / lines);
      if (side > best.side) best = { lines, side };
    }
    return best;
  }

  export interface PermuteFaceLayout {
    showPitch: boolean;
    muteLines: number;
    pitchLines: number;
  }

  /**
   * How a chain cell draws its Permute (2026-11-02). The pitch lane is drawn
   * only where both lanes fit: each given half the cell and laid out in its
   * squarest one or two lines (so at most four rows in all, mute over
   * pitch), every step at least `PERMUTE_PITCH_FLOOR` on both sides.
   * Otherwise the mute lane takes the whole cell, in its squarest lines,
   * and its steps stay live however small that leaves them (a swipe across a
   * run still mutes it). No cell (outside the chain) or an unmeasured one
   * draws both lanes, one line each.
   */
  export function permuteFaceLayout(size: CellSize | null, muteLength: number, pitchLength: number): PermuteFaceLayout {
    if (!size || size.width <= 0 || size.height <= 0) return { showPitch: true, muteLines: 1, pitchLines: 1 };
    const half = (size.height - LANE_GAP) / 2;
    const mute = permuteLaneLines(size.width, half, muteLength, 2);
    const pitch = permuteLaneLines(size.width, half, pitchLength, 2);
    if (Math.min(mute.side, pitch.side) >= PERMUTE_PITCH_FLOOR) {
      return { showPitch: true, muteLines: mute.lines, pitchLines: pitch.lines };
    }
    return { showPitch: false, muteLines: permuteLaneLines(size.width, size.height, muteLength).lines, pitchLines: 1 };
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
   * stay in the Permute view. Where both lanes do not fit at a touchable
   * step, the mute row is drawn alone, the whole cell, in as many lines as
   * make its steps squarest (`permuteFaceLayout`).
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

  const layout = $derived(resolvePermuteLayout(device));

  function read(role: PermuteRole): number {
    return selectedTrackStore.paramValueArmed(layout.paths[role]) ?? PERMUTE_PARAM_DEFAULTS[role];
  }

  const muteSteps = $derived(MUTE_STEP_ROLES.map((r) => read(r) === 1));
  const pitchSteps = $derived(PITCH_STEP_ROLES.map((r) => read(r) === 1));
  const muteLength = $derived(read('muteLength'));
  const pitchLength = $derived(read('pitchLength'));
  const face = $derived(permuteFaceLayout(cellSize(), muteLength, pitchLength));
  const running = $derived(permuteStepStore.get(device.devicePath));

  function setStep(role: PermuteRole, on: boolean) {
    void selectedTrackStore.setParamValue(layout.paths[role], on ? 1 : 0);
  }
</script>

<div class="permute-face" data-debug="permute-face" data-pitch={face.showPitch} data-mute-lines={face.muteLines}>
  <div class="row">
    <SequencerPatternGrid
      variant="mute"
      lines={face.muteLines}
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
  {#if face.showPitch}
  <div class="row">
    <SequencerPatternGrid
      variant="pitch"
      lines={face.pitchLines}
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
