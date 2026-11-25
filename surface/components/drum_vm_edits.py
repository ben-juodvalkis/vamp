"""Absorbing hand edits made in Live (ADR-428, per-pad deviations): the
member value listeners, their deferred read-back, and the classification
of what moved into a kit move (adopted into the held value) or one pad's
own edit (its deviation).

Split out of ``DrumVirtualMacroComponent`` (code review, 2026-11-25) as
:class:`EditAbsorbMixin`, which the component inherits, so
``_attach_member_listeners``, ``_absorb_edits`` and the rest keep their
names. A listener only marks and schedules; the read-back runs
:data:`EDIT_ABSORB_DELAY_MS` later, which is load-bearing for the kit-move
half (fired inline, each pad would be seen alone and read as an edit).
"""

from __future__ import annotations

import logging
from typing import Callable, Dict, List, Set, Tuple

from .drum_vm_functions import (
    DEV_EPSILON,
    DEV_VOTE_DP,
    EDIT_ABSORB_DELAY_MS,
    KIND_T,
    MAX_MEMBER_LISTENERS,
    PROPERTY_PREFIX,
    STALE_READ_WINDOW_MS,
    V3_PROPERTY_VALUE_ADDRESS,
    VirtualMacro,
    _clamp,
    parse_pad_function,
)
from .drum_vm_state import _MemberEdit, _RackState

logger = logging.getLogger("looping")


