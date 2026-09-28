// @vitest-environment node
/**
 * Reading kinds out of Live's index rows the way the disk scan reads them out
 * of the files (live-index-measurements.md; measured on this Mac 2026-09-26).
 */
import { describe, expect, it } from 'vitest';
import { auKeyOf, kindOfRow } from '$lib/server/places/indexScan';

const four = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
const row = (over: Partial<{ name: string; file_type: number; subtype: number; device_type: number; device_id: string | null }>) => ({
	name: 'x',
	file_type: 0,
	subtype: 0,
	device_type: 0,
	device_id: null,
	...over
});

describe('kindOfRow', () => {
	it('reads racks and devices from device_id', () => {
		expect(kindOfRow(row({ device_id: 'device:ableton:instr:DrumGroupDevice' }), '.adg')).toBe('drum-rack');
		expect(kindOfRow(row({ device_id: 'device:ableton:instr:InstrumentGroupDevice' }), '.adg')).toBe('instrument-rack');
		expect(kindOfRow(row({ device_id: 'device:ableton:audiofx:AudioEffectGroupDevice' }), '.adg')).toBe('effect-rack');
		expect(kindOfRow(row({ device_id: 'device:ableton:midifx:MidiEffectGroupDevice' }), '.adg')).toBe('midi-effect-rack');
		expect(kindOfRow(row({ device_id: 'device:ableton:instr:Operator' }), '.adv')).toBe('instrument');
		expect(kindOfRow(row({ device_id: 'device:ableton:instr:MultiSampler' }), '.adv')).toBe('instrument');
		expect(kindOfRow(row({ device_id: 'device:ableton:audiofx:Reverb' }), '.adv')).toBe('audio-effect');
		expect(kindOfRow(row({ device_id: 'device:ableton:midifx:MidiArpeggiator' }), '.adv')).toBe('midi-effect');
		expect(kindOfRow(row({}), '.adg')).toBe('unknown');
	});

	it('reads Max devices from device_type, plug-in presets from the au domain, clips from the subtype', () => {
		expect(kindOfRow(row({ device_type: 1 }), '.amxd')).toBe('max-instrument');
		expect(kindOfRow(row({ device_type: 2 }), '.amxd')).toBe('max-audio-effect');
		expect(kindOfRow(row({ device_type: 4 }), '.amxd')).toBe('max-midi-effect');
		expect(kindOfRow(row({ device_id: 'device:au:instr:1196381015:1097687666:1635085685' }), '.aupreset')).toBe('plugin-instrument');
		expect(kindOfRow(row({ device_id: 'device:au:audiofx:1:2:3' }), '.aupreset')).toBe('plugin-effect');
		expect(kindOfRow(row({ subtype: four('alcA') }), '.alc')).toBe('audio-clip');
		expect(kindOfRow(row({ subtype: four('alcM') }), '.alc')).toBe('midi-clip');
		expect(kindOfRow(row({ subtype: 0 }), '.alc')).toBe('clip');
		expect(kindOfRow(row({}), '.wav')).toBe('sample');
	});
});

describe('auKeyOf', () => {
	it('turns the index triple into the components map key, type|subtype|manufacturer', () => {
		// 1196381015 = 'GOSW' (Spectrasonics), 1097687666 = 'Ambr' (Omnisphere), 1635085685 = 'aumu'
		expect(auKeyOf('device:au:instr:1196381015:1097687666:1635085685?pre')).toBe('aumu|Ambr|GOSW');
		expect(auKeyOf('device:ableton:instr:Operator')).toBeNull();
		expect(auKeyOf(null)).toBeNull();
	});
});
