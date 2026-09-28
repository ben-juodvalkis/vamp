import { describe, it, expect } from 'vitest';
import {
	screenKind,
	buildCrumbs,
	pathForCrumb,
	computeGridLayout,
	computeGroupedGridLayout,
	computeVisibleWindow,
	computeGroupedVisibleWindow,
	groupPresetsByOrigin,
	packGroupedSections,
	replaceLanding,
	windowsEqual,
	groupedWindowsEqual,
	type GroupedSectionSpec
} from '$lib/components/v6/browser/utils/drillDownModel';

describe('drillDownModel — screenKind', () => {
	it('shows categories when no vendor is selected', () => {
		expect(screenKind(false, [])).toBe('categories');
		expect(screenKind(false, ['Perc'])).toBe('categories');
	});

	it('shows folders when subfolders exist (strict one-type-per-screen)', () => {
		expect(screenKind(true, ['Perc', 'Damage'])).toBe('folders');
	});

	it('shows presets only at a leaf level (no subfolders)', () => {
		expect(screenKind(true, [])).toBe('presets');
	});
});

describe('drillDownModel — buildCrumbs', () => {
	it('returns no crumbs when no category selected', () => {
		expect(buildCrumbs(null, [])).toEqual([]);
		expect(buildCrumbs(null, ['Perc'])).toEqual([]);
	});

	it('starts with the category root at index -1', () => {
		expect(buildCrumbs('Drum', [])).toEqual([{ label: 'Drum', index: -1 }]);
	});

	it('adds one indexed crumb per path segment', () => {
		expect(buildCrumbs('Drum', ['Perc', 'Designer Drums'])).toEqual([
			{ label: 'Drum', index: -1 },
			{ label: 'Perc', index: 0 },
			{ label: 'Designer Drums', index: 1 }
		]);
	});
});

describe('drillDownModel — pathForCrumb', () => {
	const path = ['Perc', 'Designer Drums', 'Kits'];

	it('clears the path for the category root (-1)', () => {
		expect(pathForCrumb(path, -1)).toEqual([]);
	});

	it('keeps segments up to and including the tapped index', () => {
		expect(pathForCrumb(path, 0)).toEqual(['Perc']);
		expect(pathForCrumb(path, 1)).toEqual(['Perc', 'Designer Drums']);
		expect(pathForCrumb(path, 2)).toEqual(path);
	});
});

