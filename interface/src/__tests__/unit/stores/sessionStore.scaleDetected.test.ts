/**
 * ADR-446: the session store keeps the surface's last key detection whole.
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

vi.mock('$lib/stores/v6/centralDisplayStore.svelte', () => ({
	centralDisplayStore: {
		setView: vi.fn()
	}
}));

import {
	session,
	handleScaleDetected,
	clearScaleDetected,
	clearSession,
	handleKeyFollowUpdate
} from '$lib/stores/session.svelte';

const answer = {
	root: 0,
	scale: 'Minor',
	band: 'sure',
	gapPct: 60,
	runnerRoot: 3,
	runnerScale: 'Major',
	pitchClasses: 1453,
	reasons: 'bass downbeats C D# C D# (4 each) | tonic votes: C 20, D# 8',
	applied: true,
	at: 1000
};

describe('session.scaleDetected (ADR-446)', () => {
	beforeEach(() => {
		clearScaleDetected();
	});

	it('is null before the first answer', () => {
		expect(session.scaleDetected).toBeNull();
	});

	it('keeps the whole answer', () => {
		handleScaleDetected(answer);
		expect(session.scaleDetected).toEqual(answer);
	});

	it('reads an unknown band as unsure, never as a key to trust', () => {
		handleScaleDetected({ ...answer, band: 'certain' });
		expect(session.scaleDetected?.band).toBe('unsure');
	});

	it('is forgotten with the session: a surface restart or a set load starts with none', () => {
		handleScaleDetected(answer);
		clearSession();
		expect(session.scaleDetected).toBeNull();
	});

	it('replaces the last answer and clears on request', () => {
		handleScaleDetected(answer);
		handleScaleDetected({ ...answer, root: -1, scale: '', band: 'no-key', applied: false, at: 2000 });
		expect(session.scaleDetected).toMatchObject({ band: 'no-key', at: 2000 });
		clearScaleDetected();
		expect(session.scaleDetected).toBeNull();
	});
});

describe('session.keyFollowEnabled (ADR-447)', () => {
	it('defaults on, like the surface', () => {
		expect(session.keyFollowEnabled).toBe(true);
	});

	it('follows the echo either way', () => {
		handleKeyFollowUpdate(0);
		expect(session.keyFollowEnabled).toBe(false);
		handleKeyFollowUpdate(true);
		expect(session.keyFollowEnabled).toBe(true);
	});
});
