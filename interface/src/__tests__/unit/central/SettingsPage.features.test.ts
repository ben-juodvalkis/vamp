/**
 * The Settings page's Move Knob switch (moved from the System view, plan.md §11) follows the bridge's `maxUtilityPatch`
 * switch (general-release audit §7b). The Move reaches the surface only
 * through the owner's standalone Max patch, so with the patch switched off —
 * and before the bridge has said anything — there is no Move Knob to press.
 * The other behaviour switches do not depend on it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/api/simpleClient.js', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import SettingsPage from '$lib/components/v6/settings/SettingsPage.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

const patch = (enabled: boolean) =>
	bridgeStatus.updateFeatures(
		JSON.stringify({ maxUtilityPatch: { enabled, available: enabled, reason: '' } })
	);

afterEach(() => {
	cleanup();
	bridgeStatus.updateFeatures('{}');
});

describe('SettingsPage and the maxUtilityPatch switch', () => {
	it('draws no Move Knob switch before the bridge has said anything', () => {
		const { queryByText, getByText } = render(SettingsPage);
		expect(queryByText('Move Knob')).toBeNull();
		expect(getByText('Auto-Arm')).toBeTruthy();
	});

	it('draws no Move Knob switch with the patch switched off', () => {
		patch(false);
		const { queryByText, getByText } = render(SettingsPage);
		expect(queryByText('Move Knob')).toBeNull();
		expect(getByText('Auto Rec')).toBeTruthy();
	});

	it('draws the Move Knob switch with the patch switched on', () => {
		patch(true);
		const { getByText } = render(SettingsPage);
		expect(getByText('Move Knob')).toBeTruthy();
	});
});
