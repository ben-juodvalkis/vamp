import { describe, expect, it } from 'vitest';
import { landedDevice } from '$lib/services/presetDragLoad.svelte';

const dev = (devicePath: string, className: string, name: string) => ({ devicePath, className, name });

describe('landedDevice', () => {
	it('is nothing until one more device of the class and preset name is on the chain', () => {
		const chain = [dev('tracks/0/devices/0', 'AudioEffectGroupDevice', 'Rack')];
		expect(landedDevice(chain, 'AutoFilter2', 'Disco Filter', 0)).toBeNull();
		const after = [...chain, dev('tracks/0/devices/1', 'AutoFilter2', 'Disco Filter')];
		expect(landedDevice(after, 'AutoFilter2', 'Disco Filter', 0)?.devicePath).toBe('tracks/0/devices/1');
	});

	it('never takes an Auto Filter of another name, or one that was already there', () => {
		const chain = [dev('tracks/0/devices/0', 'AutoFilter2', 'Wobble'), dev('tracks/0/devices/1', 'AutoFilter2', 'Disco Filter')];
		expect(landedDevice(chain, 'AutoFilter2', 'Disco Filter', 1)).toBeNull();
		const after = [...chain, dev('tracks/0/devices/2', 'AutoFilter2', 'Disco Filter')];
		expect(landedDevice(after, 'AutoFilter2', 'Disco Filter', 1)?.devicePath).toBe('tracks/0/devices/2');
	});
});
