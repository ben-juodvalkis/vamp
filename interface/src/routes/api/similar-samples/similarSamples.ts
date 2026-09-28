/**
 * Similar sounds for an audio file, as Live ranks them (ADR-440) — the
 * ranking behind `/api/similar-samples`, over a read-only handle on Live's
 * file database.
 *
 * Live's indexer stores one 64-float embedding per analyzed file in
 * `Live-files-<schema>.db`, table `fe_values`: a 12-byte header (extractor
 * version, dimension, 0), then 64 × float32. View → Show Similar Files is a
 * nearest-neighbor search over them. Measured on Live 12.4.15b2
 * (2026-09-15): plain Euclidean distance reproduces Live's own list in exact
 * order, where L1, cosine and dot product each broke inside the top ten;
 * candidates are rows whose file has `flags & 1` and shares a `file_kind` bit
 * with the reference; duplicates collapse by the audio-content `hash`. The
 * model that computes the vectors is encrypted and off-limits, so only a file
 * Live has already analyzed can be ranked — nothing here embeds audio.
 *
 * Two departures from Live's browser list, both because the answer goes into
 * a clip slot:
 *
 * - **Audio files only.** Live also lists the `.adg` / `.adv` presets that
 *   carry a vector; a clip slot cannot load one.
 * - **A loop meets loops, a one-shot meets one-shots.** Live tags analyzed
 *   audio `Type|Loop` or `Type|One Shot` (91% of it on this machine). Measured
 *   on a 5.2 s drum loop: after one recording, its ten nearest files were
 *   closed hi-hat one-shots of 0.2–0.7 s; among `Type|Loop` files the nearest
 *   were all loops. A reference with neither tag meets every audio file.
 *
 * Never write to the database *content*: it is Live's, held open in WAL mode by
 * the `Ableton Index` process. Note that "read-only" here is SQLite's
 * `readOnly: true`, not `immutable=1`, and it is not the same as touching
 * nothing on disk — opening a checkpointed WAL database read-only provably
 * creates its `-shm` and `-wal` sidecars. That is correct and must stay:
 * `immutable=1` would skip the `-shm` and read a stale snapshot while Live is
 * writing. The claim to avoid is "never written to", not the open.
 */

export const LIMIT_DEFAULT = 24;
/**
 * The ceiling on how many of the user's absolute file paths one request can
 * return (swap audit M24). It was 200: a single valid reference handed any LAN
 * client 200 absolute paths — each of them a valid next reference — in a
 * 41,879-byte body, measured on the rig 2026-09-15. The swap row steps through
 * neighbors one at a time and never showed more than a couple of dozen, so
 * this costs the feature nothing and cuts the walk per request by 8x.
 *
 * Capping the *answer* is not the same as capping the *work*: the scan still
 * reads every candidate vector. See `findSimilarSamples`.
 */
export const LIMIT_MAX = 24;

const HEADER_BYTES = 12;
const DIM = 64;

/** A four-character file type as Live stores it in `files.file_type`. */
export function fourcc(code: string): number {
	return (
		((code.charCodeAt(0) << 24) | (code.charCodeAt(1) << 16) | (code.charCodeAt(2) << 8) | code.charCodeAt(3)) >>> 0
	);
}

/**
 * The audio types that carry a vector (measured: 174,219 `wav-`, 50,458
 * `aiff`, 5,160 `mp3-`, 86 `aac-`, 2 `oggv`). The only other vectorised types
 * are `adg-` and `adv-` presets.
 */
export const AUDIO_FILE_TYPES: readonly number[] = ['wav-', 'aiff', 'mp3-', 'aac-', 'oggv'].map(fourcc);

const SOUND_TYPE_TAGS = { 'Type|Loop': 'Loop', 'Type|One Shot': 'One Shot' } as const;
type SoundTypeTag = keyof typeof SOUND_TYPE_TAGS;
export type SoundType = (typeof SOUND_TYPE_TAGS)[SoundTypeTag];

type SqlValue = null | number | bigint | string | Uint8Array;
type Row = Record<string, SqlValue>;

interface Statement {
	get(...params: SqlValue[]): Row | undefined;
	all(...params: SqlValue[]): Row[];
	iterate(...params: SqlValue[]): Iterable<Row>;
}

