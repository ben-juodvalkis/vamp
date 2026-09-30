/**
 * The Places service: the browser's catalog, built on the Mac while it runs
 * and served over `/api/places/*` (onboarding.plan.md §3, §6, §9). It replaced
 * the build-time `interface/static/data/places/` on 2026-09-26.
 *
 * What it holds, for the whole server process:
 * - **Live's library** (`liveLibrary.ts`): every sidebar Place, the User
 *   Library and the installed Packs, re-read when `Library.cfg` changes.
 * - **The ticks** (`ticks.ts`): which of those are cataloged, saved in
 *   `logs/places.json`. Nothing saved is a first run, seeded from
 *   `paths.sidebarRoot` so the rig starts with its seven.
 * - **One catalog per ticked Place**, in the shape the browser has read since
 *   the browser-places cutover (`index.json`, `<id>.json`,
 *   `<id>-samples.json`), built from Live's index (`indexScan.ts`) when
 *   `catalog.source` is `index` and the index can be read, else from the disk
 *   scan (`diskScan.ts`). Kept in memory, and on disk under
 *   `scripts/.cache/places/` so a restart serves at once.
 * - **A version**, bumped on every change a client should refetch for, and
 *   pushed over `/api/places/events` (server-sent events).
 *
 * **Freshness.** A 2 s poll of three mtimes — `Library.cfg`, the index's
 * `-wal` (what Live's indexer writes while it runs) and the ticks file —
 * decides when to rebuild. Ticked Places are rebuilt, the others never read.
 * Until a new catalog is ready the last one keeps being served.
 *
 * **Staying fast (§9).** Nothing here reaches Live's thread. An index build of
 * a Place is a single `ancestors` join; the thumbnails, the one slow part of
 * the disk scan, are baked in the background after the catalog is up, from
 * the same cache the script used, and the version bumps once they are in.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir, setPriority } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '$lib/utils/logger';
import { categoryForFolderName, folderSlug, type PlaceAliasMap } from '$lib/utils/presetPath';
import type { KindCounts } from '$lib/utils/placeKinds';
import { configPath, configSection, repoRoot, runtimeConstants } from '../runtimeConfig';
import { DEFAULT_PREFS_DIR, librarySources, readLiveLibrary, type LibrarySource, type LiveLibrary } from './liveLibrary';
import { newestLibraryCfg } from '../libraryCfg';
import { readTicks, seedTicks, writeTicks, type Ticks } from './ticks';
import {
	SAMPLES_FOLDER,
	aliasMapFrom,
	installedAuComponents,
	loadKindCache,
	saveKindCache,
	scanPlace,
	shapePlace,
	type AuComponent,
	type KindCache,
	type PlaceFolder,
	type PlaceItem,
	type PlaceTuning
} from './diskScan';
import { findLiveDatabase, indexRowsFingerprint, indexRowsOf, openIndex, placeFileId, scanIndexPlace, type IndexHandle } from './indexScan';
import { MANIFEST_NAME, readManifest } from './placesManifest';
import { bakeThumbnails } from './audioThumbnailCache';

export type CatalogSource = 'index' | 'disk';

/** One ticked Place's catalog, as the browser reads it. */
export interface BuiltCatalog {
	key: string;
	id: string;
	name: string;
	path: string;
	icon: string;
	role: string | null;
	source: CatalogSource;
	/** What the build read; a rebuild is skipped while it holds. */
	stamp: string;
	builtAt: string;
	ms: number;
	tree: PlaceFolder;
	/** The Samples subtree, served as `<id>-samples.json`; the tree holds a stub. */
	samples: PlaceFolder | null;
	kinds: KindCounts;
	totalItems: number;
	/** Whether the thumbnail bake has run over this build. */
	baked: boolean;
	/** A fingerprint of what the build produced, before thumbnails: a rebuild that matches it changed nothing. */
	content?: string;
}

export interface PlacesListing {
	firstRun: boolean;
	version: number;
	/**
	 * This checkout's `Vamp Devices`, and the sidebar Place through
	 * which the surface reaches it (onboarding.plan.md §7, step 2): the Place
	 * of that exact folder when there is one, else a Place that holds it
	 * (the surface finds a path through any Place), else null.
	 */
	m4lDevices: { path: string; place: string | null; exact: boolean };
	/** The source in use for new builds, and why the index is not, if it is not. */
	source: CatalogSource;
	indexState: { ok: boolean; note: string; file: string | null };
	sources: Array<LibrarySource & { ticked: boolean; id: string | null; totalItems: number | null }>;
	libraryCfg: string | null;
}

