/**
 * Scope-partition test.
 *
 * Asserts: for every OSC address in the migration's wire contract
 * (04-wire-protocol.md), `getRoutingTarget` returns exactly one
 * backend — never an overlap, never a gap.
 *
 * This is the test named in [03 §10.4] and [06 §1.11]. It catches
 * the "both M4L and Python answer /live/song/get/tempo" class of
 * bug structurally, which manual UI testing cannot — duplicate
 * observer fires look identical to slightly-noisy observers until
 * you spend a day debugging them.
 *
 * The address catalog below is hand-derived from 04-wire-protocol.md
 * with inline section citations. A markdown-parsing verifier that
 * asserts catalog ⇔ spec is a reasonable future follow-up but not a
 * §0.1 requirement.
 *
 * @see Looping's documentation/archive/m4l-to-python/03-target-architecture.md §10.4
 * @see Looping's documentation/archive/m4l-to-python/04-wire-protocol.md
 * @see Looping's documentation/archive/m4l-to-python/06-risks-and-open-questions.md §1.11
 */

import { describe, it, expect } from 'vitest';
import { getRoutingTarget } from '../../../../bridge/routing/messageRouter.js';

/**
 * One row per OSC address the UI sends. Inbound addresses (DAW → UI)
 * do not hit `getRoutingTarget` — the router only classifies outbound
 * traffic — so the catalog is scoped to `dir: "→"` rows from 04.
 *
 * `section` is the 04-wire-protocol.md section where the address is
 * defined; breaks of contract show up in the failure output with a
 * spec pointer rather than a bare address.
 *
 * `note` carries the reason where routing is non-obvious (e.g., the
 * `/looping/sequencer/*` family goes to the Permute .amxd on port
 * 11008, not to the Python surface — [04 §5.9]).
 */
type AddressSpec = {
	address: string;
	section: string;
	note?: string;
};

// --- UI-sent addresses from 04-wire-protocol.md ---------------------------

const HEARTBEAT_AND_PROTOCOL: AddressSpec[] = [
	{
		address: '/live/test',
		section: '§1',
		note: 'Gate 1: migrated to pythonSurface via backendScope'
	}
	// /looping/protocol/version moved to PYTHON_SURFACE_MIGRATED at Gate 5
	// — the Python surface is now the authoritative answerer.
];

