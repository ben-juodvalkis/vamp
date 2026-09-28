/**
 * presetSwap — folder-next on an instrument with no similarity vector
 * (ADR-439 phase 2). A step loads the catalog neighbor of the track's
 * recorded preset through the replace path, wrapping at the folder's ends.
 * The folder follows the track's recorded preset — and the record the pill's
 * own load produces is recognized, never looked up again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { presetSwap } from '$lib/services/presetSwap.svelte';
import type { Preset } from '$lib/services/adapters/browserAdapter';
import type { PresetSiblings } from '$lib/services/presetSwapCatalog';

const TRACK = 'tracks/11';
const BASE = '/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/Looping Presets/Instruments';
const FOLDER: Preset[] = ['Airy', 'Bell', 'Clav', 'Dust'].map((name) => ({
	name,
	path: `Omnisphere/Key/Soft/${name}.prt_omn`,
	fullPath: `${BASE}/Omnisphere/Key/Soft/${name}.prt_omn`,
	type: 'prt_omn'
}));
const at = (i: number) => FOLDER[i].fullPath;

let loads: Array<[string, string]> = [];
let finds = 0;

async function find(fullPath: string): Promise<PresetSiblings | null> {
	finds += 1;
	const index = FOLDER.findIndex((p) => p.fullPath === fullPath);
	return index < 0 ? null : { typeId: 'key', presets: FOLDER, index, path: ['Omnisphere', 'Soft'] };
}

beforeEach(() => {
	presetSwap._resetForTests();
	loads = [];
	finds = 0;
	presetSwap._setForTests({
		find,
		load: async (preset, trackPath) => void loads.push([preset.fullPath, trackPath])
	});
});

describe('presetSwap.sync', () => {
	it('has nothing to step from on a track with no recorded preset', async () => {
		await presetSwap.sync(TRACK, '');
		expect(presetSwap.state(TRACK)?.status).toBe('no-preset');
	});

	it('says so when no catalog holds the recorded preset', async () => {
		await presetSwap.sync(TRACK, `${BASE}/Elsewhere/Gone.adv`);
		expect(presetSwap.state(TRACK)?.status).toBe('not-in-catalog');
	});

	it('finds the recorded preset in its folder', async () => {
		await presetSwap.sync(TRACK, at(1));
		expect(presetSwap.state(TRACK)).toMatchObject({ status: 'ready', index: 1, working: false, error: null });
		expect(presetSwap.state(TRACK)?.presets).toHaveLength(4);
	});

	it('does not look the folder up again for the preset it already shows', async () => {
		await presetSwap.sync(TRACK, at(1));
		await presetSwap.sync(TRACK, at(1));
		expect(finds).toBe(1);
	});

	it('lets the latest recorded preset win over a slower lookup', async () => {
		let release!: () => void;
		presetSwap._setForTests({
			find: async (fullPath) => {
				if (fullPath === at(0)) await new Promise<void>((resolve) => (release = resolve));
				return find(fullPath);
			}
		});
		const slow = presetSwap.sync(TRACK, at(0));
		await presetSwap.sync(TRACK, at(2));
		release();
		await slow;
		expect(presetSwap.state(TRACK)).toMatchObject({ status: 'ready', index: 2 });
	});
});

describe('presetSwap stepping', () => {
	beforeEach(async () => {
		await presetSwap.sync(TRACK, at(0));
	});

	it('loads the neighbor onto the track', async () => {
		await presetSwap.step(TRACK, 1);
		expect(loads).toEqual([[at(1), TRACK]]);
		expect(presetSwap.state(TRACK)).toMatchObject({ index: 1, working: false });
	});

	it('wraps at the folder ends', async () => {
		await presetSwap.step(TRACK, -1);
		expect(loads).toEqual([[at(3), TRACK]]);
		expect(presetSwap.state(TRACK)?.index).toBe(3);
		await presetSwap.step(TRACK, 1);
		expect(loads.at(-1)).toEqual([at(0), TRACK]);
	});

	it('recognises the record its own load produces, even before the load settles', async () => {
		let finish!: () => void;
		presetSwap._setForTests({
			load: (preset, trackPath) =>
				new Promise<void>((resolve) => {
					loads.push([preset.fullPath, trackPath]);
					finish = resolve;
				})
		});
		const step = presetSwap.step(TRACK, 1);
		const lookups = finds;
		await presetSwap.sync(TRACK, at(1));
		expect(finds).toBe(lookups);
		expect(presetSwap.state(TRACK)).toMatchObject({ status: 'ready', working: true });
		finish();
		await step;
		expect(presetSwap.state(TRACK)).toMatchObject({ index: 1, working: false });
	});

	it('follows a preset picked elsewhere', async () => {
		await presetSwap.step(TRACK, 1);
		await presetSwap.sync(TRACK, at(2));
		expect(presetSwap.state(TRACK)).toMatchObject({ status: 'ready', index: 2 });
		await presetSwap.step(TRACK, 1);
		expect(loads.at(-1)).toEqual([at(3), TRACK]);
	});

	it('lets go when the surface says the track no longer holds the preset', async () => {
		// Live's undo of our own step: the record the step produced is ours,
		// the blank the surface publishes after the undo is not.
		await presetSwap.step(TRACK, 1);
		await presetSwap.sync(TRACK, at(1));
		await presetSwap.sync(TRACK, '');
		expect(presetSwap.state(TRACK)?.status).toBe('no-preset');
		await presetSwap.step(TRACK, 1);
		expect(loads).toEqual([[at(1), TRACK]]);
	});

	it('anchors again on the preset a redo brings back', async () => {
		await presetSwap.step(TRACK, 1);
		await presetSwap.sync(TRACK, '');
		await presetSwap.sync(TRACK, at(1));
		expect(presetSwap.state(TRACK)).toMatchObject({ status: 'ready', index: 1 });
	});

	it('runs one load at a time', async () => {
		let finish!: () => void;
		presetSwap._setForTests({
			load: (preset, trackPath) =>
				new Promise<void>((resolve) => {
					loads.push([preset.fullPath, trackPath]);
					finish = resolve;
				})
		});
		const first = presetSwap.step(TRACK, 1);
		expect(presetSwap.state(TRACK)?.working).toBe(true);
		await presetSwap.step(TRACK, 1);
		expect(loads).toHaveLength(1);
		finish();
		await first;
		expect(presetSwap.state(TRACK)).toMatchObject({ index: 1, working: false });
	});

	it('keeps its place and names the error when a load fails', async () => {
		presetSwap._setForTests({
			load: async () => {
				throw new Error('prepare_for_preset timed out');
			}
		});
		await presetSwap.step(TRACK, 1);
		expect(presetSwap.state(TRACK)).toMatchObject({ index: 0, working: false, error: 'prepare_for_preset timed out' });
	});
});
