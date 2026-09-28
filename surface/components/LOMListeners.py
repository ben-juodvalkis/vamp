"""LOMListeners — LOM listener bookkeeper for the v2 + v3 surface.

Owns the LOM listener attachments that drive structural-change
republish and per-event mutation fires. Per Phase 1 Commit A of the
v3 migration ([05 §1.1.A](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/05-migration-plan.md#11a-commit-a--registry-forward-map-retirement))
this class is a strict bookkeeper:

- It attaches and tears down ``song.tracks`` / per-track ``devices``
  / per-param ``value`` listeners.
- It fans LOM events out through plain callables installed by the
  surface (``on_structural_change``, ``on_device_added``,
  ``on_device_removed``, ``on_param_value_changed``).
- It exposes a single resolve method, ``track_id_for(track)``, used
  by ``MutationComponent`` to translate a ``Track`` object into the
  v2 wire id (master sentinel ``-1`` or masked ``_live_ptr``).

What it does NOT do:

- No ``resolve_param`` / ``resolve_legacy_param`` / ``device_params``.
  The forward-map resolve surface PR-4g had walked on demand is now
  inlined into the v2 handlers in ``DevicesComponent`` (one O(song)
  walk per ``/looping/v2/param/set``, sub-millisecond at session
  scale). See [05 §1.1.A](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/05-migration-plan.md#11a-commit-a--registry-forward-map-retirement)
  for rationale.
- No pid → object map of any kind. The wire pid is still
  ``_safe_int_id(parameter)`` for the v2 echo address; it is
  computed at fire time from the parameter the listener closure
  already holds, not looked up.

Why the rename
--------------

PR-4g had already retired the cached forward maps in favour of an
on-demand LOM walk; what survived under the ``HandleRegistry`` name
was a listener bookkeeper plus three convenience walk methods. The
class never *was* a registry after PR-4g — it was a class with three
walk-shaped methods named ``resolve_*``. v3's contract is path-keyed,
not pid-keyed; the resolve methods are now redundant against the
inline walks v2 callers do for themselves and against the v3 path
resolver Commit B will add.

Renaming to ``LOMListeners`` reflects what's left: listener
attach/detach lifecycle and the structural-change callback that the
state publisher hangs off of.

Listener lifecycle
------------------

- ``song.tracks`` listener — fires ``_on_tracks_changed`` which
  diffs the before/after track set, (re-)attaches per-track
  device-listeners, detaches anything that left, and fires the
  structural-change callback for the tree publisher.
- per-track ``devices`` listener — fires ``_on_track_devices_changed``
  which diffs the device set (fires ``on_device_added`` /
  ``on_device_removed``), attaches/detaches per-param
  ``value_listener``, and fires the structural-change callback.
- per-param ``value`` listener — fires ``on_param_value_changed``
  (the mutation callback). The listener closure captures
  ``(parameter, canonical_path)``; v3 echoes use ``canonical_path``
  directly, v2 echoes derive the pid from the parameter at fire
  time via ``_safe_int_id``.
- per-device ``parameters`` and ``name`` listeners on every top-level
  device — both fire the structural-change callback. ``parameters``
  catches a plug-in whose list grows after insertion; ``name`` catches
  a device renamed in place, which the ``devices`` listener never
  reports: a preset loaded onto a device of its own class, and Live's
  undo or redo of that load (ADR-439 addendum).

Listener bookkeeping maps (``_track_device_listeners``,
``_param_value_listeners``, ``_device_parameters_listeners`` and
``_device_name_listeners``) exist so teardown is correct — detach
every listener we attached. They are NOT resolve maps; the wire
contract never reads them.

Canonical paths captured at attach
----------------------------------

When ``_attach_value_listeners_for_device`` walks a device, it knows
the owning ``Track`` and the device's chain index, so it can compute
``canonical_path`` for each parameter once and capture it in the
listener closure. The path string follows
[04-wire-protocol.md §2.2](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#22-grammar):

- ``master/devices/<D>/params/<P>`` for master-track params,
- ``tracks/<T>/devices/<D>/params/<P>`` for regular tracks.

Returns and rack chains are not addressable in Phase 1; callers
expecting them get ``path-not-supported`` from the v3 path resolver
Commit B will add — they never reach this listener layer.

Stale-handle behaviour
----------------------

This class no longer has any "resolve" entry point that can return
``None`` for a stale id. v2 stale-handle errors come from the inline
walk in ``DevicesComponent`` — same wire contract, different code
location.
"""

from __future__ import annotations

import logging
from typing import Callable, Iterator, Optional, Tuple

# Surface profiler. Hooks are no-ops unless LOOPING_SURFACE_PROFILE=1.
try:
    from .. import perf_profiler
except ImportError:
    import perf_profiler  # type: ignore[no-redef]

logger = logging.getLogger("looping")


# Wire sentinel for the master track, per [04-wire-protocol.md §2].
# The bridge and UI send -1 for any /looping/v2/* address that targets
# the master track; mutation emits map ``song.master_track`` back to ``-1``.
MASTER_TRACK_ID = -1


