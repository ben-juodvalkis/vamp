"""SessionComponent — tempo + PR-5d transport expansion.

Owns the song-scoped ``/looping/v3/session/*`` address family plus the
legacy ``/looping/session/tempo`` + ``/live/song/{get,set}/tempo``
addresses that Gate 2/3 shipped. Per
[03-target-architecture.md §5.1]: one component for every song-level
attribute. Track-scoped listeners belong to TrackMetadataComponent;
master-scoped to MasterComponent.

Gate 2/3 (shipped before PR-5d)
-------------------------------

- ``song.tempo`` listener with one-shot echo suppression.
- ``/live/song/get/tempo`` reply.
- ``/live/song/set/tempo [bpm]`` with 20–999 validate-and-reject.

These stay exactly as shipped. The suppression flag is the
tempo-drag adaptation (UI drags produce ~60 writes/sec which LOM
debounces to one settling fire); the pattern predates the PR-5b
"trust the listener echo" discipline that the PR-5d attrs below
follow.

PR-5d — 12 song-scoped attributes + 3 commands
----------------------------------------------

New attrs (one listener per, same 1:1 pattern as tempo):

    is_playing, metronome, session_record, loop, loop_start,
    loop_length, signature_numerator, signature_denominator,
    root_note, scale_name, scale_mode, groove_amount

(``groove_amount`` was added in ROW 6.8 to retire the M4L
``/looping/session/groove_amount`` observer; same listener-attach +
init-emit + on-accept-emit shape as the rest, ``float_unit`` wire.
``clip_trigger_quantization`` — Live's global launch quantization —
followed in 2026-07-27 with the same shape, ``int_trigger_quant`` wire,
plus the ``_ECHO_ON_WRITE`` fallback described below.)

New commands (no listeners — state-change attrs above carry the
resulting state back on the wire):

    play_cmd   → song.start_playing()
    stop_cmd   → song.stop_playing()
    continue_cmd → song.continue_playing()

Wire shapes at
[phase-5-plan.md §3.5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/phase-5-plan.md#35-pr-5d--sessioncomponent-transport-expansion).
Inbound from UI: ``/looping/v3/session/<attr> [value]``. Outbound from
surface: identical address + arg. Commands are fire-and-forget
``[]``.

**No echo suppression for PR-5d attrs.** Per the PR-5b pattern:
optimistic UI state for song-global attributes is rare (the session
header reads LOM back through the listener anyway), so the one extra
emission per UI-originated write is dwarfed by the already-in-flight
fire rate. Trusting the echo keeps the code simple and matches
MasterComponent / MetersComponent. Tempo keeps its pre-existing
suppression flag because Gate 3 already shipped + lived-validated
with it; pulling it out is a separate, risk-for-risk change.

**Init-emit after listener attach.** ``state/full`` does NOT carry
session-level attributes (the full-tree emission is track-scoped;
see [03 §5] for the record shape). Without a seed emit the UI's
session-store ``$derived`` would stall on its default until the user
touches something in Live. ``_emit_initial_values()`` runs once at
``__init__`` after listener attach and writes every attr through the
same address the listener fires would use. Closes the cold-start
gap — matches MetersComponent + MasterComponent.

**LOM-touch guard.** Every attribute read, write, and listener
attach is wrapped in ``(RuntimeError, AttributeError)`` per the
Live 12 property-access quirks documented in
``project_live_lom_quirks.md``. Warnings de-dupe through
``_warn_once(key, context)`` so a broken attribute doesn't flood
Log.txt at the listener fire rate. Same guard shape as
MasterComponent.

**No structural-rebind concern.** Session attrs are song-scoped, not
track-scoped — the ``song`` object is stable across Live's lifetime.
We attach listeners once at ``__init__`` and detach once at
``disconnect``. No ``on_structural_change`` hook needed.

Validation contract
-------------------

Validate-and-reject, never clamp — same shape as
``handle_set_tempo`` / MasterComponent.

- ``is_playing``, ``metronome``, ``session_record``, ``loop``,
  ``scale_mode``: bool-on-LOM, int-on-wire (0 or 1). Other ints
  coerced to bool; strings / NaN rejected.
- ``loop_start``, ``loop_length``: float beats. ``loop_start ≥ 0``,
  ``loop_length > 0``. NaN rejected. No upper bound — Live clamps
  its own.
- ``signature_numerator``: int, ``1 ≤ v ≤ 99``. LOM's own range.
- ``signature_denominator``: int in ``{1, 2, 4, 8, 16}``.
  Live rejects other values with a noisy warning box; we reject
  silently on the wire.
- ``root_note``: int, ``0 ≤ v ≤ 11``.
- ``scale_name``: string, one of Live's 35 names (``key_detect.
  LIVE_SCALE_NAMES``, read back from the artifact). An unknown name
  written to ``song.scale_name`` does not raise — Live silently falls
  back to Major (measured 2026-09-19, ADR-446) — so the guard is here.
- ``groove_amount``: float, ``0.0 ≤ v ≤ 1.0``. NaN rejected.
  Out-of-range rejected (Live's own range — values outside it have
  no audible effect anyway).
- ``clip_trigger_quantization``: int, ``0 ≤ v ≤ 13``. Live's enum
  (0 None, 1 "8 Bars" … 13 "1/32").
- Commands: ignore any args (the LOM method takes none).

Listener-less fallback (``_ECHO_ON_WRITE``)
-------------------------------------------

Live 12 has a habit of exposing attributes that are observable on
paper and listener-less in practice (``Groove.base``,
``Track.fold_state``). The table's normal contract — trust the
listener echo, skip seeding attrs whose attach failed — turns that
quirk into a permanently blind UI control. Attrs named in
``_ECHO_ON_WRITE`` opt out: they seed on init / on-accept regardless
of attach, and their write handler emits its own echo when no
listener is holding the address. ``clip_trigger_quantization`` is
the first member. If Live's log line
"SessionComponent PR-5d bound N/M" shows a full count, the listener
attached and the fallback is inert. See ADR-411.

Decoupling from Live-side I/O
-----------------------------

As with tempo, the component takes ``song`` + ``emit`` at
construction and drives every new attr's listener through
``add_<attr>_listener`` / ``remove_<attr>_listener``. The tests use
an extended ``StubSong`` that mimics the same contract per-attr;
see ``tests/test_session_component.py``.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Callable, Dict, List, Optional, Tuple

from .key_detect import LIVE_SCALE_NAMES

logger = logging.getLogger("looping")


# --- wire addresses (closed-enum; renames fail at import time) ------------

# Legacy Gate-2/3 tempo addresses — wire-compatible with pre-v3 UI paths.
TEMPO_OBSERVER_ADDRESS = "/looping/session/tempo"

# PR-5d v3 session addresses.
V3_SESSION_IS_PLAYING_ADDRESS = "/looping/v3/session/is_playing"
V3_SESSION_METRONOME_ADDRESS = "/looping/v3/session/metronome"
V3_SESSION_SESSION_RECORD_ADDRESS = "/looping/v3/session/session_record"
V3_SESSION_LOOP_ADDRESS = "/looping/v3/session/loop"
V3_SESSION_LOOP_START_ADDRESS = "/looping/v3/session/loop_start"
V3_SESSION_LOOP_LENGTH_ADDRESS = "/looping/v3/session/loop_length"
V3_SESSION_SIGNATURE_NUM_ADDRESS = "/looping/v3/session/signature_num"
V3_SESSION_SIGNATURE_DEN_ADDRESS = "/looping/v3/session/signature_den"
V3_SESSION_SCALE_ROOT_ADDRESS = "/looping/v3/session/scale_root"
V3_SESSION_SCALE_NAME_ADDRESS = "/looping/v3/session/scale_name"
V3_SESSION_SCALE_MODE_ADDRESS = "/looping/v3/session/scale_mode"
V3_SESSION_GROOVE_AMOUNT_ADDRESS = "/looping/v3/session/groove_amount"
V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS = (
    "/looping/v3/session/clip_trigger_quantization"
)
V3_SESSION_PLAY_CMD_ADDRESS = "/looping/v3/session/play_cmd"
V3_SESSION_STOP_CMD_ADDRESS = "/looping/v3/session/stop_cmd"
V3_SESSION_CONTINUE_CMD_ADDRESS = "/looping/v3/session/continue_cmd"

# Song position in beats. Deliberately NOT a `_PR5D_ATTRS` entry:
# `current_song_time` fires on every LOM tick while the transport runs,
# and that table emits on every fire. This one rides a throttle instead
# (see `_SONG_TIME_WINDOW_SEC`).
V3_SESSION_SONG_TIME_ADDRESS = "/looping/v3/session/song_time"

# 10 Hz. The consumer is a bars.beats READOUT, not a moving playhead —
# `PlayheadComponent` runs at 30 Hz because it drives a marker sweeping
# across a clip, where a slower rate reads as a stutter. Text ticking
# ten times a second is already faster than anyone reads it, and the
# beat digit only changes a few times a second at any sane tempo.
_SONG_TIME_WINDOW_SEC = 0.1


# --- attribute table ------------------------------------------------------
#
# Each entry: ``(attr_name, lom_attr, wire_type, address)``. ``attr_name``
# is the identity used for ``_warn_once`` keys and listener-method lookup;
# ``lom_attr`` is what lands on ``song``. They differ for the
# signature/scale rows where the wire label omits the LOM suffix
# (``signature_num`` vs ``signature_numerator``). ``wire_type`` drives
# the parse/validate path in ``handle_set``:
#
#   bool01: int 0/1 on wire, bool on LOM. arm/mute/solo/loop shape.
#   int_sig_num: int, 1..99 inclusive.
#   int_sig_den: int, one of {1, 2, 4, 8, 16}.
#   int_root: int, 0..11 inclusive.
#   int_trigger_quant: int, 0..13 inclusive (Live's launch-quantization
#     enum — 0 None, 1 "8 Bars" … 13 "1/32").
#   float_nonneg: float ≥ 0. loop_start.
#   float_positive: float > 0. loop_length.
#   scale_name: string, one of Live's 35 scale names (LIVE_SCALE_NAMES).

_WIRE_BOOL01 = "bool01"
_WIRE_INT_SIG_NUM = "int_sig_num"
_WIRE_INT_SIG_DEN = "int_sig_den"
_WIRE_INT_ROOT = "int_root"
_WIRE_INT_TRIGGER_QUANT = "int_trigger_quant"
_WIRE_FLOAT_NONNEG = "float_nonneg"
_WIRE_FLOAT_POSITIVE = "float_positive"
_WIRE_FLOAT_UNIT = "float_unit"
_WIRE_SCALE_NAME = "scale_name"

_VALID_SIG_DENS = (1, 2, 4, 8, 16)
# ``song.clip_trigger_quantization`` enum bound. Live 12 exposes 14
# values; see docs/reference/lom-reference.md "Quantization Values".
_TRIGGER_QUANT_MAX = 13

# Attrs that must still seed + echo when their LOM listener fails to
# attach. Live 12 has form here: ``Groove.base`` and ``Track.fold_state``
# are both observable on paper and listener-less in practice, and an
# attr with no listener gets skipped by ``_emit_all_pr5d`` — leaving the
# UI control permanently blind. For these, the seed emit runs regardless
# and the write handler emits its own echo, so the control works either
# way. Costs one extra emit per write on the (expected) path where the
# listener *did* attach — hence the membership check, not an
# unconditional echo.
_ECHO_ON_WRITE = frozenset({"clip_trigger_quantization"})

# ``(attr_name, lom_attr, wire_type, address)``.
_PR5D_ATTRS: Tuple[Tuple[str, str, str, str], ...] = (
    ("is_playing", "is_playing", _WIRE_BOOL01,
     V3_SESSION_IS_PLAYING_ADDRESS),
    ("metronome", "metronome", _WIRE_BOOL01,
     V3_SESSION_METRONOME_ADDRESS),
    ("session_record", "session_record", _WIRE_BOOL01,
     V3_SESSION_SESSION_RECORD_ADDRESS),
    ("loop", "loop", _WIRE_BOOL01,
     V3_SESSION_LOOP_ADDRESS),
    ("loop_start", "loop_start", _WIRE_FLOAT_NONNEG,
     V3_SESSION_LOOP_START_ADDRESS),
    ("loop_length", "loop_length", _WIRE_FLOAT_POSITIVE,
     V3_SESSION_LOOP_LENGTH_ADDRESS),
    ("signature_num", "signature_numerator", _WIRE_INT_SIG_NUM,
     V3_SESSION_SIGNATURE_NUM_ADDRESS),
    ("signature_den", "signature_denominator", _WIRE_INT_SIG_DEN,
     V3_SESSION_SIGNATURE_DEN_ADDRESS),
    ("scale_root", "root_note", _WIRE_INT_ROOT,
     V3_SESSION_SCALE_ROOT_ADDRESS),
    ("scale_name", "scale_name", _WIRE_SCALE_NAME,
     V3_SESSION_SCALE_NAME_ADDRESS),
    ("scale_mode", "scale_mode", _WIRE_BOOL01,
     V3_SESSION_SCALE_MODE_ADDRESS),
    ("groove_amount", "groove_amount", _WIRE_FLOAT_UNIT,
     V3_SESSION_GROOVE_AMOUNT_ADDRESS),
    ("clip_trigger_quantization", "clip_trigger_quantization",
     _WIRE_INT_TRIGGER_QUANT, V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS),
)


class SessionComponent:
    """Observes song-scoped LOM attributes; owns their OSC address family.

    Args:
        song: The Live ``Song`` object
            (``Live.Application.get_application().get_document()``).
            In tests, a stub with the observed attributes plus
            ``add_<attr>_listener(cb)`` / ``remove_<attr>_listener(cb)``.
        emit: Callable ``(address: str, args: tuple) -> None`` that
            sends an OSC message. In production ``OSCTransport.send``;
            in tests, ``list.append``.

    Lifecycle:
        ``__init__`` attaches the tempo listener + every PR-5d listener
        synchronously, then seeds the PR-5d attrs with one init emit
        each. ``disconnect`` detaches all listeners. Idempotent.
    """

    TEMPO_OBSERVER_ADDRESS = TEMPO_OBSERVER_ADDRESS

    # LOM property bounds for ``song.tempo``. AbletonOSC-matching
    # validate-and-reject — see Gate 3 rationale in the original
    # docstring. Kept as class attributes for the test suite.
    TEMPO_MIN_BPM = 20.0
    TEMPO_MAX_BPM = 999.0

    # Re-exposed for tests that want to iterate without re-importing.
    PR5D_ATTRS = _PR5D_ATTRS

    def __init__(self, song, emit):
        self._song = song
        self._emit = emit
        self._disconnected = False

        # PR-5d listener bookkeeping. ``_pr5d_listeners[attr_name]`` is
        # the bound callback — stashed so ``disconnect`` removes exactly
        # what was attached.
        self._pr5d_listeners: Dict[str, Callable[[], None]] = {}

        # ``(attr_name, context)`` → True once warned, so a broken
        # attribute does not flood Log.txt at listener-fire rate.
        self._warned: set = set()

        # Gate 2 tempo listener — unchanged.
        self._song.add_tempo_listener(self._on_tempo_changed)
        logger.info(
            "SessionComponent attached tempo listener (initial=%.4f)",
            self._song.tempo,
        )

        # Song position. Its own listener rather than a `_PR5D_ATTRS`
        # row, because it fires continuously while the transport runs
        # and has to be throttled.
        self._last_song_time_emit = 0.0
        self._song_time_cb: Optional[Callable[[], None]] = None
        self._bind_song_time_listener()

        # PR-5d listeners. Failures on individual attrs do not block
        # the rest — a future Live that removes one attribute should
        # still boot the other ten.
        self._bind_pr5d_listeners()
        self._emit_initial_values()

        # Seed position last: the PR-5d seed sequence is a pinned
        # contract, so a new channel appends to it rather than pushing
        # in at the front. Seeded at all so a UI connecting to a STOPPED
        # transport shows where the playhead actually is, not bar 1.
        if self._song_time_cb is not None:
            self._emit_song_time(force=True)

        logger.info(
            "SessionComponent PR-5d bound %d/%d song attributes",
            len(self._pr5d_listeners), len(_PR5D_ATTRS),
        )

    # --- tempo ------------------------------------------------------------

    def _on_tempo_changed(self):
        """Fires when Live's tempo changes. Emits the observer message.

        Called by LOM on the main thread (same thread the tick runs
        on) so no locking is needed. The callback takes no arguments
        — LOM listeners are notifications, not value-passers; we read
        ``song.tempo`` back on fire.

        Echoes from our own writes are not suppressed: the UI store
        only updates from this listener, so swallowing the echo
        leaves a dragged tempo readout stuck. Same "trust the listener
        echo" pattern as the PR-5d attrs.
        """
        try:
            bpm = self._song.tempo
        except Exception as e:
            logger.warning("SessionComponent tempo read failed: %s", e)
            return
        self._emit(TEMPO_OBSERVER_ADDRESS, (float(bpm),))

    def handle_get_tempo(self, args, source_addr):
        """``/live/song/get/tempo`` → reply ``[bpm]`` on the same address."""
        try:
            bpm = self._song.tempo
        except Exception as e:
            logger.warning("SessionComponent handle_get_tempo read failed: %s", e)
            return None
        return (float(bpm),)

    def handle_set_tempo(self, args, source_addr):
        """``/live/song/set/tempo [bpm]`` — write ``song.tempo``."""
        if not args:
            logger.warning(
                "SessionComponent set_tempo: empty args, ignoring",
            )
            return None
        try:
            bpm = float(args[0])
        except (TypeError, ValueError) as e:
            logger.warning(
                "SessionComponent set_tempo: bad arg %r: %s",
                args[0], e,
            )
            return None

        if bpm != bpm or bpm < self.TEMPO_MIN_BPM or bpm > self.TEMPO_MAX_BPM:
            logger.warning(
                "SessionComponent set_tempo: %r out of range [%.1f, %.1f]; rejecting",
                bpm, self.TEMPO_MIN_BPM, self.TEMPO_MAX_BPM,
            )
            return None

        try:
            self._song.tempo = bpm
        except Exception as e:
            logger.error(
                "SessionComponent set_tempo: assignment to %.4f raised: %s",
                bpm, e,
            )
        return None

    # --- PR-5d listener attach / detach -----------------------------------

    def _bind_pr5d_listeners(self) -> None:
        """Attach one listener per PR-5d attr. Skip-with-warning on failure."""
        for attr_name, lom_attr, _wire_type, address in _PR5D_ATTRS:
            add = getattr(
                self._song, "add_%s_listener" % lom_attr, None,
            )
            if not callable(add):
                self._warn_once(
                    attr_name, "attach-missing",
                    AttributeError(
                        "no add_%s_listener on song" % lom_attr,
                    ),
                )
                continue
            cb = self._make_listener(
                attr_name=attr_name,
                lom_attr=lom_attr,
                wire_type=_wire_type_from_entry(attr_name),
                address=address,
            )
            try:
                add(cb)
            except (RuntimeError, AttributeError) as e:
                self._warn_once(attr_name, "attach", e)
                continue
            self._pr5d_listeners[attr_name] = cb

    # --- song position ----------------------------------------------------

    def _bind_song_time_listener(self) -> None:
        """Attach the throttled ``current_song_time`` listener.

        The UI's transport header showed a frozen ``1.1.0`` before this
        existed: nothing on the v3 wire carried song position at all,
        so its readout sat on the store's cold-start zero forever.

        Missing-attribute failures are warned once and skipped, same
        posture as the PR-5d attach walk — a Live that drops the
        listener should still boot everything else.
        """
        add = getattr(self._song, "add_current_song_time_listener", None)
        if not callable(add):
            self._warn_once(
                "song_time", "attach-missing",
                AttributeError("no add_current_song_time_listener on song"),
            )
            return
        cb = self._on_song_time_changed
        try:
            add(cb)
        except (RuntimeError, AttributeError) as e:
            self._warn_once("song_time", "attach", e)
            return
        self._song_time_cb = cb

    def _on_song_time_changed(self) -> None:
        self._emit_song_time(force=False)

    def _emit_song_time(self, force: bool) -> None:
        """Read + emit position, at most once per throttle window."""
        if self._disconnected:
            return
        if not force:
            now = time.monotonic()
            if now - self._last_song_time_emit < _SONG_TIME_WINDOW_SEC:
                return
            self._last_song_time_emit = now
        else:
            self._last_song_time_emit = time.monotonic()
        try:
            beats = float(self._song.current_song_time)
        except (RuntimeError, AttributeError, TypeError, ValueError) as e:
            self._warn_once("song_time", "fire-read", e)
            return
        try:
            self._emit(V3_SESSION_SONG_TIME_ADDRESS, (beats,))
        except Exception as e:
            self._warn_once("song_time", "emit", e)

    def _make_listener(
        self,
        attr_name: str,
        lom_attr: str,
        wire_type: str,
        address: str,
    ) -> Callable[[], None]:
        """Build the no-arg callback LOM passes to ``add_<attr>_listener``."""

        def _fire() -> None:
            if self._disconnected:
                return
            try:
                raw = getattr(self._song, lom_attr)
            except (RuntimeError, AttributeError) as e:
                self._warn_once(attr_name, "fire-read", e)
                return
            wire_args = _encode_wire(wire_type, raw)
            if wire_args is None:
                self._warn_once(
                    attr_name, "fire-encode",
                    ValueError("could not encode %r" % (raw,)),
                )
                return
            self._emit(address, wire_args)

        return _fire

    def _emit_initial_values(self) -> None:
        """Emit one seed message per PR-5d attr after listener attach.

        State/full does not carry these. Without a seed, the UI sits
        on its default until the user touches the control in Live.

        This path fires once at ``__init__``, **before** the UI is
        connected on cold-start. The UI will not see those packets;
        the separate ``emit_on_accept`` path re-emits after the
        handshake accept to close the cold-start gap.
        """
        self._emit_all_pr5d("init")

    def emit_on_accept(self) -> None:
        """Re-emit every PR-5d attr after handshake accept.

        State/full is track-scoped (tracks, devices, params) — it does
        not carry song-scoped session attrs. Without this re-emit, a
        UI connecting after Live boot would miss the seed burst that
        fires at surface ``__init__`` and sit on default values (e.g.
        ``metronome=false``) even when Live is actually ``true``. The
        first UI click then computes the inverted write off stale
        state, Live sees its own current value, no listener fire,
        UI stays stale — the bug operator caught during PR-5d live
        validation.

        Called from ``LoopingSurface`` via the handshake accept hook;
        piggybacks on the existing ``V3StateFullComponent.emit_on_accept``
        wiring (see ``LoopingSurface._wire_handshake_accept_chain``).

        Includes tempo — it's the one session attr that DOES have a
        UI read-back path via ``/live/song/get/tempo``, but emitting
        here is cheap and symmetrical and avoids relying on the UI
        to query separately.
        """
        try:
            bpm = float(self._song.tempo)
        except (RuntimeError, AttributeError) as e:
            logger.warning(
                "SessionComponent on_accept: tempo read failed: %s", e,
            )
        else:
            self._emit(TEMPO_OBSERVER_ADDRESS, (bpm,))
        self._emit_all_pr5d("on_accept")

    def _emit_all_pr5d(self, context: str) -> None:
        """Shared body for ``_emit_initial_values`` + ``emit_on_accept``.

        Iterates the table, reads each attr under the LOM-touch guard,
        encodes per wire_type, emits. Listener-attach failures from
        earlier are honored (attrs with no attached listener skip here
        too, since reading them will also fail) — except the
        ``_ECHO_ON_WRITE`` attrs, which are readable-but-unobservable by
        design and seed anyway.
        """
        for attr_name, lom_attr, wire_type, address in _PR5D_ATTRS:
            if (attr_name not in self._pr5d_listeners
                    and attr_name not in _ECHO_ON_WRITE):
                # Listener attach failed; don't bother reading the attr.
                continue
            self._emit_attr(attr_name, lom_attr, wire_type, address, context)

    def _emit_attr(
        self,
        attr_name: str,
        lom_attr: str,
        wire_type: str,
        address: str,
        context: str,
    ) -> None:
        """Read one PR-5d attr under the LOM guard, encode, emit.

        Shared by the seed loop and the listener-less write echo.
        """
        try:
            raw = getattr(self._song, lom_attr)
        except (RuntimeError, AttributeError) as e:
            self._warn_once(attr_name, "%s-read" % context, e)
            return
        wire_args = _encode_wire(wire_type, raw)
        if wire_args is None:
            self._warn_once(
                attr_name, "%s-encode" % context,
                ValueError("could not encode %r" % (raw,)),
            )
            return
        self._emit(address, wire_args)

    def _echo_if_listenerless(self, attr_name: str) -> None:
        """Emit ``attr_name``'s current value when nothing else will.

        A LOM listener produces the post-write echo for every other
        PR-5d attr. When the attach failed there is no such fire, so the
        write path has to publish its own — otherwise the UI's
        optimistic value never reconciles and an out-of-range write that
        Live silently ignores would leave the control lying.
        """
        if attr_name in self._pr5d_listeners:
            return
        for name, lom_attr, wire_type, address in _PR5D_ATTRS:
            if name == attr_name:
                self._emit_attr(
                    name, lom_attr, wire_type, address, "write-echo",
                )
                return

    # --- PR-5d write handlers ---------------------------------------------

    def handle_set_is_playing(self, args, source_addr):
        return self._handle_set_bool01("is_playing", args)

    def handle_set_metronome(self, args, source_addr):
        return self._handle_set_bool01("metronome", args)

    def handle_set_session_record(self, args, source_addr):
        return self._handle_set_bool01("session_record", args)

    def handle_set_loop(self, args, source_addr):
        return self._handle_set_bool01("loop", args)

    def handle_set_loop_start(self, args, source_addr):
        return self._handle_set_float("loop_start", args, _WIRE_FLOAT_NONNEG)

    def handle_set_loop_length(self, args, source_addr):
        return self._handle_set_float(
            "loop_length", args, _WIRE_FLOAT_POSITIVE,
        )

    def handle_set_signature_num(self, args, source_addr):
        return self._handle_set_int_sig_num("signature_numerator", args)

    def handle_set_signature_den(self, args, source_addr):
        return self._handle_set_int_sig_den("signature_denominator", args)

    def handle_set_scale_root(self, args, source_addr):
        return self._handle_set_int_root("root_note", args)

    def handle_set_scale_name(self, args, source_addr):
        return self._handle_set_scale_name(args)

    def handle_set_scale_mode(self, args, source_addr):
        return self._handle_set_bool01("scale_mode", args)

    def handle_set_groove_amount(self, args, source_addr):
        return self._handle_set_float("groove_amount", args, _WIRE_FLOAT_UNIT)

    def handle_set_clip_trigger_quantization(self, args, source_addr):
        return self._handle_set_int_trigger_quant(
            "clip_trigger_quantization", args,
        )

    # --- PR-5d command handlers -------------------------------------------
    #
    # Play / stop / continue are verbs, not setters — LOM methods that
    # take no args. Extra args on the wire are ignored (fire-and-forget).

    def handle_play_cmd(self, args, source_addr):
        return self._invoke_song_method("start_playing")

    def handle_stop_cmd(self, args, source_addr):
        return self._invoke_song_method("stop_playing")

    def handle_continue_cmd(self, args, source_addr):
        return self._invoke_song_method("continue_playing")

    # --- handler helpers --------------------------------------------------

    def _handle_set_bool01(self, lom_attr: str, args) -> None:
        """Parse 0/1 (or coerce int/bool) and write to ``song.<lom_attr>``."""
        if not args:
            logger.warning(
                "SessionComponent set %s: empty args, ignoring", lom_attr,
            )
            return None
        raw = args[0]
        if isinstance(raw, bool):
            val = raw
        else:
            try:
                as_int = int(raw)
            except (TypeError, ValueError) as e:
                logger.warning(
                    "SessionComponent set %s: bad arg %r: %s",
                    lom_attr, raw, e,
                )
                return None
            if as_int not in (0, 1):
                # Any non-zero int means True on LOM, but the wire
                # contract is explicit 0/1. Reject to catch UI bugs
                # early rather than silently round.
                logger.warning(
                    "SessionComponent set %s: %r not in {0,1}; rejecting",
                    lom_attr, raw,
                )
                return None
            val = bool(as_int)
        self._write_lom(lom_attr, val)
        return None

    def _handle_set_float(
        self, lom_attr: str, args, wire_type: str,
    ) -> None:
        if not args:
            logger.warning(
                "SessionComponent set %s: empty args, ignoring", lom_attr,
            )
            return None
        try:
            val = float(args[0])
        except (TypeError, ValueError) as e:
            logger.warning(
                "SessionComponent set %s: bad arg %r: %s",
                lom_attr, args[0], e,
            )
            return None
        if math.isnan(val):
            logger.warning(
                "SessionComponent set %s: NaN rejected", lom_attr,
            )
            return None
        if wire_type == _WIRE_FLOAT_NONNEG and val < 0.0:
            logger.warning(
                "SessionComponent set %s: %.6f negative; rejecting",
                lom_attr, val,
            )
            return None
        if wire_type == _WIRE_FLOAT_POSITIVE and val <= 0.0:
            logger.warning(
                "SessionComponent set %s: %.6f non-positive; rejecting",
                lom_attr, val,
            )
            return None
        if wire_type == _WIRE_FLOAT_UNIT and (val < 0.0 or val > 1.0):
            logger.warning(
                "SessionComponent set %s: %.6f out of [0.0, 1.0]; rejecting",
                lom_attr, val,
            )
            return None
        self._write_lom(lom_attr, val)
        return None

    def _handle_set_int_sig_num(self, lom_attr: str, args) -> None:
        val = _parse_int(args)
        if val is None or val < 1 or val > 99:
            logger.warning(
                "SessionComponent set %s: %r out of [1, 99]; rejecting",
                lom_attr, args[0] if args else None,
            )
            return None
        self._write_lom(lom_attr, val)
        return None

    def _handle_set_int_sig_den(self, lom_attr: str, args) -> None:
        val = _parse_int(args)
        if val is None or val not in _VALID_SIG_DENS:
            logger.warning(
                "SessionComponent set %s: %r not in %r; rejecting",
                lom_attr, args[0] if args else None, _VALID_SIG_DENS,
            )
            return None
        self._write_lom(lom_attr, val)
        return None

    def _handle_set_int_trigger_quant(self, lom_attr: str, args) -> None:
        """Write Live's launch-quantization enum. Validate-and-reject.

        Out-of-range is rejected rather than clamped: a malformed wire
        value must not silently park the set on 1/32.
        """
        val = _parse_int(args)
        if val is None or val < 0 or val > _TRIGGER_QUANT_MAX:
            logger.warning(
                "SessionComponent set %s: %r out of [0, %d]; rejecting",
                lom_attr, args[0] if args else None, _TRIGGER_QUANT_MAX,
            )
            return None
        self._write_lom(lom_attr, val)
        self._echo_if_listenerless(lom_attr)
        return None

    def _handle_set_int_root(self, lom_attr: str, args) -> None:
        val = _parse_int(args)
        if val is None or val < 0 or val > 11:
            logger.warning(
                "SessionComponent set %s: %r out of [0, 11]; rejecting",
                lom_attr, args[0] if args else None,
            )
            return None
        self._write_lom(lom_attr, val)
        return None

    def _handle_set_scale_name(self, args) -> None:
        """One of Live's 35 scale names, or nothing. Live does not raise on
        an unknown name — it silently switches to Major — so membership is
        the whole guard (ADR-446): an empty, over-long or misspelled name is
        refused here and the key stays where it was."""
        if not args:
            logger.warning("SessionComponent set scale_name: empty args, ignoring")
            return None
        raw = args[0]
        if not isinstance(raw, str) or raw not in LIVE_SCALE_NAMES:
            logger.warning(
                "SessionComponent set scale_name: %r is not one of Live's scales; rejecting",
                raw,
            )
            return None
        self._write_lom("scale_name", raw)
        return None

    def _write_lom(self, lom_attr: str, val) -> None:
        """Assign ``val`` to ``song.<lom_attr>``; swallow + log LOM errors.

        No echo suppression per the PR-5b discipline: the listener
        will fire with the new value and the UI re-reads LOM
        off-closure. One extra emission per UI write is the cost;
        losing all-future-emits on a sticky flag is not a tradeoff
        we take.
        """
        try:
            setattr(self._song, lom_attr, val)
        except (RuntimeError, AttributeError) as e:
            logger.warning(
                "SessionComponent set %s=%r raised: %s",
                lom_attr, val, e,
            )

    def _invoke_song_method(self, method_name: str) -> None:
        """Call a no-arg ``song.<method_name>()``. Fire-and-forget."""
        fn = getattr(self._song, method_name, None)
        if not callable(fn):
            logger.warning(
                "SessionComponent %s: no such method on song",
                method_name,
            )
            return None
        try:
            fn()
        except (RuntimeError, AttributeError) as e:
            logger.warning(
                "SessionComponent %s raised: %s", method_name, e,
            )
        return None

    # --- diagnostics ------------------------------------------------------

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        """Log WARNING for ``(key, context)`` once per process.

        A broken attribute fires at listener rate; without de-dupe the
        same error line repeats on every fire and hides real drift in
        Log.txt. Subsequent fires silently drop.
        """
        slot = (key, context)
        if slot in self._warned:
            return
        self._warned.add(slot)
        logger.warning(
            "SessionComponent %s (%s): %s (suppressing further warnings)",
            key, context, exc,
        )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self):
        """Detach tempo + every PR-5d listener. Idempotent.

        Called from ``LoopingSurface.disconnect`` on Live teardown. If
        the song object is already gone the ``remove_*_listener`` call
        raises; we swallow per-attr because there's nothing to clean
        up at that point anyway.
        """
        if self._disconnected:
            return
        self._disconnected = True

        # Tempo first — original Gate-2 shape.
        try:
            self._song.remove_tempo_listener(self._on_tempo_changed)
        except Exception as e:
            logger.warning("SessionComponent tempo detach failed: %s", e)

        # Song position.
        if self._song_time_cb is not None:
            remove = getattr(
                self._song, "remove_current_song_time_listener", None,
            )
            if callable(remove):
                try:
                    remove(self._song_time_cb)
                except Exception as e:
                    logger.warning(
                        "SessionComponent song_time detach failed: %s", e,
                    )
            self._song_time_cb = None

        # PR-5d. Each attr's detach is independent — one failure should
        # not block the others.
        for attr_name, lom_attr, _wire_type, _address in _PR5D_ATTRS:
            cb = self._pr5d_listeners.pop(attr_name, None)
            if cb is None:
                continue
            remove = getattr(
                self._song, "remove_%s_listener" % lom_attr, None,
            )
            if not callable(remove):
                # A torn-down song may lose ``remove_*``; log once.
                self._warn_once(attr_name, "detach-missing",
                                AttributeError(
                                    "no remove_%s_listener" % lom_attr,
                                ))
                continue
            try:
                remove(cb)
            except Exception as e:
                logger.warning(
                    "SessionComponent %s detach failed: %s",
                    attr_name, e,
                )


# --- module helpers -------------------------------------------------------


def _wire_type_from_entry(attr_name: str) -> str:
    """Return the ``wire_type`` column from the ``_PR5D_ATTRS`` row."""
    for entry_name, _lom, wire_type, _addr in _PR5D_ATTRS:
        if entry_name == attr_name:
            return wire_type
    raise KeyError("no PR-5d attr named %r" % attr_name)


def _encode_wire(wire_type: str, raw) -> Tuple:
    """Encode a LOM value as the args tuple we put on the wire.

    Returns ``None`` if the value cannot be coerced — the caller
    logs a ``_warn_once`` and drops the fire.
    """
    if wire_type == _WIRE_BOOL01:
        # Live sometimes returns int-ish truthiness for these; coerce
        # explicitly so the wire carries 0 or 1.
        try:
            return (1 if bool(raw) else 0,)
        except Exception:
            return None
    if wire_type in (
        _WIRE_INT_SIG_NUM, _WIRE_INT_SIG_DEN, _WIRE_INT_ROOT,
        _WIRE_INT_TRIGGER_QUANT,
    ):
        try:
            return (int(raw),)
        except (TypeError, ValueError):
            return None
    if wire_type in (_WIRE_FLOAT_NONNEG, _WIRE_FLOAT_POSITIVE, _WIRE_FLOAT_UNIT):
        try:
            return (float(raw),)
        except (TypeError, ValueError):
            return None
    if wire_type == _WIRE_SCALE_NAME:
        if isinstance(raw, str):
            return (raw,)
        return None
    return None


def _parse_int(args) -> int:
    """Parse ``args[0]`` as int or return ``None``. For the int_* wire types."""
    if not args:
        return None  # type: ignore[return-value]
    try:
        return int(args[0])
    except (TypeError, ValueError):
        return None  # type: ignore[return-value]
