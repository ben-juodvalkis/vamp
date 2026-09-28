/**
 * Live "Save As" automation — pops Live's native Save As dialog and
 * fills in a name, then stops so the user can accept (Enter) or
 * decline (Escape).
 *
 * Live's LOM has no "Save As" verb, so the dialog is opened through Live's
 * own UI: the Looping AX Helper's `save_as_dialog` verb (ADR-439) raises
 * Live, presses its Save Live Set As menu item, waits for the panel's name
 * field to take focus and writes the name into it through Accessibility —
 * never a keystroke, never Return. That needs Accessibility trust, and the
 * trust is the helper's: this works whichever terminal started the bridge.
 * An absent or untrusted helper rejects with a named error
 * (`ax-helper-down`, `ax-untrusted`, ...) instead of the osascript copy's
 * silent no-op.
 *
 * Fired by the bridge when the Python surface reports a transport stop
 * during an `npm run ipad` session (see the /looping/v3/session/
 * save_as_request handler in enhanced-osc-bridge.js). The surface owns
 * tempo/meter (from Live); the bridge owns the wall clock + the
 * monotonic counter (persisted to disk); the helper owns Live's UI.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { helperReadiness } = require('../transport/AxHelperClient');

// Monotonic counter state lives next to bridge.log in the repo-root
// `logs/` dir (already gitignored). __dirname = interface/bridge/handlers
// → three parents up is the repo root.
const COUNTER_FILE = path.resolve(__dirname, '..', '..', '..', 'logs', 'save-as-counter.json');

// Zero-pad width for the leading counter (001, 002, …).
const COUNTER_PAD = 3;

/**
 * Read-increment-write the monotonic save counter. Starts at 1 when the
 * file is missing or corrupt. Increments on every call (i.e. every
 * prompt) — declined saves therefore leave gaps in the numbering, which
 * is the accepted trade-off for a persisted monotonic counter.
 *
 * @param {string} [filePath] override for tests.
 * @returns {number} the counter value to use for this save.
 */
function nextCounter(filePath = COUNTER_FILE) {
    let current = 0;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Number.isFinite(parsed.counter)) {
            current = parsed.counter;
        }
    } catch (err) {
        // Missing / unreadable / corrupt → start fresh at 1 below.
        const e = /** @type {NodeJS.ErrnoException} */ (err);
        if (e.code !== 'ENOENT') {
            logger.debug('Save-As counter unreadable; restarting at 1', {
                error: e.message
            });
        }
    }
    const next = current + 1;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ counter: next }), 'utf8');
    } catch (err) {
        // Non-fatal: we still return a value so the dialog is named. A
        // failed write just means the next boot may reuse this number.
        const e = /** @type {NodeJS.ErrnoException} */ (err);
        logger.warn('Save-As counter write failed', { error: e && e.message });
    }
    return next;
}

