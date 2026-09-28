/**
 * The disk scan: a Place's folder walked into the browser's catalog shape,
 * each item with a kind read from the file itself. This is the catalog
 * builder of `scripts/generate-places-catalog.ts` (the browser-places plan,
 * 2026-09-24) moved into the server on 2026-09-26, where the Places service
 * (`service.ts`) runs it at runtime for any ticked Place — and keeps it as the
 * fallback when Live's index cannot be read (`indexScan.ts`).
 *
 * **What is in a Place.** Everything the browser can put on a track:
 * - `.aupreset`: the AU type (`aumu` instrument, `aufx`/`aumf` effect), the
 *   plug-in and its maker (matched against the installed AU components'
 *   `Info.plist`), the patch name, and whether that plug-in is installed. The
 *   codes sit in the first or the last 4 KB of the plist (measured over 1,593
 *   files: Komplete Kontrol writes them first, Omnisphere last, after its
 *   `data`), so a preset costs 8 KB of reading, not its whole size.
 * - `.adg` / `.adv`: the rack or device class, from the head of the gzipped XML.
 * - `.amxd`: the Max device type in its header.
 * - `.alc`: an audio clip (it carries a `SampleRef`), a MIDI clip, or `clip`
 *   (the old binary format, unreadable).
 * - `.wav` `.aif` `.aiff` `.mp3` `.flac` `.m4a` `.ogg`: a sample, by extension.
 *   Links to files are followed. A device inside an `Ableton Folder Info`
 *   folder (Live's device bundle) is listed in the bundle's parent, as Live
 *   shows it; the folder itself is not.
 * A per-file cache keyed on size and mtime makes a rebuild cost the walk.
 *
 * **Shape.** `{folders, presets}` trees of `PlaceFolder`, each item carrying
 * `kind` and the plug-in fields, per-kind `kinds` counts on every folder.
 * `shapePlace` collapses single-folder chains, caps nesting with the per-Place
 * `catalog.places.<Name>` tuning (`maxFolderDepth`, `flattenFolders`,
 * `keepNestingFolders`), keeps each Place's `Samples` folder fully nested,
 * sorts and annotates. The same shaping serves the index scan.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { spawnSync } from 'child_process';

import { capFolderDepth } from './catalogShape';
import { type Manifest } from './placesManifest';
import { aliasPresetPath, folderSlug, type PlaceAliasMap } from '$lib/utils/presetPath';
import { type LivePlace } from '../libraryCfg';
import { PLACE_SAMPLES_FOLDER, type ItemKind, type KindCounts } from '$lib/utils/placeKinds';

const COMPONENT_DIRS = ['/Library/Audio/Plug-Ins/Components', path.join(process.env.HOME ?? '', 'Library/Audio/Plug-Ins/Components')];
/** Bump when the kind reading changes, so the per-file cache is re-read. */
const KIND_CACHE_VERSION = 1;
export const SAMPLES_FOLDER = PLACE_SAMPLES_FOLDER;

export const PRESET_EXTENSIONS = new Set(['.adg', '.adv', '.aupreset', '.amxd']);
export const SAMPLE_EXTENSIONS = new Set(['.wav', '.aif', '.aiff', '.mp3', '.flac', '.m4a', '.ogg']);
export const CLIP_EXTENSION = '.alc';
const SKIP_NAMES = new Set(['Icon\r']);
/** Live's device bundle: a folder whose devices show in the browser as if they sat beside it (live-index-measurements.md, rule 4). */
const DEVICE_BUNDLE_FOLDER = 'Ableton Folder Info';

// ─── Types ───────────────────────────────────────────────────────────────

export interface PlaceItem {
	name: string;
	/** `<Place>/<folders>/<file>` — the shape ADR-403 grouping reads (the type catalogs' was `<Vendor>/<Type>/…`). */
	path: string;
	fullPath: string;
	type: string;
	variants: string[];
	kind: ItemKind;
	vendorColor?: string;
	/** Plug-in presets: the plug-in, its maker, the patch name when it is not the file's, and whether it is installed. */
	plugin?: string;
	maker?: string;
	patch?: string;
	installed?: boolean;
	peaks?: string;
}

export interface PlaceFolder {
	name: string;
	path: string;
	folders: Record<string, PlaceFolder>;
	presets: PlaceItem[];
	vendorColor: string | null;
	kinds?: KindCounts;
	/** A folder whose contents live in another file of `places/` (a Place's Samples), fetched when it is opened. */
	external?: string;
}

