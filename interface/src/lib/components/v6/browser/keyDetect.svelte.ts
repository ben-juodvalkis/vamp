/**
 * The Detect key request's state (ADR-446), shared by the browser bar's
 * Detect button (`ScaleKeyControls`) and the picker's Detected strip
 * (`ScalePicker`).
 *
 * A detection asks the surface for the key of what is launched and sets it
 * at once; the answer lands in `session.scaleDetected`. `sentAt` tells a
 * fresh answer from the last one, and a silent surface ends the
 * "Listening" state after `DETECT_TIMEOUT_MS` rather than leaving the
 * button lying. A detection is a moment, not a setting: the browser calls
 * `reset()` when it closes.
 */
import { session, clearScaleDetected } from '$lib/stores/session.svelte';
import { detectKey as sendDetectKey } from '$lib/services/sessionCommands';

/** How long "Listening…" waits for the surface's answer before giving up. */
export const DETECT_TIMEOUT_MS = 3000;

export class KeyDetect {
	private sentAt = $state(0);
	private timer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * The vote ladder rides the strip's tooltip on the Mac; the iPad has no
	 * tooltips, so a tap on the heading unfolds it under the strip.
	 */
	showReasons = $state(false);

	/** True from a request until its answer lands or the wait times out. */
	readonly pending = $derived.by(() => {
		const detected = session.scaleDetected;
		return this.sentAt > 0 && (!detected || detected.at < this.sentAt);
	});

	detect() {
		this.sentAt = Date.now();
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			this.sentAt = 0;
		}, DETECT_TIMEOUT_MS);
		sendDetectKey();
	}

	/** Stop waiting, without forgetting the answer on screen. */
	clearPending() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.sentAt = 0;
	}

	/** The browser closed: the next open starts clean. */
	reset() {
		clearScaleDetected();
		this.clearPending();
		this.showReasons = false;
	}
}