describe('drillDownModel — computeGridLayout', () => {
	// A representative iPad stage (landscape content area minus rail/bar).
	const STAGE = { width: 1100, height: 820, gap: 12, minTile: 150, targetAspect: 1.15 };

	it('gives few items fewer, bigger columns', () => {
		const five = computeGridLayout({ ...STAGE, count: 5 });
		// 5 items shouldn't fan out to a thin 6-across; expect a modest column count.
		expect(five.columns).toBeGreaterThanOrEqual(2);
		expect(five.columns).toBeLessThanOrEqual(4);
		expect(five.rows * five.columns).toBeGreaterThanOrEqual(5);
	});

	it('gives many items more columns and scrolls', () => {
		const many = computeGridLayout({ ...STAGE, count: 65 });
		expect(many.columns).toBeGreaterThanOrEqual(4);
		expect(many.scrolls).toBe(true);
	});

	it('never makes a tile narrower than the min tap size', () => {
		const many = computeGridLayout({ ...STAGE, count: 200 });
		expect(many.tileWidth).toBeGreaterThanOrEqual(STAGE.minTile - 1);
	});

	it('keeps tiles within a comfortable, roughly-square aspect', () => {
		// Excludes the degenerate 1–2 item cases where filling forces an extreme.
		for (const count of [3, 5, 7, 9, 16, 40]) {
			const l = computeGridLayout({ ...STAGE, count });
			const aspect = l.tileWidth / l.tileHeight;
			expect(aspect).toBeGreaterThan(0.55);
			expect(aspect).toBeLessThan(1.9);
		}
	});

	it('packs 9 items into a 3x3 with no dead row', () => {
		const nine = computeGridLayout({ ...STAGE, count: 9 });
		expect(nine.columns).toBe(3);
		expect(nine.rows).toBe(3);
		expect(nine.columns * nine.rows).toBe(9); // fully packed, no empty cells
	});

	it('prefers fully-packed grids (no partially-empty last row when it fits)', () => {
		for (const count of [4, 6, 9, 12, 16, 20]) {
			const l = computeGridLayout({ ...STAGE, count });
			if (!l.scrolls) {
				const empty = l.columns * l.rows - count;
				expect(empty).toBeLessThanOrEqual(1); // at most a single trailing gap
			}
		}
	});

	it('tiles grow to FILL the stage when the content fits (few items)', () => {
		const nine = computeGridLayout({ ...STAGE, count: 9 });
		expect(nine.scrolls).toBe(false);
		// The laid-out rows should consume ~all of the stage height, not cap short.
		const used = nine.rows * nine.tileHeight + STAGE.gap * (nine.rows - 1);
		expect(used).toBeGreaterThan(STAGE.height * 0.9);
	});

	it('degrades gracefully with a zero-size stage', () => {
		const l = computeGridLayout({ width: 0, height: 0, count: 10 });
		expect(l.columns).toBeGreaterThanOrEqual(1);
	});

	it('minTileHeight defaults to minTile (square floor) when omitted', () => {
		// A large count forces the height floor. With no minTileHeight, the tile
		// height should not fall below the width min.
		const many = computeGridLayout({ ...STAGE, count: 200 });
		expect(many.tileHeight).toBeGreaterThanOrEqual(STAGE.minTile - 1);
	});

	it('a shorter minTileHeight packs more rows before scrolling', () => {
		const tall = computeGridLayout({ ...STAGE, count: 60 });
		const short = computeGridLayout({ ...STAGE, count: 60, minTileHeight: 110 });
		// A shorter height floor never yields fewer visible rows per screen height,
		// and lets tiles shrink shorter than the width floor when scrolling.
		expect(short.tileHeight).toBeLessThanOrEqual(tall.tileHeight + 0.5);
		expect(short.tileHeight).toBeGreaterThanOrEqual(110 - 1);
	});

	it('keeps the width floor even when the height floor is shorter', () => {
		const short = computeGridLayout({ ...STAGE, count: 200, minTileHeight: 110 });
		expect(short.tileWidth).toBeGreaterThanOrEqual(STAGE.minTile - 1);
		expect(short.tileHeight).toBeGreaterThanOrEqual(110 - 1);
	});
});

