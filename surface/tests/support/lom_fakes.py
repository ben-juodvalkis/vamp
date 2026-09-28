"""LOM fakes for the Drum Rack components (moved out of
``test_drum_virtual_macro_component.py`` on 2026-09-10, issue #491 E0).

A ``DrumGroupDevice`` shaped the way Live 12 exposes it — 128 pads, each
with at most one chain of devices, the rack's macros as ``parameters``,
``macros_mapped``, the three change listeners and the view's selected pad
with its listener — plus the pad instruments the rig measured (a
DrumCell, a Simpler, a Sampler with its growing sections) and the kit
builders the tests compose them with. Shared by the virtual-macro tests
and the pad-chain tests, which add chain ``devices`` listeners and a
device ``type`` on top.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence


# --- properties that raise on READ ------------------------------------------
#
# Every fake in this file raises only from a *setter*. Live 12 raises from
# getters too — ``master.mute`` is a ``RuntimeError``, a half-torn-down slot
# answers ``Boost.Python.ArgumentError`` (a ``TypeError``) to any attribute —
# and the surface is full of ``_LOM_ERRORS``-on-read guards that nothing
# exercised, because no fake could produce one (swap audit, test case 6). The
# helpers below make any fake raise from any attribute read, so those guards
# can be tested at all.
#
# ``raising_getter`` wraps one object; ``RaisesOnRead`` is the mixin for a fake
# that wants it built in. Both take the exception *class* so a test can pick
# one inside ``_LOM_ERRORS`` (RuntimeError / AttributeError / TypeError) or —
# the case M11 is about — deliberately outside it.


class _RaisingProxy:
    """``obj`` with ``names`` raising on read. Everything else passes through,
    including writes, so a test can still set up the object it broke."""

    def __init__(self, obj, names: Iterable[str], exc=RuntimeError, message: str = "LOM read refused"):
        object.__setattr__(self, "_obj", obj)
        object.__setattr__(self, "_names", set(names))
        object.__setattr__(self, "_exc", exc)
        object.__setattr__(self, "_message", message)
        object.__setattr__(self, "reads", [])

    def __getattr__(self, name: str):
        if name in object.__getattribute__(self, "_names"):
            object.__getattribute__(self, "reads").append(name)
            raise object.__getattribute__(self, "_exc")(
                "%s: %s" % (object.__getattribute__(self, "_message"), name)
            )
        return getattr(object.__getattribute__(self, "_obj"), name)

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(object.__getattribute__(self, "_obj"), name, value)


def raising_getter(obj, *names: str, exc=RuntimeError, message: str = "LOM read refused"):
    """``obj`` with each of ``names`` raising ``exc`` when read.

    >>> clip = raising_getter(clip, "file_path")          # M12's refusal
    >>> clip = raising_getter(clip, "gain", exc=TypeError)  # M14's silent loss

    Replaces the one-off raising-``file_path`` clip that
    ``test_clips_swap_file.py`` built inline: the same trick, reusable, and
    able to break a getter on any fake in this file.
    """
    return _RaisingProxy(obj, names, exc=exc, message=message)


class RaisesOnRead:
    """Mixin: ``self.raise_on_read`` is a ``{name: exception}`` map consulted
    by ``__getattribute__`` before the real attribute. For a fake that has to
    keep its own identity (an ``is`` comparison, an isinstance check) where a
    proxy would not do."""

    raise_on_read: Dict[str, Any] = {}

    def __getattribute__(self, name: str):
        broken = object.__getattribute__(self, "__dict__").get("raise_on_read") or {}
        if name in broken:
            exc = broken[name]
            raise (exc if isinstance(exc, BaseException) else exc("LOM read refused: %s" % name))
        return object.__getattribute__(self, name)


class FakeParam:
    """``DeviceParameter`` shaped like Live's: a disabled (macro-held)
    parameter raises on write with Live's exact message."""

    def __init__(self, name, value=0.0, lo=0.0, hi=1.0, quantized=False, enabled=True):
        self.name = name
        self._value = value
        self.min = lo
        self.max = hi
        self.is_quantized = quantized
        self.is_enabled = enabled
        self.writes: List[object] = []
        self.listeners: List[object] = []

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if not self.is_enabled:
            raise RuntimeError("Value cannot be set, the parameter is disabled")
        self._value = v
        self.writes.append(v)
        # Live fires the value listeners for our own writes too; the
        # component's ``_fanning_out`` flag is what ignores them.
        self._fire()

    def _fire(self):
        for cb in list(self.listeners):
            cb()

    def add_value_listener(self, cb):
        self.listeners.append(cb)

    def remove_value_listener(self, cb):
        self.listeners.remove(cb)


