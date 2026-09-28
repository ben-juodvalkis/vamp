"""Tests for sample_normalize: peak read + dB → gain inversion.

The ``sample.gain`` curve was calibrated against Live 12.4 on
2026-04-28 by sweeping values via /looping/v3/property/set and
reading the Simpler UI's dB display. Test data here mirrors those
calibration points; if Live's mapping ever changes the test that
breaks first should be ``test_curve_*``.
"""

from __future__ import annotations

import array
import io
import math
import os
import struct
import tempfile
import wave

import pytest

from components import sample_normalize

try:
    import aifc  # stdlib through 3.12, removed in 3.13
except ImportError:
    aifc = None


# --- gain curve --------------------------------------------------------------


@pytest.mark.parametrize(
    "db, expected_gain",
    [
        # Linear region (closed form: gain = (db + 16) / 40)
        (0.0,  0.40),
        (2.0,  0.45),
        (4.0,  0.50),
        (14.0, 0.75),
        (20.0, 0.90),
        (24.0, 1.00),
    ],
)
def test_curve_linear_region_exact(db, expected_gain):
    g = sample_normalize.gain_value_for_db_offset(db)
    assert g == pytest.approx(expected_gain, abs=1e-6)


@pytest.mark.parametrize(
    "db, expected_gain",
    [
        # Below unity — table interpolation. These are calibration
        # points so they should land exactly.
        (-2.6, 0.35),
        (-6.2, 0.30),
        (-11.0, 0.25),
        (-16.0, 0.20),
        (-23.0, 0.15),
        (-31.0, 0.10),
        (-39.0, 0.05),
    ],
)
def test_curve_cut_region_calibration_points(db, expected_gain):
    g = sample_normalize.gain_value_for_db_offset(db)
    assert g == pytest.approx(expected_gain, abs=1e-6)


def test_curve_clamps_above_ceiling():
    assert sample_normalize.gain_value_for_db_offset(48.0) == 1.0


def test_curve_clamps_below_floor():
    # -39 is the lowest calibration point; anything below clamps to 0.05.
    assert sample_normalize.gain_value_for_db_offset(-60.0) == 0.05
    assert sample_normalize.gain_value_for_db_offset(-1000.0) == 0.05


def test_curve_interpolates_between_points():
    # Halfway between (0.30, -6.2) and (0.35, -2.6): db = -4.4 → gain ≈ 0.325
    g = sample_normalize.gain_value_for_db_offset(-4.4)
    assert g == pytest.approx(0.325, abs=1e-3)


def test_curve_minus_one_db_close_to_probe():
    # Live UI showed -1.2 dB at gain=0.375 during calibration. Our
    # table has unity exactly at 0.40; -1 dB should fall just below.
    g = sample_normalize.gain_value_for_db_offset(-1.0)
    assert 0.36 < g < 0.40


# --- WAV peak detection ------------------------------------------------------


def _write_wav(path: str, samples_int16, nchannels=1, framerate=44100) -> None:
    with wave.open(path, "wb") as wf:
        wf.setnchannels(nchannels)
        wf.setsampwidth(2)
        wf.setframerate(framerate)
        wf.writeframes(struct.pack("<%dh" % len(samples_int16), *samples_int16))


def test_peak_dbfs_full_scale():
    """A sample at int16 max (32767) should read ≈ 0 dBFS."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fs.wav")
        _write_wav(path, [0, 32767, -32768, 0])
        peak = sample_normalize.peak_dbfs(path)
        assert peak is not None
        # 32767 / 32768 ≈ -0.000264 dBFS; -32768 / 32768 = exactly 0 dBFS.
        # audioop.max returns abs, so we'll see 32768.
        assert peak == pytest.approx(0.0, abs=0.01)


def test_peak_dbfs_minus_six_db():
    """Half-amplitude (16384) ≈ -6.02 dBFS."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "half.wav")
        _write_wav(path, [0, 16384, -16384, 0])
        peak = sample_normalize.peak_dbfs(path)
        assert peak is not None
        assert peak == pytest.approx(-6.02, abs=0.05)


def test_peak_dbfs_silent_returns_none():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "silence.wav")
        _write_wav(path, [0, 0, 0, 0, 0])
        assert sample_normalize.peak_dbfs(path) is None


