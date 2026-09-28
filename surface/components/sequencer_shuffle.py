"""sequencer_shuffle — the temperature swap pattern, ported (permute ADR-020).

Pure functions, no LOM, ported from the fat device's ``permute-shuffle.js``
so a temperature variation on the surface is drawn from the same
distribution the device drew from:

- notes are sorted by ``start_time`` (temporal adjacency);
- walking that order, each unused note starts a group with probability
  ``temperature`` — and at least one group is forced when the walk
  reaches the last two notes with none formed, so any temperature above
  0 changes something;
- the group size follows the temperature: pairs below 0.34, pairs or
  triplets (60/40) below 0.67, else 2..5 weighted 0.2/0.3/0.3/0.2;
- the group's pitches are Fisher–Yates shuffled among its members.

``apply_swap_pattern`` writes the shuffled pitches back onto the notes
in place. The RNG is injectable (``random.Random(seed)``) so a variation
is reproducible in tests.
"""

from __future__ import annotations

import random
from typing import Dict, List, Optional, Sequence


def fisher_yates_shuffle(items: Sequence, rng: Optional[random.Random] = None) -> List:
    """A shuffled copy of ``items`` (``permute-shuffle.js`` ``fisherYatesShuffle``)."""
    r = rng or random
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = int(r.random() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def generate_swap_pattern(notes: Sequence, temperature: float, rng: Optional[random.Random] = None) -> List[Dict[str, List[int]]]:
    """Shuffle groups for ``notes`` at ``temperature`` (0..1).

    ``notes`` are dicts or objects carrying ``start_time``. Returns a list
    of ``{"indices": [...], "shuffled": [...]}`` — index pairs into
    ``notes`` saying which note takes which other note's pitch.
    """
    r = rng or random
    if not notes or len(notes) < 2:
        return []
    order = sorted(range(len(notes)), key=lambda i: _start_time(notes[i]))
    used = [False] * len(order)
    groups: List[Dict[str, List[int]]] = []
    formed = False
    for i in range(len(order)):
        if used[i]:
            continue
        roll = r.random()
        last_chance = (not formed) and i >= len(order) - 2
        if not (roll < temperature or last_chance):
            continue
        if temperature < 0.34:
            size = 2
        elif temperature < 0.67:
            size = 2 if r.random() < 0.6 else 3
        else:
            roll2 = r.random()
            size = 3
            cumulative = 0.0
            for candidate, weight in zip((2, 3, 4, 5), (0.2, 0.3, 0.3, 0.2)):
                cumulative += weight
                if roll2 < cumulative:
                    size = candidate
                    break
        group: List[int] = []
        for j in range(i, min(i + size, len(order))):
            if not used[j]:
                group.append(order[j])
                used[j] = True
            if len(group) >= size:
                break
        if len(group) >= 2:
            groups.append({"indices": group, "shuffled": fisher_yates_shuffle(group, r)})
            formed = True
    return groups


def apply_swap_pattern(notes: Sequence, pattern: Sequence[Dict[str, List[int]]]) -> int:
    """Give each note in a group the pitch of its shuffled partner, in
    place. Returns the number of notes whose pitch changed."""
    if not notes or not pattern:
        return 0
    current = [_pitch(n) for n in notes]
    changed = 0
    for group in pattern:
        indices, shuffled = group.get("indices") or [], group.get("shuffled") or []
        for target, source in zip(indices, shuffled):
            if target >= len(notes) or source >= len(current):
                continue
            new_pitch = current[source]
            if new_pitch != _pitch(notes[target]):
                _set_pitch(notes[target], new_pitch)
                changed += 1
    return changed


# --- accessors (dict or attribute notes) --------------------------------------


def _start_time(note) -> float:
    v = note.get("start_time") if isinstance(note, dict) else getattr(note, "start_time", 0.0)
    try:
        return float(v or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _pitch(note) -> int:
    v = note.get("pitch") if isinstance(note, dict) else getattr(note, "pitch", 0)
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _set_pitch(note, pitch: int) -> None:
    if isinstance(note, dict):
        note["pitch"] = pitch
    else:
        note.pitch = pitch
