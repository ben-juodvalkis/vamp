/**
 * Shared utilities for browser adapters
 */

import type { FolderNode, Preset } from './browserAdapter';

/**
 * Recursively collect all presets from a folder node and its children
 */
export function collectPresetsRecursive(node: FolderNode, accumulator: Preset[]): void {
	accumulator.push(...node.presets);
	for (const child of Object.values(node.folders)) {
		collectPresetsRecursive(child, accumulator);
	}
}

/**
 * The folder whose presets hold exactly `fullPath`, its index in that list, and
 * the folder-name segments that reach it from the type root — or null. The list
 * is the one a folder-next swap steps through, so the walk returns the *leaf's
 * own* presets, not a flattened copy.
 *
 * `path` is the same thing the browser's `currentPath` holds: the tree's own key
 * names, which is what `navigateToPath` and `enterFolder` both walk. So it is
 * directly the screen the drill-down shows that preset on — a depth-capped leaf
 * included, since the cap is baked into the tree and the walk stops where the
 * grid does. Root-level presets answer `[]`.
 *
 * Depth-first from the last-pushed folder, the order `findPresetSiblings` used
 * when it walked the tree itself; kept so a path that appears in two merged
 * leaves resolves to the same one it always did.
 */
export function findPresetInTree(
	root: { presets?: Preset[]; folders?: Record<string, FolderNode> },
	fullPath: string
): { presets: Preset[]; index: number; path: string[] } | null {
	if (!fullPath) return null;
	const stack: Array<{ presets: Preset[]; folders: Record<string, FolderNode>; path: string[] }> = [
		{ presets: root.presets ?? [], folders: root.folders ?? {}, path: [] }
	];
	while (stack.length > 0) {
		const node = stack.pop()!;
		const index = node.presets.findIndex((p) => p.fullPath === fullPath);
		if (index >= 0) return { presets: node.presets, index, path: node.path };
		for (const [name, child] of Object.entries(node.folders)) {
			stack.push({
				presets: child.presets ?? [],
				folders: child.folders ?? {},
				path: [...node.path, name]
			});
		}
	}
	return null;
}

/**
 * Remove duplicate presets by name when aggregating across multiple folders.
 * Keeps the first occurrence of each name. Duplicates reappear naturally
 * when the user drills into a specific subfolder (includeNested=false).
 */
export function deduplicatePresetsByName(presets: Preset[]): Preset[] {
	const seen = new Set<string>();
	return presets.filter(preset => {
		if (seen.has(preset.name)) return false;
		seen.add(preset.name);
		return true;
	});
}
