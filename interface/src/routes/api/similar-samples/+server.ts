/**
 * `/api/similar-samples?path=<abs>&limit=<1..200>` — the audio files Live
 * ranks nearest to `path`, for the clip view's swap row (ADR-440). The
 * ranking and its rules are `./similarSamples.ts`; this handler finds Live's
 * current file database, opens it read-only for the one request and answers
 * JSON.
 *
 * - 200 `{ ok: true, path, soundType, candidates, neighbors }`
 * - 404 `{ ok: false, code: 'not-indexed' | 'no-vector' }` — a file Live has
 *   no analysis for is an answer the swap row shows, not a server fault
 * - 400 `bad-request`, 503 `no-database`
 * - 403 `forbidden` — a path outside the sample library and Live projects
 *   (`$lib/server/sampleRoots`, general-release audit §5.3). This route never
 *   opens `path` — it is a key into Live's index — but it answered for any
 *   path a LAN host named, and every answer names up to 24 more
 *
 * The roots were measured against every file Live's index can rank (455,904,
 * 2026-09-23): all of them pass, so the gate refuses no neighbor the swap row
 * can step to.
 *
 * A linked sample is ranked from the file the link leads to (`gatedRealpath`,
 * 2026-09-24): Live's index lists no link, so every sample loaded through the
 * old `Audio Samples` links (or the Places' own, until the copy cloned them)
 * answered `not-indexed` and the clip view's swap row sat dead. The target
 * must pass the same gate.
 *
 * A request scans the index synchronously: measured on the rig 2026-09-15 over
 * 468,465 vectors, **1.26-1.39 s** — 1.27 s for a `Type|One Shot` reference
 * (325,340 candidates), 1.38 s for an untagged one (402,089). The ADR's
 * 160/660 ms was 240,472 vectors ago; this grows with the library.
 *
 * That is why the answers are cached. It is one synchronous scan on the
 * preview server's only event loop, and `/api/sample-peaks` is serving every
 * visible waveform on the same loop; the consumer re-asks for a reference it
 * has already seen, because `clipSimilarSwap.sync` short-circuits on `ready`
 * and `loading` but not on `unavailable`. Three identical requests measured
 * 1.295 / 1.263 / 1.271 s before this cache — no reuse at all (swap audit M9).
 *
 * The key carries the database file **and its mtime**, so an answer is
 * dropped as soon as Live's indexer writes: it is a WAL database Live holds
 * open, and a cached ranking from before an index pass would be stale in the
 * one direction that matters (a file Live has just featured).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAllowedSamplePath, normalizeSamplePath } from '$lib/server/sampleRoots';
import { logger } from '$lib/utils/logger';
import { runtimeConstants } from '$lib/server/runtimeConfig';
import { clampLimit, findSimilarSamples, newestLiveDatabase } from './similarSamples';

/** Live's database folder, read from disk when the server runs (`$lib/server/runtimeConfig`). */
function liveDatabaseDir(): string {
	const dir = (runtimeConstants() as { paths?: { liveDatabaseDir?: string } })?.paths?.liveDatabaseDir;
	const d = typeof dir === 'string' && dir ? dir : '~/Library/Application Support/Ableton/Live Database';
	return d.startsWith('~/') ? join(homedir(), d.slice(2)) : d;
}

// Bounded LRU keyed by `${dbFile}:${dbMtimeMs}:${path}:${limit}`, the same
// shape `/api/sample-peaks` uses. Map iteration order is insertion order, so
// delete+set on hit marks recent.
const CACHE_MAX = 64;
const cache = new Map<string, { status: number; body: unknown }>();
function cacheGet(key: string) {
	const v = cache.get(key);
	if (v !== undefined) {
		cache.delete(key);
		cache.set(key, v);
	}
	return v;
}
function cacheSet(key: string, v: { status: number; body: unknown }): void {
	if (cache.has(key)) cache.delete(key);
	cache.set(key, v);
	while (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

/** A link's target, when it is inside the sample roots too — the gate holds for the file the index is asked about. */
function gatedRealpath(path: string): string | null {
	try {
		const real = realpathSync(path);
		return isAllowedSamplePath(real) ? real : null;
	} catch {
		return null;
	}
}

/** Exported for tests: an index pass must invalidate, so this must not persist. */
export function _resetSimilarSamplesCacheForTests(): void {
	cache.clear();
}

export const GET: RequestHandler = ({ url }) => {
	const rawPath = url.searchParams.get('path') ?? '';
	if (!rawPath.startsWith('/')) {
		return json({ ok: false, code: 'bad-request', detail: 'path must be an absolute file path' }, { status: 400 });
	}
	const path = normalizeSamplePath(rawPath);
	if (!path || !isAllowedSamplePath(path)) {
		logger.warn('similar-samples: refused a path outside the sample roots', {
			component: 'similar-samples',
			path: rawPath
		});
		return json(
			{ ok: false, code: 'forbidden', detail: 'path is outside the sample library and Live projects' },
			{ status: 403 }
		);
	}

	let names: string[] = [];
	try {
		names = readdirSync(liveDatabaseDir());
	} catch {
		// Reported below as no database.
	}
	const newest = newestLiveDatabase(names, (name) => {
		try {
			return statSync(join(liveDatabaseDir(), name)).mtimeMs;
		} catch {
			return 0;
		}
	});
	if (!newest) {
		return json(
			{ ok: false, code: 'no-database', detail: `no Live-files-*.db in ${liveDatabaseDir()}` },
			{ status: 503 }
		);
	}

	const file = join(liveDatabaseDir(), newest);
	const limit = clampLimit(url.searchParams.get('limit'));
	let mtimeMs = 0;
	try {
		mtimeMs = statSync(file).mtimeMs;
	} catch {
		// Unreadable stat is not fatal; it only means this answer is not cached.
	}
	const key = `${newest}:${mtimeMs}:${path}:${limit}`;
	const hit = mtimeMs ? cacheGet(key) : undefined;
	if (hit) return json(hit.body, { status: hit.status });

	let db: DatabaseSync | null = null;
	try {
		db = new DatabaseSync(file, { readOnly: true });
		const started = performance.now();
		const reply = findSimilarSamples(db, path, { limit, exists: existsSync, realpath: gatedRealpath });
		logger.debug('similar-samples', {
			component: 'similar-samples',
			path,
			ok: reply.ok,
			ms: Math.round(performance.now() - started)
		});
		const status = reply.ok ? 200 : 404;
		// A `not-indexed` / `no-vector` answer is cached too: it is the one the
		// consumer re-asks for most, because `sync` does not short-circuit on
		// `unavailable`.
		if (mtimeMs) cacheSet(key, { status, body: reply });
		return json(reply, { status });
	} catch (err) {
		logger.warn('similar-samples: reading Live’s index failed', {
			component: 'similar-samples',
			database: newest,
			err: String(err)
		});
		return json(
			{ ok: false, code: 'no-database', detail: `could not read ${newest}: ${String(err)}` },
			{ status: 503 }
		);
	} finally {
		db?.close();
	}
};
