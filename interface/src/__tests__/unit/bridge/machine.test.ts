/**
 * `/bridge/machine` (onboarding.plan.md §6.5): the bridge's snapshot of the
 * Mac's values — library paths, this checkout's Max devices folder, the
 * TotalMix range — so a client compiles none of them in.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { machineSnapshot, createMachineRegistry, MACHINE_ADDRESS, repoRootFromHere } = require('../../../../bridge/utils/machine.js');

describe('machineSnapshot', () => {
	it('carries the two library paths, the Max devices folder from the repo root, and the TotalMix range', () => {
		const snap = machineSnapshot(
			{ paths: { instrumentsBase: '/Lib/Instruments', effectPresetsBase: '/Lib/Effects' }, osc: { totalmix: { minDb: -65, maxDb: 6, silenceDb: -300 } } },
			{ repoRoot: '/repo' }
		);
		expect(snap).toEqual({
			paths: { instrumentsBase: '/Lib/Instruments', effectPresetsBase: '/Lib/Effects', m4lDevicesRoot: '/repo/Vamp Devices' },
			totalmix: { minDb: -65, maxDb: 6, silenceDb: -300 }
		});
	});

	it('answers empty paths and no range for a config with none, never a throw', () => {
		const snap = machineSnapshot({}, { repoRoot: '/repo' });
		expect(snap.paths).toEqual({ instrumentsBase: '', effectPresetsBase: '', m4lDevicesRoot: '/repo/Vamp Devices' });
		expect(snap.totalmix).toBeNull();
	});

	it('finds this checkout from the bridge folder', () => {
		// By what the checkout holds, not its folder's name: a clone can be
		// called anything (`vamp`, a worktree's own name).
		expect(existsSync(join(repoRootFromHere(), 'Vamp Devices'))).toBe(true);
		expect(existsSync(join(repoRootFromHere(), 'config', 'constants.json'))).toBe(true);
	});
});

describe('createMachineRegistry', () => {
	it('names the address and ships one JSON argument', () => {
		const reg = createMachineRegistry({ paths: { instrumentsBase: '/a' } }, { repoRoot: '/repo' });
		expect(reg.MACHINE_ADDRESS).toBe('/bridge/machine');
		expect(MACHINE_ADDRESS).toBe('/bridge/machine');
		const [json] = reg.wireArgs();
		expect(JSON.parse(json).paths.instrumentsBase).toBe('/a');
	});
});
