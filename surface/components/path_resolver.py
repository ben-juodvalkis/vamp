"""path_resolver — v3 path string → LOM object, O(1) on all segments.

Implements the resolution side of [04 §2](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#2-path-grammar).
Given a path string like ``"tracks/0/devices/1/params/2"`` returns the
``DeviceParameter`` (or ``Track`` / ``Device`` / ``Clip``) at that
position. Every index is a list access; no walk, no registry lookup —
this is the v3 write hot path.

Resolution returns a ``ResolveResult`` enum-like return rather than
raising: the caller (``DevicesComponent.handle_set_param_v3``) needs
to distinguish ``path-not-found`` (path names a position that never
existed) from ``path-not-supported`` (grammar valid but Phase-1
doesn't ship this suffix — ``chains/...`` and ``returns/...``) from
``path-structural-mismatch`` (the path was valid at an earlier
generation but no longer resolves). The latter is handled one level
up: this resolver only sees the current LOM and the current path.

Grammar ([04 §2.1]):

    paramRef    := deviceRef "/params/" index
    deviceRef   := trackRef "/devices/" index
    trackRef    := "tracks/" index | "master" | "returns/" index
    slotRef     := "tracks/" index "/slots/" index
    clipRef     := slotRef "/clip"

    // Drum pad chains (issue #491, protocol 3.8.0) — a note-keyed pad under
    // a Drum Rack, then that pad's first chain's devices. Recursive: a
    // rack inside a pad chain takes the same suffix.
    padRef      := deviceRef "/pads/" note              // 0..127, the DrumPad's MIDI note
    deviceRef   := padRef "/devices/" index             // drum_pads[note].chains[0].devices[index]

    // Future; Phase 1 rejects with path-not-supported:
    deviceRef   := deviceRef "/chains/" index "/devices/" index

Indices are decimal digits, no leading zero except ``"0"``. Segment
names are closed-enum (``tracks``, ``master``, ``returns``,
``devices``, ``params``, ``slots``, ``clip``, ``scenes``, ``chains``,
``pads``). Anything else is ``malformed``.

Why ``pads/<note>`` rather than the reserved ``chains/<index>`` for a
Drum Rack: ``rack.chains`` is a flat list that re-indexes whenever a pad
gains or loses a chain, while every per-pad row the property channel
already carries (``vm.pad.<note>.<fn>``, ``vm.selectedPad``, the census)
keys on the note. ``chains/`` stays reserved for Instrument and Audio
Effect Racks.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

logger = logging.getLogger("looping")

try:
    from .LOMListeners import _safe_int_id as _lom_safe_int_id
except ImportError:
    _lom_safe_int_id = None


# --- error codes (closed-enum, per [04 §7.2]) -----------------------------


class ResolveStatus(str, Enum):
    """Outcome of a single ``resolve_*`` call.

    ``OK`` means the target object is in ``ResolveResult.obj``. Every
    other status maps to a typed v3 error code per [04 §7.2]; the
    caller (``DevicesComponent``) composes the ``/looping/v3/error``
    reply.

    ``MALFORMED`` is intentionally distinct from ``NOT_FOUND``:
    malformed means the grammar doesn't parse (``"xyzzy"``, empty
    string, negative index); not-found means the grammar is valid but
    no LOM object exists at that position right now.

    ``CLIP_NOT_PRESENT`` is resolve_clip-specific: the ``slotRef``
    prefix resolved cleanly but the slot currently holds no clip. The
    caller logs this separately from NOT_FOUND so "you asked for a slot
    that doesn't exist" stays distinct from "the slot is empty." See
    [04 §7.2] error codes and PR-5e1 checklist.
    """

    OK = "ok"
    NOT_FOUND = "path-not-found"
    NOT_SUPPORTED = "path-not-supported"
    MALFORMED = "malformed"
    CLIP_NOT_PRESENT = "clip-not-present"


@dataclass
class ResolveResult:
    """Return shape for ``resolve_*`` helpers.

    On ``OK``: ``obj`` is the resolved LOM object (``Parameter``,
    ``Device``, ``Track``, ``Clip`` depending on which helper was
    called). On any other status: ``obj`` is ``None`` and ``detail``
    may carry a short human-readable reason (logged, not branched-on).
    """

    status: ResolveStatus
    obj: Optional[object] = None
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status is ResolveStatus.OK


# --- path parsing ----------------------------------------------------------


# Closed-enum segment names; anything else in a segment slot is malformed.
_SEGMENT_TRACKS = "tracks"
_SEGMENT_MASTER = "master"
_SEGMENT_RETURNS = "returns"
_SEGMENT_DEVICES = "devices"
_SEGMENT_PARAMS = "params"
_SEGMENT_SLOTS = "slots"
_SEGMENT_CLIP = "clip"
_SEGMENT_SCENES = "scenes"
_SEGMENT_CHAINS = "chains"
_SEGMENT_PADS = "pads"

#: The highest MIDI note a ``pads/<note>`` segment may name — and the one
#: ceiling every pad-note parser on the surface shares (the property rows,
#: the pad-chain rows, the selected-pad write); it used to be typed in
#: four places (code review, 2026-09-12).
PAD_NOTE_MAX = 127


def _parse_index(token: str) -> Optional[int]:
    """Parse a single index token.

    Returns the integer or ``None`` if malformed. Rules from [04 §2.1]:

    - All digits (``0-9``)
    - No leading zero except for ``"0"`` itself (so ``"01"`` is
      malformed — not 1)
    - Non-negative (no ``"-1"`` in v3 paths; ``master`` is the
      master-sentinel)

    The leading-zero rule matters because future path-comparison code
    may string-equal paths; ``"tracks/0"`` and ``"tracks/00"`` both
    resolving to the same track would be an invalidation bug waiting
    to happen.
    """
    if not token or not token.isdigit():
        return None
    if len(token) > 1 and token[0] == "0":
        return None
    try:
        return int(token)
    except ValueError:
        return None


def _split(path: str) -> Optional[list]:
    """Split a path into its slash-delimited segments.

    Returns ``None`` if the path is empty, has a leading/trailing slash,
    or any empty segment (``"a//b"``). These would all be malformed
    per [04 §2.3].
    """
    if not path:
        return None
    if path.startswith("/") or path.endswith("/"):
        return None
    parts = path.split("/")
    if any(p == "" for p in parts):
        return None
    return parts


# --- LOM access helpers (copies of the DevicesComponent pattern) ----------


def _safe_master_track(song):
    try:
        return song.master_track
    except Exception as e:
        logger.warning("path_resolver: master_track read failed: %s", e)
        return None


def _safe_tracks_list(song):
    try:
        return list(song.tracks)
    except Exception as e:
        logger.warning("path_resolver: tracks read failed: %s", e)
        return None


def _safe_return_tracks_list(song):
    """Return tracks — ``song.return_tracks`` is the LOM attribute.

    Phase 1 rejects ``returns/...`` paths upstream with NOT_SUPPORTED
    before this would be called, but we still guard it so a future
    grammar extension doesn't silently pass ``None`` to ``len``.
    """
    try:
        return list(song.return_tracks)
    except Exception as e:
        logger.warning("path_resolver: return_tracks read failed: %s", e)
        return None


def _safe_devices(track) -> list:
    try:
        devices_attr = track.devices
    except Exception:
        return []
    try:
        return list(devices_attr) if devices_attr is not None else []
    except Exception:
        return []


def _safe_params(device) -> list:
    try:
        params_attr = device.parameters
    except Exception:
        return []
    try:
        return list(params_attr) if params_attr is not None else []
    except Exception:
        return []


def find_drum_pad(rack, note: int):
    """The ``DrumPad`` for ``note`` on ``rack``, or ``None``.

    ``drum_pads`` is Live's list of 128 ``DrumPad`` objects; on the rig
    it is indexed by note (``drum_pads[36].note == 36``, measured
    2026-09-08), so the note is tried as an index first and the list is
    scanned only when that read does not agree. Every LOM raise answers
    ``None``. The one pad-by-note lookup on the surface — the resolver,
    the pad-chain component and the selected-pad write all used to carry
    their own, one of them index-only (code review, 2026-09-12).
    """
    if not 0 <= note <= PAD_NOTE_MAX:
        return None
    try:
        pads = rack.drum_pads
    except (RuntimeError, AttributeError, TypeError):
        return None
    try:
        candidate = pads[note]
        if int(candidate.note) == note:
            return candidate
    except (IndexError, TypeError, ValueError, RuntimeError, AttributeError):
        pass
    try:
        for candidate in pads:
            try:
                if int(candidate.note) == note:
                    return candidate
            except (TypeError, ValueError, RuntimeError, AttributeError):
                continue
    except (RuntimeError, AttributeError, TypeError):
        return None
    return None


def _safe_pad_chain(device, note: int):
    """``(pad, chain)`` for ``note`` on a Drum Rack, or ``None``.

    A pad with no chain, a device that is not a Drum Rack
    (``can_have_drum_pads`` false or absent) and every LOM raise answer
    ``None`` — NOT_FOUND to the caller, never a raise out of the resolver.
    """
    try:
        if not getattr(device, "can_have_drum_pads", False):
            return None
        pad = find_drum_pad(device, note)
        if pad is None:
            return None
        chains = list(pad.chains or ())
    except (RuntimeError, AttributeError, TypeError):
        return None
    if not chains:
        return None
    return pad, chains[0]


def _safe_clip_slots(track) -> list:
    """Return a track's clip_slots list. Empty on any read failure."""
    try:
        slots_attr = track.clip_slots
    except Exception:
        return []
    try:
        return list(slots_attr) if slots_attr is not None else []
    except Exception:
        return []


