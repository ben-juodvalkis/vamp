/**
 * Places Adapter — the browser on Live's sidebar Places (browser-places plan).
 * The browser's only catalog since the cutover (2026-09-24), which removed the
 * type catalogs with the old library layout.
 *
 * Reads `scripts/generate-places-catalog.ts`'s output:
 *   - `/data/places/index.json`: the Places in Live's sidebar order (read from
 *     `Library.cfg`), each with its role, icon, per-kind counts and catalog
 *     file, plus the alias map (old path → new path) from the copy's manifest;
 *   - `/data/places/<id>.json`: one Place's tree of `FolderNode`s, each item
 *     carrying a `kind` read from the file;
 *   - `/data/places/<id>-samples.json`: that Place's `Samples` folder, which
 *     the Place's tree holds as an `external` stub — fetched the first time
 *     the folder is opened, so opening Inst costs its 2.7 MB and not the
 *     24 MB of its samples.
 *
 * **The kind filter** (the header's Instrument | Simpler | Clip switch: presets, audio, or
 * audio and MIDI clips) narrows every read: a folder shows when anything under it
 * is of a chosen group (its `kinds` counts say so, with no descent), an item
 * when its own kind is. `null` shows everything.
 *
 * **Every item is stamped with its Place's role** (`Preset.role`) when the
 * Place loads: a load hands it to track coloring as the answer. A path's shape
 * cannot say it — `Drum/Synth/x` would read `synth`, the 13,504-file mistake
 * of 2026-09-18 under the old layout.
 */

import type { BrowserAdapter, FolderNode, Preset, VendorInfo, GroupedFolders } from './browserAdapter';
import { collectPresetsRecursive, deduplicatePresetsByName, findPresetInTree } from './adapterUtils';
import { canLoad, groupOfKind, type KindCounts, type KindGroup } from '$lib/utils/placeKinds';
import type { PlaceAliasMap } from '$lib/utils/presetPath';
import { logger } from '$lib/utils/logger';

export const PLACE_VENDOR_PREFIX = 'place:';

/** A rail vendorId for a Place id (`drum` → `place:drum`). */
export function placeVendorId(placeId: string): string {
	return `${PLACE_VENDOR_PREFIX}${placeId}`;
}

/** Whether a vendorId names a Place. */
export function isPlaceVendorId(vendorId: string | null | undefined): boolean {
	return !!vendorId && vendorId.startsWith(PLACE_VENDOR_PREFIX);
}

export interface PlaceInfo {
	id: string;
	name: string;
	path: string;
	icon: string;
	role: string | null;
	/** The load source: `place:<name>`, `library` or `pack:<name>` (3.11.0). */
	source?: string;
	file: string;
	samplesFile?: string;
	totalItems: number;
	kinds: KindCounts;
}

export interface PlacesIndex {
	metadata: { generatedAt: string; sidebarRoot: string; source: string; totalItems: number; version?: number };
	places: PlaceInfo[];
	aliases: PlaceAliasMap;
}

interface PlaceFile {
	metadata: { placeId: string; name: string; path: string; role: string | null };
	tree: { folders: Record<string, FolderNode>; presets: Preset[]; kinds?: KindCounts };
}

let indexCache: PlacesIndex | null = null;
let indexPromise: Promise<PlacesIndex> | null = null;
/** The Mac's catalog version the memoized index carries; 0 before one arrived. `placesLive` compares the event stream against it. */
let fetchedVersion = 0;
/** The newest version the event stream has named; 0 before it opened. */
let streamVersion = 0;

export function fetchedPlacesVersion(): number {
	return fetchedVersion;
}

export function noteStreamVersion(version: number): void {
	streamVersion = version;
}

