"""MidiPedalInput — USB-direct pedal MIDI → gesture callbacks (ADR-422).

The foot switch and the wah pedal historically reached the surface
through two Max ctlin→OSC bridges (``owner/Max Patches/foot-trigger.js``
inside Max Utility, and the operator's personal wah patch), both firing
``udpsend 127.0.0.1 11020``. With the pedal plugged in over USB and the
port assigned as the Looping control surface's MIDI **Input** in Live's
preferences, the same CCs arrive as plain MIDI instead — this adapter
turns them into the same four gestures the OSC wires carry:

    foot switch (learned)    press/release → tap or hold  (foot-trigger.js port)
    CC 21 (wahToeSwitchCC)   either edge   → wah engage
    CC 20 (wahExpressionCC)  every value   → wah freq [0-127]

The foot switch is a **user setting**, not config: its channel, CC and
mode (``FootMapping``) are learned from the System view and persisted by
``FootSwitchComponent``, which calls ``set_foot_mapping`` and
``start_learn`` here. ``midiPedals.footSwitchCC`` only seeds it on a
machine with nothing saved, and with neither there is no foot switch at
all: before 2026-09-26 a missing key fell back to CC 23, so a stranger
who picked their keyboard as the Input got looper taps from it.

The two wah CCs share ``midiPedals.channel`` — 10 in the rig today — and
exist only while ``features.expressionPedal`` is on (the surface passes no
wah callbacks otherwise). Setting ``channel`` to 0 restores the
pre-ADR-422 omni behavior (all 16 channels, mirroring a Max ``ctlin``
with no channel argument) for a rig whose pedal channel is unknown.
Messages nothing owns are neither owned nor forwarded, so they fall
through to the framework base class untouched; this is what keeps a
shared input port from turning stray controller traffic into pedal
gestures.

It is deliberately plain Python with injected callbacks / scheduler /
clock — no LOM, no framework — so the tap/hold timing that used to be
untestable Max ES5 is covered by pytest. The framework-facing halves
(``build_midi_map`` forwarding + ``receive_midi`` routing) live in
``LoopingSurface``; the gesture *semantics* stay where they already
were, in ``FootTriggerComponent`` / ``WahPedalComponent`` — the
callbacks wired by ``LoopingSurface`` call those components' existing
OSC handlers, so the OSC wires remain live as a fallback path.

Tap/hold state machine — a faithful port of ``foot-trigger.js``:

- press starts a hold check scheduled at ``holdThresholdMs`` (from
  ``constants.osc.footTrigger``, the value ADR-326 parked there; the
  Max file hardcodes 500 only because Max ES5 can't read JSON);
- the check firing while the pedal is still down emits **hold** and
  suppresses the following release's tap (``holdFired`` in the JS);
- release before the check emits **tap** — unless the press has already
  outlived the threshold, in which case it emits **hold** instead: the
  surface's scheduler has ~100ms tick granularity (vs. Max's ms-accurate
  ``Task``), and this release-time clock check keeps the tap/hold
  boundary exact at the threshold instead of blurring by up to a tick;
- a second press while already down is ignored (press debounce), an
  unmatched release is ignored, and a press sequence counter keeps a
  stale scheduled check from a *previous* press from firing hold into a
  new one.

Both switches split high from low at value ≥ 64 — the standard MIDI
switch convention, matching how Live itself reads momentary CCs. (The
retired Utility Max chain edged the foot switch at a literal ``> 0``;
that reads a pedal whose "off" is a low non-zero value — e.g. 126 on /
1 off — as a second press, so the release never lands and the switch
latches down.) Repeated same-direction values collapse into one edge
(the ``change`` object's job in the Max chain).

The foot switch is momentary or latching (``FootMapping.mode``, which
learn detects). Momentary: one side of 64 is a press, the other a
release, and the gap between them is the tap/hold timer; which side is
the press is learned too, since a normally-closed switch presses low.
Latching: every stomp is a tap, and there is no hold. The wah toe switch
**latches** — one physical press flips it 0 → 127, the next flips it
127 → 0 — so *both* edges fire engage. Edging on the high side alone
would advance the wah's chain on only every other press.

Every callback invocation is guarded — a raising component must not
corrupt the state machine or escape into Live's MIDI dispatcher.
"""

