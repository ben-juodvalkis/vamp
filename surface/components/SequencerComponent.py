"""SequencerComponent — the surface owns Permute's engine (permute ADR-020).

The thin Permute device (``Vamp Devices/Permute/Permute.amxd``)
is nothing but 38 ``live.*`` pattern controls: ``Mute 1 … Mute 16``,
``Mute Length``, ``Mute Rate``, ``Pitch 1 … Pitch 16``, ``Pitch Length``,
``Pitch Rate``, ``Chance``, ``Temperature`` (steps 9–16 of each lane are
appended after the other 22, ADR-443). It has no clock and no code.
This component is the code: for every device named ``Permute`` (class
``MxDeviceAudioEffect``) on a regular track it runs the two step
sequencers the fat device used to run in Max, and it emits the step
telemetry the UI's mini sequencers read.

Always on
---------
Until 2026-09-26 everything here sat behind a persisted session toggle,
``sequencer_engine`` (default OFF), because a set still holding the fat
Permute must never have that device's own JS and this engine acting on one
track. The fat device, its step ingest (``PermuteStepComponent``) and the
toggle are gone: this engine is Permute. A set that still holds a fat
Permute needs its devices swapped for the thin one. ``is_enabled`` stays as
an injection point — ``None`` (production) is on; a getter reading False
restores whatever the engine applied and goes quiet, the path tests drive.

Clock
-----
``tick()`` runs from the fast drain pump's Timer (``drain_pump.
FastDrainPump.add_tick_hook``, 92.8 Hz measured) — the surface's
steadiest tick and a legal LOM write context (the Drum Rack fan-out
already writes from it). ``LoopingSurface._tick`` calls it as a
fallback when the pump is not running. Each tick reads
``song.is_playing`` / ``current_song_time`` / ``tempo`` /
``signature_numerator`` once, converts the position to ticks
(480/quarter) and, per device, computes each sequencer's step with the
ported math in :mod:`sequencer_math`. Nothing happens on a tick that
does not cross a step boundary.

**Lookahead.** Live triggers a note *at* the boundary, so a write that
lands one tick after it is late by construction (the fat device's
metro → low-priority thread → LiveAPI path had the same shape). The
engine keeps an EMA of its own tick interval and evaluates each step at
``now + lead`` (:func:`sequencer_math.lead_ticks`).

The lead was one tick interval until 2026-09-09. Measured on the real
rig — 10 devices, 97.7 BPM, a clean 60 s window — that put only **66.8 %**
of transitions ahead of the boundary (median 2.1 ms early, p95 +7.5 ms
*late*, p99 +47.9). The interval is the clock's granularity, not
headroom: it says when the engine can next act, and nothing about the
time Live needs to act on the write before it reads the note. The fat
device's flat 120 ticks (a 1/16) was headroom.

So the lead is now ``max(one tick interval, a 1/32)``, clamped to half a
step. In ticks, so it scales with tempo; the 1/32 stays inside the gap
after a preceding 1/16 note so the state does not flip early on the note
*before* the boundary; the clamp only bites at the 1/16 rate. It is
computed per sequencer, since the mute and pitch rates rarely match.

Per transition the engine records how early or late it was
(``now − boundary``, ms; negative = early) —
``/looping/probe/sequencer_stats`` reports the distribution.

Pattern
-------
Read-only, and cached. The 38 values are read once per device (by
parameter **name**, never index) and kept fresh by the per-parameter
value listeners ``LOMListeners`` already attaches to every parameter in
the set: ``on_param_value_changed(parameter, path)`` maps the
parameter's stable LOM id to ``(device, role)``. The engine never
writes a pattern parameter — steps, rates and lengths are automated
with clip envelopes, and a write would fight the envelope. The cache
is **sampled at step boundaries**: an envelope that changes a toggle,
rate or length mid-step takes effect at the next boundary, exactly as
the fat device behaved.

Actions
-------
Delta-based, as in the fat device: a step whose value equals the last
applied value does nothing. ``mute`` acts while a mute step reads 0,
``pitch`` while a pitch step reads 1; chance and temperature follow
the sliders.

**Pitch (+12 st while a pitch step is on) routes by class, never by
name** (issue #489 addendum, the user's rule):

- the track's instrument *contains a Drum Rack* (a top-level
  ``DrumGroupDevice``, or one nested in an Instrument Rack) → the shift
  is a term on ``DrumVirtualMacroComponent``'s pitch —
  ``pitch = clamp(global + offsets[note] + shift)`` per member, through
  the same fan-out / legacy-macro / undo path as ``vm.pitch``; the UI
  never sees the term. Needs no clip, so it applies with none playing.
- a melodic MIDI instrument (an Instrument Rack without a Drum Rack
  follows this path) → every note of the playing clip moves up by the
  octave through ``apply_note_modifications`` (ids preserved); each note
  remembers its own delta (clamped at 127) and moves back by exactly
  that, so notes added while shifted keep the pitch they were recorded
  at.
- an audio clip → ``Clip.pitch_coarse`` +12 relative to what the clip
  had, clamped ±48; the restore adopts any re-pitching the user did
  while shifted (permute ADR-019's audio rule).

**Mute (while a mute step reads 0):** on a MIDI clip every unmuted note
gets ``note.mute`` set, and only those notes are unmuted again, so a note
the user muted stays muted and a note recorded while the step held keeps
playing; on an audio clip the clip ``gain`` goes to 0 and comes back to
what it was — or to a gain set while it held, which it adopts rather than
lets through: the clip view's Gain fader (``adopt_gain``; the fader shows
``held_gain``, never the 0) or a gain edit in Live itself, which the next
tick silences again. **Solo override**, as in the fat device: while the device's
track is soloed the mute sequencer reads as "play" on every step, and the
flip either way applies at once rather than at the next boundary.

A clip change under a held step gives the old clip back what it carried
and applies the held state to the new one.

**Chance** is the slider, written through: ``note.probability`` on every
note of the current MIDI clip. A slider move applies at once (transport
running or not, and a move back to 1.0 writes 1.0 — the slider is
authoritative); a clip change and a transport start re-apply it while it
is below 1.0, so a clip the user drew probabilities into is left alone
until the slider says otherwise. Nothing restores it: probability is
what the slider says it is, and it survives stop, as in the fat device.

**Temperature** is the base model of permute ADR-015, ported. When the
slider leaves 0 the current MIDI clip's notes are captured by ``note_id``
as the *base model* (true base pitch: the pitch sequencer's per-note
octave removed), a variation is written at once and on every loop jump
— always derived from the base, never from the previous scramble, so
variation is non-cumulative by construction — and the slider going back
to 0 rewrites the base verbatim (plus the octave, if a pitch step still
holds it). A ``notes`` listener on the clip tells a user edit from the
engine's own writes by **content**: before every note write the engine
records the exact pitches it wrote (``expected``; the mute, chance and
pitch writes record theirs too), and a notification whose notes differ
from that — an added or removed note, or one repitched away from
``expected`` — is the user's, and re-baselines: untouched notes are put
back to their base pitch first, the edited notes define the new
composition, and a fresh variation follows. Notes not in the base (an
overdub the observer has not folded in yet) are never swapped, so a
return to 0 that lands before the observer fires keeps them at the
pitch they were played. Transport stop, a clip change, the toggle going
off, device removal and ``disconnect`` write the base back and drop the
model; the next start captures afresh from the clean clip.

Pads (ADR-435, 2026-09-14)
--------------------------
A Permute inside a Drum Rack pad's chain (``drum_pads[note].chains[0]``,
path ``…/pads/<note>/devices/<K>``) is an instance of its own that acts
on **that pad only**: its pitch step is a per-pad term on the drum
provider (``set_pad_sequencer_shift`` — ``pitch = global + offset + kit
shift + pad shift``, so it composes with a track-level Permute's octave
rather than competing with it, the user's rule), its mute and chance
touch only the clip's notes at the pad's pitch, and Temperature is
inert on it (a pitch swap among one pitch is a no-op). Under the
*kit's* Temperature the pad's mute and Chance follow the pad, not the
note (ADR-435 addendum, 2026-09-18): when the kit's variation or its
return to base moves a note onto a pad whose mute step holds, that
note is muted in the same write and the pad remembers it; a note the
pad muted that moves off it is unmuted; a mover's probability becomes
the value of whichever Chance governs where it landed, when that
Chance has been applied to the clip (``_settle_pads``). The pad's
unmute clears its remembered ids wherever the swap has put them.
Notes the kit does not move are never touched, so a note recorded on
a held pad keeps playing and a hand-muted note stays muted. Discovery walks
each top-level Drum Rack's populated pad chains alongside the track (a
rack nested in an Instrument Rack is not walked: the wire has no path
to a pad under ``chains/``). A ``PadChainWatcher`` per rack asks for a
rescan when a chain changes shape — run on the tick, past the window a
chain needs to populate — so a device dropped into a pad in Live
reaches the engine with no client connected. The track's value
listeners never reach a chain device and the pad-chain component's
exist only while a client holds the pad, so a pad instance keeps its
own 38. The track-level Permute's Chance skips the pitches a pad
Permute governs, so the pad's own value wins there (mute and pitch
compose; a probability is one number per note).

Restore
-------
Transport stop, a toggle flip to OFF, a device leaving, a clip change
under a held step, and ``disconnect`` all restore what was applied.
Writes never happen inside a LOM listener callback (repo rule): the
structural / removal callbacks only mark an instance as retiring, and
the next tick does the restore.

"Current clip"
--------------
The track's playing slot, read through ``PlayheadComponent.
playing_clip`` (a query on the component that already owns the
per-track ``playing_slot_index`` listeners — no second listener).
Audio vs MIDI decides the action path.

Telemetry
---------
``/looping/v3/permute/step [devicePath, kind, step]`` on every step
change, ``-1`` per kind on stop / disable / removal / disconnect — the
only emitter of that wire since the fat device's ingest was removed.
"""

from __future__ import annotations

import collections
import json
import logging
import random
import time
import traceback
from typing import Callable, Dict, List, Optional, Set, Tuple

from . import sequencer_math as sm
from . import sequencer_shuffle as shuffle
from .DrumPadChainComponent import PadChainWatcher
from .drum_vm_resolve import find_track_drum_rack
from .LOMListeners import _safe_int_id

