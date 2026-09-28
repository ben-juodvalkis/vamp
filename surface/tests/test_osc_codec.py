"""OSC codec round-trip and error-path tests.

The codec ships three arg types — ``str``/``s``, ``int``/``i``,
``float``/``f`` — and these tests assert the wire format for each,
plus round-trip stability and the error-path invariants the
transport relies on (unsupported typetag does not silently return
``None``; truncated input does not panic; non-string addresses
refuse to encode).

If Gate 1 proves OSC parse/serialize correctness on real bytes (per
``05-migration-plan.md §1 Gate 1``), these tests are where that
claim actually lives.
"""

import struct

import pytest

# The codec imports stdlib only, so no pytest skip for the Live
# interpreter. These tests run in CI's normal CPython.
from osc_codec import (
    OSCDecodeError,
    UnsupportedOSCType,
    decode_message,
    encode_message,
)


# --- round trip -------------------------------------------------------------


@pytest.mark.parametrize(
    "address,args",
    [
        ("/live/test", ("ok",)),
        ("/live/test", ()),
        ("/looping/session/tempo", (120.0,)),
        # Every float in this list is exactly representable in float32
        # (powers of 2 and sums thereof). ``3.14`` is not — use
        # ``test_float_precision_is_float32`` below for that contract.
        ("/mixed", ("hello", 42, 0.5)),
        ("/edge/empty_string", ("",)),
        ("/edge/four_char_string", ("abcd",)),  # exactly one padding null
        ("/edge/five_char_string", ("abcde",)),  # three padding nulls
        ("/edge/negative_int", (-2147483648,)),
        ("/edge/max_int", (2147483647,)),
        ("/edge/many_args", tuple(range(8)) + ("end",)),
    ],
)
def test_encode_decode_round_trip(address, args):
    encoded = encode_message(address, args)
    decoded_address, decoded_args = decode_message(encoded)
    assert decoded_address == address
    assert tuple(decoded_args) == tuple(args)


def test_float_precision_is_float32():
    # OSC ``f`` is 32-bit IEEE 754, not 64-bit. Values that aren't
    # exactly representable in float32 round-trip with precision loss
    # on the order of 1e-7. This test pins that expectation so a
    # future "why is our tempo 120.000001?" bug has a clear source.
    encoded = encode_message("/t", (3.14,))
    _, args = decode_message(encoded)
    assert args[0] == pytest.approx(3.14, rel=1e-6)
    assert args[0] != 3.14  # Python's 3.14 is float64; wire is float32.


def test_length_multiple_of_four():
    # Every OSC message on the wire must be a multiple of 4 bytes —
    # padding rules exist for UDP packet alignment. A codec that
    # quietly drops the padding is a transport-layer time bomb.
    for address, args in [
        ("/a", ()),
        ("/hello", ("world",)),
        ("/i", (1,)),
        ("/f", (1.5,)),
        ("/long_addr_needs_padding", ("s",)),
    ]:
        encoded = encode_message(address, args)
        assert len(encoded) % 4 == 0, (address, args, len(encoded))


# --- wire format spot checks -----------------------------------------------


def test_wire_format_live_test_ok():
    # The exact bytes a Gate 1 echo sends back to the bridge. Asserted
    # against a hand-constructed expected value so a codec regression
    # trips this specific test rather than a vague round-trip failure.
    encoded = encode_message("/live/test", ("ok",))
    expected = (
        b"/live/test\x00\x00"    # 12 bytes: 10 chars + null + 1 pad
        b",s\x00\x00"            # 4 bytes: typetag + null + 2 pad
        b"ok\x00\x00"            # 4 bytes: "ok" + null + 1 pad
    )
    assert encoded == expected
    assert len(encoded) == 20


def test_wire_format_float_big_endian():
    # OSC floats are IEEE 754 big-endian. ``struct.pack(">f", 1.0)`` is
    # ``b'\\x3f\\x80\\x00\\x00'``. If this ever comes out little-endian,
    # every tempo message will look like a bit-rotated integer.
    encoded = encode_message("/f", (1.0,))
    # "/f" → 4 bytes "/f\x00\x00", ",f" → 4 bytes, float → 4 bytes
    assert encoded[-4:] == b"\x3f\x80\x00\x00"


def test_wire_format_int_big_endian():
    encoded = encode_message("/i", (1,))
    assert encoded[-4:] == b"\x00\x00\x00\x01"


# --- errors -----------------------------------------------------------------


def test_encode_rejects_non_slash_address():
    with pytest.raises(ValueError):
        encode_message("no_slash", ("x",))


def test_encode_rejects_bool():
    # Bool is a subclass of int in Python; silently encoding it as 0/1
    # is the kind of "works fine until one day it doesn't" behaviour
    # that makes UI-layer bugs very hard to chase.
    with pytest.raises(TypeError):
        encode_message("/b", (True,))


def test_encode_rejects_unknown_type():
    with pytest.raises(TypeError):
        encode_message("/x", ([1, 2, 3],))


def test_encode_int_overflow():
    with pytest.raises(OverflowError):
        encode_message("/big", (2**33,))


