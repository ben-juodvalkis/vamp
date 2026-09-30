"""drum_vm_resolve — reading a Drum Rack's pads off the LOM (ADR-428; split
out of ``DrumVirtualMacroComponent`` on 2026-09-10, issue #491 E0).

The guarded reads the resolve walk is built from: a pad's first chain and
its devices, the instrument on it, the chain's colour and volume, a
device's parameters by name, and one :class:`_Member` record per bound
parameter. Every read swallows the LOM's raise family and answers
``None`` / empty, so one torn-down handle cannot abort a kit walk. Pure
functions of the objects handed in — shared by the virtual-macro
component and the pad-chain component (issue #491).
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .drum_vm_functions import (
    _LOM_ERRORS,
    BOUND_CLASSES,
    DRUM_RACK_CLASS_NAME,
    FAMILY_MACRO_NAMES,
    INSTRUMENT_RACK_CLASS_NAME,
    PAD_NAME_MAX,
    _float_or_none,
    _is_instrument,
    _safe_class_name,
)
from .drum_vm_state import _Member


def find_track_drum_rack(track, track_path: str) -> Tuple[Optional[object], str]:
    """The Drum Rack a track's instrument contains, and its device path:
    a top-level ``DrumGroupDevice``, or one nested one level down in an
    Instrument Rack's chain (196 library kits ship that way). ``(None,
    "")`` for everything else — melodic instruments, plain Instrument
    Racks, audio tracks.

    The one test for "is this a drum track" wherever pitch has to go
    somewhere (issue #489 addendum, the user's rule): by device class,
    never by macro name. Permute's pitch steps
    (``SequencerComponent._resolve_route``) and the clip view's ±12
    (``TrackTransposeComponent``) both ask it.
    """
    try:
        devices = list(track.devices or ())
    except _LOM_ERRORS:
        return None, ""
    for di, dev in enumerate(devices):
        cls = _safe_class_name(dev)
        if cls == DRUM_RACK_CLASS_NAME:
            return dev, "%s/devices/%d" % (track_path, di)
        if cls != INSTRUMENT_RACK_CLASS_NAME:
            continue
        try:
            chains = list(dev.chains or ())
        except _LOM_ERRORS:
            continue
        for ci, chain in enumerate(chains):
            try:
                inner = list(chain.devices or ())
            except _LOM_ERRORS:
                continue
            for ki, sub in enumerate(inner):
                if _safe_class_name(sub) == DRUM_RACK_CLASS_NAME:
                    return sub, "%s/devices/%d/chains/%d/devices/%d" % (track_path, di, ci, ki)
    return None, ""


def is_pipeline_family(macros: List[object]) -> bool:
    if len(macros) < 3:
        return False
    try:
        return (
            getattr(macros[1], "name", "") == FAMILY_MACRO_NAMES[0]
            and getattr(macros[2], "name", "") == FAMILY_MACRO_NAMES[1]
        )
    except _LOM_ERRORS:
        return False


def pad_devices(pad):
    """The devices on the pad's first chain, or ``None`` for an empty
    pad (no chain)."""
    try:
        chains = list(pad.chains or ())
    except _LOM_ERRORS:
        return None
    if not chains:
        return None
    try:
        return list(chains[0].devices or ())
    except _LOM_ERRORS:
        return None


def pad_chain_volume(pad):
    """The pad's first chain's mixer volume (``Chain Volume``, 0..1,
    0.85 = 0 dB — measured on `Bright Room`), or ``None``. The ``gain``
    member for a nested-rack pad, whose instrument's own Volume sits
    inside the rack where no name lookup reaches it."""
    try:
        chains = list(pad.chains or ())
        if not chains:
            return None
        return chains[0].mixer_device.volume
    except _LOM_ERRORS:
        return None


class PadMuteParam:
    """``DrumPad.mute`` dressed as a two-state ``DeviceParameter`` (0 / 1),
    so the ``chainMute`` function writes, reads and seeds it through the
    same member path as every parameter. It is a property with its own
    listener pair on the LOM, not a parameter."""

    __slots__ = ("pad",)
    min = 0.0
    max = 1.0
    is_quantized = True
    is_enabled = True
    name = "Mute"

    def __init__(self, pad):
        self.pad = pad

    @property
    def value(self):
        return 1 if self.pad.mute else 0

    @value.setter
    def value(self, v):
        self.pad.mute = bool(v)

    def add_value_listener(self, cb):
        self.pad.add_mute_listener(cb)

    def remove_value_listener(self, cb):
        self.pad.remove_mute_listener(cb)


def first_instrument(devices):
    """``(device, class_name)`` of the first instrument on the chain —
    bound or not — or ``None`` when the chain carries only effects.
    Effects are skipped in either direction: a MIDI effect may sit
    before the instrument, audio effects (Eq8 …) after it. The census
    counts every class; only ``BOUND_CLASSES`` become members."""
    for dev in devices:
        cls = _safe_class_name(dev)
        if cls in BOUND_CLASSES or cls == INSTRUMENT_RACK_CLASS_NAME or _is_instrument(dev):
            return dev, cls
    return None


def pad_color(pad) -> Optional[int]:
    """``DrumPad.chains[0].color`` — the RGB int Live paints the pad and
    its chain with; ``None`` when there is no chain or no colour."""
    try:
        chains = pad.chains
        chain = chains[0] if chains else None
        if chain is None:
            return None
        color = chain.color
    except _LOM_ERRORS + (IndexError, TypeError):
        return None
    try:
        value = int(color)
    except (TypeError, ValueError):
        return None
    return value if 0 <= value <= 0xFFFFFF else None


def pad_name(pad) -> str:
    """``DrumPad.name`` — the chain's name on a populated pad ("Kick
    Plastic 90s Heavy Rock", measured), capped for the wire."""
    try:
        name = pad.name
    except _LOM_ERRORS:
        return ""
    if not isinstance(name, str):
        return ""
    return name.strip()[:PAD_NAME_MAX]


def instrument_name(device, limit: int = PAD_NAME_MAX) -> str:
    """The pad instrument's own name, capped for the wire (ADR-439). A Drum
    Sampler is named after its sample's file stem and Live renames it when a
    swap changes the sample, while the chain (``DrumPad.name``) keeps the old
    name through a Swap All (a pad's own swap button renames the chain too) — so
    this is what a pad label reads.
    The census caps at ``PAD_NAME_MAX``; a swap's before/after comparison
    passes a longer ``limit`` so two long stems sharing a prefix still differ."""
    try:
        name = device.name
    except _LOM_ERRORS:
        return ""
    if not isinstance(name, str):
        return ""
    return name.strip()[:limit]


# The names Live gives a Drum Sampler and a Simpler before they hold a sample.
# Once one loads a file the device is named after it (measured on the Plymouth
# kit, 2026-09-15), so a pad whose instrument still reads one keeps its chain's.
SAMPLE_PAD_DEFAULT_NAMES = {
    "DrumCell": "Drum Sampler",
    "OriginalSimpler": "Simpler",
}


def pad_label(pad, found) -> str:
    """The name a pad's tile shows (ADR-439). On a Drum Sampler or Simpler pad
    — the two classes Live's similar-sound swap bar serves — the instrument's
    own name, because Live's Swap All renames the instrument and leaves the
    chain's (``DrumPad.name``) on the old sample (a pad's own swap button renames
    both): on the Plymouth kit pad 38's chain
    read ``Snare-SessionDry-Stick-Hit-Soft`` while its Drum Sampler read
    ``…-Hit-Medium``. Every other pad keeps the chain's name: an Operator or
    plug-in instrument is named after the device, not the sound, and a Sampler
    pad's swap is unmeasured (ADR-439 open question 4). ``found`` is
    :func:`first_instrument`'s answer for the pad."""
    if found is not None:
        device, cls = found
        default = SAMPLE_PAD_DEFAULT_NAMES.get(cls)
        if default is not None:
            name = instrument_name(device)
            if name and name != default:
                return name
    return pad_name(pad)


def index_params(device) -> Dict[str, object]:
    out: Dict[str, object] = {}
    try:
        params = list(device.parameters or ())
    except _LOM_ERRORS:
        return out
    for p in params:
        try:
            name = p.name
        except _LOM_ERRORS:
            continue
        if name not in out:
            out[name] = p
    return out


def make_member(param, note: int, cls: str, pname: str, semitone_macro: bool = False) -> _Member:
    def _read(attr, default):
        try:
            return getattr(param, attr)
        except _LOM_ERRORS:
            return default
    lo = _float_or_none(_read("min", 0.0))
    hi = _float_or_none(_read("max", 1.0))
    if lo is None:
        lo = 0.0
    if hi is None:
        hi = 1.0
    return _Member(
        param, note, cls, pname, lo, hi,
        bool(_read("is_quantized", False)),
        bool(_read("is_enabled", True)),
        semitone_macro=semitone_macro,
    )
