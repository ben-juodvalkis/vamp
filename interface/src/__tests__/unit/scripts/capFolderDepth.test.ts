import { describe, it, expect } from 'vitest';
// The Places catalog's folder shaping lives outside interface/ (repo-root
// scripts/); the test glob only reaches interface/src, so import via a relative
// path. Moved from the retired type-catalog builder at the browser-places
// cutover (2026-09-24), behavior unchanged.
import {
	capFolderDepth,
	isForcedFlattenNode,
	isKeepNestingNode,
	keepNestingEntryFor,
	redundantKeepNestingEntries,
	unmatchedKeepNestingEntries
} from '$lib/server/places/catalogShape';

// Minimal MergedFolderNode-shaped factory. Only the fields capFolderDepth reads
// (name/path/folders/presets) matter here.
function folder(name: string, path: string, children: Record<string, any> = {}, presets: any[] = []) {
	return { name, path, folders: children, presets };
}
function preset(name: string, path: string) {
	return { name, path };
}

describe('isForcedFlattenNode', () => {
	const list = ['Omni/Bass/Acoustic'];

	it('matches the listed folder exactly', () => {
		expect(isForcedFlattenNode('Omni/Bass/Acoustic', list)).toBe(true);
	});

	it('matches descendants of a listed folder', () => {
		expect(isForcedFlattenNode('Omni/Bass/Acoustic/Upright', list)).toBe(true);
	});

	it('does not match a sibling sharing a name prefix', () => {
		expect(isForcedFlattenNode('Omni/Bass/AcousticX', list)).toBe(false);
	});

	it('does not match a shallower ancestor', () => {
		expect(isForcedFlattenNode('Omni/Bass', list)).toBe(false);
	});

	it('never matches with an empty list', () => {
		expect(isForcedFlattenNode('Omni/Bass/Acoustic', [])).toBe(false);
	});
});

describe('capFolderDepth flattenFolders override', () => {
	// Omni / Bass / Acoustic / {Upright/*, Fretless/*} — Acoustic is at depth 3,
	// below a global cap of 4, so WITHOUT the override its Upright/Fretless
	// subfolders survive as folders.
	function buildTree() {
		return {
			presets: [] as any[],
			folders: {
				Omni: folder('Omni', 'Omni', {
					Bass: folder('Bass', 'Omni/Bass', {
						Acoustic: folder('Acoustic', 'Omni/Bass/Acoustic', {
							Upright: folder('Upright', 'Omni/Bass/Acoustic/Upright', {}, [
								preset('Warm Upright', 'Omni/Bass/Acoustic/Upright/Warm Upright.adv'),
								preset('Deep Sub', 'Omni/Bass/Acoustic/Upright/Deep Sub.adv')
							]),
							Fretless: folder('Fretless', 'Omni/Bass/Acoustic/Fretless', {}, [
								preset('Fretless Ambient', 'Omni/Bass/Acoustic/Fretless/Fretless Ambient.adv')
							])
						}),
						// Sibling of Acoustic — must be untouched by the override.
						Electric: folder('Electric', 'Omni/Bass/Electric', {}, [
							preset('Punchy', 'Omni/Bass/Electric/Punchy.adv')
						])
					})
				})
			}
		};
	}

	it('without an override, deep subfolders survive under a high global cap', () => {
		const capped = capFolderDepth(buildTree(), 4, []);
		const acoustic = capped.folders.Omni.folders.Bass.folders.Acoustic;
		expect(Object.keys(acoustic.folders).sort()).toEqual(['Fretless', 'Upright']);
		expect(acoustic.presets).toHaveLength(0);
	});

	it('flattens the listed folder: subfolders drop, all descendants roll up', () => {
		const capped = capFolderDepth(buildTree(), 4, ['Omni/Bass/Acoustic']);
		const acoustic = capped.folders.Omni.folders.Bass.folders.Acoustic;
		// Subfolders gone; every nested preset is now flat ON Acoustic.
		expect(Object.keys(acoustic.folders)).toHaveLength(0);
		expect(acoustic.presets.map((p: any) => p.name).sort()).toEqual([
			'Deep Sub',
			'Fretless Ambient',
			'Warm Upright'
		]);
	});

	it('preserves each preset physical path so the browser can re-group by parent', () => {
		const capped = capFolderDepth(buildTree(), 4, ['Omni/Bass/Acoustic']);
		const acoustic = capped.folders.Omni.folders.Bass.folders.Acoustic;
		const byName = Object.fromEntries(acoustic.presets.map((p: any) => [p.name, p.path]));
		expect(byName['Warm Upright']).toBe('Omni/Bass/Acoustic/Upright/Warm Upright.adv');
		expect(byName['Fretless Ambient']).toBe('Omni/Bass/Acoustic/Fretless/Fretless Ambient.adv');
	});

	it('leaves an unlisted sibling folder untouched', () => {
		const capped = capFolderDepth(buildTree(), 4, ['Omni/Bass/Acoustic']);
		const electric = capped.folders.Omni.folders.Bass.folders.Electric;
		expect(electric.presets.map((p: any) => p.name)).toEqual(['Punchy']);
		expect(Object.keys(electric.folders)).toHaveLength(0);
	});
});