def _safe_scenes_list(song):
    """Return ``song.scenes`` as a list, or ``None`` on failure.

    Scenes are a song-level peer of tracks — per [04 §2.1] scene paths
    are ``scenes/<N>`` with no track prefix. Returning ``None`` on read
    failure mirrors ``_safe_tracks_list``; empty song yields ``[]``.
    """
    try:
        return list(song.scenes)
    except Exception as e:
        logger.warning("path_resolver: scenes read failed: %s", e)
        return None


# --- segment-level resolvers ----------------------------------------------


def _resolve_track_segment(
    song, parts: list, start: int,
) -> tuple:
    """Consume the trackRef prefix of ``parts`` starting at ``start``.

    Returns ``(track, next_index, status)`` where ``status`` is OK on
    success, NOT_SUPPORTED for ``returns/...``, MALFORMED for bad
    grammar, or NOT_FOUND if the index is out of range. ``track`` is
    ``None`` on any non-OK status.

    The three shapes the grammar allows:

    - ``tracks/<N>`` — regular track by index
    - ``master`` — the master track
    - ``returns/<N>`` — future; rejected with NOT_SUPPORTED in Phase 1
    """
    if start >= len(parts):
        return None, start, ResolveStatus.MALFORMED

    head = parts[start]

    if head == _SEGMENT_MASTER:
        master = _safe_master_track(song)
        if master is None:
            return None, start + 1, ResolveStatus.NOT_FOUND
        return master, start + 1, ResolveStatus.OK

    if head == _SEGMENT_TRACKS:
        if start + 1 >= len(parts):
            return None, start, ResolveStatus.MALFORMED
        idx = _parse_index(parts[start + 1])
        if idx is None:
            return None, start, ResolveStatus.MALFORMED
        tracks = _safe_tracks_list(song)
        if tracks is None or idx >= len(tracks):
            return None, start + 2, ResolveStatus.NOT_FOUND
        return tracks[idx], start + 2, ResolveStatus.OK

    if head == _SEGMENT_RETURNS:
        # Grammar-valid but implementation defers to Phase 4 follow-up.
        # Per [04 §7.2] this is NOT_SUPPORTED, not NOT_FOUND.
        if start + 1 >= len(parts):
            return None, start, ResolveStatus.MALFORMED
        if _parse_index(parts[start + 1]) is None:
            return None, start, ResolveStatus.MALFORMED
        return (
            None, start + 2, ResolveStatus.NOT_SUPPORTED,
        )

    # Unknown segment name in track slot.
    return None, start, ResolveStatus.MALFORMED


