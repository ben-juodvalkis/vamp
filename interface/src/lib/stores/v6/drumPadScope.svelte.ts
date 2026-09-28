/**
 * drumPadScope — which Drum Rack pads are held right now, and the one
 * rule for writing to them (2026-09-08).
 *
 * The pad grid (`DrumPadGrid`) reports a finger landing on and leaving a
 * tile; this store remembers the holds in press order, per pointer, so
 * every writer of a virtual-macro function agrees on the scope: the
 * Drum Rack view's controls AND the FX grid's Pitch slider, which lives
 * in a different component tree and is the kit's one pitch knob once the
 * central Trnsp steps aside (the user's call: "it should still obey the
 * hold-to-edit-a-single-pad thing").
 *
 * HOLD SCOPES, LIFT RETURNS. Nothing held → the writer moves the kit
 * (`vm.<fn>`). Held → `writeScoped` writes the LAST pressed pad's row
 * (`vm.pad.<note>.<fn>`) with the control's absolute value and moves
 * every other held pad by the same delta from its own value — their
 * differences survive, the kit's rule applied to a hand-picked few. An
 * enum (FX type) has no delta and lands on every held pad as is. A pad
 * whose row reads nil (no member) is left alone.
 *
 * `padLocal` is a per-gesture memory of what we last wrote each held
 * pad, so the delta for the others is measured against our own writes
 * rather than an echo that has not landed yet; it is cleared when the
 * last finger on that device lifts.
 *
 * A GESTURE KEEPS ITS TARGET (2026-09-15). Lifting the pad while the
 * other hand is still dragging a control used to unscope mid-drag: the
 * very next frame wrote `vm.<fn>` and moved the whole kit at the pad's
 * value, and on the FX grid a ghost tile loaded its effect onto the
 * TRACK. So when the last hold on a device lifts while a finger is down
 * on something that is not a pad, the scope is PINNED — the same notes,
 * for reads and writes alike — until that finger lifts too. Nothing
 * about the gesture changes under the hand: the tile stays lit, the
 * controls keep the pad's ink and values, and the write keeps its
 * target. The pin is momentary, not a latch: it dies with the finger
 * that earned it, and the kit is the target again.
 *
 * This is view state, deliberately not on the surface: two clients
 * (Mac and iPad) cannot fight over a scope that each keeps for itself.
 */

import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { vmPadProperty, vmValueKind, clampVmValue } from '$lib/services/drumVirtualMacros';
import {
	shouldRestoreOnRelease,
	type MomentaryReleaseReason
} from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';

interface Hold {
	devicePath: string;
	note: number;
	/** When the finger landed, for the tap-vs-hold split at release. */
	at: number;
	/**
	 * What was latched on this device when the finger landed — what a TAP
	 * toggles against (tapping the latched pad lets it go). A hold's release
	 * does not write it back: see `releasePad`.
	 */
	prevLatch: number | null;
}

// pointer id → hold; a SvelteMap keeps insertion (press) order and is
// reactive, so `heldNotes` / `scopeNote` read inside `$derived` track it.
const holds = new SvelteMap<number, Hold>();
// devicePath → the ONE latched pad, a scope with no finger on it
// (2026-09-09). Reactive for the same reason `holds` is.
const latchedPads = new SvelteMap<string, number>();
// `${devicePath}|${note}|${fn}` → the value we last wrote that pad.
const padLocal = new Map<string, number>();
// devicePath → the device TYPE whose central view the Drum Rack view's
// pane shows for the scoped pad (issue #491, 2026-09-10) — a type, never
// an instance: the scoped pad supplies the instance, so a momentary hold
// over a latch shows the held pad's Reverb, ghosted if it has none.
// Pane lifetime = scope lifetime: cleared with the last hold, an unlatch,
// `clear()` and a latch `retainLatched` drops.
const panes = new SvelteMap<string, string>();
// Every pointer id currently down anywhere on the glass, from the window
// listeners at the foot of this file. A pad tile's own finger is in here
// too — what makes a pointer an EDITING one is that it is not holding a
// pad (`editingPointerDown`). Plain, not reactive: nothing derives from
// it, the pins it gates are what the views read.
const glassPointers = new Set<number>();
// devicePath → the notes a lifted hold pinned for the rest of an edit
// gesture (see the header, and `releasePad`). Reactive for the same
// reason `holds` is: `heldNotes` reads it inside `$derived`.
const pinnedScopes = new SvelteMap<string, number[]>();

