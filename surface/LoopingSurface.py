"""LoopingSurface — Gate 2 tempo read.

Subclasses ``ableton.v3.control_surface.ControlSurface``, binds a UDP
socket on ``osc.pythonSurface.localPort``, drains it on every Live
tick via ``schedule_message``, and owns a small but growing set of
handlers and observers for the `/live/*` and `/looping/*` families.

- Gate 1 (shipped): ``/live/test`` heartbeat.
- Gate 2 (shipped): ``SessionComponent`` attaches a listener to
  ``song.tempo`` and emits ``/looping/session/tempo [bpm]`` on change;
  ``/live/song/get/tempo`` returns the current BPM on demand.
- Gate 3 (shipped): ``/live/song/set/tempo [bpm]`` writes to
  ``song.tempo`` with AbletonOSC-matching 20–999 validation
  (reject, do not clamp) and a one-shot suppression flag that
  swallows the echo fire LOM emits from our own write.
- Gate 4a (shipped): ``BrowserProbe`` exposes
  ``/looping/probe/browser_load [asset_class, hint]`` and emits
  ``/looping/probe/browser_result [class, ok, detail]``. Probe-only,
  routed only to the Gate 4a driver, no UI consumer.
- Gate 4b (shipped): ``SchedulerProbe`` exposes
  ``/looping/probe/schedule_run [delay_ms, count]`` and emits
  ``/looping/probe/schedule_result
  [delay_ms, count, mean_ms, p50_ms, p99_ms, max_ms]``. Measures
  raw ``schedule_message`` fidelity; deliberately *bypasses*
  ``_schedule_delayed`` (the 100ms tick-rounding adapter) so the
  framework's actual short-delay behaviour is what gets measured,
  not the adapter's floor. See ``SchedulerProbe`` docstring.
- ``LOMListeners`` + ``DevicesComponent`` + ``DebugComponent``.
  The listener bookkeeper attaches ``song.tracks`` + per-track
  ``devices`` + per-param ``value`` listeners and fans them
  through plain callables; it holds no forward map.
  ``DevicesComponent`` owns the v3 parameter wire
  (``/looping/v3/param/set``, ``/looping/v3/param/query``,
  ``/looping/v3/state/resync``). ``DebugComponent`` answers
  ``/looping/protocol/version`` with the current protocol version
  (``"3.0.0"`` after PR-4a).

- Gate 4c: ``LifecycleProbe`` +
  ``LifecycleDecoratorProbe``. Exposes
  ``/looping/probe/lifecycle_query`` and
  ``/looping/probe/lifecycle_poke``; emits
  ``/looping/probe/lifecycle_snapshot
  [phase, fires, song_id, disconnect_count, decorator_bound]``
  and — on teardown — ``/looping/probe/lifecycle_teardown [fires]``.
  Answers [06 §2.1]: does the v3 framework's ``@listens`` +
  ``Component`` lifecycle work cleanly in a non-MIDI headless
  surface. See the module docstring for the operator procedure.

Per Looping's ``documentation/archive/m4l-to-python/05-migration-plan.md``,
AbletonOSC and M4L continue to answer every other address in those
families. The bridge's ``backendScope`` is what actually carves the
two tempo addresses out of AbletonOSC's scope.

Port numbers come from ``config/constants.json`` via
``config_loader.load()`` rather than being hardcoded here; the bridge
and surface must agree on the pair, and the project CLAUDE.md
mandates the JSON file as the single source of truth.

Note on ``LoopingElements`` below: see the Gate 0 entry in the
implementation log — v3's ``ControlSurface._create_elements``
unconditionally calls ``specification.elements_type()``, and
``None`` (the base-class default) crashes with ``TypeError``. An
empty ``ElementsBase`` subclass is the smallest thing that satisfies
the contract for a headless OSC-only surface.
"""

import logging
import time

# The host's own module — like ``ableton.v3`` below, it only exists
# inside Live's embedded interpreter. Used for
# ``Live.MidiMap.forward_midi_cc`` in ``build_midi_map`` (ADR-422).
import Live

from ableton.v3.control_surface import ControlSurface, ControlSurfaceSpecification
from ableton.v3.control_surface.elements_base import ElementsBase

# Sibling modules inside the ``Looping`` Remote Script package. Must
# be *relative* imports: Live's embedded Python loads this package via
# ``create_instance`` in ``__init__.py`` and does not put the package
# directory on ``sys.path``. An absolute ``from config_loader import
# load`` crashes at module load with ``ModuleNotFoundError``, taking
# the whole surface down (we learned this the hard way at Gate 1 —
# see 2026-04-12 log entry). Pytest still finds these modules fine
# because the test harness adds the package dir to ``sys.path``
# explicitly via ``conftest.py``.
from .components.BrowserProbe import (
    BrowserProbe,
    LOAD_ADDRESS as BROWSER_PROBE_LOAD_ADDRESS,
    PLACES_DUMP_ADDRESS as BROWSER_PROBE_PLACES_DUMP_ADDRESS,
    PLACES_LOAD_ADDRESS as BROWSER_PROBE_PLACES_LOAD_ADDRESS,
)
from .components.AlcClipProbe import (
    AlcClipProbe,
    LOAD_ADDRESS as ALC_CLIP_PROBE_LOAD_ADDRESS,
)
from .components.TrackTransposeComponent import (
    TrackTransposeComponent,
    V3_TRACK_TRANSPOSE_ADDRESS,
)
from .components.ClipNotesComponent import (
    ClipNotesComponent,
    V3_CLIP_NOTES_GET_ADDRESS,
    V3_CLIP_TRANSPOSE_ADDRESS,
    V3_CLIP_NOTES_RICH_GET_ADDRESS,
    V3_CLIP_NOTES_REMOVE_ADDRESS,
    V3_CLIP_NOTES_MODIFY_ADDRESS,
    V3_CLIP_NOTES_ADD_ADDRESS,
    V3_CLIP_NOTES_SELECT_ADDRESS,
    V3_CLIP_NOTES_DUPLICATE_ADDRESS,
)
from .components.NoteEditProbe import (
    NoteEditProbe,
    NOTE_EDIT_ADDRESS,
)
from .components.SelectionProbe import (
    SelectionProbe,
    SELECTION_ADDRESS,
)
from .components.ClipPropertiesComponent import (
    ClipPropertiesComponent,
    V3_CLIP_SET_END_MARKER_ADDRESS,
    V3_CLIP_SET_LOOP_END_ADDRESS,
    V3_CLIP_SET_LOOP_START_ADDRESS,
    V3_CLIP_SET_LOOPING_ADDRESS,
    V3_CLIP_SET_PITCH_COARSE_ADDRESS,
    V3_CLIP_SET_PITCH_FINE_ADDRESS,
    V3_CLIP_SET_GAIN_ADDRESS,
    V3_CLIP_SET_START_MARKER_ADDRESS,
    V3_CLIP_SET_WARP_MODE_ADDRESS,
    V3_CLIP_WARP_MARKER_ADD_ADDRESS,
    V3_CLIP_WARP_MARKER_MOVE_ADDRESS,
    V3_CLIP_WARP_MARKER_REMOVE_ADDRESS,
)
from .components.ClipsComponent import (
    ClipsComponent,
    V3_CLIP_DELETE_ADDRESS,
    V3_CLIP_DUPLICATE_ADDRESS,
    V3_CLIP_DUPLICATE_REGION_ADDRESS,
    V3_CLIP_FOCUS_ADDRESS,
    V3_CLIP_LAUNCH_ADDRESS,
    V3_CLIP_LOAD_FILE_ADDRESS,
    V3_CLIP_SAMPLE_GET_ADDRESS,
    V3_CLIP_SET_COLOR_ADDRESS,
    V3_CLIP_STOP_ADDRESS,
    V3_CLIP_SWAP_FILE_ADDRESS,
)
from .components.DeviceCommandsComponent import (
    DeviceCommandsComponent,
    V3_DEVICE_DELETE_ADDRESS,
    V3_DEVICE_MOVE_TO_END_ADDRESS,
    V3_DEVICE_MOVE_TO_TOP_ADDRESS,
    V3_DEVICE_SELECT_ADDRESS,
    V3_SIMPLER_REVERSE_ADDRESS,
    V3_SIMPLER_WARP_DOUBLE_ADDRESS,
    V3_SIMPLER_WARP_HALF_ADDRESS,
)
from .components.DrumSwapComponent import (
    DrumSwapComponent,
    V3_DRUM_FINISH_SWAP_ADDRESS,
    V3_DRUM_PAD_NAMES_ADDRESS,
    V3_DRUM_SHOW_FOR_SWAP_ADDRESS,
)
from .components.RecordSuspendComponent import (
    RecordSuspendComponent,
    V3_GROUP_RECORD_RESUME_ADDRESS,
    V3_GROUP_RECORD_SUSPEND_ADDRESS,
)
from .components.DebugComponent import (
    DebugComponent,
    LOM_INTROSPECT_ADDRESS,
    LOM_INVOKE_ADDRESS,
    LOM_SET_ADDRESS,
    SONG_TIME_PROBE_ADDRESS,
    PY_INTROSPECT_ADDRESS,
    PROTOCOL_VERSION_ADDRESS,
    REGISTRY_DUMP_ADDRESS,
    REGISTRY_PROBE_RESOLVE_ADDRESS,
)
from .components.DeviceLoadComponent import (
    DeviceLoadComponent,
    V3_DEVICE_LOAD_ADDRESS,
)
from .components.DevicesComponent import (
    DevicesComponent,
    V3_PARAM_QUERY_ADDRESS,
    V3_PARAM_SET_ADDRESS,
    V3_STATE_RESYNC_ADDRESS,
)
from .components.FootTriggerComponent import (
    FootTriggerComponent,
    V3_FOOT_HOLD_ADDRESS,
    V3_FOOT_TAP_ADDRESS,
)
from .components.WahPedalComponent import (
    WahPedalComponent,
    V3_WAH_ENGAGE_ADDRESS,
    V3_WAH_FREQ_ADDRESS,
)
from .components.MidiWheelsComponent import (
    MidiWheelsComponent,
    V3_WHEELS_MOD_ADDRESS,
    V3_WHEELS_PITCH_ADDRESS,
)
from .components.SequencerComponent import (
    SequencerComponent,
    SEQUENCER_STATS_ADDRESS,
)
from .components.TrackPrepareComponent import (
    TrackPrepareComponent,
    V3_TRACK_PREPARE_ADDRESS,
    V3_TRACK_DUPLICATE_ADDRESS,
)
from .components.SimplerLoadComponent import (
    SimplerLoadComponent,
    V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
    V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
)
from .components.GenerationComponent import GenerationComponent
from .components.GrooveComponent import (
    GrooveComponent,
    V3_CLIP_GROOVE_SET_BASE_ADDRESS,
    V3_CLIP_GROOVE_SET_FILE_ADDRESS,
    V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS,
    V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS,
    V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS,
    V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS,
)
from .components.GroovePoolComponent import GroovePoolComponent
from .components.HandshakeComponent import (
    HandshakeComponent,
    V3_HANDSHAKE_HELLO_ADDRESS,
)
from .components.InvalidationComponent import InvalidationComponent
from .components.LOMListeners import LOMListeners
from .components import live_library
from .components.MasterComponent import (
    MasterComponent,
    V3_MASTER_COLOR_ADDRESS,
    V3_MASTER_MUTE_ADDRESS,
    V3_MASTER_NAME_ADDRESS,
    V3_MASTER_PAN_ADDRESS,
    V3_MASTER_VOLUME_ADDRESS,
)
from .components.MetersComponent import MetersComponent
from .components.PlayheadComponent import PlayheadComponent
from .components.MutationComponent import MutationComponent
from .components.DrumVirtualMacroComponent import (
    DrumVirtualMacroComponent,
    PROVIDER_NAME as DRUM_VM_PROVIDER_NAME,
)
from .components.DrumPadChainComponent import (
    DrumPadChainComponent,
    PROVIDER_NAME as DRUM_PAD_CHAIN_PROVIDER_NAME,
)
from .components.PropertyComponent import (
    PropertyComponent,
    V3_PROPERTY_SET_ADDRESS,
    V3_PROPERTY_SUBSCRIBE_ADDRESS,
    V3_PROPERTY_UNSUBSCRIBE_ADDRESS,
)
from .components.LifecycleProbe import (
    LifecycleDecoratorProbe,
    LifecycleProbe,
    POKE_ADDRESS as LIFECYCLE_PROBE_POKE_ADDRESS,
    QUERY_ADDRESS as LIFECYCLE_PROBE_QUERY_ADDRESS,
)
from .components.ScenesComponent import (
    ScenesComponent,
    V3_SCENE_LAUNCH_ADDRESS,
    V3_SCENE_STOP_ADDRESS,
)
from .components.SchedulerProbe import (
    RUN_ADDRESS as SCHEDULER_PROBE_RUN_ADDRESS,
    SchedulerProbe,
)
from .components.KeyDetectComponent import (
    KeyDetectComponent,
    V3_SESSION_SCALE_DETECT_ADDRESS,
)
from .components.SessionComponent import (
    SessionComponent,
    V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS,
    V3_SESSION_CONTINUE_CMD_ADDRESS,
    V3_SESSION_GROOVE_AMOUNT_ADDRESS,
    V3_SESSION_IS_PLAYING_ADDRESS,
    V3_SESSION_LOOP_ADDRESS,
    V3_SESSION_LOOP_LENGTH_ADDRESS,
    V3_SESSION_LOOP_START_ADDRESS,
    V3_SESSION_METRONOME_ADDRESS,
    V3_SESSION_PLAY_CMD_ADDRESS,
    V3_SESSION_SCALE_MODE_ADDRESS,
    V3_SESSION_SCALE_NAME_ADDRESS,
    V3_SESSION_SCALE_ROOT_ADDRESS,
    V3_SESSION_SESSION_RECORD_ADDRESS,
    V3_SESSION_SIGNATURE_DEN_ADDRESS,
    V3_SESSION_SIGNATURE_NUM_ADDRESS,
    V3_SESSION_STOP_CMD_ADDRESS,
)
from .components.SessionSettingsComponent import (
    SessionSettingsComponent,
    V3_SESSION_AUTO_ARM_ADDRESS,
    V3_SESSION_AUTO_ARM_QUERY_ADDRESS,
    V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
    V3_SESSION_MOVE_VOLUME_KNOB_QUERY_ADDRESS,
    V3_SESSION_AUTO_CAPTURE_ADDRESS,
    V3_SESSION_AUTO_CAPTURE_QUERY_ADDRESS,
    V3_SESSION_KEY_FOLLOW_ADDRESS,
    V3_SESSION_KEY_FOLLOW_QUERY_ADDRESS,
)
from .components.ServerPresenceComponent import (
    ServerPresenceComponent,
    V3_SERVER_HEARTBEAT_ADDRESS,
    DEFAULT_GRACE_WINDOW_SECONDS,
    compose_auto_arm_gate,
    compose_key_follow_gate,
)
from .components.PerformanceCaptureComponent import PerformanceCaptureComponent
from .components.SurfaceHelloComponent import SurfaceHelloComponent
from .components.TrackMetadataComponent import (
    TrackMetadataComponent,
    V3_TRACK_ARM_ADDRESS,
    V3_TRACK_COLOR_ADDRESS,
    V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS,
    V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS,
    V3_TRACK_MUTE_ADDRESS,
    V3_TRACK_MUTE_TOGGLE_ADDRESS,
    V3_TRACK_NAME_ADDRESS,
    V3_TRACK_PAN_ADDRESS,
    V3_TRACK_SEND_ADDRESS,
    V3_TRACK_SET_FOLD_STATE_ADDRESS,
    V3_TRACK_SET_ROLE_ADDRESS,
    V3_TRACK_SOLO_ADDRESS,
    V3_TRACK_VOLUME_ADDRESS,
)
from .components.ExclusiveArmComponent import ExclusiveArmComponent
from .components.SelectedTrackComponent import (
    SelectedTrackComponent,
    V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS,
    V3_MOVE_PAD_HOLD_ADDRESS,
    V3_SELECT_CLIP_ADDRESS,
    V3_SELECTED_SCENE_ADDRESS,
    V3_SELECTED_TRACK_ADDRESS,
    V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS,
    V3_TRACK_SELECT_ADDRESS,
)
from .components.V3StateFullComponent import V3StateFullComponent
from .components.DeviceInitComponent import DeviceInitComponent
from .components.path_resolver import compose_track_path
from .components.ViewComponent import ViewComponent, V3_VIEW_FOCUS_ADDRESS
from .components.midi_pedal_input import MidiPedalInput
from .components.FootSwitchComponent import (
    FootSwitchComponent,
    V3_FOOT_SWITCH_ENABLED_ADDRESS,
    V3_FOOT_SWITCH_LEARN_ADDRESS,
)
from .config_loader import feature_on, load as load_constants
from .components import alc_resolver
from .tcp_transport import TCPTransport
from .drain_pump import (
    DEFAULT_INTERVAL_MS,
    STATS_ADDRESS as DRAIN_STATS_ADDRESS,
    FastDrainPump,
)
from .osc_transport import OSCTransport
from . import perf_logging
from . import perf_profiler

