"""SessionSettingsComponent — runtime on/off toggles for session-scoped
surface behaviors that aren't LOM-backed.

Distinct from :mod:`SessionComponent`, which owns LOM-listener-driven
song attributes (tempo, metronome, loop, etc.). The toggles here are
**surface-side settings** — pure in-memory bools that gate optional
behaviors. No LOM listener, no write-back to Live. They follow the
same wire shape as PR-5d's bool01 attrs (``[0|1]``) + the same
init-emit + on-accept-emit contract so a cold-starting UI sees the
current state without asking.

Shipped 2026-04-22. Two toggles at launch:

- ``auto_arm`` — controls whether ExclusiveArmComponent (on selection)
  and FootTriggerComponent (on foot-hold track create) auto-arm the
  affected track. Default ``True`` (matches pre-toggle behavior).
- ``move_volume_knob`` — controls whether SelectedTrackComponent's
  ``handle_relative_volume`` accepts the Ableton Move first-knob's
  ``/looping/v3/selected_track/volume_relative`` nudges. Default
  ``True``.
- ``key_follow`` (2026-09-19, ADR-447) — whether ``KeyDetectComponent``
  re-detects the key and sets it whenever what is playing changes.
  **On at every surface start and not persisted**: a Live restart or a set
  load re-creates the surface, and it begins with Follow on; a lock — the
  picker's Following / Locked button, the Behavior card, a hand picking a
  key in the app or in Live — lasts until then. (It was persisted for an
  afternoon; a lock read from a key change inside Live then outlived two
  restarts on the rig, and the operator asked for Follow on by default.)

Wire
----

Inbound from UI: ``/looping/v3/session/<setting> [0|1]``. Non-0/1 ints,
floats, strings are rejected — same validate-and-reject discipline as
PR-5d. Bools coerce to int.

Outbound from surface: identical address + arg on every change, plus
once at ``__init__`` (init-emit) and once on handshake accept
(on-accept-emit). Other components pull the current value via a
getter callable (e.g. ``should_auto_arm()``) so they never hold a
stale snapshot.

No LOM touch
------------

These settings don't roundtrip through Live. A toggle write is
literally ``self._auto_arm = bool(val)`` + an ``emit``. That means no
LOM-touch guard, no echo suppression debate (no echo exists), no
structural rebind concern.

Default-on
----------

Both settings default to ``True`` because that's the behavior before
this component existed. Anyone flipping to ``False`` is opting *out*
of the default, so the "absent wire = legacy behavior" principle is
preserved.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Callable, Optional, Tuple

logger = logging.getLogger("looping")


# --- persistence ----------------------------------------------------------
#
# The toggles are in-memory, and Live tears down + reconstructs the whole
# Control Surface on every set load — so without persistence a fresh
# SessionSettingsComponent resets to defaults each time (the user's override
# is lost). We persist to <repo>/logs/session-settings.json (same logs/ dir
# the bridge's save-as counter uses) and reload on init.


def _find_repo_logs_path(filename: str = "session-settings.json"):
    """Resolve ``<repo>/logs/<filename>`` via the realpath-walk-up pattern.

    Mirrors ``config_loader._find_constants_path`` — ``realpath`` resolves the
    Remote Scripts symlink back to the real repo, then we walk up to find the
    dir that holds ``config/`` (the repo root) and target its ``logs/`` sibling.
    Returns the absolute path, or ``None`` if the repo root can't be located
    (in which case persistence silently no-ops — settings still work in-memory).
    """
    here = os.path.dirname(os.path.realpath(__file__))
    current = here
    for _ in range(6):
        if os.path.isdir(os.path.join(current, "config")):
            return os.path.join(current, "logs", filename)
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


# --- wire addresses -------------------------------------------------------

V3_SESSION_AUTO_ARM_ADDRESS = "/looping/v3/session/auto_arm"
V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS = "/looping/v3/session/move_volume_knob"
V3_SESSION_AUTO_CAPTURE_ADDRESS = "/looping/v3/session/auto_capture"
V3_SESSION_AUTO_ARM_QUERY_ADDRESS = "/looping/v3/session/auto_arm/query"
V3_SESSION_MOVE_VOLUME_KNOB_QUERY_ADDRESS = (
    "/looping/v3/session/move_volume_knob/query"
)
V3_SESSION_AUTO_CAPTURE_QUERY_ADDRESS = (
    "/looping/v3/session/auto_capture/query"
)
# ADR-447 (2026-09-19): Follow mode. While on, the surface re-detects the
# key whenever a loop is created (a slot launches a MIDI clip, a recording
# ends) and sets it; a key chosen by any other hand — the picker, Live's
# own chooser, Push — turns it off. ON at every surface start; not persisted.
V3_SESSION_KEY_FOLLOW_ADDRESS = "/looping/v3/session/key_follow"
V3_SESSION_KEY_FOLLOW_QUERY_ADDRESS = "/looping/v3/session/key_follow/query"


class SessionSettingsComponent:
    """Owns in-memory session-scoped on/off toggles.

    Args:
        emit: ``(address, args) -> None`` OSC sender. Production binds
            to ``OSCTransport.send``; tests pass a list append.

    Lifecycle:
        ``__init__`` seeds defaults + init-emits both. ``disconnect``
        flips a sentinel so post-teardown toggles become no-ops.
        Idempotent.
    """

    V3_SESSION_AUTO_ARM_ADDRESS = V3_SESSION_AUTO_ARM_ADDRESS
    V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS = V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS
    V3_SESSION_AUTO_CAPTURE_ADDRESS = V3_SESSION_AUTO_CAPTURE_ADDRESS
    V3_SESSION_AUTO_ARM_QUERY_ADDRESS = V3_SESSION_AUTO_ARM_QUERY_ADDRESS
    V3_SESSION_MOVE_VOLUME_KNOB_QUERY_ADDRESS = (
        V3_SESSION_MOVE_VOLUME_KNOB_QUERY_ADDRESS
    )
    V3_SESSION_AUTO_CAPTURE_QUERY_ADDRESS = (
        V3_SESSION_AUTO_CAPTURE_QUERY_ADDRESS
    )
    V3_SESSION_KEY_FOLLOW_ADDRESS = V3_SESSION_KEY_FOLLOW_ADDRESS
    V3_SESSION_KEY_FOLLOW_QUERY_ADDRESS = V3_SESSION_KEY_FOLLOW_QUERY_ADDRESS

    def __init__(
        self,
        emit: Callable[[str, Tuple], None],
        auto_capture_default: bool = False,
        settings_path: Optional[str] = None,
    ):
        """
        Args:
            emit: OSC sender ``(address, args) -> None``.
            auto_capture_default: Cold-start seed for the ``auto_capture``
                toggle, used *before* the launch mode is known. The mode
                only arrives with the first heartbeat (~2s after the bridge
                starts), so at construction we can't yet tell ipad from dev
                — we start ``False`` (dev-safe: no surprise auto-record) and
                :meth:`seed_auto_capture_default` upgrades it to the
                mode-derived default when that first heartbeat lands, unless
                the user has already overridden it. Once seeded/overridden,
                ``auto_capture`` is the sole gate (see
                ``compose_capture_gate``): a dev session can force it on and
                an ipad set can force it off.
            settings_path: Override for the persistence file (tests). Defaults
                to ``<repo>/logs/session-settings.json``. ``None`` + an
                unresolvable repo root → persistence no-ops (in-memory only).

        Persistence: ``auto_arm`` / ``move_volume_knob`` are loaded from the
        persisted file (so a user override survives a set load / Live restart,
        which reconstruct the whole surface). ``auto_capture`` is **not** loaded
        from disk — it re-seeds from the launch mode every init
        (``seed_auto_capture_default``), by design: switching dev↔ipad should
        reset it to the mode default rather than silently reusing a stale
        cross-mode value. Its within-session override still holds until the next
        surface teardown.
        """
        self._emit = emit
        self._disconnected = False
        self._settings_path = (
            settings_path if settings_path is not None else _find_repo_logs_path()
        )

        # Defaults match legacy (pre-toggle) behavior — current users
        # should notice no change until they flip one. Overridden below by any
        # persisted values.
        self._auto_arm = True
        self._move_volume_knob = True
        # Cold-start default (dev-safe False); upgraded to the mode-derived
        # default by seed_auto_capture_default() on the first heartbeat.
        # Deliberately NOT persisted (see docstring).
        self._auto_capture = bool(auto_capture_default)
        # True once the user (or a mode seed) has committed a value, so a
        # later mode seed won't clobber a deliberate override.
        self._auto_capture_user_set = False
        # ADR-447: the key follows the loops until a hand sets it. ON at every
        # surface start (Live restart, set load) and deliberately not
        # persisted: a lock lasts until the surface is re-created.
        self._key_follow = True

        self._load_persisted()

        self._emit_auto_arm()
        self._emit_move_volume_knob()
        self._emit_auto_capture()
        self._emit_key_follow()

        logger.info(
            "SessionSettingsComponent init: auto_arm=%s move_volume_knob=%s "
            "auto_capture=%s (persist=%s)",
            self._auto_arm, self._move_volume_knob, self._auto_capture,
            self._settings_path or "off",
        )

    # --- persistence -----------------------------------------------------

    def _load_persisted(self) -> None:
        """Load persisted ``auto_arm`` / ``move_volume_knob`` if present.

        Missing / unreadable / corrupt file → keep the defaults set above.
        Only booleans are honored; anything else is ignored per-key.
        ``auto_capture`` is intentionally not read (mode-seeded each init).
        """
        if not self._settings_path:
            return
        try:
            with open(self._settings_path, "r") as f:
                data = json.load(f)
        except FileNotFoundError:
            return
        except (OSError, ValueError) as e:
            logger.warning(
                "SessionSettings: persisted settings unreadable (%r); "
                "using defaults", e,
            )
            return
        if not isinstance(data, dict):
            return
        if isinstance(data.get("auto_arm"), bool):
            self._auto_arm = data["auto_arm"]
        if isinstance(data.get("move_volume_knob"), bool):
            self._move_volume_knob = data["move_volume_knob"]

    def _persist(self) -> None:
        """Write the persisted toggles to disk. Best-effort — a failed write
        just means the next surface init falls back to defaults."""
        if not self._settings_path:
            return
        try:
            os.makedirs(os.path.dirname(self._settings_path), exist_ok=True)
            with open(self._settings_path, "w") as f:
                json.dump(
                    {
                        "auto_arm": self._auto_arm,
                        "move_volume_knob": self._move_volume_knob,
                    },
                    f,
                )
        except OSError as e:
            logger.warning("SessionSettings: persist write failed (%r)", e)

    # --- getters (pass as callables to other components) -----------------

    def should_auto_arm(self) -> bool:
        return self._auto_arm

    def should_handle_move_volume_knob(self) -> bool:
        return self._move_volume_knob

    def should_auto_capture(self) -> bool:
        return self._auto_capture

    def should_follow_key(self) -> bool:
        """ADR-447: whether the key follows the loops (``key_follow``)."""
        return self._key_follow

    # --- mode-derived seed -----------------------------------------------

    def seed_auto_capture_default(self, default: bool) -> None:
        """Apply the launch-mode-derived ``auto_capture`` default.

        Called by ``ServerPresenceComponent`` when the first heartbeat
        reveals the launch mode (``default = is_ipad``). No-op once the user
        has committed a value via ``handle_set_auto_capture`` — a deliberate
        override must survive a (late) mode seed. Emits on change so a UI
        that connected before the seed sees the corrected value.

        Idempotent: seeding the same value the toggle already holds still
        marks it committed (so a second, contradictory seed can't flip it)
        but only emits when the value actually changed.
        """
        if self._disconnected:
            return
        if self._auto_capture_user_set:
            return
        self._auto_capture_user_set = True
        new_val = bool(default)
        if new_val == self._auto_capture:
            return
        self._auto_capture = new_val
        self._emit_auto_capture()
        logger.info(
            "SessionSettingsComponent: auto_capture seeded from mode → %s",
            "ENABLED" if new_val else "DISABLED",
        )

    # --- handlers --------------------------------------------------------

    def handle_set_auto_arm(self, args, source_addr):
        """``/looping/v3/session/auto_arm [0|1]``."""
        # Freeze state after disconnect — match the query handlers, which return
        # None immediately. Without this the in-memory value would still change
        # (only the emit is silenced), an inconsistent post-teardown contract.
        if self._disconnected:
            return None
        val = _parse_bool01(args, "auto_arm")
        if val is None:
            return None
        if val == self._auto_arm:
            # Still echo — matches PR-5d listener behavior (a write
            # whose new value equals the old one still fires).
            self._emit_auto_arm()
            return None
        self._auto_arm = val
        self._persist()
        self._emit_auto_arm()
        logger.info(
            "SessionSettingsComponent: auto_arm %s",
            "ENABLED" if val else "DISABLED",
        )
        return None

    def handle_query_auto_arm(self, args, source_addr):
        """``/looping/v3/session/auto_arm/query`` — read-only state read.

        Returns the current ``auto_arm`` value as a 1-tuple ``(0|1,)``.
        A non-None tuple return makes ``OSCTransport._dispatch`` send it
        back to ``source_addr`` (the asker's ephemeral port) on the same
        address — the reply-to-sender path the broadcast ``_emit`` does
        not use. This lets a fire-and-forget client (an Ableton
        Extension, a probe) learn the current toggle without writing it
        and without binding the surface's fixed broadcast remote (11021).

        Read-only: no state mutation, no broadcast ``_emit``, so it can't
        flip the value or disturb the UI's broadcast stream. Args are
        ignored (presence-only request). Disconnected → ``None`` (no
        reply).
        """
        if self._disconnected:
            return None
        return (1 if self._auto_arm else 0,)

    def handle_set_move_volume_knob(self, args, source_addr):
        """``/looping/v3/session/move_volume_knob [0|1]``."""
        # Freeze state after disconnect (see handle_set_auto_arm).
        if self._disconnected:
            return None
        val = _parse_bool01(args, "move_volume_knob")
        if val is None:
            return None
        if val == self._move_volume_knob:
            self._emit_move_volume_knob()
            return None
        self._move_volume_knob = val
        self._persist()
        self._emit_move_volume_knob()
        logger.info(
            "SessionSettingsComponent: move_volume_knob %s",
            "ENABLED" if val else "DISABLED",
        )
        return None

    def handle_query_move_volume_knob(self, args, source_addr):
        """``/looping/v3/session/move_volume_knob/query`` — read-only state read.

        Mirror of :meth:`handle_query_auto_arm`. Returns the current
        ``move_volume_knob`` value as a 1-tuple ``(0|1,)``; the transport's
        reply-to-sender path echoes it on this same address back to the asker's
        ephemeral port. Read-only — no mutation, no broadcast. Args ignored.
        Disconnected → ``None`` (no reply).
        """
        if self._disconnected:
            return None
        return (1 if self._move_volume_knob else 0,)

    def handle_set_auto_capture(self, args, source_addr):
        """``/looping/v3/session/auto_capture [0|1]``.

        Overrides the launch-mode default. Unlike ``auto_arm``, this is the
        *sole* gate for the performance-capture behaviors — writing 1 here
        forces auto-record-on-play even under ``npm run dev``, writing 0
        silences it even under ``npm run ipad`` (see ``compose_capture_gate``).
        """
        # Freeze state after disconnect (see handle_set_auto_arm).
        if self._disconnected:
            return None
        val = _parse_bool01(args, "auto_capture")
        if val is None:
            return None
        # A user write always commits — a subsequent mode seed must not
        # clobber it (see seed_auto_capture_default).
        self._auto_capture_user_set = True
        if val == self._auto_capture:
            self._emit_auto_capture()
            return None
        self._auto_capture = val
        self._emit_auto_capture()
        logger.info(
            "SessionSettingsComponent: auto_capture %s",
            "ENABLED" if val else "DISABLED",
        )
        return None

    def handle_query_auto_capture(self, args, source_addr):
        """``/looping/v3/session/auto_capture/query`` — read-only state read.

        Mirror of :meth:`handle_query_auto_arm`. Returns the current
        ``auto_capture`` value as a 1-tuple ``(0|1,)``; the transport's
        reply-to-sender path echoes it on this same address back to the
        asker's ephemeral port. Read-only — no mutation, no broadcast. Args
        ignored. Disconnected → ``None`` (no reply).
        """
        if self._disconnected:
            return None
        return (1 if self._auto_capture else 0,)

    def handle_set_key_follow(self, args, source_addr):
        """``/looping/v3/session/key_follow [0|1]`` (ADR-447). Not persisted:
        every surface start begins with Follow on. ``KeyDetectComponent``
        reads the getter before every follow pass and turns this off itself
        when a hand sets the key."""
        if self._disconnected:
            return None
        val = _parse_bool01(args, "key_follow")
        if val is None:
            return None
        if val == self._key_follow:
            self._emit_key_follow()
            return None
        self._key_follow = val
        self._emit_key_follow()
        logger.info(
            "SessionSettingsComponent: key_follow %s",
            "ENABLED" if val else "DISABLED",
        )
        return None

    def handle_query_key_follow(self, args, source_addr):
        """``/looping/v3/session/key_follow/query`` — read-only, replies
        ``(0|1,)`` to the asker on this same address."""
        if self._disconnected:
            return None
        return (1 if self._key_follow else 0,)

    # --- handshake -------------------------------------------------------

    def emit_on_accept(self) -> None:
        """Re-emit every toggle after handshake accept.

        State/full is track-scoped; without this re-emit a UI
        connecting after surface init would miss the init-emit burst
        and sit on its local defaults.
        """
        if self._disconnected:
            return
        self._emit_auto_arm()
        self._emit_move_volume_knob()
        self._emit_auto_capture()
        self._emit_key_follow()

    # --- emit helpers ----------------------------------------------------

    def _emit_auto_arm(self) -> None:
        if self._disconnected:
            return
        self._emit(
            V3_SESSION_AUTO_ARM_ADDRESS,
            (1 if self._auto_arm else 0,),
        )

    def _emit_move_volume_knob(self) -> None:
        if self._disconnected:
            return
        self._emit(
            V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
            (1 if self._move_volume_knob else 0,),
        )

    def _emit_auto_capture(self) -> None:
        if self._disconnected:
            return
        self._emit(
            V3_SESSION_AUTO_CAPTURE_ADDRESS,
            (1 if self._auto_capture else 0,),
        )

    def _emit_key_follow(self) -> None:
        if self._disconnected:
            return
        self._emit(
            V3_SESSION_KEY_FOLLOW_ADDRESS,
            (1 if self._key_follow else 0,),
        )

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        self._disconnected = True

    # --- test hooks ------------------------------------------------------

    @property
    def auto_arm(self) -> bool:
        return self._auto_arm

    @property
    def move_volume_knob(self) -> bool:
        return self._move_volume_knob

    @property
    def auto_capture(self) -> bool:
        return self._auto_capture


# --- helpers --------------------------------------------------------------


def _parse_bool01(args, name: str):
    """Parse ``args[0]`` as 0/1 (or bool). Returns bool or None on reject.

    Floats are rejected even when their truncation would land in {0,1}
    (``0.5`` → ``int(0.5)`` = 0 would silently disable the toggle —
    almost certainly a UI bug, not an intended write). Strings and
    ``None`` reject. ``bool`` itself is accepted (OSC occasionally
    carries bool args intact).
    """
    if not args:
        logger.warning(
            "SessionSettingsComponent set %s: empty args, ignoring", name,
        )
        return None
    raw = args[0]
    if isinstance(raw, bool):
        return raw
    if not isinstance(raw, int):
        # Reject float / str / None / everything else. ``int`` covers
        # OSC's native ``i`` type; bool subclasses int and is handled
        # above.
        logger.warning(
            "SessionSettingsComponent set %s: non-int arg %r; rejecting",
            name, raw,
        )
        return None
    if raw not in (0, 1):
        logger.warning(
            "SessionSettingsComponent set %s: %r not in {0,1}; rejecting",
            name, raw,
        )
        return None
    return bool(raw)
