"""DebugComponent unit tests — protocol-version handshake."""

from __future__ import annotations

import pytest

from components.DebugComponent import (
    DebugComponent,
    PROTOCOL_VERSION,
    PROTOCOL_VERSION_ADDRESS,
    REGISTRY_PROBE_RESOLVE_ADDRESS,
    REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS,
)


@pytest.fixture
def component():
    emits = []

    def emit(addr, args):
        emits.append((addr, args))

    return DebugComponent(emit=emit), emits


def test_handle_version_emits_semver(component):
    comp, emits = component
    comp.handle_version(args=(), source_addr=None)
    assert emits == [(PROTOCOL_VERSION_ADDRESS, (PROTOCOL_VERSION,))]


def test_handle_version_ignores_payload(component):
    comp, emits = component
    comp.handle_version(args=(1, "foo"), source_addr=("127.0.0.1", 9999))
    assert len(emits) == 1
    assert emits[0] == (PROTOCOL_VERSION_ADDRESS, (PROTOCOL_VERSION,))


def test_handle_version_returns_none(component):
    """Fire-and-forget shape — handler emits directly, never returns a tuple."""
    comp, _emits = component
    assert comp.handle_version(args=(), source_addr=None) is None


def test_disconnect_idempotent(component):
    comp, emits = component
    comp.disconnect()
    comp.disconnect()
    assert emits == []


def test_protocol_version_is_3_9_0():
    """Must track ``SurfaceHelloComponent.PROTOCOL_VERSION`` and the
    highest entry in ``HandshakeComponent.SUPPORTED_VERSIONS``."""
    assert PROTOCOL_VERSION == "3.12.0"

    # 3.5.0 (2026-08-31): client-declared ETag — an ``etag:0x...`` token
    # in hello / resync, answered with ``state/full/unchanged`` when the
    # client already holds the current tree. Record arities untouched.
    #
    # 3.6.0 (2026-08-31): ``state/full`` collapsed from
    # ``begin -> chunk... -> end`` to one ``state/full/tree``. Record
    # arities are untouched, but the *addresses* changed, so a
    # pre-3.6.0 UI is listening on three channels that carry nothing.
    #
    # 3.7.0 (2026-08-31): T-record arity 13 -> 14, adding ``role`` —
    # the rail an instrument was loaded from, persisted in Live's
    # per-track key-value store. An arity change, so surface and UI
    # ship together.


def test_protocol_version_address_matches_wire_contract():
    assert PROTOCOL_VERSION_ADDRESS == "/looping/protocol/version"


# --- 05a PR-1: /looping/v2/registry/probe_resolve ------------------------
#
# These tests pin the wire shape of the F1 verification probe. The probe
# exists so live F1 behaviour (lazy rebuild on miss, with _rebuilding
# guard) can be driven in isolation from the UI — see 05a-gate-5b-
# canonical-tree.md for why UI-driven verification is too coupled.


class _FakeRegistry:
    """Counter-driven stub for HandleRegistry.

    Starts with configurable stored counts, grows them on
    ``resolve_device`` to mimic a rebuild, and reports a hit/miss
    based on ``known_ids``. Enough surface to exercise the probe
    handler without importing the real registry.
    """

    def __init__(self, stored=(0, 0, 0), after_rebuild=None, known_ids=()):
        self.track_count, self.device_count, self.param_count = stored
        self._after = after_rebuild
        self._known = set(known_ids)
        self.resolve_calls = []

    def resolve_device(self, device_id):
        self.resolve_calls.append(device_id)
        if self._after is not None:
            self.track_count, self.device_count, self.param_count = self._after
        return ("track", "device", 0) if device_id in self._known else None


def _make_component(registry):
    emits = []

    def emit(addr, args):
        emits.append((addr, args))

    return DebugComponent(emit=emit, registry=registry), emits


def test_probe_resolve_f1_self_healed_path():
    """Cold registry → F1 fires → id resolves. The happy path."""
    reg = _FakeRegistry(
        stored=(1, 0, 0),
        after_rebuild=(3, 4, 232),
        known_ids={76890},
    )
    comp, emits = _make_component(reg)
    comp.handle_registry_probe_resolve(args=(76890,), source_addr=None)
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS
    # (found, was_rebuild, before_t, before_d, before_p, after_t, after_d, after_p)
    assert args == (1, 1, 1, 0, 0, 3, 4, 232)