// Addresses migrated to the Python surface by bootstrap gates. These are
// listed in `osc.backendScope.pythonSurface` in constants.json and therefore
// route to `pythonSurface` instead of their legacy prefix owner. Kept as
// their own catalog block so the migration's progress is visible at a
// glance from the test file alone.
//
// Gate 1: `/live/test` (heartbeat) — see HEARTBEAT_AND_PROTOCOL.
// Gate 2: `/live/song/get/tempo` (read) + `/looping/session/tempo`
//         (observer fire). The tempo observer address is inbound-only
//         today, but we include it so the scope-partition test pins
//         that *if* it ever flows outbound it ends up on Python, not
//         leaking into the `/looping/*` catch-all.
// Gate 3: `/live/song/set/tempo` (write). First write path on the
//         Python surface; handler validates 20–999 and uses a
//         one-shot suppression flag to swallow its own echo.
// Gate 5: `/looping/protocol/version` (handshake),
//         `/looping/error` (error-reply shape),
//         `/looping/v2/*` (the whole id-addressed surface, via the
//         new prefix-glob entry in backendScope.pythonSurface).
const PYTHON_SURFACE_MIGRATED: AddressSpec[] = [
	{
		address: '/live/song/get/tempo',
		section: '§4.1',
		note: 'Gate 2: SessionComponent handler; legacy AbletonOSC path carved out'
	},
	{
		address: '/live/song/set/tempo',
		section: '§4.1',
		note: 'Gate 3: SessionComponent handler; legacy AbletonOSC path carved out'
	},
	{
		address: '/looping/session/tempo',
		section: '§5.1 (observer)',
		note: 'Gate 2: SessionComponent listener; inbound-only today'
	},
	{
		address: '/looping/protocol/version',
		section: '§1',
		note: 'DebugComponent answers with the surface protocol version ("3.1.0" after Phase 7 PR-7a)'
	},
	{
		address: '/looping/error',
		section: '§1',
		note: 'Gate 5: Python surface error reply shape'
	},
	{
		address: '/looping/v3/device/load',
		section: '§7 / Phase 6 PR-6',
		note: 'DeviceLoadComponent owns device/preset loading'
	},
	{
		address: '/looping/v3/clip/transpose',
		section: '§3.6 / Phase 8 PR-8b',
		note: 'ClipNotesComponent owns clip-note transposition; replaced M4L /cmd/transpose_clip_notes'
	},
	{
		address: '/looping/v3/track/transpose',
		section: '§3.6 / 2026-09-25',
		note: 'TrackTransposeComponent: ±12 on an Instrument Rack finds a wrapped Drum Rack by class'
	},
	{
		address: '/looping/v3/track/create_audio',
		section: '§5.4 / Phase 10 PR-10a',
		note: 'TrackCreateComponent; replaced M4L /looping/track/create_audio'
	},
	{
		address: '/looping/v3/track/create_midi',
		section: '§5.4 / Phase 10 PR-10a',
		note: 'TrackCreateComponent; replaced M4L /looping/track/create_midi'
	},
	{
		address: '/looping/v3/track/volume',
		section: '§5.4 / ROW 2-F3',
		note: 'TrackMetadataComponent mixer-attr write; replaced M4L /looping/track/set/volume'
	},
	{
		address: '/looping/v3/track/select',
		section: '§5.4 / ROW 2-F4',
		note: 'SelectedTrackComponent; replaced AbletonOSC /live/view/set/selected_track'
	},
	{
		address: '/looping/v3/selected_scene',
		section: '§4.5 / ROW 7c',
		note: 'SelectedTrackComponent scene listener; replaced AbletonOSC /live/view/{get,start_listen,stop_listen}/selected_scene'
	},
	{
		address: '/looping/v3/selected_clip',
		section: '§4.5 / ROW 7c',
		note: 'SelectedTrackComponent.handle_select_clip; replaced AbletonOSC /live/view/set/selected_clip'
	},
	{
		address: '/looping/v3/track/send',
		section: '§4.2 / ROW 7c',
		note: 'TrackMetadataComponent.handle_set_send; replaced AbletonOSC /live/track/set/send'
	},
	{
		address: '/looping/v3/clip/set/pitch_coarse',
		section: '§3.6 / ROW 7d',
		note: 'ClipPropertiesComponent.handle_set_pitch_coarse; replaced AbletonOSC /live/clip/{get,set}/pitch_coarse'
	},
	{
		address: '/looping/v3/clip/delete',
		section: '§3.5 / ROW 7d',
		note: 'ClipsComponent.handle_delete; replaced AbletonOSC /live/clip_slot/delete_clip'
	}
];

