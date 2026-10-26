import { describe, expect, it } from 'vitest';
import { tidyEffectsPlace, type PlaceFolder, type PlaceItem } from '$lib/server/places/diskScan';
import type { ItemKind } from '$lib/utils/placeKinds';

const ROOT = 'Vamp Devices';
const item = (rel: string, kind: ItemKind): PlaceItem =>
	({ name: rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''), path: `${ROOT}/${rel}`, kind }) as PlaceItem;
const folder = (rel: string, presets: PlaceItem[], folders: Record<string, PlaceFolder> = {}): PlaceFolder => ({
	name: rel.slice(rel.lastIndexOf('/') + 1),
	path: `${ROOT}/${rel}`,
	folders,
	presets,
	vendorColor: null
});

// The checkout's Vamp Devices as the catalog read it on 2026-10-26.
const raw: PlaceFolder = {
	name: ROOT,
	path: ROOT,
	vendorColor: null,
	presets: [item('MidiWheels.amxd', 'max-midi-effect')],
	folders: {
		Abstractions: folder('Abstractions', []),
		'Bass Amp': folder('Bass Amp', [item('Bass Amp/Bass Amp.adg', 'effect-rack')]),
		Grooves: folder('Grooves', []),
		'Note Chance': folder('Note Chance', [item('Note Chance/Note Chance.amxd', 'max-midi-effect')]),
		Permute: folder('Permute', [item('Permute/Permute.amxd', 'max-audio-effect')]),
		'random-start': folder('random-start', [item('random-start/random-start.amxd', 'max-midi-effect')]),
		'Vamp-Recorder': folder('Vamp-Recorder', [item('Vamp-Recorder/Vamp-Recorder.amxd', 'max-audio-effect')]),
		Wah: folder('Wah', [item('Wah/Wah.adg', 'effect-rack'), item('Wah/Wah Cry.adg', 'effect-rack')])
	}
};
const HIDDEN = ['Vamp-Recorder', 'random-start', 'Abstractions', 'Grooves'];

describe('tidyEffectsPlace', () => {
	it('puts every preset on the top level, each keeping its own path, so its folder is its section', () => {
		const out = tidyEffectsPlace(raw, HIDDEN);
		expect(out.folders).toEqual({});
		expect(out.presets.map((p) => p.path)).toEqual([
			'Vamp Devices/MidiWheels.amxd',
			'Vamp Devices/Bass Amp/Bass Amp.adg',
			'Vamp Devices/Note Chance/Note Chance.amxd',
			'Vamp Devices/Permute/Permute.amxd',
			'Vamp Devices/Wah/Wah.adg',
			'Vamp Devices/Wah/Wah Cry.adg'
		]);
	});

	it('drops the plumbing, a folder or a file', () => {
		const withFile: PlaceFolder = { ...raw, presets: [...raw.presets, item('Vamp-Recorder.amxd', 'max-audio-effect')] };
		const names = tidyEffectsPlace(withFile, HIDDEN).presets.map((p) => p.name);
		expect(names).not.toContain('Vamp-Recorder');
		expect(names).not.toContain('random-start');
	});

	it('leaves a flat folder, the rig\'s, exactly as it is', () => {
		const flat: PlaceFolder = {
			name: 'Audio-Midi Effects',
			path: 'Audio-Midi Effects',
			vendorColor: null,
			folders: {},
			presets: [item('Auto Filter.adv', 'audio-effect'), item('Comb.amxd', 'max-audio-effect'), item('Note Chance.amxd', 'max-midi-effect')]
		};
		expect(tidyEffectsPlace(flat, HIDDEN)).toEqual(flat);
	});
});
