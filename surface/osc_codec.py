"""Minimal OSC 1.0 encoder/decoder.

In-house, stdlib-only codec for the four arg types we send on the
wire today: ``s`` (string), ``i`` (int32 big-endian), ``f``
(float32 big-endian IEEE 754), and ``b`` (blob, ADR-360 — used by
``/looping/v3/clip/notes`` to carry a packed float32 note array).
Anything richer — 64-bit, time tags, bundles — is not implemented
and raises ``UnsupportedOSCType``. Widen when a fixture demands it.

Why in-house rather than vendoring ``python-osc``:

- The full ``pythonosc`` tree AbletonOSC ships is ~500 lines across
  eight files with a parsing submodule. This file is ~150.
- License headers on a foreign tree plus update pressure are friction
  we don't need when the code we actually use fits on one screen.
- Gate 1 is explicitly about proving OSC parse/serialize correctness
  with real bytes (see ``05-migration-plan.md §1 Gate 1``). Writing
  it ourselves means the round-trip tests below *are* the proof.

Reference: http://opensoundcontrol.org/spec-1_0.html (OSC 1.0).

The encoder accepts Python types and maps them to OSC types
unambiguously: ``str`` → ``s``, ``int`` → ``i`` (must fit in int32,
else ``OverflowError`` — not silently truncated), ``float`` → ``f``.
Mixed-int-float lists are fine; there is no type coercion on the
wire.
"""

import struct

# --- exceptions -------------------------------------------------------------


class OSCDecodeError(ValueError):
    """Raised when a byte string fails to parse as an OSC message."""


class UnsupportedOSCType(OSCDecodeError):
    """Raised on a typetag we don't implement (e.g. ``b``, ``h``, ``d``).

    Distinct from ``OSCDecodeError`` for the common case so handlers
    can log loudly rather than silently drop. See ``osc_transport``'s
    parse-error path.
    """


# --- helpers ----------------------------------------------------------------


def _pad4(n):
    """Round ``n`` up to the nearest multiple of 4."""
    return (n + 3) & ~3


def _encode_string(s):
    """OSC string: UTF-8 bytes, null terminator, null-pad to 4-byte boundary."""
    data = s.encode("utf-8") + b"\x00"
    return data + b"\x00" * (_pad4(len(data)) - len(data))


def _decode_string(data, offset):
    """Decode a null-terminated, 4-byte-padded OSC string.

    Returns ``(string, new_offset)``. Raises ``OSCDecodeError`` if no
    null terminator is found before end of buffer.
    """
    end = data.find(b"\x00", offset)
    if end == -1:
        raise OSCDecodeError("OSC string missing null terminator")
    s = data[offset:end].decode("utf-8")
    # Advance past the null, then round up to the 4-byte boundary.
    consumed = end - offset + 1
    return s, offset + _pad4(consumed)


# --- public API -------------------------------------------------------------


