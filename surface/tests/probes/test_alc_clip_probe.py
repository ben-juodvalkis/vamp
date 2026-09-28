"""AlcClipProbe unit tests.

``Live.Browser`` / clip LOM only exist inside Live, so these tests exercise
the probe's scaffolding against stubs: target-slot resolution (first empty
slot), selection writes, item resolution, the load call, and the delayed
readback → result shapes (clip landed with metadata / slot empty after load
/ no empty slot / not found / loader raised). The real warp/loop/gain verdict
comes from an operator-driven run against Live via owner/probes/alc_clip_probe_run.js.
"""

from __future__ import annotations

import pytest

from components.AlcClipProbe import (
    AlcClipProbe,
    LOAD_ADDRESS,
    RESULT_ADDRESS,
    _read_clip_metadata,
)


# --- stubs -----------------------------------------------------------------


class StubClip:
    def __init__(self, **attrs):
        # Defaults mimic a warped audio clip with a loop.
        self.is_audio_clip = attrs.get("is_audio_clip", True)
        self.warping = attrs.get("warping", True)
        self.warp_mode = attrs.get("warp_mode", 0)
        self.warp_markers = attrs.get("warp_markers", [object(), object()])
        self.looping = attrs.get("looping", True)
        self.loop_start = attrs.get("loop_start", 0.0)
        self.loop_end = attrs.get("loop_end", 4.0)
        self.start_marker = attrs.get("start_marker", 0.0)
        self.end_marker = attrs.get("end_marker", 4.0)
        self.gain = attrs.get("gain", 0.5)
        self.pitch_coarse = attrs.get("pitch_coarse", 0)
        self.pitch_fine = attrs.get("pitch_fine", 0)
        self.file_path = attrs.get("file_path", "/x/iphone 3.aif")


class StubSlot:
    def __init__(self, clip=None):
        self._clip = clip

    @property
    def has_clip(self):
        return self._clip is not None

    @property
    def clip(self):
        return self._clip

    def set_clip(self, clip):
        self._clip = clip


class StubTrack:
    def __init__(self, slots):
        self.clip_slots = list(slots)


class StubView:
    def __init__(self, track):
        self.selected_track = track
        self.highlighted_clip_slot = None


class StubSong:
    def __init__(self, track):
        self.view = StubView(track)


class StubBrowser:
    """Records the item passed to load_item; optionally fills a slot on load."""

    def __init__(self, on_load=None, raises=False):
        self.loaded = None
        self._on_load = on_load
        self._raises = raises

    def load_item(self, item):
        if self._raises:
            raise RuntimeError("boom")
        self.loaded = item
        if self._on_load:
            self._on_load(item)


def _capture_emit():
    calls = []

    def emit(address, args):
        calls.append((address, args))

    return calls, emit


def _sync_schedule(delay_ms, fn):
    """Fire the verify callback inline so assertions run in the same frame."""
    fn()


# --- tests -----------------------------------------------------------------


def test_clip_lands_with_metadata_reports_ok():
    empty = StubSlot()
    track = StubTrack([empty])
    song = StubSong(track)

    item = object()
    # On load, Live drops the clip into the highlighted slot.
    def on_load(_i):
        empty.set_clip(StubClip(loop_start=1.0, loop_end=5.0, gain=0.42))

    browser = StubBrowser(on_load=on_load)
    calls, emit = _capture_emit()

    probe = AlcClipProbe(
        browser=browser,
        song=song,
        resolve_item=lambda p: item,
        emit=emit,
        schedule_delayed=_sync_schedule,
    )
    probe.handle_alc_clip_load(["/lib/clip.alc"], None)

    # Selection was set to the target track + slot before loading.
    assert song.view.selected_track is track
    assert song.view.highlighted_clip_slot is empty
    assert browser.loaded is item

    assert len(calls) == 1
    address, (ok, detail) = calls[0]
    assert address == RESULT_ADDRESS
    assert ok == 1
    assert "loop_start=1.0" in detail
    assert "loop_end=5.0" in detail
    assert "gain=0.42" in detail
    assert "warping=True" in detail


