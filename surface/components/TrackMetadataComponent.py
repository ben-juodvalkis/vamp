"""TrackMetadataComponent — PR-5a track-metadata channel.

Owns ``/looping/v3/track/{name,color,arm,mute,solo,pan,input_routing_type,
input_routing_channel}`` per
[04 §3.3](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md)
and [phase-5-pr5a-design.md].

Scope: regular tracks only. Master is PR-5b (different LOM quirks —
``master.mute`` raises ``RuntimeError`` in Live 12). Returns are
Phase-4-follow-up. A ``"master"`` or ``"returns/<N>"`` path gets
rejected with ``path-not-supported`` here.

PR-7c extension — read-only arrangement-clips listener
---------------------------------------------------------

Alongside the 8 read/write attrs, this component owns a read-only
observer for ``track.arrangement_clips``. When the listener fires
(clip enters or leaves the arrangement view on a regular track),
the component emits ``/looping/v3/track/has_arrangement_clips
[trackPath, flag]`` and calls ``advance_generation(
"arrangement-clips-changed")`` to trigger a ``state/invalidate``.

This is a structural change — think "device add/remove" axis, not
"value change" axis — so it advances generation. The 8 metadata
attrs above do NOT advance generation (name / color / mute edits
are value changes; the listener echo + UI patch is enough).

No set handler, no echo suppression, no address in the write-side
map. The attach machinery is shared with the 8 read/write attrs
(same ``_bind_track`` / ``on_structural_change`` / ``disconnect``
lifecycle); the fire path is its own closure with its own emit +
generation-advance shape.

Why a dedicated component
-------------------------

SessionComponent is song-scoped (one listener per attribute across the
whole song). Track-metadata is track-scoped (one listener per track per
attribute, fan-out on track-add / detach on track-remove). Different
listener lifecycle; separate file keeps the diff reviewable and the
tests per-family.

Listener discipline
-------------------

This component attaches ``add_<attr>_listener`` directly on each
regular ``Track`` — it does NOT go through ``LOMListeners``.
LOMListeners owns ``tracks`` / ``devices`` / ``parameters.value``
listeners; track-attribute listeners are a different axis and the
bookkeeping is cleanest when co-located with the wire handler that
consumes them.

We DO rely on LOMListeners' structural-change fan-out: the v3
``state/full`` composite calls ``on_structural_change`` on this
component after every ``song.tracks``-changed fire, which rebinds
listeners to the current track set. Between that composite fire and
this rebind, newly-inserted tracks have no metadata listener; the
state/full emit carries their current values on the wire, so the UI
picks them up without a gap.

Echo suppression
----------------

Keyed by ``(track_path, attr)``. Every UI→Surface write sets
``self._suppress[(path, attr)] = True`` immediately before the
``setattr``; the listener callback pops-and-skips the first fire that
matches. Mirrors SessionComponent's one-shot flag (tempo drag analysis
confirmed LOM debounces a drag to one settling fire) but keyed per
(path, attr) so two simultaneous writes on different tracks don't
swallow each other's echoes.

Range validation
----------------

Validate-and-reject, never clamp — same shape as
SessionComponent.handle_set_tempo.

- ``color``: integer, ``0 ≤ v ≤ 0xFFFFFF``.
- ``pan``: float, ``-1.0 ≤ v ≤ +1.0``, NaN rejected.
- ``arm``, ``mute``, ``solo``: 0 or 1; other ints coerced to bool;
  strings rejected.
- ``name``: non-empty string, ``≤ 255`` chars.
- ``input_routing_type``, ``input_routing_channel``: strings; LOM
  raises on unknown routings — caught and emitted as
  ``write-rejected detail="invalid-routing"``.

Bool coercion on the wire
-------------------------

``arm``, ``mute``, ``solo`` are ``bool`` on the LOM; OSC codecs vary
on how they encode Python ``bool``, so the wire carries ``0``/``1``
as ints. Coerce in both directions — matches PropertyComponent's
``sample.warping`` precedent.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping
from typing import Any, Callable, Dict, List, Optional, Tuple

from .drum_vm_functions import DEVICE_TYPE_INSTRUMENT, device_type
from .path_resolver import ResolveStatus, resolve_track

logger = logging.getLogger("looping")


# LOM error tuple — matches ClipsComponent / ScenesComponent per
# CLAUDE.md merge-gate rule (9): ``Boost.Python.ArgumentError`` is a
# ``TypeError`` subclass raised when a C++ handle is invalidated.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_TRACK_NAME_ADDRESS = "/looping/v3/track/name"
V3_TRACK_COLOR_ADDRESS = "/looping/v3/track/color"
V3_TRACK_ARM_ADDRESS = "/looping/v3/track/arm"
V3_TRACK_MUTE_ADDRESS = "/looping/v3/track/mute"
V3_TRACK_SOLO_ADDRESS = "/looping/v3/track/solo"
V3_TRACK_PAN_ADDRESS = "/looping/v3/track/pan"
V3_TRACK_VOLUME_ADDRESS = "/looping/v3/track/volume"
V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS = "/looping/v3/track/input_routing_type"
V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS = (
    "/looping/v3/track/input_routing_channel"
)

# Protocol 3.7.0 — the track's *role* ("drum", "perc", "bass", …), the
# rail its instrument was loaded from.
#
# Deliberately NOT routed through ``_handle_set``: role is not a LOM
# attribute. It lives in Live's per-track key-value store
# (``Track.set_data``), which is a different mechanism with different
# failure modes — no listener wired here, no mixer-param branch, no
# int→bool coercion. Giving it its own handler keeps the generic
# attribute machine honest about what it is.
V3_TRACK_SET_ROLE_ADDRESS = "/looping/v3/track/set_role"
V3_TRACK_ROLE_ADDRESS = "/looping/v3/track/role"

# The key inside Live's per-track store.
#
# **That store is a shared namespace.** Ableton's own Push and Move
# firmware write into the same per-track dict — a saved Set shows
# ``push-instrument-selected-notes``, ``push-note-repeat-rate``,
# ``move-note-repeat-enabled`` and ``alternative_mode_locked`` sitting
# beside this key in the Track's ``<ViewData>`` element. Hence the
# ``looping.`` prefix: they prefix theirs, we prefix ours, and neither
# of us clobbers the other.
TRACK_ROLE_DATA_KEY = "looping.role"

# Returned by ``get_data`` when nothing was ever written. Cannot be a
# sentinel we invent: **there is no way to delete a key** from Live's
# store (no ``delete_data``, and writing ``None`` stores ``None``
# rather than removing the entry), so "" has to mean both "never set"
# and "cleared". A reader must treat both as "no role".
TRACK_ROLE_UNSET = ""

# Protocol 3.9.0 (ADR-439) — the preset the track's instrument was last
# loaded from, written by ``TrackPrepareComponent`` when a
# ``prepare_for_preset`` load lands and carried on the T record. It is the
# reference the swap control's folder-next steps from. Same store, same
# ``looping.`` prefix and the same no-delete rule as the role.
#
# The value is ``{"path": <the load's absolute path>, "instrument":
# {"class", "name"} | None}`` — the path with the instrument that load left
# (``preset_record``, below). The store is outside Live's undo history, so a
# bare path went on naming a preset the track no longer held after an undo;
# ``held_preset`` answers the path only while the track's first instrument
# still has that class and name, and ``""`` otherwise — which is also what a
# track with no record reads as, and a record written as a bare path before
# the instrument joined it.
TRACK_PRESET_DATA_KEY = "looping.preset"
TRACK_PRESET_UNSET = ""
V3_TRACK_PRESET_ADDRESS = "/looping/v3/track/preset"

# The roles a client may record.
#
# Mirrors ``constants.json`` → ``vendors.types``; kept as a literal here
# rather than threaded through ``config_loader`` because this component
# takes no constants today and one validation check does not justify the
# coupling. ``test_track_metadata_component`` pins the two in sync, so
# drift fails a test rather than silently widening what can be written.
#
# Validating matters more here than for a normal attribute write: Live's
# store has **no delete**, so an unrecognised value is not a transient
# wrong state that the next write corrects — it persists in the Set, and
# rides the T record to every client, until something overwrites that
# exact key. Clearing to ``TRACK_ROLE_UNSET`` stays allowed; that is how
# a client says "no role".
VALID_TRACK_ROLES = (
    "drum", "bass", "fx", "inst", "key", "perc", "synth",
)

# Toggle verb — read-then-write the inverse of current mute. Wire shape is
# ``[trackPath]`` (no value, no generation): the truth-of-record is the
# LOM at write time, so generation gating is moot. The mute listener fires
# the new value back out as a normal observer event — UI gets it for free.
V3_TRACK_MUTE_TOGGLE_ADDRESS = "/looping/v3/track/mute_toggle"

# ROW 7c: write-only send fader. Wire: ``[trackPath, sendIndex, value]``.
# Writes ``track.mixer_device.sends[sendIndex].value``. Used by the
# headphone-monitor routing in ClipCentralView (send 0 to 1.0 / 0.0);
# no observe path — if we ever need one, add a listener on sends[N].
V3_TRACK_SEND_ADDRESS = "/looping/v3/track/send"

# Read-only — listener-driven; no set handler. Emitted whenever
# ``track.arrangement_clips`` gains or loses a clip on a regular
# track. Payload: ``[trackPath, flag(0|1)]``. Added PR-7c.
V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS = (
    "/looping/v3/track/has_arrangement_clips"
)

# Reason string co-emitted with ``state/invalidate`` on fire.
_HAS_ARRANGEMENT_CLIPS_REASON = "arrangement-clips-changed"

# Group-track fold state (ADR-410). Read wire is Surf→UI
# ``[trackPath, foldState(0|1)]``; write wire is UI→Surf
# ``[trackPath, foldState(0|1), generation?]``.
V3_TRACK_FOLD_STATE_ADDRESS = "/looping/v3/track/fold_state"
V3_TRACK_SET_FOLD_STATE_ADDRESS = "/looping/v3/track/set/fold_state"

# /looping/v3/error — same address as DevicesComponent / PropertyComponent.
V3_ERROR_ADDRESS = "/looping/v3/error"

V3_ERROR_PATH_NOT_FOUND = "path-not-found"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"
V3_ERROR_GENERATION_STALE = "generation-stale"
V3_ERROR_WRITE_REJECTED = "write-rejected"


# --- attribute table ------------------------------------------------------
#
# Each entry: ``(wire_attr, lom_attr, wire_type, address)``. ``wire_attr``
# is the label that rides on the error wire and indexes the suppression
# map; ``lom_attr`` is the attribute name on Live's ``Track`` (they're
# identical today for all eight, but kept distinct so a future LOM
# rename doesn't force a wire-contract break).
#
# ``wire_type`` labels what the wire carries — ``bool01`` marks the
# int-on-wire/bool-on-LOM pair for arm/mute/solo.

_ATTR_NAME = "name"
_ATTR_COLOR = "color"
_ATTR_ARM = "arm"
_ATTR_MUTE = "mute"
_ATTR_SOLO = "solo"
_ATTR_PAN = "pan"
_ATTR_VOLUME = "volume"
_ATTR_INPUT_ROUTING_TYPE = "input_routing_type"
_ATTR_INPUT_ROUTING_CHANNEL = "input_routing_channel"


_ADDRESS_FOR_ATTR: Dict[str, str] = {
    _ATTR_NAME: V3_TRACK_NAME_ADDRESS,
    _ATTR_COLOR: V3_TRACK_COLOR_ADDRESS,
    _ATTR_ARM: V3_TRACK_ARM_ADDRESS,
    _ATTR_MUTE: V3_TRACK_MUTE_ADDRESS,
    _ATTR_SOLO: V3_TRACK_SOLO_ADDRESS,
    _ATTR_PAN: V3_TRACK_PAN_ADDRESS,
    _ATTR_VOLUME: V3_TRACK_VOLUME_ADDRESS,
    _ATTR_INPUT_ROUTING_TYPE: V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS,
    _ATTR_INPUT_ROUTING_CHANNEL: V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS,
}


# LOM attribute name for each wire attribute. ``pan`` is the one where
# the wire label and the LOM attribute diverge — Live exposes ``panning``
# on ``Track`` but every other surface (AbletonOSC, M4L, UI code) speaks
# "pan" so the wire address follows convention and we rename here.
# ``volume`` lives off the mixer device (see ``_MIXER_ATTRS`` below); its
# entry here is the mixer-param name, not a direct ``Track`` attribute.
_LOM_ATTR_FOR: Dict[str, str] = {
    _ATTR_NAME: "name",
    _ATTR_COLOR: "color",
    _ATTR_ARM: "arm",
    _ATTR_MUTE: "mute",
    _ATTR_SOLO: "solo",
    _ATTR_PAN: "panning",
    _ATTR_VOLUME: "volume",
    _ATTR_INPUT_ROUTING_TYPE: "input_routing_type",
    _ATTR_INPUT_ROUTING_CHANNEL: "input_routing_channel",
}


# Attributes whose wire form is ``int`` but LOM form is ``bool``.
_BOOL_ATTRS = frozenset({_ATTR_ARM, _ATTR_MUTE, _ATTR_SOLO})

# Attributes served off ``track.mixer_device.<param>.value`` rather than
# directly on ``track.<attr>``. Volume is the only mixer-attr in v3 — pan
# is exposed on the Track directly in this codebase and Live accepts the
# shortcut, so we keep it on the direct-attr path for symmetry with the
# existing listener/write/coerce discipline.
_MIXER_ATTRS = frozenset({_ATTR_VOLUME})


# --- helpers --------------------------------------------------------------


def _coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``. Bytes → utf-8; everything else → ``str()``.

    Mirrors PropertyComponent._coerce_str.
    """
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


