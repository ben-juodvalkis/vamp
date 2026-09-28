"""The surface half of the similar-sound swap (ADR-439 phase 3).

The bridge orchestrates ``/looping/v3/drum/swap_similar``: it asks this
component to make Live show the rack, asks the AX helper to press Live's own
swap button, asks this component what the pads hold now, and tells it the swap
is done. Nothing here waits on anything — Live services Accessibility on its
main thread, which is the thread this runs on, so a handler that waited for a
press would stall the press it waited for.

- ``show_for_swap [requestId, rackPath, note]`` selects the rack's track and
  the rack and brings the device chain into the detail view. For a pad
  (``note >= 0``) it also selects the pad — the device view then shows that
  pad's chain, where the bridge presses its Drum Sampler's own swap buttons,
  which swap without playing the pad as the rack grid's do — and scrolls the
  pad grid so the pad's row is in view. The ack says where the rack sits in
  ``TrackView.Device[N]``, which is how the bridge addresses Live's controls,
  and where the pad sits in the 4x4 grid. It also notes each pad's chain and
  instrument name and opens Live's undo step for the swap.
- ``pad_names [requestId, rackPath, notes]`` answers each pad's first
  instrument name — the sample's file stem on a Drum Sampler, where the chain
  name goes stale after a Swap All — and that instrument's identity, so a swap
  that replaced the device rather than its sample shows as such.
- ``finish_swap [requestId, rackPath]`` renames each chain that was named after
  its instrument when the swap began and whose instrument Live has renamed
  since, then closes the undo step. Live's swap and the renames undo together,
  as one ``Undo Next Similar`` (measured 2026-09-15: one undo reverted 30
  swapped samples and 29 renamed chains). A chain with a name of its own
  ("606 Kick") keeps it. Live's own pad swap button renames the pad's chain
  itself, so after a pad swap there is nothing to follow; Swap All is what
  leaves chains behind.

Every reply has a fixed arity, ``[requestId, ok, code, detail, ...]``; a
failure is ``ok = 0`` with a code, never a silence.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable

from .drum_vm_functions import PAD_NAME_MAX
from .drum_vm_resolve import first_instrument, instrument_name, pad_devices, pad_name
from .path_resolver import ResolveStatus, resolve_device, resolve_track

try:
    from .LOMListeners import _safe_int_id
except Exception:  # pragma: no cover — only if LOMListeners cannot import
    _safe_int_id = None  # type: ignore[assignment]

logger = logging.getLogger("looping")

_LOM_ERRORS = (RuntimeError, AttributeError, TypeError)

V3_DRUM_SHOW_FOR_SWAP_ADDRESS = "/looping/v3/drum/show_for_swap"
V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS = "/looping/v3/drum/show_for_swap/ack"
V3_DRUM_PAD_NAMES_ADDRESS = "/looping/v3/drum/pad_names"
V3_DRUM_PAD_NAMES_REPLY_ADDRESS = "/looping/v3/drum/pad_names/reply"
V3_DRUM_FINISH_SWAP_ADDRESS = "/looping/v3/drum/finish_swap"
V3_DRUM_FINISH_SWAP_ACK_ADDRESS = "/looping/v3/drum/finish_swap/ack"

ERR_BAD_ARGS = "bad-args"
ERR_NOT_TOP_LEVEL = "not-a-top-level-rack"
ERR_NOT_FOUND = "path-not-found"
ERR_NOT_A_KIT = "not-a-drum-rack"
ERR_NO_PAD = "no-such-pad"
ERR_REFUSED = "write-refused"

DRUM_RACK_CLASS = "DrumGroupDevice"
DEVICE_CHAIN_VIEW = "Detail/DeviceChain"
PADS_PER_ROW = 4
VISIBLE_ROWS = 4
MAX_SCROLL = 28          # 32 rows of four notes, four rows in view
# A swap is judged by comparing names before and after, so they are read longer
# than the census's pad labels: two stems sharing 24 characters still differ.
NAME_LIMIT = 64
NAMES_BYTES_SOFT_CAP = 8000
# An undo step whose finish_swap never came (the bridge went away mid-swap) is
# closed after this long, so later edits do not fold into the swap. A cold kit
# pass took 3.4 s on the rig, the helper allows one press 15 s, and a Return
# presses once per counted step. (Stale: the pill addendum deleted Return
# and the bridge's step counter, so nothing presses per counted step any
# more. The 60 s still stands on its other leg -- a cold kit pass is seconds
# and a performer must never be left inside an undo step -- and the bridge
# now gives up at 45 s, under this, rather than racing it.)
SWAP_UNDO_MAX_MS = 60_000

# Live's pad grid addresses whole top-level racks only: TrackView.Device[N]
# is the N-th device of the selected track, so a rack nested in a chain
# cannot be shown this way.
_RACK_PATH = re.compile(r"^tracks/(\d+)/devices/(\d+)$")


def _coerce_str(x) -> str:
    if x is None:
        return ""
    if isinstance(x, bytes):
        return x.decode("utf-8", errors="replace")
    return str(x)


def scroll_for(note: int, current: int) -> int:
    """The smallest scroll that brings ``note``'s row into view: unchanged when
    it is already showing. ``drum_pads_scroll_position`` is the lowest visible
    row, and rows climb upward, four notes to a row."""
    row = note // PADS_PER_ROW
    if current <= row <= current + VISIBLE_ROWS - 1:
        return current
    target = row if row < current else row - (VISIBLE_ROWS - 1)
    return max(0, min(MAX_SCROLL, target))


def grid_index(note: int, scroll: int) -> int:
    """``note``'s place in reading order (top-left 0, bottom-right 15) of the
    4x4 grid scrolled to ``scroll``, or -1 when its row is not in view. The
    top row is the highest; notes rise left to right within a row."""
    row = note // PADS_PER_ROW
    if not scroll <= row <= scroll + VISIBLE_ROWS - 1:
        return -1
    row_from_top = scroll + VISIBLE_ROWS - 1 - row
    return row_from_top * PADS_PER_ROW + note % PADS_PER_ROW


class _OpenSwap:
    """A swap between ``show_for_swap`` and ``finish_swap``: the rack, each pad's
    ``(chain name, instrument name)`` when it began, and whether it holds an open
    undo step."""

    __slots__ = ("names", "rack_path", "token", "undo")

    def __init__(self, rack_path: str, names: dict[int, tuple[str, str]], token: int, undo: bool) -> None:
        self.rack_path = rack_path
        self.names = names
        self.token = token
        self.undo = undo


class DrumSwapComponent:
    """Owns ``/looping/v3/drum/show_for_swap``, ``/looping/v3/drum/pad_names`` and
    ``/looping/v3/drum/finish_swap``.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender.
        application: ``Live.Application`` (for ``view.show_view``); optional —
            without it the detail view is left as it is.
        schedule_delayed: ``(ms, fn)``; optional — without it an abandoned swap's
            undo step waits for the next ``show_for_swap`` or ``disconnect``.
    """

    def __init__(self, song, emit: Callable[[str, tuple], None], application=None,
                 schedule_delayed: Callable[[int, Callable[[], None]], None] | None = None) -> None:
        self._song = song
        self._emit = emit
        self._application = application
        self._schedule_delayed = schedule_delayed
        self._disconnected = False
        self._open: _OpenSwap | None = None
        self._tokens = 0

    def disconnect(self) -> None:
        self._close_swap("disconnect")
        self._disconnected = True

    # --- show_for_swap ---------------------------------------------------------

    def handle_show_for_swap(self, args, source_addr) -> None:
        if self._disconnected or not args:
            return
        request_id = _coerce_str(args[0])
        if len(args) != 3:
            self._show_failed(request_id, ERR_BAD_ARGS, "expected [requestId, rackPath, note]")
            return
        rack_path = _coerce_str(args[1])
        try:
            note = int(args[2])
        except (TypeError, ValueError):
            self._show_failed(request_id, ERR_BAD_ARGS, "note must be an integer (-1 for the kit)")
            return
        if note > 127:
            self._show_failed(request_id, ERR_BAD_ARGS, "note %d is past 127" % note)
            return
        match = _RACK_PATH.match(rack_path)
        if match is None:
            self._show_failed(request_id, ERR_NOT_TOP_LEVEL, "%r is not tracks/<N>/devices/<M>" % rack_path)
            return
        track_path = "tracks/%s" % match.group(1)
        device_index = int(match.group(2))
        rack, problem = self._rack(rack_path)
        if rack is None:
            self._show_failed(request_id, problem[0], problem[1])
            return
        track_result = resolve_track(self._song, track_path)
        if track_result.status is not ResolveStatus.OK:
            self._show_failed(request_id, ERR_NOT_FOUND, track_result.detail)
            return
        pad = self._pad_with_chain(rack, note) if note >= 0 else None
        if note >= 0 and pad is None:
            self._show_failed(request_id, ERR_NO_PAD, "pad %d carries no chain, so it has no sample" % note)
            return

        try:
            self._song.view.selected_track = track_result.obj
            self._song.view.select_device(rack)
        except _LOM_ERRORS as e:
            self._show_failed(request_id, ERR_REFUSED, "selecting the rack raised: %s" % e)
            return
        if pad is not None:
            try:
                # The device view shows the selected pad's chain, and the bridge
                # presses that chain's Drum Sampler's own swap buttons.
                rack.view.selected_drum_pad = pad
            except _LOM_ERRORS as e:
                self._show_failed(request_id, ERR_REFUSED, "selecting pad %d raised: %s" % (note, e))
                return
        if self._application is not None:
            try:
                self._application.view.show_view(DEVICE_CHAIN_VIEW)
            except _LOM_ERRORS as e:
                # Not fatal: the device chain may already be the detail view,
                # and the helper names a control that is not showing.
                logger.info("DrumSwapComponent: show_view(%s) raised: %s", DEVICE_CHAIN_VIEW, e)

        try:
            scroll = int(rack.view.drum_pads_scroll_position)
        except _LOM_ERRORS + (ValueError,) as e:
            self._show_failed(request_id, ERR_REFUSED, "drum_pads_scroll_position unreadable: %s" % e)
            return
        index = -1
        if note >= 0:
            wanted = scroll_for(note, scroll)
            if wanted != scroll:
                try:
                    rack.view.drum_pads_scroll_position = wanted
                    scroll = int(rack.view.drum_pads_scroll_position)
                except _LOM_ERRORS + (ValueError,) as e:
                    self._show_failed(request_id, ERR_REFUSED, "scrolling the pad grid raised: %s" % e)
                    return
            index = grid_index(note, scroll)
            if index < 0:
                self._show_failed(request_id, ERR_REFUSED,
                                  "pad %d is still out of view at scroll %d" % (note, scroll))
                return
        self._begin_swap(rack_path, rack, note)
        self._emit(V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS,
                   (request_id, 1, "", "", track_path, device_index, scroll, index))

    def _show_failed(self, request_id: str, code: str, detail: str) -> None:
        logger.info("DrumSwapComponent: show_for_swap %s: %s", code, detail)
        self._emit(V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS, (request_id, 0, code, detail[:160], "", -1, -1, -1))

    # --- the swap's undo step ----------------------------------------------------

    def _begin_swap(self, rack_path: str, rack, note: int) -> None:
        """Note the names of the pads in scope and open Live's undo step. A step
        still open from a swap whose finish never came is closed first, so begin
        and end stay paired."""
        self._close_swap("superseded")
        names: dict[int, tuple[str, str]] = {}
        for pad in self._pads(rack, None if note < 0 else {note}):
            state = self._chain_state(pad)
            if state is not None:
                names[state[0]] = (state[2], state[3])
        self._tokens += 1
        token = self._tokens
        try:
            self._song.begin_undo_step()
            undo = True
        except _LOM_ERRORS as e:
            # The swap still works; its renames just land as an undo step of their own.
            logger.warning("DrumSwapComponent: begin_undo_step raised: %s", e)
            undo = False
        self._open = _OpenSwap(rack_path, names, token, undo)
        if undo and self._schedule_delayed is not None:
            self._schedule_delayed(SWAP_UNDO_MAX_MS, lambda: self._expire(token))

    def _expire(self, token: int) -> None:
        if self._open is not None and self._open.token == token:
            logger.warning("DrumSwapComponent: no finish_swap for %s within %d ms; closing its undo step",
                           self._open.rack_path, SWAP_UNDO_MAX_MS)
            self._close_swap("expired")

    def _close_swap(self, reason: str) -> None:
        swap, self._open = self._open, None
        if swap is None or not swap.undo:
            return
        try:
            self._song.end_undo_step()
        except _LOM_ERRORS as e:
            logger.warning("DrumSwapComponent: end_undo_step (%s) raised: %s", reason, e)

    # --- finish_swap -------------------------------------------------------------

    def handle_finish_swap(self, args, source_addr) -> None:
        if self._disconnected or not args:
            return
        request_id = _coerce_str(args[0])
        if len(args) != 2:
            self._emit(V3_DRUM_FINISH_SWAP_ACK_ADDRESS,
                       (request_id, 0, ERR_BAD_ARGS, "expected [requestId, rackPath]", ""))
            return
        rack_path = _coerce_str(args[1])
        swap = self._open
        if swap is None or swap.rack_path != rack_path:
            # Nothing open for this rack (a refused show, or a finish sent twice):
            # an answer, not an error, so the bridge can always send one.
            self._emit(V3_DRUM_FINISH_SWAP_ACK_ADDRESS, (request_id, 1, "", "", self._finish_payload(False, [], [])))
            return
        renamed, kept = self._follow_names(swap)
        self._close_swap("finished")
        self._emit(V3_DRUM_FINISH_SWAP_ACK_ADDRESS, (request_id, 1, "", "", self._finish_payload(True, renamed, kept)))

    def _follow_names(self, swap: _OpenSwap) -> tuple[list[int], list[int]]:
        """Rename each chain that was named after its instrument when the swap
        began and whose instrument has another name now. ``kept`` are the pads
        whose instrument changed but whose chain keeps its name: a name of its
        own, or one changed since the swap began."""
        rack, _ = self._rack(swap.rack_path)
        if rack is None:
            return [], []
        renamed: list[int] = []
        kept: list[int] = []
        for pad in self._pads(rack, set(swap.names)):
            state = self._chain_state(pad)
            if state is None:
                continue
            note, chain, chain_now, instrument_now = state
            chain_before, instrument_before = swap.names[note]
            if not instrument_now or instrument_now == instrument_before:
                continue
            if chain_now == instrument_now:
                # Already follows: a pad's own swap button renames its chain with
                # the instrument (measured 2026-09-15); only Swap All leaves
                # chains behind.
                continue
            if chain_before != instrument_before or chain_now != chain_before:
                kept.append(note)
                continue
            try:
                chain.name = instrument_now
            except _LOM_ERRORS as e:
                logger.warning("DrumSwapComponent: renaming pad %d's chain raised: %s", note, e)
                kept.append(note)
                continue
            renamed.append(note)
        return renamed, kept

    @staticmethod
    def _finish_payload(opened: bool, renamed: list[int], kept: list[int]) -> str:
        return json.dumps({"open": opened, "renamed": renamed, "kept": kept}, separators=(",", ":"))

    # --- pad_names -------------------------------------------------------------

    def handle_pad_names(self, args, source_addr) -> None:
        if self._disconnected or not args:
            return
        request_id = _coerce_str(args[0])
        if len(args) != 3:
            self._names_failed(request_id, ERR_BAD_ARGS, "expected [requestId, rackPath, notes]")
            return
        rack_path = _coerce_str(args[1])
        wanted = self._parse_notes(_coerce_str(args[2]))
        if wanted is False:
            self._names_failed(request_id, ERR_BAD_ARGS, "notes must be '*' or comma-separated integers")
            return
        rack, problem = self._rack(rack_path)
        if rack is None:
            self._names_failed(request_id, problem[0], problem[1])
            return
        entries = []
        for pad in self._pads(rack, wanted):
            devices = pad_devices(pad)
            if devices is None:
                continue
            try:
                note = int(pad.note)
            except _LOM_ERRORS + (ValueError,):
                continue
            found = first_instrument(devices)
            instrument = found[0] if found is not None else None
            name = instrument_name(instrument, NAME_LIMIT) if instrument is not None else ""
            entries.append({
                "note": note,
                "name": name or pad_name(pad),
                "class": found[1] if found is not None else None,
                "ptr": _safe_int_id(instrument) if (instrument is not None and _safe_int_id is not None) else None,
            })
        entries.sort(key=lambda e: e["note"])
        self._emit(V3_DRUM_PAD_NAMES_REPLY_ADDRESS, (request_id, 1, "", "", self._names_payload(entries)))

    @staticmethod
    def _names_payload(entries) -> str:
        """The reply JSON, kept inside one datagram: classes go first, then the
        names shorten to the census's cap. Notes, names and identities are what
        a before/after comparison needs."""
        payload = json.dumps({"pads": entries}, separators=(",", ":"))
        if len(payload) <= NAMES_BYTES_SOFT_CAP:
            return payload
        slim = [{"note": e["note"], "name": e["name"], "ptr": e["ptr"]} for e in entries]
        payload = json.dumps({"pads": slim, "truncated": True}, separators=(",", ":"))
        if len(payload) <= NAMES_BYTES_SOFT_CAP:
            return payload
        for e in slim:
            e["name"] = e["name"][:PAD_NAME_MAX]
        return json.dumps({"pads": slim, "truncated": True}, separators=(",", ":"))

    def _names_failed(self, request_id: str, code: str, detail: str) -> None:
        logger.info("DrumSwapComponent: pad_names %s: %s", code, detail)
        self._emit(V3_DRUM_PAD_NAMES_REPLY_ADDRESS, (request_id, 0, code, detail[:160], ""))

    @staticmethod
    def _parse_notes(text: str):
        """``None`` for every pad (``*``), a set of notes, or ``False`` when malformed."""
        if text.strip() == "*":
            return None
        try:
            notes: set[int] = {int(part) for part in text.split(",") if part.strip()}
        except ValueError:
            return False
        if not notes or any(n < 0 or n > 127 for n in notes):
            return False
        return notes

    # --- LOM reads ---------------------------------------------------------------

    def _rack(self, rack_path: str):
        result = resolve_device(self._song, rack_path)
        if result.status is not ResolveStatus.OK or result.obj is None:
            return None, (ERR_NOT_FOUND, result.detail or rack_path)
        try:
            class_name = result.obj.class_name
        except _LOM_ERRORS:
            class_name = ""
        if class_name != DRUM_RACK_CLASS:
            return None, (ERR_NOT_A_KIT, "%s is a %s" % (rack_path, class_name or "device of no class"))
        return result.obj, None

    @staticmethod
    def _pads(rack, wanted: set[int] | None) -> list[object]:
        try:
            pads = list(rack.drum_pads or ())
        except _LOM_ERRORS:
            return []
        if wanted is None:
            return pads
        # drum_pads is note-indexed on the rig (drum_pads[36].note == 36); an
        # index read is cheap next to a whole-rack walk, so try it first.
        out = []
        for note in sorted(wanted):
            pad = pads[note] if note < len(pads) else None
            try:
                if pad is None or int(pad.note) != note:
                    pad = next((p for p in pads if int(p.note) == note), None)
            except _LOM_ERRORS + (ValueError,):
                pad = None
            if pad is not None:
                out.append(pad)
        return out

    def _pad_with_chain(self, rack, note: int):
        for pad in self._pads(rack, {note}):
            if pad_devices(pad) is not None:
                return pad
        return None

    @staticmethod
    def _chain_state(pad):
        """``(note, chain, chain name, first instrument's name)`` for a pad that
        carries a chain — names whole and stripped, the instrument's ``""`` when
        the chain holds only effects — or None."""
        devices = pad_devices(pad)
        if devices is None:
            return None
        try:
            note = int(pad.note)
            chain = pad.chains[0]
            chain_name = _coerce_str(chain.name).strip()
        except _LOM_ERRORS + (ValueError, IndexError):
            return None
        found = first_instrument(devices)
        instrument = ""
        if found is not None:
            try:
                instrument = _coerce_str(found[0].name).strip()
            except _LOM_ERRORS:
                instrument = ""
        return note, chain, chain_name, instrument
