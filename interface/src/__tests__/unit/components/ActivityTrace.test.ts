/**
 * The Compressor's activity view as Vamp draws it (ADR-543): the reading's
 * fill, line and threshold as an SVG, broken where Live drew no line, and
 * nothing at all with no reading or the switch off.
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

beforeEach(() => {
	liveMeterStore.reset();
	switchOn(true);
});

describe('ActivityTrace', () => {
	it('draws the fill, the threshold and the line, breaking the line where Live drew none', () => {
		const { container } = render(ActivityTrace, { devicePath: PATH, ink: '#e0b030' });
		liveMeterStore.handleMessage(ACTIVITY_ADDRESS, [PATH, 'ok', 0.3, 0.5, 0.25, 0, 0, 0.85, 0.8, -1, 0.75]);
		flushSync();
		const svg = container.querySelector('[data-activity]');
		expect(svg).not.toBeNull();
		expect(container.querySelector('.fill')?.getAttribute('d')).toBe('M0,100L0,50.00L12.50,50.00L37.50,75.00L62.50,100.00L87.50,100.00L100,100.00L100,100Z');
		expect(container.querySelector('.threshold')?.getAttribute('y1')).toBe('70');
		// Two strokes: the first two columns, then the last on its own.
		expect(container.querySelector('.line')?.getAttribute('d')).toBe('M12.50,15.00L37.50,20.00M87.50,25.00');
	});

	it('draws nothing with no reading, a status that is not ok, or the switch off', () => {
		const { container } = render(ActivityTrace, { devicePath: PATH, ink: '#e0b030' });
		flushSync();
		expect(container.querySelector('[data-activity]')).toBeNull();
		liveMeterStore.handleMessage(ACTIVITY_ADDRESS, [PATH, 'not-shown']);
		flushSync();
		expect(container.querySelector('[data-activity]')).toBeNull();
		liveMeterStore.handleMessage(ACTIVITY_ADDRESS, [PATH, 'ok', 0.3, 0.5, 0.85]);
		switchOn(false);
		flushSync();
		expect(container.querySelector('[data-activity]')).toBeNull();
	});
});
