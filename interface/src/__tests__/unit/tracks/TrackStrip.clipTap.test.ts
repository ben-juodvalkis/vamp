/**
 * The strip's clip section (notes / waveform), tapped.
 *
 * A tap selects the track and brings up its Clip view, which since
 * 2026-10-09 is one view (editor and controls together), so a further
 * tap has nothing to flip and leaves the Clip view up.
 */


import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { SvelteMap } from 'svelte/reactivity';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { session } from '$lib/stores/session.svelte';
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
 * jsdom lays nothing out, so the hit-test is answered with the clip section.
 */
function tapClipSection(container: HTMLElement): void {
	const card = container.querySelector<HTMLElement>('[data-debug="track-card"]');
	const band = container.querySelector<HTMLElement>('[data-section="clip"]');
	if (!card || !band) throw new Error('strip rendered without its card or clip section');
	Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => band });
	card.dispatchEvent(pointer('pointerdown'));
	window.dispatchEvent(pointer('pointerup'));
}

beforeEach(() => {
	_resetForTests();
	session.selectTrackOptimistically(0);
	centralDisplayStore.setView('permute', undefined, null, 'Permute');
	replaceTree(1, [track('midi', [])]);
});

afterEach(() => {
	cleanup();
	delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

describe('TrackStrip — tapping the clip section', () => {
	it('a tap opens the Clip view', async () => {
		const { container } = render(TrackStrip, { props: { trackIndex: TRACK_INDEX } });

		tapClipSection(container);

		await vi.waitFor(() => expect(centralDisplayStore.view.type).toBe('clip'));
		expect(session.selectedTrackIndex).toBe(TRACK_INDEX);
	});

	it('a further tap keeps the Clip view up', async () => {
		const { container } = render(TrackStrip, { props: { trackIndex: TRACK_INDEX } });
		tapClipSection(container);
		await vi.waitFor(() => expect(centralDisplayStore.view.type).toBe('clip'));

		tapClipSection(container);
		tapClipSection(container);
		expect(centralDisplayStore.view.type).toBe('clip');
	});

	it('another track\'s Clip view up: the tap only moves it here', async () => {
		centralDisplayStore.setView('clip', undefined, null, 'Clip');
		const { container } = render(TrackStrip, { props: { trackIndex: TRACK_INDEX } });

		tapClipSection(container);

		await vi.waitFor(() => expect(session.selectedTrackIndex).toBe(TRACK_INDEX));
		expect(centralDisplayStore.view.type).toBe('clip');
	});
});
