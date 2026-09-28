"""TrackTransposeComponent — the clip view's ±12 on a kit the UI cannot see.

    /looping/v3/track/transpose        [request_id, trackPath, semitones:int]
    /looping/v3/track/transpose/reply  [request_id, result, detail, pitch:int]

The UI decides where an octave press goes from the track's *top-level*
instrument. A Drum Rack there is a Drum Rack; a Drum Rack wrapped in an
Instrument Rack (196 library kits ship that way) reads as a plain
Instrument Rack, and the UI's wire cannot address a device inside a rack
chain (``chains/`` is reserved, ``path-not-supported``). Permute's pitch
steps have always found the wrapped kit, because they run here. This
answers the same question the same way — ``find_track_drum_rack``, by
device class, never by macro name (issue #489 addendum, the user's
rule) — so the buttons and Permute agree on what a drum track is.

The UI sends this for an Instrument Rack only; a top-level Drum Rack it
already moves itself through ``vm.pitch``. ``result``:

- ``drum``      the kit's pitch moved: ``vm.pitch`` = clamp(current +
                semitones, ±48) through ``DrumVirtualMacroComponent``,
                the fan-out, undo and legacy-macro path Permute's shift
                and the Drum Rack view's Trnsp slider use. ``pitch`` is
                the stored value. A ``/looping/v3/property/value`` echo
                goes out for the rack's path too, as ``property/set``
                would send it.
- ``not-drum``  the instrument contains no Drum Rack: the UI does what it
                did before (the rack's named pitch macro, else the notes).
- ``held``      a kit whose every pitch member is macro-held — mapped by
                the wrapper's own macros, typically. Nothing is written;
                the UI moves the named macro that holds it, and never
                shifts the notes (on a kit +12 plays different pads).
- ``none``      a kit with no pitch member, or no value yet. Nothing moves.
- ``invalid-args`` / ``no-track``  as the names say.

Stateless apart from what the drum provider keeps per rack (the same
state Permute's shift creates on first use).
"""

from __future__ import annotations

import json
import logging
from typing import Callable, Optional, Tuple

from . import path_resolver
from .drum_vm_functions import MEMBERS_KEY, PITCH_MAX, PITCH_MIN, PROPERTY_PREFIX
from .drum_vm_resolve import find_track_drum_rack
from .path_resolver import ResolveStatus

logger = logging.getLogger("looping")

V3_TRACK_TRANSPOSE_ADDRESS = "/looping/v3/track/transpose"
V3_TRACK_TRANSPOSE_REPLY_ADDRESS = "/looping/v3/track/transpose/reply"
V3_PROPERTY_VALUE_ADDRESS = "/looping/v3/property/value"

RESULT_DRUM = "drum"
RESULT_NOT_DRUM = "not-drum"
RESULT_HELD = "held"
RESULT_NONE = "none"
RESULT_INVALID_ARGS = "invalid-args"
RESULT_NO_TRACK = "no-track"

PITCH_FUNCTION = "pitch"


def _coerce_str(x) -> str:
    if x is None:
        return ""
    if isinstance(x, bytes):
        return x.decode("utf-8", errors="replace")
    return str(x)


def _parse_int(raw) -> Optional[int]:
    if isinstance(raw, bool):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


class TrackTransposeComponent:
    """Owns ``/looping/v3/track/transpose``.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender.
        drum_vm: the ``DrumVirtualMacroComponent`` (``read`` / ``write``).
    """

    def __init__(self, song, emit: Callable[[str, tuple], None], drum_vm) -> None:
        self._song = song
        self._emit = emit
        self._drum_vm = drum_vm
        self._disconnected = False

    def handle_transpose(self, args, source_addr=None) -> None:
        if self._disconnected:
            return
        request_id = _coerce_str(args[0]) if len(args) > 0 else ""
        if len(args) < 3:
            self._reply(request_id, RESULT_INVALID_ARGS, "expected 3 args, got %d" % len(args))
            return
        track_path = _coerce_str(args[1])
        semitones = _parse_int(args[2])
        if semitones is None:
            self._reply(request_id, RESULT_INVALID_ARGS, "semitones not an int: %r" % (args[2],))
            return
        res = path_resolver.resolve_track(self._song, track_path)
        if res.status is not ResolveStatus.OK or res.obj is None:
            self._reply(request_id, RESULT_NO_TRACK, res.detail or track_path)
            return

        rack, rack_path = find_track_drum_rack(res.obj, track_path)
        if rack is None:
            self._reply(request_id, RESULT_NOT_DRUM, "")
            return
        if self._drum_vm is None:
            self._reply(request_id, RESULT_NONE, "drum provider missing")
            return

        result, detail, stored = self._move_kit_pitch(rack, rack_path, semitones)
        self._reply(request_id, result, detail, stored)
        logger.info(
            "TrackTransposeComponent: %s %+d -> %s (%s) %s",
            track_path, semitones, result, rack_path, detail,
        )

    def _move_kit_pitch(self, rack, rack_path: str, semitones: int) -> Tuple[str, str, int]:
        held, members = self._pitch_census(rack, rack_path)
        if members == 0:
            return RESULT_NONE, "kit has no pitch member", 0
        if members is not None and held >= members:
            return RESULT_HELD, "every pitch member is macro-held", 0
        current = self._drum_vm.read(rack, rack_path, PITCH_FUNCTION)
        if not isinstance(current, (int, float)):
            return RESULT_NONE, "no pitch value yet", 0
        target = int(max(PITCH_MIN, min(PITCH_MAX, int(current) + semitones)))
        if target == int(current):
            return RESULT_DRUM, "at the rail", target
        ok, stored, detail = self._drum_vm.write(rack, rack_path, PITCH_FUNCTION, target)
        if not ok:
            return RESULT_NONE, "write refused: %s" % detail, 0
        try:
            self._emit(V3_PROPERTY_VALUE_ADDRESS, (rack_path, PROPERTY_PREFIX + PITCH_FUNCTION, stored))
        except Exception as e:  # an echo failure must not lose the reply
            logger.warning("TrackTransposeComponent: echo failed: %s", e)
        return RESULT_DRUM, "", int(stored)

    def _pitch_census(self, rack, rack_path: str) -> Tuple[int, Optional[int]]:
        """``(held, members)`` for pitch from the kit's census; ``members``
        is ``None`` when the census cannot be read (treated as writable,
        as the UI treats a census that has not arrived)."""
        try:
            raw = self._drum_vm.read(rack, rack_path, MEMBERS_KEY)
            census = json.loads(raw) if isinstance(raw, str) else raw
            row = (census or {}).get("functions", {}).get(PITCH_FUNCTION) or {}
            return int(row.get("held", 0)), int(row.get("members", 0))
        except (ValueError, TypeError, AttributeError):
            return 0, None

    def _reply(self, request_id: str, result: str, detail: str, pitch: int = 0) -> None:
        try:
            self._emit(V3_TRACK_TRANSPOSE_REPLY_ADDRESS, (request_id, result, detail, int(pitch)))
        except Exception as e:
            logger.warning("TrackTransposeComponent: reply failed: %s", e)

    def disconnect(self) -> None:
        self._disconnected = True