def test_probe_resolve_already_warm_path():
    """Warm cache → resolve hits, counts unchanged, was_rebuild=0."""
    reg = _FakeRegistry(
        stored=(3, 4, 232),
        after_rebuild=None,  # resolve_device doesn't touch counts
        known_ids={76890},
    )
    comp, emits = _make_component(reg)
    comp.handle_registry_probe_resolve(args=(76890,), source_addr=None)
    assert emits[0][1] == (1, 0, 3, 4, 232, 3, 4, 232)


def test_probe_resolve_unknown_id():
    """Unknown id → found=0; was_rebuild may still be 1 because F1 tried."""
    reg = _FakeRegistry(
        stored=(1, 0, 0),
        after_rebuild=(3, 4, 232),
        known_ids=set(),
    )
    comp, emits = _make_component(reg)
    comp.handle_registry_probe_resolve(args=(99999,), source_addr=None)
    found, was_rebuild, *_ = emits[0][1]
    assert found == 0
    assert was_rebuild == 1  # counts changed → F1 ran even though id missed


def test_probe_resolve_registry_absent_emits_sentinel():
    comp, emits = _make_component(registry=None)
    comp.handle_registry_probe_resolve(args=(76890,), source_addr=None)
    assert emits == [(REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS,
                      (-1, -1, -1, -1, -1, -1, -1, -1))]


def test_probe_resolve_missing_arg_emits_sentinel():
    reg = _FakeRegistry()
    comp, emits = _make_component(reg)
    comp.handle_registry_probe_resolve(args=(), source_addr=None)
    assert emits == [(REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS,
                      (-1, -1, -1, -1, -1, -1, -1, -1))]
    assert reg.resolve_calls == []  # never touched the registry


def test_probe_resolve_non_int_arg_emits_sentinel():
    reg = _FakeRegistry()
    comp, emits = _make_component(reg)
    comp.handle_registry_probe_resolve(args=("not-an-int",), source_addr=None)
    assert emits == [(REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS,
                      (-1, -1, -1, -1, -1, -1, -1, -1))]
    assert reg.resolve_calls == []


def test_probe_resolve_returns_none():
    """Fire-and-forget shape, same as handle_version."""
    reg = _FakeRegistry(known_ids={1})
    comp, _ = _make_component(reg)
    assert comp.handle_registry_probe_resolve(args=(1,), source_addr=None) is None


def test_probe_resolve_address_matches_wire_contract():
    assert REGISTRY_PROBE_RESOLVE_ADDRESS == "/looping/v2/registry/probe_resolve"
    assert REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS == \
        "/looping/v2/registry/probe_resolve_reply"


# --- /looping/probe/lom_invoke — positional args --------------------------
#
# The probe called methods with no arguments until 2026-08-31, which put
# the whole `Track.get_data(key, default)` / `Track.set_data(key, value)`
# family out of reach — and their arguments are the entire point of them.
# `args_json` is an optional 4th wire arg carrying a JSON array.


class _DataStoreTrack:
    """Stands in for a LOM Track with the 12.4 key-value store.

    Mirrors the real signatures read off Live's Boost.Python
    `ArgumentError`: `set_data(key, value)`, `get_data(key, default)` —
    note the default is **mandatory** there, so it is here too.
    """

    def __init__(self):
        self.store = {}
        self.calls = []

    def set_data(self, key, value):
        self.calls.append(("set_data", key, value))
        self.store[key] = value

    def get_data(self, key, default_value):
        self.calls.append(("get_data", key, default_value))
        return self.store.get(key, default_value)

    def niladic(self):
        self.calls.append(("niladic",))
        return "no-args-ok"


def _invoke_component(target):
    """DebugComponent whose path resolution always yields ``target``."""
    comp, emits = _make_component(_FakeRegistry())
    comp._resolve_introspect_path = lambda path: (target, None)
    return comp, emits


def _invoke(comp, *args):
    import json
    (blob,) = comp.handle_lom_invoke(args=args, source_addr=None)
    return json.loads(blob)


def test_lom_invoke_passes_positional_args():
    track = _DataStoreTrack()
    comp, _ = _invoke_component(track)
    r = _invoke(comp, "tracks/0", "set_data", "", '["looping.role", "drum"]')
    assert r["invoke_error"] is None
    assert track.calls == [("set_data", "looping.role", "drum")]
    assert track.store == {"looping.role": "drum"}


def test_lom_invoke_reports_the_return_value():
    """A getter changes nothing observable — the return IS the result."""
    track = _DataStoreTrack()
    track.store["looping.role"] = "perc"
    comp, _ = _invoke_component(track)
    r = _invoke(comp, "tracks/0", "get_data", "", '["looping.role", "MISSING"]')
    assert r["invoke_error"] is None
    assert r["returned"] == repr("perc")


