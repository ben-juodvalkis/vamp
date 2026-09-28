"""drum_vm_functions — the virtual-macro vocabulary (ADR-428; split out of
``DrumVirtualMacroComponent`` on 2026-09-10, issue #491 E0).

The wire names, value kinds and ranges, the timing constants, the
:class:`VirtualMacro` function table with its per-class parameter-name
bindings, the rack-macro and per-pad name families and their parsers,
and the small LOM-safe helpers every module of the drum provider shares.
Pure: no state, no LOM handles kept. The component and the pad-chain
component both read from here; ``PropertyComponent`` generates its
computed allowlist rows from :data:`FUNCTIONS`.
"""

from __future__ import annotations

import math
import re
from typing import Dict, Optional, Tuple

from .path_resolver import PAD_NOTE_MAX

_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)

# --- wire ---------------------------------------------------------------

V3_PROPERTY_VALUE_ADDRESS = "/looping/v3/property/value"
#: The ``state/full/tree`` reason a pad-scoped bundle carries (issue #491,
#: 3.8.0): what ``DrumPadChainComponent`` advances the generation with and
#: what ``V3StateFullComponent`` exempts from the unchanged-tree memo. One
#: name, so the two cannot drift apart (code review, 2026-09-12).
REASON_PAD_CHAIN = "pad-chain"

# --- Live's Device.type ------------------------------------------------------
#
# ``Device.type`` reads ``Device.DeviceType.<kind>`` on Live — an int-valued
# enum — and a plain int on a stub. One reader for the three modules that
# ask "what kind of device is this": the pad-chain component (which chain
# devices get value listeners), the state-full walk (which get D/P records)
# and the loader (where a MIDI effect goes). They used to carry three
# copies of the same comparison (code review, 2026-09-12).

DEVICE_TYPE_INSTRUMENT = 1
DEVICE_TYPE_AUDIO_EFFECT = 2
DEVICE_TYPE_MIDI_EFFECT = 4


def device_type(device) -> Optional[int]:
    """``Device.type`` as one of the three ints above, or ``None`` when the
    LOM will not say. Compares as an int first, then by the enum's name,
    so a stub int and the real enum agree."""
    try:
        t = device.type
    except Exception:
        return None
    try:
        return int(t)
    except (TypeError, ValueError):
        pass
    text = str(t).lower()
    if "instrument" in text:
        return DEVICE_TYPE_INSTRUMENT
    if "midi" in text:
        return DEVICE_TYPE_MIDI_EFFECT
    if "audio" in text:
        return DEVICE_TYPE_AUDIO_EFFECT
    return None

DRUM_RACK_CLASS_NAME = "DrumGroupDevice"
#: Prefix of every virtual-macro property name on the wire (``vm.pitch``).
PROPERTY_PREFIX = "vm."
#: The ``PropertySpec.computed`` provider name PropertyComponent routes on.
PROVIDER_NAME = "drum_vm"
#: The read-only census row beside the functions (Milestone 1b):
#: ``vm.members`` → a JSON string (see :meth:`DrumVirtualMacroComponent.members_json`).
MEMBERS_KEY = "members"
MEMBERS_PROPERTY = PROPERTY_PREFIX + MEMBERS_KEY
#: Live's selected pad on the rack (``rack.view.selected_drum_pad``), as a
#: MIDI note: ``vm.selectedPad`` → int or nil. Read / write / listened.
SELECTED_PAD_KEY = "selectedPad"
SELECTED_PAD_PROPERTY = PROPERTY_PREFIX + SELECTED_PAD_KEY
#: Per-pad rows (2026-09-08): ``vm.pad.<note>.<function>`` — one pad's
#: value of a function, absolute, in the function's own units. The
#: function after the note may itself be a rack macro
#: (``vm.pad.38.macro.Attack``).
PAD_FUNCTION_PREFIX = "pad."
PAD_PROPERTY_PREFIX = PROPERTY_PREFIX + PAD_FUNCTION_PREFIX
#: Pad names ride the census; capped so a 32-pad kit stays a few KB.
PAD_NAME_MAX = 24
#: Above this the census drops pad names (and says so once) rather than
#: risk the 9,216 B datagram cap.
CENSUS_BYTES_SOFT_CAP = 8000

# --- value kinds --------------------------------------------------------

