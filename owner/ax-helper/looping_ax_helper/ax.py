"""AX primitives: named errors, target lookup, the pyobjc backend, Live discovery.

Which element a request means is decided here in plain Python over a small
backend interface (attr / children / perform / point ...), so tests drive it
with a fake tree and only PyObjCBackend imports pyobjc.

Lookup rules, all measured on Live 12.4.15b2 (ADR-439):
- Start from AXMainWindow, never AXWindows: the windows list reads empty
  whenever Live is not frontmost, while the main window still resolves.
- Find controls by AXIdentifier. Live's identifiers are hierarchical
  (`TrackView.Device[0].TitleBar.ShowSwapBar`), so a search only descends into
  children whose identifier is a prefix of the target, or that carry none;
  the SessionView subtree is skipped whole. A full walk is the fallback.
- AXDescription is the fallback for controls with no identifier (device
  parameters, Clip Detail's Reverse), searched inside a named container.
- Verify the role before acting. Never index children, never cache positions:
  the pad grid's buttons moved between two runs.
"""

from __future__ import annotations

import ctypes
import re
import subprocess
import time
from dataclasses import dataclass

# --- named errors ----------------------------------------------------------
# The bridge adds one more of its own, `ax-helper-down`, for a helper it
# cannot reach.
UNTRUSTED = "ax-untrusted"
LIVE_NOT_RUNNING = "ax-live-not-running"
NO_WINDOW = "ax-no-main-window"
MISSING = "ax-control-missing"
DISABLED = "ax-control-disabled"
WRONG_ROLE = "ax-wrong-role"
TIMEOUT = "ax-timeout"
FAILED = "ax-action-failed"
BAD_REQUEST = "ax-bad-request"
UNKNOWN_TARGET = "ax-unknown-target"
UNKNOWN_VERB = "ax-unknown-verb"
BUSY = "ax-busy"
MENU_MISSING = "ax-menu-missing"
ITEM_MISSING = "ax-item-missing"
WAIT_TIMEOUT = "ax-wait-timeout"

AX_SUCCESS = 0
AX_CANNOT_COMPLETE = -25204
AX_API_DISABLED = -25211
AX_INVALID_ELEMENT = -25202
AX_ERROR_NAMES = {
    -25200: "kAXErrorFailure",
    -25201: "kAXErrorIllegalArgument",
    -25202: "kAXErrorInvalidUIElement",
    -25203: "kAXErrorInvalidUIElementObserver",
    -25204: "kAXErrorCannotComplete",
    -25205: "kAXErrorAttributeUnsupported",
    -25206: "kAXErrorActionUnsupported",
    -25207: "kAXErrorNotificationUnsupported",
    -25208: "kAXErrorNotImplemented",
    -25209: "kAXErrorNotificationAlreadyRegistered",
    -25210: "kAXErrorNotificationNotRegistered",
    -25211: "kAXErrorAPIDisabled",
    -25212: "kAXErrorNoValue",
    -25213: "kAXErrorParameterizedAttributeUnsupported",
    -25214: "kAXErrorNotEnoughPrecision",
}

# A pruned lookup visits tens of nodes; a whole Live window is ~500-900.
NODE_BUDGET = 8000
ESCAPE_KEY = 53
# macOS virtual keycodes for `press_key` (ADR-439 research, 2026-09-20): the
# arrow keys and the one modifier it combines them with. Tried first against
# the hypothesis that Live's track outline honours Shift+Arrow range-select
# the way an ordinary Cocoa list view does -- measured false: a plain arrow
# key didn't move focus off a header row at all, so Live's Session View
# arrows are not wired to row selection in the first place. Kept as a real,
# working primitive for whatever else wants a bare keypress; nothing beyond
# this whitelist is postable.
ARROW_KEYS = {"up": 126, "down": 125}
MODIFIER_KEYS = {"shift": 56}
# Whitelisted for `click`, the modifiers Cocoa list/outline selection actually
# uses: Cmd toggles one row in or out of an existing selection, Shift extends
# a contiguous range. Set as flags on the synthesized click itself, not via
# separate key posts either side of it -- self-contained on the one event,
# rather than depending on any separately tracked modifier state.
CLICK_MODIFIERS = ("shift", "cmd")
# Whitelisted for `system_key`: the one key this exists for. Live's own menu
# names the shortcut ("Group Tracks, ⌘G"; Ungroup is Shift+⌘G), so a
# real Cmd+G posted the same way `system_click` posts a real click should
# invoke the command directly with no menu ever opening -- the ask that
# started this (2026-09-20): grouping should not visibly interrupt Live's
# screen while the performer is working from the iPad.
SYSTEM_KEYS = {"g": 5}  # standard macOS virtual keycode for G


