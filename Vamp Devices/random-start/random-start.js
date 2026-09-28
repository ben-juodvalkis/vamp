// random-start.js — pre-Simpler note offset utility.
//
// Lives inside [v8 random-start.js] in random-start.amxd. The device sits
// just before a Simpler on a MIDI track and randomizes the Simpler's
// "Sample Start" parameter on each note-on, so successive triggers play
// from different points in the sample.
//
// Timing model — "prepare next note" (no critical-path delay):
//   On note-on, the MIDI passes through unchanged (the patch routes
//   notein → midiout directly). After the note has fired, this script
//   writes a fresh randomized offset to Simpler's Sample Start. That
//   write lands BEFORE the next note's voice allocation, so the
//   randomization applies to note N+1, not note N. Note N itself plays
//   at whatever offset note N-1 set up (or `baseStart` for the very
//   first note after load).
//
// Note-off is intentionally a no-op. An earlier version snapped the param
// back to baseStart on note-off for cosmetic reasons (slider visually calm
// between notes), but that overwrote the prepared random value before the
// next note-on could read it — every note then played at baseStart and
// the offset was inaudible. Slider now rests at the last randomized value
// between notes; correctness over cosmetics.
//
// Drift control — always offset from base, never compounding:
//   `baseStart` is the user-dialed-in Sample Start. Every randomized
//   write is `baseStart + r * amount * (1 - baseStart)` where r∈[0,1).
//
// External base updates:
//   We observe the target param. When the listener fires with a value
//   that doesn't match what we just wrote (within SELF_WRITE_TOLERANCE),
//   it's a user/external change → update `baseStart`.
//
// ─── Patch wiring (do this once in Max) ─────────────────────────────────────
//
//   [live.thisdevice]──┐
//   [loadbang]─────────┼─→ [v8 random-start.js]
//                      │
//   [live.numbox @parameter_longname "Random Amount"   ──→ "amount $1"   ──┘
//                @_parameter_range 0. 100.
//                @_parameter_unitstyle 1     // %
//                @_parameter_initial 50.
//                @_parameter_initial_enable 1]
//
//   [live.text   @parameter_longname "Bypass"          ──→ "bypass $1"   ──┘
//                @text "Bypass"
//                @mode 1                      // toggle
//                @_parameter_initial 0
//                @_parameter_initial_enable 1]
//
//   [notein]   ──→ [t i i] ──→ [midiout]              (passthrough — never delay)
//                       └────→ "note $1" → [v8]      (trigger for next-note prep)
//
//   Device chain: place this device BEFORE Simpler on a MIDI track.
//   The script resolves the next device automatically via this_device →
//   canonical_parent walk; no manual target wiring needed.
//
// ─── Logging ────────────────────────────────────────────────────────────────
//
//   All output is structured: `[<level>][<tag>] message key=val key=val`
//
//   Levels: DEBUG=0, INFO=1, WARN=2, ERROR=3, NONE=4 (default — silent).
//   Send `loglevel <0..4>` or `loglevel debug|info|warn|error|none` to the
//   v8 inlet to change at runtime. Send `dump` to print a full state report.
//   Tags: init, resolve, walk, observer, base, note, write, bypass, ctrl, rx.
//   Outlet mirror only fires for INFO and above; DEBUG is console-only.
//
// ─── Outlets ────────────────────────────────────────────────────────────────
//   0: status messages — "resolved", "unresolved", "base", "wrote",
//                        "bypass", "log <level> <tag> ..."
//      Wire to [print rs] for a Max-console mirror, or to [route ...] to
//      drive UI feedback.

autowatch = 1;
inlets = 1;
outlets = 1;

// Parse-time sanity ping — proves the file was found, parsed, and is running.
// If you don't see this in the Max Console after editing the device, the v8
// object never loaded the script (wrong filename / wrong folder / syntax
// error above this line). Open the Max Console via Window → Max Console.
post("[BOOT] random-start.js parse-time hello — script file found & parsed\n");

// ─── tunables ───────────────────────────────────────────────────────────────

