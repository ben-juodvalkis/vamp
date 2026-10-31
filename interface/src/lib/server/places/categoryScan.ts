/**
 * Live's own browser categories — Sounds, Drums, Instruments, Audio Effects,
 * MIDI Effects, Max for Live, Clips — as catalogs, read from Live's index
 * like the Places (`indexScan.ts`) and never through Live's thread.
 *
 * Measured on the rig on 2026-10-31 (Live 12.4.25b1), against
 * `Live.Application.browser.<category>` read through the surface's probes:
 *
 * - Every item a category lists carries its index row in its `uri`
 *   (`query:Sounds#Bass:FileId_129811`): a category is a query over the same
 *   database, over the Packs (Core Library included) and the User Library
 *   (with the Places inside it), never a Place outside it — `.alc` files
 *   under those roots are exactly the 5,257 Live's Clips lists.
 * - **Sounds and Drum Hits are folder names.** `vfolders` names a
 *   category's sub-folders (group 1 Sounds, 3 Drum Hits) and
 *   `vfolder_patterns` the folder names that fall in each: a preset lies in
 *   Sounds › Bass when the folder it sits in is named one of Bass's ten
 *   patterns ("Bass", "Basses", "Synth Bass", "Analog Bass Vol 1"…). That rule
 *   reproduces Live's Sounds › Bass item for item, 973 of 973. Drum Hits ›
 *   Kick holds the samples and presets in a folder Kick's patterns name:
 *   1,937 here against Live's 1,599, every one of Live's included; the rest
 *   are 328 samples in User Library folders named "Kicks" (a Kick pattern
 *   Live's list passes over there) and 10 in Packs.
 * - Instruments, Audio and MIDI Effects list each device with its presets.
 *   Live's own list there hid most Pack presets (Analog: 398 of 809 shown,
 *   every one a User Library copy; Drums: 1 of 568 Pack kits) by a rule not
 *   found, so these group every preset under its own device instead
 *   (`files.device_id`, Live's name for the class), and Drums' kits are every
 *   Drum Rack preset.
 *
 * Left out: Samples (600,000 files on the rig, no list a finger can use) and
 * Plug-ins (a plug-in is not a file a load can name; its presets are in
 * Sounds when their folder says so).
 *
 * Each item names the root it lives in (`source`, `placePath`), so a load
 * says `pack:<name>` or `library` with the path inside it (protocol 3.11.0)
 * and the surface finds it through that root of Live's browser.
 */
import type { PlaceFolder, PlaceItem } from './diskScan';
import { CLIP_EXTENSION, PRESET_EXTENSIONS, SAMPLE_EXTENSIONS } from './diskScan';
import {
	DEVICE_FOLDER_TYPE,
	FOLDER_TYPE,
	diskSpeller,
	extOf,
	indexItem,
	indexLookups,
	scanIndexPlace,
	TAG_KEYS,
	type IndexHandle,
	type IndexRow,
	type IndexScanOptions
} from './indexScan';

/** The categories, in Live's sidebar order. */
export const LIVE_CATEGORIES = ['Sounds', 'Drums', 'Instruments', 'Audio Effects', 'MIDI Effects', 'Max for Live', 'Clips'] as const;
export type LiveCategory = (typeof LIVE_CATEGORIES)[number];

/**
 * Every installed Pack as one rail button (Ben, 2026-10-31: one tick in
 * place of one per Pack): a folder per Pack, Core Library included, each
 * holding the Pack's own tree as Live's index lists it (`scanPacks`).
 * Listed with the categories, after them.
 */
export const PACKS_SOURCE = 'Packs';

/** A category's role for track coloring: Drums colors as the drum rail does; the rest say nothing. */
export const CATEGORY_ROLES: Partial<Record<LiveCategory, string>> = { Drums: 'drum' };

/** `vfolders.group_id`: Sounds' sub-folders, and Drums' Drum Hits. */
const SOUNDS_GROUP = 1;
const DRUM_HITS_GROUP = 3;

/** Drums' folder of Drum Rack presets. */
export const KITS_FOLDER = 'Kits';

/** One root a category reads: the User Library or a Pack. */
export interface CategoryRoot {
	fileId: number;
	name: string;
	/** Absolute folder. */
	path: string;
	/** What a load names it: `library` or `pack:<name>`. */
	source: string;
}

interface CategoryRow extends IndexRow {
	root_id: number;
	parent_name: string;
}

