"""PropertyComponent — v3 LiveAPI device property channel (PR-3.5.7).

Owns ``/looping/v3/property/{subscribe,unsubscribe,set,value}`` per
[04 §3.5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#35-device-property-operations)
and [ADR-002](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/adr-002-property-wire-doctrine.md).

Properties are user-mutable named fields on a LOM device that fire
asynchronously (sample-marker drag, preset reload, voice-mode swap,
etc.) but do **not** advance ``generation`` — they don't reshape the
LOM tree. The wire shape mirrors ``/looping/v3/param/*`` with one
shape difference: keying is ``(devicePath, propertyName)``, not a
path suffix. ADR-002 §Decision spells out why:

- Properties are *named fields on a position*, not positions.
- Allowlist exists so a UI bug can't scribble on ``device.is_active``
  or ``track.arrangement_clips`` because the surface was happy to
  forward anything (the v2 ``setProperty`` shape).
- ``subscribe`` self-serves as cold-read; no ``query`` address.

Allowlist (closed, day-one set per ADR-002 §Context):

- ``Simpler``: ``playback_mode``, ``slicing_playback_mode``,
  ``sample.warp_mode``, ``sample.warping``,
  ``sample.slicing_sensitivity``, ``sample.gain``, ``sample.start_marker``,
  ``sample.end_marker``, ``sample.length`` (read-only),
  ``sample.file_path`` (read-only), ``sample.slices`` (read-only,
  list-of-int → JSON-string on the wire).
- ``Drift``:  ``voice_mode_index``.
- ``DrumGroupDevice``: ``vm.fx1``, ``vm.fx2``, ``vm.fxType``,
  ``vm.attack``, ``vm.decay``, ``vm.start``, ``vm.pitch``, ``vm.release``,
  ``vm.sustain``, ``vm.oscAmount``, ``vm.oscCoarse``, ``vm.pitchEnvAmount``,
  ``vm.pitchEnvAttack``, ``vm.spread``, ``vm.gain`` — the
  **computed** rows (ADR-428). No LOM attribute backs them: reads and
  writes route to the ``drum_vm`` provider
  (``DrumVirtualMacroComponent``), which holds the value and fans a
  write out to every pad's instrument. Because nothing in the LOM
  fires for a virtual value, ``handle_set`` emits the ``property/value``
  echo itself for these rows — the one exception to the no-echo rule
  below. ``vm.members`` (Milestone 1b) is the read-only census beside
  them: a JSON string (pad count, pad-class histogram, mapping flags,
  per-function member / held counts) the UI routes and dims on.
  ``vm.macro.<name>`` (2026-09-07) is the one **open-ended** family: a
  kit whose pads are nested Instrument Racks carries a function per
  pad-rack macro name, listed by the census, and the name rides after
  the prefix verbatim. :func:`spec_for` synthesises the same computed
  row for any such name on a ``DrumGroupDevice`` — the class is still
  closed, and the provider answers a name the kit lacks with nil.

Adding a new entry is one constant-table edit + one test. Anything
else rejects with ``write-rejected detail="property-not-allowed"``.

Subscription bookkeeping lives at the ``ControlSurface`` level
(here), not inside ``DevicesComponent`` — properties cut across the
device's LOM shape and merging them into ``DevicesComponent`` would
reintroduce the v2 sprawl the "static fields beat property bags"
doctrine ([04 §5.1]) was ratified to prevent.

Listener attach:

- The listener attaches on the LOM container that actually fires.
  Live's value listeners exist for some attributes directly on the
  device (``Drift.voice_mode_index``) and some on a sub-object
  (``sample.warping`` fires via the ``sample`` container). The
  allowlist entry names the listener target and the attribute name.
- The closure captures ``(devicePath, propertyName)`` so fire emits
  ``/looping/v3/property/value`` without a reverse lookup. Same
  pattern as canonical-path capture for params (§6.1).

Optimistic write rejection: a ``set`` that fails on the LOM side
(e.g. ``sample.length`` is read-only and assignment raises) returns
``write-rejected detail="property-read-only"``. The UI's optimistic
local leaf is corrected by the next ``property/value`` event — same
contract as ADR-001 for params.

Bool coercion: ``sample.warping`` is a ``bool`` in the LOM but the
wire encodes it as an OSC int (``0`` or ``1``) per [04 §3.5] note.
We coerce on both directions so the wire never carries a Python
``bool``.

Structural invalidation: on ``state/invalidate``, any subscription
whose ``devicePath`` no longer resolves is torn down server-side
(no UI round-trip). The UI's refcounted subscription manager
re-subscribes under the new path once it rebinds — same contract as
mid-drag param writes.
"""

from __future__ import annotations

import json
import logging
from typing import Callable, Dict, List, Optional, Tuple

# The virtual-macro vocabulary comes from the module that owns it, not
# through the component's re-export shim. One statement per alias is
# ruff's isort default (``combine-as-imports`` off), not a leftover.
from .drum_vm_functions import (
    DRUM_RACK_CLASS_NAME,
)
from .drum_vm_functions import (
    FUNCTIONS as DRUM_VM_FUNCTIONS,
)
from .drum_vm_functions import (
    MEMBERS_KEY as DRUM_VM_MEMBERS_KEY,
)
from .drum_vm_functions import (
    MEMBERS_PROPERTY as DRUM_VM_MEMBERS_PROPERTY,
)
from .drum_vm_functions import (
    PROPERTY_PREFIX as DRUM_VM_PREFIX,
)
from .drum_vm_functions import (
    PROVIDER_NAME as DRUM_VM_PROVIDER,
)
from .drum_vm_functions import (
    SELECTED_PAD_KEY as DRUM_VM_SELECTED_PAD_KEY,
)
from .drum_vm_functions import (
    SELECTED_PAD_PROPERTY as DRUM_VM_SELECTED_PAD_PROPERTY,
)
from .drum_vm_functions import (
    is_macro_property as is_drum_vm_macro_property,
)
from .drum_vm_functions import (
    is_pad_property as is_drum_vm_pad_property,
)
from .DrumPadChainComponent import (
    PAD_FX_KEY as DRUM_PAD_FX_KEY,
)
from .DrumPadChainComponent import (
    PAD_FX_PROPERTY as DRUM_PAD_FX_PROPERTY,
)
from .DrumPadChainComponent import (
    PROVIDER_NAME as DRUM_PAD_CHAIN_PROVIDER,
)
from .DrumPadChainComponent import (
    is_pad_chain_property as is_drum_pad_chain_property,
)

# ADR-350: Live's v3 framework hands out a fresh Python wrapper per read, so
# ``is`` comparison against a stored handle always fails at runtime even when
# it is the same LOM object. ``same_lom_handle`` is the canonical comparison —
# ``is`` fast path, then masked ``_live_ptr`` — shared with the resolver rather
# than reimplemented here.
from .path_resolver import ResolveStatus, resolve_device, same_lom_handle

logger = logging.getLogger("looping")

# --- wire addresses (closed-enum, kept here so renames fail at import-
# scope rather than at runtime in the dispatcher table) -------------------

V3_PROPERTY_SUBSCRIBE_ADDRESS = "/looping/v3/property/subscribe"
V3_PROPERTY_UNSUBSCRIBE_ADDRESS = "/looping/v3/property/unsubscribe"
V3_PROPERTY_SET_ADDRESS = "/looping/v3/property/set"
V3_PROPERTY_VALUE_ADDRESS = "/looping/v3/property/value"

# /looping/v3/error from [04 §7.1] — same address as DevicesComponent.
V3_ERROR_ADDRESS = "/looping/v3/error"

# Closed-enum error codes per [04 §7.2]. ``property-not-allowed`` and
# ``property-read-only`` were added by PR-3.5.7-spec; the others reuse
# the existing v3 enum.
V3_ERROR_PATH_NOT_FOUND = "path-not-found"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"
V3_ERROR_GENERATION_STALE = "generation-stale"
V3_ERROR_WRITE_REJECTED = "write-rejected"
V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED = "property-not-allowed"
V3_ERROR_DETAIL_PROPERTY_READ_ONLY = "property-read-only"
# ADR-428: a computed row whose provider was never registered — surface
# wiring bug, reported loudly rather than swallowed.
V3_ERROR_DETAIL_COMPUTED_PROVIDER_MISSING = "computed-provider-missing"

# How long ``on_structural_invalidate`` waits before re-resolving its
# subscriptions. **Must exceed ``V3StateFullComponent``'s own
# ``_STATE_FULL_DEBOUNCE_MS`` (75)**, because a rebind's fresh
# ``property/value`` has to land on the UI *after* the ``state/full``
# carrying the device it belongs to — a value that arrives first is wiped
# by the UI's wholesale replacement of a device record whose class
# changed. `test_structural_pass_waits_out_the_state_full_debounce` pins
# the relationship so the two cannot drift.
_STRUCTURAL_PASS_DELAY_MS = 100


# --- allowlist ------------------------------------------------------------




