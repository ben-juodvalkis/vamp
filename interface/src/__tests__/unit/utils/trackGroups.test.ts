/**
 * vitest coverage for the ADR-410 Group Track tree math.
 *
 * Pure functions, no store — the whole point of extracting them is
 * that the visibility rule can be checked without a reactive harness.
 *
 * The rule under test: a track is hidden when ANY ancestor group is
 * folded, not just its immediate parent. Nested groups are the reason
 * the wire carries `groupTrackIndex` (a parent pointer) instead of a
 * bare `isGrouped` bit.
 */

import { describe, it, expect } from 'vitest';
import {
	isTrackHidden,
	trackGroupDepth,
	groupMemberIndices,
	hasAncestor,
	groupBandLayout,
	type GroupNode
} from '$lib/utils/trackGroups';

function node(
	overrides: Partial<GroupNode> = {}
): GroupNode {
	return {
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		...overrides
	};
}

/** Builds a lookup from an index-keyed record. */
function lookupOf(nodes: Record<number, GroupNode>) {
	return (i: number) => nodes[i];
}

// Mirrors the user's real set at the time of ADR-410:
//   0 "1-Group" (group) → 1..3 children, 4..5 ungrouped
function flatGroup(folded: boolean) {
	return lookupOf({
		0: node({ isFoldable: true, foldState: folded }),
		1: node({ groupTrackIndex: 0 }),
		2: node({ groupTrackIndex: 0 }),
		3: node({ groupTrackIndex: 0 }),
		4: node(),
		5: node()
	});
}

// 0 (group) → 1 (group) → 2, plus sibling 3 directly under 0.
function nestedGroups(outerFolded: boolean, innerFolded: boolean) {
	return lookupOf({
		0: node({ isFoldable: true, foldState: outerFolded }),
		1: node({ isFoldable: true, foldState: innerFolded, groupTrackIndex: 0 }),
		2: node({ groupTrackIndex: 1 }),
		3: node({ groupTrackIndex: 0 })
	});
}

describe('isTrackHidden', () => {
	it('hides children of a folded group', () => {
		const lookup = flatGroup(true);
		expect(isTrackHidden(1, lookup)).toBe(true);
		expect(isTrackHidden(2, lookup)).toBe(true);
		expect(isTrackHidden(3, lookup)).toBe(true);
	});

	it('shows children of an unfolded group', () => {
		const lookup = flatGroup(false);
		for (const i of [1, 2, 3]) expect(isTrackHidden(i, lookup)).toBe(false);
	});

	it('never hides the folded group itself', () => {
		// The asymmetry that makes a fold reversible: a group that hid
		// itself when folded could never be reopened from the UI.
		expect(isTrackHidden(0, flatGroup(true))).toBe(false);
	});

	it('leaves ungrouped tracks alone', () => {
		const lookup = flatGroup(true);
		expect(isTrackHidden(4, lookup)).toBe(false);
		expect(isTrackHidden(5, lookup)).toBe(false);
	});

	it('hides a grandchild when only the OUTER group is folded', () => {
		// The case a parent-only check gets wrong: track 2's immediate
		// parent (the inner group) is open, but the whole subtree is
		// inside a folded outer group.
		const lookup = nestedGroups(true, false);
		expect(isTrackHidden(2, lookup)).toBe(true);
		expect(isTrackHidden(1, lookup)).toBe(true);
		expect(isTrackHidden(3, lookup)).toBe(true);
	});

	it('hides only the inner subtree when only the INNER group is folded', () => {
		const lookup = nestedGroups(false, true);
		expect(isTrackHidden(2, lookup)).toBe(true);
		// The inner group stays visible so it can be reopened.
		expect(isTrackHidden(1, lookup)).toBe(false);
		// Sibling outside the inner group is unaffected.
		expect(isTrackHidden(3, lookup)).toBe(false);
	});

	it('returns false for an unknown track index', () => {
		expect(isTrackHidden(99, flatGroup(true))).toBe(false);
	});

	it('shows the track when its parent is unresolvable (torn tree)', () => {
		// Fail-open: a wrongly-shown strip is recoverable, a wrongly-hidden
		// one loses access to the track entirely.
		const lookup = lookupOf({ 1: node({ groupTrackIndex: 7 }) });
		expect(isTrackHidden(1, lookup)).toBe(false);
	});

	it('terminates on a cyclic parent chain instead of hanging', () => {
		// Live can't produce a cycle, but a torn state/full mid-restructure
		// could momentarily look like one — an unbounded walk would spin
		// the render loop.
		const lookup = lookupOf({
			0: node({ isFoldable: true, groupTrackIndex: 1 }),
			1: node({ isFoldable: true, groupTrackIndex: 0 })
		});
		expect(isTrackHidden(0, lookup)).toBe(false);
	});
});