const SELF_WRITE_TOLERANCE = 1e-4;       // normalized 0–1 param space
const SAMPLE_START_PARAM_NAME = "Sample Start";
const SAMPLE_START_FALLBACK_INDEX = 3;   // Simpler Classic-mode quirk; see project memory
// Simpler's LOM class_name is `OriginalSimpler` (per data/CLAUDE.md device-
// configs map). We scan forward from this device looking for the first
// matching device — that lets users place utility devices (EQ, etc.)
// between Random Start and the Simpler without breaking the lock.
const SIMPLER_CLASS_NAMES = ["OriginalSimpler"];

// ─── logging ────────────────────────────────────────────────────────────────
//
// Call-site gating: every log call is wrapped in `if (DBG)` / `if (INF)` /
// `if (WRN)` so we never allocate the `kv` object literal at runtime when the
// level is suppressed. Flip `logLevel` via the `loglevel` message.

const LOG = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 };
const LOG_NAMES = ["DEBUG", "INFO", "WARN", "ERROR", "NONE"];
let logLevel = LOG.NONE;                 // off by default; raise via `loglevel debug|info|warn|error`
let DBG = false, INF = false, WRN = false, ERR = false;
function recomputeLogGates() {
    DBG = LOG.DEBUG >= logLevel;
    INF = LOG.INFO  >= logLevel;
    WRN = LOG.WARN  >= logLevel;
    ERR = LOG.ERROR >= logLevel;
}
recomputeLogGates();

function fmtKV(kv) {
    if (!kv) return "";
    const parts = [];
    for (const k in kv) {
        if (!kv.hasOwnProperty(k)) continue;
        const v = kv[k];
        let s;
        if (v === null || v === undefined) s = String(v);
        else if (typeof v === "number") s = Number.isInteger(v) ? String(v) : v.toFixed(4);
        else if (typeof v === "string") s = v.indexOf(" ") >= 0 ? `"${v}"` : v;
        else s = JSON.stringify(v);
        parts.push(`${k}=${s}`);
    }
    return parts.length ? " " + parts.join(" ") : "";
}

function emit(level, tag, msg, kv) {
    post(`[${LOG_NAMES[level]}][${tag}] ${msg}${fmtKV(kv)}\n`);
    // INFO and above also mirror to outlet 0 for a [route log] tap.
    // DEBUG is console-only — it would flood the Max graph at debug level.
    if (level >= LOG.INFO) {
        try { outlet(0, "log", LOG_NAMES[level], tag, msg); } catch (e) {}
    }
}

const logd = (tag, msg, kv) => { if (DBG) emit(LOG.DEBUG, tag, msg, kv); };
const logi = (tag, msg, kv) => { if (INF) emit(LOG.INFO,  tag, msg, kv); };
const logw = (tag, msg, kv) => { if (WRN) emit(LOG.WARN,  tag, msg, kv); };
const loge = (tag, msg, kv) => { if (ERR) emit(LOG.ERROR, tag, msg, kv); };

// ─── state ──────────────────────────────────────────────────────────────────

// `amount` and `bypass` live on the `state` object further down — Max
// dispatches messages by name, so the handler functions own those names.
let targetParam = null;                  // LiveAPI handle to Simpler's Sample Start
let targetParamId = null;                // string id, for listener identity check
let targetDeviceName = "?";              // for logs
let targetParamIdx = -1;                 // for logs / dump
let baseStart = 0;                       // user-set start position (0..1)
let lastWrittenValue = null;             // for self-write echo suppression
let paramObserver = null;                // LiveAPI listener — Sample Start value
let chainObserver = null;                // LiveAPI listener — track devices list
let parentTrackPath = null;              // cached canonical_parent path
let lockedDeviceId = null;               // device id currently locked, to skip redundant relocks
let initStarted = false;                 // guard against re-entrant init kicks

// Counters for `dump`:
const counters = {
    notesOn: 0, notesOff: 0,
    writes: 0, writeErrors: 0,
    observerFires: 0, observerSuppressed: 0, observerExternal: 0,
    chainFires: 0, resolveAttempts: 0, resolveSuccesses: 0,
};

