/**
 * The Live connection banner: the performance screen says why it is empty
 * when Live, its Vamp surface or the bridge is missing. A refused handshake
 * shows at once; anything else only after a grace period, so a reconnect
 * that settles quickly never flashes it. Its button opens Settings →
 * Connection, and it hides while Settings is open.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import LiveConnectionBanner from '$lib/components/v6/session/LiveConnectionBanner.svelte';
import { _resetForTests, markAccepted, markFailed, markHelloSent } from '$lib/stores/v3/handshakeState.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';

function banner(): HTMLElement | null {
	return document.querySelector('[data-debug="live-banner"]');
}

describe('LiveConnectionBanner', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		_resetForTests();
		bridgeStatus.reset();
		settingsStore.closeSettings();
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it('says nothing while connected', () => {
		markAccepted('3.12.0');
		render(LiveConnectionBanner);
		vi.advanceTimersByTime(10_000);
		flushSync();
		expect(banner()).toBeNull();
	});

	it('waits out the grace period before saying Live is not answering', () => {
		markHelloSent();
		bridgeStatus.updateService('pythonSurface', 'disconnected');
		render(LiveConnectionBanner);
		vi.advanceTimersByTime(2_000);
		flushSync();
		expect(banner()).toBeNull();
		vi.advanceTimersByTime(3_000);
		flushSync();
		expect(banner()?.textContent).toContain('Live isn’t answering');
		expect(banner()?.textContent).toContain('Vamp chosen as a Control Surface');
	});

	it('names a refused handshake at once, and how to fix it', () => {
		render(LiveConnectionBanner);
		markFailed('surface speaks 3.11.0');
		flushSync();
		expect(banner()?.textContent).toContain('Live runs a different Vamp');
		expect(banner()?.textContent).toContain('Quit and reopen Live');
	});

	it('goes when the handshake is accepted', () => {
		markHelloSent();
		render(LiveConnectionBanner);
		vi.advanceTimersByTime(5_000);
		flushSync();
		expect(banner()).not.toBeNull();
		markAccepted('3.12.0');
		flushSync();
		expect(banner()).toBeNull();
	});

	it('opens Settings on Connection, and hides while Settings is open', async () => {
		markFailed('surface speaks 3.11.0');
		render(LiveConnectionBanner);
		flushSync();
		const button = screen.getByRole('button', { name: 'Settings' });
		await fireEvent.pointerDown(button, { pointerId: 1, button: 0, isPrimary: true });
		await fireEvent.pointerUp(window, { pointerId: 1, button: 0, isPrimary: true });
		flushSync();
		expect(settingsStore.open).toBe(true);
		expect(settingsStore.section).toBe('connection');
		expect(banner()).toBeNull();
	});
});
