import { describe, it, expect } from 'vitest';
import { collectPresetsRecursive, deduplicatePresetsByName } from '$lib/services/adapters/adapterUtils';
import type { FolderNode, Preset } from '$lib/services/adapters/browserAdapter';

function makePreset(name: string, path = ''): Preset {
	return { name, path, fullPath: path, type: 'adv' };
}

function makeFolder(name: string, presets: Preset[] = [], folders: Record<string, FolderNode> = {}): FolderNode {
	return { name, path: name, presets, folders };
}

describe('collectPresetsRecursive', () => {
	it('collects presets from a single node', () => {
		const node = makeFolder('root', [makePreset('A'), makePreset('B')]);
		const result: Preset[] = [];
		collectPresetsRecursive(node, result);
		expect(result.map(p => p.name)).toEqual(['A', 'B']);
	});

	it('collects presets from nested folders', () => {
		const node = makeFolder('root', [makePreset('A')], {
			child: makeFolder('child', [makePreset('B')], {
				grandchild: makeFolder('grandchild', [makePreset('C')])
			})
		});
		const result: Preset[] = [];
		collectPresetsRecursive(node, result);
		expect(result.map(p => p.name)).toEqual(['A', 'B', 'C']);
	});

	it('handles empty folders', () => {
		const node = makeFolder('root', [], {
			empty: makeFolder('empty')
		});
		const result: Preset[] = [];
		collectPresetsRecursive(node, result);
		expect(result).toEqual([]);
	});

	it('accumulates into an existing array', () => {
		const existing = [makePreset('X')];
		const node = makeFolder('root', [makePreset('Y')]);
		collectPresetsRecursive(node, existing);
		expect(existing.map(p => p.name)).toEqual(['X', 'Y']);
	});
});

describe('deduplicatePresetsByName', () => {
	it('removes duplicates by name, keeping first occurrence', () => {
		const presets = [
			makePreset('A', '/folder1'),
			makePreset('B', '/folder1'),
			makePreset('A', '/folder2'),
			makePreset('C', '/folder2')
		];
		const result = deduplicatePresetsByName(presets);
		expect(result.map(p => p.name)).toEqual(['A', 'B', 'C']);
		expect(result[0].path).toBe('/folder1'); // first occurrence kept
	});

	it('returns empty array for empty input', () => {
		expect(deduplicatePresetsByName([])).toEqual([]);
	});

	it('returns all presets when there are no duplicates', () => {
		const presets = [makePreset('A'), makePreset('B'), makePreset('C')];
		const result = deduplicatePresetsByName(presets);
		expect(result).toEqual(presets);
	});

	it('handles all duplicates', () => {
		const presets = [makePreset('A', '/a'), makePreset('A', '/b'), makePreset('A', '/c')];
		const result = deduplicatePresetsByName(presets);
		expect(result).toHaveLength(1);
		expect(result[0].path).toBe('/a');
	});
});