// ─── init ───────────────────────────────────────────────────────────────────
//
// Initialization is patch-driven. [live.thisdevice]'s left outlet bangs when
// Live considers this device's API ready. We bounce that bang through a
// Task.schedule(0) before touching the LiveAPI — in practice the bang can
// arrive a tick before `new LiveAPI("this_device")` actually returns a live
// handle (id is `undefined` synchronously inside bang()). One deferred tick
// is enough; no polling, no backoff.
//
// Touching the LiveAPI before that is unsafe: wrappers exist but `id`/`path`
// are `undefined`, observer subscriptions silently bind to nothing, and
// writes raise "Live API is not initialized". We deliberately do NOT
// self-start at parse time.

let initBounces = 0;
const INIT_MAX_BOUNCES = 4;              // ~4 deferred ticks; if Live still
                                         // hasn't surfaced this_device by then,
                                         // something is really wrong.
const initTask = new Task(function () {
    if (initStarted) return;
    const me = new LiveAPI("this_device");
    if (!isLiveHandle(me)) {
        if (initBounces++ < INIT_MAX_BOUNCES) {
            if (DBG) logd("init", "this_device not live yet — bouncing", { bounce: initBounces });
            initTask.schedule(0);
        } else if (ERR) {
            loge("init", "this_device never became live after live.thisdevice bang", {
                bounces: initBounces,
            });
        }
        return;
    }
    initStarted = true;
    if (INF) logi("init", "LiveAPI ready", { thisDeviceId: String(me.id), bounces: initBounces });
    setupChainObserver();
});

function bang()     { initBounces = 0; initTask.schedule(0); }   // [live.thisdevice]
function loadbang() { initBounces = 0; initTask.schedule(0); }   // [loadbang]

// A LiveAPI handle is "live" only when it has a non-empty, non-"0" id string.
// Wrappers can exist with `undefined` id during transient states.
function isLiveHandle(api) {
    if (!api) return false;
    const id = api.id;
    return typeof id === "string" && id.length > 0 && id !== "0";
}

// ─── target resolution ──────────────────────────────────────────────────────
//
// Strategy: subscribe to the parent track's `devices` property. The listener
// fires once on subscribe (LiveAPI standard) and then again on every chain
// change — adds, removes, reorders. Each fire calls `tryResolveTarget()`,
// which is a single non-retrying attempt to lock onto the device after us.
// If the chain isn't ready yet, we just wait for the next fire. No polling.

function setupChainObserver() {
    try {
        const me = new LiveAPI("this_device");
        if (!isLiveHandle(me)) {
            if (ERR) loge("init", "this_device not available — device may not be hosted");
            return;
        }
        const parent = new LiveAPI(`id ${me.id}`);
        parent.path = "this_device canonical_parent";
        if (!isLiveHandle(parent) || typeof parent.path !== "string" || parent.path.length === 0) {
            if (ERR) loge("init", "canonical_parent not available", {
                parentId: String(parent && parent.id),
                parentPath: String(parent && parent.path),
            });
            return;
        }
        parentTrackPath = parent.path;
        if (INF) logi("init", "parent track resolved", { path: parentTrackPath });

        // Detach any previous observer (rescan path).
        if (chainObserver) {
            try { chainObserver.property = ""; } catch (e) {}
            chainObserver = null;
        }

        // Subscribe by path so the listener survives if the underlying id changes.
        chainObserver = new LiveAPI(onChainChange, parentTrackPath);
        chainObserver.property = "devices";
        if (INF) logi("init", "chain observer attached → waiting for chain events");

        // The subscribe will fire onChainChange immediately with the current
        // device list, so no manual kickoff is needed.
    } catch (e) {
        if (ERR) loge("init", "setupChainObserver raised", { msg: e.message });
    }
}

// Deferred resolve: Live forbids triggering changes from inside a listener
// callback ("Changes cannot be triggered by notifications. You will need to
// defer your response."). Constructing LiveAPI handles and writing baseStart
// via .get("value") trips that rule when invoked synchronously from
// onChainChange. Schedule(0) bounces it to the next tick where writes are
// allowed.
const resolveTask = new Task(function () { tryResolveTarget("chain-event"); });

