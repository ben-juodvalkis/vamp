/**
 * Unit tests for paramArming.svelte.ts — the armed-paths registry and
 * speculative-writes store introduced by ADR-359.
 *
 * The four invariants under test:
 *   1. `reconcileEcho` decides apply vs suppress correctly, including
 *      the floating-point tolerance boundary and the arm-clearing side
 *      effect on a match.
 *   2. TTL expiry: `isArmed` and `getArmedValue` return the
 *      not-armed answer once `ARM_TTL_MS` has elapsed, even without an
 *      explicit `disarmParam` call.
 *   3. Speculative-handoff: `armSpeculative` accumulates per-slot;
 *      `consumeSpeculative` returns the values once and removes the
 *      entry; subsequent consumes return undefined.
 *   4. `resetParamArming` clears both Maps in one call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	armParam,
	disarmParam,
	isArmed,
	getArmedValue,
	reconcileEcho,
	armSpeculative,
	peekSpeculative,
	consumeSpeculative,
	clearSpeculativeForSlot,
	resetParamArming,
	_armedCount,
	_speculativeCount
} from '$lib/stores/v3/paramArming.svelte';

// Mirrors the constants in the module under test. Kept inline rather
// than re-exported so the test fails loudly if the module changes its
// timing contract — the ADR-359 invariant is "1500 ms TTL, 1e-3
// tolerance"; if either changes, the tests should fail and force a
// review of every armed-path consumer.
const ARM_TTL_MS = 1500;
const ARM_MATCH_TOLERANCE = 1e-3;

beforeEach(() => {
	resetParamArming();
});

afterEach(() => {
	vi.useRealTimers();
	resetParamArming();
});

// ============================================
// reconcileEcho: apply vs suppress decisions
// ============================================

describe('reconcileEcho', () => {
	it('applies when no arm exists', () => {
		expect(reconcileEcho('tracks/0/devices/0/params/1', 0.5)).toBe('apply');
	});

	it('suppresses when armed value disagrees past tolerance', () => {
		armParam('tracks/0/devices/0/params/1', 0.7);
		// 0.667 differs from 0.7 by 0.033, well past 1e-3
		expect(reconcileEcho('tracks/0/devices/0/params/1', 0.667)).toBe('suppress');
		// Arm must persist after a suppress so subsequent disagreeing echoes
		// also fall on the floor.
		expect(isArmed('tracks/0/devices/0/params/1')).toBe(true);
	});

	it('applies when armed value matches within tolerance and clears the arm', () => {
		armParam('tracks/0/devices/0/params/1', 0.7);
		// 0.7 - 0.7001 = 1e-4, within 1e-3
		expect(reconcileEcho('tracks/0/devices/0/params/1', 0.7001)).toBe('apply');
		// Round-trip closed → arm cleared so the next echo wins.
		expect(isArmed('tracks/0/devices/0/params/1')).toBe(false);
	});

	it('applies values just inside the tolerance (FP-safe distance)', () => {
		armParam('tracks/0/devices/0/params/1', 0.5);
		// Use half the tolerance to dodge floating-point rounding at the
		// exact boundary; Math.abs(0.5 - 0.5005) is reliably ≤ 1e-3.
		expect(reconcileEcho('tracks/0/devices/0/params/1', 0.5 + ARM_MATCH_TOLERANCE / 2)).toBe('apply');
	});

	it('suppresses just past the tolerance boundary', () => {
		armParam('tracks/0/devices/0/params/1', 0.5);
		// One ULP past the tolerance is a suppress.
		const justPast = 0.5 + ARM_MATCH_TOLERANCE * 1.5;
		expect(reconcileEcho('tracks/0/devices/0/params/1', justPast)).toBe('suppress');
	});
});

// ============================================
// TTL expiry
// ============================================

describe('TTL expiry', () => {
	it('isArmed returns false after ARM_TTL_MS elapses without disarm', () => {
		vi.useFakeTimers();
		const start = Date.now();
		vi.setSystemTime(start);

		armParam('tracks/0/devices/0/params/1', 0.5);
		expect(isArmed('tracks/0/devices/0/params/1')).toBe(true);

		// Advance just past TTL — Date.now() is what isArmed reads, so we
		// move the system clock rather than running timers.
		vi.setSystemTime(start + ARM_TTL_MS + 1);
		expect(isArmed('tracks/0/devices/0/params/1')).toBe(false);
	});

	it('getArmedValue returns undefined after TTL', () => {
		vi.useFakeTimers();
		const start = Date.now();
		vi.setSystemTime(start);

		armParam('tracks/0/devices/0/params/1', 0.5);
		expect(getArmedValue('tracks/0/devices/0/params/1')).toBe(0.5);

		vi.setSystemTime(start + ARM_TTL_MS + 1);
		expect(getArmedValue('tracks/0/devices/0/params/1')).toBeUndefined();
	});

	// ---- Reader purity (the state_unsafe_mutation crash) ----
	//
	// `getArmedValue` is reached from ~140 `$derived` declarations across
	// ~50 components via `selectedTrackStore.paramValueArmed`. It used to
	// call `armed.delete(path)` on the TTL branch, which Svelte 5 turns
	// into a hard `state_unsafe_mutation` throw when it runs inside a
	// derivation — tearing down that view's reactive graph mid-set.
	//
	// The tests above cannot see that: they call the readers from plain
	// test code, the one context where mutating a SvelteMap is legal.
	// These assert the property that actually matters — the readers do
	// not mutate — which is what makes them safe inside a reaction.

	it('getArmedValue does not mutate the armed map on TTL expiry', () => {
		vi.useFakeTimers();
		const start = Date.now();
		armParam('tracks/0/devices/0/params/1', 0.5);
		const before = _armedCount();

		vi.setSystemTime(start + ARM_TTL_MS + 1);
		expect(getArmedValue('tracks/0/devices/0/params/1')).toBeUndefined();

		// Before the fix this was `before - 1`: the read deleted the entry.
		expect(_armedCount()).toBe(before);
		vi.useRealTimers();
	});

	it('isArmed does not mutate the armed map on TTL expiry', () => {
		vi.useFakeTimers();
		const start = Date.now();
		armParam('tracks/0/devices/0/params/2', 0.25);
		const before = _armedCount();

		vi.setSystemTime(start + ARM_TTL_MS + 1);
		expect(isArmed('tracks/0/devices/0/params/2')).toBe(false);

		expect(_armedCount()).toBe(before);
		vi.useRealTimers();
	});

	it('armParam sweeps expired entries, so purity does not leak the map', () => {
		vi.useFakeTimers();
		const start = Date.now();
		armParam('tracks/0/devices/0/params/1', 0.5);
		armParam('tracks/0/devices/0/params/2', 0.6);
		expect(_armedCount()).toBe(2);

		// Past TTL, a fresh arm on an unrelated path prunes both stale ones.
		vi.setSystemTime(start + ARM_TTL_MS + 1);
		armParam('tracks/1/devices/0/params/1', 0.7);
		expect(_armedCount()).toBe(1);
		expect(getArmedValue('tracks/1/devices/0/params/1')).toBe(0.7);
		vi.useRealTimers();
	});

	it('reconcileEcho returns apply once TTL has elapsed', () => {
		vi.useFakeTimers();
		const start = Date.now();
		vi.setSystemTime(start);

		armParam('tracks/0/devices/0/params/1', 0.7);
		// Mid-TTL the arm is still authoritative.
		vi.setSystemTime(start + ARM_TTL_MS - 100);
		expect(reconcileEcho('tracks/0/devices/0/params/1', 0.4)).toBe('suppress');

		// Past TTL the arm has expired and the surface wins.
		vi.setSystemTime(start + ARM_TTL_MS + 1);
		expect(reconcileEcho('tracks/0/devices/0/params/1', 0.4)).toBe('apply');
	});

	it('re-arming bumps the timestamp', () => {
		vi.useFakeTimers();
		const start = Date.now();
		vi.setSystemTime(start);

		armParam('tracks/0/devices/0/params/1', 0.5);

		// Halfway through the TTL the user re-drags — re-arm with a fresh
		// value, which should reset the timer.
		vi.setSystemTime(start + 1000);
		armParam('tracks/0/devices/0/params/1', 0.6);

		// At what would have been TTL on the original arm, the re-armed
		// entry is still well within its own window.
		vi.setSystemTime(start + ARM_TTL_MS + 100);
		expect(isArmed('tracks/0/devices/0/params/1')).toBe(true);
		expect(getArmedValue('tracks/0/devices/0/params/1')).toBe(0.6);
	});

	it('disarmParam clears immediately regardless of TTL', () => {
		armParam('tracks/0/devices/0/params/1', 0.5);
		disarmParam('tracks/0/devices/0/params/1');
		expect(isArmed('tracks/0/devices/0/params/1')).toBe(false);
	});
});

// ============================================
// Speculative-write handoff
// ============================================

describe('speculative writes', () => {
	it('armSpeculative accumulates multiple param indices for one slot', () => {
		armSpeculative('filter', 1, 0.7);
		armSpeculative('filter', 2, 0.3);
		armSpeculative('filter', 4, 5);

		expect(peekSpeculative('filter', 1)).toBe(0.7);
		expect(peekSpeculative('filter', 2)).toBe(0.3);
		expect(peekSpeculative('filter', 4)).toBe(5);
	});

	it('armSpeculative on the same paramIndex overwrites the prior value', () => {
		armSpeculative('filter', 1, 0.3);
		armSpeculative('filter', 1, 0.7);
		expect(peekSpeculative('filter', 1)).toBe(0.7);
	});

	it('consumeSpeculative returns all values for the slot and removes the entry', () => {
		armSpeculative('filter', 1, 0.7);
		armSpeculative('filter', 2, 0.3);

		const drained = consumeSpeculative('filter');
		expect(drained).toBeDefined();
		expect(drained!.size).toBe(2);
		expect(drained!.get(1)).toBe(0.7);
		expect(drained!.get(2)).toBe(0.3);

		// Single-consume: the second call sees nothing.
		expect(consumeSpeculative('filter')).toBeUndefined();
		expect(peekSpeculative('filter', 1)).toBeUndefined();
	});

	it('consumeSpeculative returns undefined for a slot that was never armed', () => {
		expect(consumeSpeculative('chorus')).toBeUndefined();
	});

	it('clearSpeculativeForSlot removes a slot without affecting others', () => {
		armSpeculative('filter', 1, 0.7);
		armSpeculative('chorus', 1, 0.4);

		clearSpeculativeForSlot('filter');

		expect(peekSpeculative('filter', 1)).toBeUndefined();
		expect(peekSpeculative('chorus', 1)).toBe(0.4);
	});

	it('different slot keys are independent', () => {
		armSpeculative('filter', 1, 0.1);
		armSpeculative('echo', 1, 0.9);

		const filter = consumeSpeculative('filter');
		expect(filter?.get(1)).toBe(0.1);
		// Consuming `filter` must not have touched `echo`.
		expect(peekSpeculative('echo', 1)).toBe(0.9);
	});
});

// ============================================
// resetParamArming
// ============================================

describe('resetParamArming', () => {
	it('clears both armed and speculative maps in one call', () => {
		armParam('tracks/0/devices/0/params/1', 0.5);
		armParam('tracks/1/devices/0/params/1', 0.6);
		armSpeculative('filter', 1, 0.7);
		armSpeculative('chorus', 2, 0.3);

		expect(_armedCount()).toBe(2);
		expect(_speculativeCount()).toBe(2);

		resetParamArming();

		expect(_armedCount()).toBe(0);
		expect(_speculativeCount()).toBe(0);
		expect(isArmed('tracks/0/devices/0/params/1')).toBe(false);
		expect(peekSpeculative('filter', 1)).toBeUndefined();
	});
});
