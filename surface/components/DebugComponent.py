"""DebugComponent — protocol-version handshake + light diagnostics.

Owns the ``/looping/protocol/*`` address family per
[04-wire-protocol.md §1]. Gate 5 ships the one address that matters
for the UI handshake:

- ``/looping/protocol/version`` → ``/looping/protocol/version [version:str]``

The UI queries this on every reconnect. A ``"3.x"`` reply signals
the v3 path-keyed wire contract (v2 was deleted in Phase 4 PR-4a).
An absent reply (pre-migration state: AbletonOSC + M4L, no Python
surface) is treated as ``"0.x"`` and the UI stays fully legacy.

The component is deliberately tiny — no LOM observation, no state —
so a broken surface still answers the version probe cleanly. If the
version query fails, the UI has no way to tell "Python surface is up
but wedged" from "Python surface is absent"; keeping the handler a
one-liner makes "wedged" vanishingly unlikely.
"""

from __future__ import annotations

import collections
import logging
import re as _re

logger = logging.getLogger("looping")


# Wire addresses — class-level constants so renames fail scope-partition
# and fixture tests, not at runtime.
PROTOCOL_VERSION_ADDRESS = "/looping/protocol/version"
REGISTRY_DUMP_ADDRESS = "/looping/v2/registry/dump"
REGISTRY_DUMP_REPLY_ADDRESS = "/looping/v2/registry/dump_reply"
REGISTRY_PROBE_RESOLVE_ADDRESS = "/looping/v2/registry/probe_resolve"
REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS = "/looping/v2/registry/probe_resolve_reply"
LOM_INTROSPECT_ADDRESS = "/looping/probe/lom_introspect"
LOM_INVOKE_ADDRESS = "/looping/probe/lom_invoke"
LOM_SET_ADDRESS = "/looping/probe/lom_set"
SONG_TIME_PROBE_ADDRESS = "/looping/probe/song_time_probe"
PY_INTROSPECT_ADDRESS = "/looping/probe/py_introspect"
RELOAD_ON_RESELECT_ADDRESS = "/looping/probe/reload_on_reselect"
# No _REPLY constants: the OSC transport auto-replies on the request
# address, so the request constants above are also the reply addresses.

# Phase 4 PR-4a bumped to 3.0.0 alongside v2 wire deletion; Phase 7
# PR-7a bumped to 3.1.0 alongside the sceneRef grammar extension
# (additive-only minor); Phase 7 PR-7c pr7c-3 bumped to 3.2.0
# alongside the T-record arity 8 \u2192 9 in V3StateFullComponent
# (`hasArrangementClips`); ROW 5 2026-04-21 bumped to 3.3.0 alongside
# the D-record arity 4 -> 3 (legacyId retired; path_resolver +
# DeviceCommandsComponent own select/move ops in path-space);
# 2026-08-31 bumped to 3.6.0 alongside the ``state/full``
# begin/chunk/end -> single ``state/full/tree`` collapse. Held
# in sync with ``SurfaceHelloComponent.PROTOCOL_VERSION`` and the
# highest entry in ``HandshakeComponent.SUPPORTED_VERSIONS``.
# 2026-09-10 bumped to 3.8.0 (issue #491): the ``pads/<note>`` path
# segment and the pad-scoped ``state/full/tree``.
# 2026-09-15 bumped to 3.9.0 (ADR-439): T record 14 -> 15, ``preset``.
PROTOCOL_VERSION = "3.12.0"


# --- probe chain grammar ---------------------------------------------------
#
# ``a.b[3].*name`` — dotted attribute chains with two probe-only
# extensions: ``name[N]`` indexes a list/vector attribute, ``*name``
# maps ``name`` over an iterable (``parameters.*name`` -> the parameter
# names). They exist so a probe can reach nested rack objects
# (``drum_pads[36].chains[0].devices[0].parameters[1].value``) without
# adding chain grammar to the production path resolver (issue #489
# measurements). Any miss raises; callers wrap.
_SEG_RX = _re.compile(r"^(\*?)([A-Za-z_][A-Za-z0-9_]*)((?:\[-?\d+\])*)$")
_IDX_RX = _re.compile(r"\[(-?\d+)\]")


def _walk_chain(obj, chain):
    for raw in chain.split("."):
        seg = raw.strip()
        if not seg:
            continue
        m = _SEG_RX.match(seg)
        if m is None:
            raise ValueError("bad segment %r" % seg)
        star, name, idx_s = m.groups()
        if star:
            obj = [getattr(item, name) for item in obj]
        else:
            obj = getattr(obj, name)
        for idx in _IDX_RX.findall(idx_s):
            obj = obj[int(idx)]
    return obj


