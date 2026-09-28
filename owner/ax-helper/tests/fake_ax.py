"""A fake Accessibility backend and a Live-shaped tree for the helper's tests."""

from __future__ import annotations


class El:
    def __init__(self, role, *, identifier=None, description=None, title=None, value=None, enabled=True,
                 pos=(0.0, 0.0), size=(10.0, 10.0), actions=("AXPress", "AXShowMenu"), children=(), **extra):
        self.attrs = {"AXRole": role, "AXIdentifier": identifier, "AXDescription": description,
                      "AXTitle": title, "AXValue": value, "AXEnabled": enabled, **extra}
        self.pos, self.size, self.acts = pos, size, list(actions)
        self.kids, self.parent = [], None
        self.performed: list[str] = []
        self.rc: dict[str, int] = {}
        self.hooks: dict = {}
        self.add(*children)

    def add(self, *kids):
        for kid in kids:
            kid.parent = self
            self.kids.append(kid)
        return self

    def __repr__(self):
        return f"El({self.attrs['AXRole']}, {self.attrs['AXIdentifier'] or self.attrs['AXDescription']})"


class FakeObserver:
    def __init__(self, backend, element, notification):
        self.backend, self.element, self.notification = backend, element, notification
        backend.observers.append(self)

    def wait(self, timeout_s):
        return 12.5 if (self.element, self.notification) in self.backend.posted else None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.backend.observers.remove(self)
        return False


class FakeBackend:
    def __init__(self, window, *, trusted=True, pid=4242, menubar=None):
        self.window = window
        self.windows = [window]  # Live's AXWindows; a context menu or panel is a second one
        self.menubar = menubar
        self.app = El("AXApplication")
        self.app_frontmost = False  # what AXFrontmost reads on `app`
        self.frontmost_stuck = False  # True: set_attr(app, "AXFrontmost", ...) never takes
        self.focused = None
        self.focused_window = None
        self.is_trusted = trusted
        self.prompted = False
        self.pid = pid
        self.timeouts: list[float] = []
        self.keys: list[tuple[int, bool]] = []
        self.set_calls: list[tuple] = []
        self.visits = 0
        self.posted: set = set()
        self.observers: list[FakeObserver] = []
        self.moves: list[tuple[int, float, float]] = []
        self.on_move = None  # (backend, x, y) -> None: what Live does under the pointer
        self.move_ok = True
        self.clicks: list[tuple[int, float, float, tuple]] = []
        self.on_click = None  # (backend, x, y, modifiers) -> None: what Live does when clicked
        self.click_ok = True
        self.cursor = (111.0, 222.0)  # where the "real" pointer starts, for system_click's restore
        self.system_moves: list[tuple[float, float]] = []
        self.system_clicks: list[tuple[float, float, tuple]] = []
        self.on_system_click = None  # (backend, x, y, modifiers) -> None
        self.system_click_ok = True
        self.system_mouse_downs: list[tuple[float, float]] = []
        self.system_mouse_draggeds: list[tuple[float, float]] = []
        self.system_mouse_ups: list[tuple[float, float]] = []
        self.on_system_drag_end = None  # (backend, x1, y1, x2, y2) -> None: what Live does after a drag
        self.system_mouse_down_ok = True
        self.system_mouse_dragged_ok = True
        self.system_mouse_up_ok = True
        self.system_keys: list[tuple[int, tuple]] = []
        self.on_system_key = None  # (backend, keycode, modifiers) -> None
        self.system_key_ok = True

    def trusted(self, prompt=False):
        self.prompted = self.prompted or prompt
        return self.is_trusted

    def live_pid(self, hint=None):
        return self.pid

    def application(self, pid):
        return self.app

    def attr(self, el, name):
        if el is self.app:
            if name == "AXFrontmost":
                return self.app_frontmost
            return {"AXMainWindow": self.window, "AXMenuBar": self.menubar,
                    "AXFocusedWindow": self.focused_window, "AXFocusedUIElement": self.focused,
                    "AXWindows": self.windows}.get(name)
        if name == "AXChildren":
            return list(el.kids)
        if name == "AXParent":
            return el.parent
        return el.attrs.get(name)

    def children(self, el):
        self.visits += 1
        return list(el.kids)

    def actions(self, el):
        return list(el.acts)

    def perform(self, el, action):
        el.performed.append(action)
        hook = el.hooks.get(action)
        if hook is not None:
            hook(self)
        return el.rc.get(action, 0)

    def settable(self, el, name):
        return el is not self.app and bool(el.attrs.get(f"{name}Settable"))

    def set_attr(self, el, name, value):
        self.set_calls.append((el, name, value))
        if el is self.app and name == "AXFrontmost":
            # `frontmost_stuck`: simulate Live never actually confirming, the
            # failure mode `system_key`'s poll guards against.
            if not self.frontmost_stuck:
                self.app_frontmost = bool(value)
            return 0
        if self.settable(el, name):
            el.attrs[name] = value
        return 0

    def set_timeout(self, el, seconds):
        self.timeouts.append(seconds)
        return 0

    def same(self, a, b):
        return a is b

    def point(self, el):
        return el.pos

    def size(self, el):
        return el.size

    def post_key(self, app, pid, keycode, down):
        self.keys.append((keycode, down))
        return 0

    def post_mouse_move(self, pid, x, y):
        self.moves.append((pid, x, y))
        if self.move_ok and self.on_move is not None:
            self.on_move(self, x, y)
        return self.move_ok

    def click(self, pid, x, y, modifiers=()):
        self.clicks.append((pid, x, y, tuple(modifiers)))
        if self.click_ok and self.on_click is not None:
            self.on_click(self, x, y, modifiers)
        return self.click_ok

    def cursor_position(self):
        return self.cursor

    def system_move(self, x, y):
        self.system_moves.append((x, y))
        self.cursor = (x, y)

    def system_click(self, x, y, modifiers=()):
        self.system_clicks.append((x, y, tuple(modifiers)))
        self.cursor = (x, y)
        if self.system_click_ok and self.on_system_click is not None:
            self.on_system_click(self, x, y, modifiers)
        return self.system_click_ok

    def system_mouse_down(self, x, y):
        self.system_mouse_downs.append((x, y))
        self._drag_start = (x, y)
        self.cursor = (x, y)
        return self.system_mouse_down_ok

    def system_mouse_dragged(self, x, y):
        self.system_mouse_draggeds.append((x, y))
        self.cursor = (x, y)
        return self.system_mouse_dragged_ok

    def system_mouse_up(self, x, y):
        self.system_mouse_ups.append((x, y))
        self.cursor = (x, y)
        if self.system_mouse_up_ok and self.on_system_drag_end is not None:
            start = getattr(self, "_drag_start", (x, y))
            self.on_system_drag_end(self, start[0], start[1], x, y)
        return self.system_mouse_up_ok

    def system_key(self, keycode, modifiers=()):
        self.system_keys.append((keycode, tuple(modifiers)))
        if self.system_key_ok and self.on_system_key is not None:
            self.on_system_key(self, keycode, modifiers)
        return self.system_key_ok

    def element_pid(self, el):
        return el.attrs.get("pid", self.pid)

    def observer(self, pid, element, notification):
        return FakeObserver(self, element, notification)


