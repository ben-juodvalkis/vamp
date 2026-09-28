import { describe, expect, it } from 'vitest';
// The Places catalog builder lives outside interface/ (repo-root scripts/);
// importing it is side-effect-free — main() runs only under direct invocation.
import {
	aliasMapFrom,
	applyAlias,
	auIdentity,
	collapseSingleChains,
	fourCC,
	liveDeviceKind,
	maxDeviceKind,
	placesUnder,
	shapePlace,
	tintFor,
	type PlaceFolder,
	type PlaceItem
} from '$lib/server/places/diskScan';
import { libraryPlaces } from '$lib/server/libraryCfg';
import { categoryForFolderName } from '$lib/utils/presetPath';
import { groupCounts, groupOfKind, isSampleLike, loadsAsInstrument } from '$lib/utils/placeKinds';

const SIDEBAR = '/Lib/Looping Presets/Instruments/Sidebar';

describe('Library.cfg Places', () => {
	const xml = `<UserFolderInfoList>
		<UserFolderInfo Id="1" Path="/Users/me/Desktop" DisplayName="Desktop" IconName="" />
		<UserFolderInfo Id="2" Path="${SIDEBAR}/Drum" DisplayName="Drum" IconName="Sidebar/Sidebar_Drums" />
		<UserFolderInfo Id="3" Path="${SIDEBAR}/Keys &amp; Pads" DisplayName="Keys &amp; Pads" IconName="" />
		<UserFolderInfo Id="4" Path="${SIDEBAR}/Perc" IconName="Sidebar/Sidebar_Clap" />
	</UserFolderInfoList>`;

	it('reads every Place in sidebar order, with its name and icon', () => {
		expect(libraryPlaces(xml)).toEqual([
			{ path: '/Users/me/Desktop', name: 'Desktop', icon: '' },
			{ path: `${SIDEBAR}/Drum`, name: 'Drum', icon: 'Sidebar/Sidebar_Drums' },
			{ path: `${SIDEBAR}/Keys & Pads`, name: 'Keys & Pads', icon: '' },
			// No DisplayName: the folder's own name.
			{ path: `${SIDEBAR}/Perc`, name: 'Perc', icon: 'Sidebar/Sidebar_Clap' }
		]);
	});

	it('keeps only the Places under the Sidebar root, in that order, with slug ids', () => {
		const places = placesUnder(SIDEBAR, libraryPlaces(xml), () => []);
		expect(places.map((p) => [p.id, p.name])).toEqual([
			['drum', 'Drum'],
			['keys-pads', 'Keys & Pads'],
			['perc', 'Perc']
		]);
	});

	it('falls back to the root’s folders, A→Z, when Library.cfg cannot be read', () => {
		const places = placesUnder(SIDEBAR, null, () => ['Synth', 'bass', 'Drum']);
		expect(places.map((p) => p.name)).toEqual(['bass', 'Drum', 'Synth']);
		expect(places[0].path).toBe(`${SIDEBAR}/bass`);
	});

	it('numbers a clashing id', () => {
		const clash = [
			{ path: `${SIDEBAR}/A/Drum`, name: 'Drum', icon: '' },
			{ path: `${SIDEBAR}/B/Drum`, name: 'Drum', icon: '' }
		];
		expect(placesUnder(SIDEBAR, clash, () => []).map((p) => p.id)).toEqual(['drum', 'drum-2']);
	});

	it('reads a Place’s role from its name', () => {
		expect(categoryForFolderName('Drum')).toBe('drum');
		expect(categoryForFolderName('Keys')).toBe('key');
		expect(categoryForFolderName('Found Sounds')).toBeNull();
	});
});