def _walk_parent(obj, chain):
    """``_walk_chain`` minus the last segment: returns ``(parent, attr)``."""
    parts = [p.strip() for p in chain.split(".") if p.strip()]
    if not parts:
        raise ValueError("empty chain")
    last = parts[-1]
    if not _re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", last):
        raise ValueError("last segment must be a plain attribute: %r" % last)
    head = ".".join(parts[:-1])
    return (_walk_chain(obj, head) if head else obj), last


_NOTE_FIELDS = ("note_id", "pitch", "start_time", "duration", "velocity", "mute", "probability")
_ITEMS_CAP = 256


def _expand_items(result):
    """``result`` as a list of JSON-able items when it iterates (a
    ``MidiNoteVector``, a tuple of ids …); ``None`` otherwise. Never
    raises — the probe must survive any shape."""
    if result is None or isinstance(result, (str, bytes, int, float, bool)):
        return None
    try:
        iterator = iter(result)
    except Exception:
        return None
    out = []
    try:
        for item in iterator:
            if len(out) >= _ITEMS_CAP:
                out.append("… (capped at %d)" % _ITEMS_CAP)
                break
            if hasattr(item, "note_id"):
                note = {}
                for f in _NOTE_FIELDS:
                    try:
                        v = getattr(item, f)
                    except Exception:
                        continue
                    note[f] = v if isinstance(v, (int, float, bool)) else _repr(v, 40)
                out.append(note)
            elif isinstance(item, (int, float, bool, str)):
                out.append(item)
            else:
                out.append(_repr(item, 80))
    except Exception as e:
        out.append("<iteration raised %s>" % e)
    return out


def _application():
    """``(Live.Application.get_application(), None)`` or ``(None, err)``."""
    try:
        import Live  # type: ignore
        return Live.Application.get_application(), None
    except Exception as e:
        return None, "app: %s: %s" % (type(e).__name__, e)


# A py_introspect reply rides UDP back to the sender, so it must fit
# darwin's 9,216 B datagram with room for the OSC framing.
_PY_REPLY_BYTES = 8000


def _enum_values(target):
    """``{name: int}`` for a Boost.Python enum class, else ``None``.

    Boost enums carry ``names`` (name -> member) and ``values``
    (int -> member) as class dicts; either is enough.
    """
    try:
        names = getattr(target, "names", None)
        if isinstance(names, dict) and names:
            return {str(k): int(v) for k, v in names.items()}
        values = getattr(target, "values", None)
        if isinstance(values, dict) and values:
            out = {}
            for k, v in values.items():
                label = str(v).rsplit(".", 1)[-1]
                out[label] = int(k)
            return out
    except Exception as e:
        return {"<enum read raised>": "%s: %s" % (type(e).__name__, e)}
    return None


def _repr(obj, n=160):
    try:
        if isinstance(obj, (list, tuple)):
            return repr(obj)[:2000]
        return repr(obj)[:n]
    except Exception as e:  # a LOM repr can raise; the probe must not
        return "<repr raised %s>" % e