/** The absolute path of an index folder, from its parents' names. */
function folderPath(h: IndexHandle, fileId: number): string | null {
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

/** The User Library and every Pack, as Live's `places` table lists them today (never the tree's stale roots). */
export function categoryRoots(h: IndexHandle): CategoryRoot[] {
	const rows = h.db.prepare('SELECT file_id, name, folder_kind FROM places WHERE folder_kind IN (0, 1) ORDER BY folder_kind DESC, name').all() as Array<{
		file_id: number;
		name: string;
		folder_kind: number;
	}>;
	const out: CategoryRoot[] = [];
	for (const r of rows) {
		const path = folderPath(h, r.file_id);
		if (!path) continue;
		out.push({ fileId: r.file_id, name: r.name, path, source: r.folder_kind === 1 ? 'library' : `pack:${r.name}` });
	}
	return out;
}

/**
 * What a category build read, cheaply: the roots, and the count, newest id,
 * newest write and total size of the files under them (82 ms on the rig
 * against ~4 s for the build). Live writes its index every couple of seconds
 * while it runs, a take recorded into a project included; those land outside
 * the roots and leave the stamp, and so the catalogs, as they were.
 */
export function categoryStamp(h: IndexHandle, roots: CategoryRoot[]): string {
	if (!roots.length) return 'no-roots';
	const r = h.db
		.prepare(
			`SELECT count(*) AS n, max(a.file_id) AS top, max(f.mod_date) AS newest, sum(f.file_size) AS bytes
			 FROM ancestors a JOIN files f ON f.file_id = a.file_id WHERE a.ancestor_id IN (${roots.map((x) => x.fileId).join(',')})`
		)
		.get() as { n: number; top: number; newest: number; bytes: number };
	return `${roots.map((x) => x.fileId).join(',')}:${r.n}:${r.top}:${r.newest}:${r.bytes}`;
}

/** `vfolder_patterns.name` → the sub-folder names of `group` it falls in. */
function patternsOf(h: IndexHandle, group: number): Map<string, string[]> {
	const rows = h.db
		.prepare('SELECT p.name AS pattern, v.name AS folder FROM vfolders v JOIN vfolder_patterns p ON p.vfolder_id = v.vfolder_id WHERE v.group_id = ?')
		.all(group) as Array<{ pattern: string; folder: string }>;
	const map = new Map<string, string[]>();
	for (const r of rows) {
		const list = map.get(r.pattern) ?? [];
		if (!list.includes(r.folder)) list.push(r.folder);
		map.set(r.pattern, list);
	}
	return map;
}

/** Every row a category could hold: presets and clips under the roots, and the samples in a Drum Hits folder. */
function candidateRows(h: IndexHandle, roots: CategoryRoot[], drumHitPatterns: string[]): CategoryRow[] {
	if (!roots.length) return [];
	const like = (exts: Iterable<string>) => [...exts].map((e) => `f.name LIKE '%${e}'`).join(' OR ');
	const hits = drumHitPatterns.length ? drumHitPatterns.map(() => '?').join(',') : "''";
	return h.db
		.prepare(
			`SELECT f.file_id, f.parent_id, f.name, f.file_type, f.subtype, f.device_type, f.device_id, f.mod_date, f.file_size,
			   a.ancestor_id AS root_id, pf.name AS parent_name,
			   (SELECT group_concat(v.value, char(10)) FROM metadata m JOIN metadata_values v ON v.id = m.value_id
			    WHERE m.file_id = f.file_id AND m.key IN (${TAG_KEYS.join(',')})) AS tags
			 FROM ancestors a JOIN files f ON f.file_id = a.file_id JOIN files pf ON pf.file_id = f.parent_id
			 WHERE a.ancestor_id IN (${roots.map((r) => r.fileId).join(',')}) AND f.file_type NOT IN (${FOLDER_TYPE}, ${DEVICE_FOLDER_TYPE})
			   AND ((${like([...PRESET_EXTENSIONS, CLIP_EXTENSION])}) OR ((${like(SAMPLE_EXTENSIONS)}) AND pf.name IN (${hits})))`
		)
		.all(...drumHitPatterns) as unknown as CategoryRow[];
}

const SOUND_EXTENSIONS = PRESET_EXTENSIONS;

/** Where in a category an item goes: its sub-folders, each a list of folder names below the category. */
function placesFor(cat: LiveCategory, item: PlaceItem, parentName: string, sounds: Map<string, string[]>, drumHits: Map<string, string[]>): string[] {
	const ext = item.type;
	switch (cat) {
		case 'Sounds':
			return SOUND_EXTENSIONS.has(ext) ? (sounds.get(parentName) ?? []) : [];
		case 'Drums': {
			const out = [...(drumHits.get(parentName) ?? [])];
			if (item.kind === 'drum-rack') out.push(KITS_FOLDER);
			return out;
		}
		case 'Instruments':
			return ['instrument', 'instrument-rack', 'drum-rack'].includes(item.kind) && item.device ? [item.device] : [];
		case 'Audio Effects':
			return ['audio-effect', 'effect-rack'].includes(item.kind) && item.device ? [item.device] : [];
		case 'MIDI Effects':
			return ['midi-effect', 'midi-effect-rack'].includes(item.kind) && item.device ? [item.device] : [];
		case 'Max for Live':
			if (item.kind === 'max-instrument') return ['Max Instrument'];
			if (item.kind === 'max-audio-effect') return ['Max Audio Effect'];
			if (item.kind === 'max-midi-effect') return ['Max MIDI Effect'];
			return [];
		case 'Clips':
			if (item.kind === 'audio-clip') return ['Audio Clips'];
			if (item.kind === 'midi-clip') return ['MIDI Clips'];
			return ext === CLIP_EXTENSION ? ['Clips'] : [];
	}
}

export interface CategoryScanResult {
	/** One raw (unshaped) tree per category: `<sub-folder>/<root>/<folders in the root>/<item>`. */
	trees: Map<LiveCategory, PlaceFolder>;
	/** The roots read, for the preset-params gate. */
	roots: CategoryRoot[];
	rows: number;
}

/**
 * Every category's tree in one read of the index. An item sits under its
 * sub-folder, then its root (the Pack, or the User Library), then the
 * folders it has inside that root, so the depth cap can roll a root's own
 * folders up into the root's level while each item keeps its path.
 */
export function scanCategories(h: IndexHandle, opts: IndexScanOptions, roots: CategoryRoot[] = categoryRoots(h)): CategoryScanResult {
	const sounds = patternsOf(h, SOUNDS_GROUP);
	const drumHits = patternsOf(h, DRUM_HITS_GROUP);
	const rows = candidateRows(h, roots, [...drumHits.keys()]);
	const lookups = indexLookups(h);
	const rootById = new Map(roots.map((r) => [r.fileId, r]));
	const trees = new Map<LiveCategory, PlaceFolder>(
		LIVE_CATEGORIES.map((c) => [c, { name: c, path: c, folders: {}, presets: [], vendorColor: null }])
	);
	const spelled = diskSpeller();
	// Each folder's path inside its root, built once per folder id.
	const relDirs = new Map<number, string[] | null>();
	const parentStmt = h.db.prepare('SELECT parent_id, name FROM files WHERE file_id = ?');
	const relDirOf = (folderId: number, root: CategoryRoot): string[] | null => {
		if (folderId === root.fileId) return [];
		const key = folderId;
		if (relDirs.has(key)) return relDirs.get(key)!;
		const r = parentStmt.get(folderId) as { parent_id: number; name: string } | undefined;
		const up = r && r.parent_id ? relDirOf(r.parent_id, root) : null;
		const out = up && r ? [...up, r.name.replace(/\//g, ':')] : null;
		relDirs.set(key, out);
		return out;
	};
	const seen = new Set<string>();
	for (const r of rows) {
		const root = rootById.get(r.root_id);
		if (!root) continue;
		const rel = relDirOf(r.parent_id, root);
		if (!rel) continue;
		// A device bundle's folder is the device's own: it is shown where the bundle sits.
		const shown = rel.filter((seg) => seg !== 'Ableton Folder Info');
		let dir = root.path;
		for (const seg of rel) dir = `${dir}/${spelled(dir, seg)}`;
		const diskName = spelled(dir, r.name.replace(/\//g, ':'));
		if (diskName.startsWith('.')) continue;
		const ext = extOf(diskName);
		const full = `${dir}/${diskName}`;
		if (seen.has(full)) continue;
		seen.add(full);
		const base = indexItem(r, diskName, ext, '', full, opts, lookups);
		for (const cat of LIVE_CATEGORIES) {
			for (const sub of placesFor(cat, base, r.parent_name, sounds, drumHits)) {
				const chain = [sub, root.name, ...shown];
				let node = trees.get(cat)!;
				for (const seg of chain) {
					const path = `${node.path}/${seg}`;
					node = node.folders[seg] ??= { name: seg, path, folders: {}, presets: [], vendorColor: null };
				}
				node.presets.push({ ...base, path: `${node.path}/${diskName}`, source: root.source, placePath: root.path });
			}
		}
	}
	return { trees, roots, rows: rows.length };
}

/** A tree and every folder and item under it, with the root's name put in front of each path and each item naming its Pack. */
function underPacks(node: PlaceFolder, root: CategoryRoot): PlaceFolder {
	return {
		...node,
		path: `${PACKS_SOURCE}/${node.path}`,
		folders: Object.fromEntries(Object.entries(node.folders).map(([k, v]) => [k, underPacks(v, root)])),
		presets: node.presets.map((p) => ({ ...p, path: `${PACKS_SOURCE}/${p.path}`, source: root.source, placePath: root.path }))
	};
}

/**
 * Every installed Pack under one root (`PACKS_SOURCE`): a folder per Pack
 * named as Live names it, holding what `scanIndexPlace` reads for that Pack
 * (its devices' bundles shown as the device, as in a Place). Each item names
 * its Pack (`pack:<name>`) for the load.
 */
export function scanPacks(h: IndexHandle, opts: IndexScanOptions, roots: CategoryRoot[] = categoryRoots(h)): { tree: PlaceFolder; rows: number } {
	const tree: PlaceFolder = { name: PACKS_SOURCE, path: PACKS_SOURCE, folders: {}, presets: [], vendorColor: null };
	let rows = 0;
	for (const root of roots) {
		if (!root.source.startsWith('pack:')) continue;
		const scanned = scanIndexPlace(h, root.fileId, root.path, root.name, opts);
		rows += scanned.rows;
		tree.folders[root.name] = underPacks(scanned.tree, root);
	}
	return { tree, rows };
}