function onChainChange(args) {
    counters.chainFires += 1;
    // Ignore id-rebind meta-events — they don't represent a chain change.
    if (args && args.length >= 1 && args[0] === "id") return;
    if (DBG) logd("chain", "fire", { args: args });
    resolveTask.schedule(0);
}

// Single attempt — no retries, no scheduling. Called from the chain observer.
function tryResolveTarget(source) {
    counters.resolveAttempts += 1;
    if (DBG) logd("resolve", "attempt", { source: source });

    try {
        const me = new LiveAPI("this_device");
        if (!isLiveHandle(me)) {
            if (DBG) logd("resolve", "this_device not ready — waiting for next chain event");
            return;
        }

        const parent = new LiveAPI(`id ${me.id}`);
        parent.path = "this_device canonical_parent";
        if (!isLiveHandle(parent) || typeof parent.path !== "string" || parent.path.length === 0) {
            if (DBG) logd("resolve", "canonical_parent not ready");
            return;
        }

        const deviceCount = parent.getcount("devices");
        if (DBG) logd("walk", "device count on track", { count: deviceCount });
        if (deviceCount <= 0) {
            if (DBG) logd("resolve", "no devices on track yet — waiting");
            return;
        }

        // Self-find: parse our own path's trailing `devices N` index instead
        // of walking the full devices list and id-matching. me.path looks
        // like `live_set tracks N devices M ...`, so the last numeric token
        // after `devices` is our index on the parent chain.
        const myIndex = indexFromDevicePath(me.path);
        if (myIndex < 0) {
            if (WRN) logw("resolve", "could not parse self index from path", { path: me.path });
            return;
        }
        if (myIndex >= deviceCount - 1) {
            if (INF) logi("resolve", "no device after self yet — waiting for one to be added",
                 { selfIdx: myIndex, count: deviceCount });
            clearTarget();
            return;
        }

        // Scan forward for the first OriginalSimpler downstream of this device.
        // Lets the user place EQs / shapers between Random Start and Simpler
        // without breaking the lock. Reuse one LiveAPI wrapper across the scan.
        let next = null;
        let nextName = "";
        let nextId = "";
        const cand = new LiveAPI(`${parent.path} devices ${myIndex + 1}`);
        for (let i = myIndex + 1; i < deviceCount; i++) {
            cand.path = `${parent.path} devices ${i}`;
            if (cand.id === "0") continue;
            const cClass = safeGetClass(cand);
            if (DBG) logd("walk", "candidate", { i: i, id: String(cand.id), class: cClass });
            if (SIMPLER_CLASS_NAMES.indexOf(cClass) >= 0) {
                next = cand;
                nextName = safeGetName(cand);
                nextId = String(cand.id);
                break;
            }
        }
        if (!next) {
            if (INF) logi("resolve", "no Simpler downstream — waiting for one to be added", {
                selfIdx: myIndex,
                count: deviceCount,
                accepted: SIMPLER_CLASS_NAMES,
            });
            clearTarget();
            return;
        }
        if (DBG) logd("walk", "matched Simpler", { id: nextId, name: nextName });

        // If we've already locked onto this exact device id, no work to do.
        if (targetParam && targetParamId && nextDeviceMatchesLocked(nextId)) {
            if (DBG) logd("resolve", "already locked to this device", { id: nextId });
            return;
        }

        // Find "Sample Start" by name; fall back to param index 3 (Classic mode).
        // Reuse a single LiveAPI wrapper across the scan — Simpler exposes ~30
        // params and allocating one wrapper per param dominates resolve cost.
        const paramCount = next.getcount("parameters");
        if (DBG) logd("walk", "param scan", { paramCount: paramCount });
        let targetIdx = -1;
        const scan = new LiveAPI(`${next.path} parameters 0`);
        for (let i = 0; i < paramCount; i++) {
            scan.path = `${next.path} parameters ${i}`;
            const nameStr = safeGetName(scan);
            if (DBG) logd("walk", "param", { i: i, name: nameStr });
            if (nameStr === SAMPLE_START_PARAM_NAME) { targetIdx = i; break; }
        }
        if (targetIdx < 0) {
            if (paramCount > SAMPLE_START_FALLBACK_INDEX) {
                targetIdx = SAMPLE_START_FALLBACK_INDEX;
                if (WRN) logw("resolve", "Sample Start not found by name; using fallback index",
                     { fallbackIdx: SAMPLE_START_FALLBACK_INDEX });
            } else {
                if (WRN) logw("resolve", "next device exposes no Sample Start — not a Simpler?",
                     { device: nextName, paramCount: paramCount });
                clearTarget();
                return;
            }
        }

        // Detach any prior param observer before swapping target.
        clearTarget();

        targetParam = new LiveAPI(`${next.path} parameters ${targetIdx}`);
        targetParamId = String(targetParam.id);
        targetParamIdx = targetIdx;
        targetDeviceName = nextName;
        lockedDeviceId = nextId;

        const v = targetParam.get("value");
        baseStart = (v && v.length > 0) ? Number(v[0]) : 0;
        lastWrittenValue = null;

        attachParamObserver();

        counters.resolveSuccesses += 1;
        if (INF) logi("resolve", "locked", {
            device: targetDeviceName,
            paramIdx: targetParamIdx,
            paramId: targetParamId,
            base: baseStart,
        });
        outlet(0, "resolved", targetParamId, baseStart);
    } catch (e) {
        if (ERR) loge("resolve", "exception", { msg: e.message, stack: e.stack || "" });
    }
}

