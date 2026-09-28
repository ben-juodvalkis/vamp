/**
 * midi-remap.js — General MIDI remapping for the looping rig (v8)
 *
 * Pure logic: typed MIDI in → mode-aware OSC + MIDI passthrough.
 *
 * Two mutually-exclusive modes, driven by a momentary CC press:
 *
 *   bypass (default) — pass everything except the reserved CC.
 *   scale  (CC 51 ≥ 64) — note onsets feed scale detection; OSC scale
 *                          attrs written to the Python surface; notes
 *                          are swallowed from passthrough.
 *
 * Releasing the CC returns to bypass. On every mode transition, held
 * notes are flushed to outlet 1 with synthesized note-offs so nothing
 * sticks downstream.
 *
 * A CC 64 white-key "mute mode" lived here until 2026-08-27: holding
 * the sustain pedal turned note onsets into
 * /looping/v3/track/mute_toggle and swallowed the notes. Sustain is a
 * playing control, so that gesture fired constantly by accident and
 * silenced the keyboard while the pedal was down. Removed; CC 64 now
 * passes through to Live like any other controller. The surface's
 * mute_toggle handler stays — the UI is its only caller.
 *
 * Inlet 0 (typed MIDI from tag-midi-messages, device prefix pre-stripped):
 *   cc      <channel> <controller> <value>
 *   noteon  <channel> <note>       <velocity>
 *   noteoff <channel> <note>       <velocity>
 *
 * Outlet 0 (OSC for the Python surface; feed to udpsend 127.0.0.1 11020):
 *   /looping/v3/session/scale_mode <0|1>
 *   /looping/v3/session/scale_root <0..11>
 *   /looping/v3/session/scale_name <string>
 *
 * Outlet 1 (MIDI passthrough):
 *   - CC 51 is consumed (mode toggle); never passed.
 *   - In bypass: everything else passes through.
 *   - In scale: notes are swallowed, other messages still pass.
 */

autowatch = 1;
inlets = 1;
outlets = 2;

// ─── Config ──────────────────────────────────────────────────────────────

const ADDR_SCALE_MODE = "/looping/v3/session/scale_mode";
const ADDR_SCALE_ROOT = "/looping/v3/session/scale_root";
const ADDR_SCALE_NAME = "/looping/v3/session/scale_name";

const SCALE_CC = 51;
const CC_THRESHOLD = 64;

const MODE_BYPASS = "bypass";
const MODE_SCALE = "scale";

// Scale interval definitions (semitones from root). Order in SCALE_PRIORITY
// breaks ties — earlier wins. Ported from liveAPI-v6.js.
const SCALE_DEFINITIONS = {
    "Major":            [0, 2, 4, 5, 7, 9, 11],
    "Minor":            [0, 2, 3, 5, 7, 8, 10],
    "Dorian":           [0, 2, 3, 5, 7, 9, 10],
    "Mixolydian":       [0, 2, 4, 5, 7, 9, 10],
    "Minor Pentatonic": [0, 3, 5, 7, 10],
    "Major Pentatonic": [0, 2, 4, 7, 9],
    "Lydian":           [0, 2, 4, 6, 7, 9, 11],
    "Phrygian":         [0, 1, 3, 5, 7, 8, 10],
    "Locrian":          [0, 1, 3, 5, 6, 8, 10],
    "Harmonic Minor":   [0, 2, 3, 5, 7, 8, 11],
    "Melodic Minor":    [0, 2, 3, 5, 7, 9, 11],
    "Harmonic Major":   [0, 2, 4, 5, 7, 8, 11],
    "Dorian #4":        [0, 2, 3, 6, 7, 9, 10],
    "Phrygian Dominant":[0, 1, 4, 5, 7, 8, 10],
    "Lydian Augmented": [0, 2, 4, 6, 8, 9, 11],
    "Lydian Dominant":  [0, 2, 4, 6, 7, 9, 10],
    "Super Locrian":    [0, 1, 3, 4, 6, 8, 10],
    "Whole Tone":       [0, 2, 4, 6, 8, 10],
    "Half-whole Dim.":  [0, 1, 3, 4, 6, 7, 9, 10],
    "Whole-half Dim.":  [0, 2, 3, 5, 6, 8, 9, 11],
    "Minor Blues":      [0, 3, 5, 6, 7, 10],
    "8-Tone Spanish":   [0, 1, 3, 4, 5, 6, 8, 10],
    "Bhairav":          [0, 1, 4, 5, 7, 8, 11],
    "Hungarian Minor":  [0, 2, 3, 6, 7, 8, 11],
    "Hirajoshi":        [0, 2, 3, 7, 8],
    "In-Sen":           [0, 1, 5, 7, 10],
    "Iwato":            [0, 1, 5, 6, 10],
    "Kumoi":            [0, 2, 3, 7, 9],
    "Pelog Selisir":    [0, 1, 3, 7, 8],
    "Pelog Tembung":    [0, 1, 5, 7, 8]
};

