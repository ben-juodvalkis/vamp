"""The helper against a fake Accessibility tree: lookup, verbs, named errors,
the smoke check, trust re-checks and the socket protocol."""

from __future__ import annotations

import json
import os
import shutil
import socket
import tempfile
import threading

import pytest
from fake_ax import El, FakeBackend, live_tree, menubar

from looping_ax_helper import ax
from looping_ax_helper.ax import (
    AxError,
    Target,
    boundary_prefix,
    fill,
    find_identifier,
    locate,
    parse_menu_title,
)
from looping_ax_helper.server import Server
from looping_ax_helper.targets import CATALOG
from looping_ax_helper.verbs import SMOKE_SETTLE_S, Helper


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def make_helper(backend, *, clock=None, probe=lambda: False):
    clock = clock or Clock()
    helper = Helper(backend, CATALOG, messaging_timeout_s=15.0, bundle="/Apps/Looping AX Helper.app",
                    clock=clock, sleep=clock.sleep, probe_trust=probe)
    return helper, clock


def raises(code, fn, *args, **kwargs):
    with pytest.raises(AxError) as info:
        fn(*args, **kwargs)
    assert info.value.code == code, info.value
    return info.value


# --- lookup ---------------------------------------------------------------------

def test_boundary_prefix_respects_segments():
    assert boundary_prefix("TrackView.Device[1]", "TrackView.Device[1].TitleBar")
    assert boundary_prefix("TrackView", "TrackView.Device[0]")
    assert boundary_prefix("TrackView.Device", "TrackView.Device[0]")
    assert not boundary_prefix("TrackView.Device[1]", "TrackView.Device[10].TitleBar")
    assert not boundary_prefix("Track", "TrackView")


def test_identifier_lookup_skips_unrelated_subtrees():
    window, _ = live_tree(session_tracks=200)
    backend = FakeBackend(window)
    found, visited = find_identifier(backend, window, "TrackView.Device[0].TitleBar.ShowSwapBar")
    assert found and found[0].attrs["AXDescription"] == "Show/Hide Similar Sample Swap Buttons"
    assert visited < 30  # the 200-track SessionView subtree is never entered


def test_full_walk_when_an_ancestor_breaks_the_hierarchy():
    target = El("AXButton", identifier="Odd.Button")
    window = El("AXWindow", children=(El("AXGroup", identifier="Unrelated", children=(target,)),))
    found, info = locate(FakeBackend(window), window, Target("t", "AXButton", identifier="Odd.Button"), {})
    assert found == [target] and info["fullWalk"]


def test_description_fallback_inside_its_container():
    window, refs = live_tree()
    decoy = El("AXButton", description="Reverse")  # a device's Reverse, outside Clip Detail
    window.kids[0].kids.insert(0, decoy)
    decoy.parent = window.kids[0]
    found, _ = locate(FakeBackend(window), window, CATALOG["clip.reverse"], {})
    assert found == [refs["reverse"]]


def test_missing_container_and_wrong_role_are_named():
    window, _ = live_tree(with_reverse=False)
    backend = FakeBackend(window)
    err = raises(ax.MISSING, locate, backend, window, CATALOG["clip.reverse"], {})
    assert "needs an audio clip shown in Clip View" in err.detail
    raises(ax.MISSING, locate, backend, window,
           Target("x", "AXButton", description="Reverse", within="NoSuchView"), {})
    raises(ax.WRONG_ROLE, locate, backend, window, Target("x", "AXButton", identifier="Transport.Tempo"), {})


def test_params_only_accept_small_integers():
    assert fill("TrackView.Device[{device}]", {"device": 3}) == "TrackView.Device[3]"
    raises(ax.BAD_REQUEST, fill, "TrackView.Device[{device}]", {"device": "0].X"})
    raises(ax.BAD_REQUEST, fill, "TrackView.Device[{device}]", {"device": True})
    raises(ax.BAD_REQUEST, fill, "TrackView.Device[{device}]", {})


def test_parse_menu_title():
    assert parse_menu_title("Freeze Track, ⌥⇧⌘F") == ("Freeze Track", False)
    assert parse_menu_title("✔ 1 Bar") == ("1 Bar", True)
    assert parse_menu_title("Crop, Consolidate and Bounce") == ("Crop, Consolidate and Bounce", False)


# --- verbs ------------------------------------------------------------------------

def test_press_reports_timings_and_sets_the_timeout():
    window, refs = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    result = helper.dispatch("press", {"target": "transport.tap_tempo"})
    assert refs["tap"].performed == ["AXPress"]
    assert result["target"] == "transport.tap_tempo" and "pressMs" in result and "lookupMs" in result
    assert 15.0 in backend.timeouts


def test_press_named_errors():
    window, refs = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    refs["tap"].attrs["AXEnabled"] = False
    raises(ax.DISABLED, helper.dispatch, "press", {"target": "transport.tap_tempo"})
    refs["tap"].attrs["AXEnabled"] = True
    refs["tap"].rc["AXPress"] = ax.AX_CANNOT_COMPLETE
    raises(ax.TIMEOUT, helper.dispatch, "press", {"target": "transport.tap_tempo"})
    refs["tap"].rc["AXPress"] = ax.AX_API_DISABLED
    raises(ax.UNTRUSTED, helper.dispatch, "press", {"target": "transport.tap_tempo"})
    refs["tap"].rc["AXPress"] = -25200
    err = raises(ax.FAILED, helper.dispatch, "press", {"target": "transport.tap_tempo"})
    assert "kAXErrorFailure" in err.detail


def test_dispatch_preconditions():
    window, _ = live_tree()
    backend = FakeBackend(window, trusted=False)
    helper, _ = make_helper(backend)
    err = raises(ax.UNTRUSTED, helper.dispatch, "press", {"target": "transport.tap_tempo"})
    assert 'switch on "Looping AX Helper"' in err.detail
    backend.is_trusted = True
    backend.pid = None
    raises(ax.LIVE_NOT_RUNNING, helper.dispatch, "press", {"target": "transport.tap_tempo"})
    backend.pid = 4242
    raises(ax.UNKNOWN_VERB, helper.dispatch, "scroll", {})
    raises(ax.UNKNOWN_TARGET, helper.dispatch, "press", {"target": "transport.nope"})
    raises(ax.BAD_REQUEST, helper.dispatch, "press", ["not", "an", "object"])
    raises(ax.BAD_REQUEST, helper.dispatch, "press", {"target": {"identifier": "X"}})  # raw target needs a role
    raises(ax.BAD_REQUEST, helper.dispatch, "press", {"target": "transport.tap_tempo", "timeoutS": 0})
    backend.window = None
    raises(ax.NO_WINDOW, helper.dispatch, "press", {"target": "transport.tap_tempo"})