describe('isKeepNestingNode', () => {
	const list = ['Prod/NI Acoustic'];

	it('matches a node whose path ENDS with the chain (vendor prefix optional)', () => {
		expect(isKeepNestingNode('NI/Drum/Prod/NI Acoustic', list)).toBe(true);
		expect(isKeepNestingNode('Ableton/Drum/Prod/NI Acoustic', list)).toBe(true);
	});

	it('matches descendants of a listed chain', () => {
		expect(isKeepNestingNode('NI/Drum/Prod/NI Acoustic/Kits', list)).toBe(true);
	});

	it('matches a fully-qualified entry too', () => {
		expect(isKeepNestingNode('NI/Drum/Prod/NI Acoustic', ['NI/Drum/Prod/NI Acoustic'])).toBe(true);
	});

	it('is boundary-safe on whole segments', () => {
		expect(isKeepNestingNode('NI/Drum/Prod/NI AcousticX', list)).toBe(false);
		expect(isKeepNestingNode('NI/Drum/Old Prod/NI Acoustic', list)).toBe(false);
	});

	it('does not match a shallower ancestor', () => {
		expect(isKeepNestingNode('NI/Drum/Prod', list)).toBe(false);
	});

	it('never matches with an empty list', () => {
		expect(isKeepNestingNode('NI/Drum/Prod/NI Acoustic', [])).toBe(false);
	});
});

describe('keepNestingEntryFor', () => {
	const list = ['Prod/NI Acoustic'];

	it('names the entry on the folder itself', () => {
		expect(keepNestingEntryFor('NI/Drum/Prod/NI Acoustic', list)).toBe('Prod/NI Acoustic');
	});

	it('returns null for a descendant, so the exemption logs once', () => {
		expect(keepNestingEntryFor('NI/Drum/Prod/NI Acoustic/Kits', list)).toBeNull();
	});
});

describe('redundantKeepNestingEntries', () => {
	it('flags an entry already covered by a broader one', () => {
		expect(
			redundantKeepNestingEntries(['Prod/NI Acoustic', 'Prod/NI Acoustic/Kits'])
		).toEqual(['Prod/NI Acoustic/Kits']);
	});

	it('treats a shorter chain as broader than a longer one ending with it', () => {
		// Not just path ancestry: the matcher is segment-run with the prefix
		// optional, so bare "NI Acoustic" already covers every node the qualified
		// chain names.
		expect(redundantKeepNestingEntries(['NI Acoustic', 'Prod/NI Acoustic'])).toEqual([
			'Prod/NI Acoustic'
		]);
	});

	it('leaves independent entries alone', () => {
		expect(redundantKeepNestingEntries(['Prod/NI Acoustic', 'Prod/NI Analog'])).toEqual([]);
	});

	it('does not treat a duplicate entry as covering itself', () => {
		expect(redundantKeepNestingEntries(['Prod/NI Acoustic'])).toEqual([]);
	});
});

describe('unmatchedKeepNestingEntries', () => {
	it('reports only the entries that named nothing', () => {
		const hits = new Set(['Prod/NI Acoustic']);
		expect(unmatchedKeepNestingEntries(['Prod/NI Acoustic', 'Prod/NI Typo'], hits)).toEqual([
			'Prod/NI Typo'
		]);
	});

	it('does not report an entry shadowed by a broader one as unmatched', () => {
		// The broader entry exempts the subtree, so capping returns before the
		// recursion reaches the node "…/Kits" names — it can never record a hit,
		// but it is covered, not a typo.
		const hits = new Set(['Prod/NI Acoustic']);
		expect(
			unmatchedKeepNestingEntries(['Prod/NI Acoustic', 'Prod/NI Acoustic/Kits'], hits)
		).toEqual([]);
	});
});

