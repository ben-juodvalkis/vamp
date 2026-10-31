/**
 * The catalog from Live's own index (onboarding.plan.md §4–§5,
 * live-index-measurements.md): everything under a Place's folder, read from
 * `Live-files-<schema>.db` as a file — never through Live's thread — and
 * shaped exactly as the disk scan shapes it (`diskScan.shapePlace`).
 *
 * Measured on the rig on 2026-09-26: the index matches the disk kind for kind
 * in every Place, the User Library and all 82 Packs; listing the rig's seven
 * Sidebar Places takes about 0.1 s against 10.5 s for the forced disk scan.
 *
 * What the index gives that the file itself gave before:
 * - `.adg` / `.adv`: the device class in `files.device_id`
 *   (`device:ableton:instr:DrumGroupDevice`, `…:audiofx:AudioEffectGroupDevice`,
 *   `…:instr:Operator`), so no gzip head is read.
 * - `.aupreset`: `device_id` names the plug-in as
 *   `device:au:instr:<manufacturer>:<subtype>:<type>` in decimal, the same
 *   triple `Info.plist` carries, so the installed-components map answers the
 *   plug-in, its maker and whether it is installed, with no 8 KB read.
 * - `.amxd`: `device_type` (1 instrument, 2 audio effect, 4 MIDI effect).
 * - `.alc`: `subtype` is `alcA` for an audio clip, `alcM` for a MIDI clip.
 * - `mod_date` and `file_size`, which the thumbnail cache keys on.
 *
 * Rules (§4): roots come from `Library.cfg`, never the whole tree; links do
 * not appear (nor in Live's browser); a `/` in an index name is a `:` on disk;
 * a device inside `Ableton Folder Info` is Live's device bundle, shown as the
 * device with the folder hidden.
 *
 * Tags: `metadata` holds the tags a Pack ships (key 1264941431) and the ones a
 * user folder's tag file sets (key 1431004537 — Omnisphere-Tools writes the
 * Spectrasonics attributes there, its ADR 011), as `Group|Value` strings. An
 * item carries the values of `CARD_TAG_GROUPS` for its tile's labels. A copy of
 * a Pack preset in a user folder has no tags of its own (Live keys them by
 * file); one with no card tags borrows those of the Pack preset with the
 * same name and size, else — a bare device saved out of a Pack's rack keeps
 * the name but not the size or extension — of the Pack presets sharing its
 * name, when they all agree.
 *
 * Device: a Live preset (`.adg`/`.adv`) names the device it loads, in Live's
 * own words, read from the index's Built-in devices (`DrumGroupDevice` is
 * "Drum Rack", `InstrumentVector` "Wavetable"); a Max device's preset names
 * its `.amxd`.
 *
 * **When it cannot be trusted** the caller falls back to the disk scan:
 * no database, a `version` other than `12300`, a column this reads gone,
 * or a Place the `places` table does not list.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ItemKind } from '$lib/utils/placeKinds';
import { fourCC, readKind, tintFor, CLIP_EXTENSION, PRESET_EXTENSIONS, SAMPLE_EXTENSIONS, type AuComponent, type KindCache, type KindInfo, type PlaceFolder, type PlaceItem } from './diskScan';
import { newestLiveDatabase } from '../../../routes/api/similar-samples/similarSamples';

/** The one schema this reader was measured against. */
export const SUPPORTED_SCHEMA = 12300;

export const FOLDER_TYPE = fourccOf('fldr');

/** `metadata.key` for a Pack's own tags and for a user folder's (measured 2026-10-28). */
export const TAG_KEYS = [1264941431, 1431004537];
/**
 * The tag groups a preset tile names, in this order: what a sound is like,
 * then what it is for. Live's Packs say the first under Character,
 * Spectrasonics under Timbre and Mood; Genres and Keyword (Omnisphere's
 * "Arpeggio", "Tempo-based") follow (user, 2026-10-28: "lets show more
 * tags"). The rest (Sounds, Type, Omni Category, Osc Type…) repeats the
 * folder or is noise.
 */