def test_repeated_targets_need_an_index_and_use_reading_order():
    window, refs = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    args = {"target": "pad.lock", "params": {"device": 0}}
    err = raises(ax.BAD_REQUEST, helper.dispatch, "press", args)
    assert err.extra["count"] == 16
    helper.dispatch("press", {**args, "index": 0})
    assert refs["locks"][(0, 0)].performed == ["AXPress"]  # top-left, though the tree lists the bottom row first
    helper.dispatch("press", {**args, "index": 6})
    assert refs["locks"][(1, 2)].performed == ["AXPress"]
    helper.dispatch("press", {**args, "index": 0, "order": "tree"})
    assert refs["locks"][(3, 0)].performed == ["AXPress"]
    err = raises(ax.MISSING, helper.dispatch, "press", {**args, "index": 16})
    assert err.extra["count"] == 16


def test_swap_controls_absent_while_the_swap_bar_is_off():
    window, _ = live_tree(swap_bar_on=False)
    helper, _ = make_helper(FakeBackend(window))
    err = raises(ax.MISSING, helper.dispatch, "press", {"target": "kit.swap_next", "params": {"device": 0}})
    assert "swap bar on" in err.detail
    read = helper.dispatch("read", {"target": "device.show_swap_bar", "params": {"device": 0}})
    assert read["value"] == 0 and read["role"] == "AXCheckBox"


def test_read_all_and_raw_targets():
    window, refs = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    listed = helper.dispatch("list", {"target": {"role": "AXCheckBox",
                                                 "identifier": "TrackView.Device[0].pad_collection_view.Border.SwapBar.Lock",
                                                 "repeated": True}})
    assert listed["count"] == 16 and listed["elements"][0]["position"] == [120, 900]
    one = helper.dispatch("read", {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"},
                                   "actions": True, "attributes": ["AXDescription"]})
    assert one["value"] == 111.0 and "AXIncrement" in one["actions"]
    assert one["attributes"] == {"AXDescription": "Tempo"}
    asked = helper.dispatch("read", {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"},
                                     "attributes": ["AXValue", "AXDescription"], "settable": True})
    assert asked["settable"] == {"AXValue": False, "AXDescription": False}  # Live's sliders: measured, no
    refs["tempo"].attrs["AXValueSettable"] = True
    asked = helper.dispatch("read", {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"},
                                     "attributes": ["AXValue"], "settable": True})
    assert asked["settable"] == {"AXValue": True}
    raises(ax.BAD_REQUEST, helper.dispatch, "read",
           {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}, "settable": True})


def test_select_writes_the_whole_selection_in_one_go():
    window, refs = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    result = helper.dispatch("select", {"target": "tracks.headers", "members": [
        {"target": "track.header", "params": {"track": 1}},
        {"target": "track.header", "params": {"track": 2}},
    ]})
    assert result["count"] == 2
    assert result["replaced"] == [len(refs["rows"]) - 1]  # the Main track row, where live_tree starts
    written = [call for call in backend.set_calls if call[1] == "AXSelectedRows"]
    assert len(written) == 1 and written[0][0] is refs["headers"]
    assert written[0][2] == [refs["rows"][1], refs["rows"][2]]


def test_select_waits_for_live_to_take_the_selection():
    """Live rebuilds its selection on its own thread; an immediate read answers
    the old one, an empty one, or part of the new one (measured on the rig)."""
    window, refs = live_tree()
    backend = FakeBackend(window)
    outline = refs["headers"]
    reads = {"n": 0}
    real_attr = backend.attr

    def slow(el, name):
        if el is outline and name == "AXSelectedRows":
            reads["n"] += 1
            if reads["n"] <= 3:           # the first reads come back empty
                return [] if reads["n"] > 1 else real_attr(el, name)
        return real_attr(el, name)

    backend.attr = slow
    helper, _ = make_helper(backend)
    result = helper.dispatch("select", {"target": "tracks.headers", "members": [
        {"target": "track.header", "params": {"track": 1}}]})
    assert result["count"] == 1 and reads["n"] > 2


def test_select_refuses_a_container_that_does_not_take_a_selection():
    window, refs = live_tree()
    refs["headers"].attrs["AXSelectedRowsSettable"] = False
    helper, _ = make_helper(FakeBackend(window))
    raises(ax.FAILED, helper.dispatch, "select", {"target": "tracks.headers", "members": [
        {"target": "track.header", "params": {"track": 0}}]})


def test_select_reports_a_selection_live_did_not_take():
    window, refs = live_tree()
    backend = FakeBackend(window)
    # Settable says yes, the write returns 0, and the selection does not move:
    # the failure mode `select` reads back for.
    refs["headers"].attrs["AXSelectedRowsSettable"] = True
    real_set = backend.set_attr

    def deaf(el, name, value):
        real_set(el, name, value)
        el.attrs["AXSelectedRows"] = [refs["rows"][-1]]
        return 0

    backend.set_attr = deaf
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "select", {"target": "tracks.headers", "members": [
        {"target": "track.header", "params": {"track": 0}},
        {"target": "track.header", "params": {"track": 1}}]})


def test_select_bounds_the_member_list():
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    raises(ax.BAD_REQUEST, helper.dispatch, "select", {"target": "tracks.headers", "members": []})
    raises(ax.BAD_REQUEST, helper.dispatch, "select", {"target": "tracks.headers", "members": ["track.header"]})
    raises(ax.BAD_REQUEST, helper.dispatch, "select", {"target": "tracks.headers", "members": [
        {"target": "track.header", "params": {"track": i % 40}} for i in range(65)]})


