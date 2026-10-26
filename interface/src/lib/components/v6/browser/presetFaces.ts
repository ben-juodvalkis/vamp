/**
 * What a browser preset tile draws and drives, per device class (2026-10-25,
 * ADR-478): the same control its FX-grid tile is, placed by the values the
 * preset's file saves, and the parameter writes a drag on it makes.
 *
 * Every mapping from a saved value onto the LOM's was measured, not read
 * off docs: one preset of each class was loaded onto a track in the running
 * Live, its parameters dumped, the file's values lined up beside them, and
 * the device removed. A native device saves its parameters in the order the
 * LOM lists them; Auto Pan Legacy and Utility do not, so those go by name.
 * Where the file is in display units (Hz, dB, seconds, a gain factor) the
 * conversion is Live's own rail (`presetCurves`, or a formula checked
 * against Live's labels). The tile's own math decides where the dot sits and
 * what a drag writes, so a preset tile and its grid tile agree.
 *
 * A rack (`.adg`) saves its macros as `MacroControls.<n>`, value for value
 * Live's `parameters[n + 1]` (0..127, measured on the Guitar rack), and
 * names them `MacroDisplayNames.<n>`: its face is its first macro, as the
 * Gtr and Bass tiles are.
 */
import { ECHO } from '$lib/components/v6/device-panel/echoParams';
import {
	frequencyValue,
	tileAmount,
	tileFrequency,
	tileSyncStep,
	tileXForFrequency,
	tileXForSyncRate,
	tileYFor
} from '$lib/components/v6/device-panel/autoPanParams';
import { decayValue } from '$lib/components/v6/device-panel/hybridReverbParams';
import { AUTO_FILTER_PARAM, autoFilterCurve, frequencyToValue } from '$lib/components/v6/device-panel/autoFilterParams';
import type { CurveType } from '$lib/components/v6/device-panel/FilterCurve.svelte';
import { CHORUS_RATE_HZ, ECHO_TIME_SECONDS, UTILITY_OUTPUT_DB, railFor } from './presetCurves';

/** LOM parameter index → value. */
export type LomValues = Record<number, number>;

export interface SavedPreset {
	className: string;
	params: Record<string, number>;
	labels?: Record<string, string>;
}

interface XyFace {
	kind: 'xy';
	read(v: LomValues): { x: number; y: number };
	write(x: number, y: number, v: LomValues): LomValues;
	curve?(v: LomValues): CurveType;
}
interface SliderFace {
	kind: 'slider';
	read(v: LomValues): number;
	write(t: number, v: LomValues): LomValues;
	title?: string;
}
interface EqFace {
	kind: 'eq';
	read(v: LomValues): { low: number; mid: number; midFreq: number; high: number };
}
export type Face = XyFace | SliderFace | EqFace;

