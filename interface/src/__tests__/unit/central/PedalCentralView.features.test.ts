/**
 * The Pedal view's Wah button follows the bridge's `expressionPedal` switch
 * (general-release audit §7b). The wah is played by the owner's expression
 * pedal and nothing else, so with the switch off — and before the bridge has
 * said anything — there is no Wah to load.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/api/simpleClient.js', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import PedalCentralView from '$lib/components/v6/central/views/PedalCentralView.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

const pedal = (enabled: boolean) =>
	bridgeStatus.updateFeatures(
		JSON.stringify({ expressionPedal: { enabled, available: enabled, reason: '' } })
	);

afterEach(() => {
	cleanup();
	bridgeStatus.updateFeatures('{}');
});

describe('PedalCentralView and the expressionPedal switch', () => {
	it('draws no Wah before the bridge has said anything', () => {
		const { queryByText, getByText } = render(PedalCentralView);
		expect(queryByText('Wah')).toBeNull();
		expect(getByText('Fuzz')).toBeTruthy();
	});

	it('draws no Wah with the pedal switched off', () => {
		pedal(false);
		const { queryByText } = render(PedalCentralView);
		expect(queryByText('Wah')).toBeNull();
	});

	it('draws the Wah with the pedal switched on', () => {
		pedal(true);
		const { getByText } = render(PedalCentralView);
		expect(getByText('Wah')).toBeTruthy();
	});
});