describe('drillDownModel — groupPresetsByOrigin', () => {
	const p = (path: string) => ({ path });

	it('groups flattened presets by their first subfolder under the current node', () => {
		// Standing in Keys > Electric > Rhodes Synth (a depth-capped folder): the
		// generator rolled the sub-genre folders up. Recover them for display.
		const groups = groupPresetsByOrigin(
			[
				p('Ableton/Keys/Electric/Rhodes Synth/Ambient Dreams/Warm.adg'),
				p('Ableton/Keys/Electric/Rhodes Synth/Warm Tones/Bright.adg'),
				p('Ableton/Keys/Electric/Rhodes Synth/Ambient Dreams/Deep.adg')
			],
			['Electric', 'Rhodes Synth']
		);
		expect(groups.map((g) => g.folder)).toEqual(['Ambient Dreams', 'Warm Tones']);
		expect(groups[0].presets).toHaveLength(2);
		expect(groups[1].presets).toHaveLength(1);
	});

	it('puts presets living directly in the folder in a leading loose (null) bucket', () => {
		const groups = groupPresetsByOrigin(
			[
				p('Ableton/Keys/Electric/Rhodes Synth/Classic.adg'),
				p('Ableton/Keys/Electric/Rhodes Synth/Ambient Dreams/Warm.adg')
			],
			['Electric', 'Rhodes Synth']
		);
		expect(groups.map((g) => g.folder)).toEqual([null, 'Ambient Dreams']);
		expect(groups[0].presets).toHaveLength(1);
	});

	it('returns a single loose bucket when nothing was flattened (plain leaf)', () => {
		const groups = groupPresetsByOrigin(
			[p('Ableton/Drum/Perc/Kits/909.adg'), p('Ableton/Drum/Perc/Kits/808.adg')],
			['Perc', 'Kits']
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].folder).toBeNull();
		expect(groups[0].presets).toHaveLength(2);
	});

	it('merges same-named origin folders that differ only by case (first-seen casing wins)', () => {
		// Merged multi-vendor trees can spell the same logical subfolder with
		// different casing; two near-identical sections would read as noise.
		const groups = groupPresetsByOrigin(
			[
				p('VendorA/T/Bank/Ambient/a.adg'),
				p('VendorB/T/Bank/ambient/b.adg'),
				p('VendorA/T/Bank/Ambient/c.adg')
			],
			['Bank']
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].folder).toBe('Ambient');
		expect(groups[0].presets).toHaveLength(3);
	});

	it('sorts named groups case-insensitively, loose bucket first', () => {
		const groups = groupPresetsByOrigin(
			[
				p('X/Y/Bank/zeta/a.adg'),
				p('X/Y/Bank/Alpha/b.adg'),
				p('X/Y/Bank/loose.adg'),
				p('X/Y/Bank/beta/c.adg')
			],
			['Bank']
		);
		expect(groups.map((g) => g.folder)).toEqual([null, 'Alpha', 'beta', 'zeta']);
	});

	it('attributes a deeper subtree to its FIRST subfolder so it stays together', () => {
		const groups = groupPresetsByOrigin(
			[
				p('V/T/Electric/Rhodes/Ambient Dreams/Vintage/Old.adg'),
				p('V/T/Electric/Rhodes/Ambient Dreams/New.adg')
			],
			['Electric', 'Rhodes']
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].folder).toBe('Ambient Dreams');
		expect(groups[0].presets).toHaveLength(2);
	});

	it('groups correctly when an elided single-child wrapper splits the navigated path', () => {
		// flattenMergedFolders (generator, pre-cap) elides single-child wrapper dirs
		// from the browsable tree, but preset.path keeps the physical chain. The
		// browser shows Electric > Rhodes for a disk chain Electric/Wrapper/Rhodes/…,
		// so currentPath must match as a NON-CONTIGUOUS subsequence — a contiguous
		// match would silently dump every one of these into the loose bucket.
		const groups = groupPresetsByOrigin(
			[
				p('Vendor/Keys/Electric/Wrapper/Rhodes/Ambient/warm.adg'),
				p('Vendor/Keys/Electric/Wrapper/Rhodes/Bright/lead.adg'),
				p('Vendor/Keys/Electric/Wrapper/Rhodes/loose.adg')
			],
			['Electric', 'Rhodes']
		);
		expect(groups.map((g) => g.folder)).toEqual([null, 'Ambient', 'Bright']);
		expect(groups[0].presets).toHaveLength(1);
	});

	it('anchors on the occurrence nearest the file so a repeated prefix name cannot mis-split', () => {
		// The type directory and a root folder can share a name (Ableton/Bass/Bass).
		// The split must key off the navigated folder occurrence, not the prefix.
		const groups = groupPresetsByOrigin(
			[p('Ableton/Bass/Bass/Sub/deep.adg'), p('Ableton/Bass/Bass/own.adg')],
			['Bass']
		);
		expect(groups.map((g) => g.folder)).toEqual([null, 'Sub']);
	});

	it('treats an empty current path (folder-less type root) as all-loose', () => {
		const groups = groupPresetsByOrigin(
			[p('Ableton/Keys/root1.adg'), p('Ableton/Keys/root2.adg')],
			[]
		);
		expect(groups).toEqual([
			{ folder: null, presets: [p('Ableton/Keys/root1.adg'), p('Ableton/Keys/root2.adg')] }
		]);
	});

	it('drops an unmatchable path into the loose bucket instead of losing it', () => {
		const groups = groupPresetsByOrigin(
			[p('Somewhere/Else/entirely.adg'), p('X/Bank/Sub/a.adg')],
			['Bank']
		);
		expect(groups.map((g) => g.folder)).toEqual([null, 'Sub']);
		expect(groups[0].presets[0].path).toBe('Somewhere/Else/entirely.adg');
	});

	it('preserves the incoming (baked-alphabetical) preset order within a group', () => {
		const groups = groupPresetsByOrigin(
			[p('A/B/Folder/Sub/Aaa.adg'), p('A/B/Folder/Sub/Bbb.adg'), p('A/B/Folder/Sub/Ccc.adg')],
			['Folder']
		);
		expect(groups[0].presets.map((x) => x.path.split('/').pop())).toEqual([
			'Aaa.adg',
			'Bbb.adg',
			'Ccc.adg'
		]);
	});

	it('returns an empty array for no presets', () => {
		expect(groupPresetsByOrigin([], ['Electric'])).toEqual([]);
	});
});

