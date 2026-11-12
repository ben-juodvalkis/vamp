/**
 * A rack's chains, as the chain overview unfolds them (ADR-529, protocol
 * 3.13.0).
 *
 * The surface's `chain_devices` row on an Audio Effect, Instrument or MIDI
 * Effect Rack carries the chains and what is on them; reading it also sends
 * the devices' records as a `rack-chain` bundle (`selectedTrackStore
 * .chainDevices`). It is subscribed while the rack is unfolded on screen.
 *
 * Folding is Live's own: a rack is open while Live shows its devices (its
 * Show Devices toggle, the `show_devices` row), so the two mirror each other.
 * An open rack shows its chain list and the chosen chain's devices; which
 * chain is chosen is this client's, keyed by the rack's path.
 */
import { SvelteMap } from 'svelte/reactivity';
import type { OSCArg } from '$lib/types/osc';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { CHAIN_RACK_CLASSES } from '$lib/stores/v3/normalized.svelte';

export const CHAIN_DEVICES = 'chain_devices';

export interface RackChainDevice {
	index: number;
	className: string;
	name: string;
	/** Live's `Device.type`: 1 instrument, 2 audio effect, 4 MIDI effect. */
	type: number | null;
	/** A rack itself: it unfolds in turn. */
	rack: boolean;
}

export interface RackChain {
	index: number;
	name: string;
	/** Live's chain colour, an RGB int, or null. */
	color: number | null;
	mute: boolean;
	solo: boolean;
	/** Live's chain volume, 0..1 (0.85 = 0 dB), or null. */
	volume: number | null;
	devices: RackChainDevice[];
}

/** Live's chain volume at 0 dB (measured, 2026-09-08). */
export const CHAIN_UNITY = 0.85;

export function isChainRack(className: string): boolean {
	return CHAIN_RACK_CLASSES.has(className);
}

const parsed = new Map<string, RackChain[] | null>();

/** The row's chains, or null for a value that is not the row's JSON. Cached per string. */
export function parseChainDevices(raw: OSCArg | undefined): RackChain[] | null {
	if (typeof raw !== 'string') return null;
	if (parsed.has(raw)) return parsed.get(raw)!;
	let out: RackChain[] | null = null;
	try {
		const json = JSON.parse(raw) as { chains?: unknown };
		if (Array.isArray(json.chains)) {
			out = json.chains.map((c: Record<string, unknown>) => ({
				index: Number(c.index),
				name: String(c.name ?? ''),
				color: typeof c.color === 'number' ? c.color : null,
				mute: c.mute === 1 || c.mute === true,
				solo: c.solo === 1 || c.solo === true,
				volume: typeof c.volume === 'number' ? c.volume : null,
				devices: Array.isArray(c.devices)
					? c.devices.map((d: Record<string, unknown>) => ({
							index: Number(d.index),
							className: String(d.class ?? ''),
							name: String(d.name ?? d.class ?? ''),
							type: typeof d.type === 'number' ? d.type : null,
							rack: d.rack === 1 || d.rack === true
						}))
					: []
			}));
		}
	} catch {
		out = null;
	}
	if (parsed.size > 64) parsed.clear();
	parsed.set(raw, out);
	return out;
}

/** `tracks/0/devices/1` + 0 → `tracks/0/devices/1/chains/0`. */
export function chainPathOf(rackPath: string, chainIndex: number): string {
	return `${rackPath}/chains/${chainIndex}`;
}

/** The path of the device at `deviceIndex` on a rack's chain. */
export function chainDevicePathOf(rackPath: string, chainIndex: number, deviceIndex: number): string {
	return `${chainPathOf(rackPath, chainIndex)}/devices/${deviceIndex}`;
}

/** A rack's chains as its row last said, or null before it has. */
export function rackChainsOf(rackPath: string): RackChain[] | null {
	return parseChainDevices(selectedTrackStore.propertyValue(rackPath, CHAIN_DEVICES));
}

/** Set a chain's volume in Live, 0..1 (0.85 = 0 dB). */
export function setChainVolume(rackPath: string, chainIndex: number, value: number): void {
	void selectedTrackStore.setPropertyValue(rackPath, `chain.${chainIndex}.volume`, Math.max(0, Math.min(1, value)));
}

/** Turn a chain's activator (mute) or solo on or off in Live. */
export function setChainSwitch(rackPath: string, chainIndex: number, field: 'mute' | 'solo', on: boolean): void {
	void selectedTrackStore.setPropertyValue(rackPath, `chain.${chainIndex}.${field}`, on ? 1 : 0);
}

// ===== Folding =====

/** Live's Show Devices toggle on a rack, which the fold mirrors (ADR-529). */
export const SHOW_DEVICES = 'show_devices';

/**
 * A rack is open exactly while Live shows its chain devices: unfolding in
 * Vamp shows them in Live (and the chain list, where the rack has two or
 * more chains), and Live's own toggle unfolds it here. The row must be
 * subscribed for the rack (the chain overview holds it for every rack it
 * draws); before its first answer the rack reads folded.
 */
const selectedChain = new SvelteMap<string, number>();

export const rackFold = {
	isOpen(rackPath: string): boolean {
		const v = selectedTrackStore.propertyValue(rackPath, SHOW_DEVICES);
		return v === 1 || v === true;
	},
	toggle(rackPath: string): void {
		void selectedTrackStore.setPropertyValue(rackPath, SHOW_DEVICES, rackFold.isOpen(rackPath) ? 0 : 1);
	},
	/** The chain the rack shows: the one chosen, else the first. */
	chainOf(rackPath: string): number {
		return selectedChain.get(rackPath) ?? 0;
	},
	selectChain(rackPath: string, chainIndex: number): void {
		selectedChain.set(rackPath, chainIndex);
	}
};