function nextDeviceMatchesLocked(nextDeviceId) {
    return lockedDeviceId !== null && lockedDeviceId === nextDeviceId;
}

function clearTarget() {
    if (paramObserver) {
        try { paramObserver.property = ""; } catch (e) {}
        paramObserver = null;
    }
    targetParam = null;
    targetParamId = null;
    targetParamIdx = -1;
    targetDeviceName = "?";
    lastWrittenValue = null;
    lockedDeviceId = null;
}

// Parse `... devices N ...` out of a LiveAPI path. Returns -1 if not found.
// We want the LAST `devices N` token because nested racks/chains can have
// multiple — but in our case the device's own path ends at its devices index
// (no further sub-chain selectors), so last-occurrence is correct.
function indexFromDevicePath(path) {
    if (!path) return -1;
    const tokens = path.split(" ");
    for (let i = tokens.length - 2; i >= 0; i--) {
        if (tokens[i] === "devices") {
            const n = parseInt(tokens[i + 1], 10);
            return isFinite(n) ? n : -1;
        }
    }
    return -1;
}

function safeGetName(api) {
    try {
        const n = api.get("name");
        return (n && n.length > 0) ? String(n[0]) : "?";
    } catch (e) { return "?"; }
}

function safeGetClass(api) {
    try {
        const c = api.get("class_name");
        return (c && c.length > 0) ? String(c[0]) : "";
    } catch (e) { return ""; }
}

// ─── param observer ─────────────────────────────────────────────────────────

function attachParamObserver() {
    if (paramObserver) {
        try { paramObserver.property = ""; } catch (e) {}
        paramObserver = null;
    }
    paramObserver = new LiveAPI(onParamChange, `id ${targetParamId}`);
    paramObserver.property = "value";
    if (DBG) logd("observer", "attached", { paramId: targetParamId });
}