class PropertySpec:
    """One entry in the allowlist.

    ``listener_path`` names the dotted attribute path from the device
    to the **container that owns the value listener**. ``attr_name``
    is the actual attribute on that container — so for
    ``sample.warping`` the listener attaches to ``device.sample`` and
    the read/write target is ``device.sample.warping``. For
    ``voice_mode_index`` (a direct device attribute) the listener
    attaches to ``device`` itself and ``attr_name`` is
    ``voice_mode_index``.

    ``writable`` gates the ``set`` handler: ``sample.length`` is
    read-only because it's derived from the loaded sample; a write
    returns ``write-rejected detail="property-read-only"``.

    ``coerce_bool_to_int`` flips the OSC encoding for the one
    boolean property (``sample.warping``). On the wire we emit ``0``
    or ``1``; on the LOM we read/write Python ``bool``. The wire-side
    OSC codec encodes Python ``bool`` as the BLOB type code in some
    libraries which the JS side won't decode — the int-coercion
    sidesteps that for the one property where it matters.

    ``coerce_dict_to_json`` (PR-3.5.7-impl-followup-b, 2026-04-16)
    routes dict-valued properties through JSON strings on the wire
    per the ADR-002 amendment. Compressor's
    ``available_input_routing_types`` / ``input_routing_type`` are
    the first consumers. ``json.dumps`` on cold-read/fire,
    ``json.loads`` before ``setattr``. Mutually exclusive with
    ``coerce_bool_to_int`` / ``coerce_to_int`` — a value is either a
    scalar or a dict, not both.

    ``resolve_via_vector`` (PR-3.5.7-impl-followup-c, 2026-04-21)
    names a companion LOM attribute (``available_input_routing_types``)
    on the same target that holds the set of valid proxy objects for a
    dict-coerced write. When set, ``handle_set`` decodes the JSON to a
    dict as usual but then walks the named vector and picks the proxy
    whose ``identifier`` (preferred) or ``display_name`` (fallback)
    matches the decoded dict, assigning that proxy to the attribute.
    Live's LOM rejects plain dicts for proxy-typed attributes — the
    read returns a proxy but the write must also be a proxy, not the
    dict we get back from ``json.loads``. Only meaningful when
    ``coerce_dict_to_json`` is set; no-op on scalar specs.

    ``computed`` (ADR-428, 2026-09-07) names a provider registered on the
    component (``computed_providers`` / :meth:`register_computed_provider`)
    that owns the value instead of a LOM attribute. For such a row
    ``attr_name`` is the provider's key for the value (the virtual-macro
    function name), ``listener_path`` must be empty and no coercion flag
    may be set: the provider does its own coercion and there is no LOM
    listener to attach — subscribe asks the provider to bind, set hands
    the provider the value and echoes what it stored.
    """

    __slots__ = (
        "listener_path", "attr_name", "writable",
        "coerce_bool_to_int", "coerce_to_int", "coerce_dict_to_json",
        "resolve_via_vector", "cascade_to", "computed",
    )

    def __init__(
        self,
        listener_path: str,
        attr_name: str,
        writable: bool,
        coerce_bool_to_int: bool = False,
        coerce_to_int: bool = False,
        coerce_dict_to_json: bool = False,
        resolve_via_vector: Optional[str] = None,
        cascade_to: Optional[Tuple[str, ...]] = None,
        computed: Optional[str] = None,
    ) -> None:
        self.listener_path = listener_path
        self.attr_name = attr_name
        self.writable = writable
        self.coerce_bool_to_int = coerce_bool_to_int
        # Live's LOM rejects float-where-int-expected on integer-typed
        # attributes (`playback_mode`, `sample.start_marker`,
        # `voice_mode_index`, IR-category/file indices). The wire's OSC
        # codec collapses small whole numbers to either int or float
        # depending on the JS-side encoder; we round to int on write
        # when the LOM type demands it. Round() rather than int() so a
        # 1.999999 float-rounding artifact lands on 2, not 1.
        self.coerce_to_int = coerce_to_int
        self.coerce_dict_to_json = coerce_dict_to_json
        self.resolve_via_vector = resolve_via_vector
        # Sibling properties to re-read + emit whenever this one fires
        # or is written. Use case: ``sample.slicing_sensitivity`` triggers
        # Live to recompute ``sample.slices``. The slices listener was
        # never seen to fire — but until 2026-09-27 no property listener
        # was attached at all (``add_value_listener`` does not exist on
        # these objects), so whether ``add_slices_listener`` fires on a
        # recompute is unmeasured; the cascade stays. Naming a cascade
        # target means: after this property's listener fires (or after a
        # successful ``set``), also re-read the named target through its
        # own spec and emit a ``property/value`` for it. Tuple of wire
        # property names (e.g. ``("sample.slices",)``); each must be in
        # ALLOWLIST under the same device class.
        self.cascade_to = cascade_to or ()
        # A property's wire shape is either scalar-ish or dict-shaped,
        # never both. The assert catches allowlist drift where a
        # future entry accidentally sets two coercions at once — the
        # combination has no defined semantics and would paper over a
        # real shape question.
        if coerce_dict_to_json and (coerce_bool_to_int or coerce_to_int):
            raise ValueError(
                "PropertySpec: coerce_dict_to_json is mutually exclusive "
                "with coerce_bool_to_int / coerce_to_int"
            )
        if resolve_via_vector and not coerce_dict_to_json:
            raise ValueError(
                "PropertySpec: resolve_via_vector requires coerce_dict_to_json"
            )
        self.computed = computed
        if computed and (
            listener_path or coerce_bool_to_int or coerce_to_int
            or coerce_dict_to_json or resolve_via_vector or self.cascade_to
        ):
            raise ValueError(
                "PropertySpec: computed rows take no listener_path, "
                "coercion or cascade — the provider owns the value"
            )