describe('drillDownModel — packGroupedSections', () => {
	// Build a group of `folder` with `n` throwaway presets.
	const grp = (folder: string | null, n: number) => ({
		folder,
		presets: Array.from({ length: n }, (_, i) => ({ path: `${folder ?? 'loose'}/${i}` }))
	});
	const shape = (bands: ReturnType<typeof packGroupedSections>) =>
		bands.map((b) => [b.kind, b.groups.map((g) => g.folder ?? '·').join(',')]);

	it('gives a big section (needs >1 tile row) its own full band', () => {
		// 8 tiles at 6 cols → 2 rows → big.
		const bands = packGroupedSections([grp('Acoustic', 8)], 6);
		expect(shape(bands)).toEqual([['full', 'Acoustic']]);
		expect(bands[0].count).toBe(8);
	});

	it('packs consecutive small sections until the row would overflow', () => {
		// cols=6: Combo1+Damaged1+Hybrid1+Metal2 = 5 (fits); +Misc3 = 8 (>6) → new band.
		const bands = packGroupedSections(
			[grp('Combo', 1), grp('Damaged', 1), grp('Hybrid', 1), grp('Metal', 2), grp('Misc', 3), grp('Random', 1)],
			6
		);
		expect(shape(bands)).toEqual([
			['packed', 'Combo,Damaged,Hybrid,Metal'],
			['packed', 'Misc,Random']
		]);
		expect(bands[0].count).toBe(5);
		expect(bands[1].count).toBe(4);
	});

	it('breaks a packed run around a big section, preserving render order', () => {
		const bands = packGroupedSections(
			[grp('A', 1), grp('Big', 12), grp('B', 2), grp('C', 2)],
			6
		);
		expect(shape(bands)).toEqual([
			['packed', 'A'],
			['full', 'Big'],
			['packed', 'B,C']
		]);
	});

	it('keeps the loose (null) bucket as a packable small section', () => {
		const bands = packGroupedSections([grp(null, 2), grp('Kicks', 2)], 6);
		expect(shape(bands)).toEqual([['packed', '·,Kicks']]);
	});

	it('a section that exactly fills the row packs alone (no room for a neighbour)', () => {
		const bands = packGroupedSections([grp('Full', 6), grp('One', 1)], 6);
		// 6 tiles === cols → one row, and adding "One" (→7) overflows, so each is its
		// own single-member packed band. A 6-wide packed band spans the full row.
		expect(shape(bands)).toEqual([['packed', 'Full'], ['packed', 'One']]);
	});

	it('falls back to one full band per section when columns are unmeasured', () => {
		const bands = packGroupedSections([grp('A', 1), grp('B', 1)], 0);
		expect(shape(bands)).toEqual([['full', 'A'], ['full', 'B']]);
	});

	it('a packed band is always exactly one tile row (count ≤ columns)', () => {
		const bands = packGroupedSections(
			[grp('A', 1), grp('B', 2), grp('C', 3), grp('D', 4), grp('E', 5)],
			6
		);
		for (const b of bands) {
			if (b.kind === 'packed') expect(b.count).toBeLessThanOrEqual(6);
		}
	});
});

