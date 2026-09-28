/**
 * Recent Instruments Adapter
 *
 * Adapter for browsing recently loaded instruments.
 * Sources data from recentInstrumentsStore (flat list, no folders).
 */

import type { BrowserAdapter, Preset, VendorInfo, GroupedFolders } from './browserAdapter';
import { recentInstrumentsStore } from '$lib/stores/v6/recentInstrumentsStore.svelte';
import { getPlacesIndex } from './placesAdapter';
import { aliasPresetPath } from '$lib/utils/presetPath';

/**
 * Recent, read through the alias map (browser-places plan). An entry recorded
 * before the cutover holds a path in the old vendor tree; it loads — and is
 * shown — as its copy under the Sidebar, so the load records the new path and
 * the swap pill finds it in the Place's catalog. An entry with no recorded
 * role (every one from before the Places) takes the role of the Place its path
 * lands in, which is what colors the track and records its role on load. An
 * old entry and the copy a later load added are one item: the newer (first)
 * wins. With no Places index, Recent is exactly the store's list.
 */
export async function recentThroughAliases(presets: Preset[]): Promise<Preset[]> {
	let index;
	try {
		index = await getPlacesIndex();
	} catch {
		return presets;
	}
	const roleOf = (fullPath: string) =>
		index.places.find((pl) => fullPath.startsWith(`${pl.path.replace(/\/+$/, '')}/`))?.role;
	const seen = new Set<string>();
	const out: Preset[] = [];
	for (const p of presets) {
		const fullPath = aliasPresetPath(index.aliases, p.fullPath);
		if (seen.has(fullPath)) continue;
		seen.add(fullPath);
		const role = p.role !== undefined ? p.role : roleOf(fullPath);
		out.push(
			fullPath === p.fullPath && role === p.role
				? p
				: {
						...p,
						fullPath,
						path: p.path === p.fullPath ? fullPath : p.path,
						...(p.filePath ? { filePath: aliasPresetPath(index.aliases, p.filePath) } : {}),
						...(role !== undefined ? { role } : {})
					}
		);
	}
	return out;
}

export class RecentInstrumentsAdapter implements BrowserAdapter {
	/**
	 * Get all vendors (not used for recent, but required by interface)
	 */
	async getVendors(): Promise<string[]> {
		return ['recent-instruments'];
	}

	/**
	 * No folders in recent view - flat list only
	 */
	async getFolders(vendorId: string, path: string[]): Promise<string[]> {
		return [];
	}

	/**
	 * Get grouped folders (not supported for recent)
	 */
	async getGroupedFolders(vendorId: string, path: string[], vendorColor?: string): Promise<GroupedFolders | null> {
		return null;
	}

	/**
	 * Get recent instruments as preset list
	 */
	async getPresets(
		vendorId: string,
		path: string[],
		limit: number = 200,
		includeNested: boolean = false
	): Promise<Preset[]> {
		// Recent view is always flat, ignore path
		const presets = await recentThroughAliases(recentInstrumentsStore.getAsPresets());
		return presets.slice(0, limit);
	}

	/**
	 * Get random preset from recent instruments
	 */
	async getRandomPreset(vendorId: string, path: string[]): Promise<Preset> {
		const presets = await recentThroughAliases(recentInstrumentsStore.getAsPresets());

		if (presets.length === 0) {
			throw new Error('No recent instruments available');
		}

		const randomIndex = Math.floor(Math.random() * presets.length);
		return presets[randomIndex];
	}

	/**
	 * Get vendor info for recent instruments
	 */
	async getVendorInfo(vendorId: string): Promise<VendorInfo> {
		return {
			id: 'recent-instruments',
			name: 'Recent',
			trackType: 'midi'
		};
	}

	/**
	 * No cache to clear - data comes from store
	 */
	clearCache(): void {
		// No-op
	}
}
