// @vitest-environment node
/**
 * Live's categories from its index (`categoryScan.ts`; measured on the rig
 * 2026-10-31): Sounds and Drum Hits by the name of the folder an item sits
 * in, Instruments and the effects by each preset's device, Drums' kits as
 * every Drum Rack, over the User Library and the Packs only.
 */
import { describe, expect, it } from 'vitest';
import { categoryRoots, categoryStamp, scanCategories, scanPacks } from '$lib/server/places/categoryScan';
import type { PlaceFolder, PlaceItem } from '$lib/server/places/diskScan';
import type { IndexHandle } from '$lib/server/places/indexScan';
import { liveIndexFixture } from '../../../helpers/liveIndexFixture';

const PACKS = ['Users', 'me', 'Packs'];
const UL = ['Users', 'me', 'User Library'];

function library() {
	const f = liveIndexFixture();
	f.place([...UL], 'User Library', 1);
	f.place([...PACKS, 'Drum Booth'], 'Drum Booth', 0);
	f.place(['Users', 'me', 'Desktop'], 'Desktop', 2);
	f.vfolder(1, 'Bass', ['Bass', 'Basses', 'Synth Bass']);
	f.vfolder(1, 'Vintage', ['Synth Bass']);
	f.vfolder(3, 'Kick', ['Kick']);
	const h: IndexHandle = { db: f.db, file: ':memory:', schema: 12300 };
	return { f, h };
}

const scan = (h: IndexHandle) => scanCategories(h, { au: new Map(), colors: {} });

function items(node: PlaceFolder | undefined): PlaceItem[] {
	if (!node) return [];
	return [...node.presets, ...Object.values(node.folders).flatMap(items)];
}

describe('scanCategories', () => {
	it('puts a preset in a Sounds sub-folder by the name of the folder it sits in, as Live does', () => {
		const { f, h } = library();
		f.file([...PACKS, 'Drum Booth', 'Instruments', 'Basses'], 'Sub.adv', { device_id: 'device:ableton:instr:Operator' });
		f.file([...UL, 'Mine', 'Synth Bass'], 'Mine.adg', { device_id: 'device:ableton:instr:InstrumentGroupDevice' });
		// A sample in a Bass folder is no Sound; neither is a preset outside the roots.
		f.file([...UL, 'Bass'], 'loop.wav');
		f.file(['Users', 'me', 'Desktop', 'Bass'], 'Stray.adv', { device_id: 'device:ableton:instr:Operator' });
		const sounds = scan(h).trees.get('Sounds')!;
		expect(items(sounds.folders.Bass).map((i) => i.name).sort()).toEqual(['Mine', 'Sub']);
		// A pattern two sub-folders share puts the preset in both.
		expect(items(sounds.folders.Vintage).map((i) => i.name)).toEqual(['Mine']);
		// Under the sub-folder: the root, then the folders the item has inside it.
		const sub = sounds.folders.Bass.folders['Drum Booth'].folders.Instruments.folders.Basses.presets[0];
		expect(sub.path).toBe('Sounds/Bass/Drum Booth/Instruments/Basses/Sub.adv');
	});

	it('names the root each item lives in, for a load that names it', () => {
		const { f, h } = library();
		f.file([...PACKS, 'Drum Booth', 'Basses'], 'Sub.adv', { device_id: 'device:ableton:instr:Operator' });
		f.file([...UL, 'Basses'], 'Mine.adv', { device_id: 'device:ableton:instr:Operator' });
		const bass = items(scan(h).trees.get('Sounds')!.folders.Bass);
		const sub = bass.find((i) => i.name === 'Sub')!;
		expect(sub).toMatchObject({ source: 'pack:Drum Booth', placePath: '/Users/me/Packs/Drum Booth', fullPath: '/Users/me/Packs/Drum Booth/Basses/Sub.adv' });
		expect(bass.find((i) => i.name === 'Mine')).toMatchObject({ source: 'library', placePath: '/Users/me/User Library' });
	});

	it('gathers Drum Hits by folder name, samples included, and every Drum Rack as a kit', () => {
		const { f, h } = library();
		f.file([...PACKS, 'Drum Booth', 'Samples', 'Kick'], 'Kick 1.wav');
		f.file([...PACKS, 'Drum Booth', 'Kits'], 'Booth Kit.adg', { device_id: 'device:ableton:instr:DrumGroupDevice' });
		f.file([...PACKS, 'Drum Booth', 'Samples', 'Snare'], 'Snare 1.wav');
		const drums = scan(h).trees.get('Drums')!;
		expect(Object.keys(drums.folders).sort()).toEqual(['Kick', 'Kits']);
		expect(items(drums.folders.Kick).map((i) => [i.name, i.kind])).toEqual([['Kick 1', 'sample']]);
		expect(items(drums.folders.Kits).map((i) => i.name)).toEqual(['Booth Kit']);
	});

	it('groups instrument, effect and Max presets under their device, and clips by kind', () => {
		const { f, h } = library();
		f.file([...UL, 'Presets'], 'Bright.adv', { device_id: 'device:ableton:instr:Operator' });
		f.file([...UL, 'Presets'], 'Hall.adv', { device_id: 'device:ableton:audiofx:Reverb' });
		f.file([...UL, 'Presets'], 'Up.adv', { device_id: 'device:ableton:midifx:MidiArpeggiator' });
		f.file([...UL, 'Presets'], 'Wobble.amxd', { device_type: 2 });
		f.file([...UL, 'Clips'], 'Groove.alc', { subtype: 0x616c634d });
		const { trees } = scan(h);
		expect(Object.keys(trees.get('Instruments')!.folders)).toEqual(['Operator']);
		expect(Object.keys(trees.get('Audio Effects')!.folders)).toEqual(['Reverb']);
		expect(Object.keys(trees.get('MIDI Effects')!.folders)).toEqual(['Midi Arpeggiator']);
		expect(Object.keys(trees.get('Max for Live')!.folders)).toEqual(['Max Audio Effect']);
		expect(Object.keys(trees.get('Clips')!.folders)).toEqual(['MIDI Clips']);
	});

	it('shows a device bundle where it sits', () => {
		const { f, h } = library();
		f.file([...PACKS, 'Drum Booth', 'Devices', 'Wobble', 'Ableton Folder Info'], 'Wobble.amxd', { device_type: 2 });
		const max = scan(h).trees.get('Max for Live')!.folders['Max Audio Effect'];
		expect(items(max)[0]).toMatchObject({ path: 'Max for Live/Max Audio Effect/Drum Booth/Devices/Wobble/Wobble.amxd' });
		expect(items(max)[0].fullPath).toBe('/Users/me/Packs/Drum Booth/Devices/Wobble/Ableton Folder Info/Wobble.amxd');
	});
});

