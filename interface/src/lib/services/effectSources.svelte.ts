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
 *
 * Vamp's utilities load through the "Vamp Devices" Place, which is optional
 * (installer.plan.md Phase 4): until the user adds the folder to Live's
 * Places, nothing that loads one is offered — Permute, the on-screen wheels,
 * REC. Read from the listing's `m4lDevices`; unknown until it lands, which
 * counts as there, so a rig that has the Place never sees them flicker.
 */
import { getPlacesIndex, type PlaceInfo } from '$lib/services/adapters/placesAdapter';
import { fetchPlacesListing, PLACES_CHANGED_EVENT } from '$lib/services/placesLive';
import { DEVICE_PRESETS, type DevicePresetConfig } from '$lib/config/devicePresets';
import { logger } from '$lib/utils/logger';

let folder = $state<Pick<PlaceInfo, 'name' | 'source' | 'devices'> | null>(null);
let vampDevicesPlace = $state<boolean | null>(null);
let started = false;

/** The utilities' load source (`devicePresets.ts`, the surface's `m4l_source`). */
const VAMP_DEVICES_SOURCE = 'place:Vamp Devices';

async function refresh(): Promise<void> {
	try {
		const index = await getPlacesIndex();
		const effects = index.places.find((p) => p.effects);
		folder = effects ? { name: effects.name, source: effects.source, devices: effects.devices } : null;
	} catch (err) {
		logger.warn('Effects folder: no places index', { component: 'effectSources', err: String(err) });
	}
	try {
		const m4l = (await fetchPlacesListing()).m4lDevices;
		vampDevicesPlace = m4l ? m4l.place !== null : null;
	} catch (err) {
		logger.warn('Vamp Devices: no places listing', { component: 'effectSources', err: String(err) });
	}
}

/** Whether Live has the Vamp Devices Place, so the utilities can load. True until known. Reactive. */
export function vampDevicesAvailable(): boolean {
	return vampDevicesPlace !== false;
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

/** Whether the Vamp effect of this `DEVICE_PRESETS` type can load: a native device always; a utility while Vamp Devices is a Place; an effect when its file is in the effects folder. */
export function effectAvailable(key: string): boolean {
	const config = DEVICE_PRESETS[key];
	if (!config) return false;
	if (config.source === VAMP_DEVICES_SOURCE) return vampDevicesAvailable();
	return !config.effect || effectSource(config) !== null;
}

/** Tests: set the effects folder directly. */
export function _setEffectsFolderForTests(next: Pick<PlaceInfo, 'name' | 'source' | 'devices'> | null): void {
	folder = next;
}

/** Tests: whether Live has the Vamp Devices Place (null: not known yet). */
export function _setVampDevicesPlaceForTests(next: boolean | null): void {
	vampDevicesPlace = next;
}
