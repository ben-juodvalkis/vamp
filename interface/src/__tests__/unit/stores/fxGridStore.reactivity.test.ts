/**
 * Slot transitions must actually reach a `$derived` (audit item 24).
 *
 * `FXGridState.slots` was `$state(new Map())`. Svelte's `proxy()` deep-proxies
 * plain objects and arrays only, so a Map inside `$state` is handed back raw:
 * reading the binding tracks it, but `.set()` — and field writes on the POJOs
 * it holds — emit no signal. Every slot transition was a field write on a held
 * POJO, so the whole ghost → loading → ghost machine was invisible.
 *
 * The consequence was not cosmetic. `useFxGridSlot`'s `sendParam` gates on
 * `isGhost`, which never flipped, so it re-entered `loadDevice` on every drag
 * frame — the exact duplicate-load failure the sibling `loadDedup` test was
 * written for. That test passes either way because it reads the slot
 * imperatively; only a derived can see this.
 *
 * These tests read through a real `$derived` inside `$effect.root`, which is
 * the one context where the difference is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/services/trackCommands', () => ({ setTrackName: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/stores/v6/slotRegistry.svelte', () => ({
	slotRegistry: {
		resetForTrackChange: vi.fn(),
		getAllSlots: vi.fn(() => new Map()),
		getPositionForDeviceType: vi.fn(() => null),
		getDeviceTypeForPosition: vi.fn(() => null)
	}
}));

import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import { derivedProbe } from '../../helpers/runeHarness.svelte';

function mkTrack(trackPath: string): TrackRecord {
	return {
		trackPath,
		name: trackPath,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: false,
		hasAudioInput: true,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new Map(),
		slots: new Map()
	};
}

describe('fxGrid slot transitions are visible to a $derived', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		fxGrid.resetForTrackChange();
		replaceTree(1, [mkTrack('tracks/0')]);
		selectedTrackStore.handleTrackSelected(0);
	});

	afterEach(() => {
		fxGrid.resetForTrackChange();
	});

	it('a derived sees ghost -> loading when loadDevice runs', async () => {
		const probe = derivedProbe(() => fxGrid.getSlot('variation').state);
		expect(probe.value).toBe('ghost');

		await fxGrid.loadDevice('variation');

		// Against the pre-fix store this stays 'ghost'. The write landed on the
		// POJO the Map held, which signals nothing, so the derivation never
		// recomputed — while an imperative `getSlot().state` read 'loading'
		// the whole time. That gap is the entire bug.
		expect(probe.value).toBe('loading');
		probe.stop();
	});

	it('a derived sees loading -> ghost when the track changes', async () => {
		await fxGrid.loadDevice('variation');

		const probe = derivedProbe(() => fxGrid.getSlot('variation').state);
		expect(probe.value).toBe('loading');

		fxGrid.resetForTrackChange();

		expect(probe.value).toBe('ghost');
		probe.stop();
	});
});
