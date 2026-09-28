"""AlcClipProbe — verify whether an ``.alc`` (Ableton Live Clip) can be
loaded into a clip slot **through Live's Browser** with its clip metadata
(warp/timing, loop points, gain, pitch) preserved.

Why this probe exists
---------------------

The production clip-load path (``ClipsComponent.handle_load_file``) resolves
an ``.alc`` to its underlying raw sample and calls
``ClipSlot.create_audio_clip(sample)`` — which discards everything the
``.alc`` wraps (warp markers, loop_start/loop_end, gain, pitch). Live's
Browser can load an ``.alc`` *as a clip*, preserving that metadata, but the
only loader on Live 12.3.x's ``Browser`` proxy is
``browser.load_item(BrowserItem)``, and that drops the item onto Live's
current **selection**. It is unproven on this surface whether setting
``song.view.highlighted_clip_slot`` to a target slot makes ``load_item``
land the ``.alc`` there as a clip.

This probe answers that empirically. It is a throwaway diagnostic modelled
on :class:`BrowserProbe` — no production caller, not in ``backendScope``.

Shape
-----

One OSC address, ``/looping/probe/alc_clip_load [alc_path]``, routed to
``handle_alc_clip_load``. The handler:

1. Resolves the target: the selected track + its first **empty** clip slot.
   (An empty slot avoids clobbering a user's clip; if none is free, fail
   with a clear detail so the operator can free one.)
2. Sets ``song.view.selected_track`` and ``song.view.highlighted_clip_slot``
   to that slot — the write primitive Live actually honours in production
   (``SelectedTrackComponent`` sets ``highlighted_clip_slot`` directly).
3. Resolves ``alc_path`` to a ``BrowserItem`` via the injected ``resolve_item``
   callable (``BrowserCache.lookup`` — the *safe* User-Library path, not a
   raw ``user_folders`` traversal, which wedged the transport historically).
4. Calls ``browser.load_item(item)``.
5. Schedules a delayed read ~800ms later and emits
   ``/looping/probe/alc_clip_result [ok, detail]`` where ``detail`` reports
   whether a clip appeared in the target slot and its
   warp/loop/gain/pitch state.

The ``ok`` flag is an int (0/1) — same wire-shape rationale as
:class:`BrowserProbe`.

Injection points
----------------

``browser``, ``song``, ``resolve_item``, ``emit``, ``schedule_delayed`` are
constructor args so the unit tests drive the whole flow against stubs
without Live. ``schedule_delayed(ms, fn)`` is
``ControlSurface.schedule_message`` (tick-rounded) in production and a
synchronous call in tests.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("looping")


LOAD_ADDRESS = "/looping/probe/alc_clip_load"
RESULT_ADDRESS = "/looping/probe/alc_clip_result"

DEFAULT_VERIFY_DELAY_MS = 2500


class AlcClipProbe:
    """Drives an ``.alc``-via-Browser clip load and reports metadata survival.

    Args:
        browser: ``Live.Application.get_application().browser``.
        song: The Live ``Song`` — used for selection + slot resolution.
        resolve_item: Callable ``(fs_path) -> BrowserItem | None`` — in
            production ``BrowserCache.lookup``; in tests a stub.
        emit: Callable ``(address, args)`` bound to the transport ``send``.
        schedule_delayed: Callable ``(delay_ms, fn)``.
        verify_delay_ms: Wait before reading back the clip state.
    """

    def __init__(
        self,
        browser,
        song,
        resolve_item,
        emit,
        schedule_delayed,
        verify_delay_ms: int = DEFAULT_VERIFY_DELAY_MS,
    ):
        self._browser = browser
        self._song = song
        self._resolve_item = resolve_item
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        self._verify_delay_ms = verify_delay_ms

    # --- handler ----------------------------------------------------------

    def handle_alc_clip_load(self, args, source_addr):
        """``/looping/probe/alc_clip_load [alc_path]`` entry point."""
        if len(args) < 1:
            logger.warning("AlcClipProbe: expected (alc_path,), got %r", args)
            return None
        alc_path = str(args[0])

        # 1) Resolve target slot. Prefer the slot the operator has
        #    highlighted in Live; fall back to the first empty slot on the
        #    selected track only if nothing is highlighted.
        try:
            track, slot, slot_index, target_detail = self._resolve_target_slot()
        except Exception as e:
            self._emit_result(0, "target_slot_unresolved: %s" % e)
            return None
        if slot is None:
            self._emit_result(0, target_detail)
            return None

        # 2) Set selection to the target slot — this is what makes a
        #    Browser load land in the right place (hypothesis under test).
        try:
            self._song.view.selected_track = track
            self._song.view.highlighted_clip_slot = slot
        except Exception as e:
            self._emit_result(0, "set_selection_failed: %s" % e)
            return None

        # 3) Resolve the .alc to a BrowserItem. Try the injected
        #    User-Library cache first (fast, O(1)); on a miss, fall back to
        #    a bounded search across the real browser roots (packs / clips /
        #    current_project / user_library) — pack clips reached via
        #    symlink live under browser.packs, not the User-Library tree.
        item = None
        resolve_detail = ""
        try:
            item = self._resolve_item(alc_path)
        except Exception as e:
            resolve_detail = "cache_resolve_raised: %s; " % e
        if item is None:
            item = self._find_item_in_browser(alc_path)
        if item is None:
            self._emit_result(
                0, "%salc_not_found_in_browser: %s" % (resolve_detail, alc_path),
            )
            return None

        # 4) Load it.
        loader = getattr(self._browser, "load_item", None)
        if not callable(loader):
            self._emit_result(0, "no_load_item_method")
            return None
        try:
            loader(item)
            attempt = "ok:load_item via %r [%s]" % (
                getattr(item, "name", "?"), target_detail,
            )
        except Exception as e:
            self._emit_result(0, "load_item_raised: %s" % e)
            return None

        # 5) Verify after a delay — read back the target slot's clip state.
        def _verify():
            self._verify_and_emit(track, slot_index, attempt)

        try:
            self._schedule_delayed(self._verify_delay_ms, _verify)
        except Exception as e:
            self._emit_result(0, "schedule_failed: %s" % e)
        return None

    # --- internals --------------------------------------------------------

    def _selected_track(self):
        track = self._song.view.selected_track
        if track is None:
            raise RuntimeError("song.view.selected_track is None")
        return track

    def _first_empty_slot_index(self, track):
        """Index of the first clip slot with no clip, or ``None``."""
        slots = getattr(track, "clip_slots", None) or ()
        for i, slot in enumerate(slots):
            try:
                if not slot.has_clip:
                    return i
            except Exception:
                continue
        return None

    def _resolve_target_slot(self):
        """Return ``(track, slot, slot_index, detail)`` for the load target.

        Prefer the operator's currently-highlighted slot; fall back to the
        first empty slot on the selected track. ``slot`` is ``None`` (with a
        ``detail`` reason) when neither is available.
        """
        view = self._song.view
        track = view.selected_track
        if track is None:
            return None, None, None, "no_selected_track"

        # Prefer the highlighted slot if it belongs to the selected track.
        hi = None
        try:
            hi = view.highlighted_clip_slot
        except Exception:
            hi = None
        if hi is not None:
            slots = list(getattr(track, "clip_slots", None) or ())
            for i, s in enumerate(slots):
                if s is hi or _same_slot(s, hi):
                    return track, hi, i, "highlighted_slot#%d" % i

        # Fall back to first empty slot.
        idx = self._first_empty_slot_index(track)
        if idx is None:
            return track, None, None, (
                "no_empty_slot and no highlighted slot (highlight a slot "
                "or free one, then retry)"
            )
        try:
            return track, track.clip_slots[idx], idx, "first_empty_slot#%d" % idx
        except Exception as e:
            return track, None, None, "slot_index_unresolved: %s" % e

    def _find_item_in_browser(self, alc_path):
        """Bounded search for the ``.alc``'s BrowserItem across real roots.

        Pack clips reached via symlink live under ``browser.packs`` /
        ``browser.clips``, not the User-Library tree, so the cache misses
        them. Match on the filename leaf (with/without the ``.alc``
        extension, since Live strips native suffixes from display names).
        """
        leaf = alc_path.rsplit("/", 1)[-1]
        stem = leaf.rsplit(".", 1)[0]
        roots = []
        for name in ("packs", "clips", "current_project", "user_library", "samples"):
            root = getattr(self._browser, name, None)
            if root is not None:
                roots.append(root)
        for root in roots:
            found = _walk_for_leaf(root, leaf, stem)
            if found is not None:
                return found
        return None

    def _verify_and_emit(self, track, slot_index, attempt):
        """Read the target slot's clip and report metadata survival."""
        try:
            slot = track.clip_slots[slot_index]
        except Exception as e:
            self._emit_result(0, "%s; post_slot_unreadable: %s" % (attempt, e))
            return

        try:
            has_clip = bool(slot.has_clip)
        except Exception as e:
            self._emit_result(0, "%s; has_clip_unreadable: %s" % (attempt, e))
            return

        if not has_clip:
            # Target slot empty at verify time. Before declaring failure,
            # scan the whole track — load_item may have dropped the clip
            # into a different slot (e.g. Live's own selection at load time).
            other = self._find_clip_elsewhere(track, slot_index)
            if other is not None:
                oi, oclip = other
                state = _read_clip_metadata(oclip)
                self._emit_result(
                    1, "%s; landed_in_slot#%d (not target); %s"
                    % (attempt, oi, state),
                )
                return
            self._emit_result(0, "%s; slot_empty_after_load" % attempt)
            return

        clip = slot.clip
        state = _read_clip_metadata(clip)
        detail = "%s; landed_in_target; %s" % (attempt, state)
        # A clip landed — that's the primary success criterion. Metadata
        # richness is reported in the detail for the operator to judge.
        self._emit_result(1, detail)

    def _find_clip_elsewhere(self, track, exclude_index):
        """Return ``(index, clip)`` for the first populated slot other than
        ``exclude_index``, or ``None``. Used to detect a mis-targeted load."""
        slots = list(getattr(track, "clip_slots", None) or ())
        for i, s in enumerate(slots):
            if i == exclude_index:
                continue
            try:
                if s.has_clip:
                    return i, s.clip
            except Exception:
                continue
        return None

    def _emit_result(self, ok, detail):
        logger.info("AlcClipProbe result: ok=%d detail=%s", ok, detail)
        self._emit(RESULT_ADDRESS, (int(ok), detail))


