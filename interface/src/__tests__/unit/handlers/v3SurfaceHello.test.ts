/**
 * Tests for /looping/v3/surface/hello handler — PR-3c (v2)
 * surface-restart detection.
 *
 * Covers the three branches of [04 §8.6]:
 * - First emission records baseline, no side effects.
 * - Same-instanceId re-emission is idempotent.
 * - Different-instanceId emission resets store + re-handshakes.
 *
 * Plus defensive cases (short payload, empty instanceId, malformed
 * args) that should not crash or bounce the UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import {
	handleV3SurfaceHello,
	V3_SURFACE_HELLO_ADDRESS
} from '$lib/api/handlers/v3SurfaceHello';
import {
	sendHandshakeHello,
	setSender,
	V3_HANDSHAKE_HELLO_ADDRESS,
	UI_SUPPORTED_VERSIONS
} from '$lib/api/handlers/v3Handshake';
import {
	handshakeState,
	_resetForTests as resetHandshakeState
} from '$lib/stores/v3/handshakeState.svelte';
import {
	v3Store,
	setHandshake,
	replaceTree,
	_resetForTests as resetV3Store
} from '$lib/stores/v3/normalized.svelte';
import { logger } from '$lib/utils/logger';
import { session, handleScaleDetected } from '$lib/stores/session.svelte';
import type { OSCArg } from '$lib/types/osc';

// ============================================
// Harness
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
});

// ============================================
// Sanity: address constant matches spec
// ============================================

describe('V3_SURFACE_HELLO_ADDRESS', () => {
	it('matches the wire address in [04 §8.6]', () => {
		expect(V3_SURFACE_HELLO_ADDRESS).toBe('/looping/v3/surface/hello');
	});
});

// ============================================
// First emission — baseline case
// ============================================

describe('handleV3SurfaceHello — first emission', () => {
	it('records baseline instanceId and does not re-handshake', () => {
		handleV3SurfaceHello(['inst-A', '3.0.0', 1_700_000_000]);

		expect(v3Store.surfaceInstanceId).toBe('inst-A');
		expect(emissions).toHaveLength(0);
		// Handshake state untouched — cold-start handshake is fired by
		// onConnected, not by the surface-hello handler.
		expect(handshakeState.phase).toBe('idle');
	});

	it('treats a hello arriving after an active handshake as a restart (missed baseline)', () => {
		// Observed 2026-04-23: UI loaded mid-session, handshake/accept
		// and state/full populated the store, but the prior surface's
		// hello was never captured (fired before mount or lost).
		// When Live tore down + restarted on File → Open, the new
		// hello's `previous === ''` check made the handler silently
		// record it without clearing stale tracks/generation. The fix
		// treats any hello as a restart when session state is active.
		setHandshake('session-from-earlier', 5);
		replaceTree(5, []);

		handleV3SurfaceHello(['inst-A', '3.0.0', 42]);

		expect(v3Store.surfaceInstanceId).toBe('inst-A');
		expect(v3Store.sessionId).toBe('');
		expect(v3Store.generation).toBe(0);
		expect(emissions).toHaveLength(1);
		expect(emissions[0].address).toBe(V3_HANDSHAKE_HELLO_ADDRESS);
	});
});

// ============================================
// Same-instanceId re-emission — idempotent
// ============================================

describe('handleV3SurfaceHello — same instanceId', () => {
	it('is idempotent: second call with same id does not reset or re-handshake', () => {
		handleV3SurfaceHello(['inst-A', '3.0.0', 1_700_000_000]);
		// After baseline, simulate mid-session state.
		setHandshake('session-1', 7);
		replaceTree(7, []);

		handleV3SurfaceHello(['inst-A', '3.0.0', 1_700_000_099]);

		expect(v3Store.surfaceInstanceId).toBe('inst-A');
		expect(v3Store.sessionId).toBe('session-1');
		expect(v3Store.generation).toBe(7);
		expect(emissions).toHaveLength(0);
	});

	it('tolerates different protocolVersion/timestamp fields with same instanceId', () => {
		// Version and timestamp are informational; only instanceId
		// drives the restart branch.
		handleV3SurfaceHello(['inst-A', '3.0.0', 100]);
		handleV3SurfaceHello(['inst-A', '3.1.0', 200]);
		handleV3SurfaceHello(['inst-A', '3.0.0', 300]);

		expect(v3Store.surfaceInstanceId).toBe('inst-A');
		expect(emissions).toHaveLength(0);
	});
});

// ============================================
// Different instanceId — surface restart
// ============================================

describe('handleV3SurfaceHello — different instanceId (surface restart)', () => {
	it('resets normalized store and fires a fresh hello', () => {
		// Simulate a live mid-session before restart.
		handleV3SurfaceHello(['inst-OLD', '3.0.0', 100]);
		setHandshake('session-old', 42);
		replaceTree(42, [
			{
				trackPath: 'tracks/0',
				name: 'Old-Track',
				color: 0,
				mute: false,
				solo: false,
				arm: false,
				hasMidiInput: false,
				hasAudioInput: true,
				hasArrangementClips: false,
				// ADR-410: plain top-level track (not a group, not folded, no parent).
				isFoldable: false,
				foldState: false,
				groupTrackIndex: -1,
				role: '',
				devices: new Map(),
				slots: new Map()
			}
		]);
		// Drive handshake to `accepted` so we can see it reset.
		sendHandshakeHello();
		emissions.length = 0; // clear the first hello for assertion clarity

		handleV3SurfaceHello(['inst-NEW', '3.0.0', 200]);

		// Store cleared.
		expect(v3Store.surfaceInstanceId).toBe('inst-NEW');
		expect(v3Store.sessionId).toBe('');
		expect(v3Store.generation).toBe(0); // UNSET_GENERATION
		expect(v3Store.tracks.size).toBe(0);

		// Fresh hello went out.
		expect(emissions).toHaveLength(1);
		expect(emissions[0].address).toBe(V3_HANDSHAKE_HELLO_ADDRESS);
		expect(emissions[0].args).toEqual([...UI_SUPPORTED_VERSIONS]);

		// Handshake phase back to pending (the fresh hello put it there).
		expect(handshakeState.phase).toBe('pending');
	});

	it('forgets the last key detection — it belonged to the set that was playing (ADR-446)', () => {
		handleV3SurfaceHello(['inst-OLD', '3.0.0', 100]);
		setHandshake('session-old', 42);
		handleScaleDetected({
			root: 0, scale: 'Minor', band: 'sure', gapPct: 60, runnerRoot: 3, runnerScale: 'Major',
			pitchClasses: 1453, reasons: 'tonic votes: C 20, D# 8', applied: true, at: 1
		});
		expect(session.scaleDetected).not.toBeNull();

		handleV3SurfaceHello(['inst-NEW', '3.0.0', 200]);

		expect(session.scaleDetected).toBeNull();
	});

	it('updates instanceId even if sender is not wired', () => {
		// Defensive: if setSender was never called, the re-handshake
		// attempt warn-logs but should still update the store state.
		// This is the surface-restart-during-boot edge case.
		setSender(null);
		handleV3SurfaceHello(['inst-A', '3.0.0', 1]);
		handleV3SurfaceHello(['inst-B', '3.0.0', 2]);

		expect(v3Store.surfaceInstanceId).toBe('inst-B');
		expect(v3Store.generation).toBe(0);
	});

	it('preserves attemptCount across restart (telemetry)', () => {
		handleV3SurfaceHello(['inst-A', '3.0.0', 1]);
		sendHandshakeHello();
		expect(handshakeState.attemptCount).toBe(1);

		handleV3SurfaceHello(['inst-B', '3.0.0', 2]);

		// The re-handshake sent in the handler itself counts as
		// attempt 2 — attemptCount is cumulative across surface
		// instances and tracks total UI-side hello count.
		expect(handshakeState.attemptCount).toBe(2);
	});

	it('second restart in a row does not double-fire hello', () => {
		handleV3SurfaceHello(['inst-A', '3.0.0', 1]);
		handleV3SurfaceHello(['inst-B', '3.0.0', 2]);
		emissions.length = 0;

		handleV3SurfaceHello(['inst-C', '3.0.0', 3]);

		expect(v3Store.surfaceInstanceId).toBe('inst-C');
		expect(emissions).toHaveLength(1); // exactly one hello per restart
		expect(emissions[0].address).toBe(V3_HANDSHAKE_HELLO_ADDRESS);
	});
});

// ============================================
// Defensive / malformed
// ============================================

describe('handleV3SurfaceHello — malformed payloads', () => {
	it('drops a short payload', () => {
		handleV3SurfaceHello(['inst-A']);
		expect(v3Store.surfaceInstanceId).toBe('');
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('short payload'),
			expect.anything()
		);
	});

	it('drops an empty-string instanceId', () => {
		handleV3SurfaceHello(['', '3.0.0', 42]);
		expect(v3Store.surfaceInstanceId).toBe('');
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('empty instanceId'),
			expect.anything()
		);
	});

	it('coerces non-string instanceId via toString (tolerates numeric)', () => {
		// If a test harness or buggy encoder passes a number, toString
		// should turn it into a usable string rather than crash.
		handleV3SurfaceHello([12345 as unknown as string, '3.0.0', 42]);
		expect(v3Store.surfaceInstanceId).toBe('12345');
	});
});