def test_first_empty_slot_chosen_not_a_full_one():
    full = StubSlot(StubClip())
    empty = StubSlot()
    track = StubTrack([full, empty])
    song = StubSong(track)

    loaded_into = {}
    def on_load(_i):
        empty.set_clip(StubClip())
        loaded_into["slot"] = song.view.highlighted_clip_slot

    browser = StubBrowser(on_load=on_load)
    calls, emit = _capture_emit()
    probe = AlcClipProbe(browser, song, lambda p: object(), emit, _sync_schedule)
    probe.handle_alc_clip_load(["/lib/clip.alc"], None)

    # It targeted the empty slot, never the populated one.
    assert loaded_into["slot"] is empty
    assert song.view.highlighted_clip_slot is empty
    assert calls[0][1][0] == 1


def test_no_empty_slot_fails_cleanly():
    track = StubTrack([StubSlot(StubClip()), StubSlot(StubClip())])
    song = StubSong(track)
    calls, emit = _capture_emit()
    probe = AlcClipProbe(StubBrowser(), song, lambda p: object(), emit, _sync_schedule)
    probe.handle_alc_clip_load(["/lib/clip.alc"], None)

    ok, detail = calls[0][1]
    assert ok == 0
    assert "no_empty_slot" in detail


def test_slot_empty_after_load_reports_failure():
    empty = StubSlot()
    track = StubTrack([empty])
    song = StubSong(track)
    # Browser accepts load but nothing lands in the slot.
    browser = StubBrowser(on_load=None)
    calls, emit = _capture_emit()
    probe = AlcClipProbe(browser, song, lambda p: object(), emit, _sync_schedule)
    probe.handle_alc_clip_load(["/lib/clip.alc"], None)

    ok, detail = calls[0][1]
    assert ok == 0
    assert "slot_empty_after_load" in detail


def test_alc_not_found_in_browser():
    track = StubTrack([StubSlot()])
    song = StubSong(track)
    calls, emit = _capture_emit()
    probe = AlcClipProbe(StubBrowser(), song, lambda p: None, emit, _sync_schedule)
    probe.handle_alc_clip_load(["/lib/missing.alc"], None)

    ok, detail = calls[0][1]
    assert ok == 0
    assert "alc_not_found_in_browser" in detail


def test_load_item_raised():
    empty = StubSlot()
    track = StubTrack([empty])
    song = StubSong(track)
    browser = StubBrowser(raises=True)
    calls, emit = _capture_emit()
    probe = AlcClipProbe(browser, song, lambda p: object(), emit, _sync_schedule)
    probe.handle_alc_clip_load(["/lib/clip.alc"], None)

    ok, detail = calls[0][1]
    assert ok == 0
    assert "load_item_raised" in detail


def test_no_selected_track():
    song = StubSong(None)
    calls, emit = _capture_emit()
    probe = AlcClipProbe(StubBrowser(), song, lambda p: object(), emit, _sync_schedule)
    probe.handle_alc_clip_load(["/lib/clip.alc"], None)

    ok, detail = calls[0][1]
    assert ok == 0
    assert "no_selected_track" in detail


def test_missing_args_emits_nothing():
    track = StubTrack([StubSlot()])
    song = StubSong(track)
    calls, emit = _capture_emit()
    probe = AlcClipProbe(StubBrowser(), song, lambda p: object(), emit, _sync_schedule)
    probe.handle_alc_clip_load([], None)
    assert calls == []


def test_read_clip_metadata_survives_raising_attrs():
    class Raises:
        is_audio_clip = True
        warping = True
        warp_mode = 0

        @property
        def gain(self):
            raise RuntimeError("gain only valid on warped audio clips")

        warp_markers = []
        looping = True
        loop_start = 0.0
        loop_end = 1.0
        start_marker = 0.0
        end_marker = 1.0
        pitch_coarse = 0
        pitch_fine = 0
        file_path = "/x.aif"

    out = _read_clip_metadata(Raises())
    # The raising field is captured, not fatal; other fields still present.
    assert "gain=?(RuntimeError)" in out
    assert "looping=True" in out


def test_load_address_constant():
    assert LOAD_ADDRESS == "/looping/probe/alc_clip_load"
