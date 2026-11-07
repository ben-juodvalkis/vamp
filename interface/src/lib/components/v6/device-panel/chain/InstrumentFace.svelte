<script lang="ts" module>
  import { INSTRUMENT_CONTROLS } from '../deviceControls';
  /** The instrument view types that have a face. */
  export const FACED_INSTRUMENTS = new Set(['omnisphere', 'drift', ...Object.keys(INSTRUMENT_CONTROLS)]);
</script>

<script lang="ts">
  /**
   * The instrument's face in the chain overview (2026-10-25): the one
   * control its own view is known by, on the cell's device — Omnisphere's
   * ORB, Drift's filter, Wavetable's Osc 1 pad with its wave, Meld's oscillator pad (the engine its view shows) with its type's mark, and every instrument in `INSTRUMENT_CONTROLS`
   * (Operator's four oscillators, Collision's first resonator, an Instrument Rack's
   * first macro…, 2026-10-26). The parameter slots are the views' own
   * (measured there); an instrument with no face here keeps its mark.
   */
  import OrbControl from '../OrbControl.svelte';
  import DeviceXY from '../DeviceXY.svelte';
  import DeviceSlider from '../DeviceSlider.svelte';
  import { resolveParam, instrumentControlFor, type ParamRef } from '../deviceControls';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { driftFilterCurve, analogFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import WavetableWave from '../../central/views/wavetable/WavetableWave.svelte';
  import { useOscWave } from '../../central/views/wavetable/useOscWave.svelte';
  import MeldOscIcon from '../../central/views/meld/MeldOscIcon.svelte';
  import { MELD_ENGINE } from '../../central/views/meldParams';
  import { meldEngineStore } from '$lib/stores/v6/meldEngineStore.svelte';
  import { OPERATOR_OSC_COLORS } from './OperatorAlgorithm.svelte';
  import { operatorOscStore } from '$lib/stores/v6/operatorOscStore.svelte';
  import { schemeFromInk } from '$lib/config/devicePresets';
  import { OP_COARSE_MAX, coarseRatio, coarseX, coarseStepAtX } from './operatorCoarse';
  import { v3Store } from '$lib/stores/v3/normalized.svelte';

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
  // The table's entry, or what it follows on this device (Meld: the engine its view shows).
  const control = $derived(instrumentControlFor(type, device.devicePath));
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

  // Wavetable: Osc 1's wave, as the view's Osc pad draws it (Effect 1 is 5).
  const oscWaves = useOscWave(() => (type === 'wavetable' ? device.devicePath : undefined));
  const oscCycle = $derived(
    type === 'wavetable' && control
      ? oscWaves.wave(1, readRef(control.y, control.rest[1]), read(5, 0.5), readRef(control.x, control.rest[0]))
      : null
  );

  // Meld: the shown engine's oscillator type, its mark the pad's picture.
  const meldOscType = $derived(
    type === 'meld' ? Math.round(raw(MELD_ENGINE[meldEngineStore.engineOf(device.devicePath)].oscType, 0)) : 0
  );

  // Operator: a pad per oscillator, Coarse across and Level up, in Live's
  // oscillator colors. Coarse spans two steps either side of the step
  // each oscillator held when the track was arrived at or its preset
  // loaded (operatorCoarse): the dot sits where the step falls in that
  // window and stays there on release; the ratio reads beside the letter
  // while dragging. One switched off dims and turns on at the first touch.
  // The algorithm is the cell header's (OperatorHeadAlgorithm). By name:
  // Operator's indices move with its sections.
  const OP_OSCS = ['A', 'B', 'C', 'D'] as const;
  // Which pads a finger is dragging: only they show their ratio.
  let opDragging = $state([false, false, false, false]);
  // Level takes a drag twice the pad's height to cross.
  const OP_SENSITIVITY = [1, 0.5] as const;
  const OP_SCHEMES = OPERATOR_OSC_COLORS.map((ink) => schemeFromInk(ink));
  const opRaw = (name: string, fallback: number) => {
    const i = names.indexOf(name);
    return i < 0 ? fallback : raw(i, fallback);
  };
  const opRead = (name: string, fallback: number) => {
    const i = names.indexOf(name);
    return i < 0 ? fallback : read(i, fallback);
  };
  function opWrite(name: string, t: number) {
    const i = names.indexOf(name);
    if (i >= 0) write(i, t);
  }
  const opRatioOf = (o: string) => coarseRatio(opRaw(`${o} Coarse`, 1));
  // The window's anchors, taken once per arrival: a new track or device
  // (devicePath) or a new preset on the track (its recorded path, '' after
  // a swap in Live) starts a fresh set. An oscillator whose Coarse has not
  // arrived yet is anchored on its first real value.
  const opTrackPath = $derived(device.devicePath.split('/devices/')[0]);
  const opArrival = $derived(`${device.devicePath}|${v3Store.tracks.get(opTrackPath)?.preset ?? ''}`);
  let opAnchorKey = '';
  let opAnchors: (number | undefined)[] = [];
  function opAnchor(i: number): number {
    if (opAnchorKey !== opArrival) {
      opAnchorKey = opArrival;
      opAnchors = [];
    }
    const name = `${OP_OSCS[i]} Coarse`;
    const at = names.indexOf(name);
    const value = at < 0 ? undefined : selectedTrackStore.paramValue(selectedTrackStore.paramPath(device, at));
    if (opAnchors[i] === undefined && value !== undefined) opAnchors[i] = Math.round(value);
    return opAnchors[i] ?? Math.round(value ?? 1);
  }
  const opOn = $derived(
    (type === 'operator' ? OP_OSCS.map((o) => opRaw(`Osc-${o} On`, 1) >= 0.5) : [true, true, true, true]) as [boolean, boolean, boolean, boolean]
  );
  function opPlay(i: number, x: number, level: number) {
    const o = OP_OSCS[i];
    // The view shows the oscillator whose pad was touched last (ADR-513).
    operatorOscStore.select(device.devicePath, i);
    if (!opOn[i]) opWrite(`Osc-${o} On`, 1);
    opDragging[i] = true;
    opWrite(`${o} Coarse`, coarseStepAtX(opAnchor(i), x) / OP_COARSE_MAX);
    opWrite(`Osc-${o} Level`, level);
  }



  // Analog: its pad is Filter 1's cutoff and resonance (deviceControls), so it
  // draws Filter 1's response for its type while the filter is on
  // (2026-11-07). analogParams: 53 F1 On/Off, 54 F1 Type.
  const analogCurve = $derived(type === 'analog' ? analogFilterCurve(raw(54, 0)) : null);
  const analogFilterOn = $derived(type === 'analog' && raw(53, 1) >= 0.5);

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
{:else if type === 'operator'}
  <div class="op-pads" data-operator-pads>
    {#each OP_OSCS as o, i (o)}
      <div class="op-pad" class:off={!opOn[i]} data-osc={o} data-on={opOn[i] ? '1' : '0'}>
        <DeviceXY
          xValue={coarseX(opAnchor(i), opRaw(`${o} Coarse`, 1))}
          yValue={opRead(`Osc-${o} Level`, i === 0 ? 1 : 0)}
          title={opDragging[i] ? `${o} ×${opRatioOf(o)}` : o}
          titleAt="bottom"
          showCurve={false}
          sensitivity={OP_SENSITIVITY}
          onInteraction={(x, y) => opPlay(i, x, y)}
          onRelease={() => (opDragging[i] = false)}
          color={OP_SCHEMES[i]}
        />
      </div>
    {/each}
  </div>
{:else if control?.kind === 'xy'}
  <DeviceXY
    xValue={readRef(control.x, control.rest[0])}
    yValue={readRef(control.y, control.rest[1])}
    title={control.title}
    titleAt={type === 'wavetable' || type === 'meld' ? 'bottom' : 'center'}
    showCurve={analogFilterOn && !!analogCurve}
    curveType={analogCurve?.curveType}
    curveOrder={analogCurve?.order}
    curveFreqRange={type === 'analog' ? FILTER_FREQ_RANGE.analog : undefined}
    onInteraction={(x, y) => {
      switchOn();
      writeRef(control.x, x);
      writeRef(control.y, y);
    }}
    {color}
  >
    {#snippet background()}
      {#if type === 'wavetable'}<WavetableWave cycle={oscCycle} color={color.primary} />{/if}
      {#if type === 'meld'}<MeldOscIcon type={meldOscType} color={color.primary} />{/if}
    {/snippet}
  </DeviceXY>
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

<style>
  .op-pads {
    display: grid;
    grid-template: 1fr 1fr / 1fr 1fr;
    gap: 6px;
    width: 100%;
    height: 100%;
  }

  .op-pad {
    min-width: 0;
    min-height: 0;
  }

  /* An oscillator switched off: dim, still live (a touch turns it on). */
  .op-pad.off {
    opacity: 0.4;
  }
</style>
