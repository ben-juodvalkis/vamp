"""RecordSuspendComponent — let the Group-Tracks gesture borrow the record button.

Live refuses to move a track that is "currently recording" — a real modal
dialog, not a wire error. Under `npm run ipad`'s auto-capture
(`PerformanceCaptureComponent`), `song.record_mode` is 1 for the entire time
the transport plays, so any Group gesture (ADR-439) that needs to actually
reposition a track (a non-contiguous new group, or a drag into an existing
one) hits that dialog and silently fails on Live's side. Ben's call
(2026-09-21): rather than block on it, the bridge brackets the reposition —
turn record off, do the move, turn it back on — and only when the tracks
involved actually need to move at all (the bridge decides that from a
contiguity check before ever asking for this).

This component is deliberately dumb: it holds no opinion about *when* a
bracket is warranted, only *how* to open and close one. Two one-shot
request/reply verbs, no listener, no state kept between calls other than
what one request/reply pair needs:

- **suspend**: read `song.record_mode`; if it is on, turn it off and say so.
  If it was already off, this is a no-op and says so — the bridge only
  resumes when told the suspend actually changed something.
- **resume**: turn `song.record_mode` back on, unconditionally. The bridge
  only calls this after a suspend that reported `wasOn=1`.

**Invisible to `PerformanceCaptureComponent`.** That component listens only
to `song.is_playing`, never to `record_mode` itself, so a bracket that
starts and ends with the transport still running never fires its listener
and cannot disturb `_armed_by_us` ownership or the stop-edge save-as flow.

**The cost, named plainly:** whatever plays during the bracket is not
captured to the Arrangement on a track that was actually recording — a gap
the length of one Group gesture (typically well under a second). That is
the trade being made on purpose: a short recording gap instead of a gesture
that silently does nothing.
"""

from __future__ import annotations

import logging
from typing import Callable

logger = logging.getLogger("looping")

V3_GROUP_RECORD_SUSPEND_ADDRESS = "/looping/v3/track/group/record_suspend"
V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS = "/looping/v3/track/group/record_suspend/ack"
V3_GROUP_RECORD_RESUME_ADDRESS = "/looping/v3/track/group/record_resume"
V3_GROUP_RECORD_RESUME_ACK_ADDRESS = "/looping/v3/track/group/record_resume/ack"


class RecordSuspendComponent:
    """Bridge-only request/reply pair around `song.record_mode`.

    Args:
        song: Live ``Song`` object.
        emit: ``self._transport.send`` — proactive outbound to the bridge.
    """

    V3_GROUP_RECORD_SUSPEND_ADDRESS = V3_GROUP_RECORD_SUSPEND_ADDRESS
    V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS = V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS
    V3_GROUP_RECORD_RESUME_ADDRESS = V3_GROUP_RECORD_RESUME_ADDRESS
    V3_GROUP_RECORD_RESUME_ACK_ADDRESS = V3_GROUP_RECORD_RESUME_ACK_ADDRESS

    def __init__(self, song, emit: Callable[..., None]):
        self._song = song
        self._emit = emit
        self._disconnected = False

    def handle_suspend(self, args, source_addr=None) -> None:
        """`[requestId]` → reads `record_mode`; if on, clears it. Always
        answers `[requestId, wasOn:int]` — a read/write failure answers
        `wasOn=0` (nothing to resume), never leaves the bridge hanging."""
        request_id = args[0] if args else ""
        was_on = False
        try:
            was_on = bool(self._song.record_mode)
            if was_on:
                self._song.record_mode = 0
        except (RuntimeError, AttributeError) as e:
            logger.warning("RecordSuspend: could not read/clear record_mode: %r", e)
            was_on = False
        self._emit(V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS, [request_id, 1 if was_on else 0])

    def handle_resume(self, args, source_addr=None) -> None:
        """`[requestId]` → unconditionally sets `record_mode = 1`, then
        answers `[requestId]`. The bridge only calls this after a suspend
        that reported `wasOn=1`, so "unconditional" is safe in practice —
        but this handler itself trusts the caller, not a remembered flag,
        so a caller that never suspended anything gets exactly what it
        asked for."""
        request_id = args[0] if args else ""
        try:
            self._song.record_mode = 1
        except (RuntimeError, AttributeError) as e:
            logger.warning("RecordSuspend: could not restore record_mode: %r", e)
        self._emit(V3_GROUP_RECORD_RESUME_ACK_ADDRESS, [request_id])

    def disconnect(self) -> None:
        self._disconnected = True