def _is_regular_track_path(path: str) -> bool:
    """Return True if ``path`` names a regular track (``tracks/<N>``).

    ``master`` and ``returns/<N>`` parse fine on resolve_track but this
    component rejects them with ``path-not-supported`` — master is
    PR-5b and returns are a later phase.
    """
    return path.startswith("tracks/")


# --- the preset record (ADR-439) ------------------------------------------
#
# Written by ``TrackPrepareComponent`` and read onto the T record by
# ``V3StateFullComponent``; its format and its check live here, beside the key.


def preset_instrument(track) -> dict[str, str] | None:
    """``{"class": …, "name": …}`` of ``track``'s first instrument, or ``None``
    when its chain holds no instrument — what a ``looping.preset`` record is
    checked against. Effects on either side are skipped (a MIDI effect ahead
    of the instrument; Permute and audio effects after it). Raises the LOM's
    error family when the chain cannot be read; each caller decides what that
    means.

    Class *and* name, from the rig (Live 12.4.15b2, 2026-09-15): a native
    preset loaded onto a device of its own class keeps the device and renames
    it after the preset (``Evo 01 - Subtle Sul Tasto`` → ``Evo 02 - Subtle
    Long Wave`` on one MultiSampler, ``_live_ptr`` unchanged), and undo renames
    it back, so the name is the field that moves. ``_live_ptr`` identifies
    nothing across an undo: undo and redo each handed back a device with a
    pointer the load never had. And nothing here sees inside a plug-in —
    every Omnisphere patch reads ``AuPluginDevice`` / ``Omnisphere``.
    """
    for device in list(track.devices):
        if device_type(device) == DEVICE_TYPE_INSTRUMENT:
            return {"class": str(device.class_name), "name": str(device.name)}
    return None