describe('drillDownModel — computeGroupedGridLayout', () => {
	// The component's actual comfort constraints for preset grids.
	const STAGE = {
		width: 1100,
		height: 820,
		gap: 12,
		minTile: 150,
		minTileHeight: 110,
		targetAspect: 1.5
	};
	const HEADER = { headerHeight: 44, sectionGap: 24 };

	it('matches the plain grid EXACTLY once the content scrolls (the tile-parity invariant)', () => {
		// A real flattened wall (Inst > Wind > Winds: 716 presets in 10 sections)
		// must produce tiles indistinguishable from the plain grid at the same
		// total count — same column count, same tile size. This is the invariant
		// the scrapped first attempt broke.
		const groups = [1, 23, 27, 18, 7, 30, 10, 4, 593, 3];
		const grouped = computeGroupedGridLayout({
			...STAGE,
			...HEADER,
			groups,
			headerCount: groups.length
		});
		const plain = computeGridLayout({ ...STAGE, count: 716 });
		expect(grouped.scrolls).toBe(true);
		expect(grouped.columns).toBe(plain.columns);
		expect(grouped.tileWidth).toBeCloseTo(plain.tileWidth, 5);
		expect(grouped.tileHeight).toBeCloseTo(plain.tileHeight, 5);
	});

	it('reduces to computeGridLayout for a single headerless section', () => {
		for (const count of [3, 9, 40, 200]) {
			const grouped = computeGroupedGridLayout({
				...STAGE,
				...HEADER,
				groups: [count],
				headerCount: 0
			});
			expect(grouped).toEqual(computeGridLayout({ ...STAGE, count }));
		}
	});

	it('fits small grouped content within the stage, headers included (no scroll)', () => {
		const grouped = computeGroupedGridLayout({
			...STAGE,
			...HEADER,
			groups: [3, 3],
			headerCount: 2
		});
		expect(grouped.scrolls).toBe(false);
		const rowGaps = 0; // one row per section at the chosen column count
		const content =
			2 * HEADER.headerHeight + HEADER.sectionGap + grouped.rows * grouped.tileHeight + rowGaps;
		expect(content).toBeLessThanOrEqual(STAGE.height + 0.5);
	});

	it('sums rows per-section (each section rounds up to whole rows)', () => {
		const grouped = computeGroupedGridLayout({
			...STAGE,
			...HEADER,
			groups: [7, 5, 1],
			headerCount: 3
		});
		const perSection = [7, 5, 1].map((n) => Math.ceil(n / grouped.columns));
		expect(grouped.rows).toBe(perSection.reduce((a, b) => a + b, 0));
	});

	it('never uses more columns than the largest section can fill', () => {
		const grouped = computeGroupedGridLayout({
			...STAGE,
			...HEADER,
			groups: [2, 2, 2],
			headerCount: 3
		});
		expect(grouped.columns).toBeLessThanOrEqual(2);
	});

	it('keeps the min tap width under load, like the plain grid', () => {
		const grouped = computeGroupedGridLayout({
			...STAGE,
			...HEADER,
			groups: [300, 250, 166],
			headerCount: 3
		});
		expect(grouped.tileWidth).toBeGreaterThanOrEqual(STAGE.minTile - 1);
		expect(grouped.tileHeight).toBeGreaterThanOrEqual(STAGE.minTileHeight - 1);
	});

	it('ignores empty sections and degrades gracefully to zero content', () => {
		const some = computeGroupedGridLayout({
			...STAGE,
			...HEADER,
			groups: [0, 4, 0],
			headerCount: 1
		});
		expect(some.rows).toBe(Math.ceil(4 / some.columns));
		const none = computeGroupedGridLayout({ ...STAGE, ...HEADER, groups: [], headerCount: 0 });
		expect(none.rows).toBe(0);
		expect(none.scrolls).toBe(false);
	});
});

// ── Row windowing (ADR-404) ──────────────────────────────────────────────────