def hand_edit(p: "FakeParam", v: float) -> None:
    """A change made in Live's own UI: the value moves and the listeners
    fire, but it is not one of our writes (nothing lands in ``writes``)."""
    p._value = v
    p._fire()


_next_ptr = [1000]


class FakeDevice:
    """``type`` follows ``Device.DeviceType``: 1 instrument, 2 audio
    effect, 4 MIDI effect. ``_live_ptr`` is the stable identity the
    surface reads (``_safe_int_id``), unique per fake."""

    def __init__(self, class_name, params=(), type_=1, name=None):
        self.class_name = class_name
        self.name = name or class_name
        self.parameters = list(params)
        self.type = type_
        _next_ptr[0] += 1
        self._live_ptr = _next_ptr[0]
        self.canonical_parent = None
        self.name_listeners: list = []

    def add_name_listener(self, cb):
        self.name_listeners.append(cb)

    def remove_name_listener(self, cb):
        self.name_listeners.remove(cb)

    def rename(self, name):
        """A rename Live makes on its own: a similar-sample swap renames a
        Drum Sampler after its new sample and fires ``name`` (ADR-439)."""
        self.name = name
        for cb in list(self.name_listeners):
            cb()


class FakeMixerDevice:
    """``Chain.mixer_device``: only ``volume`` matters here — Live calls it
    "Chain Volume", 0..1 with 0.85 = 0 dB (measured on `Bright Room`,
    2026-09-08). It is the ``gain`` member on a nested-rack pad."""

    def __init__(self, volume=0.85):
        self.volume = FakeParam("Chain Volume", volume)


class FakeChain:
    """``DrumChain``: its devices, colour and mixer, and — since issue #491
    — the ``devices`` listener pair Live exposes on a chain. ``insert`` /
    ``remove`` mutate the list and fire it, as Live does; ``delete_device``
    is the LOM method the delete command calls."""

    def __init__(self, devices=(), color=None, volume=0.85, name=None):
        self.devices = list(devices)
        self.inserts: List = []
        # Live paints the pad with its chain's colour (RGB int); a fake
        # chain has none unless a test gives it one.
        self.color = color
        self.mixer_device = FakeMixerDevice(volume)
        self.name = name or "chain"
        self._devices_listeners: List = []
        for d in self.devices:
            d.canonical_parent = self

    def add_devices_listener(self, cb):
        self._devices_listeners.append(cb)

    def remove_devices_listener(self, cb):
        self._devices_listeners.remove(cb)

    def fire(self):
        for cb in list(self._devices_listeners):
            cb()

    def insert(self, index, device):
        device.canonical_parent = self
        self.devices.insert(index, device)
        self.fire()

    def delete_device(self, index):
        self.devices.pop(index)
        self.fire()

    def insert_device(self, name, index=None):
        """``Chain.insert_device`` (Live 12.3+): a stock device by display
        name, at ``index`` or the end, returned; fires ``devices``. Raises
        when the container's ``refuse_insert`` is set, as Live does for a
        name it does not know or an index it will not take."""
        device = _insert_named_device(self, name, index)
        self.fire()
        return device

    def listener_count(self):
        return len(self._devices_listeners)


# What ``insert_device`` creates for a display name: MIDI effects are type
# 4, everything else an audio effect. The class names are the measured ones.
_INSERTABLE = {
    "Delay": ("Delay", 2), "Auto Filter": ("AutoFilter2", 2), "Hybrid Reverb": ("Hybrid", 2),
    "Utility": ("StereoGain", 2), "Random": ("MidiRandom", 4), "Arpeggiator": ("MidiArpeggiator", 4),
}


class _RenameRefusingDevice(FakeDevice):
    """An inserted device whose ``name`` Live will not write — the rename
    raises, the way a LOM refusal does (``refuse_rename`` on the container)."""

    @property
    def name(self):
        return self.__dict__.get("name")

    @name.setter
    def name(self, value):
        raise RuntimeError("rename refused")


