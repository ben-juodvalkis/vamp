/**
 * landingEffects — effects asked for and not yet in Live (ADR-540).
 *
 * One record per load, never per type: a second Reverb landing beside the
 * first is its own record with its own held values. The chain draws each as
 * a ghost cell at once; its control writes here (`setPending`) and reads its
 * values back (`pendingValue`) until the device arrives, when they are
 * written to it and the record goes.
 *
 * WHICH DEVICE IS THE NEW ONE. Paths are positions, and an insert ahead of
 * a device renumbers it, so the paths seen before the load prove nothing.
 * The count does: a load expects one more device of its type at its target
 * than there was (plus the loads of that type already on their way there),
 * and Live puts the new one after every other of its type — a MIDI effect
 * at the end of the MIDI effects, anything else at the end of the chain — so
 * it is the matching device at index `before`.
 *
 * A load Live refuses (`fail`, from `/looping/v3/error`) or never answers
 * (`LANDING_TIMEOUT_MS`) drops its record and the values it held.
 */

import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
import { SvelteMap } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import type { DeviceTypeKey } from '$lib/config/fxGridLayout';
import { matchesSlot } from '$lib/utils/deviceSlotMatch';
import { parsePadPath } from '$lib/utils/padPaths';
import { vmPadChainProperty } from '$lib/services/drumVirtualMacros';
import { v3Store, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { selectedTrackStore } from './selectedTrackStore.svelte';

export const LANDING_TIMEOUT_MS = 10_000;

export interface Landing {
	id: string;
	/** The track the load went to (a held strip's, else the selected one). */
	trackPath: string;
	/** Where in it: `''` the track's chain, a pad's path, or a rack chain's. */
	target: string;
	type: DeviceTypeKey;
	/** What a failure names the load by: the file, or `native:<class>`. */
	loadKey: string;
	/** How many of its type the target held, or had on the way, when it was asked for. */
	before: number;
	startedAt: number;
	/** Values written to it before it landed, by parameter index. */
	pending: ReadonlyMap<number, number>;
	/** Where the blue hand was when it was asked for: it goes back there if the load never lands. */
	handBefore: string | null;
}

const RACK_CHAIN = /\/chains\/\d+$/;

const landings = new SvelteMap<string, Landing>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const holds = new Map<string, () => void>();
let seq = 0;

/** The devices at a load's target, in Live's order. */
function devicesAt(trackPath: string, target: string): DeviceRecord[] {
	if (RACK_CHAIN.test(target)) {
		return selectedTrackStore.chainDevices(target.replace(RACK_CHAIN, '')).filter((d) => d.devicePath.startsWith(`${target}/`));
	}
	if (target) return selectedTrackStore.padDevices(target);
	return [...(v3Store.tracks.get(trackPath)?.devices.values() ?? [])];
}

function matching(l: Pick<Landing, 'trackPath' | 'target' | 'type'>): DeviceRecord[] {
	const config = DEVICE_PRESETS[l.type];
	return config ? devicesAt(l.trackPath, l.target).filter((d) => matchesSlot(d, config)) : [];
}

function sameSpot(a: Pick<Landing, 'trackPath' | 'target' | 'type'>, b: Pick<Landing, 'trackPath' | 'target' | 'type'>): boolean {
	return a.trackPath === b.trackPath && a.target === b.target && a.type === b.type;
}

function finish(id: string): void {
	const l = landings.get(id);
	if (!l) return;
	landings.delete(id);
	clearTimeout(timers.get(id));
	timers.delete(id);
	holds.get(id)?.();
	holds.delete(id);
}

/** Drop a load that will never land; the later ones of its type there expect one fewer. */
function drop(id: string): void {
	const l = landings.get(id);
	if (!l) return;
	if (fxChainStore.appointed === landingEffects.ghostPath(l.target || l.trackPath, l.id)) fxChainStore.observeAppointed(l.handBefore);
	finish(id);
	for (const other of [...landings.values()]) {
		if (sameSpot(other, l) && other.before > l.before) landings.set(other.id, { ...other, before: other.before - 1 });
	}
}

function land(l: Landing, device: DeviceRecord): void {
	// A hand put on the ghost (a chip's pick) is the device's now.
	if (fxChainStore.appointed === landingEffects.ghostPath(l.target || l.trackPath, l.id)) fxChainStore.observeAppointed(device.devicePath);
	for (const [index, value] of l.pending) {
		void selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), value);
	}
	finish(l.id);
}

