// @vitest-environment node
/**
 * The ranking behind `/api/similar-samples` (ADR-440), over an in-memory
 * database with the slice of Live's schema it reads: Euclidean order, the
 * hash dedup and the candidate rules Live applies (flags, file kind,
 * extractor version), the two a clip slot adds (audio files only; a loop
 * meets loops), and the two answers for a file Live cannot rank.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
	clampLimit,
	fileIdForPath,
	findSimilarSamples,
	fourcc,
	newestLiveDatabase,
	LIMIT_DEFAULT,
	LIMIT_MAX,
	type SimilarSamplesReply
} from '../../../../routes/api/similar-samples/similarSamples';

const SCHEMA = `
	CREATE TABLE files (file_id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, file_type INTEGER,
		file_kind INTEGER DEFAULT 0, name TEXT, flags INTEGER DEFAULT 3);
	CREATE TABLE fe_values (file_id INTEGER, data BLOB, hash INTEGER);
	CREATE TABLE metadata (file_id INTEGER, key INTEGER, value_id INTEGER);
	CREATE TABLE metadata_values (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT);
`;

const WAV = fourcc('wav-');
const AIFF = fourcc('aiff');
const ADG = fourcc('adg-');
/** The metadata key Live's auto-tags ride on this machine. */
const AUTO_TAG_KEY = 1129014649;

interface FileOptions {
	/** The vector's leading components (the rest are 0); no vector row without it. */
	at?: number[];
	hash?: number;
	type?: number;
	kind?: number;
	flags?: number;
	version?: number;
	tags?: string[];
}

function vectorBlob(values: number[], version = 18): Uint8Array {
	const view = new DataView(new ArrayBuffer(12 + 64 * 4));
	view.setUint32(0, version, true);
	view.setUint32(4, 64, true);
	values.forEach((v, i) => view.setFloat32(12 + i * 4, v, true));
	return new Uint8Array(view.buffer);
}

class Index {
	readonly db = new DatabaseSync(':memory:');
	readonly #folders = new Map<string, number>();

	constructor() {
		this.db.exec(SCHEMA);
		this.#folders.set('', this.#insert(0, 0, 512, '/', 3));
	}

	file(path: string, o: FileOptions = {}): number {
		const cut = path.lastIndexOf('/');
		const id = this.#insert(this.#folder(path.slice(0, cut)), o.type ?? WAV, o.kind ?? 4, path.slice(cut + 1), o.flags ?? 3);
		if (o.at) {
			this.db
				.prepare('INSERT INTO fe_values (file_id, data, hash) VALUES (?, ?, ?)')
				.run(id, vectorBlob(o.at, o.version), o.hash ?? id);
		}
		for (const tag of o.tags ?? []) {
			const known = this.db.prepare('SELECT id FROM metadata_values WHERE value = ?').get(tag);
			const valueId = known
				? Number(known.id)
				: Number(this.db.prepare('INSERT INTO metadata_values (value) VALUES (?)').run(tag).lastInsertRowid);
			this.db.prepare('INSERT INTO metadata (file_id, key, value_id) VALUES (?, ?, ?)').run(id, AUTO_TAG_KEY, valueId);
		}
		return id;
	}

	#folder(path: string): number {
		const known = this.#folders.get(path);
		if (known !== undefined) return known;
		const cut = path.lastIndexOf('/');
		const id = this.#insert(this.#folder(path.slice(0, cut)), 0, 512, path.slice(cut + 1), 3);
		this.#folders.set(path, id);
		return id;
	}

	#insert(parent: number, type: number, kind: number, name: string, flags: number): number {
		return Number(
			this.db
				.prepare('INSERT INTO files (parent_id, file_type, file_kind, name, flags) VALUES (?, ?, ?, ?, ?)')
				.run(parent, type, kind, name, flags).lastInsertRowid
		);
	}
}

const onDisk = () => true;
const names = (reply: SimilarSamplesReply) => (reply.ok ? reply.neighbors.map((n) => n.name) : reply.code);

