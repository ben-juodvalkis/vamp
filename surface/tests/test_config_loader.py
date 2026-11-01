"""config_loader tests.

Three behaviours worth pinning:

1. The happy path — finding ``config/constants.json`` at the
   repo-root above this file and reading ``osc.pythonSurface``.
2. The missing-file fallback — ``_find_constants_path`` returning
   ``None`` yields the hardcoded defaults without crashing.
3. The missing-key fallback — a ``constants.json`` that loads but
   lacks ``osc.pythonSurface`` still produces a usable config.

The actual repo-root ``config/constants.json`` is what the happy-path
test exercises. No isolation; if that file drifts from expectation,
this test fails loudly, which is the right signal.
"""

import logging

from config_loader import _FALLBACK, load


def test_load_finds_real_constants_json(caplog):
    # This test runs against the repo's real constants.json. A failure
    # here means either (a) pythonSurface got removed from constants,
    # or (b) the _find_constants_path walker stopped working. Both are
    # bugs worth failing on.
    caplog.set_level(logging.INFO, logger="looping")
    data = load()
    assert "osc" in data
    assert "pythonSurface" in data["osc"]
    assert "localPort" in data["osc"]["pythonSurface"]
    assert "remotePort" in data["osc"]["pythonSurface"]


def test_fallback_values_are_gate_1_ports():
    # The hardcoded fallback must match the Gate 1 spec under the
    # bridge-centric naming convention: ``localPort`` = bridge bind
    # (11021), ``remotePort`` = surface bind (11020). A drift here
    # is survivable (loud ERROR log) but tests pin it anyway.
    assert _FALLBACK["pythonSurface"]["localPort"] == 11021
    assert _FALLBACK["pythonSurface"]["remotePort"] == 11020
    assert _FALLBACK["pythonSurface"]["host"] == "127.0.0.1"


def test_load_missing_constants_returns_fallback(monkeypatch, caplog):
    # Force _find_constants_path to return None, simulating a broken
    # install where the symlink no longer resolves to the repo.
    import config_loader

    caplog.set_level(logging.ERROR, logger="looping")
    monkeypatch.setattr(config_loader, "_find_constants_path", lambda: None)
    data = config_loader.load()

    assert data == {"osc": _FALLBACK}
    # Must have logged at ERROR level so the operator notices.
    assert any(
        "constants.json not found" in record.message
        for record in caplog.records
    )


def test_load_constants_missing_python_surface_section(tmp_path, monkeypatch, caplog):
    # constants.json exists and parses, but has no osc.pythonSurface.
    # Should fall back without crashing and log at ERROR.
    import config_loader
    import json

    fake_constants = tmp_path / "constants.json"
    fake_constants.write_text(json.dumps({"osc": {"abletonOSC": {}}}))
    monkeypatch.setattr(
        config_loader, "_find_constants_path", lambda: str(fake_constants)
    )

    caplog.set_level(logging.ERROR, logger="looping")
    data = config_loader.load()

    assert data["osc"]["pythonSurface"] == _FALLBACK["pythonSurface"]
    assert any(
        "no osc.pythonSurface" in record.message
        for record in caplog.records
    )


def test_local_file_is_laid_over_the_tracked_one(tmp_path, monkeypatch):
    # The owner's rig is the tracked defaults plus constants.local.json
    # (general-release plan.md §3). Objects merge key by key; a value
    # replaces; what the local file leaves out stays.
    import config_loader
    import json

    (tmp_path / "constants.json").write_text(json.dumps({
        "features": {"totalmix": False, "expressionPedal": False},
        "audio": {"defaultInputChannel": "1/2", "description": "d"},
        "osc": {"pythonSurface": {"localPort": 11021, "remotePort": 11020}},
    }))
    (tmp_path / "constants.local.json").write_text(json.dumps({
        "features": {"expressionPedal": True},
        "audio": {"defaultInputChannel": "11/12 Guitar Mic"},
        "midiPedals": {"channel": 10},
    }))
    monkeypatch.setattr(
        config_loader, "_find_constants_path",
        lambda: str(tmp_path / "constants.json"),
    )

    data = config_loader.load()

    assert data["features"] == {"totalmix": False, "expressionPedal": True}
    assert data["audio"] == {"defaultInputChannel": "11/12 Guitar Mic", "description": "d"}
    assert data["midiPedals"] == {"channel": 10}
    assert data["osc"]["pythonSurface"]["localPort"] == 11021


