"""GroovePoolComponent — PR-5e2 song-scoped groove pool bookkeeping.

Owns ``song.groove_pool.grooves`` — the Live project's shared
groove pool — and the operations that rename pool entries in and
out of the ``unassigned-<idx>`` / ``Clip_<pathHash>`` tag scheme
that marks which grooves are currently claimed by clips.

Scope — song-scoped, not focus-scoped
-------------------------------------

The pool is a shared resource. Any clip in the set can claim a
pool entry or return one; any Live-UI action (user dragging a
groove preset into the pool from the browser, user renaming a
pool entry by hand) can mutate pool state. This component keeps
its listener on the pool **always**, regardless of whether any
clip is focused, so external pool mutations are observable and
the verbs stay available to ``GrooveComponent`` on writes that
target non-focused clips.

This is distinct from the sibling ``GrooveComponent`` (focus-
scoped — see that module). Split per [phase-5-pr5e2-design.md §2].

Public surface
--------------

``find_unassigned_groove()`` — linear scan of ``grooves`` for the
first entry whose ``name`` starts with ``"unassigned-"``. Returns
the ``Groove`` object or ``None`` if the pool is fully claimed.
Mirrors ``liveAPI-v6.js:4720-4738``.

``assign_groove_to_clip(clip, clip_path, pattern=None)`` —
rename-then-link atom:

1. Find a free groove holding ``pattern``: an ``unassigned-*`` entry,
   else a claim no clip in the set links any more, else a fresh one
   minted through the browser — ``pattern``'s own file from Live's Core
   Library, or ``Vamp Devices/Grooves/Vamp Groove.agr`` for the default
   (``pattern`` None). None of the three → ``PoolExhausted``.
2. Rename it to the claim (below).
3. Assign it to ``clip.groove`` (the link).

Names (2026-09-29, the groove chooser)
--------------------------------------

Live's API cannot read a groove's pattern, and a claim used to rename a
groove ``Clip_<pathHash>``, which erased which file it came from. The
name now carries it, and says whose it is in words:

    claim   ``<track> <scene> · <pattern> #<pathHash>``
            ``<track> <scene> #<pathHash>`` (the default pattern)
    free    ``unassigned-<idx> · <pattern>`` / ``unassigned-<idx>``

``<pattern>`` is the groove file's name without ``.agr`` (``Swing 16ths
57``): the 219 in the Core Library are unique by name. The label is
cosmetic — it is refreshed on every claim and goes stale when a track is
renamed; ownership is the hash alone. A legacy ``Clip_<pathHash>`` or
``Clip_<liveId>`` claim is still owned, with no known pattern, as is a
template's ``unassigned-*`` entry. Any other name (a groove loaded by
hand, Live's default groove for new MIDI clips) is its own pattern.
A free groove is reused only for its own pattern, so a clip is never
handed another clip's swing.

Minting (2026-09-29) is why a set no longer needs hundreds of
``unassigned-*`` grooves loaded ahead of time. The LOM cannot create,
copy or delete a groove — ``GroovePool`` is ``grooves`` and a
listener, nothing else — but ``browser.load_item`` on an ``.agr``
appends a new pool entry every call (the same file three times gave
three entries, measured on Live 12.4.15b2), synchronously, without
touching the selected clip's groove. The pool then grows only to the
most clips that have held a groove at once: a groove cannot be
deleted, so every one ever minted stays to be reused.

The ordering invariant matters even though Live's single-tick
loop makes the critical section effectively atomic. See
[design §8].

``return_groove_to_pool(clip_path)`` — the inverse verb. Looks
up the groove ``clip_path`` claims and renames it back to
``unassigned-<idx>`` (where ``idx`` is its position in the pool —
matches M4L's naming convention so legacy tools reading the pool name
remain correct), keeping its pattern.

``path_hash(clip_path)`` — deterministic 8-char hash used for
the tag. ``hashlib.sha1(clip_path.encode("utf-8")).hexdigest()[:8]``.

Tag format interop
------------------

New claims use ``Clip_<pathHash>``. Legacy M4L claims use
``Clip_<liveId>``. Both coexist: ``find_unassigned_groove`` keys
on the ``unassigned-`` prefix, not on absence of ``Clip_``, so a
legacy entry is correctly skipped. No migration needed. See
[design §6.1].

LOM-touch guard
---------------

Every LOM read/write is wrapped in ``_LOM_ERRORS`` per the Live
12 quirks documented in ``project_live_lom_quirks.md``. Warnings
de-dupe through ``_warn_once(key, context)``.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Callable, NamedTuple, Optional, Tuple

logger = logging.getLogger("looping")


# Same tuple shape as ClipPropertiesComponent — ``Boost.Python.ArgumentError``
# is a ``TypeError`` subclass raised on invalidated C++ handles.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# Live ticks the Groove Pool's "Auto Load Groove" box on a groove loaded
# into an empty pool (measured 2026-09-29), and every clip recorded after
# that takes the groove. The LOM cannot reach the box, so the bridge
# unticks it through the AX helper on this announcement; the box is only
# in Live's window while the Browser shows, hence the browser verb.
V3_GROOVE_ADDED_ADDRESS = "/looping/v3/groove/added"
V3_GROOVE_BROWSER_ADDRESS = "/looping/v3/groove/browser"
V3_GROOVE_BROWSER_ACK_ADDRESS = "/looping/v3/groove/browser/ack"


_UNASSIGNED_PREFIX = "unassigned-"

# Between a claim's label and its pattern, and before a free groove's pattern.
_PATTERN_SEP = " · "
_CLAIM_RE = re.compile(r"^(?P<label>[^·#]*?)(?: · (?P<pattern>[^·#]+?))? #(?P<hash>[0-9a-f]{8})$")
_FREE_RE = re.compile(r"^unassigned-\d+(?: · (?P<pattern>[^·#]+?))?$")
_LEGACY_RE = re.compile(r"^Clip_(?P<tag>[0-9a-f]{8}|\d+)$")
_LABEL_MAX = 32


class GrooveName(NamedTuple):
    """What a pool entry's name says (see "Names" above)."""

    #: ``claim``, ``free`` or ``other``.
    kind: str
    #: The groove file it holds, or None when the name does not say.
    pattern: Optional[str]
    #: The claiming clip's path hash; a legacy ``Clip_<liveId>`` carries digits.
    tag: Optional[str] = None