def test_focus_sets_and_confirms_axfocused():
    window, refs = live_tree()
    row = refs["rows"][2]
    row.attrs["AXFocusedSettable"] = True
    helper, _ = make_helper(FakeBackend(window))
    result = helper.dispatch("focus", {"target": "track.header", "params": {"track": 2}})
    assert row.attrs["AXFocused"] is True and result["target"] == "track.header"


def test_focus_refuses_a_control_that_does_not_take_it():
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    # Not marked *Settable in the fixture: AXFocused stays whatever it was.
    raises(ax.FAILED, helper.dispatch, "focus", {"target": "track.header", "params": {"track": 0}})


def test_focus_reports_a_write_live_did_not_take():
    window, refs = live_tree()
    row = refs["rows"][0]
    row.attrs["AXFocusedSettable"] = True
    backend = FakeBackend(window)
    real_set = backend.set_attr
    # Settable says yes, the write returns 0, but AXFocused never flips --
    # the same "the promise is about the attribute, not the effect" trap the
    # docstring calls out.
    backend.set_attr = lambda el, name, value, real=real_set: (0 if name == "AXFocused" else real(el, name, value))
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "focus", {"target": "track.header", "params": {"track": 0}, "timeoutMs": 50})


def test_press_key_sends_modifier_down_key_key_modifier_up_in_order():
    window, _ = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    result = helper.dispatch("press_key", {"key": "down", "modifiers": ["shift"]})
    assert backend.keys == [(ax.MODIFIER_KEYS["shift"], True), (ax.ARROW_KEYS["down"], True),
                             (ax.ARROW_KEYS["down"], False), (ax.MODIFIER_KEYS["shift"], False)]
    assert result == {"key": "down", "modifiers": ["shift"], "ms": result["ms"]}


def test_press_key_with_no_modifier():
    window, _ = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    helper.dispatch("press_key", {"key": "up"})
    assert backend.keys == [(ax.ARROW_KEYS["up"], True), (ax.ARROW_KEYS["up"], False)]


def test_press_key_rejects_anything_outside_the_whitelist():
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    raises(ax.BAD_REQUEST, helper.dispatch, "press_key", {"key": "return"})
    raises(ax.BAD_REQUEST, helper.dispatch, "press_key", {"key": "down", "modifiers": ["command"]})
    raises(ax.BAD_REQUEST, helper.dispatch, "press_key", {"key": "down", "modifiers": "shift"})


def test_click_defaults_to_the_element_center_with_no_modifiers():
    window, _ = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    # rows default to pos=(0,0) size=(10,10) in the El fixture: center = (5, 5)
    result = helper.dispatch("click", {"target": "track.header", "params": {"track": 1}})
    assert backend.clicks == [(4242, 5.0, 5.0, ())]
    assert result["point"] == [5, 5] and result["modifiers"] == []


def test_click_at_a_custom_point_with_cmd_held():
    window, _ = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    helper.dispatch("click", {"target": "track.header", "params": {"track": 0}, "at": [0.2, 0.8],
                              "modifiers": ["cmd"]})
    assert backend.clicks == [(4242, 2.0, 8.0, ("cmd",))]


def test_click_can_actually_change_something_the_way_a_real_one_would():
    """The point of `click` over `select`/`press_key`: Live's own reaction to a
    real click, not a promise about an attribute. Simulated here by having the
    fake backend's on_click hook do what Live is hypothesised to do -- add the
    clicked row to the outline's real AXSelectedRows."""
    window, refs = live_tree()
    backend = FakeBackend(window)
    outline, rows = refs["headers"], refs["rows"]

    def cmd_click_selects(b, x, y, modifiers):
        if "cmd" in modifiers:
            outline.attrs["AXSelectedRows"] = list(outline.attrs["AXSelectedRows"]) + [rows[2]]

    backend.on_click = cmd_click_selects
    helper, _ = make_helper(backend)
    helper.dispatch("click", {"target": "track.header", "params": {"track": 2}, "modifiers": ["cmd"]})
    # Real ground truth, not the click verb's own say-so: what the outline
    # itself now holds, the same way the real helper is read back over AX.
    assert rows[2] in outline.attrs["AXSelectedRows"]
    assert len(outline.attrs["AXSelectedRows"]) == 2  # the pre-existing Main-track selection, plus this one


def test_click_rejects_bad_at_and_bad_modifiers():
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    raises(ax.BAD_REQUEST, helper.dispatch, "click", {"target": "track.header", "params": {"track": 0},
                                                       "at": [1.5, 0.5]})
    raises(ax.BAD_REQUEST, helper.dispatch, "click", {"target": "track.header", "params": {"track": 0},
                                                       "modifiers": ["option"]})
    raises(ax.BAD_REQUEST, helper.dispatch, "click", {"target": "track.header", "params": {"track": 0},
                                                       "modifiers": "cmd"})


def test_click_reports_failure_to_post():
    window, _ = live_tree()
    backend = FakeBackend(window)
    backend.click_ok = False
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "click", {"target": "track.header", "params": {"track": 0}})


def test_system_click_raises_live_clicks_and_restores_the_real_cursor():
    window, _ = live_tree()
    backend = FakeBackend(window)
    backend.cursor = (900.0, 400.0)  # wherever the "real" pointer happened to be
    helper, _ = make_helper(backend)
    result = helper.dispatch("system_click", {"target": "track.header", "params": {"track": 2},
                                              "modifiers": ["cmd"]})
    assert (backend.app, "AXFrontmost", True) in backend.set_calls
    assert backend.system_clicks == [(5.0, 5.0, ("cmd",))]  # rows default to pos=(0,0) size=(10,10)
    assert backend.system_moves == [(900.0, 400.0)]  # put back exactly where it started
    assert backend.cursor == (900.0, 400.0)  # the click itself moved it; the restore moved it back
    assert result["point"] == [5, 5] and result["restoredTo"] == [900, 400]