KIND_T = "t"                 # continuous, 0..1
KIND_ENUM = "enum"           # integer index (FX Type 0..8)
KIND_SEMITONES = "semitones"  # whole semitones, -48..48, centre 0

PITCH_MIN = -48
PITCH_MAX = 48
#: DrumCell ``FX Type`` has nine states; measured LOM ``max`` is 8.0.
FX_TYPE_MAX = 8
#: Measured: a switch under a macro turns on when the macro exceeds 1.0
#: of 127 (1.0 → off, 1.2 → on). Expressed in ``t`` units.
TOGGLE_ON_ABOVE_T = 1.0 / 127.0
#: Pipeline-family fingerprint: macros 1 and 2 are literally named so.
FAMILY_MACRO_NAMES = ("FX1", "FX2")
#: Delay before a pads/chains/macros change is re-read and re-emitted.
#: Live populates a freshly-loaded rack's chains after the add fires;
#: 150 ms is the same margin the property cascades use.
RESEED_DELAY_MS = 150
#: A gesture's undo step closes after this long with no apply. The UI
#: sends at up to 60 Hz while a finger moves, so a live drag never
#: reaches it; the scheduler rounds up to 100 ms ticks.
GESTURE_UNDO_IDLE_MS = 300
#: How long after our own write a member reading its *pre-write* value
#: still counts as that write landing — a DrumCell can read one write
#: behind under a busy control thread (measured 2026-09-07, ADR-429) —
#: rather than as a user edit. Measured on the component's ``_clock``.
#: Must cover the fastest step: a 1/16 at 180 BPM is 83 ms apart and the
#: pump ticks every ~11 ms. Past the window the same read is the user's
#: (a hand tune back to the old value, Live's undo of our step).
STALE_READ_WINDOW_MS = 400

#: How long a member value-listener fire waits before the change is read
#: back and classified. Coalesces the storm a fan-out — or Live's undo of
#: one — produces into a single pass, and keeps the classification out of
#: the LOM notification (the repo rule: a listener marks and schedules,
#: nothing else).
EDIT_ABSORB_DELAY_MS = 150
#: Ceiling on member value listeners for one rack. A 32-pad DrumCell kit
#: carries ~700 continuous members (``fx1`` alone is ten a pad), which is
#: within Live's reach; the cap is what stops an unforeseen kit from
#: installing an unbounded number. Functions are watched in table order
#: and one that would cross the cap is left unwatched — it keeps
#: Milestone 1 behaviour (a hand edit on it drifts), and says so once.
MAX_MEMBER_LISTENERS = 1024
#: Two values in a function's own space (``t``, 0..1) count as equal below
#: this: below a MIDI step, well above float noise.
DEV_EPSILON = 1e-4
#: Vote-key precision for the kit-move detector on the continuous
#: functions (pitch votes on whole semitones instead).
DEV_VOTE_DP = 3

# Classes that are instruments but carry no binding for the fixed
# functions — the first device on a pad being one of these makes the pad
# a non-member of them (never a wrong write). A nested Instrument Rack is
# instead the member class of the rack-macro functions below.
INSTRUMENT_RACK_CLASS_NAME = "InstrumentGroupDevice"

#: Rack-macro functions (rack-macros profile, 2026-09-07): one per macro
#: name the kit's pad racks carry, ``macro.<name>`` on the component and
#: ``vm.macro.<name>`` on the wire. The name rides verbatim after the
#: prefix (spaces and all; a name may even contain a dot).
MACRO_FUNCTION_PREFIX = "macro."
MACRO_PROPERTY_PREFIX = PROPERTY_PREFIX + MACRO_FUNCTION_PREFIX
#: A rack exposes ``Device On``, its 16 macros and ``Chain Selector`` as
#: ``parameters`` (measured 2026-09-07); the two non-macros are skipped by
#: name, never by position, so a hidden prefix parameter cannot shift
#: the table (the Permute lesson).
RACK_NON_MACRO_PARAMS = frozenset(("Device On", "Chain Selector"))
#: What Live calls a chain's mixer volume — the ``gain`` member on a
#: nested-rack pad. Recorded for the census, never looked up by name.
CHAIN_VOLUME_NAME = "Chain Volume"
MACRO_SLOTS = 16
#: A macro still wearing Live's default name (or the ``.`` / ``-`` the
#: library uses for "unused") is not a control; same rule as the
#: interface's ``isEmptyMacroName``.
_EMPTY_MACRO_NAME_RX = re.compile(r"^Macro\s*\d+$", re.IGNORECASE)