function localKey(devicePath: string, note: number, fn: string): string {
	return `${devicePath}|${note}|${fn}`;
}

function clearLocal(devicePath: string): void {
	const prefix = `${devicePath}|`;
	for (const key of [...padLocal.keys()]) if (key.startsWith(prefix)) padLocal.delete(key);
}

/** Notes with a FINGER on them, in press order, a pad held by two fingers listed once. */
export function pressedNotes(devicePath: string): number[] {
	const out: number[] = [];
	for (const h of holds.values()) {
		if (h.devicePath === devicePath && !out.includes(h.note)) out.push(h.note);
	}
	return out;
}

/** The pad latched on `devicePath`, or null. */
export function latchedNote(devicePath: string): number | null {
	const note = latchedPads.get(devicePath);
	return note === undefined ? null : note;
}

/**
 * Every note the controls are scoped to: the latched pad first (it was
 * scoped earliest) then the pressed ones in press order, each once.
 *
 * A latched pad behaves exactly as a held one — it is in the scope, it
 * takes the multi-pad delta, it wears the held treatment. The only
 * difference is that no finger is holding it there.
 */
export function heldNotes(devicePath: string): number[] {
	const pressed = pressedNotes(devicePath);
	const latched = latchedNote(devicePath);
	if (latched !== null && !pressed.includes(latched)) return [latched, ...pressed];
	if (pressed.length) return pressed;
	// Nothing held and nothing latched: the scope an edit gesture still in
	// flight has pinned, or nothing at all.
	return pinnedScopes.get(devicePath) ?? [];
}

/** The scoped pad — the last one pressed on `devicePath` — or null when nothing is held there. */
export function scopeNote(devicePath: string): number | null {
	const notes = heldNotes(devicePath);
	return notes.length ? notes[notes.length - 1] : null;
}

/**
 * One pad's value of a function as the store holds it: a number, `null`
 * when the pad has no member for it (the row read nil), `undefined`
 * before the cold read. `fn` is a fixed function name or `macro.<name>`.
 */
