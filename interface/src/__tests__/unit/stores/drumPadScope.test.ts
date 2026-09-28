/**
 * drumPadScope — the held pads and the one scoped-write rule shared by the
 * Drum Rack view's controls and the FX grid's Pitch slider (2026-09-08).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const propertyValue = vi.fn();
const setPropertyValue = vi.fn();
vi.mock('$lib/stores/v6/selectedTrackStore.svelte', () => ({
	selectedTrackStore: {
		propertyValue: (...args: unknown[]) => propertyValue(...args),
		setPropertyValue: (...args: unknown[]) => setPropertyValue(...args)
	}
}));

import { drumPadScope, externalPointerId, EXTERNAL_POINTER_BASE } from '$lib/stores/v6/drumPadScope.svelte';

const DEV = 'tracks/0/devices/0';
const OTHER = 'tracks/3/devices/0';

function rows(values: Record<string, number | null>) {
	propertyValue.mockImplementation((_path: string, name: string) => values[name]);
}

describe('drumPadScope', () => {
	beforeEach(() => {
		drumPadScope.clear();
		propertyValue.mockReset();
		setPropertyValue.mockReset();
	});

	// Every release here is a HOLD (500ms > the 300ms threshold), which is
	// what the momentary rule this suite predates always meant. A tap
	// latches instead — the block of latch tests below.
	const HELD = 500;

	it('remembers holds in press order per device, the last pressed as the scope', () => {
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
		drumPadScope.press(DEV, 36, 1, 0);
		drumPadScope.press(DEV, 40, 2, 0);
		drumPadScope.press(OTHER, 50, 3, 0);
		drumPadScope.press(DEV, 36, 4, 0); // a second finger on the same pad
		expect(drumPadScope.heldNotes(DEV)).toEqual([36, 40]);
		expect(drumPadScope.scopeNote(DEV)).toBe(40);
		expect(drumPadScope.heldNotes(OTHER)).toEqual([50]);
		drumPadScope.release(2, 'up', HELD);
		expect(drumPadScope.scopeNote(DEV)).toBe(36);
		drumPadScope.release(1, 'up', HELD);
		expect(drumPadScope.scopeNote(DEV)).toBe(36); // pointer 4 still on it
		drumPadScope.release(4, 'up', HELD);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
		expect(drumPadScope.scopeNote(OTHER)).toBe(50);
	});

	// --- latching (2026-09-09) ------------------------------------------
	//
	// The same split Solo and mute make, through the same pure rule and the
	// same 300ms: a tap latches the scope, a hold is momentary.

	it('a tap latches the pad, and tapping it again lets it go', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'up', 120); // a tap
		expect(drumPadScope.latchedNote(DEV)).toBe(38);
		expect(drumPadScope.scopeNote(DEV)).toBe(38); // scoped with nothing on it
		expect(drumPadScope.pressedNotes(DEV)).toEqual([]);
		expect(drumPadScope.heldNotes(DEV)).toEqual([38]);

		drumPadScope.press(DEV, 38, 2, 1000);
		drumPadScope.release(2, 'up', 1120);
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('a hold stays momentary, and puts back whatever was latched', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'up', 120); // latch 38
		drumPadScope.press(DEV, 42, 2, 500);
		expect(drumPadScope.scopeNote(DEV)).toBe(42); // the finger wins while it is down
		expect(drumPadScope.heldNotes(DEV)).toEqual([38, 42]); // latched first, then pressed
		drumPadScope.release(2, 'up', 1000); // a hold
		expect(drumPadScope.scopeNote(DEV)).toBe(38); // back to the latch, not to the kit
		expect(drumPadScope.latchedNote(DEV)).toBe(38);
	});

	it('a hold leaves a latch made during it alone, latched or let go (2026-09-12)', () => {
		// The hold never moved the latch, so its release has nothing of its
		// own to put back; writing the pre-press snapshot would destroy the
		// newer, deliberate act.
		drumPadScope.press(DEV, 40, 1, 0); // finger down, nothing latched
		drumPadScope.press(DEV, 36, 2, 100);
		drumPadScope.release(2, 'up', 200); // a tap under the hold: 36 latched
		expect(drumPadScope.latchedNote(DEV)).toBe(36);
		drumPadScope.release(1, 'up', 1000); // the hold lifts
		expect(drumPadScope.latchedNote(DEV)).toBe(36);
		expect(drumPadScope.scopeNote(DEV)).toBe(36);

		drumPadScope.press(DEV, 40, 3, 2000); // held over the latch on 36
		drumPadScope.press(DEV, 36, 4, 2100);
		drumPadScope.release(4, 'up', 2200); // tapping the latched pad lets it go
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
		drumPadScope.release(3, 'up', 3000); // the hold lifts: still let go
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('tapping another pad moves the latch rather than collecting pads', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'up', 120);
		drumPadScope.press(DEV, 42, 2, 500);
		drumPadScope.release(2, 'up', 560);
		expect(drumPadScope.latchedNote(DEV)).toBe(42);
		expect(drumPadScope.heldNotes(DEV)).toEqual([42]);
	});

	it('a press that never finished cleanly never latches', () => {
		// The browser claiming the gesture, or the grid unmounting under
		// the finger: a latch is deliberate, and this was not.
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'cancel', 120);
		expect(drumPadScope.latchedNote(DEV)).toBeNull();

		drumPadScope.press(DEV, 38, 2, 0);
		drumPadScope.release(2, 'up', 120); // latch it
		drumPadScope.press(DEV, 42, 3, 500);
		drumPadScope.release(3, 'cancel', 560); // cancelled tap on another pad
		expect(drumPadScope.latchedNote(DEV)).toBe(38); // the old latch stands
	});

	it('latches are per device, and clear() drops them all', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'up', 120);
		drumPadScope.press(OTHER, 50, 2, 0);
		drumPadScope.release(2, 'up', 120);
		expect(drumPadScope.latchedNote(DEV)).toBe(38);
		expect(drumPadScope.latchedNote(OTHER)).toBe(50);
		drumPadScope.clear();
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
		expect(drumPadScope.latchedNote(OTHER)).toBeNull();
	});

	it('forgets a latch the kit can no longer answer for', () => {
		// A rack hot-swapped in place keeps its device path.
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'up', 120);
		drumPadScope.retainLatched(DEV, [36, 38, 40]);
		expect(drumPadScope.latchedNote(DEV)).toBe(38);
		drumPadScope.retainLatched(DEV, [60, 61]);
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
	});

	it('writes nothing and says so when nothing is held', () => {
		expect(drumPadScope.writeScoped(DEV, 'decay', 0.5)).toBe(false);
		expect(setPropertyValue).not.toHaveBeenCalled();
	});

	it('writes the scoped pad absolutely and the other held pads by the same delta, clamped', () => {
		rows({ 'vm.pad.36.decay': 0.3, 'vm.pad.40.decay': 0.9, 'vm.pad.42.decay': null });
		drumPadScope.press(DEV, 36, 1);
		drumPadScope.press(DEV, 42, 2);
		drumPadScope.press(DEV, 40, 3);
		expect(drumPadScope.writeScoped(DEV, 'decay', 0.95)).toBe(true);
		expect(setPropertyValue.mock.calls).toEqual([
			[DEV, 'vm.pad.40.decay', 0.95],
			[DEV, 'vm.pad.36.decay', expect.closeTo(0.35, 6)]
			// pad 42 reads nil — no member — and is left alone
		]);
		// The next tick measures against what we wrote, not an echo.
		setPropertyValue.mockClear();
		drumPadScope.writeScoped(DEV, 'decay', 1.2); // clamps to 1 for the scope: +0.05
		expect(setPropertyValue.mock.calls).toEqual([
			[DEV, 'vm.pad.40.decay', 1],
			[DEV, 'vm.pad.36.decay', expect.closeTo(0.4, 6)]
		]);
	});

	it('moves pitch by whole semitones and an FX type absolutely on every held pad', () => {
		rows({ 'vm.pad.36.pitch': 3, 'vm.pad.40.pitch': 10, 'vm.pad.36.fxType': 0, 'vm.pad.40.fxType': 5 });
		drumPadScope.press(DEV, 36, 1);
		drumPadScope.press(DEV, 40, 2);
		drumPadScope.writeScoped(DEV, 'pitch', 34.4);
		expect(setPropertyValue.mock.calls).toEqual([
			[DEV, 'vm.pad.40.pitch', 34],
			[DEV, 'vm.pad.36.pitch', 27]
		]);
		setPropertyValue.mockClear();
		drumPadScope.writeScoped(DEV, 'fxType', 3);
		expect(setPropertyValue.mock.calls).toEqual([
			[DEV, 'vm.pad.40.fxType', 3],
			[DEV, 'vm.pad.36.fxType', 3]
		]);
	});

	it('forgets the gesture memory when the last finger on a device lifts', () => {
		rows({ 'vm.pad.36.decay': 0.3 });
		drumPadScope.press(DEV, 36, 1);
		drumPadScope.writeScoped(DEV, 'decay', 0.8);
		drumPadScope.release(1);
		drumPadScope.press(DEV, 36, 2);
		// A fresh hold measures from the store again (0.3), not the old 0.8.
		rows({ 'vm.pad.36.decay': 0.3, 'vm.pad.40.decay': 0.5 });
		drumPadScope.press(DEV, 40, 3);
		setPropertyValue.mockClear();
		drumPadScope.writeScoped(DEV, 'decay', 0.6); // scope 40: 0.5 → 0.6, delta +0.1
		expect(setPropertyValue.mock.calls).toEqual([
			[DEV, 'vm.pad.40.decay', 0.6],
			[DEV, 'vm.pad.36.decay', expect.closeTo(0.4, 6)]
		]);
	});

	it('reads a pad row as a number, nil, or not-yet', () => {
		rows({ 'vm.pad.36.decay': 0.3, 'vm.pad.40.decay': null });
		expect(drumPadScope.padValue(DEV, 36, 'decay')).toBe(0.3);
		expect(drumPadScope.padValue(DEV, 40, 'decay')).toBeNull();
		expect(drumPadScope.padValue(DEV, 42, 'decay')).toBeUndefined();
	});
});

// --- the pane: a device type shown for the scoped pad (issue #491) -------------

describe('drumPadScope — the pane', () => {
	const DEV = 'tracks/2/devices/0';

	beforeEach(() => drumPadScope.clear());

	it('is refused with nothing scoped, and reads null', () => {
		drumPadScope.setPane(DEV, 'reverb');
		expect(drumPadScope.pane(DEV)).toBeNull();
	});

	it('lives exactly as long as the scope', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.setPane(DEV, 'reverb');
		expect(drumPadScope.pane(DEV)).toBe('reverb');
		drumPadScope.release(1, 'up', 500); // a hold: nothing latched beneath
		expect(drumPadScope.pane(DEV)).toBeNull();
	});

	it('survives a hold over a latch and goes with the unlatch', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'up', 10); // a tap: 38 latched
		drumPadScope.setPane(DEV, 'echo');
		drumPadScope.press(DEV, 40, 2, 100);
		drumPadScope.release(2, 'up', 600); // a hold over the latch
		expect(drumPadScope.pane(DEV)).toBe('echo'); // the latch still scopes
		drumPadScope.press(DEV, 38, 3, 700);
		drumPadScope.release(3, 'up', 710); // tapping the latched pad lets go
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
		expect(drumPadScope.pane(DEV)).toBeNull();
	});

	it('is dropped with a latch the kit can no longer answer for, and by clear()', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.release(1, 'up', 10);
		drumPadScope.setPane(DEV, 'reverb');
		drumPadScope.retainLatched(DEV, [36, 40]);
		expect(drumPadScope.pane(DEV)).toBeNull();
		drumPadScope.press(DEV, 36, 1, 0);
		drumPadScope.setPane(DEV, 'reverb');
		drumPadScope.clear();
		expect(drumPadScope.pane(DEV)).toBeNull();
	});

	it('setPane(null) closes it while the scope stands', () => {
		drumPadScope.press(DEV, 38, 1, 0);
		drumPadScope.setPane(DEV, 'reverb');
		drumPadScope.setPane(DEV, null);
		expect(drumPadScope.pane(DEV)).toBeNull();
		expect(drumPadScope.scopeNote(DEV)).toBe(38);
	});
});

// --- external holds (ADR-432) ---------------------------------------------
//
// A pad held on the Move: the Max Utility patch times it, the surface names
// it, and it lands here under a pointer id no browser can mint — the same
// map as fingers, so nothing else in the store knows the difference.

describe('drumPadScope — external holds (ADR-432)', () => {
	beforeEach(() => {
		drumPadScope.clear();
		propertyValue.mockReset();
		setPropertyValue.mockReset();
	});

	it('uses one reserved pointer id per note, below anything a browser mints', () => {
		expect(externalPointerId(36)).toBeLessThanOrEqual(EXTERNAL_POINTER_BASE);
		expect(externalPointerId(36)).not.toBe(externalPointerId(37));
		expect(EXTERNAL_POINTER_BASE).toBeLessThan(0);
	});

	it('scopes the pad like a finger and releases it like a hold, never a latch', () => {
		drumPadScope.pressExternal(DEV, 38, 0);
		expect(drumPadScope.scopeNote(DEV)).toBe(38);
		expect(drumPadScope.heldNotes(DEV)).toEqual([38]);
		// Lifted 50ms later — a finger this quick would LATCH; the Move never does.
		drumPadScope.releaseExternal(DEV, 38, 50);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
	});

	it('puts back the latch that was there before the hold', () => {
		drumPadScope.press(DEV, 36, 1, 0);
		drumPadScope.release(1, 'up', 100); // a tap: 36 latched
		expect(drumPadScope.latchedNote(DEV)).toBe(36);
		drumPadScope.pressExternal(DEV, 40, 200);
		expect(drumPadScope.scopeNote(DEV)).toBe(40);
		drumPadScope.releaseExternal(DEV, 40, 900);
		expect(drumPadScope.scopeNote(DEV)).toBe(36);
		expect(drumPadScope.latchedNote(DEV)).toBe(36);
	});

	it('lifting leaves a latch tapped on the glass during the hold alone (2026-09-12)', () => {
		// One hand on the Move, the other on the iPad: the Move holds 40 while
		// a finger taps 36. The tap is the newer act and stands when the Move
		// lifts; it used to be wiped by the hold's pre-press snapshot.
		drumPadScope.pressExternal(DEV, 40, 0);
		drumPadScope.press(DEV, 36, 1, 100);
		drumPadScope.release(1, 'up', 200); // a tap: 36 latched
		expect(drumPadScope.latchedNote(DEV)).toBe(36);
		expect(drumPadScope.heldNotes(DEV)).toEqual([36, 40]); // the latch first, the Move's pad last
		drumPadScope.releaseExternal(DEV, 40, 900);
		expect(drumPadScope.latchedNote(DEV)).toBe(36);
		expect(drumPadScope.scopeNote(DEV)).toBe(36);
	});

	it('ignores a repeated hold of the same pad and a release of a pad not held', () => {
		drumPadScope.pressExternal(DEV, 38, 0);
		drumPadScope.pressExternal(DEV, 38, 10);
		expect(drumPadScope.heldNotes(DEV)).toEqual([38]);
		drumPadScope.releaseExternal(DEV, 42, 20); // never held: nothing changes
		expect(drumPadScope.scopeNote(DEV)).toBe(38);
		drumPadScope.releaseExternal(DEV, 38, 30);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('holds two pads as two holds, the last pressed as the scope', () => {
		drumPadScope.pressExternal(DEV, 36, 0);
		drumPadScope.pressExternal(DEV, 38, 10);
		expect(drumPadScope.heldNotes(DEV)).toEqual([36, 38]);
		expect(drumPadScope.scopeNote(DEV)).toBe(38);
		drumPadScope.releaseExternal(DEV, 38, 500);
		expect(drumPadScope.scopeNote(DEV)).toBe(36);
	});

	it('shares the scope with a finger: the last pressed wins, whichever device pressed it', () => {
		drumPadScope.pressExternal(DEV, 36, 0);
		drumPadScope.press(DEV, 40, 1, 10);
		expect(drumPadScope.scopeNote(DEV)).toBe(40);
		drumPadScope.release(1, 'up', 500);
		expect(drumPadScope.scopeNote(DEV)).toBe(36);
	});

	it('releaseExternalHolds drops every external hold and nothing else', () => {
		drumPadScope.press(DEV, 36, 1, 0);
		drumPadScope.release(1, 'up', 100); // latched
		drumPadScope.press(DEV, 42, 2, 200); // a finger still down
		drumPadScope.pressExternal(DEV, 38, 300);
		drumPadScope.pressExternal(OTHER, 50, 300);
		drumPadScope.releaseExternalHolds(400);
		expect(drumPadScope.heldNotes(DEV)).toEqual([36, 42]);
		expect(drumPadScope.latchedNote(DEV)).toBe(36);
		expect(drumPadScope.scopeNote(OTHER)).toBeNull();
	});

	it('keys the hold by rack and note: the same note on another rack replaces it, and only its own rack releases it', () => {
		// The track switched under the hold (or the rack's path shifted):
		// the surface announces note 36 on another rack.
		drumPadScope.pressExternal(DEV, 36, 0);
		drumPadScope.pressExternal(OTHER, 36, 100);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
		expect(drumPadScope.scopeNote(OTHER)).toBe(36);
		// A release naming the first rack is not this hold's.
		drumPadScope.releaseExternal(DEV, 36, 200);
		expect(drumPadScope.scopeNote(OTHER)).toBe(36);
		drumPadScope.releaseExternal(OTHER, 36, 300);
		expect(drumPadScope.scopeNote(OTHER)).toBeNull();
	});

	it('drops the pane with the last external hold, like any release', () => {
		drumPadScope.pressExternal(DEV, 38, 0);
		drumPadScope.setPane(DEV, 'reverb');
		expect(drumPadScope.pane(DEV)).toBe('reverb');
		drumPadScope.releaseExternal(DEV, 38, 500);
		expect(drumPadScope.pane(DEV)).toBeNull();
	});
});

describe('drumPadScope — a track change clears every scope (2026-09-11)', () => {
	beforeEach(() => {
		drumPadScope.clear();
		propertyValue.mockReset();
		setPropertyValue.mockReset();
	});

	it('drops latches, holds, external holds and the pane on every rack when the track changes', () => {
		drumPadScope.press(DEV, 36, 1, 0);
		drumPadScope.release(1, 'up', 100); // latched
		drumPadScope.press(DEV, 40, 2, 200); // a finger still down
		drumPadScope.pressExternal(OTHER, 50, 300);
		drumPadScope.setPane(DEV, 'reverb');
		window.dispatchEvent(new CustomEvent('track-changed', { detail: { trackIndex: 3 } }));
		expect(drumPadScope.heldNotes(DEV)).toEqual([]);
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
		expect(drumPadScope.scopeNote(OTHER)).toBeNull();
		expect(drumPadScope.pane(DEV)).toBeNull();
		// The lift of the finger that was down finds nothing, and latches nothing.
		drumPadScope.release(2, 'up', 400);
		expect(drumPadScope.latchedNote(DEV)).toBeNull();
	});
});

// --- the gesture pin (2026-09-15) -----------------------------------------
//
// Lift the pad while the other hand is still on a control and the scope
// stays that pad's until the hand lifts too. Before this, the very next
// drag frame wrote `vm.<fn>` and moved the whole kit at the pad's value.
//
// `pointerDown` / `pointerUp` are what the window listeners feed; the tests
// drive them directly, in the order a browser fires them — a pad tile's
// own finger is counted like any other, and discounted because it holds a
// pad.

describe('drumPadScope — the gesture pin', () => {
	const PAD = 1; // the finger on the pad tile
	const KNOB = 2; // the finger on a control

	beforeEach(() => {
		drumPadScope.clear();
		propertyValue.mockReset();
		setPropertyValue.mockReset();
	});

	/** Hold pad `note`, then put a second finger on a control. */
	function holdThenGrabControl(note: number) {
		drumPadScope.pointerDown(PAD);
		drumPadScope.press(DEV, note, PAD, 0);
		drumPadScope.pointerDown(KNOB);
	}

	/** The pad lifts: the window's capture listener first, then the tile's. */
	function liftPad(now = 500) {
		drumPadScope.pointerUp(PAD);
		drumPadScope.release(PAD, 'up', now);
	}

	it('keeps the scope when the pad lifts under a finger on a control', () => {
		holdThenGrabControl(38);
		liftPad();
		expect(drumPadScope.scopeNote(DEV)).toBe(38);
		expect(drumPadScope.heldNotes(DEV)).toEqual([38]);
		// Still the pad's row, not the kit's.
		rows({ 'vm.pad.38.decay': 0.4 });
		expect(drumPadScope.writeScoped(DEV, 'decay', 0.7)).toBe(true);
		expect(setPropertyValue.mock.calls).toEqual([[DEV, 'vm.pad.38.decay', 0.7]]);
	});

	it('lets go when the control finger lifts, and the kit is the target again', () => {
		holdThenGrabControl(38);
		liftPad();
		drumPadScope.pointerUp(KNOB);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
		expect(drumPadScope.writeScoped(DEV, 'decay', 0.7)).toBe(false);
		expect(setPropertyValue).not.toHaveBeenCalled();
	});

	it('does not pin with no finger on anything — a plain hold is still momentary', () => {
		drumPadScope.pointerDown(PAD);
		drumPadScope.press(DEV, 38, PAD, 0);
		drumPadScope.pointerUp(PAD);
		drumPadScope.release(PAD, 'up', 500);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('takes the pin at the first lift, behind a second pad still under a finger', () => {
		drumPadScope.pointerDown(PAD);
		drumPadScope.press(DEV, 38, PAD, 0);
		drumPadScope.pointerDown(3);
		drumPadScope.press(DEV, 40, 3, 10);
		drumPadScope.pointerDown(KNOB);
		liftPad();
		// 40 is genuinely held; the pin is recorded but invisible behind it.
		expect(drumPadScope.scopeNote(DEV)).toBe(40);
		drumPadScope.pointerUp(3);
		drumPadScope.release(3, 'up', 600);
		// Both pads come back: the pin was taken at the FIRST lift, so the
		// multi-pad delta survives the rest of the gesture.
		expect(drumPadScope.heldNotes(DEV)).toEqual([38, 40]);
	});

	it('is exempt from a tap: a deliberate unlatch mid-gesture returns to the kit', () => {
		drumPadScope.pointerDown(PAD);
		drumPadScope.press(DEV, 38, PAD, 0);
		drumPadScope.pointerUp(PAD);
		drumPadScope.release(PAD, 'up', 50); // a tap: 38 latched
		drumPadScope.pointerDown(KNOB); // a finger on a control
		drumPadScope.pointerDown(3);
		drumPadScope.press(DEV, 38, 3, 100);
		drumPadScope.pointerUp(3);
		drumPadScope.release(3, 'up', 150); // tapping the latched pad lets it go
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('is superseded by a pad pressed again, and the new hold rules', () => {
		holdThenGrabControl(38);
		liftPad();
		drumPadScope.pointerDown(3);
		drumPadScope.press(DEV, 42, 3, 600);
		expect(drumPadScope.scopeNote(DEV)).toBe(42);
		drumPadScope.pointerUp(3);
		drumPadScope.release(3, 'up', 1100); // a hold, the control finger still down
		expect(drumPadScope.scopeNote(DEV)).toBe(42); // pinned afresh, 38 is gone
		drumPadScope.pointerUp(KNOB);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('keeps the per-gesture delta memory across the lift', () => {
		rows({ 'vm.pad.38.decay': 0.4, 'vm.pad.42.decay': 0.6 });
		drumPadScope.pointerDown(PAD);
		drumPadScope.press(DEV, 38, PAD, 0);
		drumPadScope.pointerDown(3);
		drumPadScope.press(DEV, 42, 3, 10);
		drumPadScope.pointerDown(KNOB);
		drumPadScope.writeScoped(DEV, 'decay', 0.7); // scope 42: 0.6 → 0.7, 38 → 0.5
		liftPad();
		drumPadScope.pointerUp(3);
		drumPadScope.release(3, 'up', 600);
		setPropertyValue.mockClear();
		drumPadScope.writeScoped(DEV, 'decay', 0.8); // measured from OUR writes, not the rows
		expect(setPropertyValue.mock.calls).toEqual([
			[DEV, 'vm.pad.42.decay', 0.8],
			[DEV, 'vm.pad.38.decay', expect.closeTo(0.6, 6)]
		]);
	});

	it('holds the pane open for the gesture and drops it with the pin', () => {
		holdThenGrabControl(38);
		drumPadScope.setPane(DEV, 'reverb');
		liftPad();
		expect(drumPadScope.pane(DEV)).toBe('reverb');
		drumPadScope.pointerUp(KNOB);
		expect(drumPadScope.pane(DEV)).toBeNull();
	});

	it('pins a Move hold released under a finger on the glass', () => {
		drumPadScope.pointerDown(KNOB);
		drumPadScope.pressExternal(DEV, 44, 0);
		drumPadScope.releaseExternal(DEV, 44, 500);
		expect(drumPadScope.scopeNote(DEV)).toBe(44);
		drumPadScope.pointerUp(KNOB);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('lets go on a pointercancel, and on a window blur that eats the release', () => {
		holdThenGrabControl(38);
		liftPad();
		drumPadScope.pointerUp(KNOB); // pointercancel takes the same door
		expect(drumPadScope.scopeNote(DEV)).toBeNull();

		holdThenGrabControl(40);
		liftPad(1500);
		expect(drumPadScope.scopeNote(DEV)).toBe(40);
		drumPadScope.clearPointers();
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('is pruned with a pad the hot-swapped kit no longer has', () => {
		holdThenGrabControl(38);
		liftPad();
		drumPadScope.retainLatched(DEV, [36, 40]);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});

	it('goes with clear(), pointer count and all', () => {
		holdThenGrabControl(38);
		liftPad();
		drumPadScope.clear();
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
		// The pointer count went too: a later lift of a pad with no finger
		// recorded anywhere cannot pin.
		drumPadScope.press(DEV, 40, 5, 0);
		drumPadScope.release(5, 'up', 500);
		expect(drumPadScope.scopeNote(DEV)).toBeNull();
	});
});
