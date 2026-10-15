/**
 * GlitchLoop (the owner's PitchLoop89 rebuild, the glitchloop repo's
 * dist/GlitchLoop.amxd): the parameters the Glitch tile and view drive,
 * the device's Play page (2026-10-15): the macros, Mix and the FX.
 *
 * Resolved by NAME on the loaded device, because the device gains
 * parameters build to build and Live lists them by long name, so an
 * addition shifts the indices. glitchloop treats these names as a public
 * interface (its tests/check_params.py checks them). The index is the
 * fallback, used before the device has loaded (a pending write needs an
 * index): measured off the running Live with `owner/probes/device_dump.js`
 * on 2026-10-15, the 153-parameter build. Ranges are Live's.
 */
export const GLITCH_LOOP_PARAMS = {
	clock: { name: 'Clock', index: 13, min: 0, max: 10 },
	length: { name: 'Length', index: 40, min: -100, max: 100 },
	reach: { name: 'Reach', index: 130, min: -100, max: 100 },
	repeats: { name: 'Repeats', index: 131, min: -100, max: 100 },
	tone: { name: 'Tone', index: 143, min: -100, max: 100 },
	drift: { name: 'Drift', index: 16, min: -100, max: 100 },
	chaos: { name: 'Chaos', index: 6, min: 0, max: 100 },
	mix: { name: 'Dry/Wet', index: 19, min: 0, max: 100 },
	drive: { name: 'Drive', index: 17, min: -100, max: 100 },
	space: { name: 'Space', index: 140, min: 0, max: 100 },
	duck: { name: 'Duck', index: 20, min: 0, max: 100 },
	glue: { name: 'Glue', index: 27, min: 0, max: 100 },
	freeze: { name: 'Freeze', index: 132, min: 0, max: 1 }
} as const;

export type GlitchLoopParam = keyof typeof GLITCH_LOOP_PARAMS;

/** The parameter's index on this device: by name when listed, else the measured index. */
export function glitchLoopIndex(names: readonly string[], key: GlitchLoopParam): number {
	const { name, index } = GLITCH_LOOP_PARAMS[key];
	const byName = names.indexOf(name);
	return byName >= 0 ? byName : index;
}

/** A value in the parameter's range as 0..1, and back. Noon of a bipolar macro is 0.5. */
export function toUnit(key: GlitchLoopParam, value: number): number {
	const { min, max } = GLITCH_LOOP_PARAMS[key];
	return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function fromUnit(key: GlitchLoopParam, t: number): number {
	const { min, max } = GLITCH_LOOP_PARAMS[key];
	return min + Math.min(1, Math.max(0, t)) * (max - min);
}

/** Clock's eleven detents as Live labels them, 0 to 10; 5 (12k) is noon, neutral. */
export const CLOCK_LABELS = ['2k', '3k', '4k', '6k', '8k', '12k', '16k', '24k', '32k', '48k', '64k'] as const;
export const CLOCK_NOON = 5;

/**
 * The preset bank glitchloop's params.py generates (`GET
 * /api/glitchloop/presets`): values by parameter name in Live's units.
 */
export interface GlitchLoopPresets {
	bank: string[];
	presets: Record<string, Record<string, number>>;
	untouched: string[];
}

/**
 * A preset is loaded when every value it sets matches the device within
 * this fraction of the parameter's range. Measured 2026-10-15 on the rig:
 * the device on Memories read back within 2e-8 of the range on all 133
 * values; every other preset differs from it on 30 to 50 by up to the
 * whole range.
 */
export const PRESET_MATCH_FRACTION = 1e-5;

/** The first preset every value of which the device holds, or -1. */
export function matchingPreset(
	presets: GlitchLoopPresets,
	read: (name: string) => { value: number; min: number; max: number } | undefined
): number {
	return presets.bank.findIndex((name) => {
		const values = presets.presets[name];
		if (!values) return false;
		for (const [param, v] of Object.entries(values)) {
			const cur = read(param);
			if (!cur) return false;
			if (Math.abs(cur.value - v) > PRESET_MATCH_FRACTION * (Math.abs(cur.max - cur.min) || 1)) return false;
		}
		return true;
	});
}