// /looping/v2/* — the canonical id-addressed surface ([04 §3]).
// Every address here routes to the Python surface via the
// `/looping/v2/*` prefix-glob entry in backendScope.pythonSurface
// (added Gate 5). The partition assertion below pins that fact so
// an accidental carve-out here-in-messageRouter can't split v2 across
// backends without failing this test.
const LOOPING_V2_SURFACE: AddressSpec[] = [
	// §3.1 session
	{ address: '/looping/v2/session/set/tempo', section: '§3.1' },
	{ address: '/looping/v2/session/set/metronome', section: '§3.1' },
	{ address: '/looping/v2/session/set/signature_numerator', section: '§3.1' },
	{ address: '/looping/v2/session/set/signature_denominator', section: '§3.1' },
	{ address: '/looping/v2/session/set/loop', section: '§3.1' },
	{ address: '/looping/v2/session/set/loop_start', section: '§3.1' },
	{ address: '/looping/v2/session/set/loop_length', section: '§3.1' },
	{ address: '/looping/v2/session/set/groove_amount', section: '§3.1' },
	{ address: '/looping/v2/session/set/session_record', section: '§3.1' },
	{ address: '/looping/v2/session/set/is_playing', section: '§3.1' },
	// §3.2 tracks
	{ address: '/looping/v2/track/set/name', section: '§3.2' },
	{ address: '/looping/v2/track/set/volume', section: '§3.2' },
	{ address: '/looping/v2/track/set/panning', section: '§3.2' },
	{ address: '/looping/v2/track/set/mute', section: '§3.2' },
	{ address: '/looping/v2/track/set/solo', section: '§3.2' },
	{ address: '/looping/v2/track/set/arm', section: '§3.2' },
	{ address: '/looping/v2/track/select', section: '§3.2' },
	{ address: '/looping/v2/track/create_midi', section: '§3.2' },
	{ address: '/looping/v2/track/create_audio', section: '§3.2' },
	{ address: '/looping/v2/track/delete', section: '§3.2' },
	{ address: '/looping/v2/track/delete_devices', section: '§3.2' },
	// §3.3 devices
	{ address: '/looping/v2/devices/query', section: '§3.3' },
	{
		address: '/looping/v2/devices/query_params',
		section: '§3.3',
		note: 'Gate 5 transitional — replaced by v2 complete_state in §2.5'
	},
	{ address: '/looping/v2/devices/load', section: '§3.3' },
	{ address: '/looping/v2/device/select', section: '§3.3' },
	{ address: '/looping/v2/device/move_to_top', section: '§3.3' },
	{ address: '/looping/v2/device/move_to_end', section: '§3.3' },
	{ address: '/looping/v2/device/set/property', section: '§3.3' },
	// §3.4 parameters
	{ address: '/looping/v2/param/set', section: '§3.4' },
	// §3.5 clip slots and clips
	{ address: '/looping/v2/slot/fire', section: '§3.5' },
	{ address: '/looping/v2/slot/stop', section: '§3.5' },
	{ address: '/looping/v2/slot/create_clip', section: '§3.5' },
	{ address: '/looping/v2/slot/create_audio_clip', section: '§3.5' },
	{ address: '/looping/v2/slot/delete_clip', section: '§3.5' },
	{ address: '/looping/v2/clip/set/loop_start', section: '§3.5' },
	{ address: '/looping/v2/clip/set/loop_end', section: '§3.5' },
	{ address: '/looping/v2/clip/set/loop_length', section: '§3.5' },
	{ address: '/looping/v2/clip/set/pitch_coarse', section: '§3.5' },
	{ address: '/looping/v2/clip/set/pitch_fine', section: '§3.5' },
	{ address: '/looping/v2/clip/set/name', section: '§3.5' },
	{ address: '/looping/v2/clip/set/color', section: '§3.5' },
	{ address: '/looping/v2/clip/set/gain', section: '§3.5' },
	{ address: '/looping/v2/clip/set/muted', section: '§3.5' },
	{ address: '/looping/v2/clip/set/looping', section: '§3.5' },
	{ address: '/looping/v2/clip/set/warping', section: '§3.5' },
	{ address: '/looping/v2/clip/get/file_path', section: '§3.5' },
	{ address: '/looping/v2/clip/duplicate_loop', section: '§3.5' },
	{ address: '/looping/v2/clip/transpose_notes', section: '§3.5' },
	// §3.6 scale, capture, reset
	{ address: '/looping/v2/scale/set/root_note', section: '§3.6' },
	{ address: '/looping/v2/scale/set/scale_name', section: '§3.6' },
	{ address: '/looping/v2/scale/learn/start', section: '§3.6' },
	{ address: '/looping/v2/scale/learn/note', section: '§3.6' },
	{ address: '/looping/v2/scale/learn/end', section: '§3.6' },
	{ address: '/looping/v2/capture/create_simpler', section: '§3.6' },
	{ address: '/looping/v2/master/delete_devices', section: '§3.6' },
	// §3.7 liveAPI proxy
	{ address: '/looping/v2/live_api/get', section: '§3.7' },
	{ address: '/looping/v2/live_api/set', section: '§3.7' },
	{ address: '/looping/v2/live_api/call', section: '§3.7' },
	{ address: '/looping/v2/live_api/observe', section: '§3.7' },
	{ address: '/looping/v2/live_api/unobserve', section: '§3.7' },
	// §3.8 debug
	{ address: '/looping/v2/debug/observers', section: '§3.8' },
	{ address: '/looping/v2/debug/set/log_level', section: '§3.8' }
];

// ROW 7e (2026-04-21): LEGACY_LIVE_SURFACE deleted. After the final
// AbletonOSC retirement, the UI sends zero `/live/*` addresses — every
// surviving `/live/song/set/tempo` caller migrated to `send()` (routes to
// pythonSurface via backendScope exact-match), and the
// `interface/src/lib/abletonosc/` router + parsers + `abletonOSCHandler.ts`
// + `sendAbletonOSCCommand` + the `/live/` prefix filter in
// `simpleClient.routeMessage` were all deleted. The catalog is now
// `/live/*`-free; the ROW-by-ROW retirement comments that used to live
// here are preserved in `10-cleanup-plan.md` under rows 7a-7d.