def test_system_click_can_actually_change_something_the_way_a_real_one_would():
    """The whole point of `system_click` over `click`: Live's own reaction, not
    a promise about an attribute -- simulated here the same way the `click`
    test does, via on_system_click adding the row to the real selection."""
    window, refs = live_tree()
    backend = FakeBackend(window)
    outline, rows = refs["headers"], refs["rows"]

    def cmd_click_selects(b, x, y, modifiers):
        if "cmd" in modifiers:
            outline.attrs["AXSelectedRows"] = list(outline.attrs["AXSelectedRows"]) + [rows[2]]

    backend.on_system_click = cmd_click_selects
    helper, _ = make_helper(backend)
    helper.dispatch("system_click", {"target": "track.header", "params": {"track": 2}, "modifiers": ["cmd"]})
    assert rows[2] in outline.attrs["AXSelectedRows"]
    assert len(outline.attrs["AXSelectedRows"]) == 2


def test_system_click_refuses_to_fire_blind_into_an_open_panel():
    backend, _, _ = save_as_backend()  # this tree has a sheet up
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "system_click", {"target": "track.header", "params": {"track": 0}})
    assert backend.system_clicks == []  # never posted


def test_system_click_rejects_bad_at_and_bad_modifiers():
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    raises(ax.BAD_REQUEST, helper.dispatch, "system_click",
           {"target": "track.header", "params": {"track": 0}, "at": [-0.1, 0.5]})
    raises(ax.BAD_REQUEST, helper.dispatch, "system_click",
           {"target": "track.header", "params": {"track": 0}, "modifiers": ["option"]})


def test_system_click_reports_failure_to_post():
    window, _ = live_tree()
    backend = FakeBackend(window)
    backend.system_click_ok = False
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "system_click", {"target": "track.header", "params": {"track": 0}})


def test_system_drag_raises_live_holds_the_button_across_a_path_and_restores_cursor():
    window, refs = live_tree()
    rows = refs["rows"]
    rows[0].pos, rows[2].pos = (0.0, 0.0), (100.0, 0.0)  # distinct frames to drag between
    backend = FakeBackend(window)
    backend.cursor = (900.0, 400.0)  # wherever the "real" pointer happened to be
    helper, _ = make_helper(backend)
    result = helper.dispatch("system_drag", {
        "from": {"target": "track.header", "params": {"track": 0}},
        "to": {"target": "track.header", "params": {"track": 2}},
        "steps": 4
    })
    assert (backend.app, "AXFrontmost", True) in backend.set_calls
    # Down at the start, four dragged steps tracing toward the end, up at the end.
    assert backend.system_mouse_downs == [(5.0, 5.0)]
    assert backend.system_mouse_draggeds == [(30.0, 5.0), (55.0, 5.0), (80.0, 5.0), (105.0, 5.0)]
    assert backend.system_mouse_ups == [(105.0, 5.0)]
    assert backend.system_moves == [(5.0, 5.0), (900.0, 400.0)]  # to the start, then back
    assert backend.cursor == (900.0, 400.0)
    assert result["fromPoint"] == [5, 5] and result["toPoint"] == [105, 5]
    assert result["restoredTo"] == [900, 400]


def test_system_drag_can_actually_move_a_track_the_way_a_real_drag_would():
    """The whole point of `system_drag` over any single click: Live's own
    reaction to a held-button move across a path, simulated here via
    `on_system_drag_end` reparenting the dragged row -- the fake's stand-in
    for Live moving a track into a group without dissolving it."""
    window, refs = live_tree()
    rows = refs["rows"]
    rows[0].pos, rows[2].pos = (0.0, 0.0), (100.0, 0.0)
    backend = FakeBackend(window)

    moved = {}

    def drop_into_group(b, x1, y1, x2, y2):
        moved["path"] = (x1, y1, x2, y2)

    backend.on_system_drag_end = drop_into_group
    helper, _ = make_helper(backend)
    helper.dispatch("system_drag", {
        "from": {"target": "track.header", "params": {"track": 0}},
        "to": {"target": "track.header", "params": {"track": 2}}
    })
    assert moved["path"] == (5.0, 5.0, 105.0, 5.0)


def test_system_drag_refuses_to_fire_blind_into_an_open_panel():
    backend, _, _ = save_as_backend()  # this tree has a sheet up
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "system_drag", {
        "from": {"target": "track.header", "params": {"track": 0}},
        "to": {"target": "track.header", "params": {"track": 1}}
    })
    assert backend.system_mouse_downs == []  # never posted


def test_system_drag_rejects_bad_at_fractions():
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    raises(ax.BAD_REQUEST, helper.dispatch, "system_drag", {
        "from": {"target": "track.header", "params": {"track": 0}},
        "to": {"target": "track.header", "params": {"track": 1}},
        "atFrom": [-0.1, 0.5]
    })
    raises(ax.BAD_REQUEST, helper.dispatch, "system_drag", {
        "from": {"target": "track.header", "params": {"track": 0}},
        "to": {"target": "track.header", "params": {"track": 1}},
        "atTo": [1.5, 0.5]
    })


def test_system_drag_reports_failure_to_post():
    window, _ = live_tree()
    backend = FakeBackend(window)
    backend.system_mouse_down_ok = False
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "system_drag", {
        "from": {"target": "track.header", "params": {"track": 0}},
        "to": {"target": "track.header", "params": {"track": 1}}
    })


def test_system_key_raises_live_verifies_frontmost_then_sends_cmd_g():
    window, _ = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    result = helper.dispatch("system_key", {"key": "g", "modifiers": ["cmd"]})
    assert (backend.app, "AXFrontmost", True) in backend.set_calls
    assert backend.system_keys == [(ax.SYSTEM_KEYS["g"], ("cmd",))]
    assert result == {"key": "g", "modifiers": ["cmd"], "ms": result["ms"]}


def test_system_key_can_actually_trigger_something_the_way_a_real_shortcut_would():
    window, refs = live_tree()
    backend = FakeBackend(window)
    outline = refs["headers"]

    def cmd_g_groups(b, keycode, modifiers):
        if keycode == ax.SYSTEM_KEYS["g"] and "cmd" in modifiers:
            outline.attrs["grouped"] = True

    backend.on_system_key = cmd_g_groups
    helper, _ = make_helper(backend)
    helper.dispatch("system_key", {"key": "g", "modifiers": ["cmd"]})
    assert outline.attrs.get("grouped") is True


