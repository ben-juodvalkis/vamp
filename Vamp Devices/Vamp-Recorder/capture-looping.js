// capture-looping.js — capture engine for the Looping variant.
//
// Runs inside [v8 capture-looping.js] in looping-recorder.amxd. Writes a
// WAV to disk on command, drives LED feedback, and broadcasts state over
// OSC. Does NOT create tracks, insert Simplers, or swap samples —
// that's the Looping Python surface's job, triggered by /capture/file.
//
// State machine: idle ↔ recording (no quantization, no beat sync).
//
// Presence: /capture/hello once a second from the moment the script loads,
// /capture/bye when the device is deleted. The bridge greys REC out, saying
// why, while it hears no hello (interface/bridge/handlers/captureRecorder.js).
//
// Outlets:
//   0: LED OSC out  (/looping/capture/led <pedal> <state>)  → udpsend :11012
//   1: UI state out (/capture/state | file | error | hello | bye) → udpsend :11017

autowatch = 1;
inlets = 1;
outlets = 2;

// ─── LED state constants ────────────────────────────────────────────────────

const LED_OFF = 0;
const LED_GREEN = 1;
const LED_RED = 3;
const RECORD_PEDAL = 6;

// ─── state ──────────────────────────────────────────────────────────────────

let recorder = null;               // cached [sfrecord~] handle
let captureState = "idle";         // "idle" | "recording"
let lastFilePath = "";

// Resolved at arm time, cached for this capture.
let projectPath = "";

// Where an unsaved set records: Live's temp project for it, which the bridge
// finds and sends as /capture/folder just before every /capture/start. Max JS
// can neither list Live's temporary folder portably nor read the config.
let unsavedSetFolder = "";

// Filename prefix for captures landing alongside the .als. Lets the user
// (and Live's File Manager) distinguish loop captures from Live's own
// auto-recordings or arbitrary samples that happen to live in the project
// folder. Sorts/filters cleanly on case-sensitive filesystems too.
const CAPTURE_FILENAME_PREFIX = "LOOPING_CAPTURE_";

// Deferred init — LiveAPI isn't ready at parse time in v8.
const initTask = new Task(deferredInit);

const HELLO_INTERVAL_MS = 1000;
const helloTask = new Task(sayHello);

// ─── init ───────────────────────────────────────────────────────────────────

doInit();

function doInit() {
    post("[init] capture-looping.js loaded\n");
    recorder = patcher.getnamed("recorder");
    if (!recorder) {
        post("[init] WARN: sfrecord~ named 'recorder' not found; " +
             "will retry on first arm\n");
    }
}

function loadbang() {
    if (!recorder) recorder = patcher.getnamed("recorder");
    initTask.schedule(100);
    if (!helloTask.running) {
        helloTask.interval = HELLO_INTERVAL_MS;
        helloTask.repeat();
    }
}

function deferredInit() {
    // A fresh device is idle: say so, so a client that last saw a
    // recording (a device deleted mid-take) lets go of it.
    broadcastState();
}

function sayHello() {
    outlet(1, "/capture/hello");
}

// Max calls this as the device is deleted (or the set closes). Best effort:
// the bridge's silence timeout covers a bye that never leaves.
function notifydeleted() {
    helloTask.cancel();
    outlet(1, "/capture/bye");
}

// Called by `init` message from the patch.
function init() { doInit(); }

// Every /capture/* message arrives here as well, straight from OSC-route
// with its arguments (the [sel] path drops them): /folder is the one that
// carries data. The commands also reach start()/stop()/... through [sel],
// so they are ignored here.
const ROUTED_COMMANDS = ["/arm", "/disarm", "/start", "/stop", "/query"];

function anything() {
    const args = arrayfromargs(arguments);
    if (messagename === "/folder") {
        unsavedSetFolder = args.length > 0 ? String(args[0]) : "";
        return;
    }
    if (ROUTED_COMMANDS.indexOf(messagename) >= 0) return;
    post(`[rx] unexpected: messagename='${messagename}' args=${JSON.stringify(args)}\n`);
}

// ─── project path resolution ───────────────────────────────────────────────

