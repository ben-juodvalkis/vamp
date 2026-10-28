"""``/looping/v3/session/show_message`` puts one line in Live's status bar (ADR-491)."""

from components.StatusMessageComponent import (
    MAX_MESSAGE_CHARS,
    StatusMessageComponent,
)


def _component():
    shown = []
    return StatusMessageComponent(show=shown.append), shown


def test_shows_the_text():
    comp, shown = _component()
    comp.handle_show_message(["Vamp: iPad (192.168.1.42) wants to connect. Code 482913"])
    assert shown == ["Vamp: iPad (192.168.1.42) wants to connect. Code 482913"]


def test_an_empty_string_clears_the_line():
    comp, shown = _component()
    comp.handle_show_message([""])
    assert shown == [""]


def test_one_line_and_cut_to_fit():
    comp, shown = _component()
    comp.handle_show_message(["a\nb\tc   d" + "x" * 500])
    assert "\n" not in shown[0] and "\t" not in shown[0]
    assert shown[0].startswith("a b c d")
    assert len(shown[0]) == MAX_MESSAGE_CHARS


def test_a_non_string_shows_nothing():
    comp, shown = _component()
    comp.handle_show_message([42])
    comp.handle_show_message([])
    assert shown == [""]


def test_a_raising_status_bar_does_not_escape():
    def boom(_text):
        raise RuntimeError("no status bar")

    StatusMessageComponent(show=boom).handle_show_message(["hello"])
