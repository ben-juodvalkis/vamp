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
 * device with the folder hidden. The tags Live's Packs carry
 * (`Sounds|Bass`…) are read for roles later; a user's own presets carry none.
 *
 * **When it cannot be trusted** the caller falls back to the disk scan:
 * no database, a `version` other than `12300`, a column this reads gone,
 * or a Place the `places` table does not list.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ItemKind } from '$lib/utils/placeKinds';
import { fourCC, readKind, tintFor, CLIP_EXTENSION, PRESET_EXTENSIONS, SAMPLE_EXTENSIONS, type AuComponent, type KindCache, type KindInfo, type PlaceFolder, type PlaceItem } from './diskScan';
import { newestLiveDatabase } from '../../../routes/api/similar-samples/similarSamples';

/** The one schema this reader was measured against. */
export const SUPPORTED_SCHEMA = 12300;

const FOLDER_TYPE = fourccOf('fldr');
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

interface IndexRow {
	file_id: number;
	parent_id: number;
	name: string;
	file_type: number;
	subtype: number;
	device_type: number;
	device_id: string | null;
	mod_date: number | null;
	file_size: number | null;
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
		if (!lc) return 'unknown';
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

/**
 * Everything under the folder `rootId`, as the raw (unshaped, unsorted) tree
 * `diskScan.scanPlace` would return for the same folder. `rootPath` is the
 * folder on disk (the Place's path), `placeName` the tree's root label.
 */
export function scanIndexPlace(h: IndexHandle, rootId: number, rootPath: string, placeName: string, opts: IndexScanOptions): IndexScanResult {
	const rows = h.db
		.prepare(
			`SELECT f.file_id, f.parent_id, f.name, f.file_type, f.subtype, f.device_type, f.device_id, f.mod_date, f.file_size
			 FROM ancestors a JOIN files f ON f.file_id = a.file_id WHERE a.ancestor_id = ?`
		)
		.all(rootId) as unknown as IndexRow[];
	const byParent = new Map<number, IndexRow[]>();
	for (const r of rows) {
		let list = byParent.get(r.parent_id);
		if (!list) byParent.set(r.parent_id, (list = []));
		list.push(r);
	}
	const stats = new Map<string, { mtimeMs: number; size: number }>();
	const root = rootPath.replace(/\/+$/, '');

	// Live's index stores names composed (NFC); APFS keeps the form a file was
	// named in, decomposed (NFD) for the rig's accented samples ("Póg", "Café").
	// Spell a non-ASCII name as the disk does, so paths match today's catalog
	// byte for byte (Recent, the loaded ring and the surface compare strings).
	const listings = new Map<string, Map<string, string>>();
	const spelledOnDisk = (dir: string, name: string): string => {
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
			const item: PlaceItem = {
				name: diskName.slice(0, diskName.length - ext.length),
				path: `${rel}/${diskName}`,
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
			const tint = tintFor(item, opts.colors);
			if (tint) item.vendorColor = tint;
			node.presets.push(item);
			if (r.mod_date || r.file_size) stats.set(full, { mtimeMs: (r.mod_date ?? 0) * 1000, size: r.file_size ?? 0 });
		}
		return node;
	};
	const tree = build(rootId, placeName, root, placeName);
	return { tree, stats, rows: rows.length };
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

function extOf(name: string): string {
	const i = name.lastIndexOf('.');
	return i < 0 ? '' : name.slice(i).toLowerCase();
}