def _resolve_device_segment(
    track, parts: list, start: int,
) -> tuple:
    """Consume ``devices/<N>`` after a track — and, since protocol 3.8.0,
    any ``pads/<note>/devices/<M>`` suffixes under it (issue #491).

    The walk is "container, then devices": a track holds devices, a
    Drum Rack device holds pads, a pad's first chain holds devices, and
    that chain's devices may hold pads again. Every level is an O(1)
    list access.

    Chains (``chains/<N>``, Instrument / Audio Effect Rack chains) are
    grammar-reserved and still reject with NOT_SUPPORTED.

    Returns ``(device, next_index, status)``.
    """
    container = track
    idx = start
    while True:
        if idx >= len(parts):
            return None, idx, ResolveStatus.MALFORMED

        head = parts[idx]

        if head == _SEGMENT_CHAINS:
            # chains/<N>/devices/<N>... — valid grammar, Phase 1 punts.
            if idx + 1 >= len(parts):
                return None, idx, ResolveStatus.MALFORMED
            if _parse_index(parts[idx + 1]) is None:
                return None, idx, ResolveStatus.MALFORMED
            return None, idx + 2, ResolveStatus.NOT_SUPPORTED

        if head != _SEGMENT_DEVICES:
            return None, idx, ResolveStatus.MALFORMED

        if idx + 1 >= len(parts):
            return None, idx, ResolveStatus.MALFORMED

        dev_idx = _parse_index(parts[idx + 1])
        if dev_idx is None:
            return None, idx, ResolveStatus.MALFORMED

        devices = _safe_devices(container)
        if dev_idx >= len(devices):
            return None, idx + 2, ResolveStatus.NOT_FOUND
        device = devices[dev_idx]
        idx += 2

        if idx < len(parts) and parts[idx] == _SEGMENT_PADS:
            # pads/<note>/devices/<M>... — descend into the pad's chain.
            if idx + 1 >= len(parts):
                return None, idx, ResolveStatus.MALFORMED
            note = _parse_index(parts[idx + 1])
            if note is None or note > PAD_NOTE_MAX:
                return None, idx, ResolveStatus.MALFORMED
            found = _safe_pad_chain(device, note)
            if found is None:
                return None, idx + 2, ResolveStatus.NOT_FOUND
            idx += 2
            # A pad ref is a container, not a device: the path must go on
            # to name a device on the chain.
            if idx >= len(parts) or parts[idx] != _SEGMENT_DEVICES:
                return None, idx, ResolveStatus.MALFORMED
            container = found[1]
            continue

        if idx < len(parts) and parts[idx] == _SEGMENT_CHAINS:
            # devices/<N>/chains/<M>/… — an Instrument / Audio Effect Rack
            # chain: valid grammar, still reserved.
            return None, idx, ResolveStatus.NOT_SUPPORTED

        return device, idx, ResolveStatus.OK


