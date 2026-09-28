"""RecordSuspendComponent unit tests.

Covers the bracket the Group-Tracks gesture opens around a reposition:
- suspend turns record_mode off and reports it was on;
- suspend on an already-off record_mode is a no-op that reports so;
- resume always turns record_mode back on;
- a raising song property never leaves the handler hanging without a reply.
"""

from __future__ import annotations

from components.RecordSuspendComponent import (
    RecordSuspendComponent,
    V3_GROUP_RECORD_RESUME_ACK_ADDRESS,
    V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS,
)


class FakeSong:
    def __init__(self, record_mode=0):
        self.record_mode = record_mode


class RaisingRecordModeSong:
    """record_mode raises on both read and write, like a Live 12 quirk."""

    @property
    def record_mode(self):
        raise RuntimeError("no live set")

    @record_mode.setter
    def record_mode(self, value):
        raise RuntimeError("no live set")


def _make(song):
    emitted = []
    component = RecordSuspendComponent(song=song, emit=lambda addr, args: emitted.append((addr, args)))
    return component, emitted


def test_suspend_turns_off_an_active_record_and_reports_it_was_on():
    song = FakeSong(record_mode=1)
    component, emitted = _make(song)

    component.handle_suspend(["req-1"])

    assert song.record_mode == 0
    assert emitted == [(V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS, ["req-1", 1])]


def test_suspend_on_an_already_off_record_is_a_no_op():
    song = FakeSong(record_mode=0)
    component, emitted = _make(song)

    component.handle_suspend(["req-2"])

    assert song.record_mode == 0
    assert emitted == [(V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS, ["req-2", 0])]


def test_resume_turns_record_back_on_unconditionally():
    song = FakeSong(record_mode=0)
    component, emitted = _make(song)

    component.handle_resume(["req-3"])

    assert song.record_mode == 1
    assert emitted == [(V3_GROUP_RECORD_RESUME_ACK_ADDRESS, ["req-3"])]


def test_suspend_answers_wasOn_false_when_the_song_property_raises():
    component, emitted = _make(RaisingRecordModeSong())

    component.handle_suspend(["req-4"])

    assert emitted == [(V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS, ["req-4", 0])]


def test_resume_still_answers_when_the_song_property_raises():
    component, emitted = _make(RaisingRecordModeSong())

    component.handle_resume(["req-5"])

    assert emitted == [(V3_GROUP_RECORD_RESUME_ACK_ADDRESS, ["req-5"])]


def test_a_missing_request_id_does_not_crash():
    song = FakeSong(record_mode=1)
    component, emitted = _make(song)

    component.handle_suspend([])
    component.handle_resume([])

    assert emitted == [
        (V3_GROUP_RECORD_SUSPEND_ACK_ADDRESS, ["", 1]),
        (V3_GROUP_RECORD_RESUME_ACK_ADDRESS, [""]),
    ]
