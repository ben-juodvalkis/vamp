"""ClipPropertiesComponent — PR-5e1 focus-scoped clip property channel.

Owns the ``/looping/v3/clip/*`` address family for the clip-level
attributes in ``_ATTRS`` on the **currently focused** clip
(``live_set view detail_clip``):

    loop_start, loop_end, start_marker, end_marker, warp_mode, looping,
    pitch_coarse, pitch_fine, gain

Wire contract per [04 §3.6]:

    UI → Surf   /looping/v3/clip/set/<attr>   [clipPath, value, gen?]
    Surf → UI   /looping/v3/clip/property     [clipPath, name, value]
    Surf → UI   /looping/v3/clip/focused      [clipPath | ""]
    Surf → UI   /looping/v3/clip/warp_markers [clipPath, warping, fileSeconds,
                                               beat0, sec0, beat1, sec1, …]
    UI → Surf   /looping/v3/clip/warp_marker/move [clipPath, beatTime, distance]

Focus-scoped observation
------------------------

One listener on ``song.view.detail_clip`` (song-scoped, attach once
at ``__init__``). When it fires: detach the per-clip property listeners
from the previous focused clip, resolve the new detail_clip via
``clip_path_for`` to a positional ``clipRef``, attach the
property listeners (one per ``_ATTRS`` entry) to the new clip,
emit ``clip/focused`` + initial property values.

Per the PR-5e1 design pivot (2026-04-18): one listener set on the
focused clip only — not |_ATTRS|×N. Matches Ableton's own UX model
(the UI edits the visible clip). Identity on the wire stays
positional so a future PR can extend to multi-clip without a wire
change.

Write-path asymmetry (design)
-----------------------------

Handlers accept **any** ``clipPath`` that resolves via
``resolve_clip``. They do **not** require the write to target the
currently focused clip: the user might release a slider
milliseconds after focus changes, and dropping that write would
produce a worse UX than applying it. If the write lands on a
non-focused clip, the listener on the focused clip does not fire
(no echo), which is fine — the UI's scalar store is already
tracking a different clipPath.

The UI filters late echoes by comparing incoming ``clipPath``
against ``session.focusedClipPath``; mismatches are dropped.

``loop_start`` side-effect
--------------------------

Setting ``loop_start`` also writes ``start_marker`` to the same
value, preserving the M4L product decision in
``liveAPI-v6.js:4808-4814``. Both writes are LOM-guarded; the
``start_marker`` listener fires naturally and echoes back on its
own address — no separate emit needed.

``gain`` under a Permute mute step
----------------------------------

A Permute mute step silences an audio clip by holding its ``gain`` at 0
(``SequencerComponent``). The fader edits the gain the user wants, not
that 0: while a step holds the focused clip, ``gain`` echoes the value
the step will put back (``permute.held_gain``), and a write goes to
``permute.adopt_gain`` instead of the clip, so the clip stays silent and
the step restores the new value. A held clip that reads anything but 0
was edited in Live itself: that value is adopted the same way and
Permute puts the 0 back on its next tick.

Beside every ``gain`` echo goes ``gain_display``, Live's own text for it
(``Clip.gain_display_string``, e.g. ``"-6.0 dB"``) — the 0..1 value is
not linear in dB. None goes out while a step holds the clip at 0: Live's
text would read the silence, so the fader keeps its last label.

Warp markers
------------

A focused **audio** clip also gets listeners on ``warp_markers`` and
``warping``, and every fire sends the whole list on
``clip/warp_markers``: ``warping`` (0|1), the file's length in seconds
(``sample_length / sample_rate``, 0 when unread), then each marker's
``beat_time`` and ``sample_time`` (seconds). An unwarped clip sends no
markers. A MIDI clip sends nothing; the UI clears its list on focus.

``warp_marker/move`` calls ``Clip.move_warp_marker(beat_time, distance)``,
which moves the marker by ``distance`` beats and leaves its audio point
where it is (measured, ``docs/reference/live-api-measurements.md``). The
``beatTime`` the UI sends is matched to a marker within
``_MARKER_MATCH_BEATS`` and Live's own value is passed on, because Live
wants the exact beat time. Live clamps a move past a neighbor short of
it, without an error, and the echo reports where it really landed.

Cold-start / handshake-accept re-emit
-------------------------------------

``emit_on_accept()`` re-emits ``clip/focused`` + the current
property values (if a clip is focused). Wired into
``LoopingSurface._emit_on_accept_chain`` alongside
``V3StateFullComponent.emit_on_accept`` and
``SessionComponent.emit_on_accept``. Matches the PR-5d
cold-start fix: the __init__ init-emit seeds the local port
before any UI exists; the accept-emit seeds the connecting UI.

LOM-touch guard
---------------

Every LOM read/write/listener attach is wrapped in
``(RuntimeError, AttributeError)`` per the Live 12 quirks
documented in ``project_live_lom_quirks.md``. Warnings de-dupe
through ``_warn_once(key, context)``.

Validation
----------

Validate-and-reject, never clamp:

- ``loop_start``, ``loop_end``, ``start_marker``, ``end_marker``:
  float ≥ 0, NaN rejected.
- ``warp_mode``: int in ``{0, 1, 2, 3, 4, 6}`` — Live's closed-enum
  (5 is reserved). Other values rejected silently.
- ``looping``: 0 or 1; nonzero int coerces to True, strings rejected.
- ``pitch_coarse``: int in ``[-48, 48]`` semitones. Non-integer,
  NaN, out-of-range all rejected (no clamp — callers own the
  range math; rejecting on Live's side avoids silent wraparound
  if a caller buglet produces a stale absolute value).
- ``pitch_fine``: int cents in ``[-50, 49]``. Same reject-not-clamp
  contract as pitch_coarse.
- ``gain``: float in ``[0.0, 1.0]``, **clamped** (continuous fader,
  not a discrete value — overshoot should pin to the rail, not
  reject). Audio clips only, warped or not (measured 2026-09-27, Live 12.4.15b4: a write
  on an unwarped clip landed); a raise on a MIDI clip is swallowed.
  0.4 is 0 dB, 1.0 is +24 dB, 0.0 is -inf.
"""

