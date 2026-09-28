/**
 * Vendor-model helpers for the gesture browser.
 *
 * The browser's "vendors" are the left-column buttons: instrument types loaded
 * from the types index, plus the special Audio and Recent buttons. (They're
 * still called "vendors" internally for historical reasons — see
 * UnifiedGestureBrowser.v6.svelte.) These helpers centralize the repeated
 * lookups and the magic offsets that map button positions back to this list.
 */

/** A left-column browser button (instrument type or special Audio/Recent). */
export interface BrowserVendor {
	id: string;
	name: string;
	color: string;
	vendorId: string;
	trackType: string;
}

/**
 * Special (non-type) button kinds. These have dedicated handlers and are NOT
 * navigated like vendor/type buttons during a col-0 gesture drag.
 */
export const SPECIAL_BUTTON_TYPES = ['scale', 'audio', 'recent'] as const;

/**
 * Offset between a col-0 folder-hover `data-index` and the index into the
 * `vendors` array for type buttons. The VendorButtonGrid lays out group 1 as
 * Record(implicit) / Recent(0) / Audio(2); the first type button (group 2)
 * starts at data-index 3. Subtract this offset to recover the type's position
 * in the `vendors` list. Tied to VendorButtonGrid's layout — keep in sync.
 */
export const VENDOR_BUTTON_INDEX_OFFSET = 3;

/** Find a vendor by its button id (e.g. 'place:drum', 'recent'). */
export function findVendorById<T extends { id: string }>(
	vendors: readonly T[],
	id: string | null | undefined
): T | undefined {
	if (!id) return undefined;
	return vendors.find((v) => v.id === id);
}

/** Find a vendor by its adapter vendorId (e.g. 'place:drum', 'recent-instruments'). */
export function findVendorByVendorId<T extends { vendorId: string }>(
	vendors: readonly T[],
	vendorId: string | null | undefined
): T | undefined {
	if (!vendorId) return undefined;
	return vendors.find((v) => v.vendorId === vendorId);
}

/** True when a col-0 button type is a special (non-navigable) button. */
export function isSpecialButtonType(buttonType: string | undefined | null): boolean {
	return (SPECIAL_BUTTON_TYPES as readonly string[]).includes(buttonType ?? '');
}
