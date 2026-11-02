/**
 * The browser demo's library (ADR-502): a few presets in every browser
 * category, in the Places catalog's own format, so a visitor can load
 * something from each rail button.
 *
 * The names are invented, and no file exists behind them. Each preset borrows
 * the parameters of a device the scene has a table for (`like`, as in
 * `scene.mjs`'s `pushDevices`), so what it loads opens a real view: a kit is a
 * Drum Rack, a lead a Wavetable, Drift or Operator, an effect one of the six
 * effects with tables. `demoPreset(path)` is what the mock surface asks when a
 * load names one of these files.
 */

import FIXTURE_INDEX from './fixtures/data/places/index.json' with { type: 'json' };

// The fixture library's root, icons and alias rules, kept: the scene's tracks
// record their presets under that root, and with any other one the
// interface draws no tracks at all (measured 2026-11-02).
const ROOT = FIXTURE_INDEX.metadata.sidebarRoot.replace(/\/+$/, '');
const GENERATED = '2026-11-02T00:00:00.000Z';

/** Category → folder → [preset name, device it borrows, kind]. */
const LIBRARY = {
	drum: {
		name: 'Drum',
		role: 'drum',
		folders: {
			Kits: [
				['Dusty Kit', 'Drum-Rack', 'drum-rack'],
				['Tight Room Kit', 'Drum-Rack', 'drum-rack'],
				['Brush Kit', 'Drum-Rack', 'drum-rack'],
				['Garden Machine', 'Drum-Rack', 'drum-rack']
			]
		}
	},
	perc: {
		name: 'Perc',
		role: 'perc',
		folders: {
			Hands: [
				['Hand Drums', 'Drum-Rack', 'drum-rack'],
				['Shakers and Bells', 'Drum-Rack', 'drum-rack'],
				['Wood and Clay', 'Drum-Rack', 'drum-rack']
			]
		}
	},
	bass: {
		name: 'Bass',
		role: 'bass',
		folders: {
			Synth: [
				['Round Sub', 'Drift', 'instrument-rack'],
				['Rubber Bass', 'Drift', 'instrument-rack'],
				['Wide Saw Bass', 'Wavetable', 'instrument-rack'],
				['FM Pluck Bass', 'Operator', 'instrument-rack']
			]
		}
	},
	key: {
		name: 'Key',
		role: 'key',
		folders: {
			Piano: [
				['Felt Piano', 'Simpler', 'instrument-rack'],
				['Soft Upright', 'Simpler', 'instrument-rack']
			],
			Bells: [['Glass Bell', 'Operator', 'instrument-rack']]
		}
	},
	synth: {
		name: 'Synth',
		role: 'synth',
		folders: {
			Lead: [
				['Bright Lead', 'Wavetable', 'instrument-rack'],
				['Square Lead', 'Drift', 'instrument-rack'],
				['Bell Lead', 'Operator', 'instrument-rack']
			],
			Pads: [
				['Slow Pad', 'Wavetable', 'instrument-rack'],
				['Warm Pad', 'Drift', 'instrument-rack']
			]
		}
	},
	inst: {
		name: 'Inst',
		role: 'inst',
		folders: {
			Textures: [
				['Chime Bed', 'Simpler', 'instrument-rack'],
				['Plucked Strings', 'Operator', 'instrument-rack']
			]
		}
	},
	fx: {
		name: 'FX',
		role: 'fx',
		folders: {
			Space: [
				['Long Hall', 'Reverb', 'effect-rack'],
				['Slapback', 'Echo', 'effect-rack'],
				['Dub Delay', 'Echo', 'effect-rack']
			],
			Colour: [
				['Sweep Filter', 'Auto Filter', 'effect-rack'],
				['Warm Drive', 'Saturator', 'effect-rack'],
				['Glue Bus', 'Compressor', 'effect-rack'],
				['Slow Pan', 'Auto Pan Legacy', 'effect-rack']
			]
		}
	}
};

const placePath = (id) => `${ROOT}/${LIBRARY[id].name}`;

function placeFile(id) {
	const place = LIBRARY[id];
	const folders = {};
	const kinds = {};
	let total = 0;
	for (const [folder, presets] of Object.entries(place.folders)) {
		// A folder's `kinds` is what the browser's mode filter reads: one without
		// is hidden in every mode.
		const folderKinds = {};
		for (const [, , kind] of presets) folderKinds[kind] = (folderKinds[kind] ?? 0) + 1;
		folders[folder] = {
			name: folder,
			path: `${place.name}/${folder}`,
			folders: {},
			kinds: folderKinds,
			presets: presets.map(([name, , kind]) => {
				kinds[kind] = (kinds[kind] ?? 0) + 1;
				total += 1;
				const path = `${place.name}/${folder}/${name}.adg`;
				return { name, path, fullPath: `${ROOT}/${path}`, type: '.adg', variants: [`${name}.adg`], kind };
			})
		};
	}
	return {
		metadata: { placeId: id, name: place.name, path: placePath(id), role: place.role, generatedAt: GENERATED, totalItems: total, kinds },
		tree: { folders, presets: [] }
	};
}

/**
 * Every file the demo's `/api/places/<file>.json` answers with.
 *
 * @returns {Record<string, unknown>}
 */
export function demoPlaceFiles() {
	/** @type {Record<string, unknown>} */
	const files = {};
	const places = FIXTURE_INDEX.places
		.filter((place) => LIBRARY[place.id])
		.map((place) => {
			const file = placeFile(place.id);
			files[place.file] = file;
			const { samplesFile, ...rest } = place;
			return { ...rest, path: placePath(place.id), totalItems: file.metadata.totalItems, kinds: file.metadata.kinds };
		});
	files['index.json'] = {
		...FIXTURE_INDEX,
		metadata: { ...FIXTURE_INDEX.metadata, generatedAt: GENERATED, totalItems: places.reduce((n, p) => n + p.totalItems, 0) },
		places
	};
	return files;
}

/**
 * The preset a load names, by its file name wherever the path puts it:
 * `{ name, like, role }`, or null for a file the demo does not have.
 */
export function demoPreset(path) {
	const file = String(path ?? '').split('/').pop() ?? '';
	const name = file.replace(/\.(adg|adv|aupreset|amxd)$/i, '');
	for (const place of Object.values(LIBRARY)) {
		for (const presets of Object.values(place.folders)) {
			const hit = presets.find(([n]) => n === name);
			if (hit) return { name, like: hit[1], role: place.role, effect: hit[2] === 'effect-rack' };
		}
	}
	return null;
}
