/**
 * Tests for `sequencerStore` — Phase 10 PR-10c shape.
 *
 * The store derives all read state from `v3Store.paramByPath` for the
 * selected track's Permute device, and all writes go through the
 * standard `/looping/v3/param/set` wire. The v5-era broadcast cache,
 * origin tagging, echo filtering, and grace period are gone.
 *
 * These tests cover:
 *   - Ghost-mode editing: pending edits are kept locally, `triggerLoad`
 *     fires, and a subsequent `onDeviceLoaded` flushes each pending
 *     edit as an individual `/looping/v3/param/set`.
 *   - Active-device writes: step toggle / length / rate / temperature /
 *     chance map to the correct `parameters[i]` index and emit
 *     `/looping/v3/param/set [paramPath, value, generation]`.
 *   - Derived reads: Permute-party params in `v3Store` are reflected in
 *     the store's getters (`muteSteps`, `pitchSteps`, `temperature`,
 *     `chance`, `muteCurrentStep`, `pitchCurrentStep`).
 *   - Track changes clear pending ghost edits and loading flags.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import type { FxScope } from '$lib/components/v6/central/fxScope';

// ADR-435: the pad scope the store follows. A SvelteMap holds it so the
// store's `$derived` over `activeDrumRackScope()` re-evaluates when a test
// moves it — a plain variable would be read once and cached.
vi.mock('$lib/services/deviceViewRouter.svelte', async () => {
	const { SvelteMap: ReactiveMap } = await import('svelte/reactivity');
	const holder = new ReactiveMap<string, unknown>();
	return {
		activeDrumRackScope: () => (holder.get('scope') as FxScope | null | undefined) ?? null,
		__setScope: (scope: unknown) => {
			holder.set('scope', scope);
		}
	};
});

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/stores/session.svelte', () => ({
	session: {
		get isPlaying() {
			return false;
		}
	}
}));

vi.mock('$lib/config/devicePresets', () => ({
	// The real helper (3.11.0): a preset that names its Place sends five args.
	deviceLoadArgs: (t: string, d: string, p: { presetPath: string; source?: string; rel?: string }) =>
		p.source && p.rel ? [t, d, p.presetPath, p.source, p.rel] : [t, d, p.presetPath],
	DEVICE_PRESETS: {
		sequencer: {
			presetPath: '/test/path/Permute.amxd',
			defaultName: 'Permute',
			expectedClassName: 'MxDeviceAudioEffect',
			color: { primary: '#fff', secondary: '#000', accent: '#ccc' }
		},
		utility: {
			color: { primary: '#fff', secondary: '#000', accent: '#ccc' }
		}
	}
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$lib/services/instrumentService', () => ({
	instrumentService: {
		identifyInstrumentType: vi.fn(() => 'unknown')
	}
}));

vi.mock('$lib/stores/v6/slotRegistry.svelte', () => ({
	slotRegistry: {
		resetForTrackChange: vi.fn(),
		getAllSlots: vi.fn(() => new Map()),
		getPositionForDeviceType: vi.fn(() => null),
		getDeviceTypeForPosition: vi.fn(() => null)
	}
}));

import { sequencerStore, resetParamsToDefaultsForDevice } from '$lib/stores/v6/sequencerStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { send } from '$lib/api/simpleClient';
import * as routerMock from '$lib/services/deviceViewRouter.svelte';
import {
	replaceTree,
	mergePadChain,
	_resetForTests,
	v3Store,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import {
	applyPermuteStep,
	permuteStepStore,
	__resetPermuteStepStoreForTests
} from '$lib/stores/v3/permuteSteps.svelte';
import { derivedProbe } from '../../helpers/runeHarness.svelte';

// ADR-002 (2026-04-16): `$derived` is evaluated lazily by Svelte 5 and
// only re-runs inside a tracking scope (component / `$effect` /
// `$derived`). In a raw vitest assertion the first read caches the
// result, so mid-test mutations aren't observable through
// `sequencerStore.chance` etc. For invariants where "the write landed
// in the store" is what matters, read the tree directly — the
// `paramByPath` derived view is the right API for live Svelte
// components; tests assert against the source of truth.
function readParamFromTree(paramPath: string): number | undefined {
	const parts = paramPath.split('/');
	const trackPath = `${parts[0]}/${parts[1]}`;
	const devicePath = `${trackPath}/devices/${parts[3]}`;
	return v3Store.tracks.get(trackPath)?.devices.get(devicePath)?.params.get(paramPath)?.value;
}

// ------------------------------------------------------------------
// Fixture helpers
// ------------------------------------------------------------------

function mkParam(paramPath: string, index: number, value: number): ParamRecord {
	return {
		paramPath,
		name: `p${index}`,
		displayName: `P${index}`,
		min: 0,
		max: 1,
		value,
		unit: ''
	};
}

/**
 * Build a track record with a Permute device at the given chain index,
 * pre-populated with any subset of its 39 parameters (0 = Device On,
 * 1..8 = Mute steps, 9 = Mute Length, 10 = Mute Rate, 11..18 = Pitch
 * steps, 19 = Pitch Length, 20 = Pitch Rate, 21 = Chance, 22 =
 * Temperature, 23..30 = Mute steps 9..16, 31..38 = Pitch steps 9..16).
 */
