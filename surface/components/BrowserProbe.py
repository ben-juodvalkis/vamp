"""BrowserProbe — Gate 4a capability probe for ``Live.Browser``.

Purpose
-------

Gate 4a ([05-migration-plan.md §1], [06 §1.2]) asks: can the Python
Control Surface load each of the six asset classes we care about
(``.adv``, ``.adg``, ``.amxd``, AU, VST3, sample→Simpler) by driving
``Live.Application.get_application().browser`` directly? The spec
names ``load_item_at_path(p)`` as the mechanism, but neither
AbletonOSC nor the existing M4L observer actually calls
``Live.Browser`` — both go through Max's ``addfile`` indirection —
so the method's very existence on Live 12.3.x is an open question.

This component answers that question empirically. It is a throwaway
diagnostic, not part of the production address surface: there are
no Python callers outside the Gate 4a driver, and nothing in the
bridge's ``backendScope`` routes to its addresses. When Gate 4a
completes, the probe may be deleted or left in place as a
regression-catch for future Live upgrades — that decision belongs
to the session that closes out [06 §1.2].

Shape
-----

One OSC address, ``/looping/probe/browser_load [asset_class, hint]``,
routed to ``handle_browser_load``. The handler:

1. On the *first* call of each surface lifetime, dumps ``dir(browser)``
   to ``Log.txt`` at INFO. This is how we learn what the API actually
   exposes in this Live version without needing a second round-trip.
2. Snapshots the selected track's device chain by LOM id.
3. Resolves ``hint`` to a ``BrowserItem`` — first by trying
   ``browser.load_item_at_path(hint)`` if that method exists; otherwise
   by walking ``browser.<tree>.children`` and matching on the tail of
   ``hint``. The method-existence check is deliberate — the spec
   assumes a method that may not be there.
4. Calls ``browser.load_item(item)`` (or the path variant if present).
5. Schedules a delayed verification ~800ms later: compares device-chain
   ids, emits ``/looping/probe/browser_result [asset_class, ok, detail]``.
   800ms is chosen as the loose upper bound covering AU async-parameter
   population seen historically on this machine; real Live uses retries
   ``[400, 800, 1600]ms``, so 800ms catches .adv/.adg cleanly and
   gives AUs a reasonable first-look shot. The fuller timing study
   is Gate 4b's job, not ours.

The ``ok`` flag is a plain int (0 or 1) because
``python-osc``-style encoders handle bools inconsistently across
client and server sides, and int is the least surprising wire shape.

Injection points
----------------

Takes ``browser``, ``song``, ``emit``, and ``schedule_delayed`` at
construction so the unit tests can drive the whole flow against a
stub browser that mimics the real one's attribute grab-bag. The
``schedule_delayed(ms, fn)`` callable is
``ControlSurface.schedule_message`` in production (with a
tick-count conversion; one tick ≈ 100ms) and a direct synchronous
call in tests so assertions can be made in the same pytest frame.

Why not a ``pytest`` per asset class
------------------------------------

``Live`` is only importable inside Live's embedded Python, so a
"real" pytest cannot call ``browser.load_item`` at all. What pytest
*can* do is exercise the probe's scaffolding — argument parsing,
the ``dir`` fallback, the pre/post chain snapshot, the timeout
contract — against a stub. That is what
``tests/test_browser_probe.py`` does. The per-asset-class verdicts
come from a one-shot operator-driven session, captured in the log
and in [06 §1.2]'s table.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("looping")


# OSC addresses owned by this probe. Kept as module constants so the
# unit tests and the driver script can reference them without
# duplicating strings.
LOAD_ADDRESS = "/looping/probe/browser_load"
RESULT_ADDRESS = "/looping/probe/browser_result"

# Places-probe addresses (ROW 3 of 10-cleanup-plan.md): dump the
# ``browser.user_folders`` tree and optionally attempt a load from a
# Places leaf. Answers the question "can DeviceLoadComponent reach
# assets outside User Library so we can retire the M4L addfile route?"
PLACES_DUMP_ADDRESS = "/looping/probe/places_dump"
PLACES_DUMP_RESULT_ADDRESS = "/looping/probe/places_dump_result"
PLACES_LOAD_ADDRESS = "/looping/probe/places_load"
PLACES_LOAD_RESULT_ADDRESS = "/looping/probe/places_load_result"

# Verify delay, in milliseconds, between the load attempt and the
# device-chain diff. See module docstring for rationale.
DEFAULT_VERIFY_DELAY_MS = 800

# Places dump caps. User folders can be large (photo libraries etc.
# added by accident); we cap depth and per-node children so one bad
# Place doesn't wedge the tick or blow past darwin's 9216-byte UDP
# ceiling (see ``project_live_lom_quirks`` memory).
PLACES_MAX_DEPTH = 6
PLACES_MAX_CHILDREN_PER_NODE = 200

# Hard byte budget for the dump body before we truncate. darwin's
# UDP cap is 9216 bytes; the OSC envelope (address + type tags +
# three non-body args) adds ~80 bytes, plus padding. 7500 leaves
# generous headroom. Observed once in the wild: a 10-Place library
# overflowed at the default cap — see probe run on 2026-04-20.
PLACES_MAX_BODY_BYTES = 7500


class BrowserProbe:
    """Drives ``Live.Browser`` load attempts and emits verdicts.

    Args:
        browser: ``Live.Application.get_application().browser``. In
            tests, a stub that mimics the attribute grab-bag (see
            ``tests/test_browser_probe.py``).
        song: The Live ``Song``; used to read the selected track's
            device chain for the snapshot/diff.
        emit: Callable ``(address, args)`` bound to the transport's
            ``send``. Used to publish ``RESULT_ADDRESS``.
        schedule_delayed: Callable ``(delay_ms, fn)`` — in production
            bound to a small adapter around
            ``ControlSurface.schedule_message``; in tests, a direct
            synchronous call so the verification fires inline.
        verify_delay_ms: How long to wait after the load attempt
            before diffing the chain. See module docstring.
    """

    def __init__(
        self,
        browser,
        song,
        emit,
        schedule_delayed,
        verify_delay_ms: int = DEFAULT_VERIFY_DELAY_MS,
    ):
        self._browser = browser
        self._song = song
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        self._verify_delay_ms = verify_delay_ms
        self._dir_dumped = False

    # --- handler ----------------------------------------------------------

    def handle_browser_load(self, args, source_addr):
        """``/looping/probe/browser_load [asset_class, hint]`` entry point.

        ``asset_class`` is a free-form string the driver supplies —
        ``adv``, ``adg``, ``amxd``, ``au``, ``vst3``, ``sample`` —
        and comes back verbatim on the result message so the driver
        can correlate request to response. ``hint`` is either a
        filesystem path (User Library assets), a URI of the form
        ``query:Plugins#VST3:<id>`` (plugins), or a bare name for
        native devices. The probe tries the most specific resolution
        first and falls back as needed.
        """
        if len(args) < 2:
            logger.warning(
                "BrowserProbe: expected (asset_class, hint), got %r", args,
            )
            return None
        asset_class = str(args[0])
        hint = str(args[1])

        self._maybe_dump_browser_api()

        try:
            track = self._selected_track()
        except Exception as e:
            self._emit_result(asset_class, 0, "no_selected_track: %s" % e)
            return None

        # Snapshot the device chain by id. Comparing ids (not
        # indices) lets us detect insertion even if Live reorders
        # existing devices, which is the safe default; Live in
        # practice just appends to the end on a fresh load, but the
        # probe shouldn't depend on that.
        before_ids = _chain_device_ids(track)

        attempt_detail = self._attempt_load(hint)
        if attempt_detail.startswith("error:"):
            self._emit_result(asset_class, 0, attempt_detail)
            return None

        # Schedule the verification. The callback is a closure that
        # captures the snapshot so the diff is against the state at
        # call time, not at verify time.
        def _verify():
            self._verify_and_emit(asset_class, track, before_ids, attempt_detail)

        try:
            self._schedule_delayed(self._verify_delay_ms, _verify)
        except Exception as e:
            # If scheduling itself fails we want to know immediately
            # rather than hang the driver waiting for a result.
            self._emit_result(asset_class, 0, "schedule_failed: %s" % e)
        return None

    # --- internals --------------------------------------------------------

    def _maybe_dump_browser_api(self):
        """Log ``dir(browser)`` once, on first probe call.

        The first time we ask Live's embedded Python which attributes
        the Browser actually exposes, we want the full list — it's
        cheap and it's the authoritative answer to "does
        ``load_item_at_path`` exist here?". Subsequent calls are
        silent to avoid flooding Log.txt during the driver's six
        back-to-back probes.
        """
        if self._dir_dumped:
            return
        self._dir_dumped = True
        try:
            attrs = sorted(a for a in dir(self._browser) if not a.startswith("_"))
            logger.info("BrowserProbe: dir(browser) = %s", attrs)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("BrowserProbe: dir(browser) failed: %s", e)

    def _selected_track(self):
        """Return the currently-selected ``Track`` via ``song.view``."""
        view = self._song.view
        track = view.selected_track
        if track is None:
            raise RuntimeError("song.view.selected_track is None")
        return track

    def _attempt_load(self, hint):
        """Try the load. Returns a detail string starting with ``ok:`` or ``error:``.

        Resolution order:

        1. ``browser.load_item_at_path(hint)`` if the method exists —
           this is the spec's named mechanism and the cheapest case.
        2. Traversal: walk every public browser-tree attribute's
           ``.children`` recursively, match on ``.name`` equalling the
           tail of ``hint`` (filename or bare name), then call
           ``browser.load_item(item)``.

        Both branches catch exceptions broadly because ``Live`` raises
        a menagerie of types (``RuntimeError``, ``AttributeError``,
        ``Live.Base.LimitationError``, custom exceptions) and we want
        a single diagnostic string back either way.
        """
        method = getattr(self._browser, "load_item_at_path", None)
        if callable(method):
            try:
                method(hint)
                return "ok:load_item_at_path"
            except Exception as e:
                return "error:load_item_at_path: %s" % e

        # Fallback: traverse and load the matching item.
        try:
            item = self._find_item(hint)
        except Exception as e:
            return "error:traverse: %s" % e
        if item is None:
            return "error:not_found"

        loader = getattr(self._browser, "load_item", None)
        if not callable(loader):
            return "error:no_load_item_method"
        try:
            loader(item)
            return "ok:load_item via %r" % getattr(item, "name", "?")
        except Exception as e:
            return "error:load_item: %s" % e

    def _find_item(self, hint):
        """Best-effort search across the public browser trees for ``hint``.

        ``hint`` matches on equality of the last path component to
        ``BrowserItem.name``. Live's browser tree is deep and its
        names are often ambiguous (many items called "Default.adv"),
        so the driver should pass a hint narrow enough to match
        exactly one item on the first hit. Tie-break: depth-first
        traversal, first match wins.
        """
        target = hint.rsplit("/", 1)[-1]

        # Discover candidate roots. ``dir(browser)`` is the
        # authoritative list (12.3 adds / removes these over minor
        # versions), filtered to plausible tree entries. We prefer
        # explicit known names first so the search is deterministic
        # across Live versions where the attribute set grows.
        known = [
            "sounds", "drums", "instruments", "audio_effects",
            "midi_effects", "max_for_live", "plugins", "clips",
            "samples", "user_library", "current_project",
        ]
        roots = []
        for name in known:
            root = getattr(self._browser, name, None)
            if root is not None:
                roots.append(root)

        for root in roots:
            found = _walk_for_name(root, target)
            if found is not None:
                return found
        return None

    def _verify_and_emit(self, asset_class, track, before_ids, attempt_detail):
        """Diff the device chain and publish the result."""
        try:
            after_ids = _chain_device_ids(track)
        except Exception as e:
            # Chain became unreadable (track deleted mid-probe). Treat
            # as an inconclusive failure — detail string distinguishes
            # it from a silent-load failure so the log is clear.
            self._emit_result(asset_class, 0, "post_snapshot_failed: %s" % e)
            return

        new_ids = [d for d in after_ids if d not in before_ids]
        if len(new_ids) > 0:
            detail = "%s; added=%d" % (attempt_detail, len(new_ids))
            self._emit_result(asset_class, 1, detail)
        else:
            # The silent-failure case the risk doc names for VST3:
            # ``load_item`` returned without raising, but no device
            # appeared on the chain. Important signal — don't bury it.
            detail = "%s; chain_unchanged" % attempt_detail
            self._emit_result(asset_class, 0, detail)

    def _emit_result(self, asset_class, ok, detail):
        logger.info(
            "BrowserProbe result: class=%s ok=%d detail=%s",
            asset_class, ok, detail,
        )
        self._emit(RESULT_ADDRESS, (asset_class, int(ok), detail))

    # --- places probe -----------------------------------------------------

    def handle_places_dump(self, args, source_addr):
        """``/looping/probe/places_dump []`` — dump ``browser.user_folders``.

        Emits ``/looping/probe/places_dump_result [exists, top_count, json]``
        where ``json`` is a string-encoded tree (newline-separated
        ``depth\tname\tis_loadable`` rows). JSON-ish because darwin's
        9216-byte UDP ceiling makes a single blob safer than a flurry
        of per-node OSC messages, and the driver just prints it.

        If ``browser.user_folders`` is absent or not iterable, emits
        ``exists=0, top_count=0, json=""`` plus a reason on the detail
        line so the driver's output table reads cleanly.
        """
        # Go straight to the access — ``hasattr`` would swallow
        # ``AttributeError`` but not ``RuntimeError``, and Live's LOM
        # raises the latter on some properties (see
        # ``project_live_lom_quirks`` — ``master.mute`` is the canonical
        # example). A broad try/except is the only reliable gate.
        try:
            user_folders = self._browser.user_folders
        except AttributeError:
            self._emit_places_dump(0, 0, "", "no user_folders attr")
            return None
        except Exception as e:
            self._emit_places_dump(0, 0, "", "read_error: %s" % e)
            return None

        if user_folders is None:
            self._emit_places_dump(0, 0, "", "user_folders is None")
            return None

        try:
            tops = list(user_folders)
        except TypeError:
            # Some Live versions expose ``user_folders`` as an object
            # with ``.children`` rather than directly iterable.
            tops = list(getattr(user_folders, "children", ()) or ())
        except Exception as e:
            self._emit_places_dump(1, 0, "", "iter_error: %s" % e)
            return None

        rows = []
        truncated = False
        for top in tops:
            _collect_places_rows(top, depth=0, rows=rows)
            # Early-exit once we're over budget so a late Place can't
            # push an already-fat payload further over. The final body
            # is re-checked below after join.
            if _rows_byte_size(rows) > PLACES_MAX_BODY_BYTES:
                truncated = True
                break

        body = "\n".join(rows)
        if len(body.encode("utf-8", errors="replace")) > PLACES_MAX_BODY_BYTES:
            # Trim from the tail until we fit. Keeps the top-level
            # Place list intact (that's the most diagnostic bit) and
            # sacrifices deep children first.
            truncated = True
            while (
                rows
                and len("\n".join(rows).encode("utf-8", errors="replace"))
                > PLACES_MAX_BODY_BYTES
            ):
                rows.pop()
            body = "\n".join(rows)
            if body:
                body += "\n0\t...(truncated to fit UDP)\t0"

        detail = "truncated" if truncated else "ok"
        self._emit_places_dump(1, len(tops), body, detail)
        return None

    def handle_places_load(self, args, source_addr):
        """``/looping/probe/places_load [hint]`` — try to load from Places.

        Same verify contract as ``handle_browser_load`` but the
        traversal is restricted to ``browser.user_folders``. Answers
        ROW 4's question "does ``load_item`` work on a Places leaf the
        same as on a User Library leaf?" — if yes, we can teach
        ``DeviceLoadComponent`` to accept a second root and retire the
        M4L addfile route. If no, addfile stays.
        """
        if len(args) < 1:
            logger.warning(
                "BrowserProbe.places_load: expected (hint,), got %r", args,
            )
            return None
        hint = str(args[0])

        try:
            track = self._selected_track()
        except Exception as e:
            self._emit_places_load_result(0, "no_selected_track: %s" % e)
            return None

        before_ids = _chain_device_ids(track)

        item = _find_in_user_folders(self._browser, hint)
        if item is None:
            self._emit_places_load_result(0, "not_found in user_folders")
            return None

        loader = getattr(self._browser, "load_item", None)
        if not callable(loader):
            self._emit_places_load_result(0, "no_load_item_method")
            return None

        try:
            loader(item)
            attempt_detail = "ok:load_item via %r" % getattr(item, "name", "?")
        except Exception as e:
            self._emit_places_load_result(0, "load_item raised: %s" % e)
            return None

        def _verify():
            try:
                after_ids = _chain_device_ids(track)
            except Exception as e:
                self._emit_places_load_result(
                    0, "post_snapshot_failed: %s" % e,
                )
                return
            new_ids = [d for d in after_ids if d not in before_ids]
            if len(new_ids) > 0:
                self._emit_places_load_result(
                    1, "%s; added=%d" % (attempt_detail, len(new_ids)),
                )
            else:
                self._emit_places_load_result(
                    0, "%s; chain_unchanged" % attempt_detail,
                )

        try:
            self._schedule_delayed(self._verify_delay_ms, _verify)
        except Exception as e:
            self._emit_places_load_result(0, "schedule_failed: %s" % e)
        return None

    def _emit_places_dump(self, exists, top_count, body, detail):
        logger.info(
            "BrowserProbe places_dump: exists=%d top=%d detail=%s",
            exists, top_count, detail,
        )
        self._emit(
            PLACES_DUMP_RESULT_ADDRESS,
            (int(exists), int(top_count), body, detail),
        )

    def _emit_places_load_result(self, ok, detail):
        logger.info(
            "BrowserProbe places_load: ok=%d detail=%s", ok, detail,
        )
        self._emit(PLACES_LOAD_RESULT_ADDRESS, (int(ok), detail))


# --- helpers -------------------------------------------------------------


def _chain_device_ids(track):
    """Return a tuple of ``.id`` ints for every device on the track's chain.

    LOM ids are stable across renames/reorders, which is why the
    probe compares them instead of indices. ``int(...)`` coerces
    the LOM-native ``PyObjectId`` handle to a plain int so the
    snapshot survives being closed over by the delayed verify
    callback.
    """
    devices = getattr(track, "devices", ()) or ()
    return tuple(int(getattr(d, "_live_ptr", None) or id(d)) for d in devices)


def _walk_for_name(item, target_name, depth=0, max_depth=8):
    """Depth-first search for a ``BrowserItem`` matching ``target_name``.

    Match is against ``item.name`` either exactly or after stripping a
    single trailing extension. Live's Browser strips extensions for
    presentation on some trees (e.g., ``.amxd`` shows as the bare
    device name under ``max_for_live``, not as ``Foo.amxd``) but
    preserves them on others (``.adv``, ``.adg`` appear with the
    extension intact). Accepting both forms at the matcher lets the
    driver's hints stay as filesystem-accurate paths without the
    driver needing to know Live's display convention per-tree.

    ``max_depth`` guards against cycles — Live's browser isn't
    truly cyclic but some virtual roots can be deeply nested
    (particularly user libraries with many symlinks), and we'd
    rather truncate than hang the tick. 8 is a generous upper bound
    for the actual tree depth in practice; adjust if we ever find a
    real asset deeper than that.
    """
    if depth > max_depth:
        return None
    # Match before descending so the first hit wins deterministically.
    name = getattr(item, "name", None)
    if name == target_name:
        return item
    if name is not None:
        # Case A: target is a filesystem name with an extension; Live
        # shows the stem. ``Audio Interface Detectors.amxd`` → match
        # on ``Audio Interface Detectors``.
        if target_name.rsplit(".", 1)[0] == name:
            return item
        # Case B: target is a bare stem; Live shows the filename with
        # extension. ``Operator`` → match ``Operator.adv`` (rare but
        # cheap to cover).
        if name.rsplit(".", 1)[0] == target_name:
            return item
    children = getattr(item, "children", ()) or ()
    for child in children:
        found = _walk_for_name(child, target_name, depth + 1, max_depth)
        if found is not None:
            return found
    return None


def _collect_places_rows(item, depth, rows):
    """Flatten a ``user_folders`` subtree into ``depth\tname\tloadable`` rows.

    Caps are enforced here (not at the caller) so every recursion
    path honours them identically. Truncation adds a ``...`` marker
    row so the driver's output makes the cap visible rather than
    silently dropping children.
    """
    if depth > PLACES_MAX_DEPTH:
        rows.append("%d\t...\t0" % depth)
        return
    name = getattr(item, "name", "?") or "?"
    is_loadable = 1 if getattr(item, "is_loadable", False) else 0
    # Tab-separated so embedded spaces in Place names survive; strip
    # tabs from the name defensively.
    safe_name = str(name).replace("\t", " ").replace("\n", " ")
    rows.append("%d\t%s\t%d" % (depth, safe_name, is_loadable))

    children = getattr(item, "children", ()) or ()
    shown = 0
    for child in children:
        if shown >= PLACES_MAX_CHILDREN_PER_NODE:
            rows.append("%d\t... (%d more)\t0" % (
                depth + 1,
                max(0, len(list(children)) - shown),
            ))
            break
        _collect_places_rows(child, depth + 1, rows)
        shown += 1


def _rows_byte_size(rows):
    """Estimate the UTF-8 byte size of ``\n``-joined rows."""
    # Approximate — joining with ``\n`` adds one byte per gap, not
    # per row; close enough to trigger truncation early rather than
    # late.
    return sum(len(r.encode("utf-8", errors="replace")) + 1 for r in rows)


def _find_in_user_folders(browser, hint):
    """Find a ``BrowserItem`` in ``browser.user_folders`` by tail-of-path name.

    Mirrors ``_find_item`` but scoped to Places only. Returns ``None``
    if ``user_folders`` is missing or the name is not found.
    """
    user_folders = getattr(browser, "user_folders", None)
    if user_folders is None:
        return None
    try:
        tops = list(user_folders)
    except TypeError:
        tops = list(getattr(user_folders, "children", ()) or ())
    except Exception:
        return None

    target = hint.rsplit("/", 1)[-1]
    for top in tops:
        found = _walk_for_name(top, target)
        if found is not None:
            return found
    return None
