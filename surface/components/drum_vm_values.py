"""The virtual macros' value space (ADR-428): how a held value, a macro's
travel and a member's LOM value convert into one another.

Split out of ``DrumVirtualMacroComponent`` (code review, 2026-11-25), whose
``_member_read`` / ``_coerce`` / ``_to_t`` … stay as aliases of these. No
state: every function reads only the parameter it is handed.

A **semitone macro** (a pad rack's transpose macro standing in for a
Transpose, ``_Member.semitone_macro``) reads and writes in semitones,
−48..48 across the macro's own range — the project convention, confirmed
by the kit file's ``MidiControllerRange``. :func:`semitones_from_t` and
:func:`t_from_semitones` are that one mapping, used by the member reads
and writes and by the legacy macro's travel alike.
"""

from __future__ import annotations

from typing import Optional, Tuple

from .drum_vm_functions import (
    _LOM_ERRORS,
    FX_TYPE_MAX,
    KIND_ENUM,
    KIND_SEMITONES,
    KIND_T,
    PITCH_MAX,
    PITCH_MIN,
    TOGGLE_ON_ABOVE_T,
    VirtualMacro,
    _clamp,
    _float_or_none,
)
from .drum_vm_state import _Member

_PITCH_SPAN = PITCH_MAX - PITCH_MIN


def semitones_from_t(t: float) -> float:
    """Travel ``0..1`` → semitones, unclamped and unrounded."""
    return PITCH_MIN + t * _PITCH_SPAN


def t_from_semitones(semitones) -> float:
    """Semitones → travel, clamped to ``0..1``."""
    return _clamp((float(semitones) - PITCH_MIN) / float(_PITCH_SPAN), 0.0, 1.0)


# --- one parameter -----------------------------------------------------------


def read_value(param):
    """``param.value``, or ``None`` when the read raises."""
    try:
        return param.value
    except _LOM_ERRORS:
        return None


def normalized(param) -> Optional[float]:
    """``param``'s value as ``0..1`` of its own range (a missing range reads
    as ``0..127``); ``None`` when the value cannot be read."""
    v = _float_or_none(read_value(param))
    if v is None:
        return None
    try:
        lo = float(param.min)
        hi = float(param.max)
    except _LOM_ERRORS + (ValueError,):
        lo, hi = 0.0, 127.0
    span = hi - lo
    return _clamp((v - lo) / span, 0.0, 1.0) if span > 0 else 0.0


# --- one member ----------------------------------------------------------------


def member_bounds(m: _Member) -> Tuple[float, float]:
    """The range a member's value is read and written in: semitones for a
    semitone macro, its own LOM range otherwise."""
    if m.semitone_macro:
        return float(PITCH_MIN), float(PITCH_MAX)
    return m.min, m.max


def member_read(m: _Member) -> Optional[float]:
    """A member's value in :func:`member_bounds`; ``None`` when unread, or a
    semitone macro with no span."""
    raw = _float_or_none(read_value(m.param))
    if raw is None or not m.semitone_macro:
        return raw
    span = m.max - m.min
    if span <= 0:
        return None
    return semitones_from_t((raw - m.min) / span)


def member_write(m: _Member, value) -> None:
    """Write ``value`` (in :func:`member_bounds`) to the member's parameter.
    Raises what the LOM raises; the caller counts the refusal."""
    if not m.semitone_macro:
        m.param.value = value
        return
    m.param.value = m.min + t_from_semitones(value) * (m.max - m.min)


def member_fn_value(m: _Member) -> Optional[float]:
    """A member's current value as the function's own ``t`` (0..1) — the
    exact inverse of the fan-out's ``min + t·(max−min)``, so a deviation
    measured here writes back to the value it was read from. ``None`` when
    the parameter cannot be read or has no span."""
    v = member_read(m)
    if v is None:
        return None
    lo, hi = member_bounds(m)
    span = hi - lo
    if span <= 0:
        return None
    return _clamp((v - lo) / span, 0.0, 1.0)


def member_target(fn: VirtualMacro, m: _Member, value):
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


# --- a function's held value ----------------------------------------------------


def coerce(fn: VirtualMacro, value):
    """A wire value as the function's held value: ``t`` clamped to 0..1, an
    FX type, or whole semitones clamped ±48. ``None`` when not a number."""
    v = _float_or_none(value)
    if v is None:
        return None
    if fn.kind == KIND_T:
        return _clamp(v, 0.0, 1.0)
    if fn.kind == KIND_ENUM:
        return int(_clamp(round(v), 0, FX_TYPE_MAX))
    return int(_clamp(round(v), PITCH_MIN, PITCH_MAX))


def to_t(fn: VirtualMacro, value) -> float:
    """Held value → macro travel ``0..1`` (for the legacy macro)."""
    if fn.kind == KIND_ENUM:
        return _clamp(float(value) / FX_TYPE_MAX, 0.0, 1.0)
    if fn.kind == KIND_SEMITONES:
        return t_from_semitones(value)
    return _clamp(float(value), 0.0, 1.0)


def from_t(fn: VirtualMacro, t: float):
    """Macro travel ``0..1`` → held value (seeding from a mapped macro)."""
    if fn.kind == KIND_ENUM:
        return int(_clamp(round(t * FX_TYPE_MAX), 0, FX_TYPE_MAX))
    if fn.kind == KIND_SEMITONES:
        return int(_clamp(round(semitones_from_t(t)), PITCH_MIN, PITCH_MAX))
    return _clamp(t, 0.0, 1.0)