@dataclass
class PadRef:
    """What ``resolve_pad`` answers: the Drum Rack, the pad and its first
    chain, plus the rack's own path and the note — everything a pad-
    scoped load or listener needs in one read."""

    rack: object
    rack_path: str
    note: int
    pad: object
    chain: object


def resolve_pad(song, path: str) -> ResolveResult:
    """Resolve a ``padRef`` (``…/devices/<N>/pads/<note>``) to a
    :class:`PadRef` (issue #491).

    NOT_FOUND when the device is not a Drum Rack, the note has no pad or
    the pad carries no chain; MALFORMED for anything that is not exactly
    a device path followed by one ``pads/<note>``.
    """
    parts = _split(path)
    if parts is None:
        return ResolveResult(ResolveStatus.MALFORMED, detail=f"empty/bad-slashes: {path!r}")
    # The shortest padRef is five segments — ``master/devices/0/pads/36``;
    # a four-segment ``tracks/1/pads/36`` names no device to hold the pad.
    if len(parts) < 5 or parts[-2] != _SEGMENT_PADS:
        return ResolveResult(ResolveStatus.MALFORMED, detail=f"expected pads/<note> suffix: {path!r}")
    note = _parse_index(parts[-1])
    if note is None or note > PAD_NOTE_MAX:
        return ResolveResult(ResolveStatus.MALFORMED, detail=f"bad pad note: {path!r}")
    rack_path = "/".join(parts[:-2])
    r = resolve_device(song, rack_path)
    if r.status is not ResolveStatus.OK:
        return ResolveResult(r.status, detail=f"rack segment: {path!r}")
    found = _safe_pad_chain(r.obj, note)
    if found is None:
        return ResolveResult(ResolveStatus.NOT_FOUND, detail=f"no pad chain at note {note}: {path!r}")
    pad, chain = found
    return ResolveResult(ResolveStatus.OK, obj=PadRef(r.obj, rack_path, note, pad, chain))


def is_pad_scoped(path: str) -> bool:
    """Whether ``path`` names, or sits inside, a drum pad chain."""
    parts = _split(path)
    return bool(parts) and _SEGMENT_PADS in parts


# --- public API -----------------------------------------------------------


