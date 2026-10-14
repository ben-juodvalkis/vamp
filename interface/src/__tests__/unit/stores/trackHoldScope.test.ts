/**
 * Track hold — rest a finger on a strip and the FX grid edits that track
 * without selecting it; hold several and a control moves them all.
 *
 * Pins the store's rules (primary = first pressed, relative fan-out, the
 * gesture pin), the FX-grid slot tables resolving and loading against a
 * held track, the write path's fan-out, and the strip wiring: a hold
 * after the long-press threshold, a held finger that no longer rides the
 * fader, and the release.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
import { sendParam } from '$lib/services/deviceParams';
import { replaceTree, _resetForTests, v3Store, type TrackRecord, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { LONG_PRESS_MS } from '$lib/actions/dragMachine';
import TrackStrip from '$lib/components/v6/tracks/TrackStrip.svelte';

const sendMock = vi.mocked(send);

function reverb(trackPath: string, value: number): DeviceRecord {
	const devicePath = `${trackPath}/devices/0`;
	const params = new SvelteMap();
	params.set(`${devicePath}/params/1`, {
		paramPath: `${devicePath}/params/1`,
		name: 'Dry/Wet',
		displayName: 'Dry/Wet',
		min: 0,
		max: 1,
		value,
		unit: ''
	});
	return { devicePath, name: 'Reverb', className: 'Hybrid', params, properties: new SvelteMap() } as unknown as DeviceRecord;
}

function mkTrack(index: number, devices: DeviceRecord[] = []): TrackRecord {
	const trackPath = `tracks/${index}`;
	const map = new SvelteMap<string, DeviceRecord>();
	for (const d of devices) map.set(d.devicePath, d);
	return {
		trackPath,
		name: `T${index}`,
		color: 0xff0000,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		volume: 0.5,
		devices: map,
		slots: new SvelteMap()
	} as TrackRecord;
}

function paramSets(): Array<[string, number]> {
	return sendMock.mock.calls
		.filter(([address]) => address === '/looping/v3/param/set')
		.map(([, args]) => [(args as unknown[])[0] as string, (args as unknown[])[1] as number]);
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	trackHoldScope.clear();
	fxGrid.resetForTrackChange();
	replaceTree(1, [
		mkTrack(0),
		mkTrack(1, [reverb('tracks/1', 0.2)]),
		mkTrack(2, [reverb('tracks/2', 0.6)]),
		mkTrack(3)
	]);
	selectedTrackStore.handleTrackSelected(0);
});

afterEach(() => {
	cleanup();
	trackHoldScope.clear();
	fxGrid.resetForTrackChange();
	vi.useRealTimers();
});

describe('trackHoldScope — the store', () => {
	it('the first track pressed is the primary, and its slot key is its path', () => {
		trackHoldScope.press('tracks/2', 1);
		trackHoldScope.press('tracks/1', 2);
		expect(trackHoldScope.heldTracks()).toEqual(['tracks/2', 'tracks/1']);
		expect(trackHoldScope.scopeKey()).toBe('tracks/2');
		expect(trackHoldScope.followerKeys()).toEqual(['tracks/1']);
	});

	it('holding the selected track is the selected track\'s own table', () => {
		trackHoldScope.press('tracks/0', 1);
		expect(trackHoldScope.scopeKey()).toBe('');
	});

	it('lift returns: the grid is the selected track\'s again', () => {
		trackHoldScope.press('tracks/1', 1);
		trackHoldScope.release(1);
		expect(trackHoldScope.active).toBe(false);
		expect(trackHoldScope.scopeKey()).toBe('');
	});

	it('a hold lifted mid-edit keeps its scope until the editing finger lifts', () => {
		trackHoldScope.pointerDown(1);
		trackHoldScope.press('tracks/1', 1);
		trackHoldScope.pointerDown(9); // the other hand, on a tile
		trackHoldScope.pointerUp(1);
		trackHoldScope.release(1);
		expect(trackHoldScope.scopeKey()).toBe('tracks/1');
		trackHoldScope.pointerUp(9);
		expect(trackHoldScope.active).toBe(false);
	});
});

describe('track hold — the FX grid', () => {
	it('a slot resolves against the held track\'s devices', () => {
		expect(fxGrid.getSlot('reverb', '').device).toBeNull();
		expect(fxGrid.getSlot('reverb', 'tracks/1').device?.devicePath).toBe('tracks/1/devices/0');
	});

	it('a load under a held track lands on THAT track, top level', async () => {
		await fxGrid.loadDevice('reverb', 'tracks/3');
		const loads = sendMock.mock.calls.filter(([a]) => a === '/looping/v3/device/load');
		expect(loads).toHaveLength(1);
		expect((loads[0][1] as string[]).slice(0, 2)).toEqual(['tracks/3', '']);
	});

	it('a ghost write fans the load out to every held track without the effect', () => {
		trackHoldScope.press('tracks/0', 1);
		trackHoldScope.press('tracks/3', 2);
		trackHoldScope.press('tracks/1', 3); // has a Reverb already
		sendParam(
			{ device: null, pending: { slotKey: 'reverb', scopeKey: '', isGhost: true, isLoading: false } },
			1,
			0.4
		);
		const targets = sendMock.mock.calls
			.filter(([a]) => a === '/looping/v3/device/load')
			.map(([, args]) => (args as string[])[0]);
		expect(targets).toEqual(['tracks/0', 'tracks/3']);
	});
});

describe('track hold — fan-out', () => {
	it('the other held tracks move by the same fraction of the range, from their own values', () => {
		trackHoldScope.press('tracks/1', 1);
		trackHoldScope.press('tracks/2', 2);
		const device = v3Store.tracks.get('tracks/1')!.devices.get('tracks/1/devices/0')!;
		sendParam({ device }, 1, 0.5); // 0.2 → 0.5: +0.3
		const writes = paramSets();
		expect(writes[0]).toEqual(['tracks/1/devices/0/params/1', 0.5]);
		expect(writes[1][0]).toBe('tracks/2/devices/0/params/1');
		expect(writes[1][1]).toBeCloseTo(0.9, 6); // 0.6 + 0.3
	});

	it('a follower clamps at its range', () => {
		trackHoldScope.press('tracks/1', 1);
		trackHoldScope.press('tracks/2', 2);
		const device = v3Store.tracks.get('tracks/1')!.devices.get('tracks/1/devices/0')!;
		sendParam({ device }, 1, 0.9); // +0.7 → 1.3, clamped
		expect(paramSets()[1][1]).toBe(1);
	});

	it('a held track without the device is skipped', () => {
		trackHoldScope.press('tracks/1', 1);
		trackHoldScope.press('tracks/3', 2);
		const device = v3Store.tracks.get('tracks/1')!.devices.get('tracks/1/devices/0')!;
		sendParam({ device }, 1, 0.5);
		expect(paramSets()).toEqual([['tracks/1/devices/0/params/1', 0.5]]);
	});

	it('one held track writes alone', () => {
		trackHoldScope.press('tracks/1', 1);
		const device = v3Store.tracks.get('tracks/1')!.devices.get('tracks/1/devices/0')!;
		sendParam({ device }, 1, 0.5);
		expect(paramSets()).toHaveLength(1);
	});
});

describe('track hold — the strip', () => {
	const CARD_HEIGHT = 200;

	function pointer(type: string, x: number, y: number, id = 7): PointerEvent {
		const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
		Object.defineProperty(ev, 'pointerId', { value: id });
		Object.defineProperty(ev, 'pointerType', { value: 'touch' });
		return ev as unknown as PointerEvent;
	}

	function mount(index: number) {
		const { container } = render(TrackStrip, { props: { trackIndex: index, rowScrolls: false } });
		const card = container.querySelector<HTMLElement>('[data-debug="track-card"]')!;
		card.getBoundingClientRect = () =>
			({ height: CARD_HEIGHT, width: 80, top: 0, left: 0, right: 80, bottom: CARD_HEIGHT, x: 0, y: 0 }) as DOMRect;
		return { container, card };
	}

	function volumeWrites() {
		return sendMock.mock.calls.filter(([a]) => a === '/looping/v3/track/volume');
	}

	it('a finger resting past the threshold holds the track, without selecting it', () => {
		vi.useFakeTimers();
		const { container, card } = mount(2);
		card.dispatchEvent(pointer('pointerdown', 40, 100));
		vi.advanceTimersByTime(LONG_PRESS_MS + 10);
		expect(trackHoldScope.heldTracks()).toEqual(['tracks/2']);
		expect(selectedTrackStore.selectedTrackPath).toBe('tracks/0');
		vi.useRealTimers();
		return Promise.resolve().then(() => {
			expect(container.querySelector('[data-hold-target="tracks/2"]')).not.toBeNull();
			window.dispatchEvent(pointer('pointerup', 40, 100));
			expect(trackHoldScope.active).toBe(false);
		});
	});

	it('a held finger is parked: travel after the hold moves no volume', () => {
		vi.useFakeTimers();
		const { card } = mount(2);
		card.dispatchEvent(pointer('pointerdown', 40, 100));
		vi.advanceTimersByTime(LONG_PRESS_MS + 10);
		window.dispatchEvent(pointer('pointermove', 40, 60));
		window.dispatchEvent(pointer('pointermove', 40, 30));
		vi.advanceTimersByTime(100);
		window.dispatchEvent(pointer('pointerup', 40, 30));
		expect(volumeWrites()).toEqual([]);
	});

	it('a drag before the threshold is still the fader', () => {
		vi.useFakeTimers();
		const { card } = mount(2);
		card.dispatchEvent(pointer('pointerdown', 40, 100));
		window.dispatchEvent(pointer('pointermove', 40, 80));
		window.dispatchEvent(pointer('pointermove', 40, 60));
		vi.advanceTimersByTime(LONG_PRESS_MS + 10);
		window.dispatchEvent(pointer('pointermove', 40, 40));
		vi.advanceTimersByTime(100);
		window.dispatchEvent(pointer('pointerup', 40, 40));
		expect(trackHoldScope.active).toBe(false);
		expect(volumeWrites().length).toBeGreaterThan(0);
	});
});