function onParamChange(args) {
    counters.observerFires += 1;

    // LiveAPI emits two flavors of message to a `value` listener:
    //   ["value", <number>]   ← the actual value change we want
    //   ["id", <number>]      ← id-rebind meta-event (ignore)
    // Some fires also arrive as a single bare number (Max passing through
    // the second slot of the "value <n>" list), so accept that too.
    if (!args) return;
    let v;
    if (args.length >= 2 && args[0] === "value") {
        v = Number(args[1]);
    } else if (args.length === 1 && typeof args[0] === "number") {
        v = Number(args[0]);
    } else {
        return;
    }
    if (!isFinite(v)) return;

    // Suppress echoes of our own writes. We track our last write in
    // lastWrittenValue (set BEFORE calling targetParam.set so synchronous
    // listener fires already see the right value).
    if (lastWrittenValue !== null &&
        Math.abs(v - lastWrittenValue) < SELF_WRITE_TOLERANCE) {
        counters.observerSuppressed += 1;
        return;
    }

    // Suppress no-op fires that match the current base (subscribe-time replay,
    // duplicate broadcasts).
    if (Math.abs(v - baseStart) < SELF_WRITE_TOLERANCE) return;

    // Late-echo bracket: if we recently wrote a randomized value above base,
    // values that fall STRICTLY BETWEEN base and that write are almost
    // certainly delayed echoes that snuck past the tolerance check. A user
    // edit landing in that narrow interval is implausible; outside it (e.g.
    // dragging the slider down past base, or up past lastWritten), we honor
    // the change as external.
    if (lastWrittenValue !== null && lastWrittenValue !== baseStart) {
        const lo = Math.min(baseStart, lastWrittenValue);
        const hi = Math.max(baseStart, lastWrittenValue);
        if (v > lo + SELF_WRITE_TOLERANCE && v < hi - SELF_WRITE_TOLERANCE) {
            counters.observerSuppressed += 1;
            return;
        }
    }

    counters.observerExternal += 1;
    const prev = baseStart;
    baseStart = v;
    if (INF) logi("base", "external update", { from: prev, to: baseStart });
    outlet(0, "base", baseStart);
}

// ─── message handlers (from the patch) ──────────────────────────────────────

// Max dispatches by message name, so the handler functions must be named
// after the messages from the patch. State lives on `state` so we don't
// shadow handler names.
const state = { amount: 0.5, bypass: false };

// `amount $1` from live.numbox (0..100 %)
function amount(v) {
    const n = Number(v);
    state.amount = isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0;
}

function bypass(v) {
    const prev = state.bypass;
    state.bypass = Number(v) > 0;
    if (prev !== state.bypass) {
        if (INF) logi("bypass", state.bypass ? "engaged" : "released",
             { resolved: !!targetParam });
        outlet(0, "bypass", state.bypass ? 1 : 0);
    }
    if (state.bypass && targetParam && lastWrittenValue !== null) {
        // Restore base immediately when bypassed mid-flight.
        writeParam(baseStart, "bypass-restore");
    }
}

// `note $1 $2` — fired from notein passthrough. We treat ANY note-on (vel>0)
// as "prepare the next note"; note-off (vel=0) as "snap back to base".
//
// The patch should send TWO messages per MIDI event:
//   noteon  → "note <pitch> <velocity>"  (velocity > 0)
//   noteoff → "note <pitch> 0"
// Standard [notein] outputs are pitch + velocity, so a [pak note 0 0] →
// "note $1 $2" trigger does the job.
// De-dup state for repeated note events. Some patch wirings emit each
// note-on / note-off twice; without de-dup, every doubled note-on burns
// an extra randomization step. Packed as `(pitch << 1) | isOn` so we
// compare a single int per event. -1 means "no prior note seen".
let lastNoteKey = -1;

function note(pitch, velocity) {
    const vel = Number(velocity) || 0;
    const isOn = vel > 0;
    const pitchN = Number(pitch) | 0;

    if (isOn) counters.notesOn += 1; else counters.notesOff += 1;

    if (state.bypass) return;
    if (!targetParam) {
        if (WRN) logw("note", "ignored (no target resolved)", {
            pitch: pitch, vel: vel,
            initStarted: initStarted,
            chainAttached: !!chainObserver,
            chainFires: counters.chainFires,
            resolveAttempts: counters.resolveAttempts,
        });
        return;
    }

    // De-dup: same pitch + same on/off state → ignore. Real legato repeats
    // have a note-off in between, so they break the streak.
    const key = (pitchN << 1) | (isOn ? 1 : 0);
    if (key === lastNoteKey) return;
    lastNoteKey = key;

    if (!isOn) {
        // Note-off is a no-op. Snapping back to baseStart here would
        // overwrite the random value prepared by the prior note-on
        // before the next note-on could read it — every note would
        // then play at baseStart. The slider rests at the last random
        // value between notes; that's the price of the prep-next model.
        if (DBG) logd("note", "off → ignored (no snapback)", { pitch: pitch });
        return;
    }

    // Note-on → prepare offset for the NEXT note.
    const r = Math.random();
    const headroom = 1 - baseStart;          // baseStart is clamped 0..1
    const next = baseStart + r * state.amount * (headroom > 0 ? headroom : 0);
    const clamped = next > 1 ? 1 : next;
    if (DBG) logd("note", "on → prep next", {
        pitch: pitch, vel: vel,
        base: baseStart, amount: state.amount,
        r: r, next: clamped,
    });
    writeParam(clamped, "note-on");
    outlet(0, "wrote", clamped);
}