#: Pad-rack macro names that stand in for a Transpose (exact,
#: case-insensitive), in priority order. Under the project convention
#: such a macro spans −48..48 semitones over its 0..127.
PITCH_MACRO_NAMES = ("Transpose", "Pitch", "Tune", "Trnsp")
_PITCH_MACRO_NAMES_LOWER = tuple(n.lower() for n in PITCH_MACRO_NAMES)


def is_pitch_macro_name(name) -> bool:
    return isinstance(name, str) and name.strip().lower() in _PITCH_MACRO_NAMES_LOWER


def is_empty_macro_name(name) -> bool:
    if not name or not isinstance(name, str):
        return True
    stripped = name.strip()
    if stripped in ("", ".", "-"):
        return True
    return _EMPTY_MACRO_NAME_RX.match(stripped) is not None


class VirtualMacro:
    """One musical function: its value kind, the legacy macro index the
    view used to write (1-based; ``parameters[idx]`` on the rack), and
    the per-class member parameter names."""

    __slots__ = ("name", "kind", "legacy_macro", "bindings", "macro_name", "switch_off_at_floor")

    def __init__(
        self, name: str, kind: str, legacy_macro: int,
        bindings: Dict[str, Tuple[str, ...]],
        macro_name: Optional[str] = None,
        switch_off_at_floor: bool = True,
    ) -> None:
        self.name = name
        self.kind = kind
        # 1-based rack macro index the view used to write, or 0 for a
        # function that has no legacy macro (every rack-macro function).
        self.legacy_macro = legacy_macro
        self.bindings = bindings
        # The pad-rack macro name behind a ``macro.<name>`` function;
        # ``None`` for the fixed functions.
        self.macro_name = macro_name
        # A two-state switch member follows the amount: on above 1/127 of
        # travel, off at the floor (FX On under FX1 — the measured macro
        # threshold). False for a function whose amount is bipolar
        # (``pitchEnvAmount``: the floor is −48 st, not "none"), whose
        # switch a write always turns on and never off.
        self.switch_off_at_floor = switch_off_at_floor


