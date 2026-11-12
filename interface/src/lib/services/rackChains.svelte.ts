/**
 * A rack's chains, as the chain overview unfolds them (ADR-529, protocol
 * 3.13.0).
 *
 * The surface's `chain_devices` row on an Audio Effect, Instrument or MIDI
 * Effect Rack carries the chains and what is on them; reading it also sends
 * the devices' records as a `rack-chain` bundle (`selectedTrackStore
 * .chainDevices`). It is subscribed while the rack is unfolded on screen.
 *
 * Folding is this client's own state, like Live's per-rack chain list:
 * which racks are open and which chain each shows. Keyed by the rack's
 * device path, so a rack that moves in Live comes back folded.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
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
	devices: RackChainDevice[];
}

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

/** Turn a chain's activator (mute) or solo on or off in Live. */
export function setChainSwitch(rackPath: string, chainIndex: number, field: 'mute' | 'solo', on: boolean): void {
	void selectedTrackStore.setPropertyValue(rackPath, `chain.${chainIndex}.${field}`, on ? 1 : 0);
}

// ===== Folding =====

const unfolded = new SvelteSet<string>();
const selectedChain = new SvelteMap<string, number>();

export const rackFold = {
	isOpen(rackPath: string): boolean {
		return unfolded.has(rackPath);
	},
	toggle(rackPath: string): void {
		if (unfolded.has(rackPath)) {
			// Its racks fold with it.
			for (const p of [...unfolded]) if (p === rackPath || p.startsWith(`${rackPath}/`)) unfolded.delete(p);
		} else {
			unfolded.add(rackPath);
		}
	},
	/** The chain the rack shows: the one chosen, else the first. */
	chainOf(rackPath: string): number {
		return selectedChain.get(rackPath) ?? 0;
	},
	selectChain(rackPath: string, chainIndex: number): void {
		selectedChain.set(rackPath, chainIndex);
	},
	/** Every rack open on screen (for the subscriptions). */
	get open(): string[] {
		return [...unfolded];
	},
	clear(): void {
		unfolded.clear();
		selectedChain.clear();
	}
};
