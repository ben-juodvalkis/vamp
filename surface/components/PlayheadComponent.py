"""PlayheadComponent — per-track playing-clip + playhead channel.

Owns two emit-only addresses (no transport handlers):

    /looping/v3/track/playing_slot   — track's playing slot changed,
        with the clip identity + render context (length, loop window,
        anchor triple) the UI needs to set up its render
    /looping/v3/track/playhead       — throttled 30 Hz position emit
        for drift correction of the UI's local rAF interpolator

Modeled directly on ``MetersComponent``: per-track listener attach in
``__init__``, structural-rebind on ``on_structural_change``, per-track
``time.monotonic`` 30 Hz drop-intermediate window, init-emit at startup
to seed the UI for tracks already playing on cold start.

Listener model
--------------

One ``playing_slot_index`` listener per regular track. On slot change:

  - detach the per-clip listeners (``playing_position`` always; for
    MIDI clips also a ``notes`` listener) from the prior playing clip.
  - resolve the new clip via ``track.clip_slots[slot_idx].clip``.
  - if a clip is now playing, attach ``playing_position`` (drives the
    30 Hz throttled drift emits) and — if the clip is MIDI — a
    ``notes`` listener (emits ``/looping/v3/clip/notes/changed`` so
    the UI can re-pull notes for a clip it's currently rendering).
  - emit ``playing_slot`` once with the full payload (file_path,
    length, loop bounds, looping flag, fresh anchor triple, and for
    audio the file's span — see ``read_file_span``).
  - on stop (slot_idx == -1): emit ``playing_slot`` with ``slot_idx=-1``,
    zero/empty trailing fields, and ``bps=0`` so the UI freezes its
    interpolator.

Loop-bound observation lives in ``ClipPropertiesComponent`` (focused
clip). The UI cross-subscribes the property channel by ``clip_path``;
no separate ``clip/loop`` address here. ``playing_slot`` carries the
loop bounds as they read at slot-change time so the cold view is right
even when the playing clip != the focused clip.

Wire — direct position emit, no extrapolation
---------------------------------------------

``playhead`` ships ``(track_path, slot_idx, position_beats, status)``
straight from ``Clip.playing_position`` at 30 Hz. The UI paints what it
receives — no rAF interpolator, no anchor/rate scheme. Quantized motion
at the throttle rate is acceptable on the small track-strip render, and
the simpler model collapses two whole classes of bugs (transport-stop
desync, tempo-change drift) into a single rule: when ``playing_position``
listeners stop firing, the UI's playhead stops too.

Throttle — 30 Hz per track, drop-intermediate
---------------------------------------------

Same window shape as ``MetersComponent``: a ``time.monotonic`` window
keyed on track path. ``playing_position`` listeners can fire faster
than the audio buffer rate; the throttle absorbs that.

The throttle is bypassed for ``playing_slot`` — slot changes are
gestural (one per launch / stop), and the UI needs the full payload
the moment it lands so the waveform fetch / loop-window setup can
start without waiting for the next 33 ms tick.

LOM-touch guard
---------------

Every LOM read/listener attach wraps in ``_LOM_ERRORS = (RuntimeError,
AttributeError, TypeError)`` per the Live 12 quirks. ``TypeError``
covers ``Boost.Python.ArgumentError`` from torn-down handles.

Never cache clip wrappers across listener fires — re-resolve from the
track on each fire (ADR-350: Live hands out fresh wrappers per
attribute read, so identity-keyed caches lose their detach refs).

Generation
----------

Emits omit structural generation (precedent: ``MetersComponent``).
Slot-change isn't a structural mutation — the LOM tree shape is
unchanged.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import path_resolver
from .LOMListeners import _safe_int_id

logger = logging.getLogger("looping")


# --- wire addresses (closed-enum; renames fail at import time) -----------

V3_TRACK_PLAYING_SLOT_ADDRESS = "/looping/v3/track/playing_slot"
V3_TRACK_PLAYHEAD_ADDRESS = "/looping/v3/track/playhead"
V3_CLIP_NOTES_CHANGED_ADDRESS = "/looping/v3/clip/notes/changed"


# --- throttle ------------------------------------------------------------

_RATE_HZ = 30
_WINDOW_SEC = 1.0 / _RATE_HZ  # 33.333... ms


# --- status ordinals (parallel to V3StateFullComponent slot states) ------

_STATUS_STOPPED = 0
_STATUS_PLAYING = 1
_STATUS_RECORDING = 2


# --- rendered-clip edits ------------------------------------------------

# Properties of the displayed clip whose change alters what the strip should
# draw: the unit (warping flips loop points between beats and seconds), the
# window (loop points; for a clip that isn't looping Live reports its start
# and end markers there) and which of the two applies. Nothing else watched
# them — ``playing_slot`` went out on launch / stop / record / has_clip only,
# so an edit made with the transport stopped never reached the strip until
# the clip next launched. ``warping`` exists on audio clips only; attaching
# it to a MIDI clip raises and is skipped.
_EDIT_PROPERTIES: Tuple[str, ...] = (
    "warping", "looping", "loop_start", "loop_end", "start_marker", "end_marker",
)


# --- LOM error tuple -----------------------------------------------------

_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- audio file span -------------------------------------------------------

def read_file_span(clip) -> Tuple[float, float]:
    """Where an audio clip's file starts and ends, in the clip's own time.

    ``(file_start, file_end)`` in the same unit as ``loop_start`` /
    ``loop_end`` / ``length`` — beats for a warped clip, seconds for an
    unwarped one (Live's docstrings: "unit depends on warping"). This is
    what a waveform renderer needs to place peaks: the peaks array covers
    the WHOLE file, and nothing else on the wire says where that file sits.
    ``length`` does not — for a looping clip it is the loop's length, so a
    renderer that took the file to span ``[0, length]`` drew nothing for a
    loop that had moved past it (measured 2026-09-18: a 28-beat recording
    looping 16..24 reported ``length`` 8).

    Warped: ``sample_to_beat_time`` at the first and last sample — Live's
    own warp-marker mapping, so a take recorded at another tempo still
    lines up. Unwarped: ``0 .. sample_length / sample_rate``; that
    conversion raises on a warped clip, and the beat one on an unwarped
    one.

    ``(0.0, 0.0)`` means unknown — MIDI, a take still flushing to disk, or
    any LOM raise — and the UI falls back to its old ``[0, length]`` guess.
    """
    try:
        frames = float(clip.sample_length)
        if frames <= 0:
            return (0.0, 0.0)
        if clip.warping:
            start = float(clip.sample_to_beat_time(0.0))
            end = float(clip.sample_to_beat_time(frames))
        else:
            rate = float(clip.sample_rate)
            if rate <= 0:
                return (0.0, 0.0)
            start, end = 0.0, frames / rate
    except _LOM_ERRORS + (ValueError,):
        return (0.0, 0.0)
    # NaN fails this too, which is the point.
    if not end > start:
        return (0.0, 0.0)
    return (start, end)


class PlayheadComponent:
    """Owns the ``/looping/v3/track/playing_slot`` + ``/playhead`` family.

    Args:
        song: Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.

    No handlers registered with the transport — emit-only.
    """

    WINDOW_SEC = _WINDOW_SEC
    V3_TRACK_PLAYING_SLOT_ADDRESS = V3_TRACK_PLAYING_SLOT_ADDRESS
    V3_TRACK_PLAYHEAD_ADDRESS = V3_TRACK_PLAYHEAD_ADDRESS
    V3_CLIP_NOTES_CHANGED_ADDRESS = V3_CLIP_NOTES_CHANGED_ADDRESS

    STATUS_STOPPED = _STATUS_STOPPED
    STATUS_PLAYING = _STATUS_PLAYING
    STATUS_RECORDING = _STATUS_RECORDING

    # Recording → playing settle delay. Live populates ``clip.file_path``
    # synchronously when ``is_recording`` flips false, but the .aif/.wav
    # is still flushing to disk. A one-shot recheck after this delay
    # re-emits ``playing_slot`` once the OS has finished writing — the
    # UI's `/api/sample-peaks` fetch then succeeds first try without
    # client-side retries.
    RECORD_SETTLE_DELAY_MS = 250

    # Edit / transport-stop refresh: the next tick. One warping toggle fires
    # up to six listeners (every loop point and marker converts with it), and
    # coalescing them into one pass reads the clip after Live has finished
    # converting rather than halfway through.
    EDIT_SETTLE_DELAY_MS = 0

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
    ) -> None:
        self._song = song
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        self._disconnected = False

        # ``add_change_callback`` subscribers (ADR-447: key Follow). Created
        # first — the bind walk below already runs ``_apply_render_target``.
        self._change_callbacks: List[Callable[[str, str], None]] = []

        # Per-track 33 ms drop-intermediate window for the throttled
        # ``playhead`` emits.
        self._last_emit: Dict[str, float] = {}

        # Detach records for the per-track ``playing_slot_index``
        # listener — flat list of ``(track, remove_method, cb, path)``
        # mirroring ``MetersComponent`` (ADR-350: never key by
        # ``id(track)``).
        self._slot_listeners: List[
            Tuple[Any, str, Callable[[], None], str]
        ] = []

        # Per-track playing-clip listener bookkeeping. Keyed by
        # track_path; the value records the clip wrapper we attached
        # to (so detach can target it directly, not a fresh read) plus
        # the position-listener and optional notes-listener callbacks.
        # ``clip_path`` is denormalised from the slot resolution at
        # attach time so a notes-changed emit doesn't have to re-resolve.
        # ``slot_idx`` is the LOM slot index the listener targets — the
        # path's reverse lookup goes through compose_clip_path.
        self._clip_listeners: Dict[str, Dict[str, Any]] = {}

        # (key, context) → True once warned. De-dupes high-rate listener
        # warnings into Log.txt so a torn-down handle can't flood.
        # Cleared on `on_structural_change` so a track that warned once
        # can re-warn after it's been rebound to a fresh LOM wrapper.
        self._warned: set = set()

        # Last-emitted ``playing_slot`` payload per track_path. Set by
        # ``_emit_playing_slot`` / ``_emit_playing_slot_empty``; consulted
        # by both to skip the wire emit when the payload is byte-identical
        # to the last one. Survives ``on_structural_change`` — if the
        # post-rebind payload happens to match the cached one, the UI's
        # store entry is already correct, so the emit is wasted.
        self._last_emitted_payload: Dict[str, tuple] = {}

        # Re-emit display slots when Live's highlight moves, so the
        # strip reflects the focused clip on tracks that aren't playing.
        self._highlight_cb: Optional[Callable[[], None]] = None
        self._bind_highlight_listener()

        # Tracks with an edit refresh already scheduled (coalescing).
        self._edit_refresh_pending: set = set()

        # ``song.is_playing`` — a stop gets one unthrottled position per
        # live clip, so the frozen playhead sits where Live froze it rather
        # than wherever the last 30 Hz window happened to land.
        self._transport_cb: Optional[Callable[[], None]] = None
        self._bind_transport_listener()

        self._bind_all_tracks()
        self._emit_initial_values()

        logger.info(
            "PlayheadComponent ready: %d slot-index listeners, "
            "%d active clip listeners",
            len(self._slot_listeners), len(self._clip_listeners),
        )

    # --- handshake-accept seed ------------------------------------------

    def emit_on_accept(self) -> None:
        """Re-seed the UI's playing-clip state on handshake accept.

        Required because:

        - The UI clears ``playingClipsStore`` on every ``bridge-resync``
          (WebSocket reconnect), so without an explicit re-seed the
          strip stays blank for stationary-state reconnects.
        - ``state/full`` does NOT carry ``file_path`` / ``loop_start`` /
          ``loop_end`` / ``looping`` / ``is_audio_clip`` — those fields
          live only on ``playing_slot``, which is owned here.
        - LOM listeners only fire on actual state changes; a
          stationary-state reconnect produces no listener fires, so no
          natural re-emit happens.

        Implementation: clear ``_last_emitted_payload`` so the dedup
        cache doesn't suppress the re-seed (every track's payload would
        be byte-identical to what was last sent — exactly the case the
        dedup is built to suppress, but here we want it through), then
        run ``_emit_initial_values`` to walk every track and emit.

        Mirrors the ``emit_on_accept`` pattern used by every other
        component in the handshake-accept chain.
        """
        if self._disconnected:
            return
        self._last_emitted_payload.clear()
        self._emit_initial_values()

    # --- query API (permute ADR-020) -------------------------------------

    def playing_clip(self, track, track_path: str = "") -> Optional[Tuple[object, int]]:
        """The clip ``track`` is playing right now, as ``(clip, slot_idx)``,
        or ``None`` when the track is stopped or the slot is empty.

        A fresh read through the same guarded helpers the listeners use —
        no second ``playing_slot_index`` listener, no cached wrapper
        (ADR-350). The sequencer engine calls this per step transition
        and per clip-change check; ``track_path`` only labels warnings.
        """
        if self._disconnected:
            return None
        label = track_path or "track"
        slot_idx = self._safe_read_slot_idx(track, label)
        if slot_idx is None or slot_idx < 0:
            return None
        clip = self._safe_resolve_clip(track, slot_idx, label)
        if clip is None:
            return None
        return clip, slot_idx

    # --- change hook (ADR-447) --------------------------------------------

    def add_change_callback(self, cb: Callable[[str, str], None]) -> None:
        """Call ``cb(track_path, kind)`` whenever a track's playing picture may
        have changed, so another component can follow what is playing without
        a second set of per-track listeners (ADR-447, key Follow).

        ``kind`` is ``"target"`` (the track's playing or displayed clip was
        re-resolved: a launch, a stop, a clip appearing or deleted — the
        fresh-recording race included, through the ``has_clip`` fan-out — a
        highlight move, a structural rebind), ``"recorded"`` (the clip's
        ``is_recording`` flipped while the track still plays: a take ended or
        began) or ``"notes"`` (the clip's notes changed: an edit, an overdub,
        a Permute step). Called inside Live notifications, before any
        throttle, so a callback must only mark and schedule — never read
        heavily, never write. One that raises is warned once and skipped.
        """
        self._change_callbacks.append(cb)

    def _notify_change(self, track_path: str, kind: str) -> None:
        for cb in list(self._change_callbacks):
            try:
                cb(track_path, kind)
            except Exception as e:  # a subscriber's bug must not stop the playhead
                self._warn_once(track_path, "change-callback", e)

    # --- structural-change hook -----------------------------------------

    def on_structural_change(self) -> None:
        """Detach + rebind every per-track listener.

        Same identity-immune rebind ``MetersComponent.on_structural_change``
        does. Per-clip listeners are detached too (the clip wrappers
        captured in their detach records may belong to tracks that no
        longer exist; ``_safe_remove_listener`` swallows the LOM raise
        either way). Then re-walk and rebind from scratch.
        """
        if self._disconnected:
            return

        for track, remove_method, cb, path in self._slot_listeners:
            self._safe_remove_listener(track, remove_method, cb, path)
        self._slot_listeners.clear()

        for path, rec in list(self._clip_listeners.items()):
            self._detach_clip_listeners(path, rec)
        self._clip_listeners.clear()

        # Drop one-shot warning suppressions — the post-rebind LOM
        # wrappers are different objects, so a tear-down warning that
        # already fired against an old wrapper shouldn't silence a fresh
        # raise on the new one.
        self._warned.clear()

        self._bind_all_tracks()

        # Prune stale throttle / dedup state for tracks that left. The
        # dedup map is intentionally NOT cleared for surviving tracks —
        # if their post-rebind state matches the cached payload, the UI
        # is already correct and we save the emit.
        live_paths = {path for _t, _rm, _cb, path in self._slot_listeners}
        for key in list(self._last_emit.keys()):
            if key not in live_paths:
                del self._last_emit[key]
        for key in list(self._last_emitted_payload.keys()):
            if key not in live_paths:
                del self._last_emitted_payload[key]

        # Re-emit initial values so the UI sees the post-rebind state
        # (in case a track was added with a clip already playing).
        self._emit_initial_values()

    def _safe_remove_listener(
        self, target, remove_method_name: str, cb: Callable, path: str,
    ) -> None:
        """Call ``target.<remove_method_name>(cb)``, swallow LOM errors."""
        remove = getattr(target, remove_method_name, None)
        if not callable(remove):
            return
        try:
            remove(cb)
        except _LOM_ERRORS as e:
            logger.debug(
                "PlayheadComponent: %s on %s raised: %s",
                remove_method_name, path, e,
            )

    # --- listener attach -------------------------------------------------

    def _bind_highlight_listener(self) -> None:
        """Attach a ``highlighted_clip_slot`` listener on ``song.view``.

        Used to refresh the *display* slot (the one we surface when a
        track isn't playing) when Live's highlight moves. Bound once;
        torn down in ``disconnect`` and rebuilt by ``on_structural_change``
        if needed.
        """
        try:
            view = self._song.view
        except _LOM_ERRORS:
            return
        add = getattr(view, "add_highlighted_clip_slot_listener", None)
        if not callable(add):
            return
        cb = self._on_highlight_changed
        try:
            add(cb)
            self._highlight_cb = cb
        except _LOM_ERRORS as e:
            logger.debug(
                "PlayheadComponent: bind highlight listener: %s", e,
            )

    def _on_highlight_changed(self) -> None:
        """Re-resolve every track on highlight move.

        Highlight moves can affect any track's display fallback, so we
        re-apply the render target across all tracks. Playing tracks
        short-circuit inside the resolver (priority 1) and the dedup
        table suppresses no-op emits, so this is cheap.
        """
        if self._disconnected:
            return
        for idx, track in enumerate(self._iter_regular_tracks()):
            path = "tracks/%d" % idx
            self._apply_render_target(track, idx, path)

    def _bind_all_tracks(self) -> None:
        """Attach per-track ``playing_slot_index`` listeners."""
        for idx, track in enumerate(self._iter_regular_tracks()):
            path = "tracks/%d" % idx
            self._bind_track(track, idx, path)

    def _bind_track(self, track, track_idx: int, track_path: str) -> None:
        """Attach the per-track ``playing_slot_index`` listener.

        Per-clip listeners (``playing_position`` etc.) are attached by
        ``_emit_initial_values`` → ``_apply_render_target`` after this
        method returns, so we don't duplicate that work here.
        """
        cb = self._make_slot_listener(track, track_idx, track_path)
        add = getattr(track, "add_playing_slot_index_listener", None)
        if not callable(add):
            self._warn_once(
                track_path, "attach-missing",
                AttributeError(
                    "no add_playing_slot_index_listener on track",
                ),
            )
            return
        try:
            add(cb)
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "attach", e)
            return
        self._slot_listeners.append(
            (track, "remove_playing_slot_index_listener", cb, track_path),
        )

    def _make_slot_listener(
        self, track, track_idx: int, track_path: str,
    ) -> Callable[[], None]:
        """Build the per-track ``playing_slot_index`` callback closure."""

        def _on_fire(t=track, ti=track_idx, p=track_path):
            if self._disconnected:
                return
            self._apply_render_target(t, ti, p)
            # If the playing slot's clip wasn't resolvable yet
            # (fresh-recording materialization race), the empty-frame
            # emit above is the right initial state. ClipsComponent's
            # has_clip fanout via ``on_slot_has_clip_changed`` will
            # late-attach listeners and re-emit when the clip
            # materializes.

        return _on_fire

    def _attach_clip_listeners(
        self, track, track_idx: int, track_path: str, slot_idx: int,
    ) -> bool:
        """Attach ``playing_position`` (+ ``notes`` for MIDI) on the slot's clip.

        Stored in ``_clip_listeners[track_path]`` so a subsequent slot
        change (or disconnect / structural rebind) can detach against
        the same wrapper we attached on. We deliberately do NOT cache
        the clip across emits — listener fires re-resolve from the
        track each time per ADR-350.

        Returns ``True`` if listeners were attached (clip resolved),
        ``False`` if the slot didn't have a resolvable clip yet — caller
        can schedule a recheck for the "fresh recording materializing"
        case where ``playing_slot_index`` flips before ``slot.has_clip``
        becomes true.
        """
        clip = self._safe_resolve_clip(track, slot_idx, track_path)
        if clip is None:
            return False

        rec: Dict[str, Any] = {
            "clip": clip,
            "slot_idx": slot_idx,
            # LOM identity of the clip these listeners are bound to.
            # The slot index alone does not identify a clip: a replace
            # gesture deletes and re-creates in the same slot, so the
            # index is stable across a swap while the C++ handle is not.
            # Per ADR-350 this is `_live_ptr`-based, never Python-object
            # identity. It is a value INSIDE the path-keyed record, not
            # a cache key — ADR-350's warning against identity-keyed
            # caches still applies to `_clip_listeners` itself.
            "clip_id": _safe_int_id(clip),
            "clip_path": "%s/slots/%d/clip" % (track_path, slot_idx),
            "position_cb": None,
            "notes_cb": None,
            "recording_cb": None,
        }

        pos_cb = self._make_position_listener(
            track, track_idx, track_path,
        )
        add_pos = getattr(clip, "add_playing_position_listener", None)
        if callable(add_pos):
            try:
                add_pos(pos_cb)
                rec["position_cb"] = pos_cb
            except _LOM_ERRORS as e:
                self._warn_once(
                    track_path, "attach-playing-position", e,
                )
        else:
            self._warn_once(
                track_path, "attach-playing-position-missing",
                AttributeError(
                    "no add_playing_position_listener on clip",
                ),
            )

        # Notes listener — only if MIDI. Audio clips don't have notes;
        # attaching would raise. ``is_midi_clip`` is the right gate;
        # ``add_notes_listener`` is the canonical Clip method
        # (LOM-reference §Clip).
        is_midi = self._safe_is_midi_clip(clip, track_path)
        if is_midi:
            notes_cb = self._make_notes_listener(
                track_path, rec["clip_path"],
            )
            add_notes = getattr(clip, "add_notes_listener", None)
            if callable(add_notes):
                try:
                    add_notes(notes_cb)
                    rec["notes_cb"] = notes_cb
                except _LOM_ERRORS as e:
                    self._warn_once(track_path, "attach-notes", e)
            else:
                self._warn_once(
                    track_path, "attach-notes-missing",
                    AttributeError("no add_notes_listener on clip"),
                )

        # Recording listener — fires on the record→play transition
        # (and any other ``is_recording`` change). Lets us re-emit
        # ``playing_slot`` once the just-finished sample's ``file_path``
        # is populated, so the UI's waveform fetch lands the first time
        # rather than racing the disk flush. Dedup ensures a no-op
        # transition (e.g. attach-time clip already not recording, then
        # listener fires for some other reason) doesn't churn the wire.
        rec_cb = self._make_recording_listener(
            track, track_idx, track_path,
        )
        add_rec = getattr(clip, "add_is_recording_listener", None)
        if callable(add_rec):
            try:
                add_rec(rec_cb)
                rec["recording_cb"] = rec_cb
            except _LOM_ERRORS as e:
                self._warn_once(track_path, "attach-is-recording", e)

        # Edit listeners — one shared callback on every property that
        # changes what the strip draws (``_EDIT_PROPERTIES``).
        edit_cb = self._make_edit_listener(track_idx, track_path)
        rec["edit_cb"] = edit_cb
        rec["edit_props"] = []
        for prop in _EDIT_PROPERTIES:
            add = getattr(clip, "add_%s_listener" % prop, None)
            if not callable(add):
                continue
            try:
                add(edit_cb)
                rec["edit_props"].append(prop)
            except _LOM_ERRORS:
                # ``warping`` on a MIDI clip: not an error worth a log line.
                pass

        self._clip_listeners[track_path] = rec
        return True

    def _detach_clip_listeners(self, track_path: str, rec: Dict[str, Any]) -> None:
        """Detach ``playing_position`` + ``notes`` + ``is_recording`` listeners."""
        clip = rec.get("clip")
        if clip is None:
            return
        pos_cb = rec.get("position_cb")
        if pos_cb is not None:
            self._safe_remove_listener(
                clip, "remove_playing_position_listener", pos_cb,
                track_path,
            )
        notes_cb = rec.get("notes_cb")
        if notes_cb is not None:
            self._safe_remove_listener(
                clip, "remove_notes_listener", notes_cb, track_path,
            )
        rec_cb = rec.get("recording_cb")
        if rec_cb is not None:
            self._safe_remove_listener(
                clip, "remove_is_recording_listener", rec_cb, track_path,
            )
        edit_cb = rec.get("edit_cb")
        if edit_cb is not None:
            for prop in rec.get("edit_props", ()):
                self._safe_remove_listener(
                    clip, "remove_%s_listener" % prop, edit_cb, track_path,
                )

    def _make_position_listener(
        self, track, track_idx: int, track_path: str,
    ) -> Callable[[], None]:
        """Build the per-clip ``playing_position`` throttled emit closure.

        Ships ``(track_path, slot_idx, position_beats, status)`` directly
        — no anchor/rate extrapolation. The UI paints the position it
        receives; ~33 ms quantized motion is acceptable on the small
        track-strip render. When transport stops, ``playing_position``
        listeners stop firing → no emits → UI freezes naturally.
        """

        def _on_fire(t=track, ti=track_idx, p=track_path):
            if self._disconnected:
                return
            if not self._window_open(p):
                return
            # Re-resolve the slot + clip per ADR-350; the wrapper we
            # captured at attach time may now address a different LOM
            # handle even if the slot index is unchanged.
            slot_idx = self._safe_read_slot_idx(t, p)
            if slot_idx is None or slot_idx < 0:
                return
            clip = self._safe_resolve_clip(t, slot_idx, p)
            if clip is None:
                return
            pos = self._safe_read_attr(clip, "playing_position", p)
            if pos is None:
                return
            status = self._derive_status(t, slot_idx, clip, p)
            self._safe_emit(
                V3_TRACK_PLAYHEAD_ADDRESS,
                (
                    p,
                    int(slot_idx),
                    float(pos),
                    int(status),
                ),
            )

        return _on_fire

    def _make_notes_listener(
        self, track_path: str, clip_path: str,
    ) -> Callable[[], None]:
        """Build the per-clip ``notes`` notes-changed emit closure.

        Throttled per (track_path) using the same drop-intermediate window
        the playhead emit uses — but with a separate keyspace so the
        playhead's 30 Hz window doesn't suppress notes-changed fires.
        Without a throttle, recording busy MIDI input fires ``notes``
        per captured note (~16th-note rate at the upper end), which the
        UI would translate into one full clip-notes round-trip per fire.
        4 Hz coverage is ample for a "you've added/removed notes" poke;
        the live position is carried by the playhead emit.
        """

        def _on_fire(p=track_path, cp=clip_path):
            if self._disconnected:
                return
            self._notify_change(p, "notes")
            if not self._window_open(
                "notes:" + p, self.NOTES_CHANGED_WINDOW_SEC,
            ):
                return
            self._safe_emit(
                V3_CLIP_NOTES_CHANGED_ADDRESS,
                (p, cp),
            )

        return _on_fire

    # --- has_clip cross-component callback -------------------------------

    def on_slot_has_clip_changed(self, slot_path: str, has_clip: bool) -> None:
        """React to a ``slot.has_clip`` flip on any slot.

        Wired from ``ClipsComponent.add_has_clip_change_callback`` —
        ClipsComponent already owns the per-slot ``has_clip`` listener,
        and this callback is the in-process fanout.

        Implementation: parse the path, locate the track, re-apply the
        render target. The resolver decides whether the flip changes
        what the strip shows (priority 1=playing > 2=highlighted >
        3=first-non-empty > hide) and ``_apply_render_target`` makes
        the wire + listener bookkeeping match. Dedup suppresses no-op
        emits when the flip was on a slot that doesn't affect the
        rendered target.

        Path parsing: ``tracks/N/slots/M``. Anything else is ignored
        (return tracks have a different prefix; master never carries
        slots).
        """
        if self._disconnected:
            return
        parts = slot_path.split("/")
        if len(parts) != 4 or parts[0] != "tracks" or parts[2] != "slots":
            return
        try:
            track_idx = int(parts[1])
        except ValueError:
            return

        track_path = "tracks/%d" % track_idx
        tracks = self._iter_regular_tracks()
        if track_idx < 0 or track_idx >= len(tracks):
            return
        self._apply_render_target(tracks[track_idx], track_idx, track_path)

    def _make_recording_listener(
        self, track, track_idx: int, track_path: str,
    ) -> Callable[[], None]:
        """Build the per-clip ``is_recording`` emit closure.

        Fires on any ``is_recording`` change. The case we care about is
        record→play (recording finished): ``clip.file_path`` becomes
        non-empty and ``status`` flips 2→1. Live populates ``file_path``
        synchronously with the listener fire, but the audio file is
        still flushing to disk at that instant — so we schedule the
        re-emit ``RECORD_SETTLE_DELAY_MS`` later. The dedup table
        suppresses no-op re-emits (e.g. spurious listener fires that
        don't change the payload).

        If ``schedule_delayed`` was not provided (test harness without
        a scheduler), re-emit synchronously — close enough in tests
        and keeps behaviour deterministic.
        """

        def _on_fire(t=track, ti=track_idx, p=track_path):
            if self._disconnected:
                return
            slot_idx = self._safe_read_slot_idx(t, p)
            if slot_idx is None or slot_idx < 0:
                return
            self._notify_change(p, "recorded")
            if self._schedule_delayed is None:
                self._emit_playing_slot(t, ti, p, slot_idx)
                return

            def _do_emit(t=t, ti=ti, p=p):
                if self._disconnected:
                    return
                # Re-resolve slot at fire time (ADR-350: structural
                # state may have shifted under us during the delay).
                cur_slot = self._safe_read_slot_idx(t, p)
                if cur_slot is None or cur_slot < 0:
                    return
                self._emit_playing_slot(t, ti, p, cur_slot)

            try:
                self._schedule_delayed(self.RECORD_SETTLE_DELAY_MS, _do_emit)
            except Exception as e:
                self._warn_once(p, "schedule-record-recheck", e)
                # Fallback: emit now rather than dropping the update.
                self._emit_playing_slot(t, ti, p, slot_idx)

        return _on_fire

    def _make_edit_listener(
        self, track_idx: int, track_path: str,
    ) -> Callable[[], None]:
        """Build the displayed clip's edit callback (``_EDIT_PROPERTIES``).

        Marks the track and re-applies its render target on the next tick;
        further fires before then are absorbed. The track is looked up again
        by index at fire time (ADR-350): a structural change inside the
        window rebinds everything, and whatever now sits at this index is
        what the path means. Dedup makes a no-op edit free.
        """

        def _refresh(ti=track_idx, p=track_path):
            self._edit_refresh_pending.discard(p)
            if self._disconnected:
                return
            tracks = self._iter_regular_tracks()
            if 0 <= ti < len(tracks):
                self._apply_render_target(tracks[ti], ti, p)

        def _on_fire(p=track_path):
            if self._disconnected or p in self._edit_refresh_pending:
                return
            if self._schedule_delayed is None:
                _refresh()
                return
            self._edit_refresh_pending.add(p)
            try:
                self._schedule_delayed(self.EDIT_SETTLE_DELAY_MS, _refresh)
            except Exception as e:
                self._warn_once(p, "schedule-edit-refresh", e)
                _refresh()

        return _on_fire

    def _bind_transport_listener(self) -> None:
        """Attach ``song.is_playing`` so a stop re-states every position."""
        add = getattr(self._song, "add_is_playing_listener", None)
        if not callable(add):
            return
        cb = self._on_transport_changed
        try:
            add(cb)
            self._transport_cb = cb
        except _LOM_ERRORS as e:
            logger.debug("PlayheadComponent: bind is_playing listener: %s", e)

    def _on_transport_changed(self) -> None:
        """On a stop, send each live clip's position once, unthrottled.

        The 30 Hz window drops intermediate positions, so the last one a
        running clip sent can trail where Live froze it. Live keeps the
        clip marked playing while stopped (it resumes on Play), so the
        strip keeps showing it — at the position Live will resume from.
        A start needs nothing: the position listeners fire again.
        """
        if self._disconnected:
            return
        try:
            if bool(self._song.is_playing):
                return
        except _LOM_ERRORS:
            return

        def _restate():
            if self._disconnected:
                return
            for ti, track in enumerate(self._iter_regular_tracks()):
                p = "tracks/%d" % ti
                if p not in self._clip_listeners:
                    continue
                slot_idx = self._safe_read_slot_idx(track, p)
                if slot_idx is None or slot_idx < 0:
                    continue
                clip = self._safe_resolve_clip(track, slot_idx, p)
                if clip is not None:
                    self._emit_playhead_now(track, p, slot_idx, clip)

        if self._schedule_delayed is None:
            _restate()
            return
        try:
            self._schedule_delayed(self.EDIT_SETTLE_DELAY_MS, _restate)
        except Exception as e:
            logger.debug("PlayheadComponent: schedule transport restate: %s", e)
            _restate()

    def _emit_playhead_now(self, track, track_path: str, slot_idx: int, clip) -> None:
        """One ``playhead`` emit outside the 30 Hz window."""
        pos = self._safe_read_attr(clip, "playing_position", track_path)
        if pos is None:
            return
        status = self._derive_status(track, slot_idx, clip, track_path)
        self._safe_emit(
            V3_TRACK_PLAYHEAD_ADDRESS,
            (track_path, int(slot_idx), float(pos), int(status)),
        )

    # --- emits ------------------------------------------------------------

    def _emit_playing_slot(
        self, track, track_idx: int, track_path: str, slot_idx: int,
        status_override: Optional[int] = None,
    ) -> None:
        """Emit ``playing_slot`` — slot identity + render context.

        Carries everything the UI needs to set up the strip render
        (file_path for waveform fetch, length, loop bounds, looping flag,
        and the file's span so the peaks land under the right beats).
        The live playhead position is delivered separately via the
        throttled ``playhead`` emit; the UI doesn't extrapolate locally.

        ``status_override`` lets callers force ``STATUS_STOPPED`` when
        emitting the *display* slot for a track that isn't actually
        playing.
        """
        clip = self._safe_resolve_clip(track, slot_idx, track_path)
        if clip is None:
            # Slot resolved but clip read failed — emit an empty frame
            # so the UI doesn't get stuck on stale state.
            self._emit_playing_slot_empty(track_path)
            return

        is_audio = self._safe_is_audio_clip(clip, track_path)
        file_path = ""
        file_start, file_end = 0.0, 0.0
        if is_audio:
            file_path = self._safe_read_file_path(clip, track_path)
            file_start, file_end = read_file_span(clip)

        length = self._safe_read_attr(clip, "length", track_path) or 0.0
        loop_start = self._safe_read_attr(
            clip, "loop_start", track_path,
        ) or 0.0
        loop_end = self._safe_read_attr(clip, "loop_end", track_path)
        if loop_end is None:
            loop_end = length
        looping = self._safe_read_attr(clip, "looping", track_path)
        looping_flag = 1 if looping else 0

        if status_override is not None:
            status = status_override
        else:
            status = self._derive_status(track, slot_idx, clip, track_path)

        payload = (
            track_path,
            int(slot_idx),
            int(1 if is_audio else 0),
            str(file_path or ""),
            float(length),
            float(loop_start),
            float(loop_end),
            int(looping_flag),
            int(status),
            float(file_start),
            float(file_end),
        )
        sent = self._emit_playing_slot_dedup(track_path, payload)
        # A fresh ``playing_slot`` makes the UI rebuild the track's entry,
        # and a UI connecting now has no position at all. For a live clip,
        # say where it is straight away — with the transport stopped no
        # position listener will fire to say it, and the playhead would sit
        # at the clip's start while Live holds it mid-loop (measured
        # 2026-09-18: UI 0, Live 1.56).
        if sent and status != _STATUS_STOPPED:
            self._emit_playhead_now(track, track_path, slot_idx, clip)

    def _emit_playing_slot_empty(self, track_path: str) -> None:
        """Emit ``playing_slot`` with ``slot_idx=-1`` (no clip on track)."""
        payload = (
            track_path,
            int(-1),
            int(0),
            "",
            float(0.0),
            float(0.0),
            float(0.0),
            int(0),
            int(_STATUS_STOPPED),
            float(0.0),
            float(0.0),
        )
        self._emit_playing_slot_dedup(track_path, payload)

    def _emit_playing_slot_dedup(self, track_path: str, payload: tuple) -> bool:
        """Emit ``playing_slot`` only if the payload differs from last sent.

        Identical payloads are skipped — the UI's store entry is already
        in the matching state. Saves wire churn after structural rebinds
        and on display-slot re-resolutions where the resolved identity
        happens to match the one we already advertised. Returns whether
        it went out.
        """
        if self._last_emitted_payload.get(track_path) == payload:
            return False
        self._last_emitted_payload[track_path] = payload
        self._safe_emit(V3_TRACK_PLAYING_SLOT_ADDRESS, payload)
        return True

    def _emit_initial_values(self) -> None:
        """Seed the UI on cold start / handshake.

        Walks every track and applies the render target. The resolver
        picks the playing slot, the highlighted slot, or the first
        non-empty slot, in that priority order; truly-empty tracks
        emit ``slot_idx=-1`` so the UI hides their lane.

        Attaching ``playing_position`` / ``notes`` listeners to a
        display slot (track stopped) is intentional — live edits to
        the displayed clip propagate to the strip even before the
        user launches it.
        """
        for idx, track in enumerate(self._iter_regular_tracks()):
            path = "tracks/%d" % idx
            self._apply_render_target(track, idx, path)

    # --- helpers ---------------------------------------------------------

    def _derive_status(
        self, track, slot_idx: int, clip, track_path: str,
    ) -> int:
        """Return 0=stopped, 1=playing, 2=recording.

        Mirrors ``V3StateFullComponent._slot_state_and_clip``: recording
        precedence over playing because a recording clip is also
        playing, and the UI needs the narrower state for the record-arm
        pulse.
        """
        if slot_idx < 0 or clip is None:
            return _STATUS_STOPPED
        try:
            if bool(clip.is_recording):
                return _STATUS_RECORDING
        except _LOM_ERRORS:
            pass
        # ``slot.is_playing`` is on the slot; while playing_slot_index
        # is non-negative the track has a playing slot, but a slot
        # transition can briefly leave the LOM in a state where
        # ``is_playing`` reads False. Trust the index here.
        return _STATUS_PLAYING

    def _safe_read_slot_idx(self, track, track_path: str) -> Optional[int]:
        try:
            return int(track.playing_slot_index)
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "playing-slot-read", e)
            return None

    def _resolve_render_target(
        self, track, track_path: str,
    ) -> Tuple[int, Optional[int]]:
        """Single render-decision function for the track strip.

        Returns ``(slot_idx, status_override)``:

          - ``slot_idx == -1`` → strip hidden (track has no clips
            anywhere). UI hides the lane entirely; no ghost outline.
          - ``slot_idx >= 0, status_override is None`` → that slot is
            actively playing/recording; ``_emit_playing_slot`` derives
            the status from the clip's state.
          - ``slot_idx >= 0, status_override == STATUS_STOPPED`` →
            display fallback (track stopped but a clip exists worth
            showing). Status forced to stopped.

        Priority (per ADR-363 follow-up):

          1. ``playing_slot_index`` if ``>= 0`` — that clip is live.
          2. ``song.view.highlighted_clip_slot`` if on this track and
             non-empty — show what the user is focused on.
          3. First non-empty slot on the track (lowest index) — show
             *something* rather than blank if a clip exists.
          4. ``-1`` — track is genuinely empty; hide the strip.
        """
        playing = self._safe_read_slot_idx(track, track_path)
        if playing is None:
            return (-1, _STATUS_STOPPED)
        if playing >= 0:
            return (playing, None)
        display = self._resolve_display_slot(track, track_path)
        if display < 0:
            return (-1, _STATUS_STOPPED)
        return (display, _STATUS_STOPPED)

    def _apply_render_target(
        self, track, track_idx: int, track_path: str,
    ) -> None:
        """Re-resolve + (re-)attach + emit for one track.

        Every listener (playing_slot_index flip, has_clip flip,
        highlight move, structural rebind) ends up calling this. The
        resolver decides what to render; this function makes the wire
        + listener bookkeeping match.

        Skips the detach/attach dance when the resolved slot is
        unchanged (existing record's ``slot_idx`` matches) — only the
        emit fires, and dedup suppresses no-op payloads.
        """
        self._notify_change(track_path, "target")
        target_slot, status_override = self._resolve_render_target(
            track, track_path,
        )
        existing = self._clip_listeners.get(track_path)
        existing_slot = (
            existing["slot_idx"] if existing is not None else None
        )

        # Identity as well as index. `ClipsComponent.handle_load_file` has
        # replace semantics — `delete_clip()` then `create_audio_clip()`
        # (ClipsComponent.py:753-771) — so "replace the audio in this loop"
        # puts a different clip at the same index while
        # `playing_slot_index` still reads that index. On index alone this
        # short-circuited, and all three listeners stayed bound to the torn
        # down handle: the strip's playhead froze and
        # `/looping/v3/clip/notes/changed` stopped firing for that clip
        # until an unrelated structural change forced a rebind.
        same_clip = True
        existing_id = existing.get("clip_id") if existing is not None else None
        if existing_id is not None and target_slot is not None and target_slot >= 0:
            current_id = _safe_int_id(
                self._safe_resolve_clip(track, target_slot, track_path),
            )
            # Only a POSITIVE mismatch forces the rebind. An identity we
            # cannot resolve falls back to the index-only behaviour rather
            # than tearing down and re-attaching three listeners on every
            # render-target pass.
            same_clip = current_id is None or current_id == existing_id

        if target_slot == existing_slot and same_clip:
            # Listener bookkeeping unchanged. Just (re-)emit; dedup
            # suppresses byte-identical payloads.
            if target_slot < 0:
                self._emit_playing_slot_empty(track_path)
            else:
                self._emit_playing_slot(
                    track, track_idx, track_path, target_slot,
                    status_override=status_override,
                )
            return

        # Slot changed — detach old, attach new (if any), emit.
        if existing is not None:
            self._detach_clip_listeners(track_path, existing)
            self._clip_listeners.pop(track_path, None)
        if target_slot < 0:
            self._emit_playing_slot_empty(track_path)
            return
        self._attach_clip_listeners(
            track, track_idx, track_path, target_slot,
        )
        self._emit_playing_slot(
            track, track_idx, track_path, target_slot,
            status_override=status_override,
        )

    def _resolve_display_slot(self, track, track_path: str) -> int:
        """Display fallback for tracks where ``playing_slot_index < 0``.

        Returns ``-1`` if the track has no clip worth showing at all.
        Called from ``_resolve_render_target``; not invoked directly
        by listeners. Order:

          1. ``song.view.highlighted_clip_slot`` if it sits on this
             track and the slot has a clip.
          2. First non-empty slot on the track (lowest index).
          3. ``-1`` (truly empty track).
        """
        try:
            slots = list(track.clip_slots)
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "clip-slots-read", e)
            return -1

        # 1) Highlighted slot, if on this track and non-empty.
        try:
            highlighted = self._song.view.highlighted_clip_slot
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "highlighted-slot-read", e)
            highlighted = None
        if highlighted is not None:
            for idx, slot in enumerate(slots):
                if _safe_int_id(slot) == _safe_int_id(highlighted):
                    try:
                        if bool(slot.has_clip):
                            return idx
                    except _LOM_ERRORS:
                        pass
                    break

        # 2) First non-empty slot.
        for idx, slot in enumerate(slots):
            try:
                if bool(slot.has_clip):
                    return idx
            except _LOM_ERRORS:
                continue

        return -1

    def _safe_resolve_clip(
        self, track, slot_idx: int, track_path: str,
    ):
        try:
            slots = track.clip_slots
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "clip-slots-read", e)
            return None
        try:
            slot = slots[slot_idx]
        except (IndexError, KeyError, TypeError) as e:
            self._warn_once(track_path, "slot-index-oob", e)
            return None
        try:
            has_clip = bool(slot.has_clip)
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "has-clip-read", e)
            return None
        if not has_clip:
            return None
        try:
            return slot.clip
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "clip-read", e)
            return None

    def _safe_read_attr(self, obj, name: str, track_path: str):
        try:
            return getattr(obj, name)
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "%s-read" % name, e)
            return None

    def _safe_is_audio_clip(self, clip, track_path: str) -> bool:
        try:
            return bool(clip.is_audio_clip)
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "is-audio-clip-read", e)
            return False

    def _safe_is_midi_clip(self, clip, track_path: str) -> bool:
        try:
            return bool(clip.is_midi_clip)
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "is-midi-clip-read", e)
            return False

    def _safe_read_file_path(self, clip, track_path: str) -> str:
        try:
            return str(clip.file_path or "")
        except _LOM_ERRORS as e:
            self._warn_once(track_path, "file-path-read", e)
            return ""

    # --- throttle --------------------------------------------------------

    # Notes-changed emits are per-MIDI-note during recording — far too
    # busy for the 30 Hz playhead window. 250 ms (4 Hz) is plenty for a
    # "you've edited notes" poke; the playhead emit carries the live
    # position separately.
    NOTES_CHANGED_WINDOW_SEC = 0.25

    def _window_open(self, key: str, window_sec: Optional[float] = None) -> bool:
        """Return True iff the named window has elapsed for ``key``.

        Identical shape to ``MetersComponent._window_open`` for the
        default 33 ms window; optional ``window_sec`` lets callers
        choose a slower cadence (notes-changed uses 250 ms).
        """
        now = time.monotonic()
        last = self._last_emit.get(key, 0.0)
        period = window_sec if window_sec is not None else self.WINDOW_SEC
        if now - last < period:
            return False
        self._last_emit[key] = now
        return True

    # --- iteration helpers -----------------------------------------------

    def _iter_regular_tracks(self) -> List[object]:
        try:
            return list(self._song.tracks)
        except Exception as e:
            logger.warning(
                "PlayheadComponent: tracks read failed: %s", e,
            )
            return []

    # --- emit helpers ----------------------------------------------------

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning(
                "PlayheadComponent: emit %s failed: %s", address, e,
            )

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        wkey: Tuple[str, str] = (key, context)
        if wkey in self._warned:
            return
        self._warned.add(wkey)
        logger.warning(
            "PlayheadComponent %s: %s access raised %s: %s "
            "(suppressing further warnings)",
            key, context, type(exc).__name__, exc,
        )

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        """Detach every listener, drop state. Idempotent."""
        if self._disconnected:
            return
        self._disconnected = True
        self._change_callbacks.clear()

        for track, remove_method, cb, path in self._slot_listeners:
            self._safe_remove_listener(track, remove_method, cb, path)
        self._slot_listeners.clear()

        for path, rec in list(self._clip_listeners.items()):
            self._detach_clip_listeners(path, rec)
        self._clip_listeners.clear()

        if self._highlight_cb is not None:
            try:
                view = self._song.view
            except _LOM_ERRORS:
                view = None
            if view is not None:
                self._safe_remove_listener(
                    view, "remove_highlighted_clip_slot_listener",
                    self._highlight_cb, "song.view",
                )
            self._highlight_cb = None

        if self._transport_cb is not None:
            self._safe_remove_listener(
                self._song, "remove_is_playing_listener",
                self._transport_cb, "song",
            )
            self._transport_cb = None
        self._edit_refresh_pending.clear()

        self._last_emit.clear()
        self._last_emitted_payload.clear()
