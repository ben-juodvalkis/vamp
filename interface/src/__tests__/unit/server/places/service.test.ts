// @vitest-environment node
/**
 * The Places service against a scratch library (onboarding.plan.md §6, §10):
 * the seed from the Sidebar root on a first run, the ticks, the catalogs in
 * the browser's shapes, the cache, and what a rename or an untick does. The
 * disk source, with no Live database; the index reader has its own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlacesService, loadSource, type PlacesService } from '$lib/server/places/service';
import { liveIndexFixture } from '../../../helpers/liveIndexFixture';

// `catalog.effectsPlace` per test; the rest of the config is the repo's.
let effectsPlace = '';
vi.mock('$lib/server/runtimeConfig', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/server/runtimeConfig')>();
	return {
		...real,
		configSection: (key: string) => {
			const section = real.configSection(key) as Record<string, unknown>;
			return key === 'catalog' ? { ...section, effectsPlace } : section;
		}
	};
});

let root: string;

/** The first sidebar Place in the listing: Live's categories come before the Places. */
const firstPlace = (s: PlacesService) => s.listing().sources.find((x) => x.kind === 'place')!;
let service: PlacesService | null = null;

function libraryCfg(places: Array<[string, string]>, userLibrary: string): void {
	const rows = places.map(([name, p], i) => `<UserFolderInfo Id="${i}" Path="${p}" DisplayName="${name}" IconName="" />`).join('\n');
	const dir = join(root, 'prefs', 'Live 12.4');
	mkdirSync(dir, { recursive: true });
	const file = join(dir, 'Library.cfg');
	writeFileSync(
		file,
		`<Ableton><ContentLibrary><LibraryProject><ProjectPath Value="${root}" /><ProjectName Value="${userLibrary}" /></LibraryProject>
		<UserFolderInfoList>${rows}</UserFolderInfoList></ContentLibrary></Ableton>`
	);
}

function preset(rel: string): void {
	const file = join(root, rel);
	mkdirSync(join(file, '..'), { recursive: true });
	// A gzipped-XML .adv would need zlib; an .aupreset with no identity reads as `unknown`, which is fine for shapes.
	writeFileSync(file, '<plist/>');
}

function make(): PlacesService {
	// These tests build from the disk; the repo's config may say `index`.
	vi.stubEnv('LOOPING_CATALOG_SOURCE', 'disk');
	service = createPlacesService({
		prefsDir: join(root, 'prefs'),
		ticksFile: join(root, 'logs', 'places.json'),
		cacheDir: join(root, 'cache'),
		liveDatabaseDir: null,
		// Not this Mac's plug-ins: reading the rig's 253 took 1.7 s a service,
		// and the restart test builds two, past vitest's 5 s under the gate.
		auDirs: []
	});
	return service;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'places-service-'));
	mkdirSync(join(root, 'User Library'), { recursive: true });
	preset('Sidebar/Drum/Kits/Kit A.aupreset');
	preset('Sidebar/Drum/Samples/hit.wav');
	preset('Sidebar/Key/Piano/Grand.aupreset');
	preset('Desktop/stray.aupreset');
	libraryCfg(
		[
			['Drum', join(root, 'Sidebar', 'Drum')],
			['Key', join(root, 'Sidebar', 'Key')],
			['Desktop', join(root, 'Desktop')]
		],
		'User Library'
	);
});
afterEach(() => {
	effectsPlace = '';
	vi.unstubAllEnvs();
	service?.stop();
	service = null;
	rmSync(root, { recursive: true, force: true });
});