function mkTrackWithPermute(
	trackIdx: number,
	deviceIdx: number,
	paramValues: Record<number, number> = {}
): TrackRecord {
	const trackPath = `tracks/${trackIdx}`;
	const devicePath = `${trackPath}/devices/${deviceIdx}`;
	const params = new SvelteMap<string, ParamRecord>();
	for (const [idx, value] of Object.entries(paramValues)) {
		const i = Number(idx);
		const paramPath = `${devicePath}/params/${i}`;
		params.set(paramPath, mkParam(paramPath, i, value));
	}
	const device: DeviceRecord = {
		devicePath,
		name: 'Permute',
		className: 'MxDeviceAudioEffect',
		params,
		properties: new SvelteMap()
	};
	return {
		trackPath,
		name: `t${trackIdx}`,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap([[devicePath, device]]),
		slots: new SvelteMap()
	};
}

/**
 * A Permute record whose params carry the device's real long names
 * (permute ADR-020) but sit `offset` slots later than the positional
 * table says — the situation the by-name resolver exists for.
 */
const PERMUTE_NAMES_IN_ORDER = [
	'Device On',
	'Mute 1', 'Mute 2', 'Mute 3', 'Mute 4', 'Mute 5', 'Mute 6', 'Mute 7', 'Mute 8',
	'Mute Length', 'Mute Rate',
	'Pitch 1', 'Pitch 2', 'Pitch 3', 'Pitch 4', 'Pitch 5', 'Pitch 6', 'Pitch 7', 'Pitch 8',
	'Pitch Length', 'Pitch Rate', 'Chance', 'Temperature',
	'Mute 9', 'Mute 10', 'Mute 11', 'Mute 12', 'Mute 13', 'Mute 14', 'Mute 15', 'Mute 16',
	'Pitch 9', 'Pitch 10', 'Pitch 11', 'Pitch 12', 'Pitch 13', 'Pitch 14', 'Pitch 15', 'Pitch 16'
];

/** A 16-step lane (ADR-443): `head` for the first steps, `rest` for the others. */
function lane(head: boolean[], rest: boolean): boolean[] {
	return [...head, ...Array(16 - head.length).fill(rest)];
}

function mkTrackWithNamedPermute(
	trackIdx: number,
	deviceIdx: number,
	offset: number,
	valuesByName: Record<string, number> = {}
): TrackRecord {
	const track = mkTrackWithPermute(trackIdx, deviceIdx);
	const devicePath = `tracks/${trackIdx}/devices/${deviceIdx}`;
	const device = track.devices.get(devicePath)!;
	PERMUTE_NAMES_IN_ORDER.forEach((name, i) => {
		const paramPath = `${devicePath}/params/${i + offset}`;
		const value = valuesByName[name] ?? (name.startsWith('Mute') && !name.includes('Length') && !name.includes('Rate') ? 1 : 0);
		device.params.set(paramPath, { ...mkParam(paramPath, i + offset, value), name });
	});
	return track;
}

function mkEmptyTrack(trackIdx: number): TrackRecord {
	const trackPath = `tracks/${trackIdx}`;
	return {
		trackPath,
		name: `t${trackIdx}`,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap(),
		slots: new SvelteMap()
	};
}

// ------------------------------------------------------------------
// Suite
// ------------------------------------------------------------------

