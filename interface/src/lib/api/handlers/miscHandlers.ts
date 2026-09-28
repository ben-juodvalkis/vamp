/**
 * Miscellaneous Message Handlers
 *
 * Handles various message types including:
 * - Bridge status messages
 * - Command messages
 * - Init messages
 * - Ping/pong messages
 */

import { logger } from '$lib/utils/logger';
import { clearSession } from '$lib/stores/session.svelte';
import type { OSCArg } from '$lib/types/osc';

/**
 * Handle bridge status messages
 */
export function handleBridgeMessage(address: string, args: OSCArg[]): void {
	if (address === '/bridge/ax_helper') {
		import('$lib/stores/bridgeStatus.svelte').then(({ bridgeStatus }) => {
			bridgeStatus.updateAxHelper(
				String(args[0] ?? 'unknown'),
				args[1] !== undefined ? String(args[1]) : ''
			);
		});
		return;
	}
	if (address === '/bridge/features') {
		// One JSON argument: `{ <id>: { enabled, available, reason } }`
		// (general-release audit §7b), on connect, on change and every 5 s.
		import('$lib/stores/bridgeStatus.svelte').then(({ bridgeStatus }) => {
			bridgeStatus.updateFeatures(String(args[0] ?? ''));
		});
		return;
	}
	if (address === '/bridge/machine') {
		// One JSON argument: the machine's paths and the TotalMix range
		// (onboarding.plan.md §6.5), on connect and every 5 s.
		import('$lib/stores/machineStore.svelte').then(({ machineStore }) => {
			machineStore.update(String(args[0] ?? ''));
		});
		return;
	}
	if (address === '/bridge/connection_status') {
		import('$lib/stores/bridgeStatus.svelte').then(({ bridgeStatus }) => {
			bridgeStatus.updateFromBridge(String(args[0] ?? 'unknown'));
		});
	}
}

/**
 * Handle command messages (`/cmd/*`).
 *
 * Most are debug-logged. The exception is `/cmd/clip/reverse/ack` from
 * the bridge's Reverse handler (ADR-368, pressed by the AX helper since
 * ADR-439) — args are [1] on success or [0, code, detail] with a named
 * error (`ax-helper-down`, `ax-untrusted`, `ax-control-missing`, ...). We
 * forward both into the clipReverse store so the UI button can clear its
 * in-flight state and surface errors instead of silently dropping them.
 */
export function handleCommandMessage(address: string, ...args: OSCArg[]): void {
	if (address === '/cmd/clip/reverse/ack') {
		const ok = Number(args[0] ?? 0) === 1;
		const parts = [args[1], args[2]].filter((a) => a !== undefined && a !== '').map(String);
		const detail = ok || parts.length === 0 ? undefined : parts.join(': ');
		import('$lib/stores/clipReverse.svelte').then(({ clipReverseStore }) => {
			clipReverseStore.handleAck(ok, detail);
		});
		return;
	}
	logger.debug('Command message received', { address, args });
}

/**
 * Handle ping/pong messages (connection health)
 */
export function handlePingPongMessage(address: string, ...args: OSCArg[]): void {
	if (address === '/pong') {
		logger.debug('Pong received', { args });
	}
}

/**
 * Handle initialization messages from LiveAPI-v5
 */
export function handleInitMessage(address: string, ...args: OSCArg[]): void {
	logger.info('Init message received', { address, args });

	if (address === '/init') {
		logger.info('LiveAPI-v5 initializing - clearing session store');
		clearSession();
		logger.info('Session store cleared for fresh LiveAPI-v5 session');
	}
}
