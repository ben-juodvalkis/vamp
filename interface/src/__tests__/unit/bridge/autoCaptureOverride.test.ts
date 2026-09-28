/**
 * Unit tests for the bridge-lifetime auto_capture override memory (ADR-405).
 *
 * Targets `interface/bridge/handlers/autoCaptureOverride.js`. Imports follow
 * the same relative-path + CJS-interop pattern as `liveSaveAs.test.ts`.
 *
 * Coverage:
 * - `recordClientWrite` — remembers the last valid 0/1 (int or bool),
 *   ignores empty/invalid args, later writes win
 * - `onSurfaceEmit` — inert until a client write exists; replays the
 *   override when the surface emits a conflicting value; silent on match;
 *   cannot oscillate (the post-replay echo matches, so no second replay)
 * - the full set-load choreography: user writes 0 → surface reconstructs
 *   (init-emit 0, no replay) → heartbeat seed flips it to 1 (replay 0) →
 *   surface echoes 0 (converged, silent)
 */

import { describe, it, expect } from 'vitest';

import * as mod from '../../../../bridge/handlers/autoCaptureOverride.js';

type Override = {
	recordClientWrite: (args: unknown[]) => void;
	onSurfaceEmit: (args: unknown[], replay: (value: number) => void) => void;
	readonly override: 0 | 1 | null;
};

const { AUTO_CAPTURE_ADDRESS, createAutoCaptureOverride } = mod as {
	AUTO_CAPTURE_ADDRESS: string;
	createAutoCaptureOverride: (deps?: { logger?: unknown }) => Override;
};

describe('AUTO_CAPTURE_ADDRESS', () => {
	it('is the v3 session set address (shared by both wiring sites)', () => {
		expect(AUTO_CAPTURE_ADDRESS).toBe('/looping/v3/session/auto_capture');
	});
});

describe('recordClientWrite', () => {
	it('starts with no override', () => {
		const o = createAutoCaptureOverride();
		expect(o.override).toBeNull();
	});

	it('remembers a valid 0/1 write; the last write wins', () => {
		const o = createAutoCaptureOverride();
		o.recordClientWrite([0]);
		expect(o.override).toBe(0);
		o.recordClientWrite([1]);
		expect(o.override).toBe(1);
	});

	it('accepts booleans (OSC occasionally carries bool args intact)', () => {
		const o = createAutoCaptureOverride();
		o.recordClientWrite([false]);
		expect(o.override).toBe(0);
		o.recordClientWrite([true]);
		expect(o.override).toBe(1);
	});

	it('ignores empty and invalid args without clearing a prior override', () => {
		const o = createAutoCaptureOverride();
		o.recordClientWrite([0]);
		o.recordClientWrite([]);
		o.recordClientWrite(['1']);
		o.recordClientWrite([2]);
		o.recordClientWrite([null]);
		expect(o.override).toBe(0);
	});
});

describe('onSurfaceEmit', () => {
	it('is inert before any client write (surface seed rules untouched)', () => {
		const o = createAutoCaptureOverride();
		const replays: number[] = [];
		o.onSurfaceEmit([1], (v) => replays.push(v));
		o.onSurfaceEmit([0], (v) => replays.push(v));
		expect(replays).toEqual([]);
	});

	it('replays the override when the surface emits a conflicting value', () => {
		const o = createAutoCaptureOverride();
		o.recordClientWrite([0]);
		const replays: number[] = [];
		o.onSurfaceEmit([1], (v) => replays.push(v));
		expect(replays).toEqual([0]);
	});

	it('stays silent when the surface emit matches the override', () => {
		const o = createAutoCaptureOverride();
		o.recordClientWrite([1]);
		const replays: number[] = [];
		o.onSurfaceEmit([1], (v) => replays.push(v));
		expect(replays).toEqual([]);
	});

	it('ignores emits whose args are not a valid 0/1', () => {
		const o = createAutoCaptureOverride();
		o.recordClientWrite([0]);
		const replays: number[] = [];
		o.onSurfaceEmit([], (v) => replays.push(v));
		o.onSurfaceEmit(['x'], (v) => replays.push(v));
		expect(replays).toEqual([]);
	});

	it('cannot oscillate: the post-replay echo matches, so no second replay', () => {
		const o = createAutoCaptureOverride();
		o.recordClientWrite([0]);
		const replays: number[] = [];
		const replay = (v: number) => {
			replays.push(v);
			// The surface applies the write and echoes the new value; feed
			// that echo straight back in — it must not retrigger.
			o.onSurfaceEmit([v], replay);
		};
		o.onSurfaceEmit([1], replay);
		expect(replays).toEqual([0]);
	});
});

describe('set-load choreography (the ADR-405 scenario)', () => {
	it('restores a user override after the fresh surface re-seeds the mode default', () => {
		const o = createAutoCaptureOverride();
		const replays: number[] = [];
		const replay = (v: number) => replays.push(v);

		// ipad session: seed turned it on, user turns capture off.
		o.recordClientWrite([0]);
		o.onSurfaceEmit([0], replay); // surface echo of the user write
		expect(replays).toEqual([]);

		// Set load: Live rebuilds the surface. Cold init-emit is 0 (pre-seed).
		o.onSurfaceEmit([0], replay);
		expect(replays).toEqual([]);

		// First heartbeat re-seeds the ipad default → surface emits 1.
		o.onSurfaceEmit([1], replay);
		expect(replays).toEqual([0]);

		// Surface applies the replayed write and echoes 0 → converged.
		o.onSurfaceEmit([0], replay);
		expect(replays).toEqual([0]);
	});

	it('also wins the reverse direction (dev session forced on)', () => {
		const o = createAutoCaptureOverride();
		const replays: number[] = [];
		o.recordClientWrite([1]);

		// Set load under dev: cold init-emit 0 conflicts immediately.
		o.onSurfaceEmit([0], (v) => replays.push(v));
		expect(replays).toEqual([1]);

		// Replay commits the toggle surface-side, so the later dev seed
		// (0) is a no-op — the surface keeps emitting 1.
		o.onSurfaceEmit([1], (v) => replays.push(v));
		expect(replays).toEqual([1]);
	});
});