export async function getPlacesIndex(): Promise<PlacesIndex> {
	if (indexCache) return indexCache;
	if (!indexPromise) {
		indexPromise = fetch('/api/places/index.json')
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load api/places/index.json (${res.status})`);
				return res.json();
			})
			.then((data: PlacesIndex) => {
				indexCache = data;
				fetchedVersion = Number(data.metadata?.version ?? 0) || 0;
				// The stream named a newer catalog while this was in flight (a
				// bump between the request and the answer): read it again. The
				// memo is dropped so the next read is a fetch, not this one.
				if (streamVersion > fetchedVersion && typeof window !== 'undefined') {
					clearPlacesIndexCache();
					window.dispatchEvent(new CustomEvent('places-changed', { detail: { version: streamVersion } }));
				}
				return data;
			})
			.catch((err) => {
				// A rejected promise left memoized would replay one transient
				// failure for the whole session.
				indexPromise = null;
				throw err;
			});
	}
	return indexPromise;
}

export function clearPlacesIndexCache(): void {
	indexCache = null;
	indexPromise = null;
	fetchedVersion = 0;
	changeEpoch++;
}

// ── Reading a Place's files: draw first, check after ──
//
// A Place's file is read from Safari's copy without first asking the Mac
// whether it changed (`force-cache`), so opening a Place is a parse rather
// than a round trip; the question follows in the background (`recheck`), and
// a changed file re-reads the level in place. Right after a change the Mac
// announced, a file this page read before is read strictly once, so it is not
// drawn stale and then redrawn.

/** Bumped on every change the page hears of (`clearPlacesIndexCache`). */
let changeEpoch = 0;
/** The change epoch each file was last read in, this session. */
const readAt = new Map<string, number>();

export function _resetPlaceReadsForTests(): void {
	readAt.clear();
	changeEpoch = 0;
}

async function readPlaceFile(url: string): Promise<PlaceFile> {
	const at = readAt.get(url);
	const strict = at !== undefined && at < changeEpoch;
	const res = await fetch(url, { cache: strict ? 'no-cache' : 'force-cache' });
	if (!res.ok) throw new Error(`Failed to load ${url.replace(/^\//, '')} (${res.status})`);
	const data = (await res.json()) as PlaceFile;
	readAt.set(url, changeEpoch);
	if (!strict) recheck(url, res.headers?.get('etag') ?? null);
	return data;
}

/**
 * Ask the Mac whether the file drawn from Safari's copy is current. When it
 * is not, keep the new body (so the re-read finds it) and re-read as an
 * announced change would. The event stream reports changes while the page is
 * open; this catches one made while it was away (an iPad asleep).
 */
function recheck(url: string, drawn: string | null): void {
	if (!drawn || typeof window === 'undefined') return;
	void fetch(url, { cache: 'no-cache' })
		.then(async (res) => {
			const now = res.headers.get('etag');
			if (!res.ok || !now || now === drawn) {
				await res.body?.cancel();
				return;
			}
			await res.arrayBuffer();
			logger.info('A Place changed on the Mac while this page was away; re-reading', { component: 'placesAdapter', url });
			clearPlacesIndexCache();
			window.dispatchEvent(new CustomEvent('places-changed', { detail: { recheck: url } }));
		})
		.catch(() => {});
}

/** Whether anything counted in `kinds` is of one of `groups`; `null` groups = no filter. */
export function kindsMatch(kinds: KindCounts | undefined, groups: ReadonlySet<KindGroup> | null): boolean {
	if (!groups) return true;
	for (const [kind, n] of Object.entries(kinds ?? {})) {
		if (!n) continue;
		const g = groupOfKind(kind as never);
		if (g && groups.has(g)) return true;
	}
	return false;
}

function itemMatches(p: Preset, groups: ReadonlySet<KindGroup> | null): boolean {
	if (!groups) return true;
	const g = groupOfKind(p.kind);
	return !!g && groups.has(g);
}

/** Every item takes its Place's role, and where it lives (`source`, `placePath`) for a load that names the Place. */
function stampPlace(node: { folders: Record<string, FolderNode>; presets: Preset[] }, info: Pick<PlaceInfo, 'role' | 'source' | 'path'>): void {
	for (const p of node.presets) {
		p.role = info.role;
		if (info.source) {
			p.source = info.source;
			p.placePath = info.path;
		}
	}
	for (const child of Object.values(node.folders)) stampPlace(child, info);
}

export class PlacesAdapter implements BrowserAdapter {
	private file: PlaceFile | null = null;
	private filePromise: Promise<PlaceFile | null> | null = null;
	private externals = new Map<string, Promise<boolean>>();
	private groups: ReadonlySet<KindGroup> | null = null;

	constructor(private placeId: string) {}

	/** The header chips' choice: the groups to show, or `null` for everything. */
	setKindFilter(groups: Iterable<KindGroup> | null): void {
		this.groups = groups ? new Set(groups) : null;
	}

	getKindFilter(): ReadonlySet<KindGroup> | null {
		return this.groups;
	}

	private async info(): Promise<PlaceInfo | null> {
		const index = await getPlacesIndex();
		return index.places.find((p) => p.id === this.placeId) ?? null;
	}

	private async load(): Promise<PlaceFile | null> {
		if (this.file) return this.file;
		if (this.filePromise) return this.filePromise;
		this.filePromise = (async () => {
			const info = await this.info();
			if (!info) return null;
			const data = await readPlaceFile(`/api/places/${info.file}`);
			stampPlace(data.tree, info);
			this.file = data;
			return data;
		})()
			.catch((err) => {
				logger.error('Places catalog load failed', { component: 'placesAdapter', placeId: this.placeId, err });
				return null;
			})
			.finally(() => {
				this.filePromise = null;
			});
		return this.filePromise;
	}

	/**
	 * Fill an `external` folder in place from its own file, once. The stub keeps
	 * its name, path, color and counts; its folders and items arrive.
	 */
	private fillExternal(node: FolderNode, info: Pick<PlaceInfo, 'role' | 'source' | 'path'>): Promise<boolean> {
		const file = node.external!;
		let pending = this.externals.get(file);
		if (!pending) {
			pending = readPlaceFile(`/api/places/${file}`)
				.then((data: PlaceFile) => {
					stampPlace(data.tree, info);
					node.folders = data.tree.folders;
					node.presets = data.tree.presets;
					delete node.external;
					return true;
				})
				.catch((err) => {
					this.externals.delete(file);
					logger.error('Places samples load failed', { component: 'placesAdapter', file, err });
					return false;
				});
			this.externals.set(file, pending);
		}
		return pending;
	}

	private async placeStamp(file: PlaceFile): Promise<Pick<PlaceInfo, 'role' | 'source' | 'path'>> {
		const info = await this.info();
		return info ?? { role: file.metadata.role, source: undefined, path: file.metadata.path };
	}

	/** The node at `path`, filling any external folder on the way; the root for `[]`. */
	private async nodeAt(path: string[]): Promise<{ folders: Record<string, FolderNode>; presets: Preset[] } | null> {
		const file = await this.load();
		if (!file) return null;
		let node: { folders: Record<string, FolderNode>; presets: Preset[] } = file.tree;
		for (const segment of path) {
			const next: FolderNode | undefined = node.folders[segment];
			if (!next) return null;
			if (next.external) await this.fillExternal(next, await this.placeStamp(file));
			node = next;
		}
		return node;
	}

	async getVendors(): Promise<string[]> {
		const index = await getPlacesIndex();
		return index.places.map((p) => placeVendorId(p.id));
	}

	async getFolders(_vendorId: string, path: string[]): Promise<string[]> {
		const node = await this.nodeAt(path);
		if (!node) return [];
		return Object.entries(node.folders)
			.filter(([, f]) => kindsMatch(f.kinds, this.groups))
			.map(([name]) => name);
	}

	async getGroupedFolders(): Promise<GroupedFolders | null> {
		return null;
	}

	async getFolderColors(_vendorId: string, path: string[]): Promise<Record<string, string>> {
		const node = await this.nodeAt(path);
		if (!node) return {};
		const colors: Record<string, string> = {};
		for (const [name, f] of Object.entries(node.folders)) if (f.vendorColor) colors[name] = f.vendorColor;
		return colors;
	}

	async getPresets(_vendorId: string, path: string[], limit = 200, includeNested = false): Promise<Preset[]> {
		const node = await this.nodeAt(path);
		if (!node) return [];
		let items: Preset[];
		if (includeNested) {
			items = [];
			collectPresetsRecursive({ name: '', path: '', folders: node.folders, presets: node.presets }, items);
			items = deduplicatePresetsByName(items);
		} else {
			items = node.presets;
		}
		const filtered = this.groups ? items.filter((p) => itemMatches(p, this.groups)) : items;
		return limit === Infinity ? filtered : filtered.slice(0, limit);
	}

	private static readonly MAX_RANDOM_DEPTH = 5;

	async getRandomPreset(vendorId: string, path: string[], depth = 0): Promise<Preset> {
		if (depth >= PlacesAdapter.MAX_RANDOM_DEPTH) throw new Error(`No preset found in Place ${this.placeId}`);
		const node = await this.nodeAt(path);
		const all: Preset[] = [];
		if (node) {
			// A random pick never reaches into an unopened Samples file: holding a
			// Place's root picks among what is already loaded.
			collectPresetsRecursive({ name: '', path: '', folders: node.folders, presets: node.presets }, all);
		}
		// Only what a tap could load: never a greyed tile (a plug-in not
		// installed, an effect).
		const pool = deduplicatePresetsByName(all.filter((p) => itemMatches(p, this.groups) && canLoad(p.kind, p.installed)));
		if (pool.length === 0) {
			if (path.length > 0) return this.getRandomPreset(vendorId, path.slice(0, -1), depth + 1);
			throw new Error(`No preset found in Place ${this.placeId}`);
		}
		return pool[Math.floor(Math.random() * pool.length)];
	}

	/**
	 * The leaf holding `fullPath`, its index and the folder path to it — the
	 * swap pill's and a replace's lookup (ADR-439/441). Searches the Place's
	 * tree, and its Samples file when the path lies under the Place's Samples.
	 */
	async findPresetSiblings(fullPath: string): Promise<{ presets: Preset[]; index: number; path: string[] } | null> {
		const file = await this.load();
		if (!file || !fullPath) return null;
		const inTree = findPresetInTree(file.tree, fullPath);
		if (inTree) return inTree;
		for (const [name, folder] of Object.entries(file.tree.folders)) {
			if (!folder.external) {
				continue;
			}
			const root = `${file.metadata.path.replace(/\/+$/, '')}/${name}/`;
			if (!fullPath.startsWith(root)) continue;
			await this.fillExternal(folder, await this.placeStamp(file));
			const found = findPresetInTree(folder, fullPath);
			if (found) return { ...found, path: [name, ...found.path] };
		}
		return null;
	}

	async getVendorInfo(): Promise<VendorInfo> {
		const info = await this.info();
		if (!info) throw new Error(`Place not found: ${this.placeId}`);
		return { id: placeVendorId(info.id), name: info.name, trackType: 'midi' };
	}

	clearCache(): void {
		this.file = null;
		this.filePromise = null;
		this.externals.clear();
	}
}