describe('PlacesService, disk source', () => {
	it('lists every folder Live names, ticks nothing on a first run with no seed, and builds nothing', () => {
		const s = make();
		const listing = s.listing();
		expect(listing.firstRun).toBe(true);
		expect(listing.sources.filter((x) => x.kind !== 'category').map((x) => `${x.kind}:${x.name}`)).toEqual(['place:Drum', 'place:Key', 'place:Desktop', 'user-library:User Library']);
		// Live's categories, every Pack as one source among them, ahead of the Places.
		expect(listing.sources.slice(0, 8).map((x) => `${x.kind}:${x.name}`)).toEqual(
			['Sounds', 'Drums', 'Instruments', 'Audio Effects', 'MIDI Effects', 'Max for Live', 'Clips', 'Packs'].map((n) => `category:${n}`)
		);
		expect(listing.sources.some((x) => x.ticked)).toBe(false);
		expect(s.indexJson().places).toEqual([]);
		// Onboarding's step 2: this checkout's Max devices folder is no Place of the scratch library.
		expect(listing.m4lDevices.path.endsWith('/Vamp Devices')).toBe(true);
		expect(listing.m4lDevices.place).toBeNull();
	});

	it('a tick builds the Place in the browser shapes, saves the file, ends the first run and bumps once', () => {
		const s = make();
		const v0 = s.currentVersion;
		const drum = firstPlace(s);
		const listing = s.setTicks([drum.key]);
		expect(listing.firstRun).toBe(false);
		expect(existsSync(join(root, 'logs', 'places.json'))).toBe(true);
		expect(s.currentVersion).toBe(v0 + 1);

		const index = s.indexJson();
		expect(index.places.map((p) => [p.id, p.name, p.source, p.file, p.samplesFile])).toEqual([['drum', 'Drum', 'place:Drum', 'drum.json', 'drum-samples.json']]);
		expect(index.metadata.version).toBe(s.currentVersion);
		const file = s.fileJson('drum.json') as { metadata: { placeId: string; source: string }; tree: { folders: Record<string, { external?: string; presets: unknown[] }> } };
		expect(file.metadata.placeId).toBe('drum');
		expect(file.metadata.source).toBe('disk');
		expect(Object.keys(file.tree.folders)).toEqual(['Kits', 'Samples']);
		expect(file.tree.folders.Samples.external).toBe('drum-samples.json');
		expect(file.tree.folders.Samples.presets).toEqual([]);
		const samples = s.fileJson('drum-samples.json') as { tree: { presets: Array<{ name: string; kind: string }> } };
		expect(samples.tree.presets.map((p) => [p.name, p.kind])).toEqual([['hit', 'sample']]);
		expect(s.fileJson('key.json')).toBeNull();
	});

	it('serves the cached build on a restart, and drops an unticked Place', () => {
		const s = make();
		const [drum, key] = s.listing().sources.filter((x) => x.kind === 'place');
		s.setTicks([drum.key, key.key]);
		expect(s.indexJson().places.map((p) => p.id)).toEqual(['drum', 'key']);
		s.stop();

		const again = make();
		expect(again.indexJson().places.map((p) => p.id)).toEqual(['drum', 'key']);
		const before = again.currentVersion;
		again.setTicks([key.key]);
		expect(again.indexJson().places.map((p) => p.id)).toEqual(['key']);
		expect(again.currentVersion).toBe(before + 1);
		expect(again.fileJson('drum.json')).toBeNull();
	});

	it('a rebuild that comes out the same keeps the served catalog: same ETag, no version bump', () => {
		const s = make();
		const drum = firstPlace(s);
		s.setTicks([drum.key]);
		const v = s.currentVersion;
		const tag = s.fileTag('drum.json');
		// What Live's index write does on the index source: the stamp moves,
		// nothing in the Place changed. On the disk source the root's mtime does it.
		const later = new Date(Date.now() + 60_000);
		utimesSync(join(root, 'Sidebar', 'Drum'), later, later);
		(s as unknown as { rebuildTicked(why: string): boolean }).rebuildTicked('test');
		expect(s.currentVersion).toBe(v);
		expect(s.fileTag('drum.json')).toBe(tag);

		// A real change still rebuilds and bumps.
		preset('Sidebar/Drum/Kits/Kit B.aupreset');
		utimesSync(join(root, 'Sidebar', 'Drum'), new Date(Date.now() + 120_000), new Date(Date.now() + 120_000));
		(s as unknown as { rebuildTicked(why: string): boolean }).rebuildTicked('test');
		expect(s.currentVersion).toBe(v + 1);
		expect(s.fileTag('drum.json')).not.toBe(tag);
	});

	it('follows a Place renamed in Live, and serves it under its new name', () => {
		const s = make();
		const drum = firstPlace(s);
		s.setTicks([drum.key]);
		libraryCfg([['Drums', join(root, 'Sidebar', 'Drum')]], 'User Library');
		// The poll is off in tests; a reload is what the poll would do.
		(s as unknown as { reload(why: string): void }).reload('test');
		expect(s.indexJson().places.map((p) => [p.id, p.name])).toEqual([['drums', 'Drums']]);
	});
});