from __future__ import annotations

import logging
import math
from typing import Callable, Dict, List, Optional, Tuple

from . import path_resolver
from .LOMListeners import _is_stale_handle_error
from .path_resolver import ResolveStatus

logger = logging.getLogger("looping")


# Exceptions seen on LOM access. ``Boost.Python.ArgumentError`` is
# raised (as a TypeError subclass) when we hand a C++-side API a
# Python object whose underlying handle has been invalidated — the
# classic case is calling ``remove_<attr>_listener`` on a clip that
# Live has already torn down (focused clip deletion). It is not
# importable at module scope in Live's bundled Python, so we catch
# TypeError (its base) plus the pre-existing LOM error shapes.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum) -----------------------------------------

V3_CLIP_FOCUSED_ADDRESS = "/looping/v3/clip/focused"
V3_CLIP_PROPERTY_ADDRESS = "/looping/v3/clip/property"

V3_CLIP_SET_LOOP_START_ADDRESS = "/looping/v3/clip/set/loop_start"
V3_CLIP_SET_LOOP_END_ADDRESS = "/looping/v3/clip/set/loop_end"
V3_CLIP_SET_START_MARKER_ADDRESS = "/looping/v3/clip/set/start_marker"
V3_CLIP_SET_END_MARKER_ADDRESS = "/looping/v3/clip/set/end_marker"
V3_CLIP_SET_WARP_MODE_ADDRESS = "/looping/v3/clip/set/warp_mode"
V3_CLIP_SET_LOOPING_ADDRESS = "/looping/v3/clip/set/looping"
V3_CLIP_SET_PITCH_COARSE_ADDRESS = "/looping/v3/clip/set/pitch_coarse"
V3_CLIP_SET_PITCH_FINE_ADDRESS = "/looping/v3/clip/set/pitch_fine"
V3_CLIP_SET_GAIN_ADDRESS = "/looping/v3/clip/set/gain"

V3_CLIP_WARP_MARKERS_ADDRESS = "/looping/v3/clip/warp_markers"
V3_CLIP_WARP_MARKER_MOVE_ADDRESS = "/looping/v3/clip/warp_marker/move"


# --- attribute table ------------------------------------------------------
#
# ``(attr_name, wire_type)``. Every attr's LOM name equals its wire name.

_WIRE_FLOAT_NONNEG = "float_nonneg"
_WIRE_INT_WARP_MODE = "int_warp_mode"
_WIRE_BOOL01 = "bool01"
_WIRE_INT_PITCH_COARSE = "int_pitch_coarse"
_WIRE_INT_PITCH_FINE = "int_pitch_fine"
_WIRE_FLOAT_GAIN = "float_gain"

