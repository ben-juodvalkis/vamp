/**
 * instrumentTrackColors.test.ts — when a track is coloured by its
 * instrument (ADR-545): a load from the app, a change of instrument type,
 * a new track holding one; never the set as it opens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));

import { instrumentColorPass } from '$lib/components/v6/tracks/composables/useInstrumentTrackColors.svelte';
import { applyAutoColorOnPrepareAck, takePendingInstrumentColor } from '$lib/services/trackColoring';
import type { InstrumentType } from '$lib/services/instrumentService';

type Row = readonly [string, InstrumentType | null];

describe('instrumentColorPass', () => {
	let seen: Map<string, InstrumentType | null>;
	beforeEach(() => {
		seen = new Map();
		for (const path of ['tracks/0', 'tracks/1', 'tracks/2']) takePendingInstrumentColor(path);
	});

	it('colours nothing on the first tree: opening a set is the baseline', () => {
		const rows: Row[] = [['tracks/0', 'drift'], ['tracks/1', 'drumrack']];
		expect(instrumentColorPass(seen, rows, false)).toEqual([]);
	});

	it('colours a track whose instrument type changed', () => {
		instrumentColorPass(seen, [['tracks/0', 'drift'], ['tracks/1', 'drumrack']], false);
		expect(instrumentColorPass(seen, [['tracks/0', 'meld'], ['tracks/1', 'drumrack']], true)).toEqual(['tracks/0']);
	});

	it('colours a track the app loaded onto, even when the type stayed', () => {
		instrumentColorPass(seen, [['tracks/0', 'drift']], false);
		applyAutoColorOnPrepareAck({ trackPath: 'tracks/0', presetPath: 'x.adv' });
		expect(instrumentColorPass(seen, [['tracks/0', 'drift']], true)).toEqual(['tracks/0']);
		// Once: the mark is spent.
		expect(instrumentColorPass(seen, [['tracks/0', 'drift']], true)).toEqual([]);
	});

	it('keeps a load pending until the track holds an instrument', () => {
		instrumentColorPass(seen, [['tracks/2', null]], false);
		applyAutoColorOnPrepareAck({ trackPath: 'tracks/2', presetPath: 'x.adv' });
		expect(instrumentColorPass(seen, [['tracks/2', null]], true)).toEqual([]);
		expect(instrumentColorPass(seen, [['tracks/2', 'collision']], true)).toEqual(['tracks/2']);
	});

	it('colours a new track that arrives holding an instrument', () => {
		instrumentColorPass(seen, [['tracks/0', 'drift']], false);
		expect(instrumentColorPass(seen, [['tracks/0', 'drift'], ['tracks/1', 'operator']], true)).toEqual(['tracks/1']);
	});

	it('leaves a track that lost its instrument alone', () => {
		instrumentColorPass(seen, [['tracks/0', 'drift']], false);
		expect(instrumentColorPass(seen, [['tracks/0', null]], true)).toEqual([]);
	});
});
