/**
 * Every device's control, defined once (2026-10-26): the XY, slider or tone
 * pad a device is played by, which parameters it reads and writes, the math
 * between the finger and Live, the values it rests at before a device
 * answers, and how a preset file's saved values read onto it. The FX grid's
 * tiles, the chain overview's cells and the browser's preset tiles all draw
 * from this table, so the three cannot disagree. A tile that draws
 * something of its own (Reverb's portrait, Utility's meter, the EQ's tone
 * pad) still takes its parameters and math from here.
 *
 * Keyed by `DEVICE_PRESETS` key. Parameters are LOM indices, or for a Max
 * device whose indices shift build to build, a name with the measured
 * index as the fallback (`{ name, index }`, resolved by `resolveParam`).
 *
 * Every preset mapping was measured, not read off docs: one preset of each
 * class loaded onto a track in the running Live, its parameters dumped
 * beside the file's values and the device removed
 * (`owner/probes/preset_measure.js`). A native device saves its parameters
 * in the LOM's order (Auto Pan Legacy and Utility do not: by name). Where
 * the file is in display units the conversion is Live's own rail
 * (`presetCurves`, sampled with `preset_rail_sample.js`) or a formula
 * checked against Live's labels. The numbers are in
 * docs/reference/live-api-measurements.md.
 */
import { ECHO } from './echoParams';
import {
	AUTO_PAN,
	frequencyLabel,
	frequencyValue,
	syncRateLabel,
	tileAmount,
	tileFrequency,
	tileSyncStep,
	tileXForFrequency,
	tileXForSyncRate,
	tileYFor
} from './autoPanParams';
import { decayValue } from './hybridReverbParams';
import { AUTO_FILTER_PARAM, autoFilterCurve, frequencyToValue } from './autoFilterParams';
import { GLITCH_LOOP_PARAMS } from './glitchLoopParams';
import { OCTAVE_MIX_MAX, OCTAVE_MIX_PARAM } from './octaveParams';
import { MB_BELOW_RATIO_MID, ratioFromSlider, sliderFromRatio } from './multibandParams';
import type { CurveType } from './FilterCurve.svelte';
import {
	CHORUS_RATE_HZ,
	ECHO_TIME_SECONDS,
	REDUX_SAMPLE_RATE_HZ,
	THRESHOLD_DB,
	UTILITY_OUTPUT_DB,
	railFor
} from '$lib/components/v6/browser/presetCurves';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import type { PictureKind } from '$lib/components/v6/browser/devicePictures';
import type { ControlGlyphName } from './ControlGlyph.svelte';

/** A LOM parameter index, or a Max device's parameter by name with its measured index as the fallback. */
export type ParamRef = number | { name: string; index: number };
/** A parameter's value, or undefined before the device answers. */
export type Get = (ref: ParamRef) => number | undefined;
/** The parameter writes a gesture makes. */
export type Writes = ReadonlyArray<readonly [ParamRef, number]>;

export interface XyControl {
	kind: 'xy';
	title: string;
	/** Its picture behind the pad, on a chain cell and a browser tile (`devicePictures`). */
	picture?: PictureKind;
	/** A mark beside its title. */
	icon?: ControlGlyphName;
	read(get: Get): { x: number; y: number };
	write(x: number, y: number, get: Get): Writes;
	/** The filter curve drawn behind the dot. */
	curve?(get: Get): CurveType;
	/** A rate or time drawn on the pad; `display` is Live's label for a parameter, when known. */
	label?(get: Get, display: (ref: ParamRef) => string | undefined): string | undefined;
}
export interface SliderControl {
	kind: 'slider';
	title: string;
	/** Its picture behind the slider, on a chain cell and a browser tile (`devicePictures`). */
	picture?: PictureKind;
	/** A mark beside its title (the racks: Gtr, Bass, Wah). */
	icon?: ControlGlyphName;
	/** The parameter whose label Live gives is the slider's readout. */
	readout?: ParamRef;
	/** Where the fill grows from, 0..1, for a control centered on a neutral value (Multiband's 1 : 1). */
	center?: number;
	read(get: Get): number;
	write(t: number, get: Get): Writes;
}
export interface EqControl {
	kind: 'eq';
	title: string;
	read(get: Get): { low: number; mid: number; midFreq: number; high: number };
	low(v: number): Writes;
	mid(freq: number, gain: number): Writes;
	high(v: number): Writes;
}
export type Control = XyControl | SliderControl | EqControl;