describe('scanPacks', () => {
	it('puts every installed Pack under one root, each holding its own folders and naming itself for the load', () => {
		const { f, h } = library();
		f.place([...PACKS, 'Voice Box'], 'Voice Box', 0);
		f.file([...PACKS, 'Drum Booth', 'Kits'], 'Booth Kit.adg', { device_id: 'device:ableton:instr:DrumGroupDevice' });
		f.file([...PACKS, 'Voice Box', 'Samples', 'Choir'], 'Aah.wav');
		// The User Library is no Pack.
		f.file([...UL, 'Mine'], 'Mine.adv', { device_id: 'device:ableton:instr:Operator' });
		const { tree } = scanPacks(h, { au: new Map(), colors: {} });
		expect(Object.keys(tree.folders).sort()).toEqual(['Drum Booth', 'Voice Box']);
		const kit = tree.folders['Drum Booth'].folders.Kits.presets[0];
		expect(kit).toMatchObject({ path: 'Packs/Drum Booth/Kits/Booth Kit.adg', source: 'pack:Drum Booth', placePath: '/Users/me/Packs/Drum Booth' });
		expect(tree.folders['Voice Box'].folders.Samples.path).toBe('Packs/Voice Box/Samples');
	});

	it("reads a device's folder (`dfld` in Live's index) as a folder, its presets included", () => {
		const { f, h } = library();
		f.file([...PACKS, 'Drum Booth', 'Instruments', 'Bass', 'Ableton Folder Info'], 'Bass.amxd', { device_type: 1 });
		f.file([...PACKS, 'Drum Booth', 'Instruments', 'Bass', 'Basses'], 'Sub.adv', { device_id: 'device:m4l:instr:pack@x/Bass.amxd' });
		const dfld = ((('d'.charCodeAt(0) << 24) | ('f'.charCodeAt(0) << 16) | ('l'.charCodeAt(0) << 8) | 'd'.charCodeAt(0)) >>> 0);
		f.db.prepare("UPDATE files SET file_type = ? WHERE name = 'Bass'").run(dfld);
		const bass = scanPacks(h, { au: new Map(), colors: {} }).tree.folders['Drum Booth'].folders.Instruments.folders.Bass;
		expect(bass.presets.map((p) => [p.name, p.kind])).toEqual([['Bass', 'max-instrument']]);
		expect(bass.folders.Basses.presets.map((p) => p.name)).toEqual(['Sub']);
	});
});

describe('categoryRoots and categoryStamp', () => {
	it('reads the User Library and the Packs, never a Place outside them', () => {
		const { h } = library();
		expect(categoryRoots(h).map((r) => [r.name, r.source, r.path])).toEqual([
			['User Library', 'library', '/Users/me/User Library'],
			['Drum Booth', 'pack:Drum Booth', '/Users/me/Packs/Drum Booth']
		]);
	});

	it('holds through a file written outside the roots and moves on one inside', () => {
		const { f, h } = library();
		f.file([...UL, 'Basses'], 'Mine.adv');
		const roots = categoryRoots(h);
		const before = categoryStamp(h, roots);
		// A take recorded into a project.
		f.file(['Users', 'me', 'Desktop', 'Project'], 'Take 1.wav');
		expect(categoryStamp(h, roots)).toBe(before);
		f.file([...PACKS, 'Drum Booth'], 'New.adg');
		expect(categoryStamp(h, roots)).not.toBe(before);
	});
});