class AxError(Exception):
    def __init__(self, code: str, detail: str = "", **extra):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail
        self.extra = extra


def check_rc(rc: int, what: str, ms: float | None = None) -> None:
    """Turn an AXError return into a named error (or nothing, on success)."""
    if rc == AX_SUCCESS:
        return
    after = f" after {ms:.0f} ms" if ms is not None else ""
    if rc == AX_API_DISABLED:
        raise AxError(UNTRUSTED, f"{what} refused{after}: this process is not trusted for Accessibility")
    if rc == AX_CANNOT_COMPLETE:
        raise AxError(
            TIMEOUT,
            f"{what} returned -25204{after}: Live did not answer inside the messaging timeout "
            "(the action may still complete)",
            ms=None if ms is None else round(ms, 1),
        )
    raise AxError(FAILED, f"{what} returned {rc} ({AX_ERROR_NAMES.get(rc, 'unknown AXError')}){after}")


# --- targets ---------------------------------------------------------------

@dataclass(frozen=True)
class Target:
    name: str
    role: str
    identifier: str | None = None   # AXIdentifier; may hold {param} placeholders
    description: str | None = None  # AXDescription: for controls with no identifier
    within: str | None = None       # identifier of the container a description is searched in
    title: str | None = None        # AXTitle (menu-bar items)
    root: str = "main"              # "main" AXMainWindow | "menubar" AXMenuBar | "focused" AXFocusedWindow
    repeated: bool = False          # the identifier repeats (the pad grid): address by index
    context: str | None = None      # None: exists whenever Live's window does
    # Where a pointer reveals controls Live draws only under one (a Drum
    # Sampler's swap buttons), as fractions of the element's width and height.
    hover: tuple[float, float] | None = None

    def spec(self, params: dict | None = None) -> str:
        parts = []
        if self.identifier:
            parts.append(fill(self.identifier, params or {}, strict=False))
        if self.description:
            where = f" in {fill(self.within, params or {}, strict=False)}" if self.within else ""
            parts.append(f'"{self.description}"{where}')
        if self.title:
            parts.append(f'"{self.title}" ({self.root})')
        return " / ".join(parts) or self.name


ROOTS = {"main": "AXMainWindow", "menubar": "AXMenuBar", "focused": "AXFocusedWindow"}
_PLACEHOLDER = re.compile(r"\{(\w+)\}")
_PARAM_VALUE = re.compile(r"^[0-9]{1,3}$")


def fill(template: str, params: dict, *, strict: bool = True) -> str:
    """Substitute {name} placeholders with small non-negative integers only, so a
    request can never splice arbitrary text into an identifier."""

    def sub(m: re.Match) -> str:
        key = m.group(1)
        if key not in params:
            if strict:
                raise AxError(BAD_REQUEST, f"missing param {key!r} for {template}")
            return m.group(0)
        value = params[key]
        text = str(value)
        if isinstance(value, bool) or not _PARAM_VALUE.match(text):
            raise AxError(BAD_REQUEST, f"param {key}={value!r} must be an integer 0-999")
        return text

    return _PLACEHOLDER.sub(sub, template)