describe('sequencerStore (Phase 10 PR-10c — v3 param-wire)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		__resetPermuteStepStoreForTests();
		sequencerStore.resetToGhost();
		// `resetToGhost` only clears loading flags; ghost `pending` edits
		// are keyed per trackPath and survive across tests. Purge the
		// indices we touch so state doesn't bleed between cases.
		for (let i = 0; i < 10; i++) sequencerStore.clearCachedState(i);
		sequencerStore.clearCachedState(99);
		selectedTrackStore.handleTrackSelected(0);
	});

	describe('pending ghost edits reach a $derived (audit item 24)', () => {
		// `pending` was `$state(new Map())`, carrying a comment claiming a
		// re-set made "SvelteMap fire derived consumers". It was a plain Map:
		// `$state` deep-proxies plain objects and arrays only, so it came back
		// raw and neither the inner `.set()` nor the re-set signalled anything.
		//
		// The ADR-002 note at the top of this file records the consequence —
		// that mid-test mutations "aren't observable through
		// `sequencerStore.chance` etc." and tests should read the tree instead.
		// That was read as a Svelte laziness quirk. Half of it was this bug:
		// with `pending` non-reactive, no tracking scope could ever see a
		// ghost edit. These read through a real derivation, which is the thing
		// a live component does.

		it('muteSteps reflects a ghost-mode step toggle', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			const probe = derivedProbe(() => sequencerStore.muteSteps[0]);
			expect(probe.value).toBe(true); // ghost default

			sequencerStore.handleMuteStepToggleGhost(0);

			// Against the pre-fix store this stays `true`: the edit landed in a
			// plain Map, so the derivation never recomputed and the step never
			// appeared to move under the performer's finger.
			expect(probe.value).toBe(false);
			probe.stop();
		});

		it('a second ghost edit on another step is seen too', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			const probe = derivedProbe(() => sequencerStore.muteSteps.join(','));
			expect(probe.value).toBe(lane([], true).join(','));

			sequencerStore.handleMuteStepToggleGhost(2);
			sequencerStore.handleMuteStepToggleGhost(5);

			expect(probe.value).toBe(lane([true, true, false, true, true, false], true).join(','));
			probe.stop();
		});
	});

	describe('ghost defaults (no Permute on track)', () => {
		it('exposes mute steps all true, pitch steps all false when no device is present', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			expect(sequencerStore.isGhost).toBe(true);
			expect(sequencerStore.muteSteps).toEqual(Array(16).fill(true));
			expect(sequencerStore.pitchSteps).toEqual(Array(16).fill(false));
		});

		it('exposes chance = 1.0 and temperature = 0.0 by default', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			expect(sequencerStore.chance).toBe(1.0);
			expect(sequencerStore.temperature).toBe(0.0);
		});

		it('reports muteCurrentStep and pitchCurrentStep as -1 in ghost mode', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			expect(sequencerStore.muteCurrentStep).toBe(-1);
			expect(sequencerStore.pitchCurrentStep).toBe(-1);
		});
	});

	describe('ghost-mode edits trigger device load', () => {
		it('emits /looping/v3/device/load on the first ghost edit', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			sequencerStore.handleMuteStepToggleGhost(0);

			expect(send).toHaveBeenCalledWith(
				'/looping/v3/device/load',
				expect.arrayContaining(['tracks/0', '', '/test/path/Permute.amxd'])
			);
			expect(sequencerStore.isLoading).toBe(true);
		});

		it('preserves the pending edit so it can be flushed when the device loads', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			// Ghost edit: mute step 0 + temperature.
			sequencerStore.handleMuteStepToggleGhost(0);
			sequencerStore.handleTemperatureChangeGhost(0.4);
			(send as any).mockClear();

			// Device loads. Flush should replay both pending edits — proof
			// they were preserved.
			replaceTree(2, [mkTrackWithPermute(0, 0)]);
			sequencerStore.onDeviceLoaded({ devicePath: 'tracks/0/devices/0' } as any);

			const paramSetCalls = (send as any).mock.calls.filter(
				([addr]: [string]) => addr === '/looping/v3/param/set'
			);
			const writtenPaths = paramSetCalls.map(([, args]: [string, unknown[]]) => args[0]);
			expect(writtenPaths).toContain('tracks/0/devices/0/params/1');
			expect(writtenPaths).toContain('tracks/0/devices/0/params/22');
		});

		it('only fires one /looping/v3/device/load even when multiple ghost edits happen', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			sequencerStore.handleMuteStepToggleGhost(0);
			sequencerStore.handlePitchStepToggleGhost(3);
			sequencerStore.handleTemperatureChangeGhost(0.6);

			const loadCalls = (send as any).mock.calls.filter(
				([addr]: [string]) => addr === '/looping/v3/device/load'
			);
			expect(loadCalls).toHaveLength(1);
		});

		it('accumulates ghost edits across multiple params and flushes all of them', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			sequencerStore.handlePitchStepToggleGhost(2); // param 13 → 1
			sequencerStore.handleChanceChangeGhost(0.25); // param 21 → 0.25
			sequencerStore.handleTemperatureChangeGhost(0.75); // param 22 → 0.75
			(send as any).mockClear();

			replaceTree(2, [mkTrackWithPermute(0, 0)]);
			sequencerStore.onDeviceLoaded({ devicePath: 'tracks/0/devices/0' } as any);

			const paramSetCalls = (send as any).mock.calls.filter(
				([addr]: [string]) => addr === '/looping/v3/param/set'
			);
			expect(paramSetCalls).toHaveLength(3);

			const byPath = new Map(
				paramSetCalls.map(([, args]: [string, unknown[]]) => [args[0], args[1]])
			);
			expect(byPath.get('tracks/0/devices/0/params/13')).toBe(1);
			expect(byPath.get('tracks/0/devices/0/params/21')).toBe(0.25);
			expect(byPath.get('tracks/0/devices/0/params/22')).toBe(0.75);
		});
	});

	describe('onDeviceLoaded — flush pending ghost edits', () => {
		it('replays each pending edit as an individual /looping/v3/param/set against the loaded device', () => {
			// Start with no Permute on track 0.
			replaceTree(1, [mkEmptyTrack(0)]);

			// Make three ghost edits: a mute step, a pitch step, and temperature.
			sequencerStore.handleMuteStepToggleGhost(0); // param 1 → 0
			sequencerStore.handlePitchStepToggleGhost(4); // param 15 → 1
			sequencerStore.handleTemperatureChangeGhost(0.5); // param 22 → 0.5

			// Clear the `/looping/v3/device/load` call so only the flushed param
			// writes remain.
			(send as any).mockClear();

			// Permute now loads onto track 0 at chain index 2; replaceTree bumps
			// the generation so writes are allowed.
			replaceTree(2, [mkTrackWithPermute(0, 2)]);

			const loaded = {
				devicePath: 'tracks/0/devices/2'
			};
			sequencerStore.onDeviceLoaded(loaded as any);

			const paramSetCalls = (send as any).mock.calls.filter(
				([addr]: [string]) => addr === '/looping/v3/param/set'
			);
			expect(paramSetCalls).toHaveLength(3);

			const paths = paramSetCalls.map(([, args]: [string, unknown[]]) => args[0]);
			expect(paths).toContain('tracks/0/devices/2/params/1');
			expect(paths).toContain('tracks/0/devices/2/params/15');
			expect(paths).toContain('tracks/0/devices/2/params/22');

			// Each write carries the current generation.
			for (const [, args] of paramSetCalls) {
				expect(args[2]).toBe(2);
			}

			// Loading flag drops.
			expect(sequencerStore.isLoading).toBe(false);
		});

		it('is idempotent for the same devicePath', () => {
			replaceTree(1, [mkEmptyTrack(0)]);
			sequencerStore.handleMuteStepToggleGhost(0);
			replaceTree(2, [mkTrackWithPermute(0, 0)]);
			(send as any).mockClear();

			const loaded = { devicePath: 'tracks/0/devices/0' };
			sequencerStore.onDeviceLoaded(loaded as any);
			const afterFirst = (send as any).mock.calls.length;

			sequencerStore.onDeviceLoaded(loaded as any);
			expect((send as any).mock.calls.length).toBe(afterFirst);
		});

		it('sends nothing when no ghost edits were made', () => {
			replaceTree(2, [mkTrackWithPermute(0, 0)]);
			(send as any).mockClear();

			sequencerStore.onDeviceLoaded({ devicePath: 'tracks/0/devices/0' } as any);

			expect(send).not.toHaveBeenCalled();
		});
	});

	describe('derived reads from v3Store', () => {
		it('reads mute steps from parameters[1..8]', () => {
			replaceTree(1, [
				mkTrackWithPermute(0, 0, {
					1: 0, // Mute 1 off
					2: 1, // Mute 2 on
					3: 0,
					4: 1,
					5: 1,
					6: 0,
					7: 1,
					8: 1
				})
			]);

			// Steps 9..16 carry no record here: they read the device default.
			expect(sequencerStore.muteSteps).toEqual(
				lane([false, true, false, true, true, false, true, true], true)
			);
		});

		it('reads pitch steps from parameters[11..18]', () => {
			replaceTree(1, [
				mkTrackWithPermute(0, 0, {
					11: 1,
					12: 0,
					13: 1,
					14: 0,
					15: 0,
					16: 1,
					17: 0,
					18: 1
				})
			]);

			expect(sequencerStore.pitchSteps).toEqual(
				lane([true, false, true, false, false, true, false, true], false)
			);
		});

		it('reads Mute Length / Pitch Length / Mute Rate / Pitch Rate', () => {
			replaceTree(1, [
				mkTrackWithPermute(0, 0, {
					9: 4, // Mute Length
					10: 5, // Mute Rate
					19: 7, // Pitch Length
					20: 2 // Pitch Rate
				})
			]);

			expect(sequencerStore.muteLength).toBe(4);
			expect(sequencerStore.muteRate).toBe(5);
			expect(sequencerStore.pitchLength).toBe(7);
			expect(sequencerStore.pitchRate).toBe(2);
		});

		it('reads chance from parameters[21] and temperature from parameters[22]', () => {
			replaceTree(1, [
				mkTrackWithPermute(0, 0, {
					21: 0.42,
					22: 0.68
				})
			]);

			expect(sequencerStore.chance).toBe(0.42);
			expect(sequencerStore.temperature).toBe(0.68);
		});

		it('reads current step from the permute telemetry wire, not parameters[23]/[24]', () => {
			// Params 23/24 carry deliberately wrong values: Live never fires
			// value-changed for them ("Visible (Not Stored)" mode), so they
			// arrive frozen and must not be read. The telemetry wire is the
			// only source. See stores/v3/permuteSteps.svelte.ts.
			replaceTree(1, [
				mkTrackWithPermute(0, 0, {
					23: 999,
					24: 999
				})
			]);
			applyPermuteStep('tracks/0/devices/0', 'mute', 4);
			applyPermuteStep('tracks/0/devices/0', 'pitch', 2);

			// Wire is already 0-indexed — no shift on read.
			expect(sequencerStore.muteCurrentStep).toBe(4);
			expect(sequencerStore.pitchCurrentStep).toBe(2);
		});

		it('treats the -1 sentinel as idle and step 0 as a real step', () => {
			// The old 1-indexed param wire used 0 for idle. The telemetry wire
			// is 0-indexed, so 0 is the *first step* and only -1 means idle.
			replaceTree(1, [mkTrackWithPermute(0, 0, {})]);
			applyPermuteStep('tracks/0/devices/0', 'mute', -1);
			applyPermuteStep('tracks/0/devices/0', 'pitch', 0);

			expect(sequencerStore.muteCurrentStep).toBe(-1);
			expect(sequencerStore.pitchCurrentStep).toBe(0);
		});

		it('reports idle for a device the telemetry wire has not reported yet', () => {
			replaceTree(1, [mkTrackWithPermute(0, 0, {})]);

			expect(sequencerStore.muteCurrentStep).toBe(-1);
			expect(sequencerStore.pitchCurrentStep).toBe(-1);
		});

		it('keeps each track\'s step independent', () => {
			// Regression: an earlier revision resolved both kinds to one param
			// index, collapsing mute/pitch and making every track's lights
			// mirror each other. devicePath+kind now key the store directly.
			replaceTree(1, [mkTrackWithPermute(0, 0, {}), mkTrackWithPermute(1, 0, {})]);
			applyPermuteStep('tracks/0/devices/0', 'mute', 1);
			applyPermuteStep('tracks/1/devices/0', 'mute', 6);

			expect(permuteStepStore.get('tracks/0/devices/0').mute).toBe(1);
			expect(permuteStepStore.get('tracks/1/devices/0').mute).toBe(6);
		});

		it('derives muteEnabled true when any mute step is off', () => {
			replaceTree(1, [
				mkTrackWithPermute(0, 0, {
					1: 1,
					2: 1,
					3: 0, // one muted step
					4: 1,
					5: 1,
					6: 1,
					7: 1,
					8: 1
				})
			]);

			expect(sequencerStore.muteEnabled).toBe(true);
		});

		it('derives pitchEnabled true when any pitch step is on', () => {
			replaceTree(1, [
				mkTrackWithPermute(0, 0, {
					11: 0,
					12: 0,
					13: 0,
					14: 1, // one shifted step
					15: 0,
					16: 0,
					17: 0,
					18: 0
				})
			]);

			expect(sequencerStore.pitchEnabled).toBe(true);
		});

		it('ignores steps past the length when deriving muteEnabled / pitchEnabled (ADR-443)', () => {
			// Mute 12 off and Pitch 12 on, under the default length 8: neither plays.
			replaceTree(1, [mkTrackWithPermute(0, 0, { 9: 8, 19: 8, 26: 0, 34: 1 })]);
			expect(sequencerStore.muteSteps[11]).toBe(false);
			expect(sequencerStore.pitchSteps[11]).toBe(true);
			expect(sequencerStore.muteEnabled).toBe(false);
			expect(sequencerStore.pitchEnabled).toBe(false);

			// Length 12 brings step 12 inside the pattern.
			replaceTree(2, [mkTrackWithPermute(0, 0, { 9: 12, 19: 12, 26: 0, 34: 1 })]);
			expect(sequencerStore.muteEnabled).toBe(true);
			expect(sequencerStore.pitchEnabled).toBe(true);
		});

		it('reports isGhost = false once a Permute device is present', () => {
			replaceTree(1, [mkTrackWithPermute(0, 0)]);
			expect(sequencerStore.isGhost).toBe(false);
		});
	});

	describe('active-device writes — emit /looping/v3/param/set', () => {
		beforeEach(() => {
			replaceTree(7, [mkTrackWithPermute(0, 2, { 1: 1, 11: 0, 21: 1.0, 22: 0.0 })]);
			(send as any).mockClear();
		});

		it('handleMuteStepToggle(0) writes parameters[1] = 0 (from default 1)', () => {
			sequencerStore.handleMuteStepToggle(0);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/1',
				0,
				7
			]);
		});

		it('handleMuteStepSet(3, true) writes parameters[4] = 1', () => {
			sequencerStore.handleMuteStepSet(3, true);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/4',
				1,
				7
			]);
		});

		it('handlePitchStepToggle(0) writes parameters[11] = 1 (from default 0)', () => {
			sequencerStore.handlePitchStepToggle(0);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/11',
				1,
				7
			]);
		});

		it('handlePitchStepSet(7, false) writes parameters[18] = 0', () => {
			sequencerStore.handlePitchStepSet(7, false);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/18',
				0,
				7
			]);
		});

		it('handleMuteLengthChange writes parameters[9]', () => {
			sequencerStore.handleMuteLengthChange(6);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/9',
				6,
				7
			]);
		});

		it('handleMuteRateChange writes parameters[10]', () => {
			sequencerStore.handleMuteRateChange(4);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/10',
				4,
				7
			]);
		});

		it('handlePitchLengthChange writes parameters[19]', () => {
			sequencerStore.handlePitchLengthChange(3);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/19',
				3,
				7
			]);
		});

		it('handlePitchRateChange writes parameters[20]', () => {
			sequencerStore.handlePitchRateChange(6);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/20',
				6,
				7
			]);
		});

		it('handleChanceChange writes parameters[21]', () => {
			sequencerStore.handleChanceChange(0.33);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/21',
				0.33,
				7
			]);
		});

		it('handleTemperatureChange writes parameters[22]', () => {
			sequencerStore.handleTemperatureChange(0.9);

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/2/params/22',
				0.9,
				7
			]);
		});

		it('active-device handlers no-op when called without a Permute device on the track', () => {
			_resetForTests();
			replaceTree(8, [mkEmptyTrack(0)]);
			(send as any).mockClear();

			sequencerStore.handleMuteStepToggle(0);
			sequencerStore.handleChanceChange(0.5);

			expect(send).not.toHaveBeenCalled();
		});
	});

	describe('optimistic local write', () => {
		it('writes the new value into v3Store before emitting (prevents snap-back during drags)', () => {
			replaceTree(9, [mkTrackWithPermute(0, 0, { 21: 1.0 })]);
			expect(readParamFromTree('tracks/0/devices/0/params/21')).toBe(1.0);

			sequencerStore.handleChanceChange(0.15);

			// Optimistic write — the param value in the tree has moved before
			// any echo has arrived. Without this, the UI reads stale values
			// while the surface suppresses the first echo on UI-armed params
			// (see ADR-001 / ADR-002).
			expect(readParamFromTree('tracks/0/devices/0/params/21')).toBe(0.15);
			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', [
				'tracks/0/devices/0/params/21',
				0.15,
				9
			]);
		});
	});

	describe('track change lifecycle', () => {
		it('resetToGhost clears loading flags', () => {
			replaceTree(1, [mkEmptyTrack(0)]);
			sequencerStore.handleMuteStepToggleGhost(0);
			expect(sequencerStore.isLoading).toBe(true);

			sequencerStore.resetToGhost();

			expect(sequencerStore.isLoading).toBe(false);
		});

		it('clearCachedState drops pending ghost edits so a later onDeviceLoaded flushes nothing', () => {
			replaceTree(1, [mkEmptyTrack(0)]);

			sequencerStore.handleChanceChangeGhost(0.2);
			sequencerStore.clearCachedState(0);
			(send as any).mockClear();

			replaceTree(2, [mkTrackWithPermute(0, 0)]);
			sequencerStore.onDeviceLoaded({ devicePath: 'tracks/0/devices/0' } as any);

			const paramSetCalls = (send as any).mock.calls.filter(
				([addr]: [string]) => addr === '/looping/v3/param/set'
			);
			expect(paramSetCalls).toHaveLength(0);
		});

		it('onTrackChanged clears the loading flag', () => {
			replaceTree(1, [mkEmptyTrack(0)]);
			sequencerStore.handleMuteStepToggleGhost(0);
			expect(sequencerStore.isLoading).toBe(true);

			sequencerStore.onTrackChanged(3);

			expect(sequencerStore.isLoading).toBe(false);
		});
	});

	describe('by-name resolution (permute ADR-020)', () => {
		it('reads steps and scalars by parameter name when the indices are shifted', () => {
			// Every record sits two slots later than the positional table says.
			replaceTree(3, [
				mkTrackWithNamedPermute(0, 1, 2, {
					'Mute 3': 0,
					'Pitch 5': 1,
					'Mute Length': 6,
					'Pitch Rate': 7,
					'Chance': 0.25,
					'Temperature': 0.5
				})
			]);
			selectedTrackStore.handleTrackSelected(0);

			expect(sequencerStore.layout?.positional).toEqual([]);
			expect(sequencerStore.muteSteps).toEqual(lane([true, true, false], true));
			expect(sequencerStore.pitchSteps).toEqual(lane([false, false, false, false, true], false));
			expect(sequencerStore.muteLength).toBe(6);
			expect(sequencerStore.pitchRate).toBe(7);
			expect(sequencerStore.chance).toBe(0.25);
			expect(sequencerStore.temperature).toBe(0.5);
		});

		it('writes to the named parameter path, not the positional one', () => {
			replaceTree(4, [mkTrackWithNamedPermute(0, 1, 2)]);
			selectedTrackStore.handleTrackSelected(0);
			(send as any).mockClear();

			sequencerStore.handleMuteStepSet(0, false);
			sequencerStore.handleTemperatureChange(0.7);

			// Mute 1 lives at params/3 (1 + offset 2), Temperature at params/24.
			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', ['tracks/0/devices/1/params/3', 0, 4]);
			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', ['tracks/0/devices/1/params/24', 0.7, 4]);
			expect(readParamFromTree('tracks/0/devices/1/params/3')).toBe(0);
		});

		it('resetParamsToDefaultsForDevice writes the device defaults by name', () => {
			replaceTree(5, [mkTrackWithNamedPermute(2, 0, 1)]);
			(send as any).mockClear();

			resetParamsToDefaultsForDevice('tracks/2/devices/0');

			const calls = (send as any).mock.calls.filter((c: any[]) => c[0] === '/looping/v3/param/set');
			expect(calls).toHaveLength(38);
			const byPath = new Map(calls.map((c: any[]) => [c[1][0], c[1][1]]));
			// Mute 1 at params/2 (offset 1) → 1; Mute Rate at params/11 → 3;
			// Chance at params/22 → 1; Temperature at params/23 → 0;
			// Mute 16 at params/31 → 1; Pitch 16 at params/39 → 0.
			expect(byPath.get('tracks/2/devices/0/params/2')).toBe(1);
			expect(byPath.get('tracks/2/devices/0/params/11')).toBe(3);
			expect(byPath.get('tracks/2/devices/0/params/22')).toBe(1);
			expect(byPath.get('tracks/2/devices/0/params/23')).toBe(0);
			expect(byPath.get('tracks/2/devices/0/params/31')).toBe(1);
			expect(byPath.get('tracks/2/devices/0/params/39')).toBe(0);
			expect(byPath.has('tracks/2/devices/0/params/1')).toBe(false);
		});

		it('resetParamsToDefaultsForDevice falls back to the positional table for an unknown device', () => {
			replaceTree(6, [mkEmptyTrack(0)]);
			(send as any).mockClear();

			resetParamsToDefaultsForDevice('tracks/0/devices/9');

			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', ['tracks/0/devices/9/params/1', 1, 6]);
			expect(send).toHaveBeenCalledWith('/looping/v3/param/set', ['tracks/0/devices/9/params/22', 0, 6]);
		});

		it('records without names fall back to the positional table per role', () => {
			replaceTree(7, [mkTrackWithPermute(0, 0, { 1: 0, 22: 0.9 })]);
			selectedTrackStore.handleTrackSelected(0);

			expect(sequencerStore.layout?.positional).toHaveLength(38);
			expect(sequencerStore.muteSteps[0]).toBe(false);
			expect(sequencerStore.temperature).toBe(0.9);
		});
	});

	// ---- ADR-435: a pad's Permute ---------------------------------------------
	//
	// While a pad is scoped on the selected track's Drum Rack the store is
	// that pad's Permute — found in the pad's map by class and name — and
	// the ghost is the pad without one. Reads, writes, telemetry and the
	// ghost load all address the pad; nothing scoped, and it is the track's.

	describe("a pad's Permute (ADR-435)", () => {
		const RACK = 'tracks/0/devices/0';
		const PAD = `${RACK}/pads/38`;
		const PAD_PERMUTE = `${PAD}/devices/1`;
		const setScope = (scope: FxScope | null) =>
			(routerMock as unknown as { __setScope: (s: unknown) => void }).__setScope(scope);
		const scopePad38 = () => setScope({ rackPath: RACK, note: 38, padPath: PAD, color: null, name: 'Snare' });

		function padPermute(valuesByName: Record<string, number> = {}): DeviceRecord {
			const params = new SvelteMap<string, ParamRecord>();
			PERMUTE_NAMES_IN_ORDER.forEach((name, i) => {
				const paramPath = `${PAD_PERMUTE}/params/${i}`;
				const value =
					valuesByName[name] ??
					(name.startsWith('Mute') && !name.includes('Length') && !name.includes('Rate') ? 1 : 0);
				params.set(paramPath, { ...mkParam(paramPath, i, value), name });
			});
			return {
				devicePath: PAD_PERMUTE,
				name: 'Permute',
				className: 'MxDeviceAudioEffect',
				params,
				properties: new SvelteMap()
			};
		}

		afterEach(() => setScope(null));

		it("is the pad's Permute while the pad is scoped, and the track's again after", () => {
			replaceTree(1, [mkTrackWithNamedPermute(0, 1, 0, { 'Mute 1': 0 })]); // the track's: Mute 1 off
			mergePadChain(2, PAD, new Map([[PAD_PERMUTE, padPermute({ 'Mute 2': 0, 'Pitch 3': 1 })]]));
			expect(sequencerStore.device?.devicePath).toBe('tracks/0/devices/1');
			scopePad38();
			expect(sequencerStore.device?.devicePath).toBe(PAD_PERMUTE);
			expect(sequencerStore.isGhost).toBe(false);
			expect(sequencerStore.muteSteps).toEqual(lane([true, false], true));
			expect(sequencerStore.pitchSteps[2]).toBe(true);
			expect(sequencerStore.scope?.note).toBe(38);
			expect(sequencerStore.temperatureInert).toBe(true);
			setScope(null);
			expect(sequencerStore.device?.devicePath).toBe('tracks/0/devices/1');
			expect(sequencerStore.muteSteps[0]).toBe(false);
			expect(sequencerStore.temperatureInert).toBe(false);
		});

		it("writes to the pad's own parameter paths", () => {
			replaceTree(1, [mkTrackWithNamedPermute(0, 1, 0)]);
			mergePadChain(2, PAD, new Map([[PAD_PERMUTE, padPermute()]]));
			scopePad38();
			sequencerStore.handleMuteStepToggle(0);
			expect(send).toHaveBeenLastCalledWith('/looping/v3/param/set', [`${PAD_PERMUTE}/params/1`, 0, 2]);
			sequencerStore.handleChanceChange(0.4);
			expect(send).toHaveBeenLastCalledWith('/looping/v3/param/set', [`${PAD_PERMUTE}/params/21`, 0.4, 2]);
			// The optimistic write landed on the pad's record, not the track's.
			expect(v3Store.paramByPath.get(`${PAD_PERMUTE}/params/1`)?.value).toBe(0);
			expect(v3Store.paramByPath.get('tracks/0/devices/1/params/1')?.value).toBe(1);
		});

		it("reads the pad's step position off the telemetry wire by the pad's device path", () => {
			replaceTree(1, [mkTrackWithNamedPermute(0, 1, 0)]);
			mergePadChain(2, PAD, new Map([[PAD_PERMUTE, padPermute()]]));
			applyPermuteStep('tracks/0/devices/1', 'mute', 5);
			applyPermuteStep(PAD_PERMUTE, 'mute', 2);
			scopePad38();
			expect(sequencerStore.muteCurrentStep).toBe(2);
			setScope(null);
			expect(sequencerStore.muteCurrentStep).toBe(5);
		});

		it('a stand-in record (presence alone, no values yet) reads as the device defaults', () => {
			replaceTree(1, [mkTrackWithNamedPermute(0, 1, 0)]);
			const stub: DeviceRecord = {
				devicePath: PAD_PERMUTE,
				name: 'Permute',
				className: 'MxDeviceAudioEffect',
				params: new SvelteMap(),
				properties: new SvelteMap()
			};
			mergePadChain(2, PAD, new Map([[PAD_PERMUTE, stub]]));
			scopePad38();
			expect(sequencerStore.isGhost).toBe(false);
			expect(sequencerStore.muteSteps).toEqual(Array(16).fill(true));
			expect(sequencerStore.pitchSteps).toEqual(Array(16).fill(false));
			expect(sequencerStore.chance).toBe(1);
			expect(sequencerStore.muteLength).toBe(8);
		});

		it("ghost-loads INTO the scoped pad and keys the pad's pending edits apart from the track's", () => {
			replaceTree(1, [mkTrackWithNamedPermute(0, 1, 0)]); // the track HAS a Permute …
			scopePad38();
			expect(sequencerStore.isGhost).toBe(true); // … the pad has none
			sequencerStore.handleMuteStepToggleGhost(2);
			expect(send).toHaveBeenCalledWith('/looping/v3/device/load', ['tracks/0', PAD, '/test/path/Permute.amxd']);
			expect(sequencerStore.muteSteps[2]).toBe(false); // the pad's pending edit
			setScope(null);
			expect(sequencerStore.muteSteps[2]).toBe(true); // the track's own device, untouched
			scopePad38();
			mergePadChain(2, PAD, new Map([[PAD_PERMUTE, padPermute()]]));
			vi.mocked(send).mockClear();
			sequencerStore.onDeviceLoaded(v3Store.deviceByPath.get(PAD_PERMUTE)!);
			expect(send).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenLastCalledWith('/looping/v3/param/set', [`${PAD_PERMUTE}/params/3`, 0, 2]);
			expect(sequencerStore.isLoading).toBe(false);
		});

		it("clearCachedState drops a pad's pending edits with the track's", () => {
			replaceTree(1, [mkEmptyTrack(0)]);
			scopePad38();
			sequencerStore.handlePitchStepToggleGhost(0);
			expect(sequencerStore.pitchSteps[0]).toBe(true);
			sequencerStore.clearCachedState(0);
			expect(sequencerStore.pitchSteps[0]).toBe(false);
		});
	});
});
