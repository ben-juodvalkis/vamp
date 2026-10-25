/**
 * trackHoldScope — which track strips are held right now, so the FX grid
 * and the effect views can edit a track without selecting it.
 *
 * A finger resting on a strip past the long-press threshold holds that
 * track. While any strip is held the FX grid is the held track's: a tile
 * reads that track's device, a drag moves it, a touch on a ghost tile
 * loads the effect onto that track. Live's selection never moves, so
 * nothing else that follows the selected track (the clip, the instrument
 * view, the Move's knobs) changes under the hand.
 *
 * SEVERAL HELD TRACKS. The FIRST one pressed is the primary: the grid
 * shows its devices and a control writes its value absolutely. Every other
 * held track that has the same device moves by the same delta, as a
 * fraction of the parameter's range, from its own value — their
 * differences survive, the drum-pad rule (`drumPadScope`) applied to
 * tracks. A track without that device is skipped. A ghost tile's load
 * goes onto every held track that lacks the effect.
 *
 * HOLD SCOPES, LIFT RETURNS, with the drum-pad gesture pin: a hold lifted
 * while another finger is mid-edit keeps the scope until that finger
 * lifts too, so a drag never changes target halfway through.
 *
 * View state, deliberately not on the surface: each client keeps its own.
 */

import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, type SlotKey } from '$lib/stores/v6/selectedTrackStore.svelte';
import { v3Store, type DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { trackOfDevicePath } from '$lib/utils/trackScopePaths';
import { isNameKeyedClass } from '$lib/utils/deviceSlotMatch';

// pointer id → held track path. Insertion order is press order.
const holds = new SvelteMap<number, string>();
// Every pointer down on the glass (window listeners at the foot of this
// file). A pointer that is not in `holds` is an editing finger.
const glassPointers = new Set<number>();
// The scope a lifted hold left behind for an edit still in flight.
let pinned = $state<string[] | null>(null);
// `${paramPath}` → the value we last wrote a follower, so a multi-track
// delta is measured against our own writes, not an echo still in flight.
const followerLocal = new Map<string, number>();

/** Tracks with a finger on them, in press order, each once. */
function pressedTracks(): string[] {
	const out: string[] = [];
	for (const path of holds.values()) if (!out.includes(path)) out.push(path);
	return out;
}

/** Every held track, primary first: the pressed ones, else the pinned ones. */
function heldTracks(): string[] {
	const pressed = pressedTracks();
	return pressed.length ? pressed : (pinned ?? []);
}

/**
 * The FX-grid slot-table key for a track: `''` for the selected track
 * (its own table, exactly as with no hold), else the track path.
 */
export function slotKeyForTrack(trackPath: string): string {
	return trackPath === selectedTrackStore.selectedTrackPath ? '' : trackPath;
}

function editingPointerDown(exclude: number): boolean {
	for (const id of glassPointers) {
		if (id === exclude || holds.has(id)) continue;
		return true;
	}
	return false;
}

function anyEditingPointer(): boolean {
	for (const id of glassPointers) if (!holds.has(id)) return true;
	return false;
}

function dropPin(): void {
	if (pinned === null) return;
	pinned = null;
	if (holds.size === 0) followerLocal.clear();
}

/**
 * The same device on another track, the way a tile finds it: the same
 * type, and the same name only where the type cannot tell (a rack, a Max
 * device, a plug-in — `utils/deviceSlotMatch`); first match.
 */
function twinOn(trackPath: string, device: DeviceRecord): DeviceRecord | null {
	const track = v3Store.tracks.get(trackPath);
	if (!track) return null;
	for (const d of track.devices.values()) {
		if (d.className !== device.className) continue;
		if (!isNameKeyedClass(d.className) || d.name === device.name) return d;
	}
	return null;
}

export const trackHoldScope = {
	press(trackPath: string, pointerId: number): void {
		pinned = null;
		holds.set(pointerId, trackPath);
	},

	release(pointerId: number): void {
		if (!holds.has(pointerId)) return;
		const before = heldTracks();
		holds.delete(pointerId);
		if (holds.size === 0 && pinned === null && editingPointerDown(pointerId)) {
			pinned = before;
		}
		if (holds.size === 0 && pinned === null) followerLocal.clear();
	},

	/**
	 * A ghost tile's load, fanned out: every other held track that has no
	 * such effect (its slot a ghost) loads it too.
	 */
	loadOnFollowers(slotKey: SlotKey): void {
		for (const key of this.followerKeys()) {
			if (selectedTrackStore.getFxGridSlot(slotKey, key).state === 'ghost') {
				selectedTrackStore.loadFxGridDevice(slotKey, key);
			}
		}
	},

	/** A pre-load value, mirrored into every follower whose copy is still on its way. */
	storePendingOnFollowers(slotKey: SlotKey, paramIndex: number, value: number): void {
		for (const key of this.followerKeys()) {
			const state = selectedTrackStore.getFxGridSlot(slotKey, key).state;
			if (state === 'ghost' || state === 'loading') {
				selectedTrackStore.storePendingParam(slotKey, paramIndex, value, key);
			}
		}
	},

	/** Every held track, primary (first pressed) first. */
	heldTracks,

	/** True while a finger (or a pin) holds a strip. */
	get active(): boolean {
		return heldTracks().length > 0;
	},

	/** The primary held track, or null. */
	get primary(): string | null {
		return heldTracks()[0] ?? null;
	},

	/**
	 * The slot-table key the FX grid and the effect views resolve against
	 * while a strip is held, or `''` (the selected track) with none — also
	 * `''` when the held primary IS the selected track.
	 */
	scopeKey(): string {
		const primary = heldTracks()[0];
		return primary ? slotKeyForTrack(primary) : '';
	},

	/** The other held tracks' slot keys — where a load and a delta fan out to. */
	followerKeys(): string[] {
		return heldTracks().slice(1).map(slotKeyForTrack);
	},

	isHeld(trackPath: string): boolean {
		return heldTracks().includes(trackPath);
	},

	/**
	 * Fan a write on the primary out to the other held tracks. `prev` is
	 * the primary's value before the write. Each follower with the same
	 * device moves by the same fraction of the parameter's range from its
	 * own value, clamped. Returns the follower paths written.
	 */
	fanOut(
		device: DeviceRecord,
		paramIndex: number,
		prev: number | undefined,
		next: number,
		write: (paramPath: string, value: number) => void
	): string[] {
		const tracks = heldTracks();
		if (tracks.length < 2 || prev === undefined) return [];
		if (trackOfDevicePath(device.devicePath) !== tracks[0]) return [];
		const primaryParam = v3Store.paramByPath.get(`${device.devicePath}/params/${paramIndex}`);
		const span = primaryParam ? primaryParam.max - primaryParam.min : 0;
		if (!(span > 0)) return [];
		const fraction = (next - prev) / span;
		const written: string[] = [];
		for (const trackPath of tracks.slice(1)) {
			const twin = twinOn(trackPath, device);
			if (!twin) continue;
			const path = `${twin.devicePath}/params/${paramIndex}`;
			const param = v3Store.paramByPath.get(path);
			if (!param) continue;
			const base = followerLocal.get(path) ?? selectedTrackStore.paramValueArmed(path) ?? param.value;
			const value = Math.min(param.max, Math.max(param.min, base + fraction * (param.max - param.min)));
			followerLocal.set(path, value);
			write(path, value);
			written.push(path);
		}
		return written;
	},

	pointerDown(pointerId: number): void {
		glassPointers.add(pointerId);
	},

	pointerUp(pointerId: number): void {
		glassPointers.delete(pointerId);
		if (!anyEditingPointer()) dropPin();
	},

	clearPointers(): void {
		glassPointers.clear();
		dropPin();
	},

	/** Drop every hold and pin (tests, teardown). */
	clear(): void {
		holds.clear();
		glassPointers.clear();
		followerLocal.clear();
		pinned = null;
	}
};

if (typeof window !== 'undefined') {
	// Capture phase, as drumPadScope does: a down is counted before any
	// component sees it, and an up before a handler that might stop it.
	window.addEventListener('pointerdown', (e) => trackHoldScope.pointerDown(e.pointerId), true);
	window.addEventListener('pointerup', (e) => trackHoldScope.pointerUp(e.pointerId), true);
	window.addEventListener('pointercancel', (e) => trackHoldScope.pointerUp(e.pointerId), true);
	window.addEventListener('blur', () => trackHoldScope.clearPointers());
}