/** The part of `node:sqlite`'s `DatabaseSync` the ranking uses. */
export interface IndexDatabase {
	prepare(sql: string): Statement;
}

export interface SimilarSound {
	path: string;
	name: string;
	distance: number;
}

export type SimilarSamplesReply =
	| { ok: true; path: string; soundType: SoundType | null; candidates: number; neighbors: SimilarSound[] }
	| { ok: false; code: 'not-indexed' | 'no-vector'; detail: string };

export interface SimilarSamplesOptions {
	limit?: number;
	/** Whether a ranked file is still on disk: the index can outlive a file. */
	exists: (path: string) => boolean;
	/**
	 * The file a path leads to when it is a link, or null. Live's index lists
	 * files, never links (its browser ignores symlinks), so a linked sample —
	 * every sample in the old Audio Samples folder, and the Places' 42,183
	 * links until the copy cloned them — is ranked from the file it points
	 * to. Measured 2026-09-24: a Places link answered `not-indexed`, its
	 * target 61,082 candidates.
	 */
	realpath?: (path: string) => string | null;
}

export function clampLimit(raw: string | number | null | undefined): number {
	const n = Math.floor(Number(raw ?? LIMIT_DEFAULT));
	if (!Number.isFinite(n) || n < 1) return LIMIT_DEFAULT;
	return Math.min(n, LIMIT_MAX);
}

/**
 * The `Live-files-<schema>.db` Live is actually writing.
 *
 * By modification time, with the highest schema number as the tie-break. The
 * schema number alone is a guess about Live's numbering that has already
 * changed once: this machine holds `Live-files-47.db` and `-48` and `-53`
 * (Live 11) beside `-1216`, `-12106`, `-12201` and `-12300` (Live 12), so the
 * scheme is not monotonic across major versions, and a renumbering would pin
 * the route to a dead database and report it as `no-database` forever.
 *
 * Measured on the rig 2026-09-15: 11 databases in the folder, and the newest by
 * mtime (`Live-files-12300.db`, 1.6 GB, with live `-wal`/`-shm`) is also the
 * highest number — so the two agree today and this changes no behavior here.
 * `mtimes` is injectable because the names alone cannot say.
 */
export function newestLiveDatabase(
	names: readonly string[],
	mtimeMs: (name: string) => number = () => 0
): string | null {
	let newest: string | null = null;
	let bestMtime = -1;
	let bestSchema = -1;
	for (const name of names) {
		const match = /^Live-files-(\d+)\.db$/.exec(name);
		if (!match) continue;
		const schema = Number(match[1]);
		let when = 0;
		try {
			when = mtimeMs(name);
		} catch {
			when = 0;
		}
		if (when > bestMtime || (when === bestMtime && schema > bestSchema)) {
			bestMtime = when;
			bestSchema = schema;
			newest = name;
		}
	}
	return newest;
}

/** The index's row for an absolute path, walked down from its `/` root; null when Live has none. */
export function fileIdForPath(db: IndexDatabase, filePath: string): number | null {
	if (!filePath.startsWith('/')) return null;
	const root = db.prepare(`SELECT file_id AS id FROM files WHERE parent_id = 0 AND name = '/'`).get();
	if (!root) return null;
	const child = db.prepare('SELECT file_id AS id FROM files WHERE parent_id = ? AND name = ?');
	let id = Number(root.id);
	for (const segment of filePath.split('/').filter(Boolean)) {
		// A macOS name can reach us in either Unicode normalization.
		let row: Row | undefined;
		for (const form of new Set([segment, segment.normalize('NFC'), segment.normalize('NFD')])) {
			row = child.get(id, form);
			if (row) break;
		}
		if (!row) return null;
		id = Number(row.id);
	}
	return id;
}