def test_lom_invoke_preserves_json_arg_types():
    """`set_data` takes a `boost::python::api::object`, so "which types
    does it accept" is exactly what the probe is for. Flattening
    everything to strings on the wire would answer a different
    question."""
    track = _DataStoreTrack()
    comp, _ = _invoke_component(track)
    _invoke(comp, "tracks/0", "set_data", "", '["k", 7]')
    _invoke(comp, "tracks/0", "set_data", "", '["k2", 1.5]')
    _invoke(comp, "tracks/0", "set_data", "", '["k3", {"a": [1, 2]}]')
    assert track.store == {"k": 7, "k2": 1.5, "k3": {"a": [1, 2]}}
    assert isinstance(track.store["k"], int)
    assert isinstance(track.store["k2"], float)


def test_lom_invoke_without_args_json_is_a_niladic_call():
    """Every existing driver sends three args — they must keep working."""
    track = _DataStoreTrack()
    comp, _ = _invoke_component(track)
    r = _invoke(comp, "tracks/0", "niladic", "")
    assert r["invoke_error"] is None
    assert track.calls == [("niladic",)]
    assert r["returned"] == repr("no-args-ok")


def test_lom_invoke_empty_args_json_is_a_niladic_call():
    track = _DataStoreTrack()
    comp, _ = _invoke_component(track)
    _invoke(comp, "tracks/0", "niladic", "", "")
    assert track.calls == [("niladic",)]


def test_lom_invoke_rejects_malformed_args_json_without_calling():
    """A typo in the driver must not fire a DESTRUCTIVE call anyway."""
    track = _DataStoreTrack()
    comp, _ = _invoke_component(track)
    r = _invoke(comp, "tracks/0", "set_data", "", "{not json")
    assert "not JSON" in r["invoke_error"]
    assert track.calls == []


def test_lom_invoke_rejects_non_array_args_json_without_calling():
    track = _DataStoreTrack()
    comp, _ = _invoke_component(track)
    r = _invoke(comp, "tracks/0", "set_data", "", '"looping.role"')
    assert "must be a JSON array" in r["invoke_error"]
    assert track.calls == []


def test_lom_invoke_arity_mismatch_is_reported_not_raised():
    """Calling with the wrong arity is how the signature gets read out
    of Live in the first place — it must come back as a payload."""
    track = _DataStoreTrack()
    comp, _ = _invoke_component(track)
    r = _invoke(comp, "tracks/0", "set_data", "", "[]")
    assert r["invoke_error"].startswith("TypeError")
    assert track.calls == []


# --- probe v2: chain grammar, lom_set, song_time_probe (issue #489) ---------

from components.DebugComponent import (  # noqa: E402
    LOM_SET_ADDRESS,
    SONG_TIME_PROBE_ADDRESS,
    _walk_chain,
    _walk_parent,
)


class _Param:
    def __init__(self, name, value, enabled=True):
        self.name = name
        self.value = value
        self.is_enabled = enabled


class _Cell:
    def __init__(self):
        self.class_name = "DrumCell"
        self.parameters = [_Param("Device On", 1.0), _Param("Transpose", 0.0)]


class _Chain:
    def __init__(self):
        self.name = "606 Kick"
        self.devices = [_Cell()]


class _Pad:
    def __init__(self, note):
        self.note = note
        self.chains = [_Chain()] if note % 2 == 0 else []


class _View:
    def __init__(self, pads):
        self.selected_drum_pad = pads[36]


class _Rack:
    def __init__(self):
        self.drum_pads = [_Pad(n) for n in range(128)]
        self.view = _View(self.drum_pads)


class _UndoSong:
    def __init__(self):
        self.calls = []
        self.current_song_time = 0.0
        self._cb = None

    def begin_undo_step(self):
        self.calls.append("begin")

    def end_undo_step(self):
        self.calls.append("end")

    def add_current_song_time_listener(self, cb):
        self._cb = cb

    def remove_current_song_time_listener(self, cb):
        assert cb is self._cb
        self._cb = None


