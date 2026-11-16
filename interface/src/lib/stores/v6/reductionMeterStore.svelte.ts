/**
 * The gain reduction a device's meter shows in Live (ADR-541).
 *
 * Live puts no gain reduction on the LOM; Vamp for Mac reads the needle Live
 * draws in its device view. A component that shows a device's meter holds a
 * watch on it (`hold`); while any hold stands the store asks
 * `/meter/reduction/watch <devicePath> <index> <className> <names JSON>`
 * every 2 s — the app stops 5 s after the asks stop — and the last release
 * sends the stop (`''`). `names` are the track's top-level devices in order,
 * so the app can tell Live's device view shows the same track.
 *
 * The app's `/meter/reduction <devicePath> <dB> <status>` lands in
 * `readings`; `status` is `ok` or why there is no reading (ReductionReader).
 * Only top-level devices: Live shows a rack's inner devices elsewhere.
 */

import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { v3Store } from '$lib/stores/v3/normalized.svelte';

export const WATCH_ADDRESS = '/meter/reduction/watch';
export const READING_ADDRESS = '/meter/reduction';
const REPEAT_MS = 2000;
/** No reading for this long and the last one is stale (Live left the Space, the app quit). */
export const STALE_MS = 1500;

/** The device classes whose meter Vamp for Mac can read. */
export const METERED_CLASSES = new Set(['GlueCompressor']);

export interface ReductionReading {
	db: number;
	status: string;
	at: number;
}

const TOP_LEVEL = /^(tracks\/\d+)\/devices\/(\d+)$/;

const readings = new SvelteMap<string, ReductionReading>();
const holds: string[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

/** The ask for `devicePath`, or null when it is not a top-level metered device in the tree. */
export function watchArgs(devicePath: string): [string, number, string, string] | null {
	const m = TOP_LEVEL.exec(devicePath);
	if (!m) return null;
	const track = v3Store.tracks.get(m[1]);
	const device = track?.devices.get(devicePath);
	if (!track || !device || !METERED_CLASSES.has(device.className)) return null;
	const top = Array.from(track.devices.values()).filter((d) => TOP_LEVEL.test(d.devicePath));
	const index = top.findIndex((d) => d.devicePath === devicePath);
	if (index < 0) return null;
	return [devicePath, index, device.className, JSON.stringify(top.map((d) => d.name))];
}

function ask(): void {
	const path = holds[holds.length - 1];
	const args = path ? watchArgs(path) : null;
	send(WATCH_ADDRESS, args ?? ['', -1, '', '[]']);
}

/** Watch `devicePath`'s meter while the returned release is not called. The newest hold wins. */
function hold(devicePath: string): () => void {
	if (!devicePath) return () => {};
	holds.push(devicePath);
	ask();
	if (timer === null) timer = setInterval(ask, REPEAT_MS);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const at = holds.lastIndexOf(devicePath);
		if (at >= 0) holds.splice(at, 1);
		if (holds.length > 0) {
			ask();
			return;
		}
		if (timer !== null) clearInterval(timer);
		timer = null;
		send(WATCH_ADDRESS, ['', -1, '', '[]']);
	};
}

function handleMessage(address: string, args: unknown[]): void {
	if (address !== READING_ADDRESS) return;
	const [path, db, status] = args;
	if (typeof path !== 'string' || typeof db !== 'number' || typeof status !== 'string') return;
	readings.set(path, { db, status, at: Date.now() });
}

/** `devicePath`'s latest reading, or null when there is none. */
function readingFor(devicePath: string): ReductionReading | null {
	return readings.get(devicePath) ?? null;
}

export const reductionMeterStore = {
	hold,
	readingFor,
	handleMessage,
	/** For tests. */
	reset(): void {
		holds.length = 0;
		readings.clear();
		if (timer !== null) clearInterval(timer);
		timer = null;
	}
};
