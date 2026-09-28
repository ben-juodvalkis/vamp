/**
 * skaka_pattern_pick.js — the Skaka Metronome Picker's pattern chooser
 * and note source.
 *
 * Holds the whole note lifecycle: which pattern the tempo and meter ask
 * for, whether it should be sounding at all, and what is sounding right
 * now. Writes raw MIDI bytes straight to `midiout`.
 *
 *   mode 0  auto     pick from tempo + meter, per RULES below
 *   mode 1  16th     force
 *   mode 2  8th      force
 *   mode 3  quarter  force
 *   mode 4  6/4      force
 *
 * The Klevgrand Skaka downstream **selects its pattern by held note and
 * stays phase-locked to the transport**: it shakes while a note is held,
 * stops on the note-off, and picks up wherever the bar has got to when a
 * note arrives again. That is what makes a note-off a real mute rather
 * than a restart, and it is the whole reason the Permute gate below can
 * be this simple — there is nothing to re-phase.
 *
 * Deliberately holds NO `LiveAPI` handle. A handle that reaches v8's
 * garbage collector takes Live down with a SIGTRAP — that already cost
 * this project a crash on Permute's clip-trigger path. Tempo, meter,
 * transport and the Permute gate all arrive as plain numbers and plain
 * messages on inlets, so there is nothing here for the GC to reclaim.
 * Keep it that way: if a future edit needs something from the LOM, read
 * it in the patch and send it in, or hold the handle in a module-level
 * variable that is never reassigned.
 *
 * Inlets
 *   0  mode 0..4 (bare int, straight off `live.tab`); `bang` re-emits
 *   1  tempo in BPM (bare float or int)
 *   2  time-signature numerator (bare int); `list` takes `3 4`
 *   3  time-signature denominator (bare int)
 *   4  transport `is_playing` (bare int 0/1, off the `live.observer`)
 *   5  OSC from `udpreceive` — see GATE below
 *
 * Outlets
 *   0  raw MIDI bytes for `midiout` (status, pitch, velocity), sent only
 *      when what should be sounding CHANGES; a bang re-sends.
 *   1  the chosen pattern number 1..4, for the `live.numbox` display.
 *
 * Replaces `midiformat` + `midiflush` (2026-09-17). Those kept their own
 * record of what was held, beside this file's — two accounts of one fact,
 * which could and did disagree. `held` below is now the only one. The
 * teardown flush `midiflush` was also providing is `notifydeleted()`,
 * which matters: a device deleted (or this script reloaded by `autowatch`)
 * with a note held would otherwise leave Skaka shaking with nothing left
 * to stop it.
 */

autowatch = 1;
inlets = 6;
outlets = 2;

setinletassist(0, 'mode 0-4 (live.tab); bang re-emits');
setinletassist(1, 'tempo (BPM)');
setinletassist(2, 'signature numerator (or list: 3 4)');
setinletassist(3, 'signature denominator');
setinletassist(4, 'transport is_playing (0/1)');
setinletassist(5, 'OSC in (udpreceive)');
setoutletassist(0, 'raw MIDI bytes -> midiout');
setoutletassist(1, 'pattern 1-4 (display)');

/**
 * The tempo/meter table, tried IN ORDER — the first rule whose every
 * stated clause matches wins, so the most specific rule is first.
 *
 * `meters` limits a rule to those time signatures. `min` is "above N"
 * and `max` is "below N", both EXCLUSIVE, matching how the rule is
 * spoken. A rule with neither bound is the catch-all.
 *
 * Duplicated rather than read from the project's config because this
 * device lives in the User Library, outside the repo — a path back to
 * the checkout would break on any machine that laid the repo out
 * differently. If the two ever need to be one, the patch should read the
 * file and send the table in, the same way it sends the tempo.
 */
var RULES = [
    { meters: ['3/4', '6/4'], min: 160, pattern: 4 },
    { max: 110, pattern: 1 },
    { max: 130, pattern: 2 },
    { pattern: 3 }
];

