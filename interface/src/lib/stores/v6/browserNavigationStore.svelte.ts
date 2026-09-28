/**
 * Browser Navigation Store (Svelte 5 runes)
 * Manages navigation state for the preset browser
 */

import {
	getAdapter,
	type BrowserAdapter,
} from '$lib/services/adapters';
import { logger } from '$lib/utils/logger';

// Vendor-specific navigation state
// `columns` (six sub-fields) and `lastPath` were deleted 2026-09-11: residue
// of the Miller-column browser the drill-down replaced. Both were written on
// every vendor-state create and reset and read by nothing, which also made
// the two "clear columns to release references to large JSON data" comments
// below false — the array they cleared was always already empty.
export type VendorState = {
	currentPath: string[];
	adapter: BrowserAdapter | null;
	vendorColor: string | null;  // Color of the selected first-level folder (persisted per-vendor)
};

/**
 * Key for a rail button's remembered drill-down location.
 *
 * Keyed on the *button* id and the source axis: a Place remembers one spot
 * among its presets (MIDI) and one among its samples (Simpler / Audio), since a
 * preset path means nothing inside the sample tree. Simpler and Audio share
 * one memory: same samples, same folders, only the load target differs.
 */
export function rememberedPathKey(buttonId: string, isAudioSource: boolean): string {
	return `${buttonId}:${isAudioSource ? 'audio' : 'instruments'}`;
}

function createBrowserNavigationStore() {
	let vendorStates = $state<Record<string, VendorState>>({});
	// Last drill-down location per rail button, so opening the browser from a
	// closed state resumes where that button left off. Session-lived (not
	// persisted): it tracks where you were during a set, not a saved place.
	let rememberedPaths = $state<Record<string, string[]>>({});
	let selectedVendorId = $state<string | null>(null);
	let currentVendorId = $state<string | null>(null);  // The actual vendorId (for vendorStates lookup)
	let selectedCategory = $state<'vendor' | 'scale' | null>(null);
	let loadedPresetPath = $state<string | null>(null);

	return {
		// Vendor states
		get vendorStates() {
			return vendorStates;
		},

		// Selected vendor ID (button id)
		get selectedVendorId() {
			return selectedVendorId;
		},
		set selectedVendorId(value: string | null) {
			selectedVendorId = value;
		},

		// Current vendor ID (vendorId for vendorStates lookup)
		get currentVendorId() {
			return currentVendorId;
		},
		set currentVendorId(value: string | null) {
			currentVendorId = value;
		},

		// Selected category (vendor or scale)
		get selectedCategory() {
			return selectedCategory;
		},
		set selectedCategory(value: 'vendor' | 'scale' | null) {
			selectedCategory = value;
		},

		// Currently loaded preset path (for visual selection indicator)
		get loadedPresetPath() {
			return loadedPresetPath;
		},
		set loadedPresetPath(value: string | null) {
			loadedPresetPath = value;
		},

		// Selected vendor color - derived from current vendor state (single source of truth)
		get selectedVendorColor(): string | null {
			if (!currentVendorId) return null;
			return vendorStates[currentVendorId]?.vendorColor ?? null;
		},

		// Initialize vendor states from loaded vendors
		initializeVendorStates(vendors: Array<{ vendorId: string }>) {
			const initialStates: Record<string, VendorState> = {};
			for (const vendor of vendors) {
				initialStates[vendor.vendorId] = {
					currentPath: [],
					adapter: null,
					vendorColor: null
				};
			}
			// Add recent instruments vendor state
			initialStates['recent-instruments'] = {
				currentPath: [],
				adapter: null,
				vendorColor: null
			};
			vendorStates = initialStates;
		},

		/**
		 * The Mac says the catalog changed (`placesLive`): keep every known
		 * button's folder position, add the new buttons, drop the gone ones,
		 * and forget every adapter so the next read refetches. A rebuilt
		 * catalog after a tick or a thumbnail bake must not throw the
		 * performer out of the folder they are browsing.
		 */
		refreshVendorStates(vendors: Array<{ vendorId: string }>) {
			const next: Record<string, VendorState> = {};
			const keep = (id: string, color: string | null) => {
				const old = vendorStates[id];
				// The adapter stays (a level read needs one); its memo goes.
				old?.adapter?.clearCache?.();
				next[id] = { currentPath: old ? [...old.currentPath] : [], adapter: old?.adapter ?? null, vendorColor: color };
			};
			for (const vendor of vendors) keep(vendor.vendorId, vendorStates[vendor.vendorId]?.vendorColor ?? null);
			keep('recent-instruments', null);
			vendorStates = next;
		},

		// Get or create vendor state
		getOrCreateVendorState(vendorId: string): VendorState {
			if (!vendorStates[vendorId]) {
				vendorStates[vendorId] = {
					currentPath: [],
					adapter: getAdapter(vendorId),
					vendorColor: null
				};
			} else if (!vendorStates[vendorId].adapter) {
				vendorStates[vendorId].adapter = getAdapter(vendorId);
			}
			return vendorStates[vendorId];
		},

		// Get current vendor state
		getCurrentVendorState(selectedVendor: string | null): VendorState | null {
			return selectedVendor ? vendorStates[selectedVendor] : null;
		},

		// ── Remembered per-button drill-down location ──
		// Written on every navigation while a button is open; read when that
		// button reopens the browser from a closed state. Build keys with
		// `rememberedPathKey`.

		rememberPath(key: string, path: string[]) {
			rememberedPaths[key] = [...path];
		},

		// Always a fresh array — callers assign it straight into a vendor
		// state's `currentPath`, which then gets mutated by navigation.
		getRememberedPath(key: string): string[] {
			return [...(rememberedPaths[key] ?? [])];
		},

		// Drop a memory that no longer resolves (catalog regenerated under it).
		forgetPath(key: string) {
			delete rememberedPaths[key];
		},

		// Reset vendor state
		resetVendorState(vendorId: string) {
			vendorStates[vendorId] = {
				currentPath: [],
				adapter: null,
				vendorColor: null
			};
		},

		// Reset all vendor states
		resetAllVendorStates() {
			const resetStates: Record<string, VendorState> = {};
			for (const vendorId of Object.keys(vendorStates)) {
				resetStates[vendorId] = {
					currentPath: [],
					adapter: null,
					vendorColor: null
				};
			}
			vendorStates = resetStates;
			rememberedPaths = {};
		},

		// Clear vendor state paths but preserve adapter
		clearVendorNavigationState() {
			Object.keys(vendorStates).forEach((key) => {
				vendorStates[key].currentPath = [];
			});
			// Where you were is navigation state too — leaving it behind would let
			// a reopen resurrect a path this call just wiped.
			rememberedPaths = {};
		},

		// Clear cache for a specific vendor
		clearVendorCache(vendorId: string) {
			const state = vendorStates[vendorId];
			if (state) {
				if (state.adapter && typeof state.adapter.clearCache === 'function') {
					logger.debug(`Clearing cached data for vendor: ${vendorId}`, { component: 'browserNavigation' });
					state.adapter.clearCache();
				}
			}
		},

		// Clear all vendor caches
		clearAllCaches() {
			logger.debug('Clearing all vendor caches', { component: 'browserNavigation' });
			for (const [vendorId, state] of Object.entries(vendorStates)) {
				if (state.adapter && typeof state.adapter.clearCache === 'function') {
					state.adapter.clearCache();
				}
			}
		}
	};
}

export const browserNavigationStore = createBrowserNavigationStore();
