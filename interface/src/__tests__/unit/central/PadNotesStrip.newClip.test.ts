/**
 * PadNotesStrip with nothing playing (ADR-479): the first step added makes
 * a one-bar clip in the pedal's slot, or the track's first empty one, fires
 * it, and writes the step into it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn(),
	sendClipCreate: vi.fn()
}));

vi.mock('$lib/services/clipRichNotesService', () => ({
	requestRichNotes: vi.fn(() => Promise.resolve([])),
	sendAddNotes: vi.fn(() => Promise.resolve([7])),
	sendModifyNotes: vi.fn(),
	sendRemoveNotes: vi.fn()
}));

vi.mock('$lib/services/clipNotesService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/clipNotesService')>()),
	subscribeNotesChanged: vi.fn(() => () => {})
}));

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { sendClipCreate } from '$lib/api/simpleClient';
import { sendAddNotes } from '$lib/services/clipRichNotesService';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type SlotRecord,
	type DeviceRecord
} from '$lib/stores/v3/normalized.svelte';
import PadNotesStrip from '$lib/components/v6/central/views/drum/PadNotesStrip.svelte';

const TRACK = 'tracks/0';

function track(occupied: number[]): TrackRecord {
	const slots = new SvelteMap<string, SlotRecord>();
	for (let i = 0; i < 4; i++) {
		const slotPath = `${TRACK}/slots/${i}`;
		slots.set(
			slotPath,
			occupied.includes(i)
				? {
						slotPath,
						state: 'has_clip',
						clip: { clipPath: `${slotPath}/clip`, name: '', length: 4, color: 0, pitch: 0, properties: new SvelteMap() }
					}
				: { slotPath, state: 'empty' }
		);
	}
	return {
		trackPath: TRACK,
		name: 'Drums',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: 'drum',
		devices: new SvelteMap<string, DeviceRecord>(),
		slots
	} as TrackRecord;
}

function pointer(el: Element, type: string, clientX: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 10 });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

async function tapStep(container: HTMLElement, clientX: number) {
	const strip = container.querySelector('[data-pad-notes]')!;
	pointer(strip, 'pointerdown', clientX);
	pointer(window as unknown as Element, 'pointerup', clientX);
	await tick();
}

describe('PadNotesStrip — a step with nothing playing makes a clip', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: 160, bottom: 40, width: 160, height: 40, toJSON: () => ({})
		} as DOMRect);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("makes a one-bar clip in the first empty slot and adds the step to it", async () => {
		replaceTree(1, [track([0])]);
		const { container } = render(PadNotesStrip, {
			props: { trackPath: TRACK, clipPath: '', clipWindow: null, note: 36, ink: '#fff' }
		});
		await tick();
		expect(container.textContent).toContain('add a step to start one');

		// Step 3 of 16 on a 160px strip.
		await tapStep(container, 25);

		expect(sendClipCreate).toHaveBeenCalledWith(`${TRACK}/slots/1`, 4);
		expect(sendAddNotes).toHaveBeenCalledTimes(1);
		const [clipPath, specs] = vi.mocked(sendAddNotes).mock.calls[0];
		expect(clipPath).toBe(`${TRACK}/slots/1/clip`);
		expect(specs).toMatchObject([{ pitch: 36, startBeats: 0.5, durationBeats: 0.25 }]);
	});

	it('writes a second step into the clip it made, not a new one', async () => {
		replaceTree(1, [track([])]);
		const { container } = render(PadNotesStrip, {
			props: { trackPath: TRACK, clipPath: '', clipWindow: null, note: 36, ink: '#fff' }
		});
		await tick();
		await tapStep(container, 5);
		await tapStep(container, 85);

		expect(sendClipCreate).toHaveBeenCalledTimes(1);
		expect(vi.mocked(sendAddNotes).mock.calls.map(([cp]) => cp)).toEqual([
			`${TRACK}/slots/0/clip`,
			`${TRACK}/slots/0/clip`
		]);
	});

	it('makes nothing when every slot holds a clip', async () => {
		replaceTree(1, [track([0, 1, 2, 3])]);
		const { container } = render(PadNotesStrip, {
			props: { trackPath: TRACK, clipPath: '', clipWindow: null, note: 36, ink: '#fff' }
		});
		await tick();
		await tapStep(container, 25);

		expect(sendClipCreate).not.toHaveBeenCalled();
		expect(sendAddNotes).not.toHaveBeenCalled();
	});
});
