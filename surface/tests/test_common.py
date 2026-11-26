"""``components/_common.py`` — the helpers components used to paste."""

from __future__ import annotations

import logging

from components._common import (
    LOM_ERRORS,
    WarnOnce,
    coerce_str,
    is_stale_handle_error,
    safe_emit,
    safe_remove,
)

STALE = TypeError(
    "Python argument types in Device.remove_name_listener did not match "
    "C++ signature: remove_name_listener(TPyHandle<ADevice>, object)"
)


def test_coerce_str():
    assert coerce_str(b"tracks/0") == "tracks/0"
    assert coerce_str(b"\xff") == "�"
    assert coerce_str(None) == ""
    assert coerce_str(None, none="None") == "None"
    assert coerce_str(3) == "3"


def test_lom_errors_cover_boost_argument_error():
    assert TypeError in LOM_ERRORS and RuntimeError in LOM_ERRORS


def test_is_stale_handle_error():
    assert is_stale_handle_error(STALE)
    assert not is_stale_handle_error(RuntimeError("listener not found"))


class _Target:
    def __init__(self, raises=None):
        self.removed = []
        self._raises = raises

    def remove_name_listener(self, cb):
        if self._raises is not None:
            raise self._raises
        self.removed.append(cb)


def test_safe_remove_calls_the_remover():
    t = _Target()
    assert safe_remove(t, "remove_name_listener", "cb", "test") is True
    assert t.removed == ["cb"]


def test_safe_remove_without_the_method_is_quiet():
    assert safe_remove(object(), "remove_name_listener", "cb", "test") is False


def test_safe_remove_stale_handle_logs_debug_and_other_errors_warn(caplog):
    with caplog.at_level(logging.DEBUG, logger="looping"):
        assert safe_remove(_Target(STALE), "remove_name_listener", "cb", "test") is False
        assert safe_remove(_Target(RuntimeError("boom")), "remove_name_listener", "cb", "test") is False
    levels = [r.levelno for r in caplog.records if r.name == "looping"]
    assert levels == [logging.DEBUG, logging.WARNING]


def test_safe_remove_other_level_can_be_lowered(caplog):
    with caplog.at_level(logging.DEBUG, logger="looping"):
        safe_remove(_Target(RuntimeError("boom")), "remove_name_listener", "cb", "t",
                    other_level=logging.DEBUG)
    assert [r.levelno for r in caplog.records if r.name == "looping"] == [logging.DEBUG]


def test_safe_emit_swallows_a_raise(caplog):
    sent = []
    safe_emit(lambda a, p: sent.append((a, p)), "/x", (1,), "test")
    assert sent == [("/x", (1,))]

    def boom(_a, _p):
        raise OSError("closed")

    with caplog.at_level(logging.WARNING, logger="looping"):
        safe_emit(boom, "/x", (1,), "test")
    assert "emit /x failed" in caplog.text


def test_warn_once(caplog):
    warned = WarnOnce("Comp")
    with caplog.at_level(logging.WARNING, logger="looping"):
        warned("tracks/0", "cap", "too many")
        warned("tracks/0", "cap", "too many")
        warned("tracks/1", "cap", "too many")
    assert caplog.text.count("too many") == 2
    assert ("tracks/0", "cap") in warned
    warned.clear()
    assert ("tracks/0", "cap") not in warned


class _LiveShapedClip:
    """``get_all_notes_extended`` as Live 13.0b26 has it (measured
    2026-11-25): the bare call answers, any argument raises Boost's
    ArgumentError, a ``TypeError``."""

    def __init__(self, notes=(), raises=None):
        self.notes = list(notes)
        self.raises = raises
        self.calls = []

    def get_all_notes_extended(self, *args):
        self.calls.append(args)
        if args:
            raise TypeError("did not match C++ signature: get_all_notes_extended(TPyHandle<AClip>)")
        if self.raises is not None:
            raise self.raises
        return list(self.notes)


def test_read_all_notes_makes_the_bare_call_only():
    from components._common import read_all_notes

    clip = _LiveShapedClip(notes=["n1", "n2"])
    assert read_all_notes(clip) == (["n1", "n2"], None)
    assert clip.calls == [()]


def test_read_all_notes_reports_a_raise():
    from components._common import read_all_notes

    err = RuntimeError("torn down")
    notes, got = read_all_notes(_LiveShapedClip(raises=err))
    assert notes is None and got is err
