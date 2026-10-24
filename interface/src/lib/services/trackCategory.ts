import type { TrackRecord } from '$lib/stores/v3/normalized.svelte';
import { libraryCategoryOfPreset } from '$lib/utils/presetPath';
import { machineStore } from '$lib/stores/machineStore.svelte';

/**
 * The category the track's instrument came from, and the folders under it.
 *
 * The recorded preset's own category folder first — its Place
 * (`Sidebar/<Place>/…`), or for a track loaded before the Places its type
 * folder (`<Vendor>/<Type>/…`), read exactly (`libraryCategoryOfPreset`).
 * Then the role the load recorded, which is what a track loaded before
 * protocol 3.9.0 carries, and what an xFull kit or a preset from a Place not
 * named for a role carries, their paths having no category folder to read.
 * The role is a rail id, but with no folders under it, so an Inst track
 * known only by its role is "an instrument" rather than a guess at which
 * kind.
 *
 * The preset answers first, and not only for its folders: a role recorded
 * before 2026-09-18 came from the deepest folder naming a category, so an
 * Omnisphere synth bass (`Omni/Bass/Synth/…`) recorded `synth`, and saved
 * Sets keep that until the track is next loaded through the app.
 */
export function trackCategory(track: TrackRecord | undefined): { category: string | null; folders: string[] } {
	const filed = track?.preset
		? libraryCategoryOfPreset(track.preset, machineStore.paths.instrumentsBase)
		: null;
	return filed ?? { category: track?.role || null, folders: [] };
}

/**
 * Whether a track is a drum track, for the FX grid's Drum cell (2026-10-23,
 * the user's call): its instrument came from the Drum or Perc category, or,
 * when no category was recorded (made in Live, loaded before the app recorded
 * one, an xFull kit), it holds a Drum Rack. The category answers first
 * because the class alone is wrong both ways: 45% of Drum/Perc presets are
 * not Drum Racks, and 592 Drum Racks are filed under Inst, Synth or FX.
 */
export function isDrumTrack(track: TrackRecord | undefined): boolean {
	const { category } = trackCategory(track);
	if (category) return category === 'drum' || category === 'perc';
	return [...(track?.devices.values() ?? [])].some((d) => d.className === 'DrumGroupDevice');
}
