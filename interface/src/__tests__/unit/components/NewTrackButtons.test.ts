/**
 * The tracks panel's New Audio / New MIDI column (2026-10-23): each button
 * is one `prepare_for_preset` with no preset, and a second press of the
 * same kind while the first is in flight sends nothing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/services/trackPreparation', () => ({ prepareForPreset: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import NewTrackButtons from '$lib/components/v6/tracks/NewTrackButtons.svelte';
import { prepareForPreset } from '$lib/services/trackPreparation';

async function tap(button: Element) {
	await fireEvent.pointerDown(button);
	await fireEvent.pointerUp(button);
	await tick();
}

afterEach(() => {
	cleanup();
	vi.mocked(prepareForPreset).mockReset();
});

describe('NewTrackButtons', () => {
	it('prepares an audio or a MIDI track with no preset', async () => {
		vi.mocked(prepareForPreset).mockResolvedValue({ trackPath: 'tracks/3', trackIndex: 3, wasCreated: true });
		const { getByLabelText } = render(NewTrackButtons);

		await tap(getByLabelText('New Audio track'));
		await tap(getByLabelText('New MIDI track'));

		expect(prepareForPreset).toHaveBeenNthCalledWith(1, 'audio', '');
		expect(prepareForPreset).toHaveBeenNthCalledWith(2, 'midi', '');
	});

	it('ignores a second press of a kind still in flight, and takes one after it lands', async () => {
		let land!: () => void;
		vi.mocked(prepareForPreset).mockImplementationOnce(
			() => new Promise((resolve) => (land = () => resolve({ trackPath: 'tracks/3', trackIndex: 3, wasCreated: true })))
		);
		const { getByLabelText } = render(NewTrackButtons);
		const audio = getByLabelText('New Audio track');

		await tap(audio);
		expect(audio.getAttribute('aria-busy')).toBe('true');
		await tap(audio);
		expect(prepareForPreset).toHaveBeenCalledTimes(1);

		land();
		await tick();
		await tick();
		vi.mocked(prepareForPreset).mockResolvedValue({ trackPath: 'tracks/4', trackIndex: 4, wasCreated: true });
		await tap(audio);
		expect(prepareForPreset).toHaveBeenCalledTimes(2);
	});

	it('comes back from a refused prepare', async () => {
		vi.mocked(prepareForPreset).mockRejectedValueOnce(new Error('prepareForPreset create-failed: x'));
		const { getByLabelText } = render(NewTrackButtons);
		const midi = getByLabelText('New MIDI track');

		await tap(midi);
		await tick();
		expect(midi.getAttribute('aria-busy')).toBe('false');
	});
});