// Resolve the capture folder for THIS recording. Called at arm time so a
// save-as between captures is picked up.
//
// Policy: always the current set's own project folder, saved or not.
//   - Saved set → <set_dir> (the project root, alongside the .als)
//                 We deliberately don't write into <set_dir>/Samples/Recorded
//                 because sfrecord~ silently no-ops when the parent
//                 directory is missing, and Max v8 JS has no portable
//                 mkdir. Project root always exists (Live created it on
//                 save), so the open always succeeds. Filenames carry a
//                 LOOPING_CAPTURE_ prefix so they're easy to filter and
//                 distinguish from Live's own recordings — see
//                 CAPTURE_FILENAME_PREFIX.
//   - Unsaved   → Live's temp project for the set, as the bridge last named
//                 it (/capture/folder). Its root exists for the same reason.
// Leaves projectPath "" when there is nowhere to record; start() refuses.
function refreshProjectPath() {
    let alsPath = "";
    try {
        const liveSet = new LiveAPI("live_set");
        if (liveSet && liveSet.id !== "0") {
            const raw = liveSet.get("file_path");
            alsPath = (raw && raw.length > 0) ? String(raw[0]) : "";
        }
    } catch (e) {
        post(`[path] file_path read raised: ${e.message}\n`);
    }
    if (alsPath) {
        const lastSlash = alsPath.lastIndexOf("/");
        projectPath = (lastSlash > 0) ? alsPath.substring(0, lastSlash) : alsPath;
    } else {
        projectPath = unsavedSetFolder;
    }
    post(`[path] capture dir: ${projectPath || "(none)"}\n`);
}

// ─── OSC command handlers ──────────────────────────────────────────────────

// /capture/start and /capture/arm are synonyms; same for stop/disarm.

function start() {
    if (captureState === "recording") return;
    refreshProjectPath();
    if (!projectPath) {
        // The UI painted "recording" the moment it sent start; the error and
        // an idle state let it go.
        broadcastError("no-project-folder", "the set is unsaved and Live's temp project was not found");
        broadcastState();
        return;
    }
    startRecording();
}
function arm() { start(); }

function stop() {
    if (captureState !== "recording") return;
    stopRecording();
}
function disarm() { stop(); }

function query() {
    broadcastState();
    if (lastFilePath) broadcastFile(lastFilePath);
}

// ─── manual UI support (device's own live.toggle + footswitch) ─────────────
//
// Not part of the OSC contract, but useful for testing the device in
// isolation. The .amxd routes live.toggle through `prepend record`, and
// the footswitch through a bang.

function record(value) {
    if (value === 1) start();
    else stop();
}

function bang() {
    record(captureState === "recording" ? 0 : 1);
}

// ─── recording control ─────────────────────────────────────────────────────

function startRecording() {
    if (!recorder) {
        recorder = patcher.getnamed("recorder");
        if (!recorder) {
            broadcastError("sfrecord-missing", "no [sfrecord~ @name recorder] in patch");
            broadcastState();
            return;
        }
    }
    const filename = `${CAPTURE_FILENAME_PREFIX}${formatTimestamp(new Date())}.wav`;
    lastFilePath = `${projectPath}/${filename}`;

    // sfrecord~ silently no-ops if the parent directory doesn't exist.
    // We write into a project root (the saved set's, or Live's temp
    // project), which Live itself created, so this should never silently
    // fail in practice. If it ever does, Python's replace_sample will
    // surface a typed "valid audio file" error rather than leaving the
    // user staring at a stuck red LED.
    recorder.message("open", lastFilePath);
    recorder.message(1);

    captureState = "recording";
    post(`[record] started: ${lastFilePath}\n`);
    sendLedState(LED_GREEN);
    broadcastState();
}

function stopRecording() {
    recorder.message(0);
    captureState = "idle";
    post(`[record] stopped: ${lastFilePath}\n`);
    sendLedState(LED_OFF);
    broadcastState();
    broadcastFile(lastFilePath);
}

// ─── LED output (outlet 0 → udpsend :11012) ────────────────────────────────

function sendLedState(state) {
    outlet(0, "/looping/capture/led", RECORD_PEDAL, state);
}

// ─── OSC state broadcasts (outlet 1 → udpsend :11017) ──────────────────────

function broadcastState() {
    outlet(1, "/capture/state", captureState);
}

function broadcastFile(filePath) {
    outlet(1, "/capture/file", filePath);
}

function broadcastError(code, detail) {
    outlet(1, "/capture/error", code, detail || "");
    post(`[error] ${code}: ${detail}\n`);
}

// ─── helpers ───────────────────────────────────────────────────────────────

// YYYYMMDD_HHMMSS — matches the Simpler-Record standalone convention so
// filenames are consistent across both devices.
function formatTimestamp(d) {
    const pad = n => String(n).padStart(2, "0");
    return (
        d.getFullYear().toString() +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) + "_" +
        pad(d.getHours()) +
        pad(d.getMinutes()) +
        pad(d.getSeconds())
    );
}

// Explicit loadbang at script end — mirrors the pattern in
// capture-engine.js; ensures init fires even if Max's auto-loadbang
// misbehaves inside a v8 object.
loadbang();
