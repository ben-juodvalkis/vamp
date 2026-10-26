import { describe, expect, it } from 'vitest';
import { groupEffectsPlace, type PlaceFolder, type PlaceItem } from '$lib/server/places/diskScan';
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

describe('groupEffectsPlace', () => {
	it('files every device under Audio Effects or MIDI Effects by what it is, and drops the plumbing', () => {
		const out = groupEffectsPlace(raw, HIDDEN);
		expect(Object.keys(out.folders)).toEqual(['Audio Effects', 'MIDI Effects']);
		expect(out.presets).toEqual([]);
		const audio = out.folders['Audio Effects'];
		const midi = out.folders['MIDI Effects'];
		// A one-preset folder is that preset; Permute's header says audio effect (`aaaa`).
		expect(audio.presets.map((p) => p.name)).toEqual(['Bass Amp', 'Permute']);
		expect(Object.keys(audio.folders)).toEqual(['Wah']);
		expect(midi.presets.map((p) => p.name)).toEqual(['Note Chance', 'MidiWheels']);
		expect(midi.folders).toEqual({});
		// Items keep their own paths: a load names the file where it is.
		expect(audio.presets[0].path).toBe('Vamp Devices/Bass Amp/Bass Amp.adg');
	});

	it('merges a top-level folder already named for a group into it', () => {
		const withGroup: PlaceFolder = {
			...raw,
			presets: [],
			folders: {
				'Audio Effects': folder('Audio Effects', [], {
					'Auto Filter': folder('Audio Effects/Auto Filter', [item('Audio Effects/Auto Filter/Disco Filter.adv', 'audio-effect'), item('Audio Effects/Auto Filter/Comb.adv', 'audio-effect')])
				}),
				Blur: folder('Blur', [item('Blur/Blur.amxd', 'max-audio-effect')])
			}
		};
		const audio = groupEffectsPlace(withGroup, HIDDEN).folders['Audio Effects'];
		expect(Object.keys(audio.folders)).toEqual(['Auto Filter']);
		expect(audio.presets.map((p) => p.name)).toEqual(['Blur']);
	});
});
