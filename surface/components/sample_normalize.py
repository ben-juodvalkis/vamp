"""Peak normalization for captured samples written by Vamp-Recorder.

Two pure functions, no Live API touches — testable in plain CPython:

- ``peak_dbfs(file_path)``: scan a WAV (capture flow) or AIFF (clip
  flow — Live records audio clips as ``.aif``) and return its peak in
  dBFS, or ``None`` if the file can't be read or is silent.
- ``gain_value_for_db_offset(db)``: invert Simpler's calibrated 0..1
  ``sample.gain`` curve to the value that produces ``db`` of gain.

Curve calibration (2026-04-28, Live 12.4 OriginalSimpler, probe over
``/looping/v3/property/set``):

    gain   dB
    0.00   -inf
    0.05   -39
    0.10   -31
    0.15   -23
    0.20   -16
    0.25   -11
    0.30   -6.2
    0.35   -2.6
    0.40    0     ← unity
    0.45   +2
    0.50   +4
    0.75   +14
    0.90   +20
    1.00   +24

Above 0.40 the curve is linear: dB = 40·gain - 16, equivalently
gain = (dB + 16) / 40. Below 0.40 it's nonlinear (cubic-ish toward
-inf), so we interpolate the table.

Boost is capped at +24 dB (gain = 1.0). Cut is floored at -39 dB
(gain = 0.05); a recording requesting more attenuation than that is
almost certainly clipped anyway, and pulling gain below 0.05 makes
the curve too steep to predict from the table.
"""

from __future__ import annotations

import array
import math
import struct
import wave
from typing import Optional, Tuple

# Live records audio clips as AIFC with the ``fl32`` (32-bit IEEE float
# big-endian) compression tag. Stdlib ``aifc`` rejects fl32 with
# ``aifc.Error: unsupported compression type`` before exposing any of
# the COMM fields — its allowlist is ``NONE`` / ``ULAW`` / ``ALAW`` /
# ``G722``, none of which match Apple's float-PCM extensions. We parse
# the IFF container by hand instead (see ``_peak_dbfs_aiff``); this
# also sidesteps ``aifc``'s removal in Python 3.13.

# Calibration points — keep ordered by gain ascending.
_CURVE: Tuple[Tuple[float, float], ...] = (
    (0.05, -39.0),
    (0.10, -31.0),
    (0.15, -23.0),
    (0.20, -16.0),
    (0.25, -11.0),
    (0.30,  -6.2),
    (0.35,  -2.6),
    (0.40,   0.0),
)

GAIN_FLOOR = 0.05
GAIN_UNITY = 0.40
GAIN_CEIL = 1.0
DB_CEIL = 24.0


def gain_value_for_db_offset(db: float) -> float:
    """Return the ``sample.gain`` value that yields ``db`` gain.

    Linear region (db >= 0): closed form, clamped to gain <= 1.0.
    Cut region (db < 0): linear interpolation across ``_CURVE``,
    clamped to gain >= 0.05.
    """
    if db >= 0.0:
        gain = (db + 16.0) / 40.0
        return min(GAIN_CEIL, max(GAIN_UNITY, gain))

    # db < 0 — walk the table.
    if db <= _CURVE[0][1]:
        return GAIN_FLOOR
    for (g_lo, db_lo), (g_hi, db_hi) in zip(_CURVE, _CURVE[1:]):
        if db_lo <= db <= db_hi:
            # Linear interp in (gain, db) space. Both axes monotonic.
            span = db_hi - db_lo
            if span <= 0:
                return g_hi
            t = (db - db_lo) / span
            return g_lo + t * (g_hi - g_lo)
    # Shouldn't reach here given the bounds checks above.
    return GAIN_UNITY


