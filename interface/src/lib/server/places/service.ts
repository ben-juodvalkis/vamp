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
	tidyEffectsPlace,
	shapePlace,
	type AuComponent,
	type KindCache,
	type PlaceFolder,
	type PlaceItem,
	type PlaceTuning
} from './diskScan';
import { findLiveDatabase, indexRowsFingerprint, indexRowsOf, openIndex, placeFileId, scanIndexPlace, type IndexHandle } from './indexScan';
import { MANIFEST_NAME, readManifest } from './placesManifest';
import { CATEGORY_ROLES, PACKS_SOURCE, categoryRoots, categoryStamp, scanCategories, scanPacks, type CategoryScanResult, type LiveCategory } from './categoryScan';

/** How deep the Packs button nests (`catalog.places.Packs.maxFolderDepth` overrides): the Pack, then its own folders. */
const PACKS_DEPTH = 4;
import { bakeThumbnails } from './audioThumbnailCache';

/** How the effects Place is drawn (`tidyEffectsPlace`): 3, every preset on one screen in its folder's section (2026-10-26; 2 as on disk, 1 grouped by kind). */
const EFFECTS_LAYOUT = 3;

/**
 * Bump when the scan writes something new into a catalog: the cache stamp
 * otherwise holds only what the build read, so a catalog cached by older code
 * would be served as it was. 2: items carry `tags` and `device`; 3: tags
 * borrowed by name too; 4: a Live preset tinted by its device; 5: Genres and
 * Keyword tags too (all 2026-10-28); 6: the Packs button's Packs as
 * parts of their own; 7: a device's folder (`dfld`) read as a folder (both
 * 2026-10-31).
 */
const CATALOG_FORMAT = 7;

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
	/** A Live category's roots (the User Library, the Packs): the folders its items may be read from. */
	roots?: string[];
	/**
	 * Top-level folders served as files of their own (`<id>~<slug>.json`),
	 * fetched when opened: the Packs button's Packs, 30 MB together on the
	 * rig. The tree holds an `external` stub for each, its `kinds` kept.
	 */
	parts?: Record<string, PlaceFolder>;
	/** The parts whose thumbnails are in (a part is baked once a client opens it). */
	partsBaked?: string[];
	/** A fingerprint of what the build produced, before thumbnails: a rebuild that matches it changed nothing. */
	content?: string;
}

/** One stretch of a bake pass: a catalog's tree, or one opened part of it. */
interface BakeUnit {
	c: BuiltCatalog;
	label: string;
	folders: PlaceFolder[];
	done: () => void;
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
	places: Array<{
		id: string;
		name: string;
		path: string;
		icon: string;
		role: string | null;
		/** The load source of every item; absent for a Live category, whose items each name their own. */
		source?: string;
		file: string;
		samplesFile?: string;
		totalItems: number;
		kinds: KindCounts;
		/** The effects Place (`catalog.effectsPlace`): where + Effect opens the browser. */
		effects?: boolean;
		/** Cataloged as the effects Place but not ticked: off the rail. */
		hidden?: boolean;
	}>;
	aliases: PlaceAliasMap;
}

const POLL_MS = 2000;

/**
 * How often an index write may make the categories look at their roots
 * (`categoryStamp`, 82 ms on the rig). A build is ~4 s cold, so it runs only
 * when that stamp moved, and the look itself waits this long between turns.
 */
const CATEGORY_STAMP_MS = 30_000;

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
	/**
	 * Build Live's categories on this thread instead of in a child process
	 * (`scripts/scan-categories.ts`). Tests and tools, which want the catalog
	 * when `setTicks` returns; the server never does.
	 */
	categoriesInline?: boolean;
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