def parse_groove_name(name: Optional[str]) -> GrooveName:
    if not name:
        return GrooveName("other", None)
    m = _CLAIM_RE.match(name)
    if m:
        return GrooveName("claim", m.group("pattern"), m.group("hash"))
    m = _LEGACY_RE.match(name)
    if m:
        return GrooveName("claim", None, m.group("tag"))
    if name.startswith(_UNASSIGNED_PREFIX):
        m = _FREE_RE.match(name)
        return GrooveName("free", m.group("pattern") if m else None)
    return GrooveName("other", name)


def pattern_of(name: Optional[str]) -> Optional[str]:
    """The groove file a pool entry holds, as far as its name says."""
    return parse_groove_name(name).pattern


def claim_name(label: str, pattern: Optional[str], clip_path: str) -> str:
    label = " ".join(label.replace("·", " ").replace("#", " ").split())[:_LABEL_MAX].strip() or "Clip"
    mid = _PATTERN_SEP + pattern if pattern else ""
    return "%s%s #%s" % (label, mid, path_hash(clip_path))


def free_name(idx: int, pattern: Optional[str]) -> str:
    return _UNASSIGNED_PREFIX + str(idx) + (_PATTERN_SEP + pattern if pattern else "")


_SETTINGS = (
    "base", "timing_amount", "quantization_amount",
    "random_amount", "velocity_amount",
)


def _copy_settings(src, dst) -> None:
    """Copy the five groove settings from ``src`` onto ``dst``; a read or
    write Live refuses is skipped, not fatal."""
    for attr in _SETTINGS:
        try:
            setattr(dst, attr, getattr(src, attr))
        except _LOM_ERRORS as e:
            logger.debug("GroovePoolComponent: copy %s skipped: %s", attr, e)


class PoolExhausted(Exception):
    """Raised when ``find_unassigned_groove`` returns None during a claim.

    Carries the ``clip_path`` of the write that triggered the
    assignment attempt so the caller can emit a
    ``/looping/v3/error pool-exhausted`` with the correct path.
    """

    def __init__(self, clip_path: str):
        super().__init__(
            "pool-exhausted for clip_path=%r" % (clip_path,),
        )
        self.clip_path = clip_path