def preset_record(track, preset_path: str) -> dict[str, Any] | None:
    """The ``looping.preset`` value for a load of ``preset_path`` that has just
    landed on ``track``: ``{"path", "instrument"}``, the instrument being the
    one the load left there (``None`` on a chain with none). ``None`` — the
    store's cleared value — when the chain cannot be read: a path pinned to no
    instrument could outlive its preset with nothing to notice."""
    try:
        instrument = preset_instrument(track)
    except _LOM_ERRORS:
        return None
    return {"path": preset_path, "instrument": instrument}


def held_preset(track) -> str:
    """The recorded preset path while ``track`` still holds the instrument that
    load left; ``""`` otherwise.

    Total, because it feeds the T record and a raise there empties the tree:
    a Live without the store, a key never written or cleared (``None``), a
    bare path with no instrument beside it (``looping.preset`` as 3.9.0 first
    wrote it), a malformed value and a chain that cannot be read all answer
    ``""``. A record whose load left no instrument holds while the track still
    has none.
    """
    try:
        record = track.get_data(TRACK_PRESET_DATA_KEY, TRACK_PRESET_UNSET)
    except _LOM_ERRORS:
        return TRACK_PRESET_UNSET
    if not isinstance(record, Mapping) or "instrument" not in record:
        return TRACK_PRESET_UNSET
    path = record.get("path")
    if not isinstance(path, str) or not path:
        return TRACK_PRESET_UNSET
    recorded = record["instrument"]
    if recorded is not None and not isinstance(recorded, Mapping):
        return TRACK_PRESET_UNSET
    try:
        current = preset_instrument(track)
    except _LOM_ERRORS:
        return TRACK_PRESET_UNSET
    if recorded is None or current is None:
        return path if recorded is None and current is None else TRACK_PRESET_UNSET
    same = recorded.get("class") == current["class"] and recorded.get("name") == current["name"]
    return path if same else TRACK_PRESET_UNSET


# --- component ------------------------------------------------------------


