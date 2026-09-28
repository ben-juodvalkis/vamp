"""ViewComponent unit tests — ROW 5 `/looping/v3/view/focus`."""

from __future__ import annotations

import pytest

from components.ViewComponent import (
    V3_ERROR_ADDRESS,
    V3_ERROR_WRITE_REJECTED,
    V3_VIEW_FOCUS_ADDRESS,
    ViewComponent,
)


class _FakeAppView:
    def __init__(self, fail_with=None):
        self._fail_with = fail_with
        self.calls = []

    def focus_view(self, name):
        self.calls.append(name)
        if self._fail_with is not None:
            raise self._fail_with


class _FakeApplication:
    def __init__(self, view):
        self.view = view


@pytest.fixture
def component():
    app_view = _FakeAppView()
    app = _FakeApplication(app_view)
    emits = []

    def emit(addr, args):
        emits.append((addr, args))

    comp = ViewComponent(application=app, emit=emit)
    return comp, app_view, emits


def test_valid_name_calls_lom(component):
    comp, view, emits = component
    comp.handle_focus(args=("Detail/Clip",), source_addr=None)
    assert view.calls == ["Detail/Clip"]
    assert emits == []


@pytest.mark.parametrize(
    "name",
    ["Browser", "Arranger", "Session", "Detail", "Detail/Clip", "Detail/DeviceChain"],
)
def test_all_six_valid_names_accepted(component, name):
    comp, view, _emits = component
    comp.handle_focus(args=(name,), source_addr=None)
    assert view.calls == [name]


def test_unknown_name_emits_write_rejected(component):
    comp, view, emits = component
    comp.handle_focus(args=("Nope",), source_addr=None)
    assert view.calls == []
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, path, detail = payload
    assert originating == V3_VIEW_FOCUS_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == ""
    assert "unknown-view" in detail


def test_wrong_arg_count_emits_write_rejected(component):
    comp, view, emits = component
    comp.handle_focus(args=(), source_addr=None)
    comp.handle_focus(args=("Session", "extra"), source_addr=None)
    assert view.calls == []
    assert len(emits) == 2
    for _addr, payload in emits:
        _, code, _, detail = payload
        assert code == V3_ERROR_WRITE_REJECTED
        assert "arg-count" in detail


def test_lom_runtime_error_is_typed(component):
    app_view = _FakeAppView(fail_with=RuntimeError("boom"))
    app = _FakeApplication(app_view)
    emits = []
    comp = ViewComponent(application=app, emit=lambda a, b: emits.append((a, b)))
    comp.handle_focus(args=("Session",), source_addr=None)
    assert app_view.calls == ["Session"]
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, _path, detail = payload
    assert originating == V3_VIEW_FOCUS_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert "focus_view raised" in detail
    assert "RuntimeError" in detail


def test_bytes_arg_decoded(component):
    comp, view, _emits = component
    comp.handle_focus(args=("Session".encode("utf-8"),), source_addr=None)
    assert view.calls == ["Session"]


def test_disconnect_is_idempotent_and_short_circuits(component):
    comp, view, emits = component
    comp.disconnect()
    comp.disconnect()
    comp.handle_focus(args=("Session",), source_addr=None)
    assert view.calls == []
    assert emits == []


def test_wire_address_is_v3_prefix():
    assert V3_VIEW_FOCUS_ADDRESS == "/looping/v3/view/focus"