# Day-one allowlist per ADR-002 §Context. Keys are ``(deviceClassName,
# wirePropertyName)``; values describe how to attach/read/write.
#
# ``deviceClassName`` matches what Live exposes on ``device.class_name``
# (see [LOM reference] for the canonical strings). The wire property
# name is the dotted-name string that rides on OSC; the LOM walk splits
# the same string client-side.
ALLOWLIST: Dict[Tuple[str, str], PropertySpec] = {
    # Simpler — 9 entries; sample.length and sample.file_path are read-only.
    # NOTE: Live's class_name for the built-in Simpler is
    # ``OriginalSimpler`` (the M4L observer's complete_state and
    # data/device-configs.json key both confirm). The keys below match
    # what ``device.class_name`` returns at runtime, NOT the user-
    # facing display name "Simpler".
    ("OriginalSimpler", "playback_mode"): PropertySpec(
        listener_path="", attr_name="playback_mode", writable=True,
        coerce_to_int=True,
        # Entering Slicing mode triggers Live to compute slices for the
        # first time, possibly without firing ``sample.slices``'s
        # listener (see ``cascade_to``). Cascade so the
        # very first switch to Slicing populates the UI without needing
        # the user to wiggle SENS to force a refresh.
        cascade_to=("sample.slices",),
    ),
    ("OriginalSimpler", "sample.warp_mode"): PropertySpec(
        listener_path="sample", attr_name="warp_mode", writable=True,
        coerce_to_int=True,
    ),
    # Slicing-mode voicing: 0=Mono, 1=Poly, 2=Thru. Direct device
    # attribute, observable on the device itself (no ``sample.``
    # prefix). UI surfaces a Poly/Thru tab in SimplerCentralView when
    # ``playback_mode == 2`` (Slicing). DeviceInitComponent seeds it
    # to 1 (Poly) on insert.
    ("OriginalSimpler", "slicing_playback_mode"): PropertySpec(
        listener_path="", attr_name="slicing_playback_mode", writable=True,
        coerce_to_int=True,
    ),
    ("OriginalSimpler", "sample.warping"): PropertySpec(
        listener_path="sample", attr_name="warping", writable=True,
        coerce_bool_to_int=True,
    ),
    ("OriginalSimpler", "sample.slicing_sensitivity"): PropertySpec(
        listener_path="sample", attr_name="slicing_sensitivity", writable=True,
        # Live recomputes ``sample.slices`` when sensitivity changes,
        # possibly without firing the slices listener. Cascade so
        # the UI sees the new slice list as soon as sensitivity moves.
        cascade_to=("sample.slices",),
    ),
    ("OriginalSimpler", "sample.gain"): PropertySpec(
        listener_path="sample", attr_name="gain", writable=True,
    ),
    ("OriginalSimpler", "sample.start_marker"): PropertySpec(
        listener_path="sample", attr_name="start_marker", writable=True,
        coerce_to_int=True,
    ),
    ("OriginalSimpler", "sample.end_marker"): PropertySpec(
        listener_path="sample", attr_name="end_marker", writable=True,
        coerce_to_int=True,
    ),
    ("OriginalSimpler", "sample.length"): PropertySpec(
        listener_path="sample", attr_name="length", writable=False,
    ),
    # Absolute filesystem path of the loaded sample. Empty string when
    # no sample is loaded. Powers the in-brace waveform render in
    # SimplerLoopControl — the SvelteKit /api/sample-peaks route
    # decodes the file the path points at. Per LOM reference, the LOM
    # type is ``unicode`` and the attribute is observable on the
    # ``sample`` container, so the standard nested-attr listener
    # mechanism applies (no write-path-echo fallback needed).
    ("OriginalSimpler", "sample.file_path"): PropertySpec(
        listener_path="sample", attr_name="file_path", writable=False,
    ),
    # Slice positions in frames (Live 11+). Read-only on the LOM —
    # writes go through ``insert_slice`` / ``move_slice`` /
    # ``remove_slice`` LOM functions, which the day-one allowlist
    # doesn't expose. Wire shape: list-of-int, JSON-stringified via
    # the same lane Compressor2's routing pair uses (``_jsonable``
    # iterates and returns native ints unchanged, so the list lands
    # on the wire as e.g. ``"[0, 12345, 24690]"``). UI parses with
    # ``JSON.parse`` and renders vertical lines on the slicing-mode
    # waveform canvas.
    ("OriginalSimpler", "sample.slices"): PropertySpec(
        listener_path="sample", attr_name="slices", writable=False,
        coerce_dict_to_json=True,
    ),
    # Drift — single allowlist entry, direct device attribute.
    ("Drift", "voice_mode_index"): PropertySpec(
        listener_path="", attr_name="voice_mode_index", writable=True,
        coerce_to_int=True,
    ),
    # Hybrid Reverb — 5 scalar properties, all direct device
    # attributes. Per the LOM's HybridReverbDevice (Cycling '74's LOM
    # docs). Driven by the convolution-mode controls in
    # ReverbCentralView (category / file selectors, attack / decay
    # envelopes) and the IR size slider in ReverbControl. The
    # non-scalar properties on the same device (`ir_category_list`,
    # `ir_file_list`) stay out of the allowlist — they're list-shaped,
    # which the day-one wire codec doesn't carry.
    ("Hybrid", "ir_category_index"): PropertySpec(
        listener_path="", attr_name="ir_category_index", writable=True,
        coerce_to_int=True,
    ),
    ("Hybrid", "ir_file_index"): PropertySpec(
        listener_path="", attr_name="ir_file_index", writable=True,
        coerce_to_int=True,
    ),
    ("Hybrid", "ir_attack_time"): PropertySpec(
        listener_path="", attr_name="ir_attack_time", writable=True,
    ),
    ("Hybrid", "ir_decay_time"): PropertySpec(
        listener_path="", attr_name="ir_decay_time", writable=True,
    ),
    ("Hybrid", "ir_size_factor"): PropertySpec(
        listener_path="", attr_name="ir_size_factor", writable=True,
    ),
    # Compressor — sidechain routing pair; both dict-shaped on the LOM
    # (per LOM reference §CompressorDevice). PR-3.5.7-impl-followup-b
    # routes them through JSON-on-the-wire via coerce_dict_to_json —
    # see the ADR-002 amendment for the "why". UtilityCentralView is
    # the consumer. available_input_routing_types is read-only (LOM
    # exposes it as a read-only list of sources); input_routing_type
    # is the selection dict (write == pick a source).
    #
    # Class name is "Compressor2" (not "Compressor") — confirmed by
    # data/device-configs.json key. The "Compressor"/"Compressor2"
    # split is Live's own class-name versioning for the 2nd-gen
    # device; grep(the tree) if adding another and in doubt.
    ("Compressor2", "available_input_routing_types"): PropertySpec(
        listener_path="", attr_name="available_input_routing_types",
        writable=False, coerce_dict_to_json=True,
    ),
    ("Compressor2", "input_routing_type"): PropertySpec(
        listener_path="", attr_name="input_routing_type",
        writable=True, coerce_dict_to_json=True,
        resolve_via_vector="available_input_routing_types",
    ),
}

# Drum Rack virtual macros (ADR-428). One computed row per function in
# ``DrumVirtualMacroComponent.FUNCTIONS`` — ``vm.fx1`` … ``vm.pitch`` —
# generated from that table so the two can't drift. ``attr_name`` is the
# function name the provider keys on; there is no LOM attribute behind
# any of them.
ALLOWLIST.update({
    (DRUM_RACK_CLASS_NAME, DRUM_VM_PREFIX + _fn): PropertySpec(
        listener_path="", attr_name=_fn, writable=True,
        computed=DRUM_VM_PROVIDER,
    )
    for _fn in DRUM_VM_FUNCTIONS
})
# The membership census (Milestone 1b): read-only, JSON string on the
# wire, same provider. ``writable=False`` means ``handle_set`` rejects it
# with ``property-read-only`` before the provider is ever asked.
ALLOWLIST[(DRUM_RACK_CLASS_NAME, DRUM_VM_MEMBERS_PROPERTY)] = PropertySpec(
    listener_path="", attr_name=DRUM_VM_MEMBERS_KEY, writable=False,
    computed=DRUM_VM_PROVIDER,
)
# Live's selected pad on the rack (2026-09-08): an int note, read / write,
# re-emitted by the rack view's own listener when Live's selection moves.
ALLOWLIST[(DRUM_RACK_CLASS_NAME, DRUM_VM_SELECTED_PAD_PROPERTY)] = PropertySpec(
    listener_path="", attr_name=DRUM_VM_SELECTED_PAD_KEY, writable=True,
    computed=DRUM_VM_PROVIDER,
)


# Effect presence per pad (issue #491, 3.8.0): every populated pad's chain
# devices as one read-only JSON row, from the pad-chain provider — the
# row the FX grid flips its tiles on at touch-down.
ALLOWLIST[(DRUM_RACK_CLASS_NAME, DRUM_PAD_FX_PROPERTY)] = PropertySpec(
    listener_path="", attr_name=DRUM_PAD_FX_KEY, writable=False,
    computed=DRUM_PAD_CHAIN_PROVIDER,
)

# The rack-macro family: ``vm.macro.<name>`` on a Drum Rack, one computed
# row per name, synthesised on first sight and kept so every subscription
# on the same name shares one spec object. ``vm.pad.<note>.<fn>`` and
# ``vm.padChain.<note>`` share the cache; the provider on the spec says
# which component answers.
_DRUM_VM_MACRO_SPECS: Dict[str, PropertySpec] = {}


def spec_for(class_name: str, property_name: str) -> Optional[PropertySpec]:
    """The allowlist row for ``(class_name, property_name)``: a table hit,
    or a synthesised computed row for a Drum Rack's ``vm.macro.<name>``
    or ``vm.pad.<note>.<fn>`` (2026-09-08 — one pad's value, absolute);
    ``None`` for anything else (→ ``property-not-allowed``)."""
    spec = ALLOWLIST.get((class_name, property_name))
    if spec is not None:
        return spec
    if class_name != DRUM_RACK_CLASS_NAME:
        return None
    if is_drum_pad_chain_property(property_name):
        # A pad's chain subscription (issue #491): read-only, answered by
        # the pad-chain provider — the cold read carries the pad's
        # presence entry and sends its records as a pad-scoped tree.
        spec = _DRUM_VM_MACRO_SPECS.get(property_name)
        if spec is None:
            spec = _DRUM_VM_MACRO_SPECS[property_name] = PropertySpec(
                listener_path="", attr_name=property_name[len(DRUM_VM_PREFIX):],
                writable=False, computed=DRUM_PAD_CHAIN_PROVIDER,
            )
        return spec
    if not (is_drum_vm_macro_property(property_name) or is_drum_vm_pad_property(property_name)):
        return None
    spec = _DRUM_VM_MACRO_SPECS.get(property_name)
    if spec is None:
        spec = _DRUM_VM_MACRO_SPECS[property_name] = PropertySpec(
            listener_path="", attr_name=property_name[len(DRUM_VM_PREFIX):],
            writable=True, computed=DRUM_VM_PROVIDER,
        )
    return spec


# --- helpers --------------------------------------------------------------


