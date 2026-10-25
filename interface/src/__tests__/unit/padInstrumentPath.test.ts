import { describe, expect, it } from 'vitest';
import { padInstrumentPath, type PadFxMap } from '$lib/services/drumVirtualMacros';

const PAD = 'tracks/0/devices/0/pads/38';

describe('padInstrumentPath', () => {
	it('names the instrument where presence puts it', () => {
		const fx: PadFxMap = new Map([
			[38, [
				{ index: 0, className: 'MidiRandom', name: 'Random', type: 4 },
				{ index: 1, className: 'DrumCell', name: 'Snare', type: 1 },
				{ index: 2, className: 'Hybrid', name: 'Reverb', type: 2 }
			]]
		]);
		expect(padInstrumentPath(fx, PAD, 38)).toBe(`${PAD}/devices/1`);
	});
	it('falls back to the chain head before presence', () => {
		expect(padInstrumentPath(null, PAD, 38)).toBe(`${PAD}/devices/0`);
	});
});
