"""DevicesComponent — v3 parameter writes + query + resync.

Owns the parameter-write and param/state-resync slice of the v3
wire contract:

- ``/looping/v3/param/set [path, value, generation]`` — the hot
  path. Path is ``tracks/<N>/devices/<N>/params/<N>``; generation
  guard rejects writes against a stale device-tree snapshot with
  ``/looping/v3/error [..., "generation-stale", ...]``.
- ``/looping/v3/param/query [path]`` → ``/looping/v3/param/value
  [path, value]`` — point query used sparingly for UI cold-start.
- ``/looping/v3/state/resync`` (no args) → re-emit the current
  state/full bundle via the injected callback. UI asks when it
  suspects cache tear.

Resolution strategy: every handler walks the current ``song`` tree
inline to find its target by path. There is no forward map. At
session scale (~8 tracks × ~5 devices × ~20 params) the walk is
sub-millisecond. A path that no longer resolves emits
``/looping/v3/error [..., "path-missing", ...]`` per [04 §7.1].

One-shot echo suppression delegates to ``MutationComponent``.
``arm_suppression(param_id)`` sets a per-id flag immediately before
the LOM write; the ``on_param_value_changed`` fire that LOM emits
as the synchronous echo of our assignment finds the flag, drops the
emit, and clears it. ``unarm_suppression`` runs on assignment
failure so a later unrelated fire isn't swallowed. Per-param keying
(rather than a single global one-shot) is what lets two simultaneous
writes from the UI both get cleanly suppressed without one stealing
the other's flag.

Wiring: ``LoopingSurface`` injects the ``MutationComponent`` via
``set_mutation`` immediately after both components exist. Tests that
construct ``DevicesComponent`` standalone leave the slot empty; the
write path is no-op-suppression in that case (no listener exists
either).

Value clamping is deliberate and matches LOM's rejection behaviour —
LOM raises on assignment outside ``[param.min, param.max]``, which
leaves the UI hanging on a confirming emit that never comes. Clamp
into range and let LOM accept the write; a diagnostic WARN logs the
clamp so a miscalibrated slider surfaces loudly.
"""

from __future__ import annotations

import logging
from typing import Optional

try:
    from .V3StateFullComponent import extract_etag
except ImportError:  # pytest imports these flat — see osc_transport.py
    from V3StateFullComponent import extract_etag

from .LOMListeners import _safe_int_id
from .path_resolver import ResolveStatus, resolve_param

logger = logging.getLogger("looping")

# v3 addresses — Phase 1 Commit B. Per [04 §3.1 / §7.1].
V3_PARAM_SET_ADDRESS = "/looping/v3/param/set"
V3_PARAM_QUERY_ADDRESS = "/looping/v3/param/query"
V3_PARAM_VALUE_ADDRESS = "/looping/v3/param/value"
V3_STATE_RESYNC_ADDRESS = "/looping/v3/state/resync"
V3_ERROR_ADDRESS = "/looping/v3/error"

# Closed-enum v3 error codes per [04 §7.2]. Kept here (alongside the
# handler that emits them) rather than in path_resolver because the
# resolver only produces a subset — ``generation-stale`` and
# ``write-rejected`` originate in this component.
V3_ERROR_PATH_NOT_FOUND = "path-not-found"
V3_ERROR_PATH_STRUCTURAL_MISMATCH = "path-structural-mismatch"
V3_ERROR_GENERATION_STALE = "generation-stale"
V3_ERROR_WRITE_REJECTED = "write-rejected"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"


