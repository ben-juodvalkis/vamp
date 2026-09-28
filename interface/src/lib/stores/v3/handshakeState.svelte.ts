/**
 * V3 Handshake State — Phase 2 PR-2c.
 *
 * Tracks the UI-side lifecycle of the v3 protocol handshake per
 * [04 §8](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#8-handshake).
 *
 * ## Lifecycle
 *
 * ```
 *    idle ──send hello──▶ pending ──accept──▶ accepted
 *                             │                  │
 *                             └──error──▶ failed │
 *                                                ▼
 *                                         (WS disconnect)
 *                                                │
 *                                                └──reconnect──▶ pending (attempt++)
 * ```
 *
 * `attemptCount` starts at 0. Every `sendHandshakeHello` bumps it by 1
 * before transitioning to `pending`. The reconnect path is "accepted
 * once before, now re-helloing" — detected by `attemptCount > 1` at
 * accept time. When that's true, the accept handler also fires
 * `/looping/v3/state/resync` so the UI gets a fresh state/full, because
 * the surface's init-driven state/full only fires on Live load, not on
 * bridge reconnect ([LoopingSurface.py §init-push]).
 *
 * ## No mid-session fallback
 *
 * Per [04 §8.3], once accept returns 3.0.0 the session is v3 for its
 * lifetime. `failed` is a terminal state — UI surfaces `errorDetail` to
 * the user rather than silently falling back to v2. The next fresh
 * WS-connect cycles back to `idle` → `pending`.
 */

/** Phases of the handshake. */
export type HandshakePhase = 'idle' | 'pending' | 'accepted' | 'failed';

let phase = $state<HandshakePhase>('idle');
let errorDetail = $state('');
let attemptCount = $state(0);
/** Protocol version from the accept reply. Empty until accepted. */
let negotiatedVersion = $state('');

/**
 * Mark that a hello is going out. Bumps attempt and flips to pending.
 * Returns the new attempt count — the caller uses it to decide whether
 * this is a fresh connect (1) or a reconnect (>1).
 */
export function markHelloSent(): number {
	attemptCount += 1;
	phase = 'pending';
	errorDetail = '';
	return attemptCount;
}

/** Accept arrived. Promote to accepted and record the version. */
export function markAccepted(version: string): void {
	phase = 'accepted';
	negotiatedVersion = version;
	errorDetail = '';
}

/** Error arrived (version-mismatch or malformed). Terminal until next
 *  fresh connect triggers a new hello. */
export function markFailed(detail: string): void {
	phase = 'failed';
	errorDetail = detail;
}

/** Reset to `idle` on detected surface restart per [04 §8.6]. The
 *  subsequent `sendHandshakeHello()` will bump `attemptCount` and
 *  move the phase back through `pending` → `accepted`. Preserves
 *  `attemptCount` deliberately (it's telemetry — the cumulative
 *  number of hellos this UI has sent across surface lifetimes is
 *  the more useful signal than a per-surface counter). */
export function resetForSurfaceRestart(): void {
	phase = 'idle';
	errorDetail = '';
	negotiatedVersion = '';
}

/** Test-only: full reset. */
export function _resetForTests(): void {
	phase = 'idle';
	errorDetail = '';
	attemptCount = 0;
	negotiatedVersion = '';
}

/** Reactive read-only view. Components reading this re-render on phase
 *  changes (e.g. a banner showing `errorDetail` when phase === 'failed'). */
export const handshakeState = {
	get phase() {
		return phase;
	},
	get errorDetail() {
		return errorDetail;
	},
	get attemptCount() {
		return attemptCount;
	},
	get negotiatedVersion() {
		return negotiatedVersion;
	}
};
