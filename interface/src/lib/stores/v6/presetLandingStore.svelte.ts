/**
 * Preset load state, as the track strip sees it.
 *
 * The browser closes **optimistically** — the moment a pick commits, not when
 * Live confirms it (see `DrillDownBrowser`'s `handlePostLoad`). That hands the
 * screen back immediately, but it also takes away the browser's own reveal,
 * which was the only place a random folder pick ever announced what it had
 * chosen (the folder screen renders no preset tile to light up).
 *
 * This store is where that answer moved to, in two phases:
 *
 *   - **pending** — the pick is committed and in flight. The strip wears the
 *     app's loading sweep and shows the incoming preset name provisionally, so
 *     "which track is this landing on, and what is it" is answerable the
 *     instant the browser disappears rather than a round trip later.
 *   - **landed** — the prepare ack came back. The strip pulses and its real
 *     name arrives from Live a beat afterwards.
 *
 * Pending is only reachable when the target track **already exists** — a
 * pre-prepped landing pad, or replace mode's pinned track. A load that creates
 * its track (the Audio vendor, prep-skipped) has no strip to mark until the ack
 * names one, so it goes straight to landed. That is honest rather than a gap:
 * there is genuinely nothing on screen to attach "loading" to yet.
 *
 * **One entry at a time.** A load targets exactly one track, and a newer load
 * supersedes an older one rather than stacking: two strips lit at once would say
 * two things are arriving, which is never true here. It also means the ack is
 * free to land on a *different* track than the one marked pending — Python owns
 * the reuse-vs-create decision and its ack carries the real index — and the
 * entry simply moves there.
 */

/**
 * How long a strip stays marked after the load lands. Long enough to survive the
 * gap between the ack (which fires the mark) and the track's renamed/recolored
 * state echoing back from Live, so the pulse is still running when the name it
 * is pointing at actually appears.
 */
export const LANDING_PULSE_MS = 1200;

/**
 * Safety net on the pending phase. Nothing routinely relies on this — a load
 * resolves into `markLanded` or is cleared by its caller's error path — but a
 * dropped ack must not strand a strip in a loading state forever. Sits above
 * `PREPARE_TIMEOUT_MS` (8s) so the real timeout always reports first, through
 * the error banner, and this only ever catches what escapes it.
 */
export const PENDING_MAX_MS = 10000;

export type LandingPhase = 'pending' | 'landed';

export interface Landing {
	trackPath: string;
	/** Preset the load is bringing in. Shown provisionally while pending. */
	presetName: string;
	phase: LandingPhase;
}

let _entry = $state<Landing | null>(null);
let _timeout: ReturnType<typeof setTimeout> | null = null;

function arm(ms: number): void {
	if (_timeout !== null) clearTimeout(_timeout);
	_timeout = setTimeout(() => {
		_entry = null;
		_timeout = null;
	}, ms);
}

/** A pick has committed and is in flight toward `trackPath`. */
function markPending(trackPath: string, presetName: string): void {
	if (!trackPath.startsWith('tracks/')) return;
	_entry = { trackPath, presetName, phase: 'pending' };
	arm(PENDING_MAX_MS);
}

/**
 * The load landed on `trackPath` (the acked track, which may not be the one
 * marked pending). Carries the pending entry's preset name forward when this
 * resolves one, so the strip doesn't blank the name at the handover.
 */
function markLanded(trackPath: string): void {
	if (!trackPath.startsWith('tracks/')) return;
	_entry = {
		trackPath,
		presetName: _entry?.presetName ?? '',
		phase: 'landed'
	};
	arm(LANDING_PULSE_MS);
}

/** Retire whatever is showing — the load failed, or nothing is arriving. */
function clear(): void {
	_entry = null;
	if (_timeout !== null) {
		clearTimeout(_timeout);
		_timeout = null;
	}
}

export const presetLandingStore = {
	/** The single in-flight/just-finished load, or `null`. */
	get entry() {
		return _entry;
	},
	/** Track path wearing the landing pulse, or `null`. */
	get landedTrackPath() {
		return _entry?.phase === 'landed' ? _entry.trackPath : null;
	},
	/** Track path currently awaiting a load, or `null`. */
	get pendingTrackPath() {
		return _entry?.phase === 'pending' ? _entry.trackPath : null;
	},
	/** Provisional name to show on the pending strip, or `null`. */
	get pendingName() {
		return _entry?.phase === 'pending' ? _entry.presetName || null : null;
	},
	markPending,
	markLanded,
	clear
};