# Binding rows. LOM parameter names read from Live; the DrumCell fx1/fx2
# membership verified against the KeyMidi table of ` 606 + 808.adg`
# (macro 0 → 10 params, macro 1 → 9 params; ADR-428 lists the file→LOM
# name map). Order matters only for seeding: the first *continuous*
# member of the first member pad seeds a ``t`` value.
FUNCTIONS: Dict[str, VirtualMacro] = {
    "fx1": VirtualMacro("fx1", KIND_T, 1, {
        "DrumCell": (
            "FX On", "Pitch Env Amt", "Sub Amt", "Noise Amt", "Loop Offset",
            "Stretch Factor", "Punch Amt", "8-Bit Rate", "FM Amt", "RM Amt",
        ),
    }),
    "fx2": VirtualMacro("fx2", KIND_T, 2, {
        "DrumCell": (
            "Pitch Env Decay", "Sub Freq", "Noise Color", "Loop Length",
            "Grain Size", "Punch Release", "8-Bit Flt Decay", "FM Freq",
            "RM Freq",
        ),
    }),
    "fxType": VirtualMacro("fxType", KIND_ENUM, 3, {
        "DrumCell": ("FX Type",),
    }),
    "pitch": VirtualMacro("pitch", KIND_SEMITONES, 4, {
        "DrumCell": ("Transpose",),
        "OriginalSimpler": ("Transpose",),
        "MultiSampler": ("Transpose",),
    }),
    "attack": VirtualMacro("attack", KIND_T, 9, {
        "DrumCell": ("Attack",),
        "OriginalSimpler": ("Ve Attack",),
        "MultiSampler": ("Ve Attack",),
    }),
    "decay": VirtualMacro("decay", KIND_T, 10, {
        "DrumCell": ("Decay",),
        "OriginalSimpler": ("Ve Decay",),
        "MultiSampler": ("Ve Decay",),
    }),
    "start": VirtualMacro("start", KIND_T, 11, {
        "DrumCell": ("Start",),
        "OriginalSimpler": ("S Start",),
    }),
    # The sample instruments' amp-envelope release — the Y axis of the
    # Sampler view's Time pad (2026-09-07, Sampler kits). DrumCell has
    # no release stage (Attack / Hold / Decay), and no pipeline macro
    # ever drove one: no legacy index.
    "release": VirtualMacro("release", KIND_T, 0, {
        "OriginalSimpler": ("Ve Release",),
        "MultiSampler": ("Ve Release",),
    }),
    # The Sampler row (2026-09-07, measured on `50s Autumn Brushes`):
    # Live's Pitch/Osc tab as whole-kit gestures. A section's switch is
    # the function's first member and turns on above 1/127 like FX On,
    # so a pad whose section is off follows the amount. A real Sampler
    # lists all 108 parameters with fixed indices; the 43-parameter
    # variant lists only a section's switch until the section is first
    # enabled, and ``_grow_sections`` re-reads the rack after a switch
    # member turns on so the amount is written in the same pass. Ranges:
    # O Volume 0..1, O Coarse −2..48, Pe < Env −48..48 (centre = no
    # envelope; bipolar, so its switch never follows the floor),
    # Pe Attack / Ve Sustain 0..1, Spread 0..100.
    "oscAmount": VirtualMacro("oscAmount", KIND_T, 0, {
        "MultiSampler": ("Osc On", "O Volume"),
    }),
    "oscCoarse": VirtualMacro("oscCoarse", KIND_T, 0, {
        "MultiSampler": ("O Coarse",),
    }),
    "pitchEnvAmount": VirtualMacro("pitchEnvAmount", KIND_T, 0, {
        "MultiSampler": ("Pe On", "Pe < Env"),
    }, switch_off_at_floor=False),
    "pitchEnvAttack": VirtualMacro("pitchEnvAttack", KIND_T, 0, {
        "MultiSampler": ("Pe Attack",),
    }),
    "sustain": VirtualMacro("sustain", KIND_T, 0, {
        "OriginalSimpler": ("Ve Sustain",),
        "MultiSampler": ("Ve Sustain",),
    }),
    "spread": VirtualMacro("spread", KIND_T, 0, {
        "OriginalSimpler": ("Spread",),
        "MultiSampler": ("Spread",),
    }),
    # The filter, as one XY pad (2026-09-09, user's request): cutoff
    # across, resonance up. Names read off the running rig, not the
    # indices the request named — those differ per Sampler variant, which
    # is why nothing here binds by index. `FAT Kit` (OriginalSimpler)
    # gave `F On` 31 / `Filter Freq` 36 / `Filter Res` 37, and
    # `Octagonal House` (DrumCell) `Filter On` 7 / `Filter Freq` 8 /
    # `Filter Res` 9 — both exactly the requested positions. The
    # MultiSampler pair is the one inference in the table: `F On` is
    # measured on a Sampler (index 37 of the 55-parameter variant), and
    # the two names beside it are Simpler's, which the Sampler matches on
    # every other bound parameter. Wrong, it resolves no member and the
    # control ghosts — visible, not silently moving something else.
    #
    # RESONANCE IS NOT 0..1. The rig reads `Filter Res` max **1.25** on a
    # Simpler. Nothing here cares — the fan-out spans each member's own
    # min..max — but a table that wrote 0..1 down would have been wrong.
    #
    # The switch does NOT follow the floor (`switch_off_at_floor=False`,
    # as on `pitchEnvAmount`). Cutoff at the floor with the filter ON is
    # closed and silent; letting the floor switch the filter OFF would
    # open it wide instead, so the bottom of the sweep would jump from
    # silence to full. A write turns the filter on and never off.
    "filterFreq": VirtualMacro("filterFreq", KIND_T, 0, {
        "DrumCell": ("Filter On", "Filter Freq"),
        "OriginalSimpler": ("F On", "Filter Freq"),
        "MultiSampler": ("F On", "Filter Freq"),
    }, switch_off_at_floor=False),
    "filterRes": VirtualMacro("filterRes", KIND_T, 0, {
        "DrumCell": ("Filter Res",),
        "OriginalSimpler": ("Filter Res",),
        "MultiSampler": ("Filter Res",),
    }),
    # How loud a pad is (2026-09-08, user's request). Every bound class
    # names it ``Volume``, and the three ranges differ — measured on the
    # rig, not read off a doc: DrumCell ``Volume`` is normalized 0..1
    # (index 18 on `Octagonal House`), Sampler's is **dB, -36..36**
    # (index 15 on `Bright Room`), Simpler's likewise. The ``t`` fan-out
    # spans each member's own min..max, so one slider is "how loud",
    # whatever the pad instrument measures it in, and a mixed kit moves
    # together.
    #
    # A nested-rack pad has no ``Volume`` to bind — the Samplers are
    # inside the rack, macro-held — so on those kits the member is the
    # pad's own CHAIN VOLUME instead (``chains[0].mixer_device.volume``,
    # 0..1, 0.85 = 0 dB), added in ``_rebuild_members`` rather than here
    # because it is not a device parameter lookup. Same gesture one level
    # up, and the only handle a nested-rack kit has on a pad's level.
    "gain": VirtualMacro("gain", KIND_T, 0, {
        "DrumCell": ("Volume",),
        "OriginalSimpler": ("Volume",),
        "MultiSampler": ("Volume",),
    }),
}

