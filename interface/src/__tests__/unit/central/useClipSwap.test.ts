/**
 * The clip view's swap pill (ADR-440): what `describeClipSwap` says in each
 * state. The pill names the clip's sound; a clip Live cannot rank names why in
 * its place, and only a server that could not answer reads as a fault.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { describeClipSwap } from '$lib/components/v6/central/useClipSwap.svelte';
import type { ClipSwapState } from '$lib/services/clipSimilarSwap.svelte';

const SHAKERS = '/Users/Shared/Music/Samples Organized/Loops/Apple Loops/Drums/Shaker';

function ready(over: Partial<ClipSwapState> = {}): ClipSwapState {
	return {
		status: 'ready',
		reference: `${SHAKERS}/African Seed Caxixi 02.aiff`,
		sounds: [
			{ path: `${SHAKERS}/African Seed Caxixi 02.aiff`, name: 'African Seed Caxixi 02.aiff' },
			{ path: `${SHAKERS}/African Seed Caxixi 06.aiff`, name: 'African Seed Caxixi 06.aiff' }
		],
		index: 0,
		working: false,
		error: null,
		reason: null,
		...over
	};
}

function unavailable(code: string, detail: string) {
	return describeClipSwap({
		state: { ...ready(), status: 'unavailable', sounds: [], index: -1, reason: { code, detail } },
		filePath: '/Takes/Take 3.aif'
	});
}

describe('describeClipSwap', () => {
	it('names the sound the clip holds, without its extension', () => {
		expect(describeClipSwap({ state: ready(), filePath: `${SHAKERS}/African Seed Caxixi 02.aiff` })).toEqual({
			kind: 'clip',
			scopeLabel: 'Clip',
			label: 'African Seed Caxixi 02',
			detail: '',
			working: false,
			disabled: false,
			error: null
		});
		expect(describeClipSwap({ state: ready({ index: 1 }), filePath: '' }).label).toBe('African Seed Caxixi 06');
	});

	it('keeps the name while a step loads', () => {
		expect(describeClipSwap({ state: ready({ working: true }), filePath: '' })).toMatchObject({
			label: 'African Seed Caxixi 02',
			working: true,
			disabled: false
		});
	});

	it('is disabled under the clip’s name while Live’s ranking is read', () => {
		expect(describeClipSwap({ state: undefined, filePath: `${SHAKERS}/Quarters.wav` })).toMatchObject({
			label: 'Quarters',
			detail: 'Finding similar sounds…',
			disabled: true,
			error: null
		});
		expect(
			describeClipSwap({
				state: { ...ready(), status: 'loading', sounds: [], index: -1 },
				filePath: `${SHAKERS}/Quarters.wav`
			})
		).toMatchObject({ label: 'Quarters', disabled: true });
	});

	it('says why a clip cannot step, in place of its name', () => {
		expect(unavailable('not-indexed', 'Live’s index has no entry for this file')).toMatchObject({
			label: 'Not in Live’s index',
			detail: 'not-indexed: Live’s index has no entry for this file',
			disabled: true,
			error: null
		});
		expect(unavailable('no-vector', 'Live has not analyzed this file').label).toBe('Not analyzed by Live');
		expect(unavailable('no-similar', 'Live’s index has no similar sound for this file').label).toBe(
			'No similar sounds'
		);
		expect(unavailable('no-file', 'The clip has no file yet').label).toBe('No file yet');
	});

	it('shows a server that could not answer as a fault', () => {
		expect(unavailable('no-database', 'no Live-files-*.db in /nowhere')).toMatchObject({
			label: 'no-database',
			detail: 'no-database: no Live-files-*.db in /nowhere',
			disabled: true,
			error: 'no-database: no Live-files-*.db in /nowhere'
		});
	});

	it('shows a failed step’s code, and can still step', () => {
		const error = 'swap-timeout: the slot did not read African Seed Caxixi 06.aiff back';
		expect(describeClipSwap({ state: ready({ error }), filePath: '' })).toMatchObject({
			label: 'swap-timeout',
			detail: error,
			disabled: false,
			error
		});
	});
});