$effect.root(() => {
	$effect(() => {
		for (const l of landings.values()) {
			const device = matching(l)[l.before];
			if (device) untrack(() => land(l, device));
		}
	});
});

export const landingEffects = {
	/** A load is on its way: returns its id. */
	start(opts: { trackPath: string; target: string; type: DeviceTypeKey; loadKey: string }): string {
		const id = `l${++seq}`;
		const onTheWay = [...landings.values()].filter((l) => sameSpot(l, opts)).length;
		landings.set(id, {
			id,
			...opts,
			before: matching(opts).length + onTheWay,
			startedAt: Date.now(),
			pending: new Map(),
			handBefore: fxChainStore.appointed
		});
		timers.set(id, setTimeout(() => drop(id), LANDING_TIMEOUT_MS));
		// A pad's chain is fresh only while its row is held: hold it until
		// the device lands, whatever the finger does meanwhile.
		const pad = parsePadPath(opts.target);
		if (pad) holds.set(id, selectedTrackStore.subscribeProperty(pad.rackPath, vmPadChainProperty(pad.note)));
		return id;
	},

	/** The load was refused before it was sent. */
	cancel(id: string): void {
		drop(id);
	},

	/**
	 * Live refused a load (`/looping/v3/error` on `device/load`): the oldest
	 * on its way under that key, in that pad (`scope`) or not in one.
	 */
	fail(loadKey: string, scope = ''): void {
		const l = this.all().find((x) => x.loadKey === loadKey && (scope ? x.target === scope : !parsePadPath(x.target)));
		if (l) drop(l.id);
	},

	/** Every load on its way, oldest first. */
	all(): Landing[] {
		return [...landings.values()].sort((a, b) => a.startedAt - b.startedAt || Number(a.id.slice(1)) - Number(b.id.slice(1)));
	},

	/**
	 * The loads on their way into one chain: a track's, a pad's or a rack
	 * chain's path. A load whose device is already in the chain is not one:
	 * the effect above finishes it a tick later, and until then the chain
	 * would draw the device twice, its ghost and itself (a second cell for a
	 * frame, the chain jumping as it came and went).
	 */
	inChain(chainPath: string): Landing[] {
		return this.all().filter((l) => (l.target || l.trackPath) === chainPath && !matching(l)[l.before]);
	},

	get(id: string): Landing | undefined {
		return landings.get(id);
	},

	setPending(id: string, paramIndex: number, value: number): void {
		const l = landings.get(id);
		if (!l) return;
		const pending = new Map(l.pending);
		pending.set(paramIndex, value);
		landings.set(id, { ...l, pending });
	},

	pendingValue(id: string, paramIndex: number): number | undefined {
		return landings.get(id)?.pending.get(paramIndex);
	},

	/** The device path a load's ghost cell draws under, in its chain. */
	ghostPath(chainPath: string, id: string): string {
		return `${chainPath}/landing/${id}`;
	},

	/**
	 * A device path with a ghost's resolved: the device it became once that
	 * has landed, else the path as given. The chain's highlight reads the
	 * blue hand through this, so a hand put on a ghost (a chip's pick, at
	 * once) moves onto the device the frame it lands, before Live reports it.
	 */
	resolve(devicePath: string | null): string | null {
		const m = devicePath?.match(/\/landing\/(l\d+)$/);
		const l = m ? landings.get(m[1]) : undefined;
		return (l && matching(l)[l.before]?.devicePath) ?? devicePath;
	},

	/** Drop every record (tests). */
	clear(): void {
		for (const id of [...landings.keys()]) finish(id);
	}
};
