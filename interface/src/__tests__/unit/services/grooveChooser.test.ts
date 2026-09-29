import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sent, state } = vi.hoisted(() => ({
	sent: [] as unknown[][],
	state: {
		focused: 'tracks/0/slots/1/clip' as string | null,
		known: true,
		has: false,
		chosen: '',
		tiles: [{ name: 'Swing 16ths 57' }, { name: 'Swing 8ths 73' }] as Array<{ name: string }>
	}
}));

vi.mock('$lib/api/simpleClient', () => ({ send: (a: string, args: unknown[]) => sent.push([a, ...args]) }));
vi.mock('$lib/stores/session.svelte', () => ({ session: { get focusedClipPath() { return state.focused; } } }));
vi.mock('$lib/stores/v6/groovesStore.svelte', () => ({ groovesStore: { get tickedFiles() { return state.tiles; } } }));
vi.mock('$lib/stores/v6/clipGrooveStore.svelte', () => ({
	clipGrooveStore: {
		get hasGrooveKnown() { return state.known; },
		get hasGroove() { return state.has; },
		chooseFile: (n: string) => (state.chosen = n)
	}
}));

import { loadFirstGrooveIfNone } from '$lib/services/grooveChooser';

const CLIP = 'tracks/0/slots/1/clip';

describe('loadFirstGrooveIfNone', () => {
	beforeEach(() => {
		sent.length = 0;
		Object.assign(state, { focused: CLIP, known: true, has: false, chosen: '', tiles: [{ name: 'Swing 16ths 57' }, { name: 'Swing 8ths 73' }] });
	});

	it('puts a clip with no groove on the first tile at Amount 0', () => {
		expect(loadFirstGrooveIfNone(CLIP)).toBe('Swing 16ths 57');
		expect(sent).toEqual([
			['/looping/v3/clip/groove/set/file', CLIP, 'Swing 16ths 57'],
			['/looping/v3/clip/groove/set/timing_amount', CLIP, 0]
		]);
		expect(state.chosen).toBe('Swing 16ths 57');
	});

	it('leaves a clip that has a groove', () => {
		state.has = true;
		expect(loadFirstGrooveIfNone(CLIP)).toBeNull();
		expect(sent).toEqual([]);
	});

	it('leaves a clip whose groove is not known yet, or one this touch focused', () => {
		state.known = false;
		expect(loadFirstGrooveIfNone(CLIP)).toBeNull();
		state.known = true;
		state.focused = 'tracks/2/slots/0/clip';
		expect(loadFirstGrooveIfNone(CLIP)).toBeNull();
		expect(loadFirstGrooveIfNone(null)).toBeNull();
		expect(sent).toEqual([]);
	});

	it('does nothing with no tiles ticked', () => {
		state.tiles = [];
		expect(loadFirstGrooveIfNone(CLIP)).toBeNull();
		expect(sent).toEqual([]);
	});
});
