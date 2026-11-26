"""The song's undo step, one owner for every component (``component_util``).

Live's ``begin_undo_step`` / ``end_undo_step`` do not nest (measured on Live
12.4.15b2 and 13.0b26): an inner end closes the outer step. On the rig
(2026-11-25) a Drum Rack value moved during a similar-sound swap closed the
swap's step, and one Undo reverted the macro with half the swap. These pin
the counting that makes a gesture join an open step instead.
"""

from __future__ import annotations

from components.component_util import (
    begin_undo_step,
    end_undo_step,
    reset_undo_steps,
    undo_depth,
)


class _Song:
    def __init__(self, live_ptr=None, refuse=False):
        if live_ptr is not None:
            self._live_ptr = live_ptr
        self.refuse = refuse
        self.calls = []

    def begin_undo_step(self):
        if self.refuse:
            raise RuntimeError("refused")
        self.calls.append("begin")

    def end_undo_step(self):
        self.calls.append("end")


def test_a_lone_step_reaches_live():
    song = _Song()
    began = begin_undo_step("A", song)
    end_undo_step("A", song, began)
    assert song.calls == ["begin", "end"]
    assert undo_depth(song) == 0


def test_a_gesture_inside_a_held_step_joins_it():
    """The swap opens, a macro gesture opens and closes inside it, then the
    swap closes: Live sees one begin and one end, the swap's."""
    song = _Song()
    swap = begin_undo_step("DrumSwap", song)
    macro = begin_undo_step("DrumVM", song)
    assert undo_depth(song) == 2
    end_undo_step("DrumVM", song, macro)
    assert song.calls == ["begin"], "the gesture's end closed the swap's step"
    end_undo_step("DrumSwap", song, swap)
    assert song.calls == ["begin", "end"]


def test_the_owners_may_close_in_any_order():
    song = _Song()
    swap = begin_undo_step("DrumSwap", song)
    macro = begin_undo_step("DrumVM", song)
    end_undo_step("DrumSwap", song, swap)  # the swap finishes mid-gesture
    assert song.calls == ["begin"]
    end_undo_step("DrumVM", song, macro)
    assert song.calls == ["begin", "end"]


def test_two_wrappers_of_one_song_share_the_count():
    """``self.song`` can hand each component its own wrapper; the count
    follows the LOM song."""
    a, b = _Song(live_ptr=77), _Song(live_ptr=77)
    held = begin_undo_step("A", a)
    joined = begin_undo_step("B", b)
    end_undo_step("B", b, joined)
    end_undo_step("A", a, held)
    assert a.calls == ["begin", "end"] and b.calls == []


def test_a_refused_begin_holds_nothing():
    song = _Song(refuse=True)
    warned = []
    began = begin_undo_step("A", song, warn=warned.append)
    assert began is False and undo_depth(song) == 0 and len(warned) == 1
    end_undo_step("A", song, began)
    assert song.calls == []


def test_reset_forgets_a_level_left_open():
    song = _Song()
    begin_undo_step("A", song)
    reset_undo_steps()
    began = begin_undo_step("B", song)
    end_undo_step("B", song, began)
    assert song.calls == ["begin", "begin", "end"]
