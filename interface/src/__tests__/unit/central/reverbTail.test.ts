/**
 * The tail the Reverb tile draws behind its pad (ADR-477): read off the
 * Hybrid Reverb's parameters, and a drag on it lands where its handle is
 * drawn, so the tile's handle rides the picture's decay mark.
 */
import { describe, it, expect } from 'vitest';
import { reverbTail, decayAtTailX } from '$lib/components/v6/central/views/reverb/reverbTail';
import { tailPortrait } from '$lib/components/v6/central/views/reverb/tailPortrait';
import { HYBRID, LIVE_DEFAULTS } from '$lib/components/v6/device-panel/hybridReverbParams';

const rawOf = (values: Record<number, number>) => (index: number) => values[index] ?? LIVE_DEFAULTS[index] ?? 0;

describe('reverbTail', () => {
	it('lands a drag where the handle is drawn: the X round-trips to Decay', () => {
		for (const decay of [0.2, 0.4, 0.6]) {
			const { input } = reverbTail(rawOf({ [HYBRID.decay]: decay }), 120);
			const x = tailPortrait(input).tailEndX;
			expect(decayAtTailX(x, input.onset)).toBeCloseTo(decay, 3);
		}
	});

	it('names the band split on Dark Hall and Prism only', () => {
		expect(reverbTail(rawOf({ [HYBRID.algoType]: 0 }), 120).crossoverLabel).toMatch(/^Bass X /);
		expect(reverbTail(rawOf({ [HYBRID.algoType]: 4 }), 120).crossoverLabel).toMatch(/^X-Over /);
		expect(reverbTail(rawOf({ [HYBRID.algoType]: 1 }), 120).crossoverLabel).toBeUndefined();
	});

	it('spaces a synced Predelay by the song’s tempo', () => {
		const raw = rawOf({ [HYBRID.predelaySync]: 1, [HYBRID.predelay16th]: 4 });
		expect(reverbTail(raw, 120).input.echoSpacing).toBeCloseTo(0.5, 6); // four 16ths at 120 bpm
		expect(reverbTail(raw, 60).input.echoSpacing).toBeCloseTo(1, 6);
	});
});