def target_from_request(args: dict, catalog: dict) -> Target:
    spec = args.get("target")
    if isinstance(spec, str):
        target = catalog.get(spec)
        if target is None:
            raise AxError(UNKNOWN_TARGET, f"no target named {spec!r}")
        return target
    if isinstance(spec, dict):
        role = spec.get("role")
        if not isinstance(role, str) or not role:
            raise AxError(BAD_REQUEST, "a raw target needs a role")
        keys = ("identifier", "description", "within", "title")
        fields = {k: spec.get(k) for k in keys}
        for k, v in fields.items():
            if v is not None and not isinstance(v, str):
                raise AxError(BAD_REQUEST, f"target.{k} must be a string")
        if not (fields["identifier"] or fields["description"] or fields["title"]):
            raise AxError(BAD_REQUEST, "a raw target needs an identifier, description or title")
        root = spec.get("root", "main")
        if root not in ROOTS:
            raise AxError(BAD_REQUEST, f"target.root must be one of {sorted(ROOTS)}")
        return Target("(raw)", role, root=root, repeated=bool(spec.get("repeated")), **fields)
    raise AxError(BAD_REQUEST, "target must be a catalog name or {role, identifier|description|title}")


# --- lookup ----------------------------------------------------------------

def boundary_prefix(prefix: str, full: str) -> bool:
    """`TrackView.Device[1]` prefixes `TrackView.Device[1].TitleBar`, not `TrackView.Device[10]`."""
    if not full.startswith(prefix):
        return False
    return len(full) == len(prefix) or full[len(prefix)] in ".["


def find_identifier(b, root, ident: str, *, every: bool = False, budget: int = NODE_BUDGET):
    """Prefix-pruned depth-first search, in tree order. Returns (elements, visited)."""
    found, visited, stack = [], 0, [root]
    while stack and visited < budget:
        el = stack.pop()
        visited += 1
        el_id = b.attr(el, "AXIdentifier") or ""
        if el_id == ident:
            found.append(el)
            if not every:
                break
            continue
        if el_id and not boundary_prefix(el_id, ident):
            continue
        stack.extend(reversed(b.children(el)))
    return found, visited


def walk(b, root, match, *, every: bool = True, budget: int = NODE_BUDGET):
    """Unpruned depth-first search, in tree order. Returns (elements, visited)."""
    found, visited, stack = [], 0, [root]
    while stack and visited < budget:
        el = stack.pop()
        visited += 1
        if match(el):
            found.append(el)
            if not every:
                break
        stack.extend(reversed(b.children(el)))
    return found, visited


def _hint(target: Target) -> str:
    return f" (needs {target.context})" if target.context else ""


def locate(b, root, target: Target, params: dict, *, every: bool = False):
    """Every element `target` names under `root`, role-checked, in tree order.

    Raises MISSING when nothing matches and WRONG_ROLE when something matches
    with another role. Returns (elements, info) with the nodes visited."""
    info = {"visited": 0}
    want_all = every or target.repeated
    found: list = []
    ident = fill(target.identifier, params) if target.identifier else None
    if ident:
        found, n = find_identifier(b, root, ident, every=want_all)
        info["visited"] += n
        if not found:
            found, n = walk(b, root, lambda el: (b.attr(el, "AXIdentifier") or "") == ident, every=want_all)
            info["visited"] += n
            info["fullWalk"] = True
    if not found and (target.description or target.title):
        scope = root
        if target.within:
            within = fill(target.within, params)
            scopes, n = find_identifier(b, root, within)
            info["visited"] += n
            if not scopes:
                raise AxError(MISSING, f"{within} is not in Live's window{_hint(target)}", target=target.name)
            scope = scopes[0]
        key, wanted = ("AXDescription", target.description) if target.description else ("AXTitle", target.title)
        found, n = walk(
            b, scope,
            lambda el: b.attr(el, key) == wanted and b.attr(el, "AXRole") == target.role,
            every=want_all,
        )
        info["visited"] += n
        if not found:
            other, n = walk(b, scope, lambda el: b.attr(el, key) == wanted, every=False)
            info["visited"] += n
            if other:
                raise AxError(
                    WRONG_ROLE,
                    f"{target.spec(params)} is {b.attr(other[0], 'AXRole')}, expected {target.role}",
                    target=target.name,
                )
    if not found:
        raise AxError(MISSING, f"{target.spec(params)} is not in Live's window{_hint(target)}", target=target.name)
    typed = [el for el in found if b.attr(el, "AXRole") == target.role]
    if not typed:
        raise AxError(
            WRONG_ROLE,
            f"{target.spec(params)} is {b.attr(found[0], 'AXRole')}, expected {target.role}",
            target=target.name,
        )
    return typed, info