def _insert_named_device(container, name, index):
    if getattr(container, "refuse_insert", False):
        raise RuntimeError("insert refused")
    raises = getattr(container, "insert_raises", None)
    if raises is not None:
        raise raises
    if getattr(container, "insert_returns_none", False):
        # Live hands back the device it inserted; a container flagged so
        # answers with nothing and inserts nothing, the shape the loader
        # must read as "not inserted".
        container.inserts.append((name, index))
        return None
    class_name, type_ = _INSERTABLE.get(name, (name.replace(" ", ""), 2))
    device = FakeDevice(class_name, [], type_=type_, name=name)
    if getattr(container, "refuse_rename", False):
        device.__class__ = _RenameRefusingDevice
    device.canonical_parent = container
    at = len(container.devices) if index is None else index
    container.devices.insert(at, device)
    container.inserts.append((name, index))
    return device


class FakePad:
    def __init__(self, note, chains=(), name=None):
        self.note = note
        self.chains = list(chains)
        # Live: the chain's name on a populated pad, the note name on an
        # empty one ("E2" measured on the rig for pad 52).
        self.name = name if name is not None else ("Pad %d" % note if chains else "N%d" % note)


class FakeRackView:
    """``DrumGroupDevice.view``: ``selected_drum_pad`` (a pad object) with
    the ``add_/remove_selected_drum_pad_listener`` pair Live 12 exposes
    (verified on the rig 2026-09-08). Setting the pad fires the listeners,
    as Live does for our own writes too."""

    def __init__(self, pad=None):
        self._pad = pad
        self.listeners: List = []

    @property
    def selected_drum_pad(self):
        return self._pad

    @selected_drum_pad.setter
    def selected_drum_pad(self, pad):
        self._pad = pad
        for cb in list(self.listeners):
            cb()

    def add_selected_drum_pad_listener(self, cb):
        self.listeners.append(cb)

    def remove_selected_drum_pad_listener(self, cb):
        self.listeners.remove(cb)


class FakeRack:
    """``DrumGroupDevice``: macros as ``parameters`` (index 0 = Device On),
    ``macros_mapped``, 128 ``drum_pads`` and the three change listeners."""

    can_have_drum_pads = True

    def __init__(self, macros, macros_mapped, pads, class_name="DrumGroupDevice"):
        self.class_name = class_name
        self.name = " 606 + 808"
        self.type = 1
        _next_ptr[0] += 1
        self._live_ptr = _next_ptr[0]
        self.canonical_parent = None
        self.parameters = list(macros)
        self.macros_mapped = tuple(macros_mapped)
        self.drum_pads = list(pads)
        self._listeners: Dict[str, List] = {
            "drum_pads": [], "chains": [], "macros_mapped": [], "name": [],
        }
        self.view = FakeRackView(self.drum_pads[36] if len(self.drum_pads) > 36 else None)

    @property
    def has_macro_mappings(self):
        # Live's flag follows the per-macro table.
        return any(self.macros_mapped)

    # listener API, one add_/remove_ pair per observable list
    def add_drum_pads_listener(self, cb):
        self._listeners["drum_pads"].append(cb)

    def remove_drum_pads_listener(self, cb):
        self._listeners["drum_pads"].remove(cb)

    def add_chains_listener(self, cb):
        self._listeners["chains"].append(cb)

    def remove_chains_listener(self, cb):
        self._listeners["chains"].remove(cb)

    def add_macros_mapped_listener(self, cb):
        self._listeners["macros_mapped"].append(cb)

    def remove_macros_mapped_listener(self, cb):
        self._listeners["macros_mapped"].remove(cb)

    def add_name_listener(self, cb):
        self._listeners["name"].append(cb)

    def remove_name_listener(self, cb):
        self._listeners["name"].remove(cb)

    def load_kit(self, name, pads):
        """A preset loaded into this same rack device, as the rig measured it
        (2026-09-15): the pads' parameters are replaced but the rack object is
        not, ``drum_pads`` / ``chains`` stay silent, and the only observable
        change is the rack's ``name``."""
        self.drum_pads = list(pads)
        self.view = FakeRackView(self.drum_pads[36] if len(self.drum_pads) > 36 else None)
        self.name = name
        self.fire("name")

    def fire(self, name):
        for cb in list(self._listeners[name]):
            cb()

    def listener_count(self):
        return sum(len(v) for v in self._listeners.values())


# Measured DrumCell ranges (issue #489 Addendum 2 / M1 session): every
# continuous parameter 0..1, Transpose -48..48, FX On two-state, FX Type
# 0..8. ``enabled=False`` mimics a macro-held cell on a mapped kit.
FX1_MEMBERS = (
    "FX On", "Pitch Env Amt", "Sub Amt", "Noise Amt", "Loop Offset",
    "Stretch Factor", "Punch Amt", "8-Bit Rate", "FM Amt", "RM Amt",
)
FX2_MEMBERS = (
    "Pitch Env Decay", "Sub Freq", "Noise Color", "Loop Length", "Grain Size",
    "Punch Release", "8-Bit Flt Decay", "FM Freq", "RM Freq",
)