_VALID_WARP_MODES = (0, 1, 2, 3, 4, 6)
_PITCH_COARSE_MIN = -48
_PITCH_COARSE_MAX = 48
# clip.pitch_fine: int cents in [-50, 49] (Live's documented range).
_PITCH_FINE_MIN = -50
_PITCH_FINE_MAX = 49
# clip.gain: normalized [0.0, 1.0], audio clips warped or not (0.4 = 0 dB).
# A raise on a MIDI clip is caught by the _LOM_ERRORS guard.
_GAIN_MIN = 0.0
_GAIN_MAX = 1.0
# At or below this a held clip still reads the mute step's own 0.
_GAIN_SILENT = 1e-6

_ATTRS: Tuple[Tuple[str, str], ...] = (
    ("loop_start", _WIRE_FLOAT_NONNEG),
    ("loop_end", _WIRE_FLOAT_NONNEG),
    ("start_marker", _WIRE_FLOAT_NONNEG),
    ("end_marker", _WIRE_FLOAT_NONNEG),
    ("warp_mode", _WIRE_INT_WARP_MODE),
    ("looping", _WIRE_BOOL01),
    ("pitch_coarse", _WIRE_INT_PITCH_COARSE),
    ("pitch_fine", _WIRE_INT_PITCH_FINE),
    ("gain", _WIRE_FLOAT_GAIN),
)

_ATTR_NAMES: Tuple[str, ...] = tuple(name for name, _ in _ATTRS)

# Observed on a focused audio clip; either fire re-sends the marker list.
_WARP_ATTRS: Tuple[str, ...] = ("warp_markers", "warping")
# How far the UI's beatTime may sit from a marker's and still name it.
_MARKER_MATCH_BEATS = 1e-3
_WIRE_TYPE_FOR: Dict[str, str] = {name: wt for name, wt in _ATTRS}


# --- component ------------------------------------------------------------