describe('capFolderDepth keepNestingFolders override', () => {
	// The real shape: mergeVendorTrees hoists each vendor's root-level folders
	// into the type root, so Prod is depth 1 and NI Acoustic depth 2 — exactly at
	// the shipped cap of 2, and therefore collapsed unless exempted.
	function buildTree() {
		return {
			presets: [] as any[],
			folders: {
				Prod: folder('Prod', 'NI/Drum/Prod', {
					'NI Acoustic': folder('NI Acoustic', 'NI/Drum/Prod/NI Acoustic', {
						Kits: folder('Kits', 'NI/Drum/Prod/NI Acoustic/Kits', {}, [
							preset('Brush Kit', 'NI/Drum/Prod/NI Acoustic/Kits/Brush Kit.adg')
						]),
						Snares: folder('Snares', 'NI/Drum/Prod/NI Acoustic/Snares', {}, [
							preset('Rim Snare', 'NI/Drum/Prod/NI Acoustic/Snares/Rim Snare.adg')
						])
					}),
					// Unlisted sibling at the same depth — must still collapse.
					Vintage: folder('Vintage', 'NI/Drum/Prod/Vintage', {
						Tape: folder('Tape', 'NI/Drum/Prod/Vintage/Tape', {}, [
							preset('Tape Kit', 'NI/Drum/Prod/Vintage/Tape/Tape Kit.adg')
						])
					})
				})
			}
		};
	}

	it('without the override, a depth-2 folder collapses at the shipped cap', () => {
		const capped = capFolderDepth(buildTree(), 2, [], []);
		const acoustic = capped.folders.Prod.folders['NI Acoustic'];
		expect(Object.keys(acoustic.folders)).toHaveLength(0);
		expect(acoustic.presets.map((p: any) => p.name).sort()).toEqual(['Brush Kit', 'Rim Snare']);
	});

	it('keeps the listed folder fully nested and drillable', () => {
		const capped = capFolderDepth(buildTree(), 2, [], ['Prod/NI Acoustic']);
		const acoustic = capped.folders.Prod.folders['NI Acoustic'];
		expect(Object.keys(acoustic.folders).sort()).toEqual(['Kits', 'Snares']);
		// Presets stay in their own subfolders rather than rolling up.
		expect(acoustic.presets).toHaveLength(0);
		expect(acoustic.folders.Kits.presets.map((p: any) => p.name)).toEqual(['Brush Kit']);
	});

	it('exempts descendants too, however deep', () => {
		const deep = buildTree();
		(deep.folders.Prod.folders['NI Acoustic'].folders.Kits as any).folders = {
			Brushes: folder('Brushes', 'NI/Drum/Prod/NI Acoustic/Kits/Brushes', {}, [
				preset('Soft Brush', 'NI/Drum/Prod/NI Acoustic/Kits/Brushes/Soft Brush.adg')
			])
		};
		const capped = capFolderDepth(deep, 2, [], ['Prod/NI Acoustic']);
		const kits = capped.folders.Prod.folders['NI Acoustic'].folders.Kits;
		expect(Object.keys(kits.folders)).toEqual(['Brushes']);
	});

	it('leaves an unlisted sibling to the global cap', () => {
		const capped = capFolderDepth(buildTree(), 2, [], ['Prod/NI Acoustic']);
		const vintage = capped.folders.Prod.folders.Vintage;
		expect(Object.keys(vintage.folders)).toHaveLength(0);
		expect(vintage.presets.map((p: any) => p.name)).toEqual(['Tape Kit']);
	});

	it('records each matched entry in the caller\'s hits set', () => {
		const hits = new Set<string>();
		capFolderDepth(buildTree(), 2, [], ['Prod/NI Acoustic', 'Prod/NI Gone'], hits);
		expect([...hits]).toEqual(['Prod/NI Acoustic']);
		// The entry that named no folder is what the generation warning reports.
		expect(unmatchedKeepNestingEntries(['Prod/NI Acoustic', 'Prod/NI Gone'], hits)).toEqual([
			'Prod/NI Gone'
		]);
	});

	it('records the hit once, on the named folder rather than per descendant', () => {
		const hits = new Set<string>();
		capFolderDepth(buildTree(), 2, [], ['Prod/NI Acoustic'], hits);
		expect(hits.size).toBe(1);
	});

	it('wins over a contradictory flattenFolders entry on the same folder', () => {
		const capped = capFolderDepth(
			buildTree(),
			2,
			['NI/Drum/Prod/NI Acoustic'],
			['Prod/NI Acoustic']
		);
		const acoustic = capped.folders.Prod.folders['NI Acoustic'];
		expect(Object.keys(acoustic.folders).sort()).toEqual(['Kits', 'Snares']);
	});
});
