"""Key detection on the surface (ADR-446) and Follow (ADR-447).

One verb. ``/looping/v3/session/scale/detect [apply:int]`` reads every
launched MIDI clip on a pitched track — the notes inside its loop, the
track's rail role (``looping.role``), whether it is a drum track — hands
them to :mod:`key_detect` and broadcasts the answer on
``/looping/v3/session/scale/detected``::

    [root:int, scale:str, band:str, gapPct:int,
     runnerRoot:int, runnerScale:str, pitchClasses:int,
     reasons:str, applied:int]

``root`` is ``-1`` and ``scale`` ``""`` when ``band`` is ``no-key``.
``pitchClasses`` is a 12-bit mask (bit 0 = C). ``reasons`` is the vote
ladder as text, ``" | "``-joined — the audit trail the UI shows.

With ``apply`` an int ``1`` (anything else, a float included, reads as 0)
and a key found, the key is written to Live through ``SessionComponent``'s
own handlers (root, scale name, scale mode on — exactly what the picker
sends) inside one undo step. ``applied`` is ``1`` only when Live reads the
key back afterwards: those handlers swallow a refused write, so their
returning says nothing. A ``no-key`` answer never writes.

Always answers on ``detected``, never on ``/looping/v3/error``: a set
with nothing to analyze is a performance state, not a protocol error.
Every LOM read is guarded; a track that raises is a track without a
clip. Drum tracks (``drum`` / ``perc`` role, or a ``DrumGroupDevice``
top-level or one rack deep) are skipped before their notes are read —
their notes are pad numbers, not pitches. A clip still recording is
skipped too: its notes are half a take.

Follow (ADR-447). While ``key_follow`` is on (``SessionSettingsComponent``,
default on) a pass runs whenever what is playing changes. The component
keeps no per-track listeners: ``PlayheadComponent`` already follows every
track's playing clip — the fresh-recording race included — and calls
``on_playing_change`` when it re-resolves one, when a take ends, and when
a clip's notes change. That call only schedules: launches, stops and takes
coalesce into one pass ~300 ms later, note changes into one ~1.5 s later,
both off the notification thread. A pass diffs what is playing against
what the last one analyzed (clips keyed by LOM identity, so a track
deleted above them moves nothing): a new clip, a finished take or a clip
whose loop moved to other material is an *add*; a clip gone, or one whose
notes changed in pitch class or timing, is a *correct*; nothing changed is
no pass at all — which is what Permute's
octave and mute steps come to, since the fingerprint is blind to both.
Unchanged clips are not re-read. ``key_detect.follow_decision`` then says
whether Live's key moves.

Who set the key. A key the interface sends (``scale_root`` /
``scale_name``, any client) is a hand: those two verbs are registered
here, turn Follow off, then delegate to ``SessionComponent``. A key changed
inside Live — the control bar's chooser, Push, Live's own undo — reaches
the ``scale_information`` listener and is classified a tick later, when
Live's undo history has settled: a redo waiting (``song.can_redo``) means
history navigation, which keeps Follow on; otherwise the key is Follow's
own (a redo that emptied the stack) or a hand's, which turns Follow off.

Selecting a clip is neither. Live 12 clips carry their own scale (set from
the song's when recorded), and selecting one — a tap on any clip cell in
the interface writes ``highlighted_clip_slot`` / ``detail_clip`` — makes
Live apply that clip's scale to the song (measured on 12.4.15b2). A key
change that arrives with a selection change and equals the selected clip's
scale is Live following the selection: Follow stays on, and when the key it
replaced was Follow's own, Follow writes that key back onto the song and
onto the clip, so selecting the clip again changes nothing.
"""

from __future__ import annotations

import logging

from . import path_resolver
from .drum_vm_functions import DRUM_RACK_CLASS_NAME
from .key_detect import (
    BAND_NO_KEY,
    EXCLUDED_ROLES,
    FOLLOW_ADD,
    FOLLOW_CORRECT,
    bar_ticks,
    detect,
    fingerprint,
    follow_decision,
    key_name,
    quantize_clip,
)
from .LOMListeners import _safe_int_id
from .TrackMetadataComponent import TRACK_ROLE_DATA_KEY, _coerce_str

logger = logging.getLogger("Looping.KeyDetect")

V3_SESSION_SCALE_DETECT_ADDRESS = "/looping/v3/session/scale/detect"
V3_SESSION_SCALE_DETECTED_ADDRESS = "/looping/v3/session/scale/detected"

