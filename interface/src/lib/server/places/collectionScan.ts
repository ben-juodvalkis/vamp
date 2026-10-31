/**
 * Live's Collections — the colored tags in its browser's sidebar — as
 * catalogs, read from Live's index like the categories (`categoryScan.ts`).
 *
 * Measured on the rig on 2026-10-31 (Live 12.4.25b1):
 *
 * - `Library.cfg` names each one (`<LabelInfo Uri="color:colors=N"
 *   DisplayName=…>`, `liveLibrary.collectionsOf`), and `files.colors` in the
 *   index marks its members: bit N for Collection N (bit 0 is set on every
 *   file). `colors` is indexed; reading every tagged row takes 6 ms.
 * - A Collection holds anything Live's browser lists: presets, samples,
 *   clips and Max devices; folders and whole Packs (the rig's "Designer
 *   Drums"); Live's own devices, as the `dfld` folders under Built-in
 *   (`places.folder_kind` 8, `device:ableton:audiofx:Eq8`); and plug-ins
 *   (`plug` rows under kind 10).
 * - Every Built-in device is listed twice, once with no Place behind it (a
 *   stale copy of another Live's app); only rows under a root Live's
 *   `places` table lists today are read.
 *
 * What an item becomes:
 *
 * - A preset, sample, clip or Max device: an item at the Collection's top,
 *   naming the root it lives in for the load (`library`, `pack:<name>`,
 *   `place:<name>`), as a category's items do.
 * - A folder or a Pack: a folder, holding what `scanIndexPlace` reads for
 *   it, each item naming that root.
 * - A Live device: an item that loads as `native:<class>` with its own
 *   name, which the surface inserts by (`DeviceLoadComponent`): an effect
 *   onto the chain, an instrument through `prepare_for_preset` like any
 *   instrument preset (Ben, 2026-10-31: "there must be a way to load
 *   instruments").
 * - Left out, and counted: a Max device inside Live's app, and plug-ins
 *   (no load names one yet).
 */
import { CLIP_EXTENSION, PRESET_EXTENSIONS, SAMPLE_EXTENSIONS, type PlaceFolder, type PlaceItem } from './diskScan';
import { categoryRoots, type CategoryRoot } from './categoryScan';
import {
	DEVICE_FOLDER_TYPE,
	FOLDER_TYPE,
	diskSpeller,
	fourccOf,
	extOf,
	indexItem,
	indexLookups,
	scanIndexPlace,
	TAG_KEYS,
	type IndexHandle,
	type IndexRow,
	type IndexScanOptions
} from './indexScan';

/** `files.file_type` of a Pack's own folder (`lfld`: "Designer Drums" under Packs), a folder for a Collection. */
const PACK_FOLDER_TYPE = fourccOf('lfld');
/** A plug-in's row (`plug`), under Live's Plug-ins root. */
const PLUGIN_TYPE = fourccOf('plug');
/** `places.folder_kind`: an outside Place, Live's Built-in devices. */
const OUTSIDE_PLACE_KIND = 2;
const BUILTIN_KIND = 8;

/** The source a native device's load names (protocol 3.12.0). */
export const NATIVE_SOURCE_PREFIX = 'native:';

export interface CollectionScanResult {
	tree: PlaceFolder;
	/** The roots the tree's items may be read from (the preset-params gate). */
	roots: string[];
	rows: number;
	/** Members left out, by why. */
	skipped: { plugins: number; other: number };
}

/** The tagged rows' cheap fingerprint: their count, ids, tags and newest write (6 ms on the rig). */
export function collectionStamp(h: IndexHandle): string {
	const r = h.db.prepare('SELECT count(*) AS n, sum(file_id * colors) AS s, max(mod_date) AS newest FROM files WHERE colors > 1').get() as {
		n: number;
		s: number | null;
		newest: number | null;
	};
	return `${r.n}:${r.s ?? 0}:${r.newest ?? 0}`;
}

/**
 * Every root a Collection's member may sit under: the User Library and the
 * Packs (`categoryRoots`), each outside Place Live's sidebar lists (by its
 * folder; `places` names it as the index does, the sidebar as the user
 * did), and Live's Built-in devices, whose members load by class.
 */
export function collectionRoots(h: IndexHandle, livePlaces: Array<{ name: string; path: string }>): CategoryRoot[] {
	const out = categoryRoots(h);
	const byPath = new Map(livePlaces.map((p) => [p.path.replace(/\/+$/, ''), p.name]));
	const rows = h.db.prepare('SELECT file_id, folder_kind FROM places WHERE folder_kind IN (?, ?)').all(OUTSIDE_PLACE_KIND, BUILTIN_KIND) as Array<{
		file_id: number;
		folder_kind: number;
	}>;
	for (const r of rows) {
		const path = absPath(h, r.file_id);
		if (!path) continue;
		if (r.folder_kind === BUILTIN_KIND) {
			out.push({ fileId: r.file_id, name: 'Built-in', path, source: '' });
			continue;
		}
		const name = byPath.get(path);
		if (name) out.push({ fileId: r.file_id, name, path, source: `place:${name}` });
	}
	return out;
}

