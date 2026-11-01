/**
 * Where Vamp's own effects load from (ADR-498): the effects folder chosen in
 * Settings → Places, by file name. Vamp ships only its utilities (Permute,
 * random start, the recorder); an amp rack or a Max effect is the user's own,
 * found in their effects folder under its name (`defaultName`, or one of its
 * `aliases`: the shelf's "Tone Shaper.amxd" is the Tone Shaper). Not there:
 * it cannot load and offers no ghost.
 *
 * The places index carries the effects folder's files by name
 * (`PlaceInfo.devices`); this module keeps the latest, re-read whenever the
 * Mac says the catalog changed. Live's Audio Effects category has none.
 */
import { getPlacesIndex, type PlaceInfo } from '$lib/services/adapters/placesAdapter';
import { PLACES_CHANGED_EVENT } from '$lib/services/placesLive';
import { DEVICE_PRESETS, type DevicePresetConfig } from '$lib/config/devicePresets';
import { logger } from '$lib/utils/logger';

let folder = $state<Pick<PlaceInfo, 'name' | 'source' | 'devices'> | null>(null);
let started = false;

async function refresh(): Promise<void> {
	try {
		const index = await getPlacesIndex();
		const effects = index.places.find((p) => p.effects);
		folder = effects ? { name: effects.name, source: effects.source, devices: effects.devices } : null;
	} catch (err) {
		logger.warn('Effects folder: no places index', { component: 'effectSources', err: String(err) });
	}
}

/** Read the effects folder now and on every catalog change. Idempotent. */
export function watchEffectSources(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	void refresh();
	window.addEventListener(PLACES_CHANGED_EVENT, () => void refresh());
}

/** The effects folder's name, '' when it is Live's Audio Effects or not read yet. Reactive. */
export function effectsFolderName(): string {
	return folder?.devices ? folder.name : '';
}

/**
 * Where a Vamp effect loads from: its file in the effects folder, by name or
 * alias, as `place:<name>` (or `library`) and the path inside it; null when
 * the folder has no file of that name. Reactive.
 */
export function effectSource(config: Pick<DevicePresetConfig, 'defaultName' | 'aliases'>): { source: string; rel: string } | null {
	const devices = folder?.devices;
	if (!devices || !folder?.source) return null;
	for (const name of [config.defaultName, ...(config.aliases ?? [])]) {
		const rel = devices[name];
		if (rel) return { source: folder.source, rel };
	}
	return null;
}

/** Whether the Vamp effect of this `DEVICE_PRESETS` type can load: a native device or a utility always; an effect when its file is in the effects folder. */
export function effectAvailable(key: string): boolean {
	const config = DEVICE_PRESETS[key];
	if (!config) return false;
	return !config.effect || effectSource(config) !== null;
}

/** Tests: set the effects folder directly. */
export function _setEffectsFolderForTests(next: Pick<PlaceInfo, 'name' | 'source' | 'devices'> | null): void {
	folder = next;
}