export interface KindInfo {
	kind: ItemKind;
	au?: string;
	patch?: string;
}

export interface AuComponent {
	name: string;
	plugin: string;
	maker: string;
}

// ─── Reading kinds ───────────────────────────────────────────────────────

/** An AU code integer as its four characters (`1635085685` → `aumu`). */
export function fourCC(n: number): string {
	const u = n >>> 0;
	return String.fromCharCode((u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff);
}

/** The AU identity in a slice of an `.aupreset` plist, or null when this slice lacks it. */
export function auIdentity(text: string): { type: string; subtype: string; manufacturer: string; name?: string } | null {
	const ints: Record<string, number> = {};
	for (const m of text.matchAll(/<key>(manufacturer|subtype|type)<\/key>\s*<integer>(-?\d+)<\/integer>/g)) {
		ints[m[1]] = Number(m[2]);
	}
	if (ints.manufacturer === undefined || ints.subtype === undefined || ints.type === undefined) return null;
	const name = /<key>name<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1];
	return {
		type: fourCC(ints.type),
		subtype: fourCC(ints.subtype),
		manufacturer: fourCC(ints.manufacturer),
		name: name === undefined ? undefined : decodeXml(name)
	};
}

function decodeXml(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&amp;/g, '&');
}

function readSlices(file: string, bytes: number): { head: Buffer; tail: Buffer } {
	const fd = fs.openSync(file, 'r');
	try {
		const size = fs.fstatSync(fd).size;
		const head = Buffer.alloc(Math.min(bytes, size));
		fs.readSync(fd, head, 0, head.length, 0);
		const tail = Buffer.alloc(Math.min(bytes, size));
		fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
		return { head, tail };
	} finally {
		fs.closeSync(fd);
	}
}

/** The start of a gzipped file's text, without inflating the rest. */
function gzipHead(file: string, compressedBytes = 16384): string {
	const fd = fs.openSync(file, 'r');
	try {
		const buf = Buffer.alloc(compressedBytes);
		const n = fs.readSync(fd, buf, 0, compressedBytes, 0);
		return zlib.gunzipSync(buf.subarray(0, n), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8');
	} finally {
		fs.closeSync(fd);
	}
}

/** Live instrument device classes (the LOM class names an `.adv` preset's root element carries). */
const LIVE_INSTRUMENTS = new Set([
	'MultiSampler', 'OriginalSimpler', 'InstrumentMeld', 'Drift', 'Collision', 'InstrumentVector', 'Operator',
	'UltraAnalog', 'LoungeLizard', 'StringStudio', 'InstrumentImpulse', 'DrumCell', 'MxDeviceInstrument'
]);

/** Classify a Live device preset from the head of its XML. */
export function liveDeviceKind(xml: string, ext: string): ItemKind {
	if (ext === '.adg') {
		const group = /<Device>\s*<(\w+)/.exec(xml)?.[1];
		if (group === 'DrumGroupDevice') return 'drum-rack';
		if (group === 'InstrumentGroupDevice') return 'instrument-rack';
		if (group === 'AudioEffectGroupDevice') return 'effect-rack';
		if (group === 'MidiEffectGroupDevice') return 'midi-effect-rack';
		return 'unknown';
	}
	const device = /<Ableton\b[^>]*>\s*<(\w+)/.exec(xml)?.[1];
	if (!device) return 'unknown';
	if (LIVE_INSTRUMENTS.has(device)) return 'instrument';
	if (device === 'MxDeviceMidiEffect' || device.startsWith('Midi')) return 'midi-effect';
	return 'audio-effect';
}

/** A Max device's type, from the four-character code at offset 8 of its header. */
export function maxDeviceKind(header: Buffer): ItemKind {
	if (header.subarray(0, 4).toString('latin1') !== 'ampf') return 'unknown';
	const code = header.subarray(8, 12).toString('latin1');
	if (code === 'iiii') return 'max-instrument';
	if (code === 'mmmm') return 'max-midi-effect';
	if (code === 'aaaa') return 'max-audio-effect';
	return 'unknown';
}

export function readKind(file: string, ext: string): KindInfo {
	try {
		if (ext === '.aupreset') {
			const { head, tail } = readSlices(file, 4096);
			let id = auIdentity(head.toString('utf8')) ?? auIdentity(tail.toString('utf8'));
			if (!id) id = auIdentity(fs.readFileSync(file, 'utf8'));
			if (!id) return { kind: 'unknown' };
			const kind: ItemKind = id.type === 'aumu' ? 'plugin-instrument' : id.type === 'aufx' || id.type === 'aumf' ? 'plugin-effect' : 'unknown';
			// Komplete Kontrol writes its library path as the name; the patch is its last segment.
			const patch = id.name ? path.basename(id.name).replace(/\.aupreset$/i, '') : undefined;
			return { kind, au: `${id.type}|${id.subtype}|${id.manufacturer}`, patch };
		}
		if (ext === '.adg' || ext === '.adv') return { kind: liveDeviceKind(gzipHead(file), ext) };
		if (ext === '.amxd') return { kind: maxDeviceKind(readSlices(file, 16).head) };
		if (ext === CLIP_EXTENSION) {
			if (readSlices(file, 4).head.equals(Buffer.from([0xab, 0x1e, 0x56, 0x78]))) return { kind: 'clip' };
			const xml = gzipHead(file, 65536);
			if (/<SampleRef>/.test(xml)) return { kind: 'audio-clip' };
			if (/<MidiClip\b/.test(xml)) return { kind: 'midi-clip' };
			return { kind: 'clip' };
		}
	} catch {
		// Unreadable: say so rather than guess.
	}
	return { kind: 'unknown' };
}

export type KindCache = Map<string, { size: number; mtimeMs: number; info: KindInfo }>;

export function loadKindCache(file: string): KindCache {
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (raw?.v !== KIND_CACHE_VERSION) return new Map();
		return new Map(Object.entries(raw.entries ?? {}));
	} catch {
		return new Map();
	}
}

