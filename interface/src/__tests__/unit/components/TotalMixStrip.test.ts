/**
 * TotalMixStrip with the feature switches (general-release audit §7b).
 *
 * The audit's complaint was a strip that looked alive on a Mac with no mixer.
 * With `totalmix` on but no word from TotalMix, the host passes the bridge's
 * reason, and the bars must then draw greyed out and say why. The live case
 * rides alongside as the positive control.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import TotalMixStrip from '$lib/components/v6/looping/TotalMixStrip.svelte';
import {
	applyTotalMix,
	applyTotalMixMeters,
	__resetTotalMixStoreForTests
} from '$lib/stores/v3/totalmix.svelte';

const REASON = 'TotalMix not answering';

afterEach(() => {
	cleanup();
	__resetTotalMixStoreForTests();
});

describe('TotalMixStrip (the status-strip mirror)', () => {
	it('keeps its words but marks itself unavailable', () => {
		const { container } = render(TotalMixStrip, { props: { unavailableReason: REASON } });
		const strip = container.querySelector('.tmh-strip') as HTMLElement;
		expect(strip.classList.contains('is-unavailable')).toBe(true);
		expect(strip.getAttribute('aria-disabled')).toBe('true');
		expect(container.querySelectorAll('.tmh-item')).toHaveLength(5);
		expect(container.querySelector('[data-channel="room"]')?.getAttribute('title')).toBe(REASON);
	});

	it('is the plain mirror with no reason, showing the level it has heard', () => {
		applyTotalMix('room', 0);
		const { container } = render(TotalMixStrip);
		const strip = container.querySelector('.tmh-strip') as HTMLElement;
		expect(strip.classList.contains('is-unavailable')).toBe(false);
		expect(strip.hasAttribute('aria-disabled')).toBe(false);
		expect(container.querySelector('[data-channel="room"]')?.getAttribute('aria-label')).not.toBe('room: 0%');
		expect(container.querySelector('[data-channel="click"]')?.getAttribute('aria-label')).toBe('click: 0%');
	});

	it('draws no faders', () => {
		const { container } = render(TotalMixStrip);
		expect(container.querySelectorAll('[role="slider"]')).toHaveLength(0);
	});

	it('fills with the signal meter and marks the fader with a line', () => {
		// −65..+6 dB: −29.5 dB is half the bar, +6 the end of it.
		applyTotalMix('room', 6);
		applyTotalMixMeters([-29.5, -300, -300, -300, -300]);
		const { container } = render(TotalMixStrip);
		const room = container.querySelector('[data-channel="room"]') as HTMLElement;
		expect((room.querySelector('.tmh-mask') as HTMLElement).style.width).toBe('50%');
		expect((room.querySelector('.tmh-fader') as HTMLElement).style.left).toBe('100%');
		const playback = container.querySelector('[data-channel="playback"]') as HTMLElement;
		expect((playback.querySelector('.tmh-mask') as HTMLElement).style.width).toBe('100%');
	});

	it('draws no line for a fader never heard from', () => {
		applyTotalMixMeters([-10, -10, -10, -10, -10]);
		const { container } = render(TotalMixStrip);
		expect(container.querySelector('[data-channel="click"] .tmh-fader')).toBeNull();
	});
});
