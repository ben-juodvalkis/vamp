"""DrumVirtualMacroComponent — surface-owned whole-kit gestures on a Drum Rack.

Issue #489 Milestone 1, ADR-428. The Drum Rack central view's seven
controls (FX XY, FX type, Time XY, Start, Trnsp) used to write the
rack's macros 1, 2, 3, 4, 9, 10 and 11 by index, and Live's macro
mapping fanned each one out to the same parameter on every DrumCell.
Drum-rack kits are on their way to carrying **no** macro mappings at
all, so the fan-out has to live somewhere else. It lives here.

A *virtual macro* is a musical function — ``pitch``, ``fx1``, ``fx2``,
``fxType``, ``attack``, ``decay``, ``start``, and since the Sampler-kit
row ``release``, ``sustain``, ``oscAmount``, ``oscCoarse``,
``pitchEnvAmount``, ``pitchEnvAttack``, ``spread``, plus ``gain``
(2026-09-08) — with a binding per pad instrument **class**, keyed by
parameter **name** (never index). ``gain`` is the one with a member
that is not a device parameter at all: on a kit of nested Instrument
Racks it is the pad's own chain volume (see its table entry). The
UI reads and writes them as device properties ``vm.<function>`` on the
``DrumGroupDevice`` over the ordinary property channel
(``PropertyComponent``, wire-protocol §2.6); this component is the
``computed`` provider behind those allowlist rows.

What the design rests on (all measured on Live 12.4.15b1, issue #489
Addendum 2 and the M1 session):

- Every continuous DrumCell parameter reads and writes in normalized
  ``0..1``; ``Transpose`` is ``-48..48`` semitones; enums are ints.
  Live's macro interpolates **linearly in that LOM value space**, so a
  fan-out of ``value = min + t·(max−min)`` through each member's own
  LOM ``min``/``max`` reproduces the macro exactly. No curve table.
- A macro-held parameter reads ``is_enabled == False`` and a write to it
  raises ``RuntimeError: Value cannot be set, the parameter is disabled``.
  ``RackDevice.macros_mapped`` (16 bools, observable) says which macros
  hold anything.
- A two-state switch under a macro (``FX On`` under FX1) turns on when
  the macro is **above 1.0** of 127 (1.0 → off, 1.2 → on). The
  ``min + t·(max−min)`` rule would put the switch at half travel; the
  measured threshold is what a fan-out has to reproduce.
- Live records **one undo step per parameter write**: a plain 12-cell
  fan-out in one handler leaves twelve steps and ``song.undo`` puts back
  one cell (M1 session; this corrects the Phase 0 note that one
  handler's writes coalesce). ``begin_undo_step`` / ``end_undo_step``
  around the writes make them one step ("Undo Custom Action"), and two
  consecutive groups stay two steps. Consecutive writes to the *same*
  parameter (a macro under a drag) do merge on their own.
- Macro 4 at 80 moves every cell's Transpose to exactly 12.0 — Live
  quantizes the pitch fan-out to whole semitones. Pitch is therefore
  held and written as an integer on both paths.

Transitional rule
-----------------
While a kit is still mapped, the function's *legacy* macro (the index
the view used to write) is written instead — in macro units — so the
view works before and after the library's batch-unmap. The rule is
gated on the rack being the pipeline family (macros 1 and 2 named
``FX1`` / ``FX2``): those indices only *mean* these functions on that
family, and writing "macro 1" on, say, ``32 Pad Kit Jazz`` (whose macro
1 is Transpose) would move the wrong thing. On any other rack the
fan-out runs and macro-held members are skipped.

Membership census (Milestone 1b)
--------------------------------
``vm.members`` is a read-only computed row beside the fixed functions:
a small JSON object describing the rack — how many pads carry an
instrument, a histogram of their classes, whether Live holds any macro
mapping, the pipeline-family fingerprint, and per function how many
member parameters were resolved and how many of them are **held**
(``is_enabled == False``, i.e. driven by a Live macro). The UI uses it
to route plugin-hosted kits (Komplete Kontrol) to the macro grid, to
dim a function the kit has no member for (FX on a Simpler kit, Start
on a Sampler kit) and to show a function every member of which is
macro-held as read-only. It is cold-read on subscribe and re-emitted
with the functions whenever the rack re-seeds.

Rack macros (2026-09-07)
------------------------
A kit whose pads hold nested **Instrument Racks** (an Ableton-pack kit
such as ``Ethnic Drums``: every pad an ``InstrumentGroupDevice`` around
two Sampler chains) has no member for any of the fixed functions — the
parameters the functions bind sit inside the racks, macro-held. What
such a kit *does* carry, on every pad, is a rack with named macros
(``Attack, Release, Transpose, Osc, Pitch Attack, Pitch Amount, Room``
on the rig), and the Drum Rack's own top-level macros on that kit are
named but unmapped, so writing them would move nothing. So the census
lists the pad racks' macro names (``macros``, in the first pad's macro
order, default ``Macro N`` names dropped) and each name is a function of
its own, ``vm.macro.<name>`` — kind ``t``, one member per pad rack with
a macro of that name, written through the macro's own ``0..127`` range,
so the rack fans it on to both chains itself. It rides the same seed,
apply, coalesce, undo and re-seed paths as the fixed ones; a macro
``is_enabled == False`` (mapped from the Drum Rack's macro) is held the
same way. There is no legacy macro for these: a rack macro is never
written on their behalf. The functions exist per rack state — a name
the kit does not carry reads ``nil`` and a write to it stores, echoes
and moves nothing, exactly like a member-less function.

**Pitch binds through the pad rack's transpose macro.** The parameters
``pitch`` binds sit inside the racks, macro-held, so on such a kit the
function would have no member and the Trnsp slider, the ±12 buttons and
the sequencer's octave (``set_sequencer_shift``) would all be silent —
the rig read "sequencer shift 12 skipped: rack has no pitch value yet"
on ``Ethnic Drums``. A pad rack macro named like a transpose
(``PITCH_MACRO_NAMES``: Transpose, Pitch, Tune, Trnsp — exact,
case-insensitive; never "Pitch Attack") is therefore a ``pitch`` member
under the project convention (user, 2026-09-07): **a pitch macro maps
its Transpose over the full −48..48**, ``macro = (st + 48) / 96 × 127``,
which the kit's own file confirms (``MidiControllerRange`` −48..48 on
the Sampler's ``TransposeKey`` under a ``KeyMidi`` on macro 3). Such a
member reads and writes in semitones through ``_member_read`` /
``_member_write`` and takes part in the per-pad offsets, the kit-move
reconcile and the shift like any Transpose; the macro's own value is
what is read back (synchronous — Live's fan-out to the Samplers lands a
moment later, but nothing here reads the Samplers). The census names
the macro as ``pitchMacro`` so the view shows Trnsp in that macro's
place rather than a second, unit-less slider for the same knob.

Value model
-----------
The property value is the surface-held number for that ``(device,
function)``: ``t ∈ 0..1`` for the continuous functions, an int
``0..8`` for ``fxType``, whole semitones ``-48..48`` for ``pitch``. It
is seeded on first use from the members (or the legacy macro when
mapped), re-seeded when the rack's ``drum_pads`` / ``chains`` /
``macros_mapped`` change, and dropped when the device at that path is
replaced. The model leaves room for per-pad offsets
(``pitch = global + offsets[note]``); Milestone 1 ships them empty.

Per-pad offsets, seeded from the kit (2026-09-07)
--------------------------------------------------
A kit's pads rarely share one Transpose — a snare tuned +3 is the norm,
not the exception — and a fan-out that writes ``global`` to every pad
flattens that on the first slider move or pitch step. So each pad
carries a ``_PadPitch`` record: when a rack is seeded, its ``offset`` is
the pad's own Transpose relative to the first member (whose value is
the global the UI shows), and **every pitch fan-out reads each member
back first** (``_reconcile_pitch``) and sorts what changed since our
last write:

- **A uniform delta is a kit move, not 24 hand edits.** When at least
  two pads share the same nonzero delta and it is the most common delta
  across the pads read (an unchanged pad votes 0), that shared value is
  the kit's move — Live's Edit → Undo of our own gesture or step, a
  macro, a hand move of every pad. It is subtracted from every pad's
  delta before the remainder is folded into that pad's offset. On the
  **write path** (``property/set`` → :meth:`flush`) the incoming value
  is an absolute user intent and wins: the kit move is discarded (logged
  at debug) and every pad is written ``value + shift + offset``. On the
  **sequencer path** (:meth:`set_sequencer_shift`) there is no new user
  value, so the kit move is adopted into the held global and
  ``vm.pitch`` is re-emitted to its subscribers, so a slider on screen
  follows Live's undo — except when the move is exactly the shift
  change this apply would make (Cmd-Z on a held step): the kit is
  already where the step-off lands, and nothing is adopted. Residuals:
  a single-member kit cannot tell a kit move from an edit and keeps the
  per-pad rule; a pad at the ±48 rail cannot vote and, under a kit
  move, keeps its offset; two pads hand-tuned by the same amount on a
  three-pad kit read as a kit move.
- **What remains per pad is the user's edit** — in Live's pad view, by
  MIDI — and moves that pad's offset (the read-before-write rule of
  permute ADR-019, per pad), so the edit survives our write.
- **A read equal to the pre-write value is our own write still landing
  only for ``STALE_READ_WINDOW_MS`` after the write** (measured on the
  rig 2026-09-07: under a busy control thread a DrumCell reads one
  write behind for a pass; folding that in walked every pad away by
  the shift on each step). The window is measured on the component's
  ``_clock`` and covers the fastest step (a 1/16 at 180 BPM is 83 ms
  apart); past it the same read is an edit — a hand tune back to the
  old value, or Live's undo of our step. ``prev`` is cleared once a
  read matches the write or is judged an edit.

The slider and the sequencer shift then move every pad by the same
amount and the kit keeps its tuning. ``vm.pitch`` still reads the
global; the offsets have no UI yet (that milestone is separate) — they
are what keeps the kit honest until it has one. A member first seen at
apply time (a pad added after seeding) adopts its current value as
``global + shift + offset``, i.e. it keeps its pitch until the next
move.

Sequencer shift term (permute ADR-020)
--------------------------------------
Pitch is additive: ``pitch = clamp(global + offsets[note] + shift)``
per member, where ``shift`` (0 or 12) is what the surface's
``SequencerComponent`` holds while a Permute pitch step is on. It rides
the same fan-out (or the legacy macro on a still-mapped family kit) and
the same undo path as ``vm.pitch``; it is set through
:meth:`set_sequencer_shift` and never seen by the UI — ``vm.pitch``
reads keep reporting the global, and a re-seed while shifted subtracts
the shift so the global stays the global. **A shift is committed only
after a fan-out carrying it wrote at least one member (or the legacy
macro).** A rack with no pitch value yet — a kit whose chains are still
populating — writes nothing and holds nothing, so a step that fires
then is skipped, not deferred, and a later step-off has nothing to put
back. Transport stop, the engine toggle going off and a surface reload
all zero it. A rack whose shift is non-zero is never released on
unsubscribe: the engine still owns a write on it.

State follows the rack, not its path
------------------------------------
Paths embed positions (ADR-350): deleting a track above a kit moves the
kit from ``tracks/6/devices/0`` to ``tracks/5/devices/0`` with nothing
in the LOM firing for the rack itself. :meth:`rebind` re-keys a held
state under the rack's new path — the offsets, the shift, the listeners
and any pending apply come along — and is called by
``SequencerComponent._resolve_route`` on every structural rescan and by
``_state_for`` before it would build a fresh state for a rack it
already holds. Identity is ``same_lom_handle``, never ``is``. Whatever
state sat at the new path belongs to a rack that is no longer there
(deleted, or moved and not yet rebound) and is parked rather than
released, so a shift held on it can still be found by handle. All of
this is bookkeeping, legal inside a notification; the change listeners
and the deferred re-seed resolve the state object, not a path, so a
move between a fire and the 150 ms re-seed lands on the right path.

Write path
----------
``property/set`` → :meth:`write` stores the value, echoes it (nothing in
the LOM fires for a virtual value, so the echo is ours) and queues the
apply. The transport runs :meth:`flush` at the end of each drain pass,
so a backlog of sets for one ``(device, function)`` collapses to **one**
fan-out per pass — the latest value — instead of N. That is what keeps
an XY drag from lagging when the surface falls behind. With no drain
hook wired (unit tests) the apply runs inline.

Undo
----
A gesture is many passes, and Live would record every cell of every
pass as its own undo step. The first apply of a gesture therefore opens
an undo step (``song.begin_undo_step``) and the step is closed
(``end_undo_step``) once ``GESTURE_UNDO_IDLE_MS`` pass with no apply —
so a drag, however long, is one Edit → Undo, and a pause longer than the
idle window starts a second one. Anything else that changes the Set
inside that window rides in the same step; it is the price of not
having a gesture-end message on the wire. The step is closed on
disconnect, and inline (per flush) when no scheduler is wired.

Writes happen in the OSC handler / drain hook, never inside a LOM
listener callback (repo rule). The listeners here only mark state dirty
and schedule a deferred re-seed + re-emit.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Callable, Dict, List, Optional, Set, Tuple

from .DrumPadChainComponent import PadChainWatcher
from .path_resolver import PAD_NOTE_MAX, find_drum_pad, same_lom_handle

logger = logging.getLogger("looping")

# The vocabulary, the records and the LOM walk live in their own modules
# since 2026-09-10 (issue #491 E0); see ``__all__`` below for what this
# module still re-exports.
from .drum_vm_functions import (
    _LOM_ERRORS,
    BOUND_CLASSES,
    CENSUS_BYTES_SOFT_CAP,
    CHAIN_VOLUME_NAME,
    DEV_EPSILON,
    DEV_VOTE_DP,
    EDIT_ABSORB_DELAY_MS,
    FUNCTIONS,
    FX_TYPE_MAX,
    GESTURE_UNDO_IDLE_MS,
    INSTRUMENT_RACK_CLASS_NAME,
    KIND_ENUM,
    KIND_SEMITONES,
    KIND_T,
    MACRO_FUNCTION_PREFIX,
    MACRO_PROPERTY_PREFIX,
    MACRO_SLOTS,
    MAX_MEMBER_LISTENERS,
    MEMBERS_KEY,
    MEMBERS_PROPERTY,
    PAD_NAME_MAX,
    PAD_PROPERTY_PREFIX,
    PITCH_MACRO_NAMES,
    PITCH_MAX,
    PITCH_MIN,
    PROPERTY_NAMES,
    PROPERTY_PREFIX,
    PROVIDER_NAME,
    RACK_NON_MACRO_PARAMS,
    RESEED_DELAY_MS,
    SELECTED_PAD_KEY,
    SELECTED_PAD_PROPERTY,
    STALE_READ_WINDOW_MS,
    TOGGLE_ON_ABOVE_T,
    V3_PROPERTY_VALUE_ADDRESS,
    VirtualMacro,
    _clamp,
    _float_or_none,
    function_for_property,
    is_empty_macro_name,
    is_macro_function,
    is_pad_property,
    is_pitch_macro_name,
    macro_function,
    parse_pad_function,
)
from .drum_vm_resolve import (
    SAMPLE_PAD_DEFAULT_NAMES,
    first_instrument,
    index_params,
    is_pipeline_family,
    make_member,
    pad_chain_volume,
    pad_color,
    pad_devices,
    pad_label,
    pad_name,
)
from .drum_vm_state import (
    _Member,
    _MemberEdit,
    _PadPitch,
    _RackState,
)

# The vocabulary, the records and the LOM walk live in their own modules
# since 2026-09-10 (issue #491 E0). ``__all__`` is the facade other code
# still reaches through this module — ``LoopingSurface`` and the tests;
# ``PropertyComponent`` imports from ``drum_vm_functions`` directly. A
# name nothing outside imports and the component itself does not use is
# not re-exported (code review, 2026-09-12: 64 names, 33 dead).
__all__ = [
    "BOUND_CLASSES",
    "CENSUS_BYTES_SOFT_CAP",
    "EDIT_ABSORB_DELAY_MS",
    "FUNCTIONS",
    "FX_TYPE_MAX",
    "INSTRUMENT_RACK_CLASS_NAME",
    "MACRO_FUNCTION_PREFIX",
    "MACRO_PROPERTY_PREFIX",
    "MEMBERS_KEY",
    "MEMBERS_PROPERTY",
    "PAD_NAME_MAX",
    "PAD_PROPERTY_PREFIX",
    "PITCH_MACRO_NAMES",
    "PITCH_MAX",
    "PITCH_MIN",
    "PROPERTY_NAMES",
    "PROPERTY_PREFIX",
    "PROVIDER_NAME",
    "RESEED_DELAY_MS",
    "SELECTED_PAD_KEY",
    "SELECTED_PAD_PROPERTY",
    "STALE_READ_WINDOW_MS",
    "TOGGLE_ON_ABOVE_T",
    "DrumVirtualMacroComponent",
    "function_for_property",
    "is_empty_macro_name",
    "is_macro_function",
    "is_pad_property",
    "is_pitch_macro_name",
    "macro_function",
    "parse_pad_function",
]

# --- component ------------------------------------------------------------


def _holds_pad_shift(st: _RackState) -> bool:
    """Whether a Permute in some pad's chain still holds its term on this
    rack (ADR-435) — the state must outlive the UI's subscriptions then,
    exactly as it does for the rack-wide shift."""
    return any(p.shift for p in st.pads.values())


class DrumVirtualMacroComponent:
    """Computed-property provider for ``DrumGroupDevice`` ``vm.*`` rows.

    Args:
        emit: ``(address, args)`` — ``OSCTransport.send``. Used for the
            re-seed emits after a rack's content changes; the set echo is
            emitted by PropertyComponent from the value :meth:`write`
            returns.
        schedule_delayed: ``(delay_ms, fn)`` adapter for the deferred
            re-seed and the gesture undo-step close. ``None`` in unit
            tests → re-seed runs inline and the undo step closes at the
            end of every flush.
        song: the Live ``Song``, for ``begin_undo_step`` /
            ``end_undo_step``. ``None`` disables undo grouping (tests
            that don't care).

    Lifecycle: ``LoopingSurface`` constructs it, registers :meth:`flush`
    as the UDP transport's drain hook and then calls
    :meth:`enable_deferred_apply`; passes it to ``PropertyComponent`` as
    the ``drum_vm`` provider; calls :meth:`disconnect` on teardown.
    """

    def __init__(
        self,
        emit: Callable[[str, tuple], None],
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        song=None,
    ) -> None:
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        self._song = song
        # Gesture undo step: open from the first apply until the idle
        # window passes with nothing to apply. ``_clock`` is injectable
        # so the idle arithmetic is testable without sleeping.
        self._undo_open = False
        self._undo_deadline = 0.0
        self._undo_close_scheduled = False
        self._clock = time.monotonic
        self._states: Dict[str, _RackState] = {}
        # (device_path, function) → (device, coerced value). Latest wins.
        self._pending: Dict[Tuple[str, str], Tuple[object, object]] = {}
        self._defer_applies = False
        # True while a fan-out is writing members: the members' own value
        # listeners fire for our writes too, and this is the fast way to
        # ignore them when Live dispatches synchronously. The ``written``
        # baseline in :meth:`_absorb_edits` is the correct way, for when
        # it does not.
        self._fanning_out = False
        self._disconnected = False
        self._warned: Set[Tuple[str, str]] = set()
        logger.info(
            "DrumVirtualMacroComponent: ready (%d functions: %s; rack macros=%s<name>; "
            "census=%s; provider=%s)",
            len(FUNCTIONS), ", ".join(FUNCTIONS), MACRO_PROPERTY_PREFIX,
            MEMBERS_PROPERTY, PROVIDER_NAME,
        )

    # --- wiring -----------------------------------------------------------

    def enable_deferred_apply(self) -> None:
        """Queue applies for :meth:`flush` instead of running them inline.
        Call only after :meth:`flush` is registered as a drain hook —
        otherwise writes would never land."""
        self._defer_applies = True

    # --- provider API (called by PropertyComponent) -----------------------

    def subscribe(self, device, device_path: str, function: str) -> None:
        """A UI consumer opened ``vm.<function>`` (or ``vm.members``) on
        ``device_path``. Builds (or refreshes) the rack state so the
        cold-read has a value."""
        if self._disconnected or not self._known(function):
            return
        st = self._state_for(device, device_path)
        st.subscribed.add(function)

    def unsubscribe(self, device_path: str, function: str) -> None:
        """Last consumer of a function left. When no function on the path
        is subscribed any more the state is released (listeners detached);
        the next subscribe rebuilds it from the members."""
        st = self._states.get(device_path)
        if st is None:
            return
        st.subscribed.discard(function)
        if not st.subscribed and not st.shift and not _holds_pad_shift(st):
            self.release(device_path)

    def release(self, device_path: str) -> None:
        """Drop the state for ``device_path`` (device replaced / gone)."""
        st = self._states.pop(device_path, None)
        if st is None:
            return
        self._detach_listeners(st)
        self._detach_member_listeners(st)
        self._detach_name_listeners(st)
        for key in [k for k in self._pending if k[0] == device_path]:
            self._pending.pop(key, None)

    def read(self, device, device_path: str, function: str):
        """Current held value for the function, seeding on first use.
        ``None`` when the rack has no member for it (and no mapped legacy
        macro) — the UI's ``?? default`` shows the control at rest.
        ``vm.members`` reads the census JSON string."""
        if self._disconnected or not self._known(function):
            return None
        st = self._state_for(device, device_path)
        if function == MEMBERS_KEY:
            if not st.pad_count:
                # Same race as below: the rack may still be populating.
                self._resolve(st)
                self._seed(st, only_missing=True)
            return self.members_json(st)
        if function == SELECTED_PAD_KEY:
            return self._selected_pad_note(st)
        parsed = parse_pad_function(function)
        if parsed is not None:
            value = self._pad_read(st, parsed[0], parsed[1])
            if value is None and not st.member_pads:
                self._resolve(st)
                self._seed(st, only_missing=True)
                value = self._pad_read(st, parsed[0], parsed[1])
            return value
        value = st.values.get(function)
        if value is None and not st.member_pads:
            # Subscribe may have raced the kit load (chains populate after
            # the device add). One re-resolve per read is cheap at
            # subscribe rate and bounded by the UI's refcount.
            self._resolve(st)
            self._seed(st, only_missing=True)
            value = st.values.get(function)
        return value

    def write(self, device, device_path: str, function: str, value):
        """``property/set`` for ``vm.<function>``. Returns
        ``(ok, stored_value, detail)``. The stored value is what the
        echo carries: clamped, and an int for ``fxType`` / ``pitch``."""
        if self._disconnected:
            return False, None, "disconnected"
        if function == MEMBERS_KEY:
            return False, None, "%s is read-only" % MEMBERS_PROPERTY
        if not self._known(function):
            return False, None, "unknown virtual macro %r" % function
        st = self._state_for(device, device_path)
        if function == SELECTED_PAD_KEY:
            # Not a gesture: one write, now, from handler context.
            return self._select_pad(st, value)
        parsed = parse_pad_function(function)
        if parsed is not None:
            # One pad's absolute value. Stored as that pad's deviation at
            # apply time; the kit value is not touched, so the echo is the
            # pad row alone.
            fn = self._function(st, parsed[1])
            if fn is None:
                return False, None, "unknown virtual macro %r" % parsed[1]
            coerced = self._coerce(fn, value)
            if coerced is None:
                return False, None, "bad value for %s: %r" % (function, value)
            self._pending[(device_path, function)] = (device, coerced)
            if not self._defer_applies:
                self.flush()
            return True, coerced, ""
        fn = self._function(st, function)
        if fn is None:
            return False, None, "unknown virtual macro %r" % function
        coerced = self._coerce(fn, value)
        if coerced is None:
            return False, None, "bad value for %s: %r" % (function, value)
        st.values[function] = coerced
        self._pending[(device_path, function)] = (device, coerced)
        if not self._defer_applies:
            self.flush()
        return True, coerced, ""

    def debug_state(self, device_path: str) -> Optional[Dict[str, object]]:
        """Read-only snapshot for ``/looping/probe/sequencer_stats``: the held
        values, the pitch offsets, the shift term and the per-pad
        write baselines. ``None`` for an unknown rack."""
        st = self._states.get(device_path)
        if st is None:
            return None
        return {
            "values": dict(st.values),
            "shift": st.shift,
            "family": st.family,
            "mapped": st.has_macro_mappings,
            "members": {k: len(v) for k, v in st.members.items()},
            "offsets": {str(n): p.offset for n, p in st.pads.items() if p.offset},
            # ADR-435: the term a Permute inside the pad's own chain holds.
            "padShifts": {str(n): p.shift for n, p in st.pads.items() if p.shift},
            "written": {str(n): p.written for n, p in st.pads.items() if p.written is not None},
            "prev": {str(n): p.prev for n, p in st.pads.items() if p.prev is not None},
            # Per-pad deviations for the continuous functions: the pitch
            # ``offsets`` above, generalised. Only the nonzero ones.
            "deviations": {
                name: {
                    "%d:%s" % (note, pname): round(rec.dev, 4)
                    for (note, pname), rec in recs.items()
                    if abs(rec.dev) > DEV_EPSILON
                }
                for name, recs in st.edits.items()
                if any(abs(r.dev) > DEV_EPSILON for r in recs.values())
            },
            "watching": len(st.member_listeners),
        }

    def sequencer_shift(self, device_path: str) -> int:
        """The pitch shift term currently held for ``device_path`` (0 or
        the semitones the sequencer asked for); 0 for an unknown rack."""
        st = self._states.get(device_path)
        return int(st.shift) if st is not None else 0

    def set_sequencer_shift(self, device, device_path: str, shift) -> bool:
        """permute ADR-020: hold ``shift`` semitones on top of ``vm.pitch``
        for the rack at ``device_path`` and fan it out now.

        Called by ``SequencerComponent`` from its tick (a Timer context —
        writes are legal there), so the apply runs inline, inside its own
        undo step when no gesture step is already open. Returns ``True``
        when a fan-out ran and the term is now held, ``False`` when
        nothing changed, nothing could be written or the component is
        down. The term is committed only after the fan-out wrote at least
        one member (or the legacy macro): a rack with no pitch value yet
        (chains still populating) or with every member held writes
        nothing and holds nothing — that step is skipped, not deferred,
        so a later step-off cannot land an octave below where the kit
        loaded. ``vm.pitch`` reads are unaffected: the UI never sees the
        term — except that a kit move found on this path (Live's undo of
        a gesture) is adopted into the global and re-emitted.

        The rack is found by LOM handle, so a rack whose path moved since
        the last call (a track above it deleted) is re-keyed first. A
        restore (``shift == 0``) for a rack this component holds nothing
        on — its track is gone — is a no-op: nothing was applied, nothing
        is put back, and whatever rack now lives at ``device_path`` is
        left alone.
        """
        if self._disconnected:
            return False
        try:
            target = int(round(float(shift)))
        except (TypeError, ValueError):
            return False
        st = self._find_state(device)
        if st is None:
            if target == 0:
                logger.debug(
                    "DrumVirtualMacroComponent: %s shift restore for a rack not held; nothing to put back",
                    device_path,
                )
                return False
            st = self._state_for(device, device_path)
        else:
            if st.device_path != device_path and device_path not in self._states:
                # The rack moved and the rescan has not re-keyed it yet.
                # With the new path free, follow it; with another rack's
                # state there (a live rack this restore must not displace,
                # or a dead one), work on the state where it is.
                self.rebind(device, device_path)
            if st.dirty:
                self._resolve(st)
                self._seed(st, only_missing=True)
        if st.shift == target:
            return False
        fn = FUNCTIONS["pitch"]
        value = st.values.get("pitch")
        if value is None:
            # The rack has no pitch member yet (chains still populating)
            # or seeding failed: nothing to write, so nothing is held.
            self._warn_once(
                st.device_path, "shift:nopitch",
                "sequencer shift %d skipped: rack has no pitch value yet" % target,
            )
            return False
        opened = False
        if not self._undo_open:
            self._open_undo_step()
            opened = self._undo_open
        try:
            wrote = self._apply(st, fn, value, shift=target, adopt_kit_move=True)
        except Exception as e:  # never let a rack fault reach the Timer
            self._warn_once(
                st.device_path, "apply:shift", "sequencer shift apply raised: %s: %s" % (type(e).__name__, e),
            )
            return False
        finally:
            if opened:
                self._close_undo_step()
        if not wrote:
            self._warn_once(
                st.device_path, "shift:nowrite",
                "sequencer shift %d skipped: no pitch member could be written" % target,
            )
            return False
        st.shift = target
        logger.debug("DrumVirtualMacroComponent: %s sequencer shift -> %d", st.device_path, target)
        return True

    def pad_sequencer_shift(self, device_path: str, note) -> int:
        """The shift term held on one pad by a Permute in its own chain
        (ADR-435); 0 for an unknown rack or pad."""
        st = self._states.get(device_path)
        if st is None:
            return 0
        try:
            rec = st.pads.get(int(note))
        except (TypeError, ValueError):
            return 0
        return int(rec.shift) if rec is not None else 0

    def set_pad_sequencer_shift(self, device, device_path: str, note, shift) -> bool:
        """ADR-435 (2026-09-14): hold ``shift`` semitones on ONE pad of the
        rack at ``device_path`` — the term a Permute inside that pad's
        chain asks for — and write the pad now.

        The pad's Transpose becomes ``global + offset + kit shift + this``,
        so a track-level Permute's octave and the pad's own compose rather
        than compete (the user's rule, 2026-09-14): both on is +24, clamped
        at the rail. Same context and contract as :meth:`set_sequencer_shift`
        — called from the engine's tick, inside its own undo step unless a
        gesture's is open, committed only after a member write landed,
        ``False`` when nothing changed or nothing could be written. A pad
        with no enabled pitch member (a Simpler kit's Sampler pad under a
        macro, an empty pad, a class with no binding) and a kit still
        macro-mapped — where a pad cannot move on its own — write nothing
        and hold nothing, logged once each. ``vm.pitch`` and the pad's own
        row read without the term, as they do without the kit's.
        """
        if self._disconnected:
            return False
        try:
            target = int(round(float(shift)))
            pad_note = int(note)
        except (TypeError, ValueError):
            return False
        st = self._find_state(device)
        if st is None:
            if target == 0:
                logger.debug(
                    "DrumVirtualMacroComponent: %s pad %d shift restore for a rack not held; nothing to put back",
                    device_path, pad_note,
                )
                return False
            st = self._state_for(device, device_path)
        else:
            if st.device_path != device_path and device_path not in self._states:
                self.rebind(device, device_path)
            if st.dirty:
                self._resolve(st)
                self._seed(st, only_missing=True)
        fn = FUNCTIONS["pitch"]
        global_value = st.values.get("pitch")
        if global_value is None:
            self._warn_once(
                st.device_path, "padshift:nopitch:%d" % pad_note,
                "pad %d shift %d skipped: rack has no pitch value yet" % (pad_note, target),
            )
            return False
        if self._legacy_macro(st, fn) is not None:
            self._warn_once(
                st.device_path, "padshift:legacy:%d" % pad_note,
                "pad %d shift %d dropped: the kit is still macro-mapped, so a pad "
                "cannot move on its own" % (pad_note, target),
            )
            return False
        members = [m for m in self._pad_members(st, fn, pad_note) if m.enabled]
        if not members:
            self._warn_once(
                st.device_path, "padshift:nomembers:%d" % pad_note,
                "pad %d shift %d skipped: no enabled pitch member on that pad" % (pad_note, target),
            )
            return False
        rec = st.pads.get(pad_note)
        if rec is None:
            # A pad the seed never saw (it arrived after): what it holds now
            # is its offset from the kit, the kit's own rule for a late pad.
            cur = self._member_read(members[0])
            base = int(global_value) + int(st.shift)
            rec = st.pads[pad_note] = _PadPitch(
                (int(round(cur)) - base) if cur is not None else 0,
                int(round(cur)) if cur is not None else None, self._clock(),
            )
        if rec.shift == target:
            return False
        opened = False
        if not self._undo_open:
            self._open_undo_step()
            opened = self._undo_open
        try:
            wrote = self._write_pad_pitch(
                st, rec, members,
                int(global_value) + int(rec.offset) + int(st.shift) + target,
            )
        except Exception as e:  # never let a rack fault reach the Timer
            self._warn_once(
                st.device_path, "apply:padshift", "pad shift apply raised: %s: %s" % (type(e).__name__, e),
            )
            return False
        finally:
            if opened:
                self._close_undo_step()
        if not wrote:
            self._warn_once(
                st.device_path, "padshift:nowrite:%d" % pad_note,
                "pad %d shift %d skipped: no pitch member could be written" % (pad_note, target),
            )
            return False
        rec.shift = target
        logger.debug(
            "DrumVirtualMacroComponent: %s pad %d sequencer shift -> %d", st.device_path, pad_note, target,
        )
        return True

    def flush(self) -> int:
        """Apply every pending ``(device, function)`` once, latest value.
        Registered as the transport's drain hook; returns the number of
        fan-outs run."""
        if self._disconnected or not self._pending:
            return 0
        pending, self._pending = self._pending, {}
        applied = 0
        self._open_undo_step()
        try:
            for (device_path, function), (device, value) in pending.items():
                try:
                    st = self._state_for(device, device_path)
                    parsed = parse_pad_function(function)
                    if parsed is not None:
                        fn = self._function(st, parsed[1])
                        if fn is None:
                            continue
                        self._apply_pad(st, parsed[0], fn, value)
                    else:
                        fn = self._function(st, function)
                        if fn is None:
                            continue
                        self._apply(st, fn, value)
                except Exception as e:  # one bad rack must not starve the rest
                    self._warn_once(
                        device_path, "apply:" + function,
                        "apply %s raised: %s: %s" % (function, type(e).__name__, e),
                    )
                    continue
                applied += 1
        finally:
            self._arm_undo_close()
        return applied

    def disconnect(self) -> None:
        self._disconnected = True
        self._close_undo_step()
        for device_path in list(self._states):
            self.release(device_path)
        self._pending.clear()

    # --- gesture undo step ---------------------------------------------

    def _open_undo_step(self) -> None:
        if self._song is None or self._undo_open:
            return
        try:
            self._song.begin_undo_step()
        except _LOM_ERRORS as e:
            self._warn_once("song", "begin_undo_step", "begin_undo_step raised: %s" % e)
            return
        self._undo_open = True

    def _arm_undo_close(self) -> None:
        """Push the close deadline out by the idle window; schedule the
        close once and let it re-arm itself until the deadline holds."""
        if not self._undo_open:
            return
        if self._schedule_delayed is None:
            self._close_undo_step()
            return
        self._undo_deadline = self._clock() + GESTURE_UNDO_IDLE_MS / 1000.0
        if self._undo_close_scheduled:
            return
        self._undo_close_scheduled = True
        try:
            self._schedule_delayed(GESTURE_UNDO_IDLE_MS, self._maybe_close_undo_step)
        except Exception as e:
            self._undo_close_scheduled = False
            logger.warning("DrumVirtualMacroComponent: schedule_delayed failed: %s", e)
            self._close_undo_step()

    def _maybe_close_undo_step(self) -> None:
        self._undo_close_scheduled = False
        if not self._undo_open:
            return
        remaining = self._undo_deadline - self._clock()
        if remaining > 0.005:
            # A later apply moved the deadline: come back then.
            self._undo_close_scheduled = True
            try:
                self._schedule_delayed(int(remaining * 1000) + 1, self._maybe_close_undo_step)
                return
            except Exception as e:
                self._undo_close_scheduled = False
                logger.warning("DrumVirtualMacroComponent: schedule_delayed failed: %s", e)
        self._close_undo_step()

    def _close_undo_step(self) -> None:
        if not self._undo_open:
            return
        self._undo_open = False
        try:
            self._song.end_undo_step()
        except _LOM_ERRORS as e:
            self._warn_once("song", "end_undo_step", "end_undo_step raised: %s" % e)

    @staticmethod
    def _known(function: str) -> bool:
        return (
            function == MEMBERS_KEY
            or function == SELECTED_PAD_KEY
            or function in FUNCTIONS
            or is_macro_function(function)
            or parse_pad_function(function) is not None
        )

    @staticmethod
    def _function(st: _RackState, function: str) -> Optional[VirtualMacro]:
        """The function behind a name on this rack: one of the fixed table, one
        of the kit's rack macros, or — for a macro name the kit does not
        carry — a transient rack-macro function with no members, so the
        write path treats it like any member-less function (stored,
        echoed, nothing moved) rather than as unknown."""
        fn = FUNCTIONS.get(function)
        if fn is not None:
            return fn
        fn = st.macro_functions.get(function)
        if fn is not None:
            return fn
        if is_macro_function(function):
            return macro_function(function[len(MACRO_FUNCTION_PREFIX):])
        return None

    @staticmethod
    def _functions(st: _RackState) -> List[VirtualMacro]:
        """Every function this rack seeds and censuses: the fixed table, then
        the kit's rack macros in rack order."""
        return list(FUNCTIONS.values()) + list(st.macro_functions.values())

    # --- membership census (vm.members) -----------------------------------

    def members_payload(self, st: _RackState) -> Dict[str, object]:
        """The census behind ``vm.members`` as a plain dict::

            {"padCount": 32,
             "padClasses": {"OriginalSimpler": 31, "MultiSampler": 1},
             "hasMacroMappings": true,
             "mappedMacros": [1, 2],
             "family": false,
             "functions": {"pitch": {"members": 32, "held": 32}, ...}}

        ``padCount`` is the number of pads carrying a chain; ``padClasses``
        counts the class of the first instrument on each populated pad,
        bound or not (so a Komplete Kontrol kit reads ``AuPluginDevice``
        and a pad holding a nested rack reads ``InstrumentGroupDevice``);
        ``functions`` counts member *parameters* per function and how
        many of them are macro-held (``is_enabled == False``). A kit with
        ``held == members`` for a function is read-only for it; one with
        ``members == 0`` has nothing to move. ``mappedMacros`` lists
        the macros ``RackDevice.macros_mapped`` flags, 1-based (a macro's
        parameter index; 0 is Device On) and short, since the census is
        near the datagram cap: the view draws one slider per mapped macro,
        by the flag and never by the name, since a mapped macro can keep its
        default "Macro N" name.
        """
        functions: Dict[str, Dict[str, int]] = {}
        for fn in FUNCTIONS.values():
            ms = st.members.get(fn.name) or []
            functions[fn.name] = {
                "members": len(ms),
                "held": sum(1 for m in ms if not m.enabled),
            }
        # The pad racks' macro names, in rack order (a list: ``sort_keys``
        # must not reorder them), one row per name with the same member /
        # held counts — one member per pad rack carrying that name.
        macros: List[Dict[str, object]] = []
        for fn in st.macro_functions.values():
            ms = st.members.get(fn.name) or []
            macros.append({
                "name": fn.macro_name,
                "members": len(ms),
                "held": sum(1 for m in ms if not m.enabled),
            })
        return {
            "padCount": st.pad_count,
            "padClasses": dict(st.pad_classes),
            "hasMacroMappings": bool(st.has_macro_mappings),
            "mappedMacros": [i + 1 for i, m in enumerate(st.macros_mapped) if m],
            "family": bool(st.family),
            "functions": functions,
            "macros": macros,
            "pitchMacro": st.pitch_macro,
            # The pads themselves (2026-09-08), note order, one entry per pad
            # carrying a chain: what a pad grid draws — ``class`` is the first
            # instrument's, ``null`` on an effect-only chain.
            "pads": [dict(p) for p in st.pad_list],
        }

    def members_json(self, st: _RackState) -> str:
        """:meth:`members_payload` as the compact, key-sorted JSON string
        that rides the wire (a few KB with the pad list; the UDP cap is
        9,216). Past :data:`CENSUS_BYTES_SOFT_CAP` the pad names are
        dropped — a grid can still draw from notes and classes."""
        payload = self.members_payload(st)
        text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        if len(text) > CENSUS_BYTES_SOFT_CAP and payload.get("pads"):
            payload["pads"] = [
                {"note": p["note"], "class": p["class"], "color": p.get("color")} for p in payload["pads"]
            ]
            text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
            self._warn_once(
                st.device_path, "census:size",
                "census over %d bytes; pad names dropped" % CENSUS_BYTES_SOFT_CAP,
            )
        return text

    def _emit_value(self, st: _RackState, function: str):
        """What a ``property/value`` for ``vm.<function>`` carries."""
        if function == MEMBERS_KEY:
            return self.members_json(st)
        if function == SELECTED_PAD_KEY:
            return self._selected_pad_note(st)
        parsed = parse_pad_function(function)
        if parsed is not None:
            return self._pad_read(st, parsed[0], parsed[1])
        return st.values.get(function)

    # --- state ------------------------------------------------------------

    def _state_for(self, device, device_path: str) -> _RackState:
        st = self._states.get(device_path)
        if st is not None and not same_lom_handle(st.device, device):
            # A different rack now lives at this path. Either this rack is
            # one we hold under another path (it moved: a track above it
            # was deleted) — rebind brings its state here and parks the
            # occupant — or it is a new kit swapped in, whose predecessor's
            # held values belong to the old kit.
            st = self.rebind(device, device_path)
            if st is None:
                self._evict(device_path)
        elif st is None:
            st = self.rebind(device, device_path)
        if st is None:
            st = _RackState(device, device_path)
            self._states[device_path] = st
            self._resolve(st)
            self._seed(st, only_missing=False)
            self._attach_listeners(st)
        elif st.dirty:
            self._resolve(st)
            self._seed(st, only_missing=True)
        return st

    def rebind(self, device, device_path: str) -> Optional[_RackState]:
        """The rack at ``device_path`` is one this component may already
        hold under another path — a track above it was deleted, a device
        before it removed (ADR-350: the wire carries positions, Live keeps
        objects). Re-key its state under the new path so the held shift,
        the offsets, the listeners and any pending apply follow the rack.
        Returns the state, or ``None`` when the rack is not held.

        Bookkeeping only (identity by ``same_lom_handle``, no LOM reads
        or writes), so it is legal inside a notification:
        ``SequencerComponent._resolve_route`` calls it from the structural
        rescan. Whatever state sat at the new path belongs to a rack that
        is no longer there — deleted with its track, or moved too and not
        yet rebound — and is parked at the path this rack vacates, never
        released, so a shift held on it can still be found by handle."""
        if self._disconnected:
            return None
        st = self._find_state(device)
        if st is None:
            return None
        old_path = st.device_path
        if old_path == device_path:
            return st
        self._states.pop(old_path, None)
        st_pending = self._take_pending(old_path)
        self._displace(device_path, old_path)
        self._rekey(st, device_path, st_pending)
        logger.info("DrumVirtualMacroComponent: rack state %s -> %s", old_path, device_path)
        return st

    def _find_state(self, device) -> Optional[_RackState]:
        """The state whose rack is ``device`` (``same_lom_handle``), under
        whatever path it is keyed by; ``None`` when the rack is not held."""
        for st in self._states.values():
            if same_lom_handle(st.device, device):
                return st
        return None

    def _evict(self, device_path: str) -> None:
        """The state at ``device_path`` belongs to a rack that is not the
        one now asked for there (a kit swapped in place, or a rack that
        moved away): see :meth:`_displace`."""
        self._displace(device_path, self._parked_key(device_path))

    def _displace(self, device_path: str, park_key: str) -> None:
        """The state at ``device_path`` (if any) belongs to a rack that is
        no longer there. Released when it holds no shift — its values were
        the old kit's, a moved rack re-seeds from itself — and parked under
        ``park_key`` when it does: the engine still owns a write on it and
        will find it by handle, so a held shift is never dropped by a path
        change."""
        st = self._states.get(device_path)
        if st is None:
            return
        if not st.shift and not _holds_pad_shift(st):
            self.release(device_path)
            return
        self._states.pop(device_path, None)
        pending = self._take_pending(device_path)
        self._rekey(st, park_key, pending)
        logger.info("DrumVirtualMacroComponent: shifted rack state parked as %s", park_key)

    def _parked_key(self, base: str) -> str:
        key = "%s#parked" % base
        n = 1
        while key in self._states:
            n += 1
            key = "%s#parked%d" % (base, n)
        return key

    def _rekey(self, st: _RackState, new_key: str, pending: Dict[str, Tuple[object, object]]) -> None:
        """Insert ``st`` (already popped from its old key) under ``new_key``
        with the pending applies that were queued for it."""
        st.device_path = new_key
        # The watcher carries a path of its own for its logs and warn keys;
        # keep it with the rack rather than the slot the rack left.
        if st.chain_watcher is not None:
            st.chain_watcher.device_path = new_key
        self._states[new_key] = st
        for function, entry in pending.items():
            self._pending[(new_key, function)] = entry

    def _take_pending(self, device_path: str) -> Dict[str, Tuple[object, object]]:
        out: Dict[str, Tuple[object, object]] = {}
        for key in [k for k in self._pending if k[0] == device_path]:
            out[key[1]] = self._pending.pop(key)
        return out

    def _resolve(self, st: _RackState) -> None:
        """Walk the rack: family fingerprint, macro table, and every pad's
        member parameters by class + name. Pads whose first instrument
        has no binding (Operator, a nested rack, …) are non-members."""
        device = st.device
        st.dirty = False
        # The members are about to be rebuilt from the LOM, so the
        # listeners on the old parameter objects go with them. The
        # deviations do not: they live on ``st.edits``, keyed by pad note
        # and parameter name, and are re-matched by :meth:`_seed`.
        self._detach_member_listeners(st)
        self._detach_name_listeners(st)
        # A pad that gained a chain since the last pass gets its ``devices``
        # listener here; one whose chain went loses it. Idempotent by
        # handle, so this is cheap on the common re-resolve.
        if st.chain_watcher is not None:
            st.chain_watcher.refresh()
        try:
            st.macros = list(device.parameters or ())
        except _LOM_ERRORS as e:
            self._warn_once(st.device_path, "macros", "parameters read raised: %s" % e)
            st.macros = []
        st.family = is_pipeline_family(st.macros)
        try:
            st.macros_mapped = tuple(bool(x) for x in (device.macros_mapped or ()))
        except _LOM_ERRORS:
            st.macros_mapped = ()
        try:
            st.has_macro_mappings = bool(device.has_macro_mappings)
        except _LOM_ERRORS:
            st.has_macro_mappings = any(st.macros_mapped)

        members: Dict[str, List[_Member]] = {name: [] for name in FUNCTIONS}
        macro_functions: Dict[str, VirtualMacro] = {}
        pitch_macro: Optional[str] = None
        missing: Dict[str, int] = {}
        member_pads = 0
        pad_count = 0
        pad_classes: Dict[str, int] = {}
        try:
            pads = list(device.drum_pads or ())
        except _LOM_ERRORS as e:
            self._warn_once(st.device_path, "drum_pads", "drum_pads read raised: %s" % e)
            pads = []
        pad_list: List[Dict[str, object]] = []
        instruments: list[object] = []
        for pad in pads:
            devices = pad_devices(pad)
            if devices is None:
                continue
            pad_count += 1
            try:
                note = int(pad.note)
            except _LOM_ERRORS + (ValueError,):
                note = -1
            found = first_instrument(devices)
            if found is not None and found[1] in SAMPLE_PAD_DEFAULT_NAMES:
                instruments.append(found[0])
            if note >= 0:
                pad_list.append({
                    "note": note,
                    # A sample pad's instrument name, not its chain's
                    # (ADR-439): a swap renames the one and not the other.
                    "name": pad_label(pad, found),
                    "class": found[1] if found is not None else None,
                    # The chain's colour as Live paints the pad (RGB int, the
                    # track-colour convention), or None — measured 2026-09-08:
                    # ``chains[0].color`` 8754719 = #85961f on the Croydon kit.
                    "color": pad_color(pad),
                })
            if found is None:
                continue
            inst, cls = found
            pad_classes[cls] = pad_classes.get(cls, 0) + 1
            if cls == INSTRUMENT_RACK_CLASS_NAME:
                # A nested rack's members are its named macros: one
                # ``macro.<name>`` function per name, discovered in the
                # rack's own order, the first pad's rack setting the order
                # for the kit — and its transpose-named macro, if any, is
                # the pad's ``pitch`` member in semitones.
                counted, pitch_name = self._resolve_rack_macros(inst, note, members, macro_functions)
                # ``gain`` is the exception to "a nested rack's members are
                # its macros": the pad's level is its CHAIN volume, not a
                # macro the kit may or may not carry (2026-09-08). A kit
                # whose racks happen to name a macro "Volume" still gets
                # that macro as its own ``macro.Volume`` control — this is
                # a different knob and does not collide.
                chain_volume = pad_chain_volume(pad)
                if chain_volume is not None:
                    members["gain"].append(make_member(
                        chain_volume, note, INSTRUMENT_RACK_CLASS_NAME, CHAIN_VOLUME_NAME,
                    ))
                    counted = True
                if counted:
                    member_pads += 1
                if pitch_name is not None and pitch_macro is None:
                    pitch_macro = pitch_name
                continue
            if cls not in BOUND_CLASSES:
                continue
            by_name = None
            counted = False
            for fn in FUNCTIONS.values():
                names = fn.bindings.get(cls)
                if not names:
                    continue
                if by_name is None:
                    by_name = index_params(inst)
                for pname in names:
                    param = by_name.get(pname)
                    if param is None:
                        missing[fn.name] = missing.get(fn.name, 0) + 1
                        logger.debug(
                            "DrumVirtualMacroComponent: %s: %s on pad %d has no parameter "
                            "named %r (section never enabled?); skipping that member",
                            st.device_path, cls, note, pname,
                        )
                        continue
                    members[fn.name].append(make_member(param, note, cls, pname))
                    counted = True
            if counted:
                member_pads += 1
        st.members = members
        st.member_pads = member_pads
        st.pad_count = pad_count
        st.pad_classes = pad_classes
        st.macro_functions = macro_functions
        st.pitch_macro = pitch_macro
        st.missing = missing
        st.pad_list = pad_list
        # A held value for a rack macro the kit no longer carries (racks
        # swapped on the pads) describes nothing: drop it so a subscriber
        # reads nil rather than the old kit's number.
        for key in [k for k in st.values if is_macro_function(k) and k not in macro_functions]:
            del st.values[key]
        logger.debug(
            "DrumVirtualMacroComponent: resolved %s family=%s pads=%d/%d classes=%s members=%s macros=%s",
            st.device_path, st.family, member_pads, pad_count, pad_classes,
            {k: len(v) for k, v in members.items()}, list(macro_functions),
        )
        self._attach_member_listeners(st)
        self._attach_name_listeners(st, instruments)

    def _resolve_rack_macros(
        self, rack, note: int, members: Dict[str, List[_Member]],
        macro_functions: Dict[str, VirtualMacro],
    ) -> Tuple[bool, Optional[str]]:
        """Add one pad rack's named macros to ``members`` (and any name not
        seen yet to ``macro_functions``); its first transpose-named macro
        (:data:`PITCH_MACRO_NAMES`) also joins ``members["pitch"]`` as a
        semitone member. Returns ``(contributed a member, pitch macro name
        or None)``. ``Device On`` and ``Chain Selector`` are skipped by
        name; at most :data:`MACRO_SLOTS` macros count; a default-named
        macro is not a control."""
        try:
            params = list(rack.parameters or ())
        except _LOM_ERRORS:
            return False, None
        counted = False
        pitch_name: Optional[str] = None
        slots = 0
        for p in params:
            if slots >= MACRO_SLOTS:
                break
            try:
                name = p.name
            except _LOM_ERRORS:
                continue
            if name in RACK_NON_MACRO_PARAMS:
                continue
            slots += 1
            if is_empty_macro_name(name):
                continue
            key = MACRO_FUNCTION_PREFIX + name
            fn = macro_functions.get(key)
            if fn is None:
                fn = macro_functions[key] = macro_function(name)
            member = make_member(p, note, INSTRUMENT_RACK_CLASS_NAME, name)
            members.setdefault(key, []).append(member)
            counted = True
            if pitch_name is None and is_pitch_macro_name(name):
                pitch_name = name
                members["pitch"].append(
                    make_member(p, note, INSTRUMENT_RACK_CLASS_NAME, name, semitone_macro=True),
                )
        return counted, pitch_name

    def _pad_instrument(self, pad):
        """``(device, class_name)`` of the pad's instrument when it has a
        binding; ``None`` for empty pads and for pads whose instrument is
        unbound (a nested rack, Operator, a plugin, …)."""
        devices = pad_devices(pad)
        if devices is None:
            return None
        found = first_instrument(devices)
        if found is None or found[1] not in BOUND_CLASSES:
            return None
        return found

    # --- member value space -----------------------------------------------
    #
    # A member's LOM value is its own, except a semitone macro (a pad
    # rack's transpose macro standing in for a Transpose): read and written
    # in semitones, −48..48 across the macro's 0..127 (the convention).

    @staticmethod
    def _member_bounds(m: _Member) -> Tuple[float, float]:
        if m.semitone_macro:
            return float(PITCH_MIN), float(PITCH_MAX)
        return m.min, m.max

    def _member_read(self, m: _Member) -> Optional[float]:
        raw = _float_or_none(self._read_value(m.param))
        if raw is None or not m.semitone_macro:
            return raw
        span = m.max - m.min
        if span <= 0:
            return None
        return PITCH_MIN + (raw - m.min) / span * (PITCH_MAX - PITCH_MIN)

    def _member_fn_value(self, m: _Member) -> Optional[float]:
        """A member's current value as the function's own ``t`` (0..1) —
        the exact inverse of the fan-out's ``min + t·(max−min)``, so a
        deviation measured here writes back to the value it was read
        from. ``None`` when the parameter cannot be read or has no span."""
        v = self._member_read(m)
        if v is None:
            return None
        lo, hi = self._member_bounds(m)
        span = hi - lo
        if span <= 0:
            return None
        return _clamp((v - lo) / span, 0.0, 1.0)

    @staticmethod
    def _tracks_edits(fn: VirtualMacro, m: _Member) -> bool:
        """Whether this member carries a per-pad deviation (and so a value
        listener). Continuous members of the ``t`` functions only:

        - a **two-state switch** (``FX On``, a Sampler section's ``On``)
          has no room for one and follows its amount by the measured
          macro threshold instead;
        - **fxType** is a choice, not an amount — a per-pad FX type is a
          real thing to want, but as an absolute value, not an offset, so
          it waits for the per-pad milestone rather than being modelled
          wrongly here;
        - **pitch** keeps its own ``_PadPitch`` offsets, reconciled by the
          read-before-write poll the sequencer depends on (ADR-429);
        - a pad with no note (``-1``) cannot be addressed per pad."""
        return fn.kind == KIND_T and not m.quantized and m.note >= 0

    @staticmethod
    def _member_write(m: _Member, value) -> None:
        if not m.semitone_macro:
            m.param.value = value
            return
        t = (float(value) - PITCH_MIN) / float(PITCH_MAX - PITCH_MIN)
        m.param.value = m.min + _clamp(t, 0.0, 1.0) * (m.max - m.min)

    # --- seeding ----------------------------------------------------------

    def _seed(self, st: _RackState, only_missing: bool, adopt_new: bool = True) -> None:
        """Seed the held values, and with them the per-pad records.

        ``adopt_new`` is what a member seen for the first time is assumed
        to be: with it (a kit load, a pad added) the member's own value is
        taken as the kit value plus that pad's deviation, so the pad keeps
        what it holds; without it (:meth:`_grow_sections`, where the member
        appeared *because* this very fan-out turned its section on) the
        deviation is zero and the pad takes the kit value."""
        replaced = only_missing and self._kit_replaced(st)
        if replaced:
            logger.info(
                "DrumVirtualMacroComponent: %s is now %r, was %r: a preset "
                "loaded into the same rack; re-seeding from the new kit and "
                "dropping its per-pad records",
                st.device_path, self._rack_name(st), st.kit_name,
            )
        for fn in self._functions(st):
            if only_missing and st.values.get(fn.name) is not None:
                if not self._has_source(st, fn):
                    # Every member went with the pads that carried them (a kit
                    # hot-swapped in place, racks dropped onto the pads) and no
                    # legacy macro stands in: the held number describes
                    # nothing any more. Nil, the way a fresh rack without
                    # members reads — a UI would otherwise show a Trnsp at +7
                    # on a kit it cannot move (seen on the rig 2026-09-07).
                    st.values[fn.name] = None
                    self._forget_pad_records(st, fn)
                    continue
                if not replaced:
                    # The kit still carries this function: keep the
                    # deviations, and give a member a re-resolve turned up
                    # for the first time (a pad added to the rack) a record
                    # of its own, so it keeps what it holds.
                    self._seed_member_devs(
                        st, fn, st.values.get(fn.name), only_missing=True, adopt_new=adopt_new,
                    )
                    continue
                # A NEW KIT IN THE SAME RACK DEVICE (2026-09-15): fall
                # through to a fresh seed with the records dropped. See
                # :meth:`_kit_replaced` for what this is and how it is told.
                self._forget_pad_records(st, fn)
            st.values[fn.name] = self._seed_value(st, fn)
            if fn.kind == KIND_SEMITONES:
                self._seed_pitch_offsets(st, fn, st.values[fn.name])
            else:
                self._seed_member_devs(
                    st, fn, st.values[fn.name], only_missing=False, adopt_new=adopt_new,
                )
        st.kit_name = self._rack_name(st)

    # --- is this still the kit the records describe? ----------------------

    @staticmethod
    def _rack_name(st: _RackState) -> Optional[str]:
        try:
            return str(st.device.name)
        except _LOM_ERRORS:
            return None

    def _kit_replaced(self, st: _RackState) -> bool:
        """Whether the rack now holds a different kit than the one the held
        values and the per-pad records were seeded from — a preset loaded
        into the same Drum Rack device.

        **Told by the rack's name, because nothing else changes.** Measured
        on the rig 2026-09-15, loading one 32-pad kit over another through
        `prepare_for_preset`: the chains, the pads, the devices and every
        DeviceParameter came back with the *same* ``_live_ptr`` (16 of 16
        Decay parameters identical), and the pad chains' own ``devices``
        listeners never fired — so neither LOM identity nor
        ``PadChainWatcher`` can see it. What changed was every name: the
        rack's (Live names the device after the preset), each chain's and
        each cell's. The rack's is the one a similar-sample swap does not
        touch (ADR-439 renames chains and instruments), so it is the signal
        with the least noise.

        Known limits, both documented in ADR-428: loading the *same* preset
        again is invisible here, and renaming the rack by hand reads as a
        new kit and re-seeds. A pad added to this kit does not change the
        rack's name, so its neighbours keep their deviations."""
        before = st.kit_name
        now = self._rack_name(st)
        if before is None or now is None:
            return False
        return now != before

    def _forget_pad_records(self, st: _RackState, fn: VirtualMacro) -> None:
        """Drop the per-pad records this function holds — the pitch offsets
        (with the pad shift terms that rode the old chains) or the
        deviations."""
        if fn.kind == KIND_SEMITONES:
            st.pads = {}
        else:
            st.edits.pop(fn.name, None)

    def _has_source(self, st: _RackState, fn: VirtualMacro) -> bool:
        """Whether a write to ``fn`` would reach anything on this rack: a
        member parameter, or the legacy macro while the kit is mapped."""
        if st.members.get(fn.name):
            return True
        return self._legacy_macro(st, fn) is not None

    def _seed_pitch_offsets(self, st: _RackState, fn: VirtualMacro, global_value) -> None:
        """One ``_PadPitch`` per member pad: its Transpose relative to the
        global (the first member's), with the held shift removed, and
        what it reads now as the baseline for the next reconcile. Empty
        on a rack with no pitch value and while the legacy macro is what
        gets written (the macro fans out; there is nothing per pad to
        keep)."""
        pads: Dict[int, _PadPitch] = {}
        if global_value is None or self._legacy_macro(st, fn) is not None:
            st.pads = pads
            return
        now = self._clock()
        for m in st.members.get(fn.name) or []:
            if m.note < 0:
                continue
            v = self._member_read(m)
            if v is None:
                continue
            cur = int(round(v))
            # A term a pad's own Permute holds survives the re-seed: the
            # pad reads with it on, so the offset is what remains.
            old = st.pads.get(m.note)
            pad_shift = int(old.shift) if old is not None else 0
            pads[m.note] = _PadPitch(cur - int(st.shift) - pad_shift - int(global_value), cur, now, pad_shift)
        st.pads = pads

    def _seed_member_devs(
        self, st: _RackState, fn: VirtualMacro, global_value, only_missing: bool,
        adopt_new: bool = True,
    ) -> None:
        """One :class:`_MemberEdit` per continuous member of ``fn``: the
        pad's deviation from the kit value, and what it reads now as the
        baseline the value listeners measure against.

        A kit's pads rarely share one decay any more than they share one
        tuning, so seeding the deviations from the kit as loaded is what
        stops the first touch of a control from flattening it — the same
        rule :meth:`_seed_pitch_offsets` follows for Transpose.

        Empty on a function with no value and while the legacy macro is
        what gets written (Live's macro fans out; there is nothing per pad
        to keep). With ``only_missing`` the deviations already held are
        kept and only members seen for the first time are seeded."""
        if fn.kind != KIND_T:
            return
        if global_value is None or self._legacy_macro(st, fn) is not None:
            st.edits.pop(fn.name, None)
            return
        prior = st.edits.get(fn.name) or {}
        now = self._clock()
        recs: Dict[Tuple[int, str], _MemberEdit] = {}
        for m in st.members.get(fn.name) or []:
            if not self._tracks_edits(fn, m):
                continue
            key = (m.note, m.pname)
            rec = prior.get(key) if only_missing else None
            if rec is not None:
                recs[key] = rec
                continue
            cur = self._member_fn_value(m)
            if cur is None:
                continue
            if not adopt_new:
                # The member appeared because the fan-out in flight turned
                # its section on: what it reads is Live's default for a
                # section just enabled, not a pad the user tuned. No
                # deviation — the fan-out's own value is about to land on
                # it, and ``written`` is set when it does.
                recs[key] = _MemberEdit(0.0, None, now)
                continue
            recs[key] = _MemberEdit(
                _clamp(cur - float(global_value), -1.0, 1.0), cur, now,
            )
        st.edits[fn.name] = recs

    def _seed_value(self, st: _RackState, fn: VirtualMacro):
        macro = self._legacy_macro(st, fn)
        if macro is not None:
            t = self._normalized(macro)
            if t is None:
                return None
            seeded = self._from_t(fn, t)
            if fn.kind == KIND_SEMITONES:
                seeded = int(_clamp(seeded - st.shift, PITCH_MIN, PITCH_MAX))
            return seeded
        members = st.members.get(fn.name) or []
        member = None
        for m in members:
            if not m.quantized:
                member = m
                break
        if member is None and members:
            member = members[0]
        if member is None:
            return None
        v = self._member_read(member)
        if v is None:
            return None
        if fn.kind == KIND_T:
            span = member.max - member.min
            return _clamp((v - member.min) / span, 0.0, 1.0) if span > 0 else 0.0
        if fn.kind == KIND_ENUM:
            return int(_clamp(round(v), 0, FX_TYPE_MAX))
        # A re-seed while the sequencer holds a shift must not fold that
        # shift into the global (permute ADR-020).
        return int(_clamp(round(v) - st.shift, PITCH_MIN, PITCH_MAX))

    @staticmethod
    def _read_value(param):
        try:
            return param.value
        except _LOM_ERRORS:
            return None

    @staticmethod
    def _normalized(param) -> Optional[float]:
        v = _float_or_none(DrumVirtualMacroComponent._read_value(param))
        if v is None:
            return None
        try:
            lo = float(param.min)
            hi = float(param.max)
        except _LOM_ERRORS + (ValueError,):
            lo, hi = 0.0, 127.0
        span = hi - lo
        return _clamp((v - lo) / span, 0.0, 1.0) if span > 0 else 0.0

    # --- value conversions ------------------------------------------------

    @staticmethod
    def _coerce(fn: VirtualMacro, value):
        v = _float_or_none(value)
        if v is None:
            return None
        if fn.kind == KIND_T:
            return _clamp(v, 0.0, 1.0)
        if fn.kind == KIND_ENUM:
            return int(_clamp(round(v), 0, FX_TYPE_MAX))
        return int(_clamp(round(v), PITCH_MIN, PITCH_MAX))

    @staticmethod
    def _to_t(fn: VirtualMacro, value) -> float:
        """Held value → macro travel ``0..1`` (for the legacy macro)."""
        if fn.kind == KIND_ENUM:
            return _clamp(float(value) / FX_TYPE_MAX, 0.0, 1.0)
        if fn.kind == KIND_SEMITONES:
            return _clamp((float(value) - PITCH_MIN) / (PITCH_MAX - PITCH_MIN), 0.0, 1.0)
        return _clamp(float(value), 0.0, 1.0)

    @staticmethod
    def _from_t(fn: VirtualMacro, t: float):
        """Macro travel ``0..1`` → held value (seeding from a mapped macro)."""
        if fn.kind == KIND_ENUM:
            return int(_clamp(round(t * FX_TYPE_MAX), 0, FX_TYPE_MAX))
        if fn.kind == KIND_SEMITONES:
            return int(_clamp(round(PITCH_MIN + t * (PITCH_MAX - PITCH_MIN)), PITCH_MIN, PITCH_MAX))
        return _clamp(t, 0.0, 1.0)

    @staticmethod
    def _member_target(fn: VirtualMacro, m: _Member, value):
        """The LOM value one member receives for the held ``value``."""
        if fn.kind == KIND_SEMITONES:
            return int(_clamp(int(value), m.min, m.max))
        if fn.kind == KIND_ENUM:
            return int(_clamp(int(value), m.min, m.max))
        t = float(value)
        span = m.max - m.min
        if m.quantized:
            if span <= 1.0 + 1e-9:
                # Two-state switch: measured macro threshold, not half
                # travel — or always on, for a bipolar amount's section.
                if not fn.switch_off_at_floor:
                    return m.max
                return m.max if t > TOGGLE_ON_ABOVE_T else m.min
            return int(round(m.min + t * span))
        return m.min + t * span

    # --- routing + apply --------------------------------------------------

    def _legacy_macro(self, st: _RackState, fn: VirtualMacro):
        """The rack macro to write instead of fanning out, or ``None``.
        Only on the pipeline family, only while that macro is mapped."""
        if not st.family:
            return None
        idx = fn.legacy_macro
        if idx <= 0:
            # A rack-macro function: no legacy macro, ever. (Without this
            # guard ``macros_mapped[-1]`` would read the LAST macro's
            # flag and route the write to macro 0 — Device On.)
            return None
        if idx - 1 >= len(st.macros_mapped) or not st.macros_mapped[idx - 1]:
            return None
        if idx >= len(st.macros):
            return None
        return st.macros[idx]

    def _apply(
        self, st: _RackState, fn: VirtualMacro, value,
        shift: Optional[int] = None, adopt_kit_move: bool = False,
    ) -> int:
        """Write ``value`` to the function's members — or to its legacy
        macro on a still-mapped family kit. Returns the number of LOM
        writes that landed. ``shift`` is the sequencer term a pitch apply
        carries (the held one when ``None``) and ``adopt_kit_move``
        selects the sequencer path's rule for a kit move found on the
        read-back; both are pitch-only (:meth:`_apply_pitch`)."""
        if fn.kind == KIND_SEMITONES:
            return self._apply_pitch(
                st, fn, int(value), st.shift if shift is None else int(shift), adopt_kit_move,
            )
        macro = self._legacy_macro(st, fn)
        if macro is not None:
            return self._write_macro(st, fn, macro, value)
        members = st.members.get(fn.name) or []
        if not members:
            self._warn_once(
                st.device_path, "nomembers:" + fn.name,
                "%s has no member parameter on any pad; write dropped" % fn.name,
            )
            return 0
        wrote, switched_on = self._write_members(st, fn, members, value)
        if switched_on and st.missing.get(fn.name):
            # A section switch just turned on and this function had bound
            # names some pad did not list (the 43-parameter variant): they
            # may exist now. Re-read the rack and write the members this
            # pass has not written yet.
            wrote += self._grow_sections(st, fn, members, value)
        return wrote

    def _write_members(
        self, st: _RackState, fn: VirtualMacro, members: List[_Member], value,
        absolute: bool = False,
    ) -> Tuple[int, bool]:
        """Write ``value`` to ``members``; returns ``(writes landed, a
        two-state switch member went to its max)``. ``value`` is the kit
        value and each member adds its own deviation — unless ``absolute``,
        the per-pad path, where ``value`` is the member's own target and
        the deviation has already been set to produce it. A deviation the
        clamp cannot honour is re-anchored to the rail the pad lands on,
        so the kit control can squeeze a kit level again."""
        wrote = 0
        failed = 0
        first_error = None
        switched_on = False
        recs = st.edits.get(fn.name) or {}
        now = self._clock()
        # Our own writes fire the members' value listeners; the flag makes
        # that a two-op no-op when Live dispatches them synchronously.
        self._fanning_out = True
        try:
            for m in members:
                if not m.enabled:
                    continue
                rec = recs.get((m.note, m.pname)) if recs else None
                # The pad keeps its deviation from the kit value — and a
                # deviation is always "where this pad sits, relative to that
                # value", so a clamp at a rail RE-ANCHORS it rather than
                # hiding under it (the user's call, 2026-09-15). Squeeze the
                # kit control against an end and the pads pinned there come
                # away level with it; leave the rail and a pinned pad moves
                # with the kit at once, instead of standing still until the
                # kit value comes back under its old distance. Only the
                # direction squeezed is flattened: at the top rail a pad
                # BELOW the kit is never clamped, so it keeps its distance.
                if absolute or rec is None:
                    effective = value
                else:
                    raw = float(value) + rec.dev
                    effective = _clamp(raw, 0.0, 1.0)
                    if effective != raw:
                        rec.dev = effective - float(value)
                target = self._member_target(fn, m, effective)
                try:
                    m.param.value = target
                except _LOM_ERRORS as e:
                    failed += 1
                    if first_error is None:
                        first_error = e
                    # A refused write means our enabled snapshot is stale
                    # (macro mapped in Live since resolve). Skip it now, and
                    # re-read the members before the next apply.
                    m.enabled = False
                    st.dirty = True
                    continue
                wrote += 1
                if rec is not None:
                    if rec.written is not None and abs(rec.written - effective) > DEV_EPSILON:
                        rec.prev = rec.written
                    rec.written = effective
                    rec.written_at = now
                if m.quantized and (m.max - m.min) <= 1.0 + 1e-9 and target == m.max:
                    switched_on = True
        finally:
            self._fanning_out = False
        if failed:
            self._warn_refused(st, fn, failed, len(members), first_error)
        return wrote, switched_on

    def _grow_sections(
        self, st: _RackState, fn: VirtualMacro, written: List[_Member], value,
        note: Optional[int] = None, absolute: bool = False,
    ) -> int:
        """After a section switch turned on: re-resolve the rack (the
        section's parameters may be listed now), keep the held values,
        and write this function's members that the first pass could not
        — matched by pad note and parameter name, so nothing is written
        twice. A no-op on a rack that already listed everything."""
        done = set((m.note, m.pname) for m in written)
        self._resolve(st)
        self._seed(st, only_missing=True, adopt_new=False)
        fresh = [
            m for m in (st.members.get(fn.name) or [])
            if (m.note, m.pname) not in done and (note is None or m.note == note)
        ]
        if not fresh:
            return 0
        wrote, _ = self._write_members(st, fn, fresh, value, absolute=absolute)
        logger.debug(
            "DrumVirtualMacroComponent: %s %s section grew: %d more member(s) written",
            st.device_path, fn.name, wrote,
        )
        return wrote

    def _write_macro(self, st: _RackState, fn: VirtualMacro, macro, value) -> int:
        """The transitional rule: the legacy macro in macro units."""
        t = self._to_t(fn, value)
        try:
            lo = float(macro.min)
            hi = float(macro.max)
        except _LOM_ERRORS + (ValueError,):
            lo, hi = 0.0, 127.0
        try:
            macro.value = lo + t * (hi - lo)
        except _LOM_ERRORS as e:
            st.dirty = True
            self._warn_once(
                st.device_path, "macro:" + fn.name,
                "legacy macro %d write for %s raised: %s" % (fn.legacy_macro, fn.name, e),
            )
            return 0
        return 1

    def _warn_refused(self, st: _RackState, fn: VirtualMacro, failed: int, total: int, first_error) -> None:
        self._warn_once(
            st.device_path, "refused:" + fn.name,
            "%d of %d member writes for %s refused (%s); members re-read "
            "on next apply" % (failed, total, fn.name, first_error),
        )

    def _apply_pitch(
        self, st: _RackState, fn: VirtualMacro, global_value: int, shift: int, adopt_kit_move: bool,
    ) -> int:
        """The pitch fan-out: ``clamp(global + shift + offset)`` per member,
        after :meth:`_reconcile_pitch` has read every member back.

        A kit move found on the read-back is discarded on the write path
        (the incoming ``global_value`` is the user's absolute intent) and
        adopted into the held global on the sequencer path — there is no
        new user value there, and the slider on screen should follow
        Live's undo — unless the move is exactly the shift change this
        apply makes (Cmd-Z on a held step: the kit already sits where the
        step-off lands, so nothing is adopted). Either way the sequencer
        path re-emits ``vm.pitch`` to its subscribers when a kit move was
        found. Returns the number of member writes that landed."""
        macro = self._legacy_macro(st, fn)
        if macro is not None:
            return self._write_macro(
                st, fn, macro, int(_clamp(global_value + shift, PITCH_MIN, PITCH_MAX)),
            )
        members = st.members.get(fn.name) or []
        if not members:
            self._warn_once(
                st.device_path, "nomembers:" + fn.name,
                "%s has no member parameter on any pad; write dropped" % fn.name,
            )
            return 0
        now = self._clock()
        move, first_seen = self._reconcile_pitch(st, members, now)
        if move:
            if not adopt_kit_move:
                logger.debug(
                    "DrumVirtualMacroComponent: %s kit moved %+d since the last write; "
                    "the incoming value %d wins", st.device_path, move, global_value,
                )
            elif move == shift - st.shift:
                logger.debug(
                    "DrumVirtualMacroComponent: %s kit already carries the shift change %+d "
                    "(undone in Live); nothing to adopt", st.device_path, move,
                )
            else:
                global_value = int(_clamp(global_value + move, PITCH_MIN, PITCH_MAX))
                st.values[fn.name] = global_value
                logger.debug(
                    "DrumVirtualMacroComponent: %s kit moved %+d under the sequencer; "
                    "global -> %d", st.device_path, move, global_value,
                )
            if adopt_kit_move and fn.name in st.subscribed:
                self._safe_emit(
                    V3_PROPERTY_VALUE_ADDRESS,
                    (st.device_path, PROPERTY_PREFIX + fn.name, st.values.get(fn.name)),
                )
        base = global_value + shift
        for note, cur in first_seen:
            # A pad first seen at apply time keeps its pitch until the
            # next move: its offset is whatever makes base + offset read
            # what it holds.
            rec = st.pads.get(note)
            if rec is None:
                rec = st.pads[note] = _PadPitch()
            rec.offset = cur - base
        wrote = 0
        failed = 0
        first_error = None
        for m in members:
            if not m.enabled:
                continue
            rec = st.pads.get(m.note) if m.note >= 0 else None
            # The pad's own deviation, and the term a Permute in its own
            # chain holds on it (ADR-435): both ride every kit gesture.
            offset = (rec.offset + rec.shift) if rec is not None else 0
            lo, hi = self._member_bounds(m)
            target = int(_clamp(int(_clamp(base + offset, PITCH_MIN, PITCH_MAX)), lo, hi))
            try:
                self._member_write(m, target)
            except _LOM_ERRORS as e:
                failed += 1
                if first_error is None:
                    first_error = e
                m.enabled = False
                st.dirty = True
                continue
            wrote += 1
            if rec is not None:
                if rec.written is not None and rec.written != target:
                    rec.prev = rec.written
                rec.written = target
                rec.written_at = now
        if failed:
            self._warn_refused(st, fn, failed, len(members), first_error)
        return wrote

    def _reconcile_pitch(
        self, st: _RackState, members: List[_Member], now: float,
    ) -> Tuple[int, List[Tuple[int, int]]]:
        """Pass one of a pitch fan-out: read every enabled member back and
        sort what changed since our last write.

        Returns ``(move, first_seen)``. ``move`` is the kit's move — the
        nonzero delta (read − written) at least two pads share when it is
        the most common delta across the pads read, an unchanged pad
        voting 0 — or 0 when there is none; the caller discards or adopts
        it. ``first_seen`` lists members with no record yet and what they
        read. Per pad, what remains after the kit move is the user's edit
        of that pad and is folded into its offset here.

        A read equal to the pad's pre-write value inside
        ``STALE_READ_WINDOW_MS`` of the write is our own write still
        landing: neither a vote nor an edit. A pad whose last write sat at
        its rail cannot vote — the clamp hid part of the move — and, under
        a kit move, keeps its offset. ``prev`` is cleared for every pad
        whose read matched its write or was judged an edit."""
        window = STALE_READ_WINDOW_MS / 1000.0
        votes: Dict[int, int] = {}
        changed: List[Tuple[_PadPitch, int, bool]] = []
        first_seen: List[Tuple[int, int]] = []
        for m in members:
            if not m.enabled or m.note < 0:
                continue
            cur = self._member_read(m)
            if cur is None:
                continue
            cur_i = int(round(cur))
            rec = st.pads.get(m.note)
            if rec is None or rec.written is None:
                first_seen.append((m.note, cur_i))
                continue
            lo, hi = self._member_bounds(m)
            at_rail = rec.written <= lo or rec.written >= hi
            if cur_i == rec.written:
                rec.prev = None
                if not at_rail:
                    votes[0] = votes.get(0, 0) + 1
                continue
            if rec.prev is not None and cur_i == rec.prev and (now - rec.written_at) <= window:
                # Our write still landing (measured on the rig 2026-09-07:
                # under a busy control thread a DrumCell reads one write
                # behind for a pass; folding that in walked every pad away
                # by the shift on each step).
                continue
            rec.prev = None
            delta = cur_i - rec.written
            changed.append((rec, delta, at_rail))
            if not at_rail:
                votes[delta] = votes.get(delta, 0) + 1
        move = 0
        if votes:
            top = max(votes.values())
            winners = [d for d, n in votes.items() if n == top]
            if len(winners) == 1 and winners[0] != 0 and top >= 2:
                move = winners[0]
        for rec, delta, at_rail in changed:
            if move:
                if at_rail:
                    continue
                delta -= move
            if delta:
                rec.offset += delta
        return move, first_seen

    # --- per-pad rows (2026-09-08) ------------------------------------------

    def _pad_members(self, st: _RackState, fn: VirtualMacro, note: int) -> List[_Member]:
        return [m for m in (st.members.get(fn.name) or ()) if m.note == note]

    def _pad_read(self, st: _RackState, note: int, function: str):
        """One pad's value of ``function``, absolute, in the function's own
        units — read off the pad's first continuous member (the kit's own
        anchor rule, per pad), so it is Live's truth and not the model's
        belief. ``None`` when the pad has no member for it. Pitch reports
        without the sequencer's shift, as ``vm.pitch`` does."""
        fn = self._function(st, function)
        if fn is None:
            return None
        members = self._pad_members(st, fn, note)
        if not members:
            return None
        member = next((m for m in members if not m.quantized), members[0])
        if fn.kind == KIND_SEMITONES:
            v = self._member_read(member)
            if v is None:
                return None
            rec = st.pads.get(note)
            pad_shift = int(rec.shift) if rec is not None else 0
            return int(_clamp(int(round(v)) - int(st.shift) - pad_shift, PITCH_MIN, PITCH_MAX))
        if fn.kind == KIND_ENUM:
            v = _float_or_none(self._read_value(member.param))
            if v is None:
                return None
            return int(_clamp(round(v), 0, FX_TYPE_MAX))
        return self._member_fn_value(member)

    def _apply_pad(self, st: _RackState, note: int, fn: VirtualMacro, value) -> int:
        """Write ``value`` to one pad's members of ``fn`` and record it as
        that pad's deviation from the kit value, so the next kit gesture
        carries the pad along at its new distance. The kit value does not
        move. Returns the number of LOM writes that landed."""
        if self._legacy_macro(st, fn) is not None:
            self._warn_once(
                st.device_path, "pad:legacy:" + fn.name,
                "%s on pad %d dropped: the kit is still macro-mapped, so a pad "
                "cannot move on its own" % (fn.name, note),
            )
            return 0
        members = self._pad_members(st, fn, note)
        if not members:
            self._warn_once(
                st.device_path, "pad:nomembers:%d:%s" % (note, fn.name),
                "%s has no member on pad %d; write dropped" % (fn.name, note),
            )
            return 0
        if fn.kind == KIND_SEMITONES:
            return self._apply_pad_pitch(st, note, members, int(value))
        held = st.values.get(fn.name)
        if fn.kind == KIND_T and held is not None:
            recs = st.edits.setdefault(fn.name, {})
            now = self._clock()
            for m in members:
                if not self._tracks_edits(fn, m):
                    continue
                rec = recs.get((m.note, m.pname))
                if rec is None:
                    rec = recs[(m.note, m.pname)] = _MemberEdit(0.0, None, now)
                rec.dev = _clamp(float(value) - float(held), -1.0, 1.0)
        wrote, switched_on = self._write_members(st, fn, members, value, absolute=True)
        if switched_on and st.missing.get(fn.name):
            wrote += self._grow_sections(st, fn, members, value, note=note, absolute=True)
        return wrote

    def _apply_pad_pitch(self, st: _RackState, note: int, members: List[_Member], value: int) -> int:
        """One pad's Transpose: ``value`` semitones (the UI's number, without
        the sequencer's shift), recorded as that pad's offset from the kit
        value so the Trnsp slider and the sequencer's octave carry it."""
        global_value = st.values.get("pitch")
        rec = st.pads.get(note)
        if global_value is not None:
            if rec is None:
                rec = st.pads[note] = _PadPitch()
            rec.offset = int(value) - int(global_value)
        pad_shift = int(rec.shift) if rec is not None else 0
        return self._write_pad_pitch(st, rec, members, int(value) + int(st.shift) + pad_shift)

    def _write_pad_pitch(self, st: _RackState, rec: Optional[_PadPitch], members: List[_Member], target_st: int) -> int:
        """Write ``target_st`` semitones (clamped) to one pad's pitch members,
        recording the write on its record. Returns the writes that landed."""
        target_st = int(_clamp(int(target_st), PITCH_MIN, PITCH_MAX))
        now = self._clock()
        wrote = 0
        failed = 0
        first_error = None
        for m in members:
            if not m.enabled:
                continue
            lo, hi = self._member_bounds(m)
            target = int(_clamp(target_st, lo, hi))
            try:
                self._member_write(m, target)
            except _LOM_ERRORS as e:
                failed += 1
                if first_error is None:
                    first_error = e
                m.enabled = False
                st.dirty = True
                continue
            wrote += 1
            if rec is not None:
                if rec.written is not None and rec.written != target:
                    rec.prev = rec.written
                rec.written = target
                rec.written_at = now
        if failed:
            self._warn_refused(st, FUNCTIONS["pitch"], failed, len(members), first_error)
        return wrote

    def _selected_pad_note(self, st: _RackState) -> Optional[int]:
        try:
            pad = st.device.view.selected_drum_pad
            if pad is None:
                return None
            return int(pad.note)
        except _LOM_ERRORS + (ValueError,):
            return None

    def _select_pad(self, st: _RackState, value) -> Tuple[bool, object, str]:
        """``vm.selectedPad`` set: select ``drum_pads[note]`` in Live. The
        rack's own listener then re-emits the row, so Live's UI and every
        other client follow."""
        v = _float_or_none(value)
        if v is None:
            return False, None, "bad pad note %r" % (value,)
        note = int(round(v))
        if note < 0 or note > PAD_NOTE_MAX:
            return False, None, "pad note %d out of range" % note
        pad = find_drum_pad(st.device, note)
        if pad is None:
            return False, None, "drum_pads[%d] unreadable" % note
        try:
            st.device.view.selected_drum_pad = pad
        except _LOM_ERRORS as e:
            return False, None, "selected_drum_pad write raised: %s" % e
        return True, note, ""

    # --- change listeners -------------------------------------------------

    def _attach_listeners(self, st: _RackState) -> None:
        self._attach_selected_pad_listener(st)
        # ``drum_pads`` / ``chains`` — plus a ``devices`` listener on every
        # populated pad chain, which is what this component gained by using
        # the shared watcher rather than its own pair. A pad's instrument
        # being *replaced on its own* (a device dragged onto one pad) fires
        # only that chain's ``devices``, so without it the census kept the
        # old pad's class and name and the ADR-439 ``name`` listener stayed
        # on the instrument that had gone. It does **not** see a preset
        # loaded into the whole rack — measured, see ``kit_name``.
        if st.chain_watcher is None:
            st.chain_watcher = PadChainWatcher(
                st.device, st.device_path,
                on_change=self._make_change_callback(st, "pad_chain"),
                warn=lambda key, message: self._warn_once(st.device_path, key, message),
            )
            st.chain_watcher.attach()
        # ``name`` is the rack's own, and it is what makes :meth:`_kit_replaced`
        # reachable. A preset loaded into this Drum Rack changes the name and
        # **nothing else observable** (rig, 2026-09-15: same ``_live_ptr`` on
        # the chains, the pads, the devices and every DeviceParameter; the pad
        # chains' ``devices`` listeners silent), so with nothing watching it,
        # no re-resolve ran: the census kept the previous kit's pad classes and
        # names, the view kept its profile, and the held values kept describing
        # a kit that was gone. A similar-sample swap renames the chains and the
        # instruments but not the rack (ADR-439), so this fires on kit loads
        # and not on swaps. Renaming a rack by hand reads as a new kit — the
        # documented cost of the name being the only signal Live gives.
        for name in ("macros_mapped", "name"):
            adder = getattr(st.device, "add_%s_listener" % name, None)
            if not callable(adder):
                continue
            cb = self._make_change_callback(st, name)
            try:
                adder(cb)
            except _LOM_ERRORS as e:
                self._warn_once(
                    st.device_path, "listener:" + name,
                    "add_%s_listener raised: %s" % (name, e),
                )
                continue
            st.listeners.append((name, cb))

    def _attach_selected_pad_listener(self, st: _RackState) -> None:
        if st.selected_pad_listener is not None:
            return
        view = getattr(st.device, "view", None)
        adder = getattr(view, "add_selected_drum_pad_listener", None) if view is not None else None
        if not callable(adder):
            return
        cb = self._make_selected_pad_callback(st)
        try:
            adder(cb)
        except _LOM_ERRORS as e:
            self._warn_once(
                st.device_path, "listener:selected_drum_pad",
                "add_selected_drum_pad_listener raised: %s" % e,
            )
            return
        st.selected_pad_listener = cb

    def _make_selected_pad_callback(self, st: _RackState) -> Callable[[], None]:
        """Live's selection changed (a pad tapped in Live, or our own
        write landing): push the row to its subscribers. A read and an
        emit, no LOM write."""
        def _on_selected_pad():
            if self._disconnected or not self._is_held(st):
                return
            if SELECTED_PAD_KEY in st.subscribed:
                self._safe_emit(
                    V3_PROPERTY_VALUE_ADDRESS,
                    (st.device_path, SELECTED_PAD_PROPERTY, self._selected_pad_note(st)),
                )
        return _on_selected_pad

    def _detach_listeners(self, st: _RackState) -> None:
        if st.selected_pad_listener is not None:
            view = getattr(st.device, "view", None)
            remover = getattr(view, "remove_selected_drum_pad_listener", None) if view is not None else None
            if callable(remover):
                try:
                    remover(st.selected_pad_listener)
                except _LOM_ERRORS as e:
                    logger.debug(
                        "DrumVirtualMacroComponent: remove_selected_drum_pad_listener on %s "
                        "raised: %s", st.device_path, e,
                    )
            st.selected_pad_listener = None
        for name, cb in st.listeners:
            remover = getattr(st.device, "remove_%s_listener" % name, None)
            if not callable(remover):
                continue
            try:
                remover(cb)
            except _LOM_ERRORS as e:
                logger.debug(
                    "DrumVirtualMacroComponent: remove_%s_listener on %s "
                    "raised: %s", name, st.device_path, e,
                )
        st.listeners = []
        if st.chain_watcher is not None:
            st.chain_watcher.detach()
            st.chain_watcher = None

    def _make_change_callback(self, st: _RackState, name: str) -> Callable[[], None]:
        """The callback holds the state object, not its path: a rack that
        moves between the fire and the deferred re-seed still lands on
        the right path, and a released state is recognised as such."""
        def _on_change():
            if self._disconnected or not self._is_held(st):
                return
            st.dirty = True
            self._schedule_reseed(st)
        return _on_change

    # --- member value listeners (per-pad hand edits) ----------------------

    def _attach_member_listeners(self, st: _RackState) -> None:
        """Watch every member that carries a deviation, so a hand edit in
        Live is noticed when it happens instead of being flattened by the
        next fan-out.

        The callback marks the function and schedules the absorb; it reads
        and writes nothing (repo rule — a listener marks and schedules).
        Our own fan-out is skipped by ``_fanning_out`` when Live dispatches
        synchronously and by the ``written`` baseline when it does not.
        Watched in table order to :data:`MAX_MEMBER_LISTENERS`; a function
        that would cross the cap is left unwatched and says so once."""
        if self._disconnected:
            return
        budget = MAX_MEMBER_LISTENERS
        for fn in self._functions(st):
            watchable = [
                m for m in (st.members.get(fn.name) or ())
                if self._tracks_edits(fn, m) and m.enabled
            ]
            if not watchable:
                continue
            if len(watchable) > budget:
                self._warn_once(
                    st.device_path, "listenercap:" + fn.name,
                    "%d more member listeners would pass the %d cap; %s stays "
                    "unwatched (a hand edit on it is not tracked)"
                    % (len(watchable), MAX_MEMBER_LISTENERS, fn.name),
                )
                continue
            cb = self._make_member_callback(st, fn.name)
            for m in watchable:
                adder = getattr(m.param, "add_value_listener", None)
                if not callable(adder):
                    continue
                try:
                    adder(cb)
                except _LOM_ERRORS as e:
                    self._warn_once(
                        st.device_path, "memberlistener:" + fn.name,
                        "add_value_listener raised: %s" % e,
                    )
                    continue
                st.member_listeners.append((m.param, cb))
                budget -= 1
        logger.debug(
            "DrumVirtualMacroComponent: %s watching %d member parameter(s)",
            st.device_path, len(st.member_listeners),
        )

    def _detach_member_listeners(self, st: _RackState) -> None:
        for param, cb in st.member_listeners:
            remover = getattr(param, "remove_value_listener", None)
            if not callable(remover):
                continue
            try:
                remover(cb)
            except _LOM_ERRORS as e:
                logger.debug(
                    "DrumVirtualMacroComponent: remove_value_listener on %s "
                    "raised: %s", st.device_path, e,
                )
        st.member_listeners = []
        st.edited = set()

    # --- pad instrument names (ADR-439) --------------------------------------

    def _attach_name_listeners(self, st: _RackState, instruments: list[object]) -> None:
        """Watch each pad instrument's ``name``. A similar-sample swap made in
        Live's own UI renames the Drum Sampler (or Simpler) after its new
        sample and fires nothing else this component observes — the chain's
        devices and every parameter stay put — so this is what re-emits
        the census with the new pad labels. The callback is the change
        callback: it marks and schedules the usual re-seed, and reads nothing
        in the notification. At most one instrument per pad, so at most 128."""
        if self._disconnected:
            return
        cb = self._make_change_callback(st, "instrument_name")
        for device in instruments:
            adder = getattr(device, "add_name_listener", None)
            if not callable(adder):
                continue
            try:
                adder(cb)
            except _LOM_ERRORS as e:
                self._warn_once(st.device_path, "namelistener", f"add_name_listener raised: {e}")
                continue
            st.name_listeners.append((device, cb))

    def _detach_name_listeners(self, st: _RackState) -> None:
        for device, cb in st.name_listeners:
            remover = getattr(device, "remove_name_listener", None)
            if not callable(remover):
                continue
            try:
                remover(cb)
            except _LOM_ERRORS as e:
                logger.debug(
                    "DrumVirtualMacroComponent: remove_name_listener on %s raised: %s",
                    st.device_path, e,
                )
        st.name_listeners = []

    def _make_member_callback(self, st: _RackState, function: str) -> Callable[[], None]:
        """One callback per function, shared by its members: the absorb
        re-reads the whole function anyway, so which member fired is not
        worth a closure apiece on a kit with hundreds of them."""
        def _on_member_value():
            if self._disconnected or self._fanning_out or not self._is_held(st):
                return
            st.edited.add(function)
            self._schedule_absorb(st)
        return _on_member_value

    def _schedule_absorb(self, st: _RackState) -> None:
        if st.absorb_scheduled:
            return
        if self._schedule_delayed is None:
            self._absorb_edits(st)
            return
        st.absorb_scheduled = True
        try:
            self._schedule_delayed(EDIT_ABSORB_DELAY_MS, lambda: self._absorb_edits(st))
        except Exception as e:
            st.absorb_scheduled = False
            logger.warning(
                "DrumVirtualMacroComponent: schedule_delayed failed: %s", e,
            )

    def _absorb_edits(self, st: _RackState) -> None:
        """Deferred half of the member value listeners: read back every
        function that fired and sort what changed. Reads only — nothing
        here writes the LOM.

        A delta at least two pads share, and the most common one, is a
        **kit move** — Live's Edit → Undo of our own gesture, a macro, a
        hand move of the whole kit — and is adopted into the held value
        and re-emitted, so the control on screen follows Live instead of
        going stale. What remains per member is the user's own edit and
        moves that member's deviation, so the next fan-out keeps it."""
        st.absorb_scheduled = False
        if self._disconnected or not self._is_held(st):
            return
        functions, st.edited = st.edited, set()
        for name in sorted(functions):
            fn = self._function(st, name)
            if fn is None or fn.kind != KIND_T:
                continue
            try:
                moved, touched = self._absorb_function(st, fn)
            except Exception as e:
                self._warn_once(
                    st.device_path, "absorb:" + name,
                    "absorb raised: %s: %s" % (type(e).__name__, e),
                )
                continue
            if moved and name in st.subscribed:
                self._safe_emit(
                    V3_PROPERTY_VALUE_ADDRESS,
                    (st.device_path, PROPERTY_PREFIX + name, st.values.get(name)),
                )
            # A pad row someone is watching follows the pad it describes: on
            # a kit move every pad moved, otherwise only the edited ones.
            if moved or touched:
                for sub in sorted(st.subscribed):
                    parsed = parse_pad_function(sub)
                    if parsed is None or parsed[1] != name:
                        continue
                    if moved or parsed[0] in touched:
                        self._safe_emit(
                            V3_PROPERTY_VALUE_ADDRESS,
                            (st.device_path, PROPERTY_PREFIX + sub, self._pad_read(st, parsed[0], name)),
                        )

    def _absorb_function(self, st: _RackState, fn: VirtualMacro) -> Tuple[bool, Set[int]]:
        """Classify one function's member read-backs. Returns whether the
        held kit value moved (and so wants a re-emit) and the notes of the
        pads whose deviation changed.

        The rules are :meth:`_reconcile_pitch`'s, in ``t`` space: a read
        equal to the pre-write value inside :data:`STALE_READ_WINDOW_MS`
        of our write is that write still landing (neither a vote nor an
        edit); a member whose last write sat at a rail cannot vote,
        because the clamp hid part of any move, and takes no deviation
        from one — the write that pinned it there already re-anchored its
        deviation to the rail (:meth:`_write_members`)."""
        touched: Set[int] = set()
        recs = st.edits.get(fn.name)
        if not recs or self._legacy_macro(st, fn) is not None:
            return False, touched
        held = st.values.get(fn.name)
        if held is None:
            return False, touched
        now = self._clock()
        window = STALE_READ_WINDOW_MS / 1000.0
        votes: Dict[float, int] = {}
        changed: List[Tuple[_MemberEdit, float, bool, float, int]] = []
        for m in st.members.get(fn.name) or ():
            if not m.enabled or not self._tracks_edits(fn, m):
                continue
            rec = recs.get((m.note, m.pname))
            if rec is None:
                continue
            cur = self._member_fn_value(m)
            if cur is None:
                continue
            if rec.written is None:
                rec.written = cur
                rec.written_at = now
                continue
            at_rail = rec.written <= DEV_EPSILON or rec.written >= 1.0 - DEV_EPSILON
            if abs(cur - rec.written) <= DEV_EPSILON:
                rec.prev = None
                if not at_rail:
                    votes[0.0] = votes.get(0.0, 0) + 1
                continue
            if (rec.prev is not None and abs(cur - rec.prev) <= DEV_EPSILON
                    and (now - rec.written_at) <= window):
                continue
            rec.prev = None
            delta = cur - rec.written
            changed.append((rec, delta, at_rail, cur, m.note))
            if not at_rail:
                key = round(delta, DEV_VOTE_DP)
                votes[key] = votes.get(key, 0) + 1
        if not changed:
            return False, touched
        move = 0.0
        if votes:
            top = max(votes.values())
            winners = [d for d, n in votes.items() if n == top]
            if len(winners) == 1 and abs(winners[0]) > DEV_EPSILON and top >= 2:
                move = winners[0]
        moved = False
        if move:
            new_held = _clamp(float(held) + move, 0.0, 1.0)
            if abs(new_held - float(held)) > DEV_EPSILON:
                st.values[fn.name] = new_held
                moved = True
                logger.debug(
                    "DrumVirtualMacroComponent: %s %s kit moved %+.3f in Live; "
                    "held -> %.3f", st.device_path, fn.name, move, new_held,
                )
        for rec, delta, at_rail, cur, note in changed:
            if move and at_rail:
                rec.written = cur
                continue
            if move:
                delta -= move
            if abs(delta) > DEV_EPSILON:
                rec.dev = _clamp(rec.dev + delta, -1.0, 1.0)
                touched.add(note)
            rec.written = cur
        return moved, touched

    def _is_held(self, st: _RackState) -> bool:
        return self._states.get(st.device_path) is st

    def _schedule_reseed(self, st: _RackState) -> None:
        if st.reseed_scheduled:
            return
        if self._schedule_delayed is None:
            self._reseed_and_emit(st)
            return
        st.reseed_scheduled = True
        try:
            self._schedule_delayed(
                RESEED_DELAY_MS, lambda: self._reseed_and_emit(st),
            )
        except Exception as e:
            st.reseed_scheduled = False
            logger.warning(
                "DrumVirtualMacroComponent: schedule_delayed failed: %s", e,
            )

    def _reseed_and_emit(self, st: _RackState) -> None:
        """Deferred half of a change listener: re-read the members (reads
        only — no writes here), fill in values that were missing, and
        push every subscribed function so the UI sees the new kit. The
        scheduled flag is cleared first, whatever happens next, so a
        state that was released or moved in the meantime can schedule
        again later."""
        st.reseed_scheduled = False
        if self._disconnected or not self._is_held(st):
            return
        try:
            self._resolve(st)
            self._seed(st, only_missing=True)
        except Exception as e:
            self._warn_once(st.device_path, "reseed", "re-seed raised: %s" % e)
            return
        for function in sorted(st.subscribed):
            self._safe_emit(
                V3_PROPERTY_VALUE_ADDRESS,
                (st.device_path, PROPERTY_PREFIX + function, self._emit_value(st, function)),
            )

    # --- logging ----------------------------------------------------------

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning("DrumVirtualMacroComponent: emit %s failed: %s", address, e)

    def _warn_once(self, device_path: str, key: str, message: str) -> None:
        k = (device_path, key)
        if k in self._warned:
            return
        self._warned.add(k)
        logger.warning("DrumVirtualMacroComponent: %s: %s", device_path, message)
