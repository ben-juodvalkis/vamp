/**
 * Where a recorded preset sits in its Place's folder (ADR-439 phase 2; the
 * Places catalog since the browser-places cutover, 2026-09-24).
 *
 * Folder-next steps from `TrackRecord.preset` — the absolute path the last
 * `prepare_for_preset` load recorded — to its neighbor in its Place's catalog,
 * in catalog folder order (baked A→Z, the order the browser shows).
 *
 * **Read through the alias map first.** A record from before the cutover names
 * a file in the old vendor tree (`Instruments/<Vendor>/<Type>/…`), still in
 * saved sets; the Places index's alias rules (the copy's record, old path →
 * new path) turn it into the Place's copy. Then the Place whose folder holds
 * the path, then the leaf whose items hold that exact `fullPath` — a
 * depth-capped leaf spans the subfolders it merged, exactly as the browser's
 * grid does. A path no Place holds answers null.
 *
 * The list keeps only what a step can load: an installed plug-in's preset, a
 * Live preset that is an instrument or a kit — never a greyed tile.
 *
 * One adapter per Place is kept for the session, so a Place's catalog is
 * fetched and parsed once, not once per step.
 */

import { PlacesAdapter, getPlacesIndex, placeVendorId } from './adapters/placesAdapter';
import type { Preset } from './adapters/browserAdapter';
import { aliasPresetPath } from '$lib/utils/presetPath';
import { groupOfKind, loadsAsInstrument } from '$lib/utils/placeKinds';

export interface PresetSiblings {
	/** The Place's rail id (`place:drum`) — the button a replace opens. */
	typeId: string;
	presets: Preset[];
	index: number;
	/**
	 * Folder segments from the Place's root to the leaf holding the preset — the
	 * browser's own `currentPath`, so a replace can open ON the track's patch
	 * rather than wherever the last browse ended (ADR-441). `[]` for a preset
	 * sitting at the Place's root.
	 */
	path: string[];
}

const placeAdapters = new Map<string, PlacesAdapter>();

function placeAdapterFor(placeId: string): PlacesAdapter {
	let adapter = placeAdapters.get(placeId);
	if (!adapter) {
		adapter = new PlacesAdapter(placeId);
		placeAdapters.set(placeId, adapter);
	}
	return adapter;
}

/** The folder list holding `fullPath`, its place in it, and the folder path that reaches it — or null. */
export async function presetSiblings(fullPath: string): Promise<PresetSiblings | null> {
	if (!fullPath) return null;
	let index;
	try {
		index = await getPlacesIndex();
	} catch {
		return null;
	}
	const path = aliasPresetPath(index.aliases, fullPath);
	const place = index.places.find((p) => path.startsWith(`${p.path.replace(/\/+$/, '')}/`));
	if (!place) return null;
	const found = await placeAdapterFor(place.id).findPresetSiblings(path);
	if (!found) return null;
	const current = found.presets[found.index];
	const steppable = found.presets.filter(
		(p) => p === current || (p.installed !== false && (groupOfKind(p.kind) === null || loadsAsInstrument(p.kind)))
	);
	return { typeId: placeVendorId(place.id), presets: steppable, index: steppable.indexOf(current), path: found.path };
}

export function _resetPresetSwapCatalogForTests(): void {
	placeAdapters.clear();
}
