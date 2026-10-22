"""Cut a wavetable render take into single cycles.

    uv run --no-project --with numpy python owner/probes/wavetable_render_audio.py <run.json> <out.json> [points]
    uv run --no-project --with numpy python owner/probes/wavetable_render_audio.py bundle <cycles.json> <factory.json> [points]

``wavetable_render_run.js`` plays one held note per table (or per effect
sweep) and logs, for each, the song time of every parameter write relative
to the note-on. This finds each note-on in the take, and for frame j takes
the audio between write j and write j+1 (40 ms after the first, 30 ms
before the second), samples it at ``points`` phases per cycle of the note's
known frequency and averages the whole cycles in the window. The cycles of
one note are cut at the same phase of that note, so its frames line up with
each other; the table is then turned so that its first frame's fundamental
starts like a sine (rising through zero), and scaled so its loudest frame
peaks at 1. A calibration sweep is turned and scaled by its neutral frame
instead (Effect 1 at 0 %, Effect 2 at 0), so each effect frame reads against
the untouched cycle at the level it really plays.

``bundle`` writes what the interface ships
(``interface/static/wavetables/factory.json``): every table's frames
resampled to ``points`` (128) by truncating the spectrum, each sample as a
signed byte (``round(v * 127)``), the frames of a table concatenated and
base64-encoded, keyed ``tables[category][table]``.

Each frame also gets ``spread``: the RMS difference between the cycles it
averaged, as a fraction of the frame's own RMS. Near 0 is a clean periodic
cycle; a noise table reads high, and so would a window that straddled a
write.
"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clip_jump_audio import read_audio  # noqa: E402

SETTLE_S = 0.040
GUARD_S = 0.030


def onsets(x, sr, count):
    """Sample index of each note-on: the first loud sample after a silence."""
    env = np.abs(x)
    thr = 0.02 * env.max()
    loud = np.flatnonzero(env > thr)
    gap = int(0.3 * sr)
    found = [loud[0]]
    for a, b in zip(loud[:-1], loud[1:]):
        if b - a > gap:
            found.append(b)
    if len(found) != count:
        raise SystemExit("found %d note-ons, expected %d" % (len(found), count))
    return found


def cut(x, sr, onset, f0, t0, t1, points):
    """Average the whole cycles of the note in [t0, t1) seconds after onset."""
    c0 = int(np.ceil(t0 * f0))
    m = int(np.floor(t1 * f0)) - c0
    if m < 1:
        raise SystemExit("window %.3f–%.3f s holds no whole cycle" % (t0, t1))
    phase = (c0 + np.arange(m)[:, None] + np.arange(points)[None, :] / points) / f0
    idx = onset + phase * sr
    cycles = np.interp(idx.ravel(), np.arange(len(x)), x).reshape(m, points)
    mean = cycles.mean(axis=0)
    rms = np.sqrt(np.mean(mean ** 2)) or 1e-12
    spread = float(np.sqrt(np.mean((cycles - mean) ** 2)) / rms)
    return mean, spread, m


def reference_frame(seg):
    """The frame a note is aligned and scaled by: the neutral one of a sweep."""
    if seg.get("kind") == "effect1":
        return [f["e1"] for f in seg["frames"]].index(0.5)
    return 0


def sine_aligned(frames, ref=0):
    """Turn every frame by the amount that starts frame ref's fundamental at phase 0."""
    k1 = np.fft.rfft(frames[ref])[1]
    if abs(k1) < 1e-6 * len(frames[0]):
        return frames
    phi = np.angle(k1) + np.pi / 2  # a sine of phase phi has angle phi - pi/2 at bin 1
    n = frames.shape[1]
    shift = np.exp(-1j * phi * np.arange(n // 2 + 1))
    return np.fft.irfft(np.fft.rfft(frames, axis=1) * shift, n=n, axis=1)


def main(run_path, out_path, points=256):
    run = json.load(open(run_path))
    x, sr = read_audio(run["copy"])
    spb = 60.0 / run["tempo"]
    f0 = 440.0 * 2 ** ((run["note"] - 69) / 12.0)
    segs = run["segments"]
    ons = onsets(x, sr, len(segs))
    out = {"source": os.path.basename(run["copy"]), "sample_rate": sr, "note": run["note"], "f0": f0,
           "points": points, "settle_s": SETTLE_S, "guard_s": GUARD_S, "entries": []}
    for seg, onset in zip(segs, ons):
        w = seg["writes"] + [run["note_len"] - GUARD_S / spb]
        frames, spreads, counts = [], [], []
        for j in range(len(seg["writes"])):
            t0 = w[j] * spb + SETTLE_S
            t1 = w[j + 1] * spb - GUARD_S
            cyc, spread, m = cut(x, sr, onset, f0, t0, t1, points)
            frames.append(cyc)
            spreads.append(round(spread, 4))
            counts.append(m)
        ref = reference_frame(seg)
        frames = sine_aligned(np.array(frames), ref)
        peak = (np.abs(frames[ref]).max() if seg.get("kind") in ("effect1", "effect2") else np.abs(frames).max()) or 1.0
        entry = {k: v for k, v in seg.items() if k not in ("writes", "checked", "note_on", "frames")}
        # values[j] is what frame j was played at: {pos} for a table, {e1, e2} for a sweep.
        entry.update({"values": seg["frames"], "frames": np.round(frames / peak, 4).tolist(), "spread": spreads, "cycles": counts,
                      "peak": round(float(peak), 5)})
        out["entries"].append(entry)
    json.dump(out, open(out_path, "w"))
    worst = sorted(((max(e["spread"]), " ".join(str(e.get(k, "")) for k in ("category", "table", "mode", "kind", "shape")).strip())
                    for e in out["entries"]), reverse=True)
    print("%d entries, %d frames, %d points; f0 %.4f Hz, %d Hz" % (
        len(out["entries"]), sum(len(e["frames"]) for e in out["entries"]), points, f0, sr))
    print("widest cycle spread:", ", ".join("%s %.3f" % (n, s) for s, n in worst[:5]))


def resample(frames, points):
    spec = np.fft.rfft(frames, axis=1)[:, : points // 2 + 1]
    spec[:, -1] = 0  # the new Nyquist bin, which a real cycle can't carry in phase
    return np.fft.irfft(spec, n=points, axis=1) * points / frames.shape[1]


def bundle(cycles_path, out_path, points=128):
    import base64
    src = json.load(open(cycles_path))
    tables = {}
    frames_per = set()
    for e in src["entries"]:
        fr = resample(np.array(e["frames"]), points)
        fr /= np.abs(fr).max() or 1.0
        frames_per.add(len(fr))
        raw = np.clip(np.round(fr * 127), -127, 127).astype(np.int8).tobytes()
        tables.setdefault(e["category"], {})[e["table"]] = base64.b64encode(raw).decode("ascii")
    if len(frames_per) != 1:
        raise SystemExit("tables disagree on their frame count: %s" % sorted(frames_per))
    out = {"format": 1, "note": src["note"], "frames": frames_per.pop(), "points": points, "tables": tables}
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    print("%d tables in %d categories, %d frames x %d points; %d bytes" % (
        sum(len(t) for t in tables.values()), len(tables), out["frames"], points, os.path.getsize(out_path)))


if __name__ == "__main__":
    if sys.argv[1] == "bundle":
        bundle(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 128)
    else:
        main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 256)
