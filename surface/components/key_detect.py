"""Deterministic key detection from the launched MIDI clips (ADR-446, ADR-447).

Pure functions, no Live imports: the component reads the LOM and hands
this module plain numbers, so every rule here runs under pytest without
a Live.

The decision is two steps, both integer arithmetic, so the same clips
always give the same line:

1. **Collection.** Every note's sounding time, quantized to sixteenths,
   is weighted by its track's role and by where it starts in the bar.
   The pitch classes carrying at least 2 % of that evidence are "the
   set", and the candidates are Live's scales that contain the whole
   set — seven-note scales first; a five- or six-note scale only when
   it IS the set; a bigger one only when nothing smaller fits. When no
   seven-note scale holds the set, up to two of the weakest pitch
   classes are dropped as chromatic passing tones, and named.
2. **Tonic.** Only the candidates' roots can win. The bass's lowest
   sounding note on each downbeat votes (double on the loop's first
   downbeat), with its first and lowest notes; the keys' chord roots vote,
   found by stacking and weighted by where they land; a line (synth,
   inst, unset) votes only where it comes to rest. Ties break by the
   sounding time of the candidate's tonic triad, then by how common the
   scale is (``SCALE_PREFERENCE``), then by the lower root. On one root,
   when the notes leave the mode open, the more common scale is named.

Shorter loops repeat inside the longest launched one (the harmonic
cycle), the way the ear hears them. Bars follow the time signature: LOM
beats are quarter notes whatever the signature, so a 6/8 bar is three of
them. A role weighted 0 (fx) is left out entirely. **Muted notes count**:
on this rig a muted note is Permute's performance gate — the engine mutes
a step's notes and unmutes them a step later — so a loop's harmony is all
of its notes, and leaving them out made the answer depend on the instant
the clip was read. Key profiles (Krumhansl) are deliberately absent: a
correlation is a number nobody can argue with, a vote count is an audit
trail — ``reasons`` prints it.

``follow_decision`` is Follow's write policy (ADR-447): whether a pass
may move Live's key, given what changed and whether the key there is
Follow's own.

The scale tables were read back from Live 12.4.15b3 on 2026-09-19 by
setting each name and reading ``song.scale_intervals`` (restored
after). Live keeps 35 names; an unknown name written to
``song.scale_name`` does not raise — Live silently falls back to Major
— which is why ``LIVE_SCALE_NAMES`` also guards the session write.
"""

from __future__ import annotations

from itertools import groupby

TICKS_PER_BEAT = 4  # sixteenths of a quarter note — the vote grid, not the sequencer clock

#: Live's own spelling (sharps, as its key chooser and the picker show them).
PITCH_CLASS_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

