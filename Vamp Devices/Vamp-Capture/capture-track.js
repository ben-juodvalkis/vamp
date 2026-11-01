// capture-track.js: the capture engine for Vamp-Capture.amxd.
//
// One of these sits at the end of each track Vamp has captured from
// (capture.plan.md, option 1). It records what the track plays, or what the
// audio interface's input brings in through the device's extra input, into
// a WAV, and says where it put it. The surface turns that file into a
// Simpler, as with the old Return A recorder.
//
// Many copies share one set and one command port, so every command is
// for one track: `/capture/start` names it, or means the selected track
// when it does not. A copy on any other track ignores it.
//
// Commands in (udpreceive 11023, through OSC-route /capture; the old
// Return A recorder's 11016 hears nothing now):
//   /folder <path>                    where an unsaved set records
//   /start [track] [source] [channel] track: Live's track index, -1 or
//                                     absent for the selected track;
//                                     source: "track" | "input", absent
//                                     for the device's own switch;
//                                     channel: Ext. In's channel name
//                                     ("1/2", "3", ...), absent to keep it
//   /stop                             whichever copy is recording stops
//   /arm, /disarm                     /start, /stop
//   /query                            the selected track's copy answers
//
// Replies out (udpsend 11017): /capture/state | file | error | hello | bye,
// and /capture/meter while recording (the patch sends that one). LED
// state goes to udpsend 11012.
//
// Outlets:
//   0: LED OSC   (/looping/capture/led <pedal> <state>)
//   1: replies   (/capture/...)
//   2: source    0 idle, 1 the track, 2 the extra input: the patch's
//                selector~s and its meter gate
//   3: the input menu (umenu messages)
//
// LiveAPI handles are made once and re-pointed, never dropped: a dropped
// handle's GC finalizer calls into Live and aborts it.

autowatch = 1;
inlets = 1;
outlets = 4;

const LED_OFF = 0;
const LED_GREEN = 1;
const RECORD_PEDAL = 6;

const SOURCE_IDLE = 0;
const SOURCE_TRACK = 1;
const SOURCE_INPUT = 2;

// Live's name for the audio interface in an input routing list.
const EXT_IN = "Ext. In";
const NO_INPUT = "No Input";

const CAPTURE_FILENAME_PREFIX = "LOOPING_CAPTURE_";
const HELLO_INTERVAL_MS = 1000;

let recorder = null;             // [sfrecord~ 2], scripting name "recorder"
let sourceTab = null;            // [live.tab] Track | Input, scripting name "source"
let recButton = null;            // [live.text] REC, scripting name "Capture Record"
let capturing = false;
let lastFilePath = "";
let unsavedSetFolder = "";

// Long-lived handles (see the header).
let selfApi = null;              // this_device
let lookApi = null;              // re-pointed for one-off reads
let inputApi = null;             // this_device audio_inputs <n>, the extra input

const helloTask = new Task(sayHello);

// Set up once Live can answer for this device. Right after a load from the
// browser it cannot yet (measured 2026-10-31: `get: no valid object set`
// 40 ms after load_item returned), so setup retries until it can.
const BOOT_RETRY_MS = 100;
const BOOT_TRIES = 50;
const bootTask = new Task(init);
let bootTries = 0;
let isReady = false;

// ─── load ───────────────────────────────────────────────────────────────────

// [live.thisdevice] bangs `init` once Live has the device, and the script
// schedules it too (an autowatch reload gets no bang). Safe to call twice.
function init() {
    recorder = patcher.getnamed("recorder");
    sourceTab = patcher.getnamed("source");
    recButton = patcher.getnamed("Capture Record");
    if (!selfApi) selfApi = new LiveAPI("this_device");
    else selfApi.path = "this_device";
    if (!lookApi) lookApi = new LiveAPI("live_set");
    const answered = Number(selfApi.id) !== 0
        && /^live_set /.test(String(selfApi.unquotedpath))
        && selfApi.getcount("audio_inputs") > 0;
    if (!answered) {
        if (bootTries++ < BOOT_TRIES) bootTask.schedule(BOOT_RETRY_MS);
        else post("[init] Live never answered for this device\n");
        return;
    }
    const inputPath = extraInputPath();
    if (!inputApi) inputApi = new LiveAPI(inputPath);
    else inputApi.path = inputPath;
    isReady = true;
    // Setup runs again when Live's bang comes after the retry already set
    // up and a capture started: closing the tap then silenced the take
    // ~100 ms in (Ben, 2026-10-31).
    if (!capturing) outlet(2, SOURCE_IDLE);
    fillInputMenu();
    broadcastState();
    // The bridge waits for this hello to start a capture it loaded us for.
    sayHello();
    if (!helloTask.running) {
        helloTask.interval = HELLO_INTERVAL_MS;
        helloTask.repeat();
    }
}

