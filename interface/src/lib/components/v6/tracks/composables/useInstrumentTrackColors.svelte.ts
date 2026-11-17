/**
 * useInstrumentTrackColors — every track wears its instrument's colour
 * (ADR-545). Mounted once, by the root layout.
 *
 * Watches each track's instrument TYPE, the one the strip's device band
 * reads (`trackDeviceGlance`), and colours a track when:
 * - the app loaded an instrument onto it (`takePendingInstrumentColor`),
 *   once the device is in the tree, whether or not the type changed;
 * - its type changed while the app watched, a load in Live included, or a
 *   new track arrived holding one.
 * The first tree is the baseline: opening a set recolours nothing. A tree
 * that empties (a reconnect) keeps the baseline, so the same set coming
 * back recolours nothing either.
 */

import { untrack } from 'svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import type { InstrumentType } from '$lib/services/instrumentService';
import { applyInstrumentColor, takePendingInstrumentColor } from '$lib/services/trackColoring';
import { trackDeviceGlance } from './useTrackDevice.svelte';

/** One pass over the tracks: what to colour. Pure but for the pending marks; exported for tests. */
export function instrumentColorPass(
	seen: Map<string, InstrumentType | null>,
	tracks: ReadonlyArray<readonly [string, InstrumentType | null]>,
	baselined: boolean
): string[] {
	const recolour: string[] = [];
	for (const [path, type] of tracks) {
		const had = seen.has(path);
		const prev = seen.get(path) ?? null;
		seen.set(path, type);
		if (type === null) continue;
		const pending = takePendingInstrumentColor(path);
		if (!baselined) continue;
		if (pending || !had || prev !== type) recolour.push(path);
	}
	return recolour;
}

export function useInstrumentTrackColors(): void {
	const seen = new Map<string, InstrumentType | null>();
	let baselined = false;

	// A string, so a param moving on some rack does not re-run the pass.
	const key = $derived.by(() =>
		[...v3Store.tracks.keys()]
			.filter((path) => path.startsWith('tracks/'))
			.map((path) => `${path}=${trackDeviceGlance(path).instrumentType ?? ''}`)
			.join('|')
	);

	$effect(() => {
		const current = key;
		untrack(() => {
			if (!current) return;
			const tracks = current.split('|').map((entry) => {
				const [path, type] = entry.split('=');
				return [path, (type || null) as InstrumentType | null] as const;
			});
			const types = new Map(tracks);
			for (const path of instrumentColorPass(seen, tracks, baselined)) {
				applyInstrumentColor(path, types.get(path) ?? null);
			}
			baselined = true;
		});
	});
}