#: Live's scale vocabulary in Live's own order, intervals as reported by
#: ``Song.scale_intervals`` on the artifact (see module docstring).
LIVE_SCALES = (
    ("Major", (0, 2, 4, 5, 7, 9, 11)),
    ("Minor", (0, 2, 3, 5, 7, 8, 10)),
    ("Dorian", (0, 2, 3, 5, 7, 9, 10)),
    ("Mixolydian", (0, 2, 4, 5, 7, 9, 10)),
    ("Lydian", (0, 2, 4, 6, 7, 9, 11)),
    ("Phrygian", (0, 1, 3, 5, 7, 8, 10)),
    ("Locrian", (0, 1, 3, 5, 6, 8, 10)),
    ("Whole Tone", (0, 2, 4, 6, 8, 10)),
    ("Half-whole Dim.", (0, 1, 3, 4, 6, 7, 9, 10)),
    ("Whole-half Dim.", (0, 2, 3, 5, 6, 8, 9, 11)),
    ("Minor Blues", (0, 3, 5, 6, 7, 10)),
    ("Minor Pentatonic", (0, 3, 5, 7, 10)),
    ("Major Pentatonic", (0, 2, 4, 7, 9)),
    ("Harmonic Minor", (0, 2, 3, 5, 7, 8, 11)),
    ("Harmonic Major", (0, 2, 4, 5, 7, 8, 11)),
    ("Dorian #4", (0, 2, 3, 6, 7, 9, 10)),
    ("Phrygian Dominant", (0, 1, 4, 5, 7, 8, 10)),
    ("Melodic Minor", (0, 2, 3, 5, 7, 9, 11)),
    ("Lydian Augmented", (0, 2, 4, 6, 8, 9, 11)),
    ("Lydian Dominant", (0, 2, 4, 6, 7, 9, 10)),
    ("Super Locrian", (0, 1, 3, 4, 6, 8, 10)),
    ("8-Tone Spanish", (0, 1, 3, 4, 5, 6, 8, 10)),
    ("Bhairav", (0, 1, 4, 5, 7, 8, 11)),
    ("Hungarian Minor", (0, 2, 3, 6, 7, 8, 11)),
    ("Hirajoshi", (0, 2, 3, 7, 8)),
    ("In-Sen", (0, 1, 5, 7, 10)),
    ("Iwato", (0, 1, 5, 6, 10)),
    ("Kumoi", (0, 2, 3, 7, 9)),
    ("Pelog Selisir", (0, 1, 3, 7, 8)),
    ("Pelog Tembung", (0, 1, 5, 7, 8)),
    ("Messiaen 3", (0, 2, 3, 4, 6, 7, 8, 10, 11)),
    ("Messiaen 4", (0, 1, 2, 5, 6, 7, 8, 11)),
    ("Messiaen 5", (0, 1, 5, 6, 7, 11)),
    ("Messiaen 6", (0, 2, 4, 5, 6, 8, 10, 11)),
    ("Messiaen 7", (0, 1, 2, 3, 5, 6, 7, 8, 9, 11)),
)
LIVE_SCALE_NAMES = tuple(name for name, _ in LIVE_SCALES)
_SCALE_INDEX = {name: i for i, (name, _) in enumerate(LIVE_SCALES)}
#: Every scale at every root, built once: ``(name, size, members by root)``
#: in Live's scale order — the order candidates are listed in.
_SCALE_MEMBERS = tuple(
    (name, len(intervals), tuple(frozenset((i + root) % 12 for i in intervals) for root in range(12)))
    for name, intervals in LIVE_SCALES
)
_MEMBERS_BY_NAME = {name: by_root for name, _size, by_root in _SCALE_MEMBERS}

#: When several scales on the winning root hold the notes — the third or the
#: sixth never sounds — the more common one is the answer: the church modes,
#: then the minor forms, the jazz modes, the exotic ones, the pentatonics and
#: the symmetric scales last. Live's own order (the listing's) put Dorian #4
#: ahead of Lydian Dominant, so a C drone under F# G A A# read as the rarer
#: mode (rig, 2026-09-19).
SCALE_PREFERENCE = (
    "Major", "Minor", "Dorian", "Mixolydian", "Lydian", "Phrygian",
    "Harmonic Minor", "Melodic Minor", "Lydian Dominant", "Phrygian Dominant",
    "Locrian", "Harmonic Major", "Super Locrian", "Dorian #4", "Lydian Augmented",
    "Hungarian Minor", "Bhairav",
    "Major Pentatonic", "Minor Pentatonic", "Minor Blues",
    "Hirajoshi", "In-Sen", "Iwato", "Kumoi", "Pelog Selisir", "Pelog Tembung",
    "Whole Tone", "Half-whole Dim.", "Whole-half Dim.", "8-Tone Spanish",
    "Messiaen 3", "Messiaen 4", "Messiaen 5", "Messiaen 6", "Messiaen 7",
)
_PREFERENCE = {name: i for i, name in enumerate(SCALE_PREFERENCE)}