describe('trackGroupDepth', () => {
	it('reports 0 at top level', () => {
		const lookup = flatGroup(false);
		expect(trackGroupDepth(0, lookup)).toBe(0);
		expect(trackGroupDepth(4, lookup)).toBe(0);
	});

	it('reports 1 inside one group', () => {
		expect(trackGroupDepth(1, flatGroup(false))).toBe(1);
	});

	it('reports 2 inside a nested group', () => {
		const lookup = nestedGroups(false, false);
		expect(trackGroupDepth(1, lookup)).toBe(1);
		expect(trackGroupDepth(2, lookup)).toBe(2);
	});

	it('terminates on a cyclic chain', () => {
		const lookup = lookupOf({
			0: node({ groupTrackIndex: 1 }),
			1: node({ groupTrackIndex: 0 })
		});
		expect(trackGroupDepth(0, lookup)).toBeLessThanOrEqual(32);
	});
});

describe('groupMemberIndices', () => {
	it('lists direct children in index order', () => {
		expect(groupMemberIndices(0, [0, 1, 2, 3, 4, 5], flatGroup(false))).toEqual([
			1, 2, 3
		]);
	});

	it('includes indirect descendants', () => {
		const lookup = nestedGroups(false, false);
		expect(groupMemberIndices(0, [0, 1, 2, 3], lookup)).toEqual([1, 2, 3]);
		expect(groupMemberIndices(1, [0, 1, 2, 3], lookup)).toEqual([2]);
	});

	it('is empty for a non-group track', () => {
		expect(groupMemberIndices(4, [0, 1, 2, 3, 4, 5], flatGroup(false))).toEqual(
			[]
		);
	});
});