def test_system_key_refuses_to_fire_blind_into_an_open_panel():
    backend, _, _ = save_as_backend()
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "system_key", {"key": "g", "modifiers": ["cmd"]})
    assert backend.system_keys == []


def test_system_key_refuses_when_live_never_confirms_frontmost():
    """The one way `system_key` is more cautious than `system_click`: a global
    keystroke has no coordinate to anchor it, so it polls AXFrontmost back
    rather than firing the instant it's asked to raise Live."""
    window, _ = live_tree()
    backend = FakeBackend(window)
    backend.frontmost_stuck = True
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "system_key", {"key": "g", "modifiers": ["cmd"], "timeoutMs": 50})
    assert backend.system_keys == []  # never sent


def test_system_key_rejects_anything_outside_the_whitelist():
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    raises(ax.BAD_REQUEST, helper.dispatch, "system_key", {"key": "q", "modifiers": ["cmd"]})
    raises(ax.BAD_REQUEST, helper.dispatch, "system_key", {"key": "g", "modifiers": ["option"]})
    raises(ax.BAD_REQUEST, helper.dispatch, "system_key", {"key": "g", "modifiers": "cmd"})


def test_system_key_reports_failure_to_post():
    window, _ = live_tree()
    backend = FakeBackend(window)
    backend.system_key_ok = False
    helper, _ = make_helper(backend)
    raises(ax.FAILED, helper.dispatch, "system_key", {"key": "g"})


def test_increment_counts_steps():
    window, refs = live_tree()
    helper, _ = make_helper(FakeBackend(window))
    result = helper.dispatch("increment", {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}, "steps": 3})
    assert refs["tempo"].performed == ["AXIncrement"] * 3 and result["steps"] == 3
    raises(ax.BAD_REQUEST, helper.dispatch, "decrement",
           {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}, "steps": 0})


def test_show_menu_then_pick():
    window, refs = live_tree()
    backend = FakeBackend(window)
    freeze = El("AXMenuItem", title="Freeze Track, ⌥⇧⌘F")
    one_bar = El("AXMenuItem", title="✔ 1 Bar")
    menu_window = El("AXWindow")
    menu_window.add(El("AXGroup", identifier="ContextMenu", children=(freeze, one_bar)))
    refs["tempo"].hooks["AXShowMenu"] = lambda b: setattr(b, "focused", freeze)
    helper, _ = make_helper(backend)
    shown = helper.dispatch("show_menu", {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}})
    assert [i["label"] for i in shown["items"]] == ["Freeze Track", "1 Bar"]
    assert shown["items"][1]["checked"] is True
    picked = helper.dispatch("pick", {"label": "Freeze Track"})
    assert picked["picked"] == "Freeze Track, ⌥⇧⌘F" and freeze.performed == ["AXPress"]
    raises(ax.ITEM_MISSING, helper.dispatch, "pick", {"label": "Bounce"})
    assert backend.keys == [(ax.ESCAPE_KEY, True), (ax.ESCAPE_KEY, False)]


def test_show_menu_that_opens_nothing():
    window, refs = live_tree()
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    raises(ax.MENU_MISSING, helper.dispatch, "show_menu",
           {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}, "timeoutMs": 100})
    backend.focused = refs["tap"]  # focus inside the main window is not a menu
    raises(ax.MENU_MISSING, helper.dispatch, "pick", {"label": "Freeze Track"})


def test_show_menu_finds_a_menu_focus_did_not_move_into():
    """Measured on the rig 2026-09-19: with Live not the app the user is in, Live
    opens the context menu and focus stays put. Four probes read as "Live opened
    no menu" against a Live that had opened one every time -- and each left its
    menu standing, so the next call failed too."""
    window, refs = live_tree()
    backend = FakeBackend(window)
    stray = El("AXWindow", children=(El("AXGroup", identifier="ContextMenu",
                                        children=(El("AXMenuItem", title="Group Tracks, \u2318G"),)),))
    refs["tempo"].hooks["AXShowMenu"] = lambda b: b.windows.append(stray)
    helper, _ = make_helper(backend)
    shown = helper.dispatch("show_menu", {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}})
    assert [i["label"] for i in shown["items"]] == ["Group Tracks"]
    # ...and with that menu still up, the next call is a named error, not a second menu.
    raises(ax.FAILED, helper.dispatch, "show_menu",
           {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}, "timeoutMs": 100})


def test_show_menu_dismisses_what_it_could_not_read():
    """A press that puts something up which holds no menu items: the verb says so
    and does not leave it over Live (`pick` had escaped from its equivalents all
    along; this is the same rule)."""
    window, refs = live_tree()
    backend = FakeBackend(window)
    blank = El("AXWindow", children=(El("AXGroup", identifier="ContextMenu"),))
    refs["tempo"].hooks["AXShowMenu"] = lambda b: b.windows.append(blank)
    helper, _ = make_helper(backend)
    raises(ax.MENU_MISSING, helper.dispatch, "show_menu",
           {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}, "timeoutMs": 100})
    assert backend.keys == [(ax.ESCAPE_KEY, True), (ax.ESCAPE_KEY, False)]


def test_wait_for_exists_equals_and_timeout():
    window, _ = live_tree(swap_bar_on=False)
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    got = helper.dispatch("wait_for", {"target": "device.show_swap_bar", "params": {"device": 0}, "equals": 0})
    assert got["value"] == 0
    got = helper.dispatch("wait_for", {"target": "kit.swap_next", "params": {"device": 0}, "exists": False})
    assert got["exists"] is False
    err = raises(ax.WAIT_TIMEOUT, helper.dispatch, "wait_for",
                 {"target": "kit.swap_next", "params": {"device": 0}, "exists": True, "timeoutMs": 200})
    assert err.extra["last"] == "(not showing)"


def test_press_until_a_notification():
    window, refs = live_tree()
    backend = FakeBackend(window)
    refs["tap"].hooks["AXPress"] = lambda b: b.posted.add((b.app, "AXWindowCreated"))
    helper, _ = make_helper(backend)
    result = helper.dispatch("press", {"target": "transport.tap_tempo", "until": {"notification": "AXWindowCreated"}})
    assert result["notifiedMs"] == 12.5 and backend.observers == []
    refs["tap"].hooks.clear()
    backend.posted.clear()
    raises(ax.WAIT_TIMEOUT, helper.dispatch, "press",
           {"target": "transport.tap_tempo", "until": {"notification": "AXWindowCreated", "timeoutMs": 50}})


