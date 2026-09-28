# ADR-446: The key of the set, decided by votes the performer can read

## Status
**Accepted** (2026-09-19; extends ADR-141 and ADR-178, the key signature on the surface and in the interface)

## Context

The interface has shown and set Live's song key since ADR-178: the Master
strip's key band reads it, tapping the band opens the scale picker, a pick
writes root, scale name and scale mode through `SessionComponent`. Issue
#287 asked for the key to be *learned* rather than picked, from a chord
played on a controller; it never shipped. The ask on 2026-09-19 was the
same wish from the other side: read the key off the clips that are
already playing — a bass line says more about the key than a melody does,
so weigh each track by its role — and set Live's key from that.

Two facts were measured on the artifact (Live 12.4.15b3) before anything
was designed. `Song.root_note` and `Song.scale_name` are settable from the
control surface (G Mixolydian took, intervals read back `0 2 4 5 7 9 10`,
1–2 ms a write), with listeners on both and a combined
`scale_information` listener; the same four properties exist per clip.
And **an unknown scale name does not raise: Live silently switches to
Major.** The surface's scale-name write checked only the length, so a typo
from any writer would have reset the key without a word. Live's vocabulary
is 35 names; each one's intervals were read back by setting it (then
restored) and are the table in `key_detect.py`.

The first analysis, run by hand over the rig's own set (a Trilian bass, an
Omnisphere pad on the `key` rail, a Sub37 melody), used Krumhansl key
profiles with role weights and reached C minor. The performer's question
was how to make that lightweight and deterministic. The answer is that the
profiles were never load-bearing: what decided C minor was where the bass
put its roots and which chords the keys played on the downbeats. That is
countable.

## Decision

**A vote count, not a correlation.** `key_detect.py` (pure, no Live
imports) decides in two steps, both integer arithmetic:

1. **Collection.** Every note's sounding time, quantized to sixteenths, is
   weighted by its track's rail role (bass 4, key 3, synth / inst / unset
   2, fx 0) and by where it starts (downbeat 4, on a beat 3, between 2).
   Pitch classes carrying at least 2 % of that evidence are the set; the
   candidates are Live's scales that contain the whole set, seven-note
   scales first, a five- or six-note scale only when it *is* the set.
2. **Tonic.** Only the candidates' roots can win. The bass's lowest
   sounding note on each downbeat votes (4, **8 on the loop's first
   downbeat**), its first note (2), its lowest note (1); the keys' **chord
   roots** vote, 3 on a downbeat (6 on the first), 1 off it, where a chord's
   root is found by stacking — the note with a perfect fifth above it in the
   chord, then one with a third, then the lowest — so C-E-A is A minor and
   D-G-B is G major whatever the voicing. A line (synth, inst, unset) votes
   only where it **comes to rest**: 2 for each note followed by a beat of
   silence (the loop's last note included) and 1 for its longest note — the
   rig's own melody sits on the fifth and would otherwise read as G minor.
   Ties break by the sounding time of the candidate's tonic triad, then by
   Live's scale order, then by the lower root.

Shorter loops repeat inside the longest launched one, the way the ear
hears them. Fewer than three pitch classes, or no bass and no keys track
launched, is `no-key`. Confidence is the gap between winner and runner-up
as a share of the winner: `sure` from 50 %, `plausible` from 20 %,
`unsure` below. The reasons are returned as text — "bass downbeats C D# C
D# (4 each) … tonic votes: C 20, D# 8 …" (Live's spelling, sharps, as the
picker shows roots) — and that line is the whole
audit trail. The clips are sorted canonically first, so the same set gives
the same line whatever order the LOM hands the tracks over in.

**One verb, on the surface.** `/looping/v3/session/scale/detect [apply]`
(`KeyDetectComponent`) reads every launched MIDI clip on a pitched,
non-group track — its loop's notes, its `looping.role`, whether it is a
drum track (a drum role, or a `DrumGroupDevice` top level or one rack deep;
pad numbers are not pitches) — and always answers on
`/looping/v3/session/scale/detected`, never on `/looping/v3/error`. With
`apply = 1` and a key found, it writes root, scale name and scale mode on
through `SessionComponent`'s own handlers, in one undo step: exactly the
three writes a pick makes. A `no-key` answer never writes.

**Scale names are validated against Live's vocabulary** in
`SessionComponent` (`LIVE_SCALE_NAMES`), whoever the writer is.

**In the interface,** the scale picker's header gets a *Detect key*
button and, once an answer is in, a *Detected* strip above the roots: the
key, the band, `· set` when the surface wrote it, the runner-up as a
one-tap alternative, the reasons as the strip's tooltip and, since the iPad
has no tooltips, unfolded under the strip by a tap on the heading. A detection
is a moment, not a setting: the strip is forgotten when the picker closes and
when the surface restarts (a set load, a Live restart), and `· set` shows only
while Live's key is still the one the detection wrote. Holding the
Master strip's key band (600 ms) is the fast path: the same verb with
`apply = 1` and no browser; the band shows the answer through the ordinary
echoes. The shot mock answers the verb with the rig set's line so the
strip can be photographed.

Protocol **3.10.0**.

## Consequences

- The rig's own set decides as C Minor, sure, gap 67 %, runner-up F
  Dorian — the same answer the profile analysis gave, with the reasons
  printed (`tests/test_key_detect.py` keeps that set as a fixture).