def pad_grid(device=0, *, tree_order_bottom_first=True):
    """16 pad cells, 4x4. In tree order the bottom row comes first when asked, so
    tests can tell tree order from reading order. Returns (container, {(row, col): lock_checkbox})."""
    base = f"TrackView.Device[{device}].pad_collection_view"
    container = El("AXGroup", identifier=base)
    locks = {}
    rows = [3, 2, 1, 0] if tree_order_bottom_first else [0, 1, 2, 3]
    for row in rows:  # row 0 is the top row on screen
        for col in range(4):
            x, y = 100.0 + col * 60, 900.0 + row * 50
            nxt = El("AXButton", identifier=f"{base}.Border.SwapBar.Next", pos=(x + 40, y))
            prv = El("AXButton", identifier=f"{base}.Border.SwapBar.Prev", pos=(x, y))
            lock = El("AXCheckBox", identifier=f"{base}.Border.SwapBar.Lock", value=0, pos=(x + 20, y))
            bar = El("AXGroup", identifier=f"{base}.Border.SwapBar", children=(prv, lock, nxt))
            container.add(El("AXGroup", identifier=f"{base}.Border", pos=(x, y), children=(bar,)))
            locks[(row, col)] = lock
    return container, locks


def drum_sampler(device=0, chain=0, *, title="Snap PrimeOne, Drum Sampler", pos=(607.0, 817.0), size=(490.0, 190.0)):
    """A selected pad's Drum Sampler in the device view, as measured on the rig:
    its swap buttons join the tree only under a pointer over the waveform (the
    frame's upper-left, above the Start / Length / Gain row). Returns
    (group, buttons) where `buttons` fills in once `reveal(backend, x, y)` is
    handed a point over the waveform."""
    base = f"TrackView.Device[{device}].Device[{chain}]"
    group = El("AXGroup", identifier=base, title=title, pos=pos, size=size, actions=("AXShowMenu",))
    group.add(El("AXSlider", identifier=f"{base}.PlaybackStart", description="Sample Start",
                 pos=(pos[0] + 36, pos[1] + 110)))
    buttons: dict = {}

    def reveal(backend, x, y):
        over_waveform = pos[0] <= x <= pos[0] + 250 and pos[1] + 14 <= y <= pos[1] + 98
        if not over_waveform or buttons:
            return
        view = f"{base}.WaveformDisplay.SimilaritySwapView"
        buttons["prev"] = El("AXButton", identifier=f"{view}.Prev", description="Swap to Previous Similar Sample",
                             pos=(pos[0] + 202, pos[1] + 88))
        buttons["next"] = El("AXButton", identifier=f"{view}.Next", description="Swap to Next Similar Sample",
                             pos=(pos[0] + 216, pos[1] + 88))
        group.add(buttons["prev"], buttons["next"], El("AXButton", description="Hot-Swap Sample"))

    return group, buttons, reveal


