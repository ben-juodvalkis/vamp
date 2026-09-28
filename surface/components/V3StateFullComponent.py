"""V3StateFullComponent — the v3 canonical tree publisher.

Emits the v3 tree using **positional paths** per
[04 §3.2 / §5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#32-state-full-chunking).
Wire address (protocol 3.6.0 — one message, no chunking):

    /looping/v3/state/full/tree  [reason, generation, etag, scope, *tree_args]

The four header args are **positional and always present**. ``scope``
is ``""`` for a whole-song bundle, else the ``tracks/<N>`` or
``master`` path whose subtree the bundle covers (``reason=
'selection-change'``). Fixed arity is deliberate: the predecessor
``begin`` carried an *optional* 5th scope arg, which meant a parser
had to infer meaning from length.

## Why one message

Until 3.6.0 the tree shipped as ``begin → chunk… → end`` because it
had to fit darwin's 9,216-byte UDP datagram cap — a realistic set took
99 chunks. Since the ordered TCP leg landed (port 11022) there is no
datagram ceiling, and 389 KB goes out in a single write. The framing,
the per-chunk budget and the end-to-end integrity checksum all existed
to serve the split; with the split gone they were carrying nothing.

**There is no UDP fallback.** A 389 KB message does not fit a datagram,
and the machinery that made it fit is what 3.6.0 deleted. When no
stream peer is connected the publish logs a warning, **leaves the memo
untouched**, and returns; ``on_stream_peer_connected`` clears the memo
and republishes the moment the bridge dials in. That is the whole
safety net.

Tree_args layout per [04 §5] and the UI-side contract in
[v3StateFull.ts parser](../../interface/src/lib/api/handlers/v3StateFull.ts).
Records are depth-first in LOM position order:

- ``T`` track:   ``trackPath, name, color:int, mute:int(0|1), solo:int(0|1), arm:int(0|1), hasMidiInput:int(0|1), hasAudioInput:int(0|1), hasArrangementClips:int(0|1), volume:float, isFoldable:int(0|1), foldState:int(0|1), groupTrackIndex:int``
- ``D`` device:  ``devicePath, name, className`` (ROW 5 / 3.3.0; legacyId field retired)
- ``P`` param:   ``paramPath, name, displayName, min:float, max:float, value:float, unit``
- ``S`` slot:    ``slotPath, state:int (0=empty,1=has_clip,2=playing,3=recording)``
- ``C`` clip:    ``clipPath, name, length:float, color:int, pitch:float``

ETag: a **surface-local** digest of the tree, on the wire as
``"0x12345678"``. Not a cross-language contract — see
``_compute_checksum`` for what is and is not required of it.

## Triggers

- ``emit_on_accept()``: called by ``HandshakeComponent`` after it
  emits the ``accept`` reply. This is the cold-start / reconnect
  state-delivery path per [04 §8.5]. Prior to PR-3b the surface
  emitted at bring-up with ``reason="init"``; that fired to a UDP
  socket with no listener when the UI connected after Live had
  finished loading, leaving UIs with an accepted session but an
  empty tree. ``accept``-driven emission has a guaranteed listener.
- ``on_structural_change()``: hooked into ``LOMListeners``'s
  structural-change composite callback in ``LoopingSurface``. Fires
  once per ``tracks_changed`` / ``devices_changed`` event.
- ``emit_on_resync()``: hook for UI-initiated ``/looping/v3/state/
  resync``. The UI uses this only for packet-loss recovery
  per [07 §2.4] — cold-start and reconnect are both served by
  ``emit_on_accept``.

## Generation

Generation is owned by ``GenerationComponent``. This emitter reads
``generation_component.current`` at emit time. It does NOT advance
generation — the structural-change callback composite in
``LoopingSurface`` advances generation first, then invokes this
emitter. Ordering matters: the ``state/invalidate`` fires from
InvalidationComponent's ``on_advance`` hook before the tree reaches
the wire, so the UI sees invalidate → full (or: current-gen full only,
no mid-apply param/value fires from the pre-advance tree).

## Why a new component rather than extending StateFullComponent

The v2 emitter walks with ``_safe_int_id`` to produce pointer-
identity ids. v3 walks with ``path_resolver.compose_*`` to produce
path strings. The two walks share no code paths — the v2 walk is
legacy scaffolding, and its exit at Phase 4 is a file-delete. Keeping
them separate makes that delete trivial.
"""


from __future__ import annotations

import hashlib
import logging
from typing import Any, Callable, Dict, Optional, Tuple

try:  # pragma: no cover - import shape mirrors TrackPrepareComponent
    from .LOMListeners import _safe_int_id
except Exception:  # pragma: no cover
    _safe_int_id = None  # type: ignore[assignment]

# The role key and its unset sentinel are owned by the component that
# *writes* them; this one only reads them back onto the T record.
# The pad-chain grammar (issue #491, protocol 3.8.0): a pad-scoped bundle
# resolves its pad here and composes its records' paths the same way.
from .drum_vm_functions import REASON_PAD_CHAIN, _is_instrument
from .path_resolver import (
    ResolveStatus,
    compose_chain_device_path,
    compose_param_path_under,
    is_pad_scoped,
    resolve_pad,
)
from .TrackMetadataComponent import (  # noqa: E402
    TRACK_ROLE_DATA_KEY,
    TRACK_ROLE_UNSET,
    held_preset,
)

logger = logging.getLogger("looping")


# Wire addresses — module constants so renames fail at import time, not runtime.
#
# Protocol 3.6.0: one message replaces ``begin`` / ``chunk`` / ``end``.
V3_STATE_FULL_TREE_ADDRESS = "/looping/v3/state/full/tree"

# Header args ahead of the tree payload: reason, generation, etag, scope.
_HEADER_ARITY = 4

# Scope value for a whole-song bundle. Positional, so it is a value
# rather than an omitted argument.
_WHOLE_SONG_SCOPE = ""

# Protocol 3.5.0. Answer to a client that asked for the tree while
# already holding the current one: "what you have is correct, here is
# the generation to stamp on it."
#
# Carries ``sessionId`` because the surface has no per-client channel —
# every emit goes to the bridge, which fans out to every connected UI.
# A Mac and an iPad hold independently-aged trees, so a marker minted
# for one must be ignorable by the other. (The full-tree path has the
# same fan-out, but a spare copy of the current truth harms nobody,
# which is why only the marker needs the tag.)
V3_STATE_FULL_UNCHANGED_ADDRESS = "/looping/v3/state/full/unchanged"

# Prefix marking a client-declared ETag inside an otherwise
# variadic argument list.
#
# ``handshake/hello`` carries an open-ended list of version strings, so
# a bare trailing checksum would be indistinguishable from a version a
# future surface might understand. An explicitly namespaced token is
# unambiguous in both directions: a 3.4.0 surface simply fails to match
# ``etag:0x...`` against its version tuple and ignores it, and a 3.5.0
# surface strips it before intersecting. ``state/resync`` uses the same
# prefix purely so one shape is learned once.
ETAG_PREFIX = "etag:"