def peak_dbfs(file_path: str) -> Optional[float]:
    """Return peak amplitude of a WAV or AIFF in dBFS, or ``None`` on failure.

    Returns ``None`` for: unreadable file, unsupported sample width,
    or all-silent content (peak == 0). Caller should treat ``None``
    as "leave gain alone".

    Format is detected from the file header (``RIFF`` / ``RIFX`` →
    WAV, ``FORM`` → AIFF/AIFC), not the extension. The capture flow
    writes WAV via ``[sfrecord~]``; the clip flow's audio recordings
    are AIFF (Live's default for clip recording).

    Reads in ~1MB chunks so a long capture doesn't pull the whole
    file into memory. ``audioop`` was removed in Python 3.13, so we
    decode with ``array``/``struct`` directly — Live 12.4 still ships
    Python 3.11 where this also works.
    """
    fmt = _detect_audio_format(file_path)
    if fmt == "wav":
        return _peak_dbfs_wav(file_path)
    if fmt == "aiff":
        return _peak_dbfs_aiff(file_path)
    return None


def _detect_audio_format(file_path: str) -> Optional[str]:
    """Sniff the first 12 bytes for a RIFF (WAV) or FORM (AIFF) magic.

    Returns ``"wav"``, ``"aiff"``, or ``None`` for unrecognized /
    unreadable files. We check magic bytes rather than extension
    because Live's clip recorder writes ``.aif`` but the file is
    structurally AIFF/AIFC, and a future format change in either
    recorder shouldn't silently no-op normalization.
    """
    try:
        with open(file_path, "rb") as f:
            header = f.read(12)
    except OSError:
        return None
    if len(header) < 12:
        return None
    if header[:4] in (b"RIFF", b"RIFX") and header[8:12] == b"WAVE":
        return "wav"
    if header[:4] == b"FORM" and header[8:12] in (b"AIFF", b"AIFC"):
        return "aiff"
    return None


