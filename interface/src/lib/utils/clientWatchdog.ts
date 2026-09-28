/**
 * Client-side watchdog — browser-side counterpart to the bridge's
 * healthMonitor. Reports three classes of event to the bridge over
 * the same WebSocket, where they land in `bridge.log`:
 *
 *   1. `visibility-change`   — the tab went background/foreground.
 *      iPad Safari aggressively throttles or suspends background
 *      tabs, which is the canonical "worked for ~1 minute then
 *      froze" scenario. Without this, a socket that looks
 *      ESTABLISHED in lsof is indistinguishable from a live one.
 *
 *   2. `raf-stall`           — requestAnimationFrame didn't fire for
 *      longer than `RAF_STALL_MS`. Safari pauses rAF on suspend and
 *      also during heavy GC — if paints stop, meters look frozen
 *      even if WS frames are arriving.
 *
 *   3. `ws-reconnect`        — the WebSocket closed and reopened.
 *      Correlates iPad flakiness with link-local route churn.
 *
 *   4. `uncaught-error` /   — anything that escaped to the window.
 *      `unhandled-rejection`  These matter far more than they look:
 *      an error thrown inside a Svelte 5 effect escapes
 *      `Batch.process()`, and the scheduler's `finally` restores
 *      `is_flushing` but not `queued_root_effects` / `current_batch`
 *      / the root effect's CLEAN bit. Every later `schedule_effect`
 *      then bails as "already scheduled" against a queue nothing
 *      will ever drain — reactivity is dead app-wide until reload,
 *      while DOM event handlers keep firing. One stack captured here
 *      names the component that killed the session.
 *
 *   5. `reactivity-stall`   — the proof, independent of any error:
 *      a plain `setInterval` ticks a counter, and an `$effect` in
 *      `+layout.svelte` echoes it back. Divergence means the effect
 *      scheduler stopped flushing while the event loop kept running.
 *      That distinguishes "the wire went quiet" from "the UI stopped
 *      re-rendering", which look identical from the driver's seat.
 *
 * Silent when healthy. Events are fire-once per state transition
 * (not polled at a rate) so the bridge log stays readable.
 *
 * Wire: sends OSC-shaped messages with address `/bridge/client_log`
 * and args `[level, event, detail]` — the bridge's WebSocketServer
 * intercepts that address and logs instead of routing.
 */

import { send } from '$lib/api/simpleClient';

// requestAnimationFrame intervals should land well under 100 ms on a
// healthy device (60 fps = ~16 ms). 1000 ms means paints genuinely
// stopped — tab suspend, major GC pause, or main thread starvation.
const RAF_STALL_MS = 1000;

// Don't spam. Once a stall is reported, wait for rAF to recover
// before reporting another.
let rafStallActive = false;
let lastRafTs = 0;
let rafHandle: number | null = null;

let visibilityHandler: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;
let offlineHandler: (() => void) | null = null;
let errorHandler: ((e: ErrorEvent) => void) | null = null;
let rejectionHandler: ((e: PromiseRejectionEvent) => void) | null = null;

// Stacks are the whole point of capturing these, but a runaway one
// shouldn't flood the OSC wire or bridge.log.
const MAX_STACK_CHARS = 2000;

/** Last error that escaped to the window, kept so a later
 *  `reactivity-stall` can name its likely cause. */
let lastUncaughtError: { message: string; stack: string; ts: number } | null = null;

// --- Reactivity stall detection -------------------------------------
//
// `schedulerSeq` is bumped by a plain setInterval (always runs while
// the event loop is alive). `reactiveSeq` is echoed back by an
// `$effect` in `+layout.svelte`. Comparing the two — rather than
// timestamps — makes this immune to background-tab timer throttling:
// if the interval is throttled, neither counter advances and the gap
// stays zero. A persistent gap means effects specifically stopped
// flushing.
const REACTIVITY_STALL_TICKS = 3;
let schedulerSeq = 0;
let reactiveSeq = 0;
let reactivityStallActive = false;
let reactivityTimer: ReturnType<typeof setInterval> | null = null;

function describeError(value: unknown): { message: string; stack: string } {
    if (value instanceof Error) {
        return {
            message: `${value.name}: ${value.message}`,
            stack: (value.stack ?? '').slice(0, MAX_STACK_CHARS)
        };
    }
    try {
        return { message: String(value), stack: '' };
    } catch {
        return { message: '<unstringifiable>', stack: '' };
    }
}

/**
 * Bump the scheduler counter. Called from a plain `setInterval` in
 * `+layout.svelte`, which also writes the new value into a `$state`
 * so the probe effect has something to depend on.
 */
export function noteSchedulerTick(): number {
    schedulerSeq += 1;
    return schedulerSeq;
}

/**
 * Echo the scheduler counter back from inside the Svelte effect tree.
 * Called by the `$effect` in `+layout.svelte`; that effect lives in
 * the app's own component tree, so it wedges exactly when the app does.
 */
export function noteReactiveTick(): void {
    reactiveSeq = schedulerSeq;
    if (reactivityStallActive) {
        reactivityStallActive = false;
        report('warn', 'reactivity-recovered', { seq: reactiveSeq });
    }
}