# Trailing-edge debounce window for structural / selection-change
# republishes. Plugin hydration (Omnisphere et al.) fires the
# `device:parameters` listener several times per device as the AU
# finishes booting; without coalescing each fire triggers a full LOM
# walk + chunked emit. Live's tick is ~100ms, so `_schedule_delayed`
# rounds 75ms up to one tick — the effective window is one tick, well
# inside the 50-100ms range the perf audit recommends. See issue #387.
_STATE_FULL_DEBOUNCE_MS = 75

# Issue #491 (3.8.0): the reason a pad-scoped bundle carries — answers a
# pad-chain subscription, and is never memo-suppressed — is
# ``drum_vm_functions.REASON_PAD_CHAIN``, the same name the pad-chain
# component advances the generation with.

# Masks the ETag (and the generation) into OSC's signed ``i`` typetag.
_INT31_MASK = 0x7FFFFFFF

# Slot state ordinals — wire contract per [04 §5] / v3StateFull.ts slotStateFromInt.
_SLOT_STATE_EMPTY = 0
_SLOT_STATE_HAS_CLIP = 1
_SLOT_STATE_PLAYING = 2
_SLOT_STATE_RECORDING = 3


# Tuple of exceptions every LOM read on hot paths must catch.
# Includes ``TypeError`` for ``Boost.Python.ArgumentError`` per
# [CLAUDE.md] merge-gate rule (9). Used by the S/C walk so a half-
# torn-down slot during structural change degrades to state=0
# instead of aborting the chunk.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# How many scopes ``_ChecksumMemo`` retains. Scope keys are ``None``
# (whole-song), ``master``, and ``tracks/<N>``, so the live working
# set is bounded by track count — but the keys are *paths*, and a long
# session that adds and deletes tracks keeps minting new ones. The
# predecessor dict was unbounded and only held an int, so the leak was
# invisible; an entry now carries a tree snapshot, so it is not.
_CHECKSUM_MEMO_MAX_SCOPES = 32


class _ChecksumMemo:
    """Per-scope memo of one walk's ``(tree_args, checksum)`` pair.

    Why this exists
    ---------------

    Hashing the tree is the single most expensive thing a publish
    does. Measured on a realistic set (20 tracks x 4 heavy devices,
    41,734 elements) the fold is ~34 ms of Live's control thread, and
    the chunk split ahead of it another ~9 ms. But most publishes
    re-hash a tree that has not changed at all: the checksum
    short-circuit exists precisely because duplicate whole-song
    republishes are common (issue #387's "selection-change x3 with the
    same checksum"), and every reconnect re-walks an untouched tree.

    Comparing the tree to the last one is ~250x cheaper than hashing
    it. Python's list ``==`` runs in C and short-circuits on the first
    mismatch, so on a realistic set it costs 0.26 ms when the trees
    are equal and is unmeasurable when they differ — versus 43 ms to
    split and hash.

    Why a class rather than two dicts
    ---------------------------------

    The tree and its checksum must come from the same walk. Two
    parallel dicts make that an invariant every call site has to
    remember; one entry makes it structural. The predecessor here was
    a bare ``Dict[scope, int]`` updated at one site and read at
    another.

    Exactness, not hash-equality
    ----------------------------

    The old short-circuit compared 31-bit checksums, so a collision
    (~1 in 2^31) would silently suppress a real update — a stuck UI
    with no error anywhere. Comparing the trees themselves removes
    that failure mode: a hit means the tree is genuinely identical,
    not merely hash-equal.
    """

    __slots__ = ("_entries", "_max_scopes")

    def __init__(self, max_scopes: int = _CHECKSUM_MEMO_MAX_SCOPES):
        # Insertion-ordered; oldest evicted first. Plain dict is
        # insertion-ordered on every Python Live ships, and re-inserting
        # on touch is all the recency tracking this needs.
        self._entries: Dict[Optional[str], Tuple[list, int]] = {}
        self._max_scopes = max_scopes

    def lookup(self, scope: Optional[str], tree_args: list) -> Optional[int]:
        """Return the cached checksum iff ``tree_args`` is unchanged.

        ``None`` means "not the same tree" — either nothing is cached
        for this scope or the walk produced something different. The
        caller must then compute the checksum itself.
        """
        entry = self._entries.get(scope)
        if entry is None:
            return None
        cached_tree, checksum = entry
        if cached_tree != tree_args:
            return None
        # Touch for recency so a hot scope isn't evicted by churn on
        # cold ones.
        del self._entries[scope]
        self._entries[scope] = entry
        return checksum

    def record(self, scope: Optional[str], tree_args: list,
               checksum: int) -> None:
        """Cache the tree and checksum for ``scope``.

        Call **after a successful emit**, never before: an emit that
        raised part-way left the UI with an incomplete bundle, and
        recording would suppress the retry that fixes it.
        """
        # Shallow copy. Elements are str/int/float/bool — immutable, so
        # shallow is sufficient — and it costs 0.08 ms at realistic
        # scale. The caller's list is freshly built per walk today, so
        # aliasing would be safe right now; copying keeps it safe if
        # ``_build_payload`` ever starts reusing a buffer.
        self._entries.pop(scope, None)
        self._entries[scope] = (list(tree_args), checksum)
        while len(self._entries) > self._max_scopes:
            # Evicting only costs a recomputation next time round; the
            # memo is an optimisation, never a source of truth.
            self._entries.pop(next(iter(self._entries)))

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)


