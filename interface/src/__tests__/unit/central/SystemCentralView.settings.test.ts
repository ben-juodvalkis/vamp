/**
 * The Settings split (plan.md §11, 2026-09-26): the master track's view keeps
 * Transport, Follow Key and Sections, and a gear opens the full-page
 * Settings. The setup cards — Auto-Arm, Auto Rec, Move Knob, the theme and
 * the foot switch — are Settings' now, and the wire they write is unchanged.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('$lib/api/simpleClient', () => ({ send: (...a: unknown[]) => send(...a) }));
vi.mock('$lib/api/simpleClient.js', () => ({ send: (...a: unknown[]) => send(...a) }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import SystemCentralView from '$lib/components/v6/central/views/SystemCentralView.svelte';
import SettingsPage from '$lib/components/v6/settings/SettingsPage.svelte';
import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { session } from '$lib/stores/session.svelte';
import { V3_SESSION_KEY_FOLLOW_ADDRESS, V3_SESSION_AUTO_ARM_ADDRESS } from '$lib/api/handlers/v3Session';

beforeEach(() => send.mockClear());
afterEach(() => {
	cleanup();
	settingsStore.closeSettings();
	settingsStore.firstRun = false;
	bridgeStatus.updateFeatures('{}');
});

describe('SystemCentralView after the Settings split', () => {
	it('keeps Transport, Follow Key and Sections, and no setup card', () => {
		const { getByText, queryByText, getByLabelText } = render(SystemCentralView);
		expect(getByText('Transport')).toBeTruthy();
		expect(getByText('Follow Key')).toBeTruthy();
		expect(getByText('Sections')).toBeTruthy();
		expect(getByLabelText('Show the transport header across the top')).toBeTruthy();
		for (const gone of ['Auto-Arm', 'Auto Rec', 'Move Knob', 'Appearance', 'Foot Switch', 'Learn', 'Behavior']) {
			expect(queryByText(gone), gone).toBeNull();
		}
	});

	it('Follow Key writes the same address as before, echo-confirmed', async () => {
		const { getByText } = render(SystemCentralView);
		const flipped = session.keyFollowEnabled ? 0 : 1;
		await fireEvent.click(getByText('Follow Key'));
		expect(send).toHaveBeenCalledWith(V3_SESSION_KEY_FOLLOW_ADDRESS, [flipped]);
	});

	it('the gear opens Settings', async () => {
		const { getByLabelText } = render(SystemCentralView);
		expect(settingsStore.open).toBe(false);
		await fireEvent.click(getByLabelText('Open Settings'));
		expect(settingsStore.open).toBe(true);
	});
});

describe('SettingsPage', () => {
	it('holds the setup cards and closes', async () => {
		settingsStore.openSettings();
		const { getByText, getByLabelText } = render(SettingsPage);
		for (const card of ['Behavior', 'Appearance', 'Foot Switch', 'Places', 'Features', 'Connection']) {
			expect(getByText(card), card).toBeTruthy();
		}
		const flipped = session.autoArmEnabled ? 0 : 1;
		await fireEvent.click(getByText('Auto-Arm'));
		expect(send).toHaveBeenCalledWith(V3_SESSION_AUTO_ARM_ADDRESS, [flipped]);
		await fireEvent.click(getByLabelText('Close settings'));
		expect(settingsStore.open).toBe(false);
	});

	it('lists every feature switch with its state and reason', () => {
		bridgeStatus.updateFeatures(
			JSON.stringify({
				totalmix: { enabled: true, available: false, reason: 'TotalMix has not answered' },
				maxUtilityPatch: { enabled: true, available: true, reason: '' },
				expressionPedal: { enabled: false, available: false, reason: '' }
			})
		);
		const { container, getByText } = render(SettingsPage);
		expect(container.querySelector('[data-feature="totalmix"]')?.getAttribute('data-state')).toBe('unavailable');
		expect(getByText('TotalMix has not answered')).toBeTruthy();
		expect(container.querySelector('[data-feature="maxUtilityPatch"]')?.getAttribute('data-state')).toBe('on');
		expect(container.querySelector('[data-feature="expressionPedal"]')?.getAttribute('data-state')).toBe('off');
	});

	it('reads as the first-run checklist while the Mac has saved nothing', () => {
		settingsStore.firstRun = true;
		const { getByText } = render(SettingsPage);
		expect(getByText(/set up Vamp/)).toBeTruthy();
	});
});