const SCALE_PRIORITY = [
    "Major", "Minor", "Dorian", "Mixolydian",
    "Minor Pentatonic", "Major Pentatonic",
    "Lydian", "Phrygian", "Harmonic Minor", "Melodic Minor",
    "Locrian", "Harmonic Major", "Whole Tone",
    "Half-whole Dim.", "Whole-half Dim.", "Minor Blues",
    "Dorian #4", "Phrygian Dominant", "Lydian Augmented",
    "Lydian Dominant", "Super Locrian",
    "8-Tone Spanish", "Bhairav", "Hungarian Minor",
    "Hirajoshi", "In-Sen", "Iwato", "Kumoi",
    "Pelog Selisir", "Pelog Tembung"
];

// ─── State ───────────────────────────────────────────────────────────────

let mode = MODE_BYPASS;
let learnedNotes = [];                  // pitch classes 0–11, dedup
const heldNotes = new Map();            // "ch:note" → {channel, note}

// ─── Max message dispatch ────────────────────────────────────────────────
// Max routes inlet messages to the same-named JS function: a list whose
// first atom is `cc` calls cc(...rest), `noteon` calls noteon(...rest), …

function cc(channel, controller, value) {
    if (!isMidiByte(controller) || !isMidiByte(value)) {
        post(`midi-remap: bad cc args ${channel} ${controller} ${value}\n`);
        return;
    }

    if (controller === SCALE_CC) {
        if (value >= CC_THRESHOLD) enterMode(MODE_SCALE);
        else if (mode === MODE_SCALE) enterMode(MODE_BYPASS);
        return;  // reserved — never pass through
    }

    passthrough("cc", channel, controller, value);
}

function noteon(channel, note, velocity) {
    if (!isMidiByte(note) || !isMidiByte(velocity)) {
        post(`midi-remap: bad noteon args ${channel} ${note} ${velocity}\n`);
        return;
    }

    if (mode === MODE_SCALE) {
        if (velocity > 0) addScaleNote(note);
        return;
    }

    // bypass
    if (velocity > 0) trackHeld(channel, note);
    else releaseHeld(channel, note);
    passthrough("noteon", channel, note, velocity);
}

function noteoff(channel, note, velocity) {
    releaseHeld(channel, note);
    if (mode !== MODE_BYPASS) return;  // swallow matching releases
    passthrough("noteoff", channel, note, velocity);
}

function anything() {
    passthrough(messagename, ...arrayfromargs(arguments));
}

// ─── Mode transitions ────────────────────────────────────────────────────

function enterMode(next) {
    if (mode === next) return;
    flushHeldNotes();   // prevent stuck notes downstream
    mode = next;
    if (next === MODE_SCALE) {
        learnedNotes = [];
        emit(ADDR_SCALE_MODE, 1);
    } else {
        // bypass — release any per-mode local state.
        learnedNotes = [];
    }
}

// ─── Scale mode ──────────────────────────────────────────────────────────

function addScaleNote(midiNote) {
    const pitchClass = midiNote % 12;
    if (learnedNotes.indexOf(pitchClass) !== -1) return;

    learnedNotes.push(pitchClass);

    if (learnedNotes.length === 1) {
        emit(ADDR_SCALE_ROOT, pitchClass);
        emit(ADDR_SCALE_MODE, 1);
        return;
    }

    const scaleName = detectScale(learnedNotes);
    if (scaleName) {
        emit(ADDR_SCALE_NAME, scaleName);
        emit(ADDR_SCALE_MODE, 1);
    }
}

function detectScale(pitchClasses) {
    if (!pitchClasses || pitchClasses.length === 0) return null;

    const root = pitchClasses[0];
    if (pitchClasses.length === 1) return "Major";

    const intervals = [];
    for (const pc of pitchClasses) {
        const interval = (pc - root + 12) % 12;
        if (intervals.indexOf(interval) === -1) intervals.push(interval);
    }
    intervals.sort((a, b) => a - b);

    let bestMatch = null;
    let bestScore = -1;

    for (const name of SCALE_PRIORITY) {
        const def = SCALE_DEFINITIONS[name];
        if (!def) continue;
        const score = calculateMatchScore(intervals, def);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = name;
        }
    }

    return (bestMatch && bestScore > 0) ? bestMatch : "Major";
}

function calculateMatchScore(playedIntervals, scaleIntervals) {
    let matches = 0;
    let mismatches = 0;
    for (const iv of playedIntervals) {
        if (scaleIntervals.indexOf(iv) !== -1) matches++;
        else mismatches++;
    }
    return mismatches > 0 ? matches - (mismatches * 2) : matches;
}

// ─── Held-note bookkeeping ───────────────────────────────────────────────

function trackHeld(channel, note) {
    heldNotes.set(`${channel}:${note}`, { channel, note });
}

function releaseHeld(channel, note) {
    heldNotes.delete(`${channel}:${note}`);
}

function flushHeldNotes() {
    for (const { channel, note } of heldNotes.values()) {
        passthrough("noteoff", channel, note, 0);
    }
    heldNotes.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function isMidiByte(n) {
    return typeof n === "number" && !isNaN(n) && n >= 0 && n <= 127;
}

function emit(address, ...args) {
    outlet(0, address, ...args);
}

function passthrough(type, ...args) {
    outlet(1, type, ...args);
}

post("midi-remap.js loaded\n");