export const CARD_TAG_GROUPS = ['Character', 'Timbre', 'Mood', 'Genres', 'Keyword'];
/** At most this many per item: the tile shows two rows of them. */
const MAX_CARD_TAGS = 8;
const SKIP_FOLDERS = new Set(['Ableton Folder Info']);

function fourccOf(code: string): number {
	return ((code.charCodeAt(0) << 24) | (code.charCodeAt(1) << 16) | (code.charCodeAt(2) << 8) | code.charCodeAt(3)) >>> 0;
}

function fourccString(n: number): string {
	return fourCC(n);
}

/** The newest `Live-files-*.db` in `dir`, with its mtime, or null. */
export function findLiveDatabase(dir: string): { file: string; mtimeMs: number; walMtimeMs: number } | null {
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return null;
	}
	const stat = (name: string) => {
		try {
			return statSync(join(dir, name)).mtimeMs;
		} catch {
			return 0;
		}
	};
	const newest = newestLiveDatabase(names, stat);
	if (!newest) return null;
	return { file: join(dir, newest), mtimeMs: stat(newest), walMtimeMs: stat(`${newest}-wal`) };
}

export interface IndexHandle {
	db: DatabaseSync;
	file: string;
	schema: number;
}

/** Open the index read-only and check its schema. Throws on a schema this reader was not measured against. */
export function openIndex(file: string): IndexHandle {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		const row = db.prepare('SELECT * FROM version').get() as Record<string, unknown> | undefined;
		const schema = Number(row ? Object.values(row)[0] : NaN);
		if (schema !== SUPPORTED_SCHEMA) throw new Error(`index schema ${schema}, expected ${SUPPORTED_SCHEMA}`);
		return { db, file, schema };
	} catch (err) {
		db.close();
		throw err;
	}
}

export interface IndexRow {
	file_id: number;
	parent_id: number;
	name: string;
	file_type: number;
	subtype: number;
	device_type: number;
	device_id: string | null;
	mod_date: number | null;
	file_size: number | null;
	/** The item's tags, `Group|Value`, newline-separated; null when it has none. */
	tags: string | null;
}

export interface Lookups {
	/** Device class → the name Live shows for it. */
	deviceNames: Map<string, string>;
	/** `name\tsize` of a Pack's `.adg`/`.adv` → its card tags. */
	packTags: Map<string, string[]>;
	/** A Pack preset's name, lowercased and without extension → its card tags; null where Packs disagree. */
	packTagsByName: Map<string, string[] | null>;
}
const lookups = new WeakMap<IndexHandle, Lookups>();

/** What every Place's scan reads from the index once: device names and Pack presets' tags. */
function lookupsOf(h: IndexHandle): Lookups {
	let l = lookups.get(h);
	if (l) return l;
	const deviceNames = new Map<string, string>();
	const builtIn = h.db.prepare("SELECT file_id FROM places WHERE name = 'Built-in' LIMIT 1").get() as { file_id: number } | undefined;
	if (builtIn) {
		const rows = h.db
			.prepare("SELECT f.name, f.device_id FROM ancestors a JOIN files f ON f.file_id = a.file_id WHERE a.ancestor_id = ? AND f.device_id LIKE 'device:ableton:%'")
			.all(builtIn.file_id) as Array<{ name: string; device_id: string }>;
		for (const r of rows) {
			const cls = liveClassOf(r.device_id)?.cls;
			if (cls && !deviceNames.has(cls)) deviceNames.set(cls, r.name.replace(/\.[^.]+$/, ''));
		}
	}
	const packTags = new Map<string, string[]>();
	const packTagsByName = new Map<string, string[] | null>();
	const rows = h.db
		.prepare(
			`SELECT f.name, f.file_size,
			   (SELECT group_concat(v.value, char(10)) FROM metadata m JOIN metadata_values v ON v.id = m.value_id
			    WHERE m.file_id = f.file_id AND m.key IN (${TAG_KEYS.join(',')})) AS tags
			 FROM places p JOIN ancestors a ON a.ancestor_id = p.file_id JOIN files f ON f.file_id = a.file_id
			 WHERE p.folder_kind = 0 AND (f.name LIKE '%.adg' OR f.name LIKE '%.adv')`
		)
		.all() as Array<{ name: string; file_size: number | null; tags: string | null }>;
	for (const r of rows) {
		const tags = cardTags(r.tags);
		if (!tags.length) continue;
		packTags.set(`${r.name}\t${r.file_size ?? ''}`, tags);
		const key = presetStem(r.name);
		const had = packTagsByName.get(key);
		if (had === undefined) packTagsByName.set(key, tags);
		else if (had && had.join('\n') !== tags.join('\n')) packTagsByName.set(key, null);
	}
	lookups.set(h, (l = { deviceNames, packTags, packTagsByName }));
	return l;
}

