// @vitest-environment node
/**
 * Reading kinds out of Live's index rows the way the disk scan reads them out
 * of the files (live-index-measurements.md; measured on this Mac 2026-09-26).
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { auKeyOf, cardTags, deviceNameOf, indexRowsFingerprint, indexRowsOf, kindOfRow, scanIndexPlace, type IndexHandle } from '$lib/server/places/indexScan';

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

	it("reads a Max device's preset from its m4l device_id", () => {
		// Pitch Hack.adv's row in Live's database, 2026-10-26.
		const pitchHack = 'device:m4l:audiofx:pack@www.ableton.com/260:Audio%20Effects/Pitch%20Hack/Ableton%20Folder%20Info/Pitch%20Hack.amxd';
		expect(kindOfRow(row({ device_type: 2, device_id: pitchHack }), '.adv')).toBe('audio-effect');
		expect(kindOfRow(row({ device_id: 'device:m4l:midifx:abs@/x.amxd' }), '.adv')).toBe('midi-effect');
		expect(kindOfRow(row({ device_id: 'device:m4l:instr:abs@/x.amxd' }), '.adv')).toBe('instrument');
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
			CREATE TABLE ancestors (file_id INTEGER, ancestor_id INTEGER);
			CREATE TABLE metadata (file_id INTEGER, key INTEGER, value_id INTEGER);
			CREATE TABLE metadata_values (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT);`);
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

	it('moves when a tag file changes an item\'s tags, and reads them', () => {
		const { h, add } = index();
		add(2, 1, 'Pad.aupreset', true);
		const before = indexRowsFingerprint(indexRowsOf(h, 1));
		h.db.prepare("INSERT INTO metadata_values (id, value) VALUES (7, 'Mood|Dark')").run();
		h.db.prepare('INSERT INTO metadata VALUES (2, 1431004537, 7)').run();
		const rows = indexRowsOf(h, 1);
		expect(rows[0].tags).toBe('Mood|Dark');
		expect(indexRowsFingerprint(rows)).not.toBe(before);
	});
});

describe('cardTags', () => {
	it('keeps Character, Timbre, Mood, Genres and Keyword values, in that order, once each', () => {
		expect(cardTags('Mood|Dark\nSounds|Pad\nKeyword|Arp\nTimbre|Analog\nGenres|Ambient\nCharacter|Warm\nMood|Dark')).toEqual(['Warm', 'Analog', 'Dark', 'Ambient', 'Arp']);
		expect(cardTags('Sounds|Pad|Warm\nOmni Category|Pads')).toEqual([]);
		expect(cardTags(null)).toEqual([]);
	});
});

describe('deviceNameOf', () => {
	const names = new Map([['DrumGroupDevice', 'Drum Rack'], ['InstrumentVector', 'Wavetable']]);
	it("names a Live preset's device as Live's Built-in devices do, else by its class in words", () => {
		expect(deviceNameOf('device:ableton:instr:DrumGroupDevice', names)).toBe('Drum Rack');
		expect(deviceNameOf('device:ableton:instr:InstrumentVector', names)).toBe('Wavetable');
		// A legacy device with no Built-in entry.
		expect(deviceNameOf('device:ableton:audiofx:AutoFilter', names)).toBe('Auto Filter');
		expect(deviceNameOf('device:ableton:audiofx:Erosion2', names)).toBe('Erosion');
	});
	it("names a Max device's preset by its .amxd, and nothing for a plug-in", () => {
		const pitchHack = 'device:m4l:audiofx:pack@www.ableton.com/260:Audio%20Effects/Pitch%20Hack/Ableton%20Folder%20Info/Pitch%20Hack.amxd';
		expect(deviceNameOf(pitchHack, names)).toBe('Pitch Hack');
		expect(deviceNameOf('device:au:instr:1:2:3', names)).toBeUndefined();
		expect(deviceNameOf(null, names)).toBeUndefined();
	});
});

describe('scanIndexPlace: devices and borrowed tags', () => {
	// A Place (1) beside two Packs (10, 20) and Built-in (30), as Live's index lists them.
	function index(): IndexHandle {
		const db = new DatabaseSync(':memory:');
		db.exec(`CREATE TABLE files (file_id INTEGER, parent_id INTEGER, name TEXT, file_type INTEGER, subtype INTEGER, device_type INTEGER, device_id TEXT, mod_date INTEGER, file_size INTEGER);
			CREATE TABLE ancestors (file_id INTEGER, ancestor_id INTEGER);
			CREATE TABLE places (file_id INTEGER, folder_kind INTEGER, level INTEGER, name TEXT);
			CREATE TABLE metadata (file_id INTEGER, key INTEGER, value_id INTEGER);
			CREATE TABLE metadata_values (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT);
			INSERT INTO places VALUES (10, 0, 0, 'Pack A'), (20, 0, 0, 'Pack B'), (30, 8, 0, 'Built-in');`);
		let id = 100;
		const file = (under: number, name: string, deviceId: string | null, size: number, tags: string[] = []) => {
			const fid = id++;
			db.prepare('INSERT INTO files VALUES (?, ?, ?, 0, 0, 0, ?, 100, ?)').run(fid, under, name, deviceId, size);
			db.prepare('INSERT INTO ancestors VALUES (?, ?)').run(fid, under);
			for (const t of tags) {
				const v = db.prepare('INSERT INTO metadata_values (value) VALUES (?)').run(t).lastInsertRowid;
				db.prepare('INSERT INTO metadata VALUES (?, 1264941431, ?)').run(fid, v);
			}
		};
		file(30, 'Wavetable.adv', 'device:ableton:instr:InstrumentVector', 1);
		file(10, 'Glass Pad.adg', 'device:ableton:instr:InstrumentGroupDevice', 5000, ['Character|Bright', 'Sounds|Pad']);
		file(10, 'Split.adg', 'device:ableton:instr:InstrumentGroupDevice', 5000, ['Character|Dark']);
		file(20, 'Split.adg', 'device:ableton:instr:InstrumentGroupDevice', 6000, ['Character|Soft']);
		// The Place: a bare Wavetable saved out of the Glass Pad rack, and one whose name two Packs tag differently.
		file(1, 'Glass Pad.adv', 'device:ableton:instr:InstrumentVector', 900);
		file(1, 'Split.adv', 'device:ableton:instr:InstrumentVector', 900);
		return { db, file: ':memory:', schema: 12300 };
	}

	it("names the device as Live's Built-in does, borrows a rack's tags by name, and skips a name Packs disagree on", () => {
		const { tree } = scanIndexPlace(index(), 1, '/Place', 'Place', { au: new Map(), colors: {} });
		const byName = Object.fromEntries(tree.presets.map((p) => [p.name, p]));
		expect(byName['Glass Pad'].device).toBe('Wavetable');
		expect(byName['Glass Pad'].tags).toEqual(['Bright']);
		expect(byName['Split'].tags).toBeUndefined();
	});
});
