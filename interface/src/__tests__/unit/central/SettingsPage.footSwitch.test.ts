/**
 * The Settings page's Foot Switch card (moved from the System view, plan.md §11): a user setting with Learn, whose state
 * is the surface's (`/looping/v3/session/foot_switch`). The card writes the
 * two sub-addresses and draws what the surface says — including the one step
 * it cannot take for you when a learn hears nothing.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('$lib/api/simpleClient', () => ({ send: (...a: unknown[]) => send(...a) }));
vi.mock('$lib/api/simpleClient.js', () => ({ send: (...a: unknown[]) => send(...a) }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import SettingsPage from '$lib/components/v6/settings/SettingsPage.svelte';
import {
	handleV3Session,
	parseFootSwitch,
	V3_SESSION_FOOT_SWITCH_ADDRESS,
	V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS,
	V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS
} from '$lib/api/handlers/v3Session';
import { session } from '$lib/stores/session.svelte';

const surfaceSays = (...args: (number | string)[]) =>
	handleV3Session(V3_SESSION_FOOT_SWITCH_ADDRESS, args);

beforeEach(() => send.mockClear());
afterEach(() => {
	cleanup();
	surfaceSays(0, 0, -1, '', 'idle', 0);
});

describe('parseFootSwitch', () => {
	it('reads the six-field state', () => {
		expect(parseFootSwitch([1, 10, 23, 'momentary', 'idle', 1])).toEqual({
			enabled: true,
			channel: 10,
			cc: 23,
			mode: 'momentary',
			learn: 'idle',
			heard: true
		});
	});

	it('drops a malformed state whole', () => {
		expect(parseFootSwitch([1, 10, 23, 'momentary', 'idle'])).toBeNull();
		expect(parseFootSwitch([1, 17, 23, 'momentary', 'idle', 0])).toBeNull();
		expect(parseFootSwitch([1, 10, 128, 'momentary', 'idle', 0])).toBeNull();
		expect(parseFootSwitch([1, 10, 23, 'toggle', 'idle', 0])).toBeNull();
		expect(parseFootSwitch([1, 10, 23, 'momentary', 'done', 0])).toBeNull();
	});

	it('leaves the store alone on a malformed state', () => {
		surfaceSays(1, 10, 23, 'momentary', 'idle', 1);
		surfaceSays(1, 10, 999, 'momentary', 'idle', 1);
		expect(session.footSwitch.cc).toBe(23);
	});
});

describe('SettingsPage foot switch card', () => {
	it('says nothing is learned, and On asks the surface (which learns)', async () => {
		const { getByText, getByLabelText } = render(SettingsPage);
		expect(getByText('Not learned')).toBeTruthy();
		await fireEvent.click(getByLabelText(/Foot switch off/));
		expect(send).toHaveBeenCalledWith(V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS, [1]);
	});

	it('shows the mapping, and turns it off', async () => {
		surfaceSays(1, 10, 23, 'momentary', 'idle', 1);
		const { getByText, getByLabelText } = render(SettingsPage);
		expect(getByText('CC 23 · Ch 10')).toBeTruthy();
		await fireEvent.click(getByLabelText(/Foot switch on/));
		expect(send).toHaveBeenCalledWith(V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS, [0]);
	});

	it('marks a latching switch and an omni channel', () => {
		surfaceSays(1, 0, 64, 'latching', 'idle', 0);
		const { getByText } = render(SettingsPage);
		expect(getByText('CC 64 · Any ch · Latch')).toBeTruthy();
	});

	it('Learn starts, and the listening row cancels', async () => {
		const { getByText } = render(SettingsPage);
		await fireEvent.click(getByText('Learn'));
		expect(send).toHaveBeenLastCalledWith(V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS, [1]);
		surfaceSays(0, 0, -1, '', 'listening', 0);
		await Promise.resolve();
		await fireEvent.click(getByText('Press your pedal…'));
		expect(send).toHaveBeenLastCalledWith(V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS, [0]);
	});

	it('after a learn that heard nothing, says where the Input is set, and tries again', async () => {
		surfaceSays(0, 0, -1, '', 'timeout', 0);
		const { getByText } = render(SettingsPage);
		expect(getByText(/Vamp’s Input in Live’s MIDI settings/)).toBeTruthy();
		await fireEvent.click(getByText('Nothing heard'));
		expect(send).toHaveBeenLastCalledWith(V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS, [1]);
	});
});
