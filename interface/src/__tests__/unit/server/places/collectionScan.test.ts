// @vitest-environment node
/**
 * Live's Collections from its index (`collectionScan.ts`; measured on the rig
 * 2026-10-31): `files.colors` bit N marks Collection N's members; each
 * member names the root it lives in, a Live effect its class, and what no
 * load can name yet is left out and counted.
 */
import { describe, expect, it } from 'vitest';
import { collectionRoots, collectionStamp, scanCollection } from '$lib/server/places/collectionScan';
import type { PlaceFolder, PlaceItem } from '$lib/server/places/diskScan';
import type { IndexHandle } from '$lib/server/places/indexScan';
import { liveIndexFixture } from '../../../helpers/liveIndexFixture';

const PACKS = ['Users', 'me', 'Packs'];
const UL = ['Users', 'me', 'User Library'];
const DESK = ['Users', 'me', 'Desktop'];
const BUILTIN = ['Applications', 'Live.app', 'Builtin'];

function library() {
	const f = liveIndexFixture();
	f.place([...UL], 'User Library', 1);
	f.place([...PACKS, 'Drum Booth'], 'Drum Booth', 0);
	f.place([...DESK], 'Desktop', 2);
	f.place([...BUILTIN], 'Built-in', 8);
	const h: IndexHandle = { db: f.db, file: ':memory:', schema: 12300 };
	const roots = collectionRoots(h, [{ name: 'My Desk', path: '/Users/me/Desktop' }]);
	return { f, h, roots };
}

const scan = (h: IndexHandle, roots: ReturnType<typeof collectionRoots>, n = 6) => scanCollection(h, n, 'FX', { au: new Map(), colors: {} }, roots);

function items(node: PlaceFolder): PlaceItem[] {
	return [...node.presets, ...Object.values(node.folders).flatMap(items)];
}

describe('scanCollection', () => {
	it('lists the members of its own Collection only, each naming its root', () => {
		const { f, h, roots } = library();
		f.collect(f.file([...PACKS, 'Drum Booth', 'FX'], 'Crush.adv', { device_id: 'device:ableton:audiofx:Redux2' }), 6);
		f.collect(f.file([...UL, 'Mine'], 'Wide.adg', { device_id: 'device:ableton:audiofx:AudioEffectGroupDevice' }), 6);
		f.collect(f.file([...DESK], 'take.wav'), 6);
		f.collect(f.file([...UL, 'Mine'], 'Other.adv', { device_id: 'device:ableton:audiofx:Redux2' }), 2);
		const { tree } = scan(h, roots);
		expect(tree.presets.map((p) => p.name).sort()).toEqual(['Crush', 'Wide', 'take']);
		expect(tree.presets.find((p) => p.name === 'Crush')).toMatchObject({
			source: 'pack:Drum Booth',
			placePath: '/Users/me/Packs/Drum Booth',
			fullPath: '/Users/me/Packs/Drum Booth/FX/Crush.adv',
			path: 'FX/Crush.adv'
		});
		expect(tree.presets.find((p) => p.name === 'Wide')).toMatchObject({ source: 'library', placePath: '/Users/me/User Library' });
		// An outside Place loads by the name Live's sidebar gives it.
		expect(tree.presets.find((p) => p.name === 'take')).toMatchObject({ source: 'place:My Desk', placePath: '/Users/me/Desktop' });
	});

	it('makes a tagged folder or Pack a folder of everything in it', () => {
		const { f, h, roots } = library();
		f.file([...UL, 'Racks', 'Deep'], 'A.adg', { device_id: 'device:ableton:audiofx:AudioEffectGroupDevice' });
		f.collect(f.folder([...UL, 'Racks']), 6);
		f.file([...PACKS, 'Drum Booth', 'Kits'], 'Kit.adg', { device_id: 'device:ableton:instr:DrumGroupDevice' });
		f.collect(f.folder([...PACKS, 'Drum Booth']), 6);
		const { tree } = scan(h, roots);
		expect(Object.keys(tree.folders).sort()).toEqual(['Drum Booth', 'Racks']);
		expect(items(tree.folders.Racks)[0]).toMatchObject({ name: 'A', source: 'library', path: 'FX/Racks/Deep/A.adg' });
		expect(items(tree.folders['Drum Booth'])[0]).toMatchObject({ name: 'Kit', source: 'pack:Drum Booth', placePath: '/Users/me/Packs/Drum Booth' });
	});

	it('loads a Live device by its class and name, once, and leaves out plug-ins and stale copies', () => {
		const { f, h, roots } = library();
		f.collect(f.row([...BUILTIN, 'Audio Effects'], 'EQ Eight', 'dfld', 'device:ableton:audiofx:Eq8'), 6);
		f.collect(f.row([...BUILTIN, 'MIDI Effects'], 'Arpeggiator', 'dfld', 'device:ableton:midifx:MidiArpeggiator'), 6);
		f.collect(f.row([...BUILTIN, 'Instruments'], 'Operator', 'dfld', 'device:ableton:instr:Operator'), 6);
		f.collect(f.row(['Applications', 'Old Live.app', 'Builtin'], 'EQ Eight', 'dfld', 'device:ableton:audiofx:Eq8'), 6);
		f.collect(f.row(['Plug-ins', 'AU'], 'Pro-Q 3', 'plug', 'device:au:audiofx:1:2:3'), 6);
		const r = scan(h, roots);
		expect(r.tree.presets).toEqual([
			expect.objectContaining({ name: 'Arpeggiator', kind: 'midi-effect', fullPath: 'native:MidiArpeggiator', source: 'native:MidiArpeggiator' }),
			expect.objectContaining({ name: 'EQ Eight', kind: 'audio-effect', fullPath: 'native:Eq8', source: 'native:Eq8' }),
			expect.objectContaining({ name: 'Operator', kind: 'instrument', fullPath: 'native:Operator', source: 'native:Operator' })
		]);
		expect(r.skipped).toEqual({ plugins: 1, other: 0 });
	});

	it('stamps the tags: tagging a file moves the stamp', () => {
		const { f, h } = library();
		const id = f.file([...UL], 'A.adv', { device_id: 'device:ableton:audiofx:Redux2' });
		const before = collectionStamp(h);
		f.collect(id, 3);
		expect(collectionStamp(h)).not.toBe(before);
	});
});
