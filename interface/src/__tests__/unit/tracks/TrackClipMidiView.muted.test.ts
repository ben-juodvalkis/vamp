/**
 * Muted notes in the strip's clip thumbnail (ADR-444).
 *
 * The cheap notes blob carries Live's `MidiNote.mute` as the sign of the
 * velocity, and `decodeNotesBlob` folds it into `MidiNote.muted`. The
 * thumbnail must then draw such a note hollow, in signal-dim, and never
 * in the track's ink — otherwise a silent note reads as a sounding one.
 * Mounts the real lane view over a mocked notes service; the fetch is
 * the only seam.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/services/clipNotesService', () => ({
	requestNotes: vi.fn(),
	subscribeNotesChanged: vi.fn(() => () => {})
}));

import { render, cleanup, waitFor } from '@testing-library/svelte';
import { requestNotes } from '$lib/services/clipNotesService';
import TrackClipMidiView from '$lib/components/v6/tracks/TrackStrip/components/TrackClipMidiView.svelte';

const TRACK_INK = '#ff0000';

afterEach(cleanup);

describe('TrackClipMidiView — muted notes', () => {
	it('draws a muted note hollow in signal-dim and a sounding one in the track ink', async () => {
		vi.mocked(requestNotes).mockResolvedValue([
			{ pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, muted: false },
			{ pitch: 64, startBeats: 1, durationBeats: 1, velocity: 100, muted: true }
		]);
		const { container } = render(TrackClipMidiView, {
			props: {
				clipPath: 'tracks/0/slots/0/clip',
				lengthBeats: 4,
				loopStartBeats: 0,
				loopEndBeats: 4,
				status: 1,
				fraction: 0,
				color: TRACK_INK
			}
		});
		await waitFor(() => expect(container.querySelectorAll('.midi-note')).toHaveLength(2));
		const [sounding, muted] = Array.from(container.querySelectorAll<HTMLElement>('.midi-note'));

		// Read the raw attribute: jsdom's style parser drops a `color-mix()`
		// value it does not understand, so `.style.background` reads empty.
		expect(sounding.classList.contains('midi-note--muted')).toBe(false);
		expect(sounding.getAttribute('style')).toContain(TRACK_INK);

		expect(muted.classList.contains('midi-note--muted')).toBe(true);
		expect(muted.getAttribute('style')).not.toContain(TRACK_INK);
		expect(muted.getAttribute('style')).toContain('--signal-dim');
	});

	it('gives every note the same lane treatment — a muted note still occupies its pitch lane', async () => {
		vi.mocked(requestNotes).mockResolvedValue([
			{ pitch: 60, startBeats: 0, durationBeats: 1, velocity: 100, muted: true }
		]);
		const { container } = render(TrackClipMidiView, {
			props: {
				clipPath: 'tracks/0/slots/1/clip',
				lengthBeats: 4,
				loopStartBeats: 0,
				loopEndBeats: 4,
				status: 0,
				fraction: 0
			}
		});
		await waitFor(() => expect(container.querySelectorAll('.midi-note')).toHaveLength(1));
		const note = container.querySelector<HTMLElement>('.midi-note')!;
		// One distinct pitch, MIN_LANES = 4 → the note sits in the top lane at a quarter height.
		expect(note.getAttribute('style')).toMatch(/top:\s*0%/);
		expect(note.getAttribute('style')).toMatch(/height:\s*25%/);
		expect(container.querySelector('.midi-status--empty')).toBeNull();
	});
});