describe('reading kinds', () => {
	it('turns AU codes into their four characters', () => {
		expect(fourCC(1635085685)).toBe('aumu');
		expect(fourCC(1097687666)).toBe('Ambr');
		expect(fourCC(1196381015)).toBe('GOSW');
		expect(fourCC(760105261)).toBe('-NI-');
	});

	it('finds the AU identity and patch name in a plist slice, or says the slice lacks it', () => {
		const tail = `<key>manufacturer</key> <integer>1196381015</integer> <key>name</key> <string>Noisy VHS &amp; Tapes</string>
			<key>subtype</key> <integer>1097687666</integer> <key>type</key> <integer>1635085685</integer>`;
		expect(auIdentity(tail)).toEqual({ type: 'aumu', subtype: 'Ambr', manufacturer: 'GOSW', name: 'Noisy VHS & Tapes' });
		expect(auIdentity('<key>data</key><data>AAAA</data>')).toBeNull();
	});

	it('reads a rack’s kind from its first device, and a device preset’s from its class', () => {
		const rack = (cls: string) => `<Ableton MinorVersion="12.0"><GroupDevicePreset><Device>\n<${cls} Id="0">`;
		expect(liveDeviceKind(rack('DrumGroupDevice'), '.adg')).toBe('drum-rack');
		expect(liveDeviceKind(rack('InstrumentGroupDevice'), '.adg')).toBe('instrument-rack');
		expect(liveDeviceKind(rack('AudioEffectGroupDevice'), '.adg')).toBe('effect-rack');
		expect(liveDeviceKind(rack('MidiEffectGroupDevice'), '.adg')).toBe('midi-effect-rack');
		const device = (cls: string) => `<Ableton MinorVersion="12.0">\n\t<${cls} Id="0">`;
		expect(liveDeviceKind(device('MultiSampler'), '.adv')).toBe('instrument');
		expect(liveDeviceKind(device('Drift'), '.adv')).toBe('instrument');
		expect(liveDeviceKind(device('MidiArpeggiator'), '.adv')).toBe('midi-effect');
		expect(liveDeviceKind(device('Reverb'), '.adv')).toBe('audio-effect');
	});

	it('reads a Max device’s type from its header', () => {
		const header = (code: string) => Buffer.concat([Buffer.from('ampf'), Buffer.alloc(4), Buffer.from(code)]);
		expect(maxDeviceKind(header('iiii'))).toBe('max-instrument');
		expect(maxDeviceKind(header('aaaa'))).toBe('max-audio-effect');
		expect(maxDeviceKind(header('mmmm'))).toBe('max-midi-effect');
		expect(maxDeviceKind(Buffer.from('nope, not a max device'))).toBe('unknown');
	});

	it('colors a tile by what the file is', () => {
		const colors = { Omni: 'omni', NI: 'ni', Ableton: 'ableton', Audio: 'audio' };
		expect(tintFor({ type: '.aupreset', kind: 'plugin-instrument', maker: 'Spectrasonics' }, colors)).toBe('omni');
		expect(tintFor({ type: '.aupreset', kind: 'plugin-instrument', maker: 'Native Instruments' }, colors)).toBe('ni');
		expect(tintFor({ type: '.aupreset', kind: 'unknown' }, colors)).toBeUndefined();
		expect(tintFor({ type: '.adg', kind: 'drum-rack' }, colors)).toBe('ableton');
		expect(tintFor({ type: '.wav', kind: 'sample' }, colors)).toBe('audio');
		expect(tintFor({ type: '.alc', kind: 'audio-clip' }, colors)).toBe('audio');
	});
});

describe('kind groups (the header chips)', () => {
	it('files every kind under one chip, and says what loads as an instrument', () => {
		expect(groupOfKind('drum-rack')).toBe('kits');
		expect(groupOfKind('plugin-instrument')).toBe('instruments');
		expect(groupOfKind('sample')).toBe('samples');
		expect(groupOfKind('clip')).toBe('clips');
		expect(groupOfKind('plugin-effect')).toBe('effects');
		expect(groupOfKind('unknown')).toBeNull();
		expect(loadsAsInstrument('drum-rack')).toBe(true);
		expect(loadsAsInstrument('audio-effect')).toBe(false);
		expect(isSampleLike('audio-clip')).toBe(true);
		// A MIDI clip has no audio: its own group, so only the switch's Clip segment lists it.
		expect(groupOfKind('midi-clip')).toBe('midi-clips');
		expect(isSampleLike('midi-clip')).toBe(false);
		expect(groupCounts({ 'drum-rack': 3, 'instrument-rack': 2, instrument: 1, sample: 9 })).toEqual({ kits: 3, instruments: 3, samples: 9 });
	});
});