def track_headers(count, *, returns=1):
    """Live's track-header outline: AXRows in Session View's order -- tracks, then
    returns, then Main -- with AXSelectedRows settable on the outline and not on
    the rows (measured on the rig, 2026-09-19)."""
    rows = [El("AXRow", identifier=f"SessionView.Track[{i}].TitleBar", title=f"Track {i + 1}",
               AXSelected=False) for i in range(count)]
    rows += [El("AXRow", identifier=f"SessionView.ReturnTrack[{i}].TitleBar", AXSelected=False)
             for i in range(returns)]
    rows.append(El("AXRow", identifier="SessionView.MainTrack.TitleBar", title="Main", AXSelected=True))
    outline = El("AXOutline", description="Track Headers", children=tuple(rows),
                 AXRows=rows, AXSelectedRows=[rows[-1]], AXSelectedRowsSettable=True)
    return outline, rows


def live_tree(*, swap_bar_on=True, with_reverse=True, session_tracks=40, sampler=False):
    """A main window shaped like Live 12.4.15b2's, as measured on the rig."""
    tap = El("AXButton", identifier="Transport.TapTempo", description="Tap")
    tempo = El("AXSlider", identifier="Transport.Tempo", description="Tempo", value=111.0,
               actions=("AXIncrement", "AXDecrement", "AXShowMenu"))
    transport = El("AXGroup", identifier="Transport", children=(
        El("AXGroup", title="Tempo and timing", children=(tap, tempo)),
    ))
    session = El("AXGroup", identifier="SessionView", children=tuple(
        El("AXGroup", identifier=f"SessionView.Track[{i}]", children=(
            El("AXCheckBox", identifier=f"SessionView.Track[{i}].Mixer.Arm"),
        )) for i in range(session_tracks)
    ))
    title_bar = El("AXGroup", identifier="TrackView.Device[0].TitleBar", children=(
        El("AXCheckBox", identifier="TrackView.Device[0].TitleBar.ShowSwapBar",
           description="Show/Hide Similar Sample Swap Buttons", value=1 if swap_bar_on else 0),
    ))
    device0 = El("AXGroup", identifier="TrackView.Device[0]", children=(title_bar,))
    headers, rows = track_headers(session_tracks)
    session.add(headers)
    refs = {"tap": tap, "tempo": tempo, "title_bar": title_bar, "headers": headers, "rows": rows}
    if swap_bar_on:
        swap_next = El("AXButton", identifier="TrackView.Device[0].TitleBar.SimilaritySwapView.SwapNext")
        swap_prev = El("AXButton", identifier="TrackView.Device[0].TitleBar.SimilaritySwapView.SwapPrev")
        title_bar.add(El("AXGroup", identifier="TrackView.Device[0].TitleBar.SimilaritySwapView",
                         children=(swap_prev, swap_next)))
        grid, locks = pad_grid(0)
        device0.add(grid)
        refs.update(swap_next=swap_next, swap_prev=swap_prev, locks=locks)
    if sampler:
        group, buttons, reveal = drum_sampler(0, 0)
        device0.add(group)
        refs.update(sampler=group, sampler_buttons=buttons, reveal=reveal)
    track_view = El("AXGroup", identifier="TrackView", children=(
        device0,
        El("AXGroup", identifier="TrackView.Device[1]", children=(
            El("AXGroup", identifier="TrackView.Device[1].TitleBar"),
        )),
    ))
    clip_children = []
    if with_reverse:
        reverse = El("AXButton", description="Reverse")
        clip_children.append(El("AXGroup", children=(reverse,)))
        refs["reverse"] = reverse
    clip = El("AXGroup", identifier="ClipDetailView", title="Clip Detail", children=tuple(clip_children))
    window = El("AXWindow", title="Untitled", children=(
        El("AXGroup", children=(transport, session, track_view, clip)),
    ))
    refs["clip"] = clip
    return window, refs


def menubar(*titles, shortcuts=None):
    """A File menu holding `titles`; `shortcuts` maps a title to (AXMenuItemCmdChar, AXMenuItemCmdModifiers)."""
    shortcuts = shortcuts or {}
    items = []
    for t in titles:
        char, modifiers = shortcuts.get(t, (None, None))
        items.append(El("AXMenuItem", identifier="menuItemWasSelected:", title=t,
                        AXMenuItemCmdChar=char, AXMenuItemCmdModifiers=modifiers))
    return El("AXMenuBar", children=(El("AXMenuBarItem", title="File", children=(El("AXMenu", children=items),)),))