def test_a_main_window_that_is_the_application_is_no_window():
    window, _ = live_tree()
    backend = FakeBackend(window)
    backend.window = backend.app  # what Live answered on the rig with no window to offer
    helper, _ = make_helper(backend)
    raises(ax.NO_WINDOW, helper.dispatch, "press", {"target": "transport.tap_tempo"})


def test_dump_lists_matching_nodes_and_the_windows():
    window, _ = live_tree(session_tracks=2)
    helper, _ = make_helper(FakeBackend(window))
    out = helper.dispatch("dump", {"match": "TapTempo|ShowSwapBar", "depth": 10})
    assert [n["identifier"] for n in out["nodes"]] == [
        "Transport.TapTempo", "TrackView.Device[0].TitleBar.ShowSwapBar"]
    assert out["app"]["mainWindow"]["role"] == "AXWindow"
    assert [w["role"] for w in out["app"]["windows"]] == ["AXWindow"]  # just the main one
    raises(ax.BAD_REQUEST, helper.dispatch, "dump", {"root": "everywhere"})


SAMPLER = {"device": 0, "chain": 0}


def test_hover_glides_onto_the_drum_sampler_waveform_and_waits_for_its_swap_buttons():
    window, refs = live_tree(sampler=True)
    backend = FakeBackend(window)
    backend.on_move = refs["reveal"]
    helper, _ = make_helper(backend)
    raises(ax.MISSING, helper.dispatch, "press", {"target": "sampler.swap_next", "params": SAMPLER})
    result = helper.dispatch("hover", {"target": "sampler.device", "params": SAMPLER,
                                       "until": {"target": "sampler.swap_next", "params": SAMPLER, "exists": True}})
    x, y = 607 + 0.26 * 490, 817 + 0.28 * 190
    assert result["point"] == [round(x), round(y)] and result["until"]["exists"] is True
    assert "reposted" not in result
    assert len(backend.moves) == Helper.HOVER_GLIDE_STEPS
    assert {pid for pid, _, _ in backend.moves} == {4242}
    assert backend.moves[-1][1:] == pytest.approx((x, y))
    assert all(607 < mx <= x and my == pytest.approx(y) for _, mx, my in backend.moves)  # inside the frame, left to right
    helper.dispatch("press", {"target": "sampler.swap_next", "params": SAMPLER})
    assert refs["sampler_buttons"]["next"].performed == ["AXPress"]


def test_a_hover_live_missed_is_posted_once_more_then_is_a_wait_timeout():
    window, refs = live_tree(sampler=True)
    backend = FakeBackend(window)
    seen = []

    def late(b, x, y):  # only the re-posted move lands
        seen.append((x, y))
        if len(seen) > Helper.HOVER_GLIDE_STEPS:
            refs["reveal"](b, x, y)

    backend.on_move = late
    helper, _ = make_helper(backend)
    until = {"target": "sampler.swap_prev", "params": SAMPLER, "exists": True, "timeoutMs": 100}
    result = helper.dispatch("hover", {"target": "sampler.device", "params": SAMPLER, "until": until})
    assert result["reposted"] is True and result["until"]["exists"] is True

    window, _ = live_tree(sampler=True)
    backend = FakeBackend(window)  # Live never draws them
    helper, _ = make_helper(backend)
    raises(ax.WAIT_TIMEOUT, helper.dispatch, "hover", {"target": "sampler.device", "params": SAMPLER, "until": until})
    assert len(backend.moves) == Helper.HOVER_GLIDE_STEPS + 1


def test_hover_refuses_what_it_cannot_do():
    window, _ = live_tree(sampler=True)
    backend = FakeBackend(window)
    helper, _ = make_helper(backend)
    raw = helper.dispatch("hover", {"target": {"role": "AXSlider", "identifier": "Transport.Tempo"}, "at": [0.5, 0.5]})
    assert raw["point"] == [5, 5]
    raises(ax.BAD_REQUEST, helper.dispatch, "hover", {"target": "sampler.device", "params": SAMPLER, "at": [1.5, 0.2]})
    err = raises(ax.BAD_REQUEST, helper.dispatch, "hover", {"target": "transport.tap_tempo"})
    assert "names no hover point" in err.detail
    raises(ax.BAD_REQUEST, helper.dispatch, "hover", {"target": "sampler.device", "params": SAMPLER, "until": "yes"})
    raises(ax.MISSING, helper.dispatch, "hover", {"target": "sampler.device", "params": {"device": 0, "chain": 1}})
    moves = len(backend.moves)
    backend.move_ok = False
    raises(ax.FAILED, helper.dispatch, "hover", {"target": "sampler.device", "params": SAMPLER})
    assert len(backend.moves) == moves + 1  # stopped at the first refused move


SAVE_AS = "Save Live Set As..."


def save_as_backend():
    """Live with a Save As item whose press opens a panel and focuses its name field."""
    window, _ = live_tree()
    bar = menubar(SAVE_AS)
    item = bar.kids[0].kids[0].kids[0]
    field = El("AXTextField", identifier="saveAsNameTextField", value="Untitled", AXValueSettable=True, pid=5151)
    window.add(El("AXSheet", children=(El("AXGroup", children=(field,)),)))
    backend = FakeBackend(window, menubar=bar)
    item.hooks["AXPress"] = lambda b: setattr(b, "focused", field)
    return backend, item, field


def test_save_as_dialog_presses_the_menu_item_and_writes_the_name_without_a_keystroke():
    backend, item, field = save_as_backend()
    helper, _ = make_helper(backend)
    result = helper.dispatch("save_as_dialog", {"name": "001_2026-09-15_111bpm_4-4"})
    assert item.performed == ["AXPress"]
    assert (field, "AXValue", "001_2026-09-15_111bpm_4-4") in backend.set_calls
    assert result["field"] == "001_2026-09-15_111bpm_4-4" and result["fieldPid"] == 5151
    assert (backend.app, "AXFrontmost", True) in backend.set_calls
    # A success leaves the panel up for the performer: no Escape, no keystrokes.
    assert backend.keys == []