def encode_message(address, args=()):
    """Encode an OSC 1.0 message.

    ``address`` must be a string starting with ``/``. ``args`` is any
    iterable of ``str``, ``int``, ``float``, ``bytes`` or ``None`` —
    ``None`` rides as OSC nil (typetag ``N``, no payload), which the
    bridge's decoder hands to the UI as JSON ``null``. The resulting
    ``bytes`` is ready to send via ``socket.sendto``.

    Raises ``TypeError`` on unsupported Python types, ``OverflowError``
    if an int doesn't fit in signed 32-bit.
    """
    if not isinstance(address, str) or not address.startswith("/"):
        raise ValueError("OSC address must start with '/': %r" % (address,))

    typetags = ","
    arg_bytes = b""
    for arg in args:
        # ``bool`` is a subclass of ``int`` in Python; reject
        # explicitly so a misplaced flag doesn't silently become 0/1
        # on the wire without the caller noticing.
        if isinstance(arg, bool):
            raise TypeError(
                "OSC: bool args are ambiguous; pass int(0|1) or use "
                "a typed extension if you need them"
            )
        if arg is None:
            # OSC 1.0 nil: the typetag carries the whole value. This is
            # what a property cold-read of "no value" (a virtual macro
            # with no member on the kit, a Simpler property whose
            # container is missing) rides on — before this branch the
            # emit failed to encode and never left the surface (ADR-428
            # Milestone 1b rig, 2026-09-07).
            typetags += "N"
        elif isinstance(arg, str):
            typetags += "s"
            arg_bytes += _encode_string(arg)
        elif isinstance(arg, int):
            typetags += "i"
            # struct ``>i`` raises ``struct.error`` on overflow; wrap
            # for a clearer message.
            try:
                arg_bytes += struct.pack(">i", arg)
            except struct.error as e:
                raise OverflowError(
                    "OSC int32 overflow for %r: %s" % (arg, e)
                )
        elif isinstance(arg, float):
            typetags += "f"
            arg_bytes += struct.pack(">f", arg)
        elif isinstance(arg, (bytes, bytearray)):
            # OSC blob: int32 size prefix, then the raw bytes,
            # then zero-pad to the next 4-byte boundary. Spec §1.3
            # under "OSC-blob".
            typetags += "b"
            blob = bytes(arg)
            arg_bytes += struct.pack(">i", len(blob))
            arg_bytes += blob
            pad = _pad4(len(blob)) - len(blob)
            if pad:
                arg_bytes += b"\x00" * pad
        else:
            raise TypeError(
                "OSC: unsupported arg type %s for value %r"
                % (type(arg).__name__, arg)
            )

    return _encode_string(address) + _encode_string(typetags) + arg_bytes


def decode_message(data):
    """Decode an OSC 1.0 message.

    Returns ``(address, args)`` where ``args`` is a ``list`` of
    ``str``, ``int``, ``float`` — one per typetag, in order.

    Raises ``OSCDecodeError`` on malformed input, ``UnsupportedOSCType``
    on typetags this codec doesn't implement.
    """
    if not isinstance(data, (bytes, bytearray)):
        raise OSCDecodeError("OSC data must be bytes, got %s" % type(data).__name__)
    if len(data) < 4:
        raise OSCDecodeError("OSC message too short")

    address, offset = _decode_string(data, 0)
    if not address.startswith("/"):
        # Could be a bundle (``#bundle``) — not supported here.
        raise OSCDecodeError("OSC address must start with '/': %r" % address)

    typetags, offset = _decode_string(data, offset)
    if not typetags.startswith(","):
        raise OSCDecodeError("OSC typetags must start with ',': %r" % typetags)

    args = []
    for tag in typetags[1:]:
        if tag == "N":
            args.append(None)
        elif tag == "s":
            s, offset = _decode_string(data, offset)
            args.append(s)
        elif tag == "i":
            if offset + 4 > len(data):
                raise OSCDecodeError("OSC int32 truncated")
            args.append(struct.unpack(">i", data[offset:offset + 4])[0])
            offset += 4
        elif tag == "f":
            if offset + 4 > len(data):
                raise OSCDecodeError("OSC float32 truncated")
            args.append(struct.unpack(">f", data[offset:offset + 4])[0])
            offset += 4
        elif tag == "b":
            if offset + 4 > len(data):
                raise OSCDecodeError("OSC blob size prefix truncated")
            size = struct.unpack(">i", data[offset:offset + 4])[0]
            offset += 4
            if size < 0:
                raise OSCDecodeError("OSC blob negative size: %d" % size)
            if offset + size > len(data):
                raise OSCDecodeError(
                    "OSC blob truncated: size=%d remaining=%d"
                    % (size, len(data) - offset),
                )
            args.append(bytes(data[offset:offset + size]))
            offset += _pad4(size)
        else:
            raise UnsupportedOSCType(
                "OSC typetag %r not implemented (address=%r)" % (tag, address)
            )

    return address, args
