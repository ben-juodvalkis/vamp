/**
 * Tests for session store - Session state management
 *
 * Tests cover:
 * - Time signature updates (ADR-182 bug fix)
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
import {
	session,
	handleTempoUpdate,
	handleTransportUpdate,
	handleTimeSignatureUpdate,
	handleLoopUpdate,
	handleMetronomeUpdate,
	handleGrooveUpdate,
	handleSessionRecordUpdate,
	handleTrackSelectionUpdate
} from '$lib/stores/session.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';

describe('session store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('the v3 setters', () => {
		describe('tempo updates', () => {
			it('should update tempo', () => {
				handleTempoUpdate(140);
				expect(session.tempo).toBe(140);
			});

			it('should handle decimal tempo values', () => {
				handleTempoUpdate(123.45);
				expect(session.tempo).toBe(123.45);
			});
		});

		describe('transport updates', () => {
			it('should update transport to playing', () => {
				handleTransportUpdate(true);
				expect(session.isPlaying).toBe(true);
			});

			it('should update transport to stopped', () => {
				handleTransportUpdate(false);
				expect(session.isPlaying).toBe(false);
			});
		});

		describe('time signature updates (ADR-182)', () => {
			it('should update to 4/4 time signature', () => {
				// First set to 3/4
				handleTimeSignatureUpdate(3, 4);
				expect(session.timeSignature.numerator).toBe(3);

				// Then update to 4/4 - this was the bug in ADR-182
				handleTimeSignatureUpdate(4, 4);
				expect(session.timeSignature.numerator).toBe(4);
				expect(session.timeSignature.denominator).toBe(4);
			});

			it('should handle partial numerator update (with default denominator)', () => {
				// Simulate AbletonOSC sending just numerator with parser default denominator
				handleTimeSignatureUpdate(7, 4);
				expect(session.timeSignature.numerator).toBe(7);
			});

			it('should handle partial denominator update (with default numerator)', () => {
				// Simulate AbletonOSC sending just denominator with parser default numerator
				handleTimeSignatureUpdate(4, 8);
				expect(session.timeSignature.denominator).toBe(8);
			});

			it('should handle unusual time signatures', () => {
				handleTimeSignatureUpdate(5, 4);
				expect(session.timeSignature.numerator).toBe(5);
				expect(session.timeSignature.denominator).toBe(4);

				handleTimeSignatureUpdate(7, 8);
				expect(session.timeSignature.numerator).toBe(7);
				expect(session.timeSignature.denominator).toBe(8);
			});
		});

		describe('loop updates', () => {
			it('should update loop state', () => {
				handleLoopUpdate(true, 4, 16);
				expect(session.isLooping).toBe(true);
				expect(session.loopStart).toBe(4);
				expect(session.loopEnd).toBe(16);
			});

			it('should disable looping', () => {
				handleLoopUpdate(false, 0, 0);
				expect(session.isLooping).toBe(false);
			});
		});

		describe('metronome updates', () => {
			it('should enable metronome', () => {
				handleMetronomeUpdate(true);
				expect(session.metronome).toBe(true);
			});

			it('should disable metronome', () => {
				handleMetronomeUpdate(false);
				expect(session.metronome).toBe(false);
			});
		});

		describe('groove updates', () => {
			it('should update groove amount', () => {
				handleGrooveUpdate(0.5);
				expect(session.groove).toBe(0.5);
			});
		});

		describe('session record updates', () => {
			it('should enable session record', () => {
				handleSessionRecordUpdate(true);
				expect(session.sessionRecord).toBe(true);
			});

			it('should disable session record', () => {
				handleSessionRecordUpdate(false);
				expect(session.sessionRecord).toBe(false);
			});
		});
	});

	describe('selectTrackOptimistically', () => {
		beforeEach(() => {
			// Reset to a known track so tests start from a clean state
			handleTrackSelectionUpdate(0);
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
			handleTrackSelectionUpdate(1);
			expect(session.selectedTrackIndex).toBe(2);

			// Track 2's echo arrives — confirms and clears pending
			handleTrackSelectionUpdate(2);
			expect(session.selectedTrackIndex).toBe(2);
		});

		it('Ableton-initiated selection (no pending) always applies', () => {
			// No optimistic write — pending is null
			handleTrackSelectionUpdate(5);
			expect(session.selectedTrackIndex).toBe(5);
		});

		it('confirming echo clears pending so a subsequent Ableton selection applies', () => {
			session.selectTrackOptimistically(3);
			// Confirming echo for 3
			handleTrackSelectionUpdate(3);
			// Now Ableton changes selection externally
			handleTrackSelectionUpdate(7);
			expect(session.selectedTrackIndex).toBe(7);
		});
	});
});
