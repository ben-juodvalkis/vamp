/**
 * Adding an effect to the chain: the one load path the chain's palette
 * chips (ADR-523) and the browser's Effect segment share. Onto the selected
 * track's chain, or the scoped pad's, with its view opened once Live
 * reports the device. A failure is said on the error banner, the one
 * surface that outlives a closed browser.
 *
 * An effect is either a preset file picked in a Place, or a `DEVICE_PRESETS`
 * type (`preset`), which loads as its tile does: a Live device inserted by
 * name (`native:<class>`, protocol 3.12.0, the user's own default for it
 * applying) or one of the user's effects found by name in their effects
 * folder (ADR-498, `effectSources`).
 */
import { addPresetToChain } from '$lib/services/deviceMoveService';
import { activeDrumRackScope } from '$lib/services/deviceViewRouter.svelte';
import { openViewWhenLanded } from '$lib/services/effectView.svelte';
import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import { effectSource } from '$lib/services/effectSources.svelte';
import { MIDI_EFFECT_KINDS, type ItemKind } from '$lib/utils/placeKinds';
import { logger } from '$lib/utils/logger';

export interface ChainEffect {
	/** The preset's name, which Live gives the device it loads. */
	name: string;
	/** The file, or `default:<type>` for a `DEVICE_PRESETS` type. */
	fullPath: string;
	/** The Place it lives in and the path inside it (`placeArgs`), or ''. */
	source: string;
	rel: string;
	kind?: ItemKind;
	/** A `DEVICE_PRESETS` type, which says how it loads. */
	preset?: string;
}

/** A Live device inserted by name has no file: its class, else null. */
export function nativeClassOf(effect: Pick<ChainEffect, 'source'>): string | null {
	return effect.source.startsWith('native:') ? effect.source.slice('native:'.length) : null;
}

/** Whether an effect can go on the selected track: a MIDI effect only on a MIDI track. */
export function fitsSelectedTrack(effect: Pick<ChainEffect, 'kind'>): boolean {
	return !MIDI_EFFECT_KINDS.has(effect.kind ?? 'unknown') || selectedTrackStore.trackType === 'midi';
}

/**
 * Add an effect to the selected track's chain, or the scoped pad's; its
 * view opens once Live reports the device.
 */
export async function addEffectToChain(effect: ChainEffect): Promise<void> {
	const trackPath = selectedTrackStore.selectedTrackPath;
	const pad = trackHoldScope.active ? null : activeDrumRackScope();
	if (!trackPath) return reportFailure(effect.name, new Error('No track selected'));
	if (!fitsSelectedTrack(effect)) return reportFailure(effect.name, new Error('A MIDI effect goes on a MIDI track'));
	const cancelView = openViewWhenLanded({ trackPath, padPath: pad?.padPath ?? '', name: effect.name });
	try {
		// A type loads as its tile does: one of the user's effects from the
		// effects folder, by name (ADR-498); a Live device by name sends no file (3.12.0).
		const config = effect.preset ? DEVICE_PRESETS[effect.preset] : undefined;
		const found = config?.effect ? effectSource(config) : null;
		if (config?.effect && !found) throw new Error('Not in your effects folder (Settings → Places)');
		const { source, rel } = found ?? effect;
		const file = effect.preset ? (found?.presetPath || config?.presetPath || '') : nativeClassOf(effect) ? '' : effect.fullPath;
		await addPresetToChain(trackPath, pad?.padPath ?? '', file, source, rel);
	} catch (err) {
		cancelView();
		logger.error('Effect load failed', { component: 'chainEffects', err });
		reportFailure(effect.name, err);
	}
}

function reportFailure(what: string, err: unknown): void {
	v3ErrorBannerStore.show('preset-load-failed', what, err instanceof Error ? err.message : String(err));
}
