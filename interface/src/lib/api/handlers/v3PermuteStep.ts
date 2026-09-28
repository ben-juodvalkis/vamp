/**
 * v3 Permute step-position telemetry handler.
 *
 * Consumes `/looping/v3/permute/step` fires from `SequencerComponent`
 * (Python surface, the engine behind every Permute device) and writes them into the Permute step store. Consumers
 * (`useTinySequencer`, `useTrackData`, `sequencerStore`) read via `$derived`
 * off `permuteStepStore.get(devicePath)` — no CustomEvent re-dispatch.
 *
 * Wire (see docs/reference/wire-protocol.md §2.15):
 *   /looping/v3/permute/step [devicePath:string, kind:"mute"|"pitch", step:int]
 *
 * `step` is raw: 0..7 while running, -1 when idle/stopped. No generation
 * arg — telemetry doesn't advance generation, same as meters.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { applyPermuteStep } from '$lib/stores/v3/permuteSteps.svelte';
import type { PermuteStepKind } from '$lib/stores/v3/permuteSteps.svelte';

export const V3_PERMUTE_STEP_ADDRESS = '/looping/v3/permute/step';

export function isV3PermuteStepAddress(address: string): boolean {
	return address === V3_PERMUTE_STEP_ADDRESS;
}

export function handleV3PermuteStep(address: string, args: OSCArg[]): void {
	if (args.length < 3) {
		logger.warn('v3 permute step missing args', { address, args });
		return;
	}
	const devicePath = typeof args[0] === 'string' ? args[0] : String(args[0]);
	const kind = typeof args[1] === 'string' ? args[1] : String(args[1]);
	if (kind !== 'mute' && kind !== 'pitch') {
		logger.warn('v3 permute step unknown kind', { devicePath, kind });
		return;
	}
	const step = toNumber(args[2]);
	if (step === null) {
		logger.warn('v3 permute step non-numeric step', { devicePath, kind, args });
		return;
	}
	applyPermuteStep(devicePath, kind as PermuteStepKind, step);
}

function toNumber(v: OSCArg): number | null {
	if (typeof v === 'number') return v;
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}