export function saveKindCache(file: string, cache: KindCache): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ v: KIND_CACHE_VERSION, entries: Object.fromEntries(cache) }));
	fs.renameSync(tmp, file);
}

/** The installed AU components, `type|subtype|manufacturer` → plug-in and maker. */
export function installedAuComponents(dirs: string[] = COMPONENT_DIRS): Map<string, AuComponent> {
	const map = new Map<string, AuComponent>();
	for (const dir of dirs) {
		let names: string[] = [];
		try {
			names = fs.readdirSync(dir).filter((n) => n.endsWith('.component'));
		} catch {
			continue;
		}
		for (const n of names) {
			const plist = path.join(dir, n, 'Contents', 'Info.plist');
			const r = spawnSync('plutil', ['-extract', 'AudioComponents', 'json', '-o', '-', plist], { encoding: 'utf8' });
			if (r.status !== 0) continue;
			try {
				for (const c of JSON.parse(r.stdout) as Array<Record<string, string>>) {
					if (!c.type || !c.subtype || !c.manufacturer) continue;
					const full = c.name ?? n.replace(/\.component$/, '');
					const [maker, plugin] = full.includes(': ') ? full.split(/: (.*)/s, 2) : ['', full];
					map.set(`${c.type}|${c.subtype}|${c.manufacturer}`, { name: full, plugin, maker });
				}
			} catch {
				// A component with an odd plist is just not listed.
			}
		}
	}
	return map;
}

// ─── Which Places ────────────────────────────────────────────────────────

export interface PlaceSpec {
	id: string;
	name: string;
	path: string;
	icon: string;
}

function isUnder(p: string, root: string): boolean {
	const r = root.replace(/\/+$/, '');
	return p === r || p.startsWith(`${r}/`);
}

/**
 * The Places under `sidebarRoot`, in Live's sidebar order. `places` is
 * `Library.cfg`'s list, or null when it could not be read — then the root's
 * own folders stand in, alphabetically. Ids are the name's slug, numbered on a
 * clash.
 */
export function placesUnder(sidebarRoot: string, places: LivePlace[] | null, listDir: (p: string) => string[]): PlaceSpec[] {
	const chosen: LivePlace[] =
		places !== null
			? places.filter((p) => isUnder(p.path, sidebarRoot) && p.path.replace(/\/+$/, '') !== sidebarRoot.replace(/\/+$/, ''))
			: listDir(sidebarRoot)
					.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
					.map((name) => ({ path: path.join(sidebarRoot, name), name, icon: '' }));
	const used = new Set<string>();
	return chosen.map((p) => {
		let id = folderSlug(p.name) || 'place';
		for (let n = 2; used.has(id); n++) id = `${folderSlug(p.name)}-${n}`;
		used.add(id);
		return { id, name: p.name, path: p.path.replace(/\/+$/, ''), icon: p.icon };
	});
}

// ─── Scanning ────────────────────────────────────────────────────────────