def test_walk_chain_indexes_and_maps():
    rack = _Rack()
    assert _walk_chain(rack, "drum_pads[36].chains[0].devices[0].parameters[1].value") == 0.0
    assert _walk_chain(rack, "drum_pads[36].chains[0].devices[0].parameters.*name") == [
        "Device On", "Transpose",
    ]
    assert _walk_chain(rack, "view.selected_drum_pad.note") == 36
    parent, attr = _walk_parent(rack, "view.selected_drum_pad")
    assert parent is rack.view and attr == "selected_drum_pad"
    with pytest.raises(ValueError):
        _walk_chain(rack, "drum_pads[x]")
    with pytest.raises(IndexError):
        _walk_chain(rack, "drum_pads[36].chains[0].devices[5]")


def _set_component(target, song):
    comp, emits = _make_component(_FakeRegistry())
    comp._registry._song = song
    comp._resolve_introspect_path = lambda path: (target, None)
    return comp


def test_lom_set_writes_reports_and_groups_undo():
    import json
    rack = _Rack()
    song = _UndoSong()
    comp = _set_component(rack, song)
    sets = [
        ["drum_pads[36].chains[0].devices[0].parameters[1].value", 12.0],
        ["view.selected_drum_pad", {"$ref": "drum_pads[38]"}],
        ["drum_pads[37].chains[0].devices[0].parameters[1].value", 1.0],  # empty pad: error, not raise
    ]
    (blob,) = comp.handle_lom_set(
        args=("tracks/1/devices/0", json.dumps(sets), 1), source_addr=None,
    )
    r = json.loads(blob)
    assert r["resolve_error"] is None and r["undo_group"] == 1
    assert song.calls == ["begin", "end"]
    w = r["writes"]
    assert w[0]["changed"] == 1 and w[0]["after"] == "12.0" and w[0]["error"] == ""
    assert rack.drum_pads[36].chains[0].devices[0].parameters[1].value == 12.0
    assert rack.view.selected_drum_pad is rack.drum_pads[38] and w[1]["changed"] == 1
    assert w[2]["error"].startswith("IndexError")
    assert isinstance(r["total_us"], int)


def test_lom_set_rejects_bad_json_without_writing():
    import json
    rack = _Rack()
    comp = _set_component(rack, _UndoSong())
    (blob,) = comp.handle_lom_set(args=("tracks/1/devices/0", "{not json", 0), source_addr=None)
    r = json.loads(blob)
    assert r["resolve_error"].startswith("sets_json")
    assert rack.drum_pads[36].chains[0].devices[0].parameters[1].value == 0.0


def test_song_time_probe_start_stats_stop():
    import json
    song = _UndoSong()
    comp = _set_component(_Rack(), song)
    (blob,) = comp.handle_song_time_probe(args=("start",), source_addr=None)
    assert json.loads(blob)["started"] == 1 and song._cb is not None
    for beat in (0.0, 0.25, 0.5):
        song.current_song_time = beat
        song._cb()
    r = json.loads(comp.handle_song_time_probe(args=("stats",), source_addr=None)[0])
    assert r["count"] == 3 and r["running"] == 1
    assert r["beat_delta"]["mean"] == 0.25 and "interval_ms" in r
    comp.handle_song_time_probe(args=("stop",), source_addr=None)
    assert song._cb is None
    # disconnect after stop is idempotent
    comp.disconnect()


def test_probe_addresses_are_wire_constants():
    assert LOM_SET_ADDRESS == "/looping/probe/lom_set"
    assert SONG_TIME_PROBE_ADDRESS == "/looping/probe/song_time_probe"


# --- lom_invoke expands a returned vector (ADR-429 rig checks) -------------------


def test_lom_invoke_expands_a_returned_note_vector():
    from components.DebugComponent import _expand_items

    class Note:
        def __init__(self, i, p):
            self.note_id, self.pitch, self.start_time = i, p, 0.5
            self.duration, self.velocity, self.mute, self.probability = 0.25, 100.0, False, 0.3

    items = _expand_items([Note(1, 60), Note(2, 64)])
    assert items[0] == {"note_id": 1, "pitch": 60, "start_time": 0.5, "duration": 0.25, "velocity": 100.0, "mute": False, "probability": 0.3}
    assert items[1]["pitch"] == 64
    assert _expand_items((1, 2, 3)) == [1, 2, 3]
    assert _expand_items(None) is None and _expand_items("abc") is None and _expand_items(5) is None
    assert len(_expand_items(range(1000))) == 257
    assert _expand_items([object()])[0].startswith("<object")


# --- py_introspect + the `app` root (Step 0c: is it exposed in Python?) ----------
#
# lom_introspect resolves song / track / device / clip paths only, so the
# Browser, Live.Browser.FilterType and the device classes were out of reach.