/** The absolute path of an index row, from its parents' names (a `/` in a name is a `:` on disk). */
function absPath(h: IndexHandle, fileId: number): string | null {
	const stmt = h.db.prepare('SELECT parent_id, name FROM files WHERE file_id = ?');
	const names: string[] = [];
	let id = fileId;
	for (let guard = 0; guard < 64; guard++) {
		const r = stmt.get(id) as { parent_id: number; name: string } | undefined;
		if (!r) return null;
		if (r.parent_id === 0) return r.name === '/' ? `/${names.reverse().join('/')}` : null;
		names.push(r.name.replace(/\//g, ':'));
		id = r.parent_id;
	}
	return null;
}

/** `device:ableton:<domain>:<Class>`, a Live device's own id. */
function liveDevice(deviceId: string | null): { domain: string; cls: string } | null {
	const m = /^device:ableton:(\w+):(\w+)$/.exec(deviceId ?? '');
	return m ? { domain: m[1], cls: m[2] } : null;
}

/** A folder tree and every item in it, under the Collection's name and naming `root` for the load. */
function under(node: PlaceFolder, prefix: string, root: CategoryRoot): PlaceFolder {
	return {
		...node,
		path: `${prefix}/${node.path}`,
		folders: Object.fromEntries(Object.entries(node.folders).map(([k, v]) => [k, under(v, prefix, root)])),
		presets: node.presets.map((p) => ({ ...p, path: `${prefix}/${p.path}`, source: root.source, placePath: root.path }))
	};
}

/** Collection `n`'s tree, named `name`, from one read of its tagged rows. */
export function scanCollection(h: IndexHandle, n: number, name: string, opts: IndexScanOptions, roots: CategoryRoot[]): CollectionScanResult {
	const tree: PlaceFolder = { name, path: name, folders: {}, presets: [], vendorColor: null };
	const skipped = { plugins: 0, other: 0 };
	const rootById = new Map(roots.map((r) => [r.fileId, r]));
	const rows = h.db
		.prepare(
			`SELECT f.file_id, f.parent_id, f.name, f.file_type, f.subtype, f.device_type, f.device_id, f.mod_date, f.file_size,
			   (SELECT group_concat(v.value, char(10)) FROM metadata m JOIN metadata_values v ON v.id = m.value_id
			    WHERE m.file_id = f.file_id AND m.key IN (${TAG_KEYS.join(',')})) AS tags
			 FROM files f WHERE f.colors > 1 AND (f.colors & ?) != 0 ORDER BY f.name, f.file_id`
		)
		.all(2 ** n) as unknown as IndexRow[];
	const ancestorsOf = h.db.prepare('SELECT ancestor_id FROM ancestors WHERE file_id = ?');
	// The root a row sits under: the User Library before a Place inside it, then a Pack, an outside Place, Built-in.
	const rank = (r: CategoryRoot) => (r.source === 'library' ? 0 : r.source.startsWith('pack:') ? 1 : r.source ? 2 : 3);
	const rootOf = (fileId: number): CategoryRoot | null => {
		let best: CategoryRoot | null = rootById.get(fileId) ?? null;
		for (const a of ancestorsOf.all(fileId) as Array<{ ancestor_id: number }>) {
			const r = rootById.get(a.ancestor_id);
			if (r && (!best || rank(r) < rank(best))) best = r;
		}
		return best;
	};
	const lookups = indexLookups(h);
	const spelled = diskSpeller();
	const seen = new Set<string>();
	const used = new Set<string>();
	const uniqueName = (base: string) => {
		let out = base;
		for (let k = 2; used.has(out); k++) out = `${base} ${k}`;
		used.add(out);
		return out;
	};
	for (const r of rows) {
		if (r.file_type === PLUGIN_TYPE) {
			skipped.plugins++;
			continue;
		}
		const root = rootOf(r.file_id);
		if (!root) continue; // a stale copy no Place lists
		const native = r.file_type === DEVICE_FOLDER_TYPE ? liveDevice(r.device_id) : null;
		if (native) {
			const source = `${NATIVE_SOURCE_PREFIX}${native.cls}`;
			if (seen.has(source)) continue;
			seen.add(source);
			tree.presets.push({
				name: r.name,
				path: `${name}/${r.name}`,
				fullPath: source,
				type: '',
				variants: [],
				kind: native.domain === 'midifx' ? 'midi-effect' : native.domain === 'instr' ? 'instrument' : 'audio-effect',
				// No `device`: the browser groups effects by it, and each would be a group of one.
				source
			});
			continue;
		}
		if (!root.source) {
			skipped.other++; // a Max device inside Live's app: no load names it
			continue;
		}
		const parentDir = r.file_id === root.fileId ? null : absPath(h, r.parent_id);
		const full = r.file_id === root.fileId ? root.path : parentDir && `${parentDir}/${spelled(parentDir, r.name.replace(/\//g, ':'))}`;
		if (!full || seen.has(full)) continue;
		seen.add(full);
		const diskName = full.slice(full.lastIndexOf('/') + 1);
		if (r.file_id === root.fileId || r.file_type === FOLDER_TYPE || r.file_type === DEVICE_FOLDER_TYPE || r.file_type === PACK_FOLDER_TYPE) {
			const label = uniqueName(r.name);
			const scanned = scanIndexPlace(h, r.file_id, full, label, opts);
			tree.folders[label] = under(scanned.tree, name, root);
			continue;
		}
		const ext = extOf(diskName);
		if (!PRESET_EXTENSIONS.has(ext) && !SAMPLE_EXTENSIONS.has(ext) && ext !== CLIP_EXTENSION) {
			skipped.other++;
			continue;
		}
		const item: PlaceItem = indexItem(r, diskName, ext, `${name}/${diskName}`, full, opts, lookups);
		tree.presets.push({ ...item, source: root.source, placePath: root.path });
	}
	return { tree, roots: roots.filter((r) => r.source && !r.source.startsWith(NATIVE_SOURCE_PREFIX)).map((r) => r.path), rows: rows.length, skipped };
}