def grid_order(b, elements: list) -> list:
    """Reading order on screen: rows top to bottom, then left to right."""
    far = (1e9, 1e9)
    points = [b.point(el) or far for el in elements]
    order = sorted(range(len(elements)), key=lambda i: (round(points[i][1]), round(points[i][0])))
    return [elements[i] for i in order]


def plain(value):
    """An AX attribute value as JSON: bools, numbers and strings pass, the rest is text."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, str):
        return str(value)
    return str(value)[:200]


def describe(b, el, *, with_help: bool = False) -> dict:
    point, size = b.point(el), b.size(el)
    enabled = b.attr(el, "AXEnabled")
    out = {
        "role": plain(b.attr(el, "AXRole")),
        "subrole": plain(b.attr(el, "AXSubrole")),
        "identifier": plain(b.attr(el, "AXIdentifier")) or None,
        "description": plain(b.attr(el, "AXDescription")),
        "title": plain(b.attr(el, "AXTitle")),
        "value": plain(b.attr(el, "AXValue")),
        "enabled": None if enabled is None else bool(enabled),
        "position": None if point is None else [round(point[0]), round(point[1])],
        "size": None if size is None else [round(size[0]), round(size[1])],
    }
    if with_help:
        out["help"] = plain(b.attr(el, "AXHelp"))
    return out


# --- menus (Live's context menus are windows, not AXMenu children) ------------

MODIFIER_GLYPHS = "⌃⌥⇧⌘"


def window_of(b, el, limit: int = 60):
    while el is not None and limit > 0:
        if b.attr(el, "AXRole") == "AXWindow":
            return el
        el = b.attr(el, "AXParent")
        limit -= 1
    return None


def parse_menu_title(title: str) -> tuple[str, bool]:
    """`✔ 1 Bar` -> ('1 Bar', True); `Freeze Track, ⌥⇧⌘F` -> ('Freeze Track', False)."""
    text = (title or "").strip()
    checked = text.startswith("✔")
    if checked:
        text = text[1:].strip()
    head, sep, tail = text.rpartition(", ")
    if sep and len(tail) <= 6 and (any(g in tail for g in MODIFIER_GLYPHS) or len(tail) == 1):
        text = head
    return text, checked


def menu_items(b, window) -> list:
    found, _ = walk(b, window, lambda el: b.attr(el, "AXRole") == "AXMenuItem")
    return found


# --- Live discovery ----------------------------------------------------------

LIVE_EXECUTABLE_SUFFIX = ".app/Contents/MacOS/Live"
_libproc_handle = None


def pid_path(pid: int) -> str | None:
    global _libproc_handle
    if _libproc_handle is None:
        _libproc_handle = ctypes.CDLL("/usr/lib/libproc.dylib")
    buf = ctypes.create_string_buffer(4096)
    n = _libproc_handle.proc_pidpath(ctypes.c_int(pid), buf, ctypes.c_uint32(4096))
    return buf.value.decode("utf-8", "replace") if n > 0 else None


def find_live_pid(hint: int | None = None) -> int | None:
    """The running Live's pid: `hint` while it still is Live, else a fresh pgrep."""
    if hint and (pid_path(hint) or "").endswith(LIVE_EXECUTABLE_SUFFIX):
        return hint
    try:
        out = subprocess.run(["/usr/bin/pgrep", "-x", "Live"], capture_output=True, text=True, timeout=2,
                             check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for token in out.split():
        pid = int(token)
        if (pid_path(pid) or "").endswith(LIVE_EXECUTABLE_SUFFIX):
            return pid
    return None


# --- the real backend ----------------------------------------------------------

class PyObjCBackend:
    """macOS Accessibility through pyobjc. The only class that imports it."""

    def __init__(self):
        import ApplicationServices as AS
        import CoreFoundation as CF
        import objc
        import Quartz

        self.AS, self.CF, self.objc, self.Quartz = AS, CF, objc, Quartz

    def post_mouse_move(self, pid: int, x: float, y: float) -> bool:
        """A mouse-moved event, no button, posted to one process
        (CGEventPostToPid) rather than to the system's event stream. False when
        the event could not be made."""
        Q = self.Quartz
        event = Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, Q.CGPointMake(float(x), float(y)),
                                          Q.kCGMouseButtonLeft)
        if event is None:
            return False
        Q.CGEventPostToPid(int(pid), event)
        return True

    def click(self, pid: int, x: float, y: float, modifiers: tuple[str, ...] = ()) -> bool:
        """A real left click -- down then up -- posted to one process
        (CGEventPostToPid), exactly like `post_mouse_move` but with a button.
        `modifiers` (from CLICK_MODIFIERS) are set as flags on the two events
        themselves via CGEventSetFlags, the standard, self-contained way to
        synthesize a modified click: it does not depend on any separately
        posted or tracked keyboard-modifier state, unlike `press_key`, which
        has no such flags parameter and must post the modifier as its own
        keystroke. False when either event could not be made."""
        Q = self.Quartz
        flag_bits = {"shift": Q.kCGEventFlagMaskShift, "cmd": Q.kCGEventFlagMaskCommand}
        flags = 0
        for m in modifiers:
            flags |= flag_bits[m]
        point = Q.CGPointMake(float(x), float(y))
        down = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseDown, point, Q.kCGMouseButtonLeft)
        up = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseUp, point, Q.kCGMouseButtonLeft)
        if down is None or up is None:
            return False
        if flags:
            Q.CGEventSetFlags(down, flags)
            Q.CGEventSetFlags(up, flags)
        Q.CGEventPostToPid(int(pid), down)
        Q.CGEventPostToPid(int(pid), up)
        return True

    def cursor_position(self) -> tuple[float, float]:
        """Where the real system pointer is right now, no side effect --
        `CGEventCreate(None)` describes the current event state without
        injecting anything. Read before `system_click` moves the pointer, so
        the verb can put it back."""
        loc = self.Quartz.CGEventGetLocation(self.Quartz.CGEventCreate(None))
        return (float(loc.x), float(loc.y))

    def system_move(self, x: float, y: float) -> None:
        """Move the real cursor, through the global event stream -- used only to
        restore it after `system_click`, never to leave it somewhere new."""
        Q = self.Quartz
        event = Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, Q.CGPointMake(float(x), float(y)),
                                          Q.kCGMouseButtonLeft)
        if event is not None:
            Q.CGEventPost(Q.kCGHIDEventTap, event)

    def system_click(self, x: float, y: float, modifiers: tuple[str, ...] = ()) -> bool:
        """A real left click -- move, then down, then up -- posted to the global
        HID event stream (CGEventPost, not CGEventPostToPid). This is the one
        class of synthetic input Live has actually been measured to honour
        (the Meld mod-matrix research's zero-length drag) after `click`'s
        CGEventPostToPid version was measured to do nothing at all, on two
        different controls in two different sessions. It moves the real
        system pointer -- the caller is responsible for reading
        `cursor_position()` first and calling `system_move` back afterward.
        False when an event could not be made."""
        Q = self.Quartz
        flag_bits = {"shift": Q.kCGEventFlagMaskShift, "cmd": Q.kCGEventFlagMaskCommand}
        flags = 0
        for m in modifiers:
            flags |= flag_bits[m]
        point = Q.CGPointMake(float(x), float(y))
        move = Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, point, Q.kCGMouseButtonLeft)
        down = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseDown, point, Q.kCGMouseButtonLeft)
        up = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseUp, point, Q.kCGMouseButtonLeft)
        if move is None or down is None or up is None:
            return False
        if flags:
            Q.CGEventSetFlags(down, flags)
            Q.CGEventSetFlags(up, flags)
        Q.CGEventPost(Q.kCGHIDEventTap, move)
        Q.CGEventPost(Q.kCGHIDEventTap, down)
        Q.CGEventPost(Q.kCGHIDEventTap, up)
        return True

    def system_mouse_down(self, x: float, y: float) -> bool:
        """The button-down half of a drag, posted alone through the global
        HID event stream -- paired with `system_mouse_dragged` steps and a
        final `system_mouse_up`, the same three-event shape `system_click`
        posts back to back with nothing held in between. Live's own
        track-header reorder / group-membership drag needs to see the button
        actually held across a path (`_system_drag`), which is the one thing
        a plain `system_click` cannot express."""
        Q = self.Quartz
        event = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseDown, Q.CGPointMake(float(x), float(y)),
                                          Q.kCGMouseButtonLeft)
        if event is None:
            return False
        Q.CGEventPost(Q.kCGHIDEventTap, event)
        return True

    def system_mouse_dragged(self, x: float, y: float) -> bool:
        """One step of a held-button move -- `kCGEventLeftMouseDragged`, not
        `kCGEventMouseMoved` -- through the global HID event stream. A plain
        moved event posted between a down and an up is not the same event an
        app sees during a real drag; this is."""
        Q = self.Quartz
        event = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseDragged, Q.CGPointMake(float(x), float(y)),
                                          Q.kCGMouseButtonLeft)
        if event is None:
            return False
        Q.CGEventPost(Q.kCGHIDEventTap, event)
        return True

    def system_mouse_up(self, x: float, y: float) -> bool:
        """The release half of a drag -- see `system_mouse_down`."""
        Q = self.Quartz
        event = Q.CGEventCreateMouseEvent(None, Q.kCGEventLeftMouseUp, Q.CGPointMake(float(x), float(y)),
                                          Q.kCGMouseButtonLeft)
        if event is None:
            return False
        Q.CGEventPost(Q.kCGHIDEventTap, event)
        return True

    def system_key(self, keycode: int, modifiers: tuple[str, ...] = ()) -> bool:
        """A real keystroke -- down then up -- through the global HID event
        stream (CGEventPost), the keyboard equivalent of `system_click`:
        `press_key`'s AXUIElementPostKeyboardEvent has no flags parameter at
        all, so a modifier held that way is a separate keystroke around it,
        never guaranteed to read as "held" the way a real combo does. This
        goes through CGEventCreateKeyboardEvent with CGEventSetFlags on the
        event itself instead, self-contained the same way a modified
        `system_click` is. Goes to whatever has keyboard focus system-wide --
        the caller is responsible for making sure that is Live. False when an
        event could not be made."""
        Q = self.Quartz
        flag_bits = {"shift": Q.kCGEventFlagMaskShift, "cmd": Q.kCGEventFlagMaskCommand}
        flags = 0
        for m in modifiers:
            flags |= flag_bits[m]
        down = Q.CGEventCreateKeyboardEvent(None, int(keycode), True)
        up = Q.CGEventCreateKeyboardEvent(None, int(keycode), False)
        if down is None or up is None:
            return False
        if flags:
            Q.CGEventSetFlags(down, flags)
            Q.CGEventSetFlags(up, flags)
        Q.CGEventPost(Q.kCGHIDEventTap, down)
        Q.CGEventPost(Q.kCGHIDEventTap, up)
        return True

    def trusted(self, prompt: bool = False) -> bool:
        if prompt:
            return bool(self.AS.AXIsProcessTrustedWithOptions({self.AS.kAXTrustedCheckOptionPrompt: True}))
        return bool(self.AS.AXIsProcessTrusted())

    def live_pid(self, hint: int | None = None) -> int | None:
        return find_live_pid(hint)

    def live_path(self, pid: int) -> str | None:
        path = pid_path(pid)
        return path[: -len("/Contents/MacOS/Live")] if path else None

    def application(self, pid: int):
        return self.AS.AXUIElementCreateApplication(pid)

    def attr(self, el, name: str):
        rc, value = self.AS.AXUIElementCopyAttributeValue(el, name, None)
        return value if rc == AX_SUCCESS else None

    def attr_rc(self, el, name: str):
        return self.AS.AXUIElementCopyAttributeValue(el, name, None)

    def children(self, el) -> list:
        return list(self.attr(el, "AXChildren") or [])

    def actions(self, el) -> list:
        rc, names = self.AS.AXUIElementCopyActionNames(el, None)
        return [str(n) for n in names] if rc == AX_SUCCESS and names else []

    def perform(self, el, action: str) -> int:
        return self.AS.AXUIElementPerformAction(el, action)

    def settable(self, el, name: str) -> bool:
        rc, ok = self.AS.AXUIElementIsAttributeSettable(el, name, None)
        return rc == AX_SUCCESS and bool(ok)

    def set_attr(self, el, name: str, value) -> int:
        return self.AS.AXUIElementSetAttributeValue(el, name, value)

    def set_timeout(self, el, seconds: float) -> int:
        return self.AS.AXUIElementSetMessagingTimeout(el, float(seconds))

    def same(self, a, b) -> bool:
        if a is None or b is None:
            return a is b
        return bool(self.CF.CFEqual(a, b))

    def _geometry(self, el, name: str, kind):
        value = self.attr(el, name)
        if value is None:
            return None
        try:
            ok, geom = self.AS.AXValueGetValue(value, kind, None)
        except (TypeError, ValueError):  # an unexpected value type; geometry is advisory
            return None
        return geom if ok else None

    def point(self, el):
        p = self._geometry(el, "AXPosition", self.AS.kAXValueCGPointType)
        return None if p is None else (float(p.x), float(p.y))

    def size(self, el):
        s = self._geometry(el, "AXSize", self.AS.kAXValueCGSizeType)
        return None if s is None else (float(s.width), float(s.height))

    def post_key(self, app, pid: int, keycode: int, down: bool) -> int:
        return self.AS.AXUIElementPostKeyboardEvent(app, 0, keycode, down)

    def element_pid(self, el) -> int | None:
        rc, pid = self.AS.AXUIElementGetPid(el, None)
        return int(pid) if rc == AX_SUCCESS else None

    def observer(self, pid: int, element, notification: str) -> _Observer:
        return _Observer(self, pid, element, notification)


