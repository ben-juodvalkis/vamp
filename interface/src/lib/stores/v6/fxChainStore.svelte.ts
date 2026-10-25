/**
 * The FX section's second face: the selected track's chain, in order.
 *
 * - `mode` — what the FX section shows: the grid, or the chain overview.
 *   The tiny switch in the section's corner flips it.
 * - **Picks** — which device a tile controls when the track carries
 *   several of its type (two Auto Filters), and which rack the rack view
 *   shows. Keyed by track path and device type; set by a tap in the
 *   overview. A pick whose device is gone is ignored (the first of the
 *   type takes over), so nothing here needs cleaning when the chain moves.
 * - **The appointed device** — Live's blue hand. Every tap in the
 *   overview and every gesture on a tile appoints its device, so a knob
 *   controller following the blue hand follows the iPad. Sent only when
 *   it changes: a tile appoints on every drag frame.
 */
import { SvelteMap } from 'svelte/reactivity';
import { selectDevice } from '$lib/services/deviceMoveService';

export type FxPanelMode = 'grid' | 'chain';

/** The pick key for the rack view, beside the device types. */
export const RACK_PICK = 'audio-effect-rack';

let mode = $state<FxPanelMode>('grid');
let appointed = $state<string | null>(null);
const picks = new SvelteMap<string, string>();

const pickKey = (trackPath: string, type: string) => `${trackPath}|${type}`;

export const fxChainStore = {
	get mode(): FxPanelMode {
		return mode;
	},
	setMode(next: FxPanelMode): void {
		mode = next;
	},
	toggle(): void {
		mode = mode === 'grid' ? 'chain' : 'grid';
	},

	/** The device path picked for `type` on `trackPath`, if any. */
	pickFor(trackPath: string, type: string): string | null {
		return picks.get(pickKey(trackPath, type)) ?? null;
	},
	pick(trackPath: string, type: string, devicePath: string): void {
		picks.set(pickKey(trackPath, type), devicePath);
	},

	/** The device the app last appointed in Live (Live does not report its own). */
	get appointed(): string | null {
		return appointed;
	},
	/**
	 * Appoint `devicePath`. A repeat is dropped unless `force` — a deliberate
	 * tap re-sends, since Live's hand may have moved without telling us.
	 */
	appoint(devicePath: string, { force = false }: { force?: boolean } = {}): void {
		if (appointed === devicePath && !force) return;
		appointed = devicePath;
		void selectDevice(devicePath);
	},

	/** Tests and a track change. */
	reset(): void {
		mode = 'grid';
		appointed = null;
		picks.clear();
	}
};