#: The reasons string is one OSC arg in one datagram; leave room for the rest.
REASONS_MAX_CHARS = 1500

_LOM_ERRORS = (RuntimeError, AttributeError, TypeError, IndexError, ValueError)

#: Launches, stops and finished takes coalesce behind this delay (ms); one
#: ``schedule_message`` tick is ~100 ms.
FOLLOW_DELAY_MS = 300
#: Note changes are the slow lane: Permute writes at step rate while it runs,
#: and an edit is not urgent. One pass at most per this window.
EDIT_DELAY_MS = 1500
#: A key change inside Live is classified one tick later, once Live has
#: settled its undo history (``can_redo``).
CLASSIFY_DELAY_MS = 100

#: ``PlayheadComponent.add_change_callback`` kinds.
CHANGE_NOTES = "notes"


def _has_drum_rack(track):
    """A Drum Rack among the track's devices, top level or one rack deep.
    Guarded: a device that raises is not a Drum Rack."""
    for device in path_resolver._safe_devices(track):
        try:
            if getattr(device, "class_name", "") == DRUM_RACK_CLASS_NAME:
                return True
            if not bool(getattr(device, "can_have_chains", False)):
                continue
            for chain in list(getattr(device, "chains", []) or []):
                for inner in list(getattr(chain, "devices", []) or []):
                    if getattr(inner, "class_name", "") == DRUM_RACK_CLASS_NAME:
                        return True
        except _LOM_ERRORS:
            continue
    return False


def _read_loop(clip):
    """``(start, end)`` in beats of what the clip plays. Looping off, Live
    reports the start and end markers in ``loop_start`` / ``loop_end`` —
    measured on a MIDI clip (wire-protocol.md, ``playing_slot``), and what
    the playhead ships — so one read serves both."""
    return float(clip.loop_start), float(clip.loop_end)


def _read_notes(clip, start, end):
    """The clip's notes inside ``[start, end)`` as plain dicts, or ``None``
    when the LOM refused. ``get_notes_extended`` is the windowed four-arg
    form (Cycling '74's LOM docs); a wrong arity raises TypeError, which is in
    ``_LOM_ERRORS``."""
    try:
        specs = clip.get_notes_extended(0, 128, start, end - start)
    except _LOM_ERRORS as e:
        logger.warning("KeyDetect: get_notes_extended raised: %s", e)
        return None
    notes = []
    for n in specs or ():
        try:
            notes.append({
                "pitch": int(n.pitch),
                "start_time": float(n.start_time),
                "duration": float(n.duration),
            })
        except _LOM_ERRORS:
            continue
    return notes


def _fit_reasons(lines, limit):
    """The reason lines as one string of at most ``limit`` characters. The
    last three — the tonic votes, the verdict, Follow's decision — are what a
    reader needs, so when the ladder is too long the middle gives way."""
    text = " | ".join(lines)
    if len(text) <= limit:
        return text
    head, tail = lines[:-3], lines[-3:]
    kept = []
    budget = limit - len(" | ".join(tail)) - len(" | … | ")
    for line in head:
        if len(" | ".join(kept + [line])) > budget:
            break
        kept.append(line)
    return " | ".join(kept + ["…"] + tail)[:limit]


def _diff(before, now):
    """``(added, relooped, removed, edited)`` clip keys between two snapshots.
    A clip whose loop moved is *relooped* — the performer chose other
    material, which counts as a new loop — before it is *edited*."""
    added = [k for k in now if k not in before]
    removed = [k for k in before if k not in now]
    kept = [k for k in now if k in before]
    relooped = [k for k in kept if now[k]["loop"] != before[k]["loop"]]
    edited = [
        k for k in kept
        if k not in relooped
        and (now[k]["fp"] != before[k]["fp"] or now[k]["role"] != before[k]["role"])
    ]
    return added, relooped, removed, edited