describe('drillDownModel — computeVisibleWindow', () => {
	// columns=4, tileHeight=100, gap=10 → row pitch 110.
	const GRID = { columns: 4, tileHeight: 100, gap: 10, overscanRows: 2 };
	const fullHeight = (count: number, columns: number, tileHeight: number, gap: number) => {
		const rows = Math.ceil(count / columns);
		return rows * tileHeight + (rows - 1) * gap;
	};
	// The height the windowed DOM produces: pads + rendered rows (+ their gaps).
	const domHeight = (
		w: ReturnType<typeof computeVisibleWindow>,
		columns: number,
		tileHeight: number,
		gap: number
	) => {
		const rows = Math.ceil((w.end - w.start) / columns);
		const content = rows > 0 ? rows * tileHeight + (rows - 1) * gap : 0;
		return w.topPad + content + w.bottomPad;
	};

	it('renders everything when the content fits the viewport', () => {
		const w = computeVisibleWindow({ ...GRID, scrollTop: 0, viewportHeight: 2000, count: 12 });
		expect(w).toEqual({ start: 0, end: 12, topPad: 0, bottomPad: 0 });
	});

	it('windows a deep scroll position to the visible rows plus overscan', () => {
		// scrollTop 1100 → first visible row 10; viewport 500 → last visible row 15.
		const w = computeVisibleWindow({ ...GRID, scrollTop: 1100, viewportHeight: 500, count: 1000 });
		expect(w.start).toBe((10 - 2) * 4);
		expect(w.end).toBe((15 + 2) * 4);
		expect(w.topPad).toBe(8 * 110);
		expect(w.bottomPad).toBe((250 - 17) * 110);
	});

	it('keeps the scroll height pixel-identical to the full render at any scroll position', () => {
		const count = 777; // partial last row on purpose
		const expected = fullHeight(count, GRID.columns, GRID.tileHeight, GRID.gap);
		for (let scrollTop = 0; scrollTop <= expected; scrollTop += 137) {
			const w = computeVisibleWindow({ ...GRID, scrollTop, viewportHeight: 480, count });
			expect(domHeight(w, GRID.columns, GRID.tileHeight, GRID.gap)).toBe(expected);
			expect(w.start).toBeLessThanOrEqual(w.end);
			expect(w.start % GRID.columns).toBe(0); // slices start on a row boundary
			expect(w.end).toBeLessThanOrEqual(count);
		}
	});

	it('clamps rubber-band overshoot at both ends', () => {
		const under = computeVisibleWindow({ ...GRID, scrollTop: -300, viewportHeight: 400, count: 400 });
		expect(under.start).toBe(0);
		expect(under.topPad).toBe(0);
		const over = computeVisibleWindow({ ...GRID, scrollTop: 999999, viewportHeight: 400, count: 400 });
		expect(over.end).toBe(400);
		expect(over.end - over.start).toBeGreaterThan(0); // always at least one row
		expect(over.bottomPad).toBe(0);
	});

	it('falls back to render-everything for degenerate (unmeasured) input', () => {
		expect(
			computeVisibleWindow({ ...GRID, tileHeight: 0, scrollTop: 0, viewportHeight: 500, count: 50 })
		).toEqual({ start: 0, end: 50, topPad: 0, bottomPad: 0 });
		expect(
			computeVisibleWindow({ ...GRID, scrollTop: 0, viewportHeight: 0, count: 50 })
		).toEqual({ start: 0, end: 50, topPad: 0, bottomPad: 0 });
	});

	it('returns the empty window for an empty list', () => {
		expect(computeVisibleWindow({ ...GRID, scrollTop: 0, viewportHeight: 500, count: 0 })).toEqual({
			start: 0,
			end: 0,
			topPad: 0,
			bottomPad: 0
		});
	});

	it('windowsEqual compares the full window identity', () => {
		const a = { start: 0, end: 8, topPad: 0, bottomPad: 220 };
		expect(windowsEqual(a, { ...a })).toBe(true);
		expect(windowsEqual(a, { ...a, end: 12 })).toBe(false);
		expect(windowsEqual(a, { ...a, bottomPad: 110 })).toBe(false);
	});
});