class DevicesComponent:
    """Handles v3 param writes, queries, and the state/full resync trigger.

    Args:
        song: The Live ``Song`` object. Resolution walks
            ``song.master_track`` and ``song.tracks`` directly per
            handler call.
        emit: Callable ``(address, args)`` that sends an OSC message.
            Used for ``/looping/v3/error`` replies and the param/value
            response. Matches the ``SessionComponent`` shape so the
            surface's transport.send binds cleanly.

    The component holds no LOM listeners of its own; teardown is
    trivial.
    """

    def __init__(self, song, emit):
        self._song = song
        self._emit = emit
        # Per-param echo suppression lives in ``MutationComponent``.
        # Injected post-construction via ``set_mutation`` because the
        # surface builds DevicesComponent before MutationComponent
        # (the latter needs the listener bookkeeping to be in place
        # first). Standalone unit tests leave this ``None``;
        # ``arm_suppression`` / ``unarm_suppression`` are then no-ops,
        # which is fine because no listener is attached in that test
        # shape either.
        self._mutation = None
        # v3 generation counter — injected post-construction for the
        # same reason as the mutation slot (LoopingSurface builds the
        # generation component after this one so the state/full
        # announcer can be wired into the advance hook). Standalone
        # tests leave this ``None``; v3 handlers detect and refuse to
        # answer, emitting ``write-rejected`` so no stale-check bypass
        # is possible.
        self._generation = None
        # v3 state/full announcer — fires on UI resync requests. Same
        # post-construction injection pattern; ``None`` means no
        # resync work done, handler still returns a benign no-op.
        self._state_full_on_resync = None
        self._disconnected = False

    def set_mutation(self, mutation) -> None:
        """Inject the ``MutationComponent`` for echo suppression.

        Called by ``LoopingSurface`` after both components exist. Idempotent
        — re-injection just replaces the slot. Standalone tests skip this.
        """
        self._mutation = mutation

    def set_generation(self, generation) -> None:
        """Inject the v3 ``GenerationComponent`` for stale-check.

        Called by ``LoopingSurface`` after both components exist.
        Idempotent. Unit tests that exercise the v2/legacy paths don't
        need this; unit tests that exercise the v3 path do.
        """
        self._generation = generation

    def set_state_full_on_resync(self, cb) -> None:
        """Inject the callback that re-emits state/full on UI resync.

        Called by ``LoopingSurface`` to bind
        ``StateFullComponent.emit_on_resync`` (or an equivalent) so
        ``/looping/v3/state/resync`` can drive a fresh emit. ``None``
        detaches — handler then returns a no-op.
        """
        self._state_full_on_resync = cb

    # --- /looping/v3/param/set --------------------------------------------

    def handle_set_param_v3(self, args, source_addr):
        """``/looping/v3/param/set [path, value, generation]`` — the v3 hot path.

        Per [04 §3.1, §4.2]. Typed-error model per [04 §7.2]:

        - Bad args (wrong arity, non-coercible types, NaN) → error
          ``write-rejected`` with detail explaining the bad input
        - UI generation < surface generation → error ``generation-stale``
        - Path grammar-invalid → error ``path-not-found`` (detail notes
          malformed)
        - Path names unreachable LOM position → error ``path-not-found``
        - Path grammar reserves a Phase-1-unimplemented suffix
          (``chains/``, ``returns/``) → error ``path-not-supported``

        On OK: resolves via ``path_resolver.resolve_param``, arms echo
        suppression using the v2 wire pid (so the v2-wire listener
        echo is silenced the same way), writes the clamped value. The
        v3 echo fires from ``MutationComponent.on_param_value_changed``
        and reads the listener's captured ``canonical_path``.

        Suppression detail: v3 writes also suppress v2 echoes because
        both v2 and v3 echoes share the same
        ``LOMListeners`` value listener. The v2 echo path computes
        ``_safe_int_id(parameter)`` at fire time, which is the same key
        our ``arm_suppression`` uses — one arm silences both wires.
        """
        if self._disconnected:
            logger.info("handle_set_param_v3: surface disconnected — dropping args=%r", args)
            return None

        if len(args) < 3:
            logger.warning("handle_set_param_v3: short args %r", args)
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path="", detail="expected [path, value, generation]",
            )
            return None

        try:
            path = self._coerce_str(args[0])
            value = float(args[1])
            ui_gen = int(args[2])
        except (TypeError, ValueError) as e:
            logger.warning("handle_set_param_v3: coerce failed args=%r err=%s", args, e)
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=self._coerce_str(args[0]) if args else "",
                detail="coerce failed: %s" % e,
            )
            return None

        if value != value:  # NaN guard.
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=path, detail="nan value",
            )
            return None

        # Generation check FIRST. A stale-gen write against a valid
        # current path should still be rejected — the UI hasn't caught
        # up to the structural change yet, so the write might be
        # semantically pointed at what used to be there. This ordering
        # matches [04 §4.2] "discard the pending write; wait for
        # invalidate; replay if gesture still live".
        if self._generation is None:
            # Misconfiguration — surface didn't wire the generation
            # component. Refuse rather than silently let writes land
            # without the stale-check.
            logger.error(
                "DevicesComponent.handle_set_param_v3: generation "
                "component not wired; refusing write path=%s", path,
            )
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=path, detail="surface misconfigured",
            )
            return None

        if self._generation.is_stale(ui_gen):
            logger.warning(
                "handle_set_param_v3: generation stale path=%s ui=%d surf=%d",
                path, ui_gen, self._generation.current,
            )
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_GENERATION_STALE,
                path=path,
                detail="ui=%d, surf=%d" % (ui_gen, self._generation.current),
            )
            return None

        # Resolve path. Map resolver status → v3 error code.
        r = resolve_param(self._song, path)
        if r.status is ResolveStatus.NOT_SUPPORTED:
            logger.warning("handle_set_param_v3: path-not-supported path=%s detail=%s", path, r.detail)
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_PATH_NOT_SUPPORTED,
                path=path, detail=r.detail,
            )
            return None
        if r.status is ResolveStatus.MALFORMED:
            # Malformed paths are NOT_FOUND from the UI's POV — the
            # path doesn't name anything. A "malformed" code would add
            # another branch for the UI for no recovery benefit.
            logger.warning("handle_set_param_v3: malformed path=%s detail=%s", path, r.detail)
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_PATH_NOT_FOUND,
                path=path, detail="malformed: %s" % r.detail,
            )
            return None
        if r.status is ResolveStatus.NOT_FOUND:
            logger.warning("handle_set_param_v3: path-not-found path=%s detail=%s", path, r.detail)
            self._emit_v3_error(
                V3_PARAM_SET_ADDRESS, V3_ERROR_PATH_NOT_FOUND,
                path=path, detail=r.detail,
            )
            return None

        parameter = r.obj
        # Compute the v2 wire pid for suppression keying. Same
        # _safe_int_id that the v2 echo derives at fire time, so the
        # arm/consume sides agree. Missing pid (unidentifiable
        # parameter) degrades to no suppression — the echo will fire,
        # which is harmless because the UI's optimistic local update
        # already has the value.
        pid = _safe_int_id(parameter)
        # Mark the path as hot so MutationComponent emits the formatted
        # display string on the resulting value-changed fire. The hot
        # map decays naturally (HOT_TTL_SEC) when the user stops
        # interacting; only paths the UI is actively writing to pay the
        # str(parameter) cost. See MutationComponent §"Display-value
        # hot path".
        if self._mutation is not None:
            self._mutation.mark_hot(path)
        self._write(parameter, value, where="v3", param_id=pid)
        return None

    # --- /looping/v3/param/query ------------------------------------------

    def handle_v3_param_query(self, args, source_addr):
        """``/looping/v3/param/query [path]`` → echo ``param/value``.

        Per [04 §3.1]. Replies with the current value via the same
        ``/looping/v3/param/value`` address the listener uses, so the
        UI's handler for echoes covers queries too. Intended for
        cold-start probing; not on the steady-state hot path.

        Errors map the same way as ``handle_set_param_v3`` except
        ``generation-stale`` doesn't apply (queries are read-only).
        """
        if self._disconnected:
            return None

        if not args:
            self._emit_v3_error(
                V3_PARAM_QUERY_ADDRESS, V3_ERROR_PATH_NOT_FOUND,
                path="", detail="expected [path]",
            )
            return None

        path = self._coerce_str(args[0])
        r = resolve_param(self._song, path)
        if r.status is ResolveStatus.NOT_SUPPORTED:
            self._emit_v3_error(
                V3_PARAM_QUERY_ADDRESS, V3_ERROR_PATH_NOT_SUPPORTED,
                path=path, detail=r.detail,
            )
            return None
        if not r.ok:
            self._emit_v3_error(
                V3_PARAM_QUERY_ADDRESS, V3_ERROR_PATH_NOT_FOUND,
                path=path, detail=r.detail,
            )
            return None

        try:
            value = float(getattr(r.obj, "value", 0.0))
        except (TypeError, ValueError):
            value = 0.0
        try:
            self._emit(V3_PARAM_VALUE_ADDRESS, (path, value))
        except Exception as e:
            logger.error(
                "DevicesComponent.handle_v3_param_query: emit failed: %s", e,
            )
        return None

    # --- /looping/v3/state/resync -----------------------------------------

    def handle_v3_state_resync(self, args, source_addr):
        """``/looping/v3/state/resync [sessionId?, "etag:0x..."?]``.

        Per [04 §6.3]. The UI asks when it suspects cache tear (e.g.
        dropped an invalidate). Delegates to the injected callback
        (currently ``V3StateFullComponent.emit_on_resync``); no-op if
        not wired.

        Both args are optional and were absent before protocol 3.5.0.
        A UI that declares the ETag of the tree it holds gets the
        ``state/full/unchanged`` marker instead of a re-shipped tree
        when they match; one that declares nothing gets the tree, which
        is the pre-3.5.0 behaviour and the right answer for the case
        resync actually exists to serve — a UI that lost chunks holds an
        *incomplete* tree and must not claim an ETag for it.

        ``sessionId`` rides along because the surface has no per-client
        channel: every UI's traffic arrives from the bridge's single UDP
        port, so ``source_addr`` cannot tell a Mac from an iPad. The
        marker is tagged with the id so the other client can ignore it.
        """
        if self._disconnected:
            return None
        if self._state_full_on_resync is None:
            return None

        remaining, client_etag = extract_etag(args)
        session_id = None
        if remaining and isinstance(remaining[0], str) and remaining[0]:
            session_id = remaining[0]

        try:
            try:
                self._state_full_on_resync(
                    session_id=session_id, client_etag=client_etag,
                )
            except TypeError:
                # Callback predates the ETag arguments (older publisher
                # or a test double). A full send is the safe answer.
                self._state_full_on_resync()
        except Exception as e:
            logger.error(
                "DevicesComponent.handle_v3_state_resync: resync callback "
                "raised: %s", e,
            )
        return None

    # --- shared write path ------------------------------------------------

    def _write(
        self, parameter, value: float, where: str, param_id: Optional[int],
    ) -> None:
        """Clamp + write a ``DeviceParameter.value``, armed for echo.

        ``where`` is just a log tag so the same line can identify which
        handler drove the write when diagnosing wire-tap captures.
        ``param_id`` keys the per-id suppression in
        ``MutationComponent``; ``None`` means no suppression.
        """
        # Clamp into the parameter's range. Missing min/max (stub LOM
        # objects that don't populate them) degrade to "no clamp".
        try:
            lo = float(getattr(parameter, "min", None))
            hi = float(getattr(parameter, "max", None))
        except (TypeError, ValueError):
            lo = hi = None

        clamped = value
        if lo is not None and hi is not None:
            if value < lo:
                clamped = lo
            elif value > hi:
                clamped = hi
            if clamped != value:
                logger.warning(
                    "DevicesComponent write (%s): value %.6f out of [%.4f, %.4f]; clamped to %.6f",
                    where, value, lo, hi, clamped,
                )

        # Arm the one-shot before the write. If assignment raises (torn
        # down device, plugin reconfig mid-flight) unarm so a later
        # unrelated fire isn't swallowed.
        armed = False
        if self._mutation is not None and param_id is not None:
            self._mutation.arm_suppression(param_id)
            armed = True
        try:
            parameter.value = clamped
        except Exception as e:
            if armed:
                self._mutation.unarm_suppression(param_id)
            logger.error(
                "DevicesComponent write (%s): assignment to %.6f raised: %s",
                where, clamped, e,
            )

    # --- error emit -------------------------------------------------------

    def _emit_v3_error(
        self, address: str, code: str, path: str, detail: str,
    ) -> None:
        """``/looping/v3/error [address, code, path, detail]`` per [04 §7.1].

        ``address`` is the wire address that failed (so the UI can
        branch on *which* request errored). ``code`` is one of the
        closed-enum V3_ERROR_* constants. ``path`` is the offending
        path (``""`` when the error isn't path-specific). ``detail``
        is a short human-readable string — logged, not branched on.
        """
        try:
            self._emit(V3_ERROR_ADDRESS, (address, code, path, detail))
        except Exception as e:
            logger.error(
                "DevicesComponent emit_v3_error failed: %s "
                "(while reporting %s %s %s %s)",
                e, address, code, path, detail,
            )

    @staticmethod
    def _coerce_str(x) -> str:
        """Best-effort OSC arg → string coercion.

        OSC carries strings as bytes on the wire; most codecs decode
        them but tests and some transports hand bytes through raw.
        Non-string / non-bytes arguments get ``str()``'d — a numeric
        ``42`` becomes ``"42"`` (which won't resolve as a path, but
        will at least emit a typed error instead of raising).
        """
        if isinstance(x, (bytes, bytearray)):
            try:
                return x.decode("utf-8")
            except UnicodeDecodeError:
                return ""
        return str(x) if x is not None else ""

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """No listeners at Gate 5; idempotent teardown placeholder."""
        if self._disconnected:
            return
        self._disconnected = True