/** The card palette: `vendors.brands` by brand, and `vendors.devices` as `device:<Live's name>`. */
function brandColors(): Record<string, string | undefined> {
	const vendors = configSection<Record<string, Record<string, { color?: string }>>>('vendors');
	const entries = (section: Record<string, { color?: string }> | undefined, prefix = '') =>
		Object.entries(section ?? {}).map(([k, v]) => [`${prefix}${k}`, v?.color] as const);
	return Object.fromEntries([...entries(vendors.brands), ...entries(vendors.devices, 'device:')]);
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
	/** The categories' stamp and when it was read (`CATEGORY_STAMP_MS`). */
	private categoryStampRead: { at: number; stamp: string } | null = null;
	/** Every category's tree from one read of the index, kept while its stamp holds. */
	private categoryScan: { stamp: string; result: CategoryScanResult } | null = null;
	/** Every Pack's tree (`scanPacks`), kept while the same stamp holds. */
	private packsScan: { stamp: string; tree: PlaceFolder; roots: string[] } | null = null;
	private readonly categoriesInline: boolean;
	/** The category build running in a child, and whether another was asked for meanwhile. */
	private categoryChild: ChildProcess | null = null;
	private categoryRescan = false;
	/** The child could not run (no tsx, a crash): build on this thread from now on. */
	private categoryChildFailed = false;
	/** The parts a client has read (`<key>\t<file>`): those are baked. */
	private openedParts = new Set<string>();

	constructor(opts: PlacesServiceOptions = {}) {
		this.prefsDir = opts.prefsDir ?? DEFAULT_PREFS_DIR;
		this.ticksFile = opts.ticksFile ?? join(repoRoot(), 'logs', 'places.json');
		this.cacheDir = opts.cacheDir ?? join(repoRoot(), 'scripts', '.cache');
		this.auDirs = opts.auDirs;
		this.dbDir = opts.liveDatabaseDir === undefined ? defaultLiveDatabaseDir() : opts.liveDatabaseDir;
		this.polls = opts.poll ?? true;
		this.categoriesInline = opts.categoriesInline ?? false;
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
		this.categoryChild?.kill();
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
		// the catalog script used, so `place:drum` stays `place:drum`. The
		// Places take theirs before Live's categories, which the list puts
		// first: a Place named "Drums" keeps `drums` and the category numbers.
		const used = new Set<string>();
		this.ids.clear();
		const placesFirst = [...this.sources.filter((s) => s.kind !== 'category'), ...this.sources.filter((s) => s.kind === 'category')];
		for (const s of placesFirst) {
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

	/**
	 * Whether a source is the effects Place (`catalog.effectsPlace`, by its
	 * sidebar name): the one + Effect opens. It is cataloged ticked or not.
	 */
	private isEffectsPlace(s: Pick<LibrarySource, 'name'>): boolean {
		const name = configSection<{ effectsPlace?: string }>('catalog').effectsPlace;
		return !!name && s.name === name;
	}

	/** Rebuild every ticked Place (and the effects Place) whose stamp changed, drop the rest, bump once. Returns whether anything changed. */
	private rebuildTicked(why: string): boolean {
		const t0 = Date.now();
		const wanted = this.sources.filter((s) => s.present && (this.ticks.ticked.has(s.key) || this.isEffectsPlace(s)));
		let changed = false;
		for (const key of [...this.catalogs.keys()]) {
			if (!wanted.some((s) => s.key === key)) {
				this.catalogs.delete(key);
				changed = true;
			}
		}
		const source = preferredSource();
		// A Live category is only ever built from the index, whatever the Places use.
		const needsIndex = source === 'index' || wanted.some((s) => s.kind === 'category');
		let index: IndexHandle | null = null;
		if (needsIndex) index = this.openIndexOrNull();
		this.lastDbStamp = this.dbStamp();
		const ctx = wanted.length ? this.ensureScanContext() : null;
		try {
			for (const s of wanted) {
				const id = this.ids.get(s.key)!;
				const built = s.kind === 'category' ? this.buildCategory(s, id, index, ctx!) : this.buildOne(s, id, source === 'index' ? index : null, ctx!);
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
		const effects = this.isEffectsPlace(s) ? (configSection<{ effectsHidden?: string[] }>('catalog').effectsHidden ?? []) : null;
		// The effects Place's layout rule is in it too, so a change to how the
		// Place is drawn rebuilds a catalog cached under the old one.
		// And the build's format: a change to what a scan writes into a catalog
		// (a new item field) rebuilds catalogs cached by the code before it.
		const identity = `${CATALOG_FORMAT}:${s.name}:${s.icon}:${id}:${s.path}:${JSON.stringify(tuning)}:${JSON.stringify(effects && { hidden: effects, layout: EFFECTS_LAYOUT })}`;
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
		if (effects) raw = tidyEffectsPlace(raw, effects);
		const tree = shapePlace(raw, { maxFolderDepth: tuning.maxFolderDepth, flattenFolders: tuning.flattenFolders, keepNestingFolders: tuning.keepNestingFolders });
		return this.finishBuild(s, id, role, source, stamp, t, tree, have);
	}

	/**
	 * A Live category's catalog (`categoryScan.ts`): every category's tree
	 * comes from one read of the index, rebuilt only when the files under the
	 * User Library and the Packs changed. Null when nothing changed, or when
	 * there is no index to read (a category has no folder to scan).
	 */
	private buildCategory(s: LibrarySource, id: string, index: IndexHandle | null, ctx: { au: Map<string, AuComponent>; colors: Record<string, string | undefined> }): BuiltCatalog | null {
		if (!index) return null;
		const tuning = tuningFor(s.name);
		const packs = s.name === PACKS_SOURCE;
		if (packs && configSection<{ places?: Record<string, PlaceTuning> }>('catalog').places?.[s.name]?.maxFolderDepth === undefined) {
			tuning.maxFolderDepth = Math.max(tuning.maxFolderDepth, PACKS_DEPTH);
		}
		const role = tuning.role !== undefined ? tuning.role : (CATEGORY_ROLES[s.name as LiveCategory] ?? null);
		const now = Date.now();
		if (!this.categoryStampRead || now - this.categoryStampRead.at >= CATEGORY_STAMP_MS) {
			this.categoryStampRead = { at: now, stamp: categoryStamp(index, categoryRoots(index)) };
		}
		const indexStamp = this.categoryStampRead.stamp;
		const stamp = `category:${indexStamp}:${CATALOG_FORMAT}:${s.name}:${id}:${JSON.stringify(tuning)}`;
		const have = this.catalogs.get(s.key);
		if (have && have.stamp === stamp) return null;
		const cached = this.readCache(s.key, stamp);
		if (cached) return cached;

		// The trees come from a scan of the index at this stamp. Built in a child
		// process, the server keeps serving what it has (`have`) until it lands.
		const ready = packs ? this.packsScan?.stamp === indexStamp : this.categoryScan?.stamp === indexStamp;
		if (!ready) {
			if (!this.categoriesInline && !this.categoryChildFailed) {
				this.scanCategoriesInChild(indexStamp, index.file);
				return null;
			}
			this.scanCategoriesHere(index, indexStamp, packs, ctx);
		}
		const t = Date.now();
		const shape = (raw: PlaceFolder) => shapePlace(raw, { maxFolderDepth: tuning.maxFolderDepth, flattenFolders: tuning.flattenFolders, keepNestingFolders: tuning.keepNestingFolders });
		// Each top-level folder is a file of its own, read when it is opened:
		// Drums is 14 MB whole, the Packs 30 MB (`finishBuild`'s parts).
		if (packs) return this.finishBuild(s, id, role, 'index', stamp, t, shape(this.packsScan!.tree), have, this.packsScan!.roots, true);
		const { result } = this.categoryScan!;
		const raw = result.trees.get(s.name as LiveCategory);
		if (!raw) return null;
		return this.finishBuild(s, id, role, 'index', stamp, t, shape(raw), have, result.roots.map((r) => r.path), true);
	}

	/** Whether the Packs button is ticked: only then is the Packs scan worth its 60,000 rows. */
	private packsWanted(): boolean {
		return this.sources.some((x) => x.kind === 'category' && x.name === PACKS_SOURCE && this.ticks.ticked.has(x.key));
	}

	/** Every category's tree, and the Packs' when asked, on this thread. */
	private scanCategoriesHere(index: IndexHandle, indexStamp: string, packs: boolean, ctx: { au: Map<string, AuComponent>; colors: Record<string, string | undefined> }): void {
		const t = Date.now();
		this.scanned = true;
		if (!this.kindCache) this.kindCache = loadKindCache(join(this.cacheDir, 'places-kind-cache.json'));
		const opts = { ...ctx, kindCache: this.kindCache };
		const roots = categoryRoots(index);
		if (packs) {
			const { tree, rows } = scanPacks(index, opts, roots);
			this.packsScan = { stamp: indexStamp, tree, roots: roots.filter((r) => r.source.startsWith('pack:')).map((r) => r.path) };
			logger.info('places: packs scanned', { component: 'places', rows, packs: this.packsScan.roots.length, ms: Date.now() - t });
			return;
		}
		const result = scanCategories(index, opts, roots);
		this.categoryScan = { stamp: indexStamp, result };
		logger.info('places: categories scanned', { component: 'places', rows: result.rows, roots: result.roots.length, ms: Date.now() - t });
	}

	/**
	 * Every category's tree, and the Packs' when that button is ticked, built
	 * by `scripts/scan-categories.ts` at low priority. When it lands the ticked
	 * categories rebuild from it; one asked for meanwhile runs after it. If
	 * the child cannot run, the build moves to this thread for good.
	 */
	private scanCategoriesInChild(indexStamp: string, dbFile: string): void {
		if (this.categoryChild) {
			this.categoryRescan = true;
			return;
		}
		const root = repoRoot();
		const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
		const script = join(root, 'scripts', 'scan-categories.ts');
		const fail = (why: string) => {
			logger.warn('places: the category build could not run in its own process; building here', { component: 'places', why });
			this.categoryChildFailed = true;
			setTimeout(() => this.rebuildTicked('categories: building here'), 0);
		};
		if (!existsSync(tsx) || !existsSync(script)) return fail('no tsx or script');
		const packs = this.packsWanted();
		const job = join(this.cacheDir, 'places-category-job.json');
		const outFile = join(this.cacheDir, 'places-category-scan.json');
		mkdirSync(this.cacheDir, { recursive: true });
		writeFileSync(job, JSON.stringify({ dbFile, kindCacheFile: join(this.cacheDir, 'places-kind-cache.json'), auDirs: this.auDirs, colors: brandColors(), packs, outFile }));
		const t0 = Date.now();
		const child = spawn(process.execPath, [tsx, '--tsconfig', join(root, 'interface', 'tsconfig.json'), script, job], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
		this.categoryChild = child;
		try {
			if (child.pid) setPriority(child.pid, 10);
		} catch {
			/* runs at normal priority */
		}
		let err = '';
		child.stderr?.on('data', (d) => (err += d));
		child.on('error', (e) => {
			this.categoryChild = null;
			fail(String(e));
		});
		child.on('close', (code, signal) => {
			if (this.categoryChild !== child) return;
			this.categoryChild = null;
			if (signal) return; // stopped with the server
			if (code !== 0) return fail(err.slice(-500) || `exit ${code}`);
			try {
				const t1 = Date.now();
				const out = JSON.parse(readFileSync(outFile, 'utf8')) as {
					categories: Record<string, PlaceFolder>;
					roots: CategoryScanResult['roots'];
					packs: { tree: PlaceFolder; roots: string[] } | null;
					rows: number;
				};
				this.categoryScan = { stamp: indexStamp, result: { trees: new Map(Object.entries(out.categories)) as CategoryScanResult['trees'], roots: out.roots, rows: out.rows } };
				if (out.packs) this.packsScan = { stamp: indexStamp, ...out.packs };
				// The child added to the kind cache on disk: read it again rather than write the older copy over it.
				this.kindCache = null;
				logger.info('places: categories built in their own process', { component: 'places', rows: out.rows, packs: !!out.packs, ms: t1 - t0, readMs: Date.now() - t1 });
			} catch (e) {
				return fail(String(e));
			}
			if (this.categoryRescan) {
				this.categoryRescan = false;
				this.categoryStampRead = null;
			}
			this.rebuildTicked('categories scanned');
		});
	}

	/** The catalog of a shaped tree; null when it is the one already held (its stamp is moved on). */
	private finishBuild(
		s: LibrarySource,
		id: string,
		role: string | null,
		source: CatalogSource,
		stamp: string,
		t: number,
		tree: PlaceFolder,
		have: BuiltCatalog | undefined,
		roots?: string[],
		split = false
	): BuiltCatalog | null {
		const kinds = tree.kinds ?? {};
		let parts: Record<string, PlaceFolder> | undefined;
		if (split) {
			parts = {};
			const folders: Record<string, PlaceFolder> = {};
			for (const [name, folder] of Object.entries(tree.folders)) {
				const slug = folderSlug(name) || 'part';
				let file = `${id}~${slug}.json`;
				for (let n = 2; parts[file]; n++) file = `${id}~${slug}-${n}.json`;
				parts[file] = folder;
				folders[name] = { ...folder, folders: {}, presets: [], external: file };
			}
			tree.folders = folders;
		}
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
			...(roots ? { roots } : {}),
			...(parts ? { parts } : {}),
			content: createHash('sha1').update(JSON.stringify([source, role, s.name, s.icon, id, tree, samples, parts ?? null])).digest('hex')
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
		this.categoryStampRead = null;
		this.categoryScan = null;
		this.packsScan = null;
		this.categoryChild?.kill();
		this.categoryChild = null;
		try {
			for (const f of readdirSync(this.catalogCacheDir())) if (f.endsWith('.json')) unlinkSync(join(this.catalogCacheDir(), f));
		} catch {
			/* nothing cached */
		}
		this.rebuildTicked('forced');
	}

	// --- thumbnails, in the background ----------------------------------------

	/**
	 * What one bake pass works through: each catalog's own tree (and Samples)
	 * not baked yet, and each part a client has opened and that is not baked
	 * yet. A part waits to be opened: the Packs' 43,000 samples and Drums'
	 * 12,000 are no work until someone looks.
	 */
	private bakeUnits(): BakeUnit[] {
		const units: BakeUnit[] = [];
		for (const c of this.catalogs.values()) {
			if (!c.baked) {
				units.push({
					c,
					label: c.name,
					folders: [c.tree, ...(c.samples ? [c.samples] : [])],
					done: () => {
						c.baked = true;
					}
				});
			}
			for (const file of Object.keys(c.parts ?? {})) {
				if (!this.openedParts.has(`${c.key}\t${file}`) || c.partsBaked?.includes(file)) continue;
				units.push({
					c,
					label: `${c.name} ${c.parts![file].name}`,
					folders: [c.parts![file]],
					done: () => {
						c.partsBaked = [...(c.partsBaked ?? []), file];
					}
				});
			}
		}
		return units;
	}

	private scheduleBake(): void {
		const wave = (runtimeConstants().ui as { browser?: { audioWaveforms?: boolean } } | undefined)?.browser?.audioWaveforms;
		if (wave === false) return;
		if (this.baking) {
			this.rebuildQueued = true;
			return;
		}
		const pending = this.bakeUnits();
		if (!pending.length) return;
		this.baking = true;
		setTimeout(() => void this.bake(pending), 50);
	}

	private async bake(pending: BakeUnit[]): Promise<void> {
		// One bump for the whole pass, and only when a thumbnail was decoded:
		// a pass that reused every cached one changed nothing a page shows.
		let decoded = 0;
		const peaksCache = join(this.cacheDir, 'places-peaks-cache.json');
		const failureLog = join(this.cacheDir, 'places-peaks-failures.json');
		try {
			const itemsOf = (u: BakeUnit): PlaceItem[] => {
				const items: PlaceItem[] = [];
				const collect = (n: PlaceFolder) => {
					for (const p of n.presets) if (p.kind === 'sample' || p.kind === 'audio-clip') items.push(p);
					for (const child of Object.values(n.folders)) collect(child);
				};
				for (const f of u.folders) collect(f);
				return items;
			};
			// Decode in a low-priority process of its own, so a cold bake leaves
			// this server (and Live) responsive; the pass below then reads every
			// thumbnail back from the cache. Without the child it decodes here.
			const paths = [...new Set(pending.flatMap((u) => itemsOf(u).map((p) => p.fullPath)))];
			const t0 = Date.now();
			const child = paths.length ? await this.decodeInChild(paths, peaksCache, failureLog) : null;
			if (child?.stopped) return;
			if (child) {
				decoded += child.decoded;
				logger.info('places: thumbnails decoded in the background', { component: 'places', ...child, ms: Date.now() - t0 });
			}
			const touched = new Set<BuiltCatalog>();
			for (const u of pending) {
				if (this.catalogs.get(u.c.key) !== u.c) continue; // rebuilt meanwhile
				const items = itemsOf(u);
				if (items.length) {
					const t = Date.now();
					const stats = await bakeThumbnails(items, peaksCache, child ? undefined : failureLog, {
						log: (line) => logger.debug(line.trim(), { component: 'places' }),
						keepUnseen: true
					});
					const { failures: _failures, ...summary } = stats;
					logger.info('places: thumbnails baked', { component: 'places', place: u.label, ...summary, ms: Date.now() - t });
					decoded += stats.decoded;
				}
				if (this.catalogs.get(u.c.key) !== u.c) continue;
				u.done();
				touched.add(u.c);
			}
			for (const c of touched) this.writeCache(c);
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

	/** The folders of every Place the browser has a catalog of: what a preset read may open (`/api/places/preset-params`). */
	catalogRoots(): string[] {
		return this.sources.filter((s) => this.catalogs.has(s.key)).flatMap((s) => this.catalogs.get(s.key)!.roots ?? [s.path]);
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
					...(s.kind === 'category' ? {} : { source: loadSource(s) }),
					file: `${c.id}.json`,
					samplesFile: c.samples ? `${c.id}-samples.json` : undefined,
					totalItems: c.totalItems,
					kinds: c.kinds,
					...(this.isEffectsPlace(s) ? { effects: true, hidden: !this.ticks.ticked.has(s.key) } : {})
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
	private catalogOf(name: string): { c: BuiltCatalog; samples: boolean; part?: PlaceFolder } | null {
		for (const c of this.catalogs.values()) {
			const part = c.parts?.[name];
			if (part) return { c, samples: false, part };
		}
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
		const part = hit.part ? `${name}:${!!hit.c.partsBaked?.includes(name)}` : '';
		return `"${keyHash(`${hit.c.content ?? hit.c.stamp}:${hit.c.builtAt}:${hit.c.baked}:${hit.samples}:${part}`)}"`;
	}

	/** `<id>.json`, `<id>-samples.json` or one of a catalog's parts (`<id>~<slug>.json`), or null. */
	fileJson(name: string): unknown | null {
		const hit = this.catalogOf(name);
		if (hit?.part) {
			// Opened: its samples are worth baking now.
			const opened = `${hit.c.key}\t${name}`;
			if (!this.openedParts.has(opened)) {
				this.openedParts.add(opened);
				this.scheduleBake();
			}
			return {
				metadata: { placeId: hit.c.id, name: hit.part.name, generatedAt: hit.c.builtAt },
				tree: { folders: hit.part.folders, presets: hit.part.presets, kinds: hit.part.kinds }
			};
		}
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
	// The slot outlives a dev server's reload of this module, so one watcher
	// serves every request; but an instance of the class before an edit runs
	// the old code until a restart (2026-10-25: a running `npm run dev` never
	// cataloged the effects Place). A new class replaces it. In production the
	// module loads once, so this never fires.
	const held = g[SLOT];
	if (held && !(held instanceof PlacesService)) {
		(held as { stop?: () => void }).stop?.();
		g[SLOT] = undefined;
	}
	if (!g[SLOT]) {
		g[SLOT] = new PlacesService();
		g[SLOT].start();
	}
	return g[SLOT];
}

/** A service of its own, for tests and tools: nothing shared, no poll unless asked. */
export function createPlacesService(opts: PlacesServiceOptions): PlacesService {
	const s = new PlacesService({ poll: false, categoriesInline: true, ...opts });
	s.start();
	return s;
}