describe('drillDownModel — computeGroupedVisibleWindow', () => {
	// columns=2, tileHeight=100, gap=10 (pitch 110), sectionGap=24, overscan=1.
	// Sections: loose (6 tiles, 18px lead pad), "Kicks" (8), "Snares" (100):
	//   s0: 3 rows, height 338          top 0
	//   s1: 4 rows, height 44+430=474   top 362
	//   s2: 50 rows, height 44+5490=5534 top 860 → total 6394
	const SECTIONS: GroupedSectionSpec[] = [
		{ count: 6, headerHeight: 0, leadPad: 18 },
		{ count: 8, headerHeight: 44 },
		{ count: 100, headerHeight: 44 }
	];
	const GRID = { columns: 2, tileHeight: 100, gap: 10, sectionGap: 24, overscanRows: 1 };
	const TOTAL = 6394;

	// The height the windowed DOM produces, mirroring the component's CSS: each
	// rendered section carries margin-bottom (sectionGap) unless it is the true
	// last child of the scroller (last section rendered AND no bottom spacer).
	const domHeight = (w: ReturnType<typeof computeGroupedVisibleWindow>) => {
		let h = w.topPad;
		w.sections.forEach((sw, i) => {
			const spec = SECTIONS[sw.section];
			const rows = Math.ceil((sw.end - sw.start) / GRID.columns);
			const content = rows > 0 ? rows * GRID.tileHeight + (rows - 1) * GRID.gap : 0;
			h += spec.headerHeight + sw.topPad + content + sw.bottomPad;
			const isTrueLastChild = i === w.sections.length - 1 && w.bottomPad === 0;
			if (!isTrueLastChild) h += GRID.sectionGap;
		});
		return h + w.bottomPad;
	};

	it('renders all sections in full for degenerate (unmeasured) input', () => {
		const w = computeGroupedVisibleWindow({
			...GRID,
			scrollTop: 0,
			viewportHeight: 0,
			sections: SECTIONS
		});
		expect(w.sections.map((s) => [s.section, s.start, s.end])).toEqual([
			[0, 0, 6],
			[1, 0, 8],
			[2, 0, 100]
		]);
		expect(w.sections[0].topPad).toBe(18); // loose lead pad survives the fallback
		expect(w.topPad).toBe(0);
		expect(w.bottomPad).toBe(0);
	});

	it('collapses fully off-screen sections into the scroller spacers', () => {
		const w = computeGroupedVisibleWindow({
			...GRID,
			scrollTop: 2000,
			viewportHeight: 400,
			sections: SECTIONS
		});
		// Window [1890, 2510] — only "Snares" (s2, rows 8..14) intersects.
		expect(w.sections).toEqual([
			{ section: 2, start: 16, end: 30, topPad: 880, bottomPad: 3850 }
		]);
		expect(w.topPad).toBe(860); // replaces s0 + gap + s1 + gap
		expect(w.bottomPad).toBe(0); // last section rendered → no bottom spacer
		expect(domHeight(w)).toBe(TOTAL);
	});

	it('windows rows inside partially visible sections and pads below the last rendered one', () => {
		const w = computeGroupedVisibleWindow({
			...GRID,
			scrollTop: 0,
			viewportHeight: 400,
			sections: SECTIONS
		});
		// Window [-110, 510]: s0 fully, s1 first row, s2 skipped entirely.
		expect(w.sections).toEqual([
			{ section: 0, start: 0, end: 6, topPad: 18, bottomPad: 0 },
			{ section: 1, start: 0, end: 2, topPad: 0, bottomPad: 330 }
		]);
		expect(w.topPad).toBe(0);
		// s2 + the gap before it, minus the margin the rendered s1 still carries.
		expect(w.bottomPad).toBe(5534);
		expect(domHeight(w)).toBe(TOTAL);
	});

	it('keeps at least one row in a section clipped to its header band', () => {
		// Window [340, 390] cuts s1's header (top 362) but ends above its first
		// row (y 406): the section must still render a row, not an empty grid.
		const w = computeGroupedVisibleWindow({
			...GRID,
			overscanRows: 0,
			scrollTop: 340,
			viewportHeight: 50,
			sections: SECTIONS
		});
		const s1 = w.sections.find((s) => s.section === 1);
		expect(s1).toBeDefined();
		expect(s1!.end - s1!.start).toBeGreaterThan(0);
		expect(domHeight(w)).toBe(TOTAL);
	});

	it('keeps the scroll height pixel-identical to the full render at any scroll position', () => {
		for (let scrollTop = 0; scrollTop <= TOTAL; scrollTop += 149) {
			const w = computeGroupedVisibleWindow({
				...GRID,
				scrollTop,
				viewportHeight: 400,
				sections: SECTIONS
			});
			expect(domHeight(w)).toBe(TOTAL);
			for (const sw of w.sections) {
				expect(sw.start).toBeLessThanOrEqual(sw.end);
				expect(sw.end).toBeLessThanOrEqual(SECTIONS[sw.section].count);
				expect(sw.start % GRID.columns).toBe(0);
			}
		}
	});

	it('pins deep rubber-band overshoot to the nearest edge section', () => {
		const w = computeGroupedVisibleWindow({
			...GRID,
			scrollTop: 999999,
			viewportHeight: 400,
			sections: SECTIONS
		});
		expect(w.sections.length).toBe(1);
		expect(w.sections[0].section).toBe(2);
		expect(w.sections[0].end - w.sections[0].start).toBeGreaterThan(0);
	});

	it('handles an empty section list', () => {
		const w = computeGroupedVisibleWindow({
			...GRID,
			scrollTop: 0,
			viewportHeight: 400,
			sections: []
		});
		expect(w).toEqual({ sections: [], topPad: 0, bottomPad: 0 });
	});

	it('groupedWindowsEqual compares sections structurally', () => {
		const w = (scrollTop: number) =>
			computeGroupedVisibleWindow({ ...GRID, scrollTop, viewportHeight: 400, sections: SECTIONS });
		expect(groupedWindowsEqual(w(0), w(0))).toBe(true);
		expect(groupedWindowsEqual(w(0), w(50))).toBe(false); // 50px crosses no row? it does: pads change
	});
});

