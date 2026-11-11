import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MiniSequencer from '$lib/components/v6/tracks/TrackStrip/components/MiniSequencer.svelte';
import type { TinySequencerState } from '$lib/components/v6/tracks/composables/useTinySequencer.svelte';

function seq(mute: number[], pitch: number[]): TinySequencerState {
	const lane = (p: number[], enabled: boolean) => ({ pattern: p.map((v) => v === 1), length: p.length, position: -1, enabled });
	return {
		active: true,
		mute: lane(mute, mute.some((v) => v === 0)),
		pitch: lane(pitch, pitch.some((v) => v === 1))
	};
}

const rows = (c: HTMLElement) => c.querySelectorAll('.sequencer-row').length;

describe('MiniSequencer hides Permute at its defaults', () => {
	it('draws nothing with no Permute on the track', () => {
		const { container } = render(MiniSequencer, { sequencerState: null });
		expect(rows(container)).toBe(0);
		expect(container.querySelector('.mini-sequencer.is-default')).not.toBeNull();
	});

	it('draws nothing when no step mutes and no step transposes', () => {
		const { container } = render(MiniSequencer, { sequencerState: seq([1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]) });
		expect(rows(container)).toBe(0);
	});

	it('draws both rows once a mute step is off', () => {
		const { container } = render(MiniSequencer, { sequencerState: seq([1, 0, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]) });
		expect(rows(container)).toBe(2);
	});

	it('draws both rows once a pitch step is on', () => {
		const { container } = render(MiniSequencer, { sequencerState: seq([1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 1, 0, 0, 0, 0, 0]) });
		expect(rows(container)).toBe(2);
	});

	it('keeps the pad-scope frame while hidden', () => {
		const { container } = render(MiniSequencer, { sequencerState: null, scopeLabel: 'Snare', scopeInk: '#f00' });
		expect(container.querySelector('.mini-sequencer.scoped')).not.toBeNull();
	});
});