class DebugComponent:
    """Answers ``/looping/protocol/version`` with the current semver.

    Args:
        emit: Callable ``(address, args)`` — the ``OSCTransport.send``
            shape used elsewhere in the surface.

    No listeners, no teardown work at Gate 5 beyond idempotent
    ``disconnect()`` for symmetry with the other components.
    """

    def __init__(self, emit, registry=None, request_reload=None):
        self._emit = emit
        self._registry = registry
        # The package's ``request_reload`` (surface/__init__.py), passed in
        # because this module is imported as ``components.*`` under pytest,
        # where a relative import of the package would not resolve.
        self._request_reload = request_reload
        self._disconnected = False
        # /looping/probe/song_time_probe state (issue #489 measurement 6).
        self._song_time_cb = None
        self._song_time_samples = None
        logger.info("DebugComponent: probe v2 ready (index/map/set/song_time)")

    # --- /looping/protocol/version ----------------------------------------

    def handle_version(self, args, source_addr):
        """``/looping/protocol/version`` → ``/looping/protocol/version [version]``.

        Args are ignored — the UI sends the query with no payload.
        Reply shape matches [04 §1]: one string arg with the semver.
        """
        self._emit(PROTOCOL_VERSION_ADDRESS, (PROTOCOL_VERSION,))
        return None

    # --- /looping/v2/registry/dump ----------------------------------------

    def handle_registry_dump(self, args, source_addr):
        """Probe address — emits the listener bookkeeper's walk counts.

        Reply: ``/looping/v2/registry/dump_reply
        [tracks, devices, params, fresh_tracks, fresh_devices, fresh_params]``.

        Wire address still uses the historical ``registry`` segment
        (the underlying class is now ``LOMListeners`` post-Phase-1
        Commit A; the wire name is preserved for tooling
        compatibility — see ``registry_probe_resolve_shot.js``).

        After PR-4g there is no longer any stored-vs-fresh
        distinction — both number sets are walk-derived. Reply
        shape is preserved so existing diagnostic drivers stay
        wire-compatible.
        """
        if self._registry is None:
            self._emit(REGISTRY_DUMP_REPLY_ADDRESS, (-1, -1, -1, -1, -1, -1))
            return None
        s = self._registry.dump_state()
        logger.info(
            "registry dump: stored=(t=%d d=%d p=%d) fresh=(t=%d d=%d p=%d)",
            s["tracks"], s["devices"], s["params"],
            s["fresh_tracks"], s["fresh_devices"], s["fresh_params"],
        )
        self._emit(
            REGISTRY_DUMP_REPLY_ADDRESS,
            (
                s["tracks"], s["devices"], s["params"],
                s["fresh_tracks"], s["fresh_devices"], s["fresh_params"],
            ),
        )
        return None

    # --- /looping/v2/registry/probe_resolve -------------------------------

    def handle_registry_probe_resolve(self, args, source_addr):
        """Probe ``resolve_device`` and report the outcome.

        Reply: ``/looping/v2/registry/probe_resolve_reply
        [found:int, was_rebuild:int,
         stored_tracks_before, stored_devices_before, stored_params_before,
         stored_tracks_after,  stored_devices_after,  stored_params_after]``.

        ``found`` is 1 iff ``resolve_device(device_id)`` returned a
        tuple.

        **PR-4g:** ``was_rebuild`` is always 0 in walk mode. The reply
        shape is preserved so existing driver tools
        (``registry_probe_resolve_shot.js``) stay wire-compatible, but
        the F1 "lazy rebuild on miss" path retired with the registry's
        forward maps — there is no rebuild to observe. The three
        stored-count fields now return the same walk-derived value
        before and after the resolve, since ``resolve_device`` mutates
        nothing.

        Expected arg: ``[device_id:int]``. ``-1`` is reserved for
        "registry absent" sentinels in the reply — mirrors the
        convention in ``handle_registry_dump``.
        """
        if self._registry is None or not args:
            self._emit(
                REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS,
                (-1, -1, -1, -1, -1, -1, -1, -1),
            )
            return None
        try:
            device_id = int(args[0])
        except (TypeError, ValueError):
            self._emit(
                REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS,
                (-1, -1, -1, -1, -1, -1, -1, -1),
            )
            return None
        before_t = self._registry.track_count
        before_d = self._registry.device_count
        before_p = self._registry.param_count
        resolved = self._registry.resolve_device(device_id)
        after_t = self._registry.track_count
        after_d = self._registry.device_count
        after_p = self._registry.param_count
        found = 1 if resolved is not None else 0
        was_rebuild = 1 if (
            before_t != after_t
            or before_d != after_d
            or before_p != after_p
        ) else 0
        logger.info(
            "registry probe_resolve: id=%d found=%d rebuild=%d "
            "before=(t=%d d=%d p=%d) after=(t=%d d=%d p=%d)",
            device_id, found, was_rebuild,
            before_t, before_d, before_p,
            after_t, after_d, after_p,
        )
        self._emit(
            REGISTRY_PROBE_RESOLVE_REPLY_ADDRESS,
            (
                found, was_rebuild,
                before_t, before_d, before_p,
                after_t, after_d, after_p,
            ),
        )
        return None

    # --- /looping/v2/registry/introspect_track -----------------------------

    def handle_registry_introspect_track(self, args, source_addr):
        """One-shot: dump the id-like attributes of the first regular track.

        Reply: ``/looping/v2/registry/introspect_reply [json_str]``.

        05a PR-1 diagnostic: `_live_ptr` is a Python-wrapper pointer,
        not the LOM id M4L uses. We need to find the attribute that
        returns the SAME integer as M4L's `LiveAPI.id`. This probe
        reads several candidates off the first non-master track and
        hands the JSON back for a side-by-side comparison. Remove
        once we've picked the right attribute and fixed _safe_int_id.
        """
        import json
        payload = {"error": None, "tracks": []}
        if self._registry is None:
            payload["error"] = "no registry"
            self._emit(
                "/looping/v2/registry/introspect_reply", (json.dumps(payload),),
            )
            return None
        try:
            song = self._registry._song
            candidates = ["id", "_live_ptr", "live_id", "live_object_id",
                          "_live_object", "_live_object_id"]
            # First regular track
            tracks = list(song.tracks)[:2]
            for i, t in enumerate(tracks):
                entry = {"index": i, "type": type(t).__name__, "attrs": {}}
                for a in candidates:
                    try:
                        v = getattr(t, a, "<missing>")
                        entry["attrs"][a] = repr(v)[:80]
                    except Exception as e:
                        entry["attrs"][a] = "raised: %s" % e
                # Also show all public-ish attrs that might contain "id"
                id_like = [n for n in dir(t) if "id" in n.lower() or "ptr" in n.lower()]
                entry["id_like_attrs"] = sorted(id_like)[:30]
                # Check for .canonical_parent chain & devices ids
                try:
                    devs = list(getattr(t, "devices", ()))[:1]
                    if devs:
                        d = devs[0]
                        entry["device0"] = {
                            "type": type(d).__name__,
                            "id": repr(getattr(d, "id", "<missing>"))[:80],
                            "_live_ptr": repr(getattr(d, "_live_ptr", "<missing>"))[:80],
                            "id_like": sorted([n for n in dir(d)
                                               if "id" in n.lower() or "ptr" in n.lower()])[:20],
                        }
                except Exception as e:
                    entry["device0_err"] = str(e)
                payload["tracks"].append(entry)
        except Exception as e:
            payload["error"] = "%s: %s" % (type(e).__name__, e)
        blob = json.dumps(payload)
        logger.info("registry introspect: %s", blob[:500])
        self._emit("/looping/v2/registry/introspect_reply", (blob,))
        return None

    # --- /looping/probe/lom_introspect ------------------------------------

    def handle_lom_introspect(self, args, source_addr):
        """Probe arbitrary LOM attribute existence on a resolved object.

        Args: ``[path:str, attrs_csv:str, dir_regex:str]``.

        ``path`` is a v3 LOM path: ``tracks/<N>``,
        ``tracks/<N>/devices/<M>``, ``tracks/<N>/slots/<M>/clip``,
        or ``master`` / ``master/devices/<M>``. ``attrs_csv`` is
        comma-separated; each entry may be a dotted chain
        (``sample.warp_mode``). ``dir_regex`` filters ``dir(obj)``
        for surfacing nearby names (case-insensitive); empty disables.

        Reply: ``/looping/probe/lom_introspect_reply [json_str]``
        with ``{"path","resolved_type","attrs":[{name,exists,
        callable,value_repr,error}],"dir_matches":[...]}``.

        ``hasattr`` alone is unsafe — Live 12 raises ``RuntimeError``
        on some unset attrs (see MasterComponent docstring). Every
        read is wrapped in a broad ``except Exception`` so the
        probe survives quirks like ``master.mute``.
        """
        import json
        import re
        payload = {
            "path": "", "resolved_type": "", "resolve_error": None,
            "attrs": [], "dir_matches": [],
        }
        if not args or self._registry is None:
            payload["resolve_error"] = (
                "no registry" if self._registry is None else "no args"
            )
            return (json.dumps(payload),)
        path = str(args[0]) if len(args) > 0 else ""
        attrs_csv = str(args[1]) if len(args) > 1 else ""
        dir_regex = str(args[2]) if len(args) > 2 else ""
        payload["path"] = path

        target, err = self._resolve_introspect_path(path)
        if err is not None:
            payload["resolve_error"] = err
            return (json.dumps(payload),)
        payload["resolved_type"] = type(target).__name__

        for raw in (a.strip() for a in attrs_csv.split(",") if a.strip()):
            entry = {
                "name": raw, "exists": 0, "callable": 0,
                "value_repr": "", "error": "",
            }
            obj = target
            try:
                obj = _walk_chain(target, raw)
                entry["exists"] = 1
                entry["callable"] = 1 if callable(obj) else 0
                if not callable(obj):
                    entry["value_repr"] = _repr(obj)
                else:
                    entry["value_repr"] = "<callable %s>" % type(obj).__name__
            except AttributeError as e:
                entry["error"] = "AttributeError: %s" % e
            except Exception as e:
                entry["error"] = "%s: %s" % (type(e).__name__, e)
            payload["attrs"].append(entry)

        if dir_regex:
            try:
                pat = re.compile(dir_regex, re.IGNORECASE)
                names = []
                try:
                    names = dir(target)
                except Exception as e:
                    payload["dir_matches"] = ["<dir() raised: %s>" % e]
                else:
                    payload["dir_matches"] = sorted(
                        n for n in names if pat.search(n)
                    )[:80]
            except re.error as e:
                payload["dir_matches"] = ["<bad regex: %s>" % e]

        blob = json.dumps(payload)
        logger.info("lom_introspect path=%s resolved=%s attrs=%d dir=%d",
                    path, payload["resolved_type"],
                    len(payload["attrs"]), len(payload["dir_matches"]))
        return (blob,)

    # --- /looping/probe/lom_invoke ----------------------------------------

    def handle_lom_invoke(self, args, source_addr):
        """Call a method on a resolved LOM object and report state deltas.

        Args: ``[path:str, method:str, observe_attrs_csv:str,
        args_json:str?]``.

        ``method`` is a dotted chain rooted on the resolved object
        (``reverse``, ``warp_half``, ``sample.warp_mode``-as-getter
        -won't-work — use a method name). ``observe_attrs_csv`` is
        the same comma-separated dotted-chain shape that introspect
        accepts: each entry is read before and after the method call
        so the operator can confirm a side effect actually fired.

        ``args_json`` is an optional JSON **array** of positional
        arguments. Absent or empty means "call with no arguments",
        which is what this probe did before and what every existing
        driver still sends. It exists because the interesting LOM
        methods are not all niladic: ``Track.set_data(key, value)``
        and ``Track.get_data(key, default)`` cannot be reached at all
        without it, and their whole point is the arguments.

        JSON rather than a positional arg list on the wire because
        types matter here — ``set_data`` takes a
        ``boost::python::api::object``, so "did it accept an int, a
        float, a list, a dict" is exactly the question a probe is for,
        and OSC would flatten several of those to strings.

        Reply: ``/looping/probe/lom_invoke_reply [json_str]`` with
        ``{"path","method","call_args","invoke_error","returned",
        "observed":[{name,before,after,changed,error}]}``.
        ``returned`` is the ``repr`` of the method's return value —
        the only way a *getter* like ``get_data`` reports anything,
        since it changes no observable state.

        DESTRUCTIVE — this mutates the live set. Operator must point
        it at a probe track they don't mind dirtying.
        """
        import json
        payload = {
            "path": "", "method": "", "resolve_error": None,
            "invoke_error": None, "observed": [],
            "call_args": [], "returned": "",
        }
        if not args or self._registry is None:
            payload["invoke_error"] = (
                "no registry" if self._registry is None else "no args"
            )
            return (json.dumps(payload),)
        path = str(args[0]) if len(args) > 0 else ""
        method = str(args[1]) if len(args) > 1 else ""
        observe_csv = str(args[2]) if len(args) > 2 else ""
        args_json = str(args[3]) if len(args) > 3 else ""
        payload["path"] = path
        payload["method"] = method

        call_args = []
        if args_json.strip():
            try:
                parsed = json.loads(args_json)
            except ValueError as e:
                payload["invoke_error"] = "args_json is not JSON: %s" % e
                return (json.dumps(payload),)
            if not isinstance(parsed, list):
                payload["invoke_error"] = (
                    "args_json must be a JSON array, got %s"
                    % type(parsed).__name__
                )
                return (json.dumps(payload),)
            call_args = parsed
        payload["call_args"] = [repr(a)[:80] for a in call_args]

        target, err = self._resolve_introspect_path(path)
        if err is not None:
            payload["resolve_error"] = err
            return (json.dumps(payload),)

        observed = []
        for raw in (a.strip() for a in observe_csv.split(",") if a.strip()):
            entry = {"name": raw, "before": "", "after": "",
                     "changed": 0, "error": ""}
            try:
                obj = _walk_chain(target, raw)
                entry["before"] = _repr(obj)
            except Exception as e:
                entry["error"] = "before: %s: %s" % (type(e).__name__, e)
            observed.append(entry)

        try:
            obj = _walk_chain(target, method)
            if not callable(obj):
                payload["invoke_error"] = (
                    "method %r is not callable (got %s)"
                    % (method, type(obj).__name__)
                )
            else:
                result = obj(*call_args)
                # ``repr`` rather than the value: a LOM return can be a
                # Boost.Python handle with no JSON encoding, and the
                # probe must never fail on the shape of an answer it
                # was asked to go and find.
                payload["returned"] = repr(result)[:400]
                # A returned vector (``get_all_notes_extended`` and the
                # like) is expanded item by item — a note as its fields,
                # anything else as its repr — capped, so the thin-Permute
                # rig checks (ADR-429) can read pitch / mute /
                # probability off a clip without a second wire.
                payload["items"] = _expand_items(result)
        except Exception as e:
            payload["invoke_error"] = "%s: %s" % (type(e).__name__, e)

        for entry in observed:
            if entry["error"]:
                continue
            try:
                obj = _walk_chain(target, entry["name"])
                entry["after"] = _repr(obj)
                entry["changed"] = 0 if entry["after"] == entry["before"] else 1
            except Exception as e:
                entry["error"] = "after: %s: %s" % (type(e).__name__, e)

        payload["observed"] = observed
        blob = json.dumps(payload)
        logger.info("lom_invoke path=%s method=%s args=%d err=%s",
                    path, method, len(call_args), payload["invoke_error"])
        return (blob,)

    def _resolve_introspect_path(self, path):
        """Resolve ``path`` to a LOM target, returning (obj, err_str_or_None).

        Tries ``resolve_clip``, ``resolve_device``, ``resolve_track`` in
        that order based on path shape so the probe accepts any of the
        three. Master is supported via the same path_resolver entry
        points (``master`` / ``master/devices/<M>``).
        """
        try:
            from . import path_resolver as pr
        except ImportError as e:
            return None, "import path_resolver: %s" % e
        song = self._registry._song
        parts = [p for p in path.split("/") if p]
        if not parts:
            return None, "empty path"
        # Probe-only root: ``song`` resolves to the Song itself so a probe
        # can reach ``view.selected_track``, ``undo`` / ``begin_undo_step``,
        # ``start_playing`` etc. Never used by production paths.
        if parts == ["song"]:
            return song, None
        # Probe-only root: ``app`` is Live's Application, so a chain can
        # reach ``browser`` (``browser.filter_type``, ``browser.hotswap_target``)
        # — which no song/track/device path can. Never used by production.
        if parts == ["app"]:
            return _application()
        # Disambiguate by shape: ``.../slots/<N>/clip`` → clip;
        # ``.../devices/<M>`` → device; otherwise track.
        if len(parts) >= 4 and parts[-3] == "slots" and parts[-1] == "clip":
            r = pr.resolve_clip(song, path)
        elif "devices" in parts:
            r = pr.resolve_device(song, path)
        else:
            r = pr.resolve_track(song, path)
        if r.status is not pr.ResolveStatus.OK:
            return None, "%s: %s" % (r.status.name, r.detail)
        return r.obj, None

    # --- /looping/probe/py_introspect ------------------------------------

    # --- /looping/probe/reload_on_reselect ---------------------------------

    def handle_reload_on_reselect(self, args, source_addr):
        """Arm a fresh import of the surface for its next instance.

        Reply: ``/looping/probe/reload_on_reselect [json_str]`` with
        ``{"armed": bool, "loaded": n}``, ``loaded`` being how many of the
        package's modules the next instance will import afresh. Nothing
        changes until the surface is re-selected in Live's Settings (or a
        set is opened): Live then disconnects this instance and calls
        ``create_instance``, which purges and re-imports
        (``surface/__init__.py``). Args are ignored.
        """
        import json

        if self._request_reload is None:
            reply = {"armed": False, "error": "no request_reload wired"}
        else:
            reply = {"armed": True, "loaded": self._request_reload()}
            logger.info(
                "reload_on_reselect: armed (%d modules); re-select the surface in Settings",
                reply["loaded"],
            )
        self._emit(RELOAD_ON_RESELECT_ADDRESS, (json.dumps(reply),))
        return None

    def handle_py_introspect(self, args, source_addr):
        """Import a module (or take the ``app`` root) and dir what a chain reaches.

        Args: ``[module:str, chain:str, dir_regex:str]``.

        ``module`` is an importable name (``Live.Browser``,
        ``Live.SimplerDevice``) or the probe root ``app`` — Live's
        Application instance, so ``app`` + ``browser`` dirs the live
        Browser object rather than its class. ``chain`` is the
        ``_walk_chain`` grammar rooted there (empty = the module
        itself). ``dir_regex`` filters ``dir(target)``
        case-insensitively; empty lists every non-dunder name.

        Reply: ``/looping/probe/py_introspect [json_str]`` with
        ``{"module","chain","resolved_type","value_repr","doc","enum",
        "dir_total","dir","truncated","error"}``. ``enum`` is
        ``{name: int}`` when the target is a Boost.Python enum
        (``Live.Browser.FilterType``). The reply is trimmed to fit a
        UDP datagram — ``dir`` first, then ``doc`` — and ``truncated``
        says so; narrow with ``dir_regex`` to see the rest.

        Exists because ``lom_introspect`` resolves only song / track /
        device / clip paths, and questions about the API surface itself
        ("does this build's Browser have X") live on modules and
        classes. Every read is inside ``except Exception`` — ``hasattr``
        alone raises on Live 12.
        """
        import importlib
        import json
        import re
        payload = {
            "module": "", "chain": "", "resolved_type": "", "value_repr": "",
            "doc": "", "enum": None, "dir_total": 0, "dir": [],
            "truncated": 0, "error": None,
        }
        module = str(args[0]).strip() if args else ""
        chain = str(args[1]) if len(args) > 1 else ""
        dir_regex = str(args[2]) if len(args) > 2 else ""
        payload["module"] = module
        payload["chain"] = chain
        if not module:
            payload["error"] = "no module"
            return (json.dumps(payload),)

        if module == "app":
            root, err = _application()
            if err is not None:
                payload["error"] = err
                return (json.dumps(payload),)
        else:
            try:
                root = importlib.import_module(module)
            except Exception as e:
                payload["error"] = "import %s: %s: %s" % (module, type(e).__name__, e)
                return (json.dumps(payload),)

        try:
            target = _walk_chain(root, chain) if chain.strip() else root
        except Exception as e:
            payload["error"] = "chain: %s: %s" % (type(e).__name__, e)
            return (json.dumps(payload),)

        payload["resolved_type"] = _repr(type(target), 120)
        payload["value_repr"] = _repr(target)
        try:
            payload["doc"] = str(getattr(target, "__doc__", "") or "")[:600]
        except Exception as e:
            payload["doc"] = "<__doc__ raised %s>" % e
        payload["enum"] = _enum_values(target)

        try:
            names = dir(target)
        except Exception as e:
            payload["dir"] = ["<dir() raised: %s>" % e]
        else:
            if dir_regex:
                try:
                    pat = re.compile(dir_regex, re.IGNORECASE)
                except re.error as e:
                    payload["error"] = "bad regex: %s" % e
                    return (json.dumps(payload),)
                names = [n for n in names if pat.search(n)]
            else:
                names = [n for n in names if not (n.startswith("__") and n.endswith("__"))]
            payload["dir"] = sorted(names)
            payload["dir_total"] = len(payload["dir"])

        blob = json.dumps(payload)
        while len(blob.encode("utf-8")) > _PY_REPLY_BYTES and payload["dir"]:
            payload["truncated"] = 1
            payload["dir"] = payload["dir"][: max(0, len(payload["dir"]) * 3 // 4)]
            blob = json.dumps(payload)
        if len(blob.encode("utf-8")) > _PY_REPLY_BYTES:
            payload["truncated"] = 1
            payload["doc"] = payload["doc"][:80]
            payload["value_repr"] = payload["value_repr"][:80]
            blob = json.dumps(payload)
        logger.info("py_introspect module=%s chain=%s type=%s dir=%d/%d err=%s",
                    module, chain, payload["resolved_type"], len(payload["dir"]),
                    payload["dir_total"], payload["error"])
        return (blob,)

    # --- /looping/probe/lom_set -------------------------------------------

    def handle_lom_set(self, args, source_addr):
        """Assign LOM attributes and report before/after plus timing.

        Args: ``[path:str, sets_json:str, undo_group:int?]``. ``sets_json``
        is a JSON array of ``[attr_chain, value]`` pairs applied in order
        inside this one handler call — so N writes land on one control
        tick, the shape a surface-side fan-out has. A value of the form
        ``{"$ref": "<chain>"}`` is resolved against the target first, so
        a LOM object (a ``DrumPad`` for ``view.selected_drum_pad``) can be
        assigned. ``undo_group=1`` wraps the writes in
        ``song.begin_undo_step()`` / ``end_undo_step()``.

        Reply: ``/looping/probe/lom_set [json_str]`` with
        ``{"path","undo_group","writes":[{chain,before,after,changed,
        error,us}],"total_us","undo_error"}``.

        DESTRUCTIVE — mutates the live set. Issue #489 measurements
        2 (mapped-parameter write refused), 3 (undo grouping) and 4
        (per-cell fan-out cost).
        """
        import json
        import time
        payload = {
            "path": "", "undo_group": 0, "resolve_error": None,
            "writes": [], "total_us": 0, "undo_error": None,
        }
        if not args or self._registry is None:
            payload["resolve_error"] = (
                "no registry" if self._registry is None else "no args"
            )
            return (json.dumps(payload),)
        path = str(args[0]) if len(args) > 0 else ""
        sets_json = str(args[1]) if len(args) > 1 else ""
        try:
            undo_group = int(args[2]) if len(args) > 2 else 0
        except (TypeError, ValueError):
            undo_group = 0
        payload["path"] = path
        payload["undo_group"] = undo_group
        try:
            sets = json.loads(sets_json) if sets_json.strip() else []
            if not isinstance(sets, list):
                raise ValueError("sets_json must be a JSON array")
        except ValueError as e:
            payload["resolve_error"] = "sets_json: %s" % e
            return (json.dumps(payload),)
        target, err = self._resolve_introspect_path(path)
        if err is not None:
            payload["resolve_error"] = err
            return (json.dumps(payload),)
        song = self._registry._song
        t_all = time.perf_counter()
        if undo_group:
            try:
                song.begin_undo_step()
            except Exception as e:
                payload["undo_error"] = "begin: %s: %s" % (type(e).__name__, e)
        for item in sets:
            entry = {"chain": "", "before": "", "after": "",
                     "changed": 0, "error": "", "us": 0}
            try:
                chain, value = item[0], item[1]
                entry["chain"] = str(chain)
                if isinstance(value, dict) and "$ref" in value:
                    value = _walk_chain(target, str(value["$ref"]))
                parent, attr = _walk_parent(target, str(chain))
                entry["before"] = _repr(getattr(parent, attr))
                t0 = time.perf_counter()
                setattr(parent, attr, value)
                entry["us"] = int((time.perf_counter() - t0) * 1e6)
                entry["after"] = _repr(getattr(parent, attr))
                entry["changed"] = 0 if entry["after"] == entry["before"] else 1
            except Exception as e:
                entry["error"] = "%s: %s" % (type(e).__name__, e)
            payload["writes"].append(entry)
        if undo_group:
            try:
                song.end_undo_step()
            except Exception as e:
                payload["undo_error"] = "%s end: %s: %s" % (
                    payload["undo_error"] or "", type(e).__name__, e,
                )
        payload["total_us"] = int((time.perf_counter() - t_all) * 1e6)
        blob = json.dumps(payload)
        logger.info(
            "lom_set path=%s writes=%d undo_group=%d total_us=%d",
            path, len(payload["writes"]), undo_group, payload["total_us"],
        )
        return (blob,)

    # --- /looping/probe/song_time_probe -----------------------------------

    def handle_song_time_probe(self, args, source_addr):
        """Measure the cadence of ``Song.current_song_time`` listener fires.

        Args: ``[cmd:str]`` — ``start`` attaches a listener that records
        ``(time.monotonic(), current_song_time)`` per fire into a bounded
        deque; ``stats`` replies with the fire count, elapsed seconds,
        rate, interval mean / p50 / p95 / p99 / max / min (ms) and the
        per-fire beat delta; ``stop`` detaches. The callback only reads.
        Issue #489 addendum measurement 6 (surface clock granularity).
        """
        import json
        import time
        cmd = str(args[0]) if args else "stats"
        payload = {"cmd": cmd, "error": None}
        if self._registry is None:
            payload["error"] = "no registry"
            return (json.dumps(payload),)
        song = self._registry._song
        if cmd == "start":
            if self._song_time_cb is not None:
                payload["error"] = "already running"
                return (json.dumps(payload),)
            samples = collections.deque(maxlen=20000)

            def cb():
                try:
                    samples.append(
                        (time.monotonic(), float(song.current_song_time)),
                    )
                except Exception:
                    samples.append((time.monotonic(), float("nan")))

            try:
                song.add_current_song_time_listener(cb)
            except Exception as e:
                payload["error"] = "attach: %s: %s" % (type(e).__name__, e)
                return (json.dumps(payload),)
            self._song_time_cb = cb
            self._song_time_samples = samples
            payload["started"] = 1
        elif cmd == "stop":
            self._detach_song_time_probe()
            payload["stopped"] = 1
        else:
            s = list(self._song_time_samples or ())
            payload["count"] = len(s)
            payload["running"] = 1 if self._song_time_cb is not None else 0
            if len(s) >= 2:
                iv = [(s[i][0] - s[i - 1][0]) * 1000.0 for i in range(1, len(s))]
                iv_sorted = sorted(iv)

                def pct(p):
                    return iv_sorted[min(len(iv_sorted) - 1, int(p * len(iv_sorted)))]

                span = s[-1][0] - s[0][0]
                payload["elapsed_s"] = round(span, 3)
                payload["hz"] = round((len(s) - 1) / span, 2) if span > 0 else None
                payload["interval_ms"] = {
                    "mean": round(sum(iv) / len(iv), 3),
                    "p50": round(pct(0.5), 3), "p95": round(pct(0.95), 3),
                    "p99": round(pct(0.99), 3),
                    "max": round(max(iv), 3), "min": round(min(iv), 3),
                }
                bd = [s[i][1] - s[i - 1][1] for i in range(1, len(s))]
                bd = [b for b in bd if b == b]  # drop NaN reads
                if bd:
                    payload["beat_delta"] = {
                        "mean": round(sum(bd) / len(bd), 5),
                        "max": round(max(bd), 5), "min": round(min(bd), 5),
                    }
                payload["last_song_time"] = s[-1][1]
        return (json.dumps(payload),)

    def _detach_song_time_probe(self) -> None:
        cb = self._song_time_cb
        self._song_time_cb = None
        if cb is None or self._registry is None:
            return
        try:
            self._registry._song.remove_current_song_time_listener(cb)
        except Exception as e:
            logger.warning("song_time_probe detach failed: %s", e)

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        self._detach_song_time_probe()
