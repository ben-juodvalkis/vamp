/**
 * Capture Store - State management for REC's audio capture
 *
 * Manages the recording state and UI interactions for the Vamp-Capture
 * Max for Live device on the track REC records (capture.plan.md).
 *
 * State machine: idle ↔ recording (no quantization, no beat sync).
 *
 * Uses Svelte 5 runes for reactivity.
 */

import { send } from '$lib/api/simpleClient';
import { loadCaptureIntoSimpler } from '$lib/services/clipOperations';
import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
import { logger } from '$lib/utils/logger';
import type { InputDevice } from '$lib/stores/v6/captureSettingsStore.svelte';

// ===== TYPES =====

export type CaptureState = 'idle' | 'recording';

const VALID_CAPTURE_STATES: readonly CaptureState[] = ['idle', 'recording'];

/**
 * Type guard to validate capture state values
 */
export function isCaptureState(value: unknown): value is CaptureState {
	return typeof value === 'string' && VALID_CAPTURE_STATES.includes(value as CaptureState);
}

// ===== REACTIVE STATE =====

let state = $state<CaptureState>('idle');
let lastFile = $state<string | null>(null);
let meterLevel = $state<number>(0);

/**
 * A start was sent and the device has not answered. REC paints "recording"
 * from the tap rather than the echo (~300 ms later), so a quick tap does not
 * snap back to idle; an answer of either kind — a state or an error — ends it,
 * and so does silence, so a start that reached nothing cannot latch forever.
 */
let pending = $state(false);
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
// Long enough for the bridge to load a recorder onto the track first; it
// answers a load that never lands with an error and an idle state well inside.
const PENDING_TIMEOUT_MS = 10000;

/** The device's last refusal: its code, its detail and when it came. */
export interface CaptureError {
	code: string;
	detail: string;
	at: number;
}
let lastError = $state<CaptureError | null>(null);

/**
 * The input devices Vamp for Mac offers (ADR-533), from the bridge's
 * `/capture/input/devices`: empty while the app is not running.
 */
let inputDevices = $state<InputDevice[]>([]);

function parseInputDevices(json: unknown): InputDevice[] {
	try {
		const list = JSON.parse(String(json));
		if (!Array.isArray(list)) return [];
		return list.filter(
			(d): d is InputDevice =>
				d && typeof d.uid === 'string' && typeof d.name === 'string' && Number.isInteger(d.inputs)
		);
	} catch {
		return [];
	}
}

// ===== DERIVED STATE =====

const isActive = $derived(state !== 'idle');

function settlePending(): void {
	pending = false;
	if (pendingTimer !== null) {
		clearTimeout(pendingTimer);
		pendingTimer = null;
	}
}

/** What the performer reads when the device refuses (V3ErrorBanner). */
export function captureErrorMessage(code: string, detail: string): string {
	if (code === 'no-project-folder') {
		return "Nowhere to record: this set is unsaved and Live's temp project folder wasn't found. Save the set, then record.";
	}
	if (code === 'sfrecord-missing') {
		return 'The recorder on this track is damaged. Delete Vamp-Capture from the track and record again.';
	}
	if (code === 'recorder-not-loaded') {
		return "The recorder didn't load. Check that Vamp Devices is in Live's Places (Settings → Places).";
	}
	if (code === 'no-track') {
		return 'Select a track to record.';
	}
	if (code === 'no-input-device') {
		return `The input device isn't available: ${detail}. Check that Vamp for Mac is running and the device is connected (Settings → Capture).`;
	}
	if (code === 'mic-denied') {
		return 'Vamp for Mac may not record audio. Allow it in System Settings → Privacy & Security → Microphone.';
	}
	if (code === 'no-ext-in' || code === 'no-input-channel') {
		return `No such input: ${detail}. Check Live's audio input device, and the input channel in Settings → Capture.`;
	}
	return detail ? `${code}: ${detail}` : code;
}

// ===== EVENT HANDLERS =====

/**
 * Handle incoming capture state messages from Max device
 */
function handleCaptureMessage(address: string, args: unknown[]): void {
	if (address === '/capture/input/devices') {
		inputDevices = parseInputDevices(args[0]);
		return;
	}
	logger.info('CAPTURE RX:', { address, args });
	if (address === '/capture/state') {
		const newState = args[0];
		settlePending();
		if (isCaptureState(newState)) {
			logger.info('CAPTURE STATE CHANGE:', { from: state, to: newState });
			state = newState;
		} else {
			logger.warn('Unknown capture state received', { state: newState });
		}
	} else if (address === '/capture/file') {
		const filePath = args[0];
		if (typeof filePath === 'string') {
			lastFile = filePath;
			logger.info('Capture file ready', { path: lastFile });
			// Auto-compose: prepare a MIDI track + insert a Simpler +
			// replace_sample. Fire-and-forget; errors log + surface via
			// /looping/v3/error. See clipOperations.loadCaptureIntoSimpler.
			loadCaptureIntoSimpler(filePath);
		}
	} else if (address === '/capture/error') {
		const code = typeof args[0] === 'string' && args[0] ? args[0] : 'capture-failed';
		const detail = typeof args[1] === 'string' ? args[1] : '';
		settlePending();
		lastError = { code, detail, at: Date.now() };
		logger.warn('Recorder refused', { code, detail });
		v3ErrorBannerStore.show('recorder', '', captureErrorMessage(code, detail));
	} else if (address === '/capture/meter') {
		const level = args[0];
		if (typeof level === 'number') {
			meterLevel = Math.max(0, Math.min(1, level));
			logger.debug('Capture meter updated', { level: meterLevel });
		}
	}
}

// ===== OSC SENDERS =====

/**
 * Record `trackIndex` (Live's index): what it plays, or an input on
 * `channel`. With `deviceUid` Vamp for Mac records that device (ADR-533);
 * without, the bridge loads Vamp-Capture onto the track when it has none and
 * it records Live's Ext. In.
 */
function start(trackIndex: number, source: string = 'track', channel: string = '', deviceUid: string = ''): void {
	logger.info('CAPTURE TX: start', { trackIndex, source, channel, deviceUid });
	settlePending();
	pending = true;
	pendingTimer = setTimeout(settlePending, PENDING_TIMEOUT_MS);
	send(
		'/capture/start',
		source !== 'input'
			? [trackIndex, source]
			: deviceUid
				? [trackIndex, source, channel, deviceUid]
				: [trackIndex, source, channel]
	);
}

/** Ask the bridge which input devices Vamp for Mac offers. */
function queryInputDevices(): void {
	send('/capture/input/devices/query', []);
}

function stop(): void {
	logger.info('CAPTURE TX: stop');
	settlePending();
	send('/capture/stop', []);
}

/**
 * The bridge went away. Whatever the recorder last said is stale: a take
 * whose bridge is gone never reports its idle.
 */
function deviceGone(): void {
	settlePending();
	state = 'idle';
}

// ===== PUBLIC API =====

export const captureStore = {
	get state() {
		return state;
	},
	get lastFile() {
		return lastFile;
	},
	get meterLevel() {
		return meterLevel;
	},
	get isActive() {
		return isActive;
	},
	/** A start is on its way and unanswered (see `pending`). */
	get pending() {
		return pending;
	},
	get lastError() {
		return lastError;
	},
	get inputDevices() {
		return inputDevices;
	},

	start,
	queryInputDevices,
	stop,
	deviceGone,

	// Message handler (called from simpleClient)
	handleMessage: handleCaptureMessage
};