logger = logging.getLogger("looping")

# ADR-422: source tag handed to the gesture handlers in the slot where
# OSC delivery passes the sender's UDP address — shows up in their
# ``src=%r`` log lines so Log.txt distinguishes MIDI-borne gestures
# from OSC-borne ones.
_MIDI_PEDAL_SOURCE = "midi:pedal-input"


class LoopingElements(ElementsBase):
    """Empty element factory — see module docstring."""

    pass


class LoopingSpecification(ControlSurfaceSpecification):
    """Minimal spec: no MIDI I/O, no components, empty element tree."""

    elements_type = LoopingElements


class LoopingSurface(ControlSurface):
    """Gate 2 shell — binds UDP, echoes ``/live/test``, observes tempo.

    Lifecycle:

    - ``__init__``: super init, load constants, bind transport on
      ``pythonSurface.localPort``, register the ``/live/test`` echo,
      instantiate ``SessionComponent`` which attaches the tempo
      listener and registers the ``/live/song/get/tempo`` handler,
      start the tick.
    - ``_tick`` (scheduled every Live tick): drain the socket. Handlers
      run synchronously on the main thread — safe for LOM access.
    - ``disconnect`` (called by Live on quit / slot switch / reload):
      tear down components (detaches listeners) then close the
      transport. Critical for hot-reloads; without the transport
      close, the bytecode cache + a stale bind make "select Looping
      in slot" fail on retry with ``Address already in use``.
    """

    # ===== __init__ phase methods (audit hotspot #1) =================
    # __init__ used to be a 1252-line wall mixing transport bind, ~30
    # component instantiations, listener wiring, handler registration,
    # the structural-change rebind composite, the handshake-accept emit
    # chain, the Gate 4a/4b/4c lifecycle probes, and the tick start.
    # The blocks below are extracted incrementally; the rest still
    # lives inline. Each phase reads only `self.X` set by an earlier
    # phase, so the call order in __init__ is the source of truth.
    # =================================================================

    def _setup_transport(self, constants) -> bool:
        """Bind the pythonSurface OSC port and stash the transport.

        Returns True on success, False if the port couldn't be bound
        (most often: stale Live session holding the port). On failure
        ``self._transport`` is set to None and the surface keeps loading
        without OSC — heartbeat times out, which the bridge surfaces as
        a visible diagnostic.

        Naming note: ``localPort`` / ``remotePort`` in constants.json
        are **bridge-centric** — ``localPort`` is where the bridge
        binds, ``remotePort`` is where the bridge sends. From the
        *surface's* POV the names are therefore reversed: the surface
        binds on ``remotePort`` (that's where the bridge sends to) and
        sends replies to ``localPort`` (that's where the bridge
        listens).
        """
        py_osc = constants["osc"]["pythonSurface"]
        host = py_osc.get("host", "127.0.0.1")
        bridge_bind_port = py_osc["localPort"]       # bridge receives here
        surface_bind_port = py_osc["remotePort"]     # surface receives here
        try:
            self._transport = OSCTransport(
                local_addr=(host, surface_bind_port),
                remote_addr=(host, bridge_bind_port),
                name="pythonSurface",
            )
        except OSError as e:
            logger.error(
                "Could not bind pythonSurface port %d: %s. "
                "Heartbeat will fail. Quit any stray Live instances "
                "and re-select the Control Surface slot.",
                surface_bind_port, e,
            )
            self._transport = None
            return False

        self._transport.add_handler("/live/test", self._handle_live_test)

        # TCP leg, bound beside UDP rather than replacing it. Migration
        # is one address at a time: ``state/full`` moves first because
        # it is the only thing whose 389 KB actually needs the stream;
        # everything else keeps working over UDP untouched, and
        # fire-and-forget senders on ephemeral ports (the Max probe
        # drivers) still require a datagram socket regardless.
        #
        # A bind failure here is not fatal to the surface as a whole —
        # every other address keeps working over UDP. It is fatal to
        # ``state/full``: since 3.6.0 the tree ships as one message and
        # there is no datagram it fits in, so with no stream the
        # publisher warns and holds. The UI keeps whatever tree it had
        # and gets a fresh one when a peer appears.
        tcp_port = py_osc.get("tcpPort")
        self._tcp_transport = None
        if tcp_port:
            try:
                self._tcp_transport = TCPTransport(
                    local_addr=(host, tcp_port), name="surfaceTCP",
                    # Late-bound: the publisher does not exist yet at
                    # transport-bind time (phase 1 vs phase 5 of
                    # __init__), and a peer cannot connect before the
                    # first pump anyway — which is after both exist.
                    on_connect=self._on_stream_peer_connected,
                )
            except OSError as e:
                logger.error(
                    "Could not bind pythonSurface TCP port %d: %s. "
                    "state/full cannot be published without it.",
                    tcp_port, e,
                )
                self._tcp_transport = None
        return True

    def _init_heartbeat_state(self) -> None:
        """Seed the _tick state shared by heartbeat + scheduler probe.

        ``_heartbeat_seq`` / ``_last_heartbeat_ts`` drive the 1 Hz
        control-thread heartbeat (see ``_tick``); seeding at 0 makes
        the first tick emit immediately so cold-start liveness proves
        on the wire without waiting a full second.

        ``_last_tick_mono`` drives the scheduler-hiccup probe — log
        when the gap between successive ``_tick`` fires exceeds
        ~500 ms. A long gap means the control thread was blocked
        inside a listener callback or our own handler code. Seeded 0
        so the first tick doesn't log.

        Steady-state gaps are ~100 ms. This docstring used to claim
        "Live targets ~100 Hz so steady-state gaps are ~10 ms", which
        conflated two different clocks. Live does run a ~100 Hz
        internal loop — ``Live.Base.Timer(interval=1)`` rides it at a
        measured 92.8 Hz, which is what ``drain_pump`` uses — but
        ``schedule_message`` does not dispatch at that rate. One
        ``schedule_message`` tick is ten of Live's internal beats:
        measured 2026-08-31 two independent ways, reply-clustering
        across a 40-probe burst gave 99.44 ms and the max of 120
        randomised-phase round trips gave ~104 ms.

        So the 500 ms threshold is ~5 missed ticks, not ~50. Still
        the right alarm level; only the arithmetic behind it moved.
        """
        self._heartbeat_seq = 0
        self._last_heartbeat_ts = 0.0
        self._last_tick_mono = 0.0

    def _setup_session_components(self, constants) -> None:
        """Phase 3: SessionComponent + SessionSettingsComponent + handlers.

        SessionComponent owns Gate 2/3 (legacy ``/live/song/get|set/tempo``)
        + the PR-5d v3 song-scoped wires (transport / loop / signature /
        scale / groove + 3 command verbs). Component attaches its
        tempo listener in __init__, so transport must be live before
        we get here — see Phase 1.

        SessionSettingsComponent (2026-04-22) owns the runtime on/off
        toggles that aren't LOM-backed (auto_arm, move_volume_knob).
        Must instantiate BEFORE the components that consult its
        getters: ExclusiveArmComponent + FootTriggerComponent
        (should_auto_arm) and SelectedTrackComponent
        (should_handle_move_volume_knob).

        ServerPresenceComponent tracks whether the bridge ("the dev
        server") is alive via its heartbeat. It composes with
        SessionSettings.auto_arm to gate arm-follows-selection so that
        behavior only runs during a performance (server up), not during
        bare-Live production / cleanup. Also instantiated here so it's
        live before ExclusiveArmComponent's predicate pulls it.
        """
        self._session_component = SessionComponent(
            song=self.song, emit=self._transport.send,
        )
        self._transport.add_handler(
            "/live/song/get/tempo",
            self._session_component.handle_get_tempo,
        )
        self._transport.add_handler(
            "/live/song/set/tempo",
            self._session_component.handle_set_tempo,
        )

        # PR-5d: song-scoped transport + loop + signature + scale + groove.
        # 13 attr writes (read side is listener-driven) + 3 command verbs.
        # No echo suppression, init-emit at construction — see
        # SessionComponent module docstring for the rationale. ROW 6.8
        # (2026-04-21) added groove_amount to retire the M4L
        # /looping/session/groove_amount observer; 2026-07-27 added
        # clip_trigger_quantization (global launch quantization).
        for address, handler in (
            (V3_SESSION_IS_PLAYING_ADDRESS,
             self._session_component.handle_set_is_playing),
            (V3_SESSION_METRONOME_ADDRESS,
             self._session_component.handle_set_metronome),
            (V3_SESSION_SESSION_RECORD_ADDRESS,
             self._session_component.handle_set_session_record),
            (V3_SESSION_LOOP_ADDRESS,
             self._session_component.handle_set_loop),
            (V3_SESSION_LOOP_START_ADDRESS,
             self._session_component.handle_set_loop_start),
            (V3_SESSION_LOOP_LENGTH_ADDRESS,
             self._session_component.handle_set_loop_length),
            (V3_SESSION_SIGNATURE_NUM_ADDRESS,
             self._session_component.handle_set_signature_num),
            (V3_SESSION_SIGNATURE_DEN_ADDRESS,
             self._session_component.handle_set_signature_den),
            (V3_SESSION_SCALE_MODE_ADDRESS,
             self._session_component.handle_set_scale_mode),
            (V3_SESSION_GROOVE_AMOUNT_ADDRESS,
             self._session_component.handle_set_groove_amount),
            (V3_SESSION_CLIP_TRIGGER_QUANT_ADDRESS,
             self._session_component.handle_set_clip_trigger_quantization),
            (V3_SESSION_PLAY_CMD_ADDRESS,
             self._session_component.handle_play_cmd),
            (V3_SESSION_STOP_CMD_ADDRESS,
             self._session_component.handle_stop_cmd),
            (V3_SESSION_CONTINUE_CMD_ADDRESS,
             self._session_component.handle_continue_cmd),
        ):
            self._transport.add_handler(address, handler)

        # SessionSettingsComponent — init-emit seeds the UI; the
        # on_accept re-seed for connecting clients is wired into the
        # handshake accept chain later.
        self._session_settings_component = SessionSettingsComponent(
            emit=self._transport.send,
        )
        self._transport.add_handler(
            V3_SESSION_AUTO_ARM_ADDRESS,
            self._session_settings_component.handle_set_auto_arm,
        )
        self._transport.add_handler(
            V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
            self._session_settings_component.handle_set_move_volume_knob,
        )
        # Read-only state query — replies to the asker's port (not the
        # broadcast remote) so a fire-and-forget client (Ableton
        # Extension preference panel) can seed its toggle on load.
        self._transport.add_handler(
            V3_SESSION_AUTO_ARM_QUERY_ADDRESS,
            self._session_settings_component.handle_query_auto_arm,
        )
        self._transport.add_handler(
            V3_SESSION_MOVE_VOLUME_KNOB_QUERY_ADDRESS,
            self._session_settings_component.handle_query_move_volume_knob,
        )
        # auto_capture (2026-07-06): the gate for PerformanceCaptureComponent.
        # Default is launch-mode-derived (ipad→on, dev→off) but seeded lazily
        # — the mode isn't known at construction, only on the first heartbeat
        # — via ServerPresenceComponent's on_first_mode callback (wired below).
        # Once seeded/overridden it's the sole gate, so a dev session can force
        # it on and an ipad set can force it off.
        self._transport.add_handler(
            V3_SESSION_AUTO_CAPTURE_ADDRESS,
            self._session_settings_component.handle_set_auto_capture,
        )
        self._transport.add_handler(
            V3_SESSION_AUTO_CAPTURE_QUERY_ADDRESS,
            self._session_settings_component.handle_query_auto_capture,
        )

        # Key detection (ADR-446) + Follow (ADR-447): one verb reads the
        # launched MIDI clips and decides the key by integer votes; while
        # ``key_follow`` is on the same pass runs whenever what is playing
        # changes — driven by the playhead's change hook, wired below where
        # the playhead is built — and a key set by any hand turns Follow off.
        # Built after the session settings: it reads and writes the toggle.
        self._key_detect_component = KeyDetectComponent(
            song=self.song, emit=self._transport.send,
            session_component=self._session_component,
            is_following=self._should_follow_key_in_performance,
            follow_handler=self._session_settings_component.handle_set_key_follow,
            schedule_delayed=self._schedule_delayed,
        )
        # ``scale_root`` / ``scale_name`` from the wire are a hand picking a
        # key, so they route through the key-detect component, which turns
        # Follow off and then delegates to SessionComponent unchanged.
        for address, handler in (
            (V3_SESSION_SCALE_DETECT_ADDRESS,
             self._key_detect_component.handle_detect),
            (V3_SESSION_KEY_FOLLOW_ADDRESS,
             self._key_detect_component.handle_set_follow),
            (V3_SESSION_KEY_FOLLOW_QUERY_ADDRESS,
             self._session_settings_component.handle_query_key_follow),
            (V3_SESSION_SCALE_ROOT_ADDRESS,
             self._key_detect_component.handle_set_scale_root),
            (V3_SESSION_SCALE_NAME_ADDRESS,
             self._key_detect_component.handle_set_scale_name),
        ):
            self._transport.add_handler(address, handler)

        # ServerPresenceComponent — bridge-heartbeat-driven "is the dev
        # server running?" gate. Grace window comes from
        # ``timing.serverPresence.graceWindowMs`` in constants.json (the
        # bridge sends the heartbeat on the matching cadence); falls
        # back to the component default if absent. The heartbeat is
        # bridge-originated straight to the surface port, so it needs no
        # ``backendScope`` routing entry.
        #
        # on_first_mode seeds SessionSettings.auto_capture from the launch
        # mode the moment the first heartbeat reveals it (ipad→on, dev→off).
        # It no-ops if the user already set the toggle, so a deliberate
        # override survives the (late-arriving) seed.
        grace_ms = (
            constants.get("timing", {})
            .get("serverPresence", {})
            .get("graceWindowMs")
        )
        self._server_presence_component = ServerPresenceComponent(
            grace_window_s=(
                float(grace_ms) / 1000.0
                if isinstance(grace_ms, (int, float))
                else DEFAULT_GRACE_WINDOW_SECONDS
            ),
            on_first_mode=(
                lambda mode: self._session_settings_component
                .seed_auto_capture_default(mode == "ipad")
            ),
        )
        self._transport.add_handler(
            V3_SERVER_HEARTBEAT_ADDRESS,
            self._server_presence_component.handle_heartbeat,
        )

        # PerformanceCaptureComponent — auto-record on play + save-as on
        # transport stop. Gated on SessionSettings.auto_capture (default
        # launch-mode-derived, then user-overridable — see compose_capture_
        # gate). Constructed after SessionSettings so its gate reference is
        # live. Purely edge-driven (no accept-seed).
        self._performance_capture_component = PerformanceCaptureComponent(
            song=self.song,
            emit=self._transport.send,
            session_settings=self._session_settings_component,
            # record_mode writes can't run inline in the is_playing
            # notification (Live: "Changes cannot be triggered by
            # notifications") — defer them to the next tick.
            schedule_delayed=self._schedule_delayed,
        )

    def _setup_v3_protocol_core(self) -> None:
        """Phase 4: LOMListeners + Devices + v3 protocol primitives.

        LOMListeners attaches the per-track devices / per-param value
        listeners and fans structural-change events out through plain
        callables installed by the surface. Construction here, attach
        is internal; detach happens in ``disconnect``. The
        ``schedule_delayed`` wires the post-device-add reconciler
        (ADR-004) into Live's tick scheduler.

        DevicesComponent owns the v3 param set/query/resync handlers.
        Walks ``song`` inline on every call — no forward map.

        Generation/Invalidation/Handshake/SurfaceHello form Phase 1
        Commit B's protocol primitives. Order matters:
          1. GenerationComponent — authoritative counter.
          2. InvalidationComponent — hooks into ``set_on_advance`` to
             emit ``state/invalidate`` on every advance.
          3. HandshakeComponent — reads the current generation into
             its ``accept`` reply.
          4. DevicesComponent.set_generation — DevicesComponent's v3
             handlers can now do stale-write checks. Without this, the
             v3 write handler refuses with ``write-rejected: surface
             misconfigured`` — that's the correct posture for a
             half-wired surface, not a runtime fallback.
          5. SurfaceHelloComponent — surface-instance advertisement.
             Fires exactly once at bring-up per [04 §8.6] so the UI can
             detect surface restart and re-handshake. Construction
             here so teardown in ``disconnect`` fires in component
             order; the actual ``send_hello`` call is deferred to
             late bring-up so the UDP transport is bound when it fires.
        """
        self._lom_listeners = LOMListeners(
            song=self.song,
            schedule_delayed=self._schedule_delayed,
        )

        self._devices_component = DevicesComponent(
            song=self.song, emit=self._transport.send,
        )


        self._generation_component = GenerationComponent()
        self._invalidation_component = InvalidationComponent(
            generation_component=self._generation_component,
            emit=self._transport.send,
        )
        self._handshake_component = HandshakeComponent(
            emit=self._transport.send,
            generation_component=self._generation_component,
        )
        self._transport.add_handler(
            V3_HANDSHAKE_HELLO_ADDRESS,
            self._handshake_component.handle_hello,
        )

        self._surface_hello_component = SurfaceHelloComponent(
            emit=self._transport.send,
        )

        # Inject generation into DevicesComponent so its v3 handlers
        # can do the stale-check, then wire the v3 param handlers.
        self._devices_component.set_generation(self._generation_component)
        self._transport.add_handler(
            V3_PARAM_SET_ADDRESS,
            self._devices_component.handle_set_param_v3,
        )
        self._transport.add_handler(
            V3_PARAM_QUERY_ADDRESS,
            self._devices_component.handle_v3_param_query,
        )
        self._transport.add_handler(
            V3_STATE_RESYNC_ADDRESS,
            self._devices_component.handle_v3_state_resync,
        )

    def _setup_midi_pedal_input(self, constants) -> None:
        """USB-direct pedal MIDI → the existing gesture components (ADR-422).

        With the pedal's USB MIDI port assigned as this surface's Input
        in Live's preferences, its CCs arrive as plain MIDI instead of
        through the Max ctlin→OSC bridges.
        ``MidiPedalInput`` is the plain-Python (headless-testable)
        translator: edge detection plus the 500ms tap/hold timer that
        previously lived in ``owner/Max Patches/foot-trigger.js``. The
        resolved gestures call the same ``FootTriggerComponent`` /
        ``WahPedalComponent`` handlers the ``/looping/v3/foot/*`` and
        ``/looping/v3/wah/*`` OSC wires call — so those wires stay live
        as a fallback and the semantics have exactly one owner.

        The foot switch is a user setting (``FootSwitchComponent``: on/off
        and Learn, from the System view). The expression pedal and its toe
        switch — the wah's CCs, ``constants.midiPedals`` — are claimed only
        while ``features.expressionPedal`` is on: the wah is the owner's
        rig, and a general edition leaves those CCs to the framework.

        The framework-facing halves are the ``build_midi_map`` /
        ``receive_midi`` overrides below. Must run after both gesture
        components are constructed.
        """
        foot = getattr(self, "_foot_trigger_component", None)
        wah = getattr(self, "_wah_pedal_component", None)
        if not feature_on(constants, "expressionPedal"):
            wah = None
        self._midi_pedal_input = MidiPedalInput(
            constants=constants,
            on_foot_tap=(
                None if foot is None
                else lambda: foot.handle_tap((), _MIDI_PEDAL_SOURCE)
            ),
            on_foot_hold=(
                None if foot is None
                else lambda: foot.handle_hold((), _MIDI_PEDAL_SOURCE)
            ),
            on_wah_engage=(
                None if wah is None
                else lambda: wah.handle_engage((), _MIDI_PEDAL_SOURCE)
            ),
            on_wah_freq=(
                None if wah is None
                else lambda value: wah.handle_freq(
                    (value,), _MIDI_PEDAL_SOURCE,
                )
            ),
            on_foot_heard=self._on_foot_switch_heard,
            schedule_delayed=self._schedule_delayed,
        )
        self._foot_switch_component = FootSwitchComponent(
            emit=self._transport.send,
            constants=constants,
            router=self._midi_pedal_input,
            request_midi_rebuild=self._request_midi_rebuild,
        )
        for address, handler in (
            (V3_FOOT_SWITCH_ENABLED_ADDRESS,
             self._foot_switch_component.handle_set_enabled),
            (V3_FOOT_SWITCH_LEARN_ADDRESS,
             self._foot_switch_component.handle_learn),
        ):
            self._transport.add_handler(address, handler)

    def _on_foot_switch_heard(self) -> None:
        component = getattr(self, "_foot_switch_component", None)
        if component is not None:
            component.on_foot_heard()

    def _request_midi_rebuild(self) -> None:
        """Ask Live to call ``build_midi_map`` again.

        The foot switch's mapping and learn change which CCs this script
        must claim, and Live only asks for the map on its own at load and
        when the Input/Output change.
        """
        try:
            rebuild = getattr(self, "request_rebuild_midi_map", None)
            if callable(rebuild):
                rebuild()
            else:
                self._c_instance.request_rebuild_midi_map()
        except Exception as e:
            logger.warning(
                "MIDI map rebuild request failed: %s: %s",
                type(e).__name__, e,
            )

    def __init__(self, c_instance, *a, **k):
        super().__init__(
            c_instance=c_instance,
            specification=LoopingSpecification,
            *a,
            **k,
        )
        logger.info("Vamp surface init")

        # Phase 1: bind OSC transport. Bail-out if the port is taken.
        constants = load_constants()
        if not self._setup_transport(constants):
            return

        # A pack clip copied out of its pack (the browser's Places are
        # clones) resolves against the installed Packs folder: every
        # ``.alc`` a Simpler, a slot or a track prep loads goes through
        # ``alc_resolver``, which cannot find that folder on its own.
        packs_base = (constants.get("paths") or {}).get("abletonPacksBase")
        alc_resolver.set_pack_roots([packs_base] if isinstance(packs_base, str) else [])

        # Phase 2: seed _tick state (heartbeat + scheduler probe).
        self._init_heartbeat_state()

        # Phase 3: SessionComponent + SessionSettingsComponent + handlers.
        self._setup_session_components(constants)

        # Phase 4: LOMListeners + Devices + v3 protocol primitives.
        self._setup_v3_protocol_core()

        # ROW 5 (2026-04-21): ViewComponent owns the app-view focus
        # wire lifted off M4L's ``/view/set/focus_view``. One handler,
        # no listeners; scoped to ``application.view``.
        self._view_component = ViewComponent(
            application=self.application,
            emit=self._transport.send,
        )
        self._transport.add_handler(
            V3_VIEW_FOCUS_ADDRESS,
            self._view_component.handle_focus,
        )

        # ROW 5 (2026-04-21): DeviceCommandsComponent owns the
        # path-addressed device-chain ops (select, move_to_top,
        # move_to_end) that retire the M4L "appointed device"
        # (blue-hand) dance. UI no longer maintains a devicePath →
        # legacyId side-table; path_resolver.resolve_device feeds the
        # handlers directly.
        self._device_commands_component = DeviceCommandsComponent(
            song=self.song,
            emit=self._transport.send,
        )
        for address, handler in (
            (V3_DEVICE_SELECT_ADDRESS,
             self._device_commands_component.handle_select),
            (V3_DEVICE_MOVE_TO_TOP_ADDRESS,
             self._device_commands_component.handle_move_to_top),
            (V3_DEVICE_MOVE_TO_END_ADDRESS,
             self._device_commands_component.handle_move_to_end),
            # Issue #491 (3.8.0): remove a device from its chain — a
            # track's, or a drum pad's.
            (V3_DEVICE_DELETE_ADDRESS,
             self._device_commands_component.handle_delete),
            (V3_SIMPLER_REVERSE_ADDRESS,
             self._device_commands_component.handle_simpler_reverse),
            (V3_SIMPLER_WARP_HALF_ADDRESS,
             self._device_commands_component.handle_simpler_warp_half),
            (V3_SIMPLER_WARP_DOUBLE_ADDRESS,
             self._device_commands_component.handle_simpler_warp_double),
        ):
            self._transport.add_handler(address, handler)

        # ADR-439 phase 3: the surface half of the similar-sound swap. The
        # bridge orchestrates (show the rack, AX press, read the pads, finish);
        # this answers what it asks and never waits, because Live services
        # the press on this very thread. The finish follows the chain names
        # and closes the undo step the show opened.
        self._drum_swap_component = DrumSwapComponent(
            song=self.song,
            emit=self._transport.send,
            application=self.application,
            schedule_delayed=self._schedule_delayed,
        )
        self._transport.add_handler(
            V3_DRUM_SHOW_FOR_SWAP_ADDRESS,
            self._drum_swap_component.handle_show_for_swap,
        )
        self._transport.add_handler(
            V3_DRUM_PAD_NAMES_ADDRESS,
            self._drum_swap_component.handle_pad_names,
        )
        self._transport.add_handler(
            V3_DRUM_FINISH_SWAP_ADDRESS,
            self._drum_swap_component.handle_finish_swap,
        )

        # Lets the Group-Tracks gesture (ADR-439) borrow the record button
        # for the moment a reposition needs it — see the module docstring.
        # No listener, no LOM-touch on its own; only ever fires in response
        # to the bridge's own bracket around a group/drag.
        self._record_suspend_component = RecordSuspendComponent(
            song=self.song,
            emit=self._transport.send,
        )
        self._transport.add_handler(
            V3_GROUP_RECORD_SUSPEND_ADDRESS,
            self._record_suspend_component.handle_suspend,
        )
        self._transport.add_handler(
            V3_GROUP_RECORD_RESUME_ADDRESS,
            self._record_suspend_component.handle_resume,
        )

        # DebugComponent — ``/looping/protocol/version`` reply with
        # the current surface protocol version (``"3.0.0"`` after
        # PR-4a). UI checks this on every reconnect.
        self._debug_component = DebugComponent(
            emit=self._transport.send,
            registry=self._lom_listeners,
        )
        self._transport.add_handler(
            PROTOCOL_VERSION_ADDRESS,
            self._debug_component.handle_version,
        )
        self._transport.add_handler(
            REGISTRY_DUMP_ADDRESS,
            self._debug_component.handle_registry_dump,
        )
        self._transport.add_handler(
            REGISTRY_PROBE_RESOLVE_ADDRESS,
            self._debug_component.handle_registry_probe_resolve,
        )
        self._transport.add_handler(
            "/looping/v2/registry/introspect_track",
            self._debug_component.handle_registry_introspect_track,
        )
        self._transport.add_handler(
            LOM_INTROSPECT_ADDRESS,
            self._debug_component.handle_lom_introspect,
        )
        self._transport.add_handler(
            LOM_INVOKE_ADDRESS,
            self._debug_component.handle_lom_invoke,
        )
        # Probe-only (issue #489 measurements): attribute setter with undo
        # grouping + timing, and a current_song_time cadence counter.
        self._transport.add_handler(
            LOM_SET_ADDRESS,
            self._debug_component.handle_lom_set,
        )
        self._transport.add_handler(
            SONG_TIME_PROBE_ADDRESS,
            self._debug_component.handle_song_time_probe,
        )
        # Probe-only: module / Application-level dir, for API-surface
        # questions no song path reaches (Live.Browser, FilterType …).
        self._transport.add_handler(
            PY_INTROSPECT_ADDRESS,
            self._debug_component.handle_py_introspect,
        )
        # Phase 2 PR-2b: v3 state/full emitter. Walks the LOM with
        # path_resolver.compose_* to produce positional paths rather
        # than pointer ids. v2 state/full deleted Phase 4 PR-4a. See
        # V3StateFullComponent docstring for the wire contract.
        # ``schedule_delayed`` powers the trailing-edge debounce on
        # structural / selection-change republishes (issue #387).
        # ``state/full`` is the first — and for now only — address to
        # move onto the TCP leg. It is the one whose 389 KB actually
        # needs a stream; everything else fits a datagram comfortably
        # and gains nothing from migrating, so it stays where it is.
        #
        # ``stream`` is consulted per publish, not cached, so a bridge
        # that dials in or drops mid-session changes the wire for the
        # *next* bundle rather than half-committing this one.
        self._v3_state_full_component = V3StateFullComponent(
            song=self.song,
            emit=self._transport.send,
            generation_component=self._generation_component,
            schedule_delayed=self._schedule_delayed,
            stream=self._tcp_transport,
        )

        # Phase 12 pr12-4: DeviceInitComponent — Simpler-type init
        # rules + AU-plugin parameter-population retry. Subscribes to
        # ``on_device_added`` (wired below via
        # ``set_mutation_callbacks``) and re-emits scoped state/full
        # for each tree-mutation it initiates. Construction here
        # because it needs ``V3StateFullComponent.emit_selection_change``
        # to be live; the callback is not attached to LOMListeners
        # until after ``MutationComponent`` is built several blocks
        # down.
        #
        # ADR-378: ``ensure_random_start`` is injected as a lazy closure
        # because ``SimplerLoadComponent`` is constructed below this block.
        # The closure reads ``self._simpler_load_component`` at call time;
        # it returns ``None`` while the surface is mid-init, and
        # DeviceInitComponent's Pass 2 silently no-ops in that case.
        def _resolve_ensure_random_start(track):
            slc = getattr(self, "_simpler_load_component", None)
            if slc is not None:
                slc.ensure_random_start(track)

        self._device_init_component = DeviceInitComponent(
            song=self.song,
            emit_selection_change=(
                self._v3_state_full_component.emit_selection_change
            ),
            schedule_delayed=self._schedule_delayed,
            compose_track_path=compose_track_path,
            ensure_random_start=_resolve_ensure_random_start,
        )

        # Bound here because the surviving structural-change composite
        # (``_on_structural_change_with_properties``, ~830 lines below)
        # closes over it. A first composite used to be defined AND
        # installed here, then unconditionally replaced by that one — 12
        # lines that read like the live wiring but never fired. Removed
        # 2026-08-29; the surviving composite is a strict superset.
        v3_state_full_on_structural = self._v3_state_full_component.on_structural_change

        # Phase 3 PR-3c: session-load invalidation — NOT wired here.
        # Live 12.3.7 tears down and reconstructs the entire Control
        # Surface on File → Open (observed twice 2026-04-15, see the
        # 2026-04-15 PR-3c revision entry in implementation-log.md),
        # so any song-change poll on the surface side would never see
        # drift: the old detector is GC'd with the old surface, and
        # the new one arms against the new song as its baseline. The
        # fresh surface already publishes ``state/full #1
        # reason=init`` on bring-up — the actual gap is UI-side, not
        # surface-side: the UI doesn't know the surface restarted and
        # keeps addressing the prior session's identifiers. PR-3c now
        # lives on the UI side (detect ``state/full`` with
        # ``reason=init`` + ``generation=1`` after local generation
        # already advanced → re-handshake). The ``SongChangeDetector``
        # component + tests remain in-tree as a documented guard in
        # case a future Live release stops recycling the surface on
        # session-load; see the deferred-issues.md session-load entry.

        # v3 state/resync now emits a real v3 state/full (with
        # reason="resync"), not a v2-emit placeholder. Phase 2 PR-2b
        # retired the Commit-B delegate noted in "Changes since spec
        # draft" 2026-04-14.
        #
        # The UI fires state/resync from clientWatchdog on tab
        # visibility-resume — and on that path it has just cleared
        # `playingClipsStore` via the `bridge-resync` event. state/full
        # alone doesn't carry the playing-slot render fields
        # (file_path / loop_start / loop_end / looping / is_audio_clip),
        # so without a piggyback re-emit the strip stays blank until
        # the next LOM change (e.g. recording flip). Mirrors the
        # `playhead.emit_on_accept()` call inside `_emit_on_accept_chain`.
        def _emit_on_resync_chain(session_id=None, client_etag=None):
            # Same split as the accept chain: the ETag can suppress the
            # tree, never the playhead re-seed — that emit exists
            # precisely because state/full does not carry those fields,
            # so it is needed *more* on an ETag hit, not less.
            self._v3_state_full_component.emit_on_resync(
                session_id=session_id, client_etag=client_etag,
            )
            playhead = getattr(self, "_playhead_component", None)
            if playhead is not None:
                playhead.emit_on_accept()
        self._devices_component.set_state_full_on_resync(
            _emit_on_resync_chain,
        )

        # Phase 3 PR-3b: accept drives state/full. Per [04 §8.5] the
        # handshake's ``accept`` reply is immediately followed by a
        # ``state/full/tree`` message with ``reason="accept"``. This replaces the pre-PR-3b
        # ``emit_on_init`` fire-and-forget at bring-up, which raced
        # UI connect and silently left the UI without a tree when it
        # lost the race. See V3StateFullComponent module docstring
        # for the full history.
        #
        # PR-5d addendum (2026-04-18): state/full is track-scoped and
        # does NOT carry song-scoped session attrs (metronome, loop,
        # signature, scale, ...). The SessionComponent init-emit fires
        # at surface ``__init__`` — long before UI connect on cold
        # start — so a UI connecting later missed the seeds and sat
        # on defaults. Found during PR-5d live validation: UI's
        # metronome button thought metronome was off when Live had
        # it on, so the toggle sent [1] repeatedly and Live ignored
        # it (same value → no listener fire → no echo). Fix:
        # piggyback ``SessionComponent.emit_on_accept`` onto the
        # same accept hook so every handshake re-seeds session attrs
        # alongside state/full.
        def _emit_on_accept_chain(session_id=None, client_etag=None):
            # ``session_id`` / ``client_etag`` are the protocol 3.5.0
            # ETag context. Only the state/full emit consults them —
            # every other seed below is a small, unconditional re-emit
            # whose whole purpose is to repopulate fields state/full
            # does not carry, so skipping them on an ETag hit would
            # leave the reconnecting UI with a correct tree and a blank
            # clip strip.
            #
            # A handshake accept only happens because the server sent a
            # hello — proof it's alive right now. Stamp presence first so
            # the ExclusiveArm accept-seed below (and any immediately
            # following selection change) sees the server as present,
            # even if the first post-restart bridge heartbeat hasn't
            # landed yet. This is what makes set-load / Live-restart
            # recovery instant rather than heartbeat-cadence-delayed.
            presence = getattr(self, "_server_presence_component", None)
            if presence is not None:
                presence.mark_alive()
            self._v3_state_full_component.emit_on_accept(
                session_id=session_id, client_etag=client_etag,
            )
            self._session_component.emit_on_accept()
            # SessionSettingsComponent (2026-04-22): re-seed
            # ``auto_arm`` + ``move_volume_knob`` so a reconnecting UI
            # picks up the current surface-side toggle state.
            session_settings = getattr(
                self, "_session_settings_component", None,
            )
            if session_settings is not None:
                session_settings.emit_on_accept()
            foot_switch = getattr(self, "_foot_switch_component", None)
            if foot_switch is not None:
                foot_switch.emit_on_accept()
            # PR-5e1: re-emit clip/focused + 6 focused-clip property
            # values so a cold-start UI gets seeded. Mirrors the
            # SessionComponent pattern from PR-5d. Guarded for the
            # early-wire case where ClipPropertiesComponent hasn't
            # been constructed yet (emit_on_accept runs on handshake
            # accept, which the surface only reaches after full
            # construction, but the guard is cheap and matches the
            # defensive style of the session re-emit).
            clip_props = getattr(
                self, "_clip_properties_component", None,
            )
            if clip_props is not None:
                clip_props.emit_on_accept()
            # M3 (clip-view-mirror): re-poke notes/changed for the focused
            # clip so a cold-start UI pulls the rich note channel even
            # though it has no focus-change event to trigger on.
            clip_notes = getattr(self, "_clip_notes_component", None)
            if clip_notes is not None:
                clip_notes.emit_on_accept()
            # Phase 7 PR-7d: SelectedTrackComponent re-emits the
            # current selected_track path so a cold-start UI sees
            # the selection without waiting for the next LOM fire.
            # Bypasses the coalesce — accept is a one-shot seed.
            # Defensive guard mirrors clip_props above.
            selected_track = getattr(
                self, "_selected_track_component", None,
            )
            if selected_track is not None:
                selected_track.emit_on_accept()
            # ExclusiveArmComponent seed: arm the currently-selected
            # regular track on handshake accept. Master/return
            # selections skip silently. Symmetric guard to the
            # selected-track case above.
            exclusive_arm = getattr(
                self, "_exclusive_arm_component", None,
            )
            if exclusive_arm is not None:
                exclusive_arm.emit_on_accept()
            # PR-5e2: groove pool has no UI-visible state of its own
            # (emit_on_accept is a no-op — kept for symmetry), but
            # GrooveComponent re-emits has_groove + 5 amount values
            # for the currently-focused clip. Same defensive guard
            # as clip_props above — emit_on_accept fires after full
            # construction, but the guard is cheap.
            pool = getattr(self, "_groove_pool_component", None)
            if pool is not None:
                pool.emit_on_accept()
            groove = getattr(self, "_groove_component", None)
            if groove is not None:
                groove.emit_on_accept()
            # ADR-361: re-seed playing-clip strip state on reconnect.
            # state/full carries slot/clip name/length but NOT
            # file_path / loop_start / loop_end / looping / is_audio_clip
            # — those live only on PlayheadComponent's playing_slot
            # emit. Without this, the UI's TrackClipView strip stays
            # blank on stationary-state reconnects (LOM listeners only
            # fire on actual changes; the dedup added in ADR-361
            # would suppress them anyway). emit_on_accept clears the
            # dedup cache and re-walks every track.
            playhead = getattr(self, "_playhead_component", None)
            if playhead is not None:
                playhead.emit_on_accept()
        self._handshake_component.set_state_full_on_accept(
            _emit_on_accept_chain,
        )

        # MutationComponent — per-event fires for parameter value
        # changes and device add/remove. ``LOMListeners`` owns the LOM
        # listener lifecycle (per-track devices-listener, per-param
        # value-listener); we install three callbacks via
        # ``set_mutation_callbacks`` and the already-attached value
        # listeners read them at fire time.
        #
        # Phase 1 Commit A signature change:
        # ``on_param_value_changed`` now receives ``(parameter,
        # canonical_path)``; the v2 echo derives the wire pid via
        # ``_safe_int_id(parameter)`` at fire time. v3's path-keyed
        # echo (Commit B) will read ``canonical_path`` directly.
        #
        # ``DevicesComponent`` arms/unarms per-param echo suppression
        # around its LOM writes via ``arm_suppression`` /
        # ``unarm_suppression``.
        self._mutation_component = MutationComponent(
            listeners=self._lom_listeners,
            emit=self._transport.send,
        )
        # Phase 12 pr12-4: DeviceInitComponent subscribes to
        # ``on_device_added`` here. No other subscriber today — if a
        # second one arrives, wrap the two in a fan-out closure rather
        # than adding a list slot to LOMListeners (rule-of-three first).
        # permute ADR-020: SequencerComponent (constructed after the
        # playhead, below) is the second subscriber to param-value fires —
        # its pattern cache rides the same value listeners — and the only
        # subscriber to device removals. Both fan-outs look the engine up at
        # fire time, so construction order stays free.
        mutation_on_param_value_changed = self._mutation_component.on_param_value_changed

        def _on_param_value_changed_fanout(parameter, canonical_path):
            mutation_on_param_value_changed(parameter, canonical_path)
            sequencer = getattr(self, "_sequencer_component", None)
            if sequencer is not None:
                sequencer.on_param_value_changed(parameter, canonical_path)

        def _notify_pedal_devices_changed(track):
            # ADR-445: the pedal drops its cached macro on any device-list
            # change, so a wah the Pedal view's button just loaded takes the
            # pedal over without a track switch. Pure Python state; guarded
            # so the pedal can never take the other callbacks down with it.
            # The wheels drop their cached MidiWheels parameters the same way.
            wheels = getattr(self, "_midi_wheels_component", None)
            if wheels is not None:
                try:
                    wheels.on_track_devices_changed(track)
                except Exception as e:
                    logger.warning(
                        "wheels device-change hook raised: %s: %s",
                        type(e).__name__, e,
                    )
            pedal = getattr(self, "_wah_pedal_component", None)
            if pedal is None:
                return
            try:
                pedal.on_track_devices_changed(track)
            except Exception as e:
                logger.warning(
                    "pedal device-change hook raised: %s: %s",
                    type(e).__name__, e,
                )

        def _on_device_added_fanout(track, device, chain_idx):
            try:
                self._device_init_component.on_device_added(
                    track, device, chain_idx,
                )
            finally:
                _notify_pedal_devices_changed(track)

        def _on_device_removed_fanout(track, device_id):
            sequencer = getattr(self, "_sequencer_component", None)
            if sequencer is not None:
                sequencer.on_device_removed(track, device_id)
            _notify_pedal_devices_changed(track)

        self._lom_listeners.set_mutation_callbacks(
            on_param_value_changed=_on_param_value_changed_fanout,
            on_device_added=_on_device_added_fanout,
            on_device_removed=_on_device_removed_fanout,
        )
        self._devices_component.set_mutation(self._mutation_component)

        # PR-3.5.7: PropertyComponent — owns the v3 device-property
        # channel. Construction here (after generation + transport are
        # live, before structural-invalidate composite is rebound
        # below) so the on_structural_invalidate hook can be wired
        # into the existing composite without re-ordering anything
        # upstream. Subscription state lives on this component, not
        # inside DevicesComponent: properties cut across the device's
        # LOM shape and merging them into DevicesComponent would
        # reintroduce the v2 sprawl the "static fields beat property
        # bags" doctrine ([04 §5.1]) was ratified to prevent.
        # ADR-428: Drum Rack virtual macros. The provider behind the
        # ``DrumGroupDevice`` ``vm.*`` computed rows. Its fan-out runs
        # from the UDP transport's drain hook so a burst of queued sets
        # for one control collapses to one apply per drain pass; the
        # hook must be registered before deferred apply is switched on.
        self._drum_vm_component = DrumVirtualMacroComponent(
            emit=self._transport.send,
            schedule_delayed=self._schedule_delayed,
            song=self.song,
        )
        self._transport.add_drain_hook(self._drum_vm_component.flush)
        self._drum_vm_component.enable_deferred_apply()

        # Issue #491 (3.8.0): the devices inside a drum pad's chain —
        # effect presence (``vm.padFx``) and per-pad subscriptions
        # (``vm.padChain.<note>``) whose records ride a pad-scoped
        # ``state/full/tree``. Its structural composite is deliberately
        # narrower than the track's: advance the generation, tear down
        # property subscriptions on paths that moved, re-emit the pad;
        # never republish the song, and never feed ``on_device_added``.
        # The property component is constructed just below, so its
        # invalidate hook is bound late.
        self._drum_pad_chain_component = DrumPadChainComponent(
            emit=self._transport.send,
            schedule_delayed=self._schedule_delayed,
            advance_generation=self._generation_component.advance,
            on_structural_invalidate=lambda: self._property_component.on_structural_invalidate(),
            emit_pad_chain=self._v3_state_full_component.emit_pad_chain,
            on_param_value_changed=_on_param_value_changed_fanout,
        )

        self._property_component = PropertyComponent(
            song=self.song, emit=self._transport.send,
            schedule_delayed=self._schedule_delayed,
            computed_providers={
                DRUM_VM_PROVIDER_NAME: self._drum_vm_component,
                DRUM_PAD_CHAIN_PROVIDER_NAME: self._drum_pad_chain_component,
            },
        )
        self._property_component.set_generation(self._generation_component)
        self._transport.add_handler(
            V3_PROPERTY_SUBSCRIBE_ADDRESS,
            self._property_component.handle_subscribe,
        )
        self._transport.add_handler(
            V3_PROPERTY_UNSUBSCRIBE_ADDRESS,
            self._property_component.handle_unsubscribe,
        )
        self._transport.add_handler(
            V3_PROPERTY_SET_ADDRESS,
            self._property_component.handle_set,
        )

        # PR-5a: TrackMetadataComponent — owns the seven track-metadata
        # attributes (name/color/arm/mute/solo/pan/input_routing_*) for
        # regular tracks. Attaches per-track per-attr listeners in
        # __init__, rebinds on structural change via the composite
        # below, detaches in disconnect. Master is not in scope
        # (PR-5b); returns are out-of-phase.
        self._track_metadata_component = TrackMetadataComponent(
            song=self.song, emit=self._transport.send,
            advance_generation=self._generation_component.advance,
        )
        self._track_metadata_component.set_generation(
            self._generation_component,
        )
        for address, handler in (
            (V3_TRACK_NAME_ADDRESS,
             self._track_metadata_component.handle_set_name),
            (V3_TRACK_COLOR_ADDRESS,
             self._track_metadata_component.handle_set_color),
            (V3_TRACK_ARM_ADDRESS,
             self._track_metadata_component.handle_set_arm),
            (V3_TRACK_MUTE_ADDRESS,
             self._track_metadata_component.handle_set_mute),
            (V3_TRACK_SOLO_ADDRESS,
             self._track_metadata_component.handle_set_solo),
            (V3_TRACK_PAN_ADDRESS,
             self._track_metadata_component.handle_set_pan),
            (V3_TRACK_VOLUME_ADDRESS,
             self._track_metadata_component.handle_set_volume),
            (V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS,
             self._track_metadata_component.handle_set_input_routing_type),
            (V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS,
             self._track_metadata_component.handle_set_input_routing_channel),
            (V3_TRACK_MUTE_TOGGLE_ADDRESS,
             self._track_metadata_component.handle_mute_toggle),
            (V3_TRACK_SEND_ADDRESS,
             self._track_metadata_component.handle_set_send),
            (V3_TRACK_SET_FOLD_STATE_ADDRESS,
             self._track_metadata_component.handle_set_fold_state),
            # Protocol 3.7.0 — persists the rail an instrument came from
            # into Live's per-track store, so the UI stops re-deriving it
            # from a 2.46 MB catalog fetch every session.
            (V3_TRACK_SET_ROLE_ADDRESS,
             self._track_metadata_component.handle_set_role),
        ):
            self._transport.add_handler(address, handler)

        # PR-5b: MasterComponent — owns the five master-attribute
        # addresses (volume/name/color/pan/mute). Master is permanent
        # so no structural-change rebind is needed; the component
        # attaches its listeners in __init__ and detaches in
        # disconnect. The mute listener may fail to attach on Live 12
        # (master has no mute property — RuntimeError); that's logged
        # and skipped, and writes return write-rejected with detail
        # "attribute-unavailable".
        self._master_component = MasterComponent(
            song=self.song, emit=self._transport.send,
        )
        self._master_component.set_generation(self._generation_component)
        for address, handler in (
            (V3_MASTER_VOLUME_ADDRESS,
             self._master_component.handle_set_volume),
            (V3_MASTER_NAME_ADDRESS,
             self._master_component.handle_set_name),
            (V3_MASTER_COLOR_ADDRESS,
             self._master_component.handle_set_color),
            (V3_MASTER_PAN_ADDRESS,
             self._master_component.handle_set_pan),
            (V3_MASTER_MUTE_ADDRESS,
             self._master_component.handle_set_mute),
        ):
            self._transport.add_handler(address, handler)

        # PR-5c: MetersComponent — owns /looping/v3/track/meter and
        # /looping/v3/master/meter. Emit-only, no transport handlers.
        # Per-track listeners attach in __init__ and rebind on the
        # structural composite below (same pattern as TrackMetadata);
        # master listeners attach directly and survive for the life
        # of the component.
        self._meters_component = MetersComponent(
            song=self.song, emit=self._transport.send,
        )

        # ADR-360: PlayheadComponent — owns
        # /looping/v3/track/playing_slot and /looping/v3/track/playhead.
        # Per-track ``playing_slot_index`` listener fans out to a
        # ``playing_position`` listener (and, for MIDI clips, a ``notes``
        # listener that emits /looping/v3/clip/notes/changed) on the
        # currently-playing clip. Emit-only; no transport handlers.
        # Rebinds with the meters/track-metadata structural composite
        # below.
        # ``schedule_delayed`` powers the recording → playing settle
        # recheck. When ``clip.is_recording`` flips false, Live populates
        # ``file_path`` synchronously but the .aif/.wav is still flushing
        # to disk; a ~250 ms recheck re-emits ``playing_slot`` once the
        # OS write has settled, so the UI's `/api/sample-peaks` fetch
        # lands first try without client-side retry. See PlayheadComponent
        # docstring + ``_make_recording_listener``.
        self._playhead_component = PlayheadComponent(
            song=self.song,
            emit=self._transport.send,
            schedule_delayed=self._schedule_delayed,
        )
        # ADR-447: key Follow rides the playhead's view of what each track
        # plays (launches, stops, the fresh-recording race, finished takes,
        # note edits) instead of a second per-track listener set.
        self._playhead_component.add_change_callback(
            self._key_detect_component.on_playing_change,
        )

        # permute ADR-020: SequencerComponent — the engine behind every thin
        # Permute device. Clock from the drain pump's tick hook (registered
        # after the pump starts, below) with the ~100 ms tick as fallback;
        # always on (2026-09-26: the fat Permute, its step ingest and the
        # ``sequencer_engine`` switch between the two are gone); reads the
        # current clip through the playhead's query; the drum pitch path
        # adds its shift term through DrumVirtualMacroComponent. Emits
        # /looping/v3/permute/step itself.
        # ``gate_emit`` is the same socket aimed somewhere else: the mute
        # lane's state goes straight to a ``udpreceive`` inside a Max device
        # on that track (``osc.permuteGate``), not through the bridge. It
        # lets a device gate what it plays without the surface writing a
        # parameter, which would cost an undo step per step transition.
        # Absent config leaves it None and the gate is simply never spoken —
        # every receiver fails open.
        gate_osc = constants.get("osc", {}).get("permuteGate")
        gate_emit = None
        if gate_osc and gate_osc.get("remotePort"):
            gate_addr = (gate_osc.get("host", "127.0.0.1"), gate_osc["remotePort"])

            def gate_emit(address, args, _addr=gate_addr):
                self._transport.send(address, args, remote_addr=_addr)

            logger.info("Permute gate wire -> %s:%d", gate_addr[0], gate_addr[1])

        self._sequencer_component = SequencerComponent(
            song=self.song,
            emit=self._transport.send,
            gate_emit=gate_emit,
            playhead=self._playhead_component,
            drum_vm=self._drum_vm_component,
            schedule_delayed=self._schedule_delayed,
        )
        self._transport.add_handler(
            SEQUENCER_STATS_ADDRESS, self._sequencer_component.handle_stats,
        )

        # PR-5e1: ClipPropertiesComponent — owns the clip-property
        # addresses (loop_start/end, start/end_marker, warp_mode,
        # looping) on ``live_set view.detail_clip``. Focus-scoped:
        # attaches a property listener per attr to the currently-focused clip,
        # detaches + reattaches on focus change, emits
        # ``clip/focused`` + per-property echoes through
        # ``/looping/v3/clip/property``. No participation in the
        # structural composite: the only structural concern is
        # detail_clip changing, which is its own song-scoped listener.
        # Generation advance on clip create/delete is deferred to
        # Phase 6 (``ClipLifecycleComponent``) per checklist pr5e1-3.
        self._clip_properties_component = ClipPropertiesComponent(
            song=self.song, emit=self._transport.send,
            permute=self._sequencer_component,
        )
        for address, handler in (
            (V3_CLIP_SET_LOOP_START_ADDRESS,
             self._clip_properties_component.handle_set_loop_start),
            (V3_CLIP_SET_LOOP_END_ADDRESS,
             self._clip_properties_component.handle_set_loop_end),
            (V3_CLIP_SET_START_MARKER_ADDRESS,
             self._clip_properties_component.handle_set_start_marker),
            (V3_CLIP_SET_END_MARKER_ADDRESS,
             self._clip_properties_component.handle_set_end_marker),
            (V3_CLIP_SET_WARP_MODE_ADDRESS,
             self._clip_properties_component.handle_set_warp_mode),
            (V3_CLIP_SET_LOOPING_ADDRESS,
             self._clip_properties_component.handle_set_looping),
            (V3_CLIP_SET_PITCH_COARSE_ADDRESS,
             self._clip_properties_component.handle_set_pitch_coarse),
            (V3_CLIP_SET_PITCH_FINE_ADDRESS,
             self._clip_properties_component.handle_set_pitch_fine),
            (V3_CLIP_SET_GAIN_ADDRESS,
             self._clip_properties_component.handle_set_gain),
            (V3_CLIP_WARP_MARKER_MOVE_ADDRESS,
             self._clip_properties_component.handle_move_warp_marker),
            (V3_CLIP_WARP_MARKER_ADD_ADDRESS,
             self._clip_properties_component.handle_add_warp_marker),
            (V3_CLIP_WARP_MARKER_REMOVE_ADDRESS,
             self._clip_properties_component.handle_remove_warp_marker),
        ):
            self._transport.add_handler(address, handler)

        # Phase 7 PR-7d: SelectedTrackComponent — owns the
        # ``/looping/v3/selected_track [trackPath]`` emit on
        # ``song.view.selected_track`` change. Sibling of
        # ClipPropertiesComponent (both observe song.view) — kept in
        # separate components per design §3.5 because the two
        # attributes (detail_clip vs selected_track) have independent
        # lifecycles.
        #
        # Wiring:
        # - ``emit`` shares the transport sender with other v3
        #   components.
        # - ``schedule_state_full`` binds to
        #   ``V3StateFullComponent.emit_selection_change`` as of
        #   Phase 12 pr12-4. The component's coalesce window passes
        #   the current ``song.view.selected_track`` path to the
        #   callback, which produces a scoped ``state/full`` carrying
        #   only that track's subtree. Wire + UI applier are pr12-2
        #   / pr12-3 respectively. Handshake-accept still does a full
        #   whole-song emission via ``emit_on_accept`` elsewhere, so
        #   the scoped path is strictly additive over cold-start.
        #   (Pre-pr12-4 this bound to ``emit_structural`` for a
        #   whole-song republish on every selection change.)
        # - ``schedule_delayed`` binds to the surface's
        #   ``_schedule_delayed`` (100ms tick rounding); the
        #   component's 50ms coalesce window rounds up to one tick.
        self._selected_track_component = SelectedTrackComponent(
            song=self.song,
            emit=self._transport.send,
            schedule_state_full=(
                self._v3_state_full_component.emit_selection_change
            ),
            schedule_delayed=self._schedule_delayed,
            # 2026-04-22: gate on SessionSettings.move_volume_knob.
            should_handle_move_volume_knob=(
                self._session_settings_component.should_handle_move_volume_knob
            ),
            # Built later; looked up when a clip is selected.
            on_slot_selected=lambda slot: self._clips_component.reveal_slot(slot),
        )
        # ROW 2-F4 (2026-04-21): /looping/v3/track/select [trackPath]
        # is the sibling write for the selected_track observer.
        # Retires the /live/view/set/selected_track AbletonOSC hop.
        self._transport.add_handler(
            V3_TRACK_SELECT_ADDRESS,
            self._selected_track_component.handle_select,
        )
        # ROW 5 (2026-04-21): /looping/v3/selected_track/volume_relative
        # [midiValue] — Ableton Move encoder nudges the currently-
        # selected track's volume by ±MOVE_VOLUME_STEP per tick.
        # Retires the M4L /move/selected_track/volume hop (ADR-320
        # superseded). Move hardware sends UDP directly to the Python
        # surface port; no bridge hop.
        self._transport.add_handler(
            V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS,
            self._selected_track_component.handle_relative_volume,
        )
        # ADR-412: /looping/v3/selected_track/drum_chain/volume_relative
        # [midiValue] — second Move encoder (CC 72 in the Max Utility
        # patch) nudges the selected drum-pad chain's volume on the
        # selected track's drum rack. Same direct-to-11020 hardware path
        # and move_volume_knob gate as the track-volume knob above.
        self._transport.add_handler(
            V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS,
            self._selected_track_component.handle_drum_chain_relative_volume,
        )
        # ADR-432: /looping/v3/move/pad_hold [note, held] — a Move pad
        # held past the Max Utility patch's threshold. Same direct-to-
        # 11020 lane; the surface names Live's selected pad on the
        # selected track's drum rack and re-emits it to the interface as
        # /looping/v3/drum/pad_hold [rackPath, padNote, held], an
        # external hold on the pad scope. Ungated: the patch is the switch.
        self._transport.add_handler(
            V3_MOVE_PAD_HOLD_ADDRESS,
            self._selected_track_component.handle_pad_hold,
        )
        # ROW 7c (2026-04-21): /looping/v3/selected_clip [trackPath,
        # sceneIndex] — retarget of /live/view/set/selected_clip. Writes
        # song.view.highlighted_clip_slot; silent wire.
        self._transport.add_handler(
            V3_SELECT_CLIP_ADDRESS,
            self._selected_track_component.handle_select_clip,
        )

        # ExclusiveArmComponent — arm-follows-selection side-effect.
        # Independent subscriber to song.view.selected_track (Live
        # supports multiple listeners on one property). No wire
        # address — arm flips surface to the UI via the existing
        # TrackMetadataComponent arm listener. Seeded on handshake
        # accept. See component docstring for skip rules (master /
        # return / user-override preservation).
        #
        # ``schedule_delayed`` is required: Live forbids LOM writes
        # from inside a notification callback, and
        # ``song.view.selected_track`` fires exactly there. The
        # component stashes the intent and commits on the next tick.
        self._exclusive_arm_component = ExclusiveArmComponent(
            song=self.song,
            schedule_delayed=self._schedule_delayed,
            # Two-switch gate: arm-follows-selection fires only when the
            # user wants it (SessionSettings.auto_arm, default on) AND
            # the dev server is running (ServerPresenceComponent). The
            # latter makes the behavior automatically quiet during
            # bare-Live production / cleanup and self-heal on set load /
            # Live restart while the server stays up. FootTrigger and
            # move-volume-knob keep the plain auto_arm gate — they're
            # hardware performance gestures, not selection side-effects.
            should_auto_arm=self._should_auto_arm_in_performance,
        )

        # PR-5e2: GroovePoolComponent (song-scoped) + GrooveComponent
        # (focus-scoped). Pool first: GrooveComponent takes the pool
        # by ctor injection. Both use their own independent
        # `add_detail_clip_listener` (GroovePool does not — only
        # GrooveComponent listens on focus). The pool's
        # `emit_on_accept` is a no-op; GrooveComponent re-emits
        # has_groove + 5 amount values on handshake accept (wired
        # into _emit_on_accept_chain below).
        # The pool mints a groove through the browser when it has none
        # free (2026-09-29), so a set needs no ``unassigned-*`` grooves
        # loaded ahead of time. DeviceLoadComponent owns the browser
        # cache and is built later, so the closure finds it at call time.
        groove_path = live_library.device_path(live_library.GROOVE_REL)

        def mint_groove(pattern=None):
            loader = getattr(self, "_device_load_component", None)
            if loader is None:
                return "no device loader"
            if pattern:
                # The groove chooser's pattern: its file, from the Core
                # Library or (``User: …``) the User Library.
                return loader.load_groove_by_name(pattern)
            return loader.load_groove(
                groove_path,
                source=live_library.m4l_source(), rel=live_library.GROOVE_REL,
            )

        self._groove_pool_component = GroovePoolComponent(
            song=self.song, emit=self._transport.send, mint=mint_groove,
        )
        self._groove_component = GrooveComponent(
            song=self.song,
            emit=self._transport.send,
            pool=self._groove_pool_component,
        )
        for address, handler in (
            (V3_CLIP_GROOVE_SET_BASE_ADDRESS,
             self._groove_component.handle_set_base),
            (V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS,
             self._groove_component.handle_set_timing_amount),
            (V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS,
             self._groove_component.handle_set_quantization_amount),
            (V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS,
             self._groove_component.handle_set_random_amount),
            (V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS,
             self._groove_component.handle_set_velocity_amount),
            (V3_CLIP_GROOVE_SET_FILE_ADDRESS,
             self._groove_component.handle_set_file),
        ):
            self._transport.add_handler(address, handler)

        # Phase 7 PR-7b: ClipsComponent — owns the 4 clip-lifecycle
        # addresses (launch/stop/delete/duplicate) and the per-slot
        # ``has_clip`` listeners that emit clip/created + clip/removed.
        # Structural rebind below tears down + reattaches the per-slot
        # listeners on track add/remove.
        self._clips_component = ClipsComponent(
            song=self.song,
            emit=self._transport.send,
            advance_generation=self._generation_component.advance,
            application=self.application,
            schedule_next_tick=self._schedule_next_tick,
        )
        # Cross-component fanout (ADR-363): PlayheadComponent owns the
        # track strip's render context, but ClipsComponent owns the
        # per-slot ``has_clip`` listener. Wire the in-process callback
        # so clip-create / clip-delete on any slot reach the strip
        # without a second LOM listener attach. Replaces the bounded
        # settle recheck previously living in PlayheadComponent.
        self._clips_component.add_has_clip_change_callback(
            self._playhead_component.on_slot_has_clip_changed,
        )
        for address, handler in (
            (V3_CLIP_LAUNCH_ADDRESS, self._clips_component.handle_launch),
            (V3_CLIP_STOP_ADDRESS, self._clips_component.handle_stop),
            # Session-grid long-press: focus a clip without firing it.
            # Answers on the existing ``clip/focused`` channel, since
            # it writes the same ``song.view.detail_clip`` that
            # ClipPropertiesComponent observes.
            (V3_CLIP_FOCUS_ADDRESS, self._clips_component.handle_focus),
            (V3_CLIP_DELETE_ADDRESS, self._clips_component.handle_delete),
            (V3_CLIP_DUPLICATE_ADDRESS,
             self._clips_component.handle_duplicate),
            (V3_CLIP_DUPLICATE_REGION_ADDRESS,
             self._clips_component.handle_duplicate_region),
            (V3_CLIP_LOAD_FILE_ADDRESS,
             self._clips_component.handle_load_file),
            (V3_CLIP_SET_COLOR_ADDRESS,
             self._clips_component.handle_set_color),
            # ADR-415: per-slot sample path for the session clip grid.
            # The strip's waveform rides ``playing_slot``, which carries
            # a path for ONE slot per track; a grid needs them for slots
            # that have never played. Pull, not push — the UI asks only
            # about cells on screen.
            (V3_CLIP_SAMPLE_GET_ADDRESS,
             self._clips_component.handle_sample_get),
            # ADR-440: the clip view's similar-sound pill — a clip's file
            # swapped for another with the clip kept, in one undo step.
            (V3_CLIP_SWAP_FILE_ADDRESS,
             self._clips_component.handle_swap_file),
        ):
            self._transport.add_handler(address, handler)

        # Phase 8 PR-8b: ClipNotesComponent — owns the single
        # ``/looping/v3/clip/transpose`` address. Stateless; no
        # listeners. Path-keyed write (any resolvable clipPath, not
        # focus-only) so a focus change between gesture and arrival
        # doesn't drop the write. Replaces the M4L
        # ``/cmd/transpose_clip_notes`` handler.
        self._clip_notes_component = ClipNotesComponent(
            song=self.song,
            emit=self._transport.send,
        )
        self._transport.add_handler(
            V3_CLIP_TRANSPOSE_ADDRESS,
            self._clip_notes_component.handle_transpose,
        )
        # The clip view's ±12 on an Instrument Rack: finds a Drum Rack
        # wrapped inside it (by class, as Permute's pitch route does) and
        # moves the kit's vm.pitch; replies ``not-drum`` otherwise so the
        # UI keeps its macro / note path.
        self._track_transpose_component = TrackTransposeComponent(
            song=self.song,
            emit=self._transport.send,
            drum_vm=self._drum_vm_component,
        )
        self._transport.add_handler(
            V3_TRACK_TRANSPOSE_ADDRESS,
            self._track_transpose_component.handle_transpose,
        )
        # ADR-360: notes/get pull endpoint. UI requests the full note
        # list of any clip; surface replies with a packed float32 blob.
        # Notes-changed pokes flow from PlayheadComponent's per-track
        # notes listener (above) — UI re-issues notes/get on those.
        self._transport.add_handler(
            V3_CLIP_NOTES_GET_ADDRESS,
            self._clip_notes_component.handle_notes_get,
        )
        # M3 (clip-view-mirror): rich, identity-carrying focused-clip note
        # channel (chunked begin→chunk→end). M4: by-id note editing
        # (remove/modify/add). The component also owns a focused-clip
        # notes listener that pokes /clip/notes/changed for cross-client
        # sync. See Looping's documentation/clip-view-mirror.plan.md + ADR-382.
        for address, handler in (
            (V3_CLIP_NOTES_RICH_GET_ADDRESS,
             self._clip_notes_component.handle_notes_rich_get),
            (V3_CLIP_NOTES_REMOVE_ADDRESS,
             self._clip_notes_component.handle_notes_remove),
            (V3_CLIP_NOTES_MODIFY_ADDRESS,
             self._clip_notes_component.handle_notes_modify),
            (V3_CLIP_NOTES_ADD_ADDRESS,
             self._clip_notes_component.handle_notes_add),
            (V3_CLIP_NOTES_SELECT_ADDRESS,
             self._clip_notes_component.handle_notes_select),
            (V3_CLIP_NOTES_DUPLICATE_ADDRESS,
             self._clip_notes_component.handle_notes_duplicate),
        ):
            self._transport.add_handler(address, handler)

        # NoteEditProbe — throwaway capability probe for the clip-view-
        # mirror plan's M4 (by-id note editing). Answers whether
        # apply_note_modifications can change pitch keyed by note_id (the
        # ClipNotesComponent docstring claims it can't; Permute proves it
        # can in Max — this checks the Python binding). Non-destructive:
        # snapshots and restores the focused clip. No UI consumer, not in
        # backendScope; fired only by owner/probes/note_edit_probe_run.js. Delete
        # once M4's ADR records the verdict.
        self._note_edit_probe = NoteEditProbe(
            song=self.song,
            emit=self._transport.send,
        )
        self._transport.add_handler(
            NOTE_EDIT_ADDRESS,
            self._note_edit_probe.handle_note_edit,
        )

        # SelectionProbe — throwaway read-only probe for the bidirectional
        # note-selection milestone. Introspects Clip.View's selection
        # surface (select_notes_by_id / selected_notes / changed listener)
        # so the wire can be designed from facts. No mutations, no UI
        # consumer, not in backendScope; fired by
        # owner/probes/selection_probe_run.js. Delete once the milestone records
        # its verdict.
        self._selection_probe = SelectionProbe(
            song=self.song,
            emit=self._transport.send,
        )
        self._transport.add_handler(
            SELECTION_ADDRESS,
            self._selection_probe.handle_selection_probe,
        )

        # Shared loader closure used by FootTriggerComponent
        # to append Permute on hold-created audio tracks (2026-04-30 —
        # see FootTriggerComponent docstring for why the Permute load
        # moved out of the UI). The device-load component is constructed
        # later in __init__, so resolve it at call time — the 12.3.7
        # capability gate guarantees ``_device_load_component`` is
        # attribute-set (possibly to ``None``) before any handler can
        # fire.
        def load_preset(track_index: int, preset_path: str) -> None:
            dlc = getattr(self, "_device_load_component", None)
            if dlc is None:
                logger.warning(
                    "auto-load suppressed — DeviceLoadComponent "
                    "unavailable (Live <12.3.7?)",
                )
                return
            dlc.handle_load(
                ("tracks/%d" % track_index, "", preset_path), None,
            )

        # Phase 9 PR-9b: FootTriggerComponent — owns the two arg-free
        # gesture wires (``/looping/v3/foot/tap`` and ``…/hold``)
        # emitted by ``owner/Max Patches/foot-trigger.js``. Hold creates an
        # audio track, configures it, and appends Permute via the
        # shared ``load_preset`` closure. The previous design re-emitted
        # ``/looping/v3/track/created`` so the UI ran the Permute load,
        # but the bridge broadcasts to all WS clients — Mac + iPad each
        # fired a duplicate device/load and the track ended up with two
        # Permutes (2026-04-30). Doing the load inline keeps the
        # initiator and the device-chain write in the same place.
        self._foot_trigger_component = FootTriggerComponent(
            song=self.song,
            emit=self._transport.send,
            constants=constants,
            schedule_delayed=self._schedule_delayed,
            # 2026-04-22: gate on SessionSettings.auto_arm (same toggle
            # as ExclusiveArmComponent — one flip covers both paths).
            should_auto_arm=(
                self._session_settings_component.should_auto_arm
            ),
            load_preset=load_preset,
        )
        for address, handler in (
            (V3_FOOT_TAP_ADDRESS, self._foot_trigger_component.handle_tap),
            (V3_FOOT_HOLD_ADDRESS, self._foot_trigger_component.handle_hold),
        ):
            self._transport.add_handler(address, handler)

        # WahPedalComponent — the expression pedal's two wires
        # (``/looping/v3/wah/engage`` + ``…/freq``), arriving as pedal MIDI
        # (ADR-422) or from a Max patch straight to 11020 like
        # foot-trigger.js. Same surface-owns-context shape as the foot
        # pedal: the hardware sends intent, the surface reads
        # ``song.view.selected_track``, picks the track's rack — the wah on
        # an audio track, MidiWheels on a MIDI track, a wah
        # already there on either (ADR-445) — loads-or-steps it, and
        # re-finds it by class+name to sweep its value macro — so the pedal
        # side carries no trackPath, device index, or generation. Reuses the
        # lazy ``load_into_track`` closure below so DeviceLoadComponent
        # ordering / the 12.3.7 gate don't matter.
        def load_pedal_rack_into_track(track, preset_path, at_head=False, source="", rel=""):
            dlc = getattr(self, "_device_load_component", None)
            if dlc is None:
                logger.warning(
                    "pedal rack load suppressed — DeviceLoadComponent "
                    "unavailable (Live <12.3.7?)",
                )
                return "no-loader"
            # ADR-437: the wah lands at the head of the track's audio effects
            # BY the load (the track's device insert mode set for the call),
            # never by a move afterwards — undoing the move of a device Live
            # had just loaded aborts Live. The MIDI rack takes the plain
            # load: Live puts a MIDI effect ahead of the instrument itself.
            return dlc.load_into_track(track, preset_path, at_head=at_head, source=source, rel=rel)

        self._wah_pedal_component = WahPedalComponent(
            song=self.song,
            constants=constants,
            load_into_track=load_pedal_rack_into_track,
        )
        for address, handler in (
            (V3_WAH_ENGAGE_ADDRESS, self._wah_pedal_component.handle_engage),
            (V3_WAH_FREQ_ADDRESS, self._wah_pedal_component.handle_freq),
        ):
            self._transport.add_handler(address, handler)

        # MidiWheelsComponent — the on-screen pitch/mod wheels
        # (``/looping/v3/wheels/*``) drive the MidiWheels device on the
        # selected MIDI track, loading it on the first touch; the pedal
        # shares the device on MIDI tracks. Handlers store the newest value
        # per wheel and the drain hook writes it once per pass, one undo
        # step per gesture.
        self._midi_wheels_component = MidiWheelsComponent(
            song=self.song,
            constants=constants,
            load_into_track=load_pedal_rack_into_track,
            schedule_delayed=self._schedule_delayed,
        )
        for address, handler in (
            (V3_WHEELS_PITCH_ADDRESS, self._midi_wheels_component.handle_pitch),
            (V3_WHEELS_MOD_ADDRESS, self._midi_wheels_component.handle_mod),
        ):
            self._transport.add_handler(address, handler)
        self._transport.add_drain_hook(self._midi_wheels_component.flush)

        # ADR-422: pedal CCs arriving on the surface's own MIDI input
        # port (USB) feed the two components above directly — see
        # ``_setup_midi_pedal_input``. Placed here because it captures
        # both gesture components into its callback closures.
        self._setup_midi_pedal_input(constants)

        # 2026-04-23: SimplerLoadComponent — audio-clip → Simpler
        # sampling (Flow #1 from simpler-revamp.md). Unblocked by Live
        # 12.4's SimplerDevice.replace_sample. Inserts a Simpler by name
        # on the new MIDI track (no preset file since 2026-09-27), then
        # calls replace_sample with the audio clip's file_path.
        # SimplerLoadComponent prepends Random Start before the
        # freshly-loaded Simpler in both the audio-clip and capture flows.
        # The device is the checkout's own
        # ``Vamp Devices/random-start/random-start.amxd``, loaded through the
        # "Vamp Devices" Place like Permute and MidiWheels (2026-09-27); an
        # older config's ``devices.randomStart.devicePath`` is honored
        # verbatim. No file → no prepend; Live still ends up with a usable
        # Simpler track.
        configured_rs = ""
        devices_cfg = constants.get("devices") if isinstance(constants, dict) else None
        if isinstance(devices_cfg, dict):
            rs = devices_cfg.get("randomStart")
            if isinstance(rs, dict) and isinstance(rs.get("devicePath"), str):
                configured_rs = rs["devicePath"]
        random_start_device_path = live_library.device_path(
            live_library.RANDOM_START_REL, configured_rs,
        )
        # DeviceLoadComponent is constructed *after* this block (same
        # ordering reason the load_preset closure resolves it lazily),
        # so the Random Start prepend reaches it through a closure that
        # reads ``self._device_load_component`` at call time. Returns
        # ``None`` while the surface is mid-init or in a Live-version
        # gate where the DLC is permanently absent — the prepend then
        # silently no-ops and the Simpler load itself still succeeds.
        def resolve_device_loader():
            return getattr(self, "_device_load_component", None)

        self._simpler_load_component = SimplerLoadComponent(
            song=self.song,
            emit=self._transport.send,
            random_start_device_path=random_start_device_path,
            resolve_device_loader=resolve_device_loader,
            schedule_delayed=self._schedule_delayed,
        )
        self._transport.add_handler(
            V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
            self._simpler_load_component.handle_replace_sample,
        )
        self._transport.add_handler(
            V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            self._simpler_load_component.handle_replace_sample_onto_track,
        )

        # Phase 7 PR-7b: ScenesComponent — owns the 2 scene-lifecycle
        # addresses (launch/stop) and the song-scope ``scenes`` listener
        # that advances generation on scene add/remove (state/full
        # rebuilds on the next tick; no targeted wire emit — design §2.6).
        self._scenes_component = ScenesComponent(
            song=self.song,
            emit=self._transport.send,
            advance_generation=self._generation_component.advance,
        )
        for address, handler in (
            (V3_SCENE_LAUNCH_ADDRESS, self._scenes_component.handle_launch),
            (V3_SCENE_STOP_ADDRESS, self._scenes_component.handle_stop),
        ):
            self._transport.add_handler(address, handler)

        # Rebind the structural-change composite to also tear down
        # property subscriptions whose devicePath went away AND rebind
        # track-metadata listeners against the current track set. The
        # prior composite (above) advanced generation + republished
        # v2/v3 state/full; we replace it with one that additionally
        # calls PropertyComponent.on_structural_invalidate and
        # TrackMetadataComponent.on_structural_change. Order: advance
        # generation → republish trees → tear down dead property subs
        # → rebind track-metadata listeners. The track-metadata rebind
        # lands *after* the v3 republish so the republish carries the
        # newly-added tracks' attr values on the wire; the UI binds to
        # them there and our listener rebind just ensures subsequent
        # outside edits still fire.
        property_on_structural_invalidate = (
            self._property_component.on_structural_invalidate
        )
        track_metadata_on_structural_change = (
            self._track_metadata_component.on_structural_change
        )
        meters_on_structural_change = (
            self._meters_component.on_structural_change
        )
        playhead_on_structural_change = (
            self._playhead_component.on_structural_change
        )
        clips_on_structural_change = self._clips_component.rebind
        # 2026-08-31: selection is an *object* on Live's side but a
        # position (``tracks/<N>``) on the wire, so a track removed
        # below the selection re-indexes it without firing Live's
        # selection listener. Re-check the composed path on every
        # structural change and re-emit when it moved — see
        # ``SelectedTrackComponent.on_structural_change``.
        selected_track_on_structural_change = (
            self._selected_track_component.on_structural_change
        )

        # Composite structural-change callback: advance the v3 generation
        # counter (which fires ``state/invalidate`` via
        # InvalidationComponent) AND republish the v3 state/full tree.
        # Order: advance first so the invalidate lands on the wire strictly
        # before the full republish. Every later hook is individually
        # guarded so one raising component cannot starve the rest.
        def _on_structural_change_with_properties():
            try:
                self._generation_component.advance("lom-structural")
            except Exception as e:
                logger.error(
                    "LoopingSurface: generation.advance raised: %s", e,
                )
            v3_state_full_on_structural()
            try:
                property_on_structural_invalidate()
            except Exception as e:
                logger.error(
                    "LoopingSurface: property structural-invalidate "
                    "raised: %s", e,
                )
            try:
                track_metadata_on_structural_change()
            except Exception as e:
                logger.error(
                    "LoopingSurface: track-metadata structural-change "
                    "raised: %s", e,
                )
            try:
                meters_on_structural_change()
            except Exception as e:
                logger.error(
                    "LoopingSurface: meters structural-change "
                    "raised: %s", e,
                )
            try:
                playhead_on_structural_change()
            except Exception as e:
                logger.error(
                    "LoopingSurface: playhead structural-change "
                    "raised: %s", e,
                )
            try:
                clips_on_structural_change()
            except Exception as e:
                logger.error(
                    "LoopingSurface: clips structural-change "
                    "raised: %s", e,
                )
            try:
                selected_track_on_structural_change()
            except Exception as e:
                logger.error(
                    "LoopingSurface: selected-track structural-change "
                    "raised: %s", e,
                )
            # permute ADR-020: re-walk the Permute devices (paths and
            # handles re-resolve; runtime state keyed by LOM id survives).
            sequencer = getattr(self, "_sequencer_component", None)
            if sequencer is not None:
                try:
                    sequencer.on_structural_change()
                except Exception as e:
                    logger.error(
                        "LoopingSurface: sequencer structural-change "
                        "raised: %s", e,
                    )

        self._lom_listeners.set_on_structural_change(
            _on_structural_change_with_properties,
        )

        # Gate 4a: Browser-API capability probe. No UI consumer; fired
        # only by the Gate 4a driver at ``owner/probes/gate4a_run.js``. Takes
        # the Live Browser object and a small adapter around
        # ``schedule_message`` so the probe can defer its verify pass
        # without wiring a second tick. One tick ≈ 100ms in Live; the
        # adapter rounds up to at least one tick so short delays
        # don't accidentally fire on the same tick as the load.
        try:
            browser = self.application.browser
        except Exception as e:
            # A missing ``application.browser`` would be a framework
            # regression, not a user error — log loudly, skip probe
            # registration, but keep the rest of the surface alive.
            logger.error("Could not access Live.Browser: %s", e)
            self._browser_probe = None
            self._device_load_component = None
        else:
            self._browser_probe = BrowserProbe(
                browser=browser,
                song=self.song,
                emit=self._transport.send,
                schedule_delayed=self._schedule_delayed,
            )
            self._transport.add_handler(
                BROWSER_PROBE_LOAD_ADDRESS,
                self._browser_probe.handle_browser_load,
            )
            # ROW 3 Places-tree probe DISABLED (2026-04-20):
            # first live run on Ableton 12.3.7 wedged the transport —
            # ``handle_places_dump`` traverses ``browser.user_folders``
            # and apparently hits an exception class we don't catch
            # (likely a C-level ``Live.Base`` error or a segfault-
            # adjacent condition). After the first probe every
            # subsequent ``/looping/probe/*`` request goes unanswered,
            # including the previously-working Gate 4a/4b addresses.
            # Registration is re-enabled once the root cause is found
            # — do not bind these handlers without a fix in place.
            #
            # self._transport.add_handler(
            #     BROWSER_PROBE_PLACES_DUMP_ADDRESS,
            #     self._browser_probe.handle_places_dump,
            # )
            # self._transport.add_handler(
            #     BROWSER_PROBE_PLACES_LOAD_ADDRESS,
            #     self._browser_probe.handle_places_load,
            # )
            # Phase 6 PR-6 (pr6-5): DeviceLoadComponent owns
            # ``/looping/v3/device/load``. Resolves an absolute User
            # Library filesystem path to a ``BrowserItem`` by stripping
            # ``paths.userLibraryBase`` from the hint and descending
            # ``browser.user_library`` by path segments. See the
            # component docstring for why this replaced the earlier
            # ``load_item_at_path`` approach.
            # A Mac's own (constants.local.json); unset, DeviceLoadComponent
            # takes the User Library Live's Library.cfg names.
            user_library_base = constants.get("paths", {}).get(
                "userLibraryBase", "",
            )
            # ROW 4: Places roots (Ableton sidebar). Maps display name
            # → filesystem root for every sidebar Place that needs to
            # be reachable. Filter out the ``_note`` metadata key and
            # any non-string values so a user comment can't silently
            # break resolution.
            places_roots_raw = constants.get("paths", {}).get(
                "placesRoots", {}
            ) or {}
            places_roots = {
                k: v for k, v in places_roots_raw.items()
                if isinstance(k, str) and isinstance(v, str)
                and not k.startswith("_")
            }
            # ADR-445: the wah preset lands at the head of the track's audio
            # effects from the wire too, so the Pedal view's Wah button and
            # the pedal's own engage place it identically.
            wah_cfg = (constants.get("devices") or {}).get("wah") or {}
            head_presets = [wah_cfg.get("presetPath")] if isinstance(
                wah_cfg.get("presetPath"), str,
            ) else []
            self._device_load_component = DeviceLoadComponent(
                song=self.song,
                browser=browser,
                emit=self._transport.send,
                user_library_base=user_library_base,
                places_roots=places_roots,
                # ADR-437: a pad-targeted browser load is placed the
                # moment ``load_item`` returns; a preset Live has not
                # shown yet is looked for again on the next fast tick.
                schedule_tick=self._schedule_next_tick,
                head_preset_paths=head_presets,
            )
            self._transport.add_handler(
                V3_DEVICE_LOAD_ADDRESS,
                self._device_load_component.handle_load,
            )

            # AlcClipProbe — throwaway diagnostic answering "can an .alc
            # load into a clip slot via the Browser with warp/loop/gain
            # metadata preserved?". Reuses DeviceLoadComponent's built
            # BrowserCache (the safe User-Library resolution path — a raw
            # user_folders walk wedged the transport historically, see the
            # disabled Places probe above). Not in backendScope; operator-
            # driven via owner/probes/alc_clip_probe_run.js.
            self._alc_clip_probe = AlcClipProbe(
                browser=browser,
                song=self.song,
                resolve_item=self._device_load_component._resolve_browser_item,
                emit=self._transport.send,
                schedule_delayed=self._schedule_delayed,
            )
            self._transport.add_handler(
                ALC_CLIP_PROBE_LOAD_ADDRESS,
                self._alc_clip_probe.handle_alc_clip_load,
            )

            # TrackPrepareComponent — atomic create-+-load endpoint
            # owning ``/looping/v3/track/prepare_for_preset``. Deciding
            # reuse-vs-create on authoritative LOM reads + executing in
            # one tick eliminates the multi-step UI-orchestration race
            # that produced duplicate tracks and wrong-track loads.
            # Depends on DeviceLoadComponent (for ``load_into_track``)
            # and the same ``_session_settings_component.should_auto_arm``
            # gate as the foot-trigger path.
            self._track_prepare_component = TrackPrepareComponent(
                song=self.song,
                emit=self._transport.send,
                device_load_component=self._device_load_component,
                constants=constants,
                schedule_delayed=self._schedule_delayed,
                should_auto_arm=(
                    self._session_settings_component.should_auto_arm
                ),
            )
            self._transport.add_handler(
                V3_TRACK_PREPARE_ADDRESS,
                self._track_prepare_component.handle_prepare,
            )
            self._transport.add_handler(
                V3_TRACK_DUPLICATE_ADDRESS,
                self._track_prepare_component.handle_duplicate,
            )

        # Gate 4b: scheduler-fidelity probe. Fired only by
        # ``owner/probes/gate4b_run.js``; no UI consumer. Takes the *raw*
        # ``schedule_message`` bound method — not ``_schedule_delayed``
        # — because the adapter's tick-rounding (≥100ms floor) would
        # mask what Live's scheduler actually does for short delays.
        # See the SchedulerProbe module docstring for the rationale.
        self._scheduler_probe = SchedulerProbe(
            schedule_message=self.schedule_message,
            emit=self._transport.send,
        )
        self._transport.add_handler(
            SCHEDULER_PROBE_RUN_ADDRESS,
            self._scheduler_probe.handle_schedule_run,
        )

        # Gate 4c: lifecycle probe. Two components, one OSC surface.
        #
        # ``LifecycleProbe`` is a plain class using raw
        # ``add_tempo_listener`` — same pattern as SessionComponent —
        # that counts fires and reports snapshots on OSC. Always
        # constructable; the test matrix covers its unit behaviour
        # without Live.
        #
        # ``LifecycleDecoratorProbe`` is a v3 ``Component`` subclass
        # using ``@listens("tempo")``. This is the framework-managed
        # path [03 §5] plans to use throughout; Gate 4c's core
        # question is whether it works at all in our non-MIDI
        # surface. Construction can fail several ways (framework
        # requires MIDI-backed Session, decorator imports missing,
        # ``@depends(song)`` machinery missing) — a try/except
        # captures each failure mode without taking the rest of the
        # surface down, and the ``decorator_bound`` flag in the
        # snapshot tells the driver what happened.
        self._lifecycle_probe = LifecycleProbe(
            song=self.song, emit=self._transport.send,
        )
        self._transport.add_handler(
            LIFECYCLE_PROBE_QUERY_ADDRESS,
            self._lifecycle_probe.handle_query,
        )
        self._transport.add_handler(
            LIFECYCLE_PROBE_POKE_ADDRESS,
            self._lifecycle_probe.handle_poke,
        )
        self._lifecycle_decorator_probe = None
        try:
            # Lazy imports: if the framework moves these symbols in
            # a future Live update, only the decorator probe breaks;
            # the raw probe stays green and Gate 4c records "raw path
            # works, decorator path failed with <error>" — which is
            # itself the verdict the risk doc wants.
            from ableton.v3.control_surface.component import Component
            from ableton.v2.base import inject as inject_factory
            from ableton.v2.base import listens as listens_factory
            self._lifecycle_decorator_probe = LifecycleDecoratorProbe(
                song=self.song,
                component_base=Component,
                listens_factory=listens_factory,
                inject_factory=inject_factory,
            )
            self._lifecycle_probe.set_decorator_bound(True)
            logger.info("Gate 4c: decorator path bound successfully")
        except Exception as e:
            # Deliberate broad catch: any import/construction failure
            # is a valid Gate 4c negative result, not a crash bug.
            # The surface carries on with the raw path and the
            # driver reads ``decorator_bound=0`` in the snapshot.
            logger.error(
                "Gate 4c: decorator path failed to bind: %s", e,
                exc_info=True,
            )

        # Kick off the drain tick. ``schedule_message(1, fn)`` fires
        # ``fn`` on the next tick (measured 99.4 ms, 2026-08-31); ``fn``
        # must re-schedule itself each call. This is the same idiom
        # AbletonOSC uses (manager.py:22/112) and the pattern Live's
        # embedded Python tolerates best — threads beachball.
        self.schedule_message(1, self._tick)

        # Fast inbound drain. The tick above still carries the
        # heartbeat and the scheduler-hiccup probe, and still calls
        # ``poll()`` as a fallback — but at ~100 ms it is far too
        # coarse to *read* commands off the socket, which cost a
        # measured mean 52 ms / p99 103 ms of pure queue-wait before
        # this pump existed. ``FastDrainPump`` runs the same
        # ``poll()`` off a Live-owned Timer at a sub-tick interval.
        #
        # Deliberately not fatal on failure: if the Timer class can't
        # be found or won't construct, ``start()`` returns False, the
        # reason is logged, and the tick's own ``poll()`` keeps the
        # surface working at the old latency. Same posture as the
        # Gate 4c decorator probe — a capability miss is a logged
        # verdict, not a crash.
        drain_interval = constants.get("osc", {}).get(
            "pythonSurface", {}
        ).get("drainIntervalMs", DEFAULT_INTERVAL_MS)
        self._drain_pump = FastDrainPump(
            drain=self._drain_all,
            interval_ms=drain_interval,
        )
        self._drain_pump.start()
        # permute ADR-020: the sequencer engine ticks off the same Timer
        # (every fire, drained or not — the steadiest clock the surface
        # has, 92.8 Hz measured). ``_tick`` carries it when the pump is
        # not running.
        sequencer = getattr(self, "_sequencer_component", None)
        if sequencer is not None:
            self._drain_pump.add_tick_hook(sequencer.tick)
        self._transport.add_handler(
            DRAIN_STATS_ADDRESS, self._handle_drain_stats,
        )
        logger.info(
            "Looping surface active: tempo observer + write + "
            "Gate 4a browser probe + Gate 4b scheduler probe + "
            "Gate 4c lifecycle probe + Gate 5 registry/devices/debug + "
            "05a PR-2 state/full publisher + "
            "PR-3.5.7 v3 property channel",
        )

        # PR-3c (v2): fire the surface-instance advertisement. Must
        # land on the wire *before* the v2 ``emit_on_init`` push
        # below, per [04 §8.6] — otherwise a UI whose generation is
        # still set from a prior surface instance would consume the
        # v2 tree against the wrong session context before it sees
        # the restart signal. The UDP transport is bound from the
        # component-wire block above, so emit lands cleanly.
        self._surface_hello_component.send_hello()

        # Phase 3 PR-3b: no v3 init push. The v3 tree is delivered by
        # ``HandshakeComponent`` immediately after ``accept`` fires —
        # see ``set_state_full_on_accept`` wiring above. Pre-PR-3b
        # this line fired ``emit_on_init`` at bring-up, which raced
        # UI connect: if the UI's WebSocket opened later than Live's
        # bring-up tick, the bundle went to a UDP socket with no
        # listener and the UI was left with an accepted v3 session
        # but an empty tree. The ``emit_on_accept`` path has a
        # guaranteed listener (the UI that just handshook) and needs
        # no fallback.

    # --- handlers ----------------------------------------------------------

    def _handle_live_test(self, args, source_addr):
        """Echo ``/live/test`` with ``("ok",)`` back to the sender.

        Matches the AbletonOSC contract documented in
        ``04-wire-protocol.md §1`` so the bridge's liveness probe
        logic can treat python-surface replies the same way it
        treats AbletonOSC replies.
        """
        # Returning a tuple auto-sends a reply via the transport.
        # Explicit source_addr logging is cheap and invaluable when
        # debugging "is the bridge actually reaching us?"
        logger.info("Heartbeat probe from %s args=%r", source_addr, args)
        return ("ok",)

    def _on_stream_peer_connected(self):
        """Bridge dialled in — hand off to the state/full publisher.

        Guarded rather than wired directly because the transport is
        constructed in ``__init__``'s phase 1 and the publisher in
        phase 5; a peer arriving in between (it cannot, but the
        ordering should not be load-bearing) must not raise inside the
        accept path.
        """
        publisher = getattr(self, "_v3_state_full_component", None)
        if publisher is None:
            logger.info(
                "surfaceTCP peer connected before the publisher existed; "
                "the handshake accept will deliver the tree",
            )
            return
        publisher.on_stream_peer_connected()

    def _drain_all(self):
        """Drain every transport once. The pump's single callback.

        Both legs are pumped from the same callback so they cannot
        drift: a TCP frame and a UDP datagram that arrive together are
        dispatched in the same pump, and there is one place to reason
        about ordering between them rather than two schedules.

        Returns the combined count so the pump's ``drained`` stat stays
        meaningful. A raise from either leg is caught by the pump's own
        total callback — Live stops a Timer whose callback raises — but
        each transport already swallows handler exceptions internally,
        so reaching that guard would mean a bug in the transport itself.
        """
        drained = 0
        if self._transport is not None:
            drained += self._transport.poll()
        tcp = getattr(self, "_tcp_transport", None)
        if tcp is not None:
            drained += tcp.poll()
        return drained

    def _handle_drain_stats(self, args, source_addr):
        """Report the fast drain pump's state as a JSON blob.

        Lets an operator confirm from outside Live which of the two
        drain paths is actually doing the work, and — since ``fires``
        is a monotonic counter — measure the pump's real fire rate by
        sampling twice a known interval apart. That matters because
        the Timer's interval unit is inferred, not documented.

        ``drainSkips`` is the transport's count of ``poll()`` calls
        that bailed because a drain was already running. Steady zero
        means the two pumps never actually collide.
        """
        import json
        pump = getattr(self, "_drain_pump", None)
        payload = pump.stats() if pump is not None else {
            "running": 0, "source": "", "intervalMs": 0,
            "fires": 0, "drained": 0, "errors": 0,
            "lastError": "pump not constructed",
        }
        payload["drainSkips"] = (
            self._transport.drain_skips if self._transport is not None else -1
        )
        payload["tickPeriodMsMeasured"] = 99.44
        tcp = getattr(self, "_tcp_transport", None)
        payload["tcp"] = tcp.stats() if tcp is not None else {"connected": 0}
        return (json.dumps(payload),)

    # --- gates -------------------------------------------------------------

    def _should_follow_key_in_performance(self) -> bool:
        """Composed gate for key Follow (ADR-447): the toggle AND the dev
        server running — same shape and teardown guards as
        ``_should_auto_arm_in_performance``."""
        return compose_key_follow_gate(
            getattr(self, "_session_settings_component", None),
            getattr(self, "_server_presence_component", None),
        )

    def _should_auto_arm_in_performance(self) -> bool:
        """Composed gate for arm-follows-selection: user opted in AND
        the dev server is running.

        Pulled by ``ExclusiveArmComponent`` on every commit and on
        handshake accept. Thin ``getattr`` wrapper over
        ``compose_auto_arm_gate`` — the ``getattr`` guards cover the
        teardown window where either component may already be ``None``
        (a stray listener fire then reads False — don't arm — rather
        than raising), and the pure composition lives in a testable
        free function.
        """
        return compose_auto_arm_gate(
            getattr(self, "_session_settings_component", None),
            getattr(self, "_server_presence_component", None),
        )

    # --- scheduling --------------------------------------------------------

    def _schedule_delayed(self, delay_ms, fn):
        """Adapter: milliseconds → Live ticks → ``schedule_message``.

        Live's ``ControlSurface.schedule_message(ticks, fn)`` fires
        ``fn`` after ``ticks`` ticks, where one tick is ~100ms. We
        round up so that ``_schedule_delayed(50, fn)`` still defers to
        the *next* tick rather than firing inline; the probe's verify
        pass depends on this to let Live finish processing the load
        before we diff the chain.
        """
        ticks = max(1, (int(delay_ms) + 99) // 100)
        self.schedule_message(ticks, fn)

    def _schedule_next_tick(self, fn):
        """Run ``fn`` once on the fast drain pump's next Timer fire — ~11 ms
        away, and a legal LOM write context (ADR-429's engine writes from
        it). When the pump is not running, the ~100 ms ``schedule_message``
        tick carries it, as ``_tick`` carries the engine. The hook removes
        itself before running ``fn``, so a re-arm from inside ``fn`` lands
        on the fire after this one (``_run_tick_hooks`` walks a copy).
        """
        pump = getattr(self, "_drain_pump", None)
        if pump is None or not pump.running:
            self.schedule_message(1, fn)
            return

        def once():
            pump.remove_tick_hook(once)
            fn()

        pump.add_tick_hook(once)

    # --- pedal MIDI input (ADR-422) -----------------------------------------

    def build_midi_map(self, midi_map_handle):
        """Register the pedal CCs for script forwarding.

        Live only delivers MIDI to a Remote Script for messages the
        script claims during ``build_midi_map``. With the empty element
        tree the base class claims nothing, so without this override
        CCs from the pedal port assigned as this surface's Input would
        arrive at the port and go nowhere. The adapter names the exact
        ``(channel, controller)`` pairs to claim — the foot switch on its
        learned channel, the wah on ``midiPedals.channel`` — so the script
        claims exactly what it will act on and leaves the rest of the port
        to the framework. While the foot switch is learning it claims
        every CC; ``FootSwitchComponent`` asks Live to rebuild this map
        whenever that changes.
        """
        super().build_midi_map(midi_map_handle)
        router = getattr(self, "_midi_pedal_input", None)
        if router is None:
            return
        try:
            script_handle = self._c_instance.handle()
            for channel, cc in router.forwarded_pairs():
                Live.MidiMap.forward_midi_cc(
                    script_handle, midi_map_handle, channel, cc,
                )
        except Exception as e:
            # A forwarding failure must not take down the rebuild for
            # the rest of the surface — the OSC pedal path still works.
            logger.warning(
                "pedal MIDI forwarding failed: %s: %s",
                type(e).__name__, e,
            )

    def receive_midi(self, midi_bytes):
        """Route owned pedal CCs to the adapter; the rest to the base."""
        if self._receive_pedal_midi(midi_bytes):
            return
        super().receive_midi(midi_bytes)

    def receive_midi_chunk(self, midi_chunk):
        """Chunked variant — newer Live builds deliver MIDI in batches.

        Defined defensively: when the host dispatches chunks it calls
        this instead of ``receive_midi``, and the base class's chunk
        handling (where present) may not route each message through
        ``receive_midi``, which would skip the pedal intercept. A base
        class without the method just gets the per-message calls.
        """
        remaining = [
            b for b in midi_chunk if not self._receive_pedal_midi(b)
        ]
        if not remaining:
            return
        base = getattr(super(), "receive_midi_chunk", None)
        if base is not None:
            base(tuple(remaining))
        else:
            for b in remaining:
                super().receive_midi(b)

    def _receive_pedal_midi(self, midi_bytes) -> bool:
        """True iff ``midi_bytes`` was a pedal CC and has been handled.

        The message is parsed exactly once (``parse_owned``) and the
        result handed to ``dispatch``. Dispatch is wrapped in
        ``component_guard`` (batches any resulting sends/tasks, same
        context the framework gives its own MIDI dispatch) and a broad
        except — a pedal bug must never raise into Live's MIDI
        dispatcher and take the surface down.
        """
        router = getattr(self, "_midi_pedal_input", None)
        if router is None:
            return False
        parsed = router.parse_owned(midi_bytes)
        if parsed is None:
            return False
        try:
            guard = getattr(self, "component_guard", None)
            if callable(guard):
                with guard():
                    router.dispatch(*parsed)
            else:
                router.dispatch(*parsed)
        except Exception as e:
            logger.warning(
                "pedal MIDI handling raised: %s: %s",
                type(e).__name__, e,
            )
        return True

    # --- tick --------------------------------------------------------------

    def _tick(self):
        """Fallback-drain the OSC socket, emit a 1 Hz heartbeat, re-schedule.

        Fires every ~100 ms (measured 99.44 ms, 2026-08-31). Since the
        fast drain pump landed, the ``poll()`` below is a *fallback*,
        not the primary read path: ``FastDrainPump`` normally empties
        the socket long before this runs, so the call usually finds
        nothing and costs one non-blocking ``recvfrom`` per tick.

        It is kept deliberately. Live stops a Timer whose callback
        raises (see ``drain_pump``), and the Timer class might move
        or change signature in a future Live — in either case the
        surface silently reverts to draining here, at the old ~100 ms
        latency, instead of going deaf to every inbound command.

        The heartbeat proves the control-thread scheduler is running.
        If meters go silent while the heartbeat keeps flowing, the
        stall is in Live's audio→listener notify path (or in a
        specific component). If the heartbeat *also* stops, the tick
        itself is wedged — different failure, different fix.
        """
        tick_start = time.monotonic()
        if self._transport is not None:
            drained = self._drain_all()
            # permute ADR-020: the sequencer engine normally ticks off the
            # drain pump's Timer; when the pump is not running (Timer
            # unavailable, or it stopped on an error) it degrades to this
            # ~100 ms tick rather than freezing.
            pump = getattr(self, "_drain_pump", None)
            sequencer = getattr(self, "_sequencer_component", None)
            if sequencer is not None and (pump is None or not pump.running):
                sequencer.tick()
            # Only log when something actually happened — a per-tick
            # "drained 0" would flood Log.txt at ~600 lines/minute.
            if drained > 0:
                logger.debug("Tick drained %d messages", drained)
            now = time.monotonic()
            # Scheduler-hiccup probe. A >500ms gap between ticks means
            # the control thread was blocked — almost certainly inside
            # a LOM listener callback. The log line gives us the edge
            # time; cross-reference with component logs just before it.
            gap_ms = 0.0
            if self._last_tick_mono > 0.0:
                gap_ms = (now - self._last_tick_mono) * 1000.0
                if gap_ms > 500.0:
                    logger.warning(
                        "control-thread hiccup: %.0f ms since previous tick",
                        gap_ms,
                    )
            self._last_tick_mono = now
            if now - self._last_heartbeat_ts >= 1.0:
                self._last_heartbeat_ts = now
                self._heartbeat_seq = (self._heartbeat_seq + 1) & 0x7FFFFFFF
                try:
                    self._transport.send(
                        "/looping/v3/bridge/heartbeat",
                        (self._heartbeat_seq, int(now * 1000.0)),
                    )
                except Exception as e:  # pragma: no cover — defensive
                    logger.warning("heartbeat emit failed: %s", e)

            # Profile + rate-coalescer flush. Both no-op when off.
            # Capture monotonic at the call site (not ``now`` from earlier in
            # the tick) so the duration covers the heartbeat emit + the flush
            # calls themselves, not just ``transport.poll()``.
            perf_profiler.record_tick(time.monotonic() - tick_start, gap_ms)
            perf_profiler.flush_due()
            perf_logging.flush_due()
        # Re-schedule unconditionally so that a transient transport
        # failure doesn't permanently stop the tick. ``disconnect``
        # is what actually stops it, by closing the transport and
        # relying on Live teardown to stop scheduling the callback.
        self.schedule_message(1, self._tick)

    # --- lifecycle ---------------------------------------------------------

    def disconnect(self):
        """Tear down components and close the UDP socket.

        Component teardown must happen *before* the transport closes:
        a listener fire between ``transport.close()`` and the super
        call below would try to send on a closed socket. In practice
        Live calls ``disconnect`` on the main tick thread where no
        fire can race it, but the ordering is still the safe
        default.
        """
        logger.info("Looping surface disconnecting")
        # Stop the fast drain pump before anything else. It is the
        # only thing here that can re-enter the surface *during*
        # teardown: every other disconnect below is a listener
        # detach, but the pump is an active timer that would happily
        # dispatch an inbound handler against half-freed components.
        # ``stop()`` is idempotent and safe on a pump that never
        # started, so no getattr dance is needed beyond the None
        # guard for a surface that bailed out during transport bind.
        if getattr(self, "_drain_pump", None) is not None:
            self._drain_pump.stop()
            self._drain_pump = None
        # Close the TCP listener early too. Its peer is the bridge,
        # which reconnects on its own; leaving the socket open through
        # component teardown would let an inbound frame dispatch against
        # half-freed components.
        if getattr(self, "_tcp_transport", None) is not None:
            self._tcp_transport.close()
            self._tcp_transport = None
        if getattr(self, "_session_component", None) is not None:
            self._session_component.disconnect()
            self._session_component = None
        if getattr(self, "_key_detect_component", None) is not None:
            self._key_detect_component.disconnect()
            self._key_detect_component = None
        if getattr(self, "_drum_swap_component", None) is not None:
            self._drum_swap_component.disconnect()
            self._drum_swap_component = None
        if getattr(self, "_record_suspend_component", None) is not None:
            self._record_suspend_component.disconnect()
            self._record_suspend_component = None
        if getattr(self, "_session_settings_component", None) is not None:
            self._session_settings_component.disconnect()
            self._session_settings_component = None
        # Before ServerPresenceComponent — PerformanceCapture holds a
        # reference to it for the gate.
        if getattr(self, "_performance_capture_component", None) is not None:
            self._performance_capture_component.disconnect()
            self._performance_capture_component = None
        if getattr(self, "_server_presence_component", None) is not None:
            self._server_presence_component.disconnect()
            self._server_presence_component = None
        # Teardown: DebugComponent first (no listeners — just drop
        # the emit closure), DevicesComponent next (same), then
        # LOMListeners which actually detaches song.tracks +
        # per-track listeners. Ordering matters only for the
        # listener bookkeeper: detach listeners before closing the
        # transport so a late fire doesn't try to emit against a
        # freed object graph.
        if getattr(self, "_debug_component", None) is not None:
            self._debug_component.disconnect()
            self._debug_component = None
        if getattr(self, "_view_component", None) is not None:
            self._view_component.disconnect()
            self._view_component = None
        if getattr(self, "_device_commands_component", None) is not None:
            self._device_commands_component.disconnect()
            self._device_commands_component = None
        # v3 components teardown. Order: handshake first (drops
        # sessions), invalidation next (silences any late advance
        # fires), generation last (freezes counter). Must precede
        # DevicesComponent so the latter's v3 handlers see the
        # disconnected slots when any in-flight message drains.
        if getattr(self, "_handshake_component", None) is not None:
            self._handshake_component.disconnect()
            self._handshake_component = None
        # PR-3c (v2): surface-hello teardown. One-shot component with
        # nothing to detach — just flips its disconnected flag so a
        # late ``send_hello`` (there shouldn't be one, but belt-and-
        # braces) can't emit on a torn-down transport.
        if getattr(self, "_surface_hello_component", None) is not None:
            self._surface_hello_component.disconnect()
            self._surface_hello_component = None
        if getattr(self, "_invalidation_component", None) is not None:
            self._invalidation_component.disconnect()
            self._invalidation_component = None
        if getattr(self, "_generation_component", None) is not None:
            self._generation_component.disconnect()
            self._generation_component = None
        if getattr(self, "_devices_component", None) is not None:
            self._devices_component.disconnect()
            self._devices_component = None
        # PR-5a: TrackMetadataComponent teardown. Detaches per-track
        # per-attr listeners. Order: before PropertyComponent (no
        # dependency either way, but symmetry with property's "silence
        # fires-in-flight first" ordering keeps the teardown
        # predictable).
        if getattr(self, "_track_metadata_component", None) is not None:
            self._track_metadata_component.disconnect()
            self._track_metadata_component = None
        # PR-5b: MasterComponent teardown. Detaches the master-track
        # attr listeners + mixer-device value listeners. Same ordering
        # rationale as TrackMetadata above.
        if getattr(self, "_master_component", None) is not None:
            self._master_component.disconnect()
            self._master_component = None
        # PR-5c: MetersComponent teardown. Detaches per-track + master
        # output-meter listeners. Same ordering as Master/Metadata —
        # silence fires-in-flight before tearing down PropertyComponent
        # and the mutation component.
        if getattr(self, "_meters_component", None) is not None:
            self._meters_component.disconnect()
            self._meters_component = None
        # permute ADR-020: SequencerComponent teardown FIRST among the
        # clip-touching components — it restores every clip it shifted or
        # muted and emits idle steps, and that restore goes through the
        # playhead query and the drum fan-out, both still alive here.
        if getattr(self, "_sequencer_component", None) is not None:
            self._sequencer_component.disconnect()
            self._sequencer_component = None
        # ADR-360: PlayheadComponent teardown. Detaches per-track slot
        # + per-clip listeners. Same ordering rationale as Meters.
        if getattr(self, "_playhead_component", None) is not None:
            self._playhead_component.disconnect()
            self._playhead_component = None
        # PR-5e1: ClipPropertiesComponent teardown. Detaches the
        # song-scoped detail_clip listener + any currently-attached
        # per-clip property listeners. Same "silence fires-in-flight
        # before the mutation component" ordering as Meters/Master.
        if getattr(self, "_clip_properties_component", None) is not None:
            self._clip_properties_component.disconnect()
            self._clip_properties_component = None
        # Phase 7 PR-7d: SelectedTrackComponent teardown. Detaches
        # the song.view.selected_track listener. Order next to
        # ClipPropertiesComponent — both observe song.view; silencing
        # them together keeps a last-second selection change from
        # firing on an almost-torn-down transport.
        if getattr(self, "_selected_track_component", None) is not None:
            self._selected_track_component.disconnect()
            self._selected_track_component = None
        # ExclusiveArmComponent teardown. Second subscriber to
        # song.view.selected_track — detach alongside
        # SelectedTrackComponent so neither observer fires on a
        # torn-down song.
        if getattr(self, "_exclusive_arm_component", None) is not None:
            self._exclusive_arm_component.disconnect()
            self._exclusive_arm_component = None
        # PR-5e2: GrooveComponent teardown before GroovePoolComponent
        # — GrooveComponent holds a reference to the pool and may
        # call into it during disconnect-time fires (the focus-scoped
        # delete-return path). Pool detaches its
        # `groove_pool.grooves` listener last so in-flight
        # GrooveComponent fires still see a valid pool.
        if getattr(self, "_groove_component", None) is not None:
            self._groove_component.disconnect()
            self._groove_component = None
        if getattr(self, "_groove_pool_component", None) is not None:
            self._groove_pool_component.disconnect()
            self._groove_pool_component = None
        # Phase 7 PR-7b: ClipsComponent teardown. Detaches every
        # per-slot ``has_clip`` listener before ScenesComponent (whose
        # song-scope ``scenes`` listener is cheaper to tear down and
        # less likely to race late fires). Silencing the per-slot
        # listeners first keeps a teardown-time clip delete from
        # emitting on an almost-closed transport.
        if getattr(self, "_clips_component", None) is not None:
            self._clips_component.disconnect()
            self._clips_component = None
        # Phase 8 PR-8b: ClipNotesComponent teardown. No LOM listeners;
        # ``disconnect`` just flips the silencing flag.
        if getattr(self, "_clip_notes_component", None) is not None:
            self._clip_notes_component.disconnect()
            self._clip_notes_component = None
        if getattr(self, "_track_transpose_component", None) is not None:
            self._track_transpose_component.disconnect()
            self._track_transpose_component = None
        # ADR-422: pedal MIDI input teardown — before the two gesture
        # components it feeds, so a late ``receive_midi`` can't re-enter
        # them mid-teardown. Plain flag flip; pending hold checks left
        # in the scheduler become no-ops.
        if getattr(self, "_foot_switch_component", None) is not None:
            self._foot_switch_component.disconnect()
            self._foot_switch_component = None
        if getattr(self, "_midi_pedal_input", None) is not None:
            self._midi_pedal_input.disconnect()
            self._midi_pedal_input = None
        # Phase 9 PR-9b: FootTriggerComponent teardown. No LOM
        # listeners (writes go through SessionComponent's
        # session_record listener); ``disconnect`` only flips the
        # silencing flag.
        if getattr(self, "_foot_trigger_component", None) is not None:
            self._foot_trigger_component.disconnect()
            self._foot_trigger_component = None
        if getattr(self, "_wah_pedal_component", None) is not None:
            self._wah_pedal_component.disconnect()
            self._wah_pedal_component = None
        if getattr(self, "_midi_wheels_component", None) is not None:
            self._midi_wheels_component.disconnect()
            self._midi_wheels_component = None
        if getattr(self, "_simpler_load_component", None) is not None:
            self._simpler_load_component.disconnect()
            self._simpler_load_component = None
        if getattr(self, "_scenes_component", None) is not None:
            self._scenes_component.disconnect()
            self._scenes_component = None
        # Phase 6 PR-6 (pr6-5): DeviceLoadComponent teardown. No LOM
        # listeners held, so ``disconnect`` just flips the silencing
        # flag — ordering is flexible, grouped here with the other v3
        # components for symmetry.
        if getattr(self, "_device_load_component", None) is not None:
            self._device_load_component.disconnect()
            self._device_load_component = None
        # TrackPrepareComponent teardown — drops the LRU and silences
        # any further handler invocations. Tear down before the
        # transport closes so a deferred audio-create finalize can't
        # land on a dead emit.
        if getattr(self, "_track_prepare_component", None) is not None:
            self._track_prepare_component.disconnect()
            self._track_prepare_component = None
        # Detach property subscriptions before the mutation component
        # so their fires-in-flight are silenced first (PropertyComponent
        # owns its own LOM listeners on device sub-objects like
        # ``device.sample`` and direct attrs like ``voice_mode_index``).
        # ADR-428: DrumVirtualMacroComponent teardown. Detaches the rack
        # pads/chains/macros listeners and drops pending fan-outs. Before
        # PropertyComponent, which routes the vm.* rows to it.
        if getattr(self, "_drum_vm_component", None) is not None:
            self._drum_vm_component.disconnect()
            self._drum_pad_chain_component.disconnect()
            self._drum_vm_component = None
        if getattr(self, "_property_component", None) is not None:
            self._property_component.disconnect()
            self._property_component = None
        # Detach the mutation component *before* the listener
        # bookkeeper. ``LOMListeners.disconnect`` walks every
        # ``_param_value_listeners`` entry to ``remove_value_listener``;
        # any in-flight LOM fire between those detaches and our flag
        # flip would otherwise emit on a closed transport. Flipping
        # ``_disconnected`` first turns those fires into no-ops.
        if getattr(self, "_mutation_component", None) is not None:
            self._mutation_component.disconnect()
            self._mutation_component = None
        # Detach the state/full publishers *before* the listener
        # bookkeeper. Their structural-change hook would otherwise
        # fire on a listener teardown race.
        if getattr(self, "_v3_state_full_component", None) is not None:
            if getattr(self, "_lom_listeners", None) is not None:
                self._lom_listeners.set_on_structural_change(None)
            self._v3_state_full_component.disconnect()
            self._v3_state_full_component = None
        # DeviceInitComponent owns an ``on_device_added`` hook wired at
        # ``:1062``. Its ``disconnect`` has existed since the component was
        # written and was never called from here — the teardown asymmetry
        # leaked its hook across every set reload.
        if getattr(self, "_device_init_component", None) is not None:
            self._device_init_component.disconnect()
            self._device_init_component = None
        if getattr(self, "_lom_listeners", None) is not None:
            self._lom_listeners.disconnect()
            self._lom_listeners = None
        # BrowserProbe and SchedulerProbe have no LOM listeners to
        # detach — they're pure request/response — so no teardown
        # calls; just drop the refs so the emit closures (which
        # capture ``self._transport.send``) aren't kept alive past
        # transport close. SchedulerProbe additionally captures the
        # bound ``schedule_message`` method, which is kept alive by
        # the framework until super().disconnect(), so ordering of
        # drop-ref → close transport → super is what we want.
        self._browser_probe = None
        self._scheduler_probe = None
        # Gate 4c: tear down the lifecycle probes. Both own LOM
        # listener attachments (raw via ``add_tempo_listener``, or
        # framework-managed via ``@listens``), so both need
        # ``disconnect`` before the transport closes — the
        # LifecycleProbe emits a final ``TEARDOWN_ADDRESS`` message
        # on its way out. Ordering is raw → decorator so the
        # LifecycleProbe's teardown emit lands while the transport
        # is still open.
        if getattr(self, "_lifecycle_probe", None) is not None:
            self._lifecycle_probe.disconnect()
            self._lifecycle_probe = None
        if getattr(self, "_lifecycle_decorator_probe", None) is not None:
            self._lifecycle_decorator_probe.disconnect()
            self._lifecycle_decorator_probe = None
        if self._transport is not None:
            self._transport.close()
            self._transport = None
        # Flush + close the surface profiler dump file so the final
        # window lands on disk. No-op when LOOPING_SURFACE_PROFILE is
        # unset.
        try:
            perf_profiler.close()
        except Exception:
            pass
        # Drop any pending rate-coalesced log buckets. Module-level state
        # under Live's embedded interpreter survives surface reload, so
        # without this clear, the first ``flush_due()`` of the next session
        # would emit "xN" summaries with stale counts from this one.
        try:
            perf_logging.reset()
        except Exception:
            pass
        super().disconnect()
