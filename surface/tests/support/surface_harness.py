"""Build a whole ``LoopingSurface`` without Live.

``LoopingSurface`` subclasses ``ableton.v3``'s ``ControlSurface`` and binds
real sockets, so no test constructed one before. This harness loads the
surface package under a private name with:

- a stand-in ``ableton.v3.control_surface`` (``ControlSurface`` gives
  ``song`` / ``application`` / ``schedule_message`` / ``show_message``),
- a recording transport in place of ``OSCTransport`` / ``TCPTransport``
  (``handlers`` is every ``add_handler`` address in order),
- a pump in place of ``FastDrainPump``,
- ``AnyLOM`` for the song and the application: a permissive object whose
  every attribute is another ``AnyLOM``, every call returns one, and which
  iterates as empty — enough for each component's constructor to attach
  its listeners to nothing in particular.

The package is loaded as ``vamp_surface_harness`` so its modules are
separate objects from the ``components.*`` the unit tests import.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import types
from pathlib import Path
from typing import List, Tuple

SURFACE_ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "vamp_surface_harness"


class AnyLOM:
    """Every attribute, call and item is another ``AnyLOM``; it iterates
    as empty, reads as 0 / 0.0 / ``""``, and is equal only to itself."""

    def __init__(self, name="lom"):
        object.__setattr__(self, "_name", name)
        object.__setattr__(self, "_children", {})

    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        children = object.__getattribute__(self, "_children")
        if name not in children:
            children[name] = AnyLOM("%s.%s" % (self._name, name))
        return children[name]

    def __setattr__(self, name, value):
        object.__getattribute__(self, "_children")[name] = value

    def __call__(self, *args, **kwargs):
        return AnyLOM("%s()" % self._name)

    def __iter__(self):
        return iter(())

    def __len__(self):
        return 0

    def __getitem__(self, key):
        raise IndexError(key)

    def __float__(self):
        return 0.0

    def __int__(self):
        return 0

    __index__ = __int__

    def __str__(self):
        return ""

    def __repr__(self):
        return "<AnyLOM %s>" % self._name

    def __eq__(self, other):
        return self is other

    def __hash__(self):
        return id(self)

    def __lt__(self, other):
        return False

    __le__ = __gt__ = __ge__ = __lt__


class RecordingTransport:
    """``OSCTransport``'s registration surface, recorded."""

    instances: List["RecordingTransport"] = []

    def __init__(self, *args, **kwargs):
        self.handlers: List[Tuple[str, object]] = []
        self.drain_hooks: List[object] = []
        self.sent: List[tuple] = []
        self.closed = False
        self.drain_skips = 0
        RecordingTransport.instances.append(self)

    def add_handler(self, address, handler):
        self.handlers.append((address, handler))

    def add_drain_hook(self, hook):
        self.drain_hooks.append(hook)

    def send(self, address, args=(), remote_addr=None):
        self.sent.append((address, tuple(args)))

    def poll(self):
        return 0

    def close(self):
        self.closed = True

    def stats(self):
        return {}


class RecordingTCP(RecordingTransport):
    def __init__(self, *args, **kwargs):
        super().__init__()


class StubPump:
    def __init__(self, drain=None, interval_ms=None):
        self.running = False
        self.tick_hooks: List[object] = []

    def start(self):
        return False

    def stop(self):
        self.running = False

    def add_tick_hook(self, hook):
        self.tick_hooks.append(hook)

    def remove_tick_hook(self, hook):
        if hook in self.tick_hooks:
            self.tick_hooks.remove(hook)

    def stats(self):
        return {}


class StubControlSurface:
    def __init__(self, c_instance=None, specification=None, *a, **k):
        self.song = AnyLOM("song")
        self.application = AnyLOM("application")
        self.scheduled: List[tuple] = []
        self.messages: List[str] = []

    def schedule_message(self, ticks, fn):
        self.scheduled.append((ticks, fn))

    def show_message(self, text):
        self.messages.append(text)

    def disconnect(self):
        pass


def _install_ableton_stubs():
    cs = types.ModuleType("ableton.v3.control_surface")
    cs.ControlSurface = StubControlSurface
    cs.ControlSurfaceSpecification = type("ControlSurfaceSpecification", (), {})
    eb = types.ModuleType("ableton.v3.control_surface.elements_base")
    eb.ElementsBase = type("ElementsBase", (), {})
    ableton = types.ModuleType("ableton")
    v3 = types.ModuleType("ableton.v3")
    ableton.v3 = v3
    v3.control_surface = cs
    cs.elements_base = eb
    return {
        "ableton": ableton, "ableton.v3": v3,
        "ableton.v3.control_surface": cs,
        "ableton.v3.control_surface.elements_base": eb,
    }


def load_surface_module(monkeypatch):
    """Import ``LoopingSurface.py`` as part of a private package, with Live
    and the sockets stubbed. Returns the module."""
    for name, mod in _install_ableton_stubs().items():
        monkeypatch.setitem(sys.modules, name, mod)
    for name in [m for m in sys.modules if m == PACKAGE or m.startswith(PACKAGE + ".")]:
        monkeypatch.delitem(sys.modules, name)
    spec = importlib.util.spec_from_file_location(
        PACKAGE, SURFACE_ROOT / "__init__.py",
        submodule_search_locations=[str(SURFACE_ROOT)],
    )
    pkg = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, PACKAGE, pkg)
    spec.loader.exec_module(pkg)
    mod = importlib.import_module(PACKAGE + ".LoopingSurface")

    from components.live_library import LiveLibrary

    dlc = sys.modules[PACKAGE + ".components.DeviceLoadComponent"]
    monkeypatch.setattr(dlc, "read_live_library", lambda *a, **k: LiveLibrary())
    monkeypatch.setattr(mod, "OSCTransport", RecordingTransport)
    monkeypatch.setattr(mod, "TCPTransport", RecordingTCP)
    monkeypatch.setattr(mod, "FastDrainPump", StubPump)
    return mod


def build_surface(monkeypatch):
    """A constructed ``LoopingSurface`` and its recording UDP transport."""
    mod = load_surface_module(monkeypatch)
    RecordingTransport.instances.clear()
    surface = mod.LoopingSurface(c_instance=None)
    udp = next(t for t in RecordingTransport.instances if not isinstance(t, RecordingTCP))
    return surface, udp