// Every entry point sets up first if it has to.
function ready() {
    if (!isReady) init();
    return isReady;
}

// The extra input is the last of the device's audio inputs ([plugin~ 3 4]).
function extraInputPath() {
    return `this_device audio_inputs ${selfApi.getcount("audio_inputs") - 1}`;
}

function sayHello() {
    if (isReady) outlet(1, "/capture/hello", ownTrackIndex());
}

function notifydeleted() {
    helloTask.cancel();
    if (capturing && recorder) recorder.message(0);
    outlet(1, "/capture/bye");
}

// ─── which track ────────────────────────────────────────────────────────────

// "live_set tracks 3" from any path under it (a rack's chain included), or
// "" for a return or the master, which Capture never targets.
function trackOf(path) {
    const m = /^live_set tracks (\d+)/.exec(String(path).replace(/"/g, ""));
    return m ? `live_set tracks ${m[1]}` : "";
}

function ownTrack() {
    return selfApi ? trackOf(selfApi.unquotedpath) : "";
}

function ownTrackIndex() {
    const t = ownTrack();
    return t ? Number(t.split(" ")[2]) : -1;
}

function selectedTrack() {
    lookApi.path = "live_set view selected_track";
    return trackOf(lookApi.unquotedpath);
}

function isForMe(trackIndex) {
    const mine = ownTrack();
    if (!mine) return false;
    const target = (trackIndex === undefined || trackIndex < 0)
        ? selectedTrack()
        : `live_set tracks ${trackIndex}`;
    return target === mine;
}

// ─── commands ───────────────────────────────────────────────────────────────

function anything() {
    if (!ready()) return;
    const args = arrayfromargs(arguments);
    switch (messagename) {
    case "/folder":
        unsavedSetFolder = args.length > 0 ? String(args[0]) : "";
        return;
    case "/start":
    case "/arm":
        if (!isForMe(args.length > 0 ? Number(args[0]) : -1)) return;
        start(args[1], args[2]);
        return;
    case "/stop":
    case "/disarm":
        stop();
        return;
    case "/query":
        if (!isForMe(-1)) return;
        broadcastState();
        if (lastFilePath) outlet(1, "/capture/file", lastFilePath);
        return;
    default:
        post(`[rx] unexpected ${messagename} ${JSON.stringify(args)}\n`);
    }
}

// The device's own REC button and the Track | Input switch.
function record(on) {
    if (!ready()) return;
    if (on) start(); else stop();
}

// Input puts the extra input on Ext. In, keeping its channel if it is
// there already.
function source(index) {
    if (!ready()) return;
    if (index === 1) routeExtraInputTo("");
    if (capturing) outlet(2, index === 1 ? SOURCE_INPUT : SOURCE_TRACK);
}

// The input menu: an Ext. In channel, by its name. While the extra input is
// on something else the menu holds only that name, which is not a channel.
function channel() {
    if (!ready()) return;
    const name = arrayfromargs(arguments).join(" ");
    const type = readOne(inputApi, "routing_type");
    if (name && type && type.display_name === EXT_IN) routeExtraInputTo(name);
}

// ─── recording ──────────────────────────────────────────────────────────────

function start(sourceName, channelName) {
    if (capturing) return;
    if (!recorder) recorder = patcher.getnamed("recorder");
    if (!recorder) {
        broadcastError("sfrecord-missing", "no [sfrecord~] named recorder in the patch");
        broadcastState();
        return;
    }
    const folder = captureFolder();
    if (!folder) {
        broadcastError("no-project-folder", "the set is unsaved and Live's temp project was not found");
        broadcastState();
        return;
    }
    let useInput = sourceTab ? sourceTab.getvalueof() == 1 : false;
    if (sourceName === "input") useInput = true;
    if (sourceName === "track") useInput = false;
    if (useInput) routeExtraInputTo(channelName ? String(channelName) : "");

    lastFilePath = `${folder}/${CAPTURE_FILENAME_PREFIX}${timestamp(new Date())}.wav`;
    // sfrecord~ is silent if the folder is missing; the project root always
    // exists (Live made it), and the surface's load reports a bad file.
    recorder.message("open", lastFilePath);
    outlet(2, useInput ? SOURCE_INPUT : SOURCE_TRACK);
    recorder.message(1);
    capturing = true;
    outlet(0, "/looping/capture/led", RECORD_PEDAL, LED_GREEN);
    broadcastState();
}

function stop() {
    if (!capturing) return;
    recorder.message(0);
    outlet(2, SOURCE_IDLE);
    capturing = false;
    outlet(0, "/looping/capture/led", RECORD_PEDAL, LED_OFF);
    broadcastState();
    outlet(1, "/capture/file", lastFilePath);
}

// A saved set records beside its .als, read now so a save-as between
// captures counts; an unsaved one into the temp project the bridge named.
function captureFolder() {
    lookApi.path = "live_set";
    const raw = lookApi.get("file_path");
    const als = raw && raw.length > 0 ? String(raw[0]) : "";
    if (!als) return unsavedSetFolder;
    const slash = als.lastIndexOf("/");
    return slash > 0 ? als.substring(0, slash) : als;
}

// ─── the extra input ────────────────────────────────────────────────────────

// Live hands routing lists back as JSON text, keyed by the property's name.
function readList(api, prop) {
    try {
        const parsed = JSON.parse(api.get(prop).join(" "));
        return parsed[prop] || [];
    } catch (e) {
        return [];
    }
}

function readOne(api, prop) {
    try {
        return JSON.parse(api.get(prop).join(" "))[prop] || null;
    } catch (e) {
        return null;
    }
}

// Point the extra input at Ext. In, on the named channel ("" keeps the
// channel it is on, or takes Live's first real one). Live saves the device's
// routing with the set, so this is also where the choice is kept.
function routeExtraInputTo(channelName) {
    const extIn = readList(inputApi, "available_routing_types")
        .find(t => t.display_name === EXT_IN);
    if (!extIn) {
        broadcastError("no-ext-in", "Live offers no Ext. In to this device's extra input");
        return;
    }
    const current = readOne(inputApi, "routing_type");
    if (!current || current.identifier !== extIn.identifier) {
        inputApi.set("routing_type", { identifier: extIn.identifier });
    }
    const channels = readList(inputApi, "available_routing_channels");
    const channelNow = readOne(inputApi, "routing_channel");
    if (!channelName && (!channelNow || channelNow.display_name === NO_INPUT)) {
        const first = channels.find(c => c.display_name !== NO_INPUT);
        if (first) channelName = first.display_name;
    }
    if (channelName) {
        const ch = channels.find(c => c.display_name === channelName);
        if (!ch) {
            broadcastError("no-input-channel", `Ext. In has no channel ${channelName}`);
        } else {
            inputApi.set("routing_channel", { identifier: ch.identifier });
        }
    }
    fillInputMenu();
}

// The menu lists Ext. In's channels while the extra input is on Ext. In,
// and shows what it is on otherwise (another track, say).
function fillInputMenu() {
    if (!inputApi) return;
    const type = readOne(inputApi, "routing_type");
    const channelNow = readOne(inputApi, "routing_channel");
    outlet(3, "clear");
    if (!type || type.display_name !== EXT_IN) {
        outlet(3, "append", type ? type.display_name : "—");
        outlet(3, "set", 0);
        return;
    }
    const channels = readList(inputApi, "available_routing_channels");
    channels.forEach(c => outlet(3, "append", c.display_name));
    const at = channels.findIndex(c => channelNow && c.identifier === channelNow.identifier);
    outlet(3, "set", Math.max(at, 0));
}

// ─── replies ────────────────────────────────────────────────────────────────

// The REC button follows the recorder, whoever started or stopped it
// (`set` changes it without sending it on).
function broadcastState() {
    if (recButton) recButton.message("set", capturing ? 1 : 0);
    outlet(1, "/capture/state", capturing ? "recording" : "idle");
}

function broadcastError(code, detail) {
    outlet(1, "/capture/error", code, detail || "");
    post(`[error] ${code}: ${detail}\n`);
}

// YYYYMMDD_HHMMSS, as the old recorder named its files.
function timestamp(d) {
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" +
        pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

// The first setup try; it repeats until Live answers.
bootTask.schedule(BOOT_RETRY_MS);
