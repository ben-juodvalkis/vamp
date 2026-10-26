<script lang="ts" module>
  /** The instrument view types that have a face. */
  export const FACED_INSTRUMENTS = new Set(['omnisphere', 'drift']);
</script>

<script lang="ts">
  /**
   * The instrument's face in the chain overview (2026-10-25): the one
   * control its own view is known by, on the cell's device — Omnisphere's
   * ORB, Drift's filter. The parameter slots are the views' own (measured
   * there); an instrument with no face here keeps its mark.
   */
  import OrbControl from '../OrbControl.svelte';
  import DeviceXY from '../DeviceXY.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { driftFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    device: DeviceRecord;
    /** The instrument view type (`omnisphere`, `drift`, …). */
    type: string;
    color: DeviceColorScheme;
  }

  let { device, type, color }: Props = $props();

  // Through each parameter's own range, as Live reports it: 0..1 for most,
  // Hz for a filter that reports Hz. `fallback` is a position, 0..1.
  const rangeOf = (path: string) => selectedTrackStore.paramRange(path) ?? { min: 0, max: 1 };
  function read(index: number, fallback: number): number {
    const path = selectedTrackStore.paramPath(device, index);
    const value = selectedTrackStore.paramValueArmed(path);
    if (value === undefined) return fallback;
    const { min, max } = rangeOf(path);
    return max > min ? (value - min) / (max - min) : value;
  }
  function write(index: number, t: number): void {
    const path = selectedTrackStore.paramPath(device, index);
    const { min, max } = rangeOf(path);
    void selectedTrackStore.setParamValue(path, min + t * (max - min));
  }
  /** A stepped parameter's raw value (Drift's LP type). */
  const raw = (index: number, fallback: number) =>
    selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? fallback;

  // Omnisphere: the ORB's angle and radius (OmnisphereCentralView, 25 / 26).
  // Drift: cutoff and resonance, the LP type for the curve (DriftCentralView, 1 / 2 / 3).
</script>

{#if type === 'omnisphere'}
  <OrbControl
    angle={read(25, 0.5)}
    radius={read(26, 0.5)}
    title="Orb"
    onInteraction={(angle, radius) => {
      write(25, angle);
      write(26, radius);
    }}
    {color}
  />
{:else if type === 'drift'}
  <DeviceXY
    xValue={read(1, 1)}
    yValue={read(2, 0)}
    title="Filter"
    showCurve
    curveType="lowpass"
    curveOrder={driftFilterCurve(Math.round(raw(3, 0))).order}
    curveFreqRange={FILTER_FREQ_RANGE.drift}
    onInteraction={(x, y) => {
      write(1, x);
      write(2, y);
    }}
    {color}
  />
{/if}
