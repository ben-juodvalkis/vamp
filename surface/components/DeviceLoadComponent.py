"""DeviceLoadComponent — the preset loader.

Owns ``/looping/v3/device/load [trackPath, devicePath, presetPath]``
(Phase 6 design:
[phase-6-pr6-design.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/phase-6-pr6-design.md);
pad targets and insert-by-name: ADR-430).

Stateless, one-shot, structural mutation. No listeners, no generation
injection, no echo-suppression. Success is silent on the wire: the
track's device-structure listener (or, for a pad, the chain's) carries
the news.

The load, in order (``handle_load``):

1. arg count, then an empty ``presetPath`` → ``load-failed`` before
   anything is touched.
2. ``trackPath`` → ``resolve_track`` (``track-not-found``). There is no
   empty-path fallback to the selected track since 2026-04-26.
3. ``devicePath``: a pad path (``…/devices/<N>/pads/<note>``, 3.8.0)
   resolves through ``resolve_pad`` and must sit on ``trackPath``; a
   plain device path is shape- and bounds-checked; empty means the
   track. Errors are ``device-slot-invalid``; a pad's carry
   ``;scope=<padPath>`` so the UI resets the pad's slot, not the track's.
4. A native device (3.12.0: ``source`` is ``native:<class>``, ``rel`` the
   name it takes) is **inserted by name** (``insert_device``, so the
   user's own default for it applies; renamed to ``rel``, one undo step;
   a MIDI effect after the chain's leading MIDI effects) — into the
   pad's chain or onto the track, with no file, no selection change and
   no browser. Live refusing it → ``load-failed insert-refused``.
5. A preset that is not on disk → ``load-failed path-not-found``.
6. Otherwise the browser: for a pad, select the track, the pad and the
   chain's last device, set the track's device insert mode beside the
   selection, ``load_item`` (the preset lands in the pad's chain), put
   the mode back, and look at once where it landed — chain grew: done;
   landed on the track (a Live without the insert mode): ``move_device``
   into the chain; not there yet: look again on every fast tick until
   ``PAD_PLACEMENT_TIMEOUT_S`` (ADR-437). For a track, select it and
   ``load_item`` — with a preset named in ``head_preset_paths`` (the wah,
   ADR-445) landing at the head of the track's audio effects the way
   ``load_into_track(..., at_head=True)`` lands it: the first audio
   effect selected and the insert mode "left of the selection" for the
   call, so the Pedal view's Wah button and the pedal's own engage place
   it identically. LOM raises map to ``load-failed`` with the exception
   class and a truncated message.

Error codes per [04 §7.2]; every pad-load error names its scope.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from .browser_cache import BrowserCache
from .live_library import LiveLibrary, read_live_library
from .drum_vm_functions import (
    DEVICE_TYPE_AUDIO_EFFECT,
    DEVICE_TYPE_MIDI_EFFECT,
    device_type,
)
from .path_resolver import (
    ResolveStatus,
    is_pad_scoped,  # pad-targeted loads, 3.8.0
    lom_id,
    resolve_pad,
    resolve_track,
)

logger = logging.getLogger("looping")


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_DEVICE_LOAD_ADDRESS = "/looping/v3/device/load"
V3_ERROR_ADDRESS = "/looping/v3/error"

# Error codes this component may emit. `track-not-found` and
# `device-slot-invalid` wire up in pr6-3; `load-failed` carries the
# arg-count rejection today and the exception-mapped failure in pr6-4.
V3_ERROR_TRACK_NOT_FOUND = "track-not-found"
V3_ERROR_DEVICE_SLOT_INVALID = "device-slot-invalid"
V3_ERROR_LOAD_FAILED = "load-failed"


# Tuple of exceptions every LOM touch in this module must catch.
# Includes ``TypeError`` to cover ``Boost.Python.ArgumentError`` (a
# ``TypeError`` subclass) that Live raises when a C++ handle is torn
# down — see [CLAUDE.md] merge-gate rule (9). The catch body itself
# lands in pr6-4; the tuple is defined here so pr6-3's path-resolution
# guards can reuse it without a second definition.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# Expected positional args on the wire.
# ``[trackPath, devicePath, presetPath]``, and since 3.11.0 optionally
# ``[…, source, rel]``: the Place the preset is in and its path inside it —
# or, since 3.12.0, ``native:<class>`` and the name the device takes.
_EXPECTED_ARG_COUNTS = (3, 5)

# 3.12.0: the ``source`` of a load that names a native device, not a file.
NATIVE_SOURCE_PREFIX = "native:"

# Live's Core Library, as its browser lists it: one of ``browser.packs``.
CORE_LIBRARY_SOURCE = "pack:Core Library"
# A groove of the user's own — a file in their User Library's ``Grooves``
# folder — is named ``User: <file>`` on the wire and in the pool, so it can
# sit beside a Core Library groove of the same name.
USER_GROOVE_PREFIX = "User: "

# Issue #491 (3.8.0) → ADR-437 (2026-09-14): where a pad-targeted browser
# load landed is checked the moment ``load_item`` returns, and a preset
# Live has not shown yet is looked for again on every fast tick — the
# drain pump's Timer, ~11 ms apart and a legal LOM write context (ADR-429's
# engine writes from it) — until this deadline, when the load reports
# ``landed-nowhere``. The two ``schedule_message`` looks this replaces
# (200 ms, then 800) cost 130–400 ms of pure waiting per pad load
# (measured in Log.txt, 2026-09-14: request → moved 265–821 ms, of which
# Live's own insert was 86–336).
PAD_PLACEMENT_TIMEOUT_S = 1.0

# ADR-437 (2026-09-14): ``Track.View.device_insert_mode`` (Live 12.2+) decides
# where a browser load goes relative to the selected device. Measured on
# 12.4.15b2: the property READS as a bool — ``True`` in Live's default mode,
# where ``load_item`` lands the preset on the track after the top-level
# device holding the selection (the rack), and ``False`` after writing 1 or
# 2 (Push's insert-left / insert-right), where it lands beside the selected
# device INSIDE its chain. So the pad load sets 2 for the duration of
# ``load_item`` and puts 0 back: the preset lands in the pad's chain with no
# move, and Edit → Undo is Live's own "Insert Device" (measured clean),
# where undoing a ``move_device``d Max device aborted Live.
TRACK_INSERT_MODE_DEFAULT = 0
TRACK_INSERT_MODE_LEFT_OF_SELECTION = 1
TRACK_INSERT_MODE_BESIDE_SELECTION = 2

# Issue #491 follow-up (2026-09-10): a native device is INSERTED by name.
#
# ``Track.insert_device`` / ``Chain.insert_device`` (Live 12.3+) create a
# stock device by its display name, in one call, in place, and Live books
# the insert as one undo step — where ``browser.load_item`` lands a preset
# on the track and the pad path had to move it into the chain on a later
# tick (two structural republishes, two undo steps, and the track has to be
# selected first). An insert cannot load a preset file: it gives the device
# the user's own default for it (``Defaults/Audio Effects`` /
# ``Defaults/MIDI Effects`` in their User Library, else Live's factory
# settings). Since 3.12.0 that is the point: a tile that names a native
# device (``native:<class>``) is always inserted, and every user gets the
# device as they have set it up in Live. Until then the insert was taken
# only when an installed default was byte-identical to the owner's preset
# file, which no other Mac had. Racks, plug-in presets and Max devices are
# files, and load through the browser.
#
# Class → display name, measured on 12.4.15b2 by inserting each name and
# reading ``class_name`` / ``class_display_name``. Keep in step with the
# tiles' ``expectedClassName`` in ``devicePresets.ts``.
#
# This map has NO fallback and cannot have one: an unknown class is refused
# as ``unknown-device``. 13 of its 22 rows are not recoverable from the
# class string by any rule (StereoGain -> Utility, Hybrid -> Hybrid Reverb,
# Chorus2 -> Chorus-Ensemble, PhaserNew -> Phaser-Flanger), and a guessed
# name is one Live refuses.
#
# Not to be confused with ``DEVICE_CLASS_NAMES`` in ``scripts/shot/scene.mjs``,
# which points the other way (display name -> class, for the screenshot mock)
# and DOES fall back to the name with non-letters stripped — so most of its
# rows are optional. Every row here is load-bearing.
NATIVE_DEVICE_NAMES: Dict[str, str] = {
    "Delay": "Delay",
    "Echo": "Echo",
    "AutoFilter2": "Auto Filter",
    "Compressor2": "Compressor",
    "Gate": "Gate",
    "GlueCompressor": "Glue Compressor",
    "MultibandDynamics": "Multiband Dynamics",
    "Saturator": "Saturator",
    "BeatRepeat": "Beat Repeat",
    "ChannelEq": "Channel EQ",
    "DrumBuss": "Drum Buss",
    "Pedal": "Pedal",
    "StereoGain": "Utility",
    "AutoPan": "Auto Pan Legacy",  # inserts as "Tremolo (Legacy)" (2026-10-01); renamed to the tile's name
    "Redux2": "Redux",
    "Shifter": "Shifter",
    "Hybrid": "Hybrid Reverb",
    "PhaserNew": "Phaser-Flanger",
    "Chorus2": "Chorus-Ensemble",
    "MidiArpeggiator": "Arpeggiator",
    "MidiRandom": "Random",
    "MidiVelocity": "Velocity",
    "MidiChord": "Chord",
}

def _is_midi_effect_class(device_class: str) -> bool:
    """Whether a native device class names a MIDI effect. Live's
    class names for every MIDI effect start with ``Midi`` (``MidiRandom``,
    ``MidiArpeggiator``, ``MidiChord``…). This asks about a CLASS a tile
    names before any device exists; :func:`device_type` asks a live
    device — the two halves of the one placement rule."""
    return device_class.startswith("Midi")


def _leading_midi_effects(container) -> int:
    """How many MIDI effects open ``container``'s chain — the index a new
    MIDI effect goes at (Live refuses one behind an instrument or an
    audio effect)."""
    count = 0
    for d in _devices_of(container):
        if device_type(d) == DEVICE_TYPE_MIDI_EFFECT:
            count += 1
        else:
            break
    return count


def _first_audio_effect(container):
    """The first audio effect on ``container``, or ``None`` — where a device
    that wants the head of the effects (the wah) goes in front of."""
    for d in _devices_of(container):
        if device_type(d) == DEVICE_TYPE_AUDIO_EFFECT:
            return d
    return None


def _insert_index(container, device) -> int:
    """Where ``device`` belongs in ``container``: a MIDI effect at the
    chain's head after the MIDI effects already there, anything else at
    the end."""
    if device_type(device) == DEVICE_TYPE_MIDI_EFFECT:
        return _leading_midi_effects(container)
    return len(_devices_of(container))


def _track_ptr_set(song):
    """Return a set of stable LOM ids for every track in ``song``."""
    out = set()
    for t in song.tracks:
        ptr = getattr(t, "_live_ptr", None)
        out.add(int(ptr) if ptr is not None else id(t))
    return out


def _find_new_track(song, before_ptrs):
    """Return the first track whose LOM id is not in ``before_ptrs``, or
    ``None``. Used to find the track Live created during a clip load."""
    for t in song.tracks:
        ptr = getattr(t, "_live_ptr", None)
        key = int(ptr) if ptr is not None else id(t)
        if key not in before_ptrs:
            return t
    return None


def _walk_for_clip_leaf(node, leaf, stem, depth=0, max_depth=32):
    """DFS a browser subtree for a loadable item named ``leaf`` or ``stem``.

    Returns the first matching loadable ``BrowserItem`` or ``None``. Used to
    resolve pack ``.alc`` clips that miss the User-Library cache. Bounded
    depth guards against pathological/cyclic trees.
    """
    if depth > max_depth:
        return None
    try:
        name = node.name
    except _LOM_ERRORS:
        name = None
    if name is not None and (name == leaf or name == stem):
        try:
            if bool(node.is_loadable):
                return node
        except _LOM_ERRORS:
            pass
    try:
        children = list(node.children or ())
    except _LOM_ERRORS:
        return None
    for child in children:
        found = _walk_for_clip_leaf(child, leaf, stem, depth + 1, max_depth)
        if found is not None:
            return found
    return None


def _devices_of(container) -> list:
    try:
        return list(container.devices or ())
    except _LOM_ERRORS:
        return []


def _device_ids(container) -> set:
    """The LOM identities of ``container``'s devices (``path_resolver.lom_id``),
    for the before/after snapshots that tell a newcomer apart."""
    return {i for i in (lom_id(d) for d in _devices_of(container)) if i is not None}


def _coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``. Bytes → utf-8; ``None`` → ``""``.

    Mirrors ``PropertyComponent._coerce_str`` / ``TrackMetadataComponent._coerce_str``.
    ``None`` shows up when the OSC encoder collapses an empty string
    (pyliblo quirk); treating it as ``""`` keeps the §3.2.1 empty-path
    compat shim reachable from every UI sender.
    """
    if x is None:
        return ""
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


