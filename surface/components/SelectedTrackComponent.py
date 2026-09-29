"""SelectedTrackComponent — Phase 7 PR-7d track-selection observer.

Owns ``/looping/v3/selected_track [trackPath]`` — emitted when the
user (or Live itself) changes ``song.view.selected_track``. Retires
the M4L ``selectedTrackObserver`` + ``sendCompleteDeviceState``
round-trip (the ~30-arg fat payload). Selection-change state is
delivered as a scoped ``state/full`` the UI already knows how to
apply.

Wire contract:

    Surf → UI   /looping/v3/selected_track   [trackPath]

Where ``trackPath`` is:

- ``"tracks/<N>"`` for a regular track,
- ``"master"`` for the master track,
- **no emit** when selection lands on a return track. Per PR-7d
  design §4.2 / Q1, returns aren't in the v3 tree yet — emitting
  ``"returns/<N>"`` would glitch the UI; emitting ``"master"`` would
  lie about what's selected. Silence is the correct default until
  returns land.

pr7d-4 scope — 50ms coalesce
============================

pr7d-2 shipped the skeleton; pr7d-3 added the emit body without
debounce. pr7d-4 wraps the emit behind a 50ms coalesce window:

- On a listener fire, cache the new path as the "pending"
  target. If no commit is already scheduled, schedule one via
  the injected ``schedule_delayed(50, self._commit_pending)``.
  Subsequent fires inside the window overwrite the pending
  target but do not schedule another commit — last-wins.
- When the delayed commit fires, it reads the **cached**
  ``_pending_path`` (which was refreshed on the last listener
  fire) and emits ``/looping/v3/selected_track`` + schedules
  state/full. Clears ``_commit_scheduled`` so the next fire
  starts a fresh window.
- Return-track fires still skip emit + state/full, but they
  still participate in coalescing (the pending target becomes
  ``None``, which the commit handler treats as skip-with-
  info-log). A return→regular sequence inside one window lands
  the regular-track emit; a regular→return sequence lands the
  info-log-skip and no emit.
- 50ms matches the PR-6a catalog-rebuild debounce. Live bursts
  selection changes on some operations (insert-track fires
  twice; rapid track-strip stepping at ~4 taps/sec = 250ms
  inter-tap). 50ms swallows the burst without feeling slow.
- Reuses ``LoopingSurface._schedule_delayed`` — the 100ms
  tick-rounding adapter already used by ``BrowserProbe`` and
  ``LOMListeners``. Real Live tick granularity rounds 50ms up
  to one tick (~100ms); tests inject a deterministic
  ``schedule_delayed`` stub that lets the suite drive commits
  manually without wall-clock time.

- **No init-emit / no emit_on_accept yet.** pr7d-5 wires
  ``emit_on_accept`` into ``LoopingSurface._emit_on_accept_chain``
  alongside the other focus-scoped components.

The ``emit`` + ``schedule_state_full`` + ``schedule_delayed``
callables are invoked only from listener fires + commit; never
from ``__init__``. Tests pin commit coalescing, last-wins, and
cross-mode (regular/return) sequences.

Coexistence with ``ClipPropertiesComponent``
============================================

``ClipPropertiesComponent`` observes ``song.view.detail_clip`` on
the same ``song.view`` object. These are two different LOM
attributes; the listeners do not collide. Keep them in separate
components — their lifecycles, error paths, and scope boundaries
are cleaner apart. See PR-7d design §3.5.

LOM-touch guard
===============

Every LOM read is wrapped in ``_LOM_ERRORS`` — ``RuntimeError``,
``AttributeError``, and ``TypeError`` (the last covers
``Boost.Python.ArgumentError``, a TypeError subclass raised when a
C++ handle is invalidated; see CLAUDE.md merge-gate rule 9).
Failures log once at WARNING and swallow — selection observation
is best-effort; a torn-down handle should not crash the surface.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional, Tuple

from . import path_resolver
from .path_resolver import ResolveStatus

logger = logging.getLogger("looping")


_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum) -----------------------------------------

V3_SELECTED_TRACK_ADDRESS = "/looping/v3/selected_track"
V3_TRACK_SELECT_ADDRESS = "/looping/v3/track/select"
V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS = (
    "/looping/v3/selected_track/volume_relative"
)
# ADR-412: second Move encoder — selected drum-pad chain volume on the
# selected track's drum rack. Same hardware path (Max → UDP 11020) and
# MIDI-relative encoding as the track-volume knob above.
V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS = (
    "/looping/v3/selected_track/drum_chain/volume_relative"
)
# ROW 7c (2026-04-21): scene observe + clip-slot write retire three
# AbletonOSC addresses from the UI. Both live here because
# ``song.view`` already owns the listener lifecycle.
V3_SELECTED_SCENE_ADDRESS = "/looping/v3/selected_scene"
V3_SELECT_CLIP_ADDRESS = "/looping/v3/selected_clip"
# ADR-432: a Move pad held past the patch's threshold. The Max Utility
# patch times the hold and sends ``[note, held]`` on the encoders' lane
# (Max → UDP 11020); the note is only a tag that pairs a release with
# its hold. The surface names the pad Live selected — the pad struck,
# which the selection follows (measured 2026-09-11: a Random at +12
# before the rack left the selection on the struck pad while the sound
# came from an octave up); the raw note is the Move script's own grid
# and moves with the page — and tells the interface on the second
# address, ``[rackPath, padNote, held]``, where it lands as an external
# hold on the pad scope: momentary, never a latch.
V3_MOVE_PAD_HOLD_ADDRESS = "/looping/v3/move/pad_hold"
V3_DRUM_PAD_HOLD_ADDRESS = "/looping/v3/drum/pad_hold"

V3_ERROR_ADDRESS = "/looping/v3/error"

# Step size for Move encoder relative volume nudges. 0.002 = 0.2% of
# fader range → 500 ticks from silence to unity. Lower than ADR-320's
# original 0.005 (200 ticks) — the Python Control Surface write path
# adds tick-loop latency vs the old M4L JS write, so a smaller step
# gives finer control at the cost of longer turns for big moves.
MOVE_VOLUME_STEP = 0.002

# LOM class_name of a Drum Rack device (see data/device-configs.json —
# the authoritative class-name map; same match instrumentService and
# WahPedalComponent use). Target finder for the drum-chain volume knob.
DRUM_RACK_CLASS_NAME = "DrumGroupDevice"

# Error codes (match 04 §7.2).
V3_ERROR_PATH_NOT_FOUND = "path-not-found"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"
V3_ERROR_WRITE_REJECTED = "write-rejected"

_TRACK_RESOLVE_ERROR_MAP = {
    ResolveStatus.MALFORMED: V3_ERROR_WRITE_REJECTED,
    ResolveStatus.NOT_FOUND: V3_ERROR_PATH_NOT_FOUND,
    ResolveStatus.NOT_SUPPORTED: V3_ERROR_PATH_NOT_SUPPORTED,
}


def _coerce_str(x) -> str:
    if x is None:
        return ""
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


# --- coalesce window ------------------------------------------------------

# 50ms per design §3.2 — swallows Live's own insert-track burst (observer
# fires twice) and leaves ≥200ms of headroom for a human's next tap.
COALESCE_WINDOW_MS = 50


# --- component ------------------------------------------------------------


class SelectedTrackComponent:
    """Observes ``song.view.selected_track``; owns the canonical path.

    Args:
        song: Live ``Song`` (tests: ``StubSong``).
        emit: ``(address, args) -> None`` — OSC sender. Called
            with ``(V3_SELECTED_TRACK_ADDRESS, [path])`` from
            the delayed commit when the pending path resolves.
        schedule_state_full: ``(path: str) -> None`` — state/full
            publisher; invoked from the same commit with the just-
            committed canonical path. Phase 12 pr12-4 binds this to
            ``V3StateFullComponent.emit_selection_change`` so a
            selection change publishes a **scoped** subtree rooted
            at that path (``reason='selection-change'``).
        schedule_delayed: ``(delay_ms, fn) -> None`` — delayed
            callback scheduler; invoked with
            ``(COALESCE_WINDOW_MS, self._commit_pending)`` on
            the first listener fire that starts a coalesce
            window. pr7d-5 binds this to
            ``LoopingSurface._schedule_delayed``.

    Lifecycle:
        ``__init__`` reads current selection, computes the canonical
        path, and attaches the listener on ``song.view``. No emit.
        ``disconnect`` detaches. Idempotent.
    """

    V3_SELECTED_TRACK_ADDRESS = V3_SELECTED_TRACK_ADDRESS
    V3_TRACK_SELECT_ADDRESS = V3_TRACK_SELECT_ADDRESS
    V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS = (
        V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS
    )
    V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS = (
        V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS
    )
    V3_SELECTED_SCENE_ADDRESS = V3_SELECTED_SCENE_ADDRESS
    V3_SELECT_CLIP_ADDRESS = V3_SELECT_CLIP_ADDRESS
    V3_MOVE_PAD_HOLD_ADDRESS = V3_MOVE_PAD_HOLD_ADDRESS
    V3_DRUM_PAD_HOLD_ADDRESS = V3_DRUM_PAD_HOLD_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[[str, list], None],
        schedule_state_full: Callable[[str], None],
        schedule_delayed: Callable[[int, Callable[[], None]], None],
        should_handle_move_volume_knob: Optional[Callable[[], bool]] = None,
        on_slot_selected: Optional[Callable[[object], None]] = None,
    ):
        self._song = song
        # Called with the slot a ``selected_clip`` highlighted, so the
        # clip in it comes up in Live's clip panel
        # (``ClipsComponent.reveal_slot``).
        self._on_slot_selected = on_slot_selected
        self._emit = emit
        self._schedule_state_full = schedule_state_full
        self._schedule_delayed = schedule_delayed
        # Pulled on every ``handle_relative_volume`` invocation. When
        # off, the Move encoder's messages are silently dropped
        # (no error emit — turning the knob isn't user-facing "wrong",
        # it's just inactive). Default ``lambda: True`` preserves
        # legacy behavior.
        self._should_handle_move_volume_knob = (
            should_handle_move_volume_knob or (lambda: True)
        )
        self._disconnected = False

        # ADR-432: the Move pad holds announced to the interface, by the
        # tag the patch sent — ``tag → (rackPath, padNote)``. A release
        # names the pad it announced, never the current selection: a
        # quick hit on another pad mid-hold moves Live's selection but
        # must not move the release. Forgotten on disconnect.
        self._pad_holds: dict[int, tuple[str, int]] = {}

        # Last-computed canonical path. ``None`` when selection is on
        # a return track (skip-emit per design §4.2) or when
        # ``compose_track_path`` otherwise fails.
        self._selected_path: Optional[str] = None

        # Coalesce-window state. ``_commit_scheduled`` gates
        # ``schedule_delayed`` — only the first fire in a quiet period
        # schedules a commit; subsequent fires overwrite
        # ``_pending_path`` without re-scheduling (last-wins).
        self._pending_path: Optional[str] = None
        self._commit_scheduled: bool = False

        # (kind, context) -> True. De-dupes warning spam when a flaky
        # LOM attr keeps throwing — one WARNING then silence.
        self._warned: set = set()

        self._view = self._safe_song_view()
        self._listener_attached = False
        if self._view is not None:
            try:
                self._view.add_selected_track_listener(
                    self._on_selected_track_changed,
                )
                self._listener_attached = True
            except _LOM_ERRORS as e:
                self._warn_once("selected_track", "attach", e)

        # ROW 7c: scene listener — fires when ``song.view.selected_scene``
        # changes. No coalesce: scene changes are user-paced, not
        # burst-fired by Live the way selected_track is on insert.
        self._scene_listener_attached = False
        self._selected_scene_index: Optional[int] = None
        if self._view is not None:
            try:
                self._view.add_selected_scene_listener(
                    self._on_selected_scene_changed,
                )
                self._scene_listener_attached = True
            except _LOM_ERRORS as e:
                self._warn_once("selected_scene", "attach", e)
        self._selected_scene_index = self._compute_current_scene_index()

        # Seed ``_selected_path`` from the current selection without
        # emitting. pr7d-3 adds the emit here; pr7d-5 adds the
        # ``emit_on_accept`` hook.
        self._selected_path = self._compute_current_path()

        logger.info(
            "SelectedTrackComponent init: selected_path=%s scene_index=%s "
            "track_listener=%s scene_listener=%s",
            self._selected_path, self._selected_scene_index,
            self._listener_attached, self._scene_listener_attached,
        )

    # --- listener ---------------------------------------------------------

    def _on_selected_track_changed(self) -> None:
        """Fires when ``song.view.selected_track`` changes.

        Recompute the canonical path, stash it as the pending
        commit target, and — if no commit is already scheduled —
        kick off a 50ms delayed ``_commit_pending``. Subsequent
        fires inside the window overwrite ``_pending_path`` but
        do not re-schedule; the first-scheduled commit wins, the
        last-stashed path wins at commit time.
        """
        if self._disconnected:
            return
        self._pending_path = self._compute_current_path()
        self._selected_path = self._pending_path
        if self._commit_scheduled:
            return
        self._commit_scheduled = True
        try:
            self._schedule_delayed(COALESCE_WINDOW_MS, self._commit_pending)
        except _LOM_ERRORS as e:
            # If scheduling itself fails, clear the flag so a later
            # fire can retry. Also commit inline so this change isn't
            # dropped — degraded mode rather than silent swallow.
            self._commit_scheduled = False
            self._warn_once("selected_track", "schedule", e)
            self._commit_pending()

    def _commit_pending(self) -> None:
        """Delayed commit: emit + state/full for the last pending
        target. Clears ``_commit_scheduled`` so the next fire
        starts a fresh coalesce window. Safe to invoke after
        ``disconnect`` — gated on ``_disconnected``."""
        self._commit_scheduled = False
        if self._disconnected:
            return
        path = self._pending_path
        if path is None:
            self._info_once(
                "skip_emit_unresolved",
                "selected_track resolved to None — skipping emit",
            )
            return
        try:
            self._emit(V3_SELECTED_TRACK_ADDRESS, [path])
        except _LOM_ERRORS as e:
            self._warn_once("selected_track", "emit", e)
        try:
            self._schedule_state_full(path)
        except _LOM_ERRORS as e:
            self._warn_once("selected_track", "state_full", e)

    # --- structural change ------------------------------------------------

    def on_structural_change(self) -> None:
        """Re-emit the selection when a track add/remove moved its index.

        ``song.view.selected_track`` is an **object**, and its listener
        fires when that object changes. Delete a track *below* the
        selection and the same track is still selected — it has only
        slid down a slot — so Live fires nothing and the UI's
        positional mirror (``tracks/<N>``) is left pointing one track
        too high. Every consumer that resolves it then targets the
        wrong track: the strip highlight, the FX grid and the device
        panel.

        Hooked into ``LoopingSurface``'s structural-change composite,
        so this covers *every* path that reshapes ``song.tracks`` —
        a delete made in Live itself, an
        insert above the selection — not just the one that prompted
        it.

        Emits only when the composed path actually differs from the
        cached one, so an unrelated structural change (a device added
        somewhere) costs one comparison and no wire traffic. Bypasses
        the 50ms coalesce window: this fires once per structural
        change, which the generation/state-full machinery has already
        debounced, and it is not a burst source.
        """
        if self._disconnected:
            return
        path = self._compute_current_path()
        if path is None or path == self._selected_path:
            return
        previous = self._selected_path
        self._selected_path = path
        # Keep a coalescing fire in step: if one is pending it would
        # otherwise commit the pre-shift path a moment from now.
        self._pending_path = path
        logger.info(
            "SelectedTrackComponent: selection re-indexed by structural "
            "change %s -> %s", previous, path,
        )
        try:
            self._emit(V3_SELECTED_TRACK_ADDRESS, [path])
        except _LOM_ERRORS as e:
            self._warn_once("selected_track", "structural_emit", e)

    # --- scene listener ---------------------------------------------------

    def _on_selected_scene_changed(self) -> None:
        """Fires on ``song.view.selected_scene`` change. Recompute the
        index and emit ``/looping/v3/selected_scene [sceneIndex]``.

        No coalesce: unlike selected_track, Live does not burst-fire
        scene changes (no analog to the insert-track double-fire).
        """
        if self._disconnected:
            return
        idx = self._compute_current_scene_index()
        self._selected_scene_index = idx
        if idx is None:
            return
        try:
            self._emit(V3_SELECTED_SCENE_ADDRESS, [idx])
        except _LOM_ERRORS as e:
            self._warn_once("selected_scene", "emit", e)

    def _compute_current_scene_index(self) -> Optional[int]:
        """Return the index of ``song.view.selected_scene`` in
        ``song.scenes``, or ``None`` on LOM raise / missing scene."""
        if self._view is None:
            return None
        try:
            scene = self._view.selected_scene
        except _LOM_ERRORS as e:
            self._warn_once("selected_scene", "read", e)
            return None
        if scene is None:
            return None
        try:
            scenes = list(self._song.scenes or ())
        except _LOM_ERRORS as e:
            self._warn_once("song.scenes", "read", e)
            return None
        for i, s in enumerate(scenes):
            if s is scene:
                return i
        return None

    # --- path resolution --------------------------------------------------

    def _compute_current_path(self) -> Optional[str]:
        """Read ``song.view.selected_track`` and canonicalize.

        Returns:
            ``"tracks/<N>"`` or ``"master"`` for a resolvable
            selection. ``None`` when selection is a return track
            (path_resolver.compose_track_path short-circuits to
            ``None``) or when the LOM read fails.
        """
        if self._view is None:
            return None
        track = self._safe_selected_track()
        if track is None:
            return None
        try:
            return path_resolver.compose_track_path(self._song, track)
        except _LOM_ERRORS as e:
            self._warn_once("compose_track_path", "selected", e)
            return None

    def _safe_song_view(self):
        try:
            return self._song.view
        except _LOM_ERRORS as e:
            self._warn_once("song.view", "read", e)
            return None

    def _safe_selected_track(self):
        try:
            return self._view.selected_track
        except _LOM_ERRORS as e:
            self._warn_once("selected_track", "read", e)
            return None

    # --- observers --------------------------------------------------------

    @property
    def selected_path(self) -> Optional[str]:
        """Current canonical path or ``None``. Read-only for tests
        and pr7d-3's emit logic."""
        return self._selected_path

    @property
    def listener_attached(self) -> bool:
        return self._listener_attached

    # --- handshake --------------------------------------------------------

    def emit_on_accept(self) -> None:
        """Re-emit ``/looping/v3/selected_track`` + ``/looping/v3/selected_scene``
        on handshake accept.

        Symmetric with ``ClipPropertiesComponent.emit_on_accept`` —
        called from ``LoopingSurface._emit_on_accept_chain`` so a
        UI connecting after cold-start gets the current selection
        seeded without waiting for the next LOM fire.

        Bypasses the coalesce window — accept is a one-shot seed,
        not a burst source. If a cached value is ``None``, skip
        silently.
        """
        if self._disconnected:
            return
        path = self._selected_path
        if path is not None:
            try:
                self._emit(V3_SELECTED_TRACK_ADDRESS, [path])
            except _LOM_ERRORS as e:
                self._warn_once("selected_track", "emit_on_accept", e)
        idx = self._selected_scene_index
        if idx is not None:
            try:
                self._emit(V3_SELECTED_SCENE_ADDRESS, [idx])
            except _LOM_ERRORS as e:
                self._warn_once("selected_scene", "emit_on_accept", e)

    # --- write handler ----------------------------------------------------

    def handle_select(self, args, source_addr) -> None:
        """``/looping/v3/track/select [trackPath]`` — set
        ``song.view.selected_track`` to the track at ``trackPath``.

        Accepts ``"tracks/<N>"`` and ``"master"``. Rejects
        ``"returns/<N>"`` as ``path-not-supported`` (symmetric with
        the observer's skip-emit for returns). Any LOM raise on the
        assignment surfaces as ``write-rejected`` with the exception
        class.

        The observer listener on ``song.view.selected_track`` fires
        separately on assignment and handles the echo — no direct emit
        here. Trust-the-echo per CLAUDE.md merge-gate rule 3.
        """
        if self._disconnected:
            return
        address = V3_TRACK_SELECT_ADDRESS
        if len(args) != 1:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected 1, got %d" % len(args),
            )
            return
        track_path = _coerce_str(args[0])
        result = path_resolver.resolve_track(self._song, track_path)
        if result.status is not ResolveStatus.OK:
            code = _TRACK_RESOLVE_ERROR_MAP.get(
                result.status, V3_ERROR_WRITE_REJECTED,
            )
            self._emit_error(
                address, code,
                path=track_path, detail=result.detail or "",
            )
            return
        track = result.obj
        if self._view is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=track_path, detail="song.view unavailable",
            )
            return
        try:
            self._view.selected_track = track
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=track_path,
                detail="selected_track write raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def handle_select_clip(self, args, source_addr) -> None:
        """``/looping/v3/selected_clip [trackPath, sceneIndex]`` —
        highlight the clip slot at ``(trackPath, sceneIndex)``.

        Writes ``song.view.highlighted_clip_slot`` (the LOM analog of
        AbletonOSC's ``/live/view/set/selected_clip``). Silent wire —
        UI consumers treat this as an affordance, not an observable.
        Errors land on ``/looping/v3/error`` with the same codes as
        ``handle_select``.
        """
        if self._disconnected:
            return
        address = V3_SELECT_CLIP_ADDRESS
        if len(args) < 2:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected 2, got %d" % len(args),
            )
            return
        track_path = _coerce_str(args[0])
        try:
            scene_index = int(args[1])
        except (TypeError, ValueError):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=track_path,
                detail="sceneIndex coerce failed: %r" % (args[1],),
            )
            return
        result = path_resolver.resolve_track(self._song, track_path)
        if result.status is not ResolveStatus.OK:
            code = _TRACK_RESOLVE_ERROR_MAP.get(
                result.status, V3_ERROR_WRITE_REJECTED,
            )
            self._emit_error(
                address, code,
                path=track_path, detail=result.detail or "",
            )
            return
        track = result.obj
        try:
            slots = list(track.clip_slots or ())
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=track_path,
                detail="clip_slots read raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if scene_index < 0 or scene_index >= len(slots):
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                path=track_path,
                detail="sceneIndex %d out of range (num_slots=%d)" % (
                    scene_index, len(slots),
                ),
            )
            return
        if self._view is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=track_path, detail="song.view unavailable",
            )
            return
        try:
            self._view.highlighted_clip_slot = slots[scene_index]
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=track_path,
                detail="highlighted_clip_slot write raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if self._on_slot_selected is not None:
            self._on_slot_selected(slots[scene_index])

    # --- Move encoder relative-volume handler ----------------------------

    def handle_relative_volume(self, args, source_addr) -> None:
        """``/looping/v3/selected_track/volume_relative [midiValue]``.

        ADR-320 successor. Ableton Move's encoder sends one MIDI-style
        value per tick: ``1`` = right (volume up), ``127`` = left
        (volume down). Any other value is treated as a no-op (write-
        rejected) rather than silently interpreted.

        Reads the currently-selected track's
        ``mixer_device.volume.value``, applies ±``MOVE_VOLUME_STEP``,
        clamps to ``[0.0, 1.0]``, and writes back. The
        ``TrackMetadataComponent`` volume listener echoes the new
        value to the UI — we trust the echo here (merge-gate rule 3)
        and do not emit directly.

        Master is supported: ``_compute_current_path`` returns
        ``"master"`` when the master track is selected, and
        ``Song.master_track.mixer_device.volume`` exists on the same
        attribute path.
        """
        if self._disconnected:
            return
        address = V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS
        # Runtime toggle gate (SessionSettings move_volume_knob,
        # 2026-04-22). Silent drop — the Move sending while the
        # toggle is off isn't a user error, just an inactive input.
        # No error emit keeps Log.txt quiet when a performer parks
        # the toggle off for a whole set.
        if not self._should_handle_move_volume_knob():
            return
        if len(args) != 1:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected 1, got %d" % len(args),
            )
            return
        try:
            midi_value = int(args[0])
        except (TypeError, ValueError):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="midi-value: expected int, got %r" % (args[0],),
            )
            return
        if midi_value == 1:
            delta = MOVE_VOLUME_STEP
        elif midi_value == 127:
            delta = -MOVE_VOLUME_STEP
        else:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="midi-value: expected 1 or 127, got %d" % midi_value,
            )
            return
        track = self._safe_selected_track()
        if track is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="no selected track",
            )
            return
        try:
            volume_param = track.mixer_device.volume
            current = float(volume_param.value)
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="volume read raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        new_value = max(0.0, min(1.0, current + delta))
        try:
            volume_param.value = new_value
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="volume write raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def handle_drum_chain_relative_volume(self, args, source_addr) -> None:
        """``/looping/v3/selected_track/drum_chain/volume_relative [midiValue]``.

        ADR-412 — second Move encoder. Same MIDI-relative encoding as
        ``handle_relative_volume`` (``1`` = up, ``127`` = down,
        ±``MOVE_VOLUME_STEP``, clamp ``[0.0, 1.0]``) but the target is
        the **currently-selected drum-pad chain** of the drum rack on
        the currently-selected track: ``rack.view.selected_drum_pad``
        → ``pad.chains[0]`` → ``chain.mixer_device.volume``. Tapping a
        pad (in Live or on a controller) moves ``selected_drum_pad``,
        so the knob always nudges the sound the performer last touched.

        Chain resolution rules:

        - ``selected_drum_pad`` with a populated chain list wins.
        - An **empty** selected pad drops the message — no fallback.
          ``rack.view.selected_chain`` still points at the previously
          selected pad's chain in that state, and nudging a pad the
          user didn't select is worse than doing nothing.
        - ``selected_chain`` is consulted only when
          ``selected_drum_pad`` is ``None``.

        Context misses (no drum rack on the selected track, no pad
        selected, empty pad) are silent drops with a one-shot INFO
        line — they're normal performance states (the knob turned
        while a non-drum track is in view), not protocol errors, and
        error-emitting at encoder-tick rate would spam Log.txt.
        Malformed args and LOM raises keep the sibling handler's
        error emits.

        Rides the same ``move_volume_knob`` session toggle as the
        track-volume knob — one switch parks both Move encoders. No
        direct emit on success: chain mixers aren't in the v3 tree,
        so there's no UI consumer to sync; Live's own UI reflects the
        write.
        """
        if self._disconnected:
            return
        address = V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS
        if not self._should_handle_move_volume_knob():
            return
        if len(args) != 1:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected 1, got %d" % len(args),
            )
            return
        try:
            midi_value = int(args[0])
        except (TypeError, ValueError):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="midi-value: expected int, got %r" % (args[0],),
            )
            return
        if midi_value == 1:
            delta = MOVE_VOLUME_STEP
        elif midi_value == 127:
            delta = -MOVE_VOLUME_STEP
        else:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="midi-value: expected 1 or 127, got %d" % midi_value,
            )
            return
        track = self._safe_selected_track()
        if track is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="no selected track",
            )
            return
        rack = self._find_drum_rack(track)
        if rack is None:
            self._info_once(
                "drum_chain_no_rack",
                "drum_chain volume: no drum rack on selected track — "
                "dropping (expected when a non-drum track is in view)",
            )
            return
        chain = self._resolve_selected_drum_chain(rack)
        if chain is None:
            return
        try:
            volume_param = chain.mixer_device.volume
            current = float(volume_param.value)
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="chain volume read raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        new_value = max(0.0, min(1.0, current + delta))
        try:
            volume_param.value = new_value
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail="chain volume write raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def handle_pad_hold(self, args, source_addr) -> None:
        """``/looping/v3/move/pad_hold [note, held]`` (ADR-432).

        A Move pad held past the patch's threshold. ``held`` is ``1``
        when the hold crosses it and ``0`` when the pad lifts; ``note``
        is the raw note the Move sent, used only to pair the release
        with its hold. On ``1`` the surface reads the same context the
        drum-chain knob reads — the first ``DrumGroupDevice`` on
        ``song.view.selected_track`` and its ``view.selected_drum_pad``,
        which follows the pad struck — and emits
        ``/looping/v3/drum/pad_hold [rackPath, padNote, 1]``; on ``0``
        it emits ``[rackPath, padNote, 0]`` for the pad it announced
        under that tag, and nothing for a tag it never announced.

        Context misses — no selected track, no rack on it, no selected
        pad, an empty pad — drop silently with a one-shot INFO line, as
        the knob's do: holding a pad with a non-drum track in view is a
        performance state, not a protocol error. Malformed args reject.

        A ``1`` for a tag this component still records is a hold whose
        ``0`` never arrived — a datagram lost on the way, or the patch
        restarted mid-hold and forgot it (the patch sends ``1`` once per
        hold, at the threshold). It used to be dropped as a repeat, which
        left the stale tag in place for the rest of the session and every
        later hold of that Move pad silently ignored (code review,
        2026-09-12). Now the stale announcement is released first —
        unless the fresh hold resolves to the very same pad, in which
        case the record simply stands — and the new hold is announced as
        any other. A stale tag whose fresh hold has no context to resolve
        is released too: the patch says the pad is down again, so what
        we recorded is over either way.
        """
        if self._disconnected:
            return
        address = V3_MOVE_PAD_HOLD_ADDRESS
        if len(args) != 2:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail=f"arg-count: expected 2, got {len(args)}",
            )
            return
        try:
            tag = int(args[0])
            held = int(args[1])
        except (TypeError, ValueError):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail=f"args: expected [note:int, held:int], got {list(args)!r}",
            )
            return
        if held not in (0, 1):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="",
                detail=f"held: expected 0 or 1, got {held}",
            )
            return
        if held == 0:
            self._release_pad_hold(tag)
            return
        stale = self._pad_holds.get(tag)
        target = self._pad_hold_target()
        if target is None:
            if stale is not None:
                logger.info(
                    "SelectedTrackComponent: pad hold tag %d was still recorded "
                    "with no pad to resolve — releasing the stale hold",
                    tag,
                )
                self._release_pad_hold(tag)
            return
        rack_path, note = target
        if stale is not None:
            if stale == target:
                return  # the same pad, still held: the record stands
            logger.info(
                "SelectedTrackComponent: pad hold tag %d still recorded for %s pad %d "
                "— its release never arrived; releasing it before the new hold",
                tag, stale[0], stale[1],
            )
            self._release_pad_hold(tag)
        joined = (rack_path, note) in self._pad_holds.values()
        self._pad_holds[tag] = (rack_path, note)
        if joined:
            logger.info(
                "SelectedTrackComponent: pad hold %s pad %d joined by tag %d "
                "(already announced)",
                rack_path, note, tag,
            )
            return
        logger.info(
            "SelectedTrackComponent: pad hold %s pad %d (tag %d)",
            rack_path, note, tag,
        )
        self._emit(V3_DRUM_PAD_HOLD_ADDRESS, [rack_path, note, 1])

    def _release_pad_hold(self, tag: int) -> None:
        """Forget ``tag`` and emit ``[rackPath, padNote, 0]`` for the pad it
        announced — unless another tag still names that pad, or the tag was
        never announced (nothing to say)."""
        announced = self._pad_holds.pop(tag, None)
        if announced is None:
            return
        rack_path, note = announced
        if announced in self._pad_holds.values():
            # Two pads hit together both read the same selection (Live
            # names one pad at a time); the pad stays held until the
            # last of them lifts, or the first lift would unscope a pad
            # still under a finger (measured 2026-09-11).
            logger.info(
                "SelectedTrackComponent: pad hold on %s pad %d kept — "
                "another tag still holds it (tag %d lifted)",
                rack_path, note, tag,
            )
            return
        logger.info(
            "SelectedTrackComponent: pad hold released %s pad %d (tag %d)",
            rack_path, note, tag,
        )
        self._emit(V3_DRUM_PAD_HOLD_ADDRESS, [rack_path, note, 0])

    def _pad_hold_target(self):
        """``(rack_path, note)`` for the pad Live has selected on the first
        Drum Rack of the selected track, or ``None`` after a one-shot INFO
        line for the context miss (the knob's own drops)."""
        track = self._safe_selected_track()
        if track is None:
            self._info_once(
                "pad_hold_no_track",
                "pad hold: no selected track — dropping",
            )
            return None
        index, rack = self._find_drum_rack_indexed(track)
        if rack is None:
            self._info_once(
                "pad_hold_no_rack",
                "pad hold: no drum rack on selected track — dropping "
                "(expected when a non-drum track is in view)",
            )
            return None
        pad = self._selected_drum_pad(rack)
        if pad is None:
            return None
        try:
            note = int(pad.note)
        except (_LOM_ERRORS, TypeError, ValueError) as e:
            self._warn_once("pad_hold", "pad_note_read", e)
            return None
        rack_path = path_resolver.compose_device_path(self._song, track, index)
        if rack_path is None:
            self._info_once(
                "pad_hold_no_path",
                "pad hold: selected track has no canonical path — dropping",
            )
            return None
        return rack_path, note

    def _selected_drum_pad(self, rack):
        """``rack.view.selected_drum_pad`` when it has a chain, else
        ``None`` — an empty pad has nothing to scope, a rack with no
        selection nothing to name. Misses log one INFO line; LOM raises
        warn once."""
        try:
            view = rack.view
        except _LOM_ERRORS as e:
            self._warn_once("pad_hold", "rack_view_read", e)
            return None
        try:
            pad = view.selected_drum_pad
        except _LOM_ERRORS as e:
            self._warn_once("pad_hold", "selected_drum_pad_read", e)
            return None
        if pad is None:
            self._info_once(
                "pad_hold_no_pad",
                "pad hold: drum rack has no selected pad — dropping",
            )
            return None
        try:
            chains = list(pad.chains or ())
        except _LOM_ERRORS as e:
            self._warn_once("pad_hold", "pad_chains_read", e)
            return None
        if not chains:
            self._info_once(
                "pad_hold_empty_pad",
                "pad hold: selected drum pad has no chain — dropping (empty pad)",
            )
            return None
        return pad

    def _find_drum_rack(self, track):
        """First device on ``track`` whose ``class_name`` is
        ``DrumGroupDevice``, or ``None``. Top-level scan only — the
        same depth ``instrumentService`` (UI) and ``WahPedalComponent``
        use to locate track instruments/racks."""
        return self._find_drum_rack_indexed(track)[1]

    def _find_drum_rack_indexed(self, track):
        """``(index, rack)`` for the first Drum Rack on ``track``, or
        ``(None, None)`` — the index composes the rack's path (ADR-432)."""
        try:
            devices = list(track.devices or ())
        except _LOM_ERRORS as e:
            self._warn_once("drum_chain", "devices_read", e)
            return None, None
        for index, device in enumerate(devices):
            try:
                if getattr(device, "class_name", "") == DRUM_RACK_CLASS_NAME:
                    return index, device
            except _LOM_ERRORS:
                continue
        return None, None

    def _resolve_selected_drum_chain(self, rack):
        """Resolve the chain the drum-chain knob should nudge, or
        ``None``.

        ``selected_drum_pad`` (with ≥1 chain) wins; ``selected_chain``
        is the fallback only when no pad is selected at all. An empty
        selected pad returns ``None`` without falling back (see
        ``handle_drum_chain_relative_volume`` docstring). Misses log
        one INFO line; LOM raises warn once.
        """
        try:
            view = rack.view
        except _LOM_ERRORS as e:
            self._warn_once("drum_chain", "rack_view_read", e)
            return None
        pad = None
        try:
            pad = view.selected_drum_pad
        except _LOM_ERRORS as e:
            self._warn_once("drum_chain", "selected_drum_pad_read", e)
        if pad is not None:
            try:
                chains = list(pad.chains or ())
            except _LOM_ERRORS as e:
                self._warn_once("drum_chain", "pad_chains_read", e)
                return None
            if chains:
                return chains[0]
            self._info_once(
                "drum_chain_empty_pad",
                "drum_chain volume: selected drum pad has no chain — "
                "dropping (empty pad)",
            )
            return None
        try:
            chain = view.selected_chain
        except _LOM_ERRORS as e:
            self._warn_once("drum_chain", "selected_chain_read", e)
            return None
        if chain is None:
            self._info_once(
                "drum_chain_no_selection",
                "drum_chain volume: drum rack has no selected pad/chain "
                "— dropping",
            )
            return None
        return chain

    def _emit_error(
        self,
        originating_address: str,
        code: str,
        path: str,
        detail: str,
    ) -> None:
        if self._disconnected:
            return
        logger.warning(
            "SelectedTrackComponent: emit error addr=%r code=%r "
            "path=%r detail=%r",
            originating_address, code, path, detail,
        )
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (originating_address, code, path, detail),
            )
        except Exception as e:
            logger.warning(
                "SelectedTrackComponent: emit %s failed: %s",
                V3_ERROR_ADDRESS, e,
            )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Detach listeners. Idempotent."""
        if self._disconnected:
            return
        self._disconnected = True
        self._pad_holds.clear()
        if self._view is not None and self._listener_attached:
            remove = getattr(self._view, "remove_selected_track_listener", None)
            if remove is not None:
                try:
                    remove(self._on_selected_track_changed)
                except _LOM_ERRORS as e:
                    self._warn_once("selected_track", "detach", e)
        self._listener_attached = False
        if self._view is not None and self._scene_listener_attached:
            remove = getattr(self._view, "remove_selected_scene_listener", None)
            if remove is not None:
                try:
                    remove(self._on_selected_scene_changed)
                except _LOM_ERRORS as e:
                    self._warn_once("selected_scene", "detach", e)
        self._scene_listener_attached = False

    # --- warnings ---------------------------------------------------------

    def _warn_once(self, kind: str, context: str, exc: BaseException) -> None:
        key = (kind, context)
        if key in self._warned:
            return
        self._warned.add(key)
        logger.warning(
            "SelectedTrackComponent: %s %s failed: %s",
            kind, context, exc,
        )

    def _info_once(self, kind: str, message: str) -> None:
        """Log at INFO, de-duped on ``kind``. Used for expected
        skip paths (return-track selection) that should be
        visible in Log.txt without spamming."""
        if kind in self._warned:
            return
        self._warned.add(kind)
        logger.info("SelectedTrackComponent: %s", message)