/** Local calendar date as YYYY-MM-DD. */
function todayISO(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Build the Save-As filename. Pure — exported for unit tests.
 * Shape: `NNN_YYYY-MM-DD_<tempo>bpm_<num>-<den>` e.g. `001_2026-07-06_120bpm_4-4`.
 * Tempo is rounded to a whole number; a missing/NaN tempo or meter falls
 * back to 0 rather than emitting "NaN" into a filename.
 *
 * @param {{counter: number, tempo?: number, sigNum?: number, sigDen?: number, date?: string}} parts
 */
function formatFilename({ counter, tempo, sigNum, sigDen, date = todayISO() }) {
    const counterStr = String(counter).padStart(COUNTER_PAD, '0');
    const bpm = Number.isFinite(Number(tempo)) ? Math.round(Number(tempo)) : 0;
    const num = Number.isFinite(Number(sigNum)) ? Number(sigNum) : 0;
    const den = Number.isFinite(Number(sigDen)) ? Number(sigDen) : 0;
    return `${counterStr}_${date}_${bpm}bpm_${num}-${den}`;
}

// True while a Save As run is in flight. The automation types into
// whatever field Live has focused, so a second run overlapping the first
// (transport toggled stop→play→stop fast, or the user slow to accept/decline
// the open sheet) would type into the still-open Save As field — corrupting
// the name or dismissing it. We serialize: a request that arrives mid-flight
// is dropped, not queued (a stale save-as for a take the user already moved
// past is worse than a missed one).
let saveAsInFlight = false;

/** @param {string} code @param {string} detail */
function namedError(code, detail) {
    return Object.assign(new Error(`${code}: ${detail}`), { code, detail });
}

/**
 * Pop the Save As dialog named with a counter/date/tempo/meter name.
 * Resolves with the typed filename, or rejects with the helper's named
 * error (`err.code`).
 *
 * Rejects without consuming the counter — so no gap is burned — when
 * another run is still in flight (`save-as-in-flight`) or the helper is
 * not ready (its state's code). Readiness is `connected && state ready`
 * (`helperReadiness`): the published state lags a socket drop by the
 * client's 1.5 s grace window, and a counter value spent in that window is
 * a gap in the numbering for a dialog that never opened.
 *
 * @param {{tempo?:number, sigNum?:number, sigDen?:number}} [params] from the surface.
 * @param {{state?: {state: string, detail: string}, connected?: boolean, request: Function}} [axHelper]
 *   the bridge's AxHelperClient.
 * @param {{counterFile?: string, panelPoll?: {pollMs?: number, maxMs?: number}}} [options]
 *   counter file override and panel-poll cadence, both for tests.
 */
function saveAsCurrentSet({ tempo, sigNum, sigDen } = {}, axHelper, { counterFile, panelPoll } = {}) {
    if (saveAsInFlight) {
        logger.warn('Save As already in flight; dropping overlapping request');
        return Promise.reject(namedError('save-as-in-flight', 'a Save As run is still open'));
    }
    const ready = helperReadiness(axHelper);
    if (!ready.ok) {
        return Promise.reject(namedError(ready.code, ready.detail));
    }
    // Claim the slot BEFORE consuming the counter so a dropped overlap
    // doesn't leave a numbering gap.
    saveAsInFlight = true;
    const filename = formatFilename({
        counter: nextCounter(counterFile),
        tempo,
        sigNum,
        sigDen
    });
    return Promise.resolve()
        .then(() => axHelper.request('save_as_dialog', { name: filename }))
        .then(async (result) => {
            logger.debug('Save As dialog opened', {
                filename,
                panelMs: result && result.panelMs,
                helperMs: result && result.helperMs
            });
            // The verb SUCCEEDS by leaving Live's panel up: the performer
            // accepts with Enter or declines with Escape, and the helper never
            // presses either. So the reply is not the end of the run, and
            // releasing the guard here dropped it while a modal panel was still
            // over the set — the exact overlap the comment above describes, and
            // swap audit H3. Hold it until Live has no panel.
            await waitForPanelToClose(axHelper, panelPoll);
            return filename;
        })
        .finally(() => {
            saveAsInFlight = false;
        });
}

// How long the in-flight guard may be held waiting for the performer to accept
// or decline, and how often the helper is asked. The ceiling matters more than
// the interval: a guard held forever by a panel the helper can no longer see
// would silence Save As for the rest of the session, which is worse than the
// overlap it prevents.
const PANEL_POLL_MS = 500;
const PANEL_WAIT_MAX_MS = 120000;

/**
 * Resolve once Live has no modal panel, or after `PANEL_WAIT_MAX_MS`. Never
 * rejects: a helper that cannot answer is a reason to release the guard, not to
 * fail a Save As that already happened.
 */
async function waitForPanelToClose(axHelper, { pollMs = PANEL_POLL_MS, maxMs = PANEL_WAIT_MAX_MS } = {}) {
    const until = Date.now() + maxMs;
    let first = true;
    while (Date.now() < until) {
        if (first) first = false;
        else await new Promise((resolve) => setTimeout(resolve, pollMs));
        let state;
        try {
            state = await axHelper.request('panel_state', {});
        } catch (err) {
            logger.debug('Save As: could not read the panel state; releasing the guard', {
                code: (err && err.code) || '',
                detail: (err && err.detail) || String(err)
            });
            return;
        }
        if (!state || state.open !== true) return;
    }
    logger.warn('Save As: panel still open after the wait ceiling; releasing the guard', {
        maxMs
    });
}

module.exports = {
    saveAsCurrentSet,
    waitForPanelToClose,
    formatFilename,
    nextCounter,
    todayISO
};