export interface FaceSpec {
	/** The LOM values the preset opens at, for the parameters the face uses; null when the file lacks them. */
	fromPreset(saved: SavedPreset): LomValues | null;
	face: Face | ((saved: SavedPreset) => Face);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const db = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
const defined = (v: LomValues): LomValues | null => (Object.values(v).some((x) => x === undefined || Number.isNaN(x)) ? null : v);
const fromRecord = (o: Record<number, number>): LomValues => o;

const RACK: FaceSpec = {
	fromPreset: (s) => (s.params['MacroControls.0'] === undefined ? null : { 1: s.params['MacroControls.0'] }),
	face: (s) => ({
		kind: 'slider',
		title: s.labels?.['MacroDisplayNames.0'] || 'Macro 1',
		read: (v) => clamp01((v[1] ?? 0) / 127),
		write: (t) => ({ 1: clamp01(t) * 127 })
	})
};

/** By the class the preset's file names. */
export const PRESET_FACES: Readonly<Record<string, FaceSpec>> = {
	// Measured: Disco Filter (autoFilterParams).
	AutoFilter2: {
		fromPreset: (s) =>
			s.params.Filter_Frequency === undefined
				? null
				: {
						[AUTO_FILTER_PARAM.frequency]: frequencyToValue(s.params.Filter_Frequency),
						[AUTO_FILTER_PARAM.resonance]: s.params.Filter_Resonance ?? 0,
						[AUTO_FILTER_PARAM.type]: s.params.Filter_Type ?? 0
					},
		face: {
			kind: 'xy',
			read: (v) => ({ x: v[1], y: v[2] }),
			write: (x, y) => ({ 1: x, 2: y }),
			curve: (v) => autoFilterCurve(v[4])
		}
	},
	// Measured: A Bit Tipsy. L Sync true/false; L Time in seconds (Live's
	// rail, ECHO_TIME_SECONDS: 0.375 s → 0.5653); L 16th as is; Feedback a
	// fraction of 150 % (0.6071 saved → 0.4048); Dry Wet as is.
	Echo: {
		fromPreset: (s) =>
			defined(
				fromRecord({
					[ECHO.sync]: s.params.Delay_SyncL,
					[ECHO.time]: railFor(ECHO_TIME_SECONDS, s.params.Delay_TimeL),
					[ECHO.sixteenths]: s.params.Delay_SyncedSixteenthL,
					[ECHO.feedback]: s.params.Feedback / 1.5,
					[ECHO.mix]: s.params.DryWet
				})
			),
		face: {
			kind: 'xy',
			read: (v) => ({ x: ECHO.timeTFrom(v[ECHO.sync] >= 0.5, v[ECHO.sixteenths], v[ECHO.time]), y: clamp01(v[ECHO.feedback]) }),
			write: (x, y) => Object.fromEntries([...ECHO.timeWrites(x), ...ECHO.feedbackMixWrites(y)])
		}
	},
	// Measured by name (the file's order is not the LOM's): LFO Type =
	// RateType, Amount = LfoAmount, Frequency in Hz (0.05 · 1800^v: 1.00 Hz →
	// 0.3997), Sync Rate = BeatRate, Invert = LfoInvert.
	AutoPan: {
		fromPreset: (s) =>
			defined(
				fromRecord({
					1: s.params.RateType,
					2: s.params.LfoAmount,
					3: frequencyValue(s.params.Frequency),
					4: s.params.BeatRate,
					12: s.params.LfoInvert ?? 0
				})
			),
		face: {
			kind: 'xy',
			read: (v) => ({ x: v[1] >= 0.5 ? tileXForSyncRate(v[4]) : tileXForFrequency(v[3]), y: tileYFor(v[2], v[12] >= 0.5) }),
			write: (x, y) => {
				const { amount, invert } = tileAmount(y);
				return { 4: tileSyncStep(x), 3: tileFrequency(x), 2: amount, 12: invert };
			}
		}
	},
	// Measured: Car Garage. Decay in seconds (hybridReverbParams' rail:
	// 0.514 s → 0.1667); Dry/Wet as is.
	Hybrid: {
		fromPreset: (s) =>
			s.params.Algorithm_Decay === undefined ? null : { 10: decayValue(s.params.Algorithm_Decay), 53: s.params.DryWet ?? 1 },
		face: { kind: 'xy', read: (v) => ({ x: v[10], y: v[53] }), write: (x, y) => ({ 10: x, 53: y }) }
	},
	// Measured: Boom Capture. The gains are linear factors: low and high
	// shelves on a ±15 dB rail (4.158 → 12.4 dB → 0.9134), mid ±12 dB
	// (0.5138 → -5.8 dB → 0.2598); Mid Freq in Hz on 120 Hz..7.5 kHz, log.
	ChannelEq: {
		fromPreset: (s) =>
			defined(
				fromRecord({
					2: clamp01((db(s.params.LowShelfGain) + 15) / 30),
					3: clamp01((db(s.params.MidGain) + 12) / 24),
					4: clamp01(Math.log(s.params.MidFrequency / 120) / Math.log(7500 / 120)),
					5: clamp01((db(s.params.HighShelfGain) + 15) / 30)
				})
			),
		face: { kind: 'eq', read: (v) => ({ low: v[2], mid: v[3], midFreq: v[4], high: v[5] }) }
	},
	// Measured: Chorus Bass. Rate in Hz (Live's rail, CHORUS_RATE_HZ: 0.66 Hz
	// → 0.373); Dry/Wet as is.
	Chorus2: {
		fromPreset: (s) => defined(fromRecord({ 3: railFor(CHORUS_RATE_HZ, s.params.Rate), 15: s.params.DryWet })),
		face: { kind: 'xy', read: (v) => ({ x: v[3], y: v[15] }), write: (x, y) => ({ 3: x, 15: y }) }
	},
	// Measured: Bonzo on the Dials. Transients (-1..1) and Dry/Wet as is.
	DrumBuss: {
		fromPreset: (s) => defined(fromRecord({ 6: s.params.TransientShaping, 13: s.params.DryWet })),
		face: { kind: 'xy', read: (v) => ({ x: (v[6] + 1) / 2, y: v[13] }), write: (x, y) => ({ 6: 2 * x - 1, 13: y }) }
	},
	// Measured: 808 Shaper. Drive in dB on ±36 (0 dB → 0.5), Output in dB on
	// -36..0 (0 dB → 1), Dry/Wet as is. The tile's slider: drive up, output
	// down with it, wet with it.
	Saturator: {
		fromPreset: (s) =>
			defined(fromRecord({ 1: clamp01((s.params.PreDrive + 36) / 72), 10: clamp01((s.params.PostDrive + 36) / 36), 11: s.params.DryWet })),
		face: {
			kind: 'slider',
			title: 'Drive',
			read: (v) => clamp01((v[1] - 0.5) / 0.5),
			write: (t) => ({ 1: 0.5 + 0.5 * t, 10: 1 - 0.5 * t, 11: t })
		}
	},
	// Measured: Bass - Low Extender. Threshold and Makeup in dB, as the LOM.
	GlueCompressor: {
		fromPreset: (s) => defined(fromRecord({ 1: s.params.Threshold, 3: s.params.Makeup })),
		face: { kind: 'slider', title: 'Glue', read: (v) => clamp01(v[1] / -40), write: (t) => ({ 1: -40 * t, 3: 20 * t }) }
	},
	// Measured by name: Output is the file's Gain, a linear factor (1 → 0 dB
	// → 0 on the -1..1 rail, UTILITY_OUTPUT_DB).
	StereoGain: {
		fromPreset: (s) => (s.params.Gain === undefined ? null : { 9: railFor(UTILITY_OUTPUT_DB, db(s.params.Gain)) }),
		face: { kind: 'slider', title: 'Gain', read: (v) => clamp01((v[9] + 1) / 2), write: (t) => ({ 9: 2 * t - 1 }) }
	},
	// Measured: Airpusher. Chance as is.
	BeatRepeat: {
		fromPreset: (s) => (s.params.Chance === undefined ? null : { 1: s.params.Chance }),
		face: { kind: 'slider', title: 'Chance', read: (v) => clamp01(v[1]), write: (t) => ({ 1: t }) }
	},
	// Measured: Blue. Chance as is.
	MidiRandom: {
		fromPreset: (s) => (s.params.Chance === undefined ? null : { 1: s.params.Chance }),
		face: { kind: 'slider', title: 'Chance', read: (v) => clamp01(v[1]), write: (t) => ({ 1: t }) }
	},
	AudioEffectGroupDevice: RACK,
	MidiEffectGroupDevice: RACK
};

/** A preset's face and its starting values, or null when its class has none or the file lacks the values. */
export function presetFace(saved: SavedPreset | null): { face: Face; values: LomValues } | null {
	if (!saved) return null;
	const spec = PRESET_FACES[saved.className];
	if (!spec) return null;
	const values = spec.fromPreset(saved);
	if (!values) return null;
	return { face: typeof spec.face === 'function' ? spec.face(saved) : spec.face, values };
}
