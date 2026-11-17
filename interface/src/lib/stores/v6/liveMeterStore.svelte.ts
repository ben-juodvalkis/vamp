/**
 * What a device's panel shows in Live that the LOM does not carry (ADR-541):
 * a needle meter's gain reduction (the Glue), a spectrum (the Auto Filter,
 * Channel EQ), an activity view (the Compressor's, ADR-543). Vamp for Mac
 * reads them off Live's window.
 *
 * A component that shows a device's meter holds a watch on it (`hold`); while
 * any hold stands the store asks
 * `/meter/watch <devicePath> <className> <levels JSON>` every 2 s —
 * the app stops 5 s after the asks stop — and the last release sends the
 * stop (`''`). `levels` walks Live's device view from the outside in, one
 * `[index, [names…]]` per level: the track's top-level devices, then for a
 * device in a Drum Rack pad's or a rack chain's chain that chain's devices
 * (Live shows the selected pad's or chain's), so the app can tell Live's
 * device view shows what the page means. Indexes are Live's, read off the
 * paths, and a name the page does not know is `null`: a pad's records hold
 * its effects, not its instrument, which Live shows first.
 *
 * The app's `/meter/reduction <devicePath> <dB> <status>` and
 * `/meter/spectrum <devicePath> <status> <dB × 64>` and
 * `/meter/activity <devicePath> <status> <threshold> <fill × N> <line × N>`
 * (heights 0..1 up Live's own scale; −1 where there is none) land in `readings`;
 * `status` is `ok` or why there is no reading (LiveMeterReader). A spectrum
 * is always on the standard grid: `SPECTRUM_BANDS` bands log-spaced from
 * `SPECTRUM_LOW_HZ` to `SPECTRUM_HIGH_HZ`, whatever its device draws.
 */

import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { v3Store, padDevicesAt, chainDevicesAt, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';

export const WATCH_ADDRESS = '/meter/watch';
export const REDUCTION_ADDRESS = '/meter/reduction';
export const SPECTRUM_ADDRESS = '/meter/spectrum';
export const ACTIVITY_ADDRESS = '/meter/activity';
export const SPECTRUM_BANDS = 64;
export const SPECTRUM_LOW_HZ = 20;
export const SPECTRUM_HIGH_HZ = 20000;
/** The quietest a spectrum band reads, in dB. */
export const SPECTRUM_FLOOR_DB = -80;
const REPEAT_MS = 2000;
const STOP = ['', '', '[]'];
/** No reading for this long and the last one is stale (Live left the Space, the app quit). */
export const STALE_MS = 1500;

export type MeterKind = 'reduction' | 'spectrum' | 'activity';

/** The device classes whose panel Vamp for Mac can read, and what it reads. */
export const METERED_CLASSES = new Map<string, MeterKind>([
	['GlueCompressor', 'reduction'],
	['AutoFilter2', 'spectrum'],
	['ChannelEq', 'spectrum'],
	['Compressor2', 'activity']
]);

export interface LiveMeterReading {
	kind: MeterKind;
	/**
	 * One dB for a reduction, `SPECTRUM_BANDS` dB for a spectrum, the
	 * threshold then the fill's and the line's heights for an activity view
	 * (`activityTrace`); empty unless `ok`.
	 */
	values: number[];
	status: string;
	at: number;
}

/** Band `i`'s centre, in Hz (geometric, on the standard grid). */
export function bandHz(i: number): number {
	const step = Math.log10(SPECTRUM_HIGH_HZ / SPECTRUM_LOW_HZ) / SPECTRUM_BANDS;
	return SPECTRUM_LOW_HZ * Math.pow(10, step * (i + 0.5));
}

const TOP_LEVEL = /^(tracks\/\d+)\/devices\/(\d+)$/;
/** `tracks/T/devices/N` then any number of `/pads|chains/X/devices/K`. */
const DEVICE_PATH = /^(tracks\/\d+\/devices\/\d+)((?:\/(?:pads|chains)\/\d+\/devices\/\d+)*)$/;
const NESTED_STEP = /\/(pads|chains)\/(\d+)\/devices\/(\d+)/g;

export type WatchArgs = [devicePath: string, className: string, levels: string];

const readings = new SvelteMap<string, LiveMeterReading>();
const holds: string[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

/** The ask for `devicePath`, or null when it is not a metered device the tree holds. */
export function watchArgs(devicePath: string): WatchArgs | null {
	const m = DEVICE_PATH.exec(devicePath);
	if (!m) return null;
	const trackPath = devicePath.slice(0, devicePath.indexOf('/devices/'));
	const track = v3Store.tracks.get(trackPath);
	if (!track) return null;
	const levels: Array<[number, Array<string | null>]> = [];
	const ownIndex = (path: string) => Number(path.slice(path.lastIndexOf('/') + 1));
	const level = (devices: DeviceRecord[], path: string): DeviceRecord | null => {
		const device = devices.find((d) => d.devicePath === path);
		if (!device) return null;
		const names: Array<string | null> = [];
		for (const d of devices) {
			const at = ownIndex(d.devicePath);
			while (names.length <= at) names.push(null);
			names[at] = d.name;
		}
		levels.push([ownIndex(path), names]);
		return device;
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

/** Ask for every held device: Vamp for Mac reads each on its own (ADR-542). */
function ask(): void {
	const asks = [...new Set(holds)].map(watchArgs).filter((a): a is WatchArgs => a !== null);
	if (asks.length === 0) send(WATCH_ADDRESS, STOP);
	for (const args of asks) send(WATCH_ADDRESS, args);
}

/** Watch `devicePath`'s meter while the returned release is not called. Every held device is read. */
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
	if (address === REDUCTION_ADDRESS) {
		const [path, db, status] = args;
		if (typeof path !== 'string' || typeof db !== 'number' || typeof status !== 'string') return;
		readings.set(path, { kind: 'reduction', values: status === 'ok' ? [db] : [], status, at: Date.now() });
		return;
	}
	if (address === SPECTRUM_ADDRESS || address === ACTIVITY_ADDRESS) {
		const [path, status, ...values] = args;
		if (typeof path !== 'string' || typeof status !== 'string' || !values.every((v) => typeof v === 'number')) return;
		const kind = address === SPECTRUM_ADDRESS ? 'spectrum' : 'activity';
		readings.set(path, { kind, values: values as number[], status, at: Date.now() });
	}
}

export interface ActivityTrace {
	/** The threshold line's height, or null when there is none. */
	threshold: number | null;
	/** The signal's height per column, oldest first. */
	fill: number[];
	/** The gain-reduction line's height per column, null where it has none. */
	line: Array<number | null>;
}

/** An activity reading's values as its three parts, or null when they don't split evenly. */
export function activityTrace(values: readonly number[]): ActivityTrace | null {
	const n = (values.length - 1) / 2;
	if (values.length < 3 || !Number.isInteger(n)) return null;
	const h = (v: number) => Math.min(1, Math.max(0, v));
	return {
		threshold: values[0] < 0 ? null : h(values[0]),
		fill: values.slice(1, 1 + n).map(h),
		line: values.slice(1 + n).map((v) => (v < 0 ? null : h(v)))
	};
}

/** `devicePath`'s latest reading, or null when there is none. */
function readingFor(devicePath: string): LiveMeterReading | null {
	return readings.get(devicePath) ?? null;
}

export const liveMeterStore = {
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