describe("PlacesService, Live's categories", () => {
	it('builds a ticked category from the index on a disk-source Mac; each item names its own root', () => {
		const dbDir = join(root, 'Live Database');
		mkdirSync(dbDir, { recursive: true });
		const f = liveIndexFixture(join(dbDir, 'Live-files-12300.db'));
		f.place(['Users', 'me', 'Packs', 'Drum Booth'], 'Drum Booth', 0);
		f.vfolder(1, 'Bass', ['Basses']);
		f.file(['Users', 'me', 'Packs', 'Drum Booth', 'Basses'], 'Sub.adv', { device_id: 'device:ableton:instr:Operator' });
		f.db.close();
		vi.stubEnv('LOOPING_CATALOG_SOURCE', 'disk');
		service = createPlacesService({
			prefsDir: join(root, 'prefs'),
			ticksFile: join(root, 'logs', 'places.json'),
			cacheDir: join(root, 'cache'),
			liveDatabaseDir: dbDir,
			auDirs: []
		});
		service.setTicks(['category:Sounds']);
		const entry = service.indexJson().places.find((p) => p.name === 'Sounds')!;
		// No Place source: the browser keeps each item's own.
		expect(entry).toMatchObject({ id: 'sounds', path: '', totalItems: 1 });
		expect(entry.source).toBeUndefined();
		// Each sub-folder is a file of its own, read when it is opened.
		const file = service.fileJson('sounds.json') as { tree: { folders: Record<string, { external?: string }> } };
		expect(file.tree.folders.Bass.external).toBe('sounds~bass.json');
		const bass = service.fileJson('sounds~bass.json') as { tree: { presets: Array<Record<string, unknown>> } };
		// One root under Bass: its chain collapses, as a Place's single-child folders do.
		expect(bass.tree.presets[0]).toMatchObject({
			name: 'Sub',
			source: 'pack:Drum Booth',
			placePath: '/Users/me/Packs/Drum Booth'
		});
		// A preset read may open the category's roots, not the whole disk.
		expect(service.catalogRoots()).toEqual(['/Users/me/Packs/Drum Booth']);
	});

	it('builds the categories in a process of its own, serving nothing new until it lands', async () => {
		const dbDir = join(root, 'Live Database');
		mkdirSync(dbDir, { recursive: true });
		const f = liveIndexFixture(join(dbDir, 'Live-files-12300.db'));
		f.place(['Users', 'me', 'Packs', 'Drum Booth'], 'Drum Booth', 0);
		f.vfolder(1, 'Bass', ['Basses']);
		f.file(['Users', 'me', 'Packs', 'Drum Booth', 'Basses'], 'Sub.adv', { device_id: 'device:ableton:instr:Operator' });
		f.db.close();
		vi.stubEnv('LOOPING_CATALOG_SOURCE', 'disk');
		service = createPlacesService({
			prefsDir: join(root, 'prefs'),
			ticksFile: join(root, 'logs', 'places.json'),
			cacheDir: join(root, 'cache'),
			liveDatabaseDir: dbDir,
			auDirs: [],
			categoriesInline: false
		});
		const landed = new Promise<void>((resolve) => service!.subscribe(() => service!.indexJson().places.some((p) => p.name === 'Sounds') && resolve()));
		service.setTicks(['category:Sounds']);
		// The tick returns at once; the build is in the child.
		expect(service.indexJson().places).toEqual([]);
		await landed;
		expect(service.indexJson().places.find((p) => p.name === 'Sounds')).toMatchObject({ totalItems: 1 });
	}, 30_000);

	it('serves every Pack as one button whose Packs are files of their own, read when opened', () => {
		const dbDir = join(root, 'Live Database');
		mkdirSync(dbDir, { recursive: true });
		const f = liveIndexFixture(join(dbDir, 'Live-files-12300.db'));
		f.place(['Users', 'me', 'Packs', 'Drum Booth'], 'Drum Booth', 0);
		f.file(['Users', 'me', 'Packs', 'Drum Booth', 'Kits'], 'Booth Kit.adg', { device_id: 'device:ableton:instr:DrumGroupDevice' });
		f.db.close();
		vi.stubEnv('LOOPING_CATALOG_SOURCE', 'disk');
		service = createPlacesService({
			prefsDir: join(root, 'prefs'),
			ticksFile: join(root, 'logs', 'places.json'),
			cacheDir: join(root, 'cache'),
			liveDatabaseDir: dbDir,
			auDirs: []
		});
		service.setTicks(['category:Packs']);
		const top = service.fileJson('packs.json') as { tree: { folders: Record<string, { external?: string; presets: unknown[]; kinds?: Record<string, number> }> } };
		const stub = top.tree.folders['Drum Booth'];
		expect(stub).toMatchObject({ external: 'packs~drum-booth.json', presets: [], kinds: { 'drum-rack': 1 } });
		// The Pack's one folder (Kits) collapses into it, as a Place's single-child chains do.
		const part = service.fileJson('packs~drum-booth.json') as { tree: { presets: Array<Record<string, unknown>> } };
		expect(part.tree.presets[0]).toMatchObject({ name: 'Booth Kit', source: 'pack:Drum Booth' });
		expect(service.fileTag('packs~drum-booth.json')).not.toBe(service.fileTag('packs.json'));
		expect(service.fileTag('packs~nope.json')).toBeNull();
	});
});

describe('loadSource', () => {
	it('names a Place, the library or a Pack the way the surface reads it', () => {
		expect(loadSource({ kind: 'place', name: 'Drum' })).toBe('place:Drum');
		expect(loadSource({ kind: 'user-library', name: 'User Library' })).toBe('library');
		expect(loadSource({ kind: 'pack', name: 'Drum Booth' })).toBe('pack:Drum Booth');
	});
});

describe('PlacesService, the effects Place', () => {
	it('catalogs the effects Place unticked, flagged hidden; ticked, it is on the rail too', () => {
		effectsPlace = 'Key';
		const s = make();
		const [drum, key] = s.listing().sources.filter((x) => x.kind === 'place');
		s.setTicks([drum.key]);
		expect(s.indexJson().places.map((p) => [p.id, p.effects ?? false, p.hidden ?? false])).toEqual([
			['drum', false, false],
			['key', true, true]
		]);
		expect(s.fileJson('key.json')).not.toBeNull();
		s.setTicks([drum.key, key.key]);
		expect(s.indexJson().places.find((p) => p.id === 'key')).toMatchObject({ effects: true, hidden: false });
	});

	it('names no effects Place by default', () => {
		const s = make();
		s.setTicks([firstPlace(s).key]);
		expect(s.indexJson().places.some((p) => p.effects)).toBe(false);
	});
});
