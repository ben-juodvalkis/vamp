/**
 * Ben's Adaptive Tone Shaper's frames (2026-10-07).
 *
 * The device draws its own face from two things the LOM never carries: the
 * spectrum it hears and the curve it is applying, 59 sixth-octave bands
 * (25 Hz to 20 kHz) each, in dB. Every instance sends them thirty times a
 * second to the bridge, which relays the one this client watches
 * (`/toneshaper/watch`, `handlers/toneShaper.js`):
 *
 *   /toneshaper/frame [devicePath:string, levels:float×59, gains:float×59]
 *
 * Its own module, like the meters: at thirty a second a frame on a
 * DeviceRecord would re-derive every reader of that device's name.
 */

import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';

export const TONE_SHAPER_BANDS = 59;
export const TONE_SHAPER_FRAME_ADDRESS = '/toneshaper/frame';
export const TONE_SHAPER_WATCH_ADDRESS = '/toneshaper/watch';

export interface ToneShaperFrame {
	/** The input's level per band, dB (relative; the graph scales them to the loudest). */
	levels: number[];
	/** The gain being applied per band, dB. */
	gains: number[];
}

const frames = new SvelteMap<string, ToneShaperFrame>();

export const toneShaperStore = {
	get(devicePath: string): ToneShaperFrame | undefined {
		return frames.get(devicePath);
	},
	size(): number {
		return frames.size;
	},
	/**
	 * Tell the bridge which device's frames to relay to this client: one
	 * path, or `''` for none. The view sends it as it mounts, as its device
	 * changes, and as it unmounts (components do not touch the OSC client).
	 */
	watch(devicePath: string): void {
		send(TONE_SHAPER_WATCH_ADDRESS, [devicePath]);
	}
};

/** Write one device's frame. Drops a frame of the wrong size. */
export function applyToneShaperFrame(devicePath: string, levels: number[], gains: number[]): boolean {
	if (!devicePath || levels.length !== TONE_SHAPER_BANDS || gains.length !== TONE_SHAPER_BANDS) return false;
	frames.set(devicePath, { levels, gains });
	return true;
}

/** Test-only reset. */
export function __resetToneShaperStoreForTests(): void {
	frames.clear();
}
