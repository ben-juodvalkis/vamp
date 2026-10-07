/**
 * Enhanced OSC Client - V6 AbletonOSC Integration
 *
 * Main orchestrator for WebSocket-OSC communication.
 * Delegates to specialized modules:
 * - connection/WebSocketConnection.ts - Connection lifecycle and message queue
 * - handlers/ - Domain-specific message handlers
 */

import { handleMessage as handleThemeMessage } from '$lib/stores/theme';
import { freezeDetector } from '$lib/utils/freeze-detector';
import { logger } from '$lib/utils/logger';
import { clearSession } from '$lib/stores/session.svelte';
import type { OSCArg } from '$lib/types/osc';

// Import connection management
import {
	connectToLive as wsConnect,
	send as wsSend,
	isConnected as wsIsConnected,
	getConnectionStatus as wsGetConnectionStatus,
	getLastListenerOperation as wsGetLastListenerOperation,
	getRecentMessages as wsGetRecentMessages,
	setMessageHandler,
	setConnectionHandler
} from './connection/WebSocketConnection';

// Import message handlers
import {
	handleBridgeMessage,
	handleCommandMessage,
	handlePingPongMessage,
	handleInitMessage
} from './handlers';
import {
	handleV3StateFullTree,
	handleV3StateFullUnchanged,
	V3_STATE_FULL_TREE_ADDRESS,
	V3_STATE_FULL_UNCHANGED_ADDRESS
} from './handlers/v3StateFull';
import {
	handleV3StateInvalidate,
	V3_STATE_INVALIDATE_ADDRESS
} from './handlers/v3Invalidate';
import {
	handleV3ParamValue,
	V3_PARAM_VALUE_ADDRESS
} from './handlers/v3ParamValue';
import {
	handleV3ParamDisplay,
	V3_PARAM_DISPLAY_ADDRESS
} from './handlers/v3ParamDisplay';
import {
	handleV3PropertyValue,
	V3_PROPERTY_VALUE_ADDRESS
} from './handlers/v3Property';
import { setPropertySender } from '$lib/stores/v3/propertySubscriptions.svelte';
import {
	handleV3HandshakeAccept,
	handleV3Error,
	sendHandshakeHello,
	sendStateResync,
	setSender as setV3HandshakeSender,
	V3_HANDSHAKE_ACCEPT_ADDRESS,
	V3_ERROR_ADDRESS
} from './handlers/v3Handshake';
import {
	handleV3SurfaceHello,
	V3_SURFACE_HELLO_ADDRESS
} from './handlers/v3SurfaceHello';
import {
	handleV3TrackMetadata,
	isV3TrackMetadataAddress
} from './handlers/v3TrackMetadata';
import {
	handleV3HasArrangementClips,
	V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS
} from './handlers/v3HasArrangementClips';
import {
	handleV3TrackFoldState,
	V3_TRACK_FOLD_STATE_ADDRESS
} from './handlers/v3TrackFoldState';
import {
	handleV3MasterMetadata,
	isV3MasterMetadataAddress
} from './handlers/v3MasterMetadata';
import { handleV3Meter, isV3MeterAddress } from './handlers/v3Meter';
import {
	handleV3PermuteStep,
	isV3PermuteStepAddress
} from './handlers/v3PermuteStep';
import { handleV3DrumPadHold, isV3DrumPadHoldAddress } from './handlers/v3DrumPadHold';
import {
	handleV3TotalMix,
	handleV3TotalMixMeters,
	isV3TotalMixAddress,
	V3_TOTALMIX_METERS_ADDRESS
} from './handlers/v3TotalMix';
import { handleV3Session, isV3SessionAddress } from './handlers/v3Session';
import { handleV3Clip, isV3ClipAddress } from './handlers/v3Clip';
import {
	handleV3ClipLifecycle,
	isV3ClipLifecycleAddress
} from './handlers/v3ClipLifecycle';
import { handleV3ClipGroove, isV3ClipGrooveAddress } from './handlers/v3ClipGroove';
import {
	handleV3PlayingClips,
	isV3PlayingClipsAddress
} from './handlers/v3PlayingClips';
import {
	handleV3ClipNotesReply,
	V3_CLIP_NOTES_REPLY_ADDRESS
} from './handlers/v3ClipNotes';
import {
	handleV3ClipNotesRich,
	isV3ClipNotesRichAddress
} from './handlers/v3ClipNotesRich';
import {
	handleV3ClipSampleReply,
	V3_CLIP_SAMPLE_REPLY_ADDRESS
} from './handlers/v3ClipSample';
import {
	handleV3SimplerReplaced,
	V3_SIMPLER_REPLACED_ADDRESS
} from './handlers/v3SimplerReplaced';
import { setSampleSender } from '$lib/services/clipSampleService';
import { setNotesSender } from '$lib/services/clipNotesService';
import {
	setRichGetSender,
	setRichEditSender
} from '$lib/services/clipRichNotesService';
import {
	handleV3SelectedTrack,
	V3_SELECTED_TRACK_ADDRESS
} from './handlers/v3SelectedTrack';
import {
	handleV3SelectedScene,
	V3_SELECTED_SCENE_ADDRESS
} from './handlers/v3SelectedScene';
import { captureStore } from '$lib/stores/v6/captureStore.svelte';
import { triggeredSlotsStore } from '$lib/stores/v6/triggeredSlotsStore.svelte';