describe('shaping a Place like the type catalogs', () => {
	const item = (name: string, rel: string, kind: PlaceItem['kind'] = 'plugin-instrument', vendorColor = 'omni'): PlaceItem => ({
		name, path: `${rel}/${name}.x`, fullPath: `/${rel}/${name}.x`, type: '.aupreset', variants: [`${name}.x`], kind, vendorColor
	});
	const folder = (name: string, rel: string, folders: Record<string, PlaceFolder> = {}, presets: PlaceItem[] = []): PlaceFolder => ({
		name, path: rel, folders, presets, vendorColor: null
	});

	it('collapses a single-folder chain, keeping the outer name', () => {
		const tree = folder('Pads', 'Key/Pads', { Only: folder('Only', 'Key/Pads/Only', {}, [item('A', 'Key/Pads/Only')]) });
		const out = collapseSingleChains(tree);
		expect(out.name).toBe('Pads');
		expect(Object.keys(out.folders)).toEqual([]);
		expect(out.presets.map((p) => p.name)).toEqual(['A']);
	});

	it('caps depth, keeps Samples nested, sorts A→Z and counts kinds per folder', () => {
		const deep = folder('Deep', 'Key/Pads/Deep', { Deeper: folder('Deeper', 'Key/Pads/Deep/Deeper', {}, [item('Z', 'Key/Pads/Deep/Deeper')]) }, [item('b', 'Key/Pads/Deep')]);
		const pads = folder('Pads', 'Key/Pads', { Deep: deep, Other: folder('Other', 'Key/Pads/Other', {}, [item('c', 'Key/Pads/Other')]) });
		const s3 = folder('C', 'Key/Samples/A/B/C', {}, [item('hit', 'Key/Samples/A/B/C', 'sample', 'audio')]);
		const samples = folder('Samples', 'Key/Samples', {
			A: folder('A', 'Key/Samples/A', { B: folder('B', 'Key/Samples/A/B', { C: s3, D: folder('D', 'Key/Samples/A/B/D', {}, [item('x', 'Key/Samples/A/B/D', 'sample', 'audio')]) }) }),
			E: folder('E', 'Key/Samples/E', {}, [item('y', 'Key/Samples/E', 'sample', 'audio')])
		});
		const raw = folder('Key', 'Key', { Samples: samples, Pads: pads }, [item('root', 'Key', 'instrument', 'ableton')]);
		const shaped = shapePlace(raw, { maxFolderDepth: 2, flattenFolders: [], keepNestingFolders: [] });

		expect(Object.keys(shaped.folders)).toEqual(['Pads', 'Samples']);
		// Pads/Deep is at the cap: it keeps its presets and absorbs Deeper's.
		expect(Object.keys(shaped.folders.Pads.folders.Deep.folders)).toEqual([]);
		expect(shaped.folders.Pads.folders.Deep.presets.map((p) => p.name)).toEqual(['b', 'Z']);
		// Samples keeps its nesting past the cap: A (a one-folder chain, collapsed
		// onto B's contents as the type catalogs did) still holds C and D, three levels down.
		expect(Object.keys(shaped.folders.Samples.folders.A.folders)).toEqual(['C', 'D']);
		expect(shaped.folders.Samples.folders.A.folders.C.presets.map((p) => p.name)).toEqual(['hit']);
		expect(shaped.kinds).toEqual({ instrument: 1, 'plugin-instrument': 3, sample: 3 });
		expect(shaped.folders.Pads.vendorColor).toBe('omni');
		expect(shaped.vendorColor).toBeNull();
	});

	it('keeps the same copy of a flattened duplicate whatever order the scan listed the folders in', () => {
		// The rig's Boomers: one preset name in two sub-genres, flattened into one
		// folder. The disk lists "SFX Organic" first (code-unit order); Live's index
		// listed "Scoring Organic" first and kept the other copy.
		const sfx = () => folder('SFX Organic', 'Drum/Synth/Boomers/SFX Organic', {}, [item('Big Boomer Atmo', 'Drum/Synth/Boomers/SFX Organic')]);
		const scoring = () => folder('Scoring Organic', 'Drum/Synth/Boomers/Scoring Organic', {}, [item('Big Boomer Atmo', 'Drum/Synth/Boomers/Scoring Organic')]);
		const place = (subs: Record<string, PlaceFolder>) =>
			folder('Drum', 'Drum', { Synth: folder('Synth', 'Drum/Synth', { Boomers: folder('Boomers', 'Drum/Synth/Boomers', subs), Other: folder('Other', 'Drum/Synth/Other', {}, [item('o', 'Drum/Synth/Other')]) }) });
		const tuning = { maxFolderDepth: 2, flattenFolders: [], keepNestingFolders: [] };
		const kept = (raw: PlaceFolder) => shapePlace(raw, tuning).folders.Synth.folders.Boomers.presets.map((p) => p.fullPath);

		const diskOrder = kept(place({ 'SFX Organic': sfx(), 'Scoring Organic': scoring() }));
		const indexOrder = kept(place({ 'Scoring Organic': scoring(), 'SFX Organic': sfx() }));
		expect(diskOrder).toEqual(['/Drum/Synth/Boomers/SFX Organic/Big Boomer Atmo.x']);
		expect(indexOrder).toEqual(diskOrder);
	});
});

