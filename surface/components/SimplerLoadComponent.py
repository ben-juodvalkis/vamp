"""SimplerLoadComponent — audio clip → Simpler sampling (Flow #1).

Owns the single wire:

    /looping/v3/simpler/replace_sample  [clipPath:str]

Reads the audio clip's ``file_path`` from the LOM (UI doesn't carry
it), creates a new MIDI track adjacent to the source audio track,
inserts a Simpler by name (``Track.insert_device("Simpler")``, replacing
any instrument the track came with), then calls
``simpler.replace_sample(file_path)`` on it. Unblocked 2026-04-23 by Live 12.4b16 exposing
``SimplerDevice.replace_sample(abs_path)`` — release notes confirmed
and M4L ``getinfo`` on a running Simpler showed the method.

Design mirrors DeviceLoadComponent:

- Stateless, one-shot, structural mutation. No listeners.
- LOM-touch guard ``_LOM_ERRORS = (RuntimeError, AttributeError, TypeError)``
  (TypeError covers Boost.Python.ArgumentError from torn-down handles).
- Emits ``/looping/v3/error [address, code, path, detail]`` on failure
  and ``/looping/v3/simpler/replaced [address, devicePath, filePath]``
  on success. The ack is a side channel for the gesture's initiator
  (auto-trim, Recent); the new MIDI track itself still reaches the UI
  through the device-structure listener's ``state/full``.

Open question #1 from simpler-revamp.md resolved: new MIDI track
adjacent to the audio track, audio clip intact (historical M4L
behavior).

The Simpler is inserted by name since 2026-09-27; it used to be an
``Empty Simpler.adv`` loaded through the browser, a file only the owner's
User Library had. Live gives the inserted Simpler this Mac's own default
Simpler (``Defaults/Instruments/Simpler.adv``) or its factory one.
Measured on the rig the same day: inserted into an empty MIDI track it
reads Classic, takes ``replace_sample``, and names itself after the sample.
Live refuses a second instrument on a chain ("Device chains cannot have
more than one instrument each"), so an instrument already there — a
default MIDI track's Operator — is deleted first, inside the same undo
step.
"""

from __future__ import annotations

import logging
import time
from typing import Callable, Dict, Optional, Tuple

from . import alc_resolver
from . import path_resolver
from . import sample_normalize
from .drum_vm_functions import DEVICE_TYPE_INSTRUMENT, DEVICE_TYPE_MIDI_EFFECT, device_type

logger = logging.getLogger("looping")


# --- in-flight dedupe -----------------------------------------------------
#
# The bridge broadcasts every wire to all WebSocket clients (Mac browser +
# iPad). With two clients connected, a single user gesture lands as two
# identical UI sends → two Python handler invocations milliseconds apart.
# The 2026-04-30 Permute fix moved the work to Python so the doubled
# *follow-up* loads vanished, but here BOTH calls are already in Python:
# both UI clients fire ``loadCaptureIntoSimpler`` from the broadcast
# ``/capture/file``, each calls ``prepareTrack('midi')`` (idempotent —
# returns the same trackPath), then each sends
# ``/looping/v3/simpler/replace_sample_onto_track``.
#
# We can't dedupe by looking at the track after the fact: call #2 runs
# before call #1's devices have settled. Instead, lock at request-time on
# ``(track_path, file_path)`` for a few seconds: same args → silent drop.
# Different file on the same track is still allowed (legitimate retake).
_DEDUPE_TTL_SECONDS = 10.0
_DEDUPE_MAX_ENTRIES = 64


# --- wire addresses (closed-enum) -----------------------------------------

V3_SIMPLER_REPLACE_SAMPLE_ADDRESS = "/looping/v3/simpler/replace_sample"
V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS = "/looping/v3/simpler/replace_sample_onto_track"
V3_ERROR_ADDRESS = "/looping/v3/error"

# Success ack, emitted by both load flows once the sample is on the
# Simpler and its post-load defaults are written. Shape mirrors the
# error envelope (origin address first) so the UI can correlate which
# gesture it belongs to:
#
#     /looping/v3/simpler/replaced [originAddress, devicePath, filePath]
#
# Added 2026-09-17. Before this, success was silent on the wire and the
# UI inferred both halves by eavesdropping on the first ``sample.file_path``
# property echo from a device path that hadn't existed when the gesture
# started. That inference broke whenever the new MIDI track's adjacent
# insert shifted an existing device into the path it landed on (every
# convert except one on the last track), and it only fired at all when
# something on screen happened to be subscribed to that Simpler. The ack
# hands the UI both halves directly.
V3_SIMPLER_REPLACED_ADDRESS = "/looping/v3/simpler/replaced"