export function findSimilarSamples(
	db: IndexDatabase,
	filePath: string,
	options: SimilarSamplesOptions
): SimilarSamplesReply {
	const limit = clampLimit(options.limit);
	let fileId = fileIdForPath(db, filePath);
	if (fileId === null) {
		const real = options.realpath?.(filePath);
		if (real && real !== filePath) fileId = fileIdForPath(db, real);
	}
	if (fileId === null) {
		return { ok: false, code: 'not-indexed', detail: 'Live’s index has no entry for this file' };
	}

	const base = db
		.prepare(
			`SELECT fv.data AS data, CAST(fv.hash AS TEXT) AS hash, f.file_kind AS kind
			 FROM fe_values fv JOIN files f ON f.file_id = fv.file_id WHERE fv.file_id = ?`
		)
		.get(fileId);
	const header = base ? readHeader(base.data) : null;
	if (!base || !header) {
		return { ok: false, code: 'no-vector', detail: 'Live has not analyzed this file' };
	}
	const reference = new Float64Array(DIM);
	for (let i = 0; i < DIM; i++) reference[i] = header.view.getFloat32(HEADER_BYTES + i * 4, true);

	const tags = db
		.prepare(
			`SELECT DISTINCT mv.value AS value FROM metadata m JOIN metadata_values mv ON mv.id = m.value_id
			 WHERE m.file_id = ? AND mv.value IN ('Type|Loop', 'Type|One Shot')`
		)
		.all(fileId)
		.map((row) => String(row.value) as SoundTypeTag);
	const tag = tags.length === 1 ? tags[0] : null;

	let sql = `SELECT fv.file_id AS id, fv.data AS data, CAST(fv.hash AS TEXT) AS hash
		FROM fe_values fv JOIN files f ON f.file_id = fv.file_id
		WHERE (f.flags & 1) = 1 AND (f.file_kind & ?) != 0
		  AND f.file_type IN (${AUDIO_FILE_TYPES.map(() => '?').join(', ')})`;
	const params: SqlValue[] = [Number(base.kind), ...AUDIO_FILE_TYPES];
	if (tag) {
		sql += ` AND f.file_id IN (SELECT m.file_id FROM metadata m
			WHERE m.value_id IN (SELECT id FROM metadata_values WHERE value = ?))`;
		params.push(tag);
	}

	// One file per audio content: the lowest file_id, the reference's own
	// duplicates left out with it.
	const best = new Map<string, { id: number; d: number }>();
	for (const row of db.prepare(sql).iterate(...params)) {
		const hash = String(row.hash);
		if (hash === base.hash) continue;
		const candidate = readHeader(row.data);
		if (!candidate || candidate.version !== header.version) continue;
		let d = 0;
		for (let i = 0; i < DIM; i++) {
			const x = candidate.view.getFloat32(HEADER_BYTES + i * 4, true) - reference[i];
			d += x * x;
		}
		const id = Number(row.id);
		const held = best.get(hash);
		if (!held || id < held.id) best.set(hash, { id, d });
	}
	const ranked = [...best.values()].sort((a, b) => a.d - b.d || a.id - b.id);

	const pathOf = pathReader(db);
	const neighbors: SimilarSound[] = [];
	for (const entry of ranked) {
		if (neighbors.length >= limit) break;
		const found = pathOf(entry.id);
		if (!found || !options.exists(found.path)) continue;
		neighbors.push({ path: found.path, name: found.name, distance: Math.sqrt(entry.d) });
	}

	return {
		ok: true,
		path: filePath,
		soundType: tag ? SOUND_TYPE_TAGS[tag] : null,
		candidates: best.size,
		neighbors
	};
}

function readHeader(data: SqlValue | undefined): { version: number; view: DataView } | null {
	if (!(data instanceof Uint8Array) || data.byteLength < HEADER_BYTES + DIM * 4) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	if (view.getUint32(4, true) !== DIM) return null;
	return { version: view.getUint32(0, true), view };
}

/** Absolute paths from file ids, walking `parent_id` up to the `/` root; folders are remembered. */
function pathReader(db: IndexDatabase): (id: number) => { path: string; name: string } | null {
	const byId = db.prepare('SELECT name, parent_id AS parent FROM files WHERE file_id = ?');
	const folders = new Map<number, string | null>();
	const folder = (id: number): string | null => {
		const known = folders.get(id);
		if (known !== undefined) return known;
		const row = byId.get(id);
		let path: string | null = null;
		if (row && Number(row.parent) === 0) path = row.name === '/' ? '' : null;
		else if (row) {
			const above = folder(Number(row.parent));
			path = above === null ? null : `${above}/${String(row.name)}`;
		}
		folders.set(id, path);
		return path;
	};
	return (id) => {
		const row = byId.get(id);
		if (!row) return null;
		const above = folder(Number(row.parent));
		if (above === null) return null;
		const name = String(row.name);
		return { path: `${above}/${name}`, name };
	};
}
