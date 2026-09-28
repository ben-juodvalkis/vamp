"""drum_vm_state — the drum provider's per-rack records (ADR-428; split out
of ``DrumVirtualMacroComponent`` on 2026-09-10, issue #491 E0).

:class:`_Member` (one member parameter of one function on one pad),
:class:`_MemberEdit` (a pad's deviation from the kit value for a continuous
function), :class:`_PadPitch` (the per-pad pitch model) and
:class:`_RackState` (everything the component holds for one rack, keyed by
its current device path and re-keyed by ``rebind`` when the path moves).
Plain records with ``__slots__``; the rules that fill them live on the
component.
"""

from __future__ import annotations

from typing import Callable, Dict, List, Optional, Set, Tuple

from .drum_vm_functions import VirtualMacro


class _Member:
    """One member parameter of one function on one pad. ``min``/``max``/
    ``quantized``/``enabled`` are read once at resolve time; ``enabled``
    is refreshed on ``macros_mapped`` fires and on a refused write."""

    __slots__ = ("param", "note", "cls", "pname", "min", "max", "quantized", "enabled", "semitone_macro")

    def __init__(self, param, note, cls, pname, lo, hi, quantized, enabled, semitone_macro=False):
        self.param = param
        self.note = note
        self.cls = cls
        self.pname = pname
        self.min = lo
        self.max = hi
        self.quantized = quantized
        self.enabled = enabled
        # A pad rack's transpose macro standing in for a Transpose: the
        # LOM range is the macro's (0..127) but the member is read and
        # written in semitones, −48..48 across that range (the convention).
        self.semitone_macro = semitone_macro


class _MemberEdit:
    """Per-pad state for one member of one continuous function:
    ``member = clamp(global + dev)`` in the function's own value space.

    The generalisation of :class:`_PadPitch` to the other functions
    (2026-09-08). ``dev`` is the pad's deviation from the kit value —
    seeded from the kit as loaded, moved by the user's hand edits in
    Live, and carried through every fan-out — so the kit control moves
    the kit and **keeps its shape** instead of flattening it, and a pad
    tuned by hand survives the next gesture. ``written`` is the value we
    last wrote or last observed, ``prev`` what stood before that write
    while it may still be landing, and ``written_at`` the component clock
    at the write, which :data:`STALE_READ_WINDOW_MS` is measured against.

    Where ``_PadPitch`` is reconciled by reading every member back before
    a fan-out, these are reconciled by the members' own value listeners
    (:meth:`DrumVirtualMacroComponent._absorb_edits`) — push, not poll, so
    watching ten members a pad costs nothing while nothing moves, and a
    hand edit is noticed when it happens rather than at the next gesture.
    Pitch keeps its poll: it is the sequencer's write path and is
    rig-validated as it stands (ADR-429).

    This is also the state a per-pad UI reads and writes: "set pad 38's
    decay" is ``dev = target − global`` on that pad's records, and a
    selection of pads is the same write repeated. The records are keyed
    by ``(pad note, parameter name)`` for that reason.
    """

    __slots__ = ("dev", "written", "prev", "written_at")

    def __init__(
        self, dev: float = 0.0, written: Optional[float] = None, written_at: float = 0.0,
    ) -> None:
        self.dev = float(dev)
        self.written = written
        self.prev: Optional[float] = None
        self.written_at = written_at


class _PadPitch:
    """Per-pad pitch bookkeeping: ``pitch = global + offset + kit shift
    + shift``.

    ``offset`` is the pad's Transpose relative to the global (seeded from
    the kit, moved by the user's per-pad edits); ``shift`` the sequencer
    term a Permute *inside this pad's chain* holds on it (ADR-435,
    2026-09-14 — 0 or the octave), on top of the rack-wide ``_RackState.
    shift`` a track-level Permute holds on every pad, so the two compose;
    ``written`` the value we last wrote to — or, at seed, saw on — the
    pad; ``prev`` what the pad held before that write, kept while the
    write may still be landing; ``written_at`` the component clock at the
    write, which the stale-read window (``STALE_READ_WINDOW_MS``) is
    measured against."""

    __slots__ = ("offset", "prev", "shift", "written", "written_at")

    def __init__(
        self, offset: int = 0, written: Optional[int] = None, written_at: float = 0.0, shift: int = 0,
    ) -> None:
        self.offset = int(offset)
        self.written = written
        self.prev: Optional[int] = None
        self.written_at = written_at
        self.shift = int(shift)


