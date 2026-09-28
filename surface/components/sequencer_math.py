"""sequencer_math — Permute's step arithmetic, ported (permute ADR-020).

Pure functions, no LOM. Ported from the fat device's
``permute-sequencer.js`` / ``permute-constants.js`` so the surface's
engine (:mod:`SequencerComponent`) lands on exactly the same step at
exactly the same tick as the device it replaces:

- a step is ``floor(ticks / ticks_per_step) % length`` of the absolute
  song position in ticks (480 per quarter note);
- the eight rates are the device's ``Mute Rate`` / ``Pitch Rate`` enum
  in order: ``8 bar, 4 bar, 2 bar, 1 bar, 1/2, 1/4, 1/8, 1/16``. The
  bar-length entries scale with the time-signature numerator so a bar
  stays a bar in 3/4 or 5/4; the note-length entries are fixed ticks.

Lookahead is the one thing the fat device did *not* compute: it added a
flat 120 ticks (a 16th) to compensate for its Max → LiveAPI latency. The
surface's clock knows its own period and the tempo, so
:func:`lookahead_ticks` converts a measured tick interval into ticks at
the current tempo. That interval alone (~10 ms) turned out to be too
thin a lead — measured on the rig it put only two thirds of transitions
ahead of the boundary, and it budgets nothing for the time Live needs to
act on a clip write before it reads the note. :func:`lead_ticks` is the
lead the engine actually uses: the tick interval or a 1/32, whichever is
longer, clamped to half a step so a fast rate cannot flip the state
before the middle of the step preceding the boundary.
"""

from __future__ import annotations

import math
from typing import Tuple

TICKS_PER_QUARTER_NOTE = 480
DEFAULT_TIME_SIGNATURE = 4
MIN_PATTERN_LENGTH = 1
MAX_PATTERN_LENGTH = 64
#: The device's default length. It offers 1..16 steps (ADR-443); the math
#: tolerates the fat device's 64.
DEVICE_PATTERN_STEPS = 8

#: ``(label, bars_per_step, ticks)`` — one of the last two is set. Index is
#: the ``Mute Rate`` / ``Pitch Rate`` parameter value (0..7).
ENUM_RATES: Tuple[Tuple[str, int, int], ...] = (
    ("8 bar", 8, 0),
    ("4 bar", 4, 0),
    ("2 bar", 2, 0),
    ("1 bar", 1, 0),
    ("1/2", 0, 960),
    ("1/4", 0, 480),
    ("1/8", 0, 240),
    ("1/16", 0, 120),
)
#: What an out-of-range rate index falls back to (the fat device's
#: ``DEFAULT_RATE_ENUM``: 1/4). The *device's* stored default is 3 (1 bar);
#: this only covers a value outside 0..7.
FALLBACK_RATE_ENUM = 5

#: Musical floor for the lead: a 1/32 note. The clock's own period (~10 ms)
#: is granularity, not headroom — the write still has to reach Live's
#: playback engine before it reads the note at the boundary, which is why
#: the fat device used a flat 120 ticks (a 1/16). A 1/32 is half that: it
#: stays inside the gap after a preceding 1/16 note, so the state does not
#: flip early on the note before the boundary. In ticks, so it scales with
#: tempo.
MUSICAL_LEAD_TICKS = TICKS_PER_QUARTER_NOTE // 8

#: The lead may never exceed this fraction of a step. Only bites at the
#: 1/16 rate (120-tick steps), where it holds the flip to a 1/32 early.
MAX_LEAD_FRACTION = 0.5


def _rate_entry(index) -> Tuple[str, int, int]:
    """The enum entry for ``index``; anything outside 0..7 (a negative index
    must not wrap the way Python lists do) is the fallback."""
    try:
        i = int(index)
    except (TypeError, ValueError):
        return ENUM_RATES[FALLBACK_RATE_ENUM]
    if 0 <= i < len(ENUM_RATES):
        return ENUM_RATES[i]
    return ENUM_RATES[FALLBACK_RATE_ENUM]


def rate_label(index) -> str:
    return _rate_entry(index)[0]


def ticks_for_rate_enum(index, time_sig_numerator=None) -> int:
    """Ticks per step for a rate enum index (``permute-constants.js``)."""
    entry = _rate_entry(index)
    _label, bars, ticks = entry
    if ticks:
        return ticks
    try:
        numer = int(time_sig_numerator)
    except (TypeError, ValueError):
        numer = 0
    if numer <= 0:
        numer = DEFAULT_TIME_SIGNATURE
    return bars * numer * TICKS_PER_QUARTER_NOTE


def clamp_length(length) -> int:
    """Pattern length as the device means it: 1..64, non-numbers → 8."""
    try:
        n = int(round(float(length)))
    except (TypeError, ValueError):
        return DEVICE_PATTERN_STEPS
    return max(MIN_PATTERN_LENGTH, min(MAX_PATTERN_LENGTH, n))


def calculate_step(ticks, ticks_per_step, length) -> int:
    """``floor(ticks / ticks_per_step) % length`` (``Sequencer.calculateStep``).

    ``ticks`` may be fractional (a beat position times 480). Returns 0 for
    a non-positive ``ticks_per_step`` — the fat device's guard.
    """
    if not ticks_per_step or ticks_per_step <= 0:
        return 0
    n = clamp_length(length)
    return int(math.floor(ticks / float(ticks_per_step))) % n


def step_start_ticks(ticks, ticks_per_step) -> float:
    """Tick position where the step containing ``ticks`` began."""
    if not ticks_per_step or ticks_per_step <= 0:
        return 0.0
    return math.floor(ticks / float(ticks_per_step)) * float(ticks_per_step)


def beats_to_ticks(beats) -> float:
    return float(beats) * TICKS_PER_QUARTER_NOTE


def ticks_to_ms(ticks, tempo_bpm) -> float:
    """Ticks → milliseconds at ``tempo_bpm`` (quarter = 60000/tempo ms)."""
    try:
        tempo = float(tempo_bpm)
    except (TypeError, ValueError):
        tempo = 120.0
    if tempo <= 0:
        tempo = 120.0
    return float(ticks) / TICKS_PER_QUARTER_NOTE * 60000.0 / tempo


def lookahead_ticks(interval_s, tempo_bpm) -> float:
    """Ticks that elapse in ``interval_s`` seconds at ``tempo_bpm``."""
    try:
        tempo = float(tempo_bpm)
    except (TypeError, ValueError):
        tempo = 120.0
    if tempo <= 0 or interval_s <= 0:
        return 0.0
    return float(interval_s) * tempo / 60.0 * TICKS_PER_QUARTER_NOTE


def lead_ticks(interval_s, tempo_bpm, ticks_per_step) -> float:
    """Ticks of lead the engine evaluates ahead of ``now`` for a step of
    ``ticks_per_step`` — ``max(one tick interval, a 1/32)``, clamped to
    :data:`MAX_LEAD_FRACTION` of a step.

    The tick interval is the floor below which the engine cannot be
    punctual at all; the 1/32 is the musical headroom for Live to act on
    the write. The clamp keeps a fast rate from reaching back past the
    middle of the preceding step. A non-positive ``ticks_per_step``
    (the fat device's guard) returns the unclamped lead.
    """
    base = max(lookahead_ticks(interval_s, tempo_bpm), float(MUSICAL_LEAD_TICKS))
    try:
        tps = float(ticks_per_step)
    except (TypeError, ValueError):
        return base
    if tps <= 0:
        return base
    return min(base, tps * MAX_LEAD_FRACTION)
