"""FootSwitchComponent — the foot switch as a user setting, with Learn.

Before 2026-09-26 the foot switch was config: ``midiPedals.footSwitchCC``
and ``channel`` in ``constants.json``, read once when the surface loads,
with CC 23 on channel 10 standing in for a missing key. A stranger had to
edit JSON and know their pedal's numbers, and one who picked a keyboard
as the Looping surface's Input got looper taps from it
(general-release audit §2's foot-switch row).

Now it is a setting in the System view, like ``auto_arm``:

- **On / Off.** Off, the surface claims no foot CC at all.
- **Learn.** The surface forwards every CC on its Input for up to 10 s
  and takes the next one as the foot switch — channel, controller, and
  whether it is momentary (press then release: tap and hold) or latching
  (one value per stomp: tap only). ``MidiPedalInput`` does the listening.
  Nothing heard is reported as ``timeout``, which the UI turns into the
  one step it cannot do for you: setting the pedal as Looping's Input in
  Live's MIDI settings.
- **Heard.** Whether the mapped CC has arrived since the surface was
  built, so "on" and "working" can be told apart.

The setting is persisted to ``<repo>/logs/foot-switch.json`` (its own file:
``SessionSettingsComponent`` rewrites ``session-settings.json`` whole). With
nothing saved it is seeded from ``midiPedals.footSwitchCC`` when the config
has one, which keeps the rig's pedal working untouched; with neither there
is no foot switch.

Wire
----

Surf→UI ``/looping/v3/session/foot_switch``
    ``[enabled:int, channel:int, cc:int, mode:str, learn:str, heard:int]``
    — ``cc`` -1 with nothing learned, ``channel`` 0 for omni, ``learn``
    one of ``idle`` / ``listening`` / ``timeout``. On init, on handshake
    accept, and on every change.
UI→Surf ``/looping/v3/session/foot_switch/enabled [0|1]``
    On with nothing learned starts a learn instead.
UI→Surf ``/looping/v3/session/foot_switch/learn [0|1]``
    1 starts (or restarts) a learn, 0 cancels one.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Callable, Optional, Tuple

from .midi_pedal_input import (
    FootMapping,
    MidiPedalInput,
    foot_mapping_from_constants,
    foot_mapping_from_dict,
)
from .SessionSettingsComponent import _find_repo_logs_path, _parse_bool01

logger = logging.getLogger("looping")

V3_FOOT_SWITCH_ADDRESS = "/looping/v3/session/foot_switch"
V3_FOOT_SWITCH_ENABLED_ADDRESS = "/looping/v3/session/foot_switch/enabled"
V3_FOOT_SWITCH_LEARN_ADDRESS = "/looping/v3/session/foot_switch/learn"

LEARN_IDLE = "idle"
LEARN_LISTENING = "listening"
LEARN_TIMEOUT = "timeout"


class FootSwitchComponent:
    """Owns the foot switch setting and drives ``MidiPedalInput`` from it.

    Args:
        emit: ``(address, args) -> None`` OSC sender.
        constants: the loaded constants (the seed, when nothing is saved).
        router: the surface's ``MidiPedalInput``.
        request_midi_rebuild: asks Live to call ``build_midi_map`` again —
            every mapping change and every learn start/stop changes which
            CCs the surface must claim.
        settings_path: persistence file override (tests). ``None`` →
            ``<repo>/logs/foot-switch.json``; an unresolvable repo root
            keeps the setting in memory only.
    """

    def __init__(
        self,
        emit: Callable[[str, Tuple], None],
        constants: dict,
        router: MidiPedalInput,
        request_midi_rebuild: Callable[[], None],
        settings_path: Optional[str] = None,
    ):
        self._emit = emit
        self._router = router
        self._request_midi_rebuild = request_midi_rebuild
        self._disconnected = False
        self._settings_path = (
            settings_path if settings_path is not None
            else _find_repo_logs_path("foot-switch.json")
        )
        self._learn_state = LEARN_IDLE
        self._heard = False

        self._mapping: Optional[FootMapping] = foot_mapping_from_constants(
            constants,
        )
        self._enabled = self._mapping is not None
        self._load_persisted()

        self._apply()
        self._emit_state()
        logger.info(
            "FootSwitchComponent init: enabled=%s mapping=%s (persist=%s)",
            self._enabled, self._mapping, self._settings_path or "off",
        )

    # --- persistence -----------------------------------------------------

    def _load_persisted(self) -> None:
        """A saved setting replaces the seed whole — including a saved
        "nothing learned", so clearing it is not undone by the config."""
        if not self._settings_path:
            return
        try:
            with open(self._settings_path, "r") as f:
                data = json.load(f)
        except FileNotFoundError:
            return
        except (OSError, ValueError) as e:
            logger.warning(
                "FootSwitch: saved setting unreadable (%r); using the seed", e,
            )
            return
        if not isinstance(data, dict) or not isinstance(
            data.get("enabled"), bool
        ):
            logger.warning("FootSwitch: saved setting malformed; using the seed")
            return
        self._mapping = foot_mapping_from_dict(data.get("mapping"))
        self._enabled = data["enabled"] and self._mapping is not None

    def _persist(self) -> None:
        if not self._settings_path:
            return
        try:
            os.makedirs(os.path.dirname(self._settings_path), exist_ok=True)
            with open(self._settings_path, "w") as f:
                json.dump(
                    {
                        "enabled": self._enabled,
                        "mapping": (
                            self._mapping.to_dict() if self._mapping else None
                        ),
                    },
                    f,
                )
        except OSError as e:
            logger.warning("FootSwitch: persist write failed (%r)", e)

    # --- handlers --------------------------------------------------------

    def handle_set_enabled(self, args, source_addr):
        """``/looping/v3/session/foot_switch/enabled [0|1]``."""
        if self._disconnected:
            return None
        val = _parse_bool01(args, "foot_switch/enabled")
        if val is None:
            return None
        if val and self._mapping is None:
            # Nothing to turn on yet: listen for the pedal instead.
            self._start_learn()
            return None
        if val != self._enabled:
            self._enabled = val
            self._persist()
            self._apply()
            logger.info(
                "FootSwitchComponent: %s", "ENABLED" if val else "DISABLED",
            )
        self._emit_state()
        return None

    def handle_learn(self, args, source_addr):
        """``/looping/v3/session/foot_switch/learn [0|1]``."""
        if self._disconnected:
            return None
        val = _parse_bool01(args, "foot_switch/learn")
        if val is None:
            return None
        if val:
            self._start_learn()
            return None
        if self._router.learning:
            self._router.stop_learn()
            self._request_midi_rebuild()
        self._learn_state = LEARN_IDLE
        self._emit_state()
        return None

    # --- learn -----------------------------------------------------------

    def _start_learn(self) -> None:
        self._learn_state = LEARN_LISTENING
        self._router.start_learn(self._on_learned, self._on_learn_timeout)
        self._request_midi_rebuild()
        self._emit_state()

    def _on_learned(self, mapping: FootMapping) -> None:
        if self._disconnected:
            return
        self._mapping = mapping
        self._enabled = True
        self._learn_state = LEARN_IDLE
        self._persist()
        self._apply()
        self._emit_state()

    def _on_learn_timeout(self) -> None:
        if self._disconnected:
            return
        self._learn_state = LEARN_TIMEOUT
        self._request_midi_rebuild()
        self._emit_state()

    def on_foot_heard(self) -> None:
        """``MidiPedalInput``'s first-CC callback for the current mapping."""
        if self._disconnected or self._heard:
            return
        self._heard = True
        self._emit_state()

    # --- plumbing --------------------------------------------------------

    def _apply(self) -> None:
        """Hand the router what the setting says, and re-claim the CCs."""
        self._heard = False
        self._router.set_foot_mapping(self._mapping if self._enabled else None)
        self._request_midi_rebuild()

    def state_args(self) -> Tuple:
        mapping = self._mapping
        return (
            1 if self._enabled else 0,
            mapping.channel if mapping else 0,
            mapping.cc if mapping else -1,
            mapping.mode if mapping else "",
            self._learn_state,
            1 if self._heard else 0,
        )

    def _emit_state(self) -> None:
        if self._disconnected:
            return
        self._emit(V3_FOOT_SWITCH_ADDRESS, self.state_args())

    def emit_on_accept(self) -> None:
        self._emit_state()

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        self._router.stop_learn()
