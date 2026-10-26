/**
 * The effects added most recently (ADR-484, user 2026-10-26): the effect
 * presets loaded from the browser, newest first, so the chain overview's
 * Recent column can put one on a chain again in one tap. It shows the first
 * that fit the chain (`recentForChain`), up to eight, as many as the block
 * has room for (`chainDrop.recentLayout`): no MIDI effect off a MIDI track,
 * nothing the chain already holds; the list keeps more than that so the
 * column stays full after the filter.
 *
 * Shared across tracks: one just used on one track is ready on the next.
 * Kept in this browser's localStorage, a per-viewer convenience, and
 * followed across its tabs; a private window or blocked storage starts
 * empty every time.
 *
 * `addEffectToChain` is the one load path, the browser's Effect segment
 * and the column alike: onto the selected track's chain, or the scoped
 * pad's, with its view opened once Live reports the device.
 */
import { addPresetToChain } from '$lib/services/deviceMoveService';
import { activeDrumRackScope } from '$lib/services/deviceViewRouter.svelte';
import { openViewWhenLanded } from '$lib/services/effectView.svelte';
import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
import { MIDI_EFFECT_KINDS, type ItemKind } from '$lib/utils/placeKinds';
import { logger } from '$lib/utils/logger';

export interface RecentEffect {
	/** The preset's name, which Live gives the device it loads. */
	name: string;
	/** The file. */
	fullPath: string;
	/** The Place it lives in and the path inside it (`placeArgs`), or ''. */
	source: string;
	rel: string;
	kind?: ItemKind;
}

/** How many the list keeps, and the most the column shows. */
export const RECENT_EFFECTS_MAX = 12;
export const RECENT_EFFECTS_SHOWN = 8;
const STORAGE_KEY = 'vamp.recentEffects';

function readStored(): RecentEffect[] {
	try {
		const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
		const list = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.filter((r) => r && typeof r.fullPath === 'string' && typeof r.name === 'string').slice(0, RECENT_EFFECTS_MAX) : [];
	} catch {
		return [];
	}
}

let recent = $state<RecentEffect[]>(readStored());

// Another tab (or window) adding an effect: follow its list.
if (typeof window !== 'undefined') {
	window.addEventListener('storage', (e) => {
		if (e.key === STORAGE_KEY) recent = readStored();
	});
}

/** The recents, newest first. Reactive. */
export function recentEffects(): readonly RecentEffect[] {
	return recent;
}

/** Note an effect the browser added: to the front, once. */
export function recordRecentEffect(effect: RecentEffect): void {
	recent = [effect, ...recent.filter((r) => r.fullPath !== effect.fullPath)].slice(0, RECENT_EFFECTS_MAX);
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(recent));
	} catch {
		// Storage blocked: the list lives for this page only.
	}
}

/**
 * The recents the column shows for a chain whose devices are named
 * `loaded`: the first `max` that fit the selected track and that the chain
 * does not already hold (Live names a loaded preset's device after it).
 */
export function recentForChain(loaded: readonly string[], max: number = RECENT_EFFECTS_SHOWN): RecentEffect[] {
	const have = new Set(loaded);
	return recent.filter((r) => fitsSelectedTrack(r) && !have.has(r.name)).slice(0, max);
}

/** Whether an effect can go on the selected track: a MIDI effect only on a MIDI track. */
export function fitsSelectedTrack(effect: Pick<RecentEffect, 'kind'>): boolean {
	return !MIDI_EFFECT_KINDS.has(effect.kind ?? 'unknown') || selectedTrackStore.trackType === 'midi';
}

/**
 * Add an effect preset to the selected track's chain, or the scoped pad's;
 * its view opens once Live reports the device. A failure is said on the
 * error banner, the one surface that outlives a closed browser.
 */
export async function addEffectToChain(effect: RecentEffect): Promise<void> {
	const trackPath = selectedTrackStore.selectedTrackPath;
	const pad = trackHoldScope.active ? null : activeDrumRackScope();
	if (!trackPath) return reportFailure(effect.name, new Error('No track selected'));
	if (!fitsSelectedTrack(effect)) return reportFailure(effect.name, new Error('A MIDI effect goes on a MIDI track'));
	const cancelView = openViewWhenLanded({ trackPath, padPath: pad?.padPath ?? '', name: effect.name });
	try {
		await addPresetToChain(trackPath, pad?.padPath ?? '', effect.fullPath, effect.source, effect.rel);
	} catch (err) {
		cancelView();
		logger.error('Effect load failed', { component: 'recentEffects', err });
		reportFailure(effect.name, err);
	}
}

function reportFailure(what: string, err: unknown): void {
	v3ErrorBannerStore.show('preset-load-failed', what, err instanceof Error ? err.message : String(err));
}

/** Tests: forget every recent. */
export function _resetRecentEffectsForTests(): void {
	recent = [];
}