// Legacy /looping/* ([04 §5]). These were answered by the M4L observer
// (maxObserver) until it was removed 2026-09-23 (general-release audit
// Tier 0); none has a UI sender, and each now routes to 'none', which
// WebSocketServer.routeMessageToUDP logs and drops.
const LEGACY_LOOPING_SURFACE: AddressSpec[] = [
	// §5.1, §5.2 devices
	// ROW 6 (2026-04-21): /looping/devices/{complete_state,query,refresh}
	// retired — Python DeviceInitComponent + V3StateFullComponent own the
	// device-list wire via state/full D/P-records and scoped deltas.
	// The M4L pipeline (selectedTrackChanged → buildCompleteDeviceState →
	// sendCompleteDeviceState, ~735 LOC) is gone from liveAPI-v6.js.
	{ address: '/looping/devices/ensure_sequencer', section: '§5.2' },
	// §5.3 device parameter
	{ address: '/looping/device/set/property', section: '§5.3' },
	// ROW 5 (2026-04-21): /looping/device/get/parameter_names retired —
	// parameter names carried by state/full D/P-records, surfaced via
	// selectedTrackStore.paramNamesForDevice (PR-3.5.4). Zero UI callers.
	// ROW 5 (2026-04-21): /looping/device/{select,move_appointed_to_top,
	// move_appointed_to_end} retired — path-addressed v3 equivalents on
	// DeviceCommandsComponent (/looping/v3/device/{select,move_to_top,
	// move_to_end}) route via the /looping/v3/* backendScope glob.
	// §5.4 tracks
	// ROW 6.5 (2026-04-21): /looping/track/query retired — `TrackMetadata`
	// query round-trip deleted in favour of the T-record `volume` field on
	// state/full (arity 10). Zero UI callers.
	{ address: '/looping/track/set/name', section: '§5.4' },
	// ROW 2-F3 (2026-04-21): /looping/track/set/volume retired —
	// /looping/v3/track/volume on TrackMetadataComponent (mixer-attr
	// write path) replaces it. See PYTHON_SURFACE_MIGRATED.
	// `/looping/track/create_audio` + `/looping/track/create_midi` migrated
	// to Python in Phase 10 PR-10a; see PYTHON_SURFACE_MIGRATED for the v3
	// replacements.
	// ROW 2-F2 (2026-04-21): /looping/{track,master}/delete_devices +
	// the entire session-reset flow deleted — no Python replacement;
	// the UI feature was removed. `deleteMasterDevices`/
	// `deleteTrackDevices` M4L helpers and the UI service + Svelte
	// component are gone.
	// §5.5 master
	// §5.6 session
	// ROW 6.5 (2026-04-21): /looping/query/{session,tracks,count} +
	// /looping/refresh retired — v3 handshake accept auto-emits state/full,
	// replacing every mount-time init-query round-trip. The M4L dispatch
	// branches (sendcurrentstate / refresh / msg_int) are deleted too.
	// ROW 13a (2026-04-21): /looping/session/query_{track_summaries,single_track}
	// retired — clipStateStore now $derives from v3Store.tracks[...].slots,
	// which is seeded by V3StateFullComponent's S/C record emission and
	// kept current by ClipsComponent's per-slot has_clip listeners. The
	// M4L queryTrackSummaries/querySingleTrackSummary helpers are gone.
	// §5.7 scale / learn
	// ROW 2-F1 (2026-04-21): /looping/song/{get,set}/{root_note,scale_name,scale_mode}
	// removed from UI + M4L. Python SessionComponent owns the scale wire
	// on /looping/v3/session/{scale_root,scale_name,scale_mode}.
	{ address: '/looping/learn/start', section: '§5.7' },
	{ address: '/looping/learn/note', section: '§5.7' },
	{ address: '/looping/learn/end', section: '§5.7' },
	// §5.8 liveAPI proxy
	// ROW 5 (2026-04-21): /looping/live_api/{get,set}_property,
	// {start,stop}_observe, call_function retired with
	// liveObjectAPI.ts (UI singleton) + the M4L helpers. Zero callers.
	// §5.10 capture
	// ROW 6.5 (2026-04-21): /looping/capture/create_simpler retired — zero
	// UI senders; the M4L `handleCaptureCreateSimpler` dispatch branch is
	// deleted too. `/cmd/sample_clip_to_simpler` carve-out below remains
	// (it's the surviving Max-hardware-triggered path).
	// §5.12 debug
	// ROW 6.5 (2026-04-21): /looping/debug{,observers/report,
	// suppression/{status,test}} retired — the M4L debug/suppression
	// instrumentation shipped in Phase 8 is gone; Python
	// DebugComponent owns modern debug queries.
];

// Phase 10 PR-10d (2026-04-19): deleted `/looping/sequencer/*` route and
// the `'sequencer'` port pair (11008/11009). Permute v4.0.0 exposes state
// as standard `Device.parameters` on the v3 parameter wire.
//
// `/capture/*` used to co-tenant the sequencer port; with the port gone,
// those sends have no routing target until Phase 9 introduces
// `SamplerCaptureComponent`. The feature is deliberately broken in the
// interim — tracked as a deferred task.