def test_unreadable_local_file_leaves_the_tracked_defaults(tmp_path, monkeypatch, caplog):
    import config_loader
    import json

    (tmp_path / "constants.json").write_text(json.dumps({
        "features": {"totalmix": False},
        "osc": {"pythonSurface": {"localPort": 11021, "remotePort": 11020}},
    }))
    (tmp_path / "constants.local.json").write_text("{ not json")
    monkeypatch.setattr(
        config_loader, "_find_constants_path",
        lambda: str(tmp_path / "constants.json"),
    )

    caplog.set_level(logging.ERROR, logger="looping")
    data = config_loader.load()

    assert data["features"] == {"totalmix": False}
    assert any("constants.local.json" in r.message for r in caplog.records)


def test_merge_replaces_lists_and_leaves_its_arguments_alone():
    from config_loader import merge

    base = {"a": {"list": [1, 2], "keep": 1}}
    local = {"a": {"list": [3]}}
    assert merge(base, local) == {"a": {"list": [3], "keep": 1}}
    assert base == {"a": {"list": [1, 2], "keep": 1}}
    assert local == {"a": {"list": [3]}}


def test_feature_on_needs_an_explicit_true(caplog):
    from config_loader import feature_on

    caplog.set_level(logging.WARNING, logger="looping")
    assert feature_on({"features": {"expressionPedal": True}}, "expressionPedal")
    assert not feature_on({"features": {"expressionPedal": False}}, "expressionPedal")
    assert not feature_on({"features": {}}, "expressionPedal")
    assert not feature_on({}, "expressionPedal")
    assert not feature_on({"features": ["expressionPedal"]}, "expressionPedal")
    assert not feature_on(None, "expressionPedal")
    assert not caplog.records
    # A non-boolean is off, and says so rather than failing silently.
    assert not feature_on({"features": {"expressionPedal": "yes"}}, "expressionPedal")
    assert "expressionPedal" in caplog.text


def test_installed_surface_reads_its_folders_from_vamp_paths(tmp_path, monkeypatch):
    # installer.plan.md Phase 1: a copied (not symlinked) surface finds the
    # app, data and devices folders in vamp-paths.json beside it.
    import json
    import os

    import config_loader
    from components import live_library
    from components.SessionSettingsComponent import _find_repo_logs_path

    app = tmp_path / "app"
    (app / "config").mkdir(parents=True)
    (app / "config" / "constants.json").write_text(json.dumps({"osc": {"pythonSurface": {"localPort": 1, "remotePort": 2}}}))
    data = tmp_path / "data"
    (data / "config").mkdir(parents=True)
    (data / "config" / "constants.local.json").write_text(json.dumps({"osc": {"pythonSurface": {"localPort": 7}}}))
    paths = {"app": str(app), "data": str(data), "devices": str(tmp_path / "Devices")}
    monkeypatch.setattr(config_loader, "vamp_paths", lambda: paths)

    loaded = load()["osc"]["pythonSurface"]
    assert (loaded["localPort"], loaded["remotePort"]) == (7, 2)
    assert _find_repo_logs_path("foot-switch.json") == os.path.join(str(data), "logs", "foot-switch.json")
    assert live_library.m4l_devices_root() == str(tmp_path / "Devices")


def test_a_checkout_has_no_vamp_paths():
    import config_loader

    assert config_loader.vamp_paths() == {}
    assert config_loader.data_path("logs", "x.json") is None
