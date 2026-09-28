/**
 * The Places browser (browser-places plan): the adapter over the Places
 * catalog, the swap pill's and Recent's reading of old paths through the alias
 * map, the role a load from a Place records, and the rail's bands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import { PlacesAdapter, _resetPlaceReadsForTests, clearPlacesIndexCache, kindsMatch } from '$lib/services/adapters/placesAdapter';
import { recentThroughAliases } from '$lib/services/adapters/recentInstrumentsAdapter';
import { presetSiblings, _resetPresetSwapCatalogForTests } from '$lib/services/presetSwapCatalog';
import { resolveAutoColor, resolveAutoRole, colorForAudio, colorForCategory } from '$lib/services/trackColoring';
import { keepRecent, railBands } from '$lib/components/v6/browser/utils/drillDownModel';
import type { FolderNode, Preset } from '$lib/services/adapters/browserAdapter';

const SB = '/L/Instruments/Sidebar';
const OLD = '/L/Instruments/Omni/Synth';

function item(rel: string, kind: Preset['kind'], extra: Partial<Preset> = {}): Preset {
	const file = rel.split('/').pop()!;
	return {
		name: file.replace(/\.[^.]+$/, ''),
		path: `Synth/${rel}`,
		fullPath: `${SB}/Synth/${rel}`,
		type: file.slice(file.lastIndexOf('.')),
		kind,
		...extra
	};
}
function folder(name: string, path: string, presets: Preset[], kinds: FolderNode['kinds'], folders: Record<string, FolderNode> = {}): FolderNode {
	return { name, path, presets, folders, kinds, vendorColor: null };
}

const LEAD = [item('Lead/Aurora Lead.adg', 'instrument-rack'), item('Lead/Glass Blade.adg', 'instrument-rack')];
const PADS = [
	item('Pads/Missing.aupreset', 'plugin-instrument', { installed: false }),
	item('Pads/Noisy VHS Tapes.aupreset', 'plugin-instrument', { installed: true, plugin: 'Omnisphere' }),
	item('Pads/Wet Hall.adv', 'audio-effect'),
	item('Pads/Warm Circuit.aupreset', 'plugin-instrument', { installed: true, plugin: 'Omnisphere' })
];
const DRONES = [item('Samples/Drone/Lone Forest.wav', 'sample'), item('Samples/Drone/Pure Drip.wav', 'sample')];

let files: Record<string, unknown>;
let fetched: string[];

beforeEach(() => {
	clearPlacesIndexCache();
	_resetPlaceReadsForTests();
	_resetPresetSwapCatalogForTests();
	fetched = [];
	files = {
		'/api/places/index.json': {
			metadata: { generatedAt: '', sidebarRoot: SB, source: 'library-cfg', totalItems: 8, version: 1 },
			places: [
				{ id: 'synth', name: 'Synth', path: `${SB}/Synth`, icon: '', role: 'synth', file: 'synth.json', samplesFile: 'synth-samples.json', totalItems: 8, kinds: { 'instrument-rack': 2, 'plugin-instrument': 3, 'audio-effect': 1, sample: 2 } }
			],
			aliases: { rules: [{ from: `${OLD}/`, to: `${SB}/Synth/` }], exceptions: {} }
		},
		'/api/places/synth.json': {
			metadata: { placeId: 'synth', name: 'Synth', path: `${SB}/Synth`, role: 'synth' },
			tree: {
				presets: [],
				folders: {
					Lead: folder('Lead', 'Synth/Lead', LEAD, { 'instrument-rack': 2 }),
					Pads: folder('Pads', 'Synth/Pads', PADS, { 'plugin-instrument': 3, 'audio-effect': 1 }),
					Samples: { ...folder('Samples', 'Synth/Samples', [], { sample: 2 }), external: 'synth-samples.json' }
				}
			}
		},
		'/api/places/synth-samples.json': {
			metadata: { placeId: 'synth' },
			tree: { presets: [], folders: { Drone: folder('Drone', 'Synth/Samples/Drone', DRONES, { sample: 2 }) } }
		}
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			fetched.push(url);
			const body = files[url];
			return { ok: body !== undefined, status: body ? 200 : 404, json: async () => structuredClone(body) } as Response;
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('PlacesAdapter', () => {
	it('lists a Place’s folders, narrowed by the chosen chip from the folder counts alone', async () => {
		const a = new PlacesAdapter('synth');
		expect(await a.getFolders('place:synth', [])).toEqual(['Lead', 'Pads', 'Samples']);
		a.setKindFilter(['samples']);
		expect(await a.getFolders('place:synth', [])).toEqual(['Samples']);
		// Choosing Samples did not open the samples file: the stub's counts answered.
		expect(fetched).not.toContain('/api/places/synth-samples.json');
		a.setKindFilter(['kits']);
		expect(await a.getFolders('place:synth', [])).toEqual([]);
	});

	it('fetches a Place’s Samples the first time the folder is opened, once', async () => {
		const a = new PlacesAdapter('synth');
		expect(await a.getFolders('place:synth', ['Samples'])).toEqual(['Drone']);
		expect((await a.getPresets('place:synth', ['Samples', 'Drone'], Infinity)).map((p) => p.name)).toEqual(['Lone Forest', 'Pure Drip']);
		expect(fetched.filter((u) => u === '/api/places/synth-samples.json')).toHaveLength(1);
	});

	it('stamps every item — samples included — with the Place’s role', async () => {
		const a = new PlacesAdapter('synth');
		const pads = await a.getPresets('place:synth', ['Pads'], Infinity);
		const drones = await a.getPresets('place:synth', ['Samples', 'Drone'], Infinity);
		expect([...pads, ...drones].every((p) => p.role === 'synth')).toBe(true);
	});

	it('filters a leaf’s items by the chip', async () => {
		const a = new PlacesAdapter('synth');
		a.setKindFilter(['effects']);
		expect((await a.getPresets('place:synth', ['Pads'], Infinity)).map((p) => p.name)).toEqual(['Wet Hall']);
	});

	it('never picks a greyed tile at random, chip or no chip', async () => {
		const a = new PlacesAdapter('synth');
		for (let i = 0; i < 60; i++) {
			const p = await a.getRandomPreset('place:synth', ['Pads']);
			expect(p.installed).not.toBe(false);
			expect(p.kind).not.toBe('audio-effect');
		}
	});

	it('never picks an uninstalled plug-in at random', async () => {
		const a = new PlacesAdapter('synth');
		a.setKindFilter(['instruments']);
		for (let i = 0; i < 40; i++) {
			const p = await a.getRandomPreset('place:synth', ['Pads']);
			expect(p.installed).not.toBe(false);
		}
	});

	it('finds a sample’s leaf inside the Samples file, with the folder path from the Place root', async () => {
		const a = new PlacesAdapter('synth');
		const found = await a.findPresetSiblings(DRONES[1].fullPath);
		expect(found?.path).toEqual(['Samples', 'Drone']);
		expect(found?.index).toBe(1);
	});

	it('matches kinds to chips by group', () => {
		expect(kindsMatch({ 'drum-rack': 3 }, new Set(['kits']))).toBe(true);
		expect(kindsMatch({ 'drum-rack': 3 }, new Set(['instruments']))).toBe(false);
		expect(kindsMatch({ 'drum-rack': 0, sample: 1 }, new Set(['kits']))).toBe(false);
		expect(kindsMatch({}, null)).toBe(true);
		// Simpler lists samples and audio clips; a folder of MIDI clips only shows under Clip.
		expect(kindsMatch({ 'midi-clip': 4 }, new Set(['samples', 'clips']))).toBe(false);
		expect(kindsMatch({ 'midi-clip': 4 }, new Set(['samples', 'clips', 'midi-clips']))).toBe(true);
	});
});

describe('the swap pill on the Places', () => {
	it('reads an old path through the alias map into its Place, and steps only what can load', async () => {
		const found = await presetSiblings(`${OLD}/Pads/Noisy VHS Tapes.aupreset`);
		expect(found?.typeId).toBe('place:synth');
		expect(found?.path).toEqual(['Pads']);
		// The uninstalled plug-in and the effect are not steps; the preset itself is.
		expect(found?.presets.map((p) => p.name)).toEqual(['Noisy VHS Tapes', 'Warm Circuit']);
		expect(found?.index).toBe(0);
	});

	it('answers null for a path no Place holds, reading nothing but the index', async () => {
		expect(await presetSiblings('/Elsewhere/Borrowed.adg')).toBeNull();
		expect(fetched).toEqual(['/api/places/index.json']);
	});
});

describe('Recent through the alias map', () => {
	const old = { name: 'Aurora Lead', path: `${OLD}/Lead/Aurora Lead.adg`, fullPath: `${OLD}/Lead/Aurora Lead.adg`, type: '.adg' };
	const moved = { ...old, path: `${SB}/Synth/Lead/Aurora Lead.adg`, fullPath: `${SB}/Synth/Lead/Aurora Lead.adg` };

	it('is the store’s list untouched with no Places catalog', async () => {
		delete files['/api/places/index.json'];
		expect(await recentThroughAliases([old])).toEqual([old]);
	});

	it('shows an old entry as its Sidebar copy, and one item for the two', async () => {
		const out = await recentThroughAliases([moved, old]);
		expect(out).toHaveLength(1);
		expect(out[0].fullPath).toBe(moved.fullPath);
		expect((await recentThroughAliases([old]))[0].fullPath).toBe(moved.fullPath);
	});

	it('gives an entry with no recorded role the role of the Place its file lands in', async () => {
		expect((await recentThroughAliases([old]))[0].role).toBe('synth');
		const elsewhere = { name: 'Borrowed', path: '/Elsewhere/Borrowed.adg', fullPath: '/Elsewhere/Borrowed.adg', type: '.adg' };
		expect((await recentThroughAliases([elsewhere]))[0]).toEqual(elsewhere);
		// A role the entry recorded itself is kept, even null.
		expect((await recentThroughAliases([{ ...moved, role: null }]))[0].role).toBeNull();
	});
});

describe('a load from a Place records the Place’s role', () => {
	it('outright, over what the path’s shape would say', () => {
		// `Drum/Synth/…` read by shape is the Synth folder — the 2026-09-18 mistake.
		expect(resolveAutoRole('Drum/Synth/Kit.aupreset', { placeRole: 'drum' })).toBe('drum');
		expect(resolveAutoColor('Drum/Synth/Kit.aupreset', { placeRole: 'drum' })).toBe(colorForCategory('drum'));
	});

	it('records nothing, and colors nothing, for a Place with no role', () => {
		expect(resolveAutoRole('Found/Thing.adg', { placeRole: null })).toBeNull();
		expect(resolveAutoColor('Found/Thing.adg', { placeRole: null })).toBeNull();
	});

	it('colors a sample from a Place as audio, with no role', () => {
		expect(resolveAutoColor('Drum/Samples/Kick.wav', { audio: true, placeRole: 'drum' })).toBe(colorForAudio());
		expect(resolveAutoRole('Drum/Samples/Kick.wav', { audio: true, placeRole: 'drum' })).toBeNull();
	});
});

describe('keepRecent: the Places kept in memory', () => {
	it('moves the Place opened to the front and evicts past the cap', () => {
		expect(keepRecent([], 'drum', 3)).toEqual({ list: ['drum'], evicted: [] });
		expect(keepRecent(['inst', 'drum', 'bass'], 'key', 3)).toEqual({ list: ['key', 'inst', 'drum'], evicted: ['bass'] });
		// A return to a kept Place evicts nothing: it was already counted.
		expect(keepRecent(['key', 'inst', 'drum'], 'drum', 3)).toEqual({ list: ['drum', 'key', 'inst'], evicted: [] });
	});
});

describe('reading a Place: draw first, check after', () => {
	it('draws from the cache without asking, asks after, and re-reads strictly when the Mac changed it', async () => {
		let etag = '"v1"';
		let cached: string | null = null;
		const calls: Array<{ url: string; cache?: RequestCache }> = [];
		const body = { metadata: { placeId: 'synth' }, tree: { presets: [], folders: { Lead: folder('Lead', 'Synth/Lead', PADS, { 'plugin-instrument': 3, 'audio-effect': 1 }) } } };
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push({ url, cache: init?.cache });
				if (url === '/api/places/index.json') return { ok: true, status: 200, json: async () => structuredClone(files[url]) } as Response;
				// Safari's copy: a force-cache read answers with it, a no-cache
				// read asks the Mac and stores what the Mac holds now.
				if (init?.cache !== 'force-cache' || cached === null) cached = etag;
				const tag = cached;
				return {
					ok: true,
					status: 200,
					headers: new Headers({ etag: tag }),
					json: async () => structuredClone(body),
					arrayBuffer: async () => new ArrayBuffer(0),
					body: { cancel: async () => {} }
				} as unknown as Response;
			})
		);
		const changed = vi.fn();
		window.addEventListener('places-changed', changed);
		try {
			const a = new PlacesAdapter('synth');
			expect(await a.getFolders('place:synth', [])).toEqual(['Lead']);
			await vi.waitFor(() => expect(calls.filter((c) => c.url === '/api/places/synth.json')).toHaveLength(2));
			// The draw did not wait on the Mac; the check that followed did.
			expect(calls.filter((c) => c.url === '/api/places/synth.json').map((c) => c.cache)).toEqual(['force-cache', 'no-cache']);
			expect(changed).not.toHaveBeenCalled();

			// The Mac changed the file while the page held Safari's copy: the check
			// sees another ETag, announces the change, and the next read is strict.
			etag = '"v2"';
			a.clearCache();
			await a.getFolders('place:synth', []);
			await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
			calls.length = 0;
			a.clearCache();
			await a.getFolders('place:synth', []);
			expect(calls.filter((c) => c.url === '/api/places/synth.json').map((c) => c.cache)).toEqual(['no-cache']);
		} finally {
			window.removeEventListener('places-changed', changed);
		}
	});
});

describe('railBands (plan §2)', () => {
	const bands = (n: number) => railBands(Array.from({ length: n }, (_, i) => i)).map((b) => b.length);
	it('splits the buttons over three bands, later bands taking the extra', () => {
		expect(bands(5)).toEqual([1, 2, 2]);
		expect(bands(6)).toEqual([2, 2, 2]);
		expect(bands(7)).toEqual([2, 2, 3]);
		expect(bands(8)).toEqual([2, 3, 3]); // today's rail: Recent + seven
		expect(bands(9)).toEqual([3, 3, 3]);
		expect(bands(10)).toEqual([3, 3, 4]);
		expect(bands(0)).toEqual([0, 0, 0]);
	});

	it('keeps the order', () => {
		expect(railBands(['recent', 'drum', 'perc', 'bass', 'fx', 'inst', 'key', 'synth'])).toEqual([
			['recent', 'drum'],
			['perc', 'bass', 'fx'],
			['inst', 'key', 'synth']
		]);
	});
});

describe('a load that names its Place (3.11.0)', () => {
	it('turns an item’s Place and folder into source and rel for the wire', async () => {
		const { placeArgs } = await import('$lib/services/placesLive');
		expect(placeArgs({ source: 'place:Synth', placePath: '/Lib/Sidebar/Synth', fullPath: '/Lib/Sidebar/Synth/Lead/Bright.adg' })).toEqual(['place:Synth', 'Lead/Bright.adg']);
		expect(placeArgs({ source: 'place:Synth', placePath: '/Lib/Sidebar/Synth/', fullPath: '/Lib/Sidebar/Synth/Lead/Bright.adg' })).toEqual(['place:Synth', 'Lead/Bright.adg']);
		expect(placeArgs({ fullPath: '/Recent/x.adg' })).toEqual(['', '']);
		expect(placeArgs({ source: 'place:Synth', placePath: '/Lib/Sidebar/Synth', fullPath: '/Elsewhere/x.adg' })).toEqual(['', '']);
	});
});

describe('applyPlacesVersion', () => {
	it('refetches only for a version the fetched index does not carry', async () => {
		const live = await import('$lib/services/placesLive');
		const heard: number[] = [];
		const onChanged = (e: Event) => heard.push((e as CustomEvent).detail.version);
		window.addEventListener(live.PLACES_CHANGED_EVENT, onChanged);
		try {
			live.stopPlacesLive();
			const adapter = await import('$lib/services/adapters/placesAdapter');
			adapter.clearPlacesIndexCache();
			live.applyPlacesVersion(1); // the stream opens before any index arrived: nothing to refetch yet
			expect(heard).toEqual([]);
			await adapter.getPlacesIndex(); // this suite's index is version 1
			expect(adapter.fetchedPlacesVersion()).toBe(1);
			live.applyPlacesVersion(1); // the same again: nothing
			live.applyPlacesVersion(2); // a change
			expect(heard).toEqual([2]);
			expect(adapter.fetchedPlacesVersion()).toBe(0); // the memo went with it
		} finally {
			window.removeEventListener(live.PLACES_CHANGED_EVENT, onChanged);
			live.stopPlacesLive();
		}
	});

	it('refetches when the stream names a newer catalog while the index is in flight', async () => {
		const live = await import('$lib/services/placesLive');
		const adapter = await import('$lib/services/adapters/placesAdapter');
		const heard: number[] = [];
		const onChanged = (e: Event) => heard.push((e as CustomEvent).detail.version);
		window.addEventListener(live.PLACES_CHANGED_EVENT, onChanged);
		try {
			live.stopPlacesLive();
			adapter.clearPlacesIndexCache();
			const inFlight = adapter.getPlacesIndex();
			live.applyPlacesVersion(2); // a bump the index (version 1) will not carry
			expect(heard).toEqual([]);
			await inFlight;
			expect(heard).toEqual([2]);
			expect(adapter.fetchedPlacesVersion()).toBe(0);
		} finally {
			window.removeEventListener(live.PLACES_CHANGED_EVENT, onChanged);
			live.stopPlacesLive();
		}
	});
});

describe('warmPlacesCache', () => {
	it('fetches every Place file in rail order, presets before samples, and drops the bodies', async () => {
		const { warmPlacesCache } = await import('$lib/services/placesLive');
		const urls: string[] = [];
		const fetchFn = (async (url: string) => {
			urls.push(url);
			return { ok: !url.includes('missing'), text: async () => '{}' } as unknown as Response;
		}) as unknown as typeof fetch;
		const warmed = await warmPlacesCache(
			[
				{ file: 'drum.json', samplesFile: 'drum-samples.json' },
				{ file: 'key.json' },
				{ file: 'missing.json' }
			],
			fetchFn
		);
		expect(urls).toEqual(['/api/places/drum.json', '/api/places/key.json', '/api/places/missing.json', '/api/places/drum-samples.json']);
		expect(warmed).toEqual(['drum.json', 'key.json', 'drum-samples.json']);
	});

	it('a newer warm-up stops an older one', async () => {
		const { warmPlacesCache } = await import('$lib/services/placesLive');
		const urls: string[] = [];
		const fetchFn = (async (url: string) => {
			urls.push(url);
			return { ok: true, text: async () => '' } as unknown as Response;
		}) as unknown as typeof fetch;
		const first = warmPlacesCache([{ file: 'a.json' }, { file: 'b.json' }, { file: 'c.json' }], fetchFn);
		const second = warmPlacesCache([{ file: 'x.json' }], fetchFn);
		const [older, newer] = await Promise.all([first, second]);
		expect(newer).toEqual(['x.json']);
		expect(older.length).toBeLessThan(3);
	});
});
