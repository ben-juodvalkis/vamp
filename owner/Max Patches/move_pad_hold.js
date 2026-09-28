/**
 * move_pad_hold.js — a Move pad held past HOLD_MS scopes the interface
 * to that pad (ADR-432).
 *
 * Sits on the `midi_from_move` bus of Max Utility 1.0.maxpat:
 *
 *   [r midi_from_move] → [js move_pad_hold.js] → [udpsend 127.0.0.1 11020]
 *
 * Inlet 0 takes the bus's messages — `noteon <ch> <note> <vel>` and
 * `noteoff <ch> <note> <vel>` (a note-on at velocity 0 is a note-off).
 * Everything else is ignored.
 *
 * Outlet 0 sends `/looping/v3/move/pad_hold <note> 1` the moment a pad
 * has been down for HOLD_MS, and `/looping/v3/move/pad_hold <note> 0`
 * when that pad lifts. A pad released before HOLD_MS sends nothing at
 * all — a drum hit is not a hold. The note is only a tag that pairs
 * the release with its hold: the surface names the pad Live selected,
 * which is the pad struck — the raw note is the Move's own grid and
 * moves with the page, and a MIDI effect before the rack changes what
 * sounds without moving the selection (measured 2026-09-11).
 *
 * Notes 16–31 are the Move's step buttons (mute / solo in the hijack
 * patch) and are never pads; they are ignored. Two pads held are two
 * holds — the interface edits both by the same delta.
 *
 * Messages accepted on inlet 0 to tune it without editing the file:
 *   threshold <ms>    the hold time (default 300 — `ui.gestures.momentaryHoldMs`
 *                     in config/constants.json, the pad tiles' own; Max ES5
 *                     cannot read the JSON, so the two are kept equal by hand)
 *   pads <lo> <hi>    only notes in [lo, hi] count as pads (default 0..127)
 *   ignore <lo> <hi>  a note range to skip (default 16..31)
 *
 * Max v8/js: ES5 only — no const/let, arrows or template strings.
 */

inlets = 1;
outlets = 1;

var ADDRESS = "/looping/v3/move/pad_hold";
var HOLD_MS = 300; // = constants.json ui.gestures.momentaryHoldMs

var padLo = 0;
var padHi = 127;
var ignoreLo = 16;
var ignoreHi = 31;

var timers = {};     // note → Task counting down to "held"
var announced = {};  // note → true once "held 1" went out

function anything() {
	var a = arrayfromargs(arguments);
	if (messagename === "noteon" && a.length >= 3) {
		if (a[2] > 0) down(a[1]);
		else up(a[1]);
	} else if (messagename === "noteoff" && a.length >= 2) {
		up(a[1]);
	}
}

function isPad(note) {
	if (note < padLo || note > padHi) return false;
	if (note >= ignoreLo && note <= ignoreHi) return false;
	return true;
}

function down(note) {
	if (!isPad(note)) return;
	cancelTimer(note);
	var t = new Task(fire, this, note);
	t.schedule(HOLD_MS);
	timers[note] = t;
}

// Runs HOLD_MS after the note-on, unless the note-off cancelled it.
function fire() {
	var note = arguments[0];
	delete timers[note];
	announced[note] = true;
	outlet(0, ADDRESS, note, 1);
}

function up(note) {
	cancelTimer(note);
	if (announced[note]) {
		delete announced[note];
		outlet(0, ADDRESS, note, 0);
	}
}

function cancelTimer(note) {
	var t = timers[note];
	if (t) {
		t.cancel();
		delete timers[note];
	}
}

function threshold(ms) {
	HOLD_MS = Math.max(0, ms);
}

function pads(lo, hi) {
	padLo = lo;
	padHi = hi;
}

function ignore(lo, hi) {
	ignoreLo = lo;
	ignoreHi = hi;
}