/** A preset file's saved values: its class and each parameter by the file's own name. */
export interface SavedPreset {
	className: string;
	params: Record<string, number>;
	labels?: Record<string, string>;
}

export interface DeviceControl {
	control: Control;
	/** The LOM values a preset file opens at, for the parameters the control uses; null when the file lacks them. Absent: the control's rest values. */
	fromPreset?(saved: SavedPreset): Record<number, number> | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const db = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
/** null when any value is missing from the file. */
const all = (v: Record<number, number>): Record<number, number> | null =>
	Object.values(v).some((x) => x === undefined || Number.isNaN(x)) ? null : v;
/** A threshold saved as a linear factor, on Live's dB rail; below its first label Live puts it at 0 (measured: -70 dB → 0). */
const thresholdValue = (gain: number) => {
	const d = db(gain);
	return d <= THRESHOLD_DB.units[1] ? 0 : railFor(THRESHOLD_DB, d);
};
/** One rack macro, 0..127, as a slider. */
const macroSlider = (title: string, macro = 1, icon?: ControlGlyphName): SliderControl => ({
	kind: 'slider',
	title,
	icon,
	read: (g) => clamp01((g(macro) ?? 0) / 127),
	write: (t) => [[macro, clamp01(t) * 127]]
});
/** A rack preset's macro: `MacroControls.<n>` is `parameters[n + 1]`, value for value (measured on the Guitar rack). */
const macroFromPreset = (s: SavedPreset) => (s.params['MacroControls.0'] === undefined ? null : { 1: s.params['MacroControls.0'] });

const GLITCH_MIX = { name: GLITCH_LOOP_PARAMS.mix.name, index: GLITCH_LOOP_PARAMS.mix.index };
const BLUR_MIX = { name: 'Mix', index: 4 };
const COMB = { tune: { name: 'Tune', index: 1 }, mix: { name: 'Mix', index: 2 }, feedback: { name: 'Feedback', index: 3 } };
const OCTAVE_MIX = { name: 'Mix', index: OCTAVE_MIX_PARAM };
const CHANCE = { name: 'Chance', index: 1 };
/** Pitch Hack's Dry / Wet, 0..100 % (device_dump, 2026-10-15; the .adv saves it under the same short name). */
const PITCH_HACK_MIX = { name: 'Dry / Wet', index: 2 };
/** A Max device's saved values, by name, at each parameter's fallback index; null when the file lacks one. */
const byName = (s: SavedPreset, ...refs: Array<{ name: string; index: number }>) =>
	all(Object.fromEntries(refs.map((r) => [r.index, s.params[r.name]])));
const SHIFTER = { ringMod: 18, mode: 32, ring: 2, ringModMax: 0.75 } as const;

export const DEVICE_CONTROLS: Readonly<Partial<Record<string, DeviceControl>>> = {
	// Measured: Disco Filter. Frequency in Hz → log(hz/20)/log(1000).
	filter: {
		control: {
			kind: 'xy',
			title: 'Filter',
			read: (g) => ({ x: g(AUTO_FILTER_PARAM.frequency) ?? 1, y: g(AUTO_FILTER_PARAM.resonance) ?? 0 }),
			write: (x, y) => [
				[AUTO_FILTER_PARAM.frequency, x],
				[AUTO_FILTER_PARAM.resonance, y]
			],
			curve: (g) => autoFilterCurve(g(AUTO_FILTER_PARAM.type) ?? 0)
		},
		fromPreset: (s) =>
			s.params.Filter_Frequency === undefined
				? null
				: {
						[AUTO_FILTER_PARAM.frequency]: frequencyToValue(s.params.Filter_Frequency),
						[AUTO_FILTER_PARAM.resonance]: s.params.Filter_Resonance ?? 0,
						[AUTO_FILTER_PARAM.type]: s.params.Filter_Type ?? 0
					}
	},
	// Measured: A Bit Tipsy. L Sync true/false; L Time seconds on Live's rail
	// (0.375 s → 0.5653); L 16th as is; Feedback a fraction of 150 %
	// (0.6071 → 0.4048); Dry Wet as is.
	echo: {
		control: {
			kind: 'xy',
			title: 'Echo', picture: 'rings',
			read: (g) => ({
				x: ECHO.timeTFrom((g(ECHO.sync) ?? 1) >= 0.5, g(ECHO.sixteenths), g(ECHO.time)),
				y: clamp01(g(ECHO.feedback) ?? 0)
			}),
			write: (x, y) => [...ECHO.timeWrites(x), ...ECHO.feedbackMixWrites(y)],
			label: (g, display) => ECHO.timeLabel((g(ECHO.sync) ?? 1) >= 0.5, g(ECHO.sixteenths), display(ECHO.time), g(ECHO.time))
		},
		fromPreset: (s) =>
			all({
				[ECHO.sync]: s.params.Delay_SyncL,
				[ECHO.time]: railFor(ECHO_TIME_SECONDS, s.params.Delay_TimeL),
				[ECHO.sixteenths]: s.params.Delay_SyncedSixteenthL,
				[ECHO.feedback]: s.params.Feedback / 1.5,
				[ECHO.mix]: s.params.DryWet
			})
	},
	// Measured by name: LFO Type = RateType, Amount = LfoAmount, Frequency
	// in Hz (0.05 · 1800^v: 1.00 Hz → 0.3997), Sync Rate = BeatRate,
	// Invert = LfoInvert.
	tremolo: {
		control: {
			kind: 'xy',
			title: 'Tremolo', picture: 'tremolo',
			read: (g) => {
				const synced = (g(AUTO_PAN.lfoType) ?? 1) >= 0.5;
				return {
					x: synced ? tileXForSyncRate(g(AUTO_PAN.syncRate) ?? 6) : tileXForFrequency(g(AUTO_PAN.frequency) ?? 0.5),
					y: tileYFor(g(AUTO_PAN.amount) ?? 0, (g(AUTO_PAN.invert) ?? 0) >= 0.5)
				};
			},
			write: (x, y) => {
				const { amount, invert } = tileAmount(y);
				return [
					[AUTO_PAN.syncRate, tileSyncStep(x)],
					[AUTO_PAN.frequency, tileFrequency(x)],
					[AUTO_PAN.amount, amount],
					[AUTO_PAN.invert, invert]
				];
			},
			label: (g) =>
				(g(AUTO_PAN.lfoType) ?? 1) >= 0.5 ? syncRateLabel(g(AUTO_PAN.syncRate) ?? 6) : frequencyLabel(g(AUTO_PAN.frequency) ?? 0.5)
		},
		fromPreset: (s) =>
			all({
				[AUTO_PAN.lfoType]: s.params.RateType,
				[AUTO_PAN.amount]: s.params.LfoAmount,
				[AUTO_PAN.frequency]: frequencyValue(s.params.Frequency),
				[AUTO_PAN.syncRate]: s.params.BeatRate,
				[AUTO_PAN.invert]: s.params.LfoInvert ?? 0
			})
	},
	// Measured: Car Garage. Decay in seconds (0.514 s → 0.1667); Dry/Wet as
	// is. The grid tile draws the reverb's portrait over the same two.
	reverb: {
		control: {
			kind: 'xy',
			title: 'Reverb',
			read: (g) => ({ x: g(10) ?? 0.5, y: g(53) ?? 0 }),
			write: (x, y) => [
				[10, x],
				[53, y]
			]
		},
		fromPreset: (s) => (s.params.Algorithm_Decay === undefined ? null : { 10: decayValue(s.params.Algorithm_Decay), 53: s.params.DryWet ?? 1 })
	},
	// Measured: Boom Capture. Gains are linear factors: shelves on ±15 dB
	// (4.158 → 12.4 dB → 0.9134), mid ±12 dB; Mid Freq Hz on 120 Hz..7.5 kHz, log.
	eq: {
		control: {
			kind: 'eq',
			title: 'EQ',
			read: (g) => ({ low: g(2) ?? 0.5, mid: g(3) ?? 0.5, midFreq: g(4) ?? 0.625, high: g(5) ?? 0.5 }),
			low: (v) => [[2, v]],
			mid: (f, gain) => [
				[4, f],
				[3, gain]
			],
			high: (v) => [[5, v]]
		},
		fromPreset: (s) =>
			all({
				2: clamp01((db(s.params.LowShelfGain) + 15) / 30),
				3: clamp01((db(s.params.MidGain) + 12) / 24),
				4: clamp01(Math.log(s.params.MidFrequency / 120) / Math.log(7500 / 120)),
				5: clamp01((db(s.params.HighShelfGain) + 15) / 30)
			})
	},
	// Measured: Chorus Bass. Rate Hz on Live's rail (0.66 Hz → 0.373).
	chorus: {
		control: {
			kind: 'xy',
			title: 'Chorus', picture: 'waves',
			read: (g) => ({ x: g(3) ?? 0.5, y: g(15) ?? 0 }),
			write: (x, y) => [
				[3, x],
				[15, y]
			]
		},
		fromPreset: (s) => all({ 3: railFor(CHORUS_RATE_HZ, s.params.Rate), 15: s.params.DryWet })
	},
	// Measured: Bonzo on the Dials. Transients (-1..1) and Dry/Wet as is.
	drum: {
		control: {
			kind: 'xy',
			title: 'Drum', picture: 'drum',
			read: (g) => ({ x: ((g(6) ?? 0) + 1) / 2, y: g(13) ?? 0 }),
			write: (x, y) => [
				[6, 2 * x - 1],
				[13, y]
			]
		},
		fromPreset: (s) => all({ 6: s.params.TransientShaping, 13: s.params.DryWet })
	},
	// Measured: 808 Shaper. Drive dB on ±36 (0 dB → 0.5), Output dB on
	// -36..0 (0 dB → 1). One axis: drive up, output down with it, wet with it.
	saturator: {
		control: {
			kind: 'slider',
			title: 'Drive',
			picture: 'shaper',
			read: (g) => clamp01(((g(1) ?? 0.5) - 0.5) / 0.5),
			write: (t) => [
				[1, 0.5 + 0.5 * t],
				[10, 1 - 0.5 * t],
				[11, t]
			]
		},
		fromPreset: (s) => all({ 1: clamp01((s.params.PreDrive + 36) / 72), 10: clamp01((s.params.PostDrive + 36) / 36), 11: s.params.DryWet })
	},
	// Measured: Pedal (2026-10-26). Gain is Drive (2), 0..1 as saved. Drive
	// alone (user, 2026-10-26), not the Pedal view's Drive/Mix pair.
	pedal: {
		control: { kind: 'slider', title: 'Drive', picture: 'stompbox', read: (g) => clamp01(g(2) ?? 0), write: (t) => [[2, clamp01(t)]] },
		fromPreset: (s) => (s.params.Gain === undefined ? null : { 2: s.params.Gain })
	},
	// Measured: Bass - Low Extender. Threshold and Makeup in dB, as the LOM:
	// threshold to -40 dB with makeup to +20 dB on one slider.
	squash: {
		control: {
			kind: 'slider',
			title: 'Glue', picture: 'compress',
			read: (g) => clamp01((g(1) ?? 0) / -40),
			write: (t) => [
				[1, -40 * t],
				[3, 20 * t]
			]
		},
		fromPreset: (s) => all({ 1: s.params.Threshold, 3: s.params.Makeup })
	},
	// Measured: Gate (2026-10-26). Threshold a linear factor on Live's dB
	// rail (0.000316 → -70 dB → 0); Release ms, 0.1 · 30000^v (15 → 0.486).
	gate: {
		control: {
			kind: 'xy',
			title: 'Gate', picture: 'gate',
			read: (g) => ({ x: g(4) ?? 0.5, y: g(1) ?? 0 }),
			write: (x, y) => [
				[4, x],
				[1, y]
			]
		},
		fromPreset: (s) =>
			s.params.Threshold === undefined || s.params.Release === undefined
				? null
				: { 1: thresholdValue(s.params.Threshold), 4: clamp01(Math.log(s.params.Release / 0.1) / Math.log(30000)) }
	},
	// Measured: Compressor (2026-10-26). Threshold a linear factor on the
	// same dB rail as Gate's (Live's labels agree at every quarter): 1.995
	// (+6 dB) → 1.
	compressor: {
		control: { kind: 'slider', title: 'Comp', picture: 'compress', read: (g) => clamp01(g(1) ?? 1), write: (t) => [[1, clamp01(t)]] },
		fromPreset: (s) => (s.params.Threshold === undefined ? null : { 1: thresholdValue(s.params.Threshold) })
	},
	// Measured: Multiband Dynamics (2026-10-26). Below Ratio (Mid), -3..1 as
	// saved (0 → 0, Live's 1 : 1.00); the slider is the Glue view's rail,
	// expansion below its middle and compression above (sliderFromRatio).
	ott: {
		control: {
			kind: 'slider',
			title: 'Ratio', picture: 'ratio',
			readout: MB_BELOW_RATIO_MID,
			center: 0.5,
			read: (g) => sliderFromRatio(g(MB_BELOW_RATIO_MID) ?? 0),
			write: (t) => [[MB_BELOW_RATIO_MID, ratioFromSlider(t)]]
		},
		fromPreset: (s) => (s.params.BelowRatioMid === undefined ? null : { [MB_BELOW_RATIO_MID]: s.params.BelowRatioMid })
	},
	// Measured: Utility. Output is the file's Gain, a linear factor (1 → 0 dB
	// → 0 on the -1..1 rail). The grid tile draws the track's meter behind it.
	utility: {
		control: { kind: 'slider', title: 'Gain', readout: 9, read: (g) => clamp01(((g(9) ?? 0) + 1) / 2), write: (t) => [[9, 2 * clamp01(t) - 1]] },
		fromPreset: (s) => (s.params.Gain === undefined ? null : { 9: railFor(UTILITY_OUTPUT_DB, db(s.params.Gain)) })
	},
	// Measured: Airpusher. Chance as is.
	variation: {
		control: { kind: 'slider', title: 'Stutter', picture: 'repeat', read: (g) => clamp01(g(1) ?? 0), write: (t) => [[1, clamp01(t)]] },
		fromPreset: (s) => (s.params.Chance === undefined ? null : { 1: s.params.Chance })
	},
	// Measured: Velocity (2026-10-26). Random is 0..64 in Live (not 127),
	// saved as is.
	velocity: {
		control: { kind: 'slider', title: 'Rand Vel', readout: 3, picture: 'velocity', read: (g) => clamp01((g(3) ?? 0) / 64), write: (t) => [[3, clamp01(t) * 64]] },
		fromPreset: (s) => (s.params.Random === undefined ? null : { 3: s.params.Random })
	},
	// Measured: Arpeggiator (2026-10-26). Synced Rate 0..13 (1/128..1/1),
	// Gate 1..200 %, both as saved; the preset saves the device off. Rate
	// across in its fourteen steps, Gate up: the bottom switches the device
	// off, as the Arpeggiator view's Gate does, and any other height on.
	arpeggiator: {
		control: {
			kind: 'xy',
			title: 'Arp', picture: 'arp',
			read: (g) => ({ x: clamp01((g(5) ?? 6) / 13), y: (g(0) ?? 0) < 0.5 ? 0 : clamp01(((g(8) ?? 1) - 1) / 199) }),
			write: (x, y) => [
				[5, Math.round(clamp01(x) * 13)],
				[0, y > 0 ? 1 : 0],
				[8, 1 + clamp01(y) * 199]
			],
			label: (_g, display) => display(5)
		},
		fromPreset: (s) => all({ 0: s.params.On, 5: s.params.SyncedRate, 8: s.params.Gate })
	},
	// Measured: Chord (2026-10-26). Shift1 -36..36 st as saved. One slider on
	// the first added note, in whole semitones over ±24, 0 at the middle.
	chord: {
		control: {
			kind: 'slider',
			title: 'Shift', picture: 'chord',
			readout: 1,
			center: 0.5,
			read: (g) => clamp01(((g(1) ?? 0) + 24) / 48),
			write: (t) => [[1, Math.round(clamp01(t) * 48 - 24)]]
		},
		fromPreset: (s) => (s.params.Shift1 === undefined ? null : { 1: s.params.Shift1 })
	},
	// Measured: Blue. Chance as is.
	random: {
		control: { kind: 'slider', title: 'Rand Oct', readout: 1, picture: 'scatter', read: (g) => clamp01(g(1) ?? 0), write: (t) => [[1, clamp01(t)]] },
		fromPreset: (s) => (s.params.Chance === undefined ? null : { 1: s.params.Chance })
	},
	// Measured: Redux (2026-10-26). Post-Filter -4..4 → (v + 4) / 8 (0 →
	// 0.5); Sample Rate Hz on Live's rail (40 kHz → 1). Y is the sample rate
	// turned over: up is crunchier.
	redux: {
		control: {
			kind: 'xy',
			title: 'Redux', picture: 'stairs',
			read: (g) => ({ x: g(8) ?? 0.5, y: 1 - (g(1) ?? 1) }),
			write: (x, y) => [
				[8, x],
				[1, 1 - y]
			]
		},
		fromPreset: (s) =>
			all({ 8: clamp01((s.params.PostFilterValue + 4) / 8), 1: railFor(REDUX_SAMPLE_RATE_HZ, s.params.SampleRate) })
	},
	// Measured: Phaser-Flanger (2026-10-26). LFO 1 Freq is 0..1 on Live's
	// own rail, 0.01 Hz · 4000^v (the file's 0.1486 Hz → 0.3254); Feedback
	// 0..1 (Live's 99 % at 1), saved 0 → 0. X speed, Y feedback.
	phaser: {
		control: {
			kind: 'xy',
			title: 'Phaser', picture: 'notches',
			read: (g) => ({ x: g(3) ?? 0.3254, y: g(25) ?? 0 }),
			write: (x, y) => [
				[3, x],
				[25, y]
			]
		},
		fromPreset: (s) =>
			all({ 3: clamp01(Math.log(s.params.Modulation_Frequency / 0.01) / Math.log(4000)), 25: s.params.Feedback })
	},
	// Measured: Shifter (2026-10-26). RM Coarse Hz on 1 · 10000^v (1 Hz →
	// 0), capped at 0.75 (1 kHz) as the Pedal view caps it; Mode 2 is Ring,
	// set with the first write when it is not.
	shifter: {
		control: {
			kind: 'slider',
			title: 'Shifter', picture: 'ringmod',
			readout: SHIFTER.ringMod,
			read: (g) => clamp01((g(SHIFTER.ringMod) ?? 0) / SHIFTER.ringModMax),
			write: (t, g) => [
				...(g(SHIFTER.mode) === SHIFTER.ring ? [] : ([[SHIFTER.mode, SHIFTER.ring]] as Writes)),
				[SHIFTER.ringMod, clamp01(t) * SHIFTER.ringModMax]
			]
		},
		fromPreset: (s) =>
			s.params.ModBasedShifting_RingMod_Coarse === undefined
				? null
				: { [SHIFTER.ringMod]: clamp01(Math.log10(s.params.ModBasedShifting_RingMod_Coarse) / 4), [SHIFTER.mode]: s.params.Global_ShifterMode ?? 0 }
	},
	// Max devices (2026-10-26): parameters by the name Live gives them, the
	// `.amxd`'s `parameter_shortname`, with the measured index as fallback;
	// the file saves each at the value Live opens it at (measured: Octave
	// Mix 100, Comb Mix and Feedback 17.58, Blur Mix 0, Note Chance 100,
	// GlitchLoop Dry/Wet 35.7033), in Live's units.
	smudge: {
		control: { kind: 'slider', title: 'Blur', picture: 'smear', read: (g) => clamp01((g(BLUR_MIX) ?? 0) / 100), write: (t) => [[BLUR_MIX, clamp01(t) * 100]] },
		fromPreset: (s) => byName(s, BLUR_MIX)
	},
	comb: {
		control: {
			kind: 'xy',
			title: 'Comb', picture: 'comb',
			read: (g) => ({ x: ((g(COMB.tune) ?? 0) + 24) / 48, y: clamp01((g(COMB.feedback) ?? 17.58) / 100) }),
			write: (x, y) => [
				[COMB.tune, -24 + 48 * x],
				[COMB.mix, y * 100],
				[COMB.feedback, y * 100]
			]
		},
		fromPreset: (s) => byName(s, COMB.tune, COMB.mix, COMB.feedback)
	},
	glitchLoop: {
		control: {
			kind: 'slider',
			title: 'Glitch', picture: 'glitch',
			read: (g) => clamp01((g(GLITCH_MIX) ?? 0) / GLITCH_LOOP_PARAMS.mix.max),
			write: (t) => [[GLITCH_MIX, clamp01(t) * GLITCH_LOOP_PARAMS.mix.max]]
		},
		fromPreset: (s) => byName(s, GLITCH_MIX)
	},
	octave: {
		control: {
			kind: 'slider',
			title: 'Pitch', picture: 'octaves',
			read: (g) => clamp01((g(OCTAVE_MIX) ?? 0) / OCTAVE_MIX_MAX),
			write: (t) => [[OCTAVE_MIX, clamp01(t) * OCTAVE_MIX_MAX]]
		},
		fromPreset: (s) => byName(s, OCTAVE_MIX)
	},
	// Pitch Hack: its Mix (user, 2026-10-26: "should be a slider for mix").
	pitchHack: {
		control: {
			kind: 'slider',
			title: 'Mix', readout: PITCH_HACK_MIX, picture: 'reverse',
			read: (g) => clamp01((g(PITCH_HACK_MIX) ?? 0) / 100),
			write: (t) => [[PITCH_HACK_MIX, Math.round(clamp01(t) * 100)]]
		},
		fromPreset: (s) => byName(s, PITCH_HACK_MIX)
	},
	chance: {
		control: { kind: 'slider', title: 'Chance', readout: CHANCE, picture: 'chance', read: (g) => clamp01((g(CHANCE) ?? 100) / 100), write: (t) => [[CHANCE, Math.round(clamp01(t) * 100)]] },
		fromPreset: (s) => byName(s, CHANCE)
	},
	// Racks the app knows: macro 1, as their tiles and views drive it.
	guitar: { control: macroSlider('Gtr', 1, 'amp'), fromPreset: macroFromPreset },
	bass: { control: macroSlider('Bass', 1, 'amp'), fromPreset: macroFromPreset },
	wah: { control: macroSlider('Wah', 1, 'wah'), fromPreset: macroFromPreset }
};

/** A parameter's index on a device whose parameter names are `names`. */
export function resolveParam(ref: ParamRef, names: readonly string[] = []): number {
	if (typeof ref === 'number') return ref;
	const byName = names.indexOf(ref.name);
	return byName >= 0 ? byName : ref.index;
}

/** The control for a `DEVICE_PRESETS` key, or null. */
export function controlFor(key: string | null | undefined): Control | null {
	return (key && DEVICE_CONTROLS[key]?.control) || null;
}

const RACK_CLASSES = new Set(['AudioEffectGroupDevice', 'MidiEffectGroupDevice']);

/**
 * The `DEVICE_PRESETS` key a preset file is: a native class names its key
 * outright; a Max device or a rack goes by the name Live gives it, which is
 * the file's.
 */
export function deviceKeyForPreset(className: string, name: string): string | null {
	for (const [key, config] of Object.entries(DEVICE_PRESETS)) {
		if (!DEVICE_CONTROLS[key]) continue;
		if (config.native) {
			if (config.expectedClassName === className) return key;
		} else if (config.defaultName === name && (className === '' || className === config.expectedClassName)) {
			return key;
		}
	}
	return null;
}

/**
 * What a browser preset tile draws: its device's control and the values the
 * file saves, or null when the device has no control or the file lacks the
 * values. A rack the app does not know is its first macro, named as the rack
 * names it.
 */
export function presetControl(saved: SavedPreset | null, name: string): { control: Control; values: Record<number, number> } | null {
	if (!saved) return null;
	const key = deviceKeyForPreset(saved.className, name);
	const entry = key ? DEVICE_CONTROLS[key] : undefined;
	if (entry) {
		if (!entry.fromPreset) return { control: entry.control, values: {} };
		const values = entry.fromPreset(saved);
		return values ? { control: entry.control, values } : null;
	}
	if (RACK_CLASSES.has(saved.className)) {
		const values = macroFromPreset(saved);
		return values ? { control: macroSlider(saved.labels?.['MacroDisplayNames.0'] || 'Macro 1'), values } : null;
	}
	return null;
}

/**
 * An instrument's control on its chain cell (2026-10-26): the pad its view
 * is known by, in each parameter's own range (the face reads and writes
 * through Live's min..max). The parameters are the views' own, read off the
 * running device when each view was built (the `*Params.ts` tables and the
 * views' constants): Operator's, Analog's, Wavetable's and Meld's filter,
 * Sampler's and Simpler's by name, Collision's first resonator, Electric's
 * hammer. `on` is the switch a gesture turns on first (a filter heard only
 * while on). An Instrument Rack is its first macro, named as the rack names
 * it. Omnisphere's ORB and Drift's filter are drawn by `InstrumentFace`.
 */
export interface InstrumentControl {
	kind: 'xy' | 'macro';
	title: string;
	/** A parameter by index, or by name (an index of -1 when only the name is known). */
	x: ParamRef;
	y?: ParamRef;
	/** Positions 0..1 shown before the device answers. */
	rest: [number, number];
	on?: ParamRef;
}

const byNameOnly = (name: string): ParamRef => ({ name, index: -1 });

export const INSTRUMENT_CONTROLS: Readonly<Record<string, InstrumentControl>> = {
	// OperatorCentralView: 165 'Filter On', 170 'Filter Freq', 171 'Filter Res'.
	operator: { kind: 'xy', title: 'Filter', x: { name: 'Filter Freq', index: 170 }, y: { name: 'Filter Res', index: 171 }, on: { name: 'Filter On', index: 165 }, rest: [1, 0] },
	// analogParams: 53 F1 On/Off, 57 F1 Freq, 59 F1 Resonance.
	analog: { kind: 'xy', title: 'Filter', x: 57, y: 59, on: 53, rest: [1, 0] },
	// WavetableCentralView FLT[1]: 21 on, 26 freq, 27 res.
	wavetable: { kind: 'xy', title: 'Filter', x: 26, y: 27, on: 21, rest: [1, 0] },
	// meldParams MELD_ENGINE.A: 13 filterOn, 15 freq, 16 q.
	meld: { kind: 'xy', title: 'Filter', x: 15, y: 16, on: 13, rest: [1, 0] },
	// SamplerCentralView: 'F On', 'Filter Freq', 'Filter Res' (Simpler alike).
	sampler: { kind: 'xy', title: 'Filter', x: byNameOnly('Filter Freq'), y: byNameOnly('Filter Res'), on: byNameOnly('F On'), rest: [1, 0] },
	simpler: { kind: 'xy', title: 'Filter', x: byNameOnly('Filter Freq'), y: byNameOnly('Filter Res'), on: byNameOnly('F On'), rest: [1, 0] },
	// CollisionCentralView: 41 Res 1 decay, 45 material.
	collision: { kind: 'xy', title: 'Res 1', x: 41, y: 45, rest: [0.5, 0.5] },
	// ElectricCentralView: 8 hammer stiffness, 16 noise.
	electric: { kind: 'xy', title: 'Hammer', x: 8, y: 16, rest: [0.5, 0.5] },
	// An Instrument Rack's first macro, parameters[1].
	'instrument-rack': { kind: 'macro', title: 'Macro 1', x: 1, rest: [0, 0] }
};