/**
 * ADR-441 — where a Replace Inst open lands. The rule answers two questions the
 * open used to get wrong: it opened wherever the last browse ended rather than
 * on the track's own patch, and when that last browse was among SAMPLES it left
 * the pane there while `openForReplace` had already flipped the switch to MIDI
 * underneath — samples (on the Places, an empty screen) under a "Replace inst"
 * pill.
 */
describe('drillDownModel — replaceLanding', () => {
	const PLACES = ['place:drum', 'place:bass', 'place:key'] as const;
	const found = (typeId: string, path: string[]) => ({ typeId, path });

	it("lands on the Place folder holding the track's patch", () => {
		expect(
			replaceLanding({
				found: found('place:key', ['Acoustic', 'Grand']),
				knownTypeIds: PLACES,
				openButtonId: 'place:drum',
				openShowsSamples: false
			})
		).toEqual({ kind: 'land', vendorId: 'place:key', path: ['Acoustic', 'Grand'] });
	});

	it("lands on the Place's root for a patch that sits there", () => {
		expect(
			replaceLanding({ found: found('place:key', []), knownTypeIds: PLACES, openButtonId: null, openShowsSamples: false })
		).toEqual({ kind: 'land', vendorId: 'place:key', path: [] });
	});

	it('lands even from a pane among samples, or a browser never opened', () => {
		expect(
			replaceLanding({
				found: found('place:bass', ['Sub']),
				knownTypeIds: PLACES,
				openButtonId: 'place:drum',
				openShowsSamples: true
			}).kind
		).toBe('land');
		expect(
			replaceLanding({ found: found('place:bass', ['Sub']), knownTypeIds: PLACES, openButtonId: null, openShowsSamples: false })
				.kind
		).toBe('land');
	});

	/**
	 * The drift this rule exists to catch. A Place keeps one vendorId whichever
	 * half of the switch it shows, so only the pane can say it was among
	 * samples — and `openForReplace` has already flipped the switch to MIDI,
	 * which reloads the same (samples) path with the preset filter.
	 */
	it('re-skins a pane that was among samples when there is no folder to land on', () => {
		expect(
			replaceLanding({ found: null, knownTypeIds: PLACES, openButtonId: 'place:drum', openShowsSamples: true })
		).toEqual({ kind: 'reskin', vendorId: 'place:drum' });
	});

	it('leaves a preset pane exactly where it is when nothing resolved', () => {
		expect(
			replaceLanding({ found: null, knownTypeIds: PLACES, openButtonId: 'place:drum', openShowsSamples: false })
		).toEqual({ kind: 'none' });
	});

	it('does nothing when no rail button is open — there is no sample tree to leave', () => {
		expect(
			replaceLanding({ found: null, knownTypeIds: PLACES, openButtonId: null, openShowsSamples: false })
		).toEqual({ kind: 'none' });
	});

	it('does nothing for Recent, which carries no switch', () => {
		expect(
			replaceLanding({ found: null, knownTypeIds: PLACES, openButtonId: 'recent', openShowsSamples: true })
		).toEqual({ kind: 'none' });
	});

	/**
	 * An answer naming a Place the rail has no button for (a catalog regenerated
	 * under a running page) must not strand the open on a button that isn't
	 * there — it falls through to the same re-skin/leave-alone decision as no
	 * answer at all.
	 */
	it('treats a Place the rail has no button for as no answer', () => {
		expect(
			replaceLanding({
				found: found('place:vocal', ['Choir']),
				knownTypeIds: PLACES,
				openButtonId: 'place:drum',
				openShowsSamples: true
			})
		).toEqual({ kind: 'reskin', vendorId: 'place:drum' });
	});
});