#: Wire property names, in table order.
PROPERTY_NAMES: Tuple[str, ...] = tuple(
    PROPERTY_PREFIX + name for name in FUNCTIONS
)
#: Every instrument class that has at least one binding.
BOUND_CLASSES = frozenset(
    cls for fn in FUNCTIONS.values() for cls in fn.bindings
)


def is_macro_function(function: str) -> bool:
    """``"macro.Attack"`` → True; the bare prefix is not a function."""
    return (
        isinstance(function, str)
        and function.startswith(MACRO_FUNCTION_PREFIX)
        and len(function) > len(MACRO_FUNCTION_PREFIX)
    )


def is_macro_property(property_name: str) -> bool:
    """``"vm.macro.Attack"`` → True (the wire form of :func:`is_macro_function`)."""
    return (
        isinstance(property_name, str)
        and property_name.startswith(MACRO_PROPERTY_PREFIX)
        and len(property_name) > len(MACRO_PROPERTY_PREFIX)
    )


def macro_function(macro_name: str) -> VirtualMacro:
    """The ``t``-kind function for one pad-rack macro name: bound on
    ``InstrumentGroupDevice`` by that name, no legacy macro."""
    return VirtualMacro(
        MACRO_FUNCTION_PREFIX + macro_name, KIND_T, 0,
        {INSTRUMENT_RACK_CLASS_NAME: (macro_name,)},
        macro_name=macro_name,
    )


def parse_pad_function(function) -> Optional[Tuple[int, str]]:
    """``pad.<note>.<fn>`` → ``(note, fn)``; ``fn`` may be a rack-macro
    function (``pad.38.macro.Attack`` → ``(38, "macro.Attack")``).
    ``None`` for anything else — a note outside 0..127, a function the
    table does not know, a missing piece."""
    if not isinstance(function, str) or not function.startswith(PAD_FUNCTION_PREFIX):
        return None
    rest = function[len(PAD_FUNCTION_PREFIX):]
    note_s, sep, fn = rest.partition(".")
    if not sep or not note_s.isdigit() or not fn:
        return None
    note = int(note_s)
    if note > PAD_NOTE_MAX:
        return None
    if fn not in FUNCTIONS and not is_macro_function(fn):
        return None
    return note, fn


def is_pad_property(property_name) -> bool:
    """Whether ``property_name`` is a well-formed ``vm.pad.<note>.<fn>``."""
    return (
        isinstance(property_name, str)
        and property_name.startswith(PAD_PROPERTY_PREFIX)
        and parse_pad_function(property_name[len(PROPERTY_PREFIX):]) is not None
    )


def function_for_property(property_name: str) -> Optional[VirtualMacro]:
    """``"vm.pitch"`` → the ``pitch`` function; ``"vm.macro.Attack"`` → a
    rack-macro function for ``Attack``; anything else ``None``."""
    if not property_name.startswith(PROPERTY_PREFIX):
        return None
    function = property_name[len(PROPERTY_PREFIX):]
    if is_macro_function(function):
        return macro_function(function[len(MACRO_FUNCTION_PREFIX):])
    return FUNCTIONS.get(function)


# --- helpers --------------------------------------------------------------


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _safe_class_name(device) -> str:
    try:
        return getattr(device, "class_name", "") or ""
    except Exception:
        return ""


def _is_instrument(device) -> bool:
    """Whether ``device`` is an instrument — :func:`device_type`'s answer,
    kept under this name for the state-full walk and the census."""
    return device_type(device) == DEVICE_TYPE_INSTRUMENT


def _float_or_none(x) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v