- No key profiles, no sidecar, no numpy: a few dozen lines of integer
  arithmetic after one control-thread pass over the launched clips (about
  7 ms a clip).
- Only a bass or a keys track can open the vote. A set with a melody
  alone answers `no-key` on purpose; the performer picks.
- **The first ladder got a loop wrong** (2026-09-19, the same afternoon):
  an Am Dm G C loop — Hollow Fretless bass, a marimba voicing its A minor
  chords as C-E-A and its G chords as D-G-B, a line resting on a long A —
  answered D Dorian, sure. The same seven notes; the tonic vote had gone
  D 13 to A 6 because a chord's *lowest note* stood in for its root and
  every bar weighed the same. Three rules came out of it: chord roots by
  stacking, the loop's first downbeat counting double, and a line's rests
  voting a little. Under them the loop reads A Minor, plausible, runner-up
  G Mixolydian, and the C minor set is unchanged. Both loops are fixtures
  in `tests/test_key_detect.py`.
- **Chromatic passing tones** (second addendum, the same afternoon): a
  note under 2 % of the evidence never enters the set, and when a heavier
  one does and no seven-note scale holds the set, the weakest pitch classes
  are dropped, two at most, and named in the reasons ("passing tones
  dropped: F#"). A bigger scale around the whole set (an exact octatonic)
  still wins over trimming; three chromatic extras are too many and answer
  `no-key`.
- Live's exotic scales (Messiaen, Pelog, …) are named only when the set is
  exactly theirs; a loop's five notes are named by the seven-note scale
  that contains them, since that is what one improvises over.
- Continuous detection, and a Follow toggle that re-detects at loop
  boundaries with hysteresis, are deliberately not here. On-demand first;
  Follow is a later toggle in the Behavior column if the tap earns it.
- Per-clip keys (`Clip.root_note` and kin, also writable) are untouched.

## Files

- `surface/components/key_detect.py` — the rules and the
  35 verified scale tables; `KeyDetectComponent.py` — the verb, the reads,
  the write; `SessionComponent.py` — the vocabulary guard;
  `LoopingSurface.py` — registration.
- `interface/src/lib/api/handlers/v3Session.ts`, `stores/session.svelte.ts`
  — the answer on the wire and in the store; `components/v6/browser/
  DrillDownBrowser.v6.svelte` — Detect button and strip;
  `components/v6/tracks/MasterTrack.svelte` — the hold.
- `scripts/shot/mock-surface.mjs` — the canned answer.
- Tests: `tests/test_key_detect.py`, `tests/test_key_detect_component.py`,
  additions to `tests/test_session_component.py`; vitest additions to
  `handlers/v3Session.test.ts` and `stores/sessionStore.scaleDetected.test.ts`.

## Addendum — after the review (2026-09-19, evening)

A twelve-checker review of the branch confirmed five rule defects, fixed
here, and the rig asked for one more:

- **Bars follow the time signature.** LOM beats are quarter notes whatever
  the signature, so a 6/8 bar is three of them. The bar was the numerator
  alone — two real bars in 6/8, half a bar in 2/2 — and downbeat votes
  landed on the wrong ticks. `bar_ticks(num, den)` is exact for Live's
  denominators.
- **A role weighted 0 is left out entirely.** An fx clip added no evidence
  but still voted where it rested and stretched the harmonic cycle.
- **An unlooped clip is read between its markers.** Looping off, Live
  reports the start and end markers in `loop_start` / `loop_end`; the read
  used `[0, length)` and analyzed notes that never sound.
- **A note just before the loop end is the next downbeat.** Onsets snap on
  the loop's circle; a banker's-rounding tie a 32nd before the end used to
  drop the note.
- **Muted notes count.** On this rig a muted note is Permute's gate — the
  engine mutes a step's notes and unmutes them a step later — so leaving
  them out made the answer depend on the instant a clip was read.
- **The commoner scale names an open mode.** A C drone under F# G F# A# A
  (no third) fits both C Dorian #4 and C Lydian Dominant; the tie fell to
  Live's list order and named the rarer one. `SCALE_PREFERENCE` now
  decides: church modes, minor forms, jazz modes, exotic, pentatonic,
  symmetric. The set is a fixture.

- **One note is the root, two decide.** A loop brace holding one B read as
  no key (fewer than three pitch classes); the operator's call: a single
  note is the root, Major assumed. Two pitch classes go through the votes
  like any set, named by the commonest scale on the root that holds both
  (B and D is B Minor, never B Major).
- **A chordless keys part votes its downbeat notes.** An arpeggio has no two
  notes struck together, so it cast no vote yet still counted as a voter,
  and a melody resting on G could name G Major over a C arpeggio. Only a
  clip that actually voted opens the ladder now.
- **The verdict survives a long ladder.** Vote listings stop at 24 entries
  ("… +N"), and a ladder still over 1,500 characters loses its middle, not
  its tonic votes, verdict and Follow line.

The review also found the verb's `applied` could claim a write Live refused
(the session handlers swallow the refusal); it now reads the key back. An
`apply` of `1.0` used to apply and `inf` crashed the answer; only an int
`1` applies now, as the wire contract always said.

## Tags
`key-detection`, `scale`, `session`, `votes`, `control-surface`, `protocol-3.10.0`, `extends-141`, `extends-178`