def _coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``. Bytes → utf-8; everything else → ``str()``.

    Mirrors ``DevicesComponent._coerce_str`` so behaviour is identical
    across the two v3 components. Kept module-private to discourage
    import sprawl — string coercion is a property of the wire, not of
    any one component.
    """
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


def _walk_listener_target(device, listener_path: str):
    """Walk the dotted ``listener_path`` from ``device`` to a LOM container.

    Returns the container or ``None`` if any segment is missing. An
    empty path returns ``device`` itself.

    We do this via repeated ``getattr`` rather than a single dotted
    string because Live's LOM container objects (e.g. ``device.sample``)
    can be ``None`` between preset loads — a preset that drops the
    sample slot would leave ``device.sample is None`` and the next
    ``getattr(device.sample, "warping")`` would raise. The explicit
    walk lets us detect that cleanly and degrade to "no listener
    target right now" rather than crashing the subscribe handler.
    """
    target = device
    if not listener_path:
        return target
    for segment in listener_path.split("."):
        try:
            target = getattr(target, segment)
        except Exception as e:
            logger.debug(
                "PropertyComponent: walk %r missing segment %r on %r: %s",
                listener_path, segment, type(target).__name__, e,
            )
            return None
        if target is None:
            return None
    return target


def _attr_listener_method(target, verb: str, attr_name: str):
    """``target.<verb>_<attr_name>_listener`` or ``None`` when Live has none.

    Live's Python LOM observes each property through its own
    ``add_<attr>_listener`` / ``remove_<attr>_listener`` pair; there is
    no generic ``add_value_listener`` outside ``DeviceParameter``, whose
    property is literally ``value``. Some properties are not observable
    at all (``Sample.length``) and have no pair. ``getattr`` is guarded
    broadly because Live raises ``RuntimeError`` on some stale handles.
    """
    try:
        method = getattr(target, "%s_%s_listener" % (verb, attr_name), None)
    except Exception:
        return None
    return method if callable(method) else None


def _remove_attr_listener(target, attr_name: str, cb) -> None:
    """Detach ``cb`` from ``target``'s ``attr_name`` listener. Raises
    ``AttributeError`` when there is no remover; callers log and move on."""
    remover = _attr_listener_method(target, "remove", attr_name)
    if remover is None:
        raise AttributeError("no remove_%s_listener" % attr_name)
    remover(cb)


def _jsonable(value):
    """Coerce a LOM value into a JSON-native shape.

    Live exposes sidechain routing as ``Track.RoutingType`` proxies
    inside a ``RoutingTypeVector`` container — neither is JSON-native,
    and ``json.dumps(default=str)`` falls back to ``repr`` (e.g.
    ``"<Track.RoutingTypeVector object at 0x...>"``), which the UI
    can't parse. Each proxy exposes ``display_name`` + ``identifier``
    attributes; the UI and unit tests both consume that pair shape.

    Also handles plain dicts / iterables so new dict-coerced properties
    with hybrid shapes (a dict containing a vector, a list of proxies)
    serialize correctly without per-property casework.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if hasattr(value, "display_name") or hasattr(value, "identifier"):
        return {
            "display_name": getattr(value, "display_name", None),
            "identifier": getattr(value, "identifier", None),
        }
    try:
        iterator = iter(value)
    except TypeError:
        return str(value)
    return [_jsonable(item) for item in iterator]


def _resolve_proxy_from_dict(target, vector_attr: str, decoded):
    """Find the LOM proxy whose identifier/display_name matches ``decoded``.

    Live exposes ``input_routing_type`` (and friends) as a
    ``Track.RoutingType`` proxy on read and **requires the same proxy
    object on write** — assigning a plain dict silently fails (LOM
    accepts the ``setattr`` call, emits no error, and leaves the
    attribute unchanged; the UI's optimistic write then sticks around
    waiting for an echo that never fires).

    We resolve by walking ``getattr(target, vector_attr)`` (e.g.
    ``device.available_input_routing_types``) and matching first by
    ``identifier`` (stable, numeric; the LOM's primary key) and
    falling back to ``display_name`` (stable across Live versions
    for built-in routings). Returns the proxy or ``None`` if the
    vector is missing / empty / no entry matches — ``None`` is the
    caller's cue to emit ``write-rejected`` rather than push a bad
    write to the LOM.

    Mirrors the pattern in
    ``FootTriggerComponent._set_input_routing_channel`` which resolves
    ``available_input_routing_channels`` by display-name for the
    hold-action track-create flow.
    """
    if not isinstance(decoded, dict):
        return None
    try:
        vector = getattr(target, vector_attr)
    except Exception as e:
        logger.warning(
            "PropertyComponent: read %s raised: %s", vector_attr, e,
        )
        return None
    if vector is None:
        return None

    want_id = decoded.get("identifier")
    want_name = decoded.get("display_name")
    try:
        iterator = list(vector)
    except TypeError:
        return None

    if want_id is not None:
        for proxy in iterator:
            if getattr(proxy, "identifier", None) == want_id:
                return proxy
    if want_name is not None:
        for proxy in iterator:
            if getattr(proxy, "display_name", None) == want_name:
                return proxy
    return None


def _read_property_value(device, spec: PropertySpec):
    """Read the current property value through the spec.

    Returns ``None`` if the listener target is missing or the read
    raises. Used for cold-read on subscribe and for fire-time emits.
    """
    target = _walk_listener_target(device, spec.listener_path)
    if target is None:
        return None
    try:
        value = getattr(target, spec.attr_name)
    except Exception as e:
        logger.debug(
            "PropertyComponent: read %s.%s raised: %s",
            spec.listener_path or "<device>", spec.attr_name, e,
        )
        return None
    if spec.coerce_bool_to_int:
        # bool subclasses int in Python; cast explicitly so the wire
        # encoder doesn't see a ``bool`` and emit it under a type code
        # the JS side won't decode.
        return 1 if bool(value) else 0
    if spec.coerce_dict_to_json:
        # OSC has no dict type code; JSON-string the value per the
        # ADR-002 amendment. ``_jsonable`` handles the LOM proxy/vector
        # case (``RoutingType`` / ``RoutingTypeVector``) that
        # ``default=str`` mis-serialized as a repr string.
        try:
            return json.dumps(_jsonable(value))
        except (TypeError, ValueError) as e:
            logger.warning(
                "PropertyComponent: json.dumps %s.%s failed: %s",
                spec.listener_path or "<device>", spec.attr_name, e,
            )
            return None
    return value


# --- component ------------------------------------------------------------