export function padValue(devicePath: string, note: number, fn: string): number | null | undefined {
	const raw = selectedTrackStore.propertyValue(devicePath, vmPadProperty(note, fn));
	if (raw === null) return null;
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function setLatch(devicePath: string, note: number | null): void {
	if (note === null) latchedPads.delete(devicePath);
	else latchedPads.set(devicePath, note);
}

/** The pane cannot outlive the scope it shows a pad through. */
function dropPaneIfUnscoped(devicePath: string): void {
	if (scopeNote(devicePath) === null) panes.delete(devicePath);
}

/**
 * Is a finger down on something OTHER than a pad right now? `exclude` is
 * the pointer whose release is being handled: the window listener drops
 * it before the tile's own handler runs, but the order of those two is
 * not ours to depend on.
 */
function editingPointerDown(exclude: number): boolean {
	for (const id of glassPointers) {
		if (id === exclude) continue;
		if (holds.has(id)) continue; // that finger is holding a pad, not editing
		return true;
	}
	return false;
}

/** Any editing finger at all — what keeps the pins alive. */
function anyEditingPointer(): boolean {
	for (const id of glassPointers) if (!holds.has(id)) return true;
	return false;
}

/**
 * The gesture ended: every pin goes, and the cleanups its lifetime
 * deferred run now — the per-gesture delta memory where no finger is
 * left on the device, and the pane, which cannot outlive its scope.
 */
function dropPins(): void {
	if (pinnedScopes.size === 0) return;
	for (const devicePath of [...pinnedScopes.keys()]) {
		pinnedScopes.delete(devicePath);
		if (pressedNotes(devicePath).length === 0) clearLocal(devicePath);
		dropPaneIfUnscoped(devicePath);
	}
}

function writePad(devicePath: string, note: number, fn: string, value: number): void {
	padLocal.set(localKey(devicePath, note, fn), value);
	selectedTrackStore.setPropertyValue(devicePath, vmPadProperty(note, fn), value);
}

/**
 * External holds (ADR-432) — a pad held on the Move, timed by the Max
 * Utility patch and named by the surface (`/looping/v3/drum/pad_hold`).
 * They live in the same `holds` map as fingers, under pointer ids no
 * browser can mint: `pointerId` is a non-negative integer on every
 * platform, so everything at or below this base is ours, one id per
 * note. The store then needs no second code path — `heldNotes`,
 * `scopeNote`, the multi-pad delta and the pane all see a Move pad
 * exactly as a finger on its tile.
 */
export const EXTERNAL_POINTER_BASE = -1000;

/** The pointer id an external hold of `note` uses. */
export function externalPointerId(note: number): number {
	return EXTERNAL_POINTER_BASE - note;
}

function isExternalPointer(pointerId: number): boolean {
	return pointerId <= EXTERNAL_POINTER_BASE;
}

function pressPad(devicePath: string, note: number, pointerId: number, now: number): void {
	// A pad pressed again is the performer choosing a scope by hand; the
	// pinned one is over. Dropped rather than released, so the delta
	// memory of the gesture in flight survives into the new hold.
	pinnedScopes.delete(devicePath);
	holds.set(pointerId, {
		devicePath,
		note,
		at: now,
		prevLatch: latchedNote(devicePath)
	});
}

function releasePad(pointerId: number, reason: MomentaryReleaseReason, now: number): void {
	const hold = holds.get(pointerId);
	// The scope as it stood WITH this pad, for the pin below.
	const scopedBefore = hold ? heldNotes(hold.devicePath) : [];
	holds.delete(pointerId);
	if (!hold) return;
	if (!shouldRestoreOnRelease({ elapsedMs: now - hold.at, reason })) {
		// The tap toggles: a pad already latched when the finger landed
		// is let go, any other pad takes the latch.
		setLatch(hold.devicePath, hold.prevLatch === hold.note ? null : hold.note);
	} else if (!pinnedScopes.has(hold.devicePath) && editingPointerDown(pointerId)) {
		// THE GESTURE PIN. A hold lifted while the other hand is mid-edit
		// keeps its scope until that hand lifts too — otherwise the next
		// drag frame would write the kit at the pad's value, and a ghost
		// FX tile would load its effect onto the track. Pinned at the
		// FIRST lift and not overwritten, so a two-pad edit keeps both
		// pads (and so the multi-pad delta) for the rest of the gesture.
		// A TAP is exempt: it either latches — a scope of its own — or
		// deliberately unlatches, and neither is a gesture interrupted.
		pinnedScopes.set(hold.devicePath, scopedBefore);
	}
	// A hold (or a press that did not finish cleanly) leaves the latch AS
	// IT IS — it never moved the latch, so there is nothing of its own to
	// put back, and writing the pre-press snapshot would destroy a latch
	// made deliberately during the hold: a Move pad held (ADR-432) while
	// a finger taps a pad on the glass, then the Move lifts. That tap is
	// the newer act and stands (code review, 2026-09-12).
	// Only a FINGER makes the per-gesture memory worth keeping: it
	// exists so a multi-pad delta is measured against our own writes,
	// and a lone latched pad is written absolutely.
	// A pinned device keeps its memory and its pane until the pin drops:
	// the gesture measuring deltas against our own writes is still in
	// flight, and `dropPaneIfUnscoped` reads the pinned scope anyway.
	if (pressedNotes(hold.devicePath).length === 0 && !pinnedScopes.has(hold.devicePath)) {
		clearLocal(hold.devicePath);
	}
	dropPaneIfUnscoped(hold.devicePath);
}

export const drumPadScope = {
	press(devicePath: string, note: number, pointerId: number, now = Date.now()): void {
		pressPad(devicePath, note, pointerId, now);
	},

	/**
	 * The finger leaves, and how long it stayed decides what that means
	 * (2026-09-09) — the same split Solo and mute make, through the same
	 * pure rule and the same 300ms, because a performer cannot learn two
	 * thresholds for "tap versus hold":
	 *
	 * - a quick **tap latches**: the pad stays scoped with nothing on it,
	 *   and tapping it again lets it go. One latch per device, so tapping
	 *   another pad moves the latch rather than collecting pads.
	 * - a **hold is momentary**, as it always was: the release leaves the
	 *   latch exactly as it finds it — the one that was there before the
	 *   press (usually nothing), or one a tap made during the hold.
	 *
	 * Any release that is not a clean `up` — the browser claiming the
	 * gesture, the grid unmounting under the finger — is treated as a hold
	 * too. A latch is a deliberate act, and a press that never finished is
	 * not one; the alternative failure is a scope nobody asked for that no
	 * gesture is obviously going to clear.
	 */
	release(pointerId: number, reason: MomentaryReleaseReason = 'up', now = Date.now()): void {
		releasePad(pointerId, reason, now);
	},

	/**
	 * A pad held on the Move (ADR-432): scoped exactly as a finger would
	 * scope it, and released with `cancel` so it can never latch — a
	 * latch is a deliberate tap on the glass, and a pad lifted on the
	 * Move is not one. The identity is the pad ON ITS RACK, as the
	 * surface keys it: a repeat for the same pad on the same rack is
	 * ignored, and the same note announced on another rack — the track
	 * switched under the hold, or the rack's path shifted — replaces
	 * the hold rather than being swallowed by it.
	 */
	pressExternal(devicePath: string, note: number, now = Date.now()): void {
		const pointerId = externalPointerId(note);
		const current = holds.get(pointerId);
		if (current !== undefined) {
			if (current.devicePath === devicePath) return;
			releasePad(pointerId, 'cancel', now);
		}
		pressPad(devicePath, note, pointerId, now);
	},

	/** Releases the external hold of `note` only if it is on `devicePath` — a release for another rack's pad is not ours. */
	releaseExternal(devicePath: string, note: number, now = Date.now()): void {
		const pointerId = externalPointerId(note);
		const current = holds.get(pointerId);
		if (current === undefined || current.devicePath !== devicePath) return;
		releasePad(pointerId, 'cancel', now);
	},

	/**
	 * Drop every external hold and nothing else — fingers and latches
	 * stay. Called on a handshake accept: the surface that announced
	 * the holds may have restarted and forgotten them, and a release
	 * that fell in a reconnect gap would otherwise leave a scope no
	 * gesture on the glass can clear.
	 */
	releaseExternalHolds(now = Date.now()): void {
		for (const pointerId of [...holds.keys()]) {
			if (isExternalPointer(pointerId)) releasePad(pointerId, 'cancel', now);
		}
	},

	/**
	 * A finger landed on the glass. Called for EVERY pointer by the window
	 * listeners at the foot of this file — a pad tile's own included,
	 * which `editingPointerDown` then discounts because that finger is in
	 * `holds`. The store already thinks in pointer ids, so this is one
	 * more thing it counts rather than a second mechanism somewhere else;
	 * tests drive it directly.
	 */
	pointerDown(pointerId: number): void {
		glassPointers.add(pointerId);
	},

	/**
	 * A finger left the glass (or the browser took the gesture away).
	 * With the last EDITING finger goes every pinned scope: the writers
	 * are the kit's again, the pane closes if nothing else holds it, and
	 * the per-gesture delta memory is cleared.
	 */
	pointerUp(pointerId: number): void {
		glassPointers.delete(pointerId);
		if (!anyEditingPointer()) dropPins();
	},

	/**
	 * Every finger is gone as far as we can know: the window lost focus
	 * mid-gesture, so the `pointerup` we are waiting for may never come.
	 * Drops the pins and the pointer count and NOTHING else — holds and
	 * latches are the performer's, and a Move hold was never on the glass.
	 */
	clearPointers(): void {
		glassPointers.clear();
		dropPins();
	},

	/**
	 * Forget a latch the kit can no longer answer for — a rack hot-swapped
	 * in place keeps its device path, so the note would otherwise stay
	 * scoped over a kit that has no such pad: an empty tile, every control
	 * ghosted, and nothing saying why. A pinned scope is pruned on the
	 * same rule and for the same reason.
	 */
	retainLatched(devicePath: string, notes: readonly number[]): void {
		const latched = latchedNote(devicePath);
		if (latched !== null && !notes.includes(latched)) {
			latchedPads.delete(devicePath);
			dropPaneIfUnscoped(devicePath);
		}
		const pinned = pinnedScopes.get(devicePath);
		if (pinned && pinned.some((note) => !notes.includes(note))) {
			const kept = pinned.filter((note) => notes.includes(note));
			if (kept.length) pinnedScopes.set(devicePath, kept);
			else {
				pinnedScopes.delete(devicePath);
				dropPaneIfUnscoped(devicePath);
			}
		}
	},

	/** Drop every hold, latch, pin and pane (a track change, a device replaced under a finger, PADS off, tests). */
	clear(): void {
		holds.clear();
		latchedPads.clear();
		padLocal.clear();
		panes.clear();
		pinnedScopes.clear();
		glassPointers.clear();
	},

	/**
	 * The device type the Drum Rack view's pane shows for `devicePath`'s
	 * scoped pad, or null — the controls row. Setting one under no scope
	 * is refused: a pane nobody can see is exactly the state this guards
	 * against.
	 */
	pane(devicePath: string): string | null {
		return scopeNote(devicePath) === null ? null : (panes.get(devicePath) ?? null);
	},

	setPane(devicePath: string, deviceType: string | null): void {
		if (deviceType === null || scopeNote(devicePath) === null) panes.delete(devicePath);
		else panes.set(devicePath, deviceType);
	},

	heldNotes,
	pressedNotes,
	latchedNote,
	scopeNote,
	padValue,

	/**
	 * Write `value` for `fn` to the held pads of `devicePath` — the scoped
	 * pad absolutely, the rest by delta. Returns false (and writes nothing)
	 * when nothing is held there, so a caller can fall back to the kit row.
	 */
	writeScoped(devicePath: string, fn: string, value: number): boolean {
		const scope = scopeNote(devicePath);
		if (scope === null) return false;
		const kind = vmValueKind(fn);
		const target = clampVmValue(fn, value);
		const prev = padLocal.get(localKey(devicePath, scope, fn)) ?? padValue(devicePath, scope, fn);
		const delta = typeof prev === 'number' ? target - prev : 0;
		writePad(devicePath, scope, fn, target);
		for (const note of heldNotes(devicePath)) {
			if (note === scope) continue;
			const base = padLocal.get(localKey(devicePath, note, fn)) ?? padValue(devicePath, note, fn);
			if (typeof base !== 'number') continue; // no member on that pad, or not read yet
			writePad(devicePath, note, fn, kind === 'enum' ? target : clampVmValue(fn, base + delta));
		}
		return true;
	}
};

// Arriving at a track always starts unscoped (user's call, 2026-09-11):
// a latch or a hold left on the previous track's rack must not follow
// the performer to the next one, nor wait for them on the way back —
// they navigated away, so the pad they were editing is done with. Every
// rack's scope goes, fingers included (a tile under one unmounts with
// its view and reports `cancel`, which finds nothing to release), and a
// Move hold still down releases into nothing when it lifts. Live's own
// selected pad is not touched: shared state, and what the Move hold and
// the CC 72 knob read. `selectedTrackStore.handleTrackSelected` is the
// one path every track change takes and it dispatches this event, which
// keeps this store off the selection store's import graph.
if (typeof window !== 'undefined') {
	window.addEventListener('track-changed', () => drumPadScope.clear());
	// The gesture pin's own bookkeeping (2026-09-15). CAPTURE phase, so a
	// down is counted before any component sees it and an up before the
	// pad tile's own handler runs — a control that stops propagation, or
	// unmounts under the finger, cannot cost us the release. `blur` is the
	// backstop for an up that never arrives (the app sent to the
	// background mid-drag): a pin that outlived its finger would be a
	// scope no gesture on the glass can clear, which is the one failure
	// this store has always refused to allow.
	window.addEventListener('pointerdown', (e) => drumPadScope.pointerDown(e.pointerId), true);
	window.addEventListener('pointerup', (e) => drumPadScope.pointerUp(e.pointerId), true);
	window.addEventListener('pointercancel', (e) => drumPadScope.pointerUp(e.pointerId), true);
	window.addEventListener('blur', () => drumPadScope.clearPointers());
}