class LOMListeners:
    """LOM listener bookkeeper for the v2 + v3 surface.

    Args:
        song: The Live ``Song`` object. Must expose ``.tracks`` (list of
            ``Track``), ``.master_track`` (a ``Track``), and the
            ``add_tracks_listener`` / ``remove_tracks_listener`` pair.
            Each ``Track`` must expose ``.devices`` plus
            ``add_devices_listener`` / ``remove_devices_listener``. Each
            ``Device`` must expose ``.parameters`` (list of
            ``DeviceParameter``), each of which has ``.id`` (or
            ``_live_ptr``) and a ``.value`` attribute plus the
            ``add_value_listener`` / ``remove_value_listener`` pair.

    Construction attaches the root ``song.tracks`` listener, then walks
    the current tree once to attach per-track device-listeners and
    per-param value-listeners.

    Lifecycle:
        ``__init__`` attaches. ``disconnect`` detaches everything
        (root + per-track + per-param). Idempotent.
    """

    def __init__(
        self,
        song,
        on_structural_change: Optional[Callable[[], None]] = None,
        on_device_added: Optional[Callable[[object, object, int], None]] = None,
        on_device_removed: Optional[Callable[[object, int], None]] = None,
        on_param_value_changed: Optional[
            Callable[[object, str], None]
        ] = None,
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
    ):
        self._song = song
        self._disconnected = False

        # Delayed-scheduler adapter. ``LoopingSurface`` passes
        # ``self._schedule_delayed`` — a thin wrapper around
        # ``ControlSurface.schedule_message(ticks, fn)`` — so that the
        # post-device-add reconciler (below) can fire on Live's main
        # tick without this class needing to know Live's tick math. In
        # tests we inject a manual scheduler that records pending
        # callbacks and fires them on demand. ``None`` disables the
        # delayed reconciler (e.g., unit tests that don't care about
        # post-hydration rebinds).
        self._schedule_delayed = schedule_delayed

        # Current-epoch map for the delayed post-add reconciler. Each
        # ``_on_track_devices_changed`` device-add bumps a global
        # monotonic counter, stores it against ``id(device)``, and
        # captures the same counter in the scheduled closure. When the
        # closure fires it only acts if its captured epoch still equals
        # what's stored for that device — so a racing re-add of the
        # same Python object invalidates earlier pending reconcilers.
        #
        # Keeping a *monotonic* counter (not per-device increments)
        # matters: when a device is removed the entry is cleared, and
        # a subsequent re-add must not reuse the same epoch value as
        # the stale pending closure. Per-device-counter would roll
        # back to 1 on clear-and-readd and the earlier reconciler's
        # epoch check would spuriously match.
        self._post_add_reconciler_epochs: dict[int, int] = {}
        self._post_add_epoch_counter: int = 0

        # Snapshot of param count captured at device-add time, keyed by
        # ``id(device)``. The delayed reconciler compares the
        # post-hydration count against this snapshot; only fires
        # structural-change on a genuine increase.
        self._post_add_param_count_snapshot: dict[int, int] = {}

        # Structural-change callback. Fires on ``_on_tracks_changed``
        # and on any per-track ``_on_track_devices_changed``.
        #
        # Installed either through this constructor arg (preferred for
        # tests) or post-hoc via ``set_on_structural_change`` (used by
        # ``LoopingSurface`` because ``StateFullComponent`` is built
        # after the listeners). Stays ``None`` during ``__init__`` so
        # the initial walk does not fire — that initial republish is
        # handled by ``StateFullComponent.emit_on_init`` at a
        # well-defined point in surface bring-up.
        self._on_structural_change = on_structural_change

        # Mutation callbacks. Each listener closure reads these at fire
        # time, so installing them post-construction via
        # ``set_mutation_callbacks`` also works without re-attaching
        # any listener.
        #
        # - ``on_device_added(track, device, chain_idx)`` — fires once
        #   per device inserted into a chain.
        # - ``on_device_removed(track, device_id)`` — fires once per
        #   device leaving a chain. ``device_id`` is the masked
        #   ``_live_ptr`` we captured before the device went away.
        # - ``on_param_value_changed(parameter, canonical_path)`` —
        #   fires on every parameter ``value_changed``. Signature
        #   changed in Commit A from the legacy
        #   ``(param_id, parameter)`` shape: v3 echoes use the captured
        #   path directly; v2 echoes derive the pid via
        #   ``_safe_int_id(parameter)`` at fire time. See
        #   [03 §6.1](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/03-target-architecture.md).
        self._on_device_added = on_device_added
        self._on_device_removed = on_device_removed
        self._on_param_value_changed = on_param_value_changed

        # Listener bookkeeping — NOT a resolve cache. These exist so
        # ``disconnect`` can detach every listener we attached and so
        # ``_on_track_devices_changed`` can diff before/after device
        # sets. They are populated from LOM walks and discarded on
        # teardown; no handler ever reads them to answer a wire query.

        # Per-track devices-listener. Key is ``id(track)`` (Python
        # identity, not LOM id) because the detach needs the exact
        # callback reference we attached and the Track object is what
        # we own a listener on.
        self._track_device_listeners: dict[int, Tuple[object, Callable]] = {}

        # Last-seen device wire-ids per track, keyed by ``id(track)``.
        # Populated during the initial walk and on every per-track
        # devices change; used to diff add/remove events.
        self._last_device_ids_per_track: dict[int, set[int]] = {}

        # Per-param value-listener bookkeeping. Key is the masked
        # ``_live_ptr`` (the wire pid). Value is
        # ``(parameter, callback)`` — detach goes through the
        # parameter's ``remove_value_listener``. Pid keying is an
        # implementation detail (the spec is silent on listener-map
        # keys); it stays because detach-by-id on device teardown is
        # O(1) and the listener closure itself captures both the
        # parameter and the canonical_path, so no fire-time lookup
        # goes through this dict.
        self._param_value_listeners: dict[int, Tuple[object, Callable]] = {}
        # Canonical path per bound parameter id, read at FIRE time rather
        # than captured at bind time. Canonical paths embed positional
        # indices (``tracks/<N>/devices/<C>/params/<P>``), so a track
        # insert, delete or drag-reorder invalidates every path at or
        # below the moved index — and Live fires ``tracks_changed`` for
        # all three. Same reasoning as the wire pid, which
        # ``_bind_param_value_listener`` already recomputes rather than
        # captures. Kept in step by ``recompute_param_paths``.
        self._param_paths: dict[int, str] = {}

        # Per-device parameters-list listener bookkeeping. Key is
        # ``id(device)``; value is ``(device, callback)``.
        #
        # Why this exists: plugin devices (``AuPluginDevice`` /
        # ``PluginDevice``) populate ``device.parameters`` lazily. When
        # Live first inserts a plugin into a track, ``device.parameters``
        # returns just the generic ``[Device On]`` toggle — the plugin
        # itself is still booting. Seconds later, once the plugin
        # finishes hydrating and its Configure state attaches, the
        # parameter list grows to the full mapped set (20+ for
        # Omnisphere with macros exposed). The LOM fires a
        # ``parameters`` observation when that happens, but only if
        # someone is listening.
        #
        # We attach a lightweight listener per device whose only job is
        # to call ``_on_structural_change`` (same callback
        # ``_on_track_devices_changed`` uses). That re-emits
        # ``state/full`` so the UI tree grows the missing param entries
        # without requiring a hard refresh. Symmetric detach happens in
        # ``_detach_param_listeners_for_device_ids`` via the same pid
        # walk that drops value-listeners.
        self._device_parameters_listeners: dict[
            int, Tuple[object, Callable]
        ] = {}

        # Per-device ``name`` listener bookkeeping, for the same top-level
        # devices. Keyed by the device's wire id (``_safe_int_id``), not
        # ``id(device)``: a walk may hand back a fresh wrapper for a device
        # already listened to, and a second listener would fire the
        # structural change twice per rename. Value is ``(device, callback)``;
        # see ``_bind_device_name_listener``.
        self._device_name_listeners: dict[int, Tuple[object, Callable]] = {}

        # Attach the root listener, then walk the tree once to install
        # per-track and per-param listeners. Don't fire the
        # structural-change callback — that's
        # ``StateFullComponent.emit_on_init``'s job.
        add_tracks_listener = getattr(self._song, "add_tracks_listener", None)
        if callable(add_tracks_listener):
            try:
                add_tracks_listener(self._on_tracks_changed)
            except Exception as e:
                logger.warning(
                    "LOMListeners: add_tracks_listener failed: %s", e,
                )

        self._bind_all_tracks()
        logger.info(
            "LOMListeners ready: %d tracks observed, "
            "%d param-value listeners attached",
            len(self._track_device_listeners),
            len(self._param_value_listeners),
        )

    # --- walk helpers -----------------------------------------------------
    #
    # These are NOT a forward-map resolve surface. They are on-demand
    # LOM walks kept here for the ``DebugComponent`` diagnostic probes
    # (which introspect the listener state live in Log.txt) and for
    # unit tests that need to assert walk behaviour. The v2 wire path
    # does its own inline walks in ``DevicesComponent``; nothing on
    # the hot path goes through these methods.

    def resolve_track(self, track_id: int) -> Optional[object]:
        """Return the ``Track`` for a ``track_id``, or ``None``.

        ``track_id == -1`` is the wire sentinel for the master track.
        """
        try:
            tid = int(track_id)
        except (TypeError, ValueError):
            return None
        if self._disconnected:
            return None
        if tid == MASTER_TRACK_ID:
            return self._safe_master_track()
        for track in self._iter_regular_tracks():
            if _safe_int_id(track) == tid:
                return track
        return None

    def resolve_device(
        self, device_id: int,
    ) -> Optional[Tuple[object, object, int]]:
        """Return ``(track, device, chain_index)`` for a ``device_id``."""
        try:
            did = int(device_id)
        except (TypeError, ValueError):
            return None
        if self._disconnected:
            return None
        for track in self._iter_all_tracks():
            for chain_idx, device in enumerate(self._safe_devices(track)):
                if _safe_int_id(device) == did:
                    return track, device, chain_idx
        return None

    # --- track-id reverse lookup ------------------------------------------

    def track_id_for(self, track) -> Optional[int]:
        """Return the wire ``track_id`` for a ``Track`` object.

        ``-1`` for the master track sentinel; masked ``_live_ptr`` for
        regular tracks. Returns ``None`` if the track isn't reachable
        from ``song.master_track`` / ``song.tracks`` (either a genuine
        bug — listener fired on a dropped track — or a racing
        disconnect).

        Used by ``MutationComponent`` when the LOM hands it a
        ``Track`` pointer and it needs the wire id for the emit
        address.
        """
        if self._disconnected or track is None:
            return None
        master = self._safe_master_track()
        if master is not None and _same_lom_track(track, master):
            return MASTER_TRACK_ID
        tid = _safe_int_id(track)
        if tid is None:
            return None
        for t in self._iter_regular_tracks():
            if _same_lom_track(t, track):
                return _safe_int_id(t)
        return None

    # --- diagnostics ------------------------------------------------------
    #
    # The ``track_count`` / ``device_count`` / ``param_count`` properties
    # exist so ``DebugComponent``'s ``registry/dump`` and
    # ``registry/probe_resolve`` reply shapes stay wire-compatible.
    # They compute via a single fresh walk — there is no stored map.

    @property
    def track_count(self) -> int:
        count = 0
        if self._safe_master_track() is not None:
            count += 1
        for _ in self._iter_regular_tracks():
            count += 1
        return count

    @property
    def device_count(self) -> int:
        count = 0
        for track in self._iter_all_tracks():
            count += sum(1 for _ in self._safe_devices(track))
        return count

    @property
    def param_count(self) -> int:
        count = 0
        for track in self._iter_all_tracks():
            for device in self._safe_devices(track):
                count += sum(1 for _ in self._safe_params(device))
        return count

    def dump_state(self) -> dict:
        """Return the canonical walk counts under the legacy dump keys.

        The reply shape (``tracks``, ``devices``, ``params``,
        ``fresh_tracks``, ``fresh_devices``, ``fresh_params``) came
        from an era where stored vs. fresh could legitimately diverge.
        They never diverge in walk mode — we report the walk counts
        under both sets of keys so the DebugComponent reply wire shape
        is unchanged.
        """
        fresh_tracks = self.track_count
        fresh_devices = self.device_count
        fresh_params = self.param_count
        return {
            "tracks": fresh_tracks,
            "devices": fresh_devices,
            "params": fresh_params,
            "fresh_tracks": fresh_tracks,
            "fresh_devices": fresh_devices,
            "fresh_params": fresh_params,
        }

    # --- post-construction callback installation -------------------------

    def set_on_structural_change(
        self, callback: Optional[Callable[[], None]],
    ) -> None:
        """Install / replace the structural-change callback.

        Called by ``LoopingSurface.__init__`` after
        ``StateFullComponent`` construction so the initial walk
        (which happens in ``__init__``) does not fire on an object
        that doesn't exist yet. ``None`` detaches.
        """
        self._on_structural_change = callback

    def set_mutation_callbacks(
        self,
        on_device_added: Optional[Callable[[object, object, int], None]] = None,
        on_device_removed: Optional[Callable[[object, int], None]] = None,
        on_param_value_changed: Optional[
            Callable[[object, str], None]
        ] = None,
    ) -> None:
        """Install / replace the mutation callbacks.

        Called by ``LoopingSurface.__init__`` after
        ``MutationComponent`` construction. The listener closures
        installed during ``__init__`` read ``self._on_param_value_changed``
        at fire time, so installing the callback after the fact takes
        effect on the next LOM fire without any re-attach.

        ``on_param_value_changed`` signature:
        ``(parameter, canonical_path)`` per Commit A. v2 echoes derive
        the pid from ``parameter`` at fire time; v3 echoes use
        ``canonical_path`` directly.
        """
        self._on_device_added = on_device_added
        self._on_device_removed = on_device_removed
        self._on_param_value_changed = on_param_value_changed

    # --- LOM listener plumbing --------------------------------------------

    def _on_tracks_changed(self) -> None:
        """Root ``song.tracks`` listener.

        Re-attaches per-track device-listeners for the current track
        set, detaching anything that left. Fires the
        structural-change callback so the state publisher republishes
        the tree.
        """
        if self._disconnected:
            return
        perf_profiler.record_listener_fire("tracks_changed")

        # Track order may have changed under every bound listener.
        self.recompute_param_paths()

        # Snapshot the current set of tracks (master + regulars). Key
        # by ``id(track)`` — Python identity, which is what
        # ``_track_device_listeners`` / ``_last_device_ids_per_track``
        # key on.
        current_tracks = list(self._iter_all_tracks())
        current_ids = {id(t) for t in current_tracks}

        # Detach listeners for tracks that are no longer present.
        departed = [
            tkey for tkey in list(self._track_device_listeners.keys())
            if tkey not in current_ids
        ]
        for tkey in departed:
            track, cb = self._track_device_listeners.pop(tkey)
            remove = getattr(track, "remove_devices_listener", None)
            if callable(remove):
                try:
                    remove(cb)
                except Exception as e:
                    if _is_stale_handle_error(e):
                        # Live tears the C++ slot down before the Python
                        # proxy leaves ``song.tracks``; the detach call
                        # then raises ``Boost.Python.ArgumentError``
                        # ("did not match C++ signature"). Log noise
                        # only — the listener slot is already gone, so
                        # there's nothing to clean up beyond our own
                        # bookkeeping (already popped above). See
                        # deferred-issues.md 2026-04-17 entry.
                        logger.debug(
                            "LOMListeners: remove_devices_listener "
                            "skipped for stale track %r (already torn "
                            "down)", track,
                        )
                    else:
                        logger.warning(
                            "LOMListeners: devices detach failed for "
                            "departed track %r: %s", track, e,
                        )
            # Detach any param listeners owned by the departed track's
            # devices. We fall back to the bookkeeping map: any param
            # pid whose owning track is gone needs its listener
            # detached before the dict entry is dropped.
            last_pids = self._last_device_ids_per_track.pop(tkey, set())
            self._detach_param_listeners_for_device_ids(last_pids, track=None)

        # Attach listeners for any new track.
        for track in current_tracks:
            if id(track) not in self._track_device_listeners:
                self._bind_track(track, fire_added_for_existing=False)

        if self._on_structural_change is not None:
            try:
                self._on_structural_change()
            except Exception as e:
                logger.error(
                    "LOMListeners: on_structural_change raised: %s",
                    e, exc_info=True,
                )

    def _bind_all_tracks(self) -> None:
        """Initial walk: attach devices-listeners + param value-listeners.

        Called once from ``__init__``. Does not fire
        ``on_structural_change`` (that's the caller's job after the
        state publisher exists) and does not fire
        ``on_device_added`` (this is the initial population, not a
        delta).
        """
        for track in self._iter_all_tracks():
            self._bind_track(track, fire_added_for_existing=False)

    def _bind_track(self, track, fire_added_for_existing: bool) -> None:
        """Attach a devices-listener to ``track`` + value-listeners on params.

        ``fire_added_for_existing`` controls whether the currently-
        present devices on the track fire ``on_device_added`` as they
        get bound. ``False`` for the initial ``__init__`` walk and for
        newly-observed tracks in ``_on_tracks_changed`` (both are
        "initial population for this track"). The per-track device
        diff happens in ``_on_track_devices_changed``.
        """
        add_devices_listener = getattr(track, "add_devices_listener", None)
        if callable(add_devices_listener):
            def _on_this_track_devices(t=track):
                if self._disconnected:
                    return
                self._on_track_devices_changed(t)
            try:
                add_devices_listener(_on_this_track_devices)
            except Exception as e:
                logger.warning(
                    "LOMListeners: add_devices_listener failed for %r: %s",
                    track, e,
                )
            else:
                self._track_device_listeners[id(track)] = (
                    track, _on_this_track_devices,
                )

        # Walk the current devices, attach param value-listeners, seed
        # the per-track device-id bookkeeping. Compute canonical_path
        # per param at attach time and capture it in the listener
        # closure — see _bind_param_value_listener.
        device_ids: set[int] = set()
        for chain_idx, device in enumerate(self._safe_devices(track)):
            did = _safe_int_id(device)
            if did is None:
                continue
            device_ids.add(did)
            self._attach_value_listeners_for_device(
                track=track, device=device, chain_idx=chain_idx,
            )
            # Schedule a post-init reconciler for every existing-at-startup
            # device too. MxDevice (Max-for-Live) and PluginDevice both
            # hydrate their `live.*` / VST parameter lists asynchronously
            # after Live inserts them. For devices present at LoopingSurface
            # startup we never got an ``on_device_added`` event, so without
            # this the reconciler never ran and only `[0] Device On` had
            # a value-listener attached.
            self._schedule_post_add_reconciler(track, device)
            if fire_added_for_existing and self._on_device_added is not None:
                try:
                    self._on_device_added(track, device, chain_idx)
                except Exception as e:
                    logger.error(
                        "LOMListeners: on_device_added raised for "
                        "device=%r: %s", device, e, exc_info=True,
                    )
        self._last_device_ids_per_track[id(track)] = device_ids

    def _on_track_devices_changed(self, track) -> None:
        """Per-track ``devices`` listener.

        Diffs the before/after device set, fires
        ``on_device_added`` / ``on_device_removed`` for the delta,
        attaches/detaches value-listeners, fires structural-change.
        """
        if self._disconnected:
            return
        perf_profiler.record_listener_fire("track:devices")

        # Chain order may have changed under this track's listeners.
        self.recompute_param_paths()

        before_ids = self._last_device_ids_per_track.get(
            id(track), set(),
        )
        devices_now = list(self._safe_devices(track))
        after_ids: set[int] = set()
        added_events: list[Tuple[object, int]] = []

        for chain_idx, device in enumerate(devices_now):
            did = _safe_int_id(device)
            if did is None:
                continue
            after_ids.add(did)
            if did not in before_ids:
                self._attach_value_listeners_for_device(
                    track=track, device=device, chain_idx=chain_idx,
                )
                added_events.append((device, chain_idx))

        removed_ids = before_ids - after_ids

        # Detach value-listeners for params belonging to removed
        # devices. The value-listener bookkeeping is keyed by pid, not
        # device, and the listener closure captures its own
        # ``parameter``. So the detach works from the pid → (param,
        # cb) map directly; we just need to know *which* pids to drop.
        # We re-derive that by walking the after-set params and
        # subtracting: any pid we're holding a listener for whose
        # owning device just disappeared is a pid we need to drop.
        self._detach_param_listeners_for_device_ids(removed_ids, track=track)

        # Drop post-add reconciler bookkeeping for any device that's
        # no longer present. The epoch-guard in the scheduled callback
        # protects correctness (a stale callback finds no matching
        # epoch and no-ops); this just keeps the maps from growing
        # unbounded on long-running sessions with frequent swaps.
        live_device_keys = {id(d) for d in devices_now}
        for dkey in list(self._post_add_reconciler_epochs.keys()):
            if dkey not in live_device_keys:
                self._post_add_reconciler_epochs.pop(dkey, None)
                self._post_add_param_count_snapshot.pop(dkey, None)

        self._last_device_ids_per_track[id(track)] = after_ids

        # Fire remove then add so a device *swap* — same slot, same
        # chain_idx — is observed as "old gone, new arrived" rather
        # than as a contradiction on the UI side.
        if self._on_device_removed is not None:
            for did in removed_ids:
                try:
                    self._on_device_removed(track, int(did))
                except Exception as e:
                    logger.error(
                        "LOMListeners: on_device_removed raised for "
                        "device_id=%d: %s", did, e, exc_info=True,
                    )
        if self._on_device_added is not None:
            for device, chain_idx in added_events:
                try:
                    self._on_device_added(track, device, chain_idx)
                except Exception as e:
                    logger.error(
                        "LOMListeners: on_device_added raised for "
                        "device=%r: %s", device, e, exc_info=True,
                    )

        # Plugin-hydration reconciler: for every newly-inserted device,
        # schedule a delayed check that fires a structural-change if
        # the device's parameter list grew after the add event. The
        # existing ``add_parameters_listener`` path *should* cover
        # this, but in Live 12.3.x AU plugins like Omnisphere do not
        # reliably fire that observation on post-insertion hydration —
        # see ADR-004. A single poll at +750ms catches them without
        # needing to listen to the clock.
        for device, _chain_idx in added_events:
            self._schedule_post_add_reconciler(track, device)

        # Structural change — fire even on a no-op devices_changed
        # because LOM fires this listener for chain reorders (chain
        # index changes) as well as inserts/removals.
        if self._on_structural_change is not None:
            try:
                self._on_structural_change()
            except Exception as e:
                logger.error(
                    "LOMListeners: on_structural_change raised: %s",
                    e, exc_info=True,
                )

    def _attach_value_listeners_for_device(
        self, track, device, chain_idx: int,
    ) -> None:
        """Attach ``add_value_listener`` to each of a device's parameters.

        Computes the canonical path for each parameter once at
        attach time and captures it in the listener closure, so v3
        echoes have the path without a fire-time walk and v2 echoes
        derive the pid from the parameter directly.

        Idempotent on re-bind via the pid-keyed bookkeeping map.
        No-op if a value-listener is already attached for that pid.

        Also attaches a ``parameters`` observation on the device
        itself (``_bind_device_parameters_listener``) — load-bearing
        for plugin devices whose parameter list grows after insertion.
        """
        track_segment = self._track_segment_for(track)
        if track_segment is None:
            # Track no longer reachable from song.master_track /
            # song.tracks — a racing detach. The path would be
            # meaningless; skip the attach. The next structural-change
            # fire will reconcile.
            logger.warning(
                "LOMListeners: cannot compute canonical path for device on "
                "unreachable track %r; skipping value-listener attach", track,
            )
            return
        for param_idx, param in enumerate(self._safe_params(device)):
            pid = _safe_int_id(param)
            if pid is None:
                continue
            if pid in self._param_value_listeners:
                continue
            canonical_path = "%s/devices/%d/params/%d" % (
                track_segment, chain_idx, param_idx,
            )
            self._bind_param_value_listener(pid, param, canonical_path)

        # Watch for the parameter list itself changing. On plugin
        # devices this fires seconds after insertion as the VST/AU
        # finishes booting and Live attaches the Configure mapping —
        # see the block comment on ``_device_parameters_listeners``
        # above. No-op if already attached for this device.
        self._bind_device_parameters_listener(device)

        # And for the device being renamed in place, a structural change
        # the ``devices`` listener never reports — see
        # ``_bind_device_name_listener``.
        self._bind_device_name_listener(device)

    def _schedule_post_add_reconciler(self, track, device) -> None:
        """Schedule a +750ms param-count reconcile for a newly-inserted device.

        Captures ``len(device.parameters)`` at add-time and schedules
        a callback that re-reads it after the plugin has had time to
        finish booting. When the count grew, we re-bind value-listeners
        (so the new params echo) and fire ``on_structural_change`` (so
        the UI tree grows).

        Why 750ms: empirically Omnisphere finishes exposing its mapped
        parameter list within ~300-500ms after Live inserts it; 750ms
        buys a comfortable margin without being long enough for the
        user to notice a delay in the UI's param appearance.

        Epoch-guarded: if the same Python device object churns through
        add/remove/add before the delayed callback fires, only the
        most recent scheduling actually runs; earlier ones see a stale
        epoch and no-op. Prevents a flurry of state/full emits during
        a rapid preset swap.

        No-op when ``schedule_delayed`` wasn't wired in (tests, or
        future contexts that opt out).
        """
        if self._schedule_delayed is None:
            return
        dkey = id(device)
        params_now = self._safe_params(device)
        try:
            initial_count = len(params_now) if params_now is not None else 0
        except Exception:
            initial_count = 0
        self._post_add_param_count_snapshot[dkey] = initial_count
        self._post_add_epoch_counter += 1
        epoch = self._post_add_epoch_counter
        self._post_add_reconciler_epochs[dkey] = epoch

        def _reconcile(d=device, t=track, captured_epoch=epoch,
                       captured_initial=initial_count):
            if self._disconnected:
                return
            # Epoch check — if another add cycle raced ahead, let the
            # newer scheduling win. The later callback will re-examine
            # the current state.
            if self._post_add_reconciler_epochs.get(id(d)) != captured_epoch:
                return
            # Verify the device is still in its track. On a preset-swap
            # device-level (vs. plugin-internal preset change) the
            # Python object may be gone; there's nothing to reconcile.
            try:
                current_params = self._safe_params(d)
                current_count = (
                    len(current_params) if current_params is not None else 0
                )
            except Exception as e:
                logger.debug(
                    "LOMListeners: post-add reconciler read failed "
                    "for device=%r: %s", d, e,
                )
                return
            if current_count <= captured_initial:
                # No hydration happened — either not a plugin, or the
                # plugin exposed its full set synchronously. Either
                # way, the state/full emitted at device-add was
                # already complete. Nothing to do.
                return
            logger.info(
                "LOMListeners: post-add reconciler detected param growth "
                "for device=%r (%d → %d); rebinding + re-emitting",
                d, captured_initial, current_count,
            )
            # Re-bind value listeners for the now-visible params. The
            # per-pid guard in ``_attach_value_listeners_for_device``
            # makes this a no-op for params that already had listeners
            # (the [Device On] toggle etc.).
            try:
                chain_idx = self._chain_idx_of_device(t, d)
                if chain_idx is not None:
                    self._attach_value_listeners_for_device(
                        track=t, device=d, chain_idx=chain_idx,
                    )
            except Exception as e:
                logger.warning(
                    "LOMListeners: post-add reconciler rebind failed "
                    "for device=%r: %s", d, e,
                )
            # Fire structural-change so StateFullComponent re-emits
            # state/full with the fully-hydrated param list.
            cb = self._on_structural_change
            if cb is not None:
                try:
                    cb()
                except Exception as e:
                    logger.error(
                        "LOMListeners: on_structural_change raised from "
                        "post-add reconciler: %s", e, exc_info=True,
                    )

        try:
            self._schedule_delayed(750, _reconcile)
        except Exception as e:
            logger.warning(
                "LOMListeners: schedule_delayed failed for device=%r: %s",
                device, e,
            )

    def _bind_device_parameters_listener(self, device) -> None:
        """Attach ``device.add_parameters_listener``; record for teardown.

        Callback just fires ``_on_structural_change`` — the same
        mechanism ``_on_track_devices_changed`` uses — which triggers
        a fresh ``state/full`` emit and rebinds value-listeners for the
        newly-visible params (the rebind runs via the state/full
        emitter's walk, which calls ``_attach_value_listeners_for_device``
        on every device, including this one).

        Dedup by ``id(device)`` — the same Python object shouldn't get
        two listeners even if the LOM walk visits it twice.
        """
        dkey = id(device)
        if dkey in self._device_parameters_listeners:
            return
        add = getattr(device, "add_parameters_listener", None)
        if not callable(add):
            # Not a fatal error: older Live versions or test stubs may
            # not expose this accessor. Plugins will still require a
            # hard refresh in that environment, matching pre-fix
            # behavior — not a regression.
            return

        def _on_device_parameters_changed(d=device):
            if self._disconnected:
                return
            perf_profiler.record_listener_fire("device:parameters")
            cb = self._on_structural_change
            if cb is None:
                return
            try:
                cb()
            except Exception as e:
                logger.error(
                    "LOMListeners: on_structural_change raised from "
                    "parameters-listener: %s", e, exc_info=True,
                )
            # Also re-bind value-listeners for this device's now-
            # visible params. The state/full emit will do a full walk
            # anyway, but binding here closes the window between
            # "parameter list grew" and "next state/full walk lands" —
            # keeps value-echoes immediate from the moment the list
            # stabilizes. The per-pid guard in
            # ``_attach_value_listeners_for_device`` keeps this cheap.
            try:
                track = self._track_of_device(d)
                if track is None:
                    return
                chain_idx = self._chain_idx_of_device(track, d)
                if chain_idx is None:
                    return
                self._attach_value_listeners_for_device(
                    track=track, device=d, chain_idx=chain_idx,
                )
            except Exception as e:
                logger.warning(
                    "LOMListeners: rebind-after-parameters-changed failed "
                    "for device=%r: %s", d, e,
                )

        try:
            add(_on_device_parameters_changed)
        except Exception as e:
            logger.warning(
                "LOMListeners: add_parameters_listener failed for "
                "device=%r: %s", device, e,
            )
            return
        self._device_parameters_listeners[dkey] = (
            device, _on_device_parameters_changed,
        )

    def _detach_device_parameters_listener(self, device) -> None:
        """Remove the parameters-listener for ``device``, if any.

        Stale-handle suppression matches ``_detach_param_value_listener``:
        Live downgrades the underlying ``Device`` to an invalid handle
        the moment it leaves its chain, so the detach call raises a
        C++-signature error. The bookkeeping is cleared either way.
        """
        dkey = id(device)
        entry = self._device_parameters_listeners.pop(dkey, None)
        if entry is None:
            return
        dev, cb = entry
        remove = getattr(dev, "remove_parameters_listener", None)
        if callable(remove):
            try:
                remove(cb)
            except Exception as e:
                if _is_stale_handle_error(e):
                    logger.debug(
                        "LOMListeners: remove_parameters_listener skipped "
                        "for stale handle device=%r (already torn down)",
                        dev,
                    )
                else:
                    logger.warning(
                        "LOMListeners: remove_parameters_listener failed "
                        "for device=%r: %s", dev, e,
                    )

    def _bind_device_name_listener(self, device) -> None:
        """Attach ``device.add_name_listener``; record for teardown.

        A preset loaded onto a device of its own class keeps the device and
        renames it after the preset, and Live's undo and redo of that load
        rename it back — and none of the three fires the track's ``devices``
        listener (measured on the rig, Live 12.4.15b2, 2026-09-15: Evo 01 →
        Evo 02 on one MultiSampler, its undo and its redo republished
        nothing). Without this the D record keeps the old name, and the T
        record's ``preset`` — checked against the instrument's name
        (ADR-439) — is never re-read, so the swap control would step from a
        preset the track no longer holds. The callback is the
        structural-change callback, which the publisher debounces like every
        other structural fire, so a rename during a prepare load publishes
        after that load has recorded.

        Top-level devices only: this is reached from
        ``_attach_value_listeners_for_device``. A kit swap renames every
        pad's instrument at once, and those names are
        ``DrumVirtualMacroComponent``'s to watch.
        """
        did = _safe_int_id(device)
        if did is None or did in self._device_name_listeners:
            return
        add = getattr(device, "add_name_listener", None)
        if not callable(add):
            return

        def _on_device_name_changed():
            if self._disconnected:
                return
            perf_profiler.record_listener_fire("device:name")
            cb = self._on_structural_change
            if cb is None:
                return
            try:
                cb()
            except Exception as e:
                logger.error(
                    "LOMListeners: on_structural_change raised from "
                    "name-listener: %s", e, exc_info=True,
                )

        try:
            add(_on_device_name_changed)
        except Exception as e:
            logger.warning(
                "LOMListeners: add_name_listener failed for device=%r: %s",
                device, e,
            )
            return
        self._device_name_listeners[did] = (device, _on_device_name_changed)

    def _detach_device_name_listener(self, device_id: int) -> None:
        """Remove the name-listener held for ``device_id``, if any. Idempotent.

        A device that has left its chain is a stale handle, so its detach
        failing is expected — the same suppression as the other detaches.
        """
        entry = self._device_name_listeners.pop(device_id, None)
        if entry is None:
            return
        dev, cb = entry
        remove = getattr(dev, "remove_name_listener", None)
        if not callable(remove):
            return
        try:
            remove(cb)
        except Exception as e:
            if _is_stale_handle_error(e):
                logger.debug(
                    "LOMListeners: remove_name_listener skipped for stale "
                    "handle device=%r (already torn down)", dev,
                )
            else:
                logger.warning(
                    "LOMListeners: remove_name_listener failed for "
                    "device=%r: %s", dev, e,
                )

    def _bind_param_value_listener(
        self, param_id: int, parameter, canonical_path: str,
    ) -> None:
        """Attach a value-listener for one parameter; record for teardown.

        The listener closure captures ``(parameter, canonical_path)``
        and reads ``self._on_param_value_changed`` at fire time — so
        installing the callback post-construction takes effect without
        a re-attach. The wire pid is NOT captured: v2 echoes recompute
        it via ``_safe_int_id(parameter)`` at fire time so a parameter
        whose underlying ``_live_ptr`` has shifted (preset reload,
        plugin reconfig) still echoes correctly.
        """
        add = getattr(parameter, "add_value_listener", None)
        if not callable(add):
            return

        def _on_value_changed(p=parameter, pid=param_id):
            if self._disconnected:
                return
            perf_profiler.record_listener_fire("param:value")
            cb = self._on_param_value_changed
            if cb is None:
                return
            # Read the path now, don't capture it. See ``_param_paths``.
            path = self._param_paths.get(pid)
            if path is None:
                return
            try:
                cb(p, path)
            except Exception as e:
                logger.error(
                    "LOMListeners: on_param_value_changed raised for "
                    "path=%s: %s", path, e, exc_info=True,
                )

        try:
            add(_on_value_changed)
        except Exception as e:
            logger.warning(
                "LOMListeners: add_value_listener failed for path=%s: %s",
                canonical_path, e,
            )
            return
        self._param_value_listeners[param_id] = (parameter, _on_value_changed)
        self._param_paths[param_id] = canonical_path

    def _detach_param_listeners_for_device_ids(
        self, departed_device_ids: set[int], track,
    ) -> None:
        """Detach listeners for every param on any of ``departed_device_ids``.

        Called when a device leaves a track's chain. We need to know
        which pids belong to the departed devices so we can drop them
        from ``_param_value_listeners`` before the Device object's
        Python reference goes away (at which point
        ``remove_value_listener`` may still work on the LOM side but
        the parameter wrapper is opaque).

        Strategy: walk every currently-still-present parameter under
        ``track`` (or under all tracks if ``track is None`` — the
        "departed track" path) and collect their pids. Any pid we're
        holding a listener for that *isn't* in the keep-set belongs
        to a departed device and gets detached.

        At session scale this is the same O(song) walk as any
        resolve; it only runs on a device-remove event, which is
        infrequent by definition.
        """
        if not departed_device_ids:
            return
        keep_pids: set[int] = set()
        keep_device_keys: set[int] = set()
        if track is None:
            # Departed-track path: everything still reachable from
            # song survives.
            for t in self._iter_all_tracks():
                for device in self._safe_devices(t):
                    keep_device_keys.add(id(device))
                    for param in self._safe_params(device):
                        pid = _safe_int_id(param)
                        if pid is not None:
                            keep_pids.add(pid)
        else:
            for device in self._safe_devices(track):
                did = _safe_int_id(device)
                if did is None or did in departed_device_ids:
                    continue
                keep_device_keys.add(id(device))
                for param in self._safe_params(device):
                    pid = _safe_int_id(param)
                    if pid is not None:
                        keep_pids.add(pid)
            # Also walk every *other* track — their params are
            # obviously not owned by a device that just left *this*
            # track, so we keep them.
            for t in self._iter_all_tracks():
                if t is track:
                    continue
                for device in self._safe_devices(t):
                    keep_device_keys.add(id(device))
                    for param in self._safe_params(device):
                        pid = _safe_int_id(param)
                        if pid is not None:
                            keep_pids.add(pid)

        dead_pids = [
            pid for pid in self._param_value_listeners
            if pid not in keep_pids
        ]
        for pid in dead_pids:
            self._detach_param_value_listener(pid)

        # Symmetric to the pid walk: any parameters-listener we still
        # hold for a device that isn't in the keep-set belongs to a
        # departed device and must be detached. The LOM usually tears
        # these down at ``remove_parameters_listener`` even after the
        # device is gone, but we drop the Python reference here either
        # way so teardown is bounded.
        dead_device_keys = [
            dkey for dkey in self._device_parameters_listeners
            if dkey not in keep_device_keys
        ]
        for dkey in dead_device_keys:
            entry = self._device_parameters_listeners.pop(dkey, None)
            if entry is None:
                continue
            dev, cb = entry
            remove = getattr(dev, "remove_parameters_listener", None)
            if callable(remove):
                try:
                    remove(cb)
                except Exception as e:
                    if _is_stale_handle_error(e):
                        logger.debug(
                            "LOMListeners: remove_parameters_listener "
                            "skipped for stale handle device=%r (departed "
                            "chain)", dev,
                        )
                    else:
                        logger.warning(
                            "LOMListeners: remove_parameters_listener "
                            "failed for device=%r: %s", dev, e,
                        )

        # Name-listeners are keyed by wire id. Keep every device still in the
        # song — one moved to another track included, whichever track reports
        # first — and release the rest.
        present_ids = {
            _safe_int_id(device)
            for t in self._iter_all_tracks()
            for device in self._safe_devices(t)
        }
        for did in [d for d in self._device_name_listeners if d not in present_ids]:
            self._detach_device_name_listener(did)

    def _detach_param_value_listener(self, param_id: int) -> None:
        """Detach the value-listener for ``param_id``, if any. Idempotent.

        Stale-handle suppression: Live's C++ binding raises
        ``Boost.Python.ArgumentError`` ("did not match C++ signature:
        remove_value_listener(TPyHandle<ATimeableValue>, object)") when
        the parameter's underlying TimeableValue has already been torn
        down — i.e., when the device holding the parameter was just
        removed from its chain. That's the common case: the pid-keyed
        bookkeeping is cleared either way, and the LOM had already
        dropped the C++-side listener when the device left. Log at
        DEBUG instead of WARNING so the real listener-leak bugs
        (anything other than a stale-handle) stay visible in Log.txt.
        See ADR-004 §4.
        """
        entry = self._param_value_listeners.pop(param_id, None)
        self._param_paths.pop(param_id, None)
        if entry is None:
            return
        parameter, cb = entry
        remove = getattr(parameter, "remove_value_listener", None)
        if callable(remove):
            try:
                remove(cb)
            except Exception as e:
                if _is_stale_handle_error(e):
                    logger.debug(
                        "LOMListeners: remove_value_listener skipped for "
                        "stale handle param_id=%d (device already torn "
                        "down)", param_id,
                    )
                else:
                    logger.warning(
                        "LOMListeners: remove_value_listener failed for "
                        "param_id=%d: %s", param_id, e,
                    )

    # --- canonical-path helpers -------------------------------------------

    def _track_segment_for(self, track) -> Optional[str]:
        """Return the canonical-path segment for ``track``.

        ``"master"`` for the master track; ``"tracks/<N>"`` (zero-based
        index into ``song.tracks``) for a regular track. ``None`` if
        the track isn't reachable — caller skips the path-dependent
        operation.

        Per [04 §2.2](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#22-grammar):
        paths are not rooted with a leading slash; segments are
        slash-joined.
        """
        master = self._safe_master_track()
        if master is not None and _same_lom_track(track, master):
            return "master"
        tracks = self._safe_tracks_list()
        if tracks is None:
            return None
        for idx, t in enumerate(tracks):
            if _same_lom_track(t, track):
                return "tracks/%d" % idx
        return None

    def recompute_param_paths(self) -> None:
        """Re-derive every bound parameter's canonical path from the LOM.

        Called at the top of both structural entry points
        (``_on_tracks_changed``, ``_on_track_devices_changed``). Cheap:
        one walk of tracks × devices × params with no LOM writes and no
        listener churn — deliberately *not* a drop-and-rebind, which
        would thrash during the ``devices_changed`` bursts plugin
        hydration produces.

        The same bug class was fixed in ``TrackMetadataComponent`` by
        rebinding (``on_structural_change``, "Issue #399: stale closures
        from a prior bind capture the old canonical path"). Here the
        closure never captured a path in the first place, so refreshing
        the map is enough.

        A pid that cannot be re-derived this pass keeps its previous
        path rather than being dropped: a device mid-hydration can read
        as paramless for a tick, and a missing path silences the echo
        entirely.
        """
        if self._disconnected or not self._param_value_listeners:
            return

        segments = []
        master = self._safe_master_track()
        if master is not None:
            segments.append(("master", master))
        tracks = self._safe_tracks_list()
        if tracks is not None:
            for idx, track in enumerate(tracks):
                segments.append(("tracks/%d" % idx, track))

        for segment, track in segments:
            for chain_idx, device in enumerate(self._safe_devices(track)):
                for param_idx, param in enumerate(self._safe_params(device)):
                    pid = _safe_int_id(param)
                    if pid is None or pid not in self._param_value_listeners:
                        continue
                    self._param_paths[pid] = "%s/devices/%d/params/%d" % (
                        segment, chain_idx, param_idx,
                    )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Detach every listener. Idempotent."""
        if self._disconnected:
            return
        self._disconnected = True
        remove_tracks_listener = getattr(
            self._song, "remove_tracks_listener", None,
        )
        if callable(remove_tracks_listener):
            try:
                remove_tracks_listener(self._on_tracks_changed)
            except Exception as e:
                logger.warning("LOMListeners: tracks detach failed: %s", e)
        for _tkey, (track, cb) in list(self._track_device_listeners.items()):
            remove = getattr(track, "remove_devices_listener", None)
            if callable(remove):
                try:
                    remove(cb)
                except Exception as e:
                    logger.warning(
                        "LOMListeners: devices detach failed for %r: %s",
                        track, e,
                    )
        self._track_device_listeners.clear()
        self._last_device_ids_per_track.clear()
        for pid in list(self._param_value_listeners.keys()):
            self._detach_param_value_listener(pid)
        for _dkey, (dev, cb) in list(
            self._device_parameters_listeners.items()
        ):
            remove = getattr(dev, "remove_parameters_listener", None)
            if callable(remove):
                try:
                    remove(cb)
                except Exception as e:
                    if _is_stale_handle_error(e):
                        logger.debug(
                            "LOMListeners: parameters-listener detach "
                            "skipped for stale handle device=%r", dev,
                        )
                    else:
                        logger.warning(
                            "LOMListeners: parameters-listener detach "
                            "failed for device=%r: %s", dev, e,
                        )
        self._device_parameters_listeners.clear()
        for did in list(self._device_name_listeners):
            self._detach_device_name_listener(did)
        # Post-add reconciler bookkeeping — clearing the epoch map
        # causes any in-flight scheduled callbacks to no-op (their
        # captured epoch no longer matches, and the ``_disconnected``
        # guard catches them anyway). The snapshot dict is purely
        # informational and freed here. The monotonic counter itself
        # does not need resetting — this instance is about to be
        # garbage-collected.
        self._post_add_reconciler_epochs.clear()
        self._post_add_param_count_snapshot.clear()

    # --- safe LOM access --------------------------------------------------

    def _iter_all_tracks(self) -> Iterator[object]:
        """Yield master first, then regular tracks in LOM order."""
        master = self._safe_master_track()
        if master is not None:
            yield master
        for t in self._iter_regular_tracks():
            yield t

    def _iter_regular_tracks(self) -> Iterator[object]:
        tracks = self._safe_tracks_list()
        if tracks is None:
            return
        for t in tracks:
            yield t

    def _safe_master_track(self):
        try:
            return self._song.master_track
        except Exception as e:
            logger.warning("LOMListeners: master_track read failed: %s", e)
            return None

    def _safe_tracks_list(self):
        try:
            return list(self._song.tracks)
        except Exception as e:
            logger.warning("LOMListeners: tracks read failed: %s", e)
            return None

    def _safe_devices(self, track) -> list:
        # Defensive ``try`` around the attribute access itself — a
        # broken plugin can raise from its ``devices`` property (not
        # an ``AttributeError``, so ``getattr(…, None)`` would let it
        # escape). One blown read must not take down the whole walk.
        try:
            devices_attr = track.devices
        except Exception as e:
            logger.warning(
                "LOMListeners: track.devices read failed for %r: %s",
                track, e,
            )
            return []
        devices = self._safe_iter(devices_attr)
        return devices or []

    def _safe_params(self, device) -> list:
        try:
            params_attr = device.parameters
        except Exception as e:
            logger.warning(
                "LOMListeners: device.parameters read failed for %r: %s",
                device, e,
            )
            return []
        params = self._safe_iter(params_attr)
        return params or []

    def _track_of_device(self, device) -> Optional[object]:
        """Return the Track that owns ``device``, or ``None``.

        Used by the parameters-listener callback to rebind
        value-listeners on the device's current chain slot. A walk is
        fine — this fires on plugin hydration, not on a hot path.

        Matches by LOM identity (``_safe_int_id``) not Python ``is``:
        Live hands back a fresh Python wrapper for the same LOM device
        on every attribute access, so a wrapper captured at scheduling
        time is not ``is`` the wrapper returned by ``track.devices``
        a few seconds later. ``_live_ptr`` is stable across those
        re-reads.
        """
        target_id = _safe_int_id(device)
        if target_id is None:
            return None
        for track in self._iter_all_tracks():
            for d in self._safe_devices(track):
                if _safe_int_id(d) == target_id:
                    return track
        return None

    def _chain_idx_of_device(self, track, device) -> Optional[int]:
        """Return the zero-based chain index of ``device`` under ``track``.

        Matches by LOM identity — see ``_track_of_device`` rationale.
        """
        target_id = _safe_int_id(device)
        if target_id is None:
            return None
        for idx, d in enumerate(self._safe_devices(track)):
            if _safe_int_id(d) == target_id:
                return idx
        return None

    @staticmethod
    def _safe_iter(maybe_iterable):
        if maybe_iterable is None:
            return None
        try:
            return list(maybe_iterable)
        except Exception as e:
            logger.warning("LOMListeners: iteration failed: %s", e)
            return None


def _is_stale_handle_error(exc: BaseException) -> bool:
    """Return ``True`` when ``exc`` is Live's stale-LOM-handle marker.

    Live's ``add_*_listener`` / ``remove_*_listener`` bindings are
    boost::python signatures like
    ``remove_value_listener(TPyHandle<ATimeableValue>, object)``. When
    the underlying C++ object is gone (device just removed from chain,
    preset-swap teardown, track deletion), the Python wrapper still
    exists and the ``self`` slot still *types* as the wrapper class,
    but boost::python's argument matcher refuses to unwrap it and
    raises ``Boost.Python.ArgumentError`` (a ``TypeError`` subclass)
    with "did not match C++ signature" in the message.

    The error is semantically "the listener is already detached on the
    LOM side, nothing to do here" — not a bug. Anything else from the
    same remove_* call is a genuine problem (misconfigured listener,
    crashed plugin) and stays at WARNING.

    Match on the message text rather than the exception class because
    ``Boost.Python.ArgumentError`` isn't importable from outside the
    Live host — we'd have to conditionally import it, and a string
    match is equally specific and simpler to test.
    """
    try:
        msg = str(exc)
    except Exception:
        return False
    # Both the signature-mismatch line and the trailing C++ signature
    # line can appear; matching either substring is sufficient because
    # ordinary TypeError messages never contain them.
    return (
        "did not match C++ signature" in msg
        or "TPyHandle" in msg
    )


def _safe_int_id(live_object) -> Optional[int]:
    """Read a stable LOM identity for ``live_object`` as an OSC-safe int32.

    The ``ableton.v3`` framework wraps raw LOM objects (Track, Device,
    etc.) and does *not* expose ``.id`` on those wrappers — only the
    underlying LOM pointer as ``_live_ptr``. Lower-level objects like
    ``DeviceParameter`` still expose ``.id`` directly. See
    ``BrowserProbe._chain_device_ids`` for the prior-art precedent of
    using ``_live_ptr`` as the stable identity.

    Resolution order:

    1. ``_live_ptr`` — v3 wrapper's LOM pointer, stable across
       renames/reorders. First choice for Track/Device/Chain.
    2. ``.id`` — native LOM property, still present on
       ``DeviceParameter`` and anything unwrapped.
    3. ``None`` — genuine unresolvable; caller must skip.

    We do NOT fall back to Python's built-in ``id()`` because that's
    process-address-based and would make two calls on the same LOM
    object *unrelated* to LOM identity (e.g., different Python
    wrapper instances for the same LOM track). LOM identity is the
    whole reason walk-based resolution works at all; using ``id()``
    would silently break the "stable across reorders" invariant that
    v2 addressing depends on.

    OSC-safe masking: LOM pointer values can exceed int32 on 64-bit
    macOS. We mask to 31 bits so OSC ``'i'`` emit doesn't overflow.
    Masking preserves identity: two reads on the same LOM object
    return the same masked value.

    Used by:
    - ``LOMListeners`` itself for device-id bookkeeping during the
      add/remove diff in ``_on_track_devices_changed``.
    - ``MutationComponent.on_param_value_changed`` to compute the v2
      wire pid from the parameter the listener handed it.
    - ``DevicesComponent`` v2/legacy write handlers' inline LOM walk
      (matches a wire pid against ``_safe_int_id(param)``).
    - ``StateFullComponent`` to label tree entries with their v2
      wire ids.
    """
    raw = getattr(live_object, "_live_ptr", None)
    if raw is None:
        try:
            raw = live_object.id
        except Exception as e:
            logger.warning(
                "_safe_int_id: %r has no _live_ptr and .id raised %s: %s",
                live_object, type(e).__name__, e,
            )
            return None
    if raw is None:
        return None
    try:
        return int(raw) & 0x7FFFFFFF
    except (TypeError, ValueError):
        return None


def _same_lom_track(a, b) -> bool:
    """Return True if ``a`` and ``b`` refer to the same LOM track.

    Live's ``song.tracks`` can return fresh Python wrapper instances on
    each read — two walks over ``song.tracks`` yield objects that
    compare unequal under ``is`` even though they represent the same
    underlying LOM track. This breaks identity comparisons like
    ``track is other`` in ``_track_segment_for`` / ``track_id_for``:
    the track that ``_iter_all_tracks`` yields is already a different
    wrapper from the one ``_safe_tracks_list`` returns a moment later.

    We compare by ``_safe_int_id`` (masked ``_live_ptr``), which is the
    stable identity used everywhere else in the walker. ``is`` is kept
    as a fast path for two reasons: (1) test stubs share Python
    identity and don't always expose ``_live_ptr``; (2) when Live *does*
    hand back the same wrapper, we skip the id read.

    Returns False if either object is None or neither identity form
    matches — callers treat that as "not the same track".
    """
    if a is None or b is None:
        return False
    if a is b:
        return True
    aid = _safe_int_id(a)
    bid = _safe_int_id(b)
    if aid is None or bid is None:
        return False
    return aid == bid