def test_peak_dbfs_missing_file_returns_none():
    assert sample_normalize.peak_dbfs("/nonexistent/path/foo.wav") is None


def test_peak_dbfs_not_a_wav_returns_none():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "garbage.wav")
        with open(path, "wb") as f:
            f.write(b"this is not a wav file")
        assert sample_normalize.peak_dbfs(path) is None


# --- end-to-end: normalized_gain_for_file ------------------------------------


def test_normalized_gain_full_scale_to_minus_one():
    """A capture peaking at 0 dBFS wants -1 dB cut → gain ≈ 0.385."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "hot.wav")
        _write_wav(path, [0, 32767, -32768, 0])
        result = sample_normalize.normalized_gain_for_file(path, target_dbfs=-1.0)
        assert result is not None
        peak_db, offset_db, gain = result
        assert peak_db == pytest.approx(0.0, abs=0.01)
        assert offset_db == pytest.approx(-1.0, abs=0.01)
        # Linear interp between (0.35, -2.6) and (0.40, 0): -1 → ≈ 0.3808
        assert gain == pytest.approx(0.381, abs=0.005)


def test_normalized_gain_quiet_capture_caps_at_unity_max():
    """A capture peaking at -60 dBFS wants +59 dB boost; cap at +24 → gain=1.0."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "quiet.wav")
        # ~-60 dBFS: 32768 * 10^(-60/20) ≈ 32.77 → use 33
        _write_wav(path, [0, 33, -33, 0])
        result = sample_normalize.normalized_gain_for_file(path, target_dbfs=-1.0)
        assert result is not None
        peak_db, offset_db, gain = result
        assert peak_db < -55.0
        assert offset_db > 50.0  # asked for far more than available
        assert gain == 1.0  # clamped to ceiling


def test_normalized_gain_silent_returns_none():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "silence.wav")
        _write_wav(path, [0] * 100)
        assert sample_normalize.normalized_gain_for_file(path) is None


# --- AIFF peak detection -----------------------------------------------------
#
# Live records audio clips as ``.aif`` (uncompressed AIFF, 16-bit, big-
# endian PCM). The clip-flow Simpler conversion path landed silently
# unnormalized for every fresh recording until AIFF support was added
# alongside WAV in ``sample_normalize.peak_dbfs``.

aiff_only = pytest.mark.skipif(aifc is None, reason="aifc module unavailable (Python 3.13+)")


def _write_aiff(path: str, samples_int16, nchannels=1, framerate=44100) -> None:
    """Write a single-channel signed-16 AIFF, big-endian per the spec."""
    assert aifc is not None
    with aifc.open(path, "wb") as af:
        af.setnchannels(nchannels)
        af.setsampwidth(2)
        af.setframerate(framerate)
        af.setcomptype(b"NONE", b"not compressed")
        # ``aifc.writeframes`` expects big-endian sample bytes; pack
        # explicitly so the test is independent of host endianness.
        af.writeframes(struct.pack(">%dh" % len(samples_int16), *samples_int16))


@aiff_only
def test_peak_dbfs_aiff_full_scale():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fs.aif")
        _write_aiff(path, [0, 32767, -32768, 0])
        peak = sample_normalize.peak_dbfs(path)
        assert peak is not None
        assert peak == pytest.approx(0.0, abs=0.01)


@aiff_only
def test_peak_dbfs_aiff_minus_six_db():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "half.aif")
        _write_aiff(path, [0, 16384, -16384, 0])
        peak = sample_normalize.peak_dbfs(path)
        assert peak is not None
        assert peak == pytest.approx(-6.02, abs=0.05)


@aiff_only
def test_peak_dbfs_aiff_silent_returns_none():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "silence.aif")
        _write_aiff(path, [0, 0, 0, 0, 0])
        assert sample_normalize.peak_dbfs(path) is None