class _BoostEnum(int):
    """Stands in for a Boost.Python enum: class-level ``names`` / ``values``."""


def _fake_live(monkeypatch):
    import sys
    import types

    live = types.ModuleType("Live")
    browser_mod = types.ModuleType("Live.Browser")

    class FilterType:
        """Filter types."""

    members = {"hotswap_off": 0, "instrument_hotswap": 1, "drum_pad_hotswap": 4}
    FilterType.names = {k: _BoostEnum(v) for k, v in members.items()}
    FilterType.values = {v: FilterType.names[k] for k, v in members.items()}
    browser_mod.FilterType = FilterType

    class Browser:
        """This class represents the live browser data base."""
        filter_type = 1

        def load_item(self, item):
            return None

    class App:
        browser = Browser()

    live.Application = types.SimpleNamespace(get_application=lambda: App())
    live.Browser = browser_mod
    monkeypatch.setitem(sys.modules, "Live", live)
    monkeypatch.setitem(sys.modules, "Live.Browser", browser_mod)
    return live


def _py(comp, *args):
    import json
    (blob,) = comp.handle_py_introspect(args=args, source_addr=None)
    assert len(blob.encode("utf-8")) <= 8000
    return json.loads(blob)


def test_py_introspect_reports_enum_values(monkeypatch):
    _fake_live(monkeypatch)
    comp, _ = _make_component(_FakeRegistry())
    reply = _py(comp, "Live.Browser", "FilterType", "")
    assert reply["error"] is None
    assert reply["enum"] == {"hotswap_off": 0, "instrument_hotswap": 1, "drum_pad_hotswap": 4}
    assert reply["doc"] == "Filter types."


def test_py_introspect_app_root_dirs_the_live_browser_instance(monkeypatch):
    _fake_live(monkeypatch)
    comp, _ = _make_component(_FakeRegistry())
    reply = _py(comp, "app", "browser", "")
    assert reply["error"] is None
    assert "load_item" in reply["dir"] and "filter_type" in reply["dir"]
    assert not any(n.startswith("__") for n in reply["dir"])
    assert reply["dir_total"] == len(reply["dir"]) and reply["truncated"] == 0
    assert reply["enum"] is None
    filtered = _py(comp, "app", "browser", "(?i)^LOAD")
    assert filtered["dir"] == ["load_item"]


def test_py_introspect_failures_are_reported_not_raised(monkeypatch):
    _fake_live(monkeypatch)
    comp, _ = _make_component(_FakeRegistry())
    assert _py(comp)["error"] == "no module"
    assert _py(comp, "Live.NoSuchModule", "", "")["error"].startswith("import Live.NoSuchModule")
    assert _py(comp, "Live.Browser", "Nope", "")["error"].startswith("chain: AttributeError")
    assert _py(comp, "Live.Browser", "", "(")["error"].startswith("bad regex")


def test_py_introspect_trims_the_reply_to_a_datagram(monkeypatch):
    import sys
    import types

    big = types.ModuleType("big_probe_mod")
    for i in range(2000):
        setattr(big, "attribute_with_a_long_name_%04d" % i, i)
    monkeypatch.setitem(sys.modules, "big_probe_mod", big)
    comp, _ = _make_component(_FakeRegistry())
    reply = _py(comp, "big_probe_mod", "", "")
    assert reply["truncated"] == 1
    assert reply["dir_total"] == 2000 and 0 < len(reply["dir"]) < 2000


def test_lom_introspect_app_root_reaches_the_browser(monkeypatch):
    _fake_live(monkeypatch)

    class _Reg(_FakeRegistry):
        _song = object()

    comp, _ = _make_component(_Reg())
    import json
    (blob,) = comp.handle_lom_introspect(args=("app", "browser.filter_type", ""), source_addr=None)
    reply = json.loads(blob)
    assert reply["resolve_error"] is None
    assert reply["attrs"][0]["exists"] == 1 and reply["attrs"][0]["value_repr"] == "1"


def test_app_root_without_live_is_a_resolve_error(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "Live", None)

    class _Reg(_FakeRegistry):
        _song = object()

    comp, _ = _make_component(_Reg())
    import json
    (blob,) = comp.handle_lom_introspect(args=("app", "browser", ""), source_addr=None)
    assert json.loads(blob)["resolve_error"].startswith("app: ")


def test_py_introspect_address_is_a_wire_constant():
    from components.DebugComponent import PY_INTROSPECT_ADDRESS
    assert PY_INTROSPECT_ADDRESS == "/looping/probe/py_introspect"