def resolve_track(song, path: str) -> ResolveResult:
    """Resolve a ``trackRef`` path to a ``Track``.

    Valid inputs: ``"master"``, ``"tracks/<N>"``. ``"returns/<N>"``
    returns NOT_SUPPORTED.
    """
    parts = _split(path)
    if parts is None:
        return ResolveResult(ResolveStatus.MALFORMED, detail=f"empty/bad-slashes: {path!r}")

    track, consumed, status = _resolve_track_segment(song, parts, 0)
    if status is not ResolveStatus.OK:
        return ResolveResult(status, detail=f"track segment: {path!r}")
    if consumed != len(parts):
        # Trailing segments after trackRef — it's a deviceRef / paramRef /
        # slotRef, not a bare trackRef. The caller asked the wrong resolver.
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"trailing after trackRef: {path!r}",
        )
    return ResolveResult(ResolveStatus.OK, obj=track)


def resolve_device(song, path: str) -> ResolveResult:
    """Resolve a ``deviceRef`` path to a ``Device``.

    Valid: ``"tracks/<N>/devices/<M>"``, ``"master/devices/<M>"``, and
    since 3.8.0 ``"…/devices/<M>/pads/<note>/devices/<K>"`` — a device
    on a drum pad's chain (issue #491). Chain suffixes return
    NOT_SUPPORTED.
    """
    parts = _split(path)
    if parts is None:
        return ResolveResult(ResolveStatus.MALFORMED, detail=f"empty/bad-slashes: {path!r}")

    track, consumed, status = _resolve_track_segment(song, parts, 0)
    if status is not ResolveStatus.OK:
        return ResolveResult(status, detail=f"track segment: {path!r}")

    device, consumed, status = _resolve_device_segment(track, parts, consumed)
    if status is not ResolveStatus.OK:
        return ResolveResult(status, detail=f"device segment: {path!r}")

    if consumed != len(parts):
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"trailing after deviceRef: {path!r}",
        )
    return ResolveResult(ResolveStatus.OK, obj=device)


def resolve_param(song, path: str) -> ResolveResult:
    """Resolve a ``paramRef`` path to a ``DeviceParameter``.

    Valid: ``"tracks/<N>/devices/<M>/params/<K>"``,
    ``"master/devices/<M>/params/<K>"``.

    This is the v3 write hot path called from
    ``DevicesComponent.handle_set_param_v3``. Every segment is an O(1)
    list access; aggregate resolution is a small constant number of
    reads — sub-microsecond when LOM hot, still sub-millisecond under
    any realistic contention.
    """
    parts = _split(path)
    if parts is None:
        return ResolveResult(ResolveStatus.MALFORMED, detail=f"empty/bad-slashes: {path!r}")

    track, consumed, status = _resolve_track_segment(song, parts, 0)
    if status is not ResolveStatus.OK:
        return ResolveResult(status, detail=f"track segment: {path!r}")

    device, consumed, status = _resolve_device_segment(track, parts, consumed)
    if status is not ResolveStatus.OK:
        return ResolveResult(status, detail=f"device segment: {path!r}")

    # If the next segment is ``chains/<N>``, the whole paramRef is
    # grammar-valid but Phase-1-unimplemented. Report NOT_SUPPORTED
    # rather than letting the tail parse fail as MALFORMED — the v3
    # error code distinction matters to the UI (branch: retry at new
    # path vs. show rack-chain-unsupported message).
    if consumed < len(parts) and parts[consumed] == _SEGMENT_CHAINS:
        return ResolveResult(
            ResolveStatus.NOT_SUPPORTED,
            detail=f"rack chains not implemented: {path!r}",
        )

    # Remaining must be ``params/<K>``.
    if consumed + 2 != len(parts) or parts[consumed] != _SEGMENT_PARAMS:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"expected params/<N> suffix: {path!r}",
        )
    idx = _parse_index(parts[consumed + 1])
    if idx is None:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"bad params index: {path!r}",
        )

    params = _safe_params(device)
    if idx >= len(params):
        return ResolveResult(
            ResolveStatus.NOT_FOUND,
            detail=f"param index out of range: {path!r}",
        )
    return ResolveResult(ResolveStatus.OK, obj=params[idx])