export interface ScanContext {
	kindCache: KindCache;
	newKindCache: KindCache;
	au: Map<string, AuComponent>;
	colors: Record<string, string | undefined>;
	stats: { read: number; reused: number };
}

/**
 * A tile's color, from what the file is rather than the folder it came from:
 * samples and clips take the audio color, a plug-in preset its maker's
 * (Omnisphere → Omni, Komplete Kontrol → NI), and a Live preset Ableton's —
 * the `vendors.brands` palette, so the Places browser reads like the old one.
 */
export function tintFor(item: Pick<PlaceItem, 'kind' | 'maker' | 'type'>, colors: Record<string, string | undefined>): string | undefined {
	if (item.type === '.aupreset') {
		if (item.maker === 'Spectrasonics') return colors.Omni;
		if (item.maker === 'Native Instruments') return colors.NI;
		return undefined;
	}
	if (SAMPLE_EXTENSIONS.has(item.type) || item.type === CLIP_EXTENSION) return colors.Audio;
	return colors.Ableton;
}

function kindOfFile(file: string, ext: string, st: fs.Stats, ctx: ScanContext): KindInfo {
	if (SAMPLE_EXTENSIONS.has(ext)) return { kind: 'sample' };
	const cached = ctx.kindCache.get(file);
	// Whole seconds: Live's index records `mod_date` in seconds, and the index
	// scan fills this same cache from it (`indexScan.ts`).
	if (cached && cached.size === st.size && Math.floor(cached.mtimeMs / 1000) === Math.floor(st.mtimeMs / 1000)) {
		ctx.newKindCache.set(file, cached);
		ctx.stats.reused++;
		return cached.info;
	}
	const info = readKind(file, ext);
	ctx.newKindCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, info });
	ctx.stats.read++;
	return info;
}

/** Scan one Place's folder into a raw tree (unshaped, unsorted). */
export function scanPlace(root: string, placeName: string, ctx: ScanContext): PlaceFolder {
	const seenDirs = new Set<string>();
	const walk = (dir: string, rel: string): PlaceFolder => {
		const node: PlaceFolder = { name: path.basename(dir), path: rel, folders: {}, presets: [], vendorColor: null };
		let real: string;
		try {
			real = fs.realpathSync(dir);
		} catch {
			return node;
		}
		if (seenDirs.has(real)) return node; // a linked folder cycle
		seenDirs.add(real);
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return node;
		}
		for (const e of entries) {
			if (e.name.startsWith('.') || SKIP_NAMES.has(e.name)) continue;
			const full = path.join(dir, e.name);
			const childRel = `${rel}/${e.name}`;
			let st: fs.Stats;
			try {
				st = fs.statSync(full); // follows links: samples are links
			} catch {
				continue; // broken link
			}
			if (st.isDirectory()) {
				if (e.name === DEVICE_BUNDLE_FOLDER) {
					// The bundle's devices belong to this folder, as Live's browser
					// and its index both show them (the index scan does the same).
					for (const p of walk(full, rel).presets) node.presets.push(p);
					continue;
				}
				node.folders[e.name] = walk(full, childRel);
				continue;
			}
			if (!st.isFile()) continue;
			const ext = path.extname(e.name).toLowerCase();
			if (!PRESET_EXTENSIONS.has(ext) && !SAMPLE_EXTENSIONS.has(ext) && ext !== CLIP_EXTENSION) continue;
			const info = kindOfFile(full, ext, st, ctx);
			const item: PlaceItem = {
				name: e.name.slice(0, e.name.length - ext.length),
				path: childRel,
				fullPath: full,
				type: ext,
				variants: [e.name],
				kind: info.kind
			};
			if (info.au) {
				const component = ctx.au.get(info.au);
				item.installed = !!component;
				if (component) {
					item.plugin = component.plugin;
					item.maker = component.maker;
				}
				if (info.patch && info.patch !== item.name) item.patch = info.patch;
			}
			const tint = tintFor(item, ctx.colors);
			if (tint) item.vendorColor = tint;
			node.presets.push(item);
		}
		return node;
	};
	return walk(root, placeName);
}

// ─── Shaping ─────────────────────────────────────────────────────────────

/** Collapse a folder that holds exactly one folder and no items into that folder, keeping its name and path. */
export function collapseSingleChains(node: PlaceFolder): PlaceFolder {
	const folders: Record<string, PlaceFolder> = {};
	for (const [name, child] of Object.entries(node.folders)) folders[name] = collapseSingleChains(child);
	const keys = Object.keys(folders);
	if (keys.length === 1 && node.presets.length === 0) {
		const only = folders[keys[0]];
		return { ...node, folders: only.folders, presets: only.presets };
	}
	return { ...node, folders };
}