def test_save_as_dialog_refuses_what_it_cannot_do_and_never_types():
    """The name is never typed -- measured 2026-09-15, a name posted to Live's
    process as key events never reached the panel's field, and a keystroke that
    misses the field is a keystroke into Live.

    This used to assert ``backend.keys == []`` outright, which pinned the
    *absence* of the Escape that swap audit H3 is about. The invariant it was
    protecting is "never types the name", so it is now stated that way: every
    key event this verb may send is Escape.
    """
    backend, item, field = save_as_backend()
    helper, _ = make_helper(backend)
    raises(ax.BAD_REQUEST, helper.dispatch, "save_as_dialog", {"name": "a/b"})
    assert backend.keys == []  # refused before the menu press: nothing to dismiss
    field.attrs["AXValueSettable"] = False
    err = raises(ax.FAILED, helper.dispatch, "save_as_dialog", {"name": "x"})
    assert "does not take a value" in err.detail and field.attrs["AXValue"] == "Untitled"
    item.hooks.clear()
    backend.focused = None
    raises(ax.WAIT_TIMEOUT, helper.dispatch, "save_as_dialog", {"name": "x", "timeoutMs": 100})
    item.attrs["AXEnabled"] = False
    raises(ax.DISABLED, helper.dispatch, "save_as_dialog", {"name": "x"})
    assert {code for code, _ in backend.keys} == {ax.ESCAPE_KEY}


def test_save_as_dialog_dismisses_the_panel_on_every_post_press_failure():
    """Swap audit H3.

    The panel is modal. Four raise points sat between the menu press and the
    reply and none of them escaped, so a failure left Live's Save As panel up
    over the performance -- and the next transport stop found Save Live Set As
    disabled behind it. The sibling ``_pick`` had escaped from its equivalents
    all along.
    """
    # (a) the field will not take a value -- the panel is up, so Escape goes out
    backend, item, field = save_as_backend()
    helper, _ = make_helper(backend)
    field.attrs["AXValueSettable"] = False
    err = raises(ax.FAILED, helper.dispatch, "save_as_dialog", {"name": "x"})
    assert backend.keys == [(ax.ESCAPE_KEY, True), (ax.ESCAPE_KEY, False)]
    assert "was dismissed" in err.detail

    # (b) the readback never matches what was written: the field reports
    # settable, takes the write, and still reads back the old value -- Live
    # holding the panel's field while a modal alert sits on top of it.
    backend, item, field = save_as_backend()
    helper, _ = make_helper(backend)
    real_set = backend.set_attr

    def swallow(el, name, value):
        rc = real_set(el, name, value)
        if el is field and name == "AXValue":
            field.attrs["AXValue"] = "Untitled"
        return rc

    backend.set_attr = swallow
    err = raises(ax.FAILED, helper.dispatch, "save_as_dialog", {"name": "x"})
    assert "reads" in err.detail and "was dismissed" in err.detail
    assert backend.keys == [(ax.ESCAPE_KEY, True), (ax.ESCAPE_KEY, False)]


def test_save_as_dialog_does_not_escape_into_live_when_no_panel_opened():
    """Escape is only sent when a panel is actually up. A menu press that opened
    nothing must not post Escape into Live's own window."""
    window, _ = live_tree()
    bar = menubar(SAVE_AS)
    backend = FakeBackend(window, menubar=bar)  # no sheet, no second window
    helper, _ = make_helper(backend)
    backend.focused = None
    err = raises(ax.WAIT_TIMEOUT, helper.dispatch, "save_as_dialog", {"name": "x", "timeoutMs": 50})
    assert backend.keys == []
    assert "nothing to dismiss" in err.detail


def test_the_smoke_verb_dispatches_instead_of_shadowing_itself():
    """`self._smoke` (the last report) shadowed `def _smoke` (the verb handler)
    from `__init__` onward, and `dispatch` resolves a verb with
    `getattr(self, "_" + verb)`. So `smoke` -- the operator's "did a Live update
    rename a control?" probe, listed in VERBS and documented -- answered
    `ax-action-failed: TypeError: 'dict' object is not callable` and had never
    run once. Found on the rig 2026-09-15; no test dispatched every verb.
    """
    window, _ = live_tree()
    backend = FakeBackend(window, menubar=menubar("Save Live Set", SAVE_AS))
    helper, _ = make_helper(backend)
    helper._adopt(4242)
    report = helper.dispatch("smoke", {})
    assert set(report) >= {"ok", "missing", "notShowing"}
    # And the snapshot still carries the last report.
    assert helper.status()["smoke"] is report


def test_every_verb_in_the_list_resolves_to_a_handler():
    """The generalisable half: a verb whose handler is shadowed, renamed or
    never written is `ax-action-failed` at dispatch time, not a startup error."""
    window, _ = live_tree()
    helper, _ = make_helper(FakeBackend(window, menubar=menubar(SAVE_AS)))
    for verb in helper.VERBS:
        assert callable(getattr(helper, "_" + verb, None)), f"{verb} has no callable handler"


def test_panel_state_reports_whether_live_has_a_modal_panel_up():
    """Swap audit H3, the bridge's half: `save_as_dialog` succeeds by leaving
    the panel open, so the bridge cannot release `saveAsInFlight` on the reply.
    It polls this."""
    backend, item, field = save_as_backend()  # this tree has the sheet
    helper, _ = make_helper(backend)
    assert helper.dispatch("panel_state", {}) == {"open": True}

    window, _ = live_tree()  # no sheet, no second window
    helper, _ = make_helper(FakeBackend(window, menubar=menubar(SAVE_AS)))
    assert helper.dispatch("panel_state", {}) == {"open": False}