from __future__ import annotations

import logging
import time
from typing import Callable, NamedTuple, Optional, Sequence, Tuple

logger = logging.getLogger("looping")


# --- defaults ----------------------------------------------------------------

# The wah's CCs and channel as wired in the rig. The pedal sends everything
# on channel 10: wah toe switch CC 21, expression sweep CC 20. Overridable
# via ``constants.midiPedals``; read only while ``features.expressionPedal``
# is on (the surface passes no wah callbacks otherwise).
#
# The foot switch has NO default: it is a user setting (``FootMapping``,
# learned from the System view and persisted by ``FootSwitchComponent``).
# ``midiPedals.footSwitchCC`` only seeds it on a machine with nothing saved.
_DEFAULT_WAH_TOE_CC = 21
_DEFAULT_WAH_EXPRESSION_CC = 20

# 1-16 as labeled in Live and on the pedal; 0 means listen omni.
_DEFAULT_CHANNEL = 10
_OMNI_CHANNEL = 0

# Fallback when ``osc.footTrigger.holdThresholdMs`` is missing. Matches
# HOLD_MS in foot-trigger.js.
_DEFAULT_HOLD_THRESHOLD_MS = 500

# Press threshold for both switches — see module docstring.
_FOOT_PRESS_MIN = 64
_TOE_PRESS_MIN = 64

# MIDI status high nibble for a control change.
_CC_STATUS = 0xB0

# Learn: how long to wait for the first CC before giving up, and how long
# after it a momentary switch's release must arrive. A switch that sends
# one value per stomp and nothing on release is latching.
_LEARN_TIMEOUT_MS = 10000
_LEARN_RELEASE_WINDOW_MS = 1500

MOMENTARY = "momentary"
LATCHING = "latching"
_MODES = (MOMENTARY, LATCHING)


class FootMapping(NamedTuple):
    """Which CC is the foot switch, and how it behaves.

    ``channel`` is 1-16 as labeled in Live, or 0 for all 16. ``mode``:

    - ``momentary`` — the switch sends one value on press and the other on
      release. Tap and hold both work. ``press_high`` says which side of 64
      the press is: most switches press high, some (normally-closed ones)
      press low.
    - ``latching`` — one value per stomp, alternating. There is no release
      to time, so every stomp is a tap and hold is not available. Read as
      momentary, a latching switch turned every first stomp into a hold.
    """

    channel: int
    cc: int
    mode: str = MOMENTARY
    press_high: bool = True

    def to_dict(self) -> dict:
        return {
            "channel": self.channel,
            "cc": self.cc,
            "mode": self.mode,
            "pressHigh": self.press_high,
        }


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def foot_mapping_from_dict(data) -> Optional[FootMapping]:
    """Validate a persisted mapping; ``None`` for anything malformed."""
    if not isinstance(data, dict):
        return None
    channel, cc = data.get("channel"), data.get("cc")
    mode = data.get("mode", MOMENTARY)
    press_high = data.get("pressHigh", True)
    if not (_is_int(channel) and 0 <= channel <= 16):
        return None
    if not (_is_int(cc) and 0 <= cc <= 127):
        return None
    if mode not in _MODES or not isinstance(press_high, bool):
        return None
    return FootMapping(channel, cc, mode, press_high)


def foot_mapping_from_constants(constants) -> Optional[FootMapping]:
    """The seed mapping from ``midiPedals``, or ``None`` when it names no
    foot switch. A missing ``footSwitchCC`` is no foot switch at all — not a
    default CC that quietly listens on whatever the Input is."""
    cfg = constants.get("midiPedals") if isinstance(constants, dict) else None
    if not isinstance(cfg, dict) or "footSwitchCC" not in cfg:
        return None
    cc = cfg.get("footSwitchCC")
    if not (_is_int(cc) and 0 <= cc <= 127):
        logger.warning(
            "MidiPedalInput: midiPedals.footSwitchCC=%r invalid (want int "
            "0-127); no foot switch",
            cc,
        )
        return None
    channel = MidiPedalInput._channel_or(cfg.get("channel"), _DEFAULT_CHANNEL)
    return FootMapping(channel, cc)