class EditAbsorbMixin:
    """See the module docstring."""

    def _attach_member_listeners(self, st: _RackState) -> None:
        """Watch every member that carries a deviation, so a hand edit in
        Live is noticed when it happens instead of being flattened by the
        next fan-out.

        The callback marks the function and schedules the absorb; it reads
        and writes nothing (repo rule — a listener marks and schedules).
        Our own fan-out is skipped by ``_fanning_out`` when Live dispatches
        synchronously and by the ``written`` baseline when it does not.
        Watched in table order to :data:`MAX_MEMBER_LISTENERS`; a function
        that would cross the cap is left unwatched and says so once."""
        if self._disconnected:
            return
        budget = MAX_MEMBER_LISTENERS
        for fn in self._functions(st):
            watchable = [
                m for m in (st.members.get(fn.name) or ())
                if self._tracks_edits(fn, m) and m.enabled
            ]
            if not watchable:
                continue
            if len(watchable) > budget:
                self._warn_once(
                    st.device_path, "listenercap:" + fn.name,
                    "%d more member listeners would pass the %d cap; %s stays "
                    "unwatched (a hand edit on it is not tracked)"
                    % (len(watchable), MAX_MEMBER_LISTENERS, fn.name),
                )
                continue
            cb = self._make_member_callback(st, fn.name)

            def _failed(e, fn_name=fn.name):
                self._warn_once(
                    st.device_path, "memberlistener:" + fn_name,
                    "add_value_listener raised: %s" % e,
                )

            for m in watchable:
                if st.member_listeners.add(m.param, "value", cb, tag=m.note, on_error=_failed):
                    budget -= 1
        # A pad's mute made in Live (its M button, the chain list's
        # activator) re-emits that pad's ``chainMute`` row, so the column
        # beside the held pads follows. Absolute, no deviation to absorb:
        # the listener only schedules the emit (2026-09-29).
        for m in st.members.get("chainMute") or ():
            if m.note < 0 or budget <= 0:
                continue
            cb = self._make_pad_mute_callback(st, m.note)

            def _mute_failed(e):
                self._warn_once(
                    st.device_path, "memberlistener:chainMute",
                    "add_mute_listener raised: %s" % e,
                )

            if st.member_listeners.add(
                m.param, "value", cb, tag=m.note, on_error=_mute_failed,
                on_missing=lambda: _mute_failed(AttributeError("no add_value_listener")),
            ):
                budget -= 1
        logger.debug(
            "DrumVirtualMacroComponent: %s watching %d member parameter(s)",
            st.device_path, len(st.member_listeners),
        )

    def _detach_member_listeners(self, st: _RackState) -> None:
        st.member_listeners.clear()
        st.edited = set()

    def _make_member_callback(self, st: _RackState, function: str) -> Callable[[], None]:
        """One callback per function, shared by its members: the absorb
        re-reads the whole function anyway, so which member fired is not
        worth a closure apiece on a kit with hundreds of them."""
        def _on_member_value():
            if self._disconnected or self._fanning_out or not self._is_held(st):
                return
            st.edited.add(function)
            self._schedule_absorb(st)
        return _on_member_value

    def _make_pad_mute_callback(self, st: _RackState, note: int) -> Callable[[], None]:
        def _on_pad_mute():
            if self._disconnected or not self._is_held(st):
                return
            if self._schedule_delayed is None:
                self._emit_pad_mute(st, note)
                return
            try:
                self._schedule_delayed(0, lambda: self._emit_pad_mute(st, note))
            except Exception as e:
                logger.warning(
                    "DrumVirtualMacroComponent: schedule_delayed failed: %s", e,
                )
        return _on_pad_mute

    def _emit_pad_mute(self, st: _RackState, note: int) -> None:
        """Re-emit one pad's ``chainMute`` row, if someone is watching it."""
        if self._disconnected or not self._is_held(st):
            return
        function = "pad.%d.chainMute" % note
        if function not in st.subscribed:
            return
        self._safe_emit(
            V3_PROPERTY_VALUE_ADDRESS,
            (st.device_path, PROPERTY_PREFIX + function, self._pad_read(st, note, "chainMute")),
        )

    def _schedule_absorb(self, st: _RackState) -> None:
        if st.absorb_scheduled:
            return
        if self._schedule_delayed is None:
            self._absorb_edits(st)
            return
        st.absorb_scheduled = True
        try:
            self._schedule_delayed(EDIT_ABSORB_DELAY_MS, lambda: self._absorb_edits(st))
        except Exception as e:
            st.absorb_scheduled = False
            logger.warning(
                "DrumVirtualMacroComponent: schedule_delayed failed: %s", e,
            )

    def _absorb_edits(self, st: _RackState) -> None:
        """Deferred half of the member value listeners: read back every
        function that fired and sort what changed. Reads only — nothing
        here writes the LOM.

        A delta at least two pads share, and the most common one, is a
        **kit move** — Live's Edit → Undo of our own gesture, a macro, a
        hand move of the whole kit — and is adopted into the held value
        and re-emitted, so the control on screen follows Live instead of
        going stale. What remains per member is the user's own edit and
        moves that member's deviation, so the next fan-out keeps it."""
        st.absorb_scheduled = False
        if self._disconnected or not self._is_held(st):
            return
        functions, st.edited = st.edited, set()
        for name in sorted(functions):
            fn = self._function(st, name)
            if fn is None or fn.kind != KIND_T:
                continue
            try:
                moved, touched = self._absorb_function(st, fn)
            except Exception as e:
                self._warn_once(
                    st.device_path, "absorb:" + name,
                    "absorb raised: %s: %s" % (type(e).__name__, e),
                )
                continue
            if moved and name in st.subscribed:
                self._safe_emit(
                    V3_PROPERTY_VALUE_ADDRESS,
                    (st.device_path, PROPERTY_PREFIX + name, st.values.get(name)),
                )
            # A pad row someone is watching follows the pad it describes: on
            # a kit move every pad moved, otherwise only the edited ones.
            if moved or touched:
                for sub in sorted(st.subscribed):
                    parsed = parse_pad_function(sub)
                    if parsed is None or parsed[1] != name:
                        continue
                    if moved or parsed[0] in touched:
                        self._safe_emit(
                            V3_PROPERTY_VALUE_ADDRESS,
                            (st.device_path, PROPERTY_PREFIX + sub, self._pad_read(st, parsed[0], name)),
                        )

    def _absorb_function(self, st: _RackState, fn: VirtualMacro) -> Tuple[bool, Set[int]]:
        """Classify one function's member read-backs. Returns whether the
        held kit value moved (and so wants a re-emit) and the notes of the
        pads whose deviation changed.

        The rules are :meth:`_reconcile_pitch`'s, in ``t`` space: a read
        equal to the pre-write value inside :data:`STALE_READ_WINDOW_MS`
        of our write is that write still landing (neither a vote nor an
        edit); a member whose last write sat at a rail cannot vote,
        because the clamp hid part of any move, and takes no deviation
        from one — the write that pinned it there already re-anchored its
        deviation to the rail (:meth:`_write_members`)."""
        touched: Set[int] = set()
        recs = st.edits.get(fn.name)
        if not recs or self._legacy_macro(st, fn) is not None:
            return False, touched
        held = st.values.get(fn.name)
        if held is None:
            return False, touched
        now = self._clock()
        window = STALE_READ_WINDOW_MS / 1000.0
        votes: Dict[float, int] = {}
        changed: List[Tuple[_MemberEdit, float, bool, float, int]] = []
        for m in st.members.get(fn.name) or ():
            if not m.enabled or not self._tracks_edits(fn, m):
                continue
            rec = recs.get((m.note, m.pname))
            if rec is None:
                continue
            cur = self._member_fn_value(m)
            if cur is None:
                continue
            if rec.written is None:
                rec.written = cur
                rec.written_at = now
                continue
            at_rail = rec.written <= DEV_EPSILON or rec.written >= 1.0 - DEV_EPSILON
            if abs(cur - rec.written) <= DEV_EPSILON:
                rec.prev = None
                if not at_rail:
                    votes[0.0] = votes.get(0.0, 0) + 1
                continue
            if (rec.prev is not None and abs(cur - rec.prev) <= DEV_EPSILON
                    and (now - rec.written_at) <= window):
                continue
            rec.prev = None
            delta = cur - rec.written
            changed.append((rec, delta, at_rail, cur, m.note))
            if not at_rail:
                key = round(delta, DEV_VOTE_DP)
                votes[key] = votes.get(key, 0) + 1
        if not changed:
            return False, touched
        move = 0.0
        if votes:
            top = max(votes.values())
            winners = [d for d, n in votes.items() if n == top]
            if len(winners) == 1 and abs(winners[0]) > DEV_EPSILON and top >= 2:
                move = winners[0]
        moved = False
        if move:
            new_held = _clamp(float(held) + move, 0.0, 1.0)
            if abs(new_held - float(held)) > DEV_EPSILON:
                st.values[fn.name] = new_held
                moved = True
                logger.debug(
                    "DrumVirtualMacroComponent: %s %s kit moved %+.3f in Live; "
                    "held -> %.3f", st.device_path, fn.name, move, new_held,
                )
        for rec, delta, at_rail, cur, note in changed:
            if move and at_rail:
                rec.written = cur
                continue
            if move:
                delta -= move
            if abs(delta) > DEV_EPSILON:
                rec.dev = _clamp(rec.dev + delta, -1.0, 1.0)
                touched.add(note)
            rec.written = cur
        return moved, touched
