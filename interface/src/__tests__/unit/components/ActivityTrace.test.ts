/**
 * The Compressor's activity view as Vamp draws it (ADR-543): a reading
 * draws the fill, the threshold and the line; nothing is drawn with no
 * reading or the switch off. How it scrolls is `activityScroll.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import ActivityTrace from '$lib/components/v6/central/views/panel/ActivityTrace.svelte';
import { liveMeterStore, ACTIVITY_ADDRESS } from '$lib/stores/v6/liveMeterStore.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

const PATH = 'tracks/1/devices/1';
const switchOn = (on: boolean) =>
	bridgeStatus.updateFeatures(JSON.stringify({ liveMeters: { enabled: on, available: true, reason: '' } }));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

beforeEach(() => {
	liveMeterStore.reset();
	switchOn(true);
});

describe('ActivityTrace', () => {
	it('draws the fill, the threshold and an unbroken line', async () => {
		const { container } = render(ActivityTrace, { devicePath: PATH, ink: '#e0b030' });
		const n = 32;
		const fill = Array.from({ length: n }, (_, i) => (i % 8) / 10);
		const line = Array.from({ length: n }, (_, i) => (i === 5 ? -1 : 0.8));
		liveMeterStore.handleMessage(ACTIVITY_ADDRESS, [PATH, 'ok', 0.3, ...fill, ...line]);
		flushSync();
		await nextFrame();
		flushSync();
		expect(container.querySelector('[data-activity]')).not.toBeNull();
		expect(container.querySelector('.threshold')?.getAttribute('y1')).toBe('70');
		const d = container.querySelector('.line')?.getAttribute('d') ?? '';
		expect(d.startsWith('M')).toBe(true);
		expect(d.match(/M/g)).toHaveLength(1);
		expect(container.querySelector('.fill')?.getAttribute('d')).toMatch(/Z$/);
	});

	it('draws nothing with no reading, a status that is not ok, or the switch off', async () => {
		const { container } = render(ActivityTrace, { devicePath: PATH, ink: '#e0b030' });
		flushSync();
		expect(container.querySelector('[data-activity]')).toBeNull();
		liveMeterStore.handleMessage(ACTIVITY_ADDRESS, [PATH, 'not-shown']);
		flushSync();
		expect(container.querySelector('[data-activity]')).toBeNull();
		liveMeterStore.handleMessage(ACTIVITY_ADDRESS, [PATH, 'ok', 0.3, 0.5, 0.85]);
		switchOn(false);
		flushSync();
		await nextFrame();
		flushSync();
		expect(container.querySelector('[data-activity]')).toBeNull();
	});
});