def test_panel_state_ignores_the_fullscreen_ghost_window():
    """Measured live 2026-09-21: with Live in native macOS fullscreen,
    `AXWindows` always carries a second entry -- the pre-fullscreen frame,
    kept alive off-screen -- for as long as Live occupies its own Space.
    It reports `AXSubrole "AXUnknown"` with no title and is never a real
    panel, so it must not trip the group-drag guard. Before this fix, every
    group-drag on a fullscreened Live refused itself as "a panel or menu is
    up" even with nothing open at all."""
    window, _ = live_tree()
    ghost = El("AXWindow", AXSubrole="AXUnknown", title=None)
    backend = FakeBackend(window)
    backend.windows = [window, ghost]
    helper, _ = make_helper(backend)
    assert helper.dispatch("panel_state", {}) == {"open": False}


def test_panel_state_still_catches_a_real_second_window_while_fullscreen():
    """The ghost-window exclusion is narrow: a second window with a real
    title (an actual dialog, alert, or floating panel) must still count as
    a panel up, ghost or no ghost."""
    window, _ = live_tree()
    ghost = El("AXWindow", AXSubrole="AXUnknown", title=None)
    dialog = El("AXWindow", AXSubrole="AXDialog", title="Delete Track?")
    backend = FakeBackend(window)
    backend.windows = [window, ghost, dialog]
    helper, _ = make_helper(backend)
    assert helper.dispatch("panel_state", {}) == {"open": True}


# --- smoke check, tick, trust ----------------------------------------------------

def test_smoke_check_separates_missing_from_not_showing():
    window, refs = live_tree(swap_bar_on=False)
    refs["tap"].attrs["AXIdentifier"] = "Transport.TapTempoRenamed"
    backend = FakeBackend(window, menubar=menubar("Save Live Set", "Save Live Set As...", "Group", "Ungroup"))
    helper, _ = make_helper(backend)
    helper._adopt(4242)
    report = helper.smoke_check()
    assert [m["name"] for m in report["missing"]] == ["transport.tap_tempo"]
    assert "menu.save_as" in report["ok"] and "device.show_swap_bar" in report["ok"]
    assert {"menu.group", "menu.ungroup", "tracks.headers", "track.header"} <= set(report["ok"])
    assert {"kit.swap_next", "pad.lock", "sampler.device", "sampler.swap_next"} <= {
        n["name"] for n in report["notShowing"]}


def test_tick_runs_the_smoke_check_once_per_launch_after_the_window_settles():
    window, _ = live_tree()
    backend = FakeBackend(window, menubar=menubar("Save Live Set As..."))
    helper, clock = make_helper(backend)
    helper.on_start()
    assert backend.prompted and helper.status()["smoke"] is None
    clock.now += SMOKE_SETTLE_S + 0.1
    helper.tick()
    first = helper.status()["smoke"]
    assert first is not None and first["livePid"] == 4242
    clock.now += 10
    helper.tick()
    assert helper.status()["smoke"] is first
    backend.pid = 5000  # Live restarted
    helper.tick()
    clock.now += SMOKE_SETTLE_S + 0.1
    helper.tick()
    assert helper.status()["smoke"]["livePid"] == 5000


def test_untrusted_helper_rechecks_in_a_child_and_asks_to_restart():
    window, _ = live_tree()
    backend = FakeBackend(window, trusted=False)
    answers = [False, True]
    helper, clock = make_helper(backend, probe=lambda: answers.pop(0))
    helper.on_start()
    assert not helper.wants_restart
    clock.now += 1
    helper.tick()  # inside the probe interval: no second probe yet
    assert answers == [True]
    clock.now += 10
    helper.tick()
    assert helper.wants_restart


def test_catalog_is_well_formed():
    for name, target in CATALOG.items():
        assert name == target.name and target.role.startswith("AX")
        assert target.identifier or target.description or target.title
        if "{" in (target.identifier or "") or target.repeated:
            assert target.context, f"{name} depends on what Live shows, so it needs a context"


# --- the socket --------------------------------------------------------------------

@pytest.fixture
def served():
    directory = tempfile.mkdtemp(dir="/tmp")  # AF_UNIX paths are capped at 104 bytes
    path = os.path.join(directory, "ax.sock")
    window, refs = live_tree()
    backend = FakeBackend(window, menubar=menubar("Save Live Set As..."))
    helper, _ = make_helper(backend)
    server = Server(helper, path, tick_s=0.05, max_pending=2)
    server.bind()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield path, refs, server
    server.stop()
    thread.join(timeout=2)
    shutil.rmtree(directory, ignore_errors=True)


def roundtrip(path, *lines):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(5)
        s.connect(path)
        s.sendall(b"".join((l if isinstance(l, bytes) else json.dumps(l).encode()) + b"\n" for l in lines))
        buffer = b""
        while buffer.count(b"\n") < len(lines):
            buffer += s.recv(65536)
    return [json.loads(l) for l in buffer.splitlines()]


def test_socket_status_and_verbs(served):
    path, refs, _ = served
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"
    replies = {r["id"]: r for r in roundtrip(
        path,
        {"id": 1, "verb": "status"},
        {"id": 2, "verb": "press", "args": {"target": "transport.tap_tempo"}},
        b"{not json",
        {"id": 4, "verb": "scroll", "args": {}},
    )}
    # Matched by id, not order: status and malformed lines are answered at
    # once on the reader thread, verbs when the main thread has run them.
    assert replies[1]["ok"] and replies[1]["result"]["trusted"] is True
    assert replies[2]["ok"] and refs["tap"].performed == ["AXPress"] and "queuedMs" in replies[2]
    assert replies[None] == {"id": None, "ok": False, "error": {"code": "ax-bad-request", "detail": "request is not JSON"}}
    assert replies[4]["error"]["code"] == "ax-unknown-verb"


def test_a_second_server_refuses_a_live_socket(served):
    path, _, _ = served
    from looping_ax_helper.server import AlreadyRunning

    with pytest.raises(AlreadyRunning):
        Server(None, path).bind()


def test_stale_socket_file_is_replaced():
    directory = tempfile.mkdtemp(dir="/tmp")
    path = os.path.join(directory, "ax.sock")
    stale = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    stale.bind(path)
    stale.close()  # the file stays, nobody listens
    server = Server(None, path)
    server.bind()
    assert os.path.exists(path)
    server._close()
    assert not os.path.exists(path)
    shutil.rmtree(directory, ignore_errors=True)