// §6 non-DAW endpoints — included to pin that the bridge's partition
// is stable across the full address space the UI actually uses.
// The shell-helper (`/shell/*`), NI (`/ni/*`) and Omnisphere
// (`/search`, `/get_*`) endpoints were removed 2026-09-23 with their
// servers; so were the Max observer carve-outs (`/tracks/master/*`,
// `/cmd/sample_clip_to_simpler`, `/view/*`). None had a UI sender.
// `/midi/*` went with the midiConverter port on 2026-09-25: the on-screen
// wheels now travel as /looping/v3/wheels/* to the surface (pinned below).
// `/totalmix/*` went on 2026-09-27 with the transport header's faders.

const ALL_ADDRESSES: AddressSpec[] = [
	...HEARTBEAT_AND_PROTOCOL,
	...PYTHON_SURFACE_MIGRATED,
	...LOOPING_V2_SURFACE,
	...LEGACY_LOOPING_SURFACE
];

// Known backend names from messageRouter.js's getRoutingTarget return values.
const KNOWN_BACKENDS = new Set([
	'loopingRecorder',
	'pythonSurface',
	'none'
]);

describe('scope-partition: every migration address routes to exactly one backend', () => {
	it('catalog is non-empty and deduplicated', () => {
		// Sanity: a silently-empty catalog would make the rest of the
		// assertions vacuous. Catch that, and catch copy-paste dupes.
		expect(ALL_ADDRESSES.length).toBeGreaterThan(50);
		const addresses = ALL_ADDRESSES.map((a) => a.address);
		const unique = new Set(addresses);
		expect(unique.size).toBe(addresses.length);
	});

	it.each(ALL_ADDRESSES)(
		'$section $address routes to exactly one known backend',
		({ address, note }) => {
			const target = getRoutingTarget(address);
			const hint = note ? ` (${note})` : '';
			expect(target, `expected a known backend for ${address}${hint}`).toBeTruthy();
			expect(
				KNOWN_BACKENDS.has(target),
				`unknown backend "${target}" for ${address}${hint}`
			).toBe(true);
		}
	);

	it('every v2 address routes to the Python surface (Gate 5 prefix-glob)', () => {
		// A /looping/v2/* address is the canonical id-addressed form;
		// Gate 5 adds a `/looping/v2/*` prefix-glob entry to
		// backendScope.pythonSurface so the whole family routes in one
		// step. An accidental carve-out in messageRouter (e.g., a new
		// `/looping/v2/something` exception for a prototype) would split
		// the family across backends and fail this pin.
		const v2Targets = new Set(
			LOOPING_V2_SURFACE.map(({ address }) => getRoutingTarget(address))
		);
		expect(v2Targets.size, `v2 addresses split across: ${[...v2Targets].join(', ')}`).toBe(1);
		for (const { address } of LOOPING_V2_SURFACE) {
			expect(getRoutingTarget(address), address).toBe('pythonSurface');
		}
	});

	it('migrated addresses route to pythonSurface (Gate 1–Gate 5 bootstrap progress)', () => {
		// Belt-and-braces check: the generic "exactly one backend" pass
		// above is satisfied by any correct partition, including one
		// that quietly leaves a migrated address on its legacy owner.
		// This assertion pins the backend *identity* for each address
		// we've explicitly moved, so a typo in backendScope (e.g.,
		// a trailing space in constants.json) fails loud.
		expect(getRoutingTarget('/live/test')).toBe('pythonSurface');
		for (const { address } of PYTHON_SURFACE_MIGRATED) {
			expect(getRoutingTarget(address), address).toBe('pythonSurface');
		}
	});

	it('the on-screen wheels route to the surface, and /midi/* nowhere', () => {
		// 2026-09-25: the wheels drive the MidiWheels device through the
		// surface's MidiWheelsComponent. Their old /midi/* addresses rode the
		// midiConverter port to the standalone Max patch; that port is gone,
		// so a stray /midi/* sender must be dropped, not sent anywhere.
		expect(getRoutingTarget('/looping/v3/wheels/pitch')).toBe('pythonSurface');
		expect(getRoutingTarget('/looping/v3/wheels/mod')).toBe('pythonSurface');
		expect(getRoutingTarget('/midi/pitch_bend')).toBe('none');
		expect(getRoutingTarget('/midi/mod_wheel')).toBe('none');
	});
});
