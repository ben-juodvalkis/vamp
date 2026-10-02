/**
 * foot-trigger.js — Tap/hold state machine for the looping foot pedal (v8)
 *
 * THE HOME-STUDIO PIANO-PEDAL LOOPER (owner-only, 2026-09-25). The live
 * USB pedal goes to the surface's own MidiPedalInput on channel 10 / CC 23
 * (ADR-422); this chain is the other way in: the Utility patch's omni
 * `ctlin` → `route 67` (the number box beside it sets the CC) → `> 64` →
 * here, so a piano's pedal loops with nothing else plugged in. The two
 * paths use different CCs and never double-fire unless one is re-pointed at
 * the other's. The patch opens only while `features.maxUtilityPatch` is on
 * (scripts/open-max-patch.js), so a general edition never hears CC 67.
 *
 * Pure timing logic: pedal down/up edges in → tap or hold OSC out.
 *
 * Inlet 0: int messages from the upstream pedal chain
 *   1 = pedal down (press)
 *   0 = pedal up   (release)
 *
 * Wire both outlets of a `sel 0 1` (or equivalent edge detector) into
 * this single inlet — the int 0/1 is the gesture vocabulary.
 *
 * Outlet 0: OSC messages, intended for `udpsend 127.0.0.1 11020` (the
 * Python surface's input port).
 *
 *   /looping/v3/foot/tap     # released within HOLD_MS of press
 *   /looping/v3/foot/hold    # HOLD_MS elapsed with pedal still down
 *
 * Semantics moved out of liveAPI-v6.js (`handleFootTrigger`,
 * `fireHighlightedClipSlot`, `toggleSessionRecord`) into Python's
 * FootTriggerComponent. This file owns *only* the timing decision —
 * "is this gesture a tap or a hold." The Python side decides what
 * each gesture does.
 *
 * Press debounce: a second press while already pressed is ignored
 * (mirrors the previous M4L `footTriggerIsPressed` guard).
 *
 * Hold suppresses the following tap: once the hold timer fires, the
 * release becomes a no-op (mirrors `footTriggerHoldTriggered`).
 *
 * Per the Phase 9 PR-9b plan, hold duration is hardcoded here. Two
 * gestures only — tap and hold. Long-hold / double-tap are out of
 * scope; if you add them, also extend the gesture vocabulary in
 * Python's FootTriggerComponent.
 */

autowatch = 1;
inlets = 1;
outlets = 1;

// ─── Config ──────────────────────────────────────────────────────────────

const HOLD_MS = 650;

const ADDR_TAP = "/looping/v3/foot/tap";
const ADDR_HOLD = "/looping/v3/foot/hold";

// ─── State ───────────────────────────────────────────────────────────────

let isPressed = false;
let holdFired = false;
let holdTimer = null;

// ─── Inlet handler ───────────────────────────────────────────────────────

function msg_int(value) {
    if (value === 1) {
        onPress();
    } else if (value === 0) {
        onRelease();
    }
    // Anything else: ignore. The upstream `sel 0 1` only emits 0 or 1.
}

// ─── Logic ───────────────────────────────────────────────────────────────

function onPress() {
    if (isPressed) { return; }   // debounce duplicate press
    isPressed = true;
    holdFired = false;

    cancelHoldTimer();
    holdTimer = new Task(fireHold);
    holdTimer.schedule(HOLD_MS);
}

function onRelease() {
    if (!isPressed) { return; }  // unmatched release; ignore
    isPressed = false;

    cancelHoldTimer();

    if (holdFired) {
        // Hold already fired during the press window. Suppress tap.
        holdFired = false;
        return;
    }

    outlet(0, ADDR_TAP);
}

function fireHold() {
    holdFired = true;
    outlet(0, ADDR_HOLD);
}

function cancelHoldTimer() {
    if (holdTimer !== null) {
        holdTimer.cancel();
        holdTimer = null;
    }
}

// ─── Reset hooks ─────────────────────────────────────────────────────────

// Called automatically when the script reloads (autowatch). Clears
// pending state so a hot edit doesn't strand a half-pressed gesture.
function loadbang() {
    reset();
}

function reset() {
    cancelHoldTimer();
    isPressed = false;
    holdFired = false;
}
