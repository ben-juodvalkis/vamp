/**
 * The strip's device band, TAPPED (2026-09-15).
 *
 * `trackDeviceGlance.test.ts` pins what the glance says; this pins what
 * the strip does with it. The two came apart once: `selectThenDevice`
 * read a `glance.chain` the glance has never had, so every tap that
 * reached the device branch — any audio track whose chain head has a
 * view, and a MIDI track with no instrument whose head has one — selected
 * the track, then threw, and the central view never left the view it was
 * on. The type checker reports that read, but `npm run check` gates
 * nothing (the pre-push hook leaves it out while it is red) and neither
 * the build nor vitest type-checks, so the tap is mounted here: the real
 * strip, through its real gesture machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import {
	_resetForTests,
	replaceTree,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';
import TrackStrip from '$lib/components/v6/tracks/TrackStrip.svelte';

const TRACK_INDEX = 3;
const TRACK = `tracks/${TRACK_INDEX}`;

function device(devicePath: string, name: string, className: string): DeviceRecord {
	return {
		devicePath,
		name,
		className,
		params: new SvelteMap<string, ParamRecord>(),
		properties: new SvelteMap<string, OSCArg>()
	};
}

function track(kind: 'midi' | 'audio', devices: DeviceRecord[]): TrackRecord {
	return {
		trackPath: TRACK,
		name: 'T',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: kind === 'midi',
		hasAudioInput: kind === 'audio',
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap<string, DeviceRecord>(devices.map((d) => [d.devicePath, d])),
		slots: new SvelteMap()
	};
}

/**
 * jsdom has no PointerEvent constructor, and the machine reads only
 * pointerId / pointerType / clientX / clientY — the same stand-in
 * `useStripGestures.test.ts` uses.
 */
function pointer(type: string): PointerEvent {
	const ev = new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	Object.defineProperty(ev, 'pointerType', { value: 'touch' });
	return ev as unknown as PointerEvent;
}

/**
 * Down on the card, up on `window` (where the machine listens), no travel:
 * a tap. The strip hit-tests the press point with `elementFromPoint`, and
 * jsdom lays nothing out, so the hit-test is answered with the band.
 */
function tapDeviceBand(container: HTMLElement): void {
	const card = container.querySelector<HTMLElement>('[data-debug="track-card"]');
	const band = container.querySelector<HTMLElement>('[data-section="device"]');
	if (!card || !band) throw new Error('strip rendered without its card or device band');
	Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => band });
	card.dispatchEvent(pointer('pointerdown'));
	window.dispatchEvent(pointer('pointerup'));
}

beforeEach(() => {
	_resetForTests();
	// Where the symptom left it: a tap that failed never moved off this.
	centralDisplayStore.setView('clip', undefined, null, 'Clip');
});

afterEach(() => {
	cleanup();
	delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

describe('TrackStrip — a tap on the device band opens the chain head\'s view', () => {
	it('on an audio track: the Guitar chain opens its Auto Filter', async () => {
		replaceTree(1, [
			track('audio', [
				device(`${TRACK}/devices/0`, 'Auto Filter', 'AutoFilter2'),
				device(`${TRACK}/devices/1`, 'Echo', 'Echo'),
				device(`${TRACK}/devices/2`, 'Bass Amp', 'AudioEffectGroupDevice')
			])
		]);
		const { container } = render(TrackStrip, { props: { trackIndex: TRACK_INDEX } });

		tapDeviceBand(container);

		await vi.waitFor(() => expect(centralDisplayStore.view.type).toBe('device'));
		expect(centralDisplayStore.view.subType).toBe('filter');
		expect(send).toHaveBeenCalledWith('/looping/v3/track/select', [TRACK]);
		// Anything riding along must be what a device view can read: the
		// views that take a `color` override dereference `.primary` on it,
		// so a bare ink string there draws every control uninked.
		const color = centralDisplayStore.view.data?.color;
		expect(color === undefined || typeof color.primary === 'string').toBe(true);
	});

	it('on a MIDI track with no instrument: the effect at its head', async () => {
		replaceTree(1, [
			track('midi', [
				device(`${TRACK}/devices/0`, 'Random', 'MidiRandom'),
				device(`${TRACK}/devices/1`, 'Reverb', 'Hybrid')
			])
		]);
		const { container } = render(TrackStrip, { props: { trackIndex: TRACK_INDEX } });

		tapDeviceBand(container);

		await vi.waitFor(() => expect(centralDisplayStore.view.type).toBe('device'));
		expect(centralDisplayStore.view.subType).toBe('random');
	});
});