/** Fallback when no rule matches at all — the table's catch-all should
 *  make this unreachable, but a hand-edited table might not have one. */
var DEFAULT_PATTERN = 3;

// --- MIDI ------------------------------------------------------------------

/** 1-based MIDI channel the pattern note goes out on. */
var CHANNEL = 1;
var NOTE_ON = 0x90;
var NOTE_OFF = 0x80;
var VELOCITY = 127;

/** Skaka selects its pattern by pitch, counting from zero. */
function pitchForPattern(pattern) {
    return pattern - 1;
}

// --- gate ------------------------------------------------------------------

/**
 * GATE — the Permute mute lane, over OSC from the surface.
 *
 *   /looping/permute/gate <trackIndex:int> <open:int 0|1>
 *
 * `open` 0 mutes (release the held note), 1 sounds. `trackIndex` is
 * matched against `myTrack` when the patch has told us one; until then
 * every gate message is ours, which is the right default for the single
 * metronome rack this device was written for.
 *
 * **Fail-open.** A dropped `open` datagram would leave the metronome
 * silent for the rest of a class, which is the one failure here that
 * actually costs something. So the gate opens itself if nothing has
 * arrived for GATE_TIMEOUT_MS, and the surface re-sends the current
 * state on a slow heartbeat so a drop self-corrects long before that.
 * With no surface running at all the gate simply stays open.
 */
var GATE_ADDRESS = '/looping/permute/gate';
var GATE_TIMEOUT_MS = 2500;

var gateOpen = true;
var myTrack = -1;
var gateWatchdog = null;

/** A gate message landed: hold it, and restart the fail-open timer. */
function gateHeard(open) {
    gateOpen = !!open;
    if (gateWatchdog === null) {
        gateWatchdog = new Task(gateLapsed, this);
    }
    gateWatchdog.cancel();
    gateWatchdog.schedule(GATE_TIMEOUT_MS);
    emit(false);
}

/** Nothing from the surface for GATE_TIMEOUT_MS: sound, don't sulk. */
function gateLapsed() {
    if (gateOpen) return;
    gateOpen = true;
    emit(false);
}

// --- state -----------------------------------------------------------------

var mode = 0;
var tempo = 120;
var numerator = 4;
var denominator = 4;
var playing = false;

/** The pitch currently sounding, or -1 for silence. The ONLY record of
 *  what is held — `midiflush` used to keep a second one. */
var held = -1;

/** The pattern the tempo and meter ask for. */
function autoPattern() {
    var meter = numerator + '/' + denominator;
    for (var i = 0; i < RULES.length; i++) {
        var rule = RULES[i];
        if (rule.meters && rule.meters.indexOf(meter) === -1) continue;
        if (rule.min !== undefined && !(tempo > rule.min)) continue;
        if (rule.max !== undefined && !(tempo < rule.max)) continue;
        return rule.pattern;
    }
    return DEFAULT_PATTERN;
}

/** The pattern for the current inputs: forced by the mode, or automatic. */
function chosen() {
    return mode === 0 ? autoPattern() : mode;
}

/** The pitch that should be sounding right now, or -1 for silence. The
 *  transport and the gate are equals here: either one closed is silence. */
function wanted() {
    if (!playing || !gateOpen) return -1;
    return pitchForPattern(chosen());
}

function sendNote(status, pitch, velocity) {
    outlet(0, status | (CHANNEL - 1));
    outlet(0, pitch);
    outlet(0, velocity);
}

/**
 * Bring what is sounding into line with what should be. Off always
 * before on, so Skaka is never handed two held notes; a pattern change
 * while the gate is shut therefore writes nothing at all, and the new
 * pattern arrives with the note that opens the gate again.
 *
 * `force` re-sends even when nothing moved — for `live.thisdevice` on
 * load, which needs the downstream device to hear the note it is
 * already holding in our own bookkeeping.
 */
