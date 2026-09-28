"""device_property_loader unit tests — 05a PR-4.

Covers the small JSON-walking helper that produces the
``{class_name: [property_path, …]}`` map fed into
``StateFullComponent``. Real ``data/device-configs.json`` is loaded
via the live walk; failure modes are exercised with monkeypatched
paths.
"""

from __future__ import annotations

import json
import logging
import os

import pytest

from device_property_loader import (
    _find_device_configs_path,
    load_property_paths_by_class,
)


def test_find_device_configs_path_resolves_to_repo():
    """The walk-up locates the real ``data/device-configs.json``."""
    path = _find_device_configs_path()
    assert path is not None
    assert path.endswith(os.path.join("data", "device-configs.json"))
    assert os.path.isfile(path)


def test_load_real_configs_yields_known_classes():
    """Sanity check the live load: a few well-known classes appear."""
    paths_by_class = load_property_paths_by_class()
    # The exact set drifts as configs evolve — assert on a few stable
    # class names we know carry properties today (per data/device-configs.json
    # at the time of writing).
    assert isinstance(paths_by_class, dict)
    # At least one of these is in the real configs.
    known = {"Compressor2", "Simpler", "Sampler"}
    overlap = known & set(paths_by_class.keys())
    assert overlap, (
        f"expected at least one of {known} to have configured properties; "
        f"got classes: {sorted(paths_by_class.keys())}"
    )
    for cls, paths in paths_by_class.items():
        assert isinstance(paths, list)
        assert all(isinstance(p, str) for p in paths)
        assert paths, f"class {cls} listed with empty paths — should be skipped"


def test_load_returns_empty_on_missing_file(monkeypatch, caplog):
    """A missing configs file degrades to empty dict + ERROR log."""
    monkeypatch.setattr(
        "device_property_loader._find_device_configs_path",
        lambda: None,
    )
    with caplog.at_level(logging.ERROR, logger="looping"):
        result = load_property_paths_by_class()
    assert result == {}
    assert any(
        "device-configs.json not found" in r.getMessage()
        for r in caplog.records
    )


def test_load_returns_empty_on_malformed_json(monkeypatch, tmp_path, caplog):
    """A malformed JSON file degrades to empty dict + ERROR log."""
    bad = tmp_path / "device-configs.json"
    bad.write_text("not valid json {{{")
    monkeypatch.setattr(
        "device_property_loader._find_device_configs_path",
        lambda: str(bad),
    )
    with caplog.at_level(logging.ERROR, logger="looping"):
        result = load_property_paths_by_class()
    assert result == {}
    assert any("failed to load" in r.getMessage() for r in caplog.records)


def test_load_returns_empty_on_non_object_top_level(monkeypatch, tmp_path, caplog):
    """JSON that isn't a top-level object (e.g. an array) returns empty."""
    arr = tmp_path / "device-configs.json"
    arr.write_text(json.dumps(["not", "an", "object"]))
    monkeypatch.setattr(
        "device_property_loader._find_device_configs_path",
        lambda: str(arr),
    )
    with caplog.at_level(logging.ERROR, logger="looping"):
        result = load_property_paths_by_class()
    assert result == {}
    assert any("isn't a top-level object" in r.getMessage() for r in caplog.records)


def test_skip_classes_without_properties(monkeypatch, tmp_path):
    """Classes whose config lacks a populated ``properties`` block are skipped."""
    configs = {
        "ClassA": {"parameters": {"0": {}}},  # no properties
        "ClassB": {"properties": {}},          # empty properties
        "ClassC": {"properties": {"foo": {"type": "object"}}},
    }
    f = tmp_path / "device-configs.json"
    f.write_text(json.dumps(configs))
    monkeypatch.setattr(
        "device_property_loader._find_device_configs_path",
        lambda: str(f),
    )
    result = load_property_paths_by_class()
    assert "ClassA" not in result
    assert "ClassB" not in result
    assert result == {"ClassC": ["foo"]}


def test_property_path_order_preserved_from_json(monkeypatch, tmp_path):
    """JSON insertion order of property keys is preserved on the wire.

    The state/full publisher walks paths in order; tests that depend
    on a specific wire order need this guarantee.
    """
    configs = {
        "OrderedDev": {
            "properties": {
                "third": {"type": "object"},
                "first": {"type": "object"},
                "second": {"type": "object"},
            },
        },
    }
    f = tmp_path / "device-configs.json"
    f.write_text(json.dumps(configs))
    monkeypatch.setattr(
        "device_property_loader._find_device_configs_path",
        lambda: str(f),
    )
    result = load_property_paths_by_class()
    assert result == {"OrderedDev": ["third", "first", "second"]}