def resolve_slot(song, path: str) -> ResolveResult:
    """Resolve a ``slotRef`` path to a clip slot object.

    Valid: ``"tracks/<N>/slots/<M>"``. ``master`` has no slots; passing
    a master-rooted slot path returns NOT_FOUND.
    """
    parts = _split(path)
    if parts is None:
        return ResolveResult(ResolveStatus.MALFORMED, detail=f"empty/bad-slashes: {path!r}")

    track, consumed, status = _resolve_track_segment(song, parts, 0)
    if status is not ResolveStatus.OK:
        return ResolveResult(status, detail=f"track segment: {path!r}")

    # Remaining must be ``slots/<M>``.
    if consumed + 2 != len(parts) or parts[consumed] != _SEGMENT_SLOTS:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"expected slots/<N> suffix: {path!r}",
        )
    idx = _parse_index(parts[consumed + 1])
    if idx is None:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"bad slots index: {path!r}",
        )

    slots = _safe_clip_slots(track)
    if idx >= len(slots):
        return ResolveResult(
            ResolveStatus.NOT_FOUND,
            detail=f"slot index out of range: {path!r}",
        )
    return ResolveResult(ResolveStatus.OK, obj=slots[idx])


def resolve_clip(song, path: str) -> ResolveResult:
    """Resolve a ``clipRef`` path to the clip object currently in the slot.

    Valid: ``"tracks/<N>/slots/<M>/clip"``. The trailing ``/clip``
    disambiguates from a bare ``slotRef`` — callers with a raw
    ``slotRef`` should use ``resolve_slot`` instead and inspect
    ``slot.has_clip`` themselves.

    Returns ``CLIP_NOT_PRESENT`` when the slot resolves but the slot
    is empty (``slot.has_clip`` is false). Returns ``MALFORMED`` when
    the trailing ``/clip`` segment is missing or misspelled. The
    ``slot.has_clip`` read is guarded: under Live 12 a torn-down
    slot can raise ``RuntimeError`` from inside the property getter.
    On read failure we treat the slot as empty (safer than raising).
    """
    parts = _split(path)
    if parts is None:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"empty/bad-slashes: {path!r}",
        )

    track, consumed, status = _resolve_track_segment(song, parts, 0)
    if status is not ResolveStatus.OK:
        return ResolveResult(status, detail=f"track segment: {path!r}")

    # Remaining must be ``slots/<M>/clip``.
    if consumed + 3 != len(parts):
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"expected slots/<N>/clip suffix: {path!r}",
        )
    if parts[consumed] != _SEGMENT_SLOTS:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"expected slots segment: {path!r}",
        )
    if parts[consumed + 2] != _SEGMENT_CLIP:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"expected trailing /clip: {path!r}",
        )
    idx = _parse_index(parts[consumed + 1])
    if idx is None:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"bad slots index: {path!r}",
        )

    slots = _safe_clip_slots(track)
    if idx >= len(slots):
        return ResolveResult(
            ResolveStatus.NOT_FOUND,
            detail=f"slot index out of range: {path!r}",
        )
    slot = slots[idx]
    try:
        has_clip = bool(slot.has_clip)
    except (RuntimeError, AttributeError) as e:
        logger.warning(
            "path_resolver resolve_clip has_clip read failed (%s): %s",
            path, e,
        )
        has_clip = False
    if not has_clip:
        return ResolveResult(
            ResolveStatus.CLIP_NOT_PRESENT,
            detail=f"slot empty: {path!r}",
        )
    try:
        clip = slot.clip
    except (RuntimeError, AttributeError) as e:
        logger.warning(
            "path_resolver resolve_clip clip read failed (%s): %s",
            path, e,
        )
        return ResolveResult(
            ResolveStatus.CLIP_NOT_PRESENT,
            detail=f"clip unreadable: {path!r}",
        )
    if clip is None:
        return ResolveResult(
            ResolveStatus.CLIP_NOT_PRESENT,
            detail=f"clip is None despite has_clip: {path!r}",
        )
    return ResolveResult(ResolveStatus.OK, obj=clip)


def resolve_scene(song, path: str) -> ResolveResult:
    """Resolve a ``sceneRef`` path to a ``Scene``.

    Valid: ``"scenes/<N>"`` — song-scoped per [04 §2.1]. Scenes live
    at the song level (peer to ``tracks/`` and ``master``); a scene
    path carries no track prefix.

    Returns ``NOT_FOUND`` when the index is out of ``song.scenes``
    range; ``MALFORMED`` for grammar violations (empty, wrong segment,
    non-integer index, trailing segments). Phase 7 PR-7b's
    ``ScenesComponent`` is the first caller.
    """
    parts = _split(path)
    if parts is None:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"empty/bad-slashes: {path!r}",
        )
    if len(parts) != 2 or parts[0] != _SEGMENT_SCENES:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"expected scenes/<N>: {path!r}",
        )
    idx = _parse_index(parts[1])
    if idx is None:
        return ResolveResult(
            ResolveStatus.MALFORMED,
            detail=f"bad scene index: {path!r}",
        )

    scenes = _safe_scenes_list(song)
    if scenes is None or idx >= len(scenes):
        return ResolveResult(
            ResolveStatus.NOT_FOUND,
            detail=f"scene index out of range: {path!r}",
        )
    return ResolveResult(ResolveStatus.OK, obj=scenes[idx])


