/**
 * The Settings page's Pedals card (ADR-538): every pedal, read by the bridge
 * from any MIDI input. Its state is the bridge's (`/bridge/pedals`); the card
 * writes `/bridge/pedals/{enabled,learn,forget}` and draws what the bridge
 * says.
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
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

const base = {
	available: true,
	reason: '',
	wah: false,
	learn: null as null | { role: string; state: string },
	loop: { enabled: true, pedals: [] as object[], heard: false },
	wahToe: { pedal: null as null | object, heard: false },
	wahSweep: { pedal: null as null | object, heard: false }
};
let n = 0;
// A trailing counter keeps every frame distinct, as the store drops a repeat.
const bridgeSays = (patch: Partial<typeof base>) =>
	bridgeStatus.updatePedals(JSON.stringify({ ...base, ...patch, n: n++ }));

beforeEach(() => send.mockClear());
afterEach(() => {
	cleanup();
	bridgeSays({});
});

describe('the pedal state store', () => {
	it('reads every role, and drops a malformed pedal', () => {
		bridgeSays({
			wah: true,
			loop: { enabled: true, pedals: [{ channel: 10, cc: 23, mode: 'momentary', pressHigh: true }, { cc: 'x' }], heard: true },
			wahToe: { pedal: { channel: 10, cc: 21 }, heard: false }
		});
		expect(bridgeStatus.pedals.loop.pedals).toEqual([{ channel: 10, cc: 23, mode: 'momentary', pressHigh: true }]);
		expect(bridgeStatus.pedals.wahToe.pedal).toEqual({ channel: 10, cc: 21 });
		expect(bridgeStatus.pedals.wah).toBe(true);
	});
});

describe('SettingsPage Pedals card', () => {
	it('says nothing is learned, and Learn asks the bridge for a loop pedal', async () => {
		bridgeSays({});
		const { getByText } = render(SettingsPage);
		expect(getByText('Not learned')).toBeTruthy();
		await fireEvent.click(getByText('Learn your pedal'));
		expect(send).toHaveBeenLastCalledWith('/bridge/pedals/learn', ['loop', 1]);
	});

	it('shows every loop pedal, turns them off, and forgets them', async () => {
		bridgeSays({
			loop: {
				enabled: true,
				pedals: [
					{ channel: 10, cc: 23, mode: 'momentary', pressHigh: true },
					{ channel: 0, cc: 67, mode: 'latching', pressHigh: true }
				],
				heard: true
			}
		});
		const { getByText, getByLabelText } = render(SettingsPage);
		expect(getByText('CC 23 · Ch 10')).toBeTruthy();
		expect(getByText('CC 67 · Any ch · Latch')).toBeTruthy();
		await fireEvent.click(getByLabelText(/Loop pedal on/));
		expect(send).toHaveBeenLastCalledWith('/bridge/pedals/enabled', [0]);
		await fireEvent.click(getByText('Forget these pedals'));
		expect(send).toHaveBeenLastCalledWith('/bridge/pedals/forget', ['loop']);
	});

	it('the listening row cancels, and a learn that heard nothing tries again', async () => {
		bridgeSays({ learn: { role: 'loop', state: 'listening' } });
		const { getByText } = render(SettingsPage);
		await fireEvent.click(getByText('Press your pedal…'));
		expect(send).toHaveBeenLastCalledWith('/bridge/pedals/learn', ['loop', 0]);
		bridgeSays({ learn: { role: 'loop', state: 'timeout' } });
		await Promise.resolve();
		await fireEvent.click(getByText('Nothing heard'));
		expect(send).toHaveBeenLastCalledWith('/bridge/pedals/learn', ['loop', 1]);
	});

	it('draws the wah rows only while the wah is switched on, each with Learn', async () => {
		bridgeSays({});
		const off = render(SettingsPage);
		expect(off.queryByText('Wah toe switch')).toBeNull();
		cleanup();
		bridgeSays({ wah: true, wahToe: { pedal: { channel: 10, cc: 21 }, heard: true } });
		const { getByText } = render(SettingsPage);
		expect(getByText('CC 21 · Ch 10')).toBeTruthy();
		await fireEvent.click(getByText('Wah sweep'));
		expect(send).toHaveBeenLastCalledWith('/bridge/pedals/learn', ['wahSweep', 1]);
	});

	it('says why when the bridge cannot read MIDI', () => {
		bridgeSays({ available: false, reason: 'MIDI library missing' });
		const { getByText } = render(SettingsPage);
		expect(getByText('MIDI library missing')).toBeTruthy();
	});
});