class ClipPropertiesComponent:
    """Owns the ``/looping/v3/clip/*`` property family, focus-scoped.

    Args:
        song: Live ``Song`` (test: ``StubSong`` with ``view`` +
            ``add_detail_clip_listener``).
        emit: ``(address, args) -> None`` — OSC sender.
        permute: the sequencer engine, for ``gain`` under a mute step;
            None leaves ``gain`` a plain clip attribute.

    Lifecycle:
        ``__init__`` attaches the ``detail_clip`` listener on
        ``song.view``. If a clip is already focused it immediately
        attaches the property listeners (one per _ATTRS entry) + init-emits. Subsequent
        focus changes detach-then-reattach.
        ``disconnect`` detaches everything. Idempotent.
    """

    V3_CLIP_FOCUSED_ADDRESS = V3_CLIP_FOCUSED_ADDRESS
    V3_CLIP_PROPERTY_ADDRESS = V3_CLIP_PROPERTY_ADDRESS
    ATTRS = _ATTRS

    def __init__(self, song, emit, permute=None):
        self._song = song
        self._emit = emit
        # ``SequencerComponent`` (``held_gain`` / ``adopt_gain``), or None.
        self._permute = permute
        self._disconnected = False

        # Currently-observed clip and its path. ``None`` when no
        # session clip is focused (detail_clip is null, or
        # arrangement-only clip — ``clip_path_for`` returns None).
        self._focused_clip = None
        self._focused_path: Optional[str] = None

        # ``attr_name -> bound callback`` for the per-clip property listeners
        # on ``_focused_clip``. Empty when nothing is focused.
        self._prop_listeners: Dict[str, Callable[[], None]] = {}
        # ``attr_name -> callback`` for ``_WARP_ATTRS`` on a focused audio clip.
        self._warp_listeners: Dict[str, Callable[[], None]] = {}

        # ``(attr_name, context) -> True`` once warned, for de-dupe.
        self._warned: set = set()

        # Song-scoped detail_clip listener. Attach on ``song.view``.
        self._view = self._safe_song_view()
        self._detail_listener_attached = False
        if self._view is not None:
            try:
                self._view.add_detail_clip_listener(
                    self._on_detail_clip_changed,
                )
                self._detail_listener_attached = True
            except _LOM_ERRORS as e:
                self._warn_once("detail_clip", "attach", e)

        # If a clip is already focused at construction, seed everything.
        self._refocus()
        logger.info(
            "ClipPropertiesComponent init: focused_path=%s, listeners=%d",
            self._focused_path, len(self._prop_listeners),
        )

    # --- song.view / detail_clip listener ---------------------------------

    def _safe_song_view(self):
        try:
            return self._song.view
        except _LOM_ERRORS as e:
            self._warn_once("song.view", "read", e)
            return None

    def _on_detail_clip_changed(self) -> None:
        """Fires when ``song.view.detail_clip`` changes.

        LOM-safe callback: no args, reads ``detail_clip`` back, then
        detaches/rebinds property listeners and emits focused +
        initial property values.
        """
        if self._disconnected:
            return
        self._refocus()

    def _refocus(self) -> None:
        """Detach listeners from previous clip, attach to new, emit."""
        new_clip = self._read_detail_clip()
        new_path: Optional[str] = None
        if new_clip is not None:
            try:
                new_path = path_resolver.clip_path_for(self._song, new_clip)
            except _LOM_ERRORS as e:
                self._warn_once("clip_path_for", "refocus", e)
                new_path = None

        # Detach from previous clip regardless of whether the new
        # clip resolves — a stale listener set on a gone clip leaks
        # memory and may fire against a dead LOM object.
        self._detach_property_listeners()

        # Update state *before* emit so any reentrancy sees the new
        # focus — the listener fires are notifications, not handoffs.
        self._focused_clip = new_clip if new_path is not None else None
        self._focused_path = new_path

        self._emit_focused()

        if self._focused_clip is not None:
            self._attach_property_listeners(self._focused_clip)
            self._emit_all_properties("refocus")
            self._attach_warp_listeners(self._focused_clip)
            self._emit_warp_markers()

    def _read_detail_clip(self):
        """Return ``song.view.detail_clip`` or ``None`` on any LOM quirk."""
        if self._view is None:
            return None
        try:
            clip = self._view.detail_clip
        except _LOM_ERRORS as e:
            self._warn_once("detail_clip", "read", e)
            return None
        return clip

    # --- per-clip property listeners --------------------------------------

    def _attach_property_listeners(self, clip) -> None:
        """Attach a property listener per _ATTRS entry to ``clip``. Skip-with-warning per attr."""
        for attr_name in _ATTR_NAMES:
            add = getattr(clip, "add_%s_listener" % attr_name, None)
            if not callable(add):
                self._warn_once(
                    attr_name, "attach-missing",
                    AttributeError(
                        "no add_%s_listener on clip" % attr_name,
                    ),
                )
                continue
            cb = self._make_property_listener(attr_name)
            try:
                add(cb)
            except _LOM_ERRORS as e:
                self._warn_once(attr_name, "attach", e)
                continue
            self._prop_listeners[attr_name] = cb

    def _detach_property_listeners(self) -> None:
        """Detach every currently-attached property listener.

        Operates against ``self._focused_clip`` — the clip the
        listeners were attached to. If that clip has already been
        torn down we swallow the per-attr error; there is nothing
        to clean up anyway.
        """
        clip = self._focused_clip
        if clip is None:
            self._prop_listeners.clear()
            self._warp_listeners.clear()
            return
        for listeners in (self._prop_listeners, self._warp_listeners):
            self._detach_from(clip, listeners)

    def _detach_from(self, clip, listeners: Dict[str, Callable[[], None]]) -> None:
        for attr_name in list(listeners.keys()):
            cb = listeners.pop(attr_name, None)
            if cb is None:
                continue
            remove = getattr(clip, "remove_%s_listener" % attr_name, None)
            if not callable(remove):
                continue
            try:
                remove(cb)
            except _LOM_ERRORS as e:
                self._warn_once(attr_name, "detach", e)

    def _attach_warp_listeners(self, clip) -> None:
        """Observe ``_WARP_ATTRS`` on an audio clip; a MIDI clip gets none."""
        if not self._is_audio_clip(clip):
            return
        for attr_name in _WARP_ATTRS:
            add = getattr(clip, "add_%s_listener" % attr_name, None)
            if not callable(add):
                continue
            cb = self._on_warp_changed
            try:
                add(cb)
            except _LOM_ERRORS as e:
                self._warn_once(attr_name, "attach", e)
                continue
            self._warp_listeners[attr_name] = cb

    def _on_warp_changed(self) -> None:
        if self._disconnected:
            return
        self._emit_warp_markers()

    def _is_audio_clip(self, clip) -> bool:
        try:
            return bool(clip.is_audio_clip)
        except _LOM_ERRORS:
            return False

    def _read_warp_markers(self, clip) -> List[Tuple[float, float]]:
        """``[(beat_time, sample_time)]`` in Live's order; [] when unread."""
        try:
            return [
                (float(m.beat_time), float(m.sample_time))
                for m in clip.warp_markers
            ]
        except (_LOM_ERRORS + (ValueError,)) as e:
            self._warn_once("warp_markers", "read", e)
            return []

    def _file_seconds(self, clip) -> float:
        try:
            rate = float(clip.sample_rate)
            length = float(clip.sample_length)
        except (_LOM_ERRORS + (ValueError,)):
            return 0.0
        return length / rate if rate > 0 else 0.0

    def _emit_warp_markers(self) -> None:
        """Send the focused audio clip's markers on ``clip/warp_markers``."""
        clip = self._focused_clip
        if clip is None or self._focused_path is None:
            return
        if not self._is_audio_clip(clip):
            return
        warping = bool(self._safe_read_attr(clip, "warping", "warp-read"))
        args: List[object] = [
            self._focused_path, 1 if warping else 0, self._file_seconds(clip),
        ]
        if warping:
            for beat, sec in self._read_warp_markers(clip):
                args.extend((beat, sec))
        self._emit(V3_CLIP_WARP_MARKERS_ADDRESS, tuple(args))

    def _make_property_listener(
        self, attr_name: str,
    ) -> Callable[[], None]:
        """Build the no-arg callback LOM passes to ``add_<attr>_listener``."""

        def _fire() -> None:
            if self._disconnected:
                return
            clip = self._focused_clip
            if clip is None:
                return
            raw = self._safe_read_attr(clip, attr_name, "fire-read")
            if raw is None:
                return
            self._emit_property(attr_name, raw)

        return _fire

    # --- emits -------------------------------------------------------------

    def _emit_focused(self) -> None:
        """Emit ``/looping/v3/clip/focused [clipPath | ""]``."""
        path = self._focused_path if self._focused_path is not None else ""
        self._emit(V3_CLIP_FOCUSED_ADDRESS, (path,))

    def _emit_property(self, attr_name: str, raw) -> None:
        """Emit one ``/looping/v3/clip/property`` message."""
        if self._focused_path is None:
            return
        wire_type = _WIRE_TYPE_FOR.get(attr_name)
        if wire_type is None:
            return
        silenced = False
        if attr_name == "gain":
            raw, silenced = self._gain_as_set(raw)
        value = _encode_wire(wire_type, raw)
        if value is None:
            self._warn_once(
                attr_name, "fire-encode",
                ValueError("could not encode %r" % (raw,)),
            )
            return
        self._emit(
            V3_CLIP_PROPERTY_ADDRESS,
            (self._focused_path, attr_name, value),
        )
        if attr_name == "gain" and not silenced:
            self._emit_gain_display()

    def _gain_as_set(self, raw) -> Tuple[object, bool]:
        """The focused clip's gain as the user set it, and whether a
        Permute mute step has it silenced at 0 right now (see the module
        doc). A held clip reading above 0 was edited in Live: adopted."""
        clip = self._focused_clip
        if self._permute is None or clip is None:
            return raw, False
        held = self._permute.held_gain(clip)
        if held is None:
            return raw, False
        try:
            read = float(raw)
        except (TypeError, ValueError):
            return held, True
        if read > _GAIN_SILENT:
            self._permute.adopt_gain(clip, read, rezero=True)
            return read, False
        return held, True

    def _emit_gain_display(self) -> None:
        """``gain_display``: Live's own text for the focused clip's gain."""
        clip = self._focused_clip
        if clip is None or self._focused_path is None:
            return
        text = self._safe_read_attr(clip, "gain_display_string", "display-read")
        if text is None:
            return
        self._emit(
            V3_CLIP_PROPERTY_ADDRESS,
            (self._focused_path, "gain_display", str(text)),
        )

    def _emit_all_properties(self, context: str) -> None:
        """Read + emit all properties (one per _ATTRS entry) of the currently focused clip."""
        clip = self._focused_clip
        if clip is None:
            return
        for attr_name in _ATTR_NAMES:
            if attr_name not in self._prop_listeners:
                # Listener attach failed — don't bother reading.
                continue
            raw = self._safe_read_attr(clip, attr_name, "%s-read" % context)
            if raw is None:
                continue
            self._emit_property(attr_name, raw)

    def emit_on_accept(self) -> None:
        """Re-emit ``clip/focused`` + all properties after handshake accept.

        Symmetric with SessionComponent.emit_on_accept — called from
        ``LoopingSurface._emit_on_accept_chain``. Closes the cold-start
        gap when a UI connects after Live boot.
        """
        self._emit_focused()
        if self._focused_clip is not None:
            self._emit_all_properties("on_accept")
            self._emit_warp_markers()

    # --- write handlers ----------------------------------------------------

    def handle_set_loop_start(self, args, source_addr):
        """``/looping/v3/clip/set/loop_start [clipPath, value, gen?]``.

        Side effect: also writes ``start_marker`` to the same value
        (preserves M4L product decision in liveAPI-v6.js:4808-4814).
        """
        clip, _path, val = self._parse_float_write(args, "loop_start")
        if clip is None or val is None:
            return None
        self._write_clip_attr(clip, "loop_start", val)
        # Side-effect: start_marker = loop_start.
        self._write_clip_attr(clip, "start_marker", val)
        return None

    def handle_set_loop_end(self, args, source_addr):
        clip, _path, val = self._parse_float_write(args, "loop_end")
        if clip is None or val is None:
            return None
        self._write_clip_attr(clip, "loop_end", val)
        return None

    def handle_set_start_marker(self, args, source_addr):
        clip, _path, val = self._parse_float_write(args, "start_marker")
        if clip is None or val is None:
            return None
        self._write_clip_attr(clip, "start_marker", val)
        return None

    def handle_set_end_marker(self, args, source_addr):
        clip, _path, val = self._parse_float_write(args, "end_marker")
        if clip is None or val is None:
            return None
        self._write_clip_attr(clip, "end_marker", val)
        return None

    def handle_set_warp_mode(self, args, source_addr):
        clip, _path = self._parse_clip_from_args(args, "warp_mode")
        if clip is None:
            return None
        val = _parse_int_arg(args, 1)
        if val is None or val not in _VALID_WARP_MODES:
            logger.warning(
                "ClipPropertiesComponent set warp_mode: %r not in %r; "
                "rejecting", args[1] if len(args) > 1 else None,
                _VALID_WARP_MODES,
            )
            return None
        self._write_clip_attr(clip, "warp_mode", val)
        return None

    def handle_set_looping(self, args, source_addr):
        clip, _path = self._parse_clip_from_args(args, "looping")
        if clip is None:
            return None
        val = _parse_bool01_arg(args, 1)
        if val is None:
            logger.warning(
                "ClipPropertiesComponent set looping: %r not in {0,1}; "
                "rejecting", args[1] if len(args) > 1 else None,
            )
            return None
        self._write_clip_attr(clip, "looping", val)
        return None

    def handle_set_pitch_coarse(self, args, source_addr):
        """``/looping/v3/clip/set/pitch_coarse [clipPath, value]``.

        Integer semitones in ``[-48, 48]``. Out-of-range rejected
        (no clamp; callers own the math and passing stale absolute
        values should surface as a bug, not wraparound).
        """
        clip, _path = self._parse_clip_from_args(args, "pitch_coarse")
        if clip is None:
            return None
        val = _parse_int_arg(args, 1)
        if val is None:
            logger.warning(
                "ClipPropertiesComponent set pitch_coarse: bad int %r; "
                "rejecting", args[1] if len(args) > 1 else None,
            )
            return None
        if val < _PITCH_COARSE_MIN or val > _PITCH_COARSE_MAX:
            logger.warning(
                "ClipPropertiesComponent set pitch_coarse: %d outside "
                "[%d, %d]; rejecting",
                val, _PITCH_COARSE_MIN, _PITCH_COARSE_MAX,
            )
            return None
        self._write_clip_attr(clip, "pitch_coarse", val)
        return None

    def handle_set_pitch_fine(self, args, source_addr):
        """``/looping/v3/clip/set/pitch_fine [clipPath, value]``.

        Integer cents in ``[-50, 49]``. Out-of-range rejected (no
        clamp; same contract as pitch_coarse).
        """
        clip, _path = self._parse_clip_from_args(args, "pitch_fine")
        if clip is None:
            return None
        val = _parse_int_arg(args, 1)
        if val is None:
            logger.warning(
                "ClipPropertiesComponent set pitch_fine: bad int %r; "
                "rejecting", args[1] if len(args) > 1 else None,
            )
            return None
        if val < _PITCH_FINE_MIN or val > _PITCH_FINE_MAX:
            logger.warning(
                "ClipPropertiesComponent set pitch_fine: %d outside "
                "[%d, %d]; rejecting",
                val, _PITCH_FINE_MIN, _PITCH_FINE_MAX,
            )
            return None
        self._write_clip_attr(clip, "pitch_fine", val)
        return None

    def handle_set_gain(self, args, source_addr):
        """``/looping/v3/clip/set/gain [clipPath, value]``.

        Normalized float in ``[0.0, 1.0]``. Out-of-range clamped (a
        continuous fader can overshoot its track by a hair; clamping is
        the right behavior for a level control, unlike the discrete
        pitch fields which reject). Audio clips only, warped or not —
        a raise on a MIDI clip is caught by the write guard.
        """
        clip, _path = self._parse_clip_from_args(args, "gain")
        if clip is None:
            return None
        if len(args) < 2:
            logger.warning(
                "ClipPropertiesComponent set gain: missing value arg",
            )
            return None
        try:
            val = float(args[1])
        except (TypeError, ValueError) as e:
            logger.warning(
                "ClipPropertiesComponent set gain: bad float %r: %s",
                args[1], e,
            )
            return None
        if math.isnan(val):
            logger.warning(
                "ClipPropertiesComponent set gain: NaN rejected",
            )
            return None
        if val < _GAIN_MIN:
            val = _GAIN_MIN
        elif val > _GAIN_MAX:
            val = _GAIN_MAX
        focused = path_resolver.same_lom_handle(clip, self._focused_clip)
        if self._permute is not None and self._permute.adopt_gain(clip, val):
            # A mute step holds the clip at 0 and will put this back.
            # Nothing on the clip changed, so no listener echoes it; and
            # not through ``_emit_property``, which would take a value
            # above 0 on a held clip for an edit made in Live.
            if focused and self._focused_path is not None:
                self._emit(
                    V3_CLIP_PROPERTY_ADDRESS,
                    (self._focused_path, "gain", val),
                )
            return None
        if not self._write_clip_attr(clip, "gain", val) and focused:
            # Refused: the fader goes back to what Live holds.
            raw = self._safe_read_attr(clip, "gain", "set-refused-read")
            if raw is not None:
                self._emit_property("gain", raw)
        return None

    def handle_move_warp_marker(self, args, source_addr):
        """``/looping/v3/clip/warp_marker/move [clipPath, beatTime, distance]``.

        Moves the marker at ``beatTime`` by ``distance`` beats. Rejected
        (logged, nothing written): an unwarped clip, no marker within
        ``_MARKER_MATCH_BEATS`` of ``beatTime``, a non-finite number.
        """
        clip, _path = self._parse_clip_from_args(args, "warp_marker/move")
        if clip is None:
            return None
        try:
            beat = float(args[1])
            distance = float(args[2])
        except (IndexError, TypeError, ValueError):
            logger.warning(
                "ClipPropertiesComponent warp_marker/move: bad args %r", args,
            )
            return None
        if not (math.isfinite(beat) and math.isfinite(distance)):
            logger.warning(
                "ClipPropertiesComponent warp_marker/move: non-finite %r", args,
            )
            return None
        if distance == 0.0:
            return None
        if not self._safe_read_attr(clip, "warping", "move-read"):
            logger.warning(
                "ClipPropertiesComponent warp_marker/move: clip not warped",
            )
            return None
        exact = None
        best = _MARKER_MATCH_BEATS
        for marker_beat, _sec in self._read_warp_markers(clip):
            gap = abs(marker_beat - beat)
            if gap <= best:
                exact, best = marker_beat, gap
        if exact is None:
            logger.warning(
                "ClipPropertiesComponent warp_marker/move: no marker at %.6f",
                beat,
            )
            return None
        try:
            clip.move_warp_marker(exact, distance)
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipPropertiesComponent move_warp_marker(%.6f, %.6f) "
                "raised: %s", exact, distance, e,
            )
        # Echo either way: a refused or clamped move puts the handle
        # where Live holds the marker.
        if path_resolver.same_lom_handle(clip, self._focused_clip):
            self._emit_warp_markers()
        return None

    # --- handler helpers ---------------------------------------------------

    def _parse_clip_from_args(
        self, args, attr_name: str,
    ) -> Tuple[Optional[object], Optional[str]]:
        """Resolve ``args[0]`` as a clipPath → clip object.

        Returns ``(clip, path)`` on success, ``(None, None)`` on any
        rejection (empty args, non-string path, resolve failure).
        Logs a warning per rejection class.
        """
        if not args:
            logger.warning(
                "ClipPropertiesComponent set %s: empty args, ignoring",
                attr_name,
            )
            return None, None
        raw = args[0]
        if not isinstance(raw, str):
            logger.warning(
                "ClipPropertiesComponent set %s: clipPath not a string: %r",
                attr_name, raw,
            )
            return None, None
        r = path_resolver.resolve_clip(self._song, raw)
        if not r.ok:
            logger.warning(
                "ClipPropertiesComponent set %s: clipPath %r unresolved: %s "
                "(%s)", attr_name, raw, r.status.value, r.detail,
            )
            return None, None
        return r.obj, raw

    def _parse_float_write(
        self, args, attr_name: str,
    ) -> Tuple[Optional[object], Optional[str], Optional[float]]:
        """Resolve clipPath + parse a non-negative float value.

        Returns ``(clip, path, value)`` on success; ``None`` in the
        value slot on rejection.
        """
        clip, path = self._parse_clip_from_args(args, attr_name)
        if clip is None:
            return None, None, None
        if len(args) < 2:
            logger.warning(
                "ClipPropertiesComponent set %s: missing value arg",
                attr_name,
            )
            return None, None, None
        try:
            val = float(args[1])
        except (TypeError, ValueError) as e:
            logger.warning(
                "ClipPropertiesComponent set %s: bad float %r: %s",
                attr_name, args[1], e,
            )
            return None, None, None
        if math.isnan(val):
            logger.warning(
                "ClipPropertiesComponent set %s: NaN rejected", attr_name,
            )
            return None, None, None
        if val < 0.0:
            logger.warning(
                "ClipPropertiesComponent set %s: %.6f negative; rejecting",
                attr_name, val,
            )
            return None, None, None
        return clip, path, val

    def _write_clip_attr(self, clip, attr_name: str, val) -> bool:
        """Assign ``clip.<attr_name> = val``; swallow + log LOM errors."""
        try:
            setattr(clip, attr_name, val)
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipPropertiesComponent set %s=%r raised: %s",
                attr_name, val, e,
            )
            return False
        return True

    def _safe_read_attr(self, clip, attr_name: str, context: str):
        """Read ``clip.<attr_name>`` under the LOM-touch guard."""
        try:
            return getattr(clip, attr_name)
        except _LOM_ERRORS as e:
            self._warn_once(attr_name, context, e)
            return None

    # --- diagnostics -------------------------------------------------------

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        # Stale-handle errors on detach (focused clip was deleted / the
        # underlying C++ object is gone) aren't bugs — the listener is
        # already detached on the LOM side. Drop to DEBUG so track/clip
        # deletion doesn't spam Log.txt. Genuine failures stay at WARN.
        if context == "detach" and _is_stale_handle_error(exc):
            logger.debug(
                "ClipPropertiesComponent %s (%s): stale LOM handle "
                "(already torn down): %s", key, context, exc,
            )
            return
        slot = (key, context)
        if slot in self._warned:
            return
        self._warned.add(slot)
        logger.warning(
            "ClipPropertiesComponent %s (%s): %s "
            "(suppressing further warnings)",
            key, context, exc,
        )

    # --- lifecycle ---------------------------------------------------------

    def disconnect(self):
        if self._disconnected:
            return
        self._disconnected = True

        # Per-clip property listeners.
        self._detach_property_listeners()

        # detail_clip listener on song.view.
        if self._detail_listener_attached and self._view is not None:
            try:
                self._view.remove_detail_clip_listener(
                    self._on_detail_clip_changed,
                )
            except _LOM_ERRORS as e:
                if _is_stale_handle_error(e):
                    logger.debug(
                        "ClipPropertiesComponent detail_clip detach: "
                        "stale LOM handle (already torn down): %s", e,
                    )
                else:
                    logger.warning(
                        "ClipPropertiesComponent detail_clip detach "
                        "failed: %s", e,
                    )
            self._detail_listener_attached = False