// ============================================
// Message Routing
// ============================================

/**
 * Route incoming messages to appropriate handlers
 */
function routeMessage(address: string, args: OSCArg[]): void {
	// Log routing only in debug mode and skip meter messages
	if (!address.includes('_meter_')) {
		logger.debug('Routing message', { address });
	}

	// Report WebSocket activity to freeze detector
	freezeDetector.reportWebSocketMessage();

	// Priority 1.4: v3 dispatch. The v3 state/full parser and store
	// live at handlers/v3StateFull.ts + stores/v3/normalized.svelte.ts;
	// dispatch here just fans out to those handlers.
	if (address === V3_HANDSHAKE_ACCEPT_ADDRESS) {
		handleV3HandshakeAccept(args);
		return;
	}
	if (address === V3_ERROR_ADDRESS) {
		handleV3Error(args);
		return;
	}
	if (address === V3_SURFACE_HELLO_ADDRESS) {
		handleV3SurfaceHello(args);
		return;
	}
	if (address === V3_STATE_FULL_TREE_ADDRESS) {
		handleV3StateFullTree(args);
		return;
	}
	// Protocol 3.5.0 — the surface confirming we already hold the
	// current tree, in place of re-shipping it.
	if (address === V3_STATE_FULL_UNCHANGED_ADDRESS) {
		handleV3StateFullUnchanged(args);
		return;
	}
	if (address === V3_STATE_INVALIDATE_ADDRESS) {
		handleV3StateInvalidate(args);
		return;
	}
	if (address === V3_PARAM_VALUE_ADDRESS) {
		handleV3ParamValue(args);
		return;
	}
	if (address === V3_PARAM_DISPLAY_ADDRESS) {
		handleV3ParamDisplay(args);
		return;
	}
	if (address === V3_PROPERTY_VALUE_ADDRESS) {
		handleV3PropertyValue(args);
		return;
	}
	if (isV3TrackMetadataAddress(address)) {
		handleV3TrackMetadata(address, args);
		return;
	}
	if (address === V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS) {
		handleV3HasArrangementClips(args);
		return;
	}
	if (address === V3_TRACK_FOLD_STATE_ADDRESS) {
		handleV3TrackFoldState(args);
		return;
	}
	if (isV3MasterMetadataAddress(address)) {
		handleV3MasterMetadata(address, args);
		return;
	}
	if (isV3MeterAddress(address)) {
		handleV3Meter(address, args);
		return;
	}
	if (isV3PermuteStepAddress(address)) {
		handleV3PermuteStep(address, args);
		return;
	}
	if (isV3DrumPadHoldAddress(address)) {
		handleV3DrumPadHold(address, args);
		return;
	}
	if (isV3TotalMixAddress(address)) {
		handleV3TotalMix(address, args);
		return;
	}
	if (address === V3_TOTALMIX_METERS_ADDRESS) {
		handleV3TotalMixMeters(args);
		return;
	}
	if (isV3SessionAddress(address)) {
		handleV3Session(address, args);
		return;
	}
	// Own branch rather than a case inside handleV3Clip: these two are
	// STRUCTURAL (a slot gained or lost a clip), where every address
	// that handler owns is a property of a clip that already exists.
	if (isV3ClipLifecycleAddress(address)) {
		handleV3ClipLifecycle(address, args);
		return;
	}
	if (isV3ClipAddress(address)) {
		handleV3Clip(address, args);
		return;
	}
	if (isV3ClipGrooveAddress(address)) {
		handleV3ClipGroove(address, args);
		return;
	}
	if (isV3PlayingClipsAddress(address)) {
		handleV3PlayingClips(address, args);
		return;
	}
	if (address === V3_CLIP_NOTES_REPLY_ADDRESS) {
		handleV3ClipNotesReply(args);
		return;
	}
	if (isV3ClipNotesRichAddress(address)) {
		handleV3ClipNotesRich(address, args);
		return;
	}
	if (address === V3_CLIP_SAMPLE_REPLY_ADDRESS) {
		handleV3ClipSampleReply(args);
		return;
	}
	if (address === V3_SIMPLER_REPLACED_ADDRESS) {
		handleV3SimplerReplaced(args);
		return;
	}
	if (address === V3_SELECTED_TRACK_ADDRESS) {
		handleV3SelectedTrack(args);
		return;
	}
	if (address === V3_SELECTED_SCENE_ADDRESS) {
		handleV3SelectedScene(args);
		return;
	}

	if (address === '/looping/error') {
		// Surface-side error — logged here so the source address and
		// message surface loudly in the dev console without taking the
		// rest of the maxObserver dispatch path down.
		logger.warn('Python surface error', {
			originatingAddress: String(args[0] ?? ''),
			message: String(args[1] ?? '')
		});
		return;
	}

	// Priority 2: Unrouted /looping/* — drop at debug. After ROW 10
	// cleanup, every /looping/* address either routes to an explicit
	// handler above (v3 + legacy tempo via handleV3Session) or is dead
	// wire. Log so misconfiguration surfaces loudly.
	if (address.startsWith('/looping/')) {
		logger.debug('Unrouted /looping/* address dropped', { address, args });
		return;
	}

	// Priority 2.5: Capture Messages (/capture/*)
	if (address.startsWith('/capture/')) {
		captureStore.handleMessage(address, args);
		return;
	}

	// Priority 3: Bridge Status Messages (/bridge/*)
	if (address.startsWith('/bridge/')) {
		handleBridgeMessage(address, args);
		return;
	}

	// Priority 4: System Messages
	if (address === '/init') {
		handleInitMessage(address, ...args);
		return;
	}

	// Priority 5: Legacy messages (deprecated V5 routes now ignored)
	if (
		address.startsWith('/session/') ||
		address.startsWith('/tracks/') ||
		address.startsWith('/currentTrack/') ||
		address.startsWith('/currentClip/')
	) {
		logger.debug('Ignoring V5 legacy message', { address });
		return;
	}

	// Still-supported legacy routes
	if (address.startsWith('/theme/')) {
		handleThemeMessage(address, ...args);
	} else if (address.startsWith('/cmd/')) {
		handleCommandMessage(address, ...args);
	} else if (address === '/pong') {
		handlePingPongMessage(address, ...args);
	} else {
		logger.warn('Unknown address domain', { address });
	}
}

