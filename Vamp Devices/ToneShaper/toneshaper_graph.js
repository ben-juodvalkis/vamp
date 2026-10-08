// toneshaper_graph.js : the processing graph for Ben's Adaptive Tone Shaper (a jsui).
// In: "levels <59 dB>" and "gains <59 dB>" from toneshaper~ (bang it from a metro), "tones <lows lomids himids highs>",
// "freqs <the four centers in Hz>", "amount <0..10>", "latency <0|1>", "quality <0|1>".
// Out (left outlet): "lows <v>" .. "highs <v>" and "lowsfreq <hz>" .. "highsfreq <hz>" while a handle is dragged;
// "amount <v>" while the bar at the right edge is dragged; "latency <0|1>" and "quality <0|1>" when a button is clicked.
// Out (right outlet): "/toneshaper/frame <device path> <59 levels> <59 gains>" once per frame, inside a Live device only:
// what a graph outside Live (an iPad) draws. The device wires it to a udpsend; the path is Live's, as "tracks/0/devices/1".
// Draws the input's spectrum as a filled area, the curve being applied (boosts filled above the line, cuts below), the
// four tone handles at their center and level, the Amount bar and the two buttons. The whole device is this one box.
// Copyright (c) 2026 Ben Juodvalkis. MIT License.
autowatch = 1;
inlets = 1; outlets = 2;
mgraphics.init(); mgraphics.relative_coords = 0; mgraphics.autofill = 0;
var NB = 59, FLO = 25.0, FHI = 20000.0, DB = 12.0;
var bands = new Array(NB), levels = new Array(NB), gains = new Array(NB), tones = [0, 0, 0, 0];
var devicePath = "", pathAge = 1000, pathTries = 0;      // where this device sits in Live, re-read once a second (it can be moved)
var handleHz = [100.0, 350.0, 3500.0, 6300.0], handleName = ["lows", "lomids", "himids", "highs"];
var handleRange = [[27.0, 350.0], [62.0, 1000.0], [750.0, 10000.0], [2500.0, 20000.0]];
var dragging = -1;            // a handle (0..3), the amount bar (4), or nothing (-1)
var amount = 5.0, latency = 1, quality = 0;
var BAR = 18;                 // the width of the amount bar at the right edge
var BTN_W = 30, BTN_H = 11;   // the two buttons in the top right corner of the graph
for (var b = 0; b < NB; b++) { bands[b] = 1000.0 * Math.pow(2.0, (b - 32) / 6.0); levels[b] = -120.0; gains[b] = 0.0; }

function width() { return box.rect[2] - box.rect[0] - BAR; }        // the graph's width: the box less the amount bar
function height() { return box.rect[3] - box.rect[1]; }
function xOf(hz) { return width() * Math.log(hz / FLO) / Math.log(FHI / FLO); }
function yOf(db) { return height() * (0.5 - db / (2.0 * DB)); }

function anything() {
    var a = arrayfromargs(arguments);
    if (messagename == "levels" && a.length == NB) { for (var b = 0; b < NB; b++) levels[b] = a[b]; mgraphics.redraw(); }
    else if (messagename == "gains" && a.length == NB) { for (var b = 0; b < NB; b++) gains[b] = a[b]; mgraphics.redraw(); sendFrame(); }
    else if (messagename == "tones" && a.length == 4) { for (var i = 0; i < 4; i++) tones[i] = a[i]; mgraphics.redraw(); }
    else if (messagename == "freqs" && a.length == 4) { for (var i = 0; i < 4; i++) handleHz[i] = a[i]; mgraphics.redraw(); }
    else if (messagename == "amount" && a.length == 1) { amount = a[0]; mgraphics.redraw(); }
    else if (messagename == "latency" && a.length == 1) { latency = a[0]; mgraphics.redraw(); }
    else if (messagename == "quality" && a.length == 1) { quality = a[0]; mgraphics.redraw(); }
}