class _Observer:
    """One AX notification, observed on the calling thread's run loop.

    Register before the action that causes it, then `wait`: a notification
    posted before registration is never delivered."""

    def __init__(self, backend: PyObjCBackend, pid: int, element, notification: str):
        AS, CF = backend.AS, backend.CF
        self._AS, self._CF = AS, CF
        self._fired: list[float] = []

        def callback(observer, el, name, refcon):
            self._fired.append(time.monotonic())

        self._callback = backend.objc.callbackFor(AS.AXObserverCreate)(callback)
        rc, self._observer = AS.AXObserverCreate(pid, self._callback, None)
        check_rc(rc, "AXObserverCreate")
        rc = AS.AXObserverAddNotification(self._observer, element, notification, None)
        check_rc(rc, f"AXObserverAddNotification({notification})")
        self._element, self._notification = element, notification
        self._source = AS.AXObserverGetRunLoopSource(self._observer)
        self._loop = CF.CFRunLoopGetCurrent()
        CF.CFRunLoopAddSource(self._loop, self._source, CF.kCFRunLoopDefaultMode)
        self._t0 = time.monotonic()

    def wait(self, timeout_s: float) -> float | None:
        """Milliseconds from registration to the first delivery, or None."""
        deadline = time.monotonic() + timeout_s
        while not self._fired and time.monotonic() < deadline:
            self._CF.CFRunLoopRunInMode(self._CF.kCFRunLoopDefaultMode, 0.02, True)
        return None if not self._fired else (self._fired[0] - self._t0) * 1000

    def close(self) -> None:
        self._AS.AXObserverRemoveNotification(self._observer, self._element, self._notification)
        self._CF.CFRunLoopRemoveSource(self._loop, self._source, self._CF.kCFRunLoopDefaultMode)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False
