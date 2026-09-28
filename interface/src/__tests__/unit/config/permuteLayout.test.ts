/**
 * permuteLayout — Permute's pattern controls resolved by NAME (permute
 * ADR-020), with the positional table only as a per-role fallback.
 */

import { describe, it, expect } from 'vitest';
import {
	MUTE_STEP_ROLES,
	PERMUTE_MAX_STEPS,
	PERMUTE_PARAM_DEFAULTS,
	PERMUTE_PARAM_INDEX_FALLBACK,
	PERMUTE_PARAM_NAMES,
	PERMUTE_ROLES,
	PITCH_STEP_ROLES,
	positionalPermuteLayout,
	resolvePermuteLayout
} from '$lib/config/permuteLayout';

const DEVICE = 'tracks/3/devices/1';

/** A device from before ADR-443: Device On, then the first 22 controls. */
const NAMES_BEFORE_ADR_443 = [
	'Device On',
	'Mute 1', 'Mute 2', 'Mute 3', 'Mute 4', 'Mute 5', 'Mute 6', 'Mute 7', 'Mute 8',
	'Mute Length', 'Mute Rate',
	'Pitch 1', 'Pitch 2', 'Pitch 3', 'Pitch 4', 'Pitch 5', 'Pitch 6', 'Pitch 7', 'Pitch 8',
	'Pitch Length', 'Pitch Rate', 'Chance', 'Temperature'
];

/** The thin device as Live reports it: Device On, the 22, then steps 9-16 of each lane (ADR-443). */
function measuredRecords(devicePath = DEVICE, offset = 0, names = [
	...NAMES_BEFORE_ADR_443,
	'Mute 9', 'Mute 10', 'Mute 11', 'Mute 12', 'Mute 13', 'Mute 14', 'Mute 15', 'Mute 16',
	'Pitch 9', 'Pitch 10', 'Pitch 11', 'Pitch 12', 'Pitch 13', 'Pitch 14', 'Pitch 15', 'Pitch 16'
]) {
	return names.map((name, i) => ({ paramPath: `${devicePath}/params/${i + offset}`, name }));
}

describe('permuteLayout', () => {
	it('covers all 38 pattern controls with names and fallback indices', () => {
		expect(PERMUTE_ROLES).toHaveLength(38);
		expect(MUTE_STEP_ROLES).toHaveLength(PERMUTE_MAX_STEPS);
		expect(PITCH_STEP_ROLES).toHaveLength(PERMUTE_MAX_STEPS);
		for (const role of PERMUTE_ROLES) {
			expect(PERMUTE_PARAM_NAMES[role]).toBeTruthy();
			expect(PERMUTE_PARAM_INDEX_FALLBACK[role]).toBeGreaterThan(0);
			expect(PERMUTE_PARAM_DEFAULTS[role]).toBeDefined();
		}
		// The device's order: fallback indices are 1..38 in role order.
		expect(PERMUTE_ROLES.map((r) => PERMUTE_PARAM_INDEX_FALLBACK[r])).toEqual(
			Array.from({ length: 38 }, (_, i) => i + 1)
		);
	});

	it('resolves every role by name on the measured device (nothing positional)', () => {
		const layout = resolvePermuteLayout({ devicePath: DEVICE, params: measuredRecords() });
		expect(layout.positional).toEqual([]);
		expect(layout.paths.mute1).toBe(`${DEVICE}/params/1`);
		expect(layout.paths.muteRate).toBe(`${DEVICE}/params/10`);
		expect(layout.paths.pitch8).toBe(`${DEVICE}/params/18`);
		expect(layout.paths.temperature).toBe(`${DEVICE}/params/22`);
		expect(layout.paths.mute9).toBe(`${DEVICE}/params/23`);
		expect(layout.paths.pitch16).toBe(`${DEVICE}/params/38`);
	});

	it('reads a device from before ADR-443 by name, steps 9-16 positional', () => {
		const layout = resolvePermuteLayout({
			devicePath: DEVICE,
			params: measuredRecords(DEVICE, 0, NAMES_BEFORE_ADR_443)
		});
		expect(layout.positional).toEqual([...MUTE_STEP_ROLES.slice(8), ...PITCH_STEP_ROLES.slice(8)]);
		expect(layout.paths.temperature).toBe(`${DEVICE}/params/22`);
	});

	it('follows the names when the indices shift (a hidden parameter inserted first)', () => {
		const layout = resolvePermuteLayout({ devicePath: DEVICE, params: measuredRecords(DEVICE, 2) });
		expect(layout.positional).toEqual([]);
		expect(layout.paths.mute1).toBe(`${DEVICE}/params/3`);
		expect(layout.paths.chance).toBe(`${DEVICE}/params/23`);
	});

	it('accepts the record map itself (DeviceRecord.params shape)', () => {
		const map = new Map(measuredRecords().map((r) => [r.paramPath, r]));
		const layout = resolvePermuteLayout({ devicePath: DEVICE, params: map });
		expect(layout.paths.pitchLength).toBe(`${DEVICE}/params/19`);
		expect(layout.positional).toEqual([]);
	});

	it('falls back to the positional table per role when a name is absent', () => {
		const records = measuredRecords().filter((r) => r.name !== 'Chance');
		const layout = resolvePermuteLayout({ devicePath: DEVICE, params: records });
		expect(layout.positional).toEqual(['chance']);
		expect(layout.paths.chance).toBe(`${DEVICE}/params/21`);
		expect(layout.paths.temperature).toBe(`${DEVICE}/params/22`);
	});

	it('is fully positional for records that carry no names', () => {
		const records = Array.from({ length: 39 }, (_, i) => ({
			paramPath: `${DEVICE}/params/${i}`,
			name: `p${i}`
		}));
		const layout = resolvePermuteLayout({ devicePath: DEVICE, params: records });
		expect(layout.positional).toHaveLength(38);
		expect(layout.paths.mute3).toBe(`${DEVICE}/params/3`);
		expect(positionalPermuteLayout(DEVICE).paths).toEqual(layout.paths);
	});

	it('takes the first record for a duplicated name', () => {
		const records = [
			{ paramPath: `${DEVICE}/params/4`, name: 'Mute 1' },
			{ paramPath: `${DEVICE}/params/9`, name: 'Mute 1' }
		];
		const layout = resolvePermuteLayout({ devicePath: DEVICE, params: records });
		expect(layout.paths.mute1).toBe(`${DEVICE}/params/4`);
	});
});
