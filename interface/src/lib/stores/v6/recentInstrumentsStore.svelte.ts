/**
 * Recent Instruments Store (Svelte 5 Runes)
 *
 * Tracks recently loaded instruments for quick re-selection. Two kinds of entry:
 *
 * - `preset`  — a library preset path (.adg/.adv) loaded via the browser's
 *               `loadPresetWithVariant` → Python `prepare_for_preset` flow.
 * - `sample`  — a filesystem audio file re-loaded against its absolute path.
 *               Either a captured/converted WAV that went onto a Simpler
 *               (`loadCaptureIntoSimpler` — REC TO SIMPLER / convert), or an
 *               audio sample picked from the browser in audio-source mode.
 *               `loadTarget` records how it was loaded so re-selection replays
 *               it the same way (clip on an audio track, or Simpler on MIDI).
 *
 * Persists across sessions via localStorage (`looping:recentInstruments:v3`).
 * Older-schema entries are discarded on load — small cost, keeps the schema
 * honest.
 */

import type { Preset } from '$lib/services/adapters/browserAdapter';
import { logger } from '$lib/utils/logger';

const STORAGE_KEY = 'looping:recentInstruments:v3';
// Prior-schema keys, cleared on first v3 boot (no migration).
const LEGACY_STORAGE_KEYS = ['looping:recentInstruments:v2', 'looping:recentInstruments'];
const MAX_RECENT_ITEMS = 20;

export type SampleLoadTarget = 'clip' | 'simpler';

export interface RecentPresetItem {
	kind: 'preset';
	name: string;
	fullPath: string;
	vendorId: string;
	timestamp: number;
	color?: string;
	/**
	 * The role of the browser Place it was loaded from (browser-places plan),
	 * so a reload colors and records it as the first load did. Absent on
	 * everything the type browser adds, and on entries written before it.
	 */
	role?: string | null;
}

export interface RecentSampleItem {
	kind: 'sample';
	name: string;
	filePath: string;
	source: 'capture' | 'convert' | 'browser';
	// How the sample was loaded, so re-selection replays it identically.
	// Absent on legacy capture/convert entries → treated as 'simpler'.
	loadTarget?: SampleLoadTarget;
	timestamp: number;
}

export type RecentItem = RecentPresetItem | RecentSampleItem;

class RecentInstrumentsStore {
	private _items = $state<RecentItem[]>([]);

	constructor() {
		if (typeof window !== 'undefined') {
			this.loadFromStorage();
		}
	}

	get items(): RecentItem[] {
		return this._items;
	}

	get hasItems(): boolean {
		return this._items.length > 0;
	}

	/**
	 * Add a preset to the recent list. Deduplicated by `fullPath`.
	 */
	addInstrument(preset: Preset, vendorId: string) {
		const newItem: RecentPresetItem = {
			kind: 'preset',
			name: preset.name,
			fullPath: preset.fullPath,
			vendorId,
			timestamp: Date.now(),
			...(preset.vendorColor ? { color: preset.vendorColor } : {}),
			...(preset.role !== undefined ? { role: preset.role } : {})
		};

		this._items = this._items.filter(
			(item) => !(item.kind === 'preset' && item.fullPath === newItem.fullPath)
		);
		this._items = [newItem, ...this._items];
		this.trimAndSave();

		logger.debug('Added preset:', { component: 'recentInstruments', name: preset.name, total: this._items.length });
	}

	/**
	 * Add a sample-backed entry to the recent list. Deduplicated by `filePath`.
	 * `loadTarget` records whether it was loaded as a clip or onto a Simpler so
	 * re-selection replays it the same way (omitted for legacy capture/convert,
	 * which always meant Simpler).
	 */
	addSample(
		name: string,
		filePath: string,
		source: 'capture' | 'convert' | 'browser',
		loadTarget?: SampleLoadTarget
	) {
		if (!filePath) {
			logger.warn('addSample: empty filePath', { component: 'recentInstruments' });
			return;
		}
		const newItem: RecentSampleItem = {
			kind: 'sample',
			name,
			filePath,
			source,
			...(loadTarget ? { loadTarget } : {}),
			timestamp: Date.now()
		};

		this._items = this._items.filter(
			(item) => !(item.kind === 'sample' && item.filePath === newItem.filePath)
		);
		this._items = [newItem, ...this._items];
		this.trimAndSave();

		logger.debug('Added sample:', { component: 'recentInstruments', name, source, total: this._items.length });
	}

	/**
	 * Clear all recent items.
	 */
	clear() {
		this._items = [];
		this.saveToStorage();
		logger.debug('Cleared all', { component: 'recentInstruments' });
	}

	/**
	 * Remove a preset entry by its absolute path.
	 */
	removeByPath(fullPath: string) {
		this._items = this._items.filter(
			(item) => !(item.kind === 'preset' && item.fullPath === fullPath)
		);
		this.saveToStorage();
		logger.debug('Removed preset:', { component: 'recentInstruments', fullPath });
	}

	/**
	 * Remove a sample entry by its absolute filesystem path.
	 * Called by the v3 error handler when the surface reports the
	 * sample's file is missing or unreadable.
	 */
	removeSampleByFilePath(filePath: string) {
		const before = this._items.length;
		this._items = this._items.filter(
			(item) => !(item.kind === 'sample' && item.filePath === filePath)
		);
		if (this._items.length !== before) {
			this.saveToStorage();
			logger.info('Pruned missing sample:', { component: 'recentInstruments', filePath });
		}
	}

	/**
	 * Project items to `Preset` shape so the existing browser pipeline can
	 * render them. Sample entries carry `kind: 'sample'` + `filePath` so
	 * the loader can branch.
	 */
	getAsPresets(): Preset[] {
		return this._items.map((item) => {
			if (item.kind === 'sample') {
				return {
					name: item.name,
					path: item.filePath,
					fullPath: item.filePath,
					type: '.wav',
					kind: 'sample',
					filePath: item.filePath,
					...(item.loadTarget ? { loadTarget: item.loadTarget } : {})
				} as Preset;
			}
			return {
				name: item.name,
				path: item.fullPath,
				fullPath: item.fullPath,
				type: '.adg',
				...(item.color ? { vendorColor: item.color } : {}),
				...(item.role !== undefined ? { role: item.role } : {})
			};
		});
	}

	private trimAndSave() {
		if (this._items.length > MAX_RECENT_ITEMS) {
			this._items = this._items.slice(0, MAX_RECENT_ITEMS);
		}
		this.saveToStorage();
	}

	private loadFromStorage() {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored) as RecentItem[];
				if (Array.isArray(parsed)) {
					// Defensive: drop entries that fail the kind check, in case
					// of cross-version manual edits.
					this._items = parsed.filter(
						(item) => item && (item.kind === 'preset' || item.kind === 'sample')
					);
					logger.debug('Loaded from storage:', { component: 'recentInstruments', count: this._items.length });
				}
			}
			// Drop older-schema keys once on first v3 boot — prior entries
			// predate the `loadTarget`/`browser` fields and aren't worth a
			// migration.
			for (const legacyKey of LEGACY_STORAGE_KEYS) {
				if (localStorage.getItem(legacyKey) !== null) {
					localStorage.removeItem(legacyKey);
				}
			}
		} catch (error) {
			logger.error('Failed to load from storage:', { component: 'recentInstruments', error });
			this._items = [];
		}
	}

	private saveToStorage() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this._items));
		} catch (error) {
			logger.error('Failed to save to storage:', { component: 'recentInstruments', error });
		}
	}
}

export const recentInstrumentsStore = new RecentInstrumentsStore();