// ============================================
// Connection Initialization
// ============================================

/**
 * Handle successful connection
 */
function onConnected(): void {
	// v3 handshake client. `onConnected` is the WebSocket's onopen
	// callback ([WebSocketConnection.ts:148-150]), so it naturally fires
	// once per successful connect — no separate reconnect signal needed.
	// The accept handler uses the store's attemptCount (>1) to detect
	// reconnects and fire `/looping/v3/state/resync`, which refreshes
	// the tree that the surface's init-push already fired before the
	// UI was listening.
	sendHandshakeHello();

	// Initialize v6 session stores after a short delay
	setTimeout(() => {
		initializeV6Session();
	}, 500);
}

// Wire up callbacks
setMessageHandler(routeMessage);
setConnectionHandler(onConnected);

// Inject the WebSocket send into the v3 handshake handler. Done at
// module load because the handler needs to emit hello/resync before
// any components render. Safe in SSR — setSender just stores the
// reference; the actual `wsSend` only touches `window` when called.
setV3HandshakeSender(wsSend);

// PR-3.5.7-impl: same wiring for the property subscription manager.
// Module-load timing matters: the first `$derived` to read
// `propertyValue(...)` may fire before any component renders, and
// it'll call `acquire(...)` which needs a working sender. Storing the
// reference is SSR-safe — it doesn't touch the WebSocket.
setPropertySender(wsSend);