def drumcell(enabled=True, values: Optional[Dict[str, float]] = None, omit=()):
    values = values or {}
    v = values.get
    params = [
        FakeParam("Device On", 1.0, 0, 1, quantized=True),
        FakeParam("Transpose", v("Transpose", 0.0), -48.0, 48.0, enabled=enabled),
        FakeParam("Detune", 0.5),
        FakeParam("Filter On", 0.0, 0, 1, quantized=True, enabled=enabled),
        FakeParam("Filter Freq", v("Filter Freq", 1.0), enabled=enabled),
        FakeParam("Filter Res", v("Filter Res", 0.1), enabled=enabled),
        FakeParam("Attack", v("Attack", 0.669), enabled=enabled),
        FakeParam("Hold", 0.52),
        FakeParam("Decay", v("Decay", 1.0), enabled=enabled),
        FakeParam("Start", v("Start", 0.0), enabled=enabled),
        FakeParam("Length", 1.0, enabled=enabled),
        FakeParam("Volume", 0.33, enabled=enabled),
        FakeParam("Pan", 0.5),
        FakeParam("FX Type", v("FX Type", 0), 0, 8, quantized=True, enabled=enabled),
    ]
    for name in FX1_MEMBERS:
        if name == "FX On":
            params.append(FakeParam("FX On", v("FX On", 0.0), 0, 1, quantized=True, enabled=enabled))
        else:
            params.append(FakeParam(name, v(name, 0.0), enabled=enabled))
    for name in FX2_MEMBERS:
        params.append(FakeParam(name, v(name, 0.5), enabled=enabled))
    params = [p for p in params if p.name not in omit]
    return FakeDevice("DrumCell", params)


def simpler(enabled=True, transpose=0.0):
    """A pad Simpler, the parameters `Acuff Kit` lists (measured 2026-09-07)."""
    return FakeDevice("OriginalSimpler", [
        FakeParam("Device On", 1.0, 0, 1, quantized=True),
        FakeParam("Snap", 1.0, 0, 1, quantized=True),
        FakeParam("S Start", 0.0, enabled=enabled),
        FakeParam("S Length", 1.0, enabled=enabled),
        FakeParam("S Loop On", 0.0, 0, 1, quantized=True, enabled=enabled),
        FakeParam("S Loop Length", 1.0),
        FakeParam("S Loop Fade", 0.0, enabled=enabled),
        FakeParam("Spread", 0.0, 0.0, 100.0, enabled=enabled),
        FakeParam("Transpose", transpose, -48.0, 48.0, enabled=enabled),
        FakeParam("Volume", -2.8125, -36.0, 36.0, enabled=enabled),
        FakeParam("F On", 0.0, 0, 1, quantized=True, enabled=enabled),
        FakeParam("Filter Freq", 1.0, enabled=enabled),
        FakeParam("Filter Res", 0.1, 0.0, 1.25, enabled=enabled),
        FakeParam("Ve Attack", 0.0, enabled=enabled),
        FakeParam("Ve Decay", 0.6, enabled=enabled),
        FakeParam("Ve Sustain", 1.0, enabled=enabled),
        FakeParam("Ve Release", 0.5, enabled=enabled),
    ])


# Sampler section parameters as `50s Autumn Brushes` lists them with the
# section on (measured 2026-09-07): O Volume 0..1, O Coarse −2..48,
# Pe < Env −48..48, Pe Decay 0..1, Spread 0..100.
def sampler_osc_params(enabled=True):
    return [
        FakeParam("O Mode", 0.0, 0, 1, quantized=True),
        FakeParam("O Volume", 0.0, enabled=enabled),
        FakeParam("O Coarse", 1.0, -2.0, 48.0, enabled=enabled),
        FakeParam("O Fine", 0.0, 0.0, 1000.0),
    ]


def sampler_pe_params(enabled=True):
    return [
        FakeParam("Pe < Env", 0.0, -48.0, 48.0, enabled=enabled),
        FakeParam("Pe Attack", 0.31, enabled=enabled),
        FakeParam("Pe Decay", 0.72, enabled=enabled),
    ]


