import { describe, it, expect, beforeEach } from 'vitest';
import { meldEngineStore } from '$lib/stores/v6/meldEngineStore.svelte';
import { INSTRUMENT_CONTROLS, instrumentControlFor } from '$lib/components/v6/device-panel/deviceControls';
import { MELD_ENGINE } from '$lib/components/v6/central/views/meldParams';

// The effect chain's Meld cell follows the engine the Meld view shows
// (2026-11-06): its pad is that engine's Osc Shape across, Osc Tone up.
describe('Meld chain cell follows the shown engine', () => {
	const path = 'tracks/2/devices/0';
	beforeEach(() => meldEngineStore.reset());

	it('is Engine A until the view picks B', () => {
		expect(meldEngineStore.engineOf(path)).toBe('A');
		expect(instrumentControlFor('meld', path)).toMatchObject({
			title: 'Osc A',
			x: MELD_ENGINE.A.oscShape,
			y: MELD_ENGINE.A.oscTone,
			on: MELD_ENGINE.A.on
		});
	});

	it("drives B's Shape, Tone and On once the view shows B (68 / 69 / 61)", () => {
		meldEngineStore.select(path, 'B');
		const c = instrumentControlFor('meld', path);
		expect(c).toMatchObject({ title: 'Osc B', x: 68, y: 69, on: 61 });
		expect(c).toMatchObject({ x: MELD_ENGINE.B.oscShape, y: MELD_ENGINE.B.oscTone, on: MELD_ENGINE.B.on });
	});

	it('keeps the pick per device', () => {
		meldEngineStore.select(path, 'B');
		expect(instrumentControlFor('meld', 'tracks/3/devices/0')?.title).toBe('Osc A');
	});

	it('leaves every other instrument as the table has it', () => {
		for (const type of Object.keys(INSTRUMENT_CONTROLS).filter((t) => t !== 'meld')) {
			expect(instrumentControlFor(type, path)).toBe(INSTRUMENT_CONTROLS[type]);
		}
	});
});