logger = logging.getLogger("looping")

_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)

# --- wire -----------------------------------------------------------------

V3_PERMUTE_STEP_ADDRESS = "/looping/v3/permute/step"
SEQUENCER_STATS_ADDRESS = "/looping/probe/sequencer_stats"

#: Private Surf→M4L wire, the mirror of ``/looping/permute/step``'s
#: M4L→Surf: the mute lane's state for one track, sent straight to a Max
#: device's own ``udpreceive`` rather than through the bridge (the route
#: ``owner/Max Patches/foot-trigger.js`` already uses inbound). Args are
#: ``(trackIndex:int, open:int 0|1)``.
#:
#: It exists because every other way this engine silences something is a
#: LOM write, and Live records **one undo step per parameter write**: a
#: mute lane at a 1/16 rate fills the undo stack with the engine's own
#: bookkeeping. A device that gates what it *plays* costs nothing there —
#: and on an instrument that free-runs it is the only thing that works at
#: all, since there is no clip for a mute to land on. A macro route was
#: tried for this on 2026-09-17 and removed the same day for exactly the
#: undo reason, and because the knob it flipped is one a performer plays.
V3_PERMUTE_GATE_ADDRESS = "/looping/permute/gate"
#: How often the gate is re-stated while the engine is on. The receiving
#: device fails OPEN if nothing arrives for a few seconds, so this is both
#: what keeps a shut gate shut and what heals a dropped datagram — a lost
#: "open" costs one heartbeat of silence instead of the rest of a set.
GATE_HEARTBEAT_S = 1.0

# --- the device -------------------------------------------------------------

#: Load-bearing literal, shared with ``TrackPrepareComponent._track_has_sequencer``
#: and the UI's ``sequencerByPath``: the ``.amxd`` must keep this name.
PERMUTE_DEVICE_NAME = "Permute"
PERMUTE_CLASS_NAME = "MxDeviceAudioEffect"

KIND_MUTE = "mute"
KIND_PITCH = "pitch"
KINDS = (KIND_MUTE, KIND_PITCH)

DRUM_RACK_CLASS_NAME = "DrumGroupDevice"
INSTRUMENT_RACK_CLASS_NAME = "InstrumentGroupDevice"
OCTAVE_SEMITONES = 12
MIDI_PITCH_MAX = 127
PITCH_COARSE_MIN = -48
PITCH_COARSE_MAX = 48
#: Note fields kept in the temperature base model so a return to 0
#: restores the whole note, not just its pitch (permute ADR-015).
BASE_MODEL_FIELDS = (
    "pitch", "start_time", "duration", "velocity", "mute",
    "probability", "velocity_deviation", "release_velocity",
)

#: Parameter long names per role — the contract with the device (mirror of
#: ``interface/src/lib/config/permuteLayout.ts``).
#: The device's cells per lane (ADR-443; it was eight until 2026-09-18).
DEVICE_STEPS = 16
MUTE_STEP_ROLES = tuple("mute%d" % i for i in range(1, DEVICE_STEPS + 1))
PITCH_STEP_ROLES = tuple("pitch%d" % i for i in range(1, DEVICE_STEPS + 1))
ROLE_NAMES: Dict[str, str] = {}
for _i in range(1, DEVICE_STEPS + 1):
    ROLE_NAMES["mute%d" % _i] = "Mute %d" % _i
    ROLE_NAMES["pitch%d" % _i] = "Pitch %d" % _i
ROLE_NAMES.update({
    "muteLength": "Mute Length",
    "muteRate": "Mute Rate",
    "pitchLength": "Pitch Length",
    "pitchRate": "Pitch Rate",
    "chance": "Chance",
    "temperature": "Temperature",
})
NAME_ROLES: Dict[str, str] = {name: role for role, name in ROLE_NAMES.items()}
#: What a missing role reads as (the device defaults, measured 2026-09-07).
ROLE_DEFAULTS: Dict[str, float] = {
    "muteLength": 8, "muteRate": 3, "pitchLength": 8, "pitchRate": 3,
    "chance": 1.0, "temperature": 0.0,
}
for _r in MUTE_STEP_ROLES:
    ROLE_DEFAULTS[_r] = 1.0
for _r in PITCH_STEP_ROLES:
    ROLE_DEFAULTS[_r] = 0.0

#: Tick-interval EMA seed and clamp (seconds). The pump measures 10.8 ms;
#: a stalled control thread can produce a multi-second gap that must not
#: become the lookahead, and a burst of near-simultaneous fires must not
#: collapse it to zero.
INTERVAL_SEED_S = 0.0108
INTERVAL_MIN_S = 0.004
INTERVAL_MAX_S = 0.040
#: Bounded lag sample buffer for the stats probe.
LAG_SAMPLES = 4096
#: Ticks slower than this are logged (once per burst) — a tick is a few
#: reads and, on a boundary, a handful of writes.
SLOW_TICK_WARN_S = 0.020
#: A pad chain's ``devices`` listener asks for a rescan this long after it
#: fires (ADR-435): the tick is a write-legal context for the restore a
#: retired instance needs, and a chain populates after the add fires
#: (ADR-430's margin).
PAD_RESCAN_DELAY_S = 0.15


# --- per-device state -------------------------------------------------------


class _Seq:
    """One of the two step sequencers on a device."""

    __slots__ = ("kind", "current_step", "last_value", "ticks_per_step", "length")

    def __init__(self, kind: str) -> None:
        self.kind = kind
        self.current_step = -1
        self.last_value = None
        self.ticks_per_step = 0
        self.length = 8

    def reset(self) -> None:
        self.current_step = -1
        self.last_value = None


class _ClipState:
    """What the engine has applied to one clip (keyed by clip LOM id).

    Filled in by the action phases: ``pitch_applied`` / ``mute_applied``
    say whether the clip currently carries the engine's shift / mute;
    the ``*_home`` fields hold what to restore on an audio clip; the
    temperature base model lives here too once that phase lands.
    """

    __slots__ = (
        "clip", "clip_id", "slot_idx", "is_midi", "is_audio",
        "pitch_applied", "pitch_deltas", "pitch_shift",
        "pitch_coarse_home", "pitch_coarse_written",
        "mute_applied", "muted_ids", "gain_home", "gain_rezero",
        "chance_applied", "base_model", "expected",
        "temp_loop_cb", "temp_notes_cb", "temp_variation_pending", "temp_notes_changed",
    )

    def __init__(self, clip, clip_id: int, slot_idx: int, is_midi: bool, is_audio: bool) -> None:
        self.clip = clip
        self.clip_id = clip_id
        self.slot_idx = slot_idx
        self.is_midi = is_midi
        self.is_audio = is_audio
        self.pitch_applied = False
        # note_id → semitones this engine added (melodic path), so the
        # restore subtracts exactly what was added, per note.
        self.pitch_deltas: Dict[int, int] = {}
        # The octave currently on the clip's notes (0 or 12) — the term
        # the temperature base model subtracts (permute ADR-015).
        self.pitch_shift = 0
        self.pitch_coarse_home = None
        self.pitch_coarse_written = None
        self.mute_applied = False
        # note_ids this engine muted (melodic path) — the only ones it unmutes.
        self.muted_ids: set = set()
        self.gain_home = None
        # The clip's gain was edited in Live while a mute step held it: the
        # next tick puts the 0 back (a notification cannot write).
        self.gain_rezero = False
        self.chance_applied = None
        # Temperature (ADR-015): note_id → base note dict, and note_id →
        # pitch the engine last wrote (the own-write signature).
        self.base_model: Optional[Dict[int, dict]] = None
        self.expected: Optional[Dict[int, int]] = None
        self.temp_loop_cb = None
        self.temp_notes_cb = None
        self.temp_variation_pending = False
        self.temp_notes_changed = False

    def dirty(self) -> bool:
        return bool(self.pitch_applied or self.mute_applied or self.base_model is not None)


class _Instance:
    """One thin Permute device: its handles, pattern cache and sequencers."""

    __slots__ = (
        "device", "device_id", "track", "track_idx", "device_path",
        "params", "values", "mute", "pitch",
        "slot_idx", "clip_state", "pending_restore", "retired_path",
        "drum_shift", "rack", "rack_path", "solo_last", "chance_dirty",
        "temperature_dirty", "temperature_last", "pad_note", "own_listeners",
    )

    def __init__(
        self, track, track_idx: int, device, device_id: int, device_path: str,
        pad_note: Optional[int] = None,
    ) -> None:
        self.device = device
        self.device_id = device_id
        self.track = track
        self.track_idx = track_idx
        self.device_path = device_path
        self.params: Dict[str, object] = {}
        self.values: Dict[str, float] = dict(ROLE_DEFAULTS)
        self.mute = _Seq(KIND_MUTE)
        self.pitch = _Seq(KIND_PITCH)
        # Playing-slot tracking: -1 when nothing plays; ``clip_state`` is
        # the clip at that slot (None when the slot is empty / unreadable).
        self.slot_idx = -1
        self.clip_state: Optional[_ClipState] = None
        self.pending_restore = False
        self.retired_path = ""
        # Pitch routing: the Drum Rack the track's instrument contains (top
        # level or nested one deep in an Instrument Rack), or None → the
        # clip decides (notes on MIDI, pitch_coarse on audio).
        self.rack = None
        self.rack_path = ""
        # Pitch shift term the drum path currently holds (0 or 12).
        self.drum_shift = 0
        # The track's solo state as last seen (the mute override).
        self.solo_last = False
        # The Chance slider moved since the last apply (set from the value
        # listener, a notification context; the write runs on the tick).
        self.chance_dirty = False
        # Temperature transitions are edge-based on the slider value.
        self.temperature_dirty = False
        self.temperature_last = 0.0
        # ADR-435: the pad this Permute sits in (``drum_pads[note]``), or
        # None for a track-level device. A pad instance acts on that pad
        # alone and keeps its own pattern listeners (``own_listeners``:
        # ``(parameter id, parameter, callback)``).
        self.pad_note = pad_note
        self.own_listeners: List[Tuple[int, object, Callable[[], None]]] = []

    def seqs(self) -> Tuple[_Seq, _Seq]:
        return (self.mute, self.pitch)

    def active(self) -> bool:
        """Anything applied or any sequencer past its idle step?"""
        if self.mute.current_step >= 0 or self.pitch.current_step >= 0:
            return True
        if self.drum_shift:
            return True
        cs = self.clip_state
        return cs is not None and cs.dirty()


