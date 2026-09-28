"""Static guards over ``LoopingSurface.py``, the 2410-LOC entrypoint.

Two invariants, both cheap, neither needing a ControlSurface stub:

1. **No undefined names**, anywhere in the surface — delegated to ``ruff``.
2. **Everything built with a teardown method gets torn down** in
   ``disconnect()``.

## Why ruff replaced the hand-rolled AST walk

This file used to carry 161 lines of scope reconstruction, written after the
2026-04-17 PR-4a regression: a nested function called
``state_full_on_structural()``, a v2-era name deleted in that PR, and Live
logged ``NameError`` on every structural change while the UI silently went
stale.

It did not work. It gathered an enclosing function's bindings with
``ast.walk``, which descends into *sibling* closures, so a name local to one
closure counted as visible inside its siblings — and ``__init__`` holds eight
sibling closures. A module of exactly the PR-4a shape (a closure calling a name
that only exists as a local of a neighbouring closure) raises ``NameError`` at
runtime and the old walk reported it clean. That was measured, not assumed.

``ruff --select F821`` catches that synthetic case, and covers all 122 files /
68k LOC of the surface in ~0.02 s instead of one file. It reports zero
undefined names today, so this is a real gate rather than a baseline.

## Why the teardown-parity test is shaped the way it is

It asserts something narrower than "every attribute set in ``__init__`` is
mentioned in ``disconnect()``". That looser question has three standing
answers here — ``AlcClipProbe``, ``NoteEditProbe``, ``SelectionProbe`` — and
all three are noise: those classes define no teardown method, so there is
nothing to call and nothing to fix. Asserting the loose form would mean
shipping a three-entry allowlist that hides the one shape that matters.

The narrow form has no allowlist and no exceptions: *if a component defines a
teardown method, it must be called.* Checked against history, that is exactly
the invariant that was broken — at ``ba1c5d9^`` it fails on
``_device_init_component``, whose ``DeviceInitComponent.disconnect()`` had
never been called since the component was written (fixed in batch 2, audit
item 13). It passes from ``83d2506`` onward.
"""

from __future__ import annotations

import ast
import shutil
import subprocess
from pathlib import Path
from typing import Dict, Set

import pytest


SURFACE_ROOT = Path(__file__).resolve().parent.parent
LOOPING_SURFACE = SURFACE_ROOT / "LoopingSurface.py"

#: Method names that count as releasing a resource.
TEARDOWN_METHODS = {"disconnect", "close", "stop", "shutdown"}


def _find_ruff() -> str | None:
    """The venv's ruff first — the pre-push hook runs from that interpreter."""
    local = SURFACE_ROOT / ".venv" / "bin" / "ruff"
    if local.is_file():
        return str(local)
    return shutil.which("ruff")


def test_no_undefined_names():
    """No F821 anywhere in the surface.

    Regression for the 2026-04-17 PR-4a ``state_full_on_structural`` bug, and
    for every other name that survives a rename only inside a closure.
    """
    ruff = _find_ruff()
    if ruff is None:
        pytest.skip(
            "ruff not installed — pip install -r requirements-dev.txt "
            "(this test is a gate; a skip means the gate is off)"
        )

    proc = subprocess.run(
        [ruff, "check", "--select", "F821", "--no-cache",
         "--output-format", "concise", str(SURFACE_ROOT)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        "ruff F821 found undefined name(s) in the control surface:\n"
        f"{proc.stdout}{proc.stderr}"
    )


# --------------------------------------------------------------------------
# teardown parity
# --------------------------------------------------------------------------

def _surface_class_methods() -> Dict[str, Set[str]]:
    """class name -> its method names, across every production surface module."""
    out: Dict[str, Set[str]] = {}
    for path in SURFACE_ROOT.rglob("*.py"):
        parts = path.parts
        if ".venv" in parts or "__pycache__" in parts or "tests" in parts:
            continue
        try:
            tree = ast.parse(path.read_text(errors="ignore"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                out.setdefault(node.name, set()).update(
                    m.name for m in node.body
                    if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))
                )
    return out


def _is_self_attr(node: ast.AST, name: str | None = None) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "self"
        and (name is None or node.attr == name)
    )


def _components_built(fns: Dict[str, ast.FunctionDef]) -> Dict[str, tuple]:
    """``self._x = SomeClass(...)`` across __init__ and the setup helpers it calls."""
    entry = fns["__init__"]
    helpers = sorted(
        node.func.attr
        for node in ast.walk(entry)
        if isinstance(node, ast.Call) and _is_self_attr(node.func)
        and node.func.attr in fns
    )

    built: Dict[str, tuple] = {}
    for method in ["__init__", *helpers]:
        for node in ast.walk(fns[method]):
            if not (isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)):
                continue
            func = node.value.func
            cls_name = (
                func.id if isinstance(func, ast.Name)
                else func.attr if isinstance(func, ast.Attribute)
                else None
            )
            # Constructor calls only — a class name, by convention capitalised.
            if not cls_name or not cls_name[0].isupper():
                continue
            for target in node.targets:
                if _is_self_attr(target):
                    built.setdefault(target.attr, (cls_name, node.lineno, method))
    return built


def _torn_down(disconnect: ast.FunctionDef) -> Set[str]:
    """Attributes a teardown method is actually invoked on inside disconnect()."""
    torn: Set[str] = set()
    for node in ast.walk(disconnect):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr not in TEARDOWN_METHODS:
            continue
        receiver = node.func.value
        if _is_self_attr(receiver):
            torn.add(receiver.attr)
        # `getattr(self, "_x", None).disconnect()` — the dominant idiom here
        # (55 sites / 38 names), invisible to a plain attribute walk.
        elif (
            isinstance(receiver, ast.Call)
            and isinstance(receiver.func, ast.Name)
            and receiver.func.id == "getattr"
            and len(receiver.args) > 1
            and isinstance(receiver.args[1], ast.Constant)
        ):
            torn.add(receiver.args[1].value)
    return torn


def analyse_teardown_parity(source: str) -> list:
    """Components built with a teardown method that ``disconnect()`` never calls.

    Split out from the test so it can be pointed at a historical revision of
    the file; see this module's docstring for the ``ba1c5d9^`` check.
    """
    tree = ast.parse(source)
    cls = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.ClassDef) and n.name == "LoopingSurface"
    )
    fns = {
        n.name: n for n in cls.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }

    built = _components_built(fns)
    torn = _torn_down(fns["disconnect"])
    known = _surface_class_methods()

    gaps = []
    for attr, (cls_name, lineno, method) in sorted(built.items()):
        if attr in torn:
            continue
        available = known.get(cls_name, set()) & TEARDOWN_METHODS
        if available:
            gaps.append((attr, cls_name, sorted(available), method, lineno))
    return gaps


def test_every_component_with_teardown_is_torn_down():
    """What ``__init__`` builds, ``disconnect()`` must release.

    Only components that *define* a teardown method are in scope — see this
    module's docstring for why the looser form would need an allowlist.
    """
    gaps = analyse_teardown_parity(LOOPING_SURFACE.read_text())

    if gaps:
        detail = "\n".join(
            f"  self.{attr} = {cls}(...)  built in {method}:{line}  "
            f"— defines {'/'.join(meths)}(), never called in disconnect()"
            for attr, cls, meths, method, line in gaps
        )
        pytest.fail(
            f"{len(gaps)} component(s) constructed but never torn down:\n{detail}\n"
            "Every component that defines disconnect()/close()/stop()/shutdown() "
            "must be released in LoopingSurface.disconnect()."
        )
