/**
 * presetSwapCatalog — where a recorded preset sits in its Place's folder
 * (ADR-439 phase 2, on the Places since the browser-places cutover). A path
 * recorded before the Places reads through the alias map first; then the Place
 * whose folder holds the path answers the leaf whose items hold that exact
 * `fullPath`, in catalog order. A Place's file is fetched once per session,
 * and a path no Place holds fetches no Place file at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { presetSiblings, _resetPresetSwapCatalogForTests } from '$lib/services/presetSwapCatalog';
import { clearPlacesIndexCache } from '$lib/services/adapters/placesAdapter';
import type { FolderNode, Preset } from '$lib/services/adapters/browserAdapter';

const SB = '/L/Instruments/Sidebar';
/** Where the Key presets lived before the Places — a path saved Sets still hold. */
const OLD_KEY = '/L/Instruments/Omni/Key';

function preset(place: string, rel: string): Preset {
	const name = rel.split('/').pop()!.replace(/\.[^.]+$/, '');
	return { name, path: `${place}/${rel}`, fullPath: `${SB}/${place}/${rel}`, type: '.aupreset', kind: 'plugin-instrument', installed: true };
}

function folder(name: string, presets: Preset[], folders: Record<string, FolderNode> = {}): FolderNode {
	return { name, path: name, presets, folders };
}

const GRAND = [preset('Key', 'Acoustic/Grand/Ballad.aupreset'), preset('Key', 'Acoustic/Grand/Bright.aupreset')];
const RHODES = [preset('Key', 'Electric/Rhodes.aupreset')];
// A preset sitting directly at the Place's root — its folder path is `[]`.
const ROOTED = preset('Key', 'Loose.aupreset');
// A Place whose name holds punctuation, and whose path starts with another
// Place's (`…/Key` and `…/Keys & Pads`): the folder boundary keeps them apart.
const GLASS = [preset('Keys & Pads', 'Warm/Glass.aupreset')];

const place = (id: string, name: string) => ({
	id,
	name,
	path: `${SB}/${name}`,
	icon: '',
	role: 'key',
	file: `${id}.json`,
	totalItems: 1,
	kinds: { 'plugin-instrument': 1 }
});
const FILES: Record<string, unknown> = {
	'/api/places/index.json': {
		metadata: { generatedAt: '', sidebarRoot: SB, source: 'library-cfg', totalItems: 5 },
		places: [place('key', 'Key'), place('keys-pads', 'Keys & Pads')],
		aliases: { rules: [{ from: `${OLD_KEY}/`, to: `${SB}/Key/` }], exceptions: {} }
	},
	'/api/places/key.json': {
		metadata: { placeId: 'key', name: 'Key', path: `${SB}/Key`, role: 'key' },
		tree: {
			presets: [ROOTED],
			folders: { Acoustic: folder('Acoustic', [], { Grand: folder('Grand', GRAND) }), Electric: folder('Electric', RHODES) }
		}
	},
	'/api/places/keys-pads.json': {
		metadata: { placeId: 'keys-pads', name: 'Keys & Pads', path: `${SB}/Keys & Pads`, role: 'key' },
		tree: { presets: [], folders: { Warm: folder('Warm', GLASS) } }
	}
};

let fetched: string[] = [];
const placeFilesFetched = () => fetched.filter((url) => url !== '/api/places/index.json');

beforeEach(() => {
	clearPlacesIndexCache();
	_resetPresetSwapCatalogForTests();
	fetched = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			fetched.push(url);
			const body = FILES[url];
			return { ok: body !== undefined, status: body ? 200 : 404, json: async () => structuredClone(body) } as Response;
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const names = (presets: Preset[] | undefined) => presets?.map((p) => p.name);

describe('presetSiblings', () => {
	it('answers the leaf holding the preset, in catalog order, and its place in it', async () => {
		const found = await presetSiblings(GRAND[1].fullPath);
		expect(found?.typeId).toBe('place:key');
		expect(names(found?.presets)).toEqual(['Ballad', 'Bright']);
		expect(found?.index).toBe(1);
		expect(found?.path).toEqual(['Acoustic', 'Grand']);
	});

	/**
	 * ADR-441: the replace-instrument open lands the browser on this path, so it
	 * has to be the browser's own `currentPath` — the tree's key names from the
	 * Place's root down, nothing else. A preset directly under the root answers
	 * `[]`, which is that root.
	 */
	it('carries the folder path from the Place root down to the leaf', async () => {
		expect((await presetSiblings(RHODES[0].fullPath))?.path).toEqual(['Electric']);
		expect((await presetSiblings(ROOTED.fullPath))?.path).toEqual([]);
	});

	it('reads a path recorded before the Places through the alias map', async () => {
		const found = await presetSiblings(`${OLD_KEY}/Electric/Rhodes.aupreset`);
		expect(found?.typeId).toBe('place:key');
		expect(names(found?.presets)).toEqual(['Rhodes']);
	});

	it('opens only the Place whose folder holds the path — never a second one', async () => {
		await presetSiblings(RHODES[0].fullPath);
		expect(placeFilesFetched()).toEqual(['/api/places/key.json']);
	});

	it('keeps Places apart at the folder boundary, punctuation and all', async () => {
		const found = await presetSiblings(GLASS[0].fullPath);
		expect(found?.typeId).toBe('place:keys-pads');
		expect(found?.path).toEqual(['Warm']);
		expect(placeFilesFetched()).toEqual(['/api/places/keys-pads.json']);
	});

	it('fetches a Place file once however often it is asked', async () => {
		await presetSiblings(GRAND[0].fullPath);
		await presetSiblings(RHODES[0].fullPath);
		expect(fetched.filter((url) => url === '/api/places/key.json')).toHaveLength(1);
	});

	/**
	 * Swap audit M20, answered structurally rather than with a budget. A preset
	 * no catalog held used to sweep every catalog — measured 14 files, 19.2 MB.
	 * With an exact lookup there is nothing to sweep.
	 */
	it('fetches no Place file at all for a path no Place holds', async () => {
		expect(await presetSiblings('/Users/Shared/Elsewhere/Kits/Borrowed.adg')).toBeNull();
		expect(await presetSiblings(`${SB}/Vocal/Choir.aupreset`)).toBeNull();
		expect(placeFilesFetched()).toEqual([]);
	});

	it('is null when the Place does not hold that exact file', async () => {
		expect(await presetSiblings(`${SB}/Key/Gone.aupreset`)).toBeNull();
		expect(placeFilesFetched()).toEqual(['/api/places/key.json']);
	});

	it('is null for an empty path, without fetching anything', async () => {
		expect(await presetSiblings('')).toBeNull();
		expect(fetched).toEqual([]);
	});

	it('is null, not an error, with no Places catalog', async () => {
		delete FILES['/api/places/index.json'];
		try {
			expect(await presetSiblings(GRAND[0].fullPath)).toBeNull();
		} finally {
			FILES['/api/places/index.json'] = {
				metadata: { generatedAt: '', sidebarRoot: SB, source: 'library-cfg', totalItems: 5 },
				places: [place('key', 'Key'), place('keys-pads', 'Keys & Pads')],
				aliases: { rules: [{ from: `${OLD_KEY}/`, to: `${SB}/Key/` }], exceptions: {} }
			};
		}
	});
});
