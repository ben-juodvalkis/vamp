/**
 * Tests for /looping/v3/handshake handlers — Phase 2 PR-2c, updated PR-3b.
 *
 * Covers:
 * - Cold-start hello → accept updates store, no resync emitted.
 * - Reconnect (second hello) → accept updates store, still no resync emitted
 *   (PR-3b: surface emits state/full on every accept; UI-side resync is
 *   reserved for UDP packet-loss recovery).
 * - handshake-version-mismatch error flips handshakeState to `failed`.
 * - Malformed accept payloads are dropped without state transition.
 * - Non-handshake v3 errors warn-log but don't touch handshakeState.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import {
	handleV3HandshakeAccept,
	handleV3Error,
	sendHandshakeHello,
	sendStateResync,
	setSender,
	V3_HANDSHAKE_HELLO_ADDRESS,
	V3_STATE_RESYNC_ADDRESS,
	UI_SUPPORTED_VERSIONS,
	__clearHelloRetryForTests
} from '$lib/api/handlers/v3Handshake';
import {
	handshakeState,
	_resetForTests as resetHandshakeState
} from '$lib/stores/v3/handshakeState.svelte';
import {
	v3Store,
	_resetForTests as resetV3Store
} from '$lib/stores/v3/normalized.svelte';
import { logger } from '$lib/utils/logger';
import type { OSCArg } from '$lib/types/osc';

// ============================================
// Test harness — captures sender emissions
// ============================================

type Emission = { address: string; args: OSCArg[] };
let emissions: Emission[] = [];

function captureSender(address: string, args: OSCArg[]): void {
	emissions.push({ address, args });
}

beforeEach(() => {
	vi.clearAllMocks();
	emissions = [];
	setSender(captureSender);
	resetHandshakeState();
	resetV3Store();
	__clearHelloRetryForTests();
});

// ============================================
// Outbound: hello
// ============================================

describe('sendHandshakeHello', () => {
	it('emits hello with UI_SUPPORTED_VERSIONS and bumps attempt', () => {
		const attempt = sendHandshakeHello();

		expect(attempt).toBe(1);
		expect(emissions).toHaveLength(1);
		expect(emissions[0].address).toBe(V3_HANDSHAKE_HELLO_ADDRESS);
		expect(emissions[0].args).toEqual([...UI_SUPPORTED_VERSIONS]);
		expect(handshakeState.phase).toBe('pending');
		expect(handshakeState.attemptCount).toBe(1);
	});

	it('advertises 3.12.0 alone', () => {
		// 3.5.0 briefly made this a two-entry list: it added the
		// client-declared ETag and touched no record, so decoding a 3.4.0
		// surface still worked. 3.6.0 takes it back to one entry for a
		// different reason — it changed the *addresses*, collapsing
		// `state/full` to a single `state/full/tree`. Negotiating down
		// would produce a handshake that succeeds and a tree that never
		// arrives, so we advertise one version alone and take a named
		// `handshake-version-mismatch` against an older surface instead
		// of a silently blank UI.
		//
		// 3.7.0 keeps it at one entry for the ordinary reason: the T
		// record grew a 14th field (`role`), and this parser reads 14.
		expect(UI_SUPPORTED_VERSIONS).toEqual(['3.12.0']);
	});

	it('warns when sender not wired but still bumps attempt', () => {
		setSender(null);
		const attempt = sendHandshakeHello();

		expect(attempt).toBe(1);
		expect(emissions).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalledWith(
			'v3 handshake: hello requested but no sender wired',
			expect.any(Object)
		);
		expect(handshakeState.phase).toBe('pending');
	});
});

// ============================================
// Inbound: accept
// ============================================

describe('handleV3HandshakeAccept', () => {
	it('updates v3Store and handshakeState on cold-start accept', () => {
		sendHandshakeHello(); // attempt 1
		emissions = []; // drop the hello emission so we can assert on later sends

		handleV3HandshakeAccept(['3.12.0', 'sess-abc', 7]);

		expect(handshakeState.phase).toBe('accepted');
		expect(handshakeState.negotiatedVersion).toBe('3.12.0');
		expect(v3Store.sessionId).toBe('sess-abc');
		expect(v3Store.generation).toBe(7);
		// Cold start: attempt === 1, no resync emitted.
		expect(emissions).toHaveLength(0);
	});

	it('does NOT emit state/resync on reconnect — surface delivers state/full on every accept (PR-3b)', () => {
		// First attempt — accept cleanly.
		sendHandshakeHello();
		handleV3HandshakeAccept(['3.12.0', 'sess-first', 3]);
		emissions = [];

		// Simulate WS drop + reconnect: hello goes out again.
		sendHandshakeHello();
		emissions = [];

		handleV3HandshakeAccept(['3.12.0', 'sess-second', 12]);

		expect(handshakeState.phase).toBe('accepted');
		expect(handshakeState.attemptCount).toBe(2);
		expect(v3Store.sessionId).toBe('sess-second');
		expect(v3Store.generation).toBe(12);
		// PR-3b: no UI-side resync. The Python surface emits a
		// state/full with reason="accept" after every accept, so
		// duplicating it here would double the bundle on reconnect.
		// UI-side resync is reserved for UDP packet-loss recovery.
		expect(emissions).toHaveLength(0);
	});

	it('drops short payload without state transition', () => {
		sendHandshakeHello();

		handleV3HandshakeAccept(['3.0.0', 'sess-abc']); // missing generation

		expect(handshakeState.phase).toBe('pending'); // unchanged
		expect(v3Store.sessionId).toBe(''); // not set
		expect(logger.warn).toHaveBeenCalledWith(
			'v3 handshake/accept: short payload',
			expect.any(Object)
		);
	});

	it('drops empty sessionId', () => {
		sendHandshakeHello();

		handleV3HandshakeAccept(['3.0.0', '', 5]);

		expect(handshakeState.phase).toBe('pending');
		expect(v3Store.sessionId).toBe('');
		expect(logger.warn).toHaveBeenCalledWith(
			'v3 handshake/accept: empty sessionId',
			expect.any(Object)
		);
	});

	it('drops invalid generation (zero, negative, NaN)', () => {
		sendHandshakeHello();

		handleV3HandshakeAccept(['3.0.0', 'sess-abc', 0]);
		expect(handshakeState.phase).toBe('pending');
		expect(logger.warn).toHaveBeenCalledWith(
			'v3 handshake/accept: invalid generation',
			expect.any(Object)
		);
	});

	it('ignores an accept for a version the UI never advertised', () => {
		// Accepts are broadcast to every WS client, so another client's
		// negotiation lands here too (the menubar advertises 3.3.0). The
		// surface only ever picks from the versions WE sent, and signals a
		// genuine mismatch via /looping/v3/error — never via an accept — so
		// this can only belong to someone else. Failing our own handshake
		// on it stranded the UI with no state/full.
		sendHandshakeHello();

		handleV3HandshakeAccept(['9.9.9', 'sess-abc', 1]);

		expect(handshakeState.phase).toBe('pending');
		expect(v3Store.sessionId).toBe('');
	});

	it('does not adopt another client\'s sessionId', () => {
		sendHandshakeHello();
		handleV3HandshakeAccept(['9.9.9', 'other-client-session', 42]);
		handleV3HandshakeAccept(['3.12.0', 'our-session', 7]);

		expect(handshakeState.phase).toBe('accepted');
		expect(v3Store.sessionId).toBe('our-session');
		expect(v3Store.generation).toBe(7);
	});
});

// ============================================
// Hello retry — the lost-hello freeze
// ============================================

describe('hello retry', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		__clearHelloRetryForTests();
		vi.useRealTimers();
	});

	it('resends the hello when no accept arrives', () => {
		// The hello crosses an unacknowledged UDP hop to the surface. A
		// drop left the UI in `pending` forever — no accept, so no
		// state/full, so no tracks or meters — while outbound writes kept
		// working. Only a reload cleared it.
		sendHandshakeHello();
		expect(emissions).toHaveLength(1);

		vi.advanceTimersByTime(2_000);

		expect(emissions).toHaveLength(2);
		expect(emissions[1].address).toBe(V3_HANDSHAKE_HELLO_ADDRESS);
		expect(emissions[1].args).toEqual([...UI_SUPPORTED_VERSIONS]);
	});

	it('stops resending once an accept lands', () => {
		sendHandshakeHello();
		vi.advanceTimersByTime(2_000);
		expect(emissions).toHaveLength(2);

		handleV3HandshakeAccept([UI_SUPPORTED_VERSIONS[0], 'sess-abc', 3]);
		expect(handshakeState.phase).toBe('accepted');

		vi.advanceTimersByTime(20_000);
		expect(emissions).toHaveLength(2);
	});

	it('keeps retrying through another client\'s accept', () => {
		// A foreign accept must not be mistaken for ours and stop the retry.
		sendHandshakeHello();
		handleV3HandshakeAccept(['9.9.9', 'other-session', 1]);

		vi.advanceTimersByTime(2_000);

		expect(handshakeState.phase).toBe('pending');
		expect(emissions).toHaveLength(2);
	});

	it('gives up after a bounded number of retries', () => {
		sendHandshakeHello();
		vi.advanceTimersByTime(2_000 * 20);

		// 1 initial + 8 retries, then it stops rather than spinning forever.
		expect(emissions).toHaveLength(9);
	});
});

// ============================================
// Inbound: error
// ============================================

describe('handleV3Error', () => {
	it('flips handshakeState to failed on handshake-version-mismatch', () => {
		sendHandshakeHello();

		handleV3Error([
			'/looping/v3/handshake/hello',
			'handshake-version-mismatch',
			'',
			'UI: 3.0.0, Surface: 4.0.0'
		]);

		expect(handshakeState.phase).toBe('failed');
		expect(handshakeState.errorDetail).toBe('UI: 3.0.0, Surface: 4.0.0');
		expect(logger.error).toHaveBeenCalledWith(
			'v3 handshake: version mismatch',
			expect.any(Object)
		);
	});

	it('uses fallback detail when empty', () => {
		sendHandshakeHello();

		handleV3Error([
			'/looping/v3/handshake/hello',
			'handshake-version-mismatch',
			'',
			''
		]);

		expect(handshakeState.phase).toBe('failed');
		expect(handshakeState.errorDetail).toBe('handshake version mismatch');
	});

	it('warn-logs non-handshake errors without touching handshakeState', () => {
		sendHandshakeHello();

		handleV3Error([
			'/looping/v3/param/set',
			'generation-stale',
			'tracks/0/devices/0/params/0',
			'expected 5, got 4'
		]);

		expect(handshakeState.phase).toBe('pending'); // unchanged
		expect(logger.warn).toHaveBeenCalledWith(
			'v3 error',
			expect.objectContaining({ code: 'generation-stale' })
		);
	});

	it('drops short payload', () => {
		handleV3Error(['/looping/v3/handshake/hello']);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 error: short payload',
			expect.any(Object)
		);
		expect(handshakeState.phase).toBe('idle'); // never left idle
	});

	it('parses 5-arg PropertyComponent shape (devicePath + propertyName + detail)', () => {
		// PR-3.5.7-impl-followup-a-fix (2026-04-16): PropertyComponent
		// emits 5-arg errors `[origAddr, code, devicePath, propertyName,
		// detail]`. Pre-fix the UI parsed positionally as 4-arg, putting
		// the propertyName in the detail slot and dropping the actual
		// detail. The Playwright validation that caught this saw
		// `detail: "sample.start_marker"` instead of the real
		// `property-not-allowed` reason. Pin the dispatch on length so
		// future shape drift fails this test, not silently in prod.
		handleV3Error([
			'/looping/v3/property/set',
			'write-rejected',
			'tracks/0/devices/0',
			'playback_mode',
			'property-not-allowed'
		]);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 error',
			expect.objectContaining({
				originatingAddress: '/looping/v3/property/set',
				code: 'write-rejected',
				path: 'tracks/0/devices/0',
				propertyName: 'playback_mode',
				detail: 'property-not-allowed'
			})
		);
	});
});

// ============================================
// sendStateResync direct
// ============================================

describe('sendStateResync', () => {
	it('emits /looping/v3/state/resync carrying the session id', () => {
		// Protocol 3.5.0: `[sessionId?, "etag:0x..."?]`. The session id
		// rides along because the surface has no per-client channel — it
		// needs the id to tag a `state/full/unchanged` marker that only
		// this client should act on. Empty string when we have no
		// session yet; the ETag is omitted entirely when we hold no tree,
		// which is what makes the surface send a full one.
		sendStateResync();

		expect(emissions).toHaveLength(1);
		expect(emissions[0].address).toBe(V3_STATE_RESYNC_ADDRESS);
		expect(emissions[0].args).toEqual(['']);
	});

	it('warns when sender not wired', () => {
		setSender(null);
		sendStateResync();

		expect(emissions).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalledWith(
			'v3 handshake: resync requested but no sender wired'
		);
	});
});

// --- a pad-targeted load's failure names its scope (issue #491) ----------------

import { loadFailureScope } from '$lib/api/handlers/v3Handshake';

describe('loadFailureScope', () => {
	it('reads the pad path after ;scope=, or the track', () => {
		expect(loadFailureScope('landed-nowhere;scope=tracks/2/devices/0/pads/38')).toBe('tracks/2/devices/0/pads/38');
		expect(loadFailureScope('move_device raised: RuntimeError: no;scope=tracks/2/devices/0/pads/38')).toBe('tracks/2/devices/0/pads/38');
		expect(loadFailureScope('not-in-browser')).toBe('');
		expect(loadFailureScope('')).toBe('');
	});
});