def _peak_dbfs_wav(file_path: str) -> Optional[float]:
    try:
        with wave.open(file_path, "rb") as wf:
            sampwidth = wf.getsampwidth()
            nframes = wf.getnframes()
            nchannels = max(1, wf.getnchannels())
            if nframes <= 0 or sampwidth not in (1, 2, 3, 4):
                return None
            chunk_frames = max(1, 1024 * 1024 // (sampwidth * nchannels))
            peak = 0
            remaining = nframes
            while remaining > 0:
                n = min(chunk_frames, remaining)
                data = wf.readframes(n)
                if not data:
                    break
                m = _max_abs_sample(data, sampwidth)
                if m > peak:
                    peak = m
                remaining -= n
            if peak <= 0:
                return None
            full_scale = float(1 << (8 * sampwidth - 1))
            return 20.0 * math.log10(peak / full_scale)
    except (wave.Error, EOFError, OSError, struct.error, ValueError):
        return None


def _peak_dbfs_aiff(file_path: str) -> Optional[float]:
    """Hand-rolled AIFF/AIFC parser — supports the formats Live actually writes.

    We don't use stdlib ``aifc`` because Live records audio clips as
    AIFC with the ``fl32`` compression tag (32-bit IEEE float PCM,
    big-endian), which ``aifc`` rejects with ``aifc.Error: unsupported
    compression type`` before exposing any of the COMM fields. The
    library only knows ``NONE`` / ``ULAW`` / ``ALAW`` / ``G722`` —
    Apple's float PCM extensions aren't on that list.

    The container is a simple IFF: 12-byte ``FORM`` header, then a
    sequence of ``<id:4><size:u32be><body...>`` chunks padded to even
    length. We only need ``COMM`` (sample format) and ``SSND`` (sample
    bytes); everything else is skipped.

    Supported sample formats:
    - ``NONE`` — big-endian signed PCM, 8/16/24/32-bit (standard AIFF).
    - ``sowt`` — little-endian signed PCM (rare; Apple "swapped" tag).
    - ``fl32`` / ``FL32`` — 32-bit big-endian IEEE float PCM, ±1.0
      full-scale. Live's audio clip recorder writes this.
    - ``fl64`` / ``FL64`` — 64-bit big-endian IEEE float PCM.

    Anything else returns ``None`` (caller leaves gain alone). The 8-
    byte SSND prefix (offset + blocksize, both u32be, both zero in
    practice) is skipped before reading samples.
    """
    try:
        with open(file_path, "rb") as f:
            header = f.read(12)
            if len(header) < 12:
                return None
            if header[:4] != b"FORM" or header[8:12] not in (b"AIFF", b"AIFC"):
                return None
            is_aifc = header[8:12] == b"AIFC"

            comm = _read_iff_chunk(f, b"COMM")
            ssnd_pos, ssnd_size = _find_iff_chunk(f, b"SSND")
            if comm is None or ssnd_pos is None:
                return None

            # AIFF-C COMM is COMM + 4-byte compression type + Pascal
            # string compression name. AIFF (non-C) COMM stops at the
            # 18-byte common fields. We parse the leading 18 either way.
            if len(comm) < 18:
                return None
            nchannels = struct.unpack(">h", comm[0:2])[0]
            nframes = struct.unpack(">I", comm[2:6])[0]
            sample_size = struct.unpack(">h", comm[6:8])[0]  # bits per sample
            # bytes 8..18 are the 80-bit IEEE extended sample rate; we
            # don't need it for peak detection.
            if is_aifc and len(comm) >= 22:
                comptype = comm[18:22]
            else:
                comptype = b"NONE"

            nchannels = max(1, nchannels)
            if nframes <= 0 or sample_size <= 0:
                return None

            # Seek to SSND payload. SSND prefix is 8 bytes: u32be offset
            # + u32be blockSize. Both are 0 in every file Live writes,
            # but read-and-skip rather than assume.
            f.seek(ssnd_pos)
            prefix = f.read(8)
            if len(prefix) < 8:
                return None
            ssnd_offset = struct.unpack(">I", prefix[0:4])[0]
            audio_start = f.tell() + ssnd_offset
            audio_bytes_total = max(0, ssnd_size - 8 - ssnd_offset)
            f.seek(audio_start)

            return _peak_dbfs_aiff_payload(
                f, audio_bytes_total, nchannels, sample_size, comptype,
            )
    except (OSError, struct.error, ValueError):
        return None


def _read_iff_chunk(f, want_id: bytes) -> Optional[bytes]:
    """Scan from current file pos for an IFF chunk by id; return body or None.

    Leaves the file cursor at end-of-FORM if the chunk isn't found.
    Chunk bodies are padded to even length (the pad byte is *not*
    counted in the size field).
    """
    while True:
        head = f.read(8)
        if len(head) < 8:
            return None
        cid = head[:4]
        size = struct.unpack(">I", head[4:8])[0]
        if cid == want_id:
            return f.read(size)
        # Skip body + pad byte if size is odd.
        f.seek(size + (size & 1), 1)


def _find_iff_chunk(f, want_id: bytes):
    """Locate a chunk's body start position + size, leaving the file
    cursor at the body start. Returns (pos, size) or (None, None)."""
    # Restart from after the FORM/AIFF header.
    f.seek(12)
    while True:
        head = f.read(8)
        if len(head) < 8:
            return None, None
        cid = head[:4]
        size = struct.unpack(">I", head[4:8])[0]
        if cid == want_id:
            return f.tell(), size
        f.seek(size + (size & 1), 1)


def _peak_dbfs_aiff_payload(
    f, audio_bytes_total: int, nchannels: int, sample_size: int,
    comptype: bytes,
) -> Optional[float]:
    """Read SSND payload in chunks, return peak in dBFS or None."""
    # Float PCM (fl32 / fl64): peak is computed against ±1.0 full-scale.
    if comptype in (b"fl32", b"FL32"):
        return _peak_float_be(f, audio_bytes_total, nchannels, bits=32)
    if comptype in (b"fl64", b"FL64"):
        return _peak_float_be(f, audio_bytes_total, nchannels, bits=64)

    # Integer PCM (NONE / sowt). sample_size is in *bits*; round up to
    # bytes for sample width. AIFF allows non-multiple-of-8 sizes (e.g.
    # 20-bit-in-24-bit-container), but in practice Live and every other
    # mainstream tool writes 8/16/24/32 only.
    if sample_size not in (8, 16, 24, 32):
        return None
    sampwidth = sample_size // 8
    if comptype not in (b"NONE", b"sowt"):
        return None
    big_endian = (comptype == b"NONE")
    chunk_frames = max(1, 1024 * 1024 // (sampwidth * nchannels))
    chunk_bytes = chunk_frames * sampwidth * nchannels
    peak = 0
    remaining = audio_bytes_total
    while remaining > 0:
        n = min(chunk_bytes, remaining)
        data = f.read(n)
        if not data:
            break
        if big_endian:
            m = _max_abs_sample_be(data, sampwidth)
        else:
            m = _max_abs_sample_aiff_signed_le(data, sampwidth)
        if m > peak:
            peak = m
        remaining -= len(data)
    if peak <= 0:
        return None
    full_scale = float(1 << (8 * sampwidth - 1))
    return 20.0 * math.log10(peak / full_scale)


def _peak_float_be(f, audio_bytes_total: int, nchannels: int, bits: int) -> Optional[float]:
    """Big-endian float PCM peak. ``bits`` is 32 or 64. Full-scale is ±1.0."""
    if bits == 32:
        typecode = "f"
        sampwidth = 4
    elif bits == 64:
        typecode = "d"
        sampwidth = 8
    else:
        return None
    chunk_samples = max(1, 1024 * 1024 // sampwidth)
    chunk_bytes = chunk_samples * sampwidth
    peak = 0.0
    remaining = audio_bytes_total
    while remaining > 0:
        n = min(chunk_bytes, remaining)
        data = f.read(n)
        if not data:
            break
        # Trim partial trailing sample if the chunk size doesn't divide
        # evenly — defensive against truncated SSND payloads.
        usable = (len(data) // sampwidth) * sampwidth
        if usable == 0:
            break
        a = array.array(typecode)
        a.frombytes(data[:usable])
        a.byteswap()  # SSND is big-endian; native is little on x86/arm Macs.
        if a:
            # |x|max == max(max(x), -min(x)), the identity _max_abs_sample
            # already uses for the integer widths, and both calls run in C.
            # The interpreted `for v in a` this replaces cost 2.61 s on a
            # 5-minute stereo 44.1 kHz float capture (26.5M samples) —
            # synchronously on Live's tick, so it froze audio and the OSC
            # drain for the duration.
            local = max(max(a), -min(a))
            if not math.isfinite(local):
                # Float PCM carries no clip discipline and can hold NaN or
                # inf. Neither max() nor min() handles them usefully: NaN
                # compares False against everything, so it only survives
                # from index 0, and inf wins outright. Before this guard a
                # leading NaN made the whole file read as silent (peak
                # None → no normalization) and a leading inf returned inf
                # dBFS straight into the gain-cut math. Rescan this chunk
                # only, skipping non-finite samples; the fast path above is
                # untouched for every real file.
                local = 0.0
                for v in a:
                    if not math.isfinite(v):
                        continue
                    av = -v if v < 0.0 else v
                    if av > local:
                        local = av
            if local > peak:
                peak = local
        remaining -= len(data)
    if peak <= 0.0:
        return None
    # Floats are normalized to ±1.0 full-scale; clip values >1.0 happen
    # in float PCM (no clip discipline) but still register as >0 dBFS,
    # which is fine for our gain-cut math.
    return 20.0 * math.log10(peak)


def _max_abs_sample(data: bytes, sampwidth: int) -> int:
    """Return ``max(abs(sample))`` for raw PCM ``data`` of width ``sampwidth``.

    Replacement for ``audioop.max`` (removed in Python 3.13). Handles
    8/16/24/32-bit signed PCM. 8-bit WAV is unsigned per spec — center
    on 128 before taking abs.
    """
    if sampwidth == 1:
        # 8-bit PCM is unsigned, range 0..255, midpoint 128.
        if not data:
            return 0
        return max(abs(b - 128) for b in data)
    if sampwidth == 2:
        a = array.array("h")  # signed 16-bit
        a.frombytes(data)
        if not a:
            return 0
        return max(-min(a), max(a))
    if sampwidth == 4:
        a = array.array("i")  # signed 32-bit
        a.frombytes(data)
        if not a:
            return 0
        return max(-min(a), max(a))
    if sampwidth == 3:
        # 24-bit packed, little-endian, signed. No native array typecode.
        peak = 0
        for i in range(0, len(data) - 2, 3):
            b0, b1, b2 = data[i], data[i + 1], data[i + 2]
            v = b0 | (b1 << 8) | (b2 << 16)
            if v & 0x800000:
                v -= 0x1000000
            av = -v if v < 0 else v
            if av > peak:
                peak = av
        return peak
    return 0


def _max_abs_sample_be(data: bytes, sampwidth: int) -> int:
    """Big-endian variant of ``_max_abs_sample`` for AIFF (``NONE`` PCM).

    AIFF is signed at every width, including 8-bit (vs. WAV's unsigned
    8-bit). We byteswap into native order, then reuse ``array`` for
    the 16/32-bit cases. 24-bit is hand-decoded.
    """
    if not data:
        return 0
    if sampwidth == 1:
        # Signed 8-bit, no endianness.
        a = array.array("b")
        a.frombytes(data)
        if not a:
            return 0
        return max(-min(a), max(a))
    if sampwidth == 2:
        a = array.array("h")
        a.frombytes(data)
        a.byteswap()
        return max(-min(a), max(a))
    if sampwidth == 4:
        a = array.array("i")
        a.frombytes(data)
        a.byteswap()
        return max(-min(a), max(a))
    if sampwidth == 3:
        # 24-bit packed, big-endian, signed. Reverse the per-sample
        # byte order vs. the WAV path.
        peak = 0
        for i in range(0, len(data) - 2, 3):
            b0, b1, b2 = data[i], data[i + 1], data[i + 2]
            v = b2 | (b1 << 8) | (b0 << 16)
            if v & 0x800000:
                v -= 0x1000000
            av = -v if v < 0 else v
            if av > peak:
                peak = av
        return peak
    return 0


def _max_abs_sample_aiff_signed_le(data: bytes, sampwidth: int) -> int:
    """AIFC ``sowt`` variant: little-endian PCM, signed at every width.

    Only differs from ``_max_abs_sample`` in the 8-bit case (AIFF/AIFC
    8-bit is signed, WAV 8-bit is unsigned). 16/24/32-bit signed-LE
    decode is identical to WAV's.
    """
    if not data:
        return 0
    if sampwidth == 1:
        a = array.array("b")
        a.frombytes(data)
        if not a:
            return 0
        return max(-min(a), max(a))
    return _max_abs_sample(data, sampwidth)


def normalized_gain_for_file(
    file_path: str, target_dbfs: float = -1.0,
) -> Optional[Tuple[float, float, float]]:
    """High-level helper. Returns ``(peak_db, offset_db, gain_value)``
    or ``None`` if the file is silent / unreadable.

    ``offset_db`` is what was *requested* before clamping; the actual
    ``gain_value`` may be at the floor/ceiling.
    """
    peak = peak_dbfs(file_path)
    if peak is None:
        return None
    offset = target_dbfs - peak
    # Cap requested offset at +24 dB (anything bigger maps to gain=1.0
    # anyway, but we want to expose the cap to the logger).
    capped = min(DB_CEIL, offset)
    gain = gain_value_for_db_offset(capped)
    return peak, offset, gain