function writeParam(value, source) {
    // CRITICAL: set lastWrittenValue BEFORE the actual set(). LiveAPI's
    // value-listener fires synchronously inside set() in many cases, so by
    // the time onParamChange runs, lastWrittenValue must already match or
    // the echo gets misclassified as an external update — which then
    // overwrites baseStart with our own randomized value, causing every
    // note's offset to compound forward (drift bug).
    lastWrittenValue = value;
    try {
        targetParam.set("value", value);
        counters.writes += 1;
        if (DBG) logd("write", "ok", { value: value, source: source });
    } catch (e) {
        counters.writeErrors += 1;
        if (ERR) loge("write", "failed", { value: value, source: source, msg: e.message });
    }
}

// ─── runtime control ────────────────────────────────────────────────────────

// `loglevel <0..4>` or `loglevel debug|info|warn|error|none`
function loglevel(v) {
    let next = logLevel;
    if (typeof v === "number") {
        next = Math.max(0, Math.min(4, v | 0));
    } else if (typeof v === "string") {
        const idx = LOG_NAMES.indexOf(v.toUpperCase());
        if (idx >= 0) next = idx;
    }
    const prev = logLevel;
    logLevel = next;
    recomputeLogGates();
    // Force-print this even if we just lowered the level — use raw post.
    post(`[INFO][ctrl] loglevel from=${LOG_NAMES[prev]} to=${LOG_NAMES[next]}\n`);
}

// `dump` — print a full state snapshot. Useful when wiring up.
function dump() {
    post("─── random-start state dump ─────────────────────────\n");
    post(`  logLevel        : ${LOG_NAMES[logLevel]}\n`);
    post(`  resolved        : ${targetParam ? "yes" : "no"}\n`);
    if (targetParam) {
        post(`  target device   : ${targetDeviceName}\n`);
        post(`  target paramIdx : ${targetParamIdx}\n`);
        post(`  target paramId  : ${targetParamId}\n`);
    }
    post(`  baseStart       : ${baseStart.toFixed(6)}\n`);
    post(`  lastWritten     : ${lastWrittenValue === null ? "null" : lastWrittenValue.toFixed(6)}\n`);
    post(`  amount          : ${state.amount.toFixed(4)} (${(state.amount * 100).toFixed(1)}%)\n`);
    post(`  bypass          : ${state.bypass}\n`);
    post(`  initStarted     : ${initStarted}\n`);
    post(`  parentTrackPath : ${parentTrackPath || "(none)"}\n`);
    post(`  chainObserver   : ${chainObserver ? "attached" : "(none)"}\n`);
    post("  counters        :\n");
    for (const k in counters) {
        if (counters.hasOwnProperty(k)) post(`    ${k.padEnd(20)} ${counters[k]}\n`);
    }
    post("─────────────────────────────────────────────────────\n");
}

// ─── housekeeping ───────────────────────────────────────────────────────────

// Manual re-resolve (e.g. if you suspect the chain observer missed something).
// Normally not needed — the chain observer fires on every device add/remove.
function rescan() {
    if (INF) logi("ctrl", "rescan requested");
    clearTarget();
    if (chainObserver) {
        try { chainObserver.property = ""; } catch (e) {}
        chainObserver = null;
    }
    if (initStarted) {
        setupChainObserver();
    } else if (WRN) {
        logw("ctrl", "rescan ignored — live.thisdevice has not fired yet");
    }
}

function freepeer() {
    if (chainObserver) {
        try { chainObserver.property = ""; } catch (e) {}
        chainObserver = null;
    }
    clearTarget();
}

function anything() {
    if (WRN) logw("rx", "unexpected message",
         { name: messagename, args: arrayfromargs(arguments) });
}