#: Evidence weight per rail role. A role weighted 0 is left out of the
#: analysis entirely: no evidence, no votes, no say in the cycle.
ROLE_WEIGHT = {"bass": 4, "key": 3, "synth": 2, "inst": 2, "": 2, "fx": 0}
#: Dropped before anything else: their notes are pad numbers, not pitches.
#: The component also skips them before reading, to save the note read.
EXCLUDED_ROLES = ("drum", "perc")
#: The roles whose votes can name a tonic; a set with neither is no-key.
VOTING_ROLES = ("bass", "key")
_ROLE_RANK = {"bass": 0, "key": 1}
#: Evidence weight by where the note starts: on a downbeat, on a beat, between.
POSITION_WEIGHT = (4, 3, 2)
#: Tonic vote points. The loop's first downbeat is home more often than any
#: other bar in loop music, so whatever sits there counts double.
BASS_DOWNBEAT_POINTS = 4
BASS_TOP_POINTS = 8
BASS_FIRST_NOTE_POINTS = 2
BASS_LOWEST_NOTE_POINTS = 1
KEY_CHORD_DOWNBEAT_POINTS = 3
KEY_CHORD_TOP_POINTS = 6
KEY_CHORD_OFFBEAT_POINTS = 1
#: A line says less than a bass, but where it comes to rest says something:
#: a note followed by at least a beat of silence, or the loop's last note.
LINE_REST_POINTS = 2
LINE_LONGEST_POINTS = 1
LINE_REST_GAP = TICKS_PER_BEAT
#: A reason line lists at most this many votes, then "… +N": the whole
#: ladder is one OSC string, and the tonic votes and the verdict come last.
REASON_LIST_MAX = 24
#: A pitch class is "present" with at least this share of the evidence (1/50 = 2 %).
PRESENCE_DENOMINATOR = 50
#: Two pitch classes are enough for the votes to name a tonic; one is taken
#: as the root with Major assumed (the operator's call, 2026-09-19: "a single
#: note should still be considered the root").
MIN_PITCH_CLASSES = 2
#: Passing-tone drops never shrink the set below this.
PASSING_FLOOR = 3
#: Chromatic passing tones: when no seven-note scale contains the set, the
#: weakest pitch classes are dropped, this many at most, and named.
PASSING_MAX_DROPS = 2
#: Confidence bands on (winner - runner-up) / winner.
SURE_GAP = 0.5
PLAUSIBLE_GAP = 0.2

BAND_SURE = "sure"
BAND_PLAUSIBLE = "plausible"
BAND_UNSURE = "unsure"
BAND_NO_KEY = "no-key"

#: What a Follow pass saw change (ADR-447): something new is playing — a
#: launch, a finished take, Follow turned on — or something was taken away
#: or edited — a stop, a delete, an overdub, a note edit.
FOLLOW_ADD = "add"
FOLLOW_CORRECT = "correct"

#: Live's time-signature denominators; the bar length is exact in ticks for each.
_DENOMINATORS = (1, 2, 4, 8, 16)


def bar_ticks(numerator, denominator):
    """Ticks in one bar of ``numerator/denominator``. LOM beats are quarter
    notes whatever the signature, so a 6/8 bar is three of them (12 ticks)
    and a 2/2 bar four (16). Anything unreadable is a 4/4 bar."""
    try:
        num, den = int(numerator), int(denominator)
    except (TypeError, ValueError):
        return 4 * TICKS_PER_BEAT
    if not 1 <= num <= 99 or den not in _DENOMINATORS:
        return 4 * TICKS_PER_BEAT
    return num * TICKS_PER_BEAT * 4 // den


def quantize_clip(role, loop_start, loop_end, notes):
    """One launched clip as integer evidence.

    ``notes`` are mappings with ``pitch``, ``start_time`` and ``duration``
    (beats, as ``get_notes_extended`` reports them). Notes outside the loop
    are dropped; muted notes count (see the module docstring). A note that
    outlasts the loop is cut at the loop end, because that is where Live
    cuts it. Onsets snap to the nearest sixteenth on the loop's circle: a
    note within half a sixteenth of the loop end is the next downbeat,
    played early. Returns ``{"role", "length", "notes": [(pitch, on, dur),
    ...]}`` in ticks, sorted, or ``None`` for an empty loop.
    """
    role = str(role or "")
    start = float(loop_start)
    end = float(loop_end)
    if end <= start:
        return None
    length = round((end - start) * TICKS_PER_BEAT)
    if length <= 0:
        return None
    out = []
    for n in notes:
        t = float(n["start_time"])
        if t < start or t >= end:
            continue
        on = round((t - start) * TICKS_PER_BEAT) % length
        dur = round(min(float(n["duration"]), end - t) * TICKS_PER_BEAT)
        out.append((int(n["pitch"]), on, max(1, dur)))
    if not out:
        return None
    # Fixed order so the votes never depend on the LOM's iteration order.
    out.sort(key=lambda x: (x[1], x[0], x[2]))
    return {"role": role, "length": length, "notes": out}


