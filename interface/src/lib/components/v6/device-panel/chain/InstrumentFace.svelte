<script lang="ts" module>
  import { INSTRUMENT_CONTROLS } from '../deviceControls';
  /** The instrument view types that have a face. */
  export const FACED_INSTRUMENTS = new Set(['omnisphere', 'drift', ...Object.keys(INSTRUMENT_CONTROLS)]);
</script>

<script lang="ts">
  /**
   * The instrument's face in the chain overview (2026-10-25): the one
   * control its own view is known by, on the cell's device — Omnisphere's
   * ORB, Drift's filter, and every instrument in `INSTRUMENT_CONTROLS`
   * (Operator's filter, Collision's first resonator, an Instrument Rack's
   * first macro…, 2026-10-26). The parameter slots are the views' own
   * (measured there); an instrument with no face here keeps its mark.
   */
  import OrbControl from '../OrbControl.svelte';
  import DeviceXY from '../DeviceXY.svelte';
  import DeviceSlider from '../DeviceSlider.svelte';
  import { resolveParam, type ParamRef } from '../deviceControls';
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

  // A table entry's parameters, by name on this device where named (-1: not on it).
  const names = $derived(selectedTrackStore.paramNamesForDevice(device));
  const indexOf = (ref: ParamRef) => resolveParam(ref, names);
  const control = $derived(INSTRUMENT_CONTROLS[type]);
  const readRef = (ref: ParamRef | undefined, fallback: number) => {
    const i = ref === undefined ? -1 : indexOf(ref);
    return i < 0 ? fallback : read(i, fallback);
  };
  function writeRef(ref: ParamRef | undefined, t: number) {
    const i = ref === undefined ? -1 : indexOf(ref);
    if (i >= 0) write(i, t);
  }
  /** Turn the control's switch on (a filter heard only while on) before a write. */
  function switchOn() {
    if (!control?.on) return;
    const i = indexOf(control.on);
    if (i >= 0 && raw(i, 1) < 0.5) write(i, 1);
  }

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
{:else if control?.kind === 'xy'}
  <DeviceXY
    xValue={readRef(control.x, control.rest[0])}
    yValue={readRef(control.y, control.rest[1])}
    title={control.title}
    showCurve={false}
    onInteraction={(x, y) => {
      switchOn();
      writeRef(control.x, x);
      writeRef(control.y, y);
    }}
    {color}
  />
{:else if control?.kind === 'macro'}
  <DeviceSlider
    value={readRef(control.x, control.rest[0])}
    title={names[indexOf(control.x)] || control.title}
    orientation="vertical"
    labelOrientation="horizontal"
    labelSize="small"
    min={0}
    max={1}
    onInteraction={(t) => writeRef(control.x, t)}
    {color}
  />
{/if}