// ADR-360: clipNotesService sender wiring. Same module-load timing
// requirement — a TrackClipMidiView mounting before any user
// interaction may issue notes/get during its first effect, which
// happens during component mount. Sending an OSC message is SSR-safe;
// the service stores the reference until first use.
setNotesSender((clipPath: string, requestId: string) => {
	wsSend('/looping/v3/clip/notes/get', [requestId, clipPath]);
});

// ADR-415: clipSampleService sender wiring. Same module-load timing
// requirement as the notes sender — a session-grid cell may ask for its
// slot's sample during its first effect, which runs during mount.
setSampleSender((clipPath: string, requestId: string) => {
	wsSend('/looping/v3/clip/sample/get', [requestId, clipPath]);
});

// clip-view-mirror M3/M4: rich focused-clip note channel + note edits.
// Same module-load timing requirement as the cheap-blob sender — the
// ClipEditorView may pull the rich channel during its first effect.
setRichGetSender((clipPath: string, requestId: string) => {
	wsSend('/looping/v3/clip/notes/rich/get', [requestId, clipPath]);
});
setRichEditSender((address: string, args: unknown[]) => {
	wsSend(address, args as OSCArg[]);
});

// Visibility-resume resync. When an iPad Safari tab returns from
// background, the WebSocket is often still open but frames that
// landed during suspend may have been dropped. The `bridge-resync`
// event with reason `visibility` fires from clientWatchdog on the
// suspend→visible transition. Reconnect resync is already handled
// by onConnected → sendHandshakeHello (the surface auto-emits a
// state/full on every accept).
if (typeof window !== 'undefined') {
	window.addEventListener('bridge-resync', (event: Event) => {
		const detail = (event as CustomEvent).detail;
		// Launch-queued state is edge-triggered and edge-cleared, so a
		// queue that resolved while we were away has no falling edge
		// left to arrive — it would blink forever. Every resync path
		// (reconnect and visibility-resume) passes here, so this is the
		// one place that covers both.
		triggeredSlotsStore.clear();
		if (detail?.reason === 'visibility') {
			sendStateResync();
		}
	});
}

// ============================================
// Public API (re-exports with same signatures)
// ============================================

/**
 * Connect to Live via WebSocket
 */
export function connectToLive(): Promise<void> {
	return wsConnect();
}

/**
 * Send a message over WebSocket
 */
export function send(address: string, args: OSCArg[] = []): void {
	wsSend(address, args);
}

/**
 * Check if connected to WebSocket
 */
export function isConnected(): boolean {
	return wsIsConnected();
}

/**
 * Get current connection status for UI display
 */
export function getConnectionStatus(): { connected: boolean; method: string; url?: string } {
	return wsGetConnectionStatus();
}

/**
 * Get the last listener operation for error context
 */
export function getLastListenerOperation(): string | null {
	return wsGetLastListenerOperation();
}

/**
 * Get recent messages for debugging
 */
export function getRecentMessages(
	count: number = 10
): Array<{ address: string; args: OSCArg[]; timestamp: number }> {
	return wsGetRecentMessages(count);
}

// ============================================
// V6 AbletonOSC Helper Functions
// ============================================

// ============================================
// Phase 7 PR-7b: Clip + Scene wire helpers
// ============================================
// Thin wrappers around ``send`` for the v3 clip-lifecycle and
// scene-lifecycle addresses. Centralising them here keeps the wire
// addresses out of UI call sites and makes grep-by-sender trivial.

