// mute-solo-control.js
//
// Handles mute/solo toggle commands for standard tracks (not return or master).
// Message protocol (inlet 0):
//   <trackNum> mute toggle   — 1-based index into standard tracks
//   <trackNum> solo toggle
//
// Solo behaviour:
//   - Solo presses accumulate: each adds track N to the active solo pool.
//   - On the first solo press, if the currently selected track has no playing
//     clip (and is not already in the pool), it is pinned as an extra solo.
//   - Un-solo removes track N from the pool. When the last pooled track is
//     un-soloed, the pinned selected track is also cleared.
//   - Mute and solo are independent states.
//
// Outlets: none (operates entirely via LOM writes).
// ES5 only — no const/let, no arrow functions, no template literals.

autowatch = 1;
inlets  = 1;
outlets = 0;

// ─── state ────────────────────────────────────────────────────────────────────

// LOM paths of tracks we have explicitly soloed via messages.
var soloedPaths = [];

// LOM path of the selected track we pinned on the first solo, or "" if none.
var pinnedSoloPath = "";

// ─── helpers ──────────────────────────────────────────────────────────────────

function standardTrack(n) {
    var api = new LiveAPI("live_set");
    var count = api.getcount("tracks");
    if (n < 1 || n > count) {
        post("[mute-solo] track " + n + " out of range (1-" + count + ")\n");
        return null;
    }
    return new LiveAPI("live_set tracks " + (n - 1));
}

function selectedStandardTrackPath() {
    var setApi = new LiveAPI("live_set");
    var count  = setApi.getcount("tracks");
    var selApi = new LiveAPI("live_set view selected_track");
    if (!selApi || selApi.id == 0) return "";
    var selId = selApi.id;
    for (var i = 0; i < count; i++) {
        var t = new LiveAPI("live_set tracks " + i);
        if (t.id == selId) return "live_set tracks " + i;
    }
    return "";
}

function trackHasPlayingClip(trackPath) {
    var t = new LiveAPI(trackPath);
    var slotCount = t.getcount("clip_slots");
    for (var i = 0; i < slotCount; i++) {
        var slot = new LiveAPI(trackPath + " clip_slots " + i);
        if (parseInt(slot.get("has_clip"), 10) && parseInt(slot.get("is_playing"), 10)) {
            return true;
        }
    }
    return false;
}

function arrayContains(arr, val) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === val) return true;
    }
    return false;
}

function arrayRemove(arr, val) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] !== val) out.push(arr[i]);
    }
    return out;
}

// ─── mute ─────────────────────────────────────────────────────────────────────

function handleMuteToggle(trackNum) {
    var t = standardTrack(trackNum);
    if (!t) return;
    var current = parseInt(t.get("mute"), 10);
    t.set("mute", current ? 0 : 1);
    post("[mute-solo] track " + trackNum + " mute -> " + (current ? 0 : 1) + "\n");
}

// ─── solo ─────────────────────────────────────────────────────────────────────

function handleSoloToggle(trackNum) {
    var t = standardTrack(trackNum);
    if (!t) return;

    var targetPath = "live_set tracks " + (trackNum - 1);
    var current    = parseInt(t.get("solo"), 10);

    if (current) {
        // ── un-solo ───────────────────────────────────────────────────────
        t.set("solo", 0);
        soloedPaths = arrayRemove(soloedPaths, targetPath);

        if (soloedPaths.length === 0) {
            // Last one — clear the pin too
            if (pinnedSoloPath !== "") {
                var pinned = new LiveAPI(pinnedSoloPath);
                if (pinned && pinned.id != 0) pinned.set("solo", 0);
                pinnedSoloPath = "";
            }
            post("[mute-solo] track " + trackNum + " solo -> 0 (pool empty, pin cleared)\n");
        } else {
            post("[mute-solo] track " + trackNum + " solo -> 0 (" + soloedPaths.length + " remaining)\n");
        }
    } else {
        // ── solo on ───────────────────────────────────────────────────────
        t.set("solo", 1);
        soloedPaths.push(targetPath);

        // Pin the selected track on the first solo press only
        if (soloedPaths.length === 1) {
            var selPath = selectedStandardTrackPath();
            var sameAsSelected = (selPath !== "" && selPath === targetPath);

            if (!sameAsSelected && selPath !== "" && !trackHasPlayingClip(selPath)) {
                var sel = new LiveAPI(selPath);
                if (sel && sel.id != 0) {
                    if (!parseInt(sel.get("solo"), 10)) sel.set("solo", 1);
                    pinnedSoloPath = selPath;
                    post("[mute-solo] track " + trackNum + " solo -> 1, pinned " + selPath + "\n");
                }
            } else {
                pinnedSoloPath = "";
                post("[mute-solo] track " + trackNum + " solo -> 1 (no pin: " +
                    (sameAsSelected ? "is selected track" :
                     selPath === "" ? "no standard track selected" : "selected track playing") + ")\n");
            }
        } else {
            post("[mute-solo] track " + trackNum + " solo -> 1 (" + soloedPaths.length + " in pool)\n");
        }
    }
}

// ─── inlet router ─────────────────────────────────────────────────────────────

function list() {
    var args     = arrayfromargs(arguments);
    var trackNum = parseInt(args[0], 10);
    var action   = args.length > 1 ? String(args[1]).toLowerCase() : "";

    if (action === "mute") {
        handleMuteToggle(trackNum);
    } else if (action === "solo") {
        handleSoloToggle(trackNum);
    } else {
        post("[mute-solo] unknown action '" + action + "'\n");
    }
}

function anything() {
    post("[mute-solo] unexpected: " + messagename + " " + arrayfromargs(arguments) + "\n");
}