function presetStem(name: string): string {
	return name.replace(/\.(adg|adv)$/i, '').toLowerCase();
}

/** The name Live shows for a Live preset's device, or undefined (a plug-in, a sample). */
export function deviceNameOf(deviceId: string | null, names: Map<string, string>): string | undefined {
	const lc = liveClassOf(deviceId);
	if (lc) return names.get(lc.cls) ?? lc.cls.replace(/\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
	// A Max device's preset: `device:m4l:<domain>:<…>/<Name>.amxd`.
	const amxd = /^device:m4l:\w+:.*?([^/:]+)\.amxd$/.exec(deviceId ?? '')?.[1];
	return amxd ? decodeURIComponent(amxd) : undefined;
}

/** The `files.file_id` of the folder the index lists as this Place, or null. */
export function placeFileId(h: IndexHandle, absPath: string): number | null {
	// Walk the tree from the filesystem root by name: the `places` table
  // names a Place but not its path, and two Places can share a name.
	const segments = absPath.replace(/\/+$/, '').split('/').filter(Boolean);
	const stmt = h.db.prepare('SELECT file_id FROM files WHERE parent_id = ? AND name = ? LIMIT 1');
	let row = h.db.prepare("SELECT file_id FROM files WHERE parent_id = 0 AND name = '/' LIMIT 1").get() as { file_id: number } | undefined;
	if (!row) return null;
	let id = row.file_id;
	for (const seg of segments) {
		const indexName = seg.replace(/:/g, '/');
		const next = (stmt.get(id, indexName) ?? stmt.get(id, indexName.normalize('NFC')) ?? stmt.get(id, indexName.normalize('NFD'))) as
			| { file_id: number }
			| undefined;
		if (!next) return null;
		id = next.file_id;
	}
	return id;
}

/** Live's device class from a `device_id` (`device:ableton:instr:Operator` → `Operator`). */
function liveClassOf(deviceId: string | null): { domain: string; cls: string } | null {
	if (!deviceId) return null;
	const m = /^device:ableton:(\w+):(\w+)/.exec(deviceId);
	return m ? { domain: m[1], cls: m[2] } : null;
}

/** The AU triple as `type|subtype|manufacturer` fourccs from an index `device_id`, or null. */
export function auKeyOf(deviceId: string | null): string | null {
	if (!deviceId) return null;
	const m = /^device:au:\w+:(\d+):(\d+):(\d+)/.exec(deviceId);
	if (!m) return null;
	return `${fourccString(Number(m[3]))}|${fourccString(Number(m[2]))}|${fourccString(Number(m[1]))}`;
}

const LIVE_INSTRUMENTS = new Set([
	'MultiSampler', 'OriginalSimpler', 'InstrumentMeld', 'Drift', 'Collision', 'InstrumentVector', 'Operator',
	'UltraAnalog', 'LoungeLizard', 'StringStudio', 'InstrumentImpulse', 'DrumCell', 'MxDeviceInstrument'
]);

/** An item's kind from its index row, the way `diskScan.readKind` reads it from the file. */
export function kindOfRow(row: Pick<IndexRow, 'name' | 'file_type' | 'subtype' | 'device_type' | 'device_id'>, ext: string): ItemKind {
	if (SAMPLE_EXTENSIONS.has(ext)) return 'sample';
	if (ext === '.adg') {
		const c = liveClassOf(row.device_id)?.cls;
		if (c === 'DrumGroupDevice') return 'drum-rack';
		if (c === 'InstrumentGroupDevice') return 'instrument-rack';
		if (c === 'AudioEffectGroupDevice') return 'effect-rack';
		if (c === 'MidiEffectGroupDevice') return 'midi-effect-rack';
		return 'unknown';
	}
	if (ext === '.adv') {
		const lc = liveClassOf(row.device_id);
		if (!lc) {
			// A Max device's preset (Pitch Hack.adv): `device:m4l:audiofx:<the .amxd>`.
			const m4l = /^device:m4l:(\w+):/.exec(row.device_id ?? '')?.[1];
			if (m4l === 'instr') return 'instrument';
			if (m4l === 'midifx') return 'midi-effect';
			if (m4l === 'audiofx') return 'audio-effect';
			return 'unknown';
		}
		if (LIVE_INSTRUMENTS.has(lc.cls) || lc.domain === 'instr') return 'instrument';
		if (lc.domain === 'midifx' || lc.cls === 'MxDeviceMidiEffect' || lc.cls.startsWith('Midi')) return 'midi-effect';
		return 'audio-effect';
	}
	if (ext === '.amxd') {
		if (row.device_type === 1) return 'max-instrument';
		if (row.device_type === 2) return 'max-audio-effect';
		if (row.device_type === 4) return 'max-midi-effect';
		return 'unknown';
	}
	if (ext === '.aupreset') {
		const m = /^device:au:(\w+):/.exec(row.device_id ?? '');
		if (m?.[1] === 'instr') return 'plugin-instrument';
		if (m?.[1] === 'audiofx' || m?.[1] === 'midifx') return 'plugin-effect';
		return 'unknown';
	}
	if (ext === CLIP_EXTENSION) {
		const st = fourccString(row.subtype);
		if (st === 'alcA') return 'audio-clip';
		if (st === 'alcM') return 'midi-clip';
		return 'clip';
	}
	return 'unknown';
}

export interface IndexScanOptions {
	/** Installed AU components, `type|subtype|manufacturer` → plug-in and maker (`diskScan.installedAuComponents`). */
	au: Map<string, AuComponent>;
	/** The brand palette (`vendors.brands[*].color`). */
	colors: Record<string, string | undefined>;
	/**
	 * The disk scan's per-file cache, shared. The one thing the index lacks is
	 * a plug-in preset's patch name (Komplete Kontrol and Omnisphere write it
	 * inside the plist), so a `.aupreset` the cache does not hold at the
	 * index's `mod_date` and size is read once (8 KB) and remembered — the
	 * rig's cache already holds every one from its disk scans.
	 */
	kindCache?: KindCache;
}

export interface IndexScanResult {
	tree: PlaceFolder;
	/** `fullPath` → the index's mtime (seconds) and size, for the thumbnail cache. */
	stats: Map<string, { mtimeMs: number; size: number }>;
	rows: number;
}

/** Every index row under the folder `rootId`: what `scanIndexPlace` builds from. */
export function indexRowsOf(h: IndexHandle, rootId: number): IndexRow[] {
	return h.db
		.prepare(
			`SELECT f.file_id, f.parent_id, f.name, f.file_type, f.subtype, f.device_type, f.device_id, f.mod_date, f.file_size,
			   (SELECT group_concat(v.value, char(10)) FROM metadata m JOIN metadata_values v ON v.id = m.value_id
			    WHERE m.file_id = f.file_id AND m.key IN (${TAG_KEYS.join(',')})) AS tags
			 FROM ancestors a JOIN files f ON f.file_id = a.file_id WHERE a.ancestor_id = ?`
		)
		.all(rootId) as unknown as IndexRow[];
}

/**
 * A fingerprint of a Place's rows. Live writes its index every couple of
 * seconds while it runs, mostly for folders no Place holds; rows that match
 * the last build's are the same catalog, so nothing is rebuilt.
 */
export function indexRowsFingerprint(rows: IndexRow[]): string {
	const hash = createHash('sha1');
	for (const r of rows) {
		hash.update(`${r.file_id}\t${r.parent_id}\t${r.name}\t${r.file_type}\t${r.subtype}\t${r.device_type}\t${r.device_id ?? ''}\t${r.mod_date ?? ''}\t${r.file_size ?? ''}\t${r.tags ?? ''}\n`);
	}
	return hash.digest('hex');
}

/**
 * Everything under the folder `rootId`, as the raw (unshaped, unsorted) tree
 * `diskScan.scanPlace` would return for the same folder. `rootPath` is the
 * folder on disk (the Place's path), `placeName` the tree's root label.
 * `prefetched` is `indexRowsOf`'s answer when the caller already read it.
 */
export function scanIndexPlace(h: IndexHandle, rootId: number, rootPath: string, placeName: string, opts: IndexScanOptions, prefetched?: IndexRow[]): IndexScanResult {
	const rows = prefetched ?? indexRowsOf(h, rootId);
	const { deviceNames, packTags, packTagsByName } = lookupsOf(h);
	const byParent = new Map<number, IndexRow[]>();
	for (const r of rows) {
		let list = byParent.get(r.parent_id);
		if (!list) byParent.set(r.parent_id, (list = []));
		list.push(r);
	}
	const stats = new Map<string, { mtimeMs: number; size: number }>();
	const root = rootPath.replace(/\/+$/, '');

	const spelledOnDisk = diskSpeller();
	const build = (id: number, rel: string, dir: string, name: string): PlaceFolder => {
		const node: PlaceFolder = { name, path: rel, folders: {}, presets: [], vendorColor: null };
		for (const r of byParent.get(id) ?? []) {
			const diskName = spelledOnDisk(dir, r.name.replace(/\//g, ':'));
			if (diskName.startsWith('.')) continue;
			if (r.file_type === FOLDER_TYPE) {
				if (SKIP_FOLDERS.has(diskName)) {
					// A device bundle: show what is inside as if it sat here.
					const inner = build(r.file_id, rel, `${dir}/${diskName}`, diskName);
					for (const p of inner.presets) node.presets.push(p);
					continue;
				}
				node.folders[diskName] = build(r.file_id, `${rel}/${diskName}`, `${dir}/${diskName}`, diskName);
				continue;
			}
			const ext = extOf(diskName);
			if (!PRESET_EXTENSIONS.has(ext) && !SAMPLE_EXTENSIONS.has(ext) && ext !== CLIP_EXTENSION) continue;
			const full = `${dir}/${diskName}`;
			const item = indexItem(r, diskName, ext, `${rel}/${diskName}`, full, opts, { deviceNames, packTags, packTagsByName });
			node.presets.push(item);
			if (r.mod_date || r.file_size) stats.set(full, { mtimeMs: (r.mod_date ?? 0) * 1000, size: r.file_size ?? 0 });
		}
		return node;
	};
	const tree = build(rootId, placeName, root, placeName);
	return { tree, stats, rows: rows.length };
}

/**
 * Live's index stores names composed (NFC); APFS keeps the form a file was
 * named in, decomposed (NFD) for the rig's accented samples ("Póg", "Café").
 * The speller spells a non-ASCII name as the disk does, so paths match the
 * disk scan's byte for byte (Recent, the loaded ring and the surface compare
 * strings). One speller remembers each folder it lists.
 */
export function diskSpeller(): (dir: string, name: string) => string {
	const listings = new Map<string, Map<string, string>>();
	return (dir, name) => {
		if (!/[^\x00-\x7f]/.test(name)) return name;
		let names = listings.get(dir);
		if (!names) {
			names = new Map();
			try {
				for (const n of readdirSync(dir)) names.set(n.normalize('NFC'), n);
			} catch {
				/* a folder the index lists and the disk lacks: keep the index's spelling */
			}
			listings.set(dir, names);
		}
		return names.get(name.normalize('NFC')) ?? name;
	};
}

/** The lookups every scan reads once per index handle (device names, Pack presets' tags). */
export function indexLookups(h: IndexHandle): Lookups {
	return lookupsOf(h);
}

/**
 * One catalog item from its index row: the kind, a plug-in preset's plug-in
 * and patch, a Live preset's device, its card tags (borrowed from the Pack
 * preset it copies when it has none) and its tint. `diskName` is the file's
 * name as the disk spells it, `path` the catalog path, `full` the file.
 */
export function indexItem(r: IndexRow, diskName: string, ext: string, path: string, full: string, opts: IndexScanOptions, l: Lookups): PlaceItem {
	const item: PlaceItem = {
		name: diskName.slice(0, diskName.length - ext.length),
		path,
		fullPath: full,
		type: ext,
		variants: [diskName],
		kind: kindOfRow(r, ext)
	};
	if (ext === '.aupreset') {
		const info = fileInfoOf(full, r, opts.kindCache);
		// Live's indexer records no plug-in for a preset whose plist it cannot
		// parse (a bare `&` in the name string, as in "Sad & Noisy Reeds"), so
		// the file read the patch name needs anyway says which, as the disk scan's does.
		if (!r.device_id && info) item.kind = info.kind;
		const key = auKeyOf(r.device_id) ?? (r.device_id ? null : (info?.au ?? null));
		const component = key ? opts.au.get(key) : undefined;
		item.installed = !!component;
		if (component) {
			item.plugin = component.plugin;
			item.maker = component.maker;
		}
		const patch = info?.patch;
		if (patch && patch !== item.name) item.patch = patch;
	}
	if (ext === '.adg' || ext === '.adv') {
		const device = deviceNameOf(r.device_id, l.deviceNames);
		if (device) item.device = device;
	}
	const tags = cardTags(r.tags);
	const borrowed =
		tags.length || (ext !== '.adg' && ext !== '.adv')
			? undefined
			: (l.packTags.get(`${r.name}\t${r.file_size ?? ''}`) ?? l.packTagsByName.get(presetStem(r.name)) ?? undefined);
	if (tags.length || borrowed) item.tags = tags.length ? tags : borrowed;
	const tint = tintFor(item, opts.colors);
	if (tint) item.vendorColor = tint;
	return item;
}

/** What a plug-in preset's file says (its plug-in and patch name), from the shared kind cache or one read of the file. */
function fileInfoOf(full: string, r: IndexRow, cache: KindCache | undefined): KindInfo | undefined {
	if (!cache) return undefined;
	const cached = cache.get(full);
	if (cached && cached.size === (r.file_size ?? -1) && Math.floor(cached.mtimeMs / 1000) === (r.mod_date ?? -1)) return cached.info;
	const info = readKind(full, '.aupreset');
	cache.set(full, { size: r.file_size ?? 0, mtimeMs: (r.mod_date ?? 0) * 1000, info });
	return info;
}

/** The values of `CARD_TAG_GROUPS` in an index row's tags, in group order, unique. */
export function cardTags(raw: string | null): string[] {
	if (!raw) return [];
	const out: string[] = [];
	const all = raw.split('\n');
	for (const group of CARD_TAG_GROUPS) {
		for (const t of all) {
			const i = t.indexOf('|');
			if (i < 0 || t.slice(0, i) !== group) continue;
			const value = t.slice(i + 1);
			if (value && !out.includes(value)) out.push(value);
		}
	}
	return out.slice(0, MAX_CARD_TAGS);
}

export function extOf(name: string): string {
	const i = name.lastIndexOf('.');
	return i < 0 ? '' : name.slice(i).toLowerCase();
}
