import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

// The chain Live reports, as the store would hold it.
const chain = $state<{ devices: Array<{ devicePath: string; className: string; name: string }> }>({ devices: [] });
vi.mock('$lib/stores/v6/selectedTrackStore.svelte', () => ({
	selectedTrackStore: {
		get devicesByPath() {
			return chain.devices;
		},
		padDevices: () => []
	}
}));
const opened: string[] = [];
vi.mock('$lib/services/deviceViewRouter.svelte', () => ({ openDeviceView: (type: string) => opened.push(type) }));
const picks: Array<[string, string, string]> = [];
vi.mock('$lib/stores/v6/fxChainStore.svelte', () => ({
	RACK_PICK: 'audio-effect-rack',
	fxChainStore: { appoint: vi.fn(), pick: (scope: string, key: string, path: string) => picks.push([scope, key, path]) }
}));

import { openViewWhenLanded, openEffectView } from '$lib/services/effectView.svelte';

beforeEach(() => {
	chain.devices = [{ devicePath: 'tracks/1/devices/0', className: 'Gate', name: 'Gate' }];
	opened.length = 0;
	picks.length = 0;
});

describe('a loaded effect shows its view', () => {
	it('opens the view once the load lands, picking the device that landed, not the one already there', () => {
		const cancel = openViewWhenLanded({ trackPath: 'tracks/1', padPath: '', name: 'Gate' });
		flushSync();
		expect(opened).toEqual([]);
		chain.devices = [...chain.devices, { devicePath: 'tracks/1/devices/1', className: 'Gate', name: 'Gate' }];
		flushSync();
		expect(opened).toEqual(['gate']);
		expect(picks).toEqual([['tracks/1', 'gate', 'tracks/1/devices/1']]);
		cancel();
	});

	it('opens nothing for a load that never lands', () => {
		const cancel = openViewWhenLanded({ trackPath: 'tracks/1', padPath: '', name: 'Echo' });
		flushSync();
		expect(opened).toEqual([]);
		cancel();
	});

	it('opens the rack view for a rack the app does not know, the chain view for anything else', () => {
		openEffectView({ devicePath: 'tracks/1/devices/2', className: 'AudioEffectGroupDevice', name: 'Dub Space' }, { pickScope: 'tracks/1', padScoped: false });
		openEffectView({ devicePath: 'tracks/1/devices/3', className: 'AuPluginDevice', name: 'Supermassive' }, { pickScope: 'tracks/1', padScoped: false });
		expect(opened).toEqual(['audio-effect-rack', 'chain-device']);
	});
});
