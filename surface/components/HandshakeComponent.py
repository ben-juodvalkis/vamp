"""HandshakeComponent — v3 protocol-version negotiation.

Per [04 §8](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#8-handshake).

Flow:

    UI → /looping/v3/handshake/hello [versions:string[]]
    Surf → /looping/v3/handshake/accept [version, sessionId, generation]

If no common version:
    Surf → /looping/v3/error ["/looping/v3/handshake/hello",
                              "handshake-version-mismatch", "", detail]

The surface always speaks v3-handshake even when the negotiated
protocol ends up being v2. The v2-era ``/looping/protocol/version``
probe is supported but deprecated (see ``DebugComponent``); it returns
``"2.0.0"`` forever.

No mid-session fallback ([04 §8.3]): once ``accept`` returns
``"3.0.0"``, the session is v3 for its lifetime. A UI that encounters
repeated errors disconnects and reconnects (re-handshake).

## Session lifetime and the timeout question

[06-risks-and-open-questions.md §2](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/06-risks-and-open-questions.md)
flagged the handshake timeout as a Phase-1 UX choice. Decision:
**30 seconds** from the surface's POV — a session that has been
quiescent (no writes, no state/resync, no handshake/hello) for >30s
is considered dead and would be re-handshaked by a new hello
message. In practice this is rarely hit because UDP is session-less;
the timeout only matters for session-scoped bookkeeping (we clear
stale sessionIds to bound memory). A UI debugging session at a
breakpoint well over 30s is fine: a new hello starts a fresh session,
new sessionId, fresh generation mirror. The generation counter is
surface-wide, not session-scoped, so the reconnected UI catches up
via state/resync the same way any cold-start UI does.

## Supported versions

Version list is hardcoded here rather than in constants.json because
the supported-versions set is a code contract: adding a new version
requires code that implements it. A stringly-typed config file
wouldn't enforce that.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Callable, List, Optional

try:
    from .V3StateFullComponent import extract_etag
except ImportError:  # pytest imports these flat — see osc_transport.py
    from V3StateFullComponent import extract_etag

logger = logging.getLogger("looping")


# Wire addresses — module constants so renames fail at import time.
V3_HANDSHAKE_HELLO_ADDRESS = "/looping/v3/handshake/hello"
V3_HANDSHAKE_ACCEPT_ADDRESS = "/looping/v3/handshake/accept"
V3_ERROR_ADDRESS = "/looping/v3/error"

# Surface advertises these in preference order. Phase 7 PR-7a added
# 3.1.0 alongside 3.0.0: the minor bump marks "surface MAY emit new
# addresses the 3.0.0 UI doesn't know" (sceneRef grammar + PR-7b
# addresses). Phase 7 PR-7c pr7c-3 adds 3.2.0 alongside both: the
# T-record arity grew 8 → 9 (`hasArrangementClips`), so a pre-3.2.0
# UI parser would under-read the 9th field. All three are advertised
# so older UIs against a 3.2.0 surface still find a common version
# and handshake cleanly — downgrade-revert safety (see
# phase-7-pr7a-design.md §2.4). v2 UI clients don't handshake here
# (they use /looping/protocol/version) so we don't claim 2.0.0.
# ROW 5 2026-04-21 adds 3.3.0 alongside the three earlier entries:
# D-record arity shrank 4 -> 3 (legacyId retired). A 3.2.0 UI parser
# would over-read and grab the following record tag as an int field,
# so the bump and shrink ship together. Older entries kept so a
# downgrade-revert to a 3.2.0 surface still handshakes with a 3.3.0
# UI at the negotiated 3.2.0 floor.
# ADR-410 2026-07-27 adds 3.4.0: T-record arity grew 10 -> 13
# (isFoldable / foldState / groupTrackIndex), so a pre-3.4.0 UI parser
# would under-read the T record and mis-tag the following record.
# 2026-08-31 adds 3.6.0: ``state/full`` collapsed from
# ``begin -> chunk... -> end`` to a single ``state/full/tree``.
#
# Note what negotiating *down* now means. The tail is retained because
# clients that never read ``state/full`` at all negotiate against it —
# the Swift menubar advertises only 3.3.0 and consumes transport,
# session and error addresses. But a pre-3.6.0 client that *does* want
# the tree cannot be served one by this surface at any negotiated
# floor: the addresses it is listening for no longer exist. The floors
# have always been nominal in that way (3.3.0 and 3.4.0 both changed
# record arity without changing the emit), and 3.6.0 does not make it
# worse so much as make it obvious.
# 2026-09-10 adds 3.8.0 (issue #491): the path grammar gains a note-keyed
# ``pads/<note>`` segment under a Drum Rack, ``state/full/tree`` gains
# the ``pad-chain`` reason with a pad path as its scope, and
# ``device/load`` reads its ``devicePath`` argument. Record arities are
# unchanged; a 3.7.0 UI would mis-index a nested path in its chain-
# order device array, which is what the bump marks.
# 2026-09-15 adds 3.9.0 (ADR-439): the T record grows 14 -> 15 fields,
# appending ``preset`` (the ``looping.preset`` track data key a
# ``prepare_for_preset`` load records), echoed on
# ``/looping/v3/track/preset``. A 3.8.0 UI would read 14 fields and take
# the next record's tag as a field.
# 2026-09-26 adds 3.11.0 (onboarding.plan.md §6.3): ``prepare_for_preset``
# takes two optional trailing args and ``device/load`` two, ``source``
# (``place:<name>`` / ``library`` / ``pack:<name>``) and ``rel`` (the path
# inside it), so a load names its Place instead of relying on a root typed
# into the config; an empty preset path is filled in from the Place. Record
# arities are unchanged; a 3.10.0 surface would refuse the arg counts.
SUPPORTED_VERSIONS: tuple = (
    "3.11.0", "3.10.0", "3.9.0", "3.8.0", "3.7.0", "3.6.0", "3.5.0", "3.4.0", "3.3.0", "3.2.0", "3.1.0", "3.0.0",
)

# Handshake timeout per the [06 §2] decision above.
DEFAULT_SESSION_TIMEOUT_SECONDS: float = 30.0

# Closed-enum error code per [04 §7.2].
HANDSHAKE_VERSION_MISMATCH_CODE = "handshake-version-mismatch"


@dataclass
class Session:
    """One negotiated protocol session.

    Not load-bearing for wire correctness — the sessionId is carried in
    the accept reply and is useful for correlating logs across the
    bridge and surface. Per [04 §8.4].
    """

    session_id: str
    version: str
    created_at: float
    last_activity_at: float = 0.0
    # Source address of the UI that initiated the session. Kept for
    # diagnostics (log "session ABC123 from 127.0.0.1:54321") and for
    # future per-UI routing if the surface ever supports multiple
    # concurrent UIs.
    source_addr: Optional[tuple] = field(default=None)


class HandshakeComponent:
    """Handles ``/looping/v3/handshake/hello`` and mints sessions.

    Args:
        emit: ``callable(address, args)`` — the transport's ``send``.
        generation_component: A ``GenerationComponent`` instance. The
            accept reply carries the current generation so the UI's
            mirror starts in sync.
        now: Clock for session bookkeeping; defaults to ``time.time``.
            Injected for deterministic testing.
        session_id_factory: Mints new session ids. Defaults to UUID4
            hex; tests override with a counter for stable IDs.
        timeout_seconds: Session liveness window. A hello arriving for
            a dead session makes a fresh one. See the module docstring.

    Sessions are held in a dict keyed by ``session_id``. A new hello
    from a UI that hasn't stored a session_id yet always mints a new
    session. The component does not reject concurrent UIs; each hello
    gets its own session (single-UI-per-surface is the product reality
    but the protocol doesn't enforce it).
    """

    def __init__(
        self,
        emit: Callable,
        generation_component,
        now: Optional[Callable[[], float]] = None,
        session_id_factory: Optional[Callable[[], str]] = None,
        timeout_seconds: float = DEFAULT_SESSION_TIMEOUT_SECONDS,
    ):
        import time as _time

        self._emit = emit
        self._generation = generation_component
        self._now = now if now is not None else _time.time
        self._session_id_factory = (
            session_id_factory
            if session_id_factory is not None
            else lambda: uuid.uuid4().hex
        )
        self._timeout = float(timeout_seconds)
        self._sessions: dict[str, Session] = {}
        self._disconnected = False
        # Post-accept state-delivery hook. Wired by ``LoopingSurface`` to
        # ``V3StateFullComponent.emit_on_accept`` so every handshake
        # completion delivers a fresh tree to the newly-connected UI.
        # Per [04 §8.5]. Not optional at runtime — a ``None`` here means
        # the surface forgot to wire it, which would leave UIs with an
        # empty tree. Logged loudly in ``_kick_state_delivery``.
        self._on_accept_state_full: Optional[Callable[[], None]] = None

    # --- wiring -----------------------------------------------------------

    def set_state_full_on_accept(self, fn: Callable[[], None]) -> None:
        """Register the post-accept state-delivery hook.

        Called once at surface bring-up by ``LoopingSurface``. The hook
        fires after ``handle_hello`` emits ``accept`` — per [04 §8.5],
        accept is the trigger for state/full delivery in v3.
        """
        self._on_accept_state_full = fn

    # --- handler ----------------------------------------------------------

    def handle_hello(self, args, source_addr):
        """``/looping/v3/handshake/hello [versions:string[]]``.

        Intersects the UI's advertised versions with SUPPORTED_VERSIONS,
        picks the highest common version, mints a session, and replies
        with ``accept`` carrying ``(version, sessionId, generation)``.

        If no common version: replies with ``/looping/v3/error
        [address, handshake-version-mismatch, "", detail]``. UI should
        surface this to the user rather than retry silently.
        """
        if self._disconnected:
            return None

        if not args:
            logger.warning(
                "HandshakeComponent: hello with no versions (source=%s)",
                source_addr,
            )
            self._emit_error(
                "hello must carry at least one version",
                source_addr,
            )
            return None

        # Protocol 3.5.0: a client may declare the ETag of the tree it
        # already holds inside the otherwise-variadic version list,
        # namespaced as ``etag:0x...``. Strip it before intersecting —
        # it is not a version, and an unstripped one would just fail to
        # match (which is exactly why a 3.4.0 surface can ignore it
        # safely and this bump needs no fallback).
        args, client_etag = extract_etag(args)
        ui_versions = self._coerce_versions(args)
        if not ui_versions:
            logger.warning(
                "HandshakeComponent: hello with no valid versions: %r",
                args,
            )
            self._emit_error(
                "hello carried no parseable version strings",
                source_addr,
            )
            return None

        negotiated = self._pick_version(ui_versions)
        if negotiated is None:
            logger.warning(
                "HandshakeComponent: no common version. "
                "UI=%r Surface=%r (source=%s)",
                ui_versions, list(SUPPORTED_VERSIONS), source_addr,
            )
            detail = "UI: %s, Surface: %s" % (
                ",".join(ui_versions), ",".join(SUPPORTED_VERSIONS),
            )
            self._emit_error(detail, source_addr)
            return None

        # Prune stale sessions before minting a new one. Keeps the dict
        # from growing unboundedly across hours of reconnects.
        self._evict_stale_sessions()

        session_id = self._session_id_factory()
        t = self._now()
        session = Session(
            session_id=session_id,
            version=negotiated,
            created_at=t,
            last_activity_at=t,
            source_addr=source_addr,
        )
        self._sessions[session_id] = session

        gen = self._generation.current
        logger.info(
            "Handshake accepted: version=%s session=%s gen=%d source=%s",
            negotiated, session_id, gen, source_addr,
        )
        self._safe_emit(
            V3_HANDSHAKE_ACCEPT_ADDRESS,
            (negotiated, session_id, int(gen)),
        )
        # Deliver the tree. Per [04 §8.5]: accept is the cold-start /
        # reconnect state-delivery trigger. Fire after the accept emit
        # so the UI sees accept before the state/full/tree and
        # can stamp sessionId/generation into its store before the
        # state/full handler populates the tree.
        self._kick_state_delivery(session_id, client_etag)
        return None

    def _kick_state_delivery(
        self, session_id: Optional[str] = None,
        client_etag: Optional[int] = None,
    ) -> None:
        """Fire the post-accept state-delivery hook, if wired.

        Swallows exceptions — a broken hook must not prevent the
        accept from having succeeded. The UI still has a valid
        session; it can fall back to an explicit ``/looping/v3/state/
        resync`` if it notices it has no tree yet.

        ``session_id`` / ``client_etag`` carry the 3.5.0 ETag context
        so the publisher can answer "you already have this" instead of
        re-shipping the tree. Passed positionally through a hook whose
        older form took no arguments, so the call is guarded — a
        surface wired to a pre-3.5.0 publisher degrades to a full send
        rather than a TypeError on the control thread.
        """
        hook = self._on_accept_state_full
        if hook is None:
            logger.error(
                "HandshakeComponent: accept hook not wired — UI will "
                "have an accepted session but no tree. This is a "
                "wiring bug in LoopingSurface.",
            )
            return
        try:
            try:
                hook(session_id=session_id, client_etag=client_etag)
            except TypeError:
                # Hook predates the ETag arguments (older publisher, or
                # a test double). Full send is the safe answer.
                hook()
        except Exception as e:
            logger.error(
                "HandshakeComponent: post-accept state-delivery hook "
                "raised (%s); UI may need an explicit state/resync",
                e, exc_info=True,
            )

    # --- session management ----------------------------------------------

    def active_session_ids(self) -> List[str]:
        """Return the list of currently-active session ids.

        Used by diagnostics; not on the hot path. ``_evict_stale_sessions``
        is called first so only live sessions show.
        """
        self._evict_stale_sessions()
        return list(self._sessions.keys())

    def touch(self, session_id: str) -> bool:
        """Mark a session active; returns ``False`` if the id is unknown.

        Called by the other v3 handlers (``DevicesComponent.handle_set_param_v3``
        etc.) when they observe an operation that should count as session
        activity. Keeps a quiet UI from expiring mid-gesture.

        Phase 1 doesn't actually wire this call from DevicesComponent —
        the 30s timeout is generous enough that gestures won't be
        affected, and keeping the cross-component call-graph minimal
        shrinks Phase 1's risk surface. This method exists so Phase 2
        UI-client work can opt in if needed.
        """
        s = self._sessions.get(session_id)
        if s is None:
            return False
        s.last_activity_at = self._now()
        return True

    def _evict_stale_sessions(self) -> None:
        now = self._now()
        stale = [
            (sid, now - s.last_activity_at)
            for sid, s in self._sessions.items()
            if (now - s.last_activity_at) > self._timeout
        ]
        for sid, idle in stale:
            logger.info(
                "HandshakeComponent: evicting stale session %s "
                "(idle %.1fs > timeout %.1fs)",
                sid, idle, self._timeout,
            )
            self._sessions.pop(sid, None)

    # --- version negotiation ---------------------------------------------

    @staticmethod
    def _coerce_versions(args) -> List[str]:
        """Turn OSC args into a version-string list, best-effort.

        OSC carries string args as bytes on the wire; the codec already
        decodes. Anything non-string gets dropped with a warning. Empty
        strings are dropped too.
        """
        out: List[str] = []
        for a in args:
            if isinstance(a, (bytes, bytearray)):
                try:
                    s = a.decode("utf-8")
                except UnicodeDecodeError:
                    continue
            else:
                s = str(a)
            s = s.strip()
            if s:
                out.append(s)
        return out

    @staticmethod
    def _pick_version(ui_versions: List[str]) -> Optional[str]:
        """Pick the highest version common to UI and SUPPORTED_VERSIONS.

        With the current singleton SUPPORTED_VERSIONS this is trivially
        "does 3.0.0 appear in the UI list". The loop keeps the shape
        right for the day we're advertising 3.1.0 / 3.0.0 and need
        preference ordering.
        """
        supported_set = set(SUPPORTED_VERSIONS)
        common = [v for v in ui_versions if v in supported_set]
        if not common:
            return None
        # Sort by numeric (major, minor, patch). Non-numeric tags (beta
        # releases) fall back to string sort within their tuple slot.
        def _key(v: str):
            parts = v.split(".")
            out = []
            for p in parts:
                try:
                    out.append((0, int(p)))
                except ValueError:
                    out.append((1, p))
            return tuple(out)
        return sorted(common, key=_key, reverse=True)[0]

    # --- error emit -------------------------------------------------------

    def _emit_error(self, detail: str, source_addr) -> None:
        """``/looping/v3/error [hello_address, code, "", detail]``.

        Path arg is empty per [04 §7.1] because handshake errors aren't
        path-specific.
        """
        self._safe_emit(
            V3_ERROR_ADDRESS,
            (
                V3_HANDSHAKE_HELLO_ADDRESS,
                HANDSHAKE_VERSION_MISMATCH_CODE,
                "",
                detail,
            ),
        )

    def _safe_emit(self, address: str, args) -> None:
        try:
            self._emit(address, args)
        except Exception as e:
            logger.error(
                "HandshakeComponent: emit failed for %s: %s (args=%r)",
                address, e, args,
            )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Drop all sessions; idempotent."""
        if self._disconnected:
            return
        self._disconnected = True
        self._sessions.clear()
