"""Ground truth for jumps inside a playing audio clip, read off the audio.

    uv run --no-project --with numpy python owner/probes/clip_jump_audio.py gen <out.wav> <bpm> <beats>
    uv run --no-project --with numpy python owner/probes/clip_jump_audio.py analyze <recording> <run.json>
    uv run --no-project --with numpy python owner/probes/clip_jump_audio.py analyze-midi <recording> <run.json>

``gen`` writes a sine whose frequency names its own position in the loop:
``300 + 100 * beat`` Hz, so a recording of the clip says, sample by sample,
which beat of the loop was sounding. ``analyze`` decodes a recording of it
(``clip_jump_groundtruth_run.js`` makes one and the run file) into that
position against song time, finds every cut, and reports for each fire in
the run file when the cut was heard, where in the loop it landed, and what
the splice did to the level (a fade, a click).
"""

import json
import sys
import wave

import numpy as np

F0, PER_BEAT = 300.0, 100.0


def gen(out, bpm, beats, sr=48000):
    spb = 60.0 / bpm
    n = int(round(beats * spb * sr))
    t = np.arange(n) / sr
    pos = t / spb
    phase = 2 * np.pi * np.cumsum(F0 + PER_BEAT * pos) / sr
    x = (0.5 * np.sin(phase) * 32767).astype("<i2")
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(x.tobytes())
    print("wrote %s: %d samples, %.4f s, %d beats at %s BPM" % (out, n, n / sr, beats, bpm))


def read_audio(path):
    """Mono float samples and rate from a WAV or AIFF (Live records either)."""
    if path.lower().endswith((".aif", ".aiff")):
        import aifc  # noqa: deprecated but present through 3.12
        with aifc.open(path, "rb") as a:
            ch, sw, sr, n = a.getnchannels(), a.getsampwidth(), a.getframerate(), a.getnframes()
            raw = a.readframes(n)
            ctype = a.getcomptype()
        if ctype in (b"fl32", b"FL32"):
            x = np.frombuffer(raw, dtype=">f4").astype(float)
        else:
            x = np.frombuffer(raw, dtype=">i%d" % sw).astype(float) / (2 ** (8 * sw - 1))
    else:
        with wave.open(path, "rb") as w:
            ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
        if sw == 3:
            b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
            v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
            v = np.where(v >= 1 << 23, v - (1 << 24), v)
            x = v.astype(float) / (1 << 23)
        elif sw == 4:
            x = np.frombuffer(raw, dtype="<f4").astype(float)
            if np.abs(x).max() > 16:  # int32, not float
                x = np.frombuffer(raw, dtype="<i4").astype(float) / (1 << 31)
        else:
            x = np.frombuffer(raw, dtype="<i2").astype(float) / 32768
    return x.reshape(-1, ch).mean(axis=1), sr