// The device's path in Live, the way the iPad names it ("live_set tracks 0 devices 1" is "tracks/0/devices/1"); "" when this
// is not a device in Live (the help patch), or before Live has placed it. Asked only inside an .amxd, so the help patch
// never calls Live, and at most twenty times a second apart while Live has no answer yet.
function liveDevicePath() {
    try {
        var file = String(this.patcher.filepath || "");
        if (file != "" && !/\.amxd$/i.test(file)) return "";
        if (typeof LiveAPI == "undefined") return "";
        var p = String(new LiveAPI("this_device").path).replace(/"/g, "").split(" ");
        if (p.length < 3 || p[0] != "live_set") return "";
        return p.slice(1).join("/");
    } catch (e) { return ""; }
}
function sendFrame() {
    if (++pathAge >= 30) {                                              // once a second
        pathAge = 0;
        if (devicePath != "" || pathTries < 20) { devicePath = liveDevicePath(); if (devicePath == "") pathTries++; else pathTries = 0; }
    }
    if (devicePath == "") return;
    var frame = [1, "/toneshaper/frame", devicePath];
    for (var b = 0; b < NB; b++) frame.push(levels[b]);
    for (var b = 0; b < NB; b++) frame.push(gains[b]);
    outlet.apply(null, frame);
}

function paint() {
    var w = width(), h = height();
    with (mgraphics) {
        set_source_rgba(0.11, 0.11, 0.125, 1.0); rectangle(0, 0, w, h); fill();
        set_line_width(1.0); set_source_rgba(0.18, 0.18, 0.2, 1.0);
        for (var f = 31.25; f < FHI; f *= 2.0) { move_to(xOf(f), 0); line_to(xOf(f), h); stroke(); }
        for (var d = -DB; d <= DB; d += 6.0) { move_to(0, yOf(d)); line_to(w, yOf(d)); stroke(); }
        set_source_rgba(0.33, 0.33, 0.37, 1.0); move_to(0, yOf(0)); line_to(w, yOf(0)); stroke();
        // the spectrum, its loudest band two thirds up
        var top = -1e9; for (var b = 0; b < NB; b++) if (levels[b] > top) top = levels[b];
        set_source_rgba(0.48, 0.42, 1.0, 0.35); move_to(0, h);
        for (var b = 0; b < NB; b++) { var rel = Math.max(-60.0, levels[b] - top); line_to(xOf(bands[b]), h * (1.0 - 0.66 * (rel + 60.0) / 60.0)); }
        line_to(w, h); close_path(); fill();
        // boosts above the line, cuts below
        set_source_rgba(1.0, 1.0, 1.0, 0.4); move_to(0, yOf(0));
        for (var b = 0; b < NB; b++) line_to(xOf(bands[b]), yOf(Math.max(0.0, Math.min(DB, gains[b]))));
        line_to(w, yOf(0)); close_path(); fill();
        set_source_rgba(0.0, 0.0, 0.0, 0.4); move_to(0, yOf(0));
        for (var b = 0; b < NB; b++) line_to(xOf(bands[b]), yOf(Math.min(0.0, Math.max(-DB, gains[b]))));
        line_to(w, yOf(0)); close_path(); fill();
        set_source_rgba(1.0, 1.0, 1.0, 1.0); set_line_width(1.6);
        for (var b = 0; b < NB; b++) { var y = yOf(Math.max(-DB, Math.min(DB, gains[b]))); if (b == 0) move_to(xOf(bands[b]), y); else line_to(xOf(bands[b]), y); }
        stroke();
        // the handles
        for (var i = 0; i < 4; i++) {
            var x = xOf(handleHz[i]), y = yOf(tones[i]);
            set_line_width(1.0); set_source_rgba(0.88, 0.75, 0.38, 0.5);
            for (var yy = 0; yy < h; yy += 7) { move_to(x, yy); line_to(x, Math.min(yy + 3, h)); }                  // a dashed line, drawn as segments
            stroke();
            set_source_rgba(0.88, 0.75, 0.38, 1.0); ellipse(x - 5, y - 5, 10, 10); fill();
            set_source_rgba(0.11, 0.11, 0.125, 1.0); ellipse(x - 5, y - 5, 10, 10); stroke();
            var hz = handleHz[i], label = hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + "k" : Math.round(hz) + (i == 0 ? " Hz" : "");
            set_source_rgba(0.54, 0.54, 0.58, 1.0); select_font_face("Arial"); set_font_size(9); move_to(x - 14, h - 3); show_text(label);
        }
        set_source_rgba(0.54, 0.54, 0.58, 1.0); set_font_size(9); move_to(3, 11); show_text("+12"); move_to(3, h - 3); show_text("-12");
        // the amount bar at the right edge, filled to the amount, its value under it
        var bx = w + 3, bw = BAR - 6, by0 = 14, by1 = h - 14;
        set_source_rgba(0.18, 0.18, 0.2, 1.0); rectangle(bx, by0, bw, by1 - by0); fill();
        var fy = by1 - (by1 - by0) * amount / 10.0;
        set_source_rgba(0.88, 0.75, 0.38, 0.9); rectangle(bx, fy, bw, by1 - fy); fill();
        set_source_rgba(0.54, 0.54, 0.58, 1.0); set_font_size(8); move_to(w + 1, 10); show_text("AMT"); move_to(w + 1, h - 3); show_text(amount.toFixed(1));
        // the two buttons: lit when on
        drawButton(w - 2 * BTN_W - 8, 4, "ZERO", latency == 1); drawButton(w - BTN_W - 4, 4, "ECO", quality == 1);
    }
}

function drawButton(x, y, label, on) {
    with (mgraphics) {
        set_source_rgba(on ? 0.88 : 0.22, on ? 0.75 : 0.22, on ? 0.38 : 0.25, 1.0); rectangle(x, y, BTN_W, BTN_H); fill();
        set_source_rgba(on ? 0.11 : 0.6, on ? 0.11 : 0.6, on ? 0.125 : 0.64, 1.0); set_font_size(8); move_to(x + 4, y + 9); show_text(label);
    }
}

function handleAt(x, y) {
    var best = -1, bestD = 14.0;
    for (var i = 0; i < 4; i++) { var dx = x - xOf(handleHz[i]), dy = y - yOf(tones[i]); var d = Math.sqrt(dx * dx + dy * dy); if (d < bestD) { bestD = d; best = i; } }
    return best;
}
function inButton(x, y, bx) { return x >= bx && x <= bx + BTN_W && y >= 4 && y <= 4 + BTN_H; }
function onclick(x, y) {
    var w = width();
    if (inButton(x, y, w - 2 * BTN_W - 8)) { latency = latency ? 0 : 1; outlet(0, "latency", latency); mgraphics.redraw(); dragging = -1; return; }
    if (inButton(x, y, w - BTN_W - 4)) { quality = quality ? 0 : 1; outlet(0, "quality", quality); mgraphics.redraw(); dragging = -1; return; }
    if (x >= w) { dragging = 4; ondrag(x, y, 1); return; }
    dragging = handleAt(x, y);
}
function ondrag(x, y, but) {
    if (dragging < 0) return;
    if (!but) { dragging = -1; return; }
    if (dragging == 4) {                                                             // the amount bar
        var h = height(); amount = Math.max(0.0, Math.min(10.0, 10.0 * (h - 14 - y) / (h - 28))); outlet(0, "amount", amount); mgraphics.redraw(); return;
    }
    var v = Math.max(-10.0, Math.min(10.0, (0.5 - y / height()) * 2.0 * DB));     // the handle's level reads on the dB axis
    tones[dragging] = v; outlet(0, handleName[dragging], v);
    var hz = FLO * Math.pow(FHI / FLO, x / width()); hz = Math.max(handleRange[dragging][0], Math.min(handleRange[dragging][1], hz));   // and its position, the center
    handleHz[dragging] = hz; outlet(0, handleName[dragging] + "freq", hz); mgraphics.redraw();
}
function onresize(w, h) { mgraphics.redraw(); }