describe('findSimilarSamples', () => {
	let index: Index;
	beforeEach(() => {
		index = new Index();
	});
	afterEach(() => index.db.close());

	it('ranks audio files by Euclidean distance from the reference, nearest first, by absolute path', () => {
		index.file('/S/Shaker/ref.aif', { at: [0, 0], type: AIFF });
		index.file('/S/Shaker/far.wav', { at: [5, 0] });
		index.file('/S/Other/near.wav', { at: [1, 0] });
		index.file('/S/Other/mid.aif', { at: [0, 3], type: AIFF });

		const reply = findSimilarSamples(index.db, '/S/Shaker/ref.aif', { exists: onDisk });

		expect(reply).toMatchObject({ ok: true, path: '/S/Shaker/ref.aif', soundType: null, candidates: 3 });
		expect(reply.ok && reply.neighbors).toEqual([
			{ path: '/S/Other/near.wav', name: 'near.wav', distance: 1 },
			{ path: '/S/Other/mid.aif', name: 'mid.aif', distance: 3 },
			{ path: '/S/Shaker/far.wav', name: 'far.wav', distance: 5 }
		]);
	});

	it('orders by distance, not by direction — Live’s list is Euclidean', () => {
		index.file('/S/ref.wav', { at: [1, 0] });
		index.file('/S/same-direction.wav', { at: [9, 0] });
		index.file('/S/close.wav', { at: [1, 1] });

		// Cosine would put same-direction.wav first.
		expect(names(findSimilarSamples(index.db, '/S/ref.wav', { exists: onDisk }))).toEqual([
			'close.wav',
			'same-direction.wav'
		]);
	});

	it('offers one file per audio content, and none that is the reference’s own content', () => {
		index.file('/S/ref.wav', { at: [0, 0], hash: 7 });
		index.file('/S/ref copy.aif', { at: [0, 0], hash: 7, type: AIFF });
		index.file('/S/b.wav', { at: [2, 0], hash: 9 });
		index.file('/S/a.wav', { at: [2, 0], hash: 9 });

		expect(names(findSimilarSamples(index.db, '/S/ref.wav', { exists: onDisk }))).toEqual(['b.wav']);
	});

	it('leaves out presets, files Live does not list, other kinds and other extractor versions', () => {
		index.file('/S/ref.wav', { at: [0, 0] });
		index.file('/S/rack.adg', { at: [0.1, 0], type: ADG });
		index.file('/S/unlisted.wav', { at: [0.2, 0], flags: 2 });
		index.file('/S/other-kind.wav', { at: [0.3, 0], kind: 8 });
		index.file('/S/old-extractor.wav', { at: [0.4, 0], version: 17 });
		index.file('/S/kept.wav', { at: [0.5, 0] });

		expect(names(findSimilarSamples(index.db, '/S/ref.wav', { exists: onDisk }))).toEqual(['kept.wav']);
	});

	it('meets a loop with loops and a one-shot with one-shots; an untagged reference meets both', () => {
		index.file('/S/loop.wav', { at: [0, 0], tags: ['Drums|Drum Loop', 'Type|Loop'] });
		index.file('/S/hat.wav', { at: [0.5, 0], tags: ['Type|One Shot'] });
		index.file('/S/untagged.wav', { at: [1, 0] });
		index.file('/S/other-loop.wav', { at: [3, 0], tags: ['Type|Loop'] });
		index.file('/S/bare.wav', { at: [0, 0.1] });

		const loop = findSimilarSamples(index.db, '/S/loop.wav', { exists: onDisk });
		expect(loop).toMatchObject({ ok: true, soundType: 'Loop' });
		expect(names(loop)).toEqual(['other-loop.wav']);

		const hat = findSimilarSamples(index.db, '/S/hat.wav', { exists: onDisk });
		expect(hat).toMatchObject({ ok: true, soundType: 'One Shot' });
		expect(names(hat)).toEqual([]);

		const bare = findSimilarSamples(index.db, '/S/bare.wav', { exists: onDisk });
		expect(bare).toMatchObject({ ok: true, soundType: null });
		expect(names(bare)).toEqual(['loop.wav', 'hat.wav', 'untagged.wav', 'other-loop.wav']);
	});

	it('passes over a file no longer on disk and stops at the limit', () => {
		index.file('/S/ref.wav', { at: [0, 0] });
		for (let i = 1; i <= 5; i++) index.file(`/S/n${i}.wav`, { at: [i, 0] });

		const reply = findSimilarSamples(index.db, '/S/ref.wav', { limit: 2, exists: (p) => p !== '/S/n1.wav' });

		expect(names(reply)).toEqual(['n2.wav', 'n3.wav']);
	});

	it('says why a file cannot be ranked: not in the index, or never analyzed', () => {
		index.file('/S/analyzed.wav', { at: [0, 0] });
		index.file('/S/long-take.aif', { type: AIFF });

		expect(findSimilarSamples(index.db, '/S/elsewhere.wav', { exists: onDisk })).toMatchObject({
			ok: false,
			code: 'not-indexed'
		});
		expect(findSimilarSamples(index.db, 'S/analyzed.wav', { exists: onDisk })).toMatchObject({
			ok: false,
			code: 'not-indexed'
		});
		expect(findSimilarSamples(index.db, '/S/long-take.aif', { exists: onDisk })).toMatchObject({
			ok: false,
			code: 'no-vector'
		});
	});

	it('ranks a linked sample from the file the link leads to — Live’s index lists no link', () => {
		index.file('/S/Organized/bowl.aif', { at: [0, 0] });
		index.file('/S/Organized/near.aif', { at: [1, 0] });
		const link = '/L/Sidebar/Key/Samples/bowl.aif';
		const realpath = (p: string) => (p === link ? '/S/Organized/bowl.aif' : null);

		expect(findSimilarSamples(index.db, link, { exists: onDisk })).toMatchObject({ ok: false, code: 'not-indexed' });
		const reply = findSimilarSamples(index.db, link, { exists: onDisk, realpath });
		expect(reply.ok).toBe(true);
		expect(reply.ok && reply.neighbors.map((n) => n.path)).toEqual(['/S/Organized/near.aif']);
	});
});