# --- helpers -------------------------------------------------------------


def _same_slot(a, b):
    """Best-effort identity for two clip-slot wrappers (LOM hands out fresh
    wrappers per read, so ``is`` can miss). Compare ``_live_ptr`` if present."""
    try:
        pa = getattr(a, "_live_ptr", None)
        pb = getattr(b, "_live_ptr", None)
        if pa is not None and pb is not None:
            return int(pa) == int(pb)
    except Exception:
        pass
    return False


def _walk_for_leaf(node, leaf, stem, depth=0, max_depth=32):
    """DFS a browser subtree for a loadable item named ``leaf`` or ``stem``.

    Stops at the first match. Bounded depth guards against pathological
    trees (the User-Library root alone holds ~99k entries, so we rely on
    the pack/clips roots being far smaller and matching early).
    """
    if depth > max_depth:
        return None
    try:
        name = node.name
    except Exception:
        name = None
    if name is not None and (name == leaf or name == stem):
        try:
            if bool(node.is_loadable):
                return node
        except Exception:
            pass
    try:
        children = list(node.children or ())
    except Exception:
        return None
    for child in children:
        found = _walk_for_leaf(child, leaf, stem, depth + 1, max_depth)
        if found is not None:
            return found
    return None


def _safe(fn, default="?"):
    """Read a possibly-raising LOM attribute, returning ``default`` on error.

    Live's LOM raises assorted exception types on property access (e.g.
    ``gain`` on a MIDI clip); a probe must never let
    one bad read abort the whole readback.
    """
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 - probe wants any failure captured
        return "%s(%s)" % (default, type(e).__name__)


