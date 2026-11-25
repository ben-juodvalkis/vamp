/**
 * v3 selected-scene handler (ROW 7c, 2026-04-21).
 *
 * Consumes `/looping/v3/selected_scene [sceneIndex:int]` from the
 * Python Control Surface's `SelectedTrackComponent` and hands the index
 * to the session store's `handleSceneSelectionUpdate`.
 *
 * @see surface/components/SelectedTrackComponent.py
 */
import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { handleSceneSelectionUpdate } from '$lib/stores/session.svelte';

export const V3_SELECTED_SCENE_ADDRESS = '/looping/v3/selected_scene';

export function handleV3SelectedScene(args: OSCArg[]): void {
	if (args.length < 1) {
		logger.warn('v3 selected_scene missing sceneIndex', { args });
		return;
	}

	const raw = args[0];
	const sceneIndex = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
		logger.debug('v3 selected_scene ignored for non-integer value', {
			raw
		});
		return;
	}

	handleSceneSelectionUpdate(sceneIndex);
}
