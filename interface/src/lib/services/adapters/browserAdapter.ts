/**
 * Browser Adapter Interface
 *
 * Simple tree-based navigation for all instruments.
 */

import type { ItemKind, KindCounts } from '$lib/utils/placeKinds';

export interface Preset {
	name: string;           // Display name (deduplicated)
	path: string;           // Relative to the Place's root (`<Place>/<folders>/…`); a Recent sample's is its absolute path
	fullPath: string;       // Absolute path
	type: string;           // File extension
	vendorColor?: string;   // Color of the plug-in maker (Ableton/Omni/NI), baked in by the Places catalog generator
	// ADR-401: baked base64 waveform thumbnail for audio samples (see
	// $lib/utils/waveformThumbnail). Present only when the generator could decode
	// the sample as PCM; the browser tile falls back to a live /api/sample-peaks
	// fetch when it's absent (compressed formats, freshly-added files).
	peaks?: string;
	// Recent-tab sample-backed entries (captured/converted Simplers). When
	// `kind === 'sample'` AND `filePath` is set, the loader routes through
	// `loadCaptureIntoSimpler` against `filePath` instead of the standard
	// `prepare_for_preset` path. A Places catalog item (browser-places plan)
	// also carries a `kind` — what the file is, read at build time — and never
	// a `filePath`, so it takes the standard path.
	kind?: ItemKind;
	filePath?: string;
	// Places catalog items only (browser-places plan §2). A plug-in preset's
	// plug-in, maker and patch name, and whether that plug-in is installed
	// (`false` greys the tile out rather than letting a tap fail).
	plugin?: string;
	maker?: string;
	patch?: string;
	installed?: boolean;
	// The role of the Place the item came from (drum / key / …), stamped by
	// the Places adapter (and by Recent, for an entry whose file lies in a
	// Place). A load passes it to track coloring as the answer. `null` = the
	// Place has no role; absent = no Place behind the item.
	role?: string | null;
	// Where the item lives, for a load that names its Place (protocol 3.11.0):
	// `place:<name>`, `library` or `pack:<name>`, and that Place's folder, so
	// the loader can send the path inside it. Stamped by the Places adapter.
	source?: string;
	placePath?: string;
	// Audio-sample load target, on Recent sample entries: whether the sample
	// was loaded as a clip on an audio track or onto a Simpler, so a replay
	// does the same. Absent → 'simpler' (capture/convert entries).
	loadTarget?: 'clip' | 'simpler';
}

export interface FolderNode {
	name: string;
	path: string;
	folders: Record<string, FolderNode>;
	presets: Preset[];
	vendorColor?: string | null;  // Pre-computed: string = vendor color, null = multi-vendor (use type color)
	// Places catalog only: per-kind counts of everything under this folder
	// (the header chips filter on them), and a folder whose contents live in
	// another file of /data/places/ (a Place's Samples), fetched when opened.
	kinds?: KindCounts;
	external?: string;
}

export interface VendorInfo {
	id: string;
	name: string;
	trackType: string;
}

export interface LibraryGroup {
	name: string;           // Library name (e.g., "Keyscape Creative")
	color: string;          // Color for this library
	items: string[];        // Instrument names (e.g., ["Acoustic Pianos", "Electric Pianos"])
}

export interface GroupedFolders {
	ungrouped: string[];    // Regular folder names
	groups: LibraryGroup[]; // Grouped library sections
}

/**
 * Browser adapter interface
 */
export interface BrowserAdapter {
	/**
	 * Get all vendors
	 */
	getVendors(): Promise<string[]>;

	/**
	 * Get subfolders at a given path
	 * @param vendorId - Vendor ID
	 * @param path - Array of folder names (empty = root)
	 * @param vendorColor - Optional vendor color for disambiguating duplicate folder names
	 * @returns Folder names
	 */
	getFolders(vendorId: string, path: string[], vendorColor?: string): Promise<string[]>;

	/**
	 * Get grouped subfolders at a given path (for library grouping)
	 * @param vendorId - Vendor ID
	 * @param path - Array of folder names (empty = root)
	 * @param vendorColor - Optional vendor color for disambiguating duplicate folder names
	 * @returns Grouped folders or null if not supported
	 */
	getGroupedFolders?(vendorId: string, path: string[], vendorColor?: string): Promise<GroupedFolders | null>;

	/**
	 * Get presets at a given path
	 * @param vendorId - Vendor ID
	 * @param path - Array of folder names
	 * @param limit - Maximum number of presets to return (default: 200)
	 * @param includeNested - Include presets from subfolders (default: false)
	 * @param vendorColor - Optional vendor color for disambiguating duplicate folder names
	 * @returns Array of presets
	 */
	getPresets(vendorId: string, path: string[], limit?: number, includeNested?: boolean, vendorColor?: string): Promise<Preset[]>;

	/**
	 * Get a mapping of folder name → color for the current path.
	 * Used to color-code consolidated folders by their source vendor.
	 */
	getFolderColors?(vendorId: string, path: string[]): Promise<Record<string, string>>;

	/**
	 * Get random preset from path (or entire vendor if path empty)
	 */
	getRandomPreset(vendorId: string, path: string[]): Promise<Preset>;

	/**
	 * Get vendor metadata
	 */
	getVendorInfo(vendorId: string): Promise<VendorInfo>;

	/**
	 * Release cached data held by this adapter (e.g. large preset JSON).
	 * Called when navigating away from a vendor to free memory.
	 */
	clearCache(): void;
}
