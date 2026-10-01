"""Reload without restarting Live: ``/looping/probe/reload_on_reselect``.

The probe arms ``surface/__init__.py``'s flag; the next ``create_instance``
(Live calls it on a re-select in Settings, or File > Open) drops the
package's submodules first, so the new instance imports the edited files.
The package tests run a copy of the real ``__init__.py`` over a stand-in
``LoopingSurface`` module: everything but Live.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

import pytest

from components.DebugComponent import DebugComponent, RELOAD_ON_RESELECT_ADDRESS

SURFACE_INIT = Path(__file__).resolve().parents[1] / "__init__.py"


# --- the probe ----------------------------------------------------------------


def test_probe_arms_and_reports_loaded_modules():
    emits, calls = [], []

    def request_reload():
        calls.append(1)
        return 42

    comp = DebugComponent(emit=lambda a, args: emits.append((a, args)), request_reload=request_reload)
    assert comp.handle_reload_on_reselect(args=(), source_addr=None) is None
    assert calls == [1]
    [(addr, (payload,))] = emits
    assert addr == RELOAD_ON_RESELECT_ADDRESS
    assert json.loads(payload) == {"armed": True, "loaded": 42}


def test_probe_without_the_hook_says_not_armed():
    emits = []
    DebugComponent(emit=lambda a, args: emits.append((a, args))).handle_reload_on_reselect((), None)
    [(_addr, (payload,))] = emits
    assert json.loads(payload)["armed"] is False


# --- the package's purge ------------------------------------------------------


@pytest.fixture
def package(tmp_path):
    """A package built from the real ``__init__.py`` and a stand-in surface."""
    name = "vamp_reload_test"
    root = tmp_path / name
    root.mkdir()
    shutil.copy(SURFACE_INIT, root / "__init__.py")
    surface_file = root / "LoopingSurface.py"

    def write_surface(version):
        surface_file.write_text(
            "class LoopingSurface:\n"
            f"    VERSION = {version}\n"
            "    def __init__(self, c_instance):\n"
            "        self.c_instance = c_instance\n"
        )
        # Python reuses a cached .pyc while the source's mtime (whole
        # seconds) and size match, and these rewrites land within one
        # second at one length. A real edit is later than the last import;
        # stamp each version a minute apart to say so.
        stamp = 1_700_000_000 + version * 60
        os.utime(surface_file, (stamp, stamp))

    write_surface(1)
    spec = importlib.util.spec_from_file_location(
        name, root / "__init__.py", submodule_search_locations=[str(root)]
    )
    pkg = importlib.util.module_from_spec(spec)
    sys.modules[name] = pkg
    spec.loader.exec_module(pkg)
    yield pkg, write_surface
    for mod in [m for m in sys.modules if m == name or m.startswith(name + ".")]:
        del sys.modules[mod]


def test_without_the_probe_a_new_instance_runs_the_old_code(package):
    pkg, write_surface = package
    assert pkg.create_instance("c").VERSION == 1
    write_surface(2)
    # What a re-select does today: the module is cached, the edit is not seen.
    assert pkg.create_instance("c").VERSION == 1


def test_armed_the_next_instance_imports_the_edited_file(package):
    pkg, write_surface = package
    assert pkg.create_instance("c").VERSION == 1
    write_surface(2)
    assert pkg.request_reload() == 1  # LoopingSurface is loaded
    assert pkg.create_instance("c").VERSION == 2


def test_the_reload_is_one_shot(package):
    pkg, write_surface = package
    pkg.create_instance("c")
    pkg.request_reload()
    write_surface(2)
    assert pkg.create_instance("c").VERSION == 2
    write_surface(3)
    # Disarmed after one purge: a set load later must not re-import.
    assert pkg.create_instance("c").VERSION == 2


def test_arming_alone_changes_nothing_in_the_running_instance(package):
    pkg, write_surface = package
    first = pkg.create_instance("c")
    write_surface(2)
    pkg.request_reload()
    # The purge waits for create_instance: the old instance's module stays put.
    assert f"{pkg.__name__}.LoopingSurface" in sys.modules
    assert type(first).VERSION == 1
