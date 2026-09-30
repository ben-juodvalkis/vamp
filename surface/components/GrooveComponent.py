"""GrooveComponent — PR-5e2 focus-scoped groove property channel.

Owns the ``/looping/v3/clip/groove/*`` address family for the
5 groove-amount attributes on the **currently focused** clip's
groove (``live_set view detail_clip``'s ``groove``):

    base, timing_amount, quantization_amount, random_amount,
    velocity_amount

Wire contract per [04 §3.6] and
[phase-5-pr5e2-design.md §9–§13]:

    UI → Surf   /looping/v3/clip/groove/set/<attr>
                  [clipPath, value]
    Surf → UI   /looping/v3/clip/groove/property
                  [clipPath, name, value]
    Surf → UI   /looping/v3/clip/groove/has_groove
                  [clipPath, bool]
    UI → Surf   /looping/v3/clip/groove/set/file
                  [clipPath, name]
    Surf → UI   /looping/v3/clip/groove/file
                  [clipPath, name]
    Surf → UI   /looping/v3/error
                  [triggering_address, "pool-exhausted",
                   clip_path, detail]

Focus-scoped observation — mirrors ``ClipPropertiesComponent``
--------------------------------------------------------------

One listener on ``song.view.detail_clip`` (attached once at
``__init__`` — independent of the sibling
``ClipPropertiesComponent``'s listener per design §5 option (a)).
When it fires: detach the 5 amount listeners from the previous
focused clip's groove (if any), resolve the new detail_clip +
its groove, emit ``has_groove`` + 5 amounts, attach the 5
listeners to the new groove.

**Does NOT emit ``clip/focused``.** That is
ClipPropertiesComponent's job. GrooveComponent's detail_clip
listener drives only groove attach/detach + has_groove.

Assign-on-first-write
---------------------

Per design §3. When any of the 5 amount handlers fires for a
clipPath whose resolved clip has no groove
(``clip.groove == ("id", 0)``), the handler transparently calls
``GroovePoolComponent.assign_groove_to_clip`` before applying
the amount write. On ``PoolExhausted``:

- Emit ``/looping/v3/error`` with code ``pool-exhausted``.
- Do NOT persist the amount write.

Writes accept **any** resolvable clipPath, not just the focused
one (write-path asymmetry — see PR-5e1 and design §11). If the
write targets a non-focused clip, no echo fires (no listener on
that clip's groove). The UI filters late echoes by comparing
incoming clipPath against ``session.focusedClipPath``.

Pool-return on focused-clip delete — focus-observable
------------------------------------------------------

Per design §12. When ``detail_clip`` transitions from a focused
clip with a groove to any other state (different clip, None,
focused clip deleted → detail_clip replaced), we:

1. Capture the *previous* focused clipPath + the fact that it
   had a groove (cached at attach time).
2. If the previous focused slot's ``has_clip`` is now False
   (clip was deleted), call
   ``GroovePoolComponent.return_groove_to_pool(prev_path)``.
3. Emit ``has_groove [prev_path, false]`` so the UI clears its
   amount fields. (Skipped on non-delete focus changes — the
   UI's scalar store replaces those fields with the new clip's
   values anyway, so an extra ``has_groove false`` on the old
   clipPath would be noise.)

**Known gap: programmatic delete without focus.** A clip
deleted via LOM without ever becoming detail_clip keeps its
``Clip_<pathHash>`` tag until Phase 6's ClipLifecycleComponent
closes the gap uniformly. Strictly better than M4L today (which
leaks on every delete regardless of focus).

Cold-start / handshake-accept re-emit
-------------------------------------

``emit_on_accept()`` re-emits ``has_groove`` + 5 current amount
values (if a clip is focused). Wired into
``LoopingSurface._emit_on_accept_chain`` alongside the sibling
components' accept emits. GroovePoolComponent's
``emit_on_accept`` is a no-op — the pool has no UI-visible state
of its own.

LOM-touch guard
---------------

Every LOM read/write/listener attach is wrapped in
``_LOM_ERRORS = (RuntimeError, AttributeError, TypeError)`` per
Merge-gate rule #9 — ``Boost.Python.ArgumentError`` is a
TypeError subclass. Warnings de-dupe via ``_warn_once``.

The groove chooser — ``set/file`` (2026-09-29)
-----------------------------------------------

Live's API cannot set a groove's pattern. ``set/file`` puts the clip on
the Core Library groove file ``name`` (``Swing 16ths 57``) by claiming a
groove that holds it — a free one of that pattern, else one freshly
loaded — then writes the clip's own Quantize, Timing, Random and
Velocity back onto it, since a loaded file brings its own (Timing 100,
the rest 0, measured). A clip with no groove takes Timing 100 and the
rest 0, so the tap is heard. The groove it leaves, if it was the clip's
own claim, is named free again with its pattern kept. ``file`` echoes
the pattern the focused clip's groove holds, ``""`` for none or one the
pool's names do not say (see GroovePoolComponent, "Names").

Validation
----------

Validate-and-reject, never clamp. Per design §9:

- ``base``: int ∈ {1, 2, 3}.
- ``timing_amount``, ``quantization_amount``, ``random_amount``,
  ``velocity_amount``: float in [0.0, 100.0], NaN rejected.
"""