# --- module helpers -------------------------------------------------------


def _encode_wire(wire_type: str, raw):
    """Encode a LOM value for the ``value`` slot in ``clip/property``.

    Returns ``None`` if the value cannot be coerced. The wire shape
    is ``(clipPath, name, value)`` — a single scalar, not a tuple.
    """
    if wire_type == _WIRE_FLOAT_NONNEG:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None
    if wire_type == _WIRE_INT_WARP_MODE:
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    if wire_type == _WIRE_BOOL01:
        try:
            return 1 if bool(raw) else 0
        except Exception:
            return None
    if wire_type == _WIRE_INT_PITCH_COARSE:
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    if wire_type == _WIRE_INT_PITCH_FINE:
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    if wire_type == _WIRE_FLOAT_GAIN:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None
    return None


def _parse_int_arg(args, index: int) -> Optional[int]:
    if len(args) <= index:
        return None
    try:
        return int(args[index])
    except (TypeError, ValueError):
        return None


def _parse_bool01_arg(args, index: int) -> Optional[bool]:
    if len(args) <= index:
        return None
    raw = args[index]
    if isinstance(raw, bool):
        return raw
    try:
        as_int = int(raw)
    except (TypeError, ValueError):
        return None
    if as_int not in (0, 1):
        return None
    return bool(as_int)