def fingerprint(clip):
    """What a quantized clip says about the key, blind to mute, velocity and
    octave: the sorted ``(pitch class, onset, duration)`` of every note.
    Permute's octave and mute steps leave it unchanged; an edit that moves
    the harmony does not."""
    if not clip:
        return ()
    return tuple(sorted((p % 12, on, dur) for p, on, dur in clip["notes"]))


def _position_weight(on, bar):
    if on % bar == 0:
        return POSITION_WEIGHT[0]
    if on % TICKS_PER_BEAT == 0:
        return POSITION_WEIGHT[1]
    return POSITION_WEIGHT[2]


def _candidates(present):
    """Live scales containing every present pitch class, best fit first, and
    the tier they came from: ``seven`` (seven-note scales, plus any exact
    match), ``exact`` (a five- or six-note scale that IS the set), ``larger``
    (an eight-note-or-more scale around the set) or ``none``. Listed in
    Live's scale order, then by root."""
    seven, exact, larger = [], [], []
    for name, size, by_root in _SCALE_MEMBERS:
        for root, members in enumerate(by_root):
            if not present <= members:
                continue
            cand = {"root": root, "scale": name, "members": members}
            if size == 7:
                seven.append(cand)
            elif members == present:
                exact.append(cand)
            else:
                larger.append(cand)
    if seven:
        return seven + exact, "seven"
    if exact:
        return exact, "exact"
    if larger:
        return larger, "larger"
    return [], "none"


def _fit(present, evidence):
    """The candidates for the set, dropping up to ``PASSING_MAX_DROPS`` of the
    weakest pitch classes first when nothing seven-note (or exact) contains
    it: a chromatic approach note must not turn a loop's key into a Messiaen
    mode or into nothing. Returns ``(candidates, dropped, fitted)`` —
    ``fitted`` the set the candidates contain. A bigger scale around the
    whole set is the fallback only when no drop finds a fit."""
    working = set(present)
    dropped = []
    larger = None
    for step in range(PASSING_MAX_DROPS + 1):
        cands, tier = _candidates(frozenset(working))
        if tier in ("seven", "exact"):
            return cands, dropped, frozenset(working)
        if tier == "larger" and larger is None:
            larger = cands
        if step == PASSING_MAX_DROPS or len(working) <= PASSING_FLOOR:
            break
        weakest = min(working, key=lambda pc: (evidence[pc], pc))
        working.discard(weakest)
        dropped.append(weakest)
    if larger is not None:
        return larger, [], frozenset(present)
    return [], dropped, frozenset(working)


def _triad_evidence(cand, evidence):
    """Sounding time of the candidate's tonic triad — the tie-breaker."""
    root = cand["root"]
    third = next((i for i in (3, 4) if (root + i) % 12 in cand["members"]), None)
    total = evidence[root]
    if third is not None:
        total += evidence[(root + third) % 12]
    if (root + 7) % 12 in cand["members"]:
        total += evidence[(root + 7) % 12]
    return total


def chord_root(pitches):
    """The root of a simultaneity, by stacking: the pitch class with a perfect
    fifth above it in the chord; failing that, one with a third above it;
    failing that, the lowest note. Among several, the one that also has a
    third above it, then the lowest sounding. So C-E-A is A minor (not C),
    D-G-B is G major (not D), and a bare fifth is its lower note."""
    pcs = {p % 12 for p in pitches}
    lowest = {pc: min(p for p in pitches if p % 12 == pc) for pc in pcs}

    def has(pc, interval):
        return (pc + interval) % 12 in pcs

    fifths = [pc for pc in pcs if has(pc, 7)]
    thirds = [pc for pc in pcs if has(pc, 3) or has(pc, 4)]
    pool = fifths or thirds or list(pcs)
    return min(pool, key=lambda pc: (0 if pc in fifths and pc in thirds else 1, lowest[pc]))


def _listing(items):
    if len(items) <= REASON_LIST_MAX:
        return " ".join(items) or "none"
    return " ".join(items[:REASON_LIST_MAX]) + f" … +{len(items) - REASON_LIST_MAX}"