class _Placement:
    """One pad-targeted browser load waiting to be placed (ADR-437): the
    snapshots that tell the newcomer apart, whether an undo step was
    opened for it (never, today — see ``_load_into_pad``), and the
    deadline past which the load is reported as ``landed-nowhere``."""

    __slots__ = (
        "before_chain", "before_track", "began", "chain", "deadline", "looks",
        "pad_path", "preset_path", "started", "track",
    )

    def __init__(
        self, track, chain, pad_path: str, preset_path: str,
        before_chain: set, before_track: set, began: bool,
        started: float, deadline: float,
    ) -> None:
        self.track = track
        self.chain = chain
        self.pad_path = pad_path
        self.preset_path = preset_path
        self.before_chain = before_chain
        self.before_track = before_track
        self.began = began
        self.started = started
        self.deadline = deadline
        self.looks = 0


def _parse_nonneg_index(token: str) -> Optional[int]:
    """Parse a non-negative decimal index. ``None`` on malformed.

    Mirrors ``path_resolver._parse_index``'s rules: digits only, no
    leading zero except for the literal ``"0"``. Kept local so the
    resolver stays the only module that imports these two helpers
    from each other (avoids a circular).
    """
    if not token or not token.isdigit():
        return None
    if len(token) > 1 and token[0] == "0":
        return None
    try:
        return int(token)
    except ValueError:
        return None


