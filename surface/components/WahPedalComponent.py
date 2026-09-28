"""WahPedalComponent — the expression pedal's action layer.

One pedal, two devices, chosen by the kind of track under the selection
(ADR-445):

    audio track → the **Wah** — ``Wah.adg``, an Audio Effect Rack
    MIDI track  → **MidiWheels** — ``Vamp Devices/MidiWheels.amxd``,
                  the MIDI effect the on-screen wheels drive; the pedal
                  sweeps its mod wheel (CC 1) into the instrument behind it

Both share one handler shape: a value the expression pedal sweeps (the wah's
Macro 1, MidiWheels' mod-wheel parameter) and, on the wah only, a chain
selector the toe switch steps (Macro 2). The preset, the class + name the
device is re-found by, and where a load lands are read from
``constants.devices.wah`` and ``constants.devices.midiWheels``. A rig with
no ``midiWheels`` block behaves as before ADR-445: the wah everywhere.

Until 2026-09-25 the MIDI-track target was the **Expression Pedal** rack
(``Expression Pedal.adg``): one chain holding ``Modwheel Sender.amxd``, its
Macro 1 mapped to that device's CC 1 dial and its Macro 2 mapped to
nothing. MidiWheels replaced both, so the pedal and the on-screen mod wheel
share one device per track instead of stacking two CC 1 senders.

Owns the two wires the pedal reaches the surface on — as plain MIDI on the
surface's own input (ADR-422, ``MidiPedalInput``) or, from the legacy Max
ctlin→OSC chain, fire-and-forget to UDP 11020 like
``owner/Max Patches/foot-trigger.js``:

    /looping/v3/wah/engage           # CC 21 toe-switch — load-or-step Macro 2
    /looping/v3/wah/freq  [0-127]    # CC 20 expression — sweep Macro 1

(CC numbers per ``constants.midiPedals``, channel 10 on the USB pedal; the
legacy Max chain still sends the Bluetooth rig's CC 82 / 11 down the same two
wires.) The addresses keep their historical ``wah`` name: they are the
pedal's wires, whichever rack they land on.

Which rack a track gets
-----------------------

1. **A wah already on the selected track wins**, whatever the track. That is
   how a wah is put on a synth: the Pedal central view's Wah button loads it
   (``/looping/v3/device/load``, landing at the head of the audio effects
   like the pedal's own load), and from then on the pedal is the wah until
   the button removes it again.
2. Otherwise a **MIDI track** (``track.has_midi_input``) gets MidiWheels
   and an **audio track** the wah — both summoned by the same two gestures
   below. The pedal never puts a wah on a MIDI track by gesture; that is the
   button's job. A MidiWheels the on-screen wheels already loaded is the
   pedal's too.

engage action — the surface owns the context, exactly like ``foot/hold``:

    rack not on the selected track  → load it (loads enabled)
    rack already on the chain       → step Macro 2 to the next chain
                                      (the wah; MidiWheels has no chains,
                                      so engage on it does nothing)

Sweep-to-load: the toe switch isn't the only way to summon the rack. On a
track without one, rocking the expression pedal through its *whole* travel —
both extremes seen, either order, within ``sweepLoadMargin`` of 0 and 127 —
loads it too, at the same place. Rationale: the pedal is already under your
foot mid-phrase, and a full heel-to-toe rock is a gesture nothing else
produces by accident (a partial sweep, however wide, never fires). The two
extremes are latched, not timed: they need not be adjacent frames, but the
pair is dropped whenever the selection or the track's device list changes
or a rack resolves, so a stale half-sweep can't summon a rack onto a track
you've moved to.

Placement: when engage *loads* the wah it lands at the head of the track's
audio effects (ADR-094's intent — a wah usually wants to sit before drive /
dynamics) — placed there BY the load, never moved afterwards. The loader
(``DeviceLoadComponent.load_into_track(..., at_head=True)``, ADR-437) selects
the track's first audio effect and sets the track's device insert mode to
"left of the selection" for the call; the rack is in ``track.devices`` when
the call returns. MidiWheels takes the plain load: a MIDI
effect goes where Live puts MIDI effects, ahead of the instrument. Until
2026-09-14 the wah load was followed by ``song.move_device`` to position 0 on
the next resolve — and undoing that move of a device Live had just loaded
aborted Live, a native rack and a Max device alike (measured). A hand-placed
or saved-set rack is never touched.

freq action — write the rack's value macro (Macro 1 by default). The macro
ref is cached so the ~100 msg/s sweep doesn't walk the device chain per
message. The cache is scoped to the selected track: a ``selected_track``
listener drops it on every selection change, so the next write re-resolves
against the track now in view — or feeds the sweep latches if that track
has no rack. The sweep therefore only ever touches the current track's
rack; it never keeps writing an old track's macro after you navigate away.
Within a track the sweep stays cached (the chain-walk happens once per
selection change, not per message); a cached ref that raises (rack removed,
set reloaded) also re-resolves. This revises ADR-407's original "re-engage
to re-target" rule — selection alone now moves the sweep.

The cache is also dropped when **any track's device list changes**
(``on_track_devices_changed``, fanned out from ``LOMListeners`` by
``LoopingSurface``): a wah the Pedal view's button just put on the selected
MIDI track takes the pedal over on the next frame, without a track switch,
and a rack the pedal loaded is found the moment Live shows it. One chain
walk per structural change is cheap; telling the selected track apart by
LOM identity from inside a notification is not worth a stale wrapper.

Why this lives on the surface, not as raw ``device/load`` + ``param/set``
from Max
------------------------------------------------------------------------

A standalone Max client has no notion of "the selected track" or where the
rack landed in the chain after an append — that state only ever flows on the
surface→bridge broadcast path the Max patch isn't on (``osc_transport`` does
NOT last-sender-wins; broadcasts go to the fixed bridge port). Sending
*intent* and letting the surface resolve selection + device index keeps the
Max patch as dumb as ``foot-trigger.js``: two ``udpsend … 11020`` messages,
no ``trackPath``, no device index, no generation counter, no listening. It
also fixes two problems the generic-endpoint route would hit — a repeated
toe-switch press stacking duplicate racks (``device/load`` appends and does
not dedupe) and a hardcoded device index breaking on reorder.

Device resolution mirrors ``fxGridStore``'s ``className + name`` match, so a
track carrying other racks isn't confused for the pedal's. Every
``className`` / ``deviceName`` / ``freqMacroIndex`` / ``toggleMacroIndex`` /
``sweepLoadMargin`` is read from the target's block under
``constants.devices`` so the mapping is tunable without a code change —
matching the project's "verify LOM param indices at runtime" habit.

LOM-touch guard: every read/call is wrapped in ``_LOM_ERRORS`` per the
Live 12 quirks doc — ``TypeError`` covers ``Boost.Python.ArgumentError``
from torn-down handles. This gesture path is fire-and-forget (no UI awaiting
an ack), so failures are logged and swallowed rather than raised as a typed
wire error.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional, Tuple

from .MidiWheelsComponent import (
    CONFIG_KEY as MIDI_WHEELS_CONFIG_KEY,
    read_midi_wheels_config,
)

logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch must catch. ``TypeError`` covers
# ``Boost.Python.ArgumentError`` (a TypeError subclass) raised when a C++
# handle is torn down — see the merge-gate rule in surface/CLAUDE.md.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)

# The hot freq write additionally guards against a non-numeric ``min``/``max``
# read (``ValueError`` isn't a LOM error but must not escape the sweep path).
_WRITE_ERRORS: Tuple[type, ...] = _LOM_ERRORS + (ValueError,)


# --- wire addresses (closed-enum; renames fail at import time) -------------

V3_WAH_ENGAGE_ADDRESS = "/looping/v3/wah/engage"
V3_WAH_FREQ_ADDRESS = "/looping/v3/wah/freq"


# --- defaults (used when a target's block under constants.devices is
# missing a key) -------------------------------------------------------------

# Live's LOM class for an Audio Effect Rack. Every device's ``parameters[0]``
# is "Device On"; a rack's macros follow at ``parameters[1..]`` — so Macro 1
# is index 1, Macro 2 is index 2. Confirmed by the user against the live rack;
# both overridable via ``constants.devices.wah``.
_DEFAULT_WAH_CLASS_NAME = "AudioEffectGroupDevice"
_DEFAULT_WAH_DEVICE_NAME = "Wah"

# The MIDI-track target (ADR-445, MidiWheels since 2026-09-25): the block
# under ``constants.devices`` that configures it — absent, MIDI tracks get the
# wah as they did before ADR-445.
MIDI_TARGET_CONFIG_KEY = MIDI_WHEELS_CONFIG_KEY

_DEFAULT_FREQ_MACRO_INDEX = 1

# engage steps this macro across the rack's chains when the rack is already
# loaded (Macro 2 — mapped to the chain selector on both racks).
_DEFAULT_TOGGLE_MACRO_INDEX = 2

# Sweep-to-load: how close to each end of the 0-127 CC range the expression
# pedal must reach for that end to count. A real pedal's stops are a little
# short of the rails, and its pot is noisy there, so this is not an equality
# test. Overridable per target via ``sweepLoadMargin``; 0 demands literal 0
# and 127.
_DEFAULT_SWEEP_LOAD_MARGIN = 2

# The CC range the freq wire carries (documented on ``/looping/v3/wah/freq``).
_CC_MIN = 0
_CC_MAX = 127

# Widest usable margin — beyond this the low and high bands overlap and no
# value could ever latch the far end.
_MAX_SWEEP_LOAD_MARGIN = (_CC_MAX - _CC_MIN - 1) // 2


# --- config coercion --------------------------------------------------------


def _str_or(value, fallback: str) -> str:
    return value if isinstance(value, str) and value else fallback


def _int_or(value, fallback: int) -> int:
    try:
        if isinstance(value, bool):
            return fallback
        return int(value)
    except (TypeError, ValueError):
        return fallback


class _PedalTarget:
    """One rack the pedal can summon and drive.

    The wah on audio tracks, MidiWheels on MIDI tracks: ``freq_index`` the
    value the expression pedal sweeps, ``toggle_index`` the chain selector
    the toe switch steps (None on MidiWheels, which has no chains), so the
    component's handlers take a target and never ask which device it is.
    ``at_head`` is where a load lands — the head of the track's audio
    effects for the wah, wherever Live puts a MIDI effect for the other.
    """

    __slots__ = (
        "key", "preset_path", "class_name", "device_name",
        "freq_index", "toggle_index", "sweep_margin", "at_head",
    )

    def __init__(
        self, key: str, cfg, default_class: str, default_name: str,
        at_head: bool,
    ) -> None:
        cfg = cfg if isinstance(cfg, dict) else {}
        self.key = key
        self.preset_path = _str_or(cfg.get("presetPath"), "")
        self.class_name = _str_or(cfg.get("className"), default_class)
        self.device_name = _str_or(cfg.get("deviceName"), default_name)
        self.freq_index = _int_or(
            cfg.get("freqMacroIndex"), _DEFAULT_FREQ_MACRO_INDEX,
        )
        self.toggle_index = _int_or(
            cfg.get("toggleMacroIndex"), _DEFAULT_TOGGLE_MACRO_INDEX,
        )
        # Clamped so the two bands can never meet: at margin 64 every value
        # would read as "low end" and the gesture could never complete.
        self.sweep_margin = min(_MAX_SWEEP_LOAD_MARGIN, max(0, _int_or(
            cfg.get("sweepLoadMargin"), _DEFAULT_SWEEP_LOAD_MARGIN,
        )))
        self.at_head = at_head

    @classmethod
    def midi_wheels(cls, constants) -> Optional["_PedalTarget"]:
        """MidiWheels as the pedal's MIDI-track target, from
        ``devices.midiWheels`` — the pedal sweeps its mod-wheel parameter and
        has no chain selector to step. None when the block is absent."""
        wheels = read_midi_wheels_config(constants)
        if wheels is None:
            return None
        target = cls(
            MIDI_TARGET_CONFIG_KEY,
            {
                "presetPath": wheels.device_path,
                "className": wheels.class_name,
                "deviceName": wheels.device_name,
                "freqMacroIndex": wheels.mod_index,
                "sweepLoadMargin": wheels.sweep_margin_raw,
            },
            wheels.class_name, wheels.device_name, at_head=False,
        )
        target.toggle_index = None
        return target

    def describe(self) -> str:
        return (
            "%s(preset=%r, class=%r, name=%r, freq_index=%d, "
            "toggle_index=%s, sweep_load_margin=%d, at_head=%s)" % (
                self.key, self.preset_path, self.class_name,
                self.device_name, self.freq_index, self.toggle_index,
                self.sweep_margin, self.at_head,
            )
        )


class WahPedalComponent:
    """Handles the two pedal gesture wires.

    Args:
        song: The Live ``Song``.
        constants: The constants dict (already loaded by ``LoopingSurface``
            via ``config_loader.load()``). Reads ``devices.wah`` (always) and
            ``devices.midiWheels`` (the MIDI-track device; absent → MIDI
            tracks get the wah) for each rack's preset path plus the
            class/name/macro-index used to re-find it. A missing
            ``presetPath`` disables that rack's load leg (engage on a track
            without it logs a WARN and no-ops); the class/name/index keys
            fall back to the defaults above.
        load_into_track: ``(track, preset_path, at_head=False) ->
            Optional[str]`` closure wired by ``LoopingSurface`` to
            ``DeviceLoadComponent.load_into_track``. Returns ``None`` on
            success or a short detail string on failure. Resolved lazily by
            the caller so ordering vs. the device-load component (or its
            Live-version gate) doesn't matter.
    """

    V3_WAH_ENGAGE_ADDRESS = V3_WAH_ENGAGE_ADDRESS
    V3_WAH_FREQ_ADDRESS = V3_WAH_FREQ_ADDRESS

    def __init__(
        self,
        song,
        constants: dict,
        load_into_track: Callable[..., Optional[str]],
    ) -> None:
        self._song = song
        self._load_into_track = load_into_track
        self._disconnected = False

        devices = {}
        if isinstance(constants, dict) and isinstance(
            constants.get("devices"), dict,
        ):
            devices = constants["devices"]

        self._wah = _PedalTarget(
            "wah", devices.get("wah"),
            _DEFAULT_WAH_CLASS_NAME, _DEFAULT_WAH_DEVICE_NAME, at_head=True,
        )
        # ADR-445: the MIDI-track target exists only when configured. A rig
        # without ``devices.midiWheels`` keeps the pre-ADR-445 behavior — the
        # wah on every track.
        self._midi_target: Optional[_PedalTarget] = _PedalTarget.midi_wheels(
            constants,
        )

        # Set by a load, cleared once the loaded rack resolves on the track
        # (or the selection / a device list moves): a second sweep must not
        # stack another load while the first is still not visible. Nothing is
        # moved on its account (ADR-437) — it is only the "load in flight"
        # guard.
        self._load_pending = False

        # Sweep-to-load latches: which end(s) of the expression pedal's
        # travel we've seen *since* the last selection change / resolve,
        # while the selected track has no rack. Both set ⇒ load.
        self._sweep_low_seen = False
        self._sweep_high_seen = False

        # Cached value ``DeviceParameter`` for the rack currently driven.
        # None ⇒ resolve on the next freq write. Never compared by identity
        # (LOM hands out fresh wrappers); staleness is detected by a raising
        # write, which clears it.
        self._freq_param = None

        for target in (self._wah, self._midi_target):
            if target is not None and not target.preset_path:
                logger.warning(
                    "WahPedalComponent: devices.%s.presetPath missing from "
                    "constants.json — engage will step an existing rack's "
                    "macro but cannot load one.", target.key,
                )

        # Scope the freq sweep to the selected track (ADR-407 revision). A
        # ``selected_track`` listener drops the cached macro on every
        # selection change so the expression pedal re-resolves against the
        # track now in view instead of staying glued to the last-engaged
        # one. Attached best-effort — a ``song.view`` without the listener
        # API (or a raising read) just leaves the sweep on its cache.
        self._view = self._safe_song_view()
        self._listener_attached = False
        if self._view is not None:
            try:
                self._view.add_selected_track_listener(
                    self._on_selected_track_changed,
                )
                self._listener_attached = True
            except _LOM_ERRORS as e:
                logger.warning(
                    "WahPedalComponent: attach selected_track listener "
                    "raised: %s: %s", type(e).__name__, e,
                )

        logger.info(
            "WahPedalComponent: ready (audio tracks: %s; MIDI tracks: %s; "
            "selection_listener=%s)",
            self._wah.describe(),
            self._midi_target.describe() if self._midi_target is not None
            else "the wah (no devices.%s block)" % MIDI_TARGET_CONFIG_KEY,
            self._listener_attached,
        )

    # --- wire handlers ----------------------------------------------------

    def handle_engage(self, args, source_addr) -> None:
        """``/looping/v3/wah/engage`` — load the track's rack, or step its
        Macro 2.

        Reads ``song.view.selected_track`` itself (the pedal sends no
        target) and picks the rack by track kind — the wah on an audio
        track, MidiWheels on a MIDI track, a wah already there
        on either.

        - rack already on that track → advance Macro 2 to the next chain
          step (wrapping past the last), and refresh the cached value macro
          so the sweep follows this rack.
        - rack not there → load its preset (the wah at the head of the
          track's audio effects, the MIDI rack where Live puts a MIDI
          effect) and clear the cache so the first freq write resolves the
          fresh rack.
        """
        if self._disconnected:
            return
        track = self._selected_track()
        if track is None:
            logger.warning("WahPedalComponent: engage — no selected track")
            return

        target, device = self._resolve(track)
        if device is not None:
            if target.toggle_index is not None:
                self._step_macro(device, target)
            # Point the sweep at this rack from here on.
            self._freq_param = self._macro_at(device, target.freq_index)
            self._reset_sweep_latches()
            return

        # Not present — summon it. Clear the cache so the first freq write
        # resolves the fresh rack and binds the sweep.
        if self._load_target(track, target):
            self._load_pending = True
        self._freq_param = None
        self._reset_sweep_latches()

    def handle_freq(self, args, source_addr) -> None:
        """``/looping/v3/wah/freq [0-127]`` — sweep the rack's value macro.

        Hot path: writes the cached macro directly. On a stale cache (the
        write raises) or a cold cache — which includes the frame right after
        a selection or device-list change, since the listeners drop the
        cache — re-resolves the track's rack once and writes. Value is
        clamped into the macro's own range — a raw 0-127 CC lands 1:1 on a
        0-127 macro, no scaling.

        No rack on that track is not a plain no-op: the value feeds the
        sweep-to-load latches instead, and a full heel-to-toe rock (both ends
        of the CC range seen) summons the track's rack exactly as the toe
        switch would.
        """
        if self._disconnected or not args:
            return
        try:
            value = float(args[0])
        except (TypeError, ValueError):
            logger.warning("WahPedalComponent: freq coerce failed args=%r", args)
            return
        if value != value:  # NaN guard, same posture as DevicesComponent.
            return

        param = self._freq_param
        if param is not None and self._write_macro(param, value):
            return
        # Cold or stale cache — re-resolve against the current selection.
        self._freq_param = None
        track = self._selected_track()
        if track is None:
            return
        target, device = self._resolve(track)
        if device is None:
            self._note_sweep(track, target, value)
            return
        self._reset_sweep_latches()
        param = self._macro_at(device, target.freq_index)
        if param is None:
            return
        self._freq_param = param
        self._write_macro(param, value)

    # --- structural hooks -------------------------------------------------

    def on_track_devices_changed(self, track) -> None:
        """A track's device list changed (``LOMListeners``' add/remove
        callbacks, fanned out by ``LoopingSurface``).

        Drops the cached macro, the load-in-flight guard and any half-sweep
        so the next frame re-resolves: a wah the Pedal view's button just
        put on the selected MIDI track takes the pedal over at once (rule 1
        above), and a rack the pedal loaded is found the moment Live shows
        it. Any track's change counts — the resolve is what decides, and it
        costs one chain walk. Pure Python state only: this runs inside
        Live's notification callback, where a LOM write would be dropped.
        Also fired for every device on the initial walk at startup, which
        is harmless — nothing is cached yet.
        """
        if self._disconnected:
            return
        self._freq_param = None
        self._load_pending = False
        self._reset_sweep_latches()

    # --- internal helpers -------------------------------------------------

    def _selected_track(self):
        try:
            return self._song.view.selected_track
        except _LOM_ERRORS as e:
            logger.warning(
                "WahPedalComponent: read selected_track raised: %s: %s",
                type(e).__name__, e,
            )
            return None

    def _safe_song_view(self):
        """Return ``song.view`` or None if the read raises."""
        try:
            return self._song.view
        except _LOM_ERRORS as e:
            logger.warning(
                "WahPedalComponent: read song.view raised: %s: %s",
                type(e).__name__, e,
            )
            return None

    def _on_selected_track_changed(self) -> None:
        """``song.view.selected_track`` changed — re-scope the sweep.

        Drops the cached macro (and any half-finished sweep-to-load)
        so the next expression-pedal frame re-resolves the rack on the
        track now in view, or starts a fresh sweep latch if that track
        carries none. This is what keeps the sweep scoped to the current
        track (ADR-407 revision): selection alone now re-targets, where it
        used to require a re-engage. Pure Python state only — safe to run
        inside Live's notification callback (no LOM write to defer).
        """
        if self._disconnected:
            return
        self._freq_param = None
        self._load_pending = False
        self._reset_sweep_latches()

    def _reset_sweep_latches(self) -> None:
        """Drop both sweep-to-load ends.

        Called wherever "this track's rack situation just changed": a rack
        resolved, engage loaded or stepped one, the selection moved or a
        device list changed. A half-sweep must never survive into a
        different track.
        """
        self._sweep_low_seen = False
        self._sweep_high_seen = False

    def _is_midi_track(self, track) -> bool:
        """``track.has_midi_input``, guarded. A raising read counts as audio
        — the wah, the behavior every track had before ADR-445."""
        try:
            return bool(track.has_midi_input)
        except _LOM_ERRORS as e:
            logger.warning(
                "WahPedalComponent: read has_midi_input raised: %s: %s",
                type(e).__name__, e,
            )
            return False

    def _resolve(self, track) -> Tuple[_PedalTarget, Optional[object]]:
        """``(target, device)`` for ``track`` — which rack the track gets,
        and that rack if it is already on the chain (else ``None``).

        A wah anywhere on the track wins (rule 1). Otherwise a MIDI track
        gets MidiWheels when one is configured, an audio
        track the wah. The single resolve point both handlers use for
        action; nothing is ever moved here (ADR-437), and a found rack
        clears the load-in-flight guard.
        """
        wah = self._find_device(track, self._wah)
        if wah is not None:
            self._load_pending = False
            return self._wah, wah
        if self._midi_target is not None and self._is_midi_track(track):
            rack = self._find_device(track, self._midi_target)
            if rack is not None:
                self._load_pending = False
            return self._midi_target, rack
        return self._wah, None

    def _note_sweep(self, track, target: _PedalTarget, value: float) -> None:
        """Feed one expression-pedal value to the sweep-to-load latches.

        Only ever reached with no rack on the selected track. Latches the
        end the value is at (if any), and once *both* ends have been seen
        loads ``target`` the same way ``handle_engage`` does. The rack is in
        ``track.devices`` when the load returns (measured, ADR-437), so the
        next frame resolves it and a fast rock-back finds the rack instead of
        stacking a second copy; ``_load_pending`` covers a load whose rack is
        not visible yet.
        """
        if self._load_pending:
            return  # a load is already on its way — don't stack another
        margin = target.sweep_margin
        if value <= _CC_MIN + margin:
            self._sweep_low_seen = True
        elif value >= _CC_MAX - margin:
            self._sweep_high_seen = True
        if not (self._sweep_low_seen and self._sweep_high_seen):
            return
        self._reset_sweep_latches()
        logger.info(
            "WahPedalComponent: full expression sweep on a track without "
            "its rack — loading %s", target.key,
        )
        if self._load_target(track, target):
            self._load_pending = True

    def _find_device(self, track, target: _PedalTarget):
        """Return ``target``'s rack on ``track`` (class + name match) or None.

        Mirrors ``fxGridStore``'s ``className && name`` resolution so another
        rack on the same track isn't mistaken for the pedal's.
        """
        try:
            devices = track.devices
        except _LOM_ERRORS as e:
            logger.warning(
                "WahPedalComponent: read track.devices raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        for device in (devices or ()):
            try:
                if (
                    getattr(device, "class_name", "") == target.class_name
                    and getattr(device, "name", "") == target.device_name
                ):
                    return device
            except _LOM_ERRORS:
                continue
        return None

    def _macro_at(self, device, index):
        """Return the rack's ``parameters[index]`` or None.

        Bounds-checks both ends: a negative index would pass a bare
        ``len(params) > index`` and silently return params[-1] (the last
        parameter) instead of failing.
        """
        try:
            params = device.parameters
            if params is not None and 0 <= index < len(params):
                return params[index]
        except _LOM_ERRORS as e:
            logger.warning(
                "WahPedalComponent: read parameters raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        logger.warning(
            "WahPedalComponent: rack has no parameter at index %d", index,
        )
        return None

    def _chain_count(self, device) -> int:
        """Number of chains in the rack, or 0 if it can't be read.

        ``RackDevice.chains`` — return chains live on a separate
        ``return_chains`` list and are deliberately not counted: they aren't
        selectable by the chain selector, so they aren't steps.
        """
        try:
            chains = device.chains
            return len(chains) if chains is not None else 0
        except _LOM_ERRORS as e:
            logger.warning(
                "WahPedalComponent: read chains raised: %s: %s",
                type(e).__name__, e,
            )
            return 0

    @staticmethod
    def _step_values(count: int, lo: float, hi: float):
        """The ``count`` macro values that select each chain in turn.

        Evenly spaced across the macro's full range, endpoints included, and
        rounded to whole macro units (Live shows macros as integers):

            2 chains → 0, 127
            3 chains → 0, 64, 127
            4 chains → 0, 42, 85, 127
            5 chains → 0, 32, 64, 95, 127

        Even spacing is what lands each step in its own chain-selector zone:
        a macro mapped across the selector's 0..count-1 range is linear, and
        Live gives auto-created chains equal zones. (Spacing them by a fixed
        step instead — 0, 48, 96, 127 for four — would put two values inside
        the same zone and skip a chain.)
        """
        if count < 2 or hi <= lo:
            return []
        span = hi - lo
        return [
            round(lo + span * i / (count - 1)) * 1.0 for i in range(count)
        ]

    def _step_macro(self, device, target: _PedalTarget):
        """Advance the toggle macro (Macro 2) to the next chain.

        engage on an already-loaded rack walks its chains: the macro lands
        on the step nearest its current value, then moves to the next one,
        wrapping past the last back to the first. With two chains that is
        the old 0↔127 flip, so nothing changes for a two-chain rack.

        Falls back to the 0↔max midpoint flip when the chain count can't be
        read or is < 2 (a chain-less rack, or a torn-down handle) — a single
        chain has nothing to step through. Reuses ``_write_macro`` for the
        clamped write; the echo tracks the UI.
        """
        param = self._macro_at(device, target.toggle_index)
        if param is None:
            return
        try:
            current = float(param.value)
            lo = float(param.min)
            hi = float(param.max)
        except _WRITE_ERRORS as e:
            logger.warning(
                "WahPedalComponent: read toggle macro raised: %s: %s",
                type(e).__name__, e,
            )
            return

        count = self._chain_count(device)
        steps = self._step_values(count, lo, hi)
        if steps:
            # Nearest step to where the macro sits now — tolerant of a hand-
            # dragged macro or a rack whose chain count changed under us.
            index = min(
                range(len(steps)), key=lambda i: abs(steps[i] - current),
            )
            new_value = steps[(index + 1) % len(steps)]
        else:
            # Fallback when the chain count can't be read (or is < 2): flip
            # 0↔max across the macro's own midpoint, the pre-chain-stepping
            # behavior. Derived from lo/hi rather than assuming 0-127, since
            # both are read from param.min/param.max just above.
            new_value = hi if current < (lo + hi) / 2 else lo

        if self._write_macro(param, new_value):
            logger.info(
                "WahPedalComponent: %s — stepped macro %d %.1f → %.1f "
                "(%d chain%s)",
                target.key, target.toggle_index, current, new_value,
                count, "" if count == 1 else "s",
            )

    def _load_target(self, track, target: _PedalTarget) -> bool:
        """Load ``target``'s preset onto ``track`` — the wah at the head of
        its audio effects, the MIDI rack where Live puts a MIDI effect.
        Returns True on a clean load."""
        if not target.preset_path:
            logger.warning(
                "WahPedalComponent: no devices.%s.presetPath; skipping load",
                target.key,
            )
            return False
        try:
            err = self._load_into_track(
                track, target.preset_path, at_head=target.at_head,
            )
        except Exception as e:  # defensive — a load failure must not crash us
            logger.warning(
                "WahPedalComponent: %s load raised: %s: %s",
                target.key, type(e).__name__, e,
            )
            return False
        if err:
            logger.warning(
                "WahPedalComponent: %s load failed: %s", target.key, err,
            )
            return False
        logger.info(
            "WahPedalComponent: loaded %s onto selected track", target.key,
        )
        return True

    def _write_macro(self, param, value: float) -> bool:
        """Clamp ``value`` into the macro's range and write it.

        Returns ``True`` on a clean write; ``False`` if any read/write raised
        — the signal the caller uses to drop and re-resolve a stale ref.
        """
        try:
            lo = float(param.min)
            hi = float(param.max)
            clamped = lo if value < lo else hi if value > hi else value
            param.value = clamped
        except _WRITE_ERRORS as e:
            logger.warning(
                "WahPedalComponent: macro write raised (stale ref?): %s: %s",
                type(e).__name__, e,
            )
            return False
        return True

    # --- config coercion (kept on the class for callers that reach here) --

    _str_or = staticmethod(_str_or)
    _int_or = staticmethod(_int_or)

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. Detaches the ``selected_track`` listener and
        short-circuits subsequent handler calls."""
        if self._disconnected:
            return
        self._disconnected = True
        if self._view is not None and self._listener_attached:
            remove = getattr(
                self._view, "remove_selected_track_listener", None,
            )
            if remove is not None:
                try:
                    remove(self._on_selected_track_changed)
                except _LOM_ERRORS as e:
                    logger.warning(
                        "WahPedalComponent: detach selected_track listener "
                        "raised: %s: %s", type(e).__name__, e,
                    )
        self._listener_attached = False
        self._freq_param = None
        self._load_pending = False
        self._reset_sweep_latches()