class MidiPedalInput:
    """Translate pedal CCs into foot tap/hold + wah engage/freq gestures.

    Args:
        constants: The constants dict (already loaded by
            ``LoopingSurface`` via ``config_loader.load()``). Reads
            ``midiPedals.{channel,wahToeSwitchCC,wahExpressionCC}`` for
            the wah (falling back to the rig's channel 10 / 21 / 20) and
            ``osc.footTrigger.holdThresholdMs`` (500ms).
        foot_mapping: The foot switch (``FootMapping``), or ``None`` for
            none. Changed at runtime with ``set_foot_mapping``.
        on_foot_tap / on_foot_hold / on_wah_engage: arg-free gesture
            callbacks. ``None`` disables that gesture (the CC is then not
            forwarded/owned at all).
        on_wah_freq: ``(value: int) -> None`` — raw 0-127 CC value,
            same semantics as the ``/looping/v3/wah/freq`` wire.
        on_foot_heard: arg-free, called once per mapping when the foot
            switch's CC first arrives — the System view's "working" state.
        schedule_delayed: ``(delay_ms, fn)`` scheduler
            (``LoopingSurface._schedule_delayed``). ``None`` — or a
            scheduler that raises — degrades gracefully: hold can then
            only resolve at release time via the clock check, i.e. it
            no longer fires *while* the pedal is still down, and learn
            cannot tell a latching switch or time out.
        monotonic: seconds clock, injectable for tests.
    """

    def __init__(
        self,
        constants: dict,
        on_foot_tap: Optional[Callable[[], None]] = None,
        on_foot_hold: Optional[Callable[[], None]] = None,
        on_wah_engage: Optional[Callable[[], None]] = None,
        on_wah_freq: Optional[Callable[[int], None]] = None,
        schedule_delayed: Optional[
            Callable[[int, Callable[[], None]], None]
        ] = None,
        monotonic: Callable[[], float] = time.monotonic,
        foot_mapping: Optional[FootMapping] = None,
        on_foot_heard: Optional[Callable[[], None]] = None,
    ) -> None:
        self._on_foot_tap = on_foot_tap
        self._on_foot_hold = on_foot_hold
        self._on_wah_engage = on_wah_engage
        self._on_wah_freq = on_wah_freq
        self._on_foot_heard = on_foot_heard
        self._schedule_delayed = schedule_delayed
        self._monotonic = monotonic
        self._disconnected = False

        cfg = {}
        if isinstance(constants, dict) and isinstance(
            constants.get("midiPedals"), dict
        ):
            cfg = constants["midiPedals"]

        self._toe_cc = self._cc_or(
            cfg.get("wahToeSwitchCC"), _DEFAULT_WAH_TOE_CC, "wahToeSwitchCC",
        )
        self._expression_cc = self._cc_or(
            cfg.get("wahExpressionCC"), _DEFAULT_WAH_EXPRESSION_CC,
            "wahExpressionCC",
        )
        self._hold_threshold_ms = self._resolve_hold_threshold(constants)

        # The wah's channel. Stored 1-16 for log/config legibility; the
        # wire comparison wants the 0-15 nibble. ``None`` == omni.
        self._channel = self._channel_or(
            cfg.get("channel"), _DEFAULT_CHANNEL,
        )
        self._channel_index = _channel_index(self._channel)

        # Owned CCs, keyed ``(channel_index or None for omni, cc)``. The
        # foot switch carries its own channel, so it and the wah need not
        # share one. A gesture with no callback (or no mapping) releases
        # its CC entirely — neither owned nor forwarded, so the message
        # falls through to the base class instead of being silently eaten.
        self._owned = {}
        self._foot_mapping: Optional[FootMapping] = None

        # Foot tap/hold state — mirrors foot-trigger.js (isPressed /
        # holdFired) plus the press sequence + timestamp the Python
        # port needs because ``schedule_message`` can't be cancelled.
        self._foot_pressed = False
        self._foot_hold_fired = False
        self._foot_press_seq = 0
        self._foot_press_time = 0.0
        # Latching mode: the side of 64 the last stomp left the switch on.
        self._foot_latch_high: Optional[bool] = None
        self._foot_heard = False

        # Wah toe edge state.
        self._toe_pressed = False

        # Learn: ``None`` when idle, else the session dict (see start_learn).
        self._learn = None
        self._learn_seq = 0

        self._foot_mapping = self._valid_mapping(foot_mapping)
        self._rebuild_owned()

        logger.info(
            "MidiPedalInput: ready (foot=%s, wah channel=%s, "
            "wahToeSwitchCC=%d, wahExpressionCC=%d, holdThresholdMs=%d, "
            "owned=%r, scheduler=%s)",
            _describe(self._foot_mapping),
            "omni" if self._channel_index is None else self._channel,
            self._toe_cc, self._expression_cc,
            self._hold_threshold_ms, sorted(self._owned, key=_key_sort),
            "yes" if schedule_delayed is not None else "no",
        )

    # --- surface-facing API -----------------------------------------------

    @property
    def foot_mapping(self) -> Optional[FootMapping]:
        return self._foot_mapping

    @property
    def learning(self) -> bool:
        return self._learn is not None

    def set_foot_mapping(self, mapping: Optional[FootMapping]) -> None:
        """Replace the foot switch (``None``: no foot switch).

        Resets the tap/hold machine, so a press in flight under the old
        mapping can't release into the new one. The caller rebuilds Live's
        MIDI map (``forwarded_pairs`` changed).
        """
        self._foot_mapping = self._valid_mapping(mapping)
        self._foot_pressed = False
        self._foot_hold_fired = False
        self._foot_press_seq += 1  # strand any pending hold check
        self._foot_latch_high = None
        self._foot_heard = False
        self._rebuild_owned()
        logger.info(
            "MidiPedalInput: foot switch → %s", _describe(self._foot_mapping),
        )

    def forwarded_pairs(self) -> Tuple[Tuple[int, int], ...]:
        """``(channel 0-15, cc)`` pairs ``build_midi_map`` must forward.

        While learning, every CC on every channel: the pedal could be any
        of them. Otherwise exactly what ``parse_owned`` accepts, so Live
        doesn't hand the script messages it would only drop.
        """
        if self._learn is not None:
            return tuple(
                (ch, cc) for ch in range(16) for cc in range(128)
            )
        pairs = set()
        for channel_index, cc in self._owned:
            channels = range(16) if channel_index is None else (channel_index,)
            for ch in channels:
                pairs.add((ch, cc))
        return tuple(sorted(pairs))

    def forwarded_ccs(self) -> Tuple[int, ...]:
        """The owned CC numbers, sorted (log / test legibility)."""
        return tuple(sorted({cc for _, cc in self._owned}))

    def forwarded_channels(self) -> Tuple[int, ...]:
        """The 0-15 channel nibbles any owned CC is forwarded on."""
        return tuple(sorted({ch for ch, _ in self.forwarded_pairs()}))

    def parse_owned(self, midi_bytes) -> Optional[Tuple[int, int, int]]:
        """Return ``(channel_index, cc, value)`` for an owned CC.

        The single-parse entry point: callers parse once, branch on the
        result, and hand it to ``dispatch`` — no re-parse on the hot
        path. While learning every CC is owned. Non-CC messages, sysex,
        short tuples, non-int garbage, and CCs no mapping claims return
        ``None`` — the caller then defers to the framework base class.
        """
        parsed = self._parse_cc(midi_bytes)
        if parsed is None:
            return None
        if self._learn is not None or self._handler_for(*parsed[:2]):
            return parsed
        return None

    def matches(self, midi_bytes) -> bool:
        """True iff ``midi_bytes`` is a CC this adapter owns."""
        return self.parse_owned(midi_bytes) is not None

    def dispatch(self, channel_index: int, cc: int, value: int) -> None:
        """Route one already-parsed owned CC (from ``parse_owned``).

        While learning the CC goes to learn and fires no gesture — pressing
        the pedal to teach it must not also start a recording. No-op when
        disconnected or when nothing owns it — safe against a stale triple
        held across a teardown or a remap.
        """
        if self._disconnected:
            return
        if self._learn is not None:
            self._learn_event(channel_index, cc, value)
            return
        handler = self._handler_for(channel_index, cc)
        if handler is None:
            return
        handler(value)

    def handle_midi_bytes(self, midi_bytes) -> bool:
        """Parse-and-dispatch in one call (convenience / test entry).

        Returns False for anything not owned or after ``disconnect``.
        """
        if self._disconnected:
            return False
        parsed = self.parse_owned(midi_bytes)
        if parsed is None:
            return False
        self.dispatch(*parsed)
        return True

    def disconnect(self) -> None:
        """Idempotent teardown; pending hold and learn checks no-op."""
        if self._disconnected:
            return
        self._disconnected = True
        self._learn = None

    # --- learn ----------------------------------------------------------------

    def start_learn(
        self,
        on_learned: Callable[[FootMapping], None],
        on_timeout: Callable[[], None],
        timeout_ms: int = _LEARN_TIMEOUT_MS,
        window_ms: int = _LEARN_RELEASE_WINDOW_MS,
    ) -> None:
        """Take the next CC on the Input as the foot switch.

        The first CC names the channel and controller. What follows names
        the mode: the opposite side of 64 on the same CC within
        ``window_ms`` is a momentary switch's release (and the first
        value's side is the press); nothing within it is a latching switch.
        No CC within ``timeout_ms`` calls ``on_timeout`` — usually the
        pedal is not this surface's Input in Live's MIDI settings.

        The caller rebuilds Live's MIDI map: learning forwards every CC.
        Restarting a learn in progress starts it over.
        """
        if self._disconnected:
            return
        self._learn_seq += 1
        seq = self._learn_seq
        self._learn = {
            "on_learned": on_learned,
            "on_timeout": on_timeout,
            "window_ms": window_ms,
            "first": None,
        }
        logger.info("MidiPedalInput: learn — waiting for the foot switch")
        self._schedule(timeout_ms, lambda: self._learn_timed_out(seq))

    def stop_learn(self) -> None:
        """Cancel a learn in progress (no callback). Idempotent."""
        if self._learn is None:
            return
        self._learn = None
        self._learn_seq += 1
        logger.info("MidiPedalInput: learn cancelled")

    def _learn_event(self, channel_index: int, cc: int, value: int) -> None:
        session = self._learn
        high = value >= _FOOT_PRESS_MIN
        first = session["first"]
        if first is None:
            session["first"] = (channel_index, cc, high)
            seq = self._learn_seq
            self._schedule(
                session["window_ms"], lambda: self._learn_window_ended(seq),
            )
            return
        if (channel_index, cc) != first[:2] or high == first[2]:
            return  # another control, or a repeat of the same level
        self._finish_learn(MOMENTARY, first)

    def _learn_window_ended(self, seq: int) -> None:
        if self._disconnected or seq != self._learn_seq or self._learn is None:
            return
        first = self._learn["first"]
        if first is not None:
            self._finish_learn(LATCHING, first)

    def _learn_timed_out(self, seq: int) -> None:
        if self._disconnected or seq != self._learn_seq or self._learn is None:
            return
        if self._learn["first"] is not None:
            return  # heard something; the release window decides
        on_timeout = self._learn["on_timeout"]
        self._learn = None
        self._learn_seq += 1
        logger.info("MidiPedalInput: learn — nothing heard")
        self._call("learn timeout", on_timeout)

    def _finish_learn(self, mode: str, first) -> None:
        channel_index, cc, first_high = first
        mapping = FootMapping(
            channel=channel_index + 1,
            cc=cc,
            mode=mode,
            press_high=first_high if mode == MOMENTARY else True,
        )
        on_learned = self._learn["on_learned"]
        self._learn = None
        self._learn_seq += 1
        logger.info("MidiPedalInput: learned %s", _describe(mapping))
        self._call("learn", lambda: on_learned(mapping))

    # --- per-CC handlers ----------------------------------------------------

    def _on_foot_cc(self, value: int) -> None:
        mapping = self._foot_mapping
        if mapping is None:
            return
        if not self._foot_heard:
            self._foot_heard = True
            self._call("foot heard", self._on_foot_heard)
        high = value >= _FOOT_PRESS_MIN
        if mapping.mode == LATCHING:
            if high == self._foot_latch_high:
                return  # level repeat, not a stomp
            self._foot_latch_high = high
            self._fire("foot tap (latching)", self._on_foot_tap)
            return
        if high == mapping.press_high:
            self._foot_press()
        else:
            self._foot_release()

    def _on_toe_cc(self, value: int) -> None:
        """Fire engage on **either** edge — the toe switch latches.

        The rig's toe switch alternates 127 / 0 with each physical press
        rather than sending press-then-release, so edging on the rising
        side alone made every second press do nothing. Both directions
        now fire the same gesture; the ``_toe_pressed`` flag stays only
        to collapse a repeated same-direction level into one edge (a
        pedal that streams its state would otherwise engage per message).
        """
        pressed = value >= _TOE_PRESS_MIN
        if pressed == self._toe_pressed:
            return  # level repeat, not a new edge
        self._toe_pressed = pressed
        self._fire(
            "wah engage (toe %s)" % ("high" if pressed else "low"),
            self._on_wah_engage,
        )

    def _on_expression_cc(self, value: int) -> None:
        cb = self._on_wah_freq
        if cb is None:
            return
        try:
            cb(value)
        except Exception as e:  # defensive — see module docstring
            logger.warning(
                "MidiPedalInput: wah freq callback raised: %s: %s",
                type(e).__name__, e,
            )

    # --- foot tap/hold state machine ----------------------------------------

    def _foot_press(self) -> None:
        if self._foot_pressed:
            return  # debounce duplicate press (foot-trigger.js guard)
        self._foot_pressed = True
        self._foot_hold_fired = False
        self._foot_press_seq += 1
        self._foot_press_time = self._monotonic()
        seq = self._foot_press_seq
        self._schedule(
            self._hold_threshold_ms, lambda: self._foot_hold_check(seq),
        )

    def _foot_release(self) -> None:
        if not self._foot_pressed:
            return  # unmatched release; ignore
        self._foot_pressed = False

        if self._foot_hold_fired:
            # Hold already fired during the press window. Suppress tap.
            self._foot_hold_fired = False
            return

        elapsed_ms = (self._monotonic() - self._foot_press_time) * 1000.0
        if elapsed_ms >= self._hold_threshold_ms:
            # The scheduled check hasn't fired yet (tick granularity)
            # but the press outlived the threshold — this is a hold.
            self._foot_hold_fired = False
            self._fire("foot hold (release-time clock)", self._on_foot_hold)
            return

        self._fire("foot tap", self._on_foot_tap)

    def _foot_hold_check(self, seq: int) -> None:
        """Scheduled at the hold threshold; fires hold if still pressed.

        The seq guard drops checks stranded by a release + re-press
        inside one threshold window — without it, press #1's check
        would fire a phantom hold into press #2.
        """
        if self._disconnected:
            return
        if seq != self._foot_press_seq or not self._foot_pressed:
            return
        if self._foot_hold_fired:
            return
        self._foot_hold_fired = True
        self._fire("foot hold", self._on_foot_hold)

    # --- internal helpers ---------------------------------------------------

    def _rebuild_owned(self) -> None:
        """Recompute ``_owned``: foot first, then toe, then expression."""
        self._owned = {}
        mapping = self._foot_mapping
        if mapping is not None and (
            self._on_foot_tap is not None or self._on_foot_hold is not None
        ):
            self._add_owned(
                (_channel_index(mapping.channel), mapping.cc),
                self._on_foot_cc, "foot switch",
            )
        if self._on_wah_engage is not None:
            self._add_owned(
                (self._channel_index, self._toe_cc),
                self._on_toe_cc, "wahToeSwitchCC",
            )
        if self._on_wah_freq is not None:
            self._add_owned(
                (self._channel_index, self._expression_cc),
                self._on_expression_cc, "wahExpressionCC",
            )

    def _add_owned(self, key, handler, label: str) -> None:
        if self._overlaps(key):
            # First registration wins (foot → toe → expression order);
            # a collision is a mapping mistake worth a loud line.
            logger.warning(
                "MidiPedalInput: %s (channel %s, CC %d) collides with an "
                "already-mapped CC; ignoring the later mapping",
                label, "omni" if key[0] is None else key[0] + 1, key[1],
            )
            return
        self._owned[key] = handler

    def _overlaps(self, key) -> bool:
        channel_index, cc = key
        for owned_channel, owned_cc in self._owned:
            if owned_cc != cc:
                continue
            if (
                owned_channel is None
                or channel_index is None
                or owned_channel == channel_index
            ):
                return True
        return False

    def _handler_for(self, channel_index: int, cc: int):
        return self._owned.get((channel_index, cc)) or self._owned.get(
            (None, cc)
        )

    def _schedule(self, delay_ms: int, fn: Callable[[], None]) -> None:
        if self._schedule_delayed is None:
            return
        try:
            self._schedule_delayed(delay_ms, fn)
        except Exception as e:
            # Scheduling failed — hold degrades to the release-time
            # clock check rather than dying.
            logger.warning(
                "MidiPedalInput: schedule raised: %s: %s",
                type(e).__name__, e,
            )

    def _fire(self, reason: str, cb: Optional[Callable[[], None]]) -> None:
        if cb is None:
            logger.info("MidiPedalInput: %s — no callback wired", reason)
            return
        if self._call(reason, cb):
            logger.info("MidiPedalInput: %s", reason)

    def _call(self, reason: str, cb: Optional[Callable[[], None]]) -> bool:
        if cb is None:
            return False
        try:
            cb()
        except Exception as e:  # defensive — see module docstring
            logger.warning(
                "MidiPedalInput: %s callback raised: %s: %s",
                reason, type(e).__name__, e,
            )
            return False
        return True

    @staticmethod
    def _valid_mapping(mapping) -> Optional[FootMapping]:
        if mapping is None:
            return None
        valid = foot_mapping_from_dict(
            mapping.to_dict() if isinstance(mapping, FootMapping) else None
        )
        if valid is None:
            logger.warning(
                "MidiPedalInput: foot mapping %r invalid; no foot switch",
                mapping,
            )
        return valid

    def _parse_cc(self, midi_bytes) -> Optional[Tuple[int, int, int]]:
        """Return ``(channel_index, cc, value)`` for a 3-byte CC, else None."""
        if not isinstance(midi_bytes, Sequence) or len(midi_bytes) != 3:
            return None
        status, data1, data2 = midi_bytes[0], midi_bytes[1], midi_bytes[2]
        if not (
            isinstance(status, int)
            and isinstance(data1, int)
            and isinstance(data2, int)
        ):
            return None
        if status & 0xF0 != _CC_STATUS:
            return None
        return (status & 0x0F, data1, data2)

    @staticmethod
    def _channel_or(value, fallback: int) -> int:
        """Validate ``midiPedals.channel`` (0=omni, 1-16), else fall back."""
        if _is_int(value) and 0 <= value <= 16:
            return value
        if value is not None:
            logger.warning(
                "MidiPedalInput: midiPedals.channel=%r invalid (want int "
                "1-16, or 0 for omni); using %d",
                value, fallback,
            )
        return fallback

    @staticmethod
    def _cc_or(value, fallback: int, label: str) -> int:
        if _is_int(value) and 0 <= value <= 127:
            return value
        if value is not None:
            logger.warning(
                "MidiPedalInput: midiPedals.%s=%r invalid (want int "
                "0-127); using %d",
                label, value, fallback,
            )
        return fallback

    @staticmethod
    def _resolve_hold_threshold(constants: dict) -> int:
        """Read ``osc.footTrigger.holdThresholdMs`` (ADR-326's home for
        the value foot-trigger.js could only hardcode), with fallback."""
        osc = constants.get("osc") if isinstance(constants, dict) else None
        foot = osc.get("footTrigger") if isinstance(osc, dict) else None
        if isinstance(foot, dict):
            ms = foot.get("holdThresholdMs")
            if _is_int(ms) and ms > 0:
                return ms
        logger.info(
            "MidiPedalInput: osc.footTrigger.holdThresholdMs missing; "
            "using %dms",
            _DEFAULT_HOLD_THRESHOLD_MS,
        )
        return _DEFAULT_HOLD_THRESHOLD_MS


def _channel_index(channel: int) -> Optional[int]:
    """1-16 → the 0-15 wire nibble; 0 (omni) → ``None``."""
    return None if channel == _OMNI_CHANNEL else channel - 1


def _key_sort(key) -> Tuple[int, int]:
    channel_index, cc = key
    return (-1 if channel_index is None else channel_index, cc)


def _describe(mapping: Optional[FootMapping]) -> str:
    if mapping is None:
        return "none"
    channel = "omni" if mapping.channel == _OMNI_CHANNEL else mapping.channel
    polarity = "" if mapping.press_high else ", press low"
    return "channel %s CC %d %s%s" % (
        channel, mapping.cc, mapping.mode, polarity,
    )
