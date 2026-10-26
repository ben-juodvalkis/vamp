import { describe, expect, it } from 'vitest';
import { presetFace } from '$lib/components/v6/browser/presetFaces';

/**
 * Each case is one preset loaded onto a track in the running Live (2026-10-25)
 * and removed: `saved` is what its file holds, `live` what Live reported for
 * the same parameters once it was loaded. Generated from those measurements.
 */
const CASES: Array<{ name: string; preset: string; className: string; params: Record<string, number>; labels: Record<string, string>; live: Record<number, number>; tol: Record<number, number> }> = [
	{ name: "Echo", preset: "A Bit Tipsy", className: "Echo", params: {"On": 1, "Delay_SyncL": 1, "Delay_TimeL": 0.3749999702, "Delay_SyncedDivisionL": -3.0, "Delay_SyncedSixteenthL": 3.0, "Delay_SyncModeL": 2.0, "Delay_OffsetL": 0.0, "Delay_TimeR": 0.3749999702, "Delay_SyncR": 1, "Delay_SyncedDivisionR": -3.0, "Delay_SyncedSixteenthR": 3.0, "Delay_SyncModeR": 2.0, "Delay_OffsetR": 0.0, "Delay_TimeLink": 0, "Delay_Repitch": 1, "Delay_RepitchSmoothingTime": 0.400000006, "Feedback": 0.6071428657, "FeedbackInvert": 0, "ChannelMode": 0.0, "InputGain": 0.0, "OutputGain": 1.0, "Clipper_Dry": 0, "Gate_On": 0, "Gate_Threshold": 0.0, "Gate_Release": 0.04999926314, "Ducking_On": 0, "Ducking_Threshold": 0.0, "Ducking_Release": 0.09999851137, "Filter_On": 1, "Filter_HighPassFrequency": 91.1631622, "Filter_HighPassResonance": 0.1659574509, "Filter_LowPassFrequency": 9367.44824, "Filter_LowPassResonance": 0.2425532043, "Modulation_Waveform": 5.0, "Modulation_Frequency": 1.99999928, "Modulation_Sync": 0, "Modulation_SyncedRate": 3.0, "Modulation_PhaseOffset": 180.0, "Modulation_EnvelopeMix": 0.7265625, "Modulation_AmountDelay": 0.03125, "Modulation_AmountFilter": 0.7578125, "Modulation_AmountDelayTimesFour": 0, "Reverb_Level": 0.6507936716, "Reverb_Decay": 0.7109375, "Reverb_Location": 1.0, "Noise_On": 1, "Noise_Amount": 0.1484375, "Noise_Type": 0.7890625, "Wobble_On": 1, "Wobble_Amount": 0.4296875, "Wobble_Type": 0.984375, "StereoWidth": 1.46031749, "DryWet": 0.4047619104}, labels: {}, live: {"1": 1, "2": 0.5653063654899597, "4": 3, "16": 0.4047619104385376, "52": 0.4047619104385376}, tol: {"2": 0.01} },
	{ name: "AutoPan", preset: "1to4 Note Contenders (Legacy)", className: "AutoPan", params: {"On": 1, "Type": 0.0, "Frequency": 1.00000024, "RateType": 1.0, "BeatRate": 9.0, "StereoMode": 0.0, "Spin": 0.0, "Phase": 180.0, "Offset": 0.0, "IsOn": 1, "Quantize": 0, "BeatQuantize": 2.0, "NoiseWidth": 0.5, "LfoAmount": 0.6377950907, "LfoInvert": 0, "LfoShape": 1.0}, labels: {}, live: {"1": 1, "2": 0.637795090675354, "3": 0.3996685743331909, "4": 9, "12": 0}, tol: {"3": 0.001} },
	{ name: "Hybrid", preset: "Car Garage", className: "Hybrid", params: {"On": 1, "PreDelay_Sync": 0, "PreDelay_Time": 0.01000000164, "PreDelay_Sixteenth": 2.0, "PreDelay_FeedbackTime": 0.0, "PreDelay_FeedbackSixteenth": 0.0, "Algorithm_Type": 0.0, "Algorithm_Delay": 0.0, "Algorithm_Freeze": 0, "Algorithm_FreezeIn": 0, "Algorithm_Decay": 0.5136002302, "Algorithm_Size": 0.380952388, "Algorithm_Damping": 1.0, "Algorithm_Diffusion": 1.0, "Algorithm_Modulation": 0.5, "Algorithm_Shape": 0.5, "Algorithm_BassMultiplier": 1.0, "Algorithm_BassCrossover": 440.0, "Algorithm_Shimmer": 0.5, "Algorithm_PitchShift": 12.0, "Algorithm_TidesAmount": 0.4920634925, "Algorithm_TidesRate": 12.0, "Algorithm_TidesWaveform": 0.578125, "Algorithm_TidesPhaseOffset": 90.0, "Algorithm_Quartz_LowDamping": 0.396825403, "Algorithm_Quartz_Distance": 0.206349209, "Algorithm_Prism_HighMultiplier": 1.0, "Algorithm_Prism_LowMultiplier": 0.1407092959, "Algorithm_Prism_CrossoverFrequency": 799.999939, "Algorithm_Prism_Sixth": 0.0, "Algorithm_Prism_Seventh": 0.0, "Eq_On": 1, "Eq_PreAlgo": 0, "Eq_LowBandType": 1.0, "Eq_LowBandFrequency": 81.6426239, "Eq_LowBandGain": 0.3927959204, "Eq_LowBandSlope": 1.0, "Eq_Peak1Frequency": 285.937958, "Eq_Peak1Gain": 0.9897836447, "Eq_Peak1Q": 0.7071067691, "Eq_Peak2Frequency": 1607.94775, "Eq_Peak2Gain": 1.65396178, "Eq_Peak2Q": 0.7071067691, "Eq_HighBandType": 1.0, "Eq_HighBandFrequency": 5000.0, "Eq_HighBandGain": 1.0, "Eq_HighBandSlope": 4.0, "Send": 1.0, "Routing": 1.0, "ConvoAlgoBlend": 0.2619047761, "Vintage": 2.0, "StereoWidth": 0.8412698507, "BassMono": 0, "DryWet": 1.0}, labels: {}, live: {"10": 0.1666666716337204, "53": 1}, tol: {"10": 0.01} },
	{ name: "ChannelEq", preset: "Boom Capture", className: "ChannelEq", params: {"On": 1, "HighpassOn": 0, "LowShelfGain": 4.15796185, "MidGain": 0.5138325095, "MidFrequency": 119.999985, "HighShelfGain": 0.535472393, "Gain": 1.05609536}, labels: {}, live: {"2": 0.9133858680725098, "3": 0.25984251499176025, "4": 0, "5": 0.3171408772468567}, tol: {"2": 0.003, "3": 0.003, "5": 0.003, "4": 0.001} },
	{ name: "Chorus2", preset: "Chorus Bass", className: "Chorus2", params: {"On": 1, "Mode": 0.0, "Shaping": 0.0, "Rate": 0.6585194468, "Amount": 0.6499999762, "Feedback": 0.0, "InvertFeedback": 0, "VibratoOffset": 0.0, "ChorusDelayTime": 1.0, "ChorusTapCount": 0.0, "HighpassEnabled": 1, "HighpassFrequency": 100.0, "Width": 1.0, "Warmth": 0.1047961935, "OutputGain": 1.25892854, "DryWet": 0.6000000238}, labels: {}, live: {"3": 0.3730158805847168, "15": 0.6000000238418579}, tol: {"3": 0.01} },
	{ name: "DrumBuss", preset: "Bonzo on the Dials", className: "DrumBuss", params: {"On": 1, "EnableCompression": 1, "DriveAmount": 0.3888888955, "DriveType": 1.0, "CrunchAmount": 0.5, "DampingFrequency": 20000.0, "TransientShaping": 0.0, "BoomFrequency": 48.9994278, "BoomAmount": 0.0, "BoomDecay": 1.0, "BoomAudition": 0, "InputTrim": 1.0, "OutputGain": 0.5529673696, "DryWet": 1.0}, labels: {}, live: {"6": 0, "13": 1}, tol: {} },
	{ name: "Saturator", preset: "808 Shaper", className: "Saturator", params: {"On": 1, "PreDrive": 0.0, "PreDcFilter": 0, "Type": 2.0, "ColorOn": 1, "BaseDrive": 5.39999962, "ColorFrequency": 1000.0, "ColorWidth": 0.3000000119, "ColorDepth": 0.0, "PostClip": 0.0, "PostDrive": 0.0, "DryWet": 1.0, "BassShaperThreshold": -50.0, "WsDrive": 1.0, "WsLin": 0.5, "WsCurve": 0.05000000075, "WsDamp": 0.0, "WsPeriod": 0.0, "WsDepth": 0.0}, labels: {}, live: {"1": 0.5, "10": 1, "11": 1}, tol: {} },
	{ name: "GlueCompressor", preset: "Bass - Low Extender", className: "GlueCompressor", params: {"On": 1, "Threshold": -21.9047623, "Range": 25.0, "Makeup": 5.0, "Attack": 5.0, "Ratio": 1.0, "Release": 0.0, "DryWet": 1.0, "PeakClipIn": 1, "OnOff": 0, "Volume": 1.0, "Mode": 5.0, "Freq": 200.0, "Q": 0.7071067691, "Gain": 0.0}, labels: {}, live: {"1": -21.904762268066406, "3": 5}, tol: {} },
	{ name: "StereoGain", preset: "Bass Mono", className: "StereoGain", params: {"On": 1, "PhaseInvertL": 0, "PhaseInvertR": 0, "ChannelMode": 1.0, "StereoWidth": 1.0, "MidSideBalance": 1.0, "Mono": 0, "BassMono": 1, "BassMonoFrequency": 120.0, "Balance": 0.0, "Gain": 1.0, "LegacyGain": 0.0, "Mute": 0, "DcFilter": 0}, labels: {}, live: {"9": 0}, tol: {"9": 0.01} },
	{ name: "BeatRepeat", preset: "Airpusher", className: "BeatRepeat", params: {"On": 1, "Chance": 0.700787425, "Interval": 2.0, "Offset": 0.0, "Grid": 7.0, "BlockTripplets": 1, "GridChance": 3.0, "GridChanceType": 2.0, "Gate": 8.0, "DampVolume": 0.0, "DampPitch": 0.6377952695, "BasePitch": 12.0, "MixType": 1.0, "WetLevel": 1.0, "FilterOn": 1, "MidFreq": 3864.98828, "BandWidth": 4.484375, "InstantRepeat": 0}, labels: {}, live: {"1": 0.7007874250411987}, tol: {} },
	{ name: "MidiRandom", preset: "Blue", className: "MidiRandom", params: {"On": 1, "Chance": 0.1031746045, "Choices": 1.0, "Scale": 1.0, "Sign": 0.0, "Alternate": 0, "UseCurrentScale": 0}, labels: {}, live: {"1": 0.1031746044754982}, tol: {} },
	{ name: "Pedal", preset: "Pedal", className: "Pedal", params: {"On": 1, "Type": 0, "Gain": 0, "Output": 0, "Bass": 0, "Mid": 0, "Treble": 0, "MidFreq": 1, "Sub": 0, "DryWet": 1}, labels: {}, live: {"2": 0}, tol: {} },
	{ name: "Gate", preset: "Gate", className: "Gate", params: {"On": 1, "Threshold": 0.0003162277571, "Attack": 3.5, "Hold": 10, "Release": 15, "Return": 3, "Gain": -40}, labels: {}, live: {"1": 0, "4": 0.4860469698905945}, tol: {"4": 0.001} },
	{ name: "GuitarRack", preset: "Guitar", className: "AudioEffectGroupDevice", params: {"MacroControls.0": 0.0, "MacroControls.1": 20.0, "MacroControls.2": 87.2762375}, labels: {"MacroDisplayNames.0": "Gain"}, live: {"1": 0}, tol: {} },
];

describe('preset faces start where Live puts the loaded preset', () => {
	for (const c of CASES) {
		it(`${c.name}: ${c.preset}`, () => {
			const got = presetFace({ className: c.className, params: c.params, labels: c.labels });
			expect(got).not.toBeNull();
			for (const [index, live] of Object.entries(c.live)) {
				const tol = c.tol[Number(index)] ?? 1e-6;
				expect(Math.abs((got!.values[Number(index)] ?? NaN) - live), `parameter ${index}`).toBeLessThanOrEqual(tol);
			}
		});
	}

	it('names a rack face after its first macro', () => {
		const rack = CASES.find((c) => c.className === 'AudioEffectGroupDevice')!;
		const got = presetFace({ className: rack.className, params: rack.params, labels: rack.labels });
		expect(got?.face.kind).toBe('slider');
		expect(got?.face.kind === 'slider' && got.face.title).toBe('Gain');
	});

	it('draws nothing for a class with no face, or a file missing the values', () => {
		expect(presetFace({ className: 'Roar', params: {} })).toBeNull();
		expect(presetFace({ className: 'Echo', params: {} })).toBeNull();
	});
});