class DeviceLoadComponent:
    """Owns ``/looping/v3/device/load``.

    Args:
        song: The Live ``Song``.
        browser: The Live ``Application.Browser`` object. Must expose
            ``load_item_at_path`` (Live 12.3.7+); ``__init__`` raises
            ``RuntimeError`` otherwise — see design §3.6.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
    """

    def __init__(
        self,
        song,
        browser,
        emit: Callable[[str, tuple], None],
        user_library_base: str,
        places_roots: Optional[Dict[str, str]] = None,
        schedule_tick: Optional[Callable[[Callable[[], None]], None]] = None,
        clock: Callable[[], float] = time.monotonic,
        head_preset_paths: Optional[Iterable[str]] = None,
        library: Optional[LiveLibrary] = None,
    ) -> None:
        # PR-6Pre's verdict that Live 12.3.7 exposes
        # ``browser.load_item_at_path(fullPath)`` was wrong. Diagnostic
        # probing (2026-04-19) showed the attribute is absent from the
        # Boost.Python ``Browser`` proxy on this build — the only
        # loader is ``browser.load_item(BrowserItem)``. The probe's
        # "successful arbitrary-path loads" were name-collision matches
        # via a tree-walker fallback, not a path-aware API.
        #
        # DeviceLoadComponent resolves ``preset_path`` by descending
        # ``browser.user_library`` one filesystem segment at a time,
        # matching each against child ``name``. Collision-proof because
        # the full ancestry must match, not just the basename. The tree
        # structure mirrors the User Library filesystem layout exactly.
        #
        # ROW 4 (2026-04-20): Places support. ``places_roots`` maps
        # sidebar display name → filesystem root for every Place the
        # user wants reachable. Resolution tries User Library first,
        # then iterates ``places_roots`` and descends
        # ``browser.user_folders[display_name]`` the same way. Same
        # segment-by-segment walk, same ``_LOM_ERRORS`` shield, no
        # tree-wide recursion — so it can't wedge the transport the
        # way the earlier BrowserProbe traversal did.
        self._song = song
        self._browser = browser
        self._emit = emit
        # ``schedule_tick(fn)`` runs ``fn`` on the next fast tick — the
        # surface's drain pump (~11 ms), or its ~100 ms scheduler when the
        # pump is down. It carries a pad placement Live had not shown when
        # ``load_item`` returned (ADR-437); ``None`` (tests) reports such a
        # load at once. ``clock`` is the deadline's clock, injectable.
        self._schedule_tick = schedule_tick
        self._clock = clock
        # Pad loads still waiting for Live, each holding an open undo step.
        self._pending: List[_Placement] = []
        # ADR-445: presets a wire-level track load lands at the head of the
        # track's audio effects (the wah — ``constants.devices.wah.presetPath``),
        # the same placement the pedal's own load uses, so the Pedal view's
        # Wah button and the toe switch put the rack in one place. Compared
        # by normalized path; anything else takes Live's own placement.
        self._head_presets = {
            os.path.normpath(p) for p in (head_preset_paths or ())
            if isinstance(p, str) and p
        }
        # Live's own library (2026-09-26): every sidebar Place, the User
        # Library and the Packs from ``Library.cfg``, so a path in any of
        # them resolves with nothing typed into the config. ``None`` (tests)
        # reads the file; an empty ``LiveLibrary()`` keeps the config alone.
        self._library = library if library is not None else read_live_library()
        # ``paths.userLibraryBase`` is a Mac's own setting (constants.local.json,
        # general-release plan.md §3); without it, the User Library Live's
        # ``Library.cfg`` names. ``os.path.normpath("")`` is ".", which is
        # nobody's library.
        configured_base = user_library_base or self._library.user_library or ""
        self._user_library_base = (
            os.path.normpath(configured_base).rstrip(os.sep) if configured_base else ""
        )
        self._places_roots: Dict[str, str] = {
            display_name: os.path.normpath(fs_root).rstrip(os.sep)
            for display_name, fs_root in (places_roots or {}).items()
            if fs_root  # skip empty strings so a misconfigured entry
                        # can't silently match every path
        }
        # Per-root path → BrowserItem cache. Built lazily on first
        # ``handle_load`` to a given root, then O(1) for every
        # subsequent load. This is what eliminates the multi-second UI
        # freeze on heavy User Libraries — see ``browser_cache.py``.
        self._browser_cache = BrowserCache(
            browser=browser,
            user_library_base=self._user_library_base,
            places_roots=self._places_roots,
            library=self._library,
            clock=clock,
        )
        self._disconnected = False
        logger.info(
            "DeviceLoadComponent: ready (user_library_base=%r, "
            "places_roots=%r)",
            self._user_library_base,
            sorted(self._places_roots.keys()),
        )

    # --- wire handler -----------------------------------------------------

    def handle_load(self, args, source_addr) -> None:
        """Parse and dispatch a ``/looping/v3/device/load`` message.

        Wire shape: ``[trackPath, devicePath, presetPath]``, plus
        ``[source, rel]``. The order of operations is the module
        docstring's list: arg count and the empty preset; the track; the
        pad (``resolve_pad``, and it must be on ``trackPath``) or the plain
        device slot; a native device (``native:<class>``) inserted by name;
        the file on disk; the browser — ``_load_into_pad`` with its
        deferred placement check for a pad, select-then-``load_item`` for
        a track.

        Success is silent on the wire for this component — the track's
        or the chain's device-structure listener carries the news once
        Live finishes the load (per §3.10).
        """
        if self._disconnected:
            return
        logger.info(
            "DeviceLoadComponent: handle_load args=%r from=%r",
            args, source_addr,
        )
        if len(args) not in _EXPECTED_ARG_COUNTS:
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path="",
                detail="arg-count: expected %s, got %d" % (
                    " or ".join(str(n) for n in _EXPECTED_ARG_COUNTS), len(args),
                ),
            )
            return

        track_path = _coerce_str(args[0])
        device_path = _coerce_str(args[1])
        preset_path = _coerce_str(args[2])
        # 3.11.0: the Place the preset is in and its path inside it. With
        # them an empty presetPath is filled in from the Place's folder.
        source = _coerce_str(args[3]) if len(args) > 3 else ""
        rel = _coerce_str(args[4]) if len(args) > 4 else ""
        # 3.12.0: a native device names its class, not a file. The source
        # stands in for the preset path from here on: it is what the error
        # wire carries back, and what the UI's slot reset matches on.
        native_class = (
            source[len(NATIVE_SOURCE_PREFIX):]
            if source.startswith(NATIVE_SOURCE_PREFIX) else ""
        )
        preset_path = source if native_class else self.absolute_path(preset_path, source, rel)
        logger.info(
            "DeviceLoadComponent: coerced trackPath=%r devicePath=%r "
            "presetPath=%r (len=%d) source=%r rel=%r",
            track_path, device_path, preset_path, len(preset_path), source, rel,
        )

        if not preset_path:
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path="",
                detail="empty-preset-path",
            )
            return

        track = self._resolve_target_track(track_path)
        if track is None:
            return  # error already emitted
        logger.info(
            "DeviceLoadComponent: resolved track=%r name=%r",
            track, getattr(track, "name", "?"),
        )

        pad_ref = None
        if device_path and is_pad_scoped(device_path):
            # Issue #491 (3.8.0): the preset goes INTO a drum pad's chain.
            # The pad must sit on the track named beside it: the fallback
            # below snapshots THAT track's devices to spot a preset that
            # landed there, and two arguments that disagree would have it
            # watching the wrong track (code review, 2026-09-12).
            if not device_path.startswith(track_path.rstrip("/") + "/devices/"):
                self._emit_error(
                    V3_ERROR_DEVICE_SLOT_INVALID,
                    path=preset_path,
                    detail="pad-not-on-track: %r is not on %r;scope=%s" % (
                        device_path, track_path, device_path,
                    ),
                )
                return
            pad_ref = self._resolve_pad_target(device_path, preset_path)
            if pad_ref is None:
                return  # error already emitted
        elif device_path and not self._validate_device_path(
            device_path, track,
        ):
            return  # error already emitted
        # Every pad-load error names its scope: the UI's slot reset matches
        # on the preset path and cannot otherwise tell a pad's slot from
        # the track's (a stale catalog entry under a held pad while the
        # track's same tile loads would reset the wrong one).
        scope_suffix = f";scope={device_path}" if pad_ref is not None else ""

        if native_class:
            container = pad_ref.chain if pad_ref is not None else track
            self._load_native(
                container, native_class, rel, device_path or track_path,
                preset_path, scope_suffix,
            )
            return

        # Cheap filesystem pre-check — stale UI catalog entries should
        # fail in microseconds, not after an exhaustive browser walk.
        # Non-existent paths short-circuit to ``path-not-found``.
        if not os.path.isfile(preset_path):
            logger.warning(
                "DeviceLoadComponent: preset path not found on disk: %r",
                preset_path,
            )
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path=preset_path,
                detail="path-not-found" + scope_suffix,
            )
            return

        item = self._resolve_browser_item(preset_path, source, rel)
        if item is None:
            # ``_resolve_browser_item`` already logged the reason.
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path=preset_path,
                detail="not-in-browser" + scope_suffix,
            )
            return

        if pad_ref is not None:
            self._load_into_pad(track, pad_ref, device_path, preset_path, item)
            return

        # ``browser.load_item`` loads onto ``song.view.selected_track``.
        # Set selection before the load. Per design §3.4 we do NOT save
        # and restore the prior selection — the selection shift is
        # documented as expected and mirrors a user's tap-to-select
        # gesture. Selection assignment can itself raise (torn-down
        # ``view`` wrapper, hostile track handle); it's guarded by the
        # same ``_LOM_ERRORS`` shield as the load call.
        #
        # ADR-445: a head preset (the wah) lands ahead of the track's first
        # audio effect — that device selected and the insert mode "left of
        # the selection" for the call, put back after — exactly as
        # ``load_into_track(..., at_head=True)`` does for the pedal. Never
        # a move afterwards (ADR-437). A track with no audio effect yet
        # takes the plain load, which is the head of the effects anyway.
        head = _first_audio_effect(track) if self.loads_at_head(preset_path) else None
        restore_mode = False
        try:
            self._song.view.selected_track = track
            if head is not None:
                self._song.view.select_device(head)
                restore_mode = self._set_insert_mode(
                    track, TRACK_INSERT_MODE_LEFT_OF_SELECTION,
                    "the head of %r" % getattr(track, "name", "?"), force=True,
                )
            logger.info(
                "DeviceLoadComponent: calling load_item(%r) for %r%s",
                getattr(item, "name", "?"), preset_path,
                " ahead of %r" % getattr(head, "name", "?") if head is not None else "",
            )
            try:
                self._browser.load_item(item)
            finally:
                self._restore_insert_mode(track, restore_mode)
            logger.info(
                "DeviceLoadComponent: load_item returned OK for %r",
                preset_path,
            )
        except _LOM_ERRORS as e:
            logger.error(
                "DeviceLoadComponent: load_item(%r) raised %s: %s",
                preset_path, type(e).__name__, e,
            )
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path=preset_path,
                detail="%s: %s" % (type(e).__name__, str(e)[:120]),
            )

    def loads_at_head(self, preset_path: str) -> bool:
        """Whether a wire-level track load of ``preset_path`` lands at the
        head of the track's audio effects (ADR-445: the wah)."""
        if not preset_path or not self._head_presets:
            return False
        return os.path.normpath(preset_path) in self._head_presets

    # --- pad-targeted load (issue #491, protocol 3.8.0) -------------------

    # --- insert by name (issue #491 follow-up) ---------------------------

    def _load_native(
        self, container, device_class: str, device_name: str,
        scope_label: str, key: str, scope_suffix: str,
    ) -> None:
        """Insert the native device ``device_class`` into ``container`` (a
        track or a pad's chain) by Live's display name, so the user's own
        default for it applies, named ``device_name`` (the tile's name;
        Live's display name when empty). ``key`` is what the error wire
        names: the load's ``native:<class>`` source."""
        display = NATIVE_DEVICE_NAMES.get(device_class)
        if not display:
            logger.warning(
                "DeviceLoadComponent: no display name for native class %r", device_class,
            )
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path=key,
                detail="unknown-device: %s%s" % (device_class, scope_suffix),
            )
            return
        plan = (display, device_name or display, _is_midi_effect_class(device_class))
        if not self._insert_native(container, plan, scope_label):
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path=key,
                detail="insert-refused" + scope_suffix,
            )

    def _insert_native(self, container, plan: Tuple[str, str, bool], scope_label: str) -> bool:
        """``container.insert_device(display_name)`` — a track or a drum
        chain — renamed to the tile's name, inside one undo step. A MIDI
        effect goes after the chain's leading MIDI effects (Live refuses one
        behind an instrument or an audio effect); an audio effect goes at
        the end. Returns ``False`` when Live refuses the insert; the undo
        step is closed either way."""
        display, device_name, is_midi = plan
        index: Optional[int] = _leading_midi_effects(container) if is_midi else None
        began = self._begin_undo_step()
        # The step closes whatever happens inside — a raise of a kind the
        # LOM tuple does not name must not leave it open for the rest of
        # the session (code review of ADR-430).
        try:
            try:
                device = (
                    container.insert_device(display)
                    if index is None
                    else container.insert_device(display, index)
                )
            except _LOM_ERRORS as e:
                logger.warning(
                    "DeviceLoadComponent: insert_device(%r) into %s raised %s: %s",
                    display, scope_label, type(e).__name__, e,
                )
                return False
            if device is None:
                # Live returns the device it inserted; nothing back means
                # nothing went in, and there is nothing to rename.
                logger.warning(
                    "DeviceLoadComponent: insert_device(%r) into %s returned nothing",
                    display, scope_label,
                )
                return False
            try:
                if getattr(device, "name", None) != device_name:
                    device.name = device_name
            except _LOM_ERRORS as e:
                # A device left under Live's display name matches no tile:
                # the slot would time out and the next drag insert a second
                # copy. Take it out again, still inside this undo step.
                logger.warning(
                    "DeviceLoadComponent: renaming the inserted %r to %r raised %s: %s; "
                    "removing it",
                    display, device_name, type(e).__name__, e,
                )
                self._remove_inserted(container, device)
                return False
        finally:
            self._end_undo_step(began)
        logger.info(
            "DeviceLoadComponent: inserted %r by name as %r into %s%s",
            display, device_name, scope_label, "" if index is None else " at %d" % index,
        )
        return True

    def _remove_inserted(self, container, device) -> None:
        """Delete ``device`` from ``container`` by identity — the undo of an
        insert whose rename Live refused."""
        wanted = lom_id(device)
        for index, d in enumerate(_devices_of(container)):
            # By LOM id; by object identity only for a device that has none
            # (every device on the rig has one — this keeps a fake honest).
            if (lom_id(d) == wanted) if wanted is not None else (d is device):
                try:
                    container.delete_device(index)
                except _LOM_ERRORS as e:
                    logger.warning(
                        "DeviceLoadComponent: removing the un-renamed insert raised %s: %s",
                        type(e).__name__, e,
                    )
                return
        logger.warning("DeviceLoadComponent: the un-renamed insert was not found in its container")

    def _begin_undo_step(self) -> bool:
        """Open an undo step; ``False`` when Live refused, so the caller
        does not close a step that never opened."""
        try:
            self._song.begin_undo_step()
        except _LOM_ERRORS as e:
            logger.warning("DeviceLoadComponent: begin_undo_step raised %s: %s", type(e).__name__, e)
            return False
        return True

    def _end_undo_step(self, began: bool) -> None:
        if not began:
            return
        try:
            self._song.end_undo_step()
        except _LOM_ERRORS as e:
            logger.warning("DeviceLoadComponent: end_undo_step raised %s: %s", type(e).__name__, e)

    def _resolve_pad_target(self, device_path: str, preset_path: str):
        """``…/devices/<N>/pads/<note>`` → :class:`PadRef`, or ``None`` after
        emitting ``device-slot-invalid`` with the resolver's reason. The
        error's ``path`` is the preset, as every load error's is (the UI's
        slot reset matches on it), and the pad path rides ``;scope=``."""
        r = resolve_pad(self._song, device_path)
        if r.status is ResolveStatus.OK:
            return r.obj
        self._emit_error(
            V3_ERROR_DEVICE_SLOT_INVALID,
            path=preset_path,
            detail=f"{r.status.value}: {r.detail or ''};scope={device_path}",
        )
        return None

    def _load_into_pad(self, track, pad_ref, pad_path: str, preset_path: str, item) -> None:
        """Load ``item`` into a pad's chain, Live's own way (issue #491),
        and place it as soon as Live has inserted it (ADR-437).

        Live inserts a browser load beside the selected device — the rule
        Push and Live's own browser use — so the sequence is: select the
        track, select the pad on the rack (the press already did through
        ``vm.selectedPad``; this makes a Mac-side load stand alone), select
        the chain's last device, set the track's device insert mode beside
        the selection (``TRACK_INSERT_MODE_BESIDE_SELECTION``; in Live's
        default mode the load goes to the track after the rack instead),
        load, put the mode back. Snapshots of the chain's and the track's
        device ids are taken before the load and compared the moment
        ``load_item`` returns: if the chain grew, Live put it where we
        asked (what it does with the insert mode set, measured on
        12.4.15b2); if the track grew instead (a Live without the insert
        mode), ``song.move_device`` moves the newcomer into the chain — an
        audio effect at the end, a MIDI effect after the MIDI effects
        already at the chain's head; if neither has grown yet, the same
        look is repeated on every fast tick until
        ``PAD_PLACEMENT_TIMEOUT_S``, when the load reports ``load-failed``.
        Success is otherwise silent on the wire — the chain's own
        ``devices`` listener carries the news.

        Undo (measured 2026-09-14): a preset that landed in the chain undoes
        as Live's own "Insert Device", cleanly. A preset that was
        ``move_device``d in did NOT: the first undo after it — grouped with
        the load in one undo step or not, from a probe or from Live's Edit
        menu — aborted Live with ``Fatal Error: ADeleteAction::Do``. That
        is why the insert mode is set rather than the move relied on, and
        why the pair is never grouped.

        Every error carries the pad path in ``detail`` (``;scope=…``): the
        UI's slot reset matches on the preset path and cannot otherwise
        tell a pad-scoped load from a track-level one.
        """
        chain = pad_ref.chain
        before_chain = _device_ids(chain)
        before_track = _device_ids(track)
        began = False  # no undo group here — see the docstring
        started = self._clock()
        restore_mode = False
        try:
            self._song.view.selected_track = track
            try:
                pad_ref.rack.view.selected_drum_pad = pad_ref.pad
            except _LOM_ERRORS as e:
                logger.warning(
                    "DeviceLoadComponent: selected_drum_pad write raised for %s: %s",
                    pad_path, e,
                )
            chain_devices = _devices_of(chain)
            if chain_devices:
                self._song.view.select_device(chain_devices[-1])
            restore_mode = self._set_insert_mode(
                track, TRACK_INSERT_MODE_BESIDE_SELECTION, "pad %s" % pad_path,
            )
            logger.info(
                "DeviceLoadComponent: calling load_item(%r) into pad %s (chain has %d devices, insert mode %s)",
                getattr(item, "name", "?"), pad_path, len(chain_devices),
                "beside the selection" if restore_mode else "as found",
            )
            try:
                self._browser.load_item(item)
            finally:
                self._restore_insert_mode(track, restore_mode)
        except _LOM_ERRORS as e:
            self._end_undo_step(began)
            logger.error(
                "DeviceLoadComponent: pad load of %r raised %s: %s",
                preset_path, type(e).__name__, e,
            )
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path=preset_path,
                detail="%s: %s;scope=%s" % (type(e).__name__, str(e)[:100], pad_path),
            )
            return

        placement = _Placement(
            track, chain, pad_path, preset_path, before_chain, before_track,
            began, started, started + PAD_PLACEMENT_TIMEOUT_S,
        )
        self._pending.append(placement)
        if self._settle_placement(placement):
            return
        self._defer_placement(placement)

    # --- placement after a browser load (ADR-437) ------------------------

    def _set_insert_mode(self, track, mode: int, scope_label: str, force: bool = False) -> bool:
        """Write ``mode`` to the track's device insert mode for the coming
        ``load_item``. Returns ``True`` when the mode read as Live's default
        and must be put back afterwards. A mode that already sits beside the
        selection (a Push left / right mode) is left alone unless ``force``
        — a pad load lands in the chain with either, a head load needs
        "left" — and then stays as written, since which of the two it was
        cannot be read back. ``False`` too when this Live has no such
        property: the preset then lands where Live puts it."""
        try:
            view = track.view
            was_default = bool(view.device_insert_mode)
            if not was_default and not force:
                return False
            view.device_insert_mode = mode
        except _LOM_ERRORS as e:
            logger.info(
                "DeviceLoadComponent: no device insert mode for %s (%s: %s); "
                "the preset lands where Live puts it",
                scope_label, type(e).__name__, e,
            )
            return False
        return was_default

    def _restore_insert_mode(self, track, restore: bool) -> None:
        if not restore:
            return
        try:
            track.view.device_insert_mode = TRACK_INSERT_MODE_DEFAULT
        except _LOM_ERRORS as e:
            logger.warning(
                "DeviceLoadComponent: putting the device insert mode back raised %s: %s",
                type(e).__name__, e,
            )

    def _settle_placement(self, p: _Placement) -> bool:
        """One look at where ``p``'s preset is. ``True`` when the load is
        over — placed, or failed for good — and its undo step closed;
        ``False`` when Live has not shown the newcomer yet."""
        p.looks += 1
        after_chain = _device_ids(p.chain)
        if len(after_chain) > len(p.before_chain):
            self._close_placement(p)
            logger.info(
                "DeviceLoadComponent: %r landed on pad %s (chain %d -> %d) after %d look(s), %.0f ms",
                p.preset_path, p.pad_path, len(p.before_chain), len(after_chain),
                p.looks, self._elapsed_ms(p),
            )
            return True
        newcomers = [
            d for d in _devices_of(p.track)
            if lom_id(d) is not None and lom_id(d) not in p.before_track
        ]
        if not newcomers:
            return False
        # Live put it on the track: move it into the chain — an audio
        # effect at the end, a MIDI effect at the chain's head after any
        # MIDI effects already there (Live refuses one behind the
        # instrument). ``move_device`` takes the target index before the
        # source is removed, so ``count`` appends.
        try:
            self._song.move_device(
                newcomers[0], p.chain, _insert_index(p.chain, newcomers[0]),
            )
        except _LOM_ERRORS as e:
            self._close_placement(p)
            logger.error(
                "DeviceLoadComponent: move_device into pad %s raised %s: %s",
                p.pad_path, type(e).__name__, e,
            )
            self._emit_error(
                V3_ERROR_LOAD_FAILED,
                path=p.preset_path,
                detail="move_device raised: %s: %s;scope=%s" % (
                    type(e).__name__, str(e)[:80], p.pad_path,
                ),
            )
            return True
        self._close_placement(p)
        logger.info(
            "DeviceLoadComponent: %r landed on the track; moved into pad %s after %d look(s), %.0f ms",
            p.preset_path, p.pad_path, p.looks, self._elapsed_ms(p),
        )
        return True

    def _defer_placement(self, p: _Placement) -> None:
        """Look again on the next fast tick; with no tick to wait on
        (tests), report the load now."""
        if self._schedule_tick is None:
            self._give_up(p)
            return
        try:
            self._schedule_tick(lambda: self._resume_placement(p))
        except Exception as e:
            logger.warning(
                "DeviceLoadComponent: schedule_tick raised %s: %s; reporting the pad load now",
                type(e).__name__, e,
            )
            self._give_up(p)

    def _resume_placement(self, p: _Placement) -> None:
        if self._disconnected or p not in self._pending:
            return
        if self._settle_placement(p):
            return
        if self._clock() >= p.deadline:
            self._give_up(p)
            return
        self._defer_placement(p)

    def _give_up(self, p: _Placement) -> None:
        self._close_placement(p)
        logger.warning(
            "DeviceLoadComponent: %r landed nowhere visible for pad %s after %d look(s), %.0f ms",
            p.preset_path, p.pad_path, p.looks, self._elapsed_ms(p),
        )
        self._emit_error(
            V3_ERROR_LOAD_FAILED,
            path=p.preset_path,
            detail="landed-nowhere;scope=%s" % p.pad_path,
        )

    def _close_placement(self, p: _Placement) -> None:
        """Forget ``p`` and close its undo step — once, whichever way the
        load ended."""
        if p in self._pending:
            self._pending.remove(p)
        began, p.began = p.began, False
        self._end_undo_step(began)

    def _elapsed_ms(self, p: _Placement) -> float:
        try:
            return (self._clock() - p.started) * 1000.0
        except Exception:
            return -1.0

    # --- public load helper (callable from other components) -------------

    def load_groove(self, path: str, source: str = "", rel: str = "") -> Optional[str]:
        """Load a groove file (``.agr``) into the set's Groove Pool.
        Returns ``None`` when the load ran, or a short detail string.

        ``GroovePoolComponent``'s minter. ``browser.load_item`` on a
        groove appends a new pool entry and applies it to no clip, so
        nothing is selected first.
        """
        if not path or not os.path.isfile(path):
            return "path-not-found: %r" % (path,)
        item = self._resolve_browser_item(path, source, rel)
        if item is None:
            return "not-in-browser: %r" % (path,)
        return self._load_groove_item(item)

    def load_groove_by_name(self, name: str) -> Optional[str]:
        """Load the groove file called ``name`` (``Swing 16ths 57``, no
        extension) into the Groove Pool: from the Core Library, or from the
        User Library's ``Grooves`` folder for ``User: <file>``. ``None``
        when the load ran, else a short detail string.

        Live's browser lists the Core Library as a Pack
        (``browser.packs`` → ``Core Library`` → ``Grooves`` → ``Swing`` /
        ``Style`` / ``Percussion`` / ``Utility``), though ``Library.cfg``
        does not; the file is found there by name, so no path to the Live
        app is needed (measured 2026-09-29 on 12.4.15b4: all 219 loadable,
        and a load appends a pool entry named after the file).
        """
        if not name or "/" in name:
            return "bad-groove-name: %r" % (name,)
        source = CORE_LIBRARY_SOURCE
        if name.startswith(USER_GROOVE_PREFIX):
            source, name = "library", name[len(USER_GROOVE_PREFIX):]
        item = self._browser_cache.find_leaf(source, "Grooves", name + ".agr")
        if item is None:
            return "not-in-browser: %r" % (name,)
        return self._load_groove_item(item)

    def _load_groove_item(self, item) -> Optional[str]:
        try:
            self._browser.load_item(item)
        except _LOM_ERRORS as e:
            return "%s: %s" % (type(e).__name__, str(e)[:120])
        return None

    def load_into_track(
        self, track, preset_path: str, at_head: bool = False,
        source: str = "", rel: str = "",
    ) -> Optional[str]:
        """Load ``preset_path`` onto ``track``. Returns ``None`` on
        success, or a short detail string on failure.

        Used by :class:`TrackPrepareComponent` for the load step of an
        atomic track-prepare, by :class:`SimplerLoadComponent` for the
        Random Start prepend and by :class:`WahPedalComponent` for the wah,
        without going through the wire-level ``handle_load`` error emit.
        Same browser cache, same selection-before-load semantics, same
        ``_LOM_ERRORS`` shield.

        ``at_head`` (ADR-437): land the preset ahead of the track's audio
        effects — where the wah wants to be — without a move: the track's
        first audio effect is selected and the device insert mode set to
        "left of the selection" for the call (``Track.View.device_insert_mode``,
        put back after). A track with no audio effect yet gets the plain
        load, which appends — the head of the effects either way. Never
        ``move_device`` a device Live has just loaded through the browser:
        undoing that move aborts Live (measured 2026-09-14, a native rack
        and a Max device alike).
        """
        preset_path = self.absolute_path(preset_path, source, rel)
        if not preset_path:
            return "empty-preset-path"

        if not os.path.isfile(preset_path):
            logger.warning(
                "DeviceLoadComponent: preset path not found on disk: %r",
                preset_path,
            )
            return "path-not-found"

        item = self._resolve_browser_item(preset_path, source, rel)
        if item is None:
            return "not-in-browser"

        target = _first_audio_effect(track) if at_head else None
        restore_mode = False
        try:
            self._song.view.selected_track = track
            if target is not None:
                self._song.view.select_device(target)
                restore_mode = self._set_insert_mode(
                    track, TRACK_INSERT_MODE_LEFT_OF_SELECTION,
                    "the head of %r" % getattr(track, "name", "?"), force=True,
                )
            try:
                self._browser.load_item(item)
            finally:
                self._restore_insert_mode(track, restore_mode)
        except _LOM_ERRORS as e:
            logger.error(
                "DeviceLoadComponent: load_item(%r) raised %s: %s",
                preset_path, type(e).__name__, e,
            )
            return "%s: %s" % (type(e).__name__, str(e)[:120])
        if target is not None:
            logger.info(
                "DeviceLoadComponent: loaded %r ahead of %r on %r (insert mode left of the selection)",
                os.path.basename(preset_path), getattr(target, "name", "?"),
                getattr(track, "name", "?"),
            )
        return None

    def resolve_clip_item(self, alc_path: str, source: str = "", rel: str = ""):
        """Resolve an ``.alc`` path to its loadable ``BrowserItem`` or
        ``None``. Tries the User-Library cache first, then the file a
        symlinked path points at, then a bounded walk of the real browser
        roots (``packs`` / ``clips`` / ...) — pack clips reached via
        symlink live under ``browser.packs``, not the User-Library tree.

        Live's browser lists no symlink, so a linked clip is only in it at
        its target. Measured 2026-09-24: the 190 accapella clips linked
        from ``Audio Samples/Inst/Vocal/Accapellas`` (and from the Places
        copy) all point into ``Samples Organized``, a Place
        (``paths.placesRoots``); every one answered ``not-in-browser``
        and fell back to a raw sample that the resolver could not find."""
        item = self._resolve_browser_item(alc_path, source, rel)
        if item is None:
            real = os.path.realpath(alc_path)
            if real != os.path.abspath(alc_path):
                item = self._resolve_browser_item(real)
        if item is None:
            item = self._find_clip_item_in_browser(alc_path)
        return item

    def load_clip_new_track(self, alc_path: str, source: str = "", rel: str = ""):
        """Load an ``.alc`` clip via Live's Browser and return the track
        Live created for it, or ``(None, detail)`` on failure.

        Live's ``browser.load_item`` for an ``.alc`` **always creates a new
        track** for the clip (it does not honour ``highlighted_clip_slot``
        — confirmed empirically). So we snapshot the track list, load, and
        return whichever track is new. Metadata (warp/loop/gain/pitch) is
        preserved because it's a real clip load, not a raw-sample import.

        Returns ``(track, None)`` on success or ``(None, detail)`` on
        failure so the caller can fall back to a raw-sample clip.
        """
        if not alc_path or not os.path.isfile(alc_path):
            return None, "path-not-found"

        item = self.resolve_clip_item(alc_path, source, rel)
        if item is None:
            return None, "not-in-browser"

        try:
            before = _track_ptr_set(self._song)
        except _LOM_ERRORS as e:
            return None, "pre-snapshot: %s" % e

        try:
            self._browser.load_item(item)
        except _LOM_ERRORS as e:
            logger.error(
                "DeviceLoadComponent: clip load_item(%r) raised %s: %s",
                alc_path, type(e).__name__, e,
            )
            return None, "%s: %s" % (type(e).__name__, str(e)[:120])

        # Find the track Live just created (the one not in the before set).
        try:
            new_track = _find_new_track(self._song, before)
        except _LOM_ERRORS as e:
            return None, "post-snapshot: %s" % e
        if new_track is None:
            # load_item ran but no track appeared — unexpected for .alc.
            return None, "no-new-track"
        return new_track, None

    def _find_clip_item_in_browser(self, alc_path: str):
        """Bounded search for an ``.alc``'s BrowserItem across the real
        browser roots (pack clips miss the User-Library cache).

        Matches on the filename leaf, with and without the ``.alc``
        extension (Live strips native suffixes from display names).
        """
        leaf = alc_path.rsplit("/", 1)[-1]
        stem = leaf.rsplit(".", 1)[0]
        for name in ("packs", "clips", "current_project", "user_library", "samples"):
            root = getattr(self._browser, name, None)
            if root is None:
                continue
            found = _walk_for_clip_leaf(root, leaf, stem)
            if found is not None:
                return found
        return None

    # --- resolution helpers ------------------------------------------------

    def _resolve_browser_item(self, preset_path: str, source: str = "", rel: str = ""):
        """Map a filesystem path to its loadable ``BrowserItem``.

        Delegates to :class:`BrowserCache` for an O(1) dict lookup.
        The cache builds itself lazily per root (User Library, each
        Place, each Pack) on first access — see ``browser_cache.py``.
        A load that names its Place (``source`` + ``rel``, 3.11.0) is
        looked up there first, and by path when that misses. Returns the
        leaf ``BrowserItem`` or ``None`` with the cache logging the
        reason on any miss.
        """
        if source and rel:
            item = self._browser_cache.lookup_named(source, rel)
            if item is not None:
                return item
        return self._browser_cache.lookup(preset_path) if preset_path else None

    def absolute_path(self, preset_path: str, source: str = "", rel: str = "") -> str:
        """``preset_path``, or the path a ``source`` + ``rel`` pair names
        when it is empty — a client need not know where a Place is."""
        if preset_path or not (source and rel):
            return preset_path
        root = self._browser_cache.root_path(source)
        return os.path.join(root, rel.strip("/")) if root else ""

    def has_place(self, name: str) -> bool:
        """Whether Live's sidebar (or the config) lists a Place of this name."""
        return self._browser_cache.has_place(name)

    def _resolve_target_track(self, track_path: str):
        """Return the target track, or ``None`` with an error emitted.

        The empty-path → ``selected_track`` fallback was removed
        (2026-04-26): under load, ``selected_track`` could lag behind
        the UI's intent and an instrument would land on the
        previously-selected (occupied) track. Loads now require an
        explicit ``trackPath``; an empty path is rejected as
        ``track-not-found`` with detail ``"empty-path"`` so the bug
        surfaces as a typed error instead of corrupting state.

        A non-empty ``track_path`` routes through
        :func:`path_resolver.resolve_track`. Its four non-OK statuses
        map onto the single ``track-not-found`` wire code per design
        §3.5, with the ``detail`` carrying a discriminator:

        - ``MALFORMED`` → ``"malformed-path"``
        - ``NOT_FOUND`` → ``""``  (most common; no diagnostic needed)
        - ``NOT_SUPPORTED`` → ``"not-supported"`` (e.g. ``returns/N``
          — grammar-valid, handler doesn't own)
        """
        if track_path == "":
            self._emit_error(
                V3_ERROR_TRACK_NOT_FOUND,
                path="",
                detail="empty-path",
            )
            return None

        result = resolve_track(self._song, track_path)
        if result.status is ResolveStatus.OK:
            return result.obj
        if result.status is ResolveStatus.MALFORMED:
            self._emit_error(
                V3_ERROR_TRACK_NOT_FOUND,
                path=track_path,
                detail="malformed-path",
            )
            return None
        if result.status is ResolveStatus.NOT_SUPPORTED:
            self._emit_error(
                V3_ERROR_TRACK_NOT_FOUND,
                path=track_path,
                detail="not-supported",
            )
            return None
        # Remaining: NOT_FOUND (most common) and any future status.
        self._emit_error(
            V3_ERROR_TRACK_NOT_FOUND,
            path=track_path,
            detail="",
        )
        return None

    def _validate_device_path(self, device_path: str, track) -> bool:
        """Validate a non-empty ``devicePath`` against ``track``.

        Shape is either ``tracks/<N>/devices/<M>`` or
        ``master/devices/<M>``. ``<N>`` is not re-validated against
        the track the caller already resolved — its role is purely
        shape-level (the caller's ``track_path`` owns track identity,
        per design §3.3). ``<M>`` is bounds-checked against
        ``len(track.devices)``.

        On mismatch: emits ``device-slot-invalid`` with the offending
        segment in ``detail`` and returns ``False``. On success
        returns ``True``.

        The FX grid sends a PAD path on every pad load (3.8.0), which
        ``handle_load`` routes to ``resolve_pad`` before reaching here;
        no UI sender emits a plain ``tracks/<N>/devices/<M>`` today, so
        this remains reserved-shape validation for a future caller.
        """
        parts = device_path.split("/")
        if len(parts) == 4:
            head, n_token, mid, m_token = parts
            if head != "tracks" or mid != "devices":
                self._emit_error(
                    V3_ERROR_DEVICE_SLOT_INVALID,
                    path=device_path,
                    detail="shape",
                )
                return False
            if _parse_nonneg_index(n_token) is None:
                self._emit_error(
                    V3_ERROR_DEVICE_SLOT_INVALID,
                    path=device_path,
                    detail=n_token,
                )
                return False
            m_idx = _parse_nonneg_index(m_token)
            if m_idx is None:
                self._emit_error(
                    V3_ERROR_DEVICE_SLOT_INVALID,
                    path=device_path,
                    detail=m_token,
                )
                return False
        elif len(parts) == 3:
            head, mid, m_token = parts
            if head != "master" or mid != "devices":
                self._emit_error(
                    V3_ERROR_DEVICE_SLOT_INVALID,
                    path=device_path,
                    detail="shape",
                )
                return False
            m_idx = _parse_nonneg_index(m_token)
            if m_idx is None:
                self._emit_error(
                    V3_ERROR_DEVICE_SLOT_INVALID,
                    path=device_path,
                    detail=m_token,
                )
                return False
        else:
            self._emit_error(
                V3_ERROR_DEVICE_SLOT_INVALID,
                path=device_path,
                detail="shape",
            )
            return False

        # Bounds-check M against the resolved track's device chain.
        # ``track.devices`` read is guarded — a torn-down track could
        # surface ``RuntimeError`` from the LOM wrapper.
        try:
            device_count = len(track.devices)
        except _LOM_ERRORS as e:
            logger.warning(
                "DeviceLoadComponent: devices read failed: %s", e,
            )
            self._emit_error(
                V3_ERROR_DEVICE_SLOT_INVALID,
                path=device_path,
                detail="devices-read-failed",
            )
            return False
        if m_idx > device_count:
            # M == device_count is a legal "append" position. Strict >
            # is out-of-range.
            self._emit_error(
                V3_ERROR_DEVICE_SLOT_INVALID,
                path=device_path,
                detail=str(m_idx),
            )
            return False
        return True

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. No listeners; a pad load still waiting for
        Live is dropped here (its undo step, were one open, closed), and no
        error is emitted."""
        self._disconnected = True
        for p in list(self._pending):
            self._close_placement(p)

    # --- emit helpers -----------------------------------------------------

    def _emit_error(self, code: str, path: str, detail: str) -> None:
        """Emit ``/looping/v3/error [address, code, path, detail]``.

        Four-arg shape — same as DevicesComponent / TrackMetadataComponent.
        """
        if self._disconnected:
            return
        logger.warning(
            "DeviceLoadComponent: emit error code=%r path=%r detail=%r",
            code, path, detail,
        )
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (V3_DEVICE_LOAD_ADDRESS, code, path, detail),
            )
        except Exception as e:
            logger.warning(
                "DeviceLoadComponent: emit %s failed: %s",
                V3_ERROR_ADDRESS, e,
            )
