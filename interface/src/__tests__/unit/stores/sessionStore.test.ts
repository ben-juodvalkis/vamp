/**
 * Tests for session store - Session state management
 *
 * Tests cover:
 * - Time signature updates (ADR-182 bug fix)
 * - Session state batch handling (ADR-183)
 * - Individual session property updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing session store
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

// Import after mocks are set up
import { session, handleSessionUpdate } from '$lib/stores/session.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';

describe('session store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleSessionUpdate', () => {
		describe('tempo updates', () => {
			it('should update tempo', () => {
				handleSessionUpdate({ type: 'tempo', bpm: 140, timestamp: Date.now() });
				expect(session.tempo).toBe(140);
			});

			it('should handle decimal tempo values', () => {
				handleSessionUpdate({ type: 'tempo', bpm: 123.45, timestamp: Date.now() });
				expect(session.tempo).toBe(123.45);
			});
		});

		describe('transport updates', () => {
			it('should update transport to playing', () => {
				handleSessionUpdate({ type: 'transport', isPlaying: true, timestamp: Date.now() });
				expect(session.isPlaying).toBe(true);
			});

			it('should update transport to stopped', () => {
				handleSessionUpdate({ type: 'transport', isPlaying: false, timestamp: Date.now() });
				expect(session.isPlaying).toBe(false);
			});
		});

		describe('time signature updates (ADR-182)', () => {
			it('should update to 4/4 time signature', () => {
				// First set to 3/4
				handleSessionUpdate({
					type: 'time-signature',
					timeSignature: { numerator: 3, denominator: 4 },
					timestamp: Date.now()
				});
				expect(session.timeSignature.numerator).toBe(3);

				// Then update to 4/4 - this was the bug in ADR-182
				handleSessionUpdate({
					type: 'time-signature',
					timeSignature: { numerator: 4, denominator: 4 },
					timestamp: Date.now()
				});
				expect(session.timeSignature.numerator).toBe(4);
				expect(session.timeSignature.denominator).toBe(4);
			});

			it('should handle partial numerator update (with default denominator)', () => {
				// Simulate AbletonOSC sending just numerator with parser default denominator
				handleSessionUpdate({
					type: 'time-signature',
					timeSignature: { numerator: 7, denominator: 4 },
					timestamp: Date.now()
				});
				expect(session.timeSignature.numerator).toBe(7);
			});

			it('should handle partial denominator update (with default numerator)', () => {
				// Simulate AbletonOSC sending just denominator with parser default numerator
				handleSessionUpdate({
					type: 'time-signature',
					timeSignature: { numerator: 4, denominator: 8 },
					timestamp: Date.now()
				});
				expect(session.timeSignature.denominator).toBe(8);
			});

			it('should handle unusual time signatures', () => {
				handleSessionUpdate({
					type: 'time-signature',
					timeSignature: { numerator: 5, denominator: 4 },
					timestamp: Date.now()
				});
				expect(session.timeSignature.numerator).toBe(5);
				expect(session.timeSignature.denominator).toBe(4);

				handleSessionUpdate({
					type: 'time-signature',
					timeSignature: { numerator: 7, denominator: 8 },
					timestamp: Date.now()
				});
				expect(session.timeSignature.numerator).toBe(7);
				expect(session.timeSignature.denominator).toBe(8);
			});
		});

		describe('loop updates', () => {
			it('should update loop state', () => {
				handleSessionUpdate({
					type: 'loop',
					isLooping: true,
					loopStart: 4,
					loopEnd: 16,
					timestamp: Date.now()
				});
				expect(session.isLooping).toBe(true);
				expect(session.loopStart).toBe(4);
				expect(session.loopEnd).toBe(16);
			});

			it('should disable looping', () => {
				handleSessionUpdate({
					type: 'loop',
					isLooping: false,
					loopStart: 0,
					loopEnd: 0,
					timestamp: Date.now()
				});
				expect(session.isLooping).toBe(false);
			});
		});

		describe('metronome updates', () => {
			it('should enable metronome', () => {
				handleSessionUpdate({ type: 'metronome', enabled: true, timestamp: Date.now() });
				expect(session.metronome).toBe(true);
			});

			it('should disable metronome', () => {
				handleSessionUpdate({ type: 'metronome', enabled: false, timestamp: Date.now() });
				expect(session.metronome).toBe(false);
			});
		});

		describe('groove updates', () => {
			it('should update groove amount', () => {
				handleSessionUpdate({ type: 'groove', amount: 0.5, timestamp: Date.now() });
				expect(session.groove).toBe(0.5);
			});
		});

		describe('session record updates', () => {
			it('should enable session record', () => {
				handleSessionUpdate({ type: 'session-record', isRecording: true, timestamp: Date.now() });
				expect(session.sessionRecord).toBe(true);
			});

			it('should disable session record', () => {
				handleSessionUpdate({ type: 'session-record', isRecording: false, timestamp: Date.now() });
				expect(session.sessionRecord).toBe(false);
			});
		});

		describe('return values', () => {
			it('should return true for handled updates', () => {
				expect(handleSessionUpdate({ type: 'tempo', bpm: 120, timestamp: Date.now() })).toBe(true);
				expect(handleSessionUpdate({ type: 'transport', isPlaying: true, timestamp: Date.now() })).toBe(true);
			});

			it('should return false for unhandled update types', () => {
				// @ts-expect-error - Testing invalid type
				expect(handleSessionUpdate({ type: 'unknown', timestamp: Date.now() })).toBe(false);
			});
		});
	});

	describe('selectTrackOptimistically', () => {
		beforeEach(() => {
			// Reset to a known track so tests start from a clean state
			handleSessionUpdate({ type: 'track-selection', trackIndex: 0, timestamp: Date.now() });
			vi.clearAllMocks();
		});

		it('updates selectedTrackIndex immediately', () => {
			session.selectTrackOptimistically(3);
			expect(session.selectedTrackIndex).toBe(3);
		});

		it('is a no-op when the index is already current', () => {
			session.selectTrackOptimistically(0);
			expect(session.selectedTrackIndex).toBe(0);
		});

		it('calls centralDisplayStore.setView("system") when selecting master (-1)', () => {
			session.selectTrackOptimistically(-1);
			expect(centralDisplayStore.setView).toHaveBeenCalledWith('system');
		});

		it('does not call centralDisplayStore.setView for regular tracks', () => {
			session.selectTrackOptimistically(2);
			expect(centralDisplayStore.setView).not.toHaveBeenCalled();
		});

		it('stale echo is ignored — rapid A→B tap does not flash A', () => {
			// Simulate: tap track 1 (optimistic), then immediately tap track 2 (optimistic)
			session.selectTrackOptimistically(1);
			session.selectTrackOptimistically(2);
			expect(session.selectedTrackIndex).toBe(2);

			// Track 1's echo arrives first — should be dropped
			handleSessionUpdate({ type: 'track-selection', trackIndex: 1, timestamp: Date.now() });
			expect(session.selectedTrackIndex).toBe(2);

			// Track 2's echo arrives — confirms and clears pending
			handleSessionUpdate({ type: 'track-selection', trackIndex: 2, timestamp: Date.now() });
			expect(session.selectedTrackIndex).toBe(2);
		});

		it('Ableton-initiated selection (no pending) always applies', () => {
			// No optimistic write — pending is null
			handleSessionUpdate({ type: 'track-selection', trackIndex: 5, timestamp: Date.now() });
			expect(session.selectedTrackIndex).toBe(5);
		});

		it('confirming echo clears pending so a subsequent Ableton selection applies', () => {
			session.selectTrackOptimistically(3);
			// Confirming echo for 3
			handleSessionUpdate({ type: 'track-selection', trackIndex: 3, timestamp: Date.now() });
			// Now Ableton changes selection externally
			handleSessionUpdate({ type: 'track-selection', trackIndex: 7, timestamp: Date.now() });
			expect(session.selectedTrackIndex).toBe(7);
		});
	});
});
