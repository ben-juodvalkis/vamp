"""The verbs: everything a request can ask the helper to do to Live's UI (ADR-439).

Deliberately small, not a UI-automation language: press, hover, show_menu +
pick, increment / decrement, read / list, wait_for, smoke, save_as_dialog,
select, focus, press_key, click, system_click, system_key. Nothing here sets
AXValue on a slider or checkbox: measured to return 0 and change nothing. The
values it does write are read back before the verb answers: the name in the
Save As panel's text field, a container's AXSelectedRows (`select`, measured
unreliable), and AXFocused on a control (`focus`, which held up on its own --
see its docstring -- but, like `select`, turned out not to be what Live's
arrow keys route through; see `press_key`).

Five verbs now touch Live beyond a plain AXPress, in the order they were
tried against multi-track selection and then against grouping it without a
visible menu, each because the one before it measured short or came with a
cost that mattered: `select`'s container write (unreliable), `press_key`'s
Shift+Arrow (Live's Session View arrows aren't wired to row selection at all
-- a plain arrow didn't move focus off a header row either), `click` -- a
real mouse down/up posted to Live's process alone (CGEventPostToPid) -- which
did *nothing at all*, not even a plain unmodified click, matching what a
different session found on a completely different control. `system_click` is
the answer to that: the same click, posted to the global HID event stream
instead, which is the one class of synthetic input measured to actually
register -- and the one verb that moves the real system pointer, at absolute
screen coordinates outside Live's process boundary. `system_key` is the same
escalation applied to a keystroke, so a command like Group Tracks can be
triggered by its own shortcut with no menu ever visible on Live's screen --
see both of their docstrings before calling either. The only other pointer
input anywhere is hover's mouse moves, with no button, scoped to Live's
process like `click`. A missing precondition is a named error, never a
fallback.

Every verb runs on the server's main thread, one at a time (see server.py).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import time

from . import VERSION
from .ax import (
    ARROW_KEYS,
    BAD_REQUEST,
    CLICK_MODIFIERS,
    DISABLED,
    ESCAPE_KEY,
    FAILED,
    ITEM_MISSING,
    LIVE_NOT_RUNNING,
    MENU_MISSING,
    MISSING,
    MODIFIER_KEYS,
    NO_WINDOW,
    NODE_BUDGET,
    ROOTS,
    SYSTEM_KEYS,
    UNKNOWN_VERB,
    UNTRUSTED,
    WAIT_TIMEOUT,
    AxError,
    check_rc,
    describe,
    grid_order,
    locate,
    menu_items,
    parse_menu_title,
    plain,
    target_from_request,
    window_of,
)

SELECT_SETTLE_MS = 1000  # how long `select` waits for Live to take a written selection
SMOKE_SETTLE_S = 3.0   # Live's window must have existed this long before the smoke check
TRUST_PROBE_S = 5.0    # how often an untrusted helper asks a child process whether it is granted yet
MAX_TIMEOUT_S = 60.0
MAX_WAIT_MS = 30_000
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def probe_trust_in_child() -> bool:
    """AXIsProcessTrusted() answered by a fresh child process: it shares this
    process's responsible launcher, so it sees the same grant, but unlike this
    process it has no stale answer cached."""
    code = "import ApplicationServices as A; print(int(bool(A.AXIsProcessTrusted())))"
    try:
        done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=20,
                              check=False)
    except (OSError, subprocess.SubprocessError):
        return False
    return done.stdout.strip() == "1"


def _positive_int(args: dict, key: str, default: int, low: int, high: int) -> int:
    value = args.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise AxError(BAD_REQUEST, f"{key} must be an integer {low}-{high}")
    return value


def _matches(value, wanted) -> bool:
    numbers = (int, float)
    if isinstance(value, numbers) and isinstance(wanted, numbers) \
            and not isinstance(value, bool) and not isinstance(wanted, bool):
        return abs(float(value) - float(wanted)) < 1e-9
    return str(value) == str(wanted)


class Helper:
    VERBS = (
        "press", "hover", "read", "list", "increment", "decrement",
        "show_menu", "pick", "dismiss_menu", "wait_for", "smoke", "dump", "save_as_dialog",
        "panel_state", "select", "focus", "press_key", "click", "system_click", "system_key",
        "system_drag",
    )
    MAX_SELECTION = 64
    # hover's glide into its point, from just inside the element's left edge:
    # the shape of the reveal measured on 2026-09-15 (13 moves, 15 ms apart).
    HOVER_GLIDE_STEPS = 13
    HOVER_STEP_S = 0.015
    HOVER_EDGE_INSET = 6.0

    def __init__(self, backend, catalog: dict, *, messaging_timeout_s: float, bundle: str | None = None,
                 log: logging.Logger | None = None, clock=time.monotonic, sleep=time.sleep,
                 probe_trust=probe_trust_in_child):
        self.b = backend
        self.catalog = catalog
        self.messaging_timeout_s = float(messaging_timeout_s)
        self.bundle = bundle
        self.log = log or logging.getLogger("ax-helper")
        self._clock = clock
        self._sleep = sleep
        self._probe_trust = probe_trust
        self._next_trust_probe = 0.0
        self.wants_restart = False  # read by the server loop: re-execute to pick up a fresh grant
        self._started = time.time()
        self._trusted: bool | None = None
        self._pid: int | None = None
        self._app = None
        self._window_since: float | None = None
        # `_smoke_report`, not `_smoke`: an instance attribute of that name
        # shadows `def _smoke` from `__init__` onward, and `dispatch` resolves a
        # verb with `getattr(self, "_" + verb)` — so the `smoke` verb answered
        # `TypeError: 'dict' object is not callable` (or `'NoneType'` before the
        # first periodic check). It is the operator's "did a Live update rename
        # a control?" probe and it had never run. Found on the rig 2026-09-15.
        self._smoke_report: dict | None = None
        self._smoke_pid: int | None = None

    # --- snapshot: any thread, never messages Live -------------------------------

    def status(self) -> dict:
        return {
            "version": VERSION,
            "pid": os.getpid(),
            "bundle": self.bundle,
            "trusted": self.b.trusted(),
            "live": {"pid": self._pid},
            "smoke": self._smoke_report,
            "uptimeS": round(time.time() - self._started),
        }

    # --- lifecycle: main thread ----------------------------------------------------

    def on_start(self) -> None:
        # With prompt=True an untrusted first run also lists the app in System
        # Settings (switched off) and shows the system dialog; the switch stays
        # the user's to flip.
        self._trusted = self.b.trusted(prompt=True)
        if self._trusted:
            self.log.info("trusted for Accessibility (%s)", self.bundle or "no bundle: inherits its launcher's trust")
        else:
            self.log.warning("NOT trusted for Accessibility: %s", self._grant_hint())
        self.tick()

    def tick(self) -> None:
        """Every couple of seconds: notice trust changes, follow Live's pid, and run
        the smoke check once per Live launch, after its window has settled."""
        trusted = self.b.trusted()
        if not trusted and self._clock() >= self._next_trust_probe:
            # Measured 2026-09-15: AXIsProcessTrusted() keeps answering False in a
            # process that was running when the grant was given, until it
            # restarts. A child process (same responsible launcher, so the same
            # grant) answers fresh; when it says yes, this process re-executes.
            self._next_trust_probe = self._clock() + TRUST_PROBE_S
            if self._probe_trust():
                self.log.warning("Accessibility granted: re-executing so this process picks the grant up")
                self.wants_restart = True
                return
        if trusted != self._trusted:
            (self.log.info if trusted else self.log.warning)("trust changed: %s -> %s", self._trusted, trusted)
            self._trusted = trusted
            self._smoke_pid = None
        pid = self.b.live_pid(self._pid)
        if pid != self._pid:
            self.log.info("Live %s", f"running, pid {pid}" if pid else "not running")
            self._adopt(pid)
        if not trusted or pid is None or self._smoke_pid == pid:
            return
        window = self.b.attr(self._app, "AXMainWindow")
        if window is None or self.b.attr(window, "AXRole") != "AXWindow":
            # No window to check against (launching, or the screen is locked:
            # measured, Live then offers AX only its menu bar). Wait for one.
            self._window_since = None
            return
        now = self._clock()
        if self._window_since is None:
            self._window_since = now
            return
        if now - self._window_since < SMOKE_SETTLE_S:
            return
        self._smoke_pid = pid
        self.smoke_check()

    def _adopt(self, pid: int | None) -> None:
        self._pid = pid
        self._app = self.b.application(pid) if pid else None
        self._window_since = None
        if self._app is not None:
            self.b.set_timeout(self._app, self.messaging_timeout_s)

    def _grant_hint(self) -> str:
        if self.bundle:
            name = os.path.basename(self.bundle.rstrip("/"))
            name = name.removesuffix(".app")
            return f'System Settings > Privacy & Security > Accessibility, switch on "{name}"'
        return "grant Accessibility to the app that launched this process (a terminal, when run by hand)"

    # --- dispatch --------------------------------------------------------------------

    def dispatch(self, verb: str, args) -> dict:
        if verb not in self.VERBS:
            raise AxError(UNKNOWN_VERB, f"{verb!r} is not a verb ({', '.join(self.VERBS)})")
        if args is None:
            args = {}
        if not isinstance(args, dict):
            raise AxError(BAD_REQUEST, "args must be an object")
        if not self.b.trusted():
            raise AxError(UNTRUSTED, self._grant_hint())
        app = self._live_app()
        timeout = self._timeout(args)
        self.b.set_timeout(app, timeout)
        return getattr(self, "_" + verb)(app, args, timeout)

    def _live_app(self):
        pid = self.b.live_pid(self._pid)
        if pid is None:
            if self._pid is not None:
                self._adopt(None)
            raise AxError(LIVE_NOT_RUNNING, "Ableton Live is not running")
        if pid != self._pid:
            self._adopt(pid)
        return self._app

    def _timeout(self, args: dict) -> float:
        value = args.get("timeoutS", self.messaging_timeout_s)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= MAX_TIMEOUT_S:
            raise AxError(BAD_REQUEST, f"timeoutS must be a number in (0, {MAX_TIMEOUT_S:g}]")
        return float(value)

    def _wait_ms(self, args: dict, default: int) -> int:
        return _positive_int(args, "timeoutMs", default, 1, MAX_WAIT_MS)

    def _root(self, app, kind: str):
        el = self.b.attr(app, ROOTS[kind])
        if kind in ("main", "focused"):
            # Measured 2026-09-15: AXMainWindow can answer with the application
            # element itself instead of nil (Live not frontmost, no window
            # listed); a search under it finds only the menu bar. That is "no
            # window", never a missing control.
            if el is None or self.b.attr(el, "AXRole") != "AXWindow":
                raise AxError(NO_WINDOW, f"Live reports no {ROOTS[kind]} right now (still launching, minimized, "
                                         "or the screen is locked?)")
            return el
        if el is None:
            raise AxError(MISSING, f"Live has no {ROOTS[kind]}")
        return el

    def _resolve(self, app, args: dict, *, every: bool = False):
        target = target_from_request(args, self.catalog)
        params = args.get("params") or {}
        if not isinstance(params, dict):
            raise AxError(BAD_REQUEST, "params must be an object")
        t0 = self._clock()
        root = self._root(app, target.root)
        found, info = locate(self.b, root, target, params, every=every)
        if target.repeated or every:
            order = args.get("order", "position")
            if order == "position":
                found = grid_order(self.b, found)
            elif order != "tree":
                raise AxError(BAD_REQUEST, "order must be 'position' or 'tree'")
        info["count"] = len(found)
        index = args.get("index")
        if index is not None:
            if isinstance(index, bool) or not isinstance(index, int) or index < 0:
                raise AxError(BAD_REQUEST, "index must be a non-negative integer")
            if index >= len(found):
                raise AxError(MISSING, f"{target.name} index {index}, but {len(found)} showing",
                              target=target.name, count=len(found))
            found = [found[index]]
        elif target.repeated and not every:
            raise AxError(BAD_REQUEST, f"{target.name} repeats ({len(found)} showing): pass index",
                          count=len(found))
        info["lookupMs"] = round((self._clock() - t0) * 1000, 1)
        return target, found, info

    def _one(self, app, args: dict):
        target, found, info = self._resolve(app, args)
        return target, found[0], info

    def _require_enabled(self, el, target) -> None:
        enabled = self.b.attr(el, "AXEnabled")
        if enabled is not None and not bool(enabled):
            raise AxError(DISABLED, f"{target.name} is disabled in Live's UI", target=target.name)

    def _timed(self, fn):
        t0 = self._clock()
        rc = fn()
        return rc, (self._clock() - t0) * 1000

    # --- verbs -----------------------------------------------------------------------

    def _press(self, app, args, timeout):
        target, el, info = self._one(app, args)
        self._require_enabled(el, target)
        self.b.set_timeout(el, timeout)
        until = args.get("until")
        if until is not None and not isinstance(until, dict):
            raise AxError(BAD_REQUEST, "until must be an object")
        result = {"target": target.name, "lookupMs": info["lookupMs"], "visited": info["visited"]}
        if until and "notification" in until:
            notification = self._notification(until)
            wait_ms = self._wait_ms(until, default=2000)
            watch = self._one(app, until)[1] if until.get("target") is not None else app
            with self.b.observer(self._pid, watch, notification) as observer:
                rc, press_ms = self._timed(lambda: self.b.perform(el, "AXPress"))
                check_rc(rc, f"AXPress on {target.name}", press_ms)
                fired = observer.wait(max(0.0, (wait_ms - press_ms) / 1000))
            result["pressMs"] = round(press_ms, 1)
            if fired is None:
                raise AxError(WAIT_TIMEOUT, f"{notification} did not arrive within {wait_ms} ms",
                              pressMs=result["pressMs"])
            result["notifiedMs"] = round(fired, 1)
        else:
            rc, press_ms = self._timed(lambda: self.b.perform(el, "AXPress"))
            check_rc(rc, f"AXPress on {target.name}", press_ms)
            result["pressMs"] = round(press_ms, 1)
            if until:
                result["until"] = self._poll(app, until)
        if args.get("readback"):
            result["value"] = plain(self.b.attr(el, "AXValue"))
        return result

    def _hover(self, app, args, timeout):
        """Put a pointer over a control without moving the real one, for the
        controls Live draws only under a pointer (a Drum Sampler's swap buttons).

        Mouse-moved events, no button, posted to Live's process: a short glide in
        from the element's left edge to `at`, fractions of its frame (the
        target's `hover` point by default). Measured 2026-09-15 with Live not
        frontmost: the Drum Sampler's buttons were in the tree 0.4 s after the
        moves and still there 1.9 s later with nothing more posted. `until` waits
        for what the hover should reveal; a miss re-posts the move once before it
        is an error.
        """
        target, el, info = self._one(app, args)
        at = args.get("at", target.hover)
        if (not isinstance(at, (list, tuple)) or len(at) != 2
                or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1 for v in at)):
            raise AxError(BAD_REQUEST, "at must be two fractions 0-1 of the element's frame"
                          + ("" if target.hover else f" ({target.name} names no hover point)"))
        until = args.get("until")
        if until is not None and not isinstance(until, dict):
            raise AxError(BAD_REQUEST, "until must be an object")
        point, size = self.b.point(el), self.b.size(el)
        if point is None or size is None:
            raise AxError(FAILED, f"{target.name} reports no frame to hover over", target=target.name)
        x, y = point[0] + at[0] * size[0], point[1] + at[1] * size[1]
        start = point[0] + min(self.HOVER_EDGE_INSET, at[0] * size[0])
        t0 = self._clock()
        for i in range(1, self.HOVER_GLIDE_STEPS + 1):
            self._move(start + (x - start) * i / self.HOVER_GLIDE_STEPS, y)
            self._sleep(self.HOVER_STEP_S)
        result = {"target": target.name, "point": [round(x), round(y)], "lookupMs": info["lookupMs"]}
        if until:
            try:
                result["until"] = self._poll(app, until)
            except AxError as e:
                if e.code != WAIT_TIMEOUT:
                    raise
                self._move(x, y)
                result["until"] = self._poll(app, until)
                result["reposted"] = True
        result["ms"] = round((self._clock() - t0) * 1000, 1)
        return result

    def _move(self, x: float, y: float) -> None:
        if not self.b.post_mouse_move(self._pid, x, y):
            raise AxError(FAILED, f"posting a mouse move to Live (pid {self._pid}) at {x:.0f},{y:.0f} failed")

    def _read(self, app, args, timeout):
        every = bool(args.get("all"))
        target, found, info = self._resolve(app, args, every=every)
        with_help = bool(args.get("help"))
        head = {"target": target.name, "visited": info["visited"], "lookupMs": info["lookupMs"]}
        if every:
            return {**head, "count": len(found),
                    "elements": [describe(self.b, el, with_help=with_help) for el in found]}
        out = {**head, **describe(self.b, found[0], with_help=with_help)}
        if args.get("actions"):
            out["actions"] = self.b.actions(found[0])
        extra = args.get("attributes")
        if extra is not None:
            if not isinstance(extra, list) or not all(isinstance(a, str) and a.startswith("AX") for a in extra):
                raise AxError(BAD_REQUEST, "attributes must be a list of AX attribute names")
            out["attributes"] = {name: plain(self.b.attr(found[0], name)) for name in extra[:32]}
            if args.get("settable"):
                # AXUIElementIsAttributeSettable is a question, not a write.
                # Live answers no for the controls whose AXValue a write
                # silently drops (module docstring), so ask before designing a
                # verb around writing one.
                out["settable"] = {name: self.b.settable(found[0], name) for name in extra[:32]}
        elif args.get("settable"):
            raise AxError(BAD_REQUEST, "settable needs attributes to ask about")
        return out

    def _list(self, app, args, timeout):
        return self._read(app, {**args, "all": True}, timeout)

    def _nudge(self, app, args, action: str):
        steps = _positive_int(args, "steps", 1, 1, 100)
        target, el, _ = self._one(app, args)
        self._require_enabled(el, target)
        t0 = self._clock()
        for _ in range(steps):
            rc, ms = self._timed(lambda: self.b.perform(el, action))
            check_rc(rc, f"{action} on {target.name}", ms)
        return {"target": target.name, "steps": steps, "ms": round((self._clock() - t0) * 1000, 1),
                "value": plain(self.b.attr(el, "AXValue"))}

    def _increment(self, app, args, timeout):
        return self._nudge(app, args, "AXIncrement")

    def _decrement(self, app, args, timeout):
        return self._nudge(app, args, "AXDecrement")

    def _menu_item(self, el) -> dict:
        title = plain(self.b.attr(el, "AXTitle")) or ""
        label, checked = parse_menu_title(title)
        enabled = self.b.attr(el, "AXEnabled")
        return {"title": title, "label": label, "checked": checked,
                "enabled": None if enabled is None else bool(enabled)}

    def _open_menu(self, app):
        """The items of the menu Live has open (its context menus and choosers are
        windows of its own, not AXMenu children).

        Focus finds it when Live is the app the user is in. When it is not,
        Live opens the menu and focus stays where it was -- measured
        2026-09-19, and it cost four probes that read as "Live opened no menu"
        against a Live that had opened one every time. So fall back to Live's
        own window list: the menu is a window there either way.
        """
        main = self.b.attr(app, "AXMainWindow")
        focused = self.b.attr(app, "AXFocusedUIElement")
        window = window_of(self.b, focused) if focused is not None else None
        if window is not None and not self.b.same(window, main):
            items = menu_items(self.b, window)
            if items:
                return items
        for other in self.b.attr(app, "AXWindows") or []:
            if self.b.same(other, main):
                continue
            items = menu_items(self.b, other)
            if items:
                return items
        raise AxError(MENU_MISSING, "no menu is open in Live")

    def _show_menu(self, app, args, timeout):
        """Open a control's context menu and list what is in it.

        **A failure dismisses the menu** (2026-09-19). Live's context menus are
        windows of their own, and a press whose menu this verb did not
        recognise used to leave that menu standing over Live: the next
        AXShowMenu then found focus already on a menu window, reported "focus
        did not move", and left a second one up. Four probes in a row failed
        that way against a Live that was working fine. `pick` had escaped from
        its equivalents all along; this is the same rule, and the entry check
        turns the second call of a cascade into a named error instead.
        """
        target, el, _ = self._one(app, args)
        main = self._root(app, "main")
        try:
            self._open_menu(app)
        except AxError:
            pass  # nothing open, which is the normal way in
        else:
            raise AxError(FAILED, "Live already has a menu open (dismiss_menu first)", target=target.name)
        rc, ms = self._timed(lambda: self.b.perform(el, "AXShowMenu"))
        check_rc(rc, f"AXShowMenu on {target.name}", ms)
        deadline = self._clock() + self._wait_ms(args, default=800) / 1000
        while True:
            try:
                items = self._open_menu(app)
            except AxError:
                items = []
            if items:
                return {"target": target.name, "ms": round(ms, 1),
                        "items": [self._menu_item(i) for i in items]}
            if self._clock() >= deadline:
                dismissed = self._dismiss_panel(app, main)
                raise AxError(MENU_MISSING,
                              f"AXShowMenu on {target.name} opened no menu Live lists"
                              + ("; something was up and has been dismissed)" if dismissed else ")"),
                              target=target.name)
            self._sleep(0.02)

    def _pick(self, app, args, timeout):
        label, pattern = args.get("label"), args.get("pattern")
        if not (isinstance(label, str) and label) and not (isinstance(pattern, str) and pattern):
            raise AxError(BAD_REQUEST, "pick needs a label or a pattern")
        try:
            rx = re.compile(pattern) if pattern else None
        except re.error as e:
            raise AxError(BAD_REQUEST, f"bad pattern: {e}") from e
        items = self._open_menu(app)
        described = [(el, self._menu_item(el)) for el in items]
        for el, item in described:
            if (label and item["label"] == label) or (rx and rx.search(item["title"])):
                if item["enabled"] is False:
                    self._escape(app)
                    raise AxError(DISABLED, f"menu item {item['title']!r} is disabled")
                rc, ms = self._timed(lambda el=el: self.b.perform(el, "AXPress"))
                check_rc(rc, f"AXPress on menu item {item['title']!r}", ms)
                return {"picked": item["title"], "ms": round(ms, 1)}
        self._escape(app)
        labels = ", ".join(item["label"] for _, item in described[:40])
        raise AxError(ITEM_MISSING, f"no menu item {label or pattern!r} (the menu had: {labels})")

    def _escape(self, app) -> None:
        self.b.post_key(app, self._pid, ESCAPE_KEY, True)
        self.b.post_key(app, self._pid, ESCAPE_KEY, False)

    def _dismiss_menu(self, app, args, timeout):
        self._escape(app)
        return {"dismissed": True}

    def _save_as_dialog(self, app, args, timeout):
        """Live's Save As panel, named and left open for the performer (ADR-405).

        Raise Live, press Live's own Save Live Set As menu item, wait for the
        panel's name field to take focus instead of sleeping, write the name into
        the field through Accessibility and read it back. Never Return: Enter
        saves, Escape declines.

        No keystrokes, by measurement (2026-09-15): Cmd+Shift+S posted to Live's
        process opened the panel, but the Cmd+A and the name posted after it
        never reached the name field — it still read "Untitled" a second later —
        and a keystroke that misses the field is a keystroke into Live. The
        reply's `fieldPid` names the process the field belongs to.

        **Every failure after the menu press dismisses the panel** (swap audit
        H3). Four raise points sat between the press and the reply — focus not
        landing, a field that will not take a value, a write Live refuses, and a
        readback that never matches — and none of them escaped, while the
        sibling `_pick` had escaped from its equivalents all along. The panel is
        modal: it stays up over the performance, and the next transport stop
        pressing Save Live Set As again finds a menu Live has disabled. Escape
        goes out only when a panel is actually up, so a press that opened
        nothing does not send Escape into Live's own window.
        """
        name = args.get("name")
        if (not isinstance(name, str) or not 0 < len(name) <= 200 or "/" in name
                or any(ord(c) < 32 for c in name)):
            raise AxError(BAD_REQUEST, "name must be 1-200 printable characters without '/'")
        wait_ms = self._wait_ms(args, default=3000)
        main = self._root(app, "main")
        target, item, _ = self._one(app, {"target": "menu.save_as"})
        self._require_enabled(item, target)
        t0 = self._clock()
        check_rc(self.b.set_attr(app, "AXFrontmost", True), "raising Live to the front")
        rc, press_ms = self._timed(lambda: self.b.perform(item, "AXPress"))
        check_rc(rc, f"AXPress on {target.title}", press_ms)
        try:
            field = self._focused_panel_field(app, main, wait_ms)
            panel_ms = (self._clock() - t0) * 1000
            if not self.b.settable(field, "AXValue"):
                raise AxError(FAILED, "the Save As name field does not take a value through Accessibility")
            check_rc(self.b.set_attr(field, "AXValue", name), "writing the name into the Save As field")
            deadline = self._clock() + 1.0
            while True:
                value = plain(self.b.attr(field, "AXValue"))
                if value == name:
                    break
                if self._clock() >= deadline:
                    raise AxError(FAILED, f"the Save As name field reads {value!r} after writing {name!r}")
                self._sleep(0.02)
        except AxError as e:
            dismissed = self._dismiss_panel(app, main)
            e.detail = "%s (the panel %s)" % (
                e.detail, "was dismissed" if dismissed else "was not up, nothing to dismiss",
            )
            raise
        return {"name": name, "field": value, "fieldPid": self.b.element_pid(field), "livePid": self._pid,
                "panelMs": round(panel_ms, 1), "ms": round((self._clock() - t0) * 1000, 1)}

    def _select(self, app, args, timeout):
        """Select rows in a container by writing its AXSelectedRows.

        Live's track headers are an AXOutline of AXRows, which is what makes a
        multi-track selection reachable without a click: measured 2026-09-19,
        the outline answers AXUIElementIsAttributeSettable yes for
        AXSelectedRows, while a row's own AXSelected is not settable and
        AXSelectedChildren is not either. So the whole selection goes out as one
        write on the container, never row by row.

        `members` is a list of requests shaped like any other target lookup, in
        the order they should be selected; each is resolved the same way `press`
        resolves its one element. The write is read back against what was asked
        for before the verb answers -- settable is a promise about the
        attribute, not about Live honoring it.

        **Measured unreliable, and not usably so** (2026-09-19 to 2026-09-20).
        It moved Live's own selection exactly once, in an early trial (a
        two-row write was followed by Live pluralising its track-header
        context menu -- "Freeze Tracks", "Bounce Tracks in Place" -- and
        dropping the single-track-only "Edit Info Text"). Every theory tried to
        explain the rest as conditional -- Live frontmost or not (checked two
        ways: System Events and Live's own `AXFrontmost`), a menu open between
        writes, write pacing from 0.3s to 2s apart -- was ruled out with a
        controlled, hands-off rerun that still scored 0 of 8. Kept for what it
        still demonstrates (a container write beats a per-row one) and because
        the readback discipline is the right shape for whatever verb replaces
        it; `press_key`'s Shift+Arrow route is the one now being tried instead.
        A caller must treat `ax-action-failed` as the expected outcome, not a
        broken rig.
        """
        target, container, info = self._one(app, args)
        members = args.get("members")
        if not isinstance(members, list) or not 0 < len(members) <= self.MAX_SELECTION:
            raise AxError(BAD_REQUEST, f"members must be a list of 1-{self.MAX_SELECTION} target requests")
        if not all(isinstance(m, dict) for m in members):
            raise AxError(BAD_REQUEST, "each member must be a target request object")
        t0 = self._clock()
        wanted = [self._one(app, m)[1] for m in members]
        rows = list(self.b.attr(container, "AXRows") or [])
        before = list(self.b.attr(container, "AXSelectedRows") or [])
        if not self.b.settable(container, "AXSelectedRows"):
            raise AxError(FAILED, f"{target.name} does not take AXSelectedRows through Accessibility",
                          target=target.name)
        written = self._clock()
        check_rc(self.b.set_attr(container, "AXSelectedRows", wanted),
                 f"writing {len(wanted)} selected rows to {target.name}")
        # Live takes the write and rebuilds its selection on its own thread: an
        # immediate read answers the old selection, an empty one, or part of the
        # new one (measured 2026-09-19 -- a three-row write read back two, then
        # a two-row write read back none, from a Live that had taken both). Poll
        # for it, like the Save As field.
        deadline = self._clock() + self._wait_ms(args, default=SELECT_SETTLE_MS) / 1000
        while True:
            got = list(self.b.attr(container, "AXSelectedRows") or [])
            if len(got) == len(wanted) and all(any(self.b.same(g, w) for g in got) for w in wanted):
                break
            if self._clock() >= deadline:
                raise AxError(FAILED, f"{target.name} holds {len(got)} selected rows after asking for "
                                      f"{len(wanted)}", target=target.name, count=len(got))
            self._sleep(0.02)
        return {"target": target.name, "count": len(got), "replaced": self._row_indices(rows, before),
                "settledMs": round((self._clock() - written) * 1000, 1),
                "lookupMs": info["lookupMs"], "ms": round((self._clock() - t0) * 1000, 1)}

    def _row_indices(self, rows: list, selection: list) -> list:
        """Where a selection sat in the container's AXRows, so a caller can put it
        back. Live's rows do not answer AXSelected (measured: every row reads
        false while AXSelectedRows holds one), so position is the only handle."""
        out = []
        for el in selection:
            for i, row in enumerate(rows):
                if self.b.same(row, el):
                    out.append(i)
                    break
        return out

    def _focus(self, app, args, timeout):
        """Give a control keyboard focus by setting AXFocused -- the proven way to
        select something in Live with no pointer (the Meld mod-matrix research,
        2026-09-16/17): AXFocused=True on a knob made it Live's selected
        parameter within ~0.5s, even with Live off-Space and another app
        frontmost. AXPress and a raw attribute write on a container (`select`)
        were both tried for track-row selection and neither held up; this is
        the one technique with a track record.

        Read back and polled like `select`, for the same reason: settable is a
        promise about the attribute, not about Live doing anything with it.
        """
        target, el, info = self._one(app, args)
        if not self.b.settable(el, "AXFocused"):
            raise AxError(FAILED, f"{target.name} does not take AXFocused through Accessibility",
                          target=target.name)
        t0 = self._clock()
        check_rc(self.b.set_attr(el, "AXFocused", True), f"focusing {target.name}")
        deadline = self._clock() + self._wait_ms(args, default=1000) / 1000
        while True:
            if bool(self.b.attr(el, "AXFocused")):
                break
            if self._clock() >= deadline:
                raise AxError(FAILED, f"{target.name} did not take focus", target=target.name)
            self._sleep(0.02)
        return {"target": target.name, "lookupMs": info["lookupMs"], "ms": round((self._clock() - t0) * 1000, 1)}

    def _press_key(self, app, args, timeout):
        """Post a real key, held under an optional modifier -- `key_char=0`, a
        virtual keycode, down then up, exactly the shape `_escape` has always
        used for Escape. This is new territory for the helper beyond Escape,
        so the keys it can send are the same short whitelist the module
        docstring names: the arrow keys, with Shift the only modifier.

        Built to test one specific hypothesis (2026-09-20): does Live's track
        outline honour Shift+Arrow range-select the way an ordinary Cocoa list
        view does, once a row holds focus (see `focus`)? `select`'s
        AXSelectedRows write does not reliably move Live's selection at all;
        this goes through the same input path a real keypress would, which is
        the thing that has actually worked so far (Meld's AXFocused, and typing
        exact values into its matrix cells both went through real key/attribute
        events, never a container-level array write).

        No readback: `press_key` only says the keys went out, the same way
        `hover`'s mouse moves do. A caller reads whatever attribute it expects
        to have changed afterward.
        """
        key = args.get("key")
        if key not in ARROW_KEYS:
            raise AxError(BAD_REQUEST, f"key must be one of {sorted(ARROW_KEYS)}")
        modifiers = args.get("modifiers") or []
        if not isinstance(modifiers, list) or not all(m in MODIFIER_KEYS for m in modifiers):
            raise AxError(BAD_REQUEST, f"modifiers must be a list drawn from {sorted(MODIFIER_KEYS)}")
        t0 = self._clock()
        mod_codes = [MODIFIER_KEYS[m] for m in modifiers]
        for code in mod_codes:
            self.b.post_key(app, self._pid, code, True)
        rc_down = self.b.post_key(app, self._pid, ARROW_KEYS[key], True)
        rc_up = self.b.post_key(app, self._pid, ARROW_KEYS[key], False)
        for code in reversed(mod_codes):
            self.b.post_key(app, self._pid, code, False)
        check_rc(rc_down, f"pressing {key}")
        check_rc(rc_up, f"releasing {key}")
        return {"key": key, "modifiers": modifiers, "ms": round((self._clock() - t0) * 1000, 1)}

    def _click(self, app, args, timeout):
        """A real left click -- down then up -- at a point on a control,
        optionally Cmd- or Shift-held: the one input that has actually driven
        Live's own multi-track selection by hand all along (2026-09-20). Tried
        last, not first: `select`'s AXSelectedRows write and `press_key`'s
        Shift+Arrow were both measured not to move Live's real selection, so
        this goes through the same input path a person's mouse does rather
        than asking an attribute or a key to stand in for one.

        `at` is the point to click, as fractions of the element's frame
        (default the center, since a track header's own hotspot isn't a
        control with a stated hover point the way a Drum Sampler's swap
        buttons are). No readback: like `press_key`, this only says the click
        went out. A caller reads whatever attribute it expects to have
        changed -- `tracks.headers`'s AXSelectedRows, here.
        """
        target, el, info = self._one(app, args)
        at = args.get("at", (0.5, 0.5))
        if (not isinstance(at, (list, tuple)) or len(at) != 2
                or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1 for v in at)):
            raise AxError(BAD_REQUEST, "at must be two fractions 0-1 of the element's frame")
        modifiers = args.get("modifiers") or []
        if not isinstance(modifiers, list) or not all(m in CLICK_MODIFIERS for m in modifiers):
            raise AxError(BAD_REQUEST, f"modifiers must be a list drawn from {sorted(CLICK_MODIFIERS)}")
        point, size = self.b.point(el), self.b.size(el)
        if point is None or size is None:
            raise AxError(FAILED, f"{target.name} reports no frame to click", target=target.name)
        x, y = point[0] + at[0] * size[0], point[1] + at[1] * size[1]
        t0 = self._clock()
        if not self.b.click(self._pid, x, y, tuple(modifiers)):
            raise AxError(FAILED, f"posting a click to Live (pid {self._pid}) at {x:.0f},{y:.0f} failed")
        return {"target": target.name, "point": [round(x), round(y)], "modifiers": modifiers,
                "lookupMs": info["lookupMs"], "ms": round((self._clock() - t0) * 1000, 1)}

    RESTORE_SETTLE_S = 0.05  # give Live a moment to act on the click before the cursor jumps away

    def _system_click(self, app, args, timeout):
        """A real left click through the global HID event stream (CGEventPost,
        not CGEventPostToPid): `click` posted to Live's process alone and was
        measured to do nothing at all, on two different controls in two
        different sessions. The Meld mod-matrix research's one thing that DID
        register as a real click went through the global stream instead
        (computer-use's zero-length drag), and needed Live's window on the
        current Space to do it -- so this raises Live to the front first, the
        same `AXFrontmost` write `save_as_dialog` already uses.

        **This moves the real system pointer, at absolute screen coordinates,
        outside Live's process boundary.** Every other verb either stays
        inside Live (AXPress, an attribute write, a CGEventPostToPid click) or
        only moves the pointer with no button (`hover`). A stray click here
        can land on whatever the window server finds at that point on screen,
        not on Live specifically. So immediately before clicking: Live is
        re-raised to the front (not assumed still there from an earlier call),
        and a panel already up refuses the click rather than blind-firing into
        it. The cursor is put back exactly where it was found once Live has
        had a moment to act on the click -- never left at the click point.

        **Confirmed working, not confirmed perfectly reliable** (2026-09-20).
        Both a plain click and a Cmd-held one moved Live's real selection --
        the Cmd case independently confirmed by Live's own context menu
        pluralising ("Freeze Tracks") and offering an enabled "Group Tracks",
        not just this verb's readback. But of five single clicks tried in one
        session, two did not register at all (the selection stayed exactly as
        it was) with no error and no distinguishing feature in the reply --
        clearly better than `click`'s CGEventPostToPid (0 of 2 registered
        anything, ever), not yet good enough to trust blind. A caller should
        read back what it expected to change and retry on a miss, the same
        discipline `select` already has for its own write.

        Also worth knowing before reading anything off `AXFocused` after this:
        it is transient, not a standing record of the selection. A row read
        True right after being clicked, then False shortly after with the
        outline's own AXSelectedRows still holding it -- AXFocused answers
        "did this just take keyboard focus," not "is this part of the current
        selection." AXSelectedRows (or Live's own menu) is the only ground
        truth for the latter.
        """
        target, el, info = self._one(app, args)
        at = args.get("at", (0.5, 0.5))
        if (not isinstance(at, (list, tuple)) or len(at) != 2
                or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1 for v in at)):
            raise AxError(BAD_REQUEST, "at must be two fractions 0-1 of the element's frame")
        modifiers = args.get("modifiers") or []
        if not isinstance(modifiers, list) or not all(m in CLICK_MODIFIERS for m in modifiers):
            raise AxError(BAD_REQUEST, f"modifiers must be a list drawn from {sorted(CLICK_MODIFIERS)}")
        main = self._root(app, "main")
        if self._panel_is_up(app, main):
            raise AxError(FAILED, "Live has a panel or menu up; refusing to click blind")
        point, size = self.b.point(el), self.b.size(el)
        if point is None or size is None:
            raise AxError(FAILED, f"{target.name} reports no frame to click", target=target.name)
        x, y = point[0] + at[0] * size[0], point[1] + at[1] * size[1]
        t0 = self._clock()
        check_rc(self.b.set_attr(app, "AXFrontmost", True), "raising Live to the front")
        before = self.b.cursor_position()
        if not self.b.system_click(x, y, tuple(modifiers)):
            raise AxError(FAILED, f"posting a system click at {x:.0f},{y:.0f} failed")
        self._sleep(self.RESTORE_SETTLE_S)
        self.b.system_move(*before)
        return {"target": target.name, "point": [round(x), round(y)], "modifiers": modifiers,
                "restoredTo": [round(before[0]), round(before[1])],
                "lookupMs": info["lookupMs"], "ms": round((self._clock() - t0) * 1000, 1)}

    def _frame_point(self, target, el, at, at_key):
        if (not isinstance(at, (list, tuple)) or len(at) != 2
                or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1 for v in at)):
            raise AxError(BAD_REQUEST, f"{at_key} must be two fractions 0-1 of the element's frame")
        point, size = self.b.point(el), self.b.size(el)
        if point is None or size is None:
            raise AxError(FAILED, f"{target.name} reports no frame to drag", target=target.name)
        return point[0] + at[0] * size[0], point[1] + at[1] * size[1]

    def _system_drag(self, app, args, timeout):
        """Hold the button down and move from one row to another -- the one
        way to change a track's position or its group membership at all.
        Live's LOM has no track-move call (see `handlers/liveGroupTracks.js`'s
        module docstring on why grouping itself goes through Accessibility),
        and dragging a track header onto or into an existing group is Live's
        own native way to add a member **without dissolving the group** --
        unlike this project's own group/merge path, which has to ungroup and
        re-group because Live's `Group Tracks` command always nests. A
        dissolved-and-recreated group loses anything on its own chain (sends,
        a bus compressor); a drag never touches the group at all.

        `from_`/`to` are each a target request, resolved exactly like
        `system_click`'s target; `atFrom`/`atTo` are fractions 0-1 of that
        element's own frame, defaulting to its center. Interpolated over
        `steps` (default the same glide `hover` uses) `kCGEventLeftMouseDragged`
        steps, not a teleport straight from A to B: an app that decides "is
        this a drag" from watching the button stay down across real
        intervening movement, the way Live's own header reorder plausibly
        does, would not necessarily recognize a single jump as one.

        Same safety discipline as `system_click`: raises Live to the front
        first, refuses a panel already up, restores the cursor afterward.
        **Not yet measured at all** -- `system_click`'s own miss rate (2 of 5
        single clicks in one session) is the floor to expect, not a ceiling;
        a caller needs to read back where the track actually landed and
        retry on a miss, the same discipline every other write here already
        has, once there is a dump to read that back against.
        """
        from_target, from_el, from_info = self._one(app, args.get("from") or {})
        to_target, to_el, to_info = self._one(app, args.get("to") or {})
        x1, y1 = self._frame_point(from_target, from_el, args.get("atFrom", (0.5, 0.5)), "atFrom")
        x2, y2 = self._frame_point(to_target, to_el, args.get("atTo", (0.5, 0.5)), "atTo")
        main = self._root(app, "main")
        if self._panel_is_up(app, main):
            raise AxError(FAILED, "Live has a panel or menu up; refusing to drag blind")
        steps = _positive_int(args, "steps", self.HOVER_GLIDE_STEPS, 1, 100)
        t0 = self._clock()
        check_rc(self.b.set_attr(app, "AXFrontmost", True), "raising Live to the front")
        before = self.b.cursor_position()
        self.b.system_move(x1, y1)
        if not self.b.system_mouse_down(x1, y1):
            raise AxError(FAILED, f"posting a system mouse-down at {x1:.0f},{y1:.0f} failed")
        for i in range(1, steps + 1):
            sx, sy = x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps
            if not self.b.system_mouse_dragged(sx, sy):
                raise AxError(FAILED, f"posting a dragged move at {sx:.0f},{sy:.0f} failed")
            self._sleep(self.HOVER_STEP_S)
        if not self.b.system_mouse_up(x2, y2):
            raise AxError(FAILED, f"posting a system mouse-up at {x2:.0f},{y2:.0f} failed")
        self._sleep(self.RESTORE_SETTLE_S)
        self.b.system_move(*before)
        return {"from": from_target.name, "to": to_target.name,
                "fromPoint": [round(x1), round(y1)], "toPoint": [round(x2), round(y2)],
                "restoredTo": [round(before[0]), round(before[1])],
                "lookupMs": from_info["lookupMs"] + to_info["lookupMs"],
                "ms": round((self._clock() - t0) * 1000, 1)}

    def _system_key(self, app, args, timeout):
        """A real keystroke through the global HID event stream (CGEventPost):
        Live's own menu item names its keyboard shortcut ("Group Tracks,
        ⌘G"), so this invokes the command directly -- unlike `show_menu` +
        `pick`, no menu is ever opened, ever visible on screen. The ask this
        exists for (2026-09-20): grouping tracks from the iPad should not
        interrupt Live's own screen while the performer is working.

        **Riskier than `system_click` in one specific way.** A click at least
        lands on a screen coordinate Live's own window occupies; a global
        keystroke goes to whichever app currently holds keyboard focus,
        system-wide, with no coordinate to anchor it. So this does not just
        set AXFrontmost and fire -- it polls for Live's own AXFrontmost to
        read back true first, and refuses rather than sending a keystroke
        blind if that never happens. A panel or menu already up refuses too,
        the same guard `system_click` has.
        """
        key = args.get("key")
        if key not in SYSTEM_KEYS:
            raise AxError(BAD_REQUEST, f"key must be one of {sorted(SYSTEM_KEYS)}")
        modifiers = args.get("modifiers") or []
        if not isinstance(modifiers, list) or not all(m in CLICK_MODIFIERS for m in modifiers):
            raise AxError(BAD_REQUEST, f"modifiers must be a list drawn from {sorted(CLICK_MODIFIERS)}")
        main = self._root(app, "main")
        if self._panel_is_up(app, main):
            raise AxError(FAILED, "Live has a panel or menu up; refusing to send a keystroke blind")
        t0 = self._clock()
        check_rc(self.b.set_attr(app, "AXFrontmost", True), "raising Live to the front")
        deadline = self._clock() + self._wait_ms(args, default=1000) / 1000
        while not bool(self.b.attr(app, "AXFrontmost")):
            if self._clock() >= deadline:
                raise AxError(FAILED, "Live never confirmed AXFrontmost; refusing to send a keystroke blind")
            self._sleep(0.02)
        if not self.b.system_key(SYSTEM_KEYS[key], tuple(modifiers)):
            raise AxError(FAILED, f"posting a system keystroke ({key}) failed")
        return {"key": key, "modifiers": modifiers, "ms": round((self._clock() - t0) * 1000, 1)}

    def _panel_state(self, app, args, timeout):
        """Whether Live has a modal panel up right now (swap audit H3).

        `save_as_dialog` succeeds by *leaving the panel open* for the performer
        to accept or decline, so the bridge's `saveAsInFlight` guard — which it
        releases when the helper replies — drops while the panel is still up.
        The next transport stop then consumes a counter value and presses Save
        Live Set As again behind a modal panel. The bridge polls this instead.

        Read-only, and cheap: a sheet check on the main window plus the window
        list.
        """
        return {"open": self._panel_is_up(app, self._root(app, "main"))}

    def _panel_is_up(self, app, main) -> bool:
        """True when Live has a modal panel: a sheet on its main window, or a
        window that is not the main one. Never raises — it runs on the way out
        of an error, and a diagnosis that throws would replace the real one.

        Measured 2026-09-21: native macOS fullscreen leaves a second, inert
        entry in `AXWindows` for as long as Live occupies its own Space — the
        pre-fullscreen frame, kept alive off-screen. It reports `AXSubrole
        "AXUnknown"` with no title, never a real title or standard subrole, so
        it is excluded by that signature alone. Without this, every group-drag
        on a fullscreened Live refused itself as "a panel or menu is up" —
        the ghost window was there on every check, panel or not — while the
        exact same gesture worked fine with Live in a normal window."""
        try:
            for kid in self.b.children(main):
                if self.b.attr(kid, "AXRole") == "AXSheet":
                    return True
            windows = self.b.attr(app, "AXWindows") or []
            for window in windows:
                if self.b.same(window, main):
                    continue
                if self.b.attr(window, "AXSubrole") == "AXUnknown" and not self.b.attr(window, "AXTitle"):
                    continue
                return True
        except Exception:  # noqa: BLE001 - see the docstring
            return False
        return False

    def _dismiss_panel(self, app, main) -> bool:
        """Escape a panel that is up. ``True`` when one was. Never raises."""
        if not self._panel_is_up(app, main):
            return False
        try:
            self._escape(app)
        except Exception as e:  # noqa: BLE001 - see `_panel_is_up`
            self.log.warning("save_as: could not dismiss Live's panel: %s: %s", type(e).__name__, e)
            return False
        self.log.info("save_as: failed with the panel up; Escape sent")
        return True

    def _focused_panel_field(self, app, main, wait_ms: int):
        """The text field focus lands in when Live's Save As panel opens: the
        panel's own name field, or any field in a sheet or another window."""
        deadline = self._clock() + wait_ms / 1000
        while True:
            focused = self.b.attr(app, "AXFocusedUIElement")
            if focused is not None and self.b.attr(focused, "AXRole") == "AXTextField":
                identifier = plain(self.b.attr(focused, "AXIdentifier")) or ""
                window = window_of(self.b, focused)
                if (identifier == "saveAsNameTextField" or self._inside(focused, "AXSheet")
                        or (window is not None and not self.b.same(window, main))):
                    return focused
            if self._clock() >= deadline:
                raise AxError(WAIT_TIMEOUT, f"Live's Save As panel did not take focus within {wait_ms} ms")
            self._sleep(0.03)

    def _inside(self, el, role: str, limit: int = 60) -> bool:
        el = self.b.attr(el, "AXParent")
        while el is not None and limit > 0:
            if self.b.attr(el, "AXRole") == role:
                return True
            el = self.b.attr(el, "AXParent")
            limit -= 1
        return False

    def _notification(self, args: dict) -> str:
        name = args.get("notification")
        if not isinstance(name, str) or not name.startswith("AX"):
            raise AxError(BAD_REQUEST, "notification must be an AX notification name")
        return name

    def _wait_for(self, app, args, timeout):
        if "notification" in args:
            notification = self._notification(args)
            wait_ms = self._wait_ms(args, default=2000)
            watch = self._one(app, args)[1] if args.get("target") is not None else app
            with self.b.observer(self._pid, watch, notification) as observer:
                fired = observer.wait(wait_ms / 1000)
            if fired is None:
                raise AxError(WAIT_TIMEOUT, f"{notification} did not arrive within {wait_ms} ms")
            return {"notification": notification, "ms": round(fired, 1)}
        return self._poll(app, args)

    def _poll(self, app, cond: dict) -> dict:
        """Wait until a control shows (`exists`), or one of its attributes `equals` a value."""
        wait_ms = self._wait_ms(cond, default=2000)
        interval = _positive_int(cond, "intervalMs", 20, 5, 1000)
        attribute = cond.get("attribute", "AXValue")
        if not isinstance(attribute, str) or not attribute.startswith("AX"):
            raise AxError(BAD_REQUEST, "attribute must be an AX attribute name")
        exists, equals = cond.get("exists"), cond.get("equals")
        if exists is None and equals is None:
            raise AxError(BAD_REQUEST, "wait_for needs exists, equals or notification")
        t0 = self._clock()
        deadline = t0 + wait_ms / 1000
        while True:
            try:
                _, el, _ = self._one(app, cond)
                present, value = True, plain(self.b.attr(el, attribute))
            except AxError as e:
                if e.code != MISSING:
                    raise
                present, value = False, None
            ms = round((self._clock() - t0) * 1000, 1)
            if equals is None and present == bool(exists):
                return {"ms": ms, "exists": present}
            if equals is not None and present and _matches(value, equals):
                return {"ms": ms, "value": value}
            if self._clock() >= deadline:
                last = value if present else "(not showing)"
                raise AxError(WAIT_TIMEOUT, f"{cond.get('target')!r} not as wanted within {wait_ms} ms (last: {last})",
                              last=last)
            self._sleep(interval / 1000)

    def _smoke(self, app, args, timeout):
        return self.smoke_check()

    def _dump(self, app, args, timeout):
        """Read-only diagnosis: the nodes under a root (to `depth`), or only those
        whose role / identifier / description / title match `match`. Replaces the
        Terminal `.command` probe recipe once the helper is trusted."""
        root_kind = args.get("root", "main")
        if root_kind not in ROOTS:
            raise AxError(BAD_REQUEST, f"root must be one of {sorted(ROOTS)}")
        depth = _positive_int(args, "depth", 60, 0, 200)
        limit = _positive_int(args, "limit", 300, 1, 5000)
        pattern = args.get("match")
        try:
            rx = re.compile(pattern, re.IGNORECASE) if pattern else None
        except (re.error, TypeError) as e:
            raise AxError(BAD_REQUEST, f"bad match pattern: {e}") from e
        t0 = self._clock()
        root = self._root(app, root_kind)
        nodes, visited, stack = [], 0, [(root, 0)]
        while stack and visited < NODE_BUDGET:
            el, d = stack.pop()
            visited += 1
            fields = {
                "role": plain(self.b.attr(el, "AXRole")),
                "identifier": plain(self.b.attr(el, "AXIdentifier")) or None,
                "description": plain(self.b.attr(el, "AXDescription")) or None,
                "title": plain(self.b.attr(el, "AXTitle")) or None,
            }
            text = " ".join(str(v) for v in fields.values() if v)
            if (rx is None or rx.search(text)) and len(nodes) < limit:
                point = self.b.point(el)
                nodes.append({"depth": d, **fields,
                              "position": None if point is None else [round(point[0]), round(point[1])]})
            if d < depth:
                stack.extend((kid, d + 1) for kid in reversed(self.b.children(el)))
        return {"root": root_kind, "visited": visited, "count": len(nodes),
                "ms": round((self._clock() - t0) * 1000, 1), "app": self._window_summary(app), "nodes": nodes}

    def _window_summary(self, app) -> dict:
        def brief(el):
            if el is None:
                return None
            return {k: plain(self.b.attr(el, a)) for k, a in
                    (("role", "AXRole"), ("subrole", "AXSubrole"), ("title", "AXTitle"))}

        return {
            "frontmost": plain(self.b.attr(app, "AXFrontmost")),
            "hidden": plain(self.b.attr(app, "AXHidden")),
            "mainWindow": brief(self.b.attr(app, "AXMainWindow")),
            "focusedWindow": brief(self.b.attr(app, "AXFocusedWindow")),
            "windows": [brief(w) for w in (self.b.attr(app, "AXWindows") or [])][:12],
        }

    def smoke_check(self) -> dict:
        """Look up every catalog control once. A control with no context that is
        missing is logged as an error: most likely a Live update renamed it."""
        report = {"at": int(time.time() * 1000), "livePid": self._pid, "ok": [], "missing": [], "notShowing": []}
        for target in self.catalog.values():
            keys = _PLACEHOLDER.findall((target.identifier or "") + (target.within or ""))
            params = {key: 0 for key in keys}
            try:
                root = self._root(self._app, target.root)
                locate(self.b, root, target, params, every=target.repeated)
                report["ok"].append(target.name)
            except AxError as e:
                entry = {"name": target.name, "code": e.code, "detail": e.detail}
                if target.context is None:
                    report["missing"].append(entry)
                    self.log.error("smoke: MISSING %s: %s (did a Live update rename it?)", target.name, e.detail)
                else:
                    report["notShowing"].append(entry)
                    self.log.info("smoke: %s not showing now (needs %s)", target.name, target.context)
        self.log.info("smoke: %d ok, %d missing, %d not showing",
                      len(report["ok"]), len(report["missing"]), len(report["notShowing"]))
        self._smoke_report = report
        return report
