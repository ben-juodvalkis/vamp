/**
 * Similar sounds for an audio clip — the swap pill on the clip view (ADR-440).
 *
 * The pill names the clip's file; a half steps to the neighboring file in
 * the list Live's own index ranks nearest to it: the clip's file first, then
 * up to fifty neighbors from `/api/similar-samples`, where the ranking and
 * its two clip rules live (audio files only; a loop meets loops). The list is
 * computed once per file and wraps at its ends, like folder-next, so the way
 * back is the other half (ADR-439's pill).
 *
 * A step is one request, `/looping/v3/clip/swap_file [requestId, clipPath,
 * filePath]`, and Live does the swap inside one undo step: the old clip's
 * settings, a name of its own, its playing and its focus onto the new clip,
 * and the old file put back when the new one will not load
 * (`ClipsComponent.handle_swap_file`). The step settles on the reply that
 * carries its request id.
 *
 * The list follows the clip: a file changed by other means (the browser's
 * Replace, a new recording) starts a new list. **A step in flight owns the
 * clip** — the swap deletes the clip Live shows, the clip view re-reads the
 * slot, and what it reads meanwhile is the old file, the step's own, or a
 * cached answer older than both — so nothing read during a step moves the
 * list, and every step ends by dropping the interface's cached file for the
 * slot. A clip Live cannot rank says why — `not-indexed`, `no-vector`,
 * `no-similar`, `no-file`, or the route's `no-database`.
 */

import { SvelteMap } from 'svelte/reactivity';
import { holdSwapError, dropSwapError } from './swapErrors';
import { logger } from '$lib/utils/logger';
import type { OscBusMessage } from '$lib/api/connection/oscMessageBus';

export const SIMILAR_LIMIT = 24;
export const CLIP_SWAP_FILE_ADDRESS = '/looping/v3/clip/swap_file';
export const CLIP_SWAP_FILE_REPLY_ADDRESS = '/looping/v3/clip/swap_file/reply';
/** Live answers once the new clip is created and the old one's settings written. */
const REPLY_TIMEOUT_MS = 15_000;

export type ClipSwapStatus = 'loading' | 'ready' | 'unavailable';

export interface ClipSwapSound {
	path: string;
	name: string;
}

export interface ClipSwapState {
	status: ClipSwapStatus;
	/** The file the list was computed for. */
	reference: string;
	/** That file first, then Live's neighbors, nearest first. */
	sounds: ClipSwapSound[];
	index: number;
	working: boolean;
	/** A failed step, `code: detail`. The pill can still step. */
	error: string | null;
	/** Why the clip cannot step, while `status` is `unavailable`. */
	reason: { code: string; detail: string } | null;
}

/** `/api/similar-samples`'s JSON, as far as the pill reads it. */
export interface SimilarSamplesAnswer {
	ok: boolean;
	code?: string;
	detail?: string;
	neighbors?: ClipSwapSound[];
}

/** `[ok, code, detail]` off `/looping/v3/clip/swap_file/reply`. */
export interface SwapFileReply {
	ok: boolean;
	code: string;
	detail: string;
}

interface Deps {
	find: (filePath: string, signal?: AbortSignal) => Promise<SimilarSamplesAnswer>;
	/** Asks Live to put `filePath` in the clip's slot; settles on Live's reply. */
	swap: (clipPath: string, filePath: string) => Promise<SwapFileReply>;
	/** Drops what the interface cached about the slot's file. Never throws. */
	forget: (clipPath: string) => Promise<void>;
}

/** `tracks/N/slots/M/clip` → its track, its slot and the slot's scene. */
export function slotOfClip(clipPath: string): { trackPath: string; slotPath: string; scene: number } | null {
	const match = /^(tracks\/\d+)\/slots\/(\d+)\/clip$/.exec(clipPath);
	return match ? { trackPath: match[1], slotPath: `${match[1]}/slots/${match[2]}`, scene: Number(match[2]) } : null;
}

function fileName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

