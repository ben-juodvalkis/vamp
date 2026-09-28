/**
 * REC follows the recorder device (general-release plan.md §4,
 * `captureRecorder`): greyed out and inert, saying why, until the bridge has
 * heard the device's hello; live once it has. A refused start turns back down
 * the Send A its tap turned up, and never leaves REC latched "recording".
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/api/simpleClient.js', () => ({ send: vi.fn() }));
vi.mock('$lib/services/trackPreparation', () => ({ prepareForPreset: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/services/clipOperations', () => ({ loadCaptureIntoSimpler: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import RecordButton from '$lib/components/v6/controls/RecordButton.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { captureStore } from '$lib/stores/v6/captureStore.svelte';
import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
import { send } from '$lib/api/simpleClient';

const recorderIs = (captureRecorder: { enabled: boolean; available: boolean; reason: string }) =>
	bridgeStatus.updateFeatures(JSON.stringify({ captureRecorder }));

async function tap(button: Element) {
	await fireEvent.pointerDown(button);
	await fireEvent.pointerUp(button);
	await tick();
}

afterEach(() => {
	cleanup();
	bridgeStatus.updateFeatures('{}');
	captureStore.handleMessage('/capture/state', ['idle']);
	v3ErrorBannerStore.clear();
	vi.mocked(send).mockClear();
});

describe('RecordButton and the recorder device', () => {
	it('is greyed out with the reason, and a tap sends nothing, while no recorder is there', async () => {
		recorderIs({ enabled: true, available: false, reason: 'No recorder on Return A' });
		const { container, getByText } = render(RecordButton, { armTrackIndex: 2 });
		const button = container.querySelector('button')!;
		expect(button.classList.contains('unavailable')).toBe(true);
		expect(getByText('No recorder on Return A')).toBeTruthy();

		await tap(button);
		expect(send).not.toHaveBeenCalled();
		expect(button.classList.contains('recording')).toBe(false);
	});

	it('waits for the bridge before it has said anything', () => {
		const { getByText } = render(RecordButton);
		expect(getByText('Waiting for the bridge')).toBeTruthy();
	});

	it('records on a tap once the device has said hello', async () => {
		recorderIs({ enabled: true, available: true, reason: '' });
		const { container } = render(RecordButton, { armTrackIndex: 2 });
		const button = container.querySelector('button')!;
		expect(button.classList.contains('unavailable')).toBe(false);

		await tap(button);
		expect(send).toHaveBeenCalledWith('/looping/v3/track/send', ['tracks/2', 0, 1.0]);
		expect(send).toHaveBeenCalledWith('/capture/start', []);
		expect(button.classList.contains('recording')).toBe(true);
	});

	it('lets go and turns Send A back down when the device refuses the start', async () => {
		recorderIs({ enabled: true, available: true, reason: '' });
		const { container } = render(RecordButton, { armTrackIndex: 2 });
		const button = container.querySelector('button')!;
		await tap(button);
		vi.mocked(send).mockClear();

		captureStore.handleMessage('/capture/error', ['no-project-folder', 'unsaved']);
		await tick();

		expect(send).toHaveBeenCalledWith('/looping/v3/track/send', ['tracks/2', 0, 0.0]);
		expect(button.classList.contains('recording')).toBe(false);
		expect(v3ErrorBannerStore.banner?.detail).toMatch(/Save the set/);
	});

	it('drops a recording look when the device goes away mid-take', async () => {
		recorderIs({ enabled: true, available: true, reason: '' });
		captureStore.handleMessage('/capture/state', ['recording']);
		const { container } = render(RecordButton);
		const button = container.querySelector('button')!;
		expect(button.classList.contains('recording')).toBe(true);

		recorderIs({ enabled: true, available: false, reason: 'No recorder on Return A' });
		await tick();
		expect(button.classList.contains('recording')).toBe(false);
		expect(captureStore.state).toBe('idle');
	});
});
