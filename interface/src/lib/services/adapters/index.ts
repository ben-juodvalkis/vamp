/**
 * Adapter Registry
 *
 * The browser reads two kinds of list: a Place's catalog (`place:<id>`, the
 * browser-places plan — the only catalog since the cutover, 2026-09-24, which
 * removed the type-first, audio-clips and vendor adapters with the old library
 * layout), and Recent.
 */

import { RecentInstrumentsAdapter } from './recentInstrumentsAdapter';
import { PlacesAdapter, PLACE_VENDOR_PREFIX } from './placesAdapter';
import type { BrowserAdapter } from './browserAdapter';

/** The adapter for a rail button's vendorId: Recent, or a Place. */
export function getAdapter(vendorId: string): BrowserAdapter {
	if (vendorId === 'recent-instruments') {
		return new RecentInstrumentsAdapter();
	}
	if (!vendorId.startsWith(PLACE_VENDOR_PREFIX)) {
		throw new Error(`No browser adapter for ${vendorId}: the rail holds Recent and the Places`);
	}
	return new PlacesAdapter(vendorId.slice(PLACE_VENDOR_PREFIX.length));
}

export * from './browserAdapter';
export { RecentInstrumentsAdapter } from './recentInstrumentsAdapter';
export {
	PlacesAdapter,
	getPlacesIndex,
	isPlaceVendorId,
	placeVendorId,
	type PlaceInfo,
	type PlacesIndex
} from './placesAdapter';