def decode(x, sr):
    """Instantaneous frequency (Hz) and level, 1 ms frames."""
    n = len(x)
    spec = np.fft.fft(x)
    h = np.zeros(n)
    h[0] = 1
    h[1:(n + 1) // 2] = 2
    if n % 2 == 0:
        h[n // 2] = 1
    analytic = np.fft.ifft(spec * h)
    inst = np.diff(np.unwrap(np.angle(analytic))) * sr / (2 * np.pi)
    env = np.abs(analytic)
    hop = sr // 1000
    frames = len(inst) // hop
    f = np.median(inst[:frames * hop].reshape(frames, hop), axis=1)
    lvl = env[:frames * hop].reshape(frames, hop).mean(axis=1)
    peak = np.abs(np.diff(x))[:frames * hop].reshape(frames, hop).max(axis=1)
    return f, lvl, peak


def analyze(rec, run_path):
    run = json.load(open(run_path))
    x, sr = read_audio(rec)
    f, lvl, peak = decode(x, sr)
    bpm = run["tempo"]
    spb = 60.0 / bpm
    loop = run["loop_len"]
    rec_start = run["record_start_song_time"]  # the bar line the take began on
    ms = np.arange(len(f))
    song = rec_start + (ms / 1000.0) / spb
    pos = (f - F0) / PER_BEAT
    # Clip position minus song time, mod the loop: constant while it plays
    # on, stepping at a cut. A rolling median keeps the decoder's glitch at
    # a splice from reading as a cut of its own.
    off = np.mod(pos - song, loop)
    k = 5
    offm = np.array([np.median(off[max(0, i - k):i + k + 1]) for i in range(len(off))])
    sound = lvl > 0.1
    print("recording: %.2f s at %d Hz, starts at song %.3f; level median %.3f" % (
        len(x) / sr, sr, rec_start, float(np.median(lvl))))
    # Offset before the first fire: the clip's start against song time, i.e.
    # how the recording lines up with the grid (0 = sample-aligned).
    first = min([fi["song_time"] for fi in run["fires"]] or [song[-1]])
    pre = (song < first - 0.2) & sound & (song > rec_start + 0.2)
    base = float(np.median(offm[pre])) if pre.any() else float("nan")
    print("before the first fire the clip sits %.4f beats (%.2f ms) off song time, mod the loop" % (
        base if base < loop / 2 else base - loop, (base if base < loop / 2 else base - loop) * spb * 1000))

    def wrapd(a):
        return (a + loop / 2) % loop - loop / 2

    # Cuts: frames where the smoothed offset moves by more than 0.05 beat.
    d = np.abs(wrapd(np.diff(offm)))
    cut_frames = np.where((d > 0.05) & sound[1:])[0] + 1
    cuts = []
    for c in cut_frames:
        if cuts and c - cuts[-1][-1] <= 15:
            cuts[-1].append(c)
        else:
            cuts.append([c])
    cuts = [(c[0], c[-1]) for c in cuts]
    rows = []
    for fi in run["fires"]:
        st = fi["song_time"]
        after = [c for c in cuts if song[c[0]] >= st - 0.01]
        if not after:
            rows.append({"fire": fi, "cut": None})
            continue
        c0, c1 = after[0]
        t_cut = song[c0]
        # Level and slope around the splice (±30 ms) against the steady level.
        lo, hi = max(0, c0 - 30), min(len(lvl), c1 + 30)
        steady = float(np.median(lvl[max(0, c0 - 200):max(1, c0 - 50)]))
        dip = float(lvl[lo:hi].min())
        jump_peak = float(peak[lo:hi].max())
        steady_peak = float(np.median(peak[max(0, c0 - 200):max(1, c0 - 50)]))
        b4 = float(np.median(offm[max(0, c0 - 40):max(1, c0 - 10)]))
        af = float(np.median(offm[min(len(offm) - 1, c1 + 10):min(len(offm), c1 + 40)]))
        # Where the clip was the moment the cut was heard, read off the
        # tone just after it and run back to the cut.
        j = min(len(pos) - 1, c1 + 15)
        land_pos = float(np.median(pos[c1 + 5:c1 + 25]) - (song[j] - t_cut)) % loop
        row = {
            "kind": fi["kind"], "fire_song_time": st,
            "aim_song_time": fi.get("aim"),
            "cut_song_time": round(float(t_cut), 4),
            "heard_ms_after_fire": round(float((t_cut - st) * spb * 1000), 1),
            "off_aim_ms": None if fi.get("aim") is None else round(float((t_cut - fi["aim"]) * spb * 1000), 1),
            "step_beats": round(float(wrapd(af - b4)), 4),
            "expected_step": fi.get("expected_step"),
            "landed_pos": round(float(land_pos), 4),
            "splice_ms": int(c1 - c0 + 1),
            "level_dip": round(dip / steady, 3) if steady else None,
            "edge_peak": round(jump_peak / steady_peak, 2) if steady_peak else None,
        }
        rows.append({"fire": fi, "cut": row})
    print("\n%-10s %10s %10s %9s %8s %8s %9s %7s %6s %6s" % (
        "kind", "fire", "heard at", "ms after", "off aim", "step", "expected", "splice", "dip", "edge"))
    for r in rows:
        c = r["cut"]
        if c is None:
            print("%-10s %10.3f  no cut heard" % (r["fire"]["kind"], r["fire"]["song_time"]))
            continue
        print("%-10s %10.3f %10.3f %9.1f %8s %8.3f %9s %5d ms %6.2f %6.2f" % (
            c["kind"], c["fire_song_time"], c["cut_song_time"], c["heard_ms_after_fire"],
            "" if c["off_aim_ms"] is None else "%.1f" % c["off_aim_ms"],
            c["step_beats"], "" if c["expected_step"] is None else "%.3f" % c["expected_step"],
            c["splice_ms"], c["level_dip"] or 0, c["edge_peak"] or 0))
    unclaimed = [c for c in cuts if not any(r["cut"] and abs(song[c[0]] - r["cut"]["cut_song_time"]) < 1e-6 for r in rows)]
    wraps = [c for c in unclaimed if abs(abs(wrapd(np.median(offm[min(len(offm) - 1, c[1] + 10):c[1] + 40]) - np.median(offm[max(0, c[0] - 40):c[0] - 10])))) < 0.05]
    print("\n%d cuts in all, %d matched to fires; others at song %s" % (
        len(cuts), sum(1 for r in rows if r["cut"]), [round(float(song[c[0]]), 3) for c in unclaimed][:20]))
    json.dump({"rows": rows, "cuts": [[int(a), int(b)] for a, b in cuts], "base_offset": base},
              open(run_path.replace(".json", "-analysis.json"), "w"), indent=1, default=float)


def analyze_midi(rec, run_path, first_pitch=36):
    """A take of a MIDI clip whose 16th-note slot N plays pitch first_pitch + N
    on a sine: list the notes heard around each fire, each with its onset
    against the 1/16 grid, so a skipped, doubled or late note shows."""
    run = json.load(open(run_path))
    x, sr = read_audio(rec)
    f, lvl, _ = decode(x, sr)
    spb = 60.0 / run["tempo"]
    rec_start = run["record_start_song_time"]
    song = rec_start + (np.arange(len(f)) / 1000.0) / spb
    on = lvl > 0.05 * np.median(lvl[lvl > 0]) if (lvl > 0).any() else lvl > 0
    with np.errstate(divide="ignore", invalid="ignore"):
        midi = np.where(on & (f > 20), np.round(69 + 12 * np.log2(np.maximum(f, 1) / 440.0)), -1)
    # Runs of one pitch at least 8 ms long are notes.
    runs, i = [], 0
    while i < len(midi):
        j = i
        while j < len(midi) and midi[j] == midi[i]:
            j += 1
        if midi[i] >= 0 and j - i >= 8:
            runs.append((i, j, int(midi[i]) - first_pitch))
        i = j
    # Merge a run split by a decoder blip on the same slot.
    merged = []
    for r in runs:
        if merged and merged[-1][2] == r[2] and r[0] - merged[-1][1] < 12:
            merged[-1] = (merged[-1][0], r[1], r[2])
        else:
            merged.append(r)
    print("take: %.2f s, %d notes heard" % (len(x) / sr, len(merged)))
    grid = 0.25
    onset_err = []
    for a, b, slot in merged:
        t = song[a]
        g = round(t / grid) * grid
        onset_err.append((t - g) * spb * 1000)
    oe = np.array(onset_err)
    print("note onsets against the 1/16 grid: median %.1f ms, 5%%..95%% %.1f..%.1f ms" % (
        np.median(oe), np.percentile(oe, 5), np.percentile(oe, 95)))
    for fi in run["fires"]:
        st = fi["song_time"]
        aim = fi.get("aim")
        print("\n%s fired %.3f%s target %s step %s" % (
            fi["kind"], st, "" if aim is None else " aim %.3f" % aim, fi.get("target"), fi.get("expected_step")))
        for (a, b, slot), err in zip(merged, onset_err):
            t = song[a]
            if st - 0.6 <= t <= st + 1.6:
                print("    %.3f  slot %2d (beat %5.2f)  %4.0f ms long  onset %+5.1f ms off grid%s" % (
                    t, slot, slot * 0.25, (b - a), err,
                    "" if aim is None or abs(t - aim) > 0.13 else "  <- at aim"))
    json.dump({"notes": [[float(song[a]), int(b - a), int(sl)] for a, b, sl in merged]},
              open(run_path.replace(".json", "-midi.json"), "w"))


if __name__ == "__main__":
    if sys.argv[1] == "gen":
        gen(sys.argv[2], float(sys.argv[3]), int(sys.argv[4]))
    elif sys.argv[1] == "analyze-midi":
        analyze_midi(sys.argv[2], sys.argv[3])
    else:
        analyze(sys.argv[2], sys.argv[3])