@aiff_only
def test_normalized_gain_aiff_full_scale_to_minus_one():
    """End-to-end on AIFF: same expectation as the WAV variant."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "hot.aif")
        _write_aiff(path, [0, 32767, -32768, 0])
        result = sample_normalize.normalized_gain_for_file(path, target_dbfs=-1.0)
        assert result is not None
        peak_db, offset_db, gain = result
        assert peak_db == pytest.approx(0.0, abs=0.01)
        assert offset_db == pytest.approx(-1.0, abs=0.01)
        assert gain == pytest.approx(0.381, abs=0.005)


def test_aiff_extension_with_wav_body_still_reads_wav():
    """Header sniff, not extension. A .aif file that's actually RIFF/WAVE
    inside still reads peak — protects against a future Live tweak that
    re-stamps extensions but not file format."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "lying.aif")
        _write_wav(path, [0, 32767, -32768, 0])
        peak = sample_normalize.peak_dbfs(path)
        assert peak is not None
        assert peak == pytest.approx(0.0, abs=0.01)


# --- AIFC fl32 (Live's audio-clip recording format) --------------------------
#
# stdlib ``aifc`` can't write — or even read — the ``fl32`` compression
# tag, so we build a minimal AIFC-fl32 IFF container by hand. The
# ground-truth assertion is that ``peak_dbfs`` on this hand-built file
# matches the magnitude we wrote in.


def _write_aifc_fl32(path: str, samples_f32, nchannels=1, framerate=44100) -> None:
    """Write an AIFC file with ``fl32`` (32-bit big-endian float PCM).

    Minimal IFF container: FORM/AIFC + FVER + COMM + SSND. Mirrors the
    layout produced by Live and SoX — enough for ``peak_dbfs`` to read.
    """
    nframes = len(samples_f32) // nchannels
    sample_size_bits = 32
    # FVER body: AIFF-C version timestamp (constant per spec).
    fver_body = struct.pack(">I", 0xA2805140)
    # COMM body: numChannels(s16) + numSampleFrames(u32) + sampleSize(s16)
    # + 80-bit IEEE extended sample rate + comp type(4) + Pascal compname.
    rate_ext = _double_to_ieee_extended_be(float(framerate))
    compname = b"32-bit Floating Point"
    pascal = bytes([len(compname)]) + compname
    if len(pascal) % 2:
        pascal += b"\x00"  # Pascal strings are padded to even length.
    comm_body = (
        struct.pack(">h", nchannels)
        + struct.pack(">I", nframes)
        + struct.pack(">h", sample_size_bits)
        + rate_ext
        + b"fl32"
        + pascal
    )
    # SSND body: offset(u32) + blockSize(u32) + sample bytes (big-endian floats).
    ssnd_offset = 0
    ssnd_blocksize = 0
    sample_bytes = struct.pack(">%df" % len(samples_f32), *samples_f32)
    ssnd_body = struct.pack(">II", ssnd_offset, ssnd_blocksize) + sample_bytes

    # Wrap each body with id+size header; pad odd-size bodies to even.
    def _chunk(cid: bytes, body: bytes) -> bytes:
        head = cid + struct.pack(">I", len(body))
        pad = b"\x00" if len(body) & 1 else b""
        return head + body + pad

    fver_chunk = _chunk(b"FVER", fver_body)
    comm_chunk = _chunk(b"COMM", comm_body)
    ssnd_chunk = _chunk(b"SSND", ssnd_body)
    body = b"AIFC" + fver_chunk + comm_chunk + ssnd_chunk
    with open(path, "wb") as f:
        f.write(b"FORM" + struct.pack(">I", len(body)) + body)


def _double_to_ieee_extended_be(value: float) -> bytes:
    """Encode a double as 80-bit IEEE 754 extended precision, big-endian.

    Sufficient for whole-number sample rates (44100, 48000, …); we don't
    need the full numeric range.
    """
    if value == 0.0:
        return b"\x00" * 10
    sign = 0
    if value < 0.0:
        sign = 0x8000
        value = -value
    exponent = 0
    mantissa = value
    while mantissa >= 1.0:
        mantissa /= 2.0
        exponent += 1
    while mantissa < 0.5 and mantissa > 0.0:
        mantissa *= 2.0
        exponent -= 1
    biased_exp = exponent + 16382  # bias is 16383, but we shifted to [0.5, 1)
    mantissa_int = int(mantissa * (1 << 63))
    return struct.pack(">HQ", sign | (biased_exp & 0x7FFF), mantissa_int)