class _LagStats:
    """Bounded record of apply lag (ms, negative = early) per transition."""

    def __init__(self, maxlen: int = LAG_SAMPLES) -> None:
        self.samples: collections.deque = collections.deque(maxlen=maxlen)
        self.total = 0
        self.last = None

    def record(self, lag_ms: float, tempo: float) -> None:
        self.samples.append((lag_ms, tempo))
        self.total += 1
        self.last = lag_ms

    def reset(self) -> None:
        self.samples.clear()
        self.total = 0
        self.last = None

    def summary(self) -> Dict[str, object]:
        lags = sorted(l for l, _t in self.samples)
        out: Dict[str, object] = {"count": len(lags), "total": self.total, "last_ms": self.last}
        if not lags:
            return out

        def pct(p: float) -> float:
            return lags[min(len(lags) - 1, int(p * len(lags)))]

        out.update({
            "mean_ms": round(sum(lags) / len(lags), 3),
            "p50_ms": round(pct(0.5), 3),
            "p95_ms": round(pct(0.95), 3),
            "p99_ms": round(pct(0.99), 3),
            "min_ms": round(lags[0], 3),
            "max_ms": round(lags[-1], 3),
            "early_share": round(sum(1 for l in lags if l <= 0) / float(len(lags)), 3),
            "tempo_bpm": round(self.samples[-1][1], 2),
        })
        return out


# --- component --------------------------------------------------------------