# --- path composition (inverse, used by StateFullComponent emitters) ------


def compose_track_path(song, track) -> Optional[str]:
    """Return the canonical path for a ``Track``, or ``None``.

    Used by v3 state/full emission. **Not** used by LOMListeners: this
    docstring claimed it was, but that module imports nothing from here
    and carries its own ``_track_segment_for`` plus the equivalent walk
    in ``recompute_param_paths``. The duplication is deliberate — the
    resolver stays free of back-references — but it is duplication, so
    a change to the segment grammar has to land in both.

    Uses ``same_lom_handle`` rather than plain ``is`` because Live's
    wrapper re-instantiates the Python proxy on every attribute read;
    ``is`` fails even when both wrappers point at the same LOM track.
    See ``same_lom_handle`` below.
    """
    master = _safe_master_track(song)
    if master is not None and same_lom_handle(track, master):
        return _SEGMENT_MASTER
    tracks = _safe_tracks_list(song)
    if tracks is None:
        return None
    for idx, t in enumerate(tracks):
        if same_lom_handle(t, track):
            return "%s/%d" % (_SEGMENT_TRACKS, idx)
    return None


def compose_device_path(song, track, device_index: int) -> Optional[str]:
    """Return the canonical path for a device on a known track."""
    tseg = compose_track_path(song, track)
    if tseg is None:
        return None
    return "%s/%s/%d" % (tseg, _SEGMENT_DEVICES, device_index)


def compose_param_path(
    song, track, device_index: int, param_index: int,
) -> Optional[str]:
    """Return the canonical path for a parameter."""
    dseg = compose_device_path(song, track, device_index)
    if dseg is None:
        return None
    return "%s/%s/%d" % (dseg, _SEGMENT_PARAMS, param_index)


def compose_pad_path(device_path: str, note: int) -> str:
    """``tracks/1/devices/0`` + 38 → ``tracks/1/devices/0/pads/38`` (3.8.0)."""
    return "%s/%s/%d" % (device_path, _SEGMENT_PADS, note)


def compose_chain_device_path(pad_path: str, device_index: int) -> str:
    """The path of the device at ``device_index`` on a pad's chain."""
    return "%s/%s/%d" % (pad_path, _SEGMENT_DEVICES, device_index)


def compose_param_path_under(device_path: str, param_index: int) -> str:
    """``<any deviceRef>/params/<K>`` — the parameter form for a device
    path already in hand (a pad-chain device's, typically)."""
    return "%s/%s/%d" % (device_path, _SEGMENT_PARAMS, param_index)


def compose_slot_path(song, track, slot_index: int) -> Optional[str]:
    """Return the canonical path for a clip slot on a known track.

    Master has no slots; composing a master-rooted slot path is
    grammar-legal but resolves to ``NOT_FOUND`` in ``resolve_slot``.
    We return the string anyway so the caller can surface the
    NOT_FOUND diagnostic uniformly.
    """
    tseg = compose_track_path(song, track)
    if tseg is None:
        return None
    return "%s/%s/%d" % (tseg, _SEGMENT_SLOTS, slot_index)


def compose_clip_path(song, track, slot_index: int) -> Optional[str]:
    """Return the canonical ``clipRef`` path for a slot on a known track.

    Does not check ``slot.has_clip`` — the path is the address, not
    an existence claim. Used by ``ClipPropertiesComponent`` to emit
    ``/looping/v3/clip/focused`` after a reverse-lookup via
    ``clip_path_for``.
    """
    sseg = compose_slot_path(song, track, slot_index)
    if sseg is None:
        return None
    return "%s/%s" % (sseg, _SEGMENT_CLIP)


def compose_scene_path(scene_index: int) -> str:
    """Return the canonical ``sceneRef`` path for a scene index.

    Song-scoped per [04 §2.1] — no track prefix. Unlike
    ``compose_slot_path`` this never returns ``None``: scene indices
    are not gated on any LOM handle, and a negative index is a caller
    bug that would surface as NOT_FOUND at resolve time. Tests assert
    the roundtrip against ``resolve_scene``.
    """
    return "%s/%d" % (_SEGMENT_SCENES, scene_index)