def test_peak_dbfs_aifc_fl32_full_scale():
    """fl32 sample at ±1.0 reads as 0 dBFS (float full-scale convention)."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fl32_fs.aif")
        _write_aifc_fl32(path, [0.0, 1.0, -1.0, 0.0])
        peak = sample_normalize.peak_dbfs(path)
        assert peak is not None
        assert peak == pytest.approx(0.0, abs=0.001)


def test_peak_dbfs_aifc_fl32_minus_six_db():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fl32_half.aif")
        _write_aifc_fl32(path, [0.0, 0.5, -0.5, 0.0])
        peak = sample_normalize.peak_dbfs(path)
        assert peak is not None
        assert peak == pytest.approx(-6.02, abs=0.05)


def test_peak_dbfs_aifc_fl32_silent_returns_none():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fl32_silence.aif")
        _write_aifc_fl32(path, [0.0] * 16)
        assert sample_normalize.peak_dbfs(path) is None


def test_normalized_gain_aifc_fl32_quiet_capture():
    """Live's clip-flow recording: float PCM at low amplitude. End-to-end
    the helper should request boost and return a gain value, not None."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fl32_quiet.aif")
        # ~-26 dBFS, mirroring the magnitude observed in production.
        _write_aifc_fl32(path, [0.0, 0.05, -0.05, 0.0])
        result = sample_normalize.normalized_gain_for_file(path, target_dbfs=-1.0)
        assert result is not None
        peak_db, offset_db, gain = result
        assert peak_db < -20.0
        assert offset_db > 15.0
        # Healthy boost — not pinned at the floor.
        assert gain > sample_normalize.GAIN_UNITY


# --- float PCM peak scan: non-finite samples ---------------------------------
#
# `_peak_float_be` is driven directly here rather than through an AIFC
# fixture. The fl32 fixture tests above are gated on `aifc`, which 3.13
# removed, so on a modern interpreter they do not run at all — and these
# assertions are exactly the ones that must not go quiet. A BytesIO of raw
# big-endian float bytes needs no stdlib audio module and runs everywhere.


def _be_float_bytes(values, typecode="f"):
    """Raw big-endian PCM payload, as an SSND chunk body would carry it."""
    a = array.array(typecode, values)
    a.byteswap()
    return a.tobytes()


def _peak_of(values, bits=32, typecode="f"):
    data = _be_float_bytes(values, typecode)
    return sample_normalize._peak_float_be(io.BytesIO(data), len(data), 1, bits)


def test_peak_float_be_matches_expected_for_ordinary_samples():
    assert _peak_of([0.5, -0.25, 0.1]) == pytest.approx(-6.0206, abs=1e-4)


def test_peak_float_be_leading_nan_does_not_read_as_silence():
    """A NaN at index 0 used to poison the whole file.

    `max()` keeps its running value only when `x > current` is True, and
    every comparison against NaN is False — so a NaN surviving from index 0
    propagated to the end, the `local > peak` test was False, and the
    function returned None. None means "silent" to the caller, so the take
    was left un-normalized with no error anywhere.
    """
    assert _peak_of([float("nan"), 0.5, -0.25]) == pytest.approx(-6.0206, abs=1e-4)


def test_peak_float_be_leading_inf_does_not_return_inf_dbfs():
    """inf won outright and went straight into the gain-cut math."""
    result = _peak_of([float("inf"), 0.5, -0.25])
    assert math.isfinite(result)
    assert result == pytest.approx(-6.0206, abs=1e-4)


def test_peak_float_be_non_finite_mid_buffer_is_skipped():
    assert _peak_of([0.5, float("nan"), float("-inf"), -0.25]) == pytest.approx(
        -6.0206, abs=1e-4
    )


def test_peak_float_be_all_non_finite_reads_as_silent():
    assert _peak_of([float("nan"), float("inf")]) is None


def test_peak_float_be_true_silence_still_returns_none():
    assert _peak_of([0.0, 0.0, 0.0]) is None


def test_peak_float_be_negative_only_buffer_uses_magnitude():
    """max(max(a), -min(a)) has to pick up an all-negative buffer."""
    assert _peak_of([-0.5, -0.25]) == pytest.approx(-6.0206, abs=1e-4)


def test_peak_float_be_float64_path():
    assert _peak_of([0.5, -0.25], bits=64, typecode="d") == pytest.approx(
        -6.0206, abs=1e-4
    )
