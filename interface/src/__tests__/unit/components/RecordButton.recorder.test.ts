/**
 * REC records the selected track through its Vamp-Capture (capture.plan.md):
 * a tap sends `/capture/start <track> <source> [channel]` from Settings →
 * Capture, and the bridge loads the recorder first when the track has none.
 * Greyed out and inert, saying why, without the bridge or with the master
 * selected; a refused start never leaves REC latched "recording".
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/api/simpleClient.js', () => ({ send: vi.fn() }));
vi.mock('$lib/services/clipOperations', () => ({ loadCaptureIntoSimpler: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import RecordButton from '$lib/components/v6/controls/RecordButton.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { captureStore } from '$lib/stores/v6/captureStore.svelte';
import { captureSettings } from '$lib/stores/v6/captureSettingsStore.svelte';
import { session } from '$lib/stores/session.svelte';
import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
import { send } from '$lib/api/simpleClient';

const recorderIs = (captureRecorder: { enabled: boolean; available: boolean; reason: string }) =>
	bridgeStatus.updateFeatures(JSON.stringify({ captureRecorder }));
const bridgeUp = () => recorderIs({ enabled: true, available: true, reason: '' });

async function tap(button: Element) {
	await fireEvent.pointerDown(button);
	await fireEvent.pointerUp(button);
	await tick();
}

afterEach(() => {
	cleanup();
	bridgeStatus.updateFeatures('{}');
	captureStore.handleMessage('/capture/state', ['idle']);
	captureSettings.setDevice(null);
	captureSettings.setChannel('1/2');
	session.selectTrackOptimistically(0);
	v3ErrorBannerStore.clear();
	vi.mocked(send).mockClear();
});

describe('RecordButton', () => {
	it('waits for the bridge before it has said anything, and a tap sends nothing', async () => {
		const { container, getByText } = render(RecordButton, { props: { source: 'track' } });
		expect(getByText('Waiting for the bridge')).toBeTruthy();
		await tap(container.querySelector('button')!);
		expect(send).not.toHaveBeenCalled();
	});

	it('records the selected track on a tap', async () => {
		bridgeUp();
		session.selectTrackOptimistically(2);
		const { container } = render(RecordButton, { props: { source: 'track' } });
		const button = container.querySelector('button')!;
		expect(button.classList.contains('unavailable')).toBe(false);

		await tap(button);
		expect(send).toHaveBeenCalledWith('/capture/start', [2, 'track']);
		expect(button.classList.contains('recording')).toBe(true);
	});

	it('stops on a second tap while the first is still waiting for its answer', async () => {
		bridgeUp();
		session.selectTrackOptimistically(2);
		const { container } = render(RecordButton, { props: { source: 'track' } });
		const button = container.querySelector('button')!;
		await tap(button);
		await tap(button);
		const sent = vi.mocked(send).mock.calls.map((c) => c[0]);
		expect(sent).toEqual(['/capture/start', '/capture/stop']);
	});

	it('records the interface input on the channel Settings names', async () => {
		bridgeUp();
		session.selectTrackOptimistically(1);
		captureSettings.setChannel('3');
		const { container } = render(RecordButton, { props: { source: 'input' } });
		await tap(container.querySelector('button')!);
		expect(send).toHaveBeenCalledWith('/capture/start', [1, 'input', '3']);
	});

	it('on an input device, shows that input\'s live level all the time, and keeps it coming', async () => {
		bridgeUp();
		session.selectTrackOptimistically(1);
		captureSettings.setDevice({ uid: 'bf', name: 'Babyface Pro', inputs: 14 });
		captureSettings.setChannel('3/4');
		const { container, unmount } = render(RecordButton, { props: { source: 'input' } });
		await tick();
		expect(send).toHaveBeenCalledWith('/capture/input/monitor', ['bf']);
		captureStore.handleMessage('/capture/input/levels', ['bf', '[0, 0, 0.25, 0.5]', 'granted']);
		await tick();
		const fill = container.querySelector('.meter-fill') as HTMLElement;
		// Idle, not recording: the louder of the pair, 0.5, fills half the button.
		expect(fill.getAttribute('style')).toContain('--clip-top: 50%');
		unmount();
		expect(send).toHaveBeenLastCalledWith('/capture/input/monitor', ['']);
	});

	it('the track REC and the input REC are separate: each lights for its own take, the other waits', async () => {
		bridgeUp();
		session.selectTrackOptimistically(1);
		captureSettings.setChannel('1/2');
		const { container } = render(RecordButton, { props: { source: 'input' } });
		const { container: clip } = render(RecordButton, { props: { source: 'track' } });
		await tap(clip.querySelector('button')!);
		// The clip view's REC records the track, whatever the input is.
		expect(send).toHaveBeenCalledWith('/capture/start', [1, 'track']);
		captureStore.handleMessage('/capture/state', ['recording']);
		await tick();
		expect(clip.querySelector('button')!.classList.contains('recording')).toBe(true);
		const sidebar = container.querySelector('button')!;
		expect(sidebar.classList.contains('recording')).toBe(false);
		expect(sidebar.getAttribute('aria-label')).toBe('Record — Recording the track');
		vi.mocked(send).mockClear();
		await tap(sidebar);
		expect(send).not.toHaveBeenCalledWith('/capture/stop', []);
		captureStore.handleMessage('/capture/state', ['idle']);
		await tick();
		expect(sidebar.getAttribute('aria-label')).toBe('Record');
	});

	it('drops the take\'s meter to zero when it ends, rather than freezing on its last level', async () => {
		bridgeUp();
		session.selectTrackOptimistically(1);
		const { container } = render(RecordButton, { props: { source: 'input' } });
		await tap(container.querySelector('button')!);
		captureStore.handleMessage('/capture/state', ['recording']);
		captureStore.handleMessage('/capture/meter', [0.75]);
		await tick();
		const fill = container.querySelector('.meter-fill') as HTMLElement;
		expect(fill.getAttribute('style')).toContain('--clip-top: 25%');
		captureStore.handleMessage('/capture/state', ['idle']);
		await tick();
		expect(captureStore.meterLevel).toBe(0);
		expect(fill.getAttribute('style')).toContain('--clip-top: 100%');
	});

	it('is greyed out with the master selected, saying why', async () => {
		bridgeUp();
		session.selectTrackOptimistically(-1);
		const { container, getByText } = render(RecordButton, { props: { source: 'track' } });
		const button = container.querySelector('button')!;
		expect(button.classList.contains('unavailable')).toBe(true);
		expect(getByText('Select a track')).toBeTruthy();
		await tap(button);
		expect(send).not.toHaveBeenCalled();
	});

	it('lets go when the recorder is refused, and says why', async () => {
		bridgeUp();
		const { container } = render(RecordButton, { props: { source: 'track' } });
		const button = container.querySelector('button')!;
		await tap(button);

		captureStore.handleMessage('/capture/error', ['recorder-not-loaded', 'Vamp-Capture did not load on track 1']);
		captureStore.handleMessage('/capture/state', ['idle']);
		await tick();

		expect(button.classList.contains('recording')).toBe(false);
		expect(v3ErrorBannerStore.banner?.detail).toMatch(/Vamp Devices/);
	});

	it('drops a recording look when the bridge goes away mid-take', async () => {
		bridgeUp();
		captureStore.handleMessage('/capture/state', ['recording']);
		const { container } = render(RecordButton, { props: { source: 'track' } });
		const button = container.querySelector('button')!;
		expect(button.classList.contains('recording')).toBe(true);

		recorderIs({ enabled: true, available: false, reason: 'Bridge restarting' });
		await tick();
		expect(button.classList.contains('recording')).toBe(false);
		expect(captureStore.state).toBe('idle');
	});
});
