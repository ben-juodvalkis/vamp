/**
 * Capture Store - State management for Simpler-Record audio capture
 *
 * Manages the recording state and UI interactions for the
 * Simpler-Record Max for Live device.
 *
 * State machine: idle ↔ recording (no quantization, no beat sync).
 *
 * Uses Svelte 5 runes for reactivity.
 */

import { send } from '$lib/api/simpleClient';
import { loadCaptureIntoSimpler } from '$lib/services/clipOperations';
import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
import { logger } from '$lib/utils/logger';

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
const PENDING_TIMEOUT_MS = 2000;

/** The device's last refusal: its code, its detail and when it came. */
export interface CaptureError {
	code: string;
	detail: string;
	at: number;
}
let lastError = $state<CaptureError | null>(null);

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
		return 'The recorder device is damaged. Put a fresh looping-recorder on Return A.';
	}
	return detail ? `${code}: ${detail}` : code;
}

// ===== EVENT HANDLERS =====

/**
 * Handle incoming capture state messages from Max device
 */
function handleCaptureMessage(address: string, args: unknown[]): void {
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

function start(): void {
	logger.info('CAPTURE TX: start');
	settlePending();
	pending = true;
	pendingTimer = setTimeout(settlePending, PENDING_TIMEOUT_MS);
	send('/capture/start', []);
}

function stop(): void {
	logger.info('CAPTURE TX: stop');
	settlePending();
	send('/capture/stop', []);
}

/**
 * The device went away (the bridge stopped hearing its hello). Whatever it
 * last said is stale: a device deleted mid-take never sends its idle.
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

	start,
	stop,
	deviceGone,

	// Message handler (called from simpleClient)
	handleMessage: handleCaptureMessage
};