class SequencerComponent:
    """The engine behind every thin Permute device in the set.

    Args:
        song: the Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
        is_enabled: zero-arg on/off getter. ``None`` means always on — what
            production passes since the ``sequencer_engine`` toggle went
            (2026-09-26); tests use a getter to drive the off path.
        playhead: ``PlayheadComponent`` — its ``playing_clip(track)`` query
            resolves the current clip. ``None`` → the engine resolves the
            playing slot itself through the same guarded reads.
        drum_vm: ``DrumVirtualMacroComponent`` — the pitch action's drum
            path adds its shift term there (S2). ``None`` disables it.
        clock: monotonic seconds, injectable for tests.
        lookahead: evaluate steps ``lead_ticks`` ahead (see module doc).
            ``False`` evaluates at ``now`` — every transition then lands
            after its boundary. Tests use it to pin the un-led timing.
    """

    V3_PERMUTE_STEP_ADDRESS = V3_PERMUTE_STEP_ADDRESS
    SEQUENCER_STATS_ADDRESS = SEQUENCER_STATS_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        gate_emit: Optional[Callable[[str, tuple], None]] = None,
        is_enabled: Optional[Callable[[], bool]] = None,
        playhead=None,
        drum_vm=None,
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        clock: Callable[[], float] = time.monotonic,
        lookahead: bool = True,
        rng: Optional[random.Random] = None,
    ) -> None:
        self._rng = rng or random.Random()
        self._song = song
        self._emit = emit
        # Separate sender because it has a separate DESTINATION: ``emit``
        # goes to the bridge and on to the UI, this goes to a Max device's
        # own UDP port. None when nothing wired it, and then the gate is
        # simply never spoken — every receiver fails open.
        self._gate_emit = gate_emit
        self._is_enabled = is_enabled
        self._playhead = playhead
        self._drum_vm = drum_vm
        self._schedule_delayed = schedule_delayed
        self._clock = clock
        self._lookahead = lookahead
        self._disconnected = False

        self._instances: Dict[int, _Instance] = {}
        self._pid_index: Dict[int, Tuple[_Instance, str]] = {}
        self._retiring: List[_Instance] = []
        # ADR-435: one shape watcher per top-level Drum Rack, keyed by the
        # rack's LOM id, and the deferred rescan a chain change asks for.
        self._watchers: Dict[int, PadChainWatcher] = {}
        self._rescan_due: Optional[float] = None
        self._rescan_ms_last = 0.0
        self._rescan_ms_max = 0.0

        self._last_tick_mono = 0.0
        self._interval_ema = INTERVAL_SEED_S
        self._active = False
        self._enabled_last = None
        self._lag = _LagStats()
        self._tick_count = 0
        self._tick_max_s = 0.0
        self._slow_ticks = 0
        # Diagnostic counters for the stats probe.
        self._counters: Dict[str, int] = {
            "transitions": 0, "stop_all": 0, "rescans": 0, "pad_rescans": 0, "retired": 0,
            "clip_changes": 0, "pitch_applies": 0, "mute_applies": 0,
            "chance_applies": 0, "temp_variations": 0, "temp_rebaselines": 0,
            "gate_emits": 0,
        }
        self._warned: set = set()
        #: Next monotonic time the gate heartbeat is due.
        self._gate_due = 0.0

        self.rescan()
        logger.info(
            "SequencerComponent: ready (%d Permute device(s): %s; lookahead=%s)",
            len(self._instances),
            ", ".join(sorted(i.device_path for i in self._instances.values())) or "none",
            self._lookahead,
        )

    # --- discovery ----------------------------------------------------------

    @staticmethod
    def is_permute(device) -> bool:
        try:
            return (
                getattr(device, "class_name", None) == PERMUTE_CLASS_NAME
                and getattr(device, "name", None) == PERMUTE_DEVICE_NAME
            )
        except _LOM_ERRORS:
            return False

    def rescan(self) -> None:
        """Walk the regular tracks for thin Permute devices: on each
        track's top-level chain and, since ADR-435, inside every populated
        pad chain of each top-level Drum Rack.

        Survivors keep their runtime state (matched by device LOM id,
        never ``is``); handles and paths are refreshed because Live hands
        out fresh wrappers per read and paths embed positions (ADR-350).
        Devices that left are retired — their restore runs on the next
        tick, since this may be running inside a LOM notification. Each
        Drum Rack's shape watcher is attached on first sight and refreshed
        on every pass (a pad that gained a chain is watched from then
        on), and dropped with the rack; its walk of the pads is the one
        discovery reads.
        """
        if self._disconnected:
            return
        t0 = self._clock()
        self._counters["rescans"] += 1
        # device id → (track, track index, device, path, rack, rack path, pad note)
        found: Dict[int, Tuple[object, int, object, str, object, str, Optional[int]]] = {}
        racks: Set[int] = set()
        for ti, track in enumerate(self._safe_tracks()):
            for di, device in enumerate(self._safe_devices(track)):
                if self.is_permute(device):
                    did = _safe_int_id(device)
                    if did is not None:
                        found[did] = (track, ti, device, "tracks/%d/devices/%d" % (ti, di), None, "", None)
                    continue
                if self._safe_class_name(device) != DRUM_RACK_CLASS_NAME:
                    continue
                rid = _safe_int_id(device)
                if rid is None:
                    continue
                rack_path = "tracks/%d/devices/%d" % (ti, di)
                racks.add(rid)
                for note, chain in self._watch_rack(rid, device, rack_path):
                    for ki, dev in enumerate(self._safe_devices(chain)):
                        if not self.is_permute(dev):
                            continue
                        did = _safe_int_id(dev)
                        if did is None:
                            continue
                        found[did] = (
                            track, ti, dev, "%s/pads/%d/devices/%d" % (rack_path, note, ki),
                            device, rack_path, note,
                        )
        for rid in [r for r in self._watchers if r not in racks]:
            self._watchers.pop(rid).detach()
        for did in list(self._instances):
            if did not in found:
                self._retire(self._instances.pop(did))
        for did, (track, ti, device, path, rack, rack_path, note) in found.items():
            inst = self._instances.get(did)
            if inst is None:
                inst = _Instance(track, ti, device, did, path, pad_note=note)
                self._instances[did] = inst
                logger.info("SequencerComponent: engine attached to %s", path)
            else:
                if inst.device_path != path:
                    logger.info(
                        "SequencerComponent: %s moved to %s", inst.device_path, path,
                    )
                inst.track, inst.track_idx, inst.device, inst.device_path = track, ti, device, path
            self._index_params(inst)
            if note is None:
                self._resolve_route(inst)
            else:
                self._set_rack(inst, rack, rack_path)
        self._rebuild_pid_index()
        ms = (self._clock() - t0) * 1000.0
        self._rescan_ms_last = ms
        self._rescan_ms_max = max(self._rescan_ms_max, ms)

    def _watch_rack(self, rack_id: int, rack, rack_path: str) -> List[Tuple[int, object]]:
        """The rack's shape watcher (ADR-435): attached on first sight,
        refreshed after — the one walk of the pads per rescan, whose
        populated ``(note, chain)`` pairs discovery reads for Permutes."""
        w = self._watchers.get(rack_id)
        if w is None:
            w = PadChainWatcher(
                rack, rack_path, self._on_pad_chain_changed,
                warn=lambda key, message, path=rack_path: self._warn_once(path, key, message),
            )
            self._watchers[rack_id] = w
            return w.attach()
        w.device, w.device_path = rack, rack_path
        return w.refresh()

    def _on_pad_chain_changed(self) -> None:
        """A pad chain, or a rack's pad list, changed shape (notification
        context): a Permute may have arrived in or left a chain. Ask the
        tick for a rescan once the chain has had time to populate."""
        if self._disconnected:
            return
        self._rescan_due = self._clock() + PAD_RESCAN_DELAY_S

    def _resolve_route(self, inst: _Instance) -> None:
        """Find the Drum Rack the track's instrument contains, if any
        (``find_track_drum_rack``: top-level, or nested one level down in
        an Instrument Rack). Everything else — melodic instruments, plain
        Instrument Racks, audio tracks — is the clip path."""
        rack, rack_path = find_track_drum_rack(inst.track, "tracks/%d" % inst.track_idx)
        self._set_rack(inst, rack, rack_path)

    def _set_rack(self, inst: _Instance, rack, rack_path: str) -> None:
        """Record the rack an instance's pitch goes to — the one its track
        contains, or the one a pad instance sits in — re-keying the drum
        provider's state when the rack's path moved."""
        if (rack is None) != (inst.rack is None) or (rack is not None and rack_path != inst.rack_path):
            logger.info(
                "SequencerComponent: %s pitch route %s", inst.device_path,
                ("%s at %s" % ("pad %d of the drum rack" % inst.pad_note if inst.pad_note is not None else "drum rack", rack_path))
                if rack is not None else "clip (notes / pitch_coarse)",
            )
        if rack is not None and inst.rack_path and rack_path != inst.rack_path:
            # The rack's path moved (a track above it deleted): the drum
            # provider keys its state — offsets, a held shift, listeners —
            # by path, so re-key it now. Bookkeeping only, no LOM writes:
            # this runs inside the structural notification.
            self._rebind_drum_state(inst, rack, rack_path)
        inst.rack, inst.rack_path = rack, rack_path

    def _rebind_drum_state(self, inst: _Instance, rack, rack_path: str) -> None:
        rebind = getattr(self._drum_vm, "rebind", None) if self._drum_vm is not None else None
        if not callable(rebind):
            return
        try:
            rebind(rack, rack_path)
        except Exception as e:
            self._warn_once(inst.device_path, "drum_rebind", "rebind raised: %s: %s" % (type(e).__name__, e))

    def _index_params(self, inst: _Instance) -> None:
        """Resolve the 38 controls by name and sample their values."""
        params: Dict[str, object] = {}
        try:
            plist = list(inst.device.parameters or ())
        except _LOM_ERRORS as e:
            self._warn_once(inst.device_path, "parameters", "parameters read raised: %s" % e)
            plist = []
        for p in plist:
            try:
                name = p.name
            except _LOM_ERRORS:
                continue
            role = NAME_ROLES.get(name)
            if role is not None and role not in params:
                params[role] = p
        missing = [r for r in ROLE_NAMES if r not in params]
        if missing:
            self._warn_once(
                inst.device_path, "missing",
                "device lacks %d control(s): %s — defaults used"
                % (len(missing), ", ".join(ROLE_NAMES[r] for r in missing)),
            )
        inst.params = params
        for role, p in params.items():
            v = self._read_value(p)
            if v is not None:
                inst.values[role] = v
        if inst.pad_note is not None:
            self._watch_own_params(inst)

    def _watch_own_params(self, inst: _Instance) -> None:
        """A pad instance's pattern listeners (ADR-435). The track's value
        listeners never reach a chain device and the pad-chain component's
        exist only while a client holds the pad, so the engine keeps its
        own: one per control, re-synced by parameter id on every rescan
        (Live hands out fresh wrappers per read; the id is stable)."""
        wanted: Dict[int, object] = {}
        for p in inst.params.values():
            pid = _safe_int_id(p)
            if pid is not None:
                wanted[pid] = p
        kept: List[Tuple[int, object, Callable[[], None]]] = []
        held: Set[int] = set()
        for pid, p, cb in inst.own_listeners:
            if pid in wanted:
                kept.append((pid, p, cb))
                held.add(pid)
            else:
                self._remove_value_listener(p, cb)
        for pid, p in wanted.items():
            if pid in held:
                continue
            adder = getattr(p, "add_value_listener", None)
            if not callable(adder):
                continue
            cb = self._make_own_callback(p)
            try:
                adder(cb)
            except _LOM_ERRORS as e:
                self._warn_once(inst.device_path, "own_listener", "add_value_listener raised: %s" % e)
                continue
            kept.append((pid, p, cb))
        inst.own_listeners = kept

    def _unwatch_own_params(self, inst: _Instance) -> None:
        for _pid, p, cb in inst.own_listeners:
            self._remove_value_listener(p, cb)
        inst.own_listeners = []

    def _make_own_callback(self, param) -> Callable[[], None]:
        def _on_value(param=param):
            if self._disconnected:
                return
            self.on_param_value_changed(param, "")
        return _on_value

    @staticmethod
    def _remove_value_listener(param, cb) -> None:
        remover = getattr(param, "remove_value_listener", None)
        if not callable(remover):
            return
        try:
            remover(cb)
        except _LOM_ERRORS:
            pass

    def _rebuild_pid_index(self) -> None:
        index: Dict[int, Tuple[_Instance, str]] = {}
        for inst in self._instances.values():
            for role, p in inst.params.items():
                pid = _safe_int_id(p)
                if pid is not None:
                    index[pid] = (inst, role)
        self._pid_index = index

    def _retire(self, inst: _Instance) -> None:
        inst.pending_restore = True
        inst.retired_path = inst.device_path
        self._retiring.append(inst)
        self._counters["retired"] += 1
        logger.info("SequencerComponent: engine detached from %s", inst.device_path)

    # --- LOMListeners hooks (notification context: reads + bookkeeping only) -

    def on_structural_change(self) -> None:
        if self._disconnected:
            return
        self.rescan()

    def on_device_removed(self, track, device_id: int) -> None:
        if self._disconnected:
            return
        inst = self._instances.pop(int(device_id), None)
        if inst is not None:
            self._retire(inst)
            self._rebuild_pid_index()

    def on_param_value_changed(self, parameter, canonical_path: str) -> None:
        """Keep the pattern cache fresh. Keyed by the parameter's LOM id,
        so path shifts cannot mis-route a value."""
        if self._disconnected or not self._pid_index:
            return
        pid = _safe_int_id(parameter)
        if pid is None:
            return
        hit = self._pid_index.get(pid)
        if hit is None:
            return
        inst, role = hit
        v = self._read_value(parameter)
        if v is not None:
            inst.values[role] = v
            if role == "chance":
                inst.chance_dirty = True
            elif role == "temperature":
                inst.temperature_dirty = True

    # --- the clip view's Gain fader (notification context: bookkeeping only) -

    def held_gain(self, clip) -> Optional[float]:
        """The gain a mute step holds ``clip`` away from — what it puts back
        when the step ends — or None when no mute step holds the clip. The
        clip view shows this instead of the 0 the clip reads, so its fader
        does not drop to the floor on every mute step."""
        for cs in self._gain_holds(clip):
            return cs.gain_home
        return None

    def adopt_gain(self, clip, value: float, rezero: bool = False) -> bool:
        """A gain set on ``clip`` while a mute step holds it at 0 becomes the
        gain the step puts back, and the clip stays silent until then. True
        when a step holds the clip: the caller must not write it.
        ``rezero``: the value already reached the clip (an edit made in Live
        itself), so the next tick writes the 0 back."""
        holds = self._gain_holds(clip)
        for cs in holds:
            cs.gain_home = float(value)
            if rezero:
                cs.gain_rezero = True
        return bool(holds)

    def _gain_holds(self, clip) -> List[_ClipState]:
        cid = _safe_int_id(clip)
        if cid is None:
            return []
        return [
            inst.clip_state for inst in self._instances.values()
            if inst.clip_state is not None
            and inst.clip_state.clip_id == cid
            and inst.clip_state.is_audio
            and inst.clip_state.mute_applied
            and inst.clip_state.gain_home is not None
        ]

    # --- clock ----------------------------------------------------------------

    def tick(self) -> None:
        """One pass: run from the drain pump's Timer (or the tick fallback).
        Never raises — the pump stops on an escaped exception."""
        if self._disconnected:
            return
        t0 = self._clock()
        if self._last_tick_mono > 0.0:
            dt = t0 - self._last_tick_mono
            if INTERVAL_MIN_S <= dt <= INTERVAL_MAX_S:
                self._interval_ema = self._interval_ema * 0.9 + dt * 0.1
        self._last_tick_mono = t0
        try:
            self._tick_body()
        except Exception as e:
            self._warn_once(
                "tick", "raised",
                "tick raised %s: %s\n%s" % (type(e).__name__, e, traceback.format_exc()),
            )
        self._tick_count += 1
        dur = self._clock() - t0
        if dur > self._tick_max_s:
            self._tick_max_s = dur
        if dur > SLOW_TICK_WARN_S:
            self._slow_ticks += 1
            if self._slow_ticks <= 3 or self._slow_ticks % 500 == 0:
                logger.warning(
                    "SequencerComponent: slow tick %.1f ms (#%d)", dur * 1000.0, self._slow_ticks,
                )

    def _tick_body(self) -> None:
        # A pad chain changed shape (ADR-435): re-walk the set now, past
        # the window the chain needed to populate.
        if self._rescan_due is not None and self._clock() >= self._rescan_due:
            self._rescan_due = None
            self._counters["pad_rescans"] += 1
            self.rescan()
        # Devices that left while a step was held: restore their clips
        # now, in a write-legal context.
        if self._retiring:
            retiring, self._retiring = self._retiring, []
            for inst in retiring:
                self._restore_instance(inst, "removed")
                self._unwatch_own_params(inst)
                self._emit_idle(inst, inst.retired_path or inst.device_path)

        enabled = self._enabled()
        if enabled != self._enabled_last:
            self._enabled_last = enabled
            logger.info("SequencerComponent: engine %s", "ON" if enabled else "OFF")
        if not enabled:
            # Off restores everything applied — including what landed
            # while the transport was stopped (a temperature nudged from 0
            # writes a variation without a play), which ``_active`` alone
            # would miss; the same test ``disconnect`` uses.
            if self._active or any(i.active() for i in self._instances.values()):
                self._stop_all("disabled")
            return

        now = self._clock()
        if now >= self._gate_due:
            self._gate_due = now + GATE_HEARTBEAT_S
            self._beat_gates()

        for inst in list(self._instances.values()):
            if inst.chance_dirty:
                inst.chance_dirty = False
                self._refresh_clip(inst)
                self._apply_chance(inst, force=True)
            if inst.temperature_dirty:
                inst.temperature_dirty = False
                self._refresh_clip(inst)
                self._on_temperature_changed(inst)
            self._service_temperature(inst)
            cs = inst.clip_state
            if cs is not None and cs.gain_rezero:
                cs.gain_rezero = False
                if cs.mute_applied:
                    self._write_gain(inst, cs.clip, 0.0)

        if not self._read_is_playing():
            if self._active:
                self._stop_all("transport-stop")
            return
        if not self._active:
            # Transport start: chance below 1.0 lands on the current clips,
            # and a hot temperature captures + varies them.
            for inst in list(self._instances.values()):
                self._refresh_clip(inst)
                self._apply_chance(inst, force=False)
                self._temp_start(inst)

        song_time = self._read_song_time()
        if song_time is None:
            return
        tempo = self._read_tempo()
        numer = self._read_numerator()
        now_ticks = sm.beats_to_ticks(song_time)
        self._active = True
        for inst in list(self._instances.values()):
            self._tick_instance(inst, now_ticks, tempo, numer)

    def _tick_instance(self, inst: _Instance, now_ticks: float, tempo: float, numer: int) -> None:
        self._refresh_clip(inst)
        self._refresh_solo(inst)
        for seq in inst.seqs():
            if seq.kind == KIND_MUTE:
                rate, length = inst.values.get("muteRate"), inst.values.get("muteLength")
            else:
                rate, length = inst.values.get("pitchRate"), inst.values.get("pitchLength")
            tps = sm.ticks_for_rate_enum(rate, numer)
            n = sm.clamp_length(length)
            seq.ticks_per_step, seq.length = tps, n
            # The lead is per-sequencer: the half-step clamp depends on
            # this sequencer's own rate, and the two rarely match.
            lead = sm.lead_ticks(self._interval_ema, tempo, tps) if self._lookahead else 0.0
            target = now_ticks + lead
            step = sm.calculate_step(target, tps, n)
            if step == seq.current_step:
                continue
            seq.current_step = step
            self._counters["transitions"] += 1
            lag_ms = sm.ticks_to_ms(now_ticks - sm.step_start_ticks(target, tps), tempo)
            self._lag.record(lag_ms, tempo)
            value = self._effective_value(inst, seq.kind, step)
            if value != seq.last_value:
                seq.last_value = value
                self._on_step_value(inst, seq.kind, value)
            self._emit_step(inst, seq.kind, step)

    def _effective_value(self, inst: _Instance, kind: str, step: int) -> int:
        """The pattern value at ``step``, with the solo override on mute."""
        if kind == KIND_MUTE and inst.solo_last:
            return 1
        return self._step_value(inst, kind, step)

    def _refresh_solo(self, inst: _Instance) -> None:
        """Solo flips apply at once: a soloed track plays regardless of the
        mute pattern; un-solo resumes the pattern at the current step."""
        solo = self._safe_bool(inst.track, "solo")
        if solo == inst.solo_last:
            return
        inst.solo_last = solo
        if inst.mute.current_step < 0:
            return
        value = self._effective_value(inst, KIND_MUTE, inst.mute.current_step)
        if value != inst.mute.last_value:
            inst.mute.last_value = value
            self._on_step_value(inst, KIND_MUTE, value)

    @staticmethod
    def _step_value(inst: _Instance, kind: str, step: int) -> int:
        """The pattern value at ``step`` (1/0). Steps past the device's
        sixteen — or a pre-ADR-443 device's eight — read as the default:
        plays / unshifted."""
        role = ("mute%d" if kind == KIND_MUTE else "pitch%d") % (step + 1)
        v = inst.values.get(role)
        if v is None:
            v = ROLE_DEFAULTS.get(role, 1.0 if kind == KIND_MUTE else 0.0)
        return 1 if float(v) >= 0.5 else 0

    # --- actions (dispatch; bodies land per phase) -----------------------------

    def _on_step_value(self, inst: _Instance, kind: str, value: int) -> None:
        """A sequencer's value changed at a boundary: act on the delta."""
        if kind == KIND_PITCH:
            self._counters["pitch_applies"] += 1
            self._apply_pitch(inst, value == 1)
        else:
            self._counters["mute_applies"] += 1
            # The gate is how a clip-less instrument hears this lane at
            # all, so it goes out whether or not there is a clip below.
            self._emit_gate(inst, value == 1)
            self._apply_mute(inst, value == 0)

    def _apply_pitch(self, inst: _Instance, shifted: bool) -> None:
        """+12 st while a pitch step is on: drum shift term / notes /
        ``pitch_coarse``, by class (see the module doc)."""
        if inst.rack is not None:
            self._set_drum_shift(inst, OCTAVE_SEMITONES if shifted else 0)
            return
        cs = inst.clip_state
        if cs is None:
            # Nothing playing: the wanted state lives in ``pitch.last_value``
            # and lands on the next clip through ``_on_clip_changed``.
            return
        self._set_clip_pitch(inst, cs, shifted)

    def _set_drum_shift(self, inst: _Instance, shift: int) -> None:
        if inst.drum_shift == shift:
            # A step-off with nothing shifted writes nothing (the fat
            # device's ``hasShifted`` gate): the first step after start,
            # and every off-to-off, must not touch the rack.
            return
        inst.drum_shift = shift
        if self._drum_vm is None:
            self._warn_once(inst.device_path, "drum_vm", "no DrumVirtualMacroComponent; drum pitch shift dropped")
            return
        try:
            if inst.pad_note is not None:
                self._drum_vm.set_pad_sequencer_shift(inst.rack, inst.rack_path, inst.pad_note, shift)
            else:
                self._drum_vm.set_sequencer_shift(inst.rack, inst.rack_path, shift)
        except Exception as e:
            self._warn_once(inst.device_path, "drum_shift", "sequencer shift raised: %s: %s" % (type(e).__name__, e))

    def _set_clip_pitch(self, inst: _Instance, cs: _ClipState, shifted: bool) -> None:
        if cs.is_audio:
            self._shift_audio(inst, cs, shifted)
        elif cs.is_midi:
            self._shift_notes(inst, cs, shifted)

    def _shift_notes(self, inst: _Instance, cs: _ClipState, on: bool) -> None:
        """Move every note of the clip up an octave (ids preserved) or
        back by exactly what each note was given."""
        if on == cs.pitch_applied:
            return
        vec = self._read_notes(inst, cs.clip)
        if vec is None:
            return
        changed = False
        if on:
            deltas: Dict[int, int] = {}
            for note in vec:
                nid, pitch = self._note_id(note), self._note_pitch(note)
                if nid is None or pitch is None:
                    continue
                delta = min(OCTAVE_SEMITONES, MIDI_PITCH_MAX - pitch)
                if delta <= 0:
                    continue
                note.pitch = pitch + delta
                deltas[nid] = delta
                changed = True
            if changed and not self._apply_notes(inst, cs, vec):
                return
            cs.pitch_deltas = deltas
            cs.pitch_applied = True
            cs.pitch_shift = OCTAVE_SEMITONES
        else:
            for note in vec:
                nid, pitch = self._note_id(note), self._note_pitch(note)
                delta = cs.pitch_deltas.get(nid) if nid is not None else None
                if not delta or pitch is None:
                    continue
                note.pitch = max(0, pitch - delta)
                changed = True
            if changed and not self._apply_notes(inst, cs, vec):
                return
            cs.pitch_deltas = {}
            cs.pitch_applied = False
            cs.pitch_shift = 0

    def _shift_audio(self, inst: _Instance, cs: _ClipState, on: bool) -> None:
        """``pitch_coarse`` +12 relative to the clip's own value, clamped
        ±48; the restore adopts a re-pitch made while shifted (ADR-019)."""
        if on == cs.pitch_applied:
            return
        cur = self._read_pitch_coarse(inst, cs.clip)
        if cur is None:
            return
        if on:
            home = cur
            written = self._clamp_coarse(home + OCTAVE_SEMITONES)
            if not self._write_pitch_coarse(inst, cs.clip, written):
                return
            cs.pitch_coarse_home = home
            cs.pitch_coarse_written = written
            cs.pitch_applied = True
            cs.pitch_shift = written - home
        else:
            home = cs.pitch_coarse_home if cs.pitch_coarse_home is not None else cur - OCTAVE_SEMITONES
            written = cs.pitch_coarse_written
            if written is not None and cur != written:
                # The user re-pitched the clip while we held it shifted:
                # the same delta moves home.
                home += cur - written
            if not self._write_pitch_coarse(inst, cs.clip, self._clamp_coarse(home)):
                return
            cs.pitch_coarse_home = None
            cs.pitch_coarse_written = None
            cs.pitch_applied = False
            cs.pitch_shift = 0

    @staticmethod
    def _clamp_coarse(v) -> int:
        return int(max(PITCH_COARSE_MIN, min(PITCH_COARSE_MAX, int(round(v)))))

    def _apply_mute(self, inst: _Instance, muted: bool) -> None:
        """``note.mute`` on the playing MIDI clip / clip ``gain`` on audio."""
        cs = inst.clip_state
        if cs is None:
            return  # lands on the next clip through _on_clip_changed
        self._set_clip_mute(inst, cs, muted)

    def _set_clip_mute(self, inst: _Instance, cs: _ClipState, muted: bool) -> None:
        if cs.is_audio and inst.pad_note is None:  # a pad has no audio clip to silence
            self._mute_audio(inst, cs, muted)
        elif cs.is_midi:
            self._mute_notes(inst, cs, muted)

    def _mute_notes(self, inst: _Instance, cs: _ClipState, on: bool) -> None:
        """Mute every unmuted note, remembering which; unmute only those.

        A pad instance mutes what sits on its pad now and unmutes its
        remembered ids *wherever they are*: the kit's Temperature may have
        moved them to another pad since (``_settle_pads`` keeps the mute on
        the pad in between — ADR-435 addendum)."""
        if on == cs.mute_applied:
            return
        vec = self._read_notes(inst, cs.clip, whole=not on)
        if vec is None:
            return
        changed = False
        if on:
            muted_ids: set = set()
            for note in vec:
                nid = self._note_id(note)
                if nid is None or self._note_muted(note):
                    continue
                note.mute = True
                muted_ids.add(nid)
                changed = True
            if changed and not self._apply_notes(inst, cs, vec):
                return
            cs.muted_ids = muted_ids
            cs.mute_applied = True
        else:
            for note in vec:
                nid = self._note_id(note)
                if nid is None or nid not in cs.muted_ids:
                    continue
                note.mute = False
                changed = True
            if changed and not self._apply_notes(inst, cs, vec):
                return
            cs.muted_ids = set()
            cs.mute_applied = False

    def _mute_audio(self, inst: _Instance, cs: _ClipState, on: bool) -> None:
        """Clip ``gain`` → 0 while muted, back to what it was after — or to
        what the user set meanwhile (``adopt_gain``).

        The state changes before the write, because Live fires the clip's
        ``gain`` listener inside it: the clip view reads that echo through
        ``held_gain``, and must see the 0 as held and the restore as not."""
        if on == cs.mute_applied:
            return
        if on:
            home = self._read_gain(inst, cs.clip)
            if home is None:
                return
            cs.gain_home, cs.mute_applied = home, True
            if not self._write_gain(inst, cs.clip, 0.0):
                cs.gain_home, cs.mute_applied = None, False
        else:
            home = cs.gain_home if cs.gain_home is not None else 1.0
            cs.gain_home, cs.mute_applied, cs.gain_rezero = None, False, False
            if not self._write_gain(inst, cs.clip, home):
                cs.gain_home, cs.mute_applied = home, True

    def _emit_gate(self, inst: _Instance, is_open: bool) -> None:
        """Tell a Max device on this track whether the mute lane is letting
        sound through — 1 open, 0 shut.

        Track-level instances only. A pad Permute's mute is scoped to its
        pad and this wire names a *track*, so emitting one would claim
        authority over the whole track's sound on a pad's behalf.
        """
        if self._gate_emit is None or inst.pad_note is not None:
            return
        try:
            self._gate_emit(V3_PERMUTE_GATE_ADDRESS, (inst.track_idx, 1 if is_open else 0))
        except Exception as e:
            self._warn_once(
                inst.device_path, "gate_emit",
                "gate emit raised: %s: %s" % (type(e).__name__, e),
            )
            return
        self._counters["gate_emits"] += 1

    def _beat_gates(self) -> None:
        """Re-state every track-level gate. Idempotent by design — the
        receiver holds the state and only restarts its fail-open timer —
        so this is cheap to repeat and is what makes a dropped datagram
        cost a heartbeat instead of a silent instrument. ``last_value``
        is None before the first transition, which reads as open."""
        for inst in list(self._instances.values()):
            self._emit_gate(inst, inst.mute.last_value != 0)

    def _restore_instance(self, inst: _Instance, reason: str) -> None:
        """Undo everything applied for ``inst`` (transport stop, disable,
        removal, disconnect). Each action phase adds its own restore."""
        # Whatever else a restore undoes, it must not leave an instrument
        # muted: transport stop, the toggle going off, device removal and
        # disconnect all hand the gate back open.
        self._emit_gate(inst, True)
        if inst.drum_shift:
            self._set_drum_shift(inst, 0)
        cs = inst.clip_state
        if cs is not None and cs.dirty():
            logger.debug(
                "SequencerComponent: %s restore (%s) clip=%s", inst.device_path, reason, cs.slot_idx,
            )
            if cs.base_model is not None:
                # Writes the true base (octave removed) and drops the
                # model, so the pitch restore below has nothing left to do.
                self._temp_restore(inst, cs, with_octave=False)
            if cs.pitch_applied:
                self._set_clip_pitch(inst, cs, False)
            if cs.mute_applied:
                self._set_clip_mute(inst, cs, False)
        inst.drum_shift = 0
        inst.pending_restore = False
        for seq in inst.seqs():
            seq.reset()

    def _on_clip_changed(self, inst: _Instance, old: Optional[_ClipState], new: Optional[_ClipState]) -> None:
        """The track's playing clip changed under the engine. The old clip
        gives back what it carried; the new one receives the held state."""
        if old is not None and old.dirty():
            logger.debug(
                "SequencerComponent: %s clip left slot %d with state applied",
                inst.device_path, old.slot_idx,
            )
            if old.pitch_applied:
                self._set_clip_pitch(inst, old, False)
            if old.mute_applied:
                self._set_clip_mute(inst, old, False)
        if old is not None and old.base_model is not None:
            self._temp_restore(inst, old)
        if new is not None:
            if inst.rack is None and inst.pitch.last_value == 1:
                self._set_clip_pitch(inst, new, True)
            if inst.mute.last_value == 0:
                self._set_clip_mute(inst, new, True)
            self._apply_chance(inst, force=False)
            self._temp_start(inst)

    # --- clip tracking ----------------------------------------------------------

    def _refresh_clip(self, inst: _Instance) -> None:
        """Follow the track's playing slot; on a change, swap ``clip_state``."""
        slot_idx = self._read_slot_idx(inst)
        cs = inst.clip_state
        if slot_idx == inst.slot_idx and (cs is None or cs.slot_idx == slot_idx):
            if slot_idx < 0 or cs is not None:
                return
        inst.slot_idx = slot_idx
        new: Optional[_ClipState] = None
        if slot_idx >= 0:
            resolved = self._resolve_playing_clip(inst)
            if resolved is not None:
                clip, sidx = resolved
                cid = _safe_int_id(clip)
                if cs is not None and cid is not None and cs.clip_id == cid:
                    cs.slot_idx = sidx
                    return
                new = _ClipState(
                    clip, cid if cid is not None else -1, sidx,
                    self._safe_bool(clip, "is_midi_clip"), self._safe_bool(clip, "is_audio_clip"),
                )
        if cs is None and new is None:
            return
        inst.clip_state = new
        self._counters["clip_changes"] += 1
        self._on_clip_changed(inst, cs, new)

    def _resolve_playing_clip(self, inst: _Instance):
        if self._playhead is not None:
            try:
                return self._playhead.playing_clip(inst.track, "tracks/%d" % inst.track_idx)
            except Exception as e:
                self._warn_once(inst.device_path, "playing_clip", "playhead query raised: %s" % e)
        try:
            idx = int(inst.track.playing_slot_index)
            if idx < 0:
                return None
            slot = inst.track.clip_slots[idx]
            if not bool(slot.has_clip):
                return None
            return slot.clip, idx
        except (_LOM_ERRORS, IndexError, ValueError) as e:
            self._warn_once(inst.device_path, "resolve_clip", "clip resolve raised: %s" % e)
            return None

    def _read_slot_idx(self, inst: _Instance) -> int:
        try:
            return int(inst.track.playing_slot_index)
        except (_LOM_ERRORS, ValueError) as e:
            self._warn_once(inst.device_path, "playing_slot_index", "read raised: %s" % e)
            return -1

    # --- chance -------------------------------------------------------------------------

    def _apply_chance(self, inst: _Instance, force: bool) -> None:
        """``note.probability = Chance`` on every note of the current MIDI
        clip. ``force`` (a slider move) writes whatever the slider says;
        otherwise (clip change, transport start) only a value below 1.0 is
        applied, so a clip the user drew probabilities into is left alone."""
        cs = inst.clip_state
        if cs is None or not cs.is_midi:
            return
        value = inst.values.get("chance")
        try:
            chance = max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return
        if not force and chance >= 1.0:
            return
        if cs.chance_applied is not None and abs(cs.chance_applied - chance) < 1e-6:
            return
        vec = self._read_notes(inst, cs.clip)
        if vec is None:
            return
        # The pitches a pad Permute on the same rack governs are its own
        # Chance's (ADR-435): the track's write leaves them alone.
        governed = self._governed_pitches(inst)
        changed = False
        for note in vec:
            if governed and self._note_pitch(note) in governed:
                continue
            try:
                note.probability = chance
                changed = True
            except _LOM_ERRORS:
                continue
        if changed and not self._apply_notes(inst, cs, vec):
            return
        cs.chance_applied = chance
        self._counters["chance_applies"] += 1

    def _governed_pitches(self, inst: _Instance) -> frozenset:
        """For a track-level Permute over a Drum Rack: the pad notes whose
        chains carry a Permute of their own. Empty for a pad instance and
        for the clip route."""
        if inst.pad_note is not None or inst.rack is None:
            return frozenset()
        return frozenset(
            i.pad_note for i in self._instances.values()
            if i.pad_note is not None and i.rack_path == inst.rack_path
        )

    def _governed_pads(self, inst: _Instance, cs: _ClipState) -> List[Tuple[_Instance, _ClipState]]:
        """For a track-level Permute over a Drum Rack: the pad instances on
        the same rack whose clip state is this clip, with that state."""
        if inst.pad_note is not None or inst.rack is None:
            return []
        out: List[Tuple[_Instance, _ClipState]] = []
        for other in self._instances.values():
            ocs = other.clip_state
            if other.pad_note is None or other.rack_path != inst.rack_path or ocs is None:
                continue
            if ocs.clip_id != cs.clip_id:
                continue
            out.append((other, ocs))
        return out

    def _settle_pads(self, inst: _Instance, cs: _ClipState, vec, prev: Dict[int, int]) -> bool:
        """The kit's note write is about to move pitches (``vec`` against
        ``prev``, the clip as read): a pad Permute's mute and Chance follow
        the *pad*, not the note (ADR-435 addendum). A mover landing on a
        pad whose mute step holds is muted and remembered by that pad, so
        the pad's own unmute finds it; a mover leaving a pad that muted it
        is unmuted; a mover's probability becomes the value of whichever
        Chance governs its new pitch — the pad's on a governed pad, the
        kit's elsewhere — when that Chance has been applied to this clip.
        Notes that do not move are not touched: a note recorded on a held
        pad keeps playing, a note the user muted stays muted. Folded into
        the caller's write so a variation stays one write (one undo
        entry). Returns whether anything changed."""
        pads = self._governed_pads(inst, cs)
        if not pads:
            return False
        by_pitch = {pad.pad_note: (pad, pcs) for pad, pcs in pads}
        changed = False
        for note in vec:
            nid, pitch = self._note_id(note), self._note_pitch(note)
            if nid is None or pitch is None:
                continue
            was = prev.get(nid)
            if was is None or was == pitch:
                continue
            src = by_pitch.get(was)
            dst = by_pitch.get(pitch)
            if src is not None and nid in src[1].muted_ids:
                note.mute = False
                src[1].muted_ids.discard(nid)
                changed = True
            if dst is not None and dst[0].mute.last_value == 0 and not self._note_muted(note):
                note.mute = True
                dst[1].muted_ids.add(nid)
                dst[1].mute_applied = True
                changed = True
            if dst is not None:
                chance = dst[1].chance_applied
            elif src is not None:
                chance = cs.chance_applied
            else:
                chance = None
            if chance is not None and self._note_probability(note) != chance:
                note.probability = chance
                changed = True
        return changed

    # --- temperature (permute ADR-015) ---------------------------------------------------

    def _temperature(self, inst: _Instance) -> float:
        try:
            return max(0.0, min(1.0, float(inst.values.get("temperature") or 0.0)))
        except (TypeError, ValueError):
            return 0.0

    def _on_temperature_changed(self, inst: _Instance) -> None:
        """The slider moved: 0 → hot captures + varies, hot → 0 restores;
        a change while hot only shapes the next variation."""
        new = self._temperature(inst)
        was = inst.temperature_last
        inst.temperature_last = new
        if inst.pad_note is not None:
            return  # inert on a pad (ADR-435): one pitch has nothing to swap
        cs = inst.clip_state
        if cs is None or not cs.is_midi:
            return
        if was <= 0.0 < new:
            self._temp_enable(inst, cs)
        elif was > 0.0 >= new:
            self._temp_restore(inst, cs, with_octave=True)

    def _temp_start(self, inst: _Instance) -> None:
        """Transport start / clip arrival with a hot slider: capture the
        clip (if not yet) and write a variation."""
        inst.temperature_last = self._temperature(inst)
        cs = inst.clip_state
        if inst.pad_note is not None or cs is None or not cs.is_midi or inst.temperature_last <= 0.0:
            return
        self._temp_enable(inst, cs)

    def _temp_enable(self, inst: _Instance, cs: _ClipState) -> None:
        if cs.base_model is None:
            vec = self._read_notes(inst, cs.clip)
            if vec is None:
                return
            cs.base_model = self._build_base_model(cs, vec)
            cs.expected = None
            self._temp_attach(inst, cs)
        self._temp_variation(inst, cs)

    def _temp_variation(self, inst: _Instance, cs: _ClipState) -> None:
        """A fresh variation from the base: every known note back to its
        base pitch (plus its octave), then a new swap over those only."""
        temperature = self._temperature(inst)
        if cs.base_model is None or temperature <= 0.0:
            return
        vec = self._read_notes(inst, cs.clip)
        if vec is None:
            return
        prev = self._pitch_signature(vec)
        base_notes = []
        for note in vec:
            nid = self._note_id(note)
            base = cs.base_model.get(nid) if nid is not None else None
            if base is None:
                continue  # an overdub not yet folded in: never swapped
            note.pitch = self._shifted(cs, nid, base["pitch"])
            base_notes.append(note)
        pattern = shuffle.generate_swap_pattern(base_notes, temperature, self._rng)
        shuffle.apply_swap_pattern(base_notes, pattern)
        self._settle_pads(inst, cs, vec, prev)
        if self._apply_notes(inst, cs, vec):
            self._counters["temp_variations"] += 1

    def _temp_restore(self, inst: _Instance, cs: _ClipState, with_octave: bool = True) -> None:
        """Rewrite the base model verbatim (its octave kept while a pitch
        step holds it, unless ``with_octave`` is False — the stop path,
        which puts back the true base) and drop the model."""
        self._temp_detach(cs)
        model, cs.base_model, cs.expected = cs.base_model, None, None
        cs.temp_variation_pending = False
        cs.temp_notes_changed = False
        if not model:
            return
        vec = self._read_notes(inst, cs.clip)
        if vec is None:
            return
        prev = self._pitch_signature(vec)
        changed = False
        for note in vec:
            nid = self._note_id(note)
            base = model.get(nid) if nid is not None else None
            if base is None:
                continue
            target = self._shifted(cs, nid, base["pitch"]) if with_octave else int(base["pitch"])
            if self._note_pitch(note) != target:
                note.pitch = target
                changed = True
        if self._settle_pads(inst, cs, vec, prev):
            changed = True
        if changed and not self._apply_notes(inst, cs, vec):
            return
        if not with_octave:
            cs.pitch_deltas = {}
            cs.pitch_applied = False
            cs.pitch_shift = 0

    def _service_temperature(self, inst: _Instance) -> None:
        """Deferred halves of the clip observers (they fire in a
        notification): a loop jump → a fresh variation; a ``notes``
        change → tell our own write from a user edit by content."""
        cs = inst.clip_state
        if cs is None or cs.base_model is None:
            return
        if self._temperature(inst) <= 0.0:
            return
        if cs.temp_notes_changed:
            cs.temp_notes_changed = False
            vec = self._read_notes(inst, cs.clip)
            if vec is not None and self._is_external_change(vec, cs.expected):
                self._temp_rebaseline(inst, cs, vec)
                cs.temp_variation_pending = False
                return
        if cs.temp_variation_pending:
            cs.temp_variation_pending = False
            self._temp_variation(inst, cs)

    def _temp_rebaseline(self, inst: _Instance, cs: _ClipState, vec) -> None:
        """The user edited the clip while hot: untouched notes (still at
        the pitch our last swap left them) go back to base first, the
        edited and added notes define the new composition, then a fresh
        variation keeps playback hot."""
        expected = cs.expected or {}
        model = cs.base_model or {}
        for note in vec:
            nid = self._note_id(note)
            if nid is None:
                continue
            base = model.get(nid)
            exp = expected.get(nid)
            if base is not None and exp is not None and self._note_pitch(note) == exp:
                note.pitch = self._shifted(cs, nid, base["pitch"])
        cs.base_model = self._build_base_model(cs, vec)
        cs.expected = None
        self._counters["temp_rebaselines"] += 1
        logger.debug("SequencerComponent: %s re-baselined from a user edit", inst.device_path)
        self._temp_variation(inst, cs)

    def _build_base_model(self, cs: _ClipState, vec) -> Dict[int, dict]:
        model: Dict[int, dict] = {}
        for note in vec:
            nid = self._note_id(note)
            pitch = self._note_pitch(note)
            if nid is None or pitch is None:
                continue
            entry = {}
            for field in BASE_MODEL_FIELDS:
                v = getattr(note, field, None)
                if v is None and isinstance(note, dict):
                    v = note.get(field)
                if v is not None:
                    entry[field] = v
            # True base pitch: the pitch sequencer's per-note octave removed.
            entry["pitch"] = pitch - (cs.pitch_deltas.get(nid, 0) if cs.pitch_applied else 0)
            model[nid] = entry
        return model

    @staticmethod
    def _shifted(cs: _ClipState, nid: int, base_pitch) -> int:
        """A base pitch as it should read on the clip now: plus the octave
        this engine holds on that note, clamped to MIDI."""
        delta = cs.pitch_deltas.get(nid, 0) if cs.pitch_applied else 0
        return max(0, min(MIDI_PITCH_MAX, int(base_pitch) + delta))

    def _pitch_signature(self, vec) -> Dict[int, int]:
        sig: Dict[int, int] = {}
        for note in vec:
            nid, pitch = self._note_id(note), self._note_pitch(note)
            if nid is not None and pitch is not None:
                sig[nid] = pitch
        return sig

    def _is_external_change(self, vec, expected: Optional[Dict[int, int]]) -> bool:
        """A different id set, or a note repitched away from what we last
        wrote, is the user's; an exact match is our own write."""
        if expected is None:
            return True
        sig = self._pitch_signature(vec)
        if len(sig) != len(expected):
            return True
        for nid, pitch in sig.items():
            if nid not in expected or expected[nid] != pitch:
                return True
        return False

    def _temp_attach(self, inst: _Instance, cs: _ClipState) -> None:
        clip = cs.clip

        def _on_loop_jump(cs=cs):
            cs.temp_variation_pending = True

        def _on_notes(cs=cs):
            cs.temp_notes_changed = True

        for attr, cb, slot in (("loop_jump", _on_loop_jump, "temp_loop_cb"), ("notes", _on_notes, "temp_notes_cb")):
            add = getattr(clip, "add_%s_listener" % attr, None)
            if not callable(add):
                self._warn_once(inst.device_path, "temp:" + attr, "clip has no add_%s_listener" % attr)
                continue
            try:
                add(cb)
                setattr(cs, slot, cb)
            except _LOM_ERRORS as e:
                self._warn_once(inst.device_path, "temp:" + attr, "add_%s_listener raised: %s" % (attr, e))

    def _temp_detach(self, cs: _ClipState) -> None:
        for attr, slot in (("loop_jump", "temp_loop_cb"), ("notes", "temp_notes_cb")):
            cb = getattr(cs, slot)
            if cb is None:
                continue
            setattr(cs, slot, None)
            remove = getattr(cs.clip, "remove_%s_listener" % attr, None)
            if not callable(remove):
                continue
            try:
                remove(cb)
            except _LOM_ERRORS:
                pass

    # --- note + clip I/O ------------------------------------------------------------

    def _read_notes(self, inst: _Instance, clip, whole: bool = False):
        """The clip's notes — for a pad instance only those at the pad's
        pitch (ADR-435): ``get_notes_extended(pitch, 1, …)`` where the
        clip offers that form, else the full read filtered; ``whole``
        reads past the pad's scope (its unmute, which must find the ids
        the kit's Temperature moved off the pad). The full read tries
        ``get_all_notes_extended`` with arguments first, then bare (older
        builds and stubs; ClipNotesComponent's idiom). ``None`` when the
        LOM raised."""
        try:
            length = float(getattr(clip, "length", 0.0)) or float(1 << 14)
        except _LOM_ERRORS:
            length = float(1 << 14)
        if inst.pad_note is not None and not whole:
            try:
                return clip.get_notes_extended(inst.pad_note, 1, 0.0, length)
            except (TypeError, AttributeError):
                pass  # no such form here: read everything and keep the pad's
            except RuntimeError as e:
                self._warn_once(inst.device_path, "notes_read", "get_notes_extended raised: %s" % e)
                return None
        try:
            vec = clip.get_all_notes_extended(0, 128, 0.0, length)
        except TypeError:
            try:
                vec = clip.get_all_notes_extended()
            except _LOM_ERRORS as e:
                self._warn_once(inst.device_path, "notes_read", "get_all_notes_extended raised: %s" % e)
                return None
        except _LOM_ERRORS as e:
            self._warn_once(inst.device_path, "notes_read", "get_all_notes_extended raised: %s" % e)
            return None
        if inst.pad_note is not None and not whole and vec is not None:
            vec = [n for n in vec if self._note_pitch(n) == inst.pad_note]
        return vec

    def _apply_notes(self, inst: _Instance, cs: _ClipState, vec) -> bool:
        """Write ``vec`` back. With a temperature base model in place the
        pitches written are recorded first as ``expected`` — recording
        after the call would race the ``notes`` notification the write
        queues (ADR-015)."""
        previous = cs.expected
        if cs.base_model is not None:
            cs.expected = self._pitch_signature(vec)
        try:
            cs.clip.apply_note_modifications(vec)
            return True
        except _LOM_ERRORS as e:
            cs.expected = previous
            self._warn_once(inst.device_path, "notes_apply", "apply_note_modifications raised: %s" % e)
            return False

    @staticmethod
    def _note_id(note) -> Optional[int]:
        nid = getattr(note, "note_id", None)
        if nid is None and isinstance(note, dict):
            nid = note.get("note_id")
        try:
            return int(nid) if nid is not None else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _note_pitch(note) -> Optional[int]:
        p = getattr(note, "pitch", None)
        if p is None and isinstance(note, dict):
            p = note.get("pitch")
        try:
            return int(p) if p is not None else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _note_probability(note) -> Optional[float]:
        v = getattr(note, "probability", None)
        if v is None and isinstance(note, dict):
            v = note.get("probability")
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _note_muted(note) -> bool:
        m = getattr(note, "mute", None)
        if m is None and isinstance(note, dict):
            m = note.get("mute")
        return bool(m)

    def _read_gain(self, inst: _Instance, clip) -> Optional[float]:
        try:
            return float(clip.gain)
        except (_LOM_ERRORS, ValueError) as e:
            self._warn_once(inst.device_path, "gain_read", "gain read raised: %s" % e)
            return None

    def _write_gain(self, inst: _Instance, clip, value: float) -> bool:
        try:
            clip.gain = float(value)
            return True
        except _LOM_ERRORS as e:
            self._warn_once(inst.device_path, "gain_write", "gain write raised: %s" % e)
            return False

    def _read_pitch_coarse(self, inst: _Instance, clip) -> Optional[int]:
        try:
            return int(round(float(clip.pitch_coarse)))
        except (_LOM_ERRORS, ValueError) as e:
            self._warn_once(inst.device_path, "pitch_coarse_read", "pitch_coarse read raised: %s" % e)
            return None

    def _write_pitch_coarse(self, inst: _Instance, clip, value: int) -> bool:
        try:
            clip.pitch_coarse = int(value)
            return True
        except _LOM_ERRORS as e:
            self._warn_once(inst.device_path, "pitch_coarse_write", "pitch_coarse write raised: %s" % e)
            return False

    # --- stop / restore -----------------------------------------------------------

    def _stop_all(self, reason: str) -> None:
        self._counters["stop_all"] += 1
        for inst in list(self._instances.values()):
            self._restore_instance(inst, reason)
            self._emit_idle(inst, inst.device_path)
        self._active = False
        logger.debug("SequencerComponent: stop (%s)", reason)

    # --- telemetry ------------------------------------------------------------------

    def _emit_step(self, inst: _Instance, kind: str, step: int) -> None:
        self._safe_emit(V3_PERMUTE_STEP_ADDRESS, (inst.device_path, kind, int(step)))

    def _emit_idle(self, inst: _Instance, device_path: str) -> None:
        for kind in KINDS:
            self._safe_emit(V3_PERMUTE_STEP_ADDRESS, (device_path, kind, -1))

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            self._warn_once("emit", address, "emit failed: %s" % e)

    # --- probe --------------------------------------------------------------------

    def stats(self) -> Dict[str, object]:
        instances = []
        for inst in self._instances.values():
            cs = inst.clip_state
            instances.append({
                "path": inst.device_path,
                "route": "pad" if inst.pad_note is not None else ("drum" if inst.rack is not None else "clip"),
                "pad": inst.pad_note,
                "rack": inst.rack_path,
                "drum_shift": inst.drum_shift,
                "slot": inst.slot_idx,
                "clip": (cs.clip_id if cs else None),
                "clip_pitch": ({"applied": cs.pitch_applied, "shift": cs.pitch_shift, "audio": cs.is_audio} if cs else None),
                "clip_mute": ({"applied": cs.mute_applied, "notes": len(cs.muted_ids)} if cs else None),
                "clip_chance": (cs.chance_applied if cs else None),
                "clip_temperature": ({"hot": cs.base_model is not None, "base_notes": len(cs.base_model or {})} if cs else None),
                "solo": inst.solo_last,
                "gate_open": inst.mute.last_value != 0,
                "mute": {"step": inst.mute.current_step, "tps": inst.mute.ticks_per_step, "len": inst.mute.length, "value": inst.mute.last_value},
                "pitch": {"step": inst.pitch.current_step, "tps": inst.pitch.ticks_per_step, "len": inst.pitch.length, "value": inst.pitch.last_value},
                "values": {r: inst.values.get(r) for r in ("muteLength", "muteRate", "pitchLength", "pitchRate", "chance", "temperature")},
                "missing": [r for r in ROLE_NAMES if r not in inst.params],
                "drum_vm": self._drum_vm_state(inst),
            })
        return {
            "enabled": bool(self._enabled()),
            "active": self._active,
            "lookahead": self._lookahead,
            "interval_ms": round(self._interval_ema * 1000.0, 3),
            "lead": self._lead_summary(),
            "ticks": self._tick_count,
            "tick_max_ms": round(self._tick_max_s * 1000.0, 3),
            "slow_ticks": self._slow_ticks,
            "counters": dict(self._counters),
            "lag": self._lag.summary(),
            # ADR-435: what a walk of the set costs now that it reads pad
            # chains too, and the rack watchers that ask for one.
            "rescan": {
                "last_ms": round(self._rescan_ms_last, 3),
                "max_ms": round(self._rescan_ms_max, 3),
                "watchers": len(self._watchers),
                "due": self._rescan_due is not None,
            },
            "instances": instances,
        }

    def _lead_summary(self) -> Dict[str, object]:
        """The unclamped lead at the current tempo — what the engine aims
        for before each sequencer's half-step clamp. Each instance's
        ``tps`` is reported alongside, so the clamp is derivable."""
        if not self._lookahead:
            return {"on": False}
        tempo = self._read_tempo()
        base = sm.lead_ticks(self._interval_ema, tempo, 0)
        return {
            "on": True,
            "ticks": round(base, 2),
            "ms": round(sm.ticks_to_ms(base, tempo), 2),
            "floor_ticks": sm.MUSICAL_LEAD_TICKS,
            "max_fraction": sm.MAX_LEAD_FRACTION,
        }

    def _drum_vm_state(self, inst: _Instance):
        if inst.rack is None or self._drum_vm is None:
            return None
        dump = getattr(self._drum_vm, "debug_state", None)
        if not callable(dump):
            return None
        try:
            return dump(inst.rack_path)
        except Exception as e:
            return {"error": "%s: %s" % (type(e).__name__, e)}

    def handle_stats(self, args, source_addr):
        """``/looping/probe/sequencer_stats [cmd?]`` → JSON reply to the
        asker. ``reset`` clears the lag samples and the tick maxima."""
        cmd = str(args[0]) if args else ""
        if cmd == "reset":
            self._lag.reset()
            self._tick_max_s = 0.0
            self._slow_ticks = 0
        return (json.dumps(self.stats()),)

    # --- reads ---------------------------------------------------------------------

    def _enabled(self) -> bool:
        if self._is_enabled is None:
            return True
        try:
            return bool(self._is_enabled())
        except Exception as e:
            self._warn_once("gate", "raised", "is_enabled raised: %s" % e)
            return False

    def _read_is_playing(self) -> bool:
        try:
            return bool(self._song.is_playing)
        except _LOM_ERRORS as e:
            self._warn_once("song", "is_playing", "read raised: %s" % e)
            return False

    def _read_song_time(self) -> Optional[float]:
        try:
            return float(self._song.current_song_time)
        except (_LOM_ERRORS, ValueError) as e:
            self._warn_once("song", "current_song_time", "read raised: %s" % e)
            return None

    def _read_tempo(self) -> float:
        try:
            t = float(self._song.tempo)
            return t if t > 0 else 120.0
        except (_LOM_ERRORS, ValueError):
            return 120.0

    def _read_numerator(self) -> int:
        try:
            n = int(self._song.signature_numerator)
            return n if n > 0 else sm.DEFAULT_TIME_SIGNATURE
        except (_LOM_ERRORS, ValueError):
            return sm.DEFAULT_TIME_SIGNATURE

    @staticmethod
    def _read_value(param) -> Optional[float]:
        try:
            return float(param.value)
        except (_LOM_ERRORS, ValueError):
            return None

    @staticmethod
    def _safe_class_name(device) -> str:
        try:
            return getattr(device, "class_name", "") or ""
        except _LOM_ERRORS:
            return ""

    @staticmethod
    def _safe_bool(obj, attr: str) -> bool:
        try:
            return bool(getattr(obj, attr))
        except _LOM_ERRORS:
            return False

    def _safe_tracks(self) -> List[object]:
        try:
            return list(self._song.tracks)
        except Exception as e:
            self._warn_once("song", "tracks", "tracks read raised: %s" % e)
            return []

    @staticmethod
    def _safe_devices(track) -> List[object]:
        try:
            return list(track.devices)
        except _LOM_ERRORS:
            return []

    def _warn_once(self, key: str, context: str, message: str) -> None:
        k = (key, context)
        if k in self._warned:
            return
        self._warned.add(k)
        logger.warning("SequencerComponent %s: %s: %s", key, context, message)

    # --- lifecycle --------------------------------------------------------------------

    def disconnect(self) -> None:
        """Restore every clip and go quiet. A surface reload mid-play must
        not leave clips shifted, muted or scrambled."""
        if self._disconnected:
            return
        try:
            for inst in list(self._retiring):
                self._restore_instance(inst, "disconnect")
                self._emit_idle(inst, inst.retired_path or inst.device_path)
            self._retiring = []
            if self._active or any(i.active() for i in self._instances.values()):
                self._stop_all("disconnect")
        finally:
            for inst in list(self._instances.values()) + list(self._retiring):
                self._unwatch_own_params(inst)
            for w in self._watchers.values():
                w.detach()
            self._watchers.clear()
            self._disconnected = True
            self._instances.clear()
            self._pid_index.clear()