from __future__ import annotations

import logging
import math
from typing import Callable, Dict, Optional, Tuple

from . import path_resolver
from .GroovePoolComponent import (
    BLANK_NAME,
    GroovePoolComponent,
    PoolExhausted,
    clip_groove_id,
    is_owned_by,
    live_id,
    pattern_of,
)

logger = logging.getLogger("looping")


# Same tuple shape as ClipPropertiesComponent — see that module's
# commentary on ``Boost.Python.ArgumentError`` being a TypeError
# subclass (Merge-gate rule #9).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum) -----------------------------------------

V3_CLIP_GROOVE_PROPERTY_ADDRESS = "/looping/v3/clip/groove/property"
V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS = "/looping/v3/clip/groove/has_groove"
V3_CLIP_GROOVE_FILE_ADDRESS = "/looping/v3/clip/groove/file"
V3_ERROR_ADDRESS = "/looping/v3/error"

V3_CLIP_GROOVE_SET_BASE_ADDRESS = (
    "/looping/v3/clip/groove/set/base"
)
V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS = (
    "/looping/v3/clip/groove/set/timing_amount"
)
V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS = (
    "/looping/v3/clip/groove/set/quantization_amount"
)
V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS = (
    "/looping/v3/clip/groove/set/random_amount"
)
V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS = (
    "/looping/v3/clip/groove/set/velocity_amount"
)
V3_CLIP_GROOVE_SET_FILE_ADDRESS = "/looping/v3/clip/groove/set/file"

# Pool-exhausted closed-enum code per [04 §7.2].
_ERROR_POOL_EXHAUSTED = "pool-exhausted"

# What ``set/file`` carries over from the groove a clip leaves; a clip
# with none starts from these, so the pattern is heard at once.
_CARRIED_AMOUNTS = (
    "quantization_amount", "timing_amount", "random_amount", "velocity_amount",
)
_FRESH_AMOUNTS = {
    "quantization_amount": 0.0, "timing_amount": 100.0,
    "random_amount": 0.0, "velocity_amount": 0.0,
}
_FILE_NAME_MAX = 128


# --- attribute table ------------------------------------------------------

_WIRE_INT_BASE = "int_base"
_WIRE_FLOAT_0_100 = "float_0_100"

_VALID_BASE = (1, 2, 3)

# ``(attr_name, wire_type)``. Every attr's LOM name equals its
# wire name. ``base`` is int; the four amounts are float 0–100.
_AMOUNT_ATTRS: Tuple[Tuple[str, str], ...] = (
    ("base", _WIRE_INT_BASE),
    ("timing_amount", _WIRE_FLOAT_0_100),
    ("quantization_amount", _WIRE_FLOAT_0_100),
    ("random_amount", _WIRE_FLOAT_0_100),
    ("velocity_amount", _WIRE_FLOAT_0_100),
)
_AMOUNT_NAMES: Tuple[str, ...] = tuple(n for n, _ in _AMOUNT_ATTRS)
_WIRE_TYPE_FOR: Dict[str, str] = {n: wt for n, wt in _AMOUNT_ATTRS}


# One helper for "which groove does this clip link", shared with the pool's
# orphan walk (moved there 2026-09-29; the old name stays for callers).
_groove_id_of = clip_groove_id


# --- component ------------------------------------------------------------