class V3StateFullComponent:
    """Publishes the v3 chunked state/full bundle.

    Args:
        song: The Live ``Song`` — walked directly on every publish.
        emit: ``callable(address, args)`` — the transport's ``send``.
        generation_component: Source of the authoritative generation
            int for the begin envelope. The structural-change callback
            composite in ``LoopingSurface`` advances this before
            invoking us, so our read always reflects the current
            generation.
        schedule_delayed: Optional ``(delay_ms, fn) -> None`` adapter
            for the trailing-edge debounce on structural and
            selection-change publishes. When ``None`` (tests, or
            contexts that opt out) every publish fires immediately
            and behavior is identical to the pre-debounce emitter.
    """

    def __init__(
        self,
        song,
        emit: Callable,
        generation_component,
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        stream=None,
    ):
        self._song = song
        self._emit = emit
        # Optional ordered stream (``TCPTransport``). When one is
        # connected the bundle goes over it instead of UDP; see
        # ``_select_transport``.
        self._stream = stream
        self._generation_component = generation_component
        self._schedule_delayed = schedule_delayed
        self._disconnected = False
        # Per-scope coalescing state. Scope ``None`` means whole-song;
        # other keys are track paths (``master``, ``tracks/<N>``). Only
        # ``structural`` and ``selection-change`` emits are debounced —
        # ``accept`` and ``resync`` always fire immediately because the
        # UI is actively waiting on them.
        self._pending_reasons: Dict[Optional[str], str] = {}
        self._timer_armed: Dict[Optional[str], bool] = {}
        # Per-scope memo of the last successfully-emitted tree and its
        # checksum. Lets ``_publish_now`` skip the split, the hash and
        # the begin/chunk/end emit when a fresh walk produced an
        # identical tree (the Omnisphere "selection-change x3 with
        # same checksum" pattern from issue #387).
        self._checksum_memo = _ChecksumMemo()

    # --- public surface --------------------------------------------------

    def set_song(self, song) -> None:
        """Rebind the captured song reference.

        Used by ``LoopingSurface``'s song-change handler (PR-3c): when
        ``SongChangeDetector`` reports a File → Open drift, the
        surface rebinds this emitter's song to the new object so the
        subsequent ``emit_structural`` walk visits the new set's
        tracks/devices/params rather than the (now garbage-collected)
        old set. ``LOMListeners``-style listener re-attachment is NOT
        done here — see the ``SongChangeDetector`` module docstring
        for the scope rationale.
        """
        self._song = song
        # Old-song trees are meaningless against the new set. Clearing
        # prevents a stale entry from suppressing the post-rebind emit.
        self._checksum_memo.clear()

    def on_stream_peer_connected(self) -> None:
        """A fresh stream peer appeared — republish unconditionally.

        Two things happen here, and the second is easy to miss.

        The memo records what the *surface* last sent. That only proxies
        for "what the far side holds" while the far side stays the same,
        so a new peer invalidates it — without the clear, the next
        publish would find the tree unchanged and skip, leaving the new
        peer with nothing. Same reasoning as ``set_song``: the thing the
        cache was about has been replaced.

        Then republish. Over UDP a bundle sent with nobody listening was
        simply lost, and that was survivable because the next LOM change
        would resend it. The more ``state/full`` depends on the stream,
        the less that backstop holds — a bundle produced while the
        bridge was redialling would strand the UI with a session and a
        stale tree until something unrelated changed. Republishing on
        connect closes that window instead of betting it stays short.
        """
        if self._disconnected:
            return
        self._checksum_memo.clear()
        logger.info(
            "V3StateFullComponent: stream peer connected — republishing",
        )
        self._publish(reason="structural")

    def emit_structural(self) -> None:
        """Explicit entry point: emit ``reason='structural'``.

        Semantically identical to ``on_structural_change`` — both
        funnel to ``_publish("structural")`` — but named from the
        caller's perspective rather than the listener's. The PR-3c
        song-change handler in ``LoopingSurface`` uses this name so
        the call site reads as "emit a structural invalidation now"
        without implying a listener fire.
        """
        if self._disconnected:
            return
        self._publish(reason="structural")

    def emit_on_accept(
        self, session_id: Optional[str] = None,
        client_etag: Optional[int] = None,
    ) -> None:
        """Post-handshake-accept tree delivery. ``reason='accept'``.

        Per [04 §8.5]: accept is the cold-start / reconnect state-
        delivery trigger. Called by ``HandshakeComponent`` after it
        emits the accept reply so the UI sees accept (stamps
        sessionId/generation) before the ``state/full/tree``
        lands. Bypasses the debounce so the UI doesn't wait an extra
        tick after handshake.

        Protocol 3.5.0: when the reconnecting UI declared an ETag in
        its hello and it matches the current tree, this answers with
        the ``unchanged`` marker instead of re-shipping a tree the
        client already has. Cold starts declare nothing and are
        unaffected.
        """
        if self._disconnected:
            return
        self._publish_now(
            reason="accept", session_id=session_id, client_etag=client_etag,
        )

    def on_structural_change(self) -> None:
        """Hook for listener rebuilds. Republishes with ``reason='structural'``."""
        if self._disconnected:
            return
        self._publish(reason="structural")

    def emit_on_resync(
        self, session_id: Optional[str] = None,
        client_etag: Optional[int] = None,
    ) -> None:
        """Hook for ``/looping/v3/state/resync``. ``reason='resync'``.

        UI-initiated packet-loss recovery path per [07 §2.4]. Cold-start
        and reconnect are served by ``emit_on_accept`` — the UI does not
        need to fire resync for either case in v3 post-PR-3b. Bypasses
        the debounce because the UI just asked for a fresh tree.

        Protocol 3.5.0: honours a client-declared ETag exactly as
        ``emit_on_accept`` does. Note the asymmetry with packet loss —
        a UI that lost chunks has an *incomplete* tree, so it must
        declare no ETag (or a stale one) to get a real resend. That is
        the client's call to make: the surface cannot tell a
        successfully-applied bundle from a half-applied one.
        """
        if self._disconnected:
            return
        self._publish_now(
            reason="resync", session_id=session_id, client_etag=client_etag,
        )

    def emit_selection_change(self, track_path: str) -> None:
        """Emit a scoped ``state/full`` for a single track subtree.

        Phase 12 pr12-2. ``reason='selection-change'``, scope=track_path.

        The payload walks exactly one track via ``_track_section`` —
        master when ``track_path == 'master'`` or
        ``tracks/<N>`` otherwise. Chunking, checksum, and the
        begin/chunk/end framing are identical to the whole-song path;
        the only wire difference is an optional 5th arg on ``begin``
        carrying the scope string so the UI can apply chunks to the
        subtree rooted at that path without wiping unrelated paths.

        Unresolvable paths (``returns/<N>`` today, out-of-range
        indices, or malformed strings) emit nothing. The caller
        (``SelectedTrackComponent`` after pr12-4) already skips
        return-track selection; this is a defense-in-depth guard.

        Additive on the wire: UIs that haven't learned to read the
        scope arg yet still see a coherent begin/chunk/end bundle.
        They'll interpret the scoped bundle as if it were a whole-
        song emission and may fail to apply — which is why pr12-2
        does not rebind ``SelectedTrackComponent.schedule_state_full``
        to this path. pr12-4 makes the switch after pr12-3 teaches
        the UI to honor scope.
        """
        if self._disconnected:
            return
        self._publish(reason="selection-change", scope=track_path)

    def emit_pad_chain(self, pad_path: str) -> None:
        """Emit a pad-scoped ``state/full`` (issue #491, protocol 3.8.0):
        reason ``pad-chain``, scope the pad path, D and P records for the
        effects on that pad's chain under ``…/pads/<note>/devices/<i>``.

        Sent now rather than debounced — ``DrumPadChainComponent`` has
        already deferred the structural fire — and past the unchanged-
        tree memo, because a bundle answers a subscription: a client
        that dropped its pad map on unsubscribe needs the records again
        even when nothing changed. An empty bundle (every effect gone)
        is a real answer and is sent; only an unresolvable pad path
        emits nothing.
        """
        if self._disconnected:
            return
        self._publish_now(reason=REASON_PAD_CHAIN, scope=pad_path)

    # --- core ------------------------------------------------------------

    def _publish(self, reason: str, scope: str = None) -> None:
        """Trailing-edge debounced entry point. Coalesces bursts of
        ``structural`` / ``selection-change`` fires per scope.

        When ``schedule_delayed`` was not wired at construction (tests
        and a few opt-out paths), falls through to ``_publish_now``
        immediately so behavior is unchanged.

        Within the debounce window, the latest ``reason`` for a given
        scope wins — last-write-wins. Subsequent calls for the same
        scope do not re-arm the timer; the originally-scheduled fire
        picks up whatever reason was last stashed.
        """
        if self._schedule_delayed is None:
            self._publish_now(reason, scope)
            return

        self._pending_reasons[scope] = reason

        if self._timer_armed.get(scope):
            return
        self._timer_armed[scope] = True

        try:
            self._schedule_delayed(
                _STATE_FULL_DEBOUNCE_MS,
                lambda s=scope: self._fire_pending(s),
            )
        except Exception as e:
            # Scheduler failed — degrade to inline publish so the
            # change isn't dropped, and reset the bookkeeping for this
            # scope so a future fire can re-arm.
            self._timer_armed.pop(scope, None)
            pending = self._pending_reasons.pop(scope, reason)
            logger.warning(
                "V3StateFullComponent: schedule_delayed failed (%s); "
                "publishing inline (reason=%s, scope=%s)",
                e, pending, scope,
            )
            self._publish_now(pending, scope)

    def _fire_pending(self, scope: Optional[str]) -> None:
        """Trailing-edge handler. Pops the pending reason for the
        scope, clears the armed flag, and runs the publish."""
        self._timer_armed.pop(scope, None)
        if self._disconnected:
            self._pending_reasons.pop(scope, None)
            return
        reason = self._pending_reasons.pop(scope, None)
        if reason is None:
            return
        try:
            self._publish_now(reason=reason, scope=scope)
        except Exception as e:
            # _publish_now already swallows internal exceptions; this
            # is defense-in-depth so a stray Live tick callback raise
            # doesn't tear down the scheduler thread.
            logger.error(
                "V3StateFullComponent: debounced publish raised "
                "(reason=%s, scope=%s): %s",
                reason, scope, e, exc_info=True,
            )

    def _publish_now(
        self, reason: str, scope: str = None,
        session_id: Optional[str] = None,
        client_etag: Optional[int] = None,
    ) -> None:
        """Build tree_args and emit one ``state/full/tree``. Never raises.

        ``scope`` is ``None`` for a whole-song bundle — it reaches the
        wire as the empty string, because the header is positional.
        A resolvable track path emits that track's subtree instead.
        Callers wanting scoped emission use ``emit_selection_change``;
        ``_publish_now`` itself is private.
        """
        generation = self._generation_component.current & _INT31_MASK

        try:
            if scope is None:
                tree_args = self._build_payload()
            else:
                tree_args = self._build_scoped_payload(scope)
        except Exception as e:
            # Whole song: an empty tree is the honest answer. A scope: an
            # empty bundle is a *statement* — for a pad, "every effect
            # gone", which the UI applies by emptying the pad — so a
            # failed build is suppressed instead (code review of ADR-430).
            logger.error(
                "V3StateFullComponent: build_payload raised (%s); %s "
                "(generation=%d, scope=%s)",
                e, "emitting empty-tree bundle" if scope is None else "suppressing the scoped bundle",
                generation, scope, exc_info=True,
            )
            tree_args = [] if scope is None else None

        # A scoped publish with an unresolvable path yields no tree.
        # Skip the wire altogether rather than shipping an apply the UI
        # would have to ignore. (An *empty* tree is different — a pad
        # whose effects were all deleted answers with none — and ships.)
        if scope is not None and tree_args is None:
            logger.info(
                "V3StateFullComponent: scoped publish suppressed — "
                "unresolvable scope=%s (reason=%s, generation=%d)",
                scope, reason, generation,
            )
            return

        # Ask the memo before hashing. A hit means this walk produced
        # an identical tree to the one we last shipped on this scope,
        # so we already know its ETag and can skip the digest.
        cached = self._checksum_memo.lookup(scope, tree_args)
        checksum = cached if cached is not None else _compute_checksum(tree_args)
        checksum_hex = "0x%08x" % checksum

        # --- client-declared ETag (protocol 3.5.0) ---------------------
        #
        # ``accept`` and ``resync`` used to be excluded from the
        # unchanged-tree skip below, and had to be: the memo records
        # what the *surface* last sent, which says nothing about what
        # the asking client currently holds. That was wrong twice over
        # — on reconnect (the UI may have dropped state) and with two
        # UIs connected, where "last sent" is one client's history
        # being used to answer the other's question.
        #
        # A client that declares what it holds replaces the guess with
        # a fact, so these paths get an informed decision rather than a
        # blanket bypass. Declaring nothing still ships the tree, which
        # keeps cold starts and pre-3.5.0 UIs on exactly the old
        # behaviour.
        if (
            tree_args
            and client_etag is not None
            and client_etag == checksum
        ):
            logger.info(
                "V3StateFullComponent: state/full unchanged — client "
                "holds current tree (reason=%s, generation=%d, "
                "tree_args=%d, checksum=%s, scope=%s, session=%s)",
                reason, generation, len(tree_args), checksum_hex,
                scope, session_id,
            )
            self._safe_emit_unchanged(reason, generation, session_id, checksum_hex)
            # Record it: the tree the client holds is now known-good on
            # this scope, so a later structural fire on the same tree
            # can short-circuit instead of re-hashing.
            self._checksum_memo.record(scope, tree_args, checksum)
            return

        # Unchanged-tree short-circuit for *pushes*. Nobody asked, so
        # there is no client ETag to consult; what the surface last
        # shipped is the only signal available, and it is the right one
        # for "has anything changed at all". The UI's last-applied
        # bundle is still authoritative, so skip the emit entirely.
        # Saves bandwidth (~390 KB per duplicate whole-song republish)
        # but not the LOM walk; the debounce cuts walks for fires that
        # arrive within the same tick.
        #
        # ``accept`` and ``resync`` stay excluded here: a client that
        # asked and did *not* declare a matching ETag must get a tree,
        # never silence.
        if (
            tree_args
            and cached is not None
            and reason not in ("accept", "resync", REASON_PAD_CHAIN)
        ):
            logger.info(
                "V3StateFullComponent: state/full skipped — tree "
                "unchanged (reason=%s, generation=%d, tree_args=%d, "
                "etag=%s, scope=%s)",
                reason, generation, len(tree_args), checksum_hex, scope,
            )
            return

        send = self._stream_send()
        if send is None:
            # No stream, no send. The tree outgrew UDP the moment
            # chunking went away — 389 KB against a 9,216-byte
            # datagram cap — so there is nothing to fall back to.
            #
            # The memo is deliberately left untouched: it records what
            # the far side holds, and nothing was delivered. That keeps
            # ``on_stream_peer_connected``'s republish from being
            # short-circuited as a duplicate when the bridge dials in,
            # which is the entire safety net for this branch.
            logger.warning(
                "V3StateFullComponent: no stream peer — state/full "
                "not sent (reason=%s, generation=%d, tree_args=%d, "
                "scope=%s); will republish on peer connect",
                reason, generation, len(tree_args), scope,
            )
            return

        # Positional header, then the flat record stream. ``scope`` is
        # the empty string for whole-song rather than an omitted arg —
        # a fixed arity means the parser never infers meaning from
        # message length.
        args = (
            reason,
            generation,
            checksum_hex,
            _WHOLE_SONG_SCOPE if scope is None else scope,
        ) + tuple(tree_args)

        try:
            delivered = send(V3_STATE_FULL_TREE_ADDRESS, args)
        except Exception as e:
            logger.error(
                "V3StateFullComponent: state/full emit failed (%s); "
                "nothing delivered (generation=%d, scope=%s)",
                e, generation, scope, exc_info=True,
            )
            return

        # ``TCPTransport.send`` RETURNS False rather than raising for the
        # three ways a frame is dropped — no peer, encode failure, outbox
        # overflow — so the except above never sees them. Discarding the
        # return recorded the memo for a tree the far side never got, and
        # the next resync on this scope then answered
        # ``state/full/unchanged`` against it: a scope stuck stale with no
        # error and no retry. The peer-connect republish only covers the
        # case _stream_send() already screens out.
        if delivered is False:
            logger.warning(
                "V3StateFullComponent: stream dropped the state/full frame; "
                "memo not recorded so the next walk re-emits "
                "(reason=%s, generation=%d, tree_args=%d, scope=%s)",
                reason, generation, len(tree_args), scope,
            )
            return

        # Record the just-emitted tree so the next walk on this scope
        # can short-circuit if it produces the same one. Deliberately
        # after the emit: a failed emit above returns early, leaving
        # the memo untouched so the retry isn't suppressed.
        self._checksum_memo.record(scope, tree_args, checksum)

        logger.info(
            "V3StateFullComponent: published v3 state/full "
            "(reason=%s, generation=%d, tree_args=%d, etag=%s, "
            "scope=%s)",
            reason, generation, len(tree_args), checksum_hex, scope,
        )

    def _stream_send(self):
        """The ordered stream's ``send``, or ``None`` if no peer.

        ``None`` is a real outcome, not an error to route around.
        Since 3.6.0 the tree goes out as one message and there is no
        datagram it would fit in, so a missing peer means the publish
        does not happen — see the caller for why the memo must not be
        updated in that case.

        Probed per publish rather than cached, because the peer comes
        and goes with the bridge process.
        """
        stream = self._stream
        if stream is None:
            return None
        try:
            if stream.connected:
                return stream.send
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(
                "V3StateFullComponent: stream probe raised (%s); "
                "treating peer as absent", e,
            )
        return None

    def _safe_emit_unchanged(
        self, reason: str, generation: int,
        session_id: Optional[str], checksum_hex: str,
    ) -> None:
        """Emit the ``unchanged`` marker. Never raises.

        Rides UDP, not the stream: it is four small args, and it must
        still reach a client whose bridge has no TCP leg. Same posture
        as the tree emit — a transport failure is logged, not
        propagated, because this runs on Live's control thread. The
        consequence of a dropped marker is mild: the UI keeps the tree
        it already has and its generation stamp lags until the next
        publish.

        ``session_id`` is empty-stringed rather than omitted when
        absent so the arity is fixed; a UI that can't match it against
        its own session must ignore the marker.
        """
        try:
            self._emit(
                V3_STATE_FULL_UNCHANGED_ADDRESS,
                (reason, int(generation), session_id or "", checksum_hex),
            )
        except Exception as e:
            logger.error(
                "V3StateFullComponent: unchanged-marker emit failed "
                "(%s); client keeps its tree but its generation stamp "
                "will lag until the next publish (reason=%s, "
                "generation=%d, session=%s)",
                e, reason, generation, session_id, exc_info=True,
            )

    def _build_payload(self) -> list:
        """Walk the LOM and return the flat list of tree_args.

        Emission order: master first (trackPath = ``master``), then
        ``tracks/0``, ``tracks/1``, … Returns emit within track order
        once implemented; Phase 2 PR-2b does not emit returns/ yet
        because the path_resolver rejects them with
        ``path-not-supported`` anyway.
        """
        from .path_resolver import compose_device_path, compose_param_path

        out: list = []

        # Master first.
        try:
            master = self._song.master_track
        except Exception as e:
            logger.warning("V3StateFullComponent: master_track read failed: %s", e)
            master = None
        if master is not None:
            out.extend(self._track_section(master, "master",
                                            compose_device_path,
                                            compose_param_path))

        # Regular tracks.
        try:
            regular = list(self._song.tracks)
        except Exception as e:
            logger.warning("V3StateFullComponent: tracks read failed: %s", e)
            regular = []

        for idx, track in enumerate(regular):
            track_path = "tracks/%d" % idx
            out.extend(self._track_section(track, track_path,
                                            compose_device_path,
                                            compose_param_path))

        return out

    def _build_scoped_payload(self, scope: str) -> list:
        """Walk a single track subtree for scoped ``state/full``.

        Phase 12 pr12-2. Resolves ``scope`` to a LOM track object
        and reuses ``_track_section`` to emit exactly that track's
        T/D/P/S/C records. Non-resolvable scopes return ``[]`` so
        the caller can suppress the emission.

        Resolvable today:

        - ``"master"`` → ``self._song.master_track``.
        - ``"tracks/<N>"`` → ``self._song.tracks[N]`` when ``N`` is
          a valid non-negative integer within range.

        Returns ``[]`` for ``returns/<N>``, out-of-range indices,
        and malformed paths. Returns ``[]`` on any LOM read error
        — the caller logs and skips rather than emitting a broken
        bundle.
        """
        from .path_resolver import compose_device_path, compose_param_path

        if is_pad_scoped(scope):
            return self._build_pad_payload(scope)

        track = self._resolve_scope_track(scope)
        if track is None:
            return None
        try:
            return list(self._track_section(
                track, scope, compose_device_path, compose_param_path,
            ))
        except _LOM_ERRORS as e:
            logger.warning(
                "V3StateFullComponent: scoped walk failed for %s: %s",
                scope, e,
            )
            return None

    def _build_pad_payload(self, pad_path: str):
        """D and P records for the effects on one pad's chain (issue #491).

        The chain's instrument is skipped — its parameters are the
        virtual-macro layer's (``vm.*``), and carrying it would bloat a
        bundle that exists for the handful of effects beside it — but
        its chain index is kept, so a Reverb after a Simpler is
        ``…/pads/<note>/devices/1`` on the wire as it is on the chain.
        ``None`` when the pad path does not resolve; ``[]`` when the
        chain carries no effect.
        """
        r = resolve_pad(self._song, pad_path)
        if r.status is not ResolveStatus.OK:
            logger.info(
                "V3StateFullComponent: pad scope %s does not resolve (%s)",
                pad_path, r.detail,
            )
            return None
        try:
            devices = list(r.obj.chain.devices or ())
        except _LOM_ERRORS as e:
            logger.warning(
                "V3StateFullComponent: chain.devices read failed for %s: %s",
                pad_path, e,
            )
            return None
        out: list = []
        for device_idx, device in enumerate(devices):
            if _is_instrument(device):
                continue
            device_path = compose_chain_device_path(pad_path, device_idx)
            out.append("D")
            out.append(device_path)
            out.append(_safe_str(_safe_getattr(device, "name", "")))
            out.append(_safe_str(_safe_getattr(device, "class_name", "")))
            try:
                params = list(device.parameters)
            except Exception as e:
                logger.warning(
                    "V3StateFullComponent: device.parameters read failed "
                    "for %s: %s", device_path, e,
                )
                continue
            for param_idx, param in enumerate(params):
                out.append("P")
                out.append(compose_param_path_under(device_path, param_idx))
                out.append(_safe_str(_safe_getattr(param, "name", "")))
                out.append(_safe_str(
                    _safe_getattr(param, "display_name",
                                  _safe_getattr(param, "name", ""))
                ))
                out.append(_safe_float(_safe_getattr(param, "min", 0.0)))
                out.append(_safe_float(_safe_getattr(param, "max", 1.0)))
                out.append(_safe_float(_safe_getattr(param, "value", 0.0)))
                out.append(_safe_str(_safe_getattr(param, "unit", "")))
        return out

    def _resolve_scope_track(self, scope: str):
        """Resolve a ``scope`` path string to a LOM track object.

        Mirrors the grammar ``path_resolver`` accepts for tracks
        but inlined to avoid a round-trip through
        ``compose_track_path`` (which takes a track and returns a
        path — the inverse of what we need here).

        Returns ``None`` for unsupported grammars (returns/<N>,
        chains/<N>/...) and for out-of-range indices. LOM read
        failures are swallowed and logged once.
        """
        if not isinstance(scope, str) or not scope:
            return None

        if scope == "master":
            try:
                return self._song.master_track
            except _LOM_ERRORS as e:
                logger.warning(
                    "V3StateFullComponent: master_track read failed "
                    "during scoped walk: %s", e,
                )
                return None

        if scope.startswith("tracks/"):
            tail = scope[len("tracks/"):]
            # Reject any sub-path grammar — a scoped state/full is
            # always rooted at a track; param/device/slot selection
            # rides other wires.
            if "/" in tail or not tail.isdigit():
                return None
            idx = int(tail)
            try:
                tracks = list(self._song.tracks)
            except _LOM_ERRORS as e:
                logger.warning(
                    "V3StateFullComponent: tracks read failed during "
                    "scoped walk (scope=%s): %s", scope, e,
                )
                return None
            if idx < 0 or idx >= len(tracks):
                return None
            return tracks[idx]

        # returns/<N> and chains/<N>/... are reserved grammar — the
        # v3 tree doesn't carry them yet (path_resolver rejects with
        # ``path-not-supported``). Emit nothing.
        return None

    def _track_section(
        self,
        track,
        track_path: str,
        compose_device_path,
        compose_param_path,
    ) -> list:
        """Emit T + nested D/P/V records for one track."""
        out: list = []
        # T record. Field order and arity are load-bearing — see
        # [04 \u00a75 record table] and `_RECORD_ARITY['T']` below. Adding a
        # field is a coordinated change across this emitter, the chunk-
        # boundary arity table, and the UI parser in
        # interface/src/lib/api/handlers/v3StateFull.ts.
        #
        # PR-3.5.3 (2026-04-16): added hasMidiInput / hasAudioInput per
        # the doctrine in [04 \u00a75.1] (track-level capability flags belong
        # on T). Both come straight from the LOM's `Live.Track.Track`
        # attributes; master tracks don't expose them, so the safe-getattr
        # default of False yields 0/0 for master, which the UI's trackType
        # derivation reads as "neither MIDI nor audio" \u2192 null. That matches
        # the pre-PR-3.5.3 v2 behaviour where master never set the I/O
        # flags either.
        out.append("T")
        out.append(track_path)
        out.append(_safe_str(_safe_getattr(track, "name", "")))
        out.append(_safe_int(_safe_getattr(track, "color", 0)))
        out.append(_bool_int(_safe_getattr(track, "mute", False)))
        out.append(_bool_int(_safe_getattr(track, "solo", False)))
        out.append(_bool_int(_safe_getattr(track, "arm", False)))
        out.append(_bool_int(_safe_getattr(track, "has_midi_input", False)))
        out.append(_bool_int(_safe_getattr(track, "has_audio_input", False)))
        # PR-7c pr7c-3 (protocol 3.2.0): hasArrangementClips per
        # [04 \u00a75] / [phase-7-pr7c-design.md \u00a74.1]. Regular tracks read
        # `len(track.arrangement_clips) > 0` guarded by `_LOM_ERRORS`
        # (rule 9). Master and returns can't host arrangement clips,
        # so we emit literal 0 there \u2014 keeping single-arity parsing
        # on the UI side. The focused
        # `/looping/v3/track/has_arrangement_clips` event lives on
        # `TrackMetadataComponent`; this is the snapshot that lands
        # in state/full bundles.
        if track_path == "master" or track_path.startswith("returns/"):
            out.append(0)
        else:
            try:
                clips = track.arrangement_clips
                out.append(1 if len(clips) > 0 else 0)
            except _LOM_ERRORS:
                out.append(0)
        # ROW 6.5 (2026-04-21): volume on T-record, arity 9 → 10. Reads
        # ``track.mixer_device.volume.value`` via safe-getattr; any LOM
        # raise degrades to 0.0. Regular tracks are driven by the
        # ``TrackMetadataComponent`` mixer listener (ROW 2-F3); master's
        # listener lives on ``MasterComponent``. Carrying volume on T
        # lets the UI drop its mount-time ``/looping/track/query`` round-
        # trip — the only mount field state/full didn't carry before.
        try:
            mixer = _safe_getattr(track, "mixer_device", None)
            vol_param = _safe_getattr(mixer, "volume", None) if mixer else None
            out.append(_safe_float(_safe_getattr(vol_param, "value", 0.0)))
        except _LOM_ERRORS:
            out.append(0.0)

        # ADR-410 (2026-07-27): group-track structure on T, arity 10 → 13.
        # Protocol 3.3.0 → 3.4.0.
        #
        # `is_foldable` marks a Group Track; `fold_state` is its
        # collapsed bit (True = children hidden in Live). Verified
        # against Live 12.4.5b8: **`fold_state` RAISES on non-foldable
        # tracks** (it is not merely absent), so it must go through
        # `_safe_getattr`, which swallows the property-read error the
        # same way it does for `master.mute`. Reading it unguarded on a
        # regular track aborts the whole T record.
        #
        # `groupTrackIndex` is the LOM index of the parent group, or -1
        # when the track sits at top level. It's carried instead of a
        # bare `is_grouped` flag because the UI needs the *tree* — a
        # track is hidden when ANY ancestor is folded, which nested
        # groups make a walk rather than a single bit. Master / returns
        # emit -1 (they can't be grouped).
        out.append(_bool_int(_safe_getattr(track, "is_foldable", False)))
        out.append(_bool_int(_safe_getattr(track, "fold_state", False)))
        out.append(self._group_track_index(track))

        # Protocol 3.7.0: role, arity 13 -> 14. The rail the track's
        # instrument was loaded from ("drum", "perc", "bass", ...), read
        # out of Live's per-track key-value store where
        # ``TrackMetadataComponent.handle_set_role`` put it.
        #
        # This is the first T field that is not a LOM *attribute* — it
        # is a value this system wrote and is reading back. That is the
        # whole point: the role was previously re-derived every session
        # from a 2.46 MB catalog fetch plus a three-tier guess, because
        # there was nowhere to write the answer down. There is.
        #
        # ``get_data``'s default is positional and mandatory, and a key
        # cannot be deleted (writing ``None`` stores ``None``), so both
        # "never set" and "cleared" have to read as the empty string.
        out.append(self._track_role(track))

        # Protocol 3.9.0 (ADR-439): preset, arity 14 -> 15. The path the
        # last ``prepare_for_preset`` load put on this track, written by
        # ``TrackPrepareComponent`` into the same per-track store as the
        # role together with the instrument that load left; the instrument
        # views' swap control steps from it. "" once the track's instrument
        # is no longer that one (Live's undo, a hot-swap), and read as
        # totally as the role: "never set", "cleared" and a Live without the
        # store all come out as "".
        out.append(self._track_preset(track))

        # Devices.
        try:
            devices = list(track.devices)
        except Exception as e:
            logger.warning(
                "V3StateFullComponent: track.devices read failed for %s: %s",
                track_path, e,
            )
            return out

        for device_idx, device in enumerate(devices):
            device_path = "%s/devices/%d" % (track_path, device_idx)
            out.append("D")
            out.append(device_path)
            out.append(_safe_str(_safe_getattr(device, "name", "")))
            out.append(_safe_str(_safe_getattr(device, "class_name", "")))
            # ROW 5 (2026-04-21): D-record arity dropped from 4 → 3.
            # The legacyId field (31-bit truncated _live_ptr) existed
            # under closeout-0b as a side-table key for the M4L-served
            # /looping/device/{select,move_appointed_*} handlers. Those
            # retired alongside this field — path_resolver.resolve_device
            # + DeviceCommandsComponent own the same ops in path-space.
            # Protocol-version bump: 3.2.0 → 3.3.0.

            # Params on this device.
            try:
                params = list(device.parameters)
            except Exception as e:
                logger.warning(
                    "V3StateFullComponent: device.parameters read failed "
                    "for %s: %s", device_path, e,
                )
                continue

            for param_idx, param in enumerate(params):
                param_path = "%s/params/%d" % (device_path, param_idx)
                out.append("P")
                out.append(param_path)
                out.append(_safe_str(_safe_getattr(param, "name", "")))
                # displayName falls back to name when the LOM object
                # doesn't carry a separate display-name attribute (our
                # stubs don't). Real Live.DeviceParameter does.
                out.append(_safe_str(
                    _safe_getattr(param, "display_name",
                                  _safe_getattr(param, "name", ""))
                ))
                out.append(_safe_float(_safe_getattr(param, "min", 0.0)))
                out.append(_safe_float(_safe_getattr(param, "max", 1.0)))
                out.append(_safe_float(_safe_getattr(param, "value", 0.0)))
                # unit is often empty on LOM params; empty string is a
                # valid value and round-trips through the checksum.
                out.append(_safe_str(_safe_getattr(param, "unit", "")))

        # S/C records — pr7b-7. Depth-first per-track after D/P/V.
        # Master has no clip_slots, so this call is a no-op for
        # track_path == "master". The UI's v3StateFull parser
        # asserts S records' slotPath starts with trackPath + "/",
        # so we emit slotPath = "tracks/<N>/slots/<M>" or
        # "master/slots/<M>" (the latter never produced, since the
        # master walk finds no clip_slots to iterate).
        out.extend(self._slot_section(track, track_path))

        return out

    def _track_role(self, track) -> str:
        """The track's persisted role, or ``""`` when it has none.

        Total by construction. ``get_data`` is a Live 12 API, so a
        surface running against an older build finds no such attribute
        — and every LOM read on this path has to degrade rather than
        abort the whole T record (same posture as ``fold_state``, which
        *raises* on non-foldable tracks).
        """
        try:
            value = track.get_data(TRACK_ROLE_DATA_KEY, TRACK_ROLE_UNSET)
        except Exception:
            return TRACK_ROLE_UNSET
        # ``_safe_str`` is doing real work here, not defensive padding:
        # a *cleared* role reads back as ``None`` rather than as the
        # default, because Live's store has no delete and writing
        # ``None`` stores ``None``. ``_safe_str(None)`` is ``""``, which
        # collapses "never set" and "cleared" into one wire value —
        # ``str(None)`` would put the literal "None" on the wire and the
        # UI would treat it as a role named None.
        return _safe_str(value)

    def _track_preset(self, track) -> str:
        """The preset the last ``prepare_for_preset`` load recorded, while the
        track still holds the instrument that load left; ``""`` otherwise.

        Protocol 3.9.0 (ADR-439). The check lives beside the key, in
        ``TrackMetadataComponent.held_preset``, and is as total as
        ``_track_role``: ``get_data`` is Live 12 API and a key cannot be
        deleted. It is worked out on every walk rather than written when the
        instrument changes, so Live's undo reads ``""`` and its redo brings
        the path back.
        """
        return held_preset(track)

    def _group_track_index(self, track) -> int:
        """LOM index of ``track``'s parent Group Track, or ``-1``.

        ADR-410. ``Track.group_track`` hands back a Track object (or
        ``None`` at top level), so the index has to be recovered by
        identity against ``song.tracks``. Live's v3 framework mints a
        fresh wrapper per read, so ``is`` silently never matches —
        compare with ``_safe_int_id`` (``_live_ptr``) per ADR-350.

        O(N) per call, N = track count, so a full-song walk is O(N²).
        With real-world track counts (tens) that's a few hundred
        integer compares per bundle — measurably cheaper than
        threading an id→index map through both the whole-song and the
        scoped single-track emission paths.
        """
        parent = _safe_getattr(track, "group_track", None)
        if parent is None:
            return -1
        try:
            tracks = list(self._song.tracks)
        except _LOM_ERRORS:
            return -1
        if _safe_int_id is not None:
            parent_id = _safe_int_id(parent)
            if parent_id is not None:
                for i, t in enumerate(tracks):
                    if _safe_int_id(t) == parent_id:
                        return i
        # Identity fallback — covers test stubs with no ``_live_ptr``.
        for i, t in enumerate(tracks):
            if t is parent:
                return i
        return -1

    def _slot_section(self, track, track_path: str) -> list:
        """Emit S + optional C per slot. Design §2.7.

        Walk ``track.clip_slots`` in index order. For each slot emit
        one S record with the derived state (0=empty, 1=has_clip,
        2=playing, 3=recording). If ``slot.has_clip``, emit one C
        record immediately after — the UI's parser requires S → C
        contiguity (``C without S`` bails the chunk).

        All LOM reads are wrapped in ``_LOM_ERRORS``-tolerant
        helpers so a half-torn-down slot during a structural
        change returns state=0 and skips the C record rather than
        aborting the walk. The next tick's S/C emission cleans up.
        """
        out: list = []
        try:
            slots = list(track.clip_slots)
        except _LOM_ERRORS as e:
            # Master lacks clip_slots; AttributeError here is the
            # intended path for master. Regular-track raises (rare)
            # log and skip.
            if track_path != "master":
                logger.warning(
                    "V3StateFullComponent: %s.clip_slots read "
                    "failed: %s", track_path, e,
                )
            return out
        except Exception as e:
            logger.warning(
                "V3StateFullComponent: %s.clip_slots read failed: %s",
                track_path, e,
            )
            return out

        for slot_idx, slot in enumerate(slots):
            slot_path = "%s/slots/%d" % (track_path, slot_idx)
            state, clip = _slot_state_and_clip(slot)
            out.append("S")
            out.append(slot_path)
            out.append(state)

            if clip is not None:
                clip_path = "%s/clip" % slot_path
                out.append("C")
                out.append(clip_path)
                out.append(_safe_str(_safe_getattr(clip, "name", "")))
                out.append(_safe_float(_safe_getattr(clip, "length", 0.0)))
                out.append(_safe_int(_safe_getattr(clip, "color", 0)))
                # pitch is meaningful for MIDI clips; audio clips
                # emit 0. The LOM attribute either exists (MIDI)
                # or doesn't (audio) — _safe_getattr default covers
                # both.
                out.append(_safe_float(_safe_getattr(clip, "pitch", 0.0)))

        return out

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        """Stop publishing; idempotent."""
        if self._disconnected:
            return
        self._disconnected = True
        # Drop any pending coalescing state — a delayed callback that
        # fires after disconnect bails on the ``_disconnected`` check
        # in ``_fire_pending``, so this is just bookkeeping cleanup.
        self._pending_reasons.clear()
        self._timer_armed.clear()
        # Also drops the retained tree snapshots, which are the only
        # meaningful memory this component holds after teardown.
        self._checksum_memo.clear()