describe('fileIdForPath', () => {
	it('walks the path down from the root, in either Unicode normalization', () => {
		const index = new Index();
		const id = index.file('/S/Café/ref.wav', { at: [0, 0] });

		expect(fileIdForPath(index.db, '/S/Café/ref.wav')).toBe(id);
		expect(fileIdForPath(index.db, '/S/Café/ref.wav')).toBe(id);
		expect(fileIdForPath(index.db, '/S/ref.wav')).toBeNull();
		index.db.close();
	});
});

describe('newestLiveDatabase', () => {
	it('picks the highest schema number — the database Live writes', () => {
		expect(
			newestLiveDatabase([
				'Live-files-47.db',
				'Live-files-12300.db',
				'Live-files-12300.db-wal',
				'Live-files-1218.db',
				'Live-plugins-1.db',
				'Live-files-12201.db'
			])
		).toBe('Live-files-12300.db');
		expect(newestLiveDatabase(['Live-plugins-1.db'])).toBeNull();
	});
});

describe('clampLimit', () => {
	it('defaults a missing or bad limit and caps a large one', () => {
		expect(clampLimit(null)).toBe(LIMIT_DEFAULT);
		expect(clampLimit('abc')).toBe(LIMIT_DEFAULT);
		expect(clampLimit('0')).toBe(LIMIT_DEFAULT);
		expect(clampLimit('12')).toBe(12);
		expect(clampLimit(5000)).toBe(LIMIT_MAX);
	});

	/**
	 * Swap audit M24. The 200 body enumerates the user's library to any LAN
	 * client: one valid reference yields that many absolute paths, each a valid
	 * next reference. Measured on the rig 2026-09-15: `limit=200` returned 200
	 * paths in 41,879 bytes. The ceiling is an exposure budget, so it is
	 * asserted as a number rather than read from the module it bounds.
	 */
	it('caps the paths one request can enumerate well below the old 200', () => {
		expect(LIMIT_MAX).toBeLessThanOrEqual(24);
		expect(LIMIT_DEFAULT).toBeLessThanOrEqual(LIMIT_MAX);
	});
});

describe('newestLiveDatabase', () => {
	/**
	 * The Low the audit names: picking the highest schema *number* is a guess
	 * about Live's numbering that has already changed once. Measured on the rig
	 * 2026-09-15: 11 databases, Live 11's `-47/-48/-53` beside Live 12's
	 * `-1216/-12106/-12201/-12300`, and the newest by mtime is also the highest
	 * number — so the two agree today and the reachable case is a future
	 * renumbering, not this library.
	 */
	it('picks by mtime, so a renumbering cannot pin the route to a dead database', () => {
		const names = ['Live-files-53.db', 'Live-files-12300.db', 'Live-files-2.db', 'notes.txt'];
		const mtimes: Record<string, number> = {
			'Live-files-53.db': 10,
			'Live-files-12300.db': 20,
			'Live-files-2.db': 30
		};
		expect(newestLiveDatabase(names, (n) => mtimes[n] ?? 0)).toBe('Live-files-2.db');
	});

	it('falls back to the highest schema number when mtimes tie or are unreadable', () => {
		const names = ['Live-files-53.db', 'Live-files-12300.db'];
		expect(newestLiveDatabase(names)).toBe('Live-files-12300.db');
		expect(
			newestLiveDatabase(names, () => {
				throw new Error('stat failed');
			})
		).toBe('Live-files-12300.db');
	});

	it('ignores names that are not a Live index', () => {
		expect(newestLiveDatabase(['notes.txt', 'Live-plugins-1.db'])).toBeNull();
	});
});