class KeyDetectComponent:
    """See the module docstring."""

    def __init__(
        self, song, emit, session_component=None,
        is_following=None, follow_handler=None, schedule_delayed=None,
    ):
        """
        Args:
            song: the LOM song.
            emit: OSC sender ``(address, args)``.
            session_component: ``SessionComponent`` — the key is written
                through its three handlers (validation + echo), and the two
                wire verbs this component wraps delegate to it.
            is_following: zero-arg getter for the ``key_follow`` toggle
                (``SessionSettingsComponent.should_follow_key``). ``None``
                means Follow never runs.
            follow_handler: the toggle's set handler
                (``SessionSettingsComponent.handle_set_key_follow``): the
                component writes ``0`` through it when a hand sets the key.
            schedule_delayed: ``(ms, fn)`` — the surface's tick scheduler;
                ``None`` (tests) runs inline.
        """
        self._song = song
        self._emit = emit
        self._session = session_component
        self._is_following = is_following
        self._follow_handler = follow_handler
        self._schedule_delayed = schedule_delayed
        self._disconnected = False
        # Our own writes: ``_writing`` swallows a listener delivered during
        # them, ``_last_seen`` one delivered after (it is the key as read
        # when they finished), ``_last_written`` is the key Follow owns —
        # cleared whenever Follow turns off or on, so a key it wrote before
        # a hand took over is never mistaken for its own again.
        self._writing = False
        self._last_written = None
        self._last_seen = self._current_key()
        # A key change inside Live waiting for its classification tick, and
        # the key it replaced.
        self._pending_key = None
        self._key_before = None
        self._classify_pending = False
        # The selected clip moved since the last tick (``_on_selection``).
        self._selection_moved = False
        self._settle_pending = False
        # Follow passes: one pending per lane, a forced one after Follow
        # turns on, the tracks whose notes changed, and what the last pass
        # analyzed — ``{clip key: {"path", "loop", "role", "clip", "fp"}}``.
        self._pending = {"fast": False, "slow": False}
        self._force = False
        self._dirty = set()
        self._analyzed = {}
        self._last_broadcast = None
        self._scale_listener_bound = self._bind_scale_listener()
        self._selection_listeners = self._bind_selection_listeners()
        if self._following():
            # What is playing when the surface starts is not news.
            self._analyzed = self._snapshot(use_cache=False)
        logger.info(
            "KeyDetectComponent ready (follow=%s, %d clip(s) playing)",
            self._following(), len(self._analyzed),
        )

    # --- the verb -----------------------------------------------------------

    def handle_detect(self, args, source_addr):
        apply = self._apply_flag(args)
        self._classify()
        snapshot = self._snapshot(use_cache=False)
        if self._following():
            # The next Follow pass diffs against this fresh read.
            self._analyzed = snapshot
            self._dirty.clear()
        result = detect([e["clip"] for e in snapshot.values()], bar=self._bar_ticks())
        applied = False
        if apply and result["band"] != BAND_NO_KEY:
            applied = self._apply(result)
        self._emit_detected(result, applied)
        logger.info(
            "KeyDetect: detect %s (%s) clips=%d apply=%d applied=%d",
            key_name((result["root"], result["scale"])), result["band"],
            len(snapshot), apply, applied,
        )

    @staticmethod
    def _apply_flag(args):
        """``[apply]``: an int ``1`` (or ``True``) applies; anything else —
        a float, ``2``, a string, nothing — reads as detect-only."""
        if not args:
            return False
        raw = args[0]
        if isinstance(raw, bool):
            return raw
        return isinstance(raw, int) and raw == 1

    def _emit_detected(self, result, applied):
        reasons = _fit_reasons(result["reasons"], REASONS_MAX_CHARS)
        self._emit(V3_SESSION_SCALE_DETECTED_ADDRESS, (
            int(result["root"]), str(result["scale"]), str(result["band"]),
            round(result["gap"] * 100),
            int(result["runner_root"]), str(result["runner_scale"]),
            int(result["pitch_classes"]), reasons, int(bool(applied)),
        ))
        self._last_broadcast = (result["root"], result["scale"], result["band"])

    # --- the two wire verbs a hand sends -----------------------------------

    def handle_set_scale_root(self, args, source_addr):
        """``/looping/v3/session/scale_root`` from any client: a hand picked a
        key, so Follow turns off first; then the write, unchanged."""
        self._hand_picked()
        if self._session is not None:
            return self._session.handle_set_scale_root(args, source_addr)
        return None

    def handle_set_scale_name(self, args, source_addr):
        """``/looping/v3/session/scale_name`` from any client — see
        ``handle_set_scale_root``."""
        self._hand_picked()
        if self._session is not None:
            return self._session.handle_set_scale_name(args, source_addr)
        return None

    def _hand_picked(self):
        if self._disconnected or not self._following():
            return
        logger.info("KeyDetect: key picked from the interface: follow off")
        self._lock()

    # --- Follow (ADR-447) -----------------------------------------------------

    def handle_set_follow(self, args, source_addr):
        """``/looping/v3/session/key_follow [0|1]``: the settings handler
        validates, persists and echoes; turning Follow on runs a pass now,
        deciding as if everything playing were new."""
        if self._follow_handler is None:
            return
        was = self._following()
        self._follow_handler(args, source_addr)
        now = self._following()
        if was and not now:
            self._forget()
        elif now and not was:
            self._forget()
            self._force = True
            self._schedule_pass(slow=False)

    def on_playing_change(self, track_path, kind):
        """``PlayheadComponent``'s change hook. Called inside Live
        notifications, so it only marks and schedules."""
        if self._disconnected or not self._following():
            return
        if kind == CHANGE_NOTES:
            self._dirty.add(track_path)
            self._schedule_pass(slow=True)
        else:
            self._schedule_pass(slow=False)

    def _following(self):
        if self._is_following is None:
            return False
        try:
            return bool(self._is_following())
        except _LOM_ERRORS:
            return False

    def _lock(self):
        """Follow off, through the settings handler so it persists and
        echoes, and forget what Follow owned."""
        if self._follow_handler is not None:
            self._follow_handler((0,), None)
        self._forget()

    def _forget(self):
        self._last_written = None
        self._analyzed = {}
        self._dirty.clear()
        self._pending_key = None
        self._key_before = None
        self._classify_pending = False
        self._selection_moved = False
        self._force = False

    def _schedule(self, delay_ms, fn, what):
        """Run ``fn`` a tick or more later; ``False`` when the scheduler
        refused. Inline without a scheduler (tests)."""
        if self._schedule_delayed is None:
            fn()
            return True
        try:
            self._schedule_delayed(delay_ms, fn)
            return True
        except Exception as e:  # noqa: BLE001 — the framework's scheduler, not a LOM read
            logger.warning("KeyDetect: scheduling %s failed: %s", what, e)
            return False

    def _schedule_pass(self, slow):
        lane = "slow" if slow else "fast"
        if self._disconnected or self._pending[lane]:
            return
        self._pending[lane] = True

        def run(lane=lane):
            self._pending[lane] = False
            self._run_pass()

        if not self._schedule(EDIT_DELAY_MS if slow else FOLLOW_DELAY_MS, run, "a follow pass"):
            self._pending[lane] = False

    def _run_pass(self):
        if self._disconnected:
            return
        self._classify()
        if not self._following():
            return
        force, self._force = self._force, False
        before = self._analyzed
        now = self._snapshot(use_cache=True)
        self._dirty.clear()
        self._analyzed = now
        added, relooped, removed, edited = _diff(before, now)
        if not (added or relooped or removed or edited or force):
            return
        event = FOLLOW_ADD if (added or relooped or force) else FOLLOW_CORRECT
        result = detect([e["clip"] for e in now.values()], bar=self._bar_ticks())
        current = self._current_key()
        owned = current is not None and current == self._last_written
        write, why = follow_decision(result, current, event, owned)
        applied = self._apply(result) if write else False
        if write and not applied:
            why += " — but Live did not take it"
        what = ", ".join(part for part in (
            "follow turned on" if force else "",
            f"{len(added)} new" if added else "",
            f"{len(relooped)} re-looped" if relooped else "",
            f"{len(removed)} gone" if removed else "",
            f"{len(edited)} edited" if edited else "",
        ) if part)
        result["reasons"].append(f"follow ({what}): {why}")
        changed = self._last_broadcast != (result["root"], result["scale"], result["band"])
        if added or relooped or removed or force or applied or changed:
            self._emit_detected(result, applied)
            logger.info(
                "KeyDetect: follow (%s) %s (%s) clips=%d: %s",
                what, key_name((result["root"], result["scale"])), result["band"], len(now), why,
            )
        else:
            logger.debug("KeyDetect: follow (%s): %s", what, why)

    # --- who set the key ------------------------------------------------------

    def _bind_scale_listener(self):
        add = getattr(self._song, "add_scale_information_listener", None)
        if not callable(add):
            return False
        try:
            add(self._on_scale_information)
        except _LOM_ERRORS as e:
            logger.warning("KeyDetect: add_scale_information_listener failed: %s", e)
            return False
        return True

    def _on_scale_information(self):
        """The song's key changed (a notification: mark and schedule only)."""
        if self._disconnected or self._writing:
            return
        key = self._current_key()
        if key is None or key == self._last_seen:
            return  # a mode-only change, our own write, or nothing we can read
        before, self._last_seen = self._last_seen, key
        if not self._following():
            return
        self._pending_key = key
        if self._classify_pending:
            return
        self._key_before = before
        self._classify_pending = True
        if not self._schedule(CLASSIFY_DELAY_MS, self._classify, "a key classification"):
            self._classify_pending = False

    def _classify(self):
        """A key change inside Live, a tick after it happened. A pass and the
        verb run this first, so no write of ours lands before a hand's
        change has been read as one."""
        if not self._classify_pending:
            return
        self._classify_pending = False
        key, self._pending_key = self._pending_key, None
        before, self._key_before = self._key_before, None
        selection, self._selection_moved = self._selection_moved, False
        if key is None or self._disconnected or not self._following():
            return
        clip = self._selected_clip_in(key) if selection else None
        if clip is not None:
            logger.info(
                "KeyDetect: key followed the selected clip (%s): still following", key_name(key),
            )
            if before is not None and before == self._last_written:
                logger.info("KeyDetect: %s back on the song and the clip", key_name(before))
                self._apply({"root": before[0], "scale": before[1]}, stamp=clip)
            return
        if self._can_redo():
            logger.info(
                "KeyDetect: key moved by Live's undo or redo (%s): still following", key_name(key),
            )
            return
        if key == self._last_written:
            return  # the redo that lands back on Follow's own key
        logger.info("KeyDetect: key set by hand in Live (%s): follow off", key_name(key))
        self._lock()

    # --- the selected clip ----------------------------------------------------

    def _view(self):
        try:
            return self._song.view
        except _LOM_ERRORS:
            return None

    def _bind_selection_listeners(self):
        """``detail_clip`` and ``highlighted_clip_slot`` on ``song.view``: the
        interface writes one or the other on a clip tap. Returns the names
        bound."""
        view = self._view()
        bound = []
        for name in ("detail_clip", "highlighted_clip_slot"):
            add = getattr(view, f"add_{name}_listener", None)
            if not callable(add):
                continue
            try:
                add(self._on_selection)
                bound.append(name)
            except _LOM_ERRORS as e:
                logger.warning("KeyDetect: add_%s_listener failed: %s", name, e)
        return bound

    def _on_selection(self):
        """The selected clip moved (a notification: mark and schedule only).
        Live applies the clip's scale inside the same action, so the key
        change, if any, is in the same batch; the mark lasts until the tick
        after, or until the classification it belongs to reads it."""
        if self._disconnected:
            return
        self._selection_moved = True
        if self._settle_pending:
            return
        self._settle_pending = True
        if not self._schedule(CLASSIFY_DELAY_MS, self._settle_selection, "a selection settle"):
            self._settle_pending = False

    def _settle_selection(self):
        self._settle_pending = False
        if not self._classify_pending:
            self._selection_moved = False

    def _selected_clip_in(self, key):
        """The selected clip — the detail clip, else the highlighted slot's —
        whose own scale is ``key``; ``None`` when none is."""
        view = self._view()
        candidates = []
        try:
            candidates.append(view.detail_clip)
        except _LOM_ERRORS:
            pass
        try:
            slot = view.highlighted_clip_slot
            if slot is not None and bool(slot.has_clip):
                candidates.append(slot.clip)
        except _LOM_ERRORS:
            pass
        for clip in candidates:
            if clip is None:
                continue
            try:
                if (int(clip.root_note), str(clip.scale_name)) == key:
                    return clip
            except _LOM_ERRORS:
                continue
        return None

    def _can_redo(self):
        try:
            return bool(self._song.can_redo)
        except _LOM_ERRORS:
            return False

    # --- the reads ----------------------------------------------------------

    def _current_key(self):
        try:
            return int(self._song.root_note), str(self._song.scale_name)
        except _LOM_ERRORS:
            return None

    def _bar_ticks(self):
        try:
            return bar_ticks(self._song.signature_numerator, self._song.signature_denominator)
        except _LOM_ERRORS:
            return bar_ticks(4, 4)

    def _pitched_tracks(self):
        """``(index, track)`` for every regular MIDI track that is not a group."""
        for index, track in enumerate(path_resolver._safe_tracks_list(self._song) or []):
            try:
                if not bool(getattr(track, "has_midi_input", False)):
                    continue
                if bool(getattr(track, "is_foldable", False)):
                    continue
            except _LOM_ERRORS:
                continue
            yield index, track

    @staticmethod
    def _playing_midi_clip(track):
        try:
            index = int(getattr(track, "playing_slot_index", -1))
            if index < 0:
                return None
            slot = track.clip_slots[index]
            if not bool(getattr(slot, "has_clip", False)):
                return None
            clip = slot.clip
            return clip if bool(getattr(clip, "is_midi_clip", False)) else None
        except _LOM_ERRORS:
            return None

    @staticmethod
    def _is_recording(clip):
        try:
            return bool(getattr(clip, "is_recording", False))
        except _LOM_ERRORS:
            return False

    @staticmethod
    def _role(track):
        try:
            return _coerce_str(track.get_data(TRACK_ROLE_DATA_KEY, ""))
        except _LOM_ERRORS:
            return ""

    def _snapshot(self, use_cache):
        """What is playing now: ``{clip key: entry}`` for every launched,
        finished MIDI clip on a pitched, non-drum track. The key is the
        clip's LOM identity (its path when unreadable). With ``use_cache``
        a clip whose identity, loop and role are unchanged and whose track
        saw no notes change is taken from the last pass, not re-read."""
        previous = self._analyzed if use_cache else {}
        out = {}
        for index, track in self._pitched_tracks():
            path = f"tracks/{index}"
            clip = self._playing_midi_clip(track)
            if clip is None or self._is_recording(clip):
                continue
            role = self._role(track)
            if role in EXCLUDED_ROLES or _has_drum_rack(track):
                continue
            try:
                loop = _read_loop(clip)
            except _LOM_ERRORS:
                continue
            cid = _safe_int_id(clip)
            key = cid if cid is not None else ("path", path)
            cached = previous.get(key)
            if (cached is not None and cached["loop"] == loop and cached["role"] == role
                    and path not in self._dirty):
                out[key] = dict(cached, path=path)
                continue
            notes = _read_notes(clip, *loop)
            if notes is None:
                continue
            quantized = quantize_clip(role, loop[0], loop[1], notes)
            out[key] = {
                "path": path, "loop": loop, "role": role,
                "clip": quantized, "fp": fingerprint(quantized),
            }
        return out

    # --- the write ----------------------------------------------------------

    def _apply(self, result, stamp=None):
        """Root, scale name, scale mode on — through the session handlers
        when there are any (validation + echo), else straight to the song —
        inside one undo step. True only when Live reads the key back.
        ``stamp``, a clip, gets the same root and scale name first."""
        root, scale = int(result["root"]), str(result["scale"])
        song = self._song
        opened = False
        self._writing = True
        try:
            try:
                song.begin_undo_step()
                opened = True
            except _LOM_ERRORS as e:
                logger.warning("KeyDetect: begin_undo_step raised: %s", e)
            if stamp is not None:
                try:
                    stamp.root_note = root
                    stamp.scale_name = scale
                except _LOM_ERRORS as e:
                    logger.warning("KeyDetect: writing %s to the clip raised: %s", key_name((root, scale)), e)
            try:
                if self._session is not None:
                    self._session.handle_set_scale_root((root,), None)
                    self._session.handle_set_scale_name((scale,), None)
                    self._session.handle_set_scale_mode((1,), None)
                else:
                    song.root_note = root
                    song.scale_name = scale
                    song.scale_mode = True
            except _LOM_ERRORS as e:
                logger.warning("KeyDetect: writing %s raised: %s", key_name((root, scale)), e)
        finally:
            self._writing = False
            if opened:
                try:
                    song.end_undo_step()
                except _LOM_ERRORS as e:
                    logger.warning("KeyDetect: end_undo_step raised: %s", e)
        after = self._current_key()
        self._last_seen = after
        if after != (root, scale):
            logger.warning(
                "KeyDetect: Live did not take %s (reads %s)", key_name((root, scale)), key_name(after),
            )
            return False
        self._last_written = after
        return True

    def disconnect(self):
        """Drop the song and view listeners and every pending pass; safe to
        call twice."""
        if self._disconnected:
            return
        self._disconnected = True
        self._forget()
        if self._scale_listener_bound:
            remove = getattr(self._song, "remove_scale_information_listener", None)
            if callable(remove):
                try:
                    remove(self._on_scale_information)
                except _LOM_ERRORS:
                    pass
            self._scale_listener_bound = False
        view = self._view() if self._selection_listeners else None
        for name in self._selection_listeners:
            remove = getattr(view, f"remove_{name}_listener", None)
            if callable(remove):
                try:
                    remove(self._on_selection)
                except _LOM_ERRORS:
                    pass
        self._selection_listeners = []