class _RackState:
    """Per-rack state, keyed by the rack's current device path: resolved
    members, the legacy macro table, the held values, the per-pad pitch
    records, and the change listeners keeping them fresh. :meth:`rebind`
    moves it when the rack's path changes."""

    __slots__ = (
        "device", "device_path", "family", "macros", "macros_mapped",
        "has_macro_mappings", "members", "member_pads", "pad_count",
        "pad_classes", "macro_functions", "pitch_macro", "missing", "values", "pads", "shift",
        "dirty", "listeners", "subscribed", "reseed_scheduled",
        "edits", "member_listeners", "edited", "absorb_scheduled",
        "pad_list", "selected_pad_listener", "name_listeners", "kit_name",
        "chain_watcher",
    )

    def __init__(self, device, device_path: str) -> None:
        self.device = device
        self.device_path = device_path
        self.family = False
        self.macros: List[object] = []
        self.macros_mapped: Tuple[bool, ...] = ()
        self.has_macro_mappings = False
        self.members: Dict[str, List[_Member]] = {}
        self.member_pads = 0
        # Census for ``vm.members``: pads that carry a chain, and the class
        # of the first instrument on each populated pad (bound or not).
        self.pad_count = 0
        self.pad_classes: Dict[str, int] = {}
        # The rack-macro functions this kit carries, ``macro.<name>`` →
        # function, in the order the pads' racks list their macros (first
        # pad first). Rebuilt by every resolve; the census lists them.
        self.macro_functions: Dict[str, VirtualMacro] = {}
        # The pad-rack macro name ``pitch`` binds through on a nested-rack
        # kit ("Transpose"), or ``None``; the census reports it.
        self.pitch_macro: Optional[str] = None
        # Bound parameter names a pad's instrument did not list, per
        # function — the 43-parameter Sampler variant lists only a
        # section's switch until the section is first enabled. A write
        # that turns the switch on re-resolves.
        self.missing: Dict[str, int] = {}
        self.values: Dict[str, object] = {}
        # The per-pad pitch model (``pitch = global + offsets[note] +
        # shift + pads[note].shift``), one record per pad note: seeded
        # from the kit's own Transpose values and reconciled against every
        # member read-back before a fan-out (``_reconcile_pitch``).
        self.pads: Dict[int, _PadPitch] = {}
        # permute ADR-020: the sequencer's pitch shift term (0 or 12),
        # committed only once a fan-out carrying it has written something.
        # A pad's own Permute holds its term on ``pads[note].shift``.
        self.shift = 0
        self.dirty = False
        self.listeners: List[Tuple[str, Callable[[], None]]] = []
        self.subscribed: Set[str] = set()
        self.reseed_scheduled = False
        # Per-pad deviations for the continuous functions, function name →
        # (pad note, parameter name) → :class:`_MemberEdit`. The pitch
        # equivalent is ``pads`` above; these survive a re-resolve the same
        # way, because ``members`` is rebuilt from the LOM and they are not.
        self.edits: Dict[str, Dict[Tuple[int, str], _MemberEdit]] = {}
        # (parameter, callback) for every member value listener attached.
        self.member_listeners: List[Tuple[object, Callable[[], None]]] = []
        # Function names whose members fired since the last absorb.
        self.edited: Set[str] = set()
        self.absorb_scheduled = False
        # The census's pad list: ``{"note", "name", "class"}`` per pad that
        # carries a chain, in note order — what a pad grid draws from.
        self.pad_list: List[Dict[str, object]] = []
        # ``rack.view.add_selected_drum_pad_listener`` callback, if attached.
        self.selected_pad_listener: Optional[Callable[[], None]] = None
        # (instrument, callback) for every pad instrument's ``name`` listener
        # (ADR-439): a swap made in Live's own UI renames the instrument and
        # nothing else fires, so this is what re-emits the census.
        self.name_listeners: list[tuple[object, Callable[[], None]]] = []
        # The rack's own ``name`` when the held values and the per-pad
        # records were last seeded. A preset load into the same rack device
        # changes it (Live names the device after the preset), and
        # **nothing else observable changes**: measured on the rig
        # 2026-09-15, the chains, the pads, the devices and every
        # DeviceParameter come back with the same ``_live_ptr``, and the
        # pad chains' own ``devices`` listeners do not fire. So the name is
        # the signal that the records describe a kit that is gone.
        self.kit_name: Optional[str] = None
        # ``DrumPadChainComponent.PadChainWatcher`` — the rack's
        # ``drum_pads`` / ``chains`` listeners and one ``devices`` listener
        # per populated pad chain. The component's third owner, after
        # ``DrumPadChainComponent`` and ``SequencerComponent``. Note the
        # measured limit recorded above: a *preset load* into this rack
        # fires none of these. The chains' listeners cover the narrower
        # case of a pad's instrument being replaced on its own (a device
        # dragged onto a pad), which the rack's own listeners miss.
        self.chain_watcher: Optional[object] = None