class TrackMetadataComponent:
    """Owns the ``/looping/v3/track/*`` metadata address family.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
        advance_generation: Optional callable taking a reason string
            and advancing the shared generation counter. Invoked
            only by the read-only ``arrangement_clips`` listener
            (added PR-7c) — the 8 read/write attrs do not advance
            generation on fire. If ``None``, the arrangement-clips
            listener still attaches and emits the focused address,
            but no ``state/invalidate`` is triggered alongside. A
            warning is logged once at init so the misconfiguration
            is visible.

    Generation injection for the write-side stale check is deferred
    via :meth:`set_generation`. Without it, ``handle_set_*`` rejects
    writes with ``write-rejected detail="surface misconfigured"``.
    """

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        advance_generation: Optional[Callable[[str], None]] = None,
    ) -> None:
        self._song = song
        self._emit = emit
        self._generation = None
        self._advance_generation = advance_generation
        self._disconnected = False

        # (track_path, attr) → True for exactly one suppressed fire.
        self._suppress: Dict[Tuple[str, str], bool] = {}

        # Detach records — flat list of every listener we attached.
        # Each record is ``(target, remove_method_name, cb, path)``
        # where ``target`` is whatever object owns the listener (the
        # track itself for direct-attr listeners, the mixer parameter
        # for ``volume``). The list, not ``id(track)``-keyed bookkeeping,
        # is the source of truth for detach: Live's v3 framework hands
        # out fresh Python wrappers per ``song.tracks`` read (ADR-350),
        # so ``id()`` is never stable across reads. The wrapper we
        # attached on is still valid for detach — it stays alive in
        # this list and points at the same underlying LOM handle.
        self._listeners: List[Tuple[Any, str, Callable, str]] = []

        # Same shape, separate list for the read-only ``arrangement_clips``
        # listener (PR-7c). Kept out of ``_listeners`` because its fire
        # path (read length → emit → advance gen) and detach method
        # name are distinct from the 8-attr "echo the new value" path.
        self._arrangement_clips_listeners: List[
            Tuple[Any, Callable, str]
        ] = []

        # Group-fold bookkeeping (ADR-410). ``track_path -> 0|1`` of the
        # last fold state we put on the wire, so the song-scoped
        # ``visible_tracks`` fire only emits what actually changed (it
        # also fires on plain track add/remove, and on our own writes).
        self._fold_states: Dict[str, int] = {}
        self._visible_tracks_listener: Optional[Callable] = None

        if advance_generation is None:
            logger.warning(
                "TrackMetadataComponent: advance_generation not wired; "
                "arrangement_clips fires will emit the focused address "
                "but not advance generation"
            )

        self._bind_all_tracks()
        self._bind_visible_tracks()
        self._seed_fold_states()
        logger.info(
            "TrackMetadataComponent ready: %d listener records "
            "(8 attrs + arrangement_clips per regular track), "
            "%d foldable track(s)",
            len(self._listeners) + len(self._arrangement_clips_listeners),
            len(self._fold_states),
        )

    def set_generation(self, generation_component) -> None:
        """Inject the ``GenerationComponent`` for stale-write checks.

        Mirrors DevicesComponent.set_generation / PropertyComponent.
        Idempotent.
        """
        self._generation = generation_component

    # --- structural-change hook -------------------------------------------

    def on_structural_change(self) -> None:
        """Detach every prior listener, rebind against the current walk.

        Fires from LoopingSurface's composite structural-change callback,
        after v3 state/full republish. Issue #399: stale closures from
        a prior bind capture the *old* canonical path; after a delete,
        the surviving track at the same index keeps emitting on the
        deleted track's path, contaminating the sibling slot in the UI
        store. Drop everything and rebuild — no identity-based "did
        this track move?" bookkeeping (ADR-350: ``_live_ptr``-based
        identity, never ``is``-based; the previous attempt that keyed
        on ``id(track)`` lost detach refs because Live hands out fresh
        wrappers per read, double-attached, and made the bug worse).

        The cost is ``9 detach + 9 attach × N tracks`` per structural
        change — microseconds for typical sets, runs only on add /
        remove / reorder. Detach calls swallow ``Boost.Python.ArgumentError``
        (a ``TypeError`` subclass) for handles whose C++ side already
        tore down when the track left the song.
        """
        if self._disconnected:
            return

        for target, remove_method_name, cb, path in self._listeners:
            self._safe_remove_listener(target, remove_method_name, cb, path)
        self._listeners.clear()

        for track, cb, path in self._arrangement_clips_listeners:
            self._safe_remove_listener(
                track, "remove_arrangement_clips_listener", cb, path,
            )
        self._arrangement_clips_listeners.clear()

        for idx, track in enumerate(self._iter_regular_tracks()):
            self._bind_track(track, "tracks/%d" % idx)

        # Track indices shifted, so cached fold state is keyed on stale
        # paths. Drop it and re-seed — the accompanying state/full
        # carries the fresh values, so this is cache maintenance, not a
        # re-emit.
        self._fold_states.clear()
        self._seed_fold_states()

        # Same argument, sharper consequence. ``_suppress`` is armed
        # BEFORE a write and popped by the listener fire it expects.
        # Live only fires on an actual change, so a write that set the
        # value it already held leaves the flag standing — and the flag
        # is keyed on a PATH. After a structural change that path names
        # a different track, so the next genuine fire for that attribute
        # on that index is swallowed and the UI shows a stale value with
        # nothing to correct it. Every listener here was just rebound;
        # none of the old expectations can still be owed.
        self._suppress.clear()

    # --- group fold state (ADR-410) ---------------------------------------

    def _bind_visible_tracks(self) -> None:
        """Attach the song-scoped ``visible_tracks`` listener.

        This is the *only* signal Live gives us for a fold. Verified
        against Live 12.4.5b8: ``Track`` exposes **no**
        ``add_fold_state_listener`` and **no** ``add_is_visible_listener``
        — folding a group in Live's own UI fires nothing track-side.
        ``Song.visible_tracks`` is observable and does change (a fold
        removes the children from it), so it's the hook.

        Song-scoped, so it survives track add/remove and is bound once
        in ``__init__`` rather than rebuilt in ``on_structural_change``
        (the song object is stable for the component's lifetime).
        """
        add = getattr(self._song, "add_visible_tracks_listener", None)
        if not callable(add):
            logger.warning(
                "TrackMetadataComponent: song has no "
                "add_visible_tracks_listener; group folds will not reach "
                "the UI until the next state/full"
            )
            return

        def _on_fire():
            if self._disconnected:
                return
            self._emit_changed_fold_states()

        try:
            add(_on_fire)
        except _LOM_ERRORS as e:
            logger.warning(
                "TrackMetadataComponent: add_visible_tracks_listener "
                "raised: %s", e,
            )
            return
        self._visible_tracks_listener = _on_fire

    def _iter_foldable_tracks(self):
        """Yield ``(track_path, fold_state_int)`` for every Group Track.

        ``fold_state`` **raises** on a non-foldable track in Live 12 —
        it is not merely absent — so the ``is_foldable`` gate has to
        come first and both reads stay inside the guard.
        """
        for idx, track in enumerate(self._iter_regular_tracks()):
            try:
                if not track.is_foldable:
                    continue
                flag = 1 if track.fold_state else 0
            except _LOM_ERRORS:
                continue
            except Exception:
                continue
            yield "tracks/%d" % idx, flag

    def _seed_fold_states(self) -> None:
        """Populate the fold cache without emitting."""
        for track_path, flag in self._iter_foldable_tracks():
            self._fold_states[track_path] = flag

    def _emit_changed_fold_states(self) -> None:
        """Emit ``/looping/v3/track/fold_state`` for every changed group.

        No generation advance: a fold changes nothing about the LOM
        *tree* (no track is added, removed, or reordered), only which
        rows Live draws. The UI recomputes visibility from the group
        tree it already has, so a compact per-track echo is enough —
        republishing the whole state/full for a fold would ship ~4.5k
        args to hide six rows.
        """
        for track_path, flag in self._iter_foldable_tracks():
            if self._fold_states.get(track_path) == flag:
                continue
            self._fold_states[track_path] = flag
            self._safe_emit(V3_TRACK_FOLD_STATE_ADDRESS, (track_path, flag))

    def _safe_remove_listener(
        self, target, remove_method_name: str, cb: Callable, path: str,
    ) -> None:
        """Call ``target.<remove_method_name>(cb)``, swallow LOM errors.

        Live tears down C++-side listeners when the LOM handle leaves
        the song, in which case the Python remove call raises
        ``Boost.Python.ArgumentError`` (a ``TypeError`` subclass) or
        ``RuntimeError``. Either is benign — we wanted detach, the C++
        side already did it. Logged at DEBUG so a delete-heavy session
        doesn't flood Log.txt.
        """
        remove = getattr(target, remove_method_name, None)
        if not callable(remove):
            return
        try:
            remove(cb)
        except _LOM_ERRORS as e:
            logger.debug(
                "TrackMetadataComponent: %s on %s raised: %s",
                remove_method_name, path, e,
            )
        except Exception as e:
            logger.debug(
                "TrackMetadataComponent: %s on %s raised: %s",
                remove_method_name, path, e,
            )

    # --- listener attach / detach -----------------------------------------

    def _bind_all_tracks(self) -> None:
        """Initial walk — attach 8 listeners per regular track.

        Indexes come from the single ``song.tracks`` read here — we do
        not round-trip through a second read to look up the index of
        ``track`` by identity. Live's LOM returns fresh Python wrappers
        on every ``song.tracks`` read, so a later ``is`` comparison
        against a wrapper from an earlier read mis-matches. The path
        captured into the listener closure is authoritative.
        """
        for idx, track in enumerate(self._iter_regular_tracks()):
            self._bind_track(track, "tracks/%d" % idx)

    def _bind_track(self, track, track_path: str) -> None:
        """Attach ``add_<attr>_listener`` for each of the 9 attrs on ``track``.

        Direct-attr listeners attach on ``track`` itself; mixer-attr
        listeners (``volume``) attach on ``track.mixer_device.<param>``
        via ``add_value_listener``. Each successful attach pushes a
        detach record onto ``_listeners`` so ``on_structural_change``
        and ``disconnect`` can rebuild without identity bookkeeping.
        Also attaches the read-only ``arrangement_clips`` listener
        (PR-7c) tracked in its own list.
        """
        for attr in _ADDRESS_FOR_ATTR:
            if attr in _MIXER_ATTRS:
                self._bind_mixer_attr(track, track_path, attr)
                continue
            listener_method = "add_%s_listener" % _LOM_ATTR_FOR[attr]
            add = getattr(track, listener_method, None)
            if not callable(add):
                # Older Live or a test stub without this listener;
                # log at DEBUG so it doesn't flood real sessions and
                # move on — the wire handler still works, we just
                # won't emit on outside edits for this attr.
                logger.debug(
                    "TrackMetadataComponent: track has no %s; "
                    "skipping", listener_method,
                )
                continue
            cb = self._make_listener(track=track, attr=attr, path=track_path)
            try:
                add(cb)
            except Exception as e:
                logger.warning(
                    "TrackMetadataComponent: %s failed for %s: %s",
                    listener_method, track_path, e,
                )
                continue
            self._listeners.append((
                track,
                "remove_%s_listener" % _LOM_ATTR_FOR[attr],
                cb,
                track_path,
            ))

        self._bind_arrangement_clips(track, track_path)

    def _bind_mixer_attr(
        self, track, track_path: str, attr: str,
    ) -> None:
        """Attach ``add_value_listener`` on ``track.mixer_device.<param>``.

        Mirrors MasterComponent._attach_mixer_attr. On a LOM read failure
        we log once and skip — the wire handler still works. Stores the
        mixer param (not the track) as the detach target so the rebind
        path can call ``remove_value_listener`` on the same wrapper we
        attached on.
        """
        param = self._resolve_mixer_param(track, attr)
        if param is None:
            logger.debug(
                "TrackMetadataComponent: mixer %s unavailable on %s; "
                "listener skipped", attr, track_path,
            )
            return
        add = getattr(param, "add_value_listener", None)
        if not callable(add):
            logger.debug(
                "TrackMetadataComponent: mixer %s on %s has no "
                "add_value_listener; skipping", attr, track_path,
            )
            return
        cb = self._make_mixer_listener(
            track=track, attr=attr, path=track_path,
        )
        try:
            add(cb)
        except _LOM_ERRORS as e:
            logger.warning(
                "TrackMetadataComponent: add_value_listener on mixer %s "
                "for %s failed: %s", attr, track_path, e,
            )
            return
        self._listeners.append(
            (param, "remove_value_listener", cb, track_path),
        )

    def _resolve_mixer_param(self, track, attr: str):
        """Return ``track.mixer_device.<param>`` or ``None`` on LOM raise.

        Mirrors MasterComponent._resolve_mixer_param. The LOM guard
        covers torn-down handles (TypeError via Boost.Python) and
        regressed mixer shape.
        """
        try:
            mixer = track.mixer_device
        except _LOM_ERRORS as e:
            logger.debug(
                "TrackMetadataComponent: mixer_device read failed: %s", e,
            )
            return None
        try:
            return getattr(mixer, _LOM_ATTR_FOR[attr])
        except _LOM_ERRORS as e:
            logger.debug(
                "TrackMetadataComponent: mixer.%s read failed: %s",
                _LOM_ATTR_FOR[attr], e,
            )
            return None

    def _bind_arrangement_clips(self, track, track_path: str) -> None:
        """Attach ``add_arrangement_clips_listener`` on ``track``. PR-7c.

        No-op if the LOM doesn't expose the listener (older Live builds
        or test stubs that haven't opted in) — the 8-attr path stays
        intact. Successful attach pushes a detach record onto
        ``_arrangement_clips_listeners``.
        """
        add = getattr(track, "add_arrangement_clips_listener", None)
        if not callable(add):
            logger.debug(
                "TrackMetadataComponent: track has no "
                "add_arrangement_clips_listener; skipping (path=%s)",
                track_path,
            )
            return
        cb = self._make_arrangement_clips_listener(
            track=track, path=track_path,
        )
        try:
            add(cb)
        except Exception as e:
            logger.warning(
                "TrackMetadataComponent: "
                "add_arrangement_clips_listener failed for %s: %s",
                track_path, e,
            )
            return
        self._arrangement_clips_listeners.append((track, cb, track_path))

    def _make_listener(
        self, track, attr: str, path: str,
    ) -> Callable[[], None]:
        """Build the closure for one (track, attr) pair.

        Captures both ``track`` (for ``getattr`` on fire) and ``path``
        + ``attr`` (for the emit address). Closure structure chosen
        deliberately to sidestep the PR-4a regression class where a
        loop variable was captured by reference and fire always read
        the last-iteration value.
        """

        def _on_fire(t=track, a=attr, p=path):
            if self._disconnected:
                return
            key = (p, a)
            if self._suppress.pop(key, False):
                return
            try:
                value = getattr(t, _LOM_ATTR_FOR[a])
            except Exception as e:
                logger.warning(
                    "TrackMetadataComponent: read %s.%s raised: %s",
                    p, a, e,
                )
                return
            wire_value = self._coerce_to_wire(a, value)
            self._safe_emit(_ADDRESS_FOR_ATTR[a], (p, wire_value))

        return _on_fire

    def _make_mixer_listener(
        self, track, attr: str, path: str,
    ) -> Callable[[], None]:
        """Build the closure for a mixer-attr listener (``volume``).

        Reads ``track.mixer_device.<param>.value`` on fire. Suppression
        is keyed on (path, attr) just like direct-attr listeners.
        """

        def _on_fire(t=track, a=attr, p=path):
            if self._disconnected:
                return
            key = (p, a)
            if self._suppress.pop(key, False):
                return
            param = self._resolve_mixer_param(t, a)
            if param is None:
                return
            try:
                value = param.value
            except _LOM_ERRORS as e:
                logger.warning(
                    "TrackMetadataComponent: read mixer %s.value on %s "
                    "raised: %s", a, p, e,
                )
                return
            wire_value = self._coerce_to_wire(a, value)
            self._safe_emit(_ADDRESS_FOR_ATTR[a], (p, wire_value))

        return _on_fire

    def _make_arrangement_clips_listener(
        self, track, path: str,
    ) -> Callable[[], None]:
        """Build the closure for a track's ``arrangement_clips`` listener.

        Fire path (design §4 of phase-7-pr7c-design): read
        ``len(track.arrangement_clips) > 0`` (LOM errors swallowed →
        no emit, no generation advance), emit the focused address,
        then advance generation with the ``arrangement-clips-changed``
        reason so the next ``state/full`` carries the new T-record.
        Both emit and generation advance are guarded against late-fire
        races via ``_disconnected`` on the enclosing component.
        """

        def _on_fire(t=track, p=path):
            if self._disconnected:
                return
            try:
                clips = t.arrangement_clips
                flag = 1 if len(clips) > 0 else 0
            except _LOM_ERRORS as e:
                logger.warning(
                    "TrackMetadataComponent: read arrangement_clips on "
                    "%s raised: %s", p, e,
                )
                return
            self._safe_emit(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS, (p, flag))
            if self._advance_generation is None:
                return
            try:
                self._advance_generation(_HAS_ARRANGEMENT_CLIPS_REASON)
            except Exception as e:
                logger.warning(
                    "TrackMetadataComponent: advance_generation raised "
                    "on %s fire: %s", p, e,
                )

        return _on_fire

    # --- set handlers -----------------------------------------------------
    #
    # Eight handler methods, one per attribute. LoopingSurface registers
    # each as a transport handler. We avoid a single generic "dispatch
    # by attr name" handler because the transport's handler registry is
    # address-indexed — one handler per address is the clean shape.

    def handle_set_name(self, args, source_addr) -> None:
        self._handle_set(_ATTR_NAME, args)

    def handle_set_color(self, args, source_addr) -> None:
        self._handle_set(_ATTR_COLOR, args)

    def handle_set_role(self, args, source_addr) -> None:
        """``[trackPath:string, role:string]`` — write the track's role.

        Protocol 3.7.0. Persists the rail an instrument was loaded from
        into Live's per-track key-value store, so the UI stops
        re-deriving it every session from a 2.46 MB catalog fetch plus a
        three-tier guess. The value survives save/reload (verified
        against a saved ``.als``) and survives a track duplicate.

        No generation gate, and that is on purpose. Every other write
        here mutates a LOM attribute whose value the UI is also
        rendering, so a stale write can paint the wrong thing. A role is
        recorded *by* the load that just happened — the caller is the
        authority, not a client echoing state back — and the write
        arrives on the prepare-ack path where a generation advance is
        already in flight. Gating it would reject the one write that is
        always correct.

        Echoes ``/looping/v3/track/role`` on success. The store does
        have a listener (``add_data_listener``), but a write-path echo
        is what the rest of this component does and it costs one emit
        rather than a listener lifecycle per track.
        """
        if self._disconnected:
            return
        if len(args) < 2:
            self._emit_error(
                V3_TRACK_SET_ROLE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="expected [trackPath, role]",
            )
            return
        try:
            track_path = _coerce_str(args[0])
            role = _coerce_str(args[1])
        except Exception as e:
            self._emit_error(
                V3_TRACK_SET_ROLE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="coerce args: %s" % e,
            )
            return

        if role != TRACK_ROLE_UNSET and role not in VALID_TRACK_ROLES:
            self._emit_error(
                V3_TRACK_SET_ROLE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                track_path=track_path,
                detail="unknown role %r (expected one of %s, or \"\" to clear)"
                       % (role, ", ".join(VALID_TRACK_ROLES)),
            )
            return

        if not _is_regular_track_path(track_path):
            self._emit_error(
                V3_TRACK_SET_ROLE_ADDRESS, V3_ERROR_PATH_NOT_SUPPORTED,
                track_path=track_path,
                detail="master and returns carry no role",
            )
            return

        result = resolve_track(self._song, track_path)
        if result.status is not ResolveStatus.OK:
            code = (
                V3_ERROR_PATH_NOT_SUPPORTED
                if result.status is ResolveStatus.NOT_SUPPORTED
                else V3_ERROR_PATH_NOT_FOUND
            )
            self._emit_error(
                V3_TRACK_SET_ROLE_ADDRESS, code,
                track_path=track_path, detail=result.detail,
            )
            return

        try:
            result.obj.set_data(TRACK_ROLE_DATA_KEY, role)
        except Exception as e:
            # ``set_data`` landed in Live 12; a surface running against
            # an older build has no store at all. Report it rather than
            # raising on the control thread.
            #
            # Be clear about the consequence: there is **no fallback**.
            # This comment used to say the UI degrades to the catalog
            # tier it used before 3.7.0 — that tier was deleted in the
            # same change that added this handler (ADR-425). A write
            # that fails here leaves the track with no role at all, so
            # the only remaining gate is the bare Drum Rack class check;
            # a non-Drum-Rack drum preset then shows no rail until
            # something records a role successfully. The emitted
            # ``write-rejected`` is the UI's only signal that happened.
            logger.warning(
                "TrackMetadataComponent: set_data role on %s raised: %s",
                track_path, e,
            )
            self._emit_error(
                V3_TRACK_SET_ROLE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                track_path=track_path,
                detail="lom rejected: %s" % e,
            )
            return

        logger.info(
            "TrackMetadataComponent: role %s = %r", track_path, role,
        )
        self._emit(V3_TRACK_ROLE_ADDRESS, (track_path, role))

    def handle_set_arm(self, args, source_addr) -> None:
        self._handle_set(_ATTR_ARM, args)

    def handle_set_mute(self, args, source_addr) -> None:
        self._handle_set(_ATTR_MUTE, args)

    def handle_set_solo(self, args, source_addr) -> None:
        self._handle_set(_ATTR_SOLO, args)

    def handle_set_pan(self, args, source_addr) -> None:
        self._handle_set(_ATTR_PAN, args)

    def handle_set_volume(self, args, source_addr) -> None:
        self._handle_set(_ATTR_VOLUME, args)

    def handle_set_input_routing_type(self, args, source_addr) -> None:
        self._handle_set(_ATTR_INPUT_ROUTING_TYPE, args)

    def handle_set_input_routing_channel(self, args, source_addr) -> None:
        self._handle_set(_ATTR_INPUT_ROUTING_CHANNEL, args)

    def handle_set_fold_state(self, args, source_addr) -> None:
        """Fold / unfold a Group Track. Wire: ``[trackPath, foldState(0|1)]``.

        ADR-410. Not routed through ``_handle_set`` because ``fold_state``
        is unlike the nine table-driven attrs in two ways that matter:
        it **raises** when read or written on a non-foldable track, and
        it has **no listener**, so nothing echoes the new value back.
        The write path therefore emits the echo itself — the same
        write-path-echo shape ``Groove.base`` needs.

        No generation gate: a fold is a view operation with no stale-write
        hazard (it's idempotent and index-independent), matching
        ``handle_mute_toggle``'s stance.
        """
        if self._disconnected:
            return
        address = V3_TRACK_SET_FOLD_STATE_ADDRESS
        if len(args) < 2:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED, "",
                "expected [trackPath, foldState]",
            )
            return
        try:
            track_path = _coerce_str(args[0])
        except Exception as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED, "",
                "coerce track_path: %s" % e,
            )
            return
        try:
            fold = 1 if int(args[1]) else 0
        except (TypeError, ValueError) as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED, track_path,
                "bad foldState: %s" % e,
            )
            return

        if not _is_regular_track_path(track_path):
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED, track_path,
                "master and returns cannot be folded",
            )
            return

        result = resolve_track(self._song, track_path)
        if result.status is ResolveStatus.MALFORMED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND, track_path,
                "malformed: %s" % result.detail,
            )
            return
        if result.status is ResolveStatus.NOT_SUPPORTED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED, track_path,
                result.detail or "",
            )
            return
        if result.status is not ResolveStatus.OK:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND, track_path,
                result.detail or "",
            )
            return

        track = result.obj
        try:
            foldable = bool(track.is_foldable)
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED, track_path,
                "read is_foldable raised: %s" % e,
            )
            return
        if not foldable:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED, track_path,
                "not a group track",
            )
            return

        try:
            track.fold_state = bool(fold)
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED, track_path,
                "write fold_state raised: %s" % e,
            )
            return

        # Write-path echo. The ``visible_tracks`` listener normally fires
        # on a real fold and would emit this too, but the cache write
        # here makes that a dedup'd no-op — and a group whose children
        # are already hidden by an outer fold changes no visible track,
        # so the listener may not fire at all.
        self._fold_states[track_path] = fold
        self._safe_emit(V3_TRACK_FOLD_STATE_ADDRESS, (track_path, fold))

    def handle_mute_toggle(self, args, source_addr) -> None:
        """Toggle the resolved track's mute. Wire: ``[trackPath]``.

        Single-writer pattern: read current ``mute`` via LOM, write the
        inverse, let the existing mute listener fire the new value out.
        Generation is intentionally absent — the read-modify-write is
        atomic at the LOM, so there's no client-stale window to gate on.
        Mirrors the suppress-then-setattr discipline of ``_handle_set``
        so the listener echo is swallowed, same as a normal mute write.
        """
        if self._disconnected:
            return
        address = V3_TRACK_MUTE_TOGGLE_ADDRESS
        if len(args) < 1:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="expected [trackPath]",
            )
            return
        try:
            track_path = _coerce_str(args[0])
        except Exception as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="coerce track_path: %s" % e,
            )
            return

        if not _is_regular_track_path(track_path):
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED,
                track_path=track_path,
                detail="master and returns not owned by TrackMetadataComponent",
            )
            return

        result = resolve_track(self._song, track_path)
        if result.status is ResolveStatus.MALFORMED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                track_path=track_path,
                detail="malformed: %s" % result.detail,
            )
            return
        if result.status is ResolveStatus.NOT_SUPPORTED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED,
                track_path=track_path,
                detail=result.detail,
            )
            return
        if result.status is ResolveStatus.NOT_FOUND:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                track_path=track_path,
                detail=result.detail,
            )
            return

        track = result.obj
        try:
            current = bool(getattr(track, _LOM_ATTR_FOR[_ATTR_MUTE]))
        except Exception as e:
            logger.warning(
                "TrackMetadataComponent: read mute on %s raised: %s",
                track_path, e,
            )
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path, detail="lom read failed: %s" % e,
            )
            return

        new_value = not current
        self._suppress[(track_path, _ATTR_MUTE)] = True
        try:
            setattr(track, _LOM_ATTR_FOR[_ATTR_MUTE], new_value)
        except Exception as e:
            self._suppress.pop((track_path, _ATTR_MUTE), None)
            logger.warning(
                "TrackMetadataComponent: setattr %s.mute = %r raised: %s",
                track_path, new_value, e,
            )
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path, detail="lom rejected: %s" % e,
            )

    def handle_set_send(self, args, source_addr) -> None:
        """``/looping/v3/track/send [trackPath, sendIndex, value]``.

        Write-only wire. Writes ``track.mixer_device.sends[N].value``
        (a ``DeviceParameter`` — same write surface as volume/pan).
        No observe path — callers treat this as a fire-and-forget
        routing nudge (headphone-monitor toggle in ClipCentralView).
        Errors land on ``/looping/v3/error``.
        """
        if self._disconnected:
            return
        address = V3_TRACK_SEND_ADDRESS
        if len(args) < 3:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="expected [trackPath, sendIndex, value]",
            )
            return
        try:
            track_path = _coerce_str(args[0])
        except Exception as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="coerce track_path: %s" % e,
            )
            return
        try:
            send_index = int(args[1])
        except (TypeError, ValueError):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path,
                detail="sendIndex coerce failed: %r" % (args[1],),
            )
            return
        try:
            value = float(args[2])
        except (TypeError, ValueError):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path,
                detail="value coerce failed: %r" % (args[2],),
            )
            return
        if not _is_regular_track_path(track_path):
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED,
                track_path=track_path,
                detail="sends only on regular tracks",
            )
            return
        result = resolve_track(self._song, track_path)
        if result.status is not ResolveStatus.OK:
            code_map = {
                ResolveStatus.MALFORMED: V3_ERROR_PATH_NOT_FOUND,
                ResolveStatus.NOT_FOUND: V3_ERROR_PATH_NOT_FOUND,
                ResolveStatus.NOT_SUPPORTED: V3_ERROR_PATH_NOT_SUPPORTED,
            }
            self._emit_error(
                address,
                code_map.get(result.status, V3_ERROR_WRITE_REJECTED),
                track_path=track_path,
                detail=result.detail or "",
            )
            return
        track = result.obj
        try:
            sends = list(track.mixer_device.sends or ())
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path,
                detail="sends read raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if send_index < 0 or send_index >= len(sends):
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                track_path=track_path,
                detail="sendIndex %d out of range (num_sends=%d)" % (
                    send_index, len(sends),
                ),
            )
            return
        try:
            sends[send_index].value = value
        except Exception as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path,
                detail="sends[%d] write raised: %s: %s" % (
                    send_index, type(e).__name__, str(e)[:80],
                ),
            )

    def _handle_set(self, attr: str, args) -> None:
        """Shared body for the eight set handlers.

        Wire shape: ``[trackPath:string, value, generation:int]`` per
        [04 §3.3]. ``generation`` is optional for backward-compat with
        the handful of senders that haven't wired it yet — a missing
        generation bypasses the stale check, same rationale as the
        PropertyComponent stance ("surface misconfigured" surfaces the
        wiring gap instead of silently rejecting everything).
        """
        if self._disconnected:
            return
        address = _ADDRESS_FOR_ATTR[attr]
        if len(args) < 2:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="expected [trackPath, value, generation?]",
            )
            return
        try:
            track_path = _coerce_str(args[0])
        except Exception as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path="",
                detail="coerce track_path: %s" % e,
            )
            return

        value = args[1]
        ui_gen: Optional[int] = None
        if len(args) >= 3:
            try:
                ui_gen = int(args[2])
            except (TypeError, ValueError) as e:
                self._emit_error(
                    address, V3_ERROR_WRITE_REJECTED,
                    track_path=track_path,
                    detail="bad generation: %s" % e,
                )
                return

        # Generation gate — same shape as PropertyComponent.handle_set.
        if ui_gen is not None:
            if self._generation is None:
                logger.error(
                    "TrackMetadataComponent: generation component not "
                    "wired; refusing %s on %s", attr, track_path,
                )
                self._emit_error(
                    address, V3_ERROR_WRITE_REJECTED,
                    track_path=track_path,
                    detail="surface misconfigured",
                )
                return
            if self._generation.is_stale(ui_gen):
                self._emit_error(
                    address, V3_ERROR_GENERATION_STALE,
                    track_path=track_path,
                    detail="ui=%d, surf=%d" % (
                        ui_gen, self._generation.current,
                    ),
                )
                return

        # Path support — reject master / returns with path-not-supported.
        if not _is_regular_track_path(track_path):
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED,
                track_path=track_path,
                detail="master and returns not owned by TrackMetadataComponent",
            )
            return

        result = resolve_track(self._song, track_path)
        if result.status is ResolveStatus.MALFORMED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                track_path=track_path,
                detail="malformed: %s" % result.detail,
            )
            return
        if result.status is ResolveStatus.NOT_SUPPORTED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED,
                track_path=track_path,
                detail=result.detail,
            )
            return
        if result.status is ResolveStatus.NOT_FOUND:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                track_path=track_path,
                detail=result.detail,
            )
            return

        track = result.obj

        # Validate + coerce. Validation rejects out-of-range; coerce
        # converts the wire shape to LOM shape (int→bool for
        # arm/mute/solo, all others pass through).
        coerced = self._coerce_from_wire(attr, value)
        if coerced is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path,
                detail="out-of-range: %r" % (value,),
            )
            return

        # Arm suppression before setattr. On a raise we roll back the
        # flag so a later unrelated fire isn't inadvertently swallowed
        # (same contract DevicesComponent upholds).
        self._suppress[(track_path, attr)] = True
        try:
            if attr in _MIXER_ATTRS:
                param = self._resolve_mixer_param(track, attr)
                if param is None:
                    raise RuntimeError("mixer.%s unavailable" % attr)
                param.value = coerced
            else:
                setattr(track, _LOM_ATTR_FOR[attr], coerced)
        except Exception as e:
            self._suppress.pop((track_path, attr), None)
            detail = (
                "invalid-routing"
                if attr in (
                    _ATTR_INPUT_ROUTING_TYPE, _ATTR_INPUT_ROUTING_CHANNEL,
                )
                else "lom rejected: %s" % e
            )
            logger.warning(
                "TrackMetadataComponent: write %s.%s = %r raised: %s",
                track_path, attr, coerced, e,
            )
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                track_path=track_path, detail=detail,
            )

    # --- validation + coercion --------------------------------------------

    def _coerce_from_wire(self, attr: str, value):
        """Validate + coerce wire → LOM. Returns ``None`` to reject.

        Rules per design §2.6:
        - ``color``: int, 0 ≤ v ≤ 0xFFFFFF.
        - ``pan``: float, -1.0 ≤ v ≤ +1.0, NaN rejected.
        - ``arm``/``mute``/``solo``: 0 or 1; other ints coerced to bool;
          strings rejected.
        - ``name``: non-empty string, ≤ 255 chars.
        - ``input_routing_*``: strings; LOM raises on invalid — we
          pass through and let setattr surface the error.
        """
        if attr == _ATTR_COLOR:
            # Reject booleans — ``True``/``False`` are valid Python ints
            # but a wire that delivered a bool clearly targeted a
            # different attr. Catches obvious mis-dispatch.
            if isinstance(value, bool):
                return None
            # The OSC bridge encodes plain JS numbers as float32. Accept
            # whole-number floats and coerce to int so the range check
            # and LOM assignment both see a proper Python int.
            if isinstance(value, float):
                if not value.is_integer():
                    return None
                value = int(value)
            if not isinstance(value, int):
                return None
            if value < 0 or value > 0xFFFFFF:
                return None
            return value
        if attr == _ATTR_PAN:
            # Accept int-typed zeros etc. — float conversion is cheap
            # and the wire codec may collapse 0.0 to 0.
            try:
                fv = float(value)
            except (TypeError, ValueError):
                return None
            if math.isnan(fv) or math.isinf(fv):
                return None
            if fv < -1.0 or fv > 1.0:
                return None
            return fv
        if attr == _ATTR_VOLUME:
            try:
                fv = float(value)
            except (TypeError, ValueError):
                return None
            if math.isnan(fv) or math.isinf(fv):
                return None
            if fv < 0.0 or fv > 1.0:
                return None
            return fv
        if attr in _BOOL_ATTRS:
            if isinstance(value, str):
                return None
            try:
                iv = int(value)
            except (TypeError, ValueError):
                return None
            # Any nonzero int coerces to True; gates UI off-by-one
            # senders (some emit 1 / 0, some True / False-as-int).
            return bool(iv)
        if attr == _ATTR_NAME:
            if not isinstance(value, (str, bytes)):
                return None
            sv = _coerce_str(value)
            if not sv or len(sv) > 255:
                return None
            return sv
        if attr in (_ATTR_INPUT_ROUTING_TYPE, _ATTR_INPUT_ROUTING_CHANNEL):
            if not isinstance(value, (str, bytes)):
                return None
            return _coerce_str(value)
        return None

    def _coerce_to_wire(self, attr: str, value):
        """Coerce LOM → wire. Inverse of _coerce_from_wire.

        ``input_routing_type`` / ``input_routing_channel`` read back as
        Live ``RoutingType`` / ``RoutingChannel`` objects, not strings —
        the LOM accepts either shape on write but always hands objects
        back on read. pyliblo can't encode those, so pull ``display_name``
        (the user-facing label that every Live version exposes) and fall
        back to ``str()`` if absent.
        """
        if attr in _BOOL_ATTRS:
            return 1 if bool(value) else 0
        if attr == _ATTR_COLOR:
            try:
                return int(value)
            except (TypeError, ValueError):
                return 0
        if attr in (_ATTR_PAN, _ATTR_VOLUME):
            try:
                return float(value)
            except (TypeError, ValueError):
                return 0.0
        if attr in (_ATTR_INPUT_ROUTING_TYPE, _ATTR_INPUT_ROUTING_CHANNEL):
            display = getattr(value, "display_name", None)
            if isinstance(display, str):
                return display
            if isinstance(display, bytes):
                return _coerce_str(display)
            return _coerce_str(value) if isinstance(value, bytes) else str(value)
        return _coerce_str(value) if isinstance(value, bytes) else value

    # --- path helpers -----------------------------------------------------

    def _track_path_for(self, track) -> Optional[str]:
        """Return ``"tracks/<N>"`` for a regular track, or ``None``.

        Master / returns return ``None`` — they're not owned by this
        component and we never want to attach listeners to them here.
        """
        tracks = self._safe_tracks_list()
        if tracks is None:
            return None
        for idx, t in enumerate(tracks):
            if t is track:
                return "tracks/%d" % idx
        return None

    def _iter_regular_tracks(self) -> List[object]:
        tracks = self._safe_tracks_list()
        return list(tracks) if tracks is not None else []

    def _safe_tracks_list(self):
        try:
            return list(self._song.tracks)
        except Exception as e:
            logger.warning(
                "TrackMetadataComponent: tracks read failed: %s", e,
            )
            return None

    # --- emit helpers -----------------------------------------------------

    def _safe_emit(self, address: str, payload: tuple) -> None:
        """Emit guarded by ``_disconnected``.

        A late LOM fire can race disconnect; the flag flip in
        :meth:`disconnect` turns those into no-ops before the transport
        closes. Mirrors PropertyComponent._safe_emit.
        """
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning(
                "TrackMetadataComponent: emit %s failed: %s", address, e,
            )

    def _emit_error(
        self,
        address: str,
        code: str,
        track_path: str,
        detail: str,
    ) -> None:
        """Emit ``/looping/v3/error [address, code, trackPath, detail]``.

        Four-arg shape — same as DevicesComponent's shape for the
        per-track error channel; PropertyComponent uses a five-arg
        shape because properties key on ``(path, name)``. Track
        metadata keys on ``path`` alone.
        """
        self._safe_emit(
            V3_ERROR_ADDRESS, (address, code, track_path, detail),
        )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Detach all listeners, drop state. Idempotent.

        Walks the detach-record lists — each record carries the exact
        wrapper we attached on, so we don't need a fresh ``song.tracks``
        read to resolve targets (which would hand back fresh wrappers
        per ADR-350 and miss anyway). Per-record errors swallowed at
        DEBUG: torn-down C++ handles are benign here.
        """
        if self._disconnected:
            return
        self._disconnected = True

        for target, remove_method_name, cb, path in self._listeners:
            self._safe_remove_listener(target, remove_method_name, cb, path)
        self._listeners.clear()

        for track, cb, path in self._arrangement_clips_listeners:
            self._safe_remove_listener(
                track, "remove_arrangement_clips_listener", cb, path,
            )
        self._arrangement_clips_listeners.clear()

        if self._visible_tracks_listener is not None:
            self._safe_remove_listener(
                self._song, "remove_visible_tracks_listener",
                self._visible_tracks_listener, "song",
            )
            self._visible_tracks_listener = None
        self._fold_states.clear()

        self._suppress.clear()