class GrooveComponent:
    """Owns the ``/looping/v3/clip/groove/*`` family, focus-scoped.

    Args:
        song: Live ``Song`` (test: ``ClipStubSong`` subclass with
            ``view`` + ``groove_pool.grooves``).
        emit: ``(address, args) -> None`` — OSC sender.
        pool: ``GroovePoolComponent`` instance. Ctor-injected so
            the handler can call ``assign_groove_to_clip`` and
            ``return_groove_to_pool`` without a back-reference
            from the pool into focus state.

    Lifecycle:
        ``__init__`` attaches the ``detail_clip`` listener on
        ``song.view``; if a clip is already focused it resolves
        the groove, attaches 5 amount listeners, and emits
        ``has_groove`` + current amounts. ``disconnect``
        detaches everything. Idempotent.
    """

    V3_CLIP_GROOVE_PROPERTY_ADDRESS = V3_CLIP_GROOVE_PROPERTY_ADDRESS
    V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS = V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS
    AMOUNT_ATTRS = _AMOUNT_ATTRS

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        pool: GroovePoolComponent,
    ):
        self._song = song
        self._emit = emit
        self._pool = pool
        self._disconnected = False

        # Currently-observed clip + its path, and the groove object
        # currently attached. ``_focused_groove`` is None when the
        # focused clip has no groove or no clip is focused.
        self._focused_clip = None
        self._focused_path: Optional[str] = None
        self._focused_groove = None

        # Cached reverse-lookup: the focused clip's track + slot_index
        # at attach time. Used during pool-return-on-delete so we can
        # check slot.has_clip after LOM swaps detail_clip.
        self._focused_track = None
        self._focused_slot_index: Optional[int] = None

        # ``attr_name -> bound callback`` for the 5 amount listeners
        # on ``_focused_groove``. Empty when no groove is attached.
        self._amount_listeners: Dict[str, Callable[[], None]] = {}

        # ``(key, context) -> True`` once warned, for de-dupe.
        self._warned: set = set()

        # ``(clipPath, grooveId)`` found linked by no other clip; see
        # ``_is_shared``. Cleared on every focus change.
        self._unshared: set = set()

        # Song-scoped detail_clip listener. Attach on ``song.view``
        # — independent of ClipPropertiesComponent's listener
        # (design §5, option (a) — rule of three).
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

        # Seed state if a clip is already focused at construction.
        self._refocus(initial=True)
        logger.info(
            "GrooveComponent init: focused_path=%s groove=%s amounts=%d",
            self._focused_path,
            "yes" if self._focused_groove is not None else "no",
            len(self._amount_listeners),
        )

    # --- song.view / detail_clip listener ---------------------------------

    def _safe_song_view(self):
        try:
            return self._song.view
        except _LOM_ERRORS as e:
            self._warn_once("song.view", "read", e)
            return None

    def _on_detail_clip_changed(self) -> None:
        if self._disconnected:
            return
        self._refocus(initial=False)

    def _refocus(self, initial: bool) -> None:
        """Detach from previous groove, resolve new focus, attach, emit.

        ``initial`` is True only on the construction-time seed call.
        It skips the pool-return-on-delete check since there is no
        prior focus to check for deletion.
        """
        # --- 1. Capture the previous state for delete-detection ---
        prev_clip = self._focused_clip
        prev_path = self._focused_path
        prev_groove = self._focused_groove
        prev_track = self._focused_track
        prev_slot_index = self._focused_slot_index

        # --- 2. Resolve new focus ---
        new_clip = self._read_detail_clip()
        new_path: Optional[str] = None
        new_track = None
        new_slot_index: Optional[int] = None
        if new_clip is not None:
            try:
                new_path = path_resolver.clip_path_for(self._song, new_clip)
            except _LOM_ERRORS as e:
                self._warn_once("clip_path_for", "refocus", e)
                new_path = None
            if new_path is not None:
                new_track, new_slot_index = self._lookup_track_slot(new_path)

        # --- 3. Detach from previous groove (always safe) ---
        self._detach_amount_listeners()

        # --- 4. Handle pool-return-on-delete ---
        #
        # If we had a focused clip with a claimed groove, and its slot
        # no longer reports has_clip=True, the clip was deleted. Return
        # the groove and emit has_groove=false for the gone path. Skip
        # when this is the initial seed call.
        if (not initial and prev_path is not None
                and prev_groove is not None):
            if self._slot_is_empty(prev_track, prev_slot_index):
                try:
                    self._pool.return_groove_to_pool(prev_path)
                except _LOM_ERRORS as e:
                    self._warn_once("pool_return", "delete", e)
                self._safe_emit_has_groove(prev_path, False)

        # --- 5. Update focus state before emits ---
        self._unshared.clear()
        self._focused_clip = new_clip if new_path is not None else None
        self._focused_path = new_path if new_path is not None else None
        self._focused_track = new_track
        self._focused_slot_index = new_slot_index
        self._focused_groove = None  # set below if groove present

        # --- 6. No focus → nothing to emit ---
        if self._focused_clip is None or self._focused_path is None:
            return

        # --- 7. Resolve clip's groove and emit has_groove + amounts ---
        groove = self._resolve_groove_for_clip(self._focused_clip)
        if groove is None:
            self._safe_emit_has_groove(self._focused_path, False)
            self._emit_file(None)
            return

        self._focused_groove = groove
        self._attach_amount_listeners(groove)
        self._safe_emit_has_groove(self._focused_path, True)
        self._emit_all_amounts(groove, "refocus")
        self._emit_file(groove)

    def _read_detail_clip(self):
        if self._view is None:
            return None
        try:
            return self._view.detail_clip
        except _LOM_ERRORS as e:
            self._warn_once("detail_clip", "read", e)
            return None

    def _lookup_track_slot(self, clip_path: str):
        """Resolve ``clip_path`` → (track, slot_index) for delete-check.

        Uses ``resolve_slot`` on the slot-prefix portion of the clip
        path (strips the trailing ``/clip``). Returns (None, None) on
        any failure — the subsequent ``_slot_is_empty`` check will
        conservatively return False (no return-to-pool attempted).
        """
        if not clip_path.endswith("/clip"):
            return None, None
        slot_path = clip_path[: -len("/clip")]
        try:
            r = path_resolver.resolve_slot(self._song, slot_path)
        except _LOM_ERRORS as e:
            self._warn_once("resolve_slot", "lookup", e)
            return None, None
        if not r.ok:
            return None, None
        # Track + slot_index are derived by re-parsing the path —
        # resolve_slot only returns the slot object. We want the
        # track for the delete-check too so a stale track ref
        # doesn't race a newly-resolved slot.
        track, slot_index = _parse_track_and_slot(self._song, slot_path)
        return track, slot_index

    def _slot_is_empty(self, track, slot_index: Optional[int]) -> bool:
        """Return True iff the slot at (track, slot_index) now has no clip.

        Used only as the pool-return-on-delete trigger. False on any
        LOM quirk: if we can't see ``has_clip`` clearly, don't try to
        return the groove — a false negative here is a cosmetic pool
        leak; a false positive could return a groove still in use.
        """
        if track is None or slot_index is None:
            return False
        try:
            slots = list(track.clip_slots)
        except _LOM_ERRORS:
            return False
        if slot_index >= len(slots):
            # Slot itself was deleted — treat as "clip gone."
            return True
        slot = slots[slot_index]
        try:
            return not bool(slot.has_clip)
        except _LOM_ERRORS:
            return False

    # --- groove resolution --------------------------------------------------

    def _resolve_groove_for_clip(self, clip):
        """Return the Groove object assigned to ``clip``, or None.

        Two-step: read ``clip.groove`` (a ``("id", N)`` tuple) and,
        if ``N != 0``, find the groove in
        ``song.groove_pool.grooves`` whose id matches. Live 12's
        Python API exposes grooves via the pool rather than through
        the tuple directly.
        """
        gid = _groove_id_of(clip)
        if gid is None:
            return None
        try:
            pool = self._song.groove_pool
        except _LOM_ERRORS as e:
            self._warn_once("groove_pool", "resolve", e)
            return None
        try:
            grooves = list(pool.grooves)
        except _LOM_ERRORS as e:
            self._warn_once("grooves", "resolve", e)
            return None
        for groove in grooves:
            if self._groove_matches_id(groove, gid):
                # Live's auto-load put the clip on the blank: no groove.
                try:
                    if groove.name == BLANK_NAME:
                        return None
                except _LOM_ERRORS:
                    pass
                return groove
        # Tuple pointed at an id the pool doesn't have — treat as
        # grooveless. This can happen if pool mutates between read
        # and walk; next focus change rebuilds.
        self._warn_once(
            "groove_mismatch", "resolve",
            RuntimeError("clip.groove id=%d not in pool" % gid),
        )
        return None

    def _groove_matches_id(self, groove, gid: int) -> bool:
        """Return True iff ``groove`` is the LOM object at ``gid``.

        Live wraps each property read in a fresh Python proxy, so
        we compare by the underlying live-ptr the same way
        path_resolver does. Falls back to ``id(groove) & mask == gid``
        for simple test stubs that don't have ``_live_ptr``. Both
        sides are masked to 31 bits so the comparison lines up with
        ``_groove_id_of`` (which also masks for OSC-int32 safety).
        """
        try:
            from .LOMListeners import _safe_int_id
        except Exception:
            _safe_int_id = None
        if _safe_int_id is not None:
            lpi = _safe_int_id(groove)
            if lpi is not None:
                return lpi == gid
        # Test stubs: plain Python id, masked to 31 bits to match
        # ``_groove_id_of``.
        try:
            return (id(groove) & 0x7FFFFFFF) == gid
        except Exception:
            return False

    # --- per-groove amount listeners --------------------------------------

    def _attach_amount_listeners(self, groove) -> None:
        for attr_name in _AMOUNT_NAMES:
            add = getattr(groove, "add_%s_listener" % attr_name, None)
            if not callable(add):
                # ``base`` may not be observable on some Live builds
                # — design §9 accepts this. Warn-once per missing
                # listener and carry on: the initial emit already
                # delivered the current value.
                self._warn_once(
                    attr_name, "attach-missing",
                    AttributeError(
                        "no add_%s_listener on groove" % attr_name,
                    ),
                )
                continue
            cb = self._make_amount_listener(attr_name)
            try:
                add(cb)
            except _LOM_ERRORS as e:
                self._warn_once(attr_name, "attach", e)
                continue
            self._amount_listeners[attr_name] = cb

    def _detach_amount_listeners(self) -> None:
        groove = self._focused_groove
        if groove is None:
            self._amount_listeners.clear()
            return
        for attr_name in list(self._amount_listeners.keys()):
            cb = self._amount_listeners.pop(attr_name, None)
            if cb is None:
                continue
            remove = getattr(groove, "remove_%s_listener" % attr_name, None)
            if not callable(remove):
                continue
            try:
                remove(cb)
            except _LOM_ERRORS as e:
                self._warn_once(attr_name, "detach", e)

    def _make_amount_listener(
        self, attr_name: str,
    ) -> Callable[[], None]:
        def _fire() -> None:
            if self._disconnected:
                return
            groove = self._focused_groove
            if groove is None or self._focused_path is None:
                return
            raw = self._safe_read_groove_attr(groove, attr_name, "fire-read")
            if raw is None:
                return
            self._emit_amount(attr_name, raw)

        return _fire

    # --- emits -------------------------------------------------------------

    def _safe_emit_has_groove(
        self, clip_path: str, has_groove: bool,
    ) -> None:
        try:
            self._emit(
                V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
                (clip_path, 1 if has_groove else 0),
            )
        except Exception as e:
            logger.warning(
                "GrooveComponent has_groove emit failed: %s "
                "(path=%r, has=%r)", e, clip_path, has_groove,
            )

    def _emit_amount(self, attr_name: str, raw) -> None:
        if self._focused_path is None:
            return
        wire_type = _WIRE_TYPE_FOR.get(attr_name)
        if wire_type is None:
            return
        value = _encode_wire(wire_type, raw)
        if value is None:
            self._warn_once(
                attr_name, "fire-encode",
                ValueError("could not encode %r" % (raw,)),
            )
            return
        self._emit(
            V3_CLIP_GROOVE_PROPERTY_ADDRESS,
            (self._focused_path, attr_name, value),
        )

    def _emit_all_amounts(self, groove, context: str) -> None:
        if self._focused_path is None or groove is None:
            return
        for attr_name in _AMOUNT_NAMES:
            raw = self._safe_read_groove_attr(
                groove, attr_name, "%s-read" % context,
            )
            if raw is None:
                continue
            self._emit_amount(attr_name, raw)

    def _emit_file(self, groove) -> None:
        """``file [focusedPath, pattern]`` — ``""`` for no groove, or one
        whose name does not say."""
        if self._focused_path is None:
            return
        name = ""
        if groove is not None:
            try:
                name = pattern_of(groove.name) or ""
            except _LOM_ERRORS as e:
                self._warn_once("groove.name", "file-read", e)
        try:
            self._emit(V3_CLIP_GROOVE_FILE_ADDRESS, (self._focused_path, name))
        except Exception as e:
            logger.warning("GrooveComponent file emit failed: %s", e)

    def emit_on_accept(self) -> None:
        """Re-emit ``has_groove`` + amounts after handshake accept.

        Symmetric with SessionComponent / ClipPropertiesComponent
        ``emit_on_accept``. Closes the cold-start gap.
        """
        if self._focused_path is None:
            return
        has = self._focused_groove is not None
        self._safe_emit_has_groove(self._focused_path, has)
        if has:
            self._emit_all_amounts(self._focused_groove, "on_accept")
        self._emit_file(self._focused_groove)

    # --- write handlers ----------------------------------------------------

    def handle_set_base(self, args, source_addr):
        clip, path = self._parse_clip_from_args(args, "base")
        if clip is None:
            return None
        val = _parse_int_arg(args, 1)
        if val is None or val not in _VALID_BASE:
            logger.warning(
                "GrooveComponent set base: %r not in %r; rejecting",
                args[1] if len(args) > 1 else None, _VALID_BASE,
            )
            return None
        self._apply_amount_write(
            clip, path, "base", val,
            V3_CLIP_GROOVE_SET_BASE_ADDRESS,
        )
        return None

    def handle_set_timing_amount(self, args, source_addr):
        self._handle_float_amount(
            args, "timing_amount",
            V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS,
        )
        return None

    def handle_set_quantization_amount(self, args, source_addr):
        self._handle_float_amount(
            args, "quantization_amount",
            V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS,
        )
        return None

    def handle_set_random_amount(self, args, source_addr):
        self._handle_float_amount(
            args, "random_amount",
            V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS,
        )
        return None

    def handle_set_velocity_amount(self, args, source_addr):
        self._handle_float_amount(
            args, "velocity_amount",
            V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS,
        )
        return None

    def _handle_float_amount(
        self, args, attr_name: str, set_address: str,
    ) -> None:
        clip, path, val = self._parse_float_0_100(args, attr_name)
        if clip is None or val is None:
            return
        self._apply_amount_write(clip, path, attr_name, val, set_address)

    # --- handler helpers ---------------------------------------------------

    def _apply_amount_write(
        self, clip, clip_path: str, attr_name: str, val,
        set_address: str,
    ) -> None:
        """Ensure clip has a groove, then write the amount.

        Assign-on-first-write lands here. If the clip is grooveless,
        claim an unassigned groove via
        ``GroovePoolComponent.assign_groove_to_clip``. On
        ``PoolExhausted``: emit ``/looping/v3/error`` and do NOT
        persist the amount.
        """
        groove = self._resolve_groove_for_clip(clip)
        inherit = None
        if groove is not None and self._is_shared(clip, clip_path, groove):
            # Not this clip's own and another clip links it too — Live
            # 12.1's default groove for new MIDI clips, a preset shared by
            # hand, a duplicate still on the original's claim. Writing it
            # would move every clip on it, so this clip takes a groove of
            # its own, starting from the shared one's settings.
            inherit, groove = groove, None
        if groove is None:
            # Leaving a shared groove, the clip keeps its pattern when the
            # Core Library has it (Live's default groove is a file there);
            # else, like a clip with none, it takes the default.
            pattern = None
            if inherit is not None:
                try:
                    pattern = pattern_of(inherit.name)
                except _LOM_ERRORS:
                    pattern = None
            try:
                groove = self._pool.assign_groove_to_clip(
                    clip, clip_path, inherit=inherit,
                    pattern=pattern, strict=False,
                )
            except PoolExhausted:
                logger.warning(
                    "GrooveComponent %s: pool-exhausted for %r; "
                    "not persisting value", attr_name, clip_path,
                )
                self._emit_pool_exhausted_error(
                    set_address, clip_path,
                )
                return
            except _LOM_ERRORS as e:
                logger.warning(
                    "GrooveComponent %s: assign-on-first-write raised: "
                    "%s (path=%r)", attr_name, e, clip_path,
                )
                return

        # Apply the amount write to the groove object directly.
        self._write_groove_attr(groove, attr_name, val)

        # If the write targets the currently-focused clip and the
        # focused-groove has just changed (first-write-just-
        # assigned), refresh our cached reference + rebind listeners
        # + emit has_groove=true + initial amounts so the UI sees
        # the full picture without waiting for another focus tick.
        # Identity must be by live-ptr, not Python ``is``: Live
        # returns a fresh proxy per LOM read so ``is`` is always
        # True-rebinds on every tick, producing a storm of
        # has_groove/property re-seeds that clobber the UI.
        if self._focused_path == clip_path and self._is_new_focused_groove(groove):
            self._rebind_focused(groove, "first-write")
            return

        # Write-path echo for attrs Live 12 doesn't expose a listener
        # for (``base`` — no ``add_base_listener``). Without this, the
        # UI's radio-group never receives an RX update and stays on the
        # old value. Only echo when writing against the focused clip,
        # since non-focused writes have no listener-attached groove to
        # keep in sync.
        if (self._focused_path == clip_path
                and attr_name not in self._amount_listeners):
            raw = self._safe_read_groove_attr(groove, attr_name, "write-echo")
            if raw is not None:
                self._emit_amount(attr_name, raw)

    def _rebind_focused(self, groove, context: str) -> None:
        """The focused clip is on ``groove`` now: listen to it and re-seed
        the UI (has_groove, the amounts, the file)."""
        self._detach_amount_listeners()
        self._focused_groove = groove
        self._attach_amount_listeners(groove)
        self._safe_emit_has_groove(self._focused_path, True)
        self._emit_all_amounts(groove, context)
        self._emit_file(groove)

    def handle_set_file(self, args, source_addr):
        """``set/file [clipPath, name]`` — put the clip on the Core Library
        groove file ``name``, keeping its amounts (module docstring)."""
        clip, path = self._parse_clip_from_args(args, "file")
        if clip is None:
            return None
        name = args[1] if len(args) > 1 else None
        if (not isinstance(name, str) or not name.strip() or len(name) > _FILE_NAME_MAX
                or any(c in name for c in "/·#")):
            logger.warning("GrooveComponent set file: bad name %r; rejecting", name)
            return None
        name = name.strip()

        current = self._resolve_groove_for_clip(clip)
        current_name = None
        amounts = dict(_FRESH_AMOUNTS)
        if current is not None:
            try:
                current_name = current.name
            except _LOM_ERRORS:
                current_name = None
            gid = live_id(current)
            if (pattern_of(current_name) == name
                    and not self._pool.linked_elsewhere(clip, gid)):
                # Already on it, and no other clip shares it.
                if self._focused_path == path:
                    self._emit_file(current)
                return None
            for attr in _CARRIED_AMOUNTS:
                raw = self._safe_read_groove_attr(current, attr, "file-carry")
                if raw is not None:
                    amounts[attr] = raw

        try:
            groove = self._pool.assign_groove_to_clip(clip, path, pattern=name)
        except PoolExhausted:
            logger.warning("GrooveComponent set file: no groove %r for %r", name, path)
            self._emit_pool_exhausted_error(
                V3_CLIP_GROOVE_SET_FILE_ADDRESS, path,
                detail="No groove file %s" % name,
            )
            return None
        except _LOM_ERRORS as e:
            logger.warning("GrooveComponent set file raised: %s (path=%r)", e, path)
            return None

        for attr in _CARRIED_AMOUNTS:
            self._write_groove_attr(groove, attr, amounts[attr])

        # The groove left behind: this clip's own claim, linked by no other
        # clip, is free again, still holding its pattern.
        if (current is not None and is_owned_by(current_name, path)
                and not self._pool.linked_elsewhere(clip, live_id(current))):
            self._pool.release(current)

        if self._focused_path == path:
            self._rebind_focused(groove, "file")
        return None

    def _is_shared(self, clip, clip_path: str, groove) -> bool:
        """Whether ``groove`` is someone else's that another clip links.

        A groove that is not the clip's own but that only this clip
        links (a preset the user put on it) is written in place: taking
        a fresh one would lose the preset's pattern. The walk runs only
        for such a groove, and its "not shared" answer is kept per
        clip path + groove so a slider drag walks once, not per tick.
        """
        try:
            name = groove.name
        except _LOM_ERRORS:
            return False
        if is_owned_by(name, clip_path):
            return False
        gid = _groove_id_of(clip)
        if gid is None:
            return False
        key = (clip_path, gid)
        if key in self._unshared:
            return False
        if self._pool.linked_elsewhere(clip, gid):
            return True
        self._unshared.add(key)
        return False

    def _is_new_focused_groove(self, groove) -> bool:
        """True if ``groove`` is not the currently-cached focused groove.

        Compares by live-ptr id (masked to 31 bits) rather than
        Python ``is``, since Live wraps each LOM read in a fresh
        Python proxy. ``None`` on either side always means "new".
        """
        if self._focused_groove is None or groove is None:
            return self._focused_groove is not groove
        try:
            from .LOMListeners import _safe_int_id
        except Exception:
            _safe_int_id = None
        if _safe_int_id is not None:
            a = _safe_int_id(self._focused_groove)
            b = _safe_int_id(groove)
            if a is not None and b is not None:
                return a != b
        return self._focused_groove is not groove

    def _emit_pool_exhausted_error(
        self, set_address: str, clip_path: str,
        detail: str = "Pool has 0 unassigned grooves",
    ) -> None:
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (
                    set_address,
                    _ERROR_POOL_EXHAUSTED,
                    clip_path,
                    detail,
                ),
            )
        except Exception as e:
            logger.error(
                "GrooveComponent pool-exhausted emit failed: %s "
                "(path=%r)", e, clip_path,
            )

    def _parse_clip_from_args(
        self, args, attr_name: str,
    ) -> Tuple[Optional[object], Optional[str]]:
        if not args:
            logger.warning(
                "GrooveComponent set %s: empty args, ignoring", attr_name,
            )
            return None, None
        raw = args[0]
        if not isinstance(raw, str):
            logger.warning(
                "GrooveComponent set %s: clipPath not a string: %r",
                attr_name, raw,
            )
            return None, None
        r = path_resolver.resolve_clip(self._song, raw)
        if not r.ok:
            logger.warning(
                "GrooveComponent set %s: clipPath %r unresolved: %s (%s)",
                attr_name, raw, r.status.value, r.detail,
            )
            return None, None
        return r.obj, raw

    def _parse_float_0_100(
        self, args, attr_name: str,
    ) -> Tuple[Optional[object], Optional[str], Optional[float]]:
        clip, path = self._parse_clip_from_args(args, attr_name)
        if clip is None:
            return None, None, None
        if len(args) < 2:
            logger.warning(
                "GrooveComponent set %s: missing value arg", attr_name,
            )
            return None, None, None
        try:
            val = float(args[1])
        except (TypeError, ValueError) as e:
            logger.warning(
                "GrooveComponent set %s: bad float %r: %s",
                attr_name, args[1], e,
            )
            return None, None, None
        if math.isnan(val):
            logger.warning(
                "GrooveComponent set %s: NaN rejected", attr_name,
            )
            return None, None, None
        if val < 0.0 or val > 100.0:
            logger.warning(
                "GrooveComponent set %s: %.4f out of [0,100]; rejecting",
                attr_name, val,
            )
            return None, None, None
        return clip, path, val

    def _write_groove_attr(self, groove, attr_name: str, val) -> None:
        try:
            setattr(groove, attr_name, val)
        except _LOM_ERRORS as e:
            logger.warning(
                "GrooveComponent set %s=%r raised: %s",
                attr_name, val, e,
            )

    def _safe_read_groove_attr(self, groove, attr_name: str, context: str):
        try:
            return getattr(groove, attr_name)
        except _LOM_ERRORS as e:
            self._warn_once(attr_name, context, e)
            return None

    # --- diagnostics -------------------------------------------------------

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        slot = (key, context)
        if slot in self._warned:
            return
        self._warned.add(slot)
        logger.warning(
            "GrooveComponent %s (%s): %s (suppressing further warnings)",
            key, context, exc,
        )

    # --- lifecycle ---------------------------------------------------------

    def disconnect(self):
        if self._disconnected:
            return
        self._disconnected = True

        # Per-groove amount listeners.
        self._detach_amount_listeners()

        # detail_clip listener on song.view.
        if self._detail_listener_attached and self._view is not None:
            try:
                self._view.remove_detail_clip_listener(
                    self._on_detail_clip_changed,
                )
            except _LOM_ERRORS as e:
                logger.warning(
                    "GrooveComponent detail_clip detach failed: %s", e,
                )
            self._detail_listener_attached = False