def _read_clip_metadata(clip):
    """Return a compact ``key=value`` string of the clip's warp/loop/gain/pitch.

    Reads defensively — each field is independently guarded so a clip that
    doesn't expose one attribute still reports the rest.
    """
    fields = []
    fields.append("is_audio=%s" % _safe(lambda: bool(clip.is_audio_clip)))
    fields.append("warping=%s" % _safe(lambda: bool(clip.warping)))
    fields.append("warp_mode=%s" % _safe(lambda: int(clip.warp_mode)))
    fields.append(
        "warp_markers=%s"
        % _safe(lambda: len(list(clip.warp_markers)))
    )
    fields.append("looping=%s" % _safe(lambda: bool(clip.looping)))
    fields.append("loop_start=%s" % _safe(lambda: round(float(clip.loop_start), 4)))
    fields.append("loop_end=%s" % _safe(lambda: round(float(clip.loop_end), 4)))
    fields.append("start_marker=%s" % _safe(lambda: round(float(clip.start_marker), 4)))
    fields.append("end_marker=%s" % _safe(lambda: round(float(clip.end_marker), 4)))
    fields.append("gain=%s" % _safe(lambda: round(float(clip.gain), 5)))
    fields.append("pitch_coarse=%s" % _safe(lambda: int(clip.pitch_coarse)))
    fields.append("pitch_fine=%s" % _safe(lambda: int(clip.pitch_fine)))
    fields.append("file_path=%s" % _safe(lambda: clip.file_path))
    return " ".join(fields)