class PropertyComponent:
    """Owns the ``/looping/v3/property/*`` address family.

    Args:
        song: The Live ``Song`` object. Resolution walks
            ``song.tracks`` / ``song.master_track`` directly per
            handler call via ``path_resolver.resolve_device``.
        emit: Callable ``(address, args)`` matching
            ``OSCTransport.send``. Used to emit ``property/value`` on
            subscribe-cold-read and listener fire, and ``v3/error`` on
            rejection.
        generation_component: Injected post-construction via
            :meth:`set_generation` — same wiring pattern as
            ``DevicesComponent``. Standalone unit tests skip this and
            the v3 ``set`` handler refuses with
            ``write-rejected detail="surface misconfigured"``.

    Subscription state:

        ``self._subscriptions`` keys on
        ``(devicePath, propertyName)``; values store the
        ``(device, spec, listener_callable)`` triple. Idempotent
        subscribe is implemented by checking the dict before attaching
        a fresh listener. ``unsubscribe`` is similarly idempotent.

        Subscription bookkeeping mirrors ``LOMListeners`` rather than
        the ``MutationComponent`` echo registry: properties are too
        few and too high-level for the per-tick walk model that
        param values use.
    """

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        computed_providers: Optional[Dict[str, object]] = None,
    ) -> None:
        self._song = song
        self._emit = emit
        # ADR-428: providers behind ``PropertySpec.computed`` rows, keyed by
        # the provider name the spec carries. A subscribe/set on a computed
        # row whose provider isn't registered rejects with
        # ``write-rejected detail="computed-provider-missing"`` — a wiring
        # bug we want loud, not a silent no-op.
        self._computed: Dict[str, object] = dict(computed_providers or {})
        # Optional deferred-execution adapter (LoopingSurface._schedule_delayed).
        # Used by ``_emit_cascades`` to schedule a second cascade-emit ~150ms
        # after the source mutation, catching cases where Live computes the
        # cascaded property on a later tick than the setattr (e.g. switching
        # to Slicing playback mode triggers a delayed slice-list compute).
        # ``None`` in unit tests — they assert immediate-cascade only.
        self._schedule_delayed = schedule_delayed
        self._generation = None
        self._disconnected = False
        # True between arming the deferred structural pass and its fire,
        # so a burst of structural changes costs one re-resolve.
        self._structural_pass_armed = False
        # (devicePath, propertyName) → (device, spec, listener_cb)
        self._subscriptions: Dict[
            Tuple[str, str], Tuple[object, PropertySpec, Callable[[], None]],
        ] = {}
        # (devicePath, containerSegment) → (device, container_replaced_cb).
        # When a property has a non-empty listener_path (e.g. ``sample`` or
        # ``sample.something``), the per-attr listener attaches to the
        # *current* container (e.g. ``device.sample``). Live replaces some
        # containers wholesale on user actions — Simpler swaps its
        # ``sample`` object when a new sample is dropped on it — leaving
        # every per-attr listener stranded on the dead object. We additionally
        # install a device-level ``add_<segment>_listener`` (e.g.
        # ``add_sample_listener``) that fires on container replacement; on
        # fire, we re-walk + re-attach every per-attr listener under that
        # device whose ``listener_path`` starts with ``segment``, and emit a
        # fresh ``property/value`` so the UI sees the new container's state.
        self._container_listeners: Dict[
            Tuple[str, str], Tuple[object, Callable[[], None]],
        ] = {}

    def set_generation(self, generation_component) -> None:
        """Inject the v3 ``GenerationComponent`` for stale-write checks.

        Idempotent. ``LoopingSurface`` calls this immediately after
        constructing both components; standalone tests skip and the
        ``set`` handler refuses with ``surface misconfigured``.
        """
        self._generation = generation_component

    def register_computed_provider(self, name: str, provider) -> None:
        """Register (or replace) the provider behind ``computed=name`` rows.
        Idempotent; ``LoopingSurface`` may also pass providers at
        construction via ``computed_providers``."""
        self._computed[name] = provider

    # --- /looping/v3/property/subscribe -----------------------------------

    def handle_subscribe(self, args, source_addr) -> None:
        """``/looping/v3/property/subscribe [devicePath, propertyName]``.

        Per [04 §3.5]: attach a listener for ``device.<propertyName>``
        and emit one ``property/value`` carrying the current value.
        Idempotent — re-subscribing the same pair is a no-op (the
        existing listener stays, and the cold-read fires again so the
        UI's refcount-bumped second reader gets a value to bind to).
        """
        if self._disconnected:
            return
        coerced = self._coerce_pair(V3_PROPERTY_SUBSCRIBE_ADDRESS, args)
        if coerced is None:
            return
        device_path, property_name = coerced

        device, spec = self._resolve_and_check(
            V3_PROPERTY_SUBSCRIBE_ADDRESS, device_path, property_name,
        )
        if device is None or spec is None:
            return

        key = (device_path, property_name)
        if key not in self._subscriptions and not self._attach_subscription(
            device, device_path, property_name, spec,
            error_address=V3_PROPERTY_SUBSCRIBE_ADDRESS,
        ):
            # Nothing was recorded (a computed row with no provider, which
            # `_attach_subscription` has already reported). No cold read.
            return

        # Cold-read the current value and emit. Done after the
        # subscription is recorded so a fire that races the cold-read
        # finds the dict entry intact.
        value = self._read_value(device, device_path, spec)
        self._safe_emit(
            V3_PROPERTY_VALUE_ADDRESS,
            (device_path, property_name, value),
        )

    def _attach_subscription(
        self,
        device,
        device_path: str,
        property_name: str,
        spec: PropertySpec,
        error_address: Optional[str] = None,
    ) -> bool:
        """Record ``(device_path, property_name)`` and attach its listener.

        The one implementation of "bind this property to this device",
        shared by :meth:`handle_subscribe` and the structural-rebind path
        (:meth:`_rebind_device`) so a rebound subscription is wired
        exactly like a fresh one. Caller is responsible for the cold-read
        emit — subscribe and rebind word their logging differently but
        both send the same ``property/value``.

        Returns ``False`` only when nothing was recorded: a computed row
        whose provider is not registered. ``error_address`` names the
        wire address that error is reported against; ``None`` reports
        nothing (the rebind path, where no client asked for anything).
        """
        key = (device_path, property_name)
        if spec.computed:
            # Computed row: no LOM listener target. The provider binds
            # its own change listeners (rack pads/chains) and seeds the
            # value; the caller's cold-read asks it.
            provider = self._computed.get(spec.computed)
            if provider is None:
                if error_address is not None:
                    self._emit_error(
                        error_address, V3_ERROR_WRITE_REJECTED,
                        device_path=device_path, property_name=property_name,
                        detail=V3_ERROR_DETAIL_COMPUTED_PROVIDER_MISSING,
                    )
                return False
            try:
                provider.subscribe(device, device_path, spec.attr_name)
            except Exception as e:
                logger.warning(
                    "PropertyComponent: computed provider %s subscribe "
                    "for %s/%s raised: %s",
                    spec.computed, device_path, property_name, e,
                )
            self._subscriptions[key] = (device, spec, _noop)
            return True

        target = _walk_listener_target(device, spec.listener_path)
        if target is None:
            # Container missing right now (e.g. Simpler with no
            # sample loaded). Record an empty subscription so the
            # next state/invalidate teardown sees the key, but
            # there's no listener to attach. The caller's cold-read of
            # ``None`` lets the UI's $derived view bind to undefined
            # and re-evaluate when a property/value arrives later.
            logger.debug(
                "PropertyComponent: no listener target for %s on %s; "
                "subscribing without listener",
                spec.listener_path or "<device>", device_path,
            )
            self._subscriptions[key] = (device, spec, _noop)
        else:
            adder = _attr_listener_method(target, "add", spec.attr_name)
            if adder is None:
                # Not observable in Live (``Sample.length``): the value
                # reaches the UI through the cold read and the re-read
                # every container/device rebind emits.
                logger.debug(
                    "PropertyComponent: %s.%s on %s has no "
                    "add_%s_listener; cold read only",
                    spec.listener_path or "<device>", spec.attr_name,
                    device_path, spec.attr_name,
                )
                self._subscriptions[key] = (device, spec, _noop)
            else:
                cb = self._make_fire_callback(
                    device=device, device_path=device_path,
                    property_name=property_name, spec=spec,
                )
                try:
                    adder(cb)
                except Exception as e:
                    logger.warning(
                        "PropertyComponent: add_%s_listener failed for "
                        "%s on %s: %s",
                        spec.attr_name, spec.listener_path or "<device>",
                        device_path, e,
                    )
                    # Record the subscription anyway so unsubscribe is
                    # symmetric; the fire path is then dead.
                    self._subscriptions[key] = (device, spec, _noop)
                else:
                    self._subscriptions[key] = (device, spec, cb)

        # Container-replaced safety net (see ``_container_listeners``
        # docstring on ``__init__``). Idempotent per
        # (device_path, container_segment).
        self._ensure_container_listener(device, device_path, spec)
        return True

    # --- /looping/v3/property/unsubscribe ---------------------------------

    def handle_unsubscribe(self, args, source_addr) -> None:
        """``/looping/v3/property/unsubscribe [devicePath, propertyName]``.

        Detach the listener. Idempotent — unsubscribing an unknown
        pair is a no-op (logged at DEBUG, not WARN, because a
        UI-side refcount that drops twice is a benign race, not a
        bug).
        """
        if self._disconnected:
            return
        coerced = self._coerce_pair(V3_PROPERTY_UNSUBSCRIBE_ADDRESS, args)
        if coerced is None:
            return
        device_path, property_name = coerced
        key = (device_path, property_name)

        sub = self._subscriptions.pop(key, None)
        if sub is None:
            logger.debug(
                "PropertyComponent: unsubscribe miss %s/%s (already gone)",
                device_path, property_name,
            )
            return
        device, spec, cb = sub
        if spec.computed:
            self._release_computed(spec, device_path)
            return
        listener_path = spec.listener_path  # captured before any detach
        if cb is _noop:
            self._maybe_drop_container_listener(device_path, listener_path)
            return
        target = _walk_listener_target(device, spec.listener_path)
        if target is None:
            self._maybe_drop_container_listener(device_path, listener_path)
            return
        try:
            _remove_attr_listener(target, spec.attr_name, cb)
        except Exception as e:
            # Live can raise on remove if the underlying object went
            # stale between attach and detach (preset reload, plugin
            # swap). Log and move on — the listener is effectively gone
            # because its target is.
            logger.debug(
                "PropertyComponent: remove listener failed for "
                "%s.%s on %s: %s",
                spec.listener_path or "<device>", spec.attr_name,
                device_path, e,
            )
        self._maybe_drop_container_listener(device_path, listener_path)

    # --- /looping/v3/property/set -----------------------------------------

    def handle_set(self, args, source_addr) -> None:
        """``/looping/v3/property/set [devicePath, propertyName, value, generation]``.

        Per [04 §3.5] and [§4.2]:

        - Generation-stale → ``generation-stale``.
        - Bad arity / coerce failure → ``write-rejected``.
        - Unknown ``(deviceClassName, propertyName)`` →
          ``write-rejected detail="property-not-allowed"``.
        - Read-only property → ``write-rejected detail="property-read-only"``.
        - Path resolves but ``getattr`` raises (LOM rejected the type
          or the value) → ``write-rejected`` with the exception detail.

        Optimistic local write is the UI's responsibility (ADR-001 +
        ADR-002): the surface authoritative-corrects via the next
        ``property/value`` listener fire — which fires synchronously
        with the LOM assignment in Live's main thread.
        """
        if self._disconnected:
            return
        if len(args) < 4:
            self._emit_error(
                V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                device_path="", property_name="",
                detail="expected [devicePath, propertyName, value, generation]",
            )
            return
        try:
            device_path = _coerce_str(args[0])
            property_name = _coerce_str(args[1])
            value = args[2]
            ui_gen = int(args[3])
        except (TypeError, ValueError) as e:
            self._emit_error(
                V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                device_path=_coerce_str(args[0]) if args else "",
                property_name=_coerce_str(args[1]) if len(args) > 1 else "",
                detail="coerce failed: %s" % e,
            )
            return

        logger.debug(
            "PropertyComponent.handle_set RX: %s/%s = %r (ui_gen=%d)",
            device_path, property_name, value, ui_gen,
        )

        # Generation gate first — a stale-gen write against a still-
        # valid path may be pointed at what *used to* be there. Same
        # rationale as DevicesComponent.handle_set_param_v3.
        if self._generation is None:
            logger.error(
                "PropertyComponent.handle_set: generation component "
                "not wired; refusing %s/%s",
                device_path, property_name,
            )
            self._emit_error(
                V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                device_path=device_path, property_name=property_name,
                detail="surface misconfigured",
            )
            return
        if self._generation.is_stale(ui_gen):
            self._emit_error(
                V3_PROPERTY_SET_ADDRESS, V3_ERROR_GENERATION_STALE,
                device_path=device_path, property_name=property_name,
                detail="ui=%d, surf=%d" % (ui_gen, self._generation.current),
            )
            return

        device, spec = self._resolve_and_check(
            V3_PROPERTY_SET_ADDRESS, device_path, property_name,
        )
        if device is None or spec is None:
            return

        if not spec.writable:
            self._emit_error(
                V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                device_path=device_path, property_name=property_name,
                detail=V3_ERROR_DETAIL_PROPERTY_READ_ONLY,
            )
            return

        if spec.computed:
            # ADR-428: the provider coerces, stores and applies (a Drum
            # Rack fan-out lands at the end of the drain pass). Nothing
            # in the LOM fires for a virtual value, so the echo is ours:
            # emit what the provider stored — clamped, int for enum /
            # semitone functions — which is also what corrects an
            # out-of-range optimistic write on the UI side.
            provider = self._computed.get(spec.computed)
            if provider is None:
                self._emit_error(
                    V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                    device_path=device_path, property_name=property_name,
                    detail=V3_ERROR_DETAIL_COMPUTED_PROVIDER_MISSING,
                )
                return
            try:
                ok, stored, detail = provider.write(
                    device, device_path, spec.attr_name, value,
                )
            except Exception as e:
                logger.warning(
                    "PropertyComponent.handle_set: computed provider %s "
                    "raised for %s/%s: %s",
                    spec.computed, device_path, property_name, e,
                )
                ok, stored, detail = False, None, "provider raised: %s" % e
            if not ok:
                self._emit_error(
                    V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                    device_path=device_path, property_name=property_name,
                    detail="lom rejected: %s" % detail,
                )
                return
            self._safe_emit(
                V3_PROPERTY_VALUE_ADDRESS,
                (device_path, property_name, stored),
            )
            return

        target = _walk_listener_target(device, spec.listener_path)
        if target is None:
            # Container missing right now (no sample loaded, etc).
            # Treat as path-not-found-equivalent for properties — the
            # named slot doesn't exist on this device in its current
            # state.
            self._emit_error(
                V3_PROPERTY_SET_ADDRESS, V3_ERROR_PATH_NOT_FOUND,
                device_path=device_path, property_name=property_name,
                detail="container missing for %s" % spec.listener_path,
            )
            return

        # Coerce wire value → LOM type. The OSC arg type code already
        # matched what the JS side encoded; we flip only when the LOM
        # type demands something different from what the wire carried.
        # Other values ride through unchanged and let LOM raise on
        # mismatch (caught below as write-rejected with the LOM detail).
        write_value = value
        if spec.coerce_bool_to_int:
            try:
                write_value = bool(int(value))
            except (TypeError, ValueError):
                self._emit_error(
                    V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                    device_path=device_path, property_name=property_name,
                    detail="bad bool value: %r" % (value,),
                )
                return
        elif spec.coerce_to_int:
            try:
                write_value = int(round(float(value)))
            except (TypeError, ValueError):
                self._emit_error(
                    V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                    device_path=device_path, property_name=property_name,
                    detail="bad int value: %r" % (value,),
                )
                return
        elif spec.coerce_dict_to_json:
            # Wire carries a JSON string; decode to a dict before the
            # setattr so the LOM setter sees the shape it expects.
            # Non-string / malformed-JSON inputs are write-rejected
            # with the parse detail — same shape as the bool/int
            # branches above.
            try:
                write_value = json.loads(_coerce_str(value))
            except (TypeError, ValueError) as e:
                self._emit_error(
                    V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                    device_path=device_path, property_name=property_name,
                    detail="bad json value: %s" % e,
                )
                return
            # Proxy-typed LOM attributes (Compressor2.input_routing_type)
            # reject dicts on write — the attribute is typed as a
            # RoutingType proxy and the decoded dict needs to be
            # resolved back to one of the proxies in the companion
            # vector (available_input_routing_types). Without this the
            # setattr silently no-ops and the UI's optimistic write
            # never gets an echo. See _resolve_proxy_from_dict docstring.
            if spec.resolve_via_vector is not None:
                proxy = _resolve_proxy_from_dict(
                    target, spec.resolve_via_vector, write_value,
                )
                if proxy is None:
                    self._emit_error(
                        V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                        device_path=device_path, property_name=property_name,
                        detail="no matching proxy in %s for %r" % (
                            spec.resolve_via_vector, write_value,
                        ),
                    )
                    return
                write_value = proxy

        try:
            setattr(target, spec.attr_name, write_value)
        except Exception as e:
            # Generic LOM rejection. Includes type mismatches, range
            # rejections (``warp_mode`` only accepts the canonical
            # enum values), and Live's read-only assignments that
            # raise even when our allowlist marks them writable
            # (defensive guard).
            logger.warning(
                "PropertyComponent.handle_set: setattr %s.%s = %r raised: %s",
                spec.listener_path or "<device>", spec.attr_name,
                write_value, e,
            )
            self._emit_error(
                V3_PROPERTY_SET_ADDRESS, V3_ERROR_WRITE_REJECTED,
                device_path=device_path, property_name=property_name,
                detail="lom rejected: %s" % e,
            )
            return

        # Cascade re-emit for sibling properties whose listeners don't
        # fire (e.g. ``sample.slices`` when ``slicing_sensitivity``
        # changes). The fire callback handles the same case for
        # Live-side mutations; this is the UI-write path's mirror.
        self._emit_cascades(device, device_path, spec)

        # The LOM listener (if attached via subscribe) will fire and
        # emit the property/value echo synchronously on the same tick.
        # If no listener is attached (write-only consumer that didn't
        # subscribe first), no echo fires — that's the consumer's
        # choice. We deliberately do **not** auto-emit here because a
        # double-emit on the subscribed-and-write case would either
        # require a suppression key (DevicesComponent's pattern, but
        # too much machinery for properties) or a value-equality check
        # (race-prone if LOM clamps).

    # --- internal helpers --------------------------------------------------

    def _read_value(self, device, device_path: str, spec: PropertySpec):
        """Read through the spec: the provider for a computed row,
        ``_read_property_value`` for everything else."""
        if not spec.computed:
            return _read_property_value(device, spec)
        provider = self._computed.get(spec.computed)
        if provider is None:
            return None
        try:
            return provider.read(device, device_path, spec.attr_name)
        except Exception as e:
            logger.warning(
                "PropertyComponent: computed provider %s read for %s/%s "
                "raised: %s", spec.computed, device_path, spec.attr_name, e,
            )
            return None

    def _release_computed(self, spec: PropertySpec, device_path: str) -> None:
        """Tell the provider a computed subscription went away (unsubscribe,
        structural teardown). Best-effort — the provider is responsible for
        its own listener bookkeeping."""
        provider = self._computed.get(spec.computed)
        if provider is None:
            return
        try:
            provider.unsubscribe(device_path, spec.attr_name)
        except Exception as e:
            logger.debug(
                "PropertyComponent: computed provider %s unsubscribe for "
                "%s/%s raised: %s", spec.computed, device_path, spec.attr_name, e,
            )

    def _coerce_pair(
        self, address: str, args,
    ) -> Optional[Tuple[str, str]]:
        """Validate and coerce ``[devicePath, propertyName]`` args.

        Returns ``(device_path, property_name)`` or ``None`` after
        emitting an error. Bad arity / non-coercible types log WARN
        and return ``None``. Subscribe and unsubscribe share this so
        the wire shape stays symmetric.
        """
        if len(args) < 2:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                device_path="", property_name="",
                detail="expected [devicePath, propertyName]",
            )
            return None
        try:
            device_path = _coerce_str(args[0])
            property_name = _coerce_str(args[1])
        except (TypeError, ValueError) as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                device_path="", property_name="",
                detail="coerce failed: %s" % e,
            )
            return None
        return device_path, property_name

    def _resolve_and_check(
        self, address: str, device_path: str, property_name: str,
    ) -> Tuple[Optional[object], Optional[PropertySpec]]:
        """Resolve devicePath → LOM device and look up the allowlist entry.

        Returns ``(device, spec)`` or ``(None, None)`` after emitting
        the appropriate error code. Centralized so subscribe / unsub /
        set all reject the same way.
        """
        r = resolve_device(self._song, device_path)
        if r.status is ResolveStatus.NOT_SUPPORTED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_SUPPORTED,
                device_path=device_path, property_name=property_name,
                detail=r.detail,
            )
            return None, None
        if r.status is ResolveStatus.MALFORMED:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                device_path=device_path, property_name=property_name,
                detail="malformed: %s" % r.detail,
            )
            return None, None
        if r.status is ResolveStatus.NOT_FOUND:
            self._emit_error(
                address, V3_ERROR_PATH_NOT_FOUND,
                device_path=device_path, property_name=property_name,
                detail=r.detail,
            )
            return None, None

        device = r.obj
        class_name = _safe_class_name(device)
        spec = spec_for(class_name, property_name)
        if spec is None:
            # Unknown ``(class, prop)`` pair. ``write-rejected`` with
            # ``property-not-allowed`` is the agreed code for both
            # subscribe and set per ADR-002; subscribe gets it because
            # opening a subscription on a non-allowlisted property is
            # the same shape of UI bug as writing one.
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                device_path=device_path, property_name=property_name,
                detail=V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED,
            )
            return None, None
        return device, spec

    def _make_fire_callback(
        self, device, device_path: str, property_name: str, spec: PropertySpec,
    ) -> Callable[[], None]:
        """Build a closure that emits ``property/value`` on listener fire.

        Captures ``(device_path, property_name)`` so fire emits
        without a reverse lookup — same canonical-path-capture pattern
        used by ``LOMListeners`` for params (§6.1).

        The closure does **not** capture ``self``'s emit directly so
        teardown after disconnect is safe: it goes through
        ``self._safe_emit`` which short-circuits on the ``_disconnected``
        flag.
        """

        def _on_fire():
            value = _read_property_value(device, spec)
            self._safe_emit(
                V3_PROPERTY_VALUE_ADDRESS,
                (device_path, property_name, value),
            )
            self._emit_cascades(device, device_path, spec)

        return _on_fire

    def _emit_cascades(self, device, device_path: str, spec: PropertySpec) -> None:
        """Re-read + emit ``property/value`` for every cascade target on
        ``spec``. Used when a write or fire on the source property is
        known to mutate sibling properties whose own listeners may not
        fire (see ``cascade_to``).

        Emits twice when a ``schedule_delayed`` adapter is wired:

        - **Immediate**: covers the synchronous-recompute case
          (``slicing_sensitivity`` updates ``sample.slices`` inline on
          the same tick as the setattr).
        - **Deferred ~150ms**: covers the async-recompute case
          (entering Slicing mode via ``playback_mode``: Live computes
          the slice list on a later tick than the setattr, so the
          immediate read returns stale/empty data). The deferred re-
          read may emit the same value as the immediate one — that's
          a benign re-render on the UI side, not a correctness issue.

        Resolves each target's allowlist row by ``(class_name, name)`` so
        the correct coercion runs. Missing targets log at WARN and are
        skipped — a typo in ``cascade_to`` is a surface bug we want to
        notice in dev, not crash the fire path.
        """
        if not spec.cascade_to:
            return
        class_name = _safe_class_name(device)
        targets = []
        for target_name in spec.cascade_to:
            target_spec = ALLOWLIST.get((class_name, target_name))
            if target_spec is None:
                logger.warning(
                    "PropertyComponent: cascade target %s/%s not in allowlist; "
                    "skipping",
                    class_name, target_name,
                )
                continue
            targets.append((target_name, target_spec))

        # Immediate read+emit.
        for target_name, target_spec in targets:
            value = _read_property_value(device, target_spec)
            self._safe_emit(
                V3_PROPERTY_VALUE_ADDRESS,
                (device_path, target_name, value),
            )

        # Deferred re-emit so async-recompute cases land. No-op in unit
        # tests (no schedule_delayed wired) — those assert immediate only.
        if self._schedule_delayed is None:
            return

        def _deferred_emit():
            if self._disconnected:
                return
            for target_name, target_spec in targets:
                value = _read_property_value(device, target_spec)
                self._safe_emit(
                    V3_PROPERTY_VALUE_ADDRESS,
                    (device_path, target_name, value),
                )

        try:
            self._schedule_delayed(150, _deferred_emit)
        except Exception as e:
            logger.warning(
                "PropertyComponent: schedule_delayed for cascade failed: %s", e,
            )

    # --- container-replaced (e.g. Simpler.sample swap) handling ----------

    def _ensure_container_listener(
        self, device, device_path: str, spec: PropertySpec,
    ) -> None:
        """Install (idempotently) a device-level listener on the first
        segment of ``spec.listener_path`` so we can re-bind per-attr
        listeners when Live replaces the container wholesale.

        Without this, Simpler's wholesale ``sample`` replacement on
        sample swap leaves every ``sample.*`` per-attr listener attached
        to the orphaned old object, and the UI never sees post-swap
        property values until a manual re-subscribe.

        The listener path's first segment maps to a Live LOM listener
        method ``add_<segment>_listener`` (e.g. ``add_sample_listener``).
        Per-attr (``listener_path == ""``) properties skip this — the
        listener is on the device itself, no container to replace.
        """
        if not spec.listener_path:
            return
        segment = spec.listener_path.split(".", 1)[0]
        if not segment:
            return
        ckey = (device_path, segment)
        if ckey in self._container_listeners:
            return
        adder = getattr(device, "add_%s_listener" % segment, None)
        if not callable(adder):
            # Live doesn't expose a per-attr listener for this container —
            # skip the safety net. The per-attr listeners that subscribed
            # already are still attached; they just won't survive a
            # wholesale replacement of this container.
            logger.debug(
                "PropertyComponent: device on %s has no add_%s_listener; "
                "skipping container-replaced safety net",
                device_path, segment,
            )
            return
        cb = self._make_container_replaced_callback(device_path, segment)
        try:
            adder(cb)
        except Exception as e:
            logger.warning(
                "PropertyComponent: add_%s_listener failed on %s: %s",
                segment, device_path, e,
            )
            return
        self._container_listeners[ckey] = (device, cb)

    def _make_container_replaced_callback(
        self, device_path: str, segment: str,
    ) -> Callable[[], None]:
        """Build the callback that fires when ``device.<segment>`` is
        replaced. Re-binds every per-attr subscription under this device
        whose ``listener_path`` starts with ``segment``.

        Captures only ``device_path`` and ``segment`` (strings) so the
        closure stays trivially cheap and doesn't pin the device.
        """

        def _on_container_replaced():
            self._rebind_segment(device_path, segment)

        return _on_container_replaced

    def _rebind_segment(self, device_path: str, segment: str) -> None:
        """Re-attach every subscription under ``device_path`` whose
        ``listener_path`` starts with ``segment``, then emit a fresh
        ``property/value`` for each so the UI sees post-swap state.

        Old container is presumed dead (Live replaced it). We don't try
        to detach the old per-attr listener: the previous container is
        already orphaned and the new ``device.<segment>`` is a different
        object that never had the old callback attached. Live will GC the
        dead container; we just stop tracking it. (Holding a reference to
        the old container to detach against would be the exact
        stale-handle bug this code exists to fix.)

        The *device* is unchanged here — only the container under it —
        which is the one difference from :meth:`_rebind_device`.
        """
        if self._disconnected:
            return
        # Snapshot the keys first — ``_rebind_and_emit`` mutates
        # ``self._subscriptions``.
        affected = [
            (key, sub[0], sub[1])
            for key, sub in self._subscriptions.items()
            if key[0] == device_path
            and sub[1].listener_path.split(".", 1)[0] == segment
        ]
        for key, device, spec in affected:
            self._rebind_and_emit(key, device, spec)

    def _rebind_and_emit(self, key: Tuple[str, str], device, spec: PropertySpec) -> None:
        """Re-record ``key``'s subscription against ``device`` and emit its
        current value.

        The one implementation of "what this subscription was bound to
        was replaced — bind it again and tell the UI", shared by the
        container-replaced safety net (:meth:`_rebind_segment`) and the
        device-replaced pass (:meth:`_rebind_device`). Dropping the entry
        first is what makes :meth:`_attach_subscription` take its attach
        branch rather than treating the key as already-subscribed.

        The value is emitted whether or not the attach succeeded — the UI
        needs post-swap state even if our re-attach raced — and reads
        ``None`` when the new target is missing, which clears the stale
        value rather than leaving it on screen.
        """
        self._subscriptions.pop(key, None)
        self._attach_subscription(device, key[0], key[1], spec)
        value = self._read_value(device, key[0], spec)
        self._safe_emit(V3_PROPERTY_VALUE_ADDRESS, (key[0], key[1], value))

    def _maybe_drop_container_listener(
        self, device_path: str, listener_path: str,
    ) -> None:
        """If no remaining subscriptions on ``device_path`` use
        ``listener_path``'s first segment, detach the device-level
        container listener.

        Symmetric with :meth:`_ensure_container_listener` so a UI
        unsubscribe-of-last-consumer doesn't leave a dangling listener
        on the device.
        """
        if not listener_path:
            return
        segment = listener_path.split(".", 1)[0]
        if not segment:
            return
        ckey = (device_path, segment)
        entry = self._container_listeners.get(ckey)
        if entry is None:
            return
        # Any other subscription under this device still using the segment?
        for key, (_d, spec, _cb) in self._subscriptions.items():
            if key[0] != device_path:
                continue
            if spec.listener_path.split(".", 1)[0] == segment:
                return  # Still in use — keep the container listener.
        device, cb = entry
        remover = getattr(device, "remove_%s_listener" % segment, None)
        if callable(remover):
            try:
                remover(cb)
            except Exception as e:
                logger.debug(
                    "PropertyComponent: remove_%s_listener failed on %s: %s",
                    segment, device_path, e,
                )
        self._container_listeners.pop(ckey, None)

    def _safe_emit(self, address: str, payload: tuple) -> None:
        """Emit guarded by ``_disconnected``.

        A late LOM fire can race ``disconnect`` (the listener removal
        loop runs against the per-attr removers, but a fire that
        was already in-flight on the framework side will still
        execute). Short-circuiting here keeps ``OSCTransport.send``
        from hitting a closed socket.
        """
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning(
                "PropertyComponent: emit %s failed: %s", address, e,
            )

    def _emit_error(
        self,
        address: str,
        code: str,
        device_path: str,
        property_name: str,
        detail: str,
    ) -> None:
        """Emit ``/looping/v3/error [address, code, devicePath, propertyName, detail]``.

        Five-arg shape rather than the four-arg shape ``DevicesComponent``
        uses because the property ``key`` is a pair, not a single
        path. The UI's error handler reads positional args; adding
        ``propertyName`` as a 4th arg before ``detail`` keeps the
        error-routing symmetric with the request shape.
        """
        self._safe_emit(
            V3_ERROR_ADDRESS,
            (address, code, device_path, property_name, detail),
        )

    # --- structural-invalidate hook ---------------------------------------

    def on_structural_invalidate(self) -> None:
        """Re-resolve every subscription after a structural change.

        Wired in ``LoopingSurface`` beside the generation advance and the
        state/full republish. **Deferred** by
        :data:`_STRUCTURAL_PASS_DELAY_MS` so the fresh values a rebind
        emits land on the UI *after* the tree that carries the new
        device: the UI replaces a device record wholesale when its class
        changes, and a ``property/value`` that arrived first would be
        wiped by that replacement. Bursts coalesce — the pass re-reads
        the whole table, so a second arming inside the window is
        redundant work, not a second answer. Falls through to an inline
        pass when no scheduler was wired (unit tests), matching
        ``V3StateFullComponent._publish``.
        """
        if self._disconnected or not self._subscriptions:
            return
        if self._schedule_delayed is None:
            self._run_structural_invalidate()
            return
        if self._structural_pass_armed:
            return
        self._structural_pass_armed = True
        try:
            self._schedule_delayed(
                _STRUCTURAL_PASS_DELAY_MS, self._fire_structural_pass,
            )
        except Exception as e:
            self._structural_pass_armed = False
            logger.warning(
                "PropertyComponent: schedule_delayed failed (%s); "
                "running the structural pass inline", e,
            )
            self._run_structural_invalidate()

    def _fire_structural_pass(self) -> None:
        """Trailing-edge handler for :meth:`on_structural_invalidate`."""
        self._structural_pass_armed = False
        if self._disconnected:
            return
        self._run_structural_invalidate()

    def _run_structural_invalidate(self) -> None:
        """Resolve every subscription's ``devicePath`` against the current
        LOM and sort each into one of three outcomes.

        - **Same device at the same path** — the listener is still valid,
          leave it alone.
        - **Path resolves to a *different* device** — Live replaced the
          device in that slot (a preset load in replace-instrument mode,
          a hot-swap, Live's own browser). Re-bind onto the new device
          and emit its value. Tearing down here instead used to strand
          the UI: the path string is unchanged, so its subscription
          ``$effect`` never re-runs and it never re-subscribes, while a
          ``state/invalidate`` carries no paths to tell it otherwise —
          leaving the surface's half gone, the UI's half held, and the
          last device's values on screen for good. A property the new
          device's class does not allow *is* genuinely dead: it is torn
          down, and a ``None`` clears the stale value.
        - **Path gone** (``NOT_FOUND`` / ``NOT_SUPPORTED`` — a
          returns/chains slot the UI subscribed to before Phase 1's
          reject path was wired, defensive) — unsubscribed.
        """
        if self._disconnected or not self._subscriptions:
            return

        dead_keys: List[Tuple[str, str]] = []
        rebinds: List[Tuple[Tuple[str, str], object]] = []
        for key, (device, spec, cb) in self._subscriptions.items():
            r = resolve_device(self._song, key[0])
            if r.status is not ResolveStatus.OK:
                dead_keys.append(key)
                continue
            if same_lom_handle(r.obj, device):
                # Same device at the same path — listener still valid.
                continue
            rebinds.append((key, r.obj))

        for key in dead_keys:
            self._teardown_subscription(key)

        # The container listeners are keyed by path and hold the *old*
        # device, and ``_maybe_drop_container_listener`` keeps one alive
        # while any sibling subscription still uses its segment — so a
        # per-key teardown would leave the safety net bound to the dead
        # device and ``_ensure_container_listener`` would then skip its
        # own key as already-installed. Drop them per path up front.
        for device_path in {key[0] for key, _ in rebinds}:
            self._drop_container_listeners_for(device_path)
        for key, new_device in rebinds:
            self._rebind_device(key, new_device)

    def _teardown_subscription(self, key: Tuple[str, str]) -> None:
        """Drop one subscription and detach whatever it holds. Idempotent."""
        sub = self._subscriptions.pop(key, None)
        if sub is None:
            return
        device, spec, cb = sub
        if spec.computed:
            self._release_computed(spec, key[0])
            return
        if cb is not _noop:
            target = _walk_listener_target(device, spec.listener_path)
            if target is not None:
                try:
                    _remove_attr_listener(target, spec.attr_name, cb)
                except Exception as e:
                    logger.debug(
                        "PropertyComponent: remove listener failed "
                        "for %s/%s: %s", key[0], key[1], e,
                    )
        self._maybe_drop_container_listener(key[0], spec.listener_path)

    def _drop_container_listeners_for(self, device_path: str) -> None:
        """Detach and forget every container listener on ``device_path``.

        Best-effort: the device they are bound to has just been replaced,
        so ``remove_<segment>_listener`` may well raise on the dead
        handle. Forgetting them is the part that matters — it lets
        ``_ensure_container_listener`` install fresh ones on the newcomer.
        """
        for ckey in [k for k in self._container_listeners if k[0] == device_path]:
            device, cb = self._container_listeners.pop(ckey)
            remover = getattr(device, "remove_%s_listener" % ckey[1], None)
            if not callable(remover):
                continue
            try:
                remover(cb)
            except Exception as e:
                logger.debug(
                    "PropertyComponent: remove_%s_listener on the replaced "
                    "device at %s raised: %s", ckey[1], device_path, e,
                )

    def _rebind_device(self, key: Tuple[str, str], new_device) -> None:
        """Move one subscription onto the device that replaced its own.

        The property must still be allowlisted for the newcomer's class:
        a Drum Rack replaced by a Wavetable answers no for ``vm.members``,
        and that subscription really is dead — tear it down and clear the
        UI's stale value with a ``None`` rather than pretend otherwise.
        """
        sub = self._subscriptions.get(key)
        if sub is None:
            return
        spec = spec_for(_safe_class_name(new_device), key[1])
        if spec is None:
            self._teardown_subscription(key)
            self._safe_emit(V3_PROPERTY_VALUE_ADDRESS, (key[0], key[1], None))
            logger.debug(
                "PropertyComponent: %s/%s dropped — the device that "
                "replaced it does not carry that property",
                key[0], key[1],
            )
            return
        self._teardown_subscription(key)
        self._rebind_and_emit(key, new_device, spec)
        logger.debug(
            "PropertyComponent: %s/%s re-bound onto the device that "
            "replaced it", key[0], key[1],
        )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Detach all listeners, drop subscription state.

        Called by ``LoopingSurface.disconnect`` before the transport
        closes, same ordering as ``MutationComponent``: the
        ``_disconnected`` flag flips first so any in-flight LOM fire
        becomes a no-op, then the listener detachment loop runs.
        """
        self._disconnected = True
        for key, (device, spec, cb) in list(self._subscriptions.items()):
            if cb is _noop:
                continue
            target = _walk_listener_target(device, spec.listener_path)
            if target is None:
                continue
            try:
                _remove_attr_listener(target, spec.attr_name, cb)
            except Exception as e:
                logger.debug(
                    "PropertyComponent.disconnect: remove listener "
                    "failed for %s/%s: %s", key[0], key[1], e,
                )
        for ckey, (device, cb) in list(self._container_listeners.items()):
            _device_path, segment = ckey
            remover = getattr(device, "remove_%s_listener" % segment, None)
            if callable(remover):
                try:
                    remover(cb)
                except Exception as e:
                    logger.debug(
                        "PropertyComponent.disconnect: remove_%s_listener "
                        "failed on %s: %s", segment, _device_path, e,
                    )
        self._container_listeners.clear()
        self._subscriptions.clear()


def _noop() -> None:
    """Sentinel listener used when no live target exists at subscribe time.

    Subscribing without a listener is a deliberate state — the UI
    refcount still lives, and the next ``state/invalidate`` may
    re-resolve the target. Comparing ``cb is _noop`` lets unsubscribe
    skip the ``remove_<attr>_listener`` call cleanly.
    """


def _safe_class_name(device) -> str:
    """Read ``device.class_name``, returning ``""`` on any failure.

    Live raises on class_name access for some torn-down device handles
    rather than returning a sentinel — guard so the allowlist lookup
    sees a clean string and rejects it as ``property-not-allowed``
    (the right code: we can't even tell what it is, let alone allow it).
    """
    try:
        return getattr(device, "class_name", "") or ""
    except Exception:
        return ""