def live_id(obj) -> Optional[int]:
    """A LOM object's identity, masked to 31 bits like ``clip_groove_id``.

    Live hands back a fresh proxy per read, so identity is the live
    pointer; a test stub without one falls back to ``id()``.
    """
    live_ptr = getattr(obj, "_live_ptr", None)
    if live_ptr is not None:
        try:
            return int(live_ptr) & 0x7FFFFFFF
        except (TypeError, ValueError):
            return None
    return id(obj) & 0x7FFFFFFF


def clip_groove_id(clip) -> Optional[int]:
    """Return the live-ptr id of the groove linked to ``clip``, or None.

    Live 12's ``clip.groove`` returns different shapes depending on
    API path:

    * The ``ableton.v3`` wrapper returns the ``Groove.Groove`` object
      directly (or ``None`` for no groove).
    * Older raw LOM access returns an ``("id", N)`` tuple where
      ``N == 0`` means no groove.
    * Test stubs return a plain int or ``("id", int)``.

    We normalize all three to a 31-bit-masked live-ptr so the result
    lines up with ``live_id`` / ``_safe_int_id(groove)``.
    """
    try:
        raw = clip.groove
    except _LOM_ERRORS:
        return None
    if raw is None:
        return None
    # Groove object (real Live 12 v3 wrapper path).
    live_ptr = getattr(raw, "_live_ptr", None)
    if live_ptr is not None:
        try:
            v = int(live_ptr) & 0x7FFFFFFF
        except (TypeError, ValueError):
            return None
        return v if v != 0 else None
    # ``("id", N)`` tuple (raw LOM path) or bare int (test stub).
    if not raw:
        return None
    try:
        if hasattr(raw, "__len__") and len(raw) == 2:
            gid = raw[1]
        else:
            gid = raw
    except TypeError:
        gid = raw
    try:
        gid_int = int(gid)
    except (TypeError, ValueError):
        return None
    if gid_int == 0:
        return None
    return gid_int & 0x7FFFFFFF


def is_owned_by(name: Optional[str], clip_path: str) -> bool:
    """Whether a groove named ``name`` is ``clip_path``'s own.

    Its own is a claim ending ``#<pathHash(clip_path)>`` (or the older
    ``Clip_<pathHash>``), or a legacy M4L claim ``Clip_<liveId>`` (all
    digits), which cannot be traced to a path. Anything else — a preset
    dragged in by hand, Live 12.1's default groove for new MIDI clips, a
    duplicated clip still sharing the original's claim — belongs to
    someone else.
    """
    parsed = parse_groove_name(name)
    if parsed.kind != "claim" or parsed.tag is None:
        return False
    return parsed.tag == path_hash(clip_path) or parsed.tag.isdigit()


def path_hash(clip_path: str) -> str:
    """8-char sha1 prefix of the UTF-8 encoded path.

    Deterministic, collision-safe at the pool's practical scale
    (tens of grooves per project, so pair-collision probability
    2⁻³² is ignorable). Lives at module scope so tests can use
    it directly without instantiating the component.
    """
    return hashlib.sha1(clip_path.encode("utf-8")).hexdigest()[:8]


