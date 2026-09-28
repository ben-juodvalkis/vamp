/**
 * What the swap pill says (ADR-439): `describeSimilar` and `describePreset`
 * in each state the pill can be in. The label is the contract with the
 * performer — the loaded name, or why the pill cannot step: a named error's
 * code on the pill, its detail behind it.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { describeSimilar, describePreset, drumSwapKind } from '$lib/components/v6/central/useInstrumentSwap.svelte';
import type { SimilarSwapState } from '$lib/services/similarSwap.svelte';
import type { PresetSwapState } from '$lib/services/presetSwap.svelte';
import type { Preset } from '$lib/services/adapters/browserAdapter';

const READY = { state: 'ready', detail: '' };
const IDLE: SimilarSwapState = { working: false, error: null };

function kit(over: Partial<Parameters<typeof describeSimilar>[0]> = {}) {
	return describeSimilar({
		scopeNote: null,
		rackName: 'Memphis Studio + Plymouth',
		padName: null,
		helper: READY,
		swap: IDLE,
		...over
	});
}

describe('describeSimilar', () => {
	it('is disabled and names why while the helper is not ready', () => {
		expect(kit({ helper: { state: 'unknown', detail: '' } })).toMatchObject({
			disabled: true,
			error: null,
			label: 'Waiting for the AX helper'
		});
		expect(kit({ helper: { state: 'ax-helper-down', detail: '' } })).toMatchObject({
			disabled: true,
			error: 'ax-helper-down',
			label: 'ax-helper-down',
			detail: 'ax-helper-down: the AX Helper is not running'
		});
		expect(kit({ helper: { state: 'ax-untrusted', detail: 'AXIsProcessTrusted() is false' } })).toMatchObject({
			disabled: true,
			error: 'ax-untrusted',
			label: 'ax-untrusted',
			detail: 'ax-untrusted: AXIsProcessTrusted() is false'
		});
	});

	it('names the kit', () => {
		expect(kit()).toEqual({
			kind: 'similar',
			scopeLabel: 'Kit',
			label: 'Memphis Studio + Plymouth',
			detail: '',
			working: false,
			disabled: false,
			error: null
		});
	});

	it('names the scoped pad, and its note while the census has not named it', () => {
		expect(kit({ scopeNote: 38, padName: 'Snare Roto' })).toMatchObject({ scopeLabel: 'Pad', label: 'Snare Roto' });
		expect(kit({ scopeNote: 40, padName: null }).label).toBe('Pad 40');
	});

	it('keeps the name while a swap is in flight', () => {
		expect(kit({ swap: { working: true, error: null } })).toMatchObject({
			working: true,
			disabled: false,
			label: 'Memphis Studio + Plymouth'
		});
	});

	it("puts a failed swap's reason on the pill without disabling it", () => {
		// The codes a performer can meet read as phrases; the rest read as the
		// code, which still beats silence. The whole reason rides `detail`.
		const error = "ax-control-disabled: pad.swap_next is disabled in Live's UI";
		expect(kit({ swap: { working: false, error } })).toMatchObject({
			label: 'No similar samples yet',
			detail: error,
			error,
			disabled: false
		});
		expect(
			kit({ swap: { working: false, error: "swap-at-the-end: Live's ranking has nothing after this kit" } }).label
		).toBe('Nothing further that way');
		expect(kit({ swap: { working: false, error: 'swap-timeout: no reply within 45 s' } }).label).toBe('swap-timeout');
	});
});

describe('describePreset', () => {
	const presets = ['Airy Keys', 'Bell Keys', 'Clav Keys'].map(
		(name) => ({ name, fullPath: `/lib/Omnisphere/Keys/${name}.prt_omn` }) as Preset
	);
	const ready = (over: Partial<PresetSwapState> = {}): PresetSwapState => ({
		status: 'ready',
		presets,
		index: 0,
		working: false,
		error: null,
		...over
	});

	it('is disabled and says why without a recorded preset it can find', () => {
		expect(describePreset({ instrumentName: 'Omnisphere', state: undefined })).toMatchObject({
			disabled: true,
			label: 'No preset recorded',
			detail: expect.stringContaining('No preset on record for this instrument')
		});
		expect(describePreset({ instrumentName: 'Omnisphere', state: ready({ status: 'loading', presets: [] }) })).toMatchObject({
			disabled: true,
			label: 'Omnisphere'
		});
		expect(describePreset({ instrumentName: 'Omnisphere', state: ready({ status: 'not-in-catalog', presets: [] }) })).toMatchObject({
			disabled: true,
			label: 'Not in the catalog'
		});
	});

	it('names the current preset', () => {
		expect(describePreset({ instrumentName: 'Omnisphere', state: ready({ index: 1 }) })).toEqual({
			kind: 'preset',
			scopeLabel: 'Preset',
			label: 'Bell Keys',
			detail: '',
			working: false,
			disabled: false,
			error: null
		});
	});

	it('keeps the name while a load is in flight, and names a failed one', () => {
		expect(describePreset({ instrumentName: 'Omnisphere', state: ready({ working: true }) })).toMatchObject({
			working: true,
			label: 'Airy Keys'
		});
		expect(describePreset({ instrumentName: 'Omnisphere', state: ready({ error: 'prepare-timeout' }) })).toMatchObject({
			label: 'prepare-timeout',
			error: 'prepare-timeout',
			disabled: false
		});
	});
});

/**
 * Which way a Drum Rack's pill steps (2026-09-27): a kit steps its preset
 * folder like every other instrument; only a held Drum Sampler pad steps
 * Live's similar samples, the one pad the bridge's swap can step.
 */
describe('drumSwapKind', () => {
	it('steps the preset folder with nothing scoped, whatever the kit is', () => {
		expect(drumSwapKind(null)).toBe('preset');
	});

	it("steps Live's similar samples for a held Drum Sampler pad", () => {
		expect(drumSwapKind('DrumCell')).toBe('similar');
	});

	it('steps the kit for a held pad of any other class', () => {
		// A Sampler pad is a multisample Live cannot rank; the bridge refuses
		// a single-pad swap on anything but a Drum Sampler.
		expect(drumSwapKind('MultiSampler')).toBe('preset');
		expect(drumSwapKind('OriginalSimpler')).toBe('preset');
		expect(drumSwapKind('InstrumentGroupDevice')).toBe('preset');
	});
});
