/**
 * The gain reduction a device's meter shows in Live (ADR-541).
 *
 * Live puts no gain reduction on the LOM; Vamp for Mac reads the needle Live
 * draws in its device view. A component that shows a device's meter holds a
 * watch on it (`hold`); while any hold stands the store asks
 * `/meter/reduction/watch <devicePath> <className> <levels JSON>` every 2 s —
 * the app stops 5 s after the asks stop — and the last release sends the
 * stop (`''`). `levels` walks Live's device view from the outside in, one
 * `[index, [names…]]` per level: the track's top-level devices, then for a
 * device in a Drum Rack pad's or a rack chain's chain that chain's devices
 * (Live shows the selected pad's or chain's), so the app can tell Live's
 * device view shows what the page means.
 *
 * The app's `/meter/reduction <devicePath> <dB> <status>` lands in
 * `readings`; `status` is `ok` or why there is no reading (ReductionReader).
 */

import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { v3Store, padDevicesAt, chainDevicesAt, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';

export const WATCH_ADDRESS = '/meter/reduction/watch';
export const READING_ADDRESS = '/meter/reduction';
const REPEAT_MS = 2000;
const STOP = ['', '', '[]'];
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
/** `tracks/T/devices/N` then any number of `/pads|chains/X/devices/K`. */
const DEVICE_PATH = /^(tracks\/\d+\/devices\/\d+)((?:\/(?:pads|chains)\/\d+\/devices\/\d+)*)$/;
const NESTED_STEP = /\/(pads|chains)\/(\d+)\/devices\/(\d+)/g;

export type WatchArgs = [devicePath: string, className: string, levels: string];

const readings = new SvelteMap<string, ReductionReading>();
const holds: string[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

/** The ask for `devicePath`, or null when it is not a metered device the tree holds. */
export function watchArgs(devicePath: string): WatchArgs | null {
	const m = DEVICE_PATH.exec(devicePath);
	if (!m) return null;
	const trackPath = devicePath.slice(0, devicePath.indexOf('/devices/'));
	const track = v3Store.tracks.get(trackPath);
	if (!track) return null;
	const levels: Array<[number, string[]]> = [];
	const level = (devices: DeviceRecord[], path: string): DeviceRecord | null => {
		const index = devices.findIndex((d) => d.devicePath === path);
		if (index < 0) return null;
		levels.push([index, devices.map((d) => d.name)]);
		return devices[index];
	};
	const top = Array.from(track.devices.values()).filter((d) => TOP_LEVEL.test(d.devicePath));
	let device = level(top, m[1]);
	for (const [, kind, at, k] of m[2].matchAll(NESTED_STEP)) {
		if (!device) return null;
		const container = `${device.devicePath}/${kind}/${at}`;
		const inChain = new RegExp(`^${container.replace(/\//g, '\\/')}\\/devices\\/\\d+$`);
		const devices = (kind === 'pads' ? padDevicesAt(container) : chainDevicesAt(device.devicePath)).filter((d) => inChain.test(d.devicePath));
		device = level(devices, `${container}/devices/${k}`);
	}
	if (!device || !METERED_CLASSES.has(device.className)) return null;
	return [devicePath, device.className, JSON.stringify(levels)];
}

function ask(): void {
	const path = holds[holds.length - 1];
	const args = path ? watchArgs(path) : null;
	send(WATCH_ADDRESS, args ?? STOP);
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
		send(WATCH_ADDRESS, STOP);
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
