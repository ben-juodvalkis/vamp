// @vitest-environment node
/**
 * Reading kinds out of Live's index rows the way the disk scan reads them out
 * of the files (live-index-measurements.md; measured on this Mac 2026-09-26).
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { auKeyOf, indexRowsFingerprint, indexRowsOf, kindOfRow, type IndexHandle } from '$lib/server/places/indexScan';

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

describe('indexRowsFingerprint', () => {
	// Live writes its index every couple of seconds while it runs; a write
	// outside a Place must not look like a change to it (2026-09-29).
	function index(): { h: IndexHandle; add: (id: number, parent: number, name: string, place: boolean) => void } {
		const db = new DatabaseSync(':memory:');
		db.exec(`CREATE TABLE files (file_id INTEGER, parent_id INTEGER, name TEXT, file_type INTEGER, subtype INTEGER, device_type INTEGER, device_id TEXT, mod_date INTEGER, file_size INTEGER);
			CREATE TABLE ancestors (file_id INTEGER, ancestor_id INTEGER);`);
		const add = (id: number, parent: number, name: string, place: boolean) => {
			db.prepare('INSERT INTO files VALUES (?, ?, ?, 0, 0, 0, NULL, 100, 10)').run(id, parent, name);
			if (place) db.prepare('INSERT INTO ancestors VALUES (?, 1)').run(id);
		};
		return { h: { db, file: ':memory:', schema: 12300 }, add };
	}

	it('holds through a write outside the Place and moves on one inside it', () => {
		const { h, add } = index();
		add(2, 1, 'Kick.adg', true);
		add(3, 1, 'Snare.adg', true);
		const before = indexRowsFingerprint(indexRowsOf(h, 1));
		add(50, 40, 'Elsewhere.wav', false);
		expect(indexRowsFingerprint(indexRowsOf(h, 1))).toBe(before);
		h.db.prepare("UPDATE files SET mod_date = 101 WHERE name = 'Snare.adg'").run();
		const touched = indexRowsFingerprint(indexRowsOf(h, 1));
		expect(touched).not.toBe(before);
		add(4, 1, 'Clap.adg', true);
		expect(indexRowsFingerprint(indexRowsOf(h, 1))).not.toBe(touched);
	});
});