const byNameCI = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * Put folders and items in the order the disk lists them (code-unit order on
 * APFS, measured over the rig's 3,390 Sidebar folders), before the depth cap:
 * a flattened folder keeps the FIRST of two same-named presets, so the walk's
 * order decides which copy survives. Live's index lists in its own order, and
 * without this it kept the other copy of 9,876 of the rig's flattened presets.
 */
function diskOrder(node: PlaceFolder): PlaceFolder {
	const folders: Record<string, PlaceFolder> = {};
	for (const key of Object.keys(node.folders).sort(byCodeUnit)) folders[key] = diskOrder(node.folders[key]);
	return { ...node, folders, presets: [...node.presets].sort((a, b) => byCodeUnit(fileName(a.fullPath), fileName(b.fullPath))) };
}

/** Sort folder keys and items A→Z at every level (ADR-391). */
export function sortTree(node: PlaceFolder): PlaceFolder {
	const folders: Record<string, PlaceFolder> = {};
	for (const key of Object.keys(node.folders).sort(byNameCI)) folders[key] = sortTree(node.folders[key]);
	return { ...node, folders, presets: [...node.presets].sort((a, b) => byNameCI(a.name, b.name)) };
}

/** Per-kind counts and a folder color: the one tint every item under it shares, else null. */
export function annotate(node: PlaceFolder): { kinds: KindCounts; tints: Set<string | undefined> } {
	const kinds: KindCounts = {};
	const tints = new Set<string | undefined>();
	for (const item of node.presets) {
		kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
		tints.add(item.vendorColor);
	}
	for (const child of Object.values(node.folders)) {
		const sub = annotate(child);
		for (const [k, n] of Object.entries(sub.kinds)) kinds[k as ItemKind] = (kinds[k as ItemKind] ?? 0) + (n ?? 0);
		for (const t of sub.tints) tints.add(t);
	}
	node.kinds = kinds;
	node.vendorColor = tints.size === 1 ? ([...tints][0] ?? null) : null;
	return { kinds, tints };
}

export interface PlaceTuning {
	maxFolderDepth?: number;
	flattenFolders?: string[];
	keepNestingFolders?: string[];
	role?: string | null;
}

/** Shape one scanned Place the way the type catalogs were shaped: collapse chains, cap depth (Samples kept nested), sort, annotate. */
export function shapePlace(raw: PlaceFolder, tuning: Required<Omit<PlaceTuning, 'role'>>): PlaceFolder {
	const ordered = diskOrder(raw);
	const collapsed: Record<string, PlaceFolder> = {};
	for (const [name, child] of Object.entries(ordered.folders)) collapsed[name] = collapseSingleChains(child);
	// The Samples folder keeps full nesting, as the audio catalogs did: a
	// keep-nesting chain matches it (and anything under it) as a whole segment.
	const keep = [...tuning.keepNestingFolders, `${raw.path}/${SAMPLES_FOLDER}`];
	const capped = capFolderDepth(
		{ folders: collapsed as never, presets: ordered.presets as never },
		tuning.maxFolderDepth,
		tuning.flattenFolders,
		keep,
		new Set<string>()
	) as unknown as { folders: Record<string, PlaceFolder>; presets: PlaceItem[] };
	const shaped = sortTree({ ...raw, folders: capped.folders, presets: capped.presets });
	annotate(shaped);
	return shaped;
}

// ─── Aliases ─────────────────────────────────────────────────────────────

/** Old path → new path (`presetPath.aliasPresetPath` applies it, in the app and here). */
export type AliasMap = PlaceAliasMap;

/** Old path → new path, from the copy manifest: one rule per source, plus every entry the rule would get wrong. */
export function aliasMapFrom(manifest: Pick<Manifest, 'sources' | 'entries'>): AliasMap {
	const rules = manifest.sources.map((s) => ({ from: `${s.root}/`, to: `${s.dest}/` }));
	const exceptions: Record<string, string> = {};
	for (const e of manifest.entries) {
		if (e.a === 'd') continue;
		if (applyAlias({ rules, exceptions: {} }, e.s) !== e.d) exceptions[e.s] = e.d;
	}
	return { rules, exceptions };
}

/** The new path for `oldPath` — the app's own function, so the builder and the app cannot disagree. */
export const applyAlias = aliasPresetPath;