describe('alias map (old path → new path, from the copy manifest)', () => {
	const manifest = {
		sources: [
			{ origin: 'Omni', place: 'Drum', root: '/L/Instruments/Omni/Drum', dest: `${SIDEBAR}/Drum` },
			{ origin: 'Audio Samples', place: 'Drum', root: '/L/Audio Samples/Drum', dest: `${SIDEBAR}/Drum/Samples` }
		],
		entries: [
			{ a: 'c' as const, k: 'preset' as const, s: '/L/Instruments/Omni/Drum/Kits/A.aupreset', d: `${SIDEBAR}/Drum/Kits/A.aupreset`, o: 'Omni', p: 'Drum' },
			{ a: 'c' as const, k: 'preset' as const, s: '/L/Instruments/Omni/Drum/Kits/B.aupreset', d: `${SIDEBAR}/Drum/Kits/B (Omni).aupreset`, o: 'Omni', p: 'Drum', r: 'B.aupreset' },
			{ a: 'd' as const, k: 'dir' as const, s: '/L/Instruments/Omni/Drum/Kits', d: `${SIDEBAR}/Drum/Kits`, o: 'Omni', p: 'Drum' }
		]
	};

	it('is one rule per source plus the entries the rule gets wrong', () => {
		const map = aliasMapFrom(manifest);
		expect(map.rules).toHaveLength(2);
		expect(map.exceptions).toEqual({ '/L/Instruments/Omni/Drum/Kits/B.aupreset': `${SIDEBAR}/Drum/Kits/B (Omni).aupreset` });
		expect(applyAlias(map, '/L/Instruments/Omni/Drum/Kits/A.aupreset')).toBe(`${SIDEBAR}/Drum/Kits/A.aupreset`);
		expect(applyAlias(map, '/L/Instruments/Omni/Drum/Kits/B.aupreset')).toBe(`${SIDEBAR}/Drum/Kits/B (Omni).aupreset`);
		expect(applyAlias(map, '/L/Audio Samples/Drum/Hits/k.wav')).toBe(`${SIDEBAR}/Drum/Samples/Hits/k.wav`);
		// A path no rule covers is its own alias.
		expect(applyAlias(map, '/elsewhere/X.adg')).toBe('/elsewhere/X.adg');
		// A folder boundary: /Drum2 is not under /Drum.
		expect(applyAlias(map, '/L/Instruments/Omni/Drum2/X.adg')).toBe('/L/Instruments/Omni/Drum2/X.adg');
	});
});