def sampler(enabled=True, transpose=0.0, osc_on=True, pe_on=True):
    """A pad Sampler. ``osc_on`` / ``pe_on`` False lists only that
    section's switch — the 43-parameter variant before the section was
    first enabled; a real Sampler lists everything."""
    params = [
        FakeParam("Device On", 1.0, 0, 1, quantized=True),
        FakeParam("Osc On", 1.0 if osc_on else 0.0, 0, 1, quantized=True, enabled=enabled),
    ]
    if osc_on:
        params += sampler_osc_params(enabled)
    params += [
        FakeParam("Spread", 0.0, 0.0, 100.0, enabled=enabled),
        FakeParam("Transpose", transpose, -48.0, 48.0, enabled=enabled),
        FakeParam("Pe On", 1.0 if pe_on else 0.0, 0, 1, quantized=True, enabled=enabled),
    ]
    if pe_on:
        params += sampler_pe_params(enabled)
    params += [
        FakeParam("Volume", 0.0, -36.0, 36.0),
        FakeParam("F On", 0.0, 0, 1, quantized=True),
        FakeParam("Filter Freq", 1.0),
        FakeParam("Filter Res", 0.1, 0.0, 1.25),
        FakeParam("Ve Attack", 0.0, enabled=enabled),
        FakeParam("Ve Decay", 0.6, enabled=enabled),
        FakeParam("Ve Sustain", 1.0, enabled=enabled),
        FakeParam("Ve Release", 0.5, enabled=enabled),
    ]
    return FakeDevice("MultiSampler", params)


class GrowingSwitch(FakeParam):
    """A section switch shaped like Live's (user's toggle test,
    2026-09-07): a section never enabled since the kit loaded lists only
    its switch; the first time it is switched on its parameters appear
    in the device's list and they STAY listed — switching it off again
    removes nothing and shifts no index."""

    def __init__(self, name, device, grow, enabled=True):
        super().__init__(name, 0.0, 0, 1, quantized=True, enabled=enabled)
        self._device = device
        self._grow = grow
        self._grown: List[FakeParam] = []

    @FakeParam.value.setter
    def value(self, v):
        FakeParam.value.fset(self, v)
        if v >= 1.0 and not self._grown:
            self._grown = self._grow()
            i = self._device.parameters.index(self) + 1
            self._device.parameters[i:i] = self._grown


def growing_sampler():
    """A Sampler with Osc and Pe off whose sections appear when switched on."""
    dev = sampler(osc_on=False, pe_on=False)
    for i, p in enumerate(dev.parameters):
        if p.name == "Osc On":
            dev.parameters[i] = GrowingSwitch("Osc On", dev, sampler_osc_params)
        elif p.name == "Pe On":
            dev.parameters[i] = GrowingSwitch("Pe On", dev, sampler_pe_params)
    return dev


def eq8():
    return FakeDevice("Eq8", [FakeParam("Device On", 1.0)], type_=2)


def pad(note, *devices):
    return FakePad(note, [FakeChain(devices)] if devices else [])


FAMILY_MACRO_NAMES = [
    "Device On", "FX1", "FX2", "Macro 3", "Macro 4", "Kick", "Snare", "Hihat",
    "Perc", "Macro 9", "Macro 10", "Macro 11", "Macro 12", "Macro 13",
    "Macro 14", "Macro 15", "Macro 16",
]
# The kit's shipped macro values (rig read 2026-09-07).
FAMILY_MACRO_VALUES = [1.0, 0.0, 63.5, 0.0, 63.5, 107.95, 107.95, 107.95, 107.95,
                       85.0, 127.0, 0.0, 127.0, 0.0, 20.0, 0.0, 42.0]


def family_macros(values: Optional[Dict[int, float]] = None, names=None):
    names = names or FAMILY_MACRO_NAMES
    out = []
    for i, name in enumerate(names):
        val = FAMILY_MACRO_VALUES[i] if i < len(FAMILY_MACRO_VALUES) else 0.0
        if values and i in values:
            val = values[i]
        if i == 0:
            out.append(FakeParam(name, val, 0, 1, quantized=True))
        else:
            out.append(FakeParam(name, val, 0.0, 127.0))
    return out


def make_rack(pads: Sequence[FakePad], mapped=False, macros=None, mapped_indices=None):
    """A 128-pad rack. ``mapped=True`` maps all 16 macros; ``mapped_indices``
    maps only those 1-based macro numbers."""
    all_pads = [FakePad(n) for n in range(128)]
    for p in pads:
        all_pads[p.note] = p
    if mapped_indices is not None:
        flags = [i + 1 in mapped_indices for i in range(16)]
    else:
        flags = [mapped] * 16
    return FakeRack(macros or family_macros(), flags, all_pads)