function requestId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `clip-swap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_DEPS: Deps = {
	async find(filePath, signal) {
		const response = await fetch(
			`/api/similar-samples?path=${encodeURIComponent(filePath)}&limit=${SIMILAR_LIMIT}`,
			signal ? { signal } : undefined
		);
		// A 4xx/5xx still carries the route's own `{ok:false, code}` body, but a
		// proxy error page or a dropped preview server does not — `.json()` then
		// throws a SyntaxError that reads like a bug in the ranking (M9).
		if (!response.ok && response.headers.get('content-type')?.includes('application/json') !== true) {
			return {
				ok: false,
				code: 'similar-samples-failed',
				detail: `the index route answered ${response.status}`
			} as SimilarSamplesAnswer;
		}
		return (await response.json()) as SimilarSamplesAnswer;
	},
	async swap(clipPath, filePath) {
		const [{ send }, { addOscMessageListener, removeOscMessageListener }] = await Promise.all([
			import('$lib/api/simpleClient'),
			import('$lib/api/connection/oscMessageBus')
		]);
		const id = requestId();
		return new Promise<SwapFileReply>((resolve, reject) => {
			const listener = (message: OscBusMessage) => {
				if (message.address !== CLIP_SWAP_FILE_REPLY_ADDRESS || String(message.args?.[0]) !== id) return;
				clearTimeout(timer);
				removeOscMessageListener(listener);
				const [, ok, code, detail] = message.args ?? [];
				resolve({ ok: Number(ok) === 1, code: String(code ?? ''), detail: String(detail ?? '') });
			};
			const timer = setTimeout(() => {
				removeOscMessageListener(listener);
				reject(new Error(`swap-timeout: Live did not answer within ${REPLY_TIMEOUT_MS / 1000} s`));
			}, REPLY_TIMEOUT_MS);
			addOscMessageListener(listener);
			send(CLIP_SWAP_FILE_ADDRESS, [id, clipPath, filePath]);
		});
	},
	async forget(clipPath) {
		try {
			const { invalidateSample } = await import('./clipSampleService');
			invalidateSample(clipPath);
		} catch (err) {
			logger.warn('Clip swap: could not drop the cached sample', { component: 'clipSimilarSwap', clipPath, err: String(err) });
		}
	}
};

class ClipSimilarSwapStore {
	#states = new SvelteMap<string, ClipSwapState>();
	#tokens = new Map<string, number>();
	#inFlight = $state<string | null>(null);
	/** The in-flight index request, aborted when a newer reference arrives (M9). */
	#abort: AbortController | null = null;
	#deps: Deps = { ...DEFAULT_DEPS };

	state(clipPath: string): ClipSwapState | undefined {
		return this.#states.get(clipPath);
	}

	/** The clip a step is loading into: Live's clip view is empty for a moment then. */
	get inFlight(): string | null {
		return this.#inFlight;
	}

	/** Follow the clip's file. Cheap when nothing changed; ignored while a step is in flight. */
	async sync(clipPath: string, filePath: string): Promise<void> {
		const current = this.#states.get(clipPath);
		if (current?.working) return;
		if (current?.status === 'ready' && current.sounds[current.index]?.path === filePath) return;
		if (current?.status === 'loading' && current.reference === filePath) return;
		// M9: `unavailable` was the one status that did not short-circuit, so a
		// file that answered `no-similar` or `not-indexed` re-ran a full index
		// scan on every effect re-run — measured on the rig 2026-09-15 at
		// 1.26-1.39 s of *synchronous* work on the preview server's only event
		// loop, while `/api/sample-peaks` is decoding every visible waveform on
		// the same loop. The answer for a given file does not change until
		// Live's indexer writes, which the route's own cache key (the database's
		// mtime) is what notices.
		if (current?.status === 'unavailable' && current.reference === filePath) return;

		const token = (this.#tokens.get(clipPath) ?? 0) + 1;
		this.#tokens.set(clipPath, token);
		if (!filePath) {
			this.#unavailable(clipPath, '', 'no-file', 'The clip has no file yet — a recording is still being written');
			return;
		}
		this.#states.set(clipPath, {
			status: 'loading',
			reference: filePath,
			sounds: [],
			index: -1,
			working: false,
			error: null,
			reason: null
		});

		let answer: SimilarSamplesAnswer;
		try {
			// M9: a reference the user has already stepped past is a scan nobody
			// is waiting for. The token check below drops the *answer*; this
			// drops the request.
			this.#abort?.abort();
			const controller = typeof AbortController === 'function' ? new AbortController() : null;
			this.#abort = controller;
			answer = await this.#deps.find(filePath, controller?.signal);
		} catch (err) {
			if (this.#tokens.get(clipPath) !== token) return;
			const detail = err instanceof Error ? err.message : String(err);
			logger.warn('Clip swap: similar-samples request failed', { component: 'clipSimilarSwap', filePath, detail });
			this.#unavailable(clipPath, filePath, 'similar-samples-failed', detail);
			return;
		}
		if (this.#tokens.get(clipPath) !== token) return;
		if (!answer.ok) {
			this.#unavailable(clipPath, filePath, answer.code || 'similar-samples-failed', answer.detail ?? '');
			return;
		}
		const neighbors = answer.neighbors ?? [];
		if (neighbors.length === 0) {
			this.#unavailable(clipPath, filePath, 'no-similar', 'Live’s index has no similar sound for this file');
			return;
		}
		this.#states.set(clipPath, {
			status: 'ready',
			reference: filePath,
			sounds: [{ path: filePath, name: fileName(filePath) }, ...neighbors.map(({ path, name }) => ({ path, name }))],
			index: 0,
			working: false,
			error: null,
			reason: null
		});
	}

	async step(clipPath: string, delta: 1 | -1): Promise<void> {
		const s = this.#states.get(clipPath);
		if (!s || s.status !== 'ready' || s.working || s.sounds.length < 2) return;
		const n = s.sounds.length;
		const target = (s.index + delta + n) % n;
		const sound = s.sounds[target];

		dropSwapError(clipPath);
		this.#states.set(clipPath, { ...s, working: true, error: null });
		this.#inFlight = clipPath;
		let swapped = false;
		let error: string | null = null;
		try {
			const reply = await this.#deps.swap(clipPath, sound.path);
			swapped = reply.ok;
			if (!reply.ok) error = reply.detail ? `${reply.code}: ${reply.detail}` : reply.code || 'swap-failed';
			else if (reply.detail) {
				logger.info('Clip swap: Live swapped the file but refused a setting', {
					component: 'clipSimilarSwap',
					clipPath,
					detail: reply.detail
				});
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
		if (error) logger.warn('Clip swap: step failed', { component: 'clipSimilarSwap', clipPath, file: sound.path, error });

		// Whatever Live did, a file the interface cached for the slot may be stale now.
		await this.#deps.forget(clipPath);
		if (this.#inFlight === clipPath) this.#inFlight = null;
		const now = this.#states.get(clipPath);
		if (now) this.#states.set(clipPath, { ...now, index: swapped ? target : now.index, working: false, error });
		// The reason is shown, then dropped, and the pill names the file again
		// (see `swapErrors`). A clip path is positional too.
		if (error) {
			holdSwapError(clipPath, () => {
				const held = this.#states.get(clipPath);
				if (held?.error) this.#states.set(clipPath, { ...held, error: null });
			});
		}
	}

	#unavailable(clipPath: string, reference: string, code: string, detail: string): void {
		this.#states.set(clipPath, {
			status: 'unavailable',
			reference,
			sounds: [],
			index: -1,
			working: false,
			error: null,
			reason: { code, detail }
		});
	}

	_setForTests(deps: Partial<Deps>): void {
		this.#deps = { ...this.#deps, ...deps };
	}

	_resetForTests(): void {
		this.#states.clear();
		this.#tokens.clear();
		this.#inFlight = null;
		this.#deps = { ...DEFAULT_DEPS };
	}
}

export const clipSimilarSwap = new ClipSimilarSwapStore();