def _downbeat_lows(c, cycle, bar):
    """``(downbeat tick, lowest pitch sounding there)`` over the cycle."""
    out = []
    for db in range(0, cycle, bar):
        at = db % c["length"]
        sounding = [n for n in c["notes"] if n[1] <= at < n[1] + n[2]]
        if sounding:
            out.append((db, min(sounding, key=lambda n: (n[0], n[1]))[0]))
    return out


def _repeats(clip, cycle):
    return -(-cycle // clip["length"])  # ceil


def _evidence(clips, cycle, bar):
    """Weighted sounding time per pitch class over the harmonic cycle."""
    evidence = [0] * 12
    for c in clips:
        rw = ROLE_WEIGHT.get(c["role"], ROLE_WEIGHT[""])
        for rep in range(_repeats(c, cycle)):
            for pitch, on, dur in c["notes"]:
                at = on + rep * c["length"]
                if at < cycle:
                    evidence[pitch % 12] += dur * rw * _position_weight(at, bar)
    return evidence


def _bass_votes(c, cycle, bar, votes):
    """The bass's lowest sounding note on each downbeat, its first and its
    lowest note. Returns the reason line."""
    notes = c["notes"]
    lows = []
    for db, pitch in _downbeat_lows(c, cycle, bar):
        pts = BASS_TOP_POINTS if db == 0 else BASS_DOWNBEAT_POINTS
        votes[pitch % 12] += pts
        lows.append(f"{PITCH_CLASS_NAMES[pitch % 12]}({pts})")
    first = min(notes, key=lambda n: (n[1], n[0]))
    lowest = min(notes, key=lambda n: (n[0], n[1]))
    votes[first[0] % 12] += BASS_FIRST_NOTE_POINTS
    votes[lowest[0] % 12] += BASS_LOWEST_NOTE_POINTS
    return (
        f"bass downbeats {_listing(lows)}, "
        f"first note {PITCH_CLASS_NAMES[first[0] % 12]} ({BASS_FIRST_NOTE_POINTS}), "
        f"lowest {PITCH_CLASS_NAMES[lowest[0] % 12]} ({BASS_LOWEST_NOTE_POINTS})"
    )


def _key_votes(c, cycle, bar, votes):
    """Each chord's root, by where it lands in the cycle. The chords are
    found once (one pass over the notes) and repeated, not re-found per
    repeat. A part with no two notes struck together — an arpeggio, a riff —
    votes the note sounding on each downbeat instead, the way the bass does:
    an arpeggio starts on its chord. Returns the reason line."""
    chords = []
    for on, group in groupby(sorted(c["notes"], key=lambda n: n[1]), key=lambda n: n[1]):
        pitches = [n[0] for n in group]
        if len(pitches) >= 2:
            chords.append((on, chord_root(pitches)))
    listed = []
    if not chords:
        for db, pitch in _downbeat_lows(c, cycle, bar):
            pts = KEY_CHORD_TOP_POINTS if db == 0 else KEY_CHORD_DOWNBEAT_POINTS
            votes[pitch % 12] += pts
            listed.append(f"{PITCH_CLASS_NAMES[pitch % 12]}({pts})")
        return "keys downbeat notes " + _listing(listed)
    for rep in range(_repeats(c, cycle)):
        for on, root in chords:
            at = on + rep * c["length"]
            if at >= cycle:
                continue
            if at == 0:
                pts = KEY_CHORD_TOP_POINTS
            elif at % bar == 0:
                pts = KEY_CHORD_DOWNBEAT_POINTS
            else:
                pts = KEY_CHORD_OFFBEAT_POINTS
            votes[root] += pts
            listed.append(f"{PITCH_CLASS_NAMES[root]}({pts})")
    return "keys chord roots " + _listing(listed)


def _line_votes(c, votes):
    """A line votes where it comes to rest: each note followed by a beat of
    silence (the loop's last note wraps to its first), and its longest
    note. Returns the reason line."""
    notes, length = c["notes"], c["length"]
    by_onset = sorted(notes, key=lambda n: (n[1], n[0]))
    rests = []
    for i, n in enumerate(by_onset):
        nxt = by_onset[i + 1][1] if i + 1 < len(by_onset) else by_onset[0][1] + length
        if nxt - (n[1] + n[2]) >= LINE_REST_GAP:
            votes[n[0] % 12] += LINE_REST_POINTS
            rests.append(PITCH_CLASS_NAMES[n[0] % 12])
    longest = max(notes, key=lambda n: (n[2], -n[1], n[0]))
    votes[longest[0] % 12] += LINE_LONGEST_POINTS
    return (
        f"{c['role'] or 'line'} rests {_listing(rests)} ({LINE_REST_POINTS} each), "
        f"longest {PITCH_CLASS_NAMES[longest[0] % 12]} ({LINE_LONGEST_POINTS})"
    )


def _rank(cands, votes, evidence):
    """One candidate per root — the seven-note tier before an exact smaller
    match, then the more common scale (``SCALE_PREFERENCE``) — best first."""
    best_per_root = {}
    for tier, c in enumerate(cands):
        key = (0 if len(c["members"]) == 7 else 1, _PREFERENCE[c["scale"]], tier)
        held = best_per_root.get(c["root"])
        if held is None or key < held[0]:
            best_per_root[c["root"]] = (key, c)
    roots = [c for _key, c in best_per_root.values()]
    return sorted(roots, key=lambda c: (-votes[c["root"]], -_triad_evidence(c, evidence),
                                        _PREFERENCE[c["scale"]], c["root"]))


def detect(clips, bar=4 * TICKS_PER_BEAT):
    """Decide the key of the launched clips. See the module docstring.

    ``clips`` are ``quantize_clip`` results (``None`` entries ignored);
    ``bar`` is the bar length in ticks (``bar_ticks``). Returns a dict:
    ``band`` (sure / plausible / unsure / no-key), ``root`` and ``scale``
    (``-1`` / ``""`` under no-key), ``runner_root`` / ``runner_scale``,
    ``gap`` (0..1), ``pitch_classes`` (12-bit mask, bit 0 = C, of what
    sounds), ``fitted`` (the mask the candidates were fitted to, after any
    passing tones), ``votes`` (per pitch class), ``candidates`` and
    ``reasons``.
    """
    clips = [
        c for c in clips
        if c and c["notes"] and c["role"] not in EXCLUDED_ROLES
        and ROLE_WEIGHT.get(c["role"], ROLE_WEIGHT[""]) > 0
    ]
    # Canonical order, so the reasons read the same whatever order the LOM
    # handed the tracks over in: voters first, then by loop length, then
    # by the notes themselves.
    clips.sort(key=lambda c: (_ROLE_RANK.get(c["role"], 9), c["length"], c["notes"]))
    result = {
        "band": BAND_NO_KEY, "root": -1, "scale": "", "runner_root": -1,
        "runner_scale": "", "gap": 0.0, "pitch_classes": 0, "fitted": 0,
        "votes": [0] * 12, "candidates": [], "reasons": [],
    }
    reasons = result["reasons"]
    if not clips:
        reasons.append("nothing launched on a pitched track")
        return result
    bar = max(1, int(bar))
    cycle = max(c["length"] for c in clips)
    reasons.append(f"harmonic cycle {cycle / TICKS_PER_BEAT:g} beats")

    # 1. collection
    evidence = _evidence(clips, cycle, bar)
    total = sum(evidence)
    present = frozenset(pc for pc in range(12) if evidence[pc] * PRESENCE_DENOMINATOR >= total > 0)
    result["pitch_classes"] = sum(1 << pc for pc in present)
    reasons.append("pitch classes present: " + " ".join(PITCH_CLASS_NAMES[pc] for pc in sorted(present)))
    if len(present) == 1:
        (pc,) = present
        result.update({
            "band": BAND_SURE, "root": pc, "scale": "Major", "gap": 1.0,
            "fitted": 1 << pc, "candidates": [(pc, "Major")],
        })
        reasons.append(f"one pitch class: {PITCH_CLASS_NAMES[pc]} is the root, Major assumed")
        reasons.append(f"{key_name((pc, 'Major'))} (sure, gap 100 %)")
        return result
    if len(present) < MIN_PITCH_CLASSES:
        reasons.append("no pitch class carries weight: no key")
        return result

    cands, dropped, fitted = _fit(present, evidence)
    result["candidates"] = [(c["root"], c["scale"]) for c in cands]
    result["fitted"] = sum(1 << pc for pc in fitted)
    if dropped and cands:
        reasons.append("passing tones dropped: " + " ".join(PITCH_CLASS_NAMES[pc] for pc in dropped))
    if not cands:
        reasons.append("no Live scale contains those notes: no key")
        return result
    reasons.append("collections that fit: " + ", ".join(
        f"{PITCH_CLASS_NAMES[c['root']]} {c['scale']}" for c in cands))

    # 2. tonic
    votes = [0] * 12
    voted = False
    for c in clips:
        cast = sum(votes)
        if c["role"] == "bass":
            reasons.append(_bass_votes(c, cycle, bar, votes))
        elif c["role"] == "key":
            reasons.append(_key_votes(c, cycle, bar, votes))
        else:
            reasons.append(_line_votes(c, votes))
        voted = voted or (c["role"] in VOTING_ROLES and sum(votes) > cast)
    result["votes"] = votes
    if not voted:
        reasons.append("no bass or keys vote cast: no key")
        return result

    ranked = _rank(cands, votes, evidence)
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    reasons.append("tonic votes: " + ", ".join(
        f"{PITCH_CLASS_NAMES[c['root']]} {votes[c['root']]}" for c in ranked))
    best_votes = votes[best["root"]]
    gap = 0.0
    if best_votes > 0:
        gap = (best_votes - (votes[second["root"]] if second else 0)) / float(best_votes)
    band = BAND_SURE if gap >= SURE_GAP else BAND_PLAUSIBLE if gap >= PLAUSIBLE_GAP else BAND_UNSURE
    if best_votes == 0:
        band = BAND_UNSURE
    result.update({
        "band": band, "root": best["root"], "scale": best["scale"], "gap": gap,
        "runner_root": second["root"] if second else -1,
        "runner_scale": second["scale"] if second else "",
    })
    runner = f", runner-up {key_name((second['root'], second['scale']))}" if second else ""
    reasons.append(
        f"{key_name((best['root'], best['scale']))} ({band}, gap {round(gap * 100)} %){runner}")
    return result


def key_name(key):
    """``(root, scale)`` as Live spells it (``"D# Major"``), or ``"no key"``."""
    if not key or not 0 <= key[0] < 12:
        return "no key"
    return f"{PITCH_CLASS_NAMES[key[0]]} {key[1]}"


def key_fits(key, fitted_mask):
    """Whether Live's key ``(root, scale)`` contains every pitch class in
    ``fitted_mask`` — what the analysis kept, after passing tones."""
    if not key or not 0 <= key[0] < 12:
        return False
    by_root = _MEMBERS_BY_NAME.get(key[1])
    if by_root is None:
        return False
    members = by_root[key[0]]
    return all(pc in members for pc in range(12) if fitted_mask >> pc & 1)


def follow_decision(result, current, event, owned):
    """Follow's write policy (ADR-447): ``(write, why)``.

    ``current`` is Live's key ``(root, scale)`` (``None`` when unreadable),
    ``event`` ``FOLLOW_ADD`` or ``FOLLOW_CORRECT``, ``owned`` whether that
    key is the one Follow wrote last.

    - A key that no longer fits what is playing is replaced by any answer:
      the loops' own notes are outside it.
    - A key that still fits stays after a stop, a delete or an edit — a part
      dropping out, an overdub or a Permute variation never moves it.
    - After a launch or a new take it moves on a sure answer, or on a
      plausible one when the key is not Follow's own (Live's default, the
      set's saved key, a hand's before Follow was turned back on) — so the
      first loop sets the key, and two relative keys do not trade places
      on every loop.
    """
    if result["band"] == BAND_NO_KEY:
        return False, f"no key in what is playing: kept {key_name(current)}"
    answer = (int(result["root"]), str(result["scale"]))
    if current == answer:
        return False, f"{key_name(answer)} already set"
    if not key_fits(current, result["fitted"]):
        return True, f"{key_name(current)} does not fit what is playing: wrote {key_name(answer)}"
    if event != FOLLOW_ADD:
        return False, f"kept {key_name(current)}: it still fits"
    if result["band"] == BAND_SURE or (result["band"] == BAND_PLAUSIBLE and not owned):
        return True, f"wrote {key_name(answer)} ({result['band']})"
    return False, (f"kept {key_name(current)}: it still fits, and {key_name(answer)} "
                   f"is only {result['band']}")