function emit(force) {
    var want = wanted();
    if (!force && want === held) return;
    if (held >= 0) {
        sendNote(NOTE_OFF, held, 0);
        held = -1;
    }
    if (want >= 0) {
        sendNote(NOTE_ON, want, VELOCITY);
        held = want;
    }
    outlet(1, chosen());
}

// --- inputs ----------------------------------------------------------------

function msg_int(v) {
    switch (inlet) {
        case 0:
            // Clamp rather than reject: a tab with a different state
            // count wired in should degrade to a valid mode, not go
            // silent. 0 is auto; 1..4 force.
            mode = v < 0 ? 0 : (v > 4 ? 4 : v);
            break;
        case 1:
            tempo = v;
            break;
        case 2:
            if (v > 0) numerator = v;
            break;
        case 3:
            if (v > 0) denominator = v;
            break;
        case 4:
            playing = v !== 0;
            break;
        default:
            return;
    }
    emit(false);
}

function msg_float(v) {
    // Only the tempo is genuinely fractional; for the rest a float is
    // a patching accident, so round it into the int path rather than
    // letting `mode` become 2.5 and match nothing.
    if (inlet === 1) {
        tempo = v;
        emit(false);
        return;
    }
    msg_int(Math.round(v));
}

/** `list` on inlet 2 accepts the meter as one message: `3 4`. */
function list() {
    var a = arrayfromargs(arguments);
    if (inlet === 2 && a.length >= 2) {
        if (a[0] > 0) numerator = Math.round(a[0]);
        if (a[1] > 0) denominator = Math.round(a[1]);
        emit(false);
    }
}

/**
 * OSC off `udpreceive`, which hands the address over as the message
 * name. Anything that is not our address is someone else's traffic on
 * this port and is ignored in silence.
 */
function anything() {
    if (messagename !== GATE_ADDRESS) return;
    var a = arrayfromargs(arguments);
    if (a.length < 2) return;
    var track = Math.round(a[0]);
    if (myTrack >= 0 && track !== myTrack) return;
    gateHeard(Math.round(a[1]) !== 0);
}

/**
 * The track this device sits on, from the path the patch already resolves
 * for the Utility mute (`zl nth 4` of `path live_set tracks N devices`).
 * Until it is set, every gate message is ours — right for the single
 * metronome rack, and the only safe default besides.
 *
 * A non-number means that path's shape changed under us. Say so once:
 * the silent consequence is a gate that matches nothing and a metronome
 * that never mutes, which looks like the wire being dead.
 */
function track(v) {
    var n = Math.round(v);
    if (isNaN(n)) {
        post('skaka_pattern_pick: ignoring non-numeric track ' + v +
             ' — gate accepts every track\n');
        return;
    }
    myTrack = n;
}

/** Re-send the current choice — for `live.thisdevice` bang on load, and
 *  any time the patch wants the downstream device refreshed. */
function bang() {
    emit(true);
}

/**
 * The teardown flush `midiflush` used to provide. Called when the object
 * is freed: the device deleted, the set closed, or this script reloaded
 * by `autowatch`. Without it a held note outlives the thing that sent
 * it and Skaka shakes on with nothing left to stop it.
 */
function notifydeleted() {
    if (held >= 0) {
        sendNote(NOTE_OFF, held, 0);
        held = -1;
    }
    if (gateWatchdog !== null) {
        gateWatchdog.cancel();
        gateWatchdog = null;
    }
}

/** Report the current inputs and what is sounding, to the Max console. */
function state() {
    post('skaka_pattern_pick: mode=' + mode + ' tempo=' + tempo +
         ' meter=' + numerator + '/' + denominator +
         ' playing=' + playing + ' gate=' + (gateOpen ? 'open' : 'shut') +
         ' track=' + myTrack +
         ' -> pattern ' + chosen() + ', holding ' + held + '\n');
}