def test_decode_truncated_int_raises():
    # Typetag says ``i`` but no int follows.
    truncated = (
        b"/t\x00\x00"
        b",i\x00\x00"
        b"\x00\x00"  # only 2 bytes instead of 4
    )
    with pytest.raises(OSCDecodeError):
        decode_message(truncated)


def test_decode_unsupported_typetag_raises_specific_exception():
    # OSC ``h`` (int64) isn't implemented. The transport handler needs
    # to be able to distinguish this from a generic parse error so it
    # can log loudly rather than drop. (Blob/``b`` is now supported —
    # see ADR-360 / clip notes path.)
    unknown = (
        b"/t\x00\x00"
        b",h\x00\x00"
        b"\x00\x00\x00\x00\x00\x00\x00\x01"  # int64 placeholder
    )
    with pytest.raises(UnsupportedOSCType):
        decode_message(unknown)


# --- blob (ADR-360) -------------------------------------------------------


def test_blob_round_trip_basic():
    payload = b"hello"
    encoded = encode_message("/clip/notes", ("req-1", payload))
    address, args = decode_message(encoded)
    assert address == "/clip/notes"
    assert args[0] == "req-1"
    assert args[1] == payload


def test_blob_round_trip_packed_floats():
    """The notes path packs ``[pitch, start, duration, velocity]`` as
    float32 little-endian. Round-trip must preserve every byte."""
    raw = struct.pack("<ffff", 60.0, 0.0, 0.5, 100.0)
    raw += struct.pack("<ffff", 64.0, 0.5, 0.25, 80.0)
    encoded = encode_message("/clip/notes", ("req-2", "tracks/0", 2, raw))
    _addr, args = decode_message(encoded)
    assert args[3] == raw
    assert len(args[3]) == 32


def test_blob_round_trip_empty():
    encoded = encode_message("/empty", (b"",))
    _addr, args = decode_message(encoded)
    assert args[0] == b""


def test_blob_round_trip_pad_3():
    """Blob length 5 → pad 3 bytes to next 4-byte boundary."""
    payload = b"\x01\x02\x03\x04\x05"
    encoded = encode_message("/p3", (payload,))
    assert len(encoded) % 4 == 0
    _addr, args = decode_message(encoded)
    assert args[0] == payload


def test_blob_accepts_bytearray():
    payload = bytearray(b"\xde\xad\xbe\xef")
    encoded = encode_message("/ba", (payload,))
    _addr, args = decode_message(encoded)
    assert args[0] == bytes(payload)


def test_blob_decode_rejects_truncated_size_prefix():
    truncated = (
        b"/t\x00\x00"
        b",b\x00\x00"
        b"\x00\x00"  # only 2 bytes; expected 4-byte size prefix
    )
    with pytest.raises(OSCDecodeError):
        decode_message(truncated)


def test_blob_decode_rejects_truncated_payload():
    truncated = (
        b"/t\x00\x00"
        b",b\x00\x00"
        b"\x00\x00\x00\x10"  # claims 16 bytes
        b"\x00\x00"           # but only 2 bytes follow
    )
    with pytest.raises(OSCDecodeError):
        decode_message(truncated)


def test_decode_rejects_non_bytes():
    with pytest.raises(OSCDecodeError):
        decode_message("not bytes")


def test_decode_rejects_bundle():
    # Bundles start with ``#bundle``, not ``/``. We don't implement
    # bundles, and the decode path should say so clearly rather than
    # producing garbage.
    bundle = b"#bundle\x00" + b"\x00" * 16
    with pytest.raises(OSCDecodeError):
        decode_message(bundle)


# --- struct sanity ----------------------------------------------------------


def test_float_round_trip_through_struct():
    # Not actually testing the codec — testing our assumption that
    # ``struct.pack(">f", x)`` is exactly reversible for values
    # exactly representable in float32 (powers of 2, their sums, and
    # a handful of "round" decimals). If the interpreter's IEEE 754
    # support is broken, nothing else matters.
    for x in [0.0, 1.0, -1.5, 120.0, 0.5, 0.25]:
        packed = struct.pack(">f", x)
        unpacked = struct.unpack(">f", packed)[0]
        assert unpacked == x


def test_none_rides_as_osc_nil():
    """A property cold-read of "no value" (``vm.fx1`` on a Simpler kit —
    no member; a Simpler property whose container is missing) emits
    ``None``. OSC 1.0 spells that as typetag ``N`` with no payload; the
    bridge's decoder (osc.js ``readNull``) hands it to the UI as JSON
    ``null``. Before this the encode raised and the emit never left the
    surface (ADR-428 Milestone 1b rig, 2026-09-07)."""
    data = encode_message("/looping/v3/property/value", ("tracks/5/devices/0", "vm.fx1", None))
    address, args = decode_message(data)
    assert address == "/looping/v3/property/value"
    assert args == ["tracks/5/devices/0", "vm.fx1", None]
    # Wire shape: ",ssN" and nothing after the two strings.
    tags_start = data.index(b",ssN")
    assert data[tags_start:tags_start + 8] == b",ssN\x00\x00\x00\x00"
    assert len(data) % 4 == 0


def test_nil_can_sit_anywhere_in_the_arg_list():
    data = encode_message("/x", (None, 3, None, 1.5, "s", None))
    assert decode_message(data) == ("/x", [None, 3, None, 1.5, "s", None])