function report(
    level: 'info' | 'warn' | 'error',
    event: string,
    detail?: unknown
): void {
    try {
        const detailStr = detail === undefined
            ? ''
            : typeof detail === 'string' ? detail : JSON.stringify(detail);
        send('/bridge/client_log', [level, event, detailStr]);
    } catch {
        // Watchdog failures must never break the app. If the socket
        // isn't up, the browser console still has the event via the
        // `console.warn` below.
    }
    if (level === 'error') console.error(`[watchdog] ${event}`, detail);
    else if (level === 'warn') console.warn(`[watchdog] ${event}`, detail);
}

function rafTick(ts: number): void {
    if (lastRafTs !== 0) {
        const gap = ts - lastRafTs;
        if (gap > RAF_STALL_MS) {
            if (!rafStallActive) {
                rafStallActive = true;
                report('warn', 'raf-stall', {
                    gapMs: Math.round(gap),
                    threshold: RAF_STALL_MS,
                    visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown'
                });
            }
        } else if (rafStallActive) {
            rafStallActive = false;
            report('warn', 'raf-recovered', { gapMs: Math.round(gap) });
        }
    }
    lastRafTs = ts;
    rafHandle = requestAnimationFrame(rafTick);
}

/**
 * Start the watchdog. Safe to call multiple times — idempotent.
 * No-op on the server (SSR).
 */
export function startClientWatchdog(): void {
    if (typeof window === 'undefined') return;
    if (rafHandle !== null) return; // already running

    // Visibility. One report on transition, with the new state.
    // On resume to `visible`, fire a bridge-resync event so services
    // can pull fresh state — mirrors what the connection manager
    // does on reconnect. A suspended iPad Safari tab may have missed
    // listener fires; without resync the UI would stay stale until
    // the next real user-initiated edit.
    visibilityHandler = () => {
        report('warn', 'visibility-change', {
            state: document.visibilityState,
            hidden: document.hidden
        });
        if (document.visibilityState === 'visible') {
            window.dispatchEvent(new CustomEvent('bridge-resync', {
                detail: { reason: 'visibility' }
            }));
        }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    // Online/offline — NetworkInformation isn't reliable on iOS so
    // the navigator events are the best signal we get.
    onlineHandler = () => report('warn', 'network-online');
    offlineHandler = () => report('warn', 'network-offline');
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);

    // Uncaught errors. Captured rather than merely logged because a
    // single throw inside a Svelte effect permanently wedges the
    // effect scheduler (see header note 4) — this stack is the only
    // record of which component did it.
    errorHandler = (event: ErrorEvent) => {
        const { message, stack } = describeError(event.error ?? event.message);
        lastUncaughtError = { message, stack, ts: Date.now() };
        report('error', 'uncaught-error', {
            message,
            stack,
            source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined
        });
    };
    window.addEventListener('error', errorHandler);

    rejectionHandler = (event: PromiseRejectionEvent) => {
        const { message, stack } = describeError(event.reason);
        lastUncaughtError = { message, stack, ts: Date.now() };
        report('error', 'unhandled-rejection', { message, stack });
    };
    window.addEventListener('unhandledrejection', rejectionHandler);

    // Reactivity stall check. Compares counters, not clocks, so a
    // throttled background tab can't produce a false positive.
    schedulerSeq = 0;
    reactiveSeq = 0;
    reactivityStallActive = false;
    reactivityTimer = setInterval(() => {
        const gap = schedulerSeq - reactiveSeq;
        if (gap >= REACTIVITY_STALL_TICKS && !reactivityStallActive) {
            reactivityStallActive = true;
            report('error', 'reactivity-stall', {
                missedTicks: gap,
                schedulerSeq,
                reactiveSeq,
                visibility: document.visibilityState,
                // The effect scheduler wedges on an uncaught throw, so
                // the last one is the prime suspect even if it landed
                // several seconds earlier.
                lastError: lastUncaughtError
            });
        }
    }, 1000);

    // rAF heartbeat.
    lastRafTs = 0;
    rafStallActive = false;
    rafHandle = requestAnimationFrame(rafTick);

    report('info', 'watchdog-started', {
        ua: navigator.userAgent,
        visibility: document.visibilityState
    });
}

export function stopClientWatchdog(): void {
    if (typeof window === 'undefined') return;
    if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
    }
    if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
    }
    if (onlineHandler) {
        window.removeEventListener('online', onlineHandler);
        onlineHandler = null;
    }
    if (offlineHandler) {
        window.removeEventListener('offline', offlineHandler);
        offlineHandler = null;
    }
    if (errorHandler) {
        window.removeEventListener('error', errorHandler);
        errorHandler = null;
    }
    if (rejectionHandler) {
        window.removeEventListener('unhandledrejection', rejectionHandler);
        rejectionHandler = null;
    }
    if (reactivityTimer !== null) {
        clearInterval(reactivityTimer);
        reactivityTimer = null;
    }
}

/** Report a WebSocket reconnect. Call from the connection manager. */
export function reportWsReconnect(detail?: unknown): void {
    report('warn', 'ws-reconnect', detail);
}

/** Report an error caught by a `<svelte:boundary>`.
 *
 *  A contained error never reaches `window.onerror`, so it would
 *  otherwise be invisible in `bridge.log` — and containment is exactly
 *  when we most want the record, because the app keeps running and
 *  nobody reports a bug. Carries the boundary's own name so the log
 *  says which subtree degraded. */
export function reportBoundaryError(boundary: string, error: unknown): void {
    const err = error as { message?: string; stack?: string } | null;
    report('error', 'boundary-error', {
        boundary,
        message: err?.message ?? String(error),
        stack: err?.stack ?? ''
    });
}