export interface PlacesIndexJson {
	metadata: { generatedAt: string; sidebarRoot: string; source: string; totalItems: number; version: number };
	places: Array<{ id: string; name: string; path: string; icon: string; role: string | null; source: string; file: string; samplesFile?: string; totalItems: number; kinds: KindCounts }>;
	aliases: PlaceAliasMap;
}

const POLL_MS = 2000;

/** Where the service reads and writes; the defaults are the checkout's, tests pass their own. */
export interface PlacesServiceOptions {
	/** Live's preferences folder (`Library.cfg` under it). */
	prefsDir?: string;
	/** The ticks file. */
	ticksFile?: string;
	/** The cache folder (`places/`, the kind and peaks caches). */
	cacheDir?: string;
	/** Live's database folder; null for none. */
	liveDatabaseDir?: string | null;
	/** Whether to poll for changes (off in tests). */
	poll?: boolean;
	/** The AU component folders to read the installed plug-ins from; the system's by default. */
	auDirs?: string[];
}

function defaultLiveDatabaseDir(): string | null {
	const dir = configPath('liveDatabaseDir');
	if (!dir) return null;
	return dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir;
}
function keyHash(key: string): string {
	return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

interface CatalogTuning {
	maxFolderDepth: number;
	flattenFolders: string[];
	keepNestingFolders: string[];
	role?: string | null;
}

function tuningFor(name: string): CatalogTuning {
	const catalog = configSection<{ maxFolderDepth?: number; places?: Record<string, PlaceTuning> }>('catalog');
	const t = catalog.places?.[name] ?? {};
	return {
		maxFolderDepth: t.maxFolderDepth ?? catalog.maxFolderDepth ?? 2,
		flattenFolders: t.flattenFolders ?? [],
		keepNestingFolders: t.keepNestingFolders ?? [],
		role: t.role
	};
}

function brandColors(): Record<string, string | undefined> {
	const brands = configSection<Record<string, { color?: string }>>('vendors').brands ?? {};
	return Object.fromEntries(Object.entries(brands as Record<string, { color?: string }>).map(([k, v]) => [k, v?.color]));
}

/**
 * `catalog.source` in the config, `disk` unless it says `index` (the rig's
 * config says `index` since §10's checks passed). The environment
 * variable `LOOPING_CATALOG_SOURCE` overrides it for a session, so another
 * Mac can run the index without editing the rig's config.
 */
function preferredSource(): CatalogSource {
	const env = process.env.LOOPING_CATALOG_SOURCE;
	if (env === 'index' || env === 'disk') return env;
	const s = configSection<{ source?: string }>('catalog').source;
	return s === 'index' ? 'index' : 'disk';
}

/** The `source` a load names for items of this folder (protocol 3.11.0): `place:<name>`, `library` or `pack:<name>`. */
export function loadSource(s: Pick<LibrarySource, 'kind' | 'name'>): string {
	if (s.kind === 'user-library') return 'library';
	return `${s.kind}:${s.name}`;
}

function totalOf(kinds: KindCounts): number {
	return Object.values(kinds).reduce((a, b) => a + (b ?? 0), 0);
}

export class PlacesService {
	private readonly prefsDir: string;
	private readonly ticksFile: string;
	private readonly cacheDir: string;
	private readonly dbDir: string | null;
	private readonly polls: boolean;
	private lib: LiveLibrary;
	private sources: LibrarySource[] = [];
	private ticks: Ticks = { ticked: new Set(), firstRun: true, mtimeMs: 0 };
	private catalogs = new Map<string, BuiltCatalog>();
	private ids = new Map<string, string>();
	private version = 1;
	private listeners = new Set<(version: number) => void>();
	private timer: ReturnType<typeof setInterval> | null = null;
	private started = false;
	private indexState: { ok: boolean; note: string; file: string | null } = { ok: false, note: 'not read yet', file: null };
	private au: Map<string, AuComponent> | null = null;
	private readonly auDirs: string[] | undefined;
	private kindCache: KindCache | null = null;
	private lastDbStamp = '';
	private rebuildQueued = false;
	/** Whether this rebuild pass scanned a Place (rather than finding every one current). */
	private scanned = false;
	private baking = false;
	private bakeChild: ChildProcess | null = null;
	private aliasCache: { file: string; mtimeMs: number; aliases: PlaceAliasMap } | null = null;

	constructor(opts: PlacesServiceOptions = {}) {
		this.prefsDir = opts.prefsDir ?? DEFAULT_PREFS_DIR;
		this.ticksFile = opts.ticksFile ?? join(repoRoot(), 'logs', 'places.json');
		this.cacheDir = opts.cacheDir ?? join(repoRoot(), 'scripts', '.cache');
		this.auDirs = opts.auDirs;
		this.dbDir = opts.liveDatabaseDir === undefined ? defaultLiveDatabaseDir() : opts.liveDatabaseDir;
		this.polls = opts.poll ?? true;
		this.lib = readLiveLibrary(this.prefsDir);
	}

	private catalogCacheDir(): string {
		return join(this.cacheDir, 'places');
	}

	/** Read everything once and start the freshness poll. Safe to call twice. */
	start(): void {
		if (this.started) return;
		this.started = true;
		this.reload('start');
		if (!this.polls) return;
		this.timer = setInterval(() => this.poll(), POLL_MS);
		// Never keep the process alive for the poll alone.
		(this.timer as { unref?: () => void }).unref?.();
	}

	stop(): void {
		this.bakeChild?.kill();
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.started = false;
	}

	subscribe(listener: (version: number) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private bump(why: string): void {
		this.version += 1;
		logger.debug('places: version bump', { component: 'places', version: this.version, why });
		for (const l of this.listeners) {
			try {
				l(this.version);
			} catch {
				// A listener that throws is a closed stream whose cancel has
				// not run yet; it goes when it does (`events/+server.ts`).
			}
		}
	}

	get currentVersion(): number {
		return this.version;
	}

	// --- the library and the ticks ------------------------------------------

	private readSources(): void {
		this.sources = librarySources(this.lib);
		// Ids: the name's slug, numbered on a clash, in list order — the rule
		// the catalog script used, so `place:drum` stays `place:drum`.
		const used = new Set<string>();
		this.ids.clear();
		for (const s of this.sources) {
			let id = folderSlug(s.name) || 'place';
			for (let n = 2; used.has(id); n++) id = `${folderSlug(s.name)}-${n}`;
			used.add(id);
			this.ids.set(s.key, id);
		}
	}

	private readTicksFile(): void {
		const t = readTicks(this.ticksFile);
		if (t.firstRun) {
			t.ticked = seedTicks(this.sources, configPath('sidebarRoot'));
		}
		this.ticks = t;
	}

	private reload(why: string): void {
		this.lib = readLiveLibrary(this.prefsDir);
		this.readSources();
		this.readTicksFile();
		this.rebuildTicked(why);
	}

	/** Whether `Library.cfg` moved since it was read: a stat, not a parse. */
	private cfgChanged(): boolean {
		const file = newestLibraryCfg(this.prefsDir);
		if (file !== this.lib.cfgFile) return true;
		if (!file) return false;
		try {
			return statSync(file).mtimeMs !== this.lib.cfgMtimeMs;
		} catch {
			return true;
		}
	}

	private poll(): void {
		try {
			const ticksChanged = readTicks(this.ticksFile).mtimeMs !== this.ticks.mtimeMs;
			const dbChanged = this.dbStamp() !== this.lastDbStamp;
			if (this.cfgChanged()) {
				this.reload('Library.cfg changed');
				return;
			}
			if (ticksChanged) {
				this.readTicksFile();
				this.rebuildTicked('ticks changed');
				return;
			}
			// Live's indexer writes whenever a file lands in a folder it watches,
			// the ticked Places included, so an index write is the signal for a
			// disk rebuild too: the disk stamp carries it (`buildOne`).
			if (dbChanged) this.rebuildTicked('index written');
		} catch (err) {
			logger.warn('places: poll failed', { component: 'places', err: String(err) });
		}
	}

	private dbStamp(): string {
		const db = this.dbDir ? findLiveDatabase(this.dbDir) : null;
		return db ? `${db.file}:${db.mtimeMs}:${db.walMtimeMs}` : '';
	}

	// --- building ------------------------------------------------------------

	private ensureScanContext(): { au: Map<string, AuComponent>; colors: Record<string, string | undefined> } {
		if (!this.au) {
			const t = Date.now();
			this.au = installedAuComponents(this.auDirs);
			logger.info('places: AU components read', { component: 'places', count: this.au.size, ms: Date.now() - t });
		}
		return { au: this.au, colors: brandColors() };
	}

	private openIndexOrNull(): IndexHandle | null {
		const db = this.dbDir ? findLiveDatabase(this.dbDir) : null;
		if (!db) {
			this.indexState = { ok: false, note: `no Live-files-*.db in ${this.dbDir ?? 'paths.liveDatabaseDir'}`, file: null };
			return null;
		}
		try {
			const h = openIndex(db.file);
			this.indexState = { ok: true, note: '', file: db.file };
			return h;
		} catch (err) {
			this.indexState = { ok: false, note: String(err), file: db.file };
			return null;
		}
	}

	/** Rebuild every ticked Place whose stamp changed, drop the unticked, bump once. Returns whether anything changed. */
	private rebuildTicked(why: string): boolean {
		const t0 = Date.now();
		const wanted = this.sources.filter((s) => this.ticks.ticked.has(s.key) && s.present);
		let changed = false;
		for (const key of [...this.catalogs.keys()]) {
			if (!wanted.some((s) => s.key === key)) {
				this.catalogs.delete(key);
				changed = true;
			}
		}
		const source = preferredSource();
		let index: IndexHandle | null = null;
		if (source === 'index') index = this.openIndexOrNull();
		this.lastDbStamp = this.dbStamp();
		const ctx = wanted.length ? this.ensureScanContext() : null;
		try {
			for (const s of wanted) {
				const id = this.ids.get(s.key)!;
				const built = this.buildOne(s, id, index, ctx!);
				if (built) {
					this.catalogs.set(s.key, built);
					changed = true;
				}
			}
		} finally {
			index?.db.close();
		}
		// Only a pass that scanned can have taught the kind cache anything; it is
		// 13 MB on the rig, too much to rewrite on every poll.
		if (this.kindCache && this.scanned) saveKindCache(join(this.cacheDir, 'places-kind-cache.json'), this.kindCache);
		this.scanned = false;
		logger.info('places: catalogs ready', {
			component: 'places',
			why,
			ticked: wanted.length,
			source,
			indexOk: this.indexState.ok,
			ms: Date.now() - t0
		});
		if (changed) this.bump(why);
		this.scheduleBake();
		return changed;
	}

	/** The disk-cache file for a Place's catalog. */
	private cacheFile(key: string): string {
		return join(this.catalogCacheDir(), `${keyHash(key)}.json`);
	}

	private buildOne(s: LibrarySource, id: string, index: IndexHandle | null, ctx: { au: Map<string, AuComponent>; colors: Record<string, string | undefined> }): BuiltCatalog | null {
		const tuning = tuningFor(s.name);
		const role = tuning.role !== undefined ? tuning.role : (categoryForFolderName(s.name) ?? categoryForFolderName(basename(s.path)));
		// The stamp: the index's write stamp for an index build (any index
		// write rebuilds, 0.1 s for the rig's seven), the folder's own for a
		// disk build (decided by mtime of the root, cheap; a deeper change
		// arrives with the 2 s poll's next index stamp or a forced rebuild).
		// The stamp: what the build read. An index build carries the index's
		// write stamp, so any index write rebuilds it (0.1 s for the rig's
		// seven). A disk build carries the root folder's own mtime and no
		// index stamp: a walk of the rig's seven costs seconds of the server's
		// only thread, so it runs for a tick, a Library.cfg change, a change
		// at the Place's top level, or a forced rebuild — not for every file
		// Live's indexer touches anywhere. The Place's name, icon and id are
		// in it too, so a Place renamed in Live is served under its new name.
		const identity = `${s.name}:${s.icon}:${id}:${s.path}:${JSON.stringify(tuning)}`;
		// An index build is stamped with a fingerprint of the Place's own rows,
		// not the index's write time: Live writes its index every couple of
		// seconds while it runs, and rebuilding all seven Places on each write
		// held the server's only thread ~95% of the time (every iPad request
		// waited ~1.7 s behind it, 2026-09-29). Reading the rows costs ~0.1 s.
		const rootId = index ? placeFileId(index, s.path) : null;
		const rows = index && rootId !== null ? indexRowsOf(index, rootId) : null;
		const stamp = rows ? `index:${indexRowsFingerprint(rows)}:${identity}` : index ? `index:${this.lastDbStamp}:${identity}` : `disk:${identity}:${this.diskStamp(s.path)}`;
		const have = this.catalogs.get(s.key);
		if (have && have.stamp === stamp) return null;
		const cached = this.readCache(s.key, stamp);
		if (cached) return cached;

		const t = Date.now();
		this.scanned = true;
		let raw: PlaceFolder | null = null;
		let source: CatalogSource = 'disk';
		if (index) {
			if (rootId !== null) {
				try {
					if (!this.kindCache) this.kindCache = loadKindCache(join(this.cacheDir, 'places-kind-cache.json'));
					raw = scanIndexPlace(index, rootId, s.path, s.name, { ...ctx, kindCache: this.kindCache }, rows ?? undefined).tree;
					source = 'index';
				} catch (err) {
					logger.warn('places: index scan failed, using the disk', { component: 'places', place: s.name, err: String(err) });
					raw = null;
				}
			} else {
				logger.info('places: not in the index yet, using the disk', { component: 'places', place: s.name, path: s.path });
			}
		}
		if (!raw) {
			if (!this.kindCache) this.kindCache = loadKindCache(join(this.cacheDir, 'places-kind-cache.json'));
			const scanCtx = { kindCache: this.kindCache, newKindCache: this.kindCache, au: ctx.au, colors: ctx.colors, stats: { read: 0, reused: 0 } };
			raw = scanPlace(s.path, s.name, scanCtx);
			source = 'disk';
		}
		const tree = shapePlace(raw, { maxFolderDepth: tuning.maxFolderDepth, flattenFolders: tuning.flattenFolders, keepNestingFolders: tuning.keepNestingFolders });
		const kinds = tree.kinds ?? {};
		const samples = tree.folders[SAMPLES_FOLDER] ?? null;
		if (samples) {
			tree.folders = { ...tree.folders, [SAMPLES_FOLDER]: { ...samples, folders: {}, presets: [], external: `${id}-samples.json` } };
		}
		const built: BuiltCatalog = {
			key: s.key,
			id,
			name: s.name,
			path: s.path,
			icon: s.icon,
			role,
			source,
			stamp,
			builtAt: new Date().toISOString(),
			ms: Date.now() - t,
			tree,
			samples,
			kinds,
			totalItems: totalOf(kinds),
			baked: false,
			content: createHash('sha1').update(JSON.stringify([source, role, s.name, s.icon, id, tree, samples])).digest('hex')
		};
		// Live writes its index for anything it indexes, a file on the Desktop
		// included, and every write rebuilds the ticked Places. One that comes
		// out the same keeps the catalog clients hold: its ETag, its
		// thumbnails, and no version bump (so no page re-reads 80 MB).
		if (have && have.content === built.content) {
			have.stamp = stamp;
			this.writeCache(have);
			logger.debug('places: rebuilt unchanged', { component: 'places', place: s.name, ms: Date.now() - t });
			return null;
		}
		logger.info('places: built', { component: 'places', place: s.name, source, items: built.totalItems, ms: built.ms });
		this.writeCache(built);
		return built;
	}

	private diskStamp(path: string): string {
		try {
			return String(statSync(path).mtimeMs);
		} catch {
			return 'missing';
		}
	}

	private readCache(key: string, stamp: string): BuiltCatalog | null {
		try {
			const file = this.cacheFile(key);
			if (!existsSync(file)) return null;
			const data = JSON.parse(readFileSync(file, 'utf8')) as BuiltCatalog;
			if (data.stamp !== stamp) return null;
			return data;
		} catch {
			return null;
		}
	}

	private writeCache(built: BuiltCatalog): void {
		try {
			mkdirSync(this.catalogCacheDir(), { recursive: true });
			const file = this.cacheFile(built.key);
			writeFileSync(`${file}.tmp`, JSON.stringify(built));
			renameSync(`${file}.tmp`, file);
		} catch (err) {
			logger.warn('places: cache write failed', { component: 'places', err: String(err) });
		}
	}

	/** Forget every built catalog and build again. */
	rebuild(): void {
		this.catalogs.clear();
		try {
			for (const f of readdirSync(this.catalogCacheDir())) if (f.endsWith('.json')) unlinkSync(join(this.catalogCacheDir(), f));
		} catch {
			/* nothing cached */
		}
		this.rebuildTicked('forced');
	}

	// --- thumbnails, in the background ----------------------------------------

	private scheduleBake(): void {
		const wave = (runtimeConstants().ui as { browser?: { audioWaveforms?: boolean } } | undefined)?.browser?.audioWaveforms;
		if (wave === false) return;
		if (this.baking) {
			this.rebuildQueued = true;
			return;
		}
		const pending = [...this.catalogs.values()].filter((c) => !c.baked);
		if (!pending.length) return;
		this.baking = true;
		setTimeout(() => void this.bake(pending), 50);
	}

	private async bake(pending: BuiltCatalog[]): Promise<void> {
		// One bump for the whole pass, and only when a thumbnail was decoded:
		// a pass that reused every cached one changed nothing a page shows.
		let decoded = 0;
		const peaksCache = join(this.cacheDir, 'places-peaks-cache.json');
		const failureLog = join(this.cacheDir, 'places-peaks-failures.json');
		try {
			const itemsOf = (c: BuiltCatalog): PlaceItem[] => {
				const items: PlaceItem[] = [];
				const collect = (n: PlaceFolder) => {
					for (const p of n.presets) if (p.kind === 'sample' || p.kind === 'audio-clip') items.push(p);
					for (const child of Object.values(n.folders)) collect(child);
				};
				collect(c.tree);
				if (c.samples) collect(c.samples);
				return items;
			};
			// Decode in a low-priority process of its own, so a cold bake leaves
			// this server (and Live) responsive; the pass below then reads every
			// thumbnail back from the cache. Without the child it decodes here.
			const paths = [...new Set(pending.flatMap((c) => itemsOf(c).map((p) => p.fullPath)))];
			const t0 = Date.now();
			const child = paths.length ? await this.decodeInChild(paths, peaksCache, failureLog) : null;
			if (child?.stopped) return;
			if (child) {
				decoded += child.decoded;
				logger.info('places: thumbnails decoded in the background', { component: 'places', ...child, ms: Date.now() - t0 });
			}
			for (const c of pending) {
				if (this.catalogs.get(c.key) !== c) continue; // rebuilt meanwhile
				const items = itemsOf(c);
				if (items.length) {
					const t = Date.now();
					const stats = await bakeThumbnails(items, peaksCache, child ? undefined : failureLog, {
						log: (line) => logger.debug(line.trim(), { component: 'places' }),
						keepUnseen: true
					});
					const { failures: _failures, ...summary } = stats;
					logger.info('places: thumbnails baked', { component: 'places', place: c.name, ...summary, ms: Date.now() - t });
					decoded += stats.decoded;
				}
				if (this.catalogs.get(c.key) !== c) continue;
				c.baked = true;
				this.writeCache(c);
			}
			if (decoded > 0) this.bump(`thumbnails: ${decoded} decoded`);
		} catch (err) {
			logger.warn('places: thumbnail bake failed', { component: 'places', err: String(err) });
		} finally {
			this.baking = false;
			if (this.rebuildQueued) {
				this.rebuildQueued = false;
				this.scheduleBake();
			}
		}
	}

	/**
	 * Decode `paths` into the peaks cache in `scripts/bake-thumbnails.ts`, run
	 * by tsx at low priority. Resolves the child's stats, or null when it could
	 * not run (no tsx, a crash), and the caller decodes in this process.
	 */
	private decodeInChild(paths: string[], cacheFile: string, failureLogFile: string): Promise<{ decoded: number; reused: number; tombstoned: number; total: number; stopped?: boolean } | null> {
		const root = repoRoot();
		const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
		const script = join(root, 'scripts', 'bake-thumbnails.ts');
		if (!existsSync(tsx) || !existsSync(script)) return Promise.resolve(null);
		const job = join(this.cacheDir, 'places-bake-job.json');
		mkdirSync(this.cacheDir, { recursive: true });
		writeFileSync(job, JSON.stringify({ cacheFile, failureLogFile, paths }));
		return new Promise((resolve) => {
			const child = spawn(process.execPath, [tsx, '--tsconfig', join(root, 'interface', 'tsconfig.json'), script, job], {
				cwd: root,
				// stdin stays open for the child's life: it exits when this process does.
				stdio: ['pipe', 'pipe', 'pipe']
			});
			this.bakeChild = child;
			try {
				if (child.pid) setPriority(child.pid, 10);
			} catch {
				/* runs at normal priority */
			}
			let out = '';
			let err = '';
			child.stdout?.on('data', (d) => (out += d));
			child.stderr?.on('data', (d) => (err += d));
			const done = (stats: { decoded: number; reused: number; tombstoned: number; total: number; stopped?: boolean } | null) => {
				if (this.bakeChild === child) this.bakeChild = null;
				try {
					unlinkSync(job);
				} catch {
					/* already gone */
				}
				resolve(stats);
			};
			child.on('error', (e) => {
				logger.warn('places: the thumbnail process did not start; decoding here', { component: 'places', err: String(e) });
				done(null);
			});
			child.on('close', (code, signal) => {
				// Stopped with the server: nothing to decode here either.
				if (signal) return done({ decoded: 0, reused: 0, tombstoned: 0, total: 0, stopped: true });
				if (code !== 0) {
					logger.warn('places: the thumbnail process failed; decoding here', { component: 'places', code, err: err.slice(-500) });
					return done(null);
				}
				try {
					done(JSON.parse(out.trim().split('\n').pop() ?? ''));
				} catch {
					done(null);
				}
			});
		});
	}

	// --- what clients read ------------------------------------------------------

	private m4lDevices(): PlacesListing['m4lDevices'] {
		const path = join(repoRoot(), 'Vamp Devices');
		const places = this.sources.filter((s) => s.kind === 'place');
		const exact = places.find((s) => s.path === path);
		if (exact) return { path, place: exact.name, exact: true };
		const holder = places.filter((s) => path.startsWith(`${s.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
		return { path, place: holder ? holder.name : null, exact: false };
	}

	listing(): PlacesListing {
		return {
			firstRun: this.ticks.firstRun,
			version: this.version,
			m4lDevices: this.m4lDevices(),
			source: preferredSource(),
			indexState: this.indexState,
			libraryCfg: this.lib.cfgFile,
			sources: this.sources.map((s) => {
				const c = this.catalogs.get(s.key);
				return {
					...s,
					ticked: this.ticks.ticked.has(s.key),
					id: this.ids.get(s.key) ?? null,
					totalItems: c ? c.totalItems : null
				};
			})
		};
	}

	/** Save the ticks (the first save ends the first run) and rebuild. */
	setTicks(keys: Iterable<string>): PlacesListing {
		const known = new Set(this.sources.map((s) => s.key));
		const ticked = [...keys].filter((k) => known.has(k));
		writeTicks(this.ticksFile, ticked);
		this.readTicksFile();
		// The listing changed even when no catalog did (a tick on a folder
		// that is not on this Mac), so a rebuild that bumped nothing still bumps.
		if (!this.rebuildTicked('ticks saved')) this.bump('ticks saved');
		return this.listing();
	}

	/** Today's `index.json`: the ticked Places in sidebar order. */
	indexJson(): PlacesIndexJson {
		const places = this.sources
			.filter((s) => this.catalogs.has(s.key))
			.map((s) => {
				const c = this.catalogs.get(s.key)!;
				return {
					id: c.id,
					name: c.name,
					path: c.path,
					icon: c.icon,
					role: c.role,
					source: loadSource(s),
					file: `${c.id}.json`,
					samplesFile: c.samples ? `${c.id}-samples.json` : undefined,
					totalItems: c.totalItems,
					kinds: c.kinds
				};
			});
		const sidebarRoot = configPath('sidebarRoot') ?? '';
		const aliases = this.aliases(sidebarRoot);
		return {
			metadata: {
				generatedAt: new Date().toISOString(),
				sidebarRoot,
				source: this.lib.cfgFile ? 'library-cfg' : 'folders',
				totalItems: places.reduce((a, p) => a + p.totalItems, 0),
				version: this.version
			},
			places,
			aliases
		};
	}

	/** The alias map from the copy's manifest, re-read only when the manifest changes (the rig's has ~90,000 entries). */
	private aliases(sidebarRoot: string): PlaceAliasMap {
		const none: PlaceAliasMap = { rules: [], exceptions: {} };
		if (!sidebarRoot) return none;
		const file = join(sidebarRoot, MANIFEST_NAME);
		let mtimeMs: number;
		try {
			mtimeMs = statSync(file).mtimeMs;
		} catch {
			return none;
		}
		if (this.aliasCache && this.aliasCache.file === file && this.aliasCache.mtimeMs === mtimeMs) return this.aliasCache.aliases;
		try {
			const aliases = aliasMapFrom(readManifest(sidebarRoot));
			this.aliasCache = { file, mtimeMs, aliases };
			return aliases;
		} catch {
			return none;
		}
	}

	/** The catalog a file name (`<id>.json`, `<id>-samples.json`) belongs to, or null. */
	private catalogOf(name: string): { c: BuiltCatalog; samples: boolean } | null {
		const samples = name.endsWith('-samples.json');
		const id = samples ? name.slice(0, -'-samples.json'.length) : name.endsWith('.json') ? name.slice(0, -5) : '';
		if (!id) return null;
		const c = [...this.catalogs.values()].find((x) => x.id === id);
		if (!c || (samples && !c.samples)) return null;
		return { c, samples };
	}

	/**
	 * A validator for a file's current body, for the route's ETag: the build's
	 * stamp and whether its thumbnails are in, which is everything the body is
	 * made of. Null for a file that does not exist.
	 */
	fileTag(name: string): string | null {
		const hit = this.catalogOf(name);
		if (!hit) return null;
		// The content, not the stamp: an index write that changed nothing in the
		// Place moves the stamp and must not make every page re-download it.
		return `"${keyHash(`${hit.c.content ?? hit.c.stamp}:${hit.c.builtAt}:${hit.c.baked}:${hit.samples}`)}"`;
	}

	/** `<id>.json` or `<id>-samples.json`, or null. */
	fileJson(name: string): unknown | null {
		const samples = name.endsWith('-samples.json');
		const id = samples ? name.slice(0, -'-samples.json'.length) : name.endsWith('.json') ? name.slice(0, -5) : '';
		if (!id) return null;
		const c = [...this.catalogs.values()].find((x) => x.id === id);
		if (!c) return null;
		if (samples) {
			if (!c.samples) return null;
			return {
				metadata: { placeId: c.id, name: `${c.name} ${SAMPLES_FOLDER}`, generatedAt: c.builtAt },
				tree: { folders: c.samples.folders, presets: c.samples.presets, kinds: c.samples.kinds }
			};
		}
		return {
			metadata: { placeId: c.id, name: c.name, path: c.path, role: c.role, generatedAt: c.builtAt, totalItems: c.totalItems, kinds: c.kinds, source: c.source },
			tree: { folders: c.tree.folders, presets: c.tree.presets }
		};
	}

	/** For the diff tool and tests: the built catalogs by key. */
	get built(): ReadonlyMap<string, BuiltCatalog> {
		return this.catalogs;
	}
}

// On `globalThis`, not the module: Vite's dev server re-evaluates a changed
// server module, and a second service would poll and build beside the first.
const SLOT = '__loopingPlacesService';

/** The one service of this process, started on first use (`hooks.server.ts` starts it at boot). */
export function placesService(): PlacesService {
	const g = globalThis as unknown as Record<string, PlacesService | undefined>;
	if (!g[SLOT]) {
		g[SLOT] = new PlacesService();
		g[SLOT].start();
	}
	return g[SLOT];
}

/** A service of its own, for tests and tools: nothing shared, no poll unless asked. */
export function createPlacesService(opts: PlacesServiceOptions): PlacesService {
	const s = new PlacesService({ poll: false, ...opts });
	s.start();
	return s;
}

