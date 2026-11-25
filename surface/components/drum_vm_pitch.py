"""The pitch fan-out of the Drum Rack virtual macros (ADR-428 / ADR-429 /
ADR-435): ``vm.pitch`` across the kit's members, the read-back that tells
a kit move from one pad's hand edit, and one pad's own Transpose.

Split out of ``DrumVirtualMacroComponent`` (code review, 2026-11-25) as
:class:`PitchMixin`, which the component inherits, so ``_apply_pitch`` and
the rest keep their names. The methods lean on the component's member
reads and writes (``drum_vm_values``), ``_clock``, ``_warn_refused`` and
``_safe_emit``.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

from .drum_vm_functions import (
    _LOM_ERRORS,
    FUNCTIONS,
    PITCH_MAX,
    PITCH_MIN,
    PROPERTY_PREFIX,
    STALE_READ_WINDOW_MS,
    V3_PROPERTY_VALUE_ADDRESS,
    VirtualMacro,
    _clamp,
)
from .drum_vm_state import _Member, _PadPitch, _RackState

logger = logging.getLogger("looping")


class PitchMixin:
    """See the module docstring."""

    def _apply_pitch(
        self, st: _RackState, fn: VirtualMacro, global_value: int, shift: int, adopt_kit_move: bool,
    ) -> int:
        """The pitch fan-out: ``clamp(global + shift + offset)`` per member,
        after :meth:`_reconcile_pitch` has read every member back.

        A kit move found on the read-back is discarded on the write path
        (the incoming ``global_value`` is the user's absolute intent) and
        adopted into the held global on the sequencer path — there is no
        new user value there, and the slider on screen should follow
        Live's undo — unless the move is exactly the shift change this
        apply makes (Cmd-Z on a held step: the kit already sits where the
        step-off lands, so nothing is adopted). Either way the sequencer
        path re-emits ``vm.pitch`` to its subscribers when a kit move was
        found. Returns the number of member writes that landed."""
        macro = self._legacy_macro(st, fn)
        if macro is not None:
            return self._write_macro(
                st, fn, macro, int(_clamp(global_value + shift, PITCH_MIN, PITCH_MAX)),
            )
        members = st.members.get(fn.name) or []
        if not members:
            self._warn_once(
                st.device_path, "nomembers:" + fn.name,
                "%s has no member parameter on any pad; write dropped" % fn.name,
            )
            return 0
        now = self._clock()
        move, first_seen = self._reconcile_pitch(st, members, now)
        if move:
            if not adopt_kit_move:
                logger.debug(
                    "DrumVirtualMacroComponent: %s kit moved %+d since the last write; "
                    "the incoming value %d wins", st.device_path, move, global_value,
                )
            elif move == shift - st.shift:
                logger.debug(
                    "DrumVirtualMacroComponent: %s kit already carries the shift change %+d "
                    "(undone in Live); nothing to adopt", st.device_path, move,
                )
            else:
                global_value = int(_clamp(global_value + move, PITCH_MIN, PITCH_MAX))
                st.values[fn.name] = global_value
                logger.debug(
                    "DrumVirtualMacroComponent: %s kit moved %+d under the sequencer; "
                    "global -> %d", st.device_path, move, global_value,
                )
            if adopt_kit_move and fn.name in st.subscribed:
                self._safe_emit(
                    V3_PROPERTY_VALUE_ADDRESS,
                    (st.device_path, PROPERTY_PREFIX + fn.name, st.values.get(fn.name)),
                )
        base = global_value + shift
        for note, cur in first_seen:
            # A pad first seen at apply time keeps its pitch until the
            # next move: its offset is whatever makes base + offset read
            # what it holds.
            rec = st.pads.get(note)
            if rec is None:
                rec = st.pads[note] = _PadPitch()
            rec.offset = cur - base
        wrote = 0
        failed = 0
        first_error = None
        for m in members:
            if not m.enabled:
                continue
            rec = st.pads.get(m.note) if m.note >= 0 else None
            # The pad's own deviation, and the term a Permute in its own
            # chain holds on it (ADR-435): both ride every kit gesture.
            offset = (rec.offset + rec.shift) if rec is not None else 0
            lo, hi = self._member_bounds(m)
            target = int(_clamp(int(_clamp(base + offset, PITCH_MIN, PITCH_MAX)), lo, hi))
            try:
                self._member_write(m, target)
            except _LOM_ERRORS as e:
                failed += 1
                if first_error is None:
                    first_error = e
                m.enabled = False
                st.dirty = True
                continue
            wrote += 1
            if rec is not None:
                if rec.written is not None and rec.written != target:
                    rec.prev = rec.written
                rec.written = target
                rec.written_at = now
        if failed:
            self._warn_refused(st, fn, failed, len(members), first_error)
        return wrote

    def _reconcile_pitch(
        self, st: _RackState, members: List[_Member], now: float,
    ) -> Tuple[int, List[Tuple[int, int]]]:
        """Pass one of a pitch fan-out: read every enabled member back and
        sort what changed since our last write.

        Returns ``(move, first_seen)``. ``move`` is the kit's move — the
        nonzero delta (read − written) at least two pads share when it is
        the most common delta across the pads read, an unchanged pad
        voting 0 — or 0 when there is none; the caller discards or adopts
        it. ``first_seen`` lists members with no record yet and what they
        read. Per pad, what remains after the kit move is the user's edit
        of that pad and is folded into its offset here.

        A read equal to the pad's pre-write value inside
        ``STALE_READ_WINDOW_MS`` of the write is our own write still
        landing: neither a vote nor an edit. A pad whose last write sat at
        its rail cannot vote — the clamp hid part of the move — and, under
        a kit move, keeps its offset. ``prev`` is cleared for every pad
        whose read matched its write or was judged an edit."""
        window = STALE_READ_WINDOW_MS / 1000.0
        votes: Dict[int, int] = {}
        changed: List[Tuple[_PadPitch, int, bool]] = []
        first_seen: List[Tuple[int, int]] = []
        for m in members:
            if not m.enabled or m.note < 0:
                continue
            cur = self._member_read(m)
            if cur is None:
                continue
            cur_i = int(round(cur))
            rec = st.pads.get(m.note)
            if rec is None or rec.written is None:
                first_seen.append((m.note, cur_i))
                continue
            lo, hi = self._member_bounds(m)
            at_rail = rec.written <= lo or rec.written >= hi
            if cur_i == rec.written:
                rec.prev = None
                if not at_rail:
                    votes[0] = votes.get(0, 0) + 1
                continue
            if rec.prev is not None and cur_i == rec.prev and (now - rec.written_at) <= window:
                # Our write still landing (measured on the rig 2026-09-07:
                # under a busy control thread a DrumCell reads one write
                # behind for a pass; folding that in walked every pad away
                # by the shift on each step).
                continue
            rec.prev = None
            delta = cur_i - rec.written
            changed.append((rec, delta, at_rail))
            if not at_rail:
                votes[delta] = votes.get(delta, 0) + 1
        move = 0
        if votes:
            top = max(votes.values())
            winners = [d for d, n in votes.items() if n == top]
            if len(winners) == 1 and winners[0] != 0 and top >= 2:
                move = winners[0]
        for rec, delta, at_rail in changed:
            if move:
                if at_rail:
                    continue
                delta -= move
            if delta:
                rec.offset += delta
        return move, first_seen

    def _apply_pad_pitch(self, st: _RackState, note: int, members: List[_Member], value: int) -> int:
        """One pad's Transpose: ``value`` semitones (the UI's number, without
        the sequencer's shift), recorded as that pad's offset from the kit
        value so the Trnsp slider and the sequencer's octave carry it."""
        global_value = st.values.get("pitch")
        rec = st.pads.get(note)
        if global_value is not None:
            if rec is None:
                rec = st.pads[note] = _PadPitch()
            rec.offset = int(value) - int(global_value)
        pad_shift = int(rec.shift) if rec is not None else 0
        return self._write_pad_pitch(st, rec, members, int(value) + int(st.shift) + pad_shift)

    def _write_pad_pitch(self, st: _RackState, rec: Optional[_PadPitch], members: List[_Member], target_st: int) -> int:
        """Write ``target_st`` semitones (clamped) to one pad's pitch members,
        recording the write on its record. Returns the writes that landed."""
        target_st = int(_clamp(int(target_st), PITCH_MIN, PITCH_MAX))
        now = self._clock()
        wrote = 0
        failed = 0
        first_error = None
        for m in members:
            if not m.enabled:
                continue
            lo, hi = self._member_bounds(m)
            target = int(_clamp(target_st, lo, hi))
            try:
                self._member_write(m, target)
            except _LOM_ERRORS as e:
                failed += 1
                if first_error is None:
                    first_error = e
                m.enabled = False
                st.dirty = True
                continue
            wrote += 1
            if rec is not None:
                if rec.written is not None and rec.written != target:
                    rec.prev = rec.written
                rec.written = target
                rec.written_at = now
        if failed:
            self._warn_refused(st, FUNCTIONS["pitch"], failed, len(members), first_error)
        return wrote