/** Launch the clip at ``slotPath`` (empty slot → record into armed track). */
export function sendClipLaunch(slotPath: string): void {
	send('/looping/v3/clip/launch', [slotPath]);
}

/** Stop all clips on ``trackPath``. */
export function sendClipStop(trackPath: string): void {
	send('/looping/v3/clip/stop', [trackPath]);
}

/**
 * Focus the clip at ``slotPath`` — show it, never fire it.
 *
 * The session grid's long-press. Focus is what the clip view keys off,
 * and it is surface-owned state (``song.view.detail_clip``): the
 * property, rich-note and groove channels only emit for the focused
 * clip, so "show me that clip" has to be a real write rather than a
 * client-side selection. The answer comes back on the existing
 * ``/looping/v3/clip/focused`` channel, exactly as it does when the
 * focus moves inside Live.
 */
export function sendClipFocus(slotPath: string): void {
	send('/looping/v3/clip/focus', [slotPath]);
}

/**
 * Highlight the slot at ``(trackPath, sceneIndex)`` without firing it.
 *
 * Writes Live's ``song.view.highlighted_clip_slot`` — the exact property
 * `FootTriggerComponent` reads to decide what a pedal press does. That is
 * why the session grid's tap rides this rather than inferring the slot
 * from a selected track plus a selected scene: aiming the pedal is the
 * whole job, so the UI writes the property the pedal reads instead of two
 * others it happens to be derived from.
 *
 * Silent wire — the surface emits nothing directly. The highlight moving
 * changes Live's selected scene, which the existing `selected_scene`
 * listener echoes back, and that is what repaints the highlight here.
 */
export function sendSelectClip(trackPath: string, sceneIndex: number): void {
	send('/looping/v3/selected_clip', [trackPath, sceneIndex]);
}

/** Delete the clip at ``slotPath``. Empty slot → ``clip-not-present`` error. */
export function sendClipDelete(slotPath: string): void {
	send('/looping/v3/clip/delete', [slotPath]);
}

/** Duplicate clip at ``slotPath`` to ``destSlotPath`` (same track only). */
export function sendClipDuplicate(slotPath: string, destSlotPath: string): void {
	send('/looping/v3/clip/duplicate', [slotPath, destSlotPath]);
}

/**
 * Double the looped region of a MIDI clip in place — ROW 8.
 *
 * Calls ``Clip.duplicate_loop()`` on the Python ``ClipsComponent``.
 * Audio slots produce a ``clip-not-midi`` typed error; empty slots
 * produce ``clip-not-present``.
 */
export function sendClipDuplicateRegion(slotPath: string): void {
	send('/looping/v3/clip/duplicate_region', [slotPath]);
}

/** Launch every clip in the scene at ``scenePath``. */
export function sendSceneLaunch(scenePath: string): void {
	send('/looping/v3/scene/launch', [scenePath]);
}

/** Stop every clip in the scene at ``scenePath`` (per-track synthetic). */
export function sendSceneStop(scenePath: string): void {
	send('/looping/v3/scene/stop', [scenePath]);
}

/**
 * Initialize V6 session system
 */
export function initializeV6Session(): void {
	logger.info('Initializing V6 session system');

	// Clear session store for fresh start
	clearSession();

	// ROW 6.5 (2026-04-21): `/looping/query/tracks` and `/looping/query/session`
	// init-queries retired — the v3 handshake accept emits state/full and
	// `SessionComponent._emit_all_pr5d('on_accept')` seeds session fields.
	// ROW 7a: `/live/view/get/selected_track` init-query retired
	// (`SelectedTrackComponent` accept-emits selected_track).
	// ROW 7c (2026-04-21): `/live/view/get/selected_scene` + the
	// selected_scene start/stop listeners retired — the same component
	// now owns an `add_selected_scene_listener` and accept-emits
	// `/looping/v3/selected_scene`. Cold-start and reconnect both seed
	// the scene index without an UI-driven query.

	logger.info('V6 session system initialized');
}

// Note: Auto-connect moved to +layout.svelte onMount for SSR compatibility