# --- module helpers -------------------------------------------------------


def _encode_wire(wire_type: str, raw):
    if wire_type == _WIRE_INT_BASE:
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    if wire_type == _WIRE_FLOAT_0_100:
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


def _parse_track_and_slot(song, slot_path: str):
    """Re-parse a slot path into (track, slot_index).

    Needed for the pool-return-on-delete check — after ``resolve_slot``
    confirms the slot existed, we also need the track object + the
    slot index so we can read slot-state post-delete without
    re-walking the whole tree.

    Returns (None, None) on any malformed path — the caller just
    won't attempt the delete-return, which is safe.
    """
    parts = slot_path.split("/")
    if len(parts) < 3:
        return None, None
    # Three shapes: ``tracks/<N>/slots/<M>``, ``master/slots/<M>``,
    # ``returns/<N>/slots/<M>``. Only the first is live today; the
    # others would be NOT_SUPPORTED upstream.
    try:
        if parts[0] == "tracks":
            t_idx = int(parts[1])
            s_idx = int(parts[3])
            tracks = list(song.tracks)
            if t_idx >= len(tracks):
                return None, None
            return tracks[t_idx], s_idx
        if parts[0] == "master":
            s_idx = int(parts[2])
            return song.master_track, s_idx
    except (ValueError, IndexError, AttributeError):
        return None, None
    return None, None
