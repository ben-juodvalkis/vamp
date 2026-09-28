/**
 * V3 Surface-Hello handler — PR-3c (v2) surface-restart detection.
 *
 * Consumes `/looping/v3/surface/hello [instanceId, protocolVersion,
 * timestamp]` per [04 §8.6](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#86-surface-instance-advertisement-surfacehello).
 *
 * ## Why this exists
 *
 * Live 12.3.7 deterministically tears down and reconstructs the entire
 * Python Control Surface on File → Open. The bridge's WebSocket to the
 * UI stays alive across this because the bridge is a separate Node
 * process, so the UI has no wire signal that the surface underneath
 * has been replaced. Without a signal, `v3Store.sessionId` and
 * `v3Store.generation` stay set to the previous session's values, and
 * writes either no-op against a stale session context or land on
 * positionally-matching but semantically-different params in the new
 * set.
 *
 * Found during streak session 1 (2026-04-15 scenario 7); see the
 * 2026-04-15 PR-3c revision entry in implementation-log.md.
 *
 * ## Handler contract
 *
 * 1. **Cold first emission** (`surfaceInstanceId === ''` AND the store
 *    has no active handshake state — `sessionId === ''` and
 *    `generation === UNSET_GENERATION`): record the advertised
 *    instanceId, log, no-op. The handshake-on-connect path handles
 *    cold bring-up.
 * 2. **First emission *after* an active handshake** (baseline empty
 *    but `sessionId !== ''` or `generation !== UNSET_GENERATION`):
 *    the prior surface's hello was missed (UI mounted after it fired,
 *    or was lost on the wire). Any hello while we already hold a
 *    session means the surface underneath has been replaced — treat
 *    it as a restart. Observed 2026-04-23 with a File → Open after
 *    page reload: the new surface's hello landed, matched the empty
 *    baseline, and the UI silently kept the previous set's tracks
 *    and stale `generation`.
 * 3. **Subsequent emission with same instanceId**: log-and-no-op. This
 *    covers any future case where the surface re-emits (it doesn't
 *    today, but the handler's idempotence guarantee is load-bearing
 *    for the §8.6 contract).
 * 4. **Subsequent emission with different instanceId**: surface
 *    restart. Reset the normalized store (tree + generation +
 *    sessionId), reset handshakeState phase to `idle`, record the new
 *    instanceId, and fire `sendHandshakeHello()`. The surface's
 *    `accept` reply then drives the state/full bundle per [04 §8.5].
 *
 * ## What this deliberately doesn't do
 *
 * - Doesn't validate `protocolVersion` against
 *   `UI_SUPPORTED_VERSIONS`. The version field is informational — the
 *   handshake is still the authoritative version negotiation, and
 *   pre-rejecting here would duplicate logic without new guarantees.
 *   A future UI that wants to surface "this surface is too new/old"
 *   diagnostics can add that branch here.
 * - Doesn't act on the `timestamp` arg. It's diagnostic only per
 *   [04 §8.6]; logged for correlation but not used for any decision.
 * - Doesn't drain in-flight state/full chunks on restart. The v3
 *   state/full handler's reassembly buffer is already module-local
 *   and keyed by the current `chunkGen`; the next `begin` (from the
 *   post-restart `reason="accept"` bundle) replaces it cleanly.
 */

import { logger } from '$lib/utils/logger';
import { toNumber, toString } from './oscTypeHelpers';
import {
	resetForSurfaceRestart,
	setSurfaceInstanceId,
	UNSET_GENERATION,
	v3Store
} from '$lib/stores/v3/normalized.svelte';
import { resetForSurfaceRestart as resetHandshakeForSurfaceRestart } from '$lib/stores/v3/handshakeState.svelte';
import { resetAll as resetPropertySubscriptions } from '$lib/stores/v3/propertySubscriptions.svelte';
import { sendHandshakeHello } from './v3Handshake';
import { clearScaleDetected } from '$lib/stores/session.svelte';
import type { OSCArg } from '$lib/types/osc';

// ============================================
// Address constant
// ============================================

export const V3_SURFACE_HELLO_ADDRESS = '/looping/v3/surface/hello';

// ============================================
// Handler
// ============================================

/**
 * Handle `/looping/v3/surface/hello [instanceId, protocolVersion, timestamp]`.
 *
 * See module-level comment for branching semantics.
 */
export function handleV3SurfaceHello(args: OSCArg[]): void {
	if (args.length < 3) {
		logger.warn('v3 surface/hello: short payload', { length: args.length });
		return;
	}

	const instanceId = toString(args[0]);
	const protocolVersion = toString(args[1]);
	const timestamp = toNumber(args[2]);

	if (!instanceId) {
		// Empty instanceId is meaningless — a surface-side bug we
		// shouldn't paper over. Log and drop.
		logger.warn('v3 surface/hello: empty instanceId', { protocolVersion });
		return;
	}

	const previous = v3Store.surfaceInstanceId;
	const hasActiveSession =
		v3Store.sessionId !== '' || v3Store.generation !== UNSET_GENERATION;

	if (previous === '' && !hasActiveSession) {
		// Cold first emission. Record baseline; the natural
		// handshake-on-connect path (simpleClient.onConnected →
		// sendHandshakeHello) handles cold bring-up from here.
		setSurfaceInstanceId(instanceId);
		logger.info('v3 surface/hello: initial surface instance recorded', {
			instanceId,
			protocolVersion,
			timestamp
		});
		return;
	}

	if (previous === instanceId) {
		// Idempotent: same surface re-emitted. Today the surface
		// one-shots emission so this branch is unreachable from the
		// current Python code, but the §8.6 contract requires the
		// handler to tolerate it — otherwise a future re-fire (e.g.
		// for diagnostic reasons) would bounce the UI through a
		// spurious restart.
		logger.debug('v3 surface/hello: same instanceId, no-op', {
			instanceId,
			protocolVersion,
			timestamp
		});
		return;
	}

	// Surface restart: either a different instanceId or an empty
	// baseline paired with active session state (prior surface's hello
	// was missed). Reset per-surface state and re-handshake. Order:
	// update instanceId *first* so any reactive subscriber that fires
	// on the store resets sees the new value already recorded; then
	// clear the tree/session; then drop the handshake phase; then fire
	// the new hello.
	logger.warn('v3 surface/hello: surface restart detected — re-handshaking', {
		previousInstanceId: previous,
		newInstanceId: instanceId,
		missedBaseline: previous === '',
		protocolVersion,
		timestamp
	});

	setSurfaceInstanceId(instanceId);
	resetForSurfaceRestart();
	// ADR-446: a key detection belongs to the set that was playing; a new
	// surface (a set load, a Live restart) starts with none.
	clearScaleDetected();
	resetHandshakeForSurfaceRestart();
	resetPropertySubscriptions();
	sendHandshakeHello();
}