def clip_path_for(song, clip) -> Optional[str]:
    """Reverse-lookup: return the ``clipRef`` that resolves to ``clip``.

    Walks ``song.tracks`` (+ master) and each track's ``clip_slots``
    looking for the slot whose ``.clip is clip``. Returns ``None`` if
    the clip is not in any session slot — typical cases:

    - Arrangement-only clips. ``live_set view.detail_clip`` can point
      at a clip that lives only in the arrangement view; no slot
      holds it, so no ``clipRef`` exists. Caller emits empty
      ``focused`` path so the UI knows "no focus."
    - Clip on a chain inside a rack. Phase-1 v3 doesn't enumerate
      chain slots; those return ``None`` too.
    - Clip has been deleted since the focus change fired. The LOM
      listener is the authoritative signal for that — we just report
      honestly here.

    Cost: O(tracks × slots-per-track). On a 50-track × 100-slot set
    this is 5000 ``is`` comparisons, still sub-millisecond. Called on
    focus change (rare) and on ``emit_on_accept`` (once per
    connect) — not on the write hot path. If this ever shows up in
    profiles we can cache ``clip → path`` forward at resolve time,
    but the cache invalidation cost at clip create/delete offsets the
    lookup savings.
    """
    if clip is None:
        return None
    # Fast-path: quick identity check for master track slots. Master
    # tracks don't hold clip slots in any current Live build, but
    # future-proofing in case a return or master starts exposing
    # slots — the walk handles it uniformly.
    master = _safe_master_track(song)
    if master is not None:
        slots = _safe_clip_slots(master)
        for idx, slot in enumerate(slots):
            if _slot_holds(slot, clip):
                return compose_clip_path(song, master, idx)
    tracks = _safe_tracks_list(song)
    if tracks is None:
        return None
    for track in tracks:
        slots = _safe_clip_slots(track)
        for idx, slot in enumerate(slots):
            if _slot_holds(slot, clip):
                return compose_clip_path(song, track, idx)
    return None


def _slot_holds(slot, clip) -> bool:
    """Return True iff ``slot.clip`` refers to the same LOM clip as ``clip``.

    Cannot use plain ``is`` — Live wraps each property read in a fresh
    Python proxy, so ``slot.clip is song.view.detail_clip`` returns
    False even when both point at the same underlying clip. We compare
    by ``_live_ptr`` (LOM pointer), mirroring the
    ``LOMListeners._same_lom_track`` pattern. Guarded against the
    Live-12 RuntimeError that can come from inside torn-down slots.
    """
    try:
        if not bool(slot.has_clip):
            return False
    except (RuntimeError, AttributeError):
        return False
    try:
        slot_clip = slot.clip
    except (RuntimeError, AttributeError):
        return False
    return same_lom_handle(slot_clip, clip)


def lom_id(obj) -> Optional[int]:
    """The stable identity :func:`same_lom_handle` compares —
    ``LOMListeners._safe_int_id`` (``_live_ptr`` first, ``.id`` second,
    masked to int32) — or ``None`` when the object has neither. The one
    id helper for callers that key a set on it (the loader's "which device
    is new" snapshots used to carry their own copy — code review,
    2026-09-12)."""
    if obj is None or _lom_safe_int_id is None:
        return None
    return _lom_safe_int_id(obj)


def same_lom_handle(a, b) -> bool:
    """Return True if ``a`` and ``b`` point at the same LOM object.

    Fast path: ``a is b`` (test stubs share identity; Live sometimes
    hands back the same wrapper). Fallback: compare ``_live_ptr``
    (masked to int32, matching ``LOMListeners._safe_int_id``). Needed
    because Live's wrapper layer constructs a fresh Python proxy on
    every property read, so two reads for the same underlying LOM
    object fail an ``is`` check.
    """
    if a is None or b is None:
        return False
    if a is b:
        return True
    if _lom_safe_int_id is None:
        return False
    aid = _lom_safe_int_id(a)
    bid = _lom_safe_int_id(b)
    if aid is None or bid is None:
        return False
    return aid == bid


# Backwards-compatible alias. ``same_lom_handle`` was promoted from private to
# public 2026-08-29 (audit item 6) so components outside this module can share
# one LOM-identity implementation instead of each rolling their own.
_same_lom_handle = same_lom_handle