# --- helpers ---------------------------------------------------------------


def parse_etag(value) -> Optional[int]:
    """Read a client-declared ETag into an int, or ``None``.

    Accepts the on-wire form ``"etag:0x0f6edcf5"`` and the bare
    ``"0x0f6edcf5"`` so a caller that has already stripped the prefix
    doesn't have to put it back. Anything unparseable is ``None``,
    which callers must treat as "client declared nothing" — the
    conservative answer, because it ships the tree.

    Deliberately total: this parses a string a *client* chose, so a
    malformed one must degrade to a full send rather than raise on the
    control thread.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.startswith(ETAG_PREFIX):
        text = text[len(ETAG_PREFIX):]
    if not text:
        return None
    try:
        parsed = int(text, 16) if text.lower().startswith("0x") else int(text)
    except (TypeError, ValueError):
        return None
    # Checksums are int31 on the wire. A value outside that range came
    # from a different scheme and must not be trusted to mean "same".
    if parsed < 0 or parsed > _INT31_MASK:
        return None
    return parsed


def extract_etag(args) -> Tuple[list, Optional[int]]:
    """Split ``etag:``-prefixed tokens out of a variadic arg list.

    Returns ``(remaining_args, etag_or_None)``. Last valid declaration
    wins, matching how a repeated header would normally be read.
    """
    remaining = []
    etag = None
    for arg in args or ():
        if isinstance(arg, str) and arg.startswith(ETAG_PREFIX):
            parsed = parse_etag(arg)
            if parsed is not None:
                etag = parsed
            continue
        remaining.append(arg)
    return remaining, etag


def _compute_checksum(tree_args: list) -> int:
    """A **surface-local** digest of the tree. Not a wire contract.

    Read this before "fixing" it to match something.

    Until protocol 3.6.0 this was FNV-1a over a hand-rolled typed byte
    stream, mirrored byte-for-byte in ``v3StateFull.ts``, because the
    UI recomputed it to verify a reassembled multi-chunk bundle. The
    tree now arrives as one ordered-stream message, so the UI never
    recomputes anything — it stores this token and echoes it back as
    a client-declared ETag (§5.1.1). Nobody but this module ever
    derives a value to compare against.

    That leaves exactly two requirements, both local:

    - **Stable within a session** — the ETag check is
      ``client_etag == checksum``, so the same tree must digest the
      same way for as long as a client might hold it.
    - **Collision-resistant enough** that two different trees don't
      compare equal. A collision would answer "unchanged" to a client
      whose tree is stale, which is silent corruption. At int31 that
      is ~1 in 2^31, the same odds the FNV version ran at.

    Explicitly **not** required: agreement with any other
    implementation, stability across surface restarts (a restart
    re-handshakes and the client's held ETag is cleared), or any
    particular bit width.

    Freed of the cross-language constraint, the fold moves off the
    Python interpreter entirely. Measured on a realistic set (20
    tracks x 4 heavy devices, 41,734 elements) on this machine:

        old: typed byte stream + per-byte FNV ...... 40.3 ms
        new: ``repr`` + ``md5`` .....................  3.8 ms

    The 3.8 ms splits 3.0 ms ``repr`` / 0.7 ms ``md5`` — the fold
    itself is nearly free and ``repr`` is now the whole cost.
    ``pickle.dumps(tree_args, -1)`` in place of ``repr`` measures
    1.4 ms end to end, a further 2.7x, at the price of a
    serialization whose stability nobody has to think about today.
    Not taken: the memo already makes the common case cost nothing,
    so the remaining win is on cold publishes only.

    ``repr`` distinguishes the types that matter here: ``repr(1)`` is
    ``'1'`` and ``repr(1.0)`` is ``'1.0'``, and strings carry their
    quotes, so a tree that differs only in the type of one field still
    digests differently.
    """
    digest = hashlib.md5(repr(tree_args).encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") & _INT31_MASK


def _safe_str(value) -> str:
    if value is None:
        return ""
    try:
        return str(value)
    except Exception:
        return ""


def _safe_int(value) -> int:
    """Coerce to int. NaN/failures degrade to 0."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _safe_float(value) -> float:
    """Coerce to float. NaN degrades to 0.0."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    if f != f:  # NaN
        return 0.0
    return f


def _bool_int(value) -> int:
    """LOM mute/solo/arm-style flags → 0|1 int for the wire."""
    try:
        return 1 if value else 0
    except Exception:
        return 0


def _safe_getattr(obj, name: str, default=None):
    """``getattr(obj, name, default)`` that also swallows property-read errors.

    Live's LOM raises ``RuntimeError('Main track has no 'mute' property!')``
    from *inside* attribute access on the master/return tracks, which
    bypasses the ``default`` argument of plain ``getattr``. This wrapper
    catches those so a single missing property doesn't abort the walk.
    """
    try:
        return getattr(obj, name, default)
    except Exception:
        return default


def _slot_state_and_clip(slot) -> Tuple[int, Any]:
    """Resolve ``(state_ordinal, clip_or_None)`` for one ``ClipSlot``.

    State ordinals per [04 §5]:

    - ``0`` empty    — ``has_clip`` is False or unreadable
    - ``1`` has_clip — populated, clip not playing/recording
    - ``2`` playing  — ``slot.is_playing`` True
    - ``3`` recording — clip's ``is_recording`` True

    All LOM reads are guarded by ``_LOM_ERRORS`` — a half-torn-down
    slot during a structural change degrades to ``(0, None)`` and
    the S walk continues. Design §2.7.
    """
    try:
        has_clip = bool(slot.has_clip)
    except _LOM_ERRORS:
        return (_SLOT_STATE_EMPTY, None)

    if not has_clip:
        return (_SLOT_STATE_EMPTY, None)

    try:
        clip = slot.clip
    except _LOM_ERRORS:
        clip = None

    # ``is_recording`` lives on the clip (MIDI/audio); ``is_playing``
    # lives on the slot. Recording takes precedence because a
    # recording clip is also playing — the UI needs the narrower
    # state to render the record-arm pulse.
    if clip is not None:
        try:
            if bool(clip.is_recording):
                return (_SLOT_STATE_RECORDING, clip)
        except _LOM_ERRORS:
            pass

    try:
        if bool(slot.is_playing):
            return (_SLOT_STATE_PLAYING, clip)
    except _LOM_ERRORS:
        pass

    return (_SLOT_STATE_HAS_CLIP, clip)