class GroovePoolComponent:
    """Song-scoped groove pool observer + assign/return verbs.

    Args:
        song: Live ``Song`` (test: stub with ``groove_pool.grooves``).
        emit: ``(address, args) -> None`` — OSC sender. Currently
            unused (pool has no UI-visible state of its own; all
            UI emits flow through GrooveComponent) but kept for
            symmetry with sibling components and future use.
        mint: ``(pattern=None) -> Optional[str]`` — loads one groove
            file into the pool: ``pattern``'s from the Core Library, or
            the default file when called with no argument; returns an
            error string, or ``None`` when the load ran. ``None``
            (tests, a Live without a browser) means the pool never
            grows on its own.

    Lifecycle:
        ``__init__`` attaches the ``groove_pool.grooves`` list
        listener (always on). ``disconnect`` detaches it.
    """

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        mint: Optional[Callable[..., Optional[str]]] = None,
        app_view: Optional[Callable[[], object]] = None,
    ):
        self._song = song
        self._emit = emit
        self._mint = mint
        self._app_view = app_view
        self._disconnected = False

        # ``(key, context) -> True`` once warned, for de-dupe.
        self._warned: set = set()

        self._pool = self._safe_groove_pool()
        self._grooves_listener_attached = False
        self._grooves_listener_cb: Optional[Callable[[], None]] = None
        if self._pool is not None:
            cb = self._on_grooves_changed
            try:
                self._pool.add_grooves_listener(cb)
                self._grooves_listener_attached = True
                self._grooves_listener_cb = cb
            except _LOM_ERRORS as e:
                self._warn_once("grooves", "attach", e)

        logger.info(
            "GroovePoolComponent init: pool=%s listener=%s",
            "ok" if self._pool is not None else "missing",
            self._grooves_listener_attached,
        )

    # --- listener ----------------------------------------------------------

    def _on_grooves_changed(self) -> None:
        """Fires when the pool's grooves list changes.

        Structural notification only — the pool's contents changed
        (entry added, removed, or reordered). We don't emit
        anything to UI today: pool state is only surfaced via
        GrooveComponent's focused-clip has_groove / amount emits.
        The listener exists to exercise the pool attribute so LOM
        keeps the reference live, and to provide a hook for future
        pool-wide UI (e.g. a Phase 7 groove browser).
        """
        if self._disconnected:
            return
        # No emit today. Cheap probe-log at DEBUG so
        # validation can confirm the listener fires.
        logger.debug("GroovePoolComponent: grooves list fired")

    # --- pool scan + verbs -------------------------------------------------

    def find_unassigned_groove(self, pattern: Optional[str] = None):
        """Return first ``unassigned-*`` groove holding ``pattern``, or None.

        Linear scan of ``pool.grooves`` in list order. Matches
        M4L's ``findUnassignedGroove`` (liveAPI-v6.js:4720) so
        the pool walk stays predictable across the migration.
        ``pattern`` None is the default: a template's plain
        ``unassigned-<idx>``.

        Skips:
        - claims, new and legacy.
        - Any other name not starting with ``unassigned-`` (e.g.
          Ableton preset grooves dragged in from the browser).
        - a free groove holding another pattern.
        """
        grooves = self._safe_grooves_list()
        if grooves is None:
            return None
        for groove in grooves:
            parsed = parse_groove_name(self._safe_read_name(groove))
            if parsed.kind == "free" and parsed.pattern == pattern:
                return groove
        return None

    def find_orphaned_groove(self, pattern: Optional[str] = None):
        """Return a claimed groove holding ``pattern`` that no clip in the
        set links, or None.

        A claim outlives its clip when the clip goes without ever being
        focused (the module's known gap), or moves to another slot and
        claims afresh there. One walk of every Session and Arrangement
        clip, so only when there is no ``unassigned-*`` entry left.
        """
        grooves = self._safe_grooves_list()
        if not grooves:
            return None
        claimed = []
        for g in grooves:
            parsed = parse_groove_name(self._safe_read_name(g))
            if parsed.kind == "claim" and parsed.pattern == pattern:
                claimed.append(g)
        if not claimed:
            return None
        linked = self._linked_groove_ids()
        if linked is None:
            return None
        for groove in claimed:
            if live_id(groove) not in linked:
                return groove
        return None

    def mint_groove(self, pattern: Optional[str] = None):
        """Load one groove file into the pool and return the new entry:
        ``pattern``'s, or the default one.

        None when there is no minter, the load failed, or the pool did
        not grow. The new entry is the one whose identity the pool did
        not have before (Live appends, but nothing promises it).
        """
        if self._mint is None:
            return None
        before = self._safe_grooves_list()
        if before is None:
            return None
        known = {live_id(g) for g in before}
        try:
            err = self._mint(pattern) if pattern else self._mint()
        except Exception as e:  # a failed load must not take the write down
            err = "%s: %s" % (type(e).__name__, e)
        if err:
            logger.warning("GroovePoolComponent: mint failed: %s", err)
            return None
        after = self._safe_grooves_list() or []
        for groove in reversed(after):
            if live_id(groove) not in known:
                logger.info(
                    "GroovePoolComponent: minted a groove (pool %d -> %d)",
                    len(before), len(after),
                )
                self._emit(V3_GROOVE_ADDED_ADDRESS, ())
                return groove
        logger.warning(
            "GroovePoolComponent: mint ran but the pool did not grow (%d)",
            len(after),
        )
        return None

    def handle_browser(self, args, source_addr=None) -> None:
        """``/looping/v3/groove/browser [id, visible]``: show (1) or hide (0)
        Live's Browser, acked ``[id, was_visible]`` so the bridge can put
        back what it found."""
        if len(args) < 2 or self._app_view is None:
            return
        request_id, visible = str(args[0]), bool(args[1])
        was = -1
        try:
            view = self._app_view()
            was = 1 if view.is_view_visible("Browser") else 0
            if visible and not was:
                view.show_view("Browser")
            elif not visible and was:
                view.hide_view("Browser")
        except _LOM_ERRORS as e:
            logger.warning("GroovePoolComponent: browser %s failed: %s",
                           "show" if visible else "hide", e)
        self._emit(V3_GROOVE_BROWSER_ACK_ADDRESS, (request_id, was))

    def assign_groove_to_clip(
        self, clip, clip_path: str, inherit=None,
        pattern: Optional[str] = None, strict: bool = True,
    ):
        """Rename-then-link: claim a free groove holding ``pattern`` for ``clip``.

        Order is critical. See [design §8]:
        1. Find a free groove: unassigned, else orphaned, else minted,
           each holding ``pattern`` (None: the default). If none, raise
           PoolExhausted — or, with ``strict`` False, try the default
           pattern before raising.
        2. Rename the groove (the claim). If this raises, nothing
           is linked; rollback is a no-op.
        3. Assign the groove to the clip (the link). If this raises,
           the groove is named-but-orphaned. Next delete-return sweep
           reclaims it.

        ``inherit`` is a groove whose settings the claimed one takes
        first: the shared groove the clip is leaving, so claiming one
        of its own does not change how the clip sounds.

        Returns the assigned groove object on success.
        """
        groove = self._free_groove(pattern)
        if groove is None and pattern and not strict:
            pattern = None
            groove = self._free_groove(None)
        if groove is None:
            raise PoolExhausted(clip_path)
        if inherit is not None:
            _copy_settings(inherit, groove)

        new_name = claim_name(self._label_for(clip_path), pattern, clip_path)
        try:
            groove.name = new_name
        except _LOM_ERRORS as e:
            logger.warning(
                "GroovePoolComponent assign rename raised: %s (clip_path=%r)",
                e, clip_path,
            )
            raise

        try:
            clip.groove = groove
        except _LOM_ERRORS as e:
            logger.warning(
                "GroovePoolComponent assign link raised: %s (clip_path=%r, "
                "groove=%r) — groove left named-but-orphaned",
                e, clip_path, new_name,
            )
            raise

        return groove

    def _free_groove(self, pattern: Optional[str]):
        # ``is None``, not ``or``: a LOM object defines ``__bool__``.
        groove = self.find_unassigned_groove(pattern)
        if groove is None:
            groove = self.find_orphaned_groove(pattern)
        if groove is None:
            groove = self.mint_groove(pattern)
        return groove

    def release(self, groove) -> bool:
        """Name ``groove`` free again, keeping its pattern — the groove a
        clip just left for another pattern. False when Live refused."""
        grooves = self._safe_grooves_list() or []
        gid = live_id(groove)
        idx = next((i for i, g in enumerate(grooves) if live_id(g) == gid), len(grooves))
        try:
            groove.name = free_name(idx, pattern_of(groove.name))
        except _LOM_ERRORS as e:
            logger.warning("GroovePoolComponent release rename raised: %s", e)
            return False
        return True

    def _label_for(self, clip_path: str) -> str:
        """``<track name> <scene number>`` for a Session clip, for a person
        reading Live's Groove Pool; ``Clip`` when the path says no more."""
        parts = clip_path.split("/")
        if len(parts) >= 4 and parts[0] == "tracks" and parts[2] == "slots":
            try:
                track = list(self._song.tracks)[int(parts[1])]
                return "%s %d" % (track.name, int(parts[3]) + 1)
            except (_LOM_ERRORS + (ValueError, IndexError)):
                pass
        return "Clip"

    def return_groove_to_pool(self, clip_path: str) -> bool:
        """Rename ``Clip_<pathHash(clip_path)>`` back to ``unassigned-<idx>``.

        Returns True on return, False when the tag was not found
        (e.g. the clip had no groove, or a previous call already
        reclaimed it).

        Linear scan — same cost shape as ``find_unassigned_groove``.
        ``<idx>`` is the groove's position in the pool; matches M4L's
        naming convention so external tools reading names stay
        correct.
        """
        target_tag = path_hash(clip_path)
        grooves = self._safe_grooves_list()
        if grooves is None:
            return False
        for idx, groove in enumerate(grooves):
            name = self._safe_read_name(groove)
            if name is None:
                continue
            parsed = parse_groove_name(name)
            if parsed.kind == "claim" and parsed.tag == target_tag:
                new_name = free_name(idx, parsed.pattern)
                try:
                    groove.name = new_name
                except _LOM_ERRORS as e:
                    logger.warning(
                        "GroovePoolComponent return rename raised: %s "
                        "(clip_path=%r, target=%r, new=%r)",
                        e, clip_path, target_tag, new_name,
                    )
                    return False
                return True
        return False

    # --- emit_on_accept ----------------------------------------------------

    def emit_on_accept(self) -> None:
        """Handshake-accept re-emit hook.

        Pool has no UI-visible state of its own — grooves only
        surface via GrooveComponent's focus-scoped emits. This
        method is present for symmetry with the
        ``_emit_on_accept_chain`` convention and is deliberately
        a no-op.
        """
        return

    # --- LOM guards --------------------------------------------------------

    def _safe_groove_pool(self):
        try:
            return self._song.groove_pool
        except _LOM_ERRORS as e:
            self._warn_once("song.groove_pool", "read", e)
            return None

    def _safe_grooves_list(self):
        if self._pool is None:
            return None
        try:
            return list(self._pool.grooves)
        except _LOM_ERRORS as e:
            self._warn_once("grooves", "read", e)
            return None

    def _safe_read_name(self, groove) -> Optional[str]:
        try:
            return groove.name
        except _LOM_ERRORS as e:
            self._warn_once("groove.name", "read", e)
            return None

    def _linked_groove_ids(self):
        """Every groove id a Session or Arrangement clip links, or None
        when the tracks cannot be read (then nothing counts as orphaned)."""
        try:
            tracks = list(self._song.tracks)
        except _LOM_ERRORS as e:
            self._warn_once("song.tracks", "orphan-walk", e)
            return None
        linked = set()
        for track in tracks:
            clips = []
            try:
                for slot in track.clip_slots:
                    if slot.has_clip:
                        clips.append(slot.clip)
            except _LOM_ERRORS:
                pass  # a group track's slots, a torn-down handle
            try:
                clips.extend(track.arrangement_clips)
            except _LOM_ERRORS:
                pass
            for clip in clips:
                gid = clip_groove_id(clip)
                if gid is not None:
                    linked.add(gid)
        return linked

    def linked_elsewhere(self, clip, gid: int) -> bool:
        """Whether a Session clip other than ``clip`` links groove ``gid``."""
        me = live_id(clip)
        try:
            tracks = list(self._song.tracks)
        except _LOM_ERRORS:
            return False
        for track in tracks:
            try:
                slots = list(track.clip_slots)
            except _LOM_ERRORS:
                continue
            for slot in slots:
                try:
                    if not slot.has_clip:
                        continue
                    other = slot.clip
                except _LOM_ERRORS:
                    continue
                if live_id(other) == me:
                    continue
                if clip_groove_id(other) == gid:
                    return True
        return False

    # --- diagnostics -------------------------------------------------------

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        slot = (key, context)
        if slot in self._warned:
            return
        self._warned.add(slot)
        logger.warning(
            "GroovePoolComponent %s (%s): %s (suppressing further warnings)",
            key, context, exc,
        )

    # --- lifecycle ---------------------------------------------------------

    def disconnect(self):
        if self._disconnected:
            return
        self._disconnected = True

        if (self._grooves_listener_attached and self._pool is not None
                and self._grooves_listener_cb is not None):
            try:
                self._pool.remove_grooves_listener(
                    self._grooves_listener_cb,
                )
            except _LOM_ERRORS as e:
                logger.warning(
                    "GroovePoolComponent grooves detach failed: %s", e,
                )
            self._grooves_listener_attached = False
            self._grooves_listener_cb = None