describe('groupBandLayout', () => {
	it('brackets an open group over its members, not over itself', () => {
		const { bands, offsets, bandCount } = groupBandLayout(
			[0, 1, 2, 3, 4, 5],
			flatGroup(false)
		);
		expect(bands).toEqual([{ groupIndex: 0, start: 0, span: 4, band: 0 }]);
		// The group's own column keeps offset 0 — full height, because its
		// arm grows sideways out of its top edge rather than sitting above
		// it. Only the members (1..3) drop below the arm.
		expect(offsets).toEqual([0, 1, 1, 1, 0, 0]);
		expect(bandCount).toBe(1);
	});

	it('draws nothing for a folded group', () => {
		// Members aren't in the visible row at all when the group is folded.
		const { bands, offsets, bandCount } = groupBandLayout(
			[0, 4, 5],
			flatGroup(true)
		);
		expect(bands).toEqual([]);
		expect(offsets).toEqual([0, 0, 0]);
		expect(bandCount).toBe(0);
	});

	it('stacks a nested group one band below its parent', () => {
		// 0 (group) → 1 (group) → 2, plus sibling 3 under 0.
		const { bands, offsets, bandCount } = groupBandLayout(
			[0, 1, 2, 3],
			nestedGroups(false, false)
		);
		expect(bands).toEqual([
			{ groupIndex: 0, start: 0, span: 4, band: 0 },
			{ groupIndex: 1, start: 1, span: 2, band: 1 }
		]);
		// 0 is the outer group: full height. 1 is the inner group — pushed
		// down by the OUTER arm only, so it sits level with its own arm.
		// 2 is inside both. 3 is inside the outer group only.
		expect(offsets).toEqual([0, 1, 2, 1]);
		expect(bandCount).toBe(2);
	});

	it('keeps the outer bracket when only the inner group is folded', () => {
		// Track 2 is hidden by the inner fold, so the row is [0, 1, 3].
		const { bands, offsets } = groupBandLayout([0, 1, 3], nestedGroups(false, true));
		expect(bands).toEqual([{ groupIndex: 0, start: 0, span: 3, band: 0 }]);
		expect(offsets).toEqual([0, 1, 1]);
	});

	it('skips an open group with no visible members', () => {
		// `active` filter mode can leave a group on screen (it's selected)
		// with every child filtered out. A lone arm over one column is
		// noise, not information.
		const { bands, bandCount } = groupBandLayout([0, 4], flatGroup(false));
		expect(bands).toEqual([]);
		expect(bandCount).toBe(0);
	});

	it('offsets children by drawn brackets, not by ancestor count', () => {
		// `active` mode can filter the group track out while its children
		// survive. Counting ancestors would push those children under a
		// band nothing was ever drawn in.
		const { bands, offsets } = groupBandLayout([1, 2, 3], flatGroup(false));
		expect(bands).toEqual([]);
		expect(offsets).toEqual([0, 0, 0]);
	});

	it('leaves a row with no groups completely flat', () => {
		const lookup = lookupOf({ 0: node(), 1: node() });
		expect(groupBandLayout([0, 1], lookup)).toEqual({
			bands: [],
			offsets: [0, 0],
			bandCount: 0
		});
	});

	it('flattens nesting deeper than the band cap instead of growing', () => {
		// Six nested groups, each holding the next. The arms stop stacking
		// at 4 bands — past that they share the innermost row rather than
		// eating the strips below without limit.
		const nodes: Record<number, GroupNode> = {};
		for (let i = 0; i < 6; i++) {
			nodes[i] = node({ isFoldable: true, groupTrackIndex: i - 1 });
		}
		nodes[6] = node({ groupTrackIndex: 5 });
		const visible = [0, 1, 2, 3, 4, 5, 6];
		const { bands, bandCount, offsets } = groupBandLayout(visible, lookupOf(nodes));
		expect(bands).toHaveLength(6);
		expect(bandCount).toBe(4);
		expect(Math.max(...offsets)).toBe(4);
		expect(bands.every((b) => b.band < 4)).toBe(true);
		// The outermost group is still full height, however deep the stack.
		expect(offsets[0]).toBe(0);
	});

	it('keeps every open group level with its own arm', () => {
		// The invariant the layout rests on: an arm never pushes down the
		// strip it grows out of, only the members it reaches over. Without
		// it the group strip would sit below its own arm and the ⌐ shape
		// would break into two disconnected pieces.
		const lookup = nestedGroups(false, false);
		const { bands, offsets } = groupBandLayout([0, 1, 2, 3], lookup);
		for (const band of bands) {
			expect(offsets[band.start]).toBe(band.band);
		}
	});

	it('handles an empty row', () => {
		expect(groupBandLayout([], flatGroup(false))).toEqual({
			bands: [],
			offsets: [],
			bandCount: 0
		});
	});
});

describe('hasAncestor', () => {
	it('finds a direct parent', () => {
		expect(hasAncestor(1, 0, flatGroup(false))).toBe(true);
	});

	it('finds a grandparent', () => {
		expect(hasAncestor(2, 0, nestedGroups(false, false))).toBe(true);
	});

	it('is false for an unrelated track', () => {
		expect(hasAncestor(4, 0, flatGroup(false))).toBe(false);
	});

	it('is false for a track against itself', () => {
		expect(hasAncestor(0, 0, flatGroup(false))).toBe(false);
	});
});