def cells(rack: FakeRack) -> List[FakeDevice]:
    return [p.chains[0].devices[0] for p in rack.drum_pads if p.chains]


def param(dev: FakeDevice, name: str) -> FakeParam:
    return next(p for p in dev.parameters if p.name == name)


def macro(rack: FakeRack, idx: int) -> FakeParam:
    return rack.parameters[idx]





def unmapped_kit(n=3):
    return make_rack([pad(36 + i, drumcell()) for i in range(n)], mapped=False)


def mapped_kit(n=3):
    return make_rack([pad(36 + i, drumcell(enabled=False)) for i in range(n)], mapped=True)



class FakeTrack:
    """A track holding devices, for the pad-path tests: ``devices`` is a
    live list, ``delete_device`` the LOM method."""

    def __init__(self, devices=(), name="Track"):
        self.devices = list(devices)
        self.name = name
        self.inserts: List = []
        self.view = FakeTrackView()
        for d in self.devices:
            d.canonical_parent = self

    def delete_device(self, index):
        self.devices.pop(index)

    def insert_device(self, name, index=None):
        """``Track.insert_device`` (Live 12.3+); see ``FakeChain``'s."""
        return _insert_named_device(self, name, index)


class FakeTrackView:
    """``track.view`` — its ``device_insert_mode`` as Live 12.4.15b2 reports
    it (ADR-437): the property reads ``True`` in Live's default mode (a
    browser load goes to the track after the top-level device holding the
    selection) and ``False`` after 1 or 2 is written (the load lands beside
    the selected device inside its chain). ``modes`` records every write."""

    def __init__(self):
        self._mode = 0
        self.modes: List[int] = []

    @property
    def device_insert_mode(self):
        return self._mode == 0

    @device_insert_mode.setter
    def device_insert_mode(self, value):
        if not isinstance(value, int):
            raise TypeError("Python argument types did not match C++ signature: (View, int)")
        self._mode = int(value)
        self.modes.append(int(value))

    @property
    def lands_in_chain(self):
        return self._mode != 0


class FakeSongView:
    """``song.view``: the selected track and ``select_device``, recorded."""

    def __init__(self):
        self.selected_track = None
        self.selected_devices: List = []

    def select_device(self, device):
        self.selected_devices.append(device)


class FakeSong:
    """Undo bookkeeping (the virtual-macro tests), plus — since issue #491
    — ``tracks`` / ``master_track`` / ``view`` and a ``move_device`` that
    really moves a device between a track and a chain."""

    def __init__(self, raise_on=(), tracks=(), master=None):
        self.begins = 0
        self.ends = 0
        self.raise_on = set(raise_on)
        self.tracks = list(tracks)
        self.master_track = master if master is not None else FakeTrack(name="Master")
        self.view = FakeSongView()
        self.moves: List = []

    def move_device(self, device, parent, index):
        """``Song.move_device`` with Live's one placement rule the surface
        leans on: **a MIDI effect cannot sit behind an instrument or an
        audio effect** (ADR-430, measured 2026-09-11). Before this the fake
        clamped any index and refused nothing, so a loader that computed
        the wrong index for a MIDI effect still "moved" it and the tests
        passed (code review, 2026-09-12). Raises before touching either
        list, as Live's refusal leaves the set unchanged."""
        if "move" in self.raise_on:
            raise RuntimeError("no move")
        source = device.canonical_parent
        if getattr(device, "type", None) == 4:
            ahead = [d for d in parent.devices if d is not device][: max(0, index)]
            if any(getattr(d, "type", None) != 4 for d in ahead):
                raise RuntimeError("Live refuses a MIDI effect behind an instrument or audio effect")
        if source is not None:
            source.devices.remove(device)
            if isinstance(source, FakeChain):
                source.fire()
        parent.devices.insert(min(index, len(parent.devices)), device)
        device.canonical_parent = parent
        if isinstance(parent, FakeChain):
            parent.fire()
        self.moves.append((device, parent, index))

    def begin_undo_step(self):
        if "begin" in self.raise_on:
            raise RuntimeError("no begin")
        self.begins += 1

    def end_undo_step(self):
        if "end" in self.raise_on:
            raise RuntimeError("no end")
        self.ends += 1