# Error codes emitted by this component. Wire shape matches
# DeviceLoadComponent's ``/looping/v3/error [address, code, path, detail]``.
V3_ERROR_CLIP_NOT_FOUND = "clip-not-found"
V3_ERROR_NOT_AUDIO_CLIP = "not-audio-clip"
V3_ERROR_NO_FILE_PATH = "no-file-path"
V3_ERROR_TRACK_INDEX_UNRESOLVED = "track-index-unresolved"
V3_ERROR_CREATE_FAILED = "create-midi-track-failed"
V3_ERROR_INSERT_FAILED = "simpler-insert-failed"
V3_ERROR_REPLACE_SAMPLE_MISSING = "replace-sample-missing"
V3_ERROR_REPLACE_SAMPLE_FAILED = "replace-sample-failed"

# Live's display name for Simpler, what ``insert_device`` takes.
SIMPLER_DEVICE_NAME = "Simpler"



# Tuple of exceptions every LOM touch catches. Same as DeviceLoadComponent.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


class SimplerLoadComponent:
    """Handles the "sample audio clip to Simpler" gesture (Flow #1).

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
    """

    V3_SIMPLER_REPLACE_SAMPLE_ADDRESS = V3_SIMPLER_REPLACE_SAMPLE_ADDRESS
    V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS = (
        V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS
    )
    V3_SIMPLER_REPLACED_ADDRESS = V3_SIMPLER_REPLACED_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
    ) -> None:
        self._song = song
        self._emit = emit
        self._disconnected = False
        # Dedupe key → monotonic timestamp. See module-level comment on
        # ``_DEDUPE_TTL_SECONDS`` for the bridge-broadcast race we're
        # closing. Insertion-order dict so eviction is O(1).
        self._inflight: Dict[Tuple[str, str], float] = {}
        logger.info("SimplerLoadComponent: ready")

    # --- wire handler -----------------------------------------------------

    def handle_replace_sample(self, args, source_addr) -> None:
        """``/looping/v3/simpler/replace_sample [clipPath]``.

        One-tap flow:
        1. Resolve ``clipPath`` → clip; read ``clip.file_path``.
        2. Find the source audio track's index in ``song.tracks``.
        3. ``song.create_midi_track(source_idx + 1)`` — adjacent insert.
        4. Insert a Simpler by name, in place of any instrument the new
           track came with.
        5. ``simpler.replace_sample(file_path)``.

        Every failure maps to a typed ``/looping/v3/error`` with a
        ``path`` carrying the offending clipPath/filePath and a
        ``detail`` naming what went wrong. Success emits
        ``/looping/v3/simpler/replaced`` with the new Simpler's
        devicePath; the state/full listener separately surfaces the new
        track + device on the UI side.
        """
        if self._disconnected:
            return
        logger.info(
            "SimplerLoadComponent: handle_replace_sample args=%r from=%r",
            args, source_addr,
        )
        if len(args) != 1:
            self._emit_error(
                V3_ERROR_REPLACE_SAMPLE_FAILED,
                path="",
                detail="arg-count: expected 1, got %d" % len(args),
            )
            return

        clip_path = _coerce_str(args[0])
        if not clip_path:
            self._emit_error(
                V3_ERROR_CLIP_NOT_FOUND,
                path="",
                detail="empty-clip-path",
            )
            return

        # Dedupe at the wire boundary: the clip-path is a stable proxy
        # for "this exact UI gesture" — deduping here prevents the second
        # broadcast from creating an extra empty MIDI track *before* the
        # downstream load gate can stop it.
        dedupe_key = ("clip", clip_path)
        if self._dedupe_seen_recently(dedupe_key):
            logger.info(
                "SimplerLoadComponent: dedupe — duplicate replace_sample for "
                "%r within %.0fs, dropping",
                clip_path, _DEDUPE_TTL_SECONDS,
            )
            return
        self._dedupe_mark(dedupe_key)

        # 1. Resolve clip + read file_path.
        clip = self._resolve_audio_clip(clip_path)
        if clip is None:
            return  # error already emitted
        file_path = self._read_file_path(clip, clip_path)
        if not file_path:
            return  # error already emitted

        # 2. Find source track index.
        source_idx = self._find_track_index(clip_path)
        if source_idx < 0:
            self._emit_error(
                V3_ERROR_TRACK_INDEX_UNRESOLVED,
                path=clip_path,
                detail="source-track-missing-from-song.tracks",
            )
            return

        target_idx = source_idx + 1
        logger.info(
            "SimplerLoadComponent: source audio track idx=%d, "
            "creating new MIDI track at idx=%d",
            source_idx, target_idx,
        )

        # 3. Create the MIDI track.
        try:
            self._song.create_midi_track(target_idx)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_ERROR_CREATE_FAILED,
                path=clip_path,
                detail="%s: %s" % (type(e).__name__, str(e)[:120]),
            )
            return

        # 4. Resolve the newly-created track.
        new_track = self._get_track_at(target_idx)
        if new_track is None:
            self._emit_error(
                V3_ERROR_CREATE_FAILED,
                path=clip_path,
                detail="new-track-not-at-expected-index",
            )
            return

        # 4 + 5. Insert a Simpler + replace_sample. Shared with
        # handle_replace_sample_onto_track; every failure mode in that
        # path is typed and emitted inside the helper.
        self._load_simpler_onto_track(
            new_track, target_idx, file_path, normalize=True,
        )

    # --- sibling handler: capture flow ------------------------------------

    def handle_replace_sample_onto_track(self, args, source_addr) -> None:
        """``/looping/v3/simpler/replace_sample_onto_track [trackPath, filePath]``.

        Capture-flow variant of ``handle_replace_sample``: caller already
        has a prepared MIDI track (typically via the UI's
        ``prepareTrack('midi')``) and a filesystem path to a WAV written
        by Vamp-Recorder.amxd. No clip resolution, no adjacent-insert
        logic. Delegates to the same ``_load_simpler_onto_track`` helper
        as the clip-path handler.
        """
        if self._disconnected:
            return
        logger.info(
            "SimplerLoadComponent: handle_replace_sample_onto_track args=%r from=%r",
            args, source_addr,
        )
        if len(args) != 2:
            self._emit_error(
                V3_ERROR_REPLACE_SAMPLE_FAILED,
                path="",
                detail="arg-count: expected 2, got %d" % len(args),
                address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            )
            return

        track_path = _coerce_str(args[0])
        file_path = _coerce_str(args[1])
        if not track_path:
            self._emit_error(
                V3_ERROR_TRACK_INDEX_UNRESOLVED,
                path="",
                detail="empty-track-path",
                address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            )
            return
        if not file_path:
            self._emit_error(
                V3_ERROR_NO_FILE_PATH,
                path=track_path,
                detail="empty-file-path",
                address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            )
            return

        # An .alc (Ableton Live Clip) is a gzipped XML wrapper, not audio —
        # Simpler's replace_sample only accepts a raw .wav/.aif. Resolve the
        # .alc to the underlying sample it references before loading. Done
        # before the dedupe key is formed so a resolved retake dedupes
        # correctly.
        if alc_resolver.is_alc(file_path):
            resolved = alc_resolver.resolve_alc(file_path)
            if resolved is None:
                self._emit_error(
                    V3_ERROR_NO_FILE_PATH,
                    path=track_path,
                    detail="could not resolve .alc to an audio file: %s" % file_path,
                    address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
                )
                return
            file_path = resolved

        # Dedupe at the wire boundary. Closes the bridge-broadcast double-
        # fire from /capture/file → loadCaptureIntoSimpler running on both
        # connected WS clients. Same (track, file) within TTL → silent
        # drop. Different file on the same track is a legitimate retake
        # and goes through.
        dedupe_key = (track_path, file_path)
        if self._dedupe_seen_recently(dedupe_key):
            logger.info(
                "SimplerLoadComponent: dedupe — duplicate "
                "replace_sample_onto_track (track=%r, file=%r) within %.0fs, "
                "dropping",
                track_path, file_path, _DEDUPE_TTL_SECONDS,
            )
            return
        self._dedupe_mark(dedupe_key)

        # Resolve ``track_path`` → (track, idx) via path_resolver.
        track, target_idx = self._resolve_track_by_path(track_path)
        if track is None:
            # error already emitted
            return

        self._load_simpler_onto_track(
            track, target_idx, file_path,
            address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            normalize=True,
        )

    # --- shared load-and-swap helper --------------------------------------

    def _load_simpler_onto_track(
        self, track, target_idx: int, file_path: str,
        address: str = V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
        normalize: bool = False,
    ) -> None:
        """Insert a Simpler onto ``track`` and swap its sample.

        Shared between the clip-flow and capture-flow handlers. Every
        error path emits a typed ``/looping/v3/error`` with the origin
        ``address`` stamped in, so the UI can correlate. The insert (and
        the instrument it replaces) and the sample swap are one undo step.

        Caller responsibility (not done here): track existence.
        """
        began = self._begin_undo_step()
        try:
            simpler, _slot = self._insert_simpler(track, file_path, address)
            if simpler is None:
                return  # error already emitted
            try:
                simpler.replace_sample(file_path)
            except _LOM_ERRORS as e:
                self._emit_error(
                    V3_ERROR_REPLACE_SAMPLE_FAILED,
                    path=file_path,
                    detail="%s: %s" % (type(e).__name__, str(e)[:120]),
                    address=address,
                )
                return
        finally:
            self._end_undo_step(began)

        # Default new samples to Loop=on. Simpler's Loop is a
        # DeviceParameter at index 5 ("S Loop On"), not a Sample attr —
        # verified against Live 12.4. Writing from an OSC handler frame
        # (via handle_replace_sample) is notification-safe.
        try:
            params = simpler.parameters
            if len(params) > 5:
                params[5].value = 1.0
        except _LOM_ERRORS as e:
            logger.warning(
                "SimplerLoadComponent: could not enable Loop on new sample: %s: %s",
                type(e).__name__, e,
            )

        # Default slicing voicing to Thru (2). DeviceInitComponent also
        # writes this on the bare ``on_device_added`` tick, but that fires
        # before this handler's ``replace_sample`` and the value can land
        # back at Live's per-sample default (observed: 0/Mono on a fresh
        # capture). Writing here post-swap pins it deterministically.
        # 0=Mono, 1=Poly, 2=Thru per LOM ref §SimplerDevice.
        try:
            simpler.slicing_playback_mode = 2
        except _LOM_ERRORS as e:
            logger.warning(
                "SimplerLoadComponent: could not set slicing_playback_mode=2: %s: %s",
                type(e).__name__, e,
            )

        # Peak-normalize to -1 dBFS via sample.gain. Both flows pass
        # ``normalize=True`` — in practice the audio reaching either
        # handler is the user's own session recording, not a curated
        # library sample, so the original ADR-356 carve-out for the
        # clip-flow doesn't reflect real usage. Silent / unreadable
        # WAVs leave gain untouched.
        if normalize:
            self._apply_peak_normalization(simpler, file_path)

        # No Random Start here: the Simpler view loads it the first time its
        # Random slider moves (2026-11-01, Ben), not on every Simpler.

        logger.info(
            "SimplerLoadComponent: replace_sample OK — track idx=%d, sample=%r",
            target_idx, file_path,
        )

        # Success ack. Emitted last, after Loop / slicing-mode /
        # normalization are written, so anything the UI reads off the
        # back of it is already settled. The UI's auto-trim + Recent
        # bookkeeping keys on this instead of inferring the device from
        # property-echo traffic.
        self._ack_replaced(address, track, target_idx, file_path)

    def _ack_replaced(self, address: str, track, target_idx: int, file_path: str) -> None:
        """Send the success ack, naming the Simpler where it sits now and
        the track's index as it is now."""
        if self._disconnected:
            return
        _simpler, simpler_idx = self._find_simpler_with_replace_sample(track)
        if simpler_idx < 0:
            logger.warning(
                "SimplerLoadComponent: no Simpler on the track when the ack "
                "was due; not acking %r", file_path,
            )
            return
        self._emit_replaced(
            address,
            "tracks/%d/devices/%d" % (self._track_index(track, target_idx), simpler_idx),
            file_path,
        )

    def _track_index(self, track, fallback: int) -> int:
        """``track``'s index in ``song.tracks`` now, which a track added or
        deleted while the ack waited has moved; ``fallback`` when it
        cannot be found."""
        try:
            for i, candidate in enumerate(self._song.tracks):
                if candidate == track:
                    return i
        except _LOM_ERRORS:
            pass
        return fallback

    def _insert_simpler(self, track, file_path: str, address: str):
        """Insert a Simpler by name after ``track``'s leading MIDI effects,
        deleting the instrument already there first — Live allows one per
        chain, and a new MIDI track can come with one (a default MIDI
        track's Operator). Returns ``(simpler, slot_index)``, or
        ``(None, -1)`` after emitting a typed error."""
        try:
            devices = list(track.devices)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_ERROR_INSERT_FAILED,
                path=file_path,
                detail="read track.devices: %s: %s" % (type(e).__name__, str(e)[:120]),
                address=address,
            )
            return None, -1
        index = 0
        instrument_idx = None
        for i, device in enumerate(devices):
            kind = device_type(device)
            if kind == DEVICE_TYPE_MIDI_EFFECT:
                index = i + 1
                continue
            if kind == DEVICE_TYPE_INSTRUMENT:
                instrument_idx = i
            break
        try:
            if instrument_idx is not None:
                track.delete_device(instrument_idx)
                index = instrument_idx
            track.insert_device(SIMPLER_DEVICE_NAME, index)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_ERROR_INSERT_FAILED,
                path=file_path,
                detail="%s: %s" % (type(e).__name__, str(e)[:120]),
                address=address,
            )
            return None, -1

        # Found by capability rather than by the index it went in at: a
        # device Live answers for is the one to trust, and it tells a
        # pre-12.4 Simpler (no ``replace_sample``) apart.
        simpler, simpler_idx = self._find_simpler_with_replace_sample(track)
        if simpler is None:
            self._emit_error(
                V3_ERROR_REPLACE_SAMPLE_MISSING,
                path=file_path,
                detail="no device on track exposes replace_sample (requires Live 12.4+)",
                address=address,
            )
            return None, -1
        return simpler, simpler_idx

    def _begin_undo_step(self) -> bool:
        """Open an undo step; ``False`` when Live refused, so the caller
        does not close a step that never opened."""
        try:
            self._song.begin_undo_step()
        except _LOM_ERRORS as e:
            logger.warning("SimplerLoadComponent: begin_undo_step raised %s: %s", type(e).__name__, e)
            return False
        return True

    def _end_undo_step(self, began: bool) -> None:
        if not began:
            return
        try:
            self._song.end_undo_step()
        except _LOM_ERRORS as e:
            logger.warning("SimplerLoadComponent: end_undo_step raised %s: %s", type(e).__name__, e)

    def _apply_peak_normalization(self, simpler, file_path: str) -> None:
        """Peak-normalize the Simpler sample to -1 dBFS.

        Pure best-effort: every failure mode (file gone, decode error,
        silent capture, LOM raise on the ``sample.gain`` write) just
        logs and leaves the default gain in place. Capture flow already
        succeeded by this point — we don't want a normalization miss
        to surface as a user-visible error.
        """
        result = sample_normalize.normalized_gain_for_file(file_path)
        if result is None:
            logger.info(
                "SimplerLoadComponent: skip normalize — silent or unreadable: %r",
                file_path,
            )
            return
        peak_db, offset_db, gain_value = result
        try:
            simpler.sample.gain = gain_value
        except _LOM_ERRORS as e:
            logger.warning(
                "SimplerLoadComponent: sample.gain write raised: %s: %s",
                type(e).__name__, e,
            )
            return
        logger.info(
            "SimplerLoadComponent: normalized — peak=%.2f dBFS offset=%+.2f dB "
            "(capped to %+.2f dB) gain=%.4f",
            peak_db, offset_db,
            min(sample_normalize.DB_CEIL, offset_db),
            gain_value,
        )

    # --- resolution helpers -----------------------------------------------

    def _resolve_audio_clip(self, clip_path: str):
        """Resolve ``clip_path`` via path_resolver; enforce audio type.

        Emits and returns ``None`` on any of: malformed path,
        not-found, empty slot, or MIDI clip. The audio/midi check is
        done by reading ``clip.is_midi_clip`` (LOM attr) rather than
        by inspecting the track, because a single clip's type is the
        cheapest authoritative signal.
        """
        result = path_resolver.resolve_clip(self._song, clip_path)
        if not result.ok:
            self._emit_error(
                V3_ERROR_CLIP_NOT_FOUND,
                path=clip_path,
                detail=result.status.value,
            )
            return None

        clip = result.obj
        try:
            is_midi = bool(clip.is_midi_clip)
        except _LOM_ERRORS as e:
            logger.warning(
                "SimplerLoadComponent: is_midi_clip read raised: %s: %s",
                type(e).__name__, e,
            )
            self._emit_error(
                V3_ERROR_CLIP_NOT_FOUND,
                path=clip_path,
                detail="is_midi_clip-unreadable",
            )
            return None
        if is_midi:
            self._emit_error(
                V3_ERROR_NOT_AUDIO_CLIP,
                path=clip_path,
                detail="clip.is_midi_clip == True",
            )
            return None
        return clip

    def _read_file_path(self, clip, clip_path: str) -> Optional[str]:
        """Read ``clip.file_path`` from the LOM. Must be non-empty."""
        try:
            file_path = clip.file_path
        except _LOM_ERRORS as e:
            logger.warning(
                "SimplerLoadComponent: file_path read raised: %s: %s",
                type(e).__name__, e,
            )
            self._emit_error(
                V3_ERROR_NO_FILE_PATH,
                path=clip_path,
                detail="read-raised: %s" % type(e).__name__,
            )
            return None
        if not file_path:
            self._emit_error(
                V3_ERROR_NO_FILE_PATH,
                path=clip_path,
                detail="clip.file_path is empty",
            )
            return None
        # Could also pre-check with ``os.path.isfile``, but Live itself
        # will surface the failure from ``replace_sample`` if the file
        # vanished between LOM read and load — and re-using the same
        # error code avoids overlapping semantics.
        return str(file_path)

    def _find_track_index(self, clip_path: str) -> int:
        """Parse ``tracks/<N>`` prefix out of a clip path.

        Clip paths are ``tracks/<N>/slots/<M>/clip`` by grammar; the
        ``tracks`` token + integer index is the cheapest way to get
        the position index for ``create_midi_track``. We don't walk
        ``song.tracks`` by identity because the path is already the
        canonical index and this handler runs *before* the create, so
        the index list hasn't shifted yet.
        """
        parts = clip_path.split("/")
        # Expected shape: ["tracks", "<N>", "slots", "<M>", "clip"].
        # We also accept any longer prefix that starts with tracks/<N>
        # for defensiveness; the only requirement is the first two
        # segments.
        if len(parts) < 2 or parts[0] != "tracks":
            return -1
        try:
            idx = int(parts[1])
        except (TypeError, ValueError):
            return -1
        if idx < 0:
            return -1
        # Verify the index is actually addressable in the current song
        # before we hand it off to create_midi_track — avoids a
        # non-obvious failure mode where a stale clipPath names an idx
        # past the end of the track list.
        try:
            tracks_len = len(self._song.tracks)
        except _LOM_ERRORS as e:
            logger.warning(
                "SimplerLoadComponent: song.tracks read raised: %s: %s",
                type(e).__name__, e,
            )
            return -1
        if idx >= tracks_len:
            return -1
        return idx

    def _get_track_at(self, index: int):
        """Return ``song.tracks[index]`` or ``None`` on failure."""
        try:
            tracks = self._song.tracks
        except _LOM_ERRORS as e:
            logger.warning(
                "SimplerLoadComponent: song.tracks read raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        if index < 0 or index >= len(tracks):
            return None
        return tracks[index]

    def _resolve_track_by_path(self, track_path: str):
        """Resolve a ``tracks/<N>`` path to ``(track, index)``.

        Returns ``(None, -1)`` and emits a typed error on any failure:
        malformed shape, index out of range, LOM read raise.

        Used by ``handle_replace_sample_onto_track`` when the caller
        already knows the target track's path (e.g. from
        ``prepareTrack('midi')`` in the UI).
        """
        parts = track_path.split("/")
        if len(parts) != 2 or parts[0] != "tracks":
            self._emit_error(
                V3_ERROR_TRACK_INDEX_UNRESOLVED,
                path=track_path,
                detail="expected tracks/<N>",
                address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            )
            return None, -1
        try:
            idx = int(parts[1])
        except (TypeError, ValueError):
            self._emit_error(
                V3_ERROR_TRACK_INDEX_UNRESOLVED,
                path=track_path,
                detail="non-integer-index",
                address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            )
            return None, -1
        if idx < 0:
            self._emit_error(
                V3_ERROR_TRACK_INDEX_UNRESOLVED,
                path=track_path,
                detail="negative-index",
                address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            )
            return None, -1
        track = self._get_track_at(idx)
        if track is None:
            self._emit_error(
                V3_ERROR_TRACK_INDEX_UNRESOLVED,
                path=track_path,
                detail="index-out-of-range",
                address=V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            )
            return None, -1
        return track, idx

    # --- dedupe helpers ---------------------------------------------------

    def _dedupe_seen_recently(self, key: Tuple[str, str]) -> bool:
        """True when ``key`` was marked within the TTL.

        Eagerly evicts the entry on TTL expiry so the next call after a
        legitimate retake (same track + same file, > TTL apart) goes
        through. Counts as a side effect of the read — fine here because
        the caller treats expired entries identically to absent ones."""
        ts = self._inflight.get(key)
        if ts is None:
            return False
        if time.monotonic() - ts > _DEDUPE_TTL_SECONDS:
            self._inflight.pop(key, None)
            return False
        return True

    def _dedupe_mark(self, key: Tuple[str, str]) -> None:
        """Stamp ``key`` as in-flight; evict oldest while over capacity."""
        self._inflight[key] = time.monotonic()
        # Insertion-order eviction keeps the dict small under bursty load
        # without a separate LRU structure. Only fires on overflow.
        while len(self._inflight) > _DEDUPE_MAX_ENTRIES:
            oldest = next(iter(self._inflight))
            self._inflight.pop(oldest, None)

    @staticmethod
    def _find_simpler_with_replace_sample(track):
        """First device on ``track`` that exposes ``replace_sample``.

        Iterates the chain rather than indexing directly so a track
        with a MIDI effect at index 0 (Random Start) still resolves to the
        Simpler that follows it. Returns ``(device, slot_index)``, or
        ``(None, -1)`` when the chain is empty or no device exposes the
        attribute (pre-12.4 Simpler, wrong device class).

        The slot index is what makes the success ack addressable — it
        is the ``<M>`` in the ``tracks/<N>/devices/<M>`` devicePath the
        UI keys every property subscription on.
        """
        try:
            devices = list(track.devices)
        except _LOM_ERRORS:
            return None, -1
        for idx, device in enumerate(devices):
            try:
                if hasattr(device, "replace_sample"):
                    return device, idx
            except _LOM_ERRORS:
                continue
        return None, -1

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. No listeners, no state beyond flags."""
        self._disconnected = True
        self._inflight.clear()

    # --- emit helpers -----------------------------------------------------

    def _emit_replaced(
        self, address: str, device_path: str, file_path: str,
    ) -> None:
        """Emit ``/looping/v3/simpler/replaced [address, devicePath, filePath]``.

        ``address`` is the gesture that produced the load (clip-flow vs
        capture-flow), stamped first for symmetry with ``_emit_error``.
        Emit failures are logged and swallowed: the sample is already on
        the Simpler, and the UI degrades to the pre-ack behaviour
        (no auto-trim, Recent falls back to its optimistic entry).
        """
        if self._disconnected:
            return
        logger.info(
            "SimplerLoadComponent: emit replaced address=%r devicePath=%r sample=%r",
            address, device_path, file_path,
        )
        try:
            self._emit(
                V3_SIMPLER_REPLACED_ADDRESS,
                (address, device_path, file_path),
            )
        except Exception as e:
            logger.warning(
                "SimplerLoadComponent: emit %s failed: %s",
                V3_SIMPLER_REPLACED_ADDRESS, e,
            )

    def _emit_error(
        self, code: str, path: str, detail: str,
        address: str = V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
    ) -> None:
        """Emit ``/looping/v3/error [address, code, path, detail]``.

        Same four-arg shape as DeviceLoadComponent. ``address`` defaults
        to the clip-flow address so existing callers don't need to pass
        it; the capture-flow handler threads
        ``V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS`` through so its
        errors correlate correctly on the UI side.
        """
        if self._disconnected:
            return
        logger.warning(
            "SimplerLoadComponent: emit error code=%r path=%r detail=%r address=%r",
            code, path, detail, address,
        )
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (address, code, path, detail),
            )
        except Exception as e:
            logger.warning(
                "SimplerLoadComponent: emit %s failed: %s",
                V3_ERROR_ADDRESS, e,
            )


def _coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``. Bytes → utf-8; ``None`` → ``""``.

    Mirrors ``DeviceLoadComponent._coerce_str``. Kept local so the
    resolver pipeline doesn't pick up a cross-module dependency.
    """
    if x is None:
        return ""
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)
