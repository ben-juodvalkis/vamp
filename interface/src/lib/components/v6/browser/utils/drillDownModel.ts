/**
 * Drill-down browser model helpers (pure).
 *
 * The drill-down browser shows exactly ONE layer per screen (strict
 * one-type-per-screen — folders OR presets, never mixed). These helpers decide
 * what the current screen should render from the loaded folders/presets, and
 * build the breadcrumb trail for the top bar.
 *
 * Kept pure + framework-free so it can be unit-tested without a component
 * harness (mirrors the style of the other `utils/*.ts` helpers in this dir).
 */

export type ScreenKind = 'categories' | 'folders' | 'presets';

/**
 * A single tappable breadcrumb segment.
 * `index` is the depth to truncate `currentPath` to when tapped:
 *   -1  → the category root (clear the whole path, back to category grid)
 *    0  → keep the first path segment, and so on.
 */
export interface Crumb {
	label: string;
	index: number;
}

/**
 * Decide which screen to render.
 *
 * Strict one-type-per-screen (per design decision): if any subfolders exist at
 * this level we show the FOLDER screen, ignoring any loose presets that also
 * live at the same level. Only a folder with zero subfolders shows its presets.
 * This is the predictable-navigation trade-off the user chose — occasionally an
 * extra tap, never a mixed screen.
 *
 * @param hasVendor  whether a top-level category/vendor is selected
 * @param folders    subfolder names at the current path
 */
export function screenKind(hasVendor: boolean, folders: string[]): ScreenKind {
	if (!hasVendor) return 'categories';
	return folders.length > 0 ? 'folders' : 'presets';
}

/**
 * Build the breadcrumb trail: category root, then one crumb per path segment.
 * The last crumb is the current location; earlier crumbs are tappable to jump
 * back up. Returns an empty array when no category is selected (the category
 * grid needs no breadcrumb beyond the fixed "Browser" root the component draws).
 *
 * @param categoryName  display name of the selected top-level category
 * @param path          folder-name segments from the category root
 */
export function buildCrumbs(categoryName: string | null, path: string[]): Crumb[] {
	if (!categoryName) return [];
	const crumbs: Crumb[] = [{ label: categoryName, index: -1 }];
	path.forEach((seg, i) => crumbs.push({ label: seg, index: i }));
	return crumbs;
}

/**
 * Truncate a path to the depth implied by a tapped breadcrumb `index`.
 * `index === -1` clears the path entirely (back to the category's root folder
 * listing); `index === n` keeps segments `0..n` inclusive.
 */
export function pathForCrumb(path: string[], index: number): string[] {
	if (index < 0) return [];
	return path.slice(0, index + 1);
}

// ── Preset grouping by original (pre-flatten) folder ────────────────────────
//
// The catalog generator caps folder nesting at `catalog.maxFolderDepth`
// (`capFolderDepth` in scripts/catalogShape.ts): a folder at
// the cap keeps its own presets, absorbs every preset nested below it, and
// drops the subfolder *nodes*. The structure is gone from the tree, but each
// preset still carries its full physical `path`, so the subfolder it came from
// is recoverable at render time — no catalog change needed. `groupPresetsByOrigin`
// re-clusters the flat list into those original folders for display.

/**
 * One display section of a flattened preset screen. `folder === null` is the
 * "loose" bucket: presets that live directly in the current folder (nothing to
 * attribute them to). Generic over the preset shape — only `path` is read.
 */
export interface PresetGroup<P extends { path: string }> {
	folder: string | null;
	presets: P[];
}

/**
 * Locate the origin folder of one preset relative to the folder the browser is
 * standing in: the path segment that comes right after `currentPath`, matched
 * inside the preset's physical directory chain.
 *
 * `currentPath` is matched as an ordered, NON-CONTIGUOUS subsequence anchored
 * from the right (closest to the filename). Both properties are load-bearing:
 *
 * - Non-contiguous: the generator's `flattenMergedFolders` (runs BEFORE the
 *   depth cap) elides single-child wrapper directories from the browsable tree
 *   while `preset.path` keeps the full physical chain — so the browser can show
 *   `Electric → Rhodes` for a disk chain `Electric/Wrapper/Rhodes/…`. A
 *   contiguous match would miss and silently dump those presets into the loose
 *   bucket (the exact flat wall this grouping removes).
 * - Right-anchored: vendor/type prefix segments can repeat a folder name (e.g.
 *   `Ableton/Bass/Bass/…` — the type directory and a root folder both named
 *   "Bass"). Anchoring on the occurrence nearest the file keys the split off
 *   the folder actually navigated, not the prefix.
 *
 * Returns `null` when the preset sits directly in the current folder or when
 * `currentPath` can't be found at all (defensive — such presets stay visible in
 * the loose bucket rather than disappearing).
 */
function originFolderFor(path: string, currentPath: string[]): string | null {
	if (currentPath.length === 0) return null;
	const dirs = path.split('/').slice(0, -1); // drop the filename
	let searchEnd = dirs.length; // exclusive upper bound for the next match
	let anchor = -1; // index where the LAST currentPath segment matched
	for (let j = currentPath.length - 1; j >= 0; j--) {
		let found = -1;
		for (let i = searchEnd - 1; i >= 0; i--) {
			if (dirs[i] === currentPath[j]) {
				found = i;
				break;
			}
		}
		if (found === -1) return null;
		if (j === currentPath.length - 1) anchor = found;
		searchEnd = found;
	}
	return anchor + 1 < dirs.length ? dirs[anchor + 1] : null;
}

/**
 * Re-cluster a depth-cap-flattened preset list into its original subfolders.
 * Returns the loose bucket (presets directly in the current folder) first, then
 * one group per recovered subfolder, alphabetical (case-insensitive). Preset
 * order inside each group preserves the incoming (baked-alphabetical) order.
 *
 * Buckets merge case-insensitively (first-seen casing becomes the label) —
 * merged multi-vendor trees can spell the same logical subfolder differently,
 * and the generator's own name de-dupe is already case-insensitive. Two
 * same-named-but-for-case sections would read as noise, not structure.
 *
 * A screen where nothing was flattened comes back as a single group, and the
 * caller should render the plain grid — grouping only carries information when
 * there are two or more sections.
 */
export function groupPresetsByOrigin<P extends { path: string }>(
	presets: P[],
	currentPath: string[]
): PresetGroup<P>[] {
	if (presets.length === 0) return [];
	const loose: P[] = [];
	const named = new Map<string, { folder: string; presets: P[] }>();
	for (const p of presets) {
		const origin = originFolderFor(p.path, currentPath);
		if (origin === null) {
			loose.push(p);
		} else {
			const key = origin.toLowerCase();
			const bucket = named.get(key);
			if (bucket) bucket.presets.push(p);
			else named.set(key, { folder: origin, presets: [p] });
		}
	}
	const groups: PresetGroup<P>[] = [...named.values()].sort((a, b) =>
		a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' })
	);
	if (loose.length > 0) groups.unshift({ folder: null, presets: loose });
	return groups;
}

// ── Packing small sections into shared rows (ADR-409) ───────────────────────
//
// A flattened folder often recovers many *tiny* origin sections (1–2 tiles). Left
// alone each takes its own full-width row and the rest of the line is dead space.
// This pass coalesces consecutive small sections onto a shared line: a "band" is
// either ONE big section (needs more than a single tile row → own full-width band)
// or a run of small sections (each fits in one row) greedily packed until their
// combined tile count would exceed the column count — so a packed band's tiles all
// sit on a single grid line, at the SAME tile geometry, each sub-section keeping
// its own header (folder + count). Tile size never changes; only the sections'
// horizontal arrangement does. Render order is preserved (the loose bucket, when
// present, still leads — it's a small section too and packs like the rest).
//
// Because a packed band is exactly one tile row tall, it maps cleanly onto ONE
// windowing section (ceil(sumTiles/cols) === 1), so ADR-404 row-windowing keeps
// working untouched: big bands window their rows as before, packed bands render
// whole (they're small by construction).

/** A single laid-out row of the grouped screen. */
export interface SectionBand<P extends { path: string }> {
	/** 'full' = one section spanning the whole row (big, may be many tile rows).
	    'packed' = several small sections sharing one tile row, side by side. */
	kind: 'full' | 'packed';
	/** The section(s) on this band, in render order (one for 'full'). */
	groups: PresetGroup<P>[];
	/** Total tile count across the band's sections. */
	count: number;
}

/**
 * Coalesce grouped sections into row-bands. A section is "big" (its own full band)
 * when it needs more than one tile row at `columns`; otherwise it's "small" and
 * packs greedily with following small sections while the running tile sum stays
 * ≤ `columns`. With `columns <= 0` (unmeasured stage) every section becomes its own
 * full band — the safe, pre-measurement default.
 */
export function packGroupedSections<P extends { path: string }>(
	groups: PresetGroup<P>[],
	columns: number
): SectionBand<P>[] {
	const cols = Math.max(0, Math.floor(columns));
	const bands: SectionBand<P>[] = [];
	let run: PresetGroup<P>[] = [];
	let runCount = 0;

	const flushRun = () => {
		if (run.length === 0) return;
		bands.push({ kind: 'packed', groups: run, count: runCount });
		run = [];
		runCount = 0;
	};

	for (const g of groups) {
		const n = g.presets.length;
		const isBig = cols <= 0 || n > cols;
		if (isBig) {
			flushRun();
			bands.push({ kind: 'full', groups: [g], count: n });
			continue;
		}
		// Small section: start a fresh band if adding it would overflow the row.
		if (runCount + n > cols) flushRun();
		run.push(g);
		runCount += n;
	}
	flushRun();
	return bands;
}

// ── Adaptive tile grid layout ─────────────────────────────────────────────
//
// One shared sizing system for BOTH folder and preset grids. Given the stage
// size, the item count, and comfort constraints, it picks the column count (and
// resulting row count) that makes tiles as close as possible to a comfortable
// tap size while staying roughly squarish and filling the space. Few items →
// fewer, bigger tiles that fill the stage; many items → more, smaller tiles that
// scroll. Pure + deterministic so it's unit-testable.

export interface GridConstraints {
	/** Usable stage width in px (after the grid's own padding). */
	width: number;
	/** Usable stage height in px. */
	height: number;
	/** Number of tiles to lay out. */
	count: number;
	/** Gap between tiles in px. */
	gap?: number;
	/** Smallest comfortable tile width (min tap target + column-count cap).
	    Columns are never so many that a tile would be narrower than this. */
	minTile?: number;
	/** Smallest comfortable tile height. Below this, the grid scrolls rather than
	    shrinking rows further. Defaults to `minTile` (square min). Set lower than
	    `minTile` to pack more rows onscreen while keeping the width floor. */
	minTileHeight?: number;
	/** Ideal tile aspect ratio (width / height). 1 = square. Tiles grow to FILL
	    the stage; this only steers the column-count choice. */
	targetAspect?: number;
}

export interface GridLayout {
	/** Number of columns to render. */
	columns: number;
	/** Number of rows the items occupy. */
	rows: number;
	/** Whether the laid-out content is taller than the stage (grid should scroll). */
	scrolls: boolean;
	/** Resulting tile width/height in px (for reference / tests). */
	tileWidth: number;
	tileHeight: number;
}

/**
 * Choose the grid layout that best fits `count` tiles into `width × height`.
 *
 * Strategy: try every plausible column count (1..count). For each, derive the
 * tile width from the stage width, decide a tile height — grow rows to fill the
 * stage height when the items fit, otherwise size the height off the width to
 * stay squarish and let the grid scroll — then score the result against the
 * comfort targets (tile size in the sweet spot, aspect near target). Pick the
 * best-scoring column count.
 */
export function computeGridLayout(c: GridConstraints): GridLayout {
	const gap = c.gap ?? 12;
	const minTile = c.minTile ?? 150;
	const minTileHeight = c.minTileHeight ?? minTile; // defaults to a square min
	const targetAspect = c.targetAspect ?? 1; // square-ish

	const count = Math.max(1, Math.floor(c.count));
	const width = Math.max(1, c.width);
	const height = Math.max(1, c.height);

	// Upper bound on columns: never more than items, and never so many that a
	// tile would be narrower than the min tap size.
	const maxColsByWidth = Math.max(1, Math.floor((width + gap) / (minTile + gap)));
	const maxCols = Math.min(count, Math.max(1, maxColsByWidth));

	let best: GridLayout | null = null;
	let bestScore = -Infinity;

	for (let cols = 1; cols <= maxCols; cols++) {
		const rows = Math.ceil(count / cols);

		// Tiles always use their full share of the width.
		const tileWidth = (width - gap * (cols - 1)) / cols;

		// Height that lets `rows` share the stage height exactly (grow to FILL).
		const fillHeight = (height - gap * (rows - 1)) / rows;
		// If filling would squash rows below the min height, hold at minTileHeight
		// and let the grid scroll instead. No maximum — tiles grow to fill the stage.
		const tileHeight = Math.max(fillHeight, minTileHeight);

		// Does the laid-out content overflow the stage vertically?
		const contentHeight = rows * tileHeight + gap * (rows - 1);
		const scrolls = contentHeight > height + 0.5;

		// ── Score this candidate ──
		// This chooses the COLUMN COUNT. Since tiles fill the stage, the lever is
		// the resulting aspect ratio: pick the columns whose filled tiles land
		// closest to the target (squarish), while keeping a comfortable tap size.
		const aspect = tileWidth / tileHeight;
		const aspectScore = -Math.abs(Math.log(aspect / targetAspect));

		// Comfort: gently penalize tiles whose width or height falls below its own
		// comfortable minimum (only really bites once we're scrolling). Width and
		// height are judged against their own floors so a short-tile layout isn't
		// penalized just for being shorter than it is wide.
		const widthDeficit = tileWidth >= minTile ? 0 : (minTile - tileWidth) / minTile;
		const heightDeficit =
			tileHeight >= minTileHeight ? 0 : (minTileHeight - tileHeight) / minTileHeight;
		const sizeScore = -Math.max(widthDeficit, heightDeficit);

		// Fullness: penalize a partially-empty last row (dead space). A 3×3 for 9
		// items (fully packed) should beat a 4×3 that leaves 3 empty cells. Only
		// counts when NOT scrolling — a scrolling grid's last row is offscreen.
		const cells = cols * rows;
		const emptyCells = cells - count;
		const fullnessScore = scrolls ? 0 : -(emptyCells / cells);

		const score = aspectScore * 1.8 + sizeScore * 1.4 + fullnessScore * 1.2;

		if (score > bestScore) {
			bestScore = score;
			best = { columns: cols, rows, scrolls, tileWidth, tileHeight };
		}
	}

	return best ?? { columns: 1, rows: count, scrolls: false, tileWidth: width, tileHeight: height };
}

// ── Grouped variant of the adaptive grid solver ─────────────────────────────
//
// Same solver, but the tiles are split into headed sections (one per recovered
// origin folder — see groupPresetsByOrigin). The scoring is IDENTICAL to
// computeGridLayout; only the row accounting differs: each section rounds up to
// its own whole rows, and headers + section gaps consume fixed vertical chrome.
// In the scrolling regime (any realistically flattened folder) this converges
// to the same column count and tile height as the plain grid for the same
// total count — grouped tiles must be indistinguishable from plain-grid tiles.

export interface GroupedGridConstraints extends Omit<GridConstraints, 'count'> {
	/** Tile count of each section, in render order. Zero-size sections are ignored. */
	groups: number[];
	/** How many sections render a header (the loose bucket doesn't). */
	headerCount: number;
	/** Vertical space one header consumes, in px (keep in sync with the CSS). */
	headerHeight: number;
	/** Extra vertical gap between sections (defaults to the tile gap). */
	sectionGap?: number;
}

/**
 * Choose the column count / tile size for a sectioned preset grid.
 * `rows` in the result is the total tile-row count across all sections.
 */
export function computeGroupedGridLayout(c: GroupedGridConstraints): GridLayout {
	const gap = c.gap ?? 12;
	const minTile = c.minTile ?? 150;
	const minTileHeight = c.minTileHeight ?? minTile;
	const targetAspect = c.targetAspect ?? 1;
	const sectionGap = c.sectionGap ?? gap;

	const sizes = c.groups.filter((n) => n > 0).map((n) => Math.floor(n));
	const count = sizes.reduce((a, b) => a + b, 0);
	const width = Math.max(1, c.width);
	const height = Math.max(1, c.height);
	if (count === 0) {
		return { columns: 1, rows: 0, scrolls: false, tileWidth: width, tileHeight: height };
	}

	// Fixed vertical chrome that exists regardless of tile height.
	const chromeBase = c.headerCount * c.headerHeight + (sizes.length - 1) * sectionGap;

	// Column upper bound: min tap width, and never more columns than the largest
	// section can fill (extra columns would be dead width in EVERY section).
	const maxColsByWidth = Math.max(1, Math.floor((width + gap) / (minTile + gap)));
	const maxCols = Math.min(Math.max(...sizes), Math.max(1, maxColsByWidth));

	let best: GridLayout | null = null;
	let bestScore = -Infinity;

	for (let cols = 1; cols <= maxCols; cols++) {
		const rowsPerSection = sizes.map((n) => Math.ceil(n / cols));
		const rows = rowsPerSection.reduce((a, b) => a + b, 0);
		const rowGaps = rowsPerSection.reduce((a, r) => a + (r - 1) * gap, 0);
		const chrome = chromeBase + rowGaps;

		const tileWidth = (width - gap * (cols - 1)) / cols;
		// Grow rows to fill the stage when everything fits; hold at the min height
		// and scroll otherwise (same fill-then-scroll rule as the plain grid).
		const fillHeight = (height - chrome) / rows;
		const tileHeight = Math.max(fillHeight, minTileHeight);

		const contentHeight = chrome + rows * tileHeight;
		const scrolls = contentHeight > height + 0.5;

		// Scoring — identical shape + weights to computeGridLayout.
		const aspect = tileWidth / tileHeight;
		const aspectScore = -Math.abs(Math.log(aspect / targetAspect));
		const widthDeficit = tileWidth >= minTile ? 0 : (minTile - tileWidth) / minTile;
		const heightDeficit =
			tileHeight >= minTileHeight ? 0 : (minTileHeight - tileHeight) / minTileHeight;
		const sizeScore = -Math.max(widthDeficit, heightDeficit);
		const cells = cols * rows;
		const emptyCells = cells - count;
		const fullnessScore = scrolls ? 0 : -(emptyCells / cells);

		const score = aspectScore * 1.8 + sizeScore * 1.4 + fullnessScore * 1.2;

		if (score > bestScore) {
			bestScore = score;
			best = { columns: cols, rows, scrolls, tileWidth, tileHeight };
		}
	}

	return best ?? { columns: 1, rows: count, scrolls: false, tileWidth: width, tileHeight: height };
}

// ── Row windowing (DOM virtualization, ADR-404) ─────────────────────────────
//
// The adaptive grid used to render EVERY tile of the current level, so one
// huge flat leaf (thousands of samples) meant thousands of live DOM nodes.
// Because the solvers above fix the tile geometry up front — uniform row
// height, uniform gap, known column count — the set of rows intersecting the
// viewport is pure arithmetic: no measurement pass, no library. These helpers
// window the preset list to those rows (± overscan); padding spacers stand in
// for everything off-screen so scroll height and position are pixel-identical
// to the full render.

export interface VirtualWindow {
	/** Index of the first item to render. */
	start: number;
	/** Exclusive end index of the rendered slice. */
	end: number;
	/** Padding above the rendered rows standing in for the skipped ones, px. */
	topPad: number;
	/** Padding below the rendered rows, px. */
	bottomPad: number;
}

/** Two windows produce the same DOM — skip the state write when equal. */
export function windowsEqual(a: VirtualWindow, b: VirtualWindow): boolean {
	return a.start === b.start && a.end === b.end && a.topPad === b.topPad && a.bottomPad === b.bottomPad;
}

/**
 * Window a plain (unsectioned) grid to the rows intersecting the viewport.
 *
 * Degenerate inputs (unmeasured stage, zero tile height) fall back to
 * render-everything — the behavior-preserving default for the single frame
 * before the ResizeObserver delivers a real measurement.
 *
 * Padding contract: `topPad`/`bottomPad` are set as padding on the grid
 * element itself, so row k of the rendered slice lands at exactly the y the
 * full render would put it (row pitch = tileHeight + gap; the grid's own
 * trailing edge keeps the full render's height since the final row carries no
 * trailing gap).
 */
export function computeVisibleWindow(c: {
	scrollTop: number;
	viewportHeight: number;
	count: number;
	columns: number;
	tileHeight: number;
	gap?: number;
	/** Extra rows rendered above/below the viewport so a fling doesn't outrun the DOM. */
	overscanRows?: number;
}): VirtualWindow {
	const gap = c.gap ?? 12;
	const overscan = c.overscanRows ?? 3;
	const count = Math.max(0, Math.floor(c.count));
	const columns = Math.max(1, Math.floor(c.columns));

	if (count === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
	if (c.tileHeight <= 0 || c.viewportHeight <= 0) {
		return { start: 0, end: count, topPad: 0, bottomPad: 0 };
	}

	const pitch = c.tileHeight + gap;
	const totalRows = Math.ceil(count / columns);
	// Clamp against iOS rubber-band overshoot (negative / past-the-end scrollTop).
	const top = Math.max(0, c.scrollTop);
	let firstRow = Math.max(0, Math.floor(top / pitch) - overscan);
	let lastRow = Math.min(totalRows, Math.ceil((top + c.viewportHeight) / pitch) + overscan);
	// Always render at least one row so the pad arithmetic below never has to
	// account for a rendered-nothing grid (whose CSS height loses one row gap).
	if (lastRow <= firstRow) {
		firstRow = Math.min(firstRow, totalRows - 1);
		lastRow = firstRow + 1;
	}

	return {
		start: firstRow * columns,
		end: Math.min(count, lastRow * columns),
		topPad: firstRow * pitch,
		bottomPad: (totalRows - lastRow) * pitch
	};
}

// ── Grouped (sectioned) windowing ────────────────────────────────────────────
//
// The grouped screen stacks headed sections in one scroller (ADR-403). Section
// geometry is still fully determined — header heights, per-section row counts,
// section gaps — so windowing works the same way, just with two levels of
// spacer: whole sections outside the window collapse into the scroller-level
// top/bottom spacers, and the row window INSIDE each surviving section becomes
// grid padding exactly like the plain case. A partially-visible section always
// keeps its header in the DOM, so sticky pinning is unaffected.

export interface GroupedSectionSpec {
	/** Tile count of this section. */
	count: number;
	/** Vertical space its header consumes, px; 0 = renders no header. */
	headerHeight: number;
	/** Extra padding inside the section's grid before row 0 (the loose bucket's
	    CSS `padding-top`). Included in the returned `topPad`, which REPLACES the
	    stylesheet padding when applied inline. */
	leadPad?: number;
}

export interface GroupedSectionWindow {
	/** Index into the input `sections` array. */
	section: number;
	/** Rendered slice of this section's presets (within-section indices). */
	start: number;
	end: number;
	/** Grid padding standing in for this section's off-window rows, px. */
	topPad: number;
	bottomPad: number;
}

export interface GroupedVirtualWindow {
	/** Sections intersecting the window, in render order. */
	sections: GroupedSectionWindow[];
	/** Scroller-level spacer replacing every section above the window, px.
	    Includes the inter-section gaps that would have preceded the first
	    rendered section. */
	topPad: number;
	/** Scroller-level spacer replacing every section below the window, px.
	    EXCLUDES the section gap directly after the last rendered section — the
	    section's own margin-bottom still renders it. 0 when the last section is
	    rendered (render no spacer, so the `:last-child` margin reset applies). */
	bottomPad: number;
}

export function groupedWindowsEqual(a: GroupedVirtualWindow, b: GroupedVirtualWindow): boolean {
	if (a.topPad !== b.topPad || a.bottomPad !== b.bottomPad) return false;
	if (a.sections.length !== b.sections.length) return false;
	for (let i = 0; i < a.sections.length; i++) {
		const x = a.sections[i];
		const y = b.sections[i];
		if (
			x.section !== y.section ||
			x.start !== y.start ||
			x.end !== y.end ||
			x.topPad !== y.topPad ||
			x.bottomPad !== y.bottomPad
		) {
			return false;
		}
	}
	return true;
}

/**
 * Window a sectioned preset screen to the sections + rows intersecting the
 * viewport. Same fallbacks and clamps as `computeVisibleWindow`.
 */
export function computeGroupedVisibleWindow(c: {
	scrollTop: number;
	viewportHeight: number;
	sections: GroupedSectionSpec[];
	columns: number;
	tileHeight: number;
	gap?: number;
	/** Vertical gap between sections (the section margin-bottom). */
	sectionGap?: number;
	overscanRows?: number;
}): GroupedVirtualWindow {
	const gap = c.gap ?? 12;
	const sectionGap = c.sectionGap ?? gap;
	const overscan = c.overscanRows ?? 3;
	const columns = Math.max(1, Math.floor(c.columns));

	const renderAll = (): GroupedVirtualWindow => ({
		sections: c.sections.map((s, i) => ({
			section: i,
			start: 0,
			end: s.count,
			topPad: s.leadPad ?? 0,
			bottomPad: 0
		})),
		topPad: 0,
		bottomPad: 0
	});
	if (c.sections.length === 0) return { sections: [], topPad: 0, bottomPad: 0 };
	if (c.tileHeight <= 0 || c.viewportHeight <= 0) return renderAll();

	const pitch = c.tileHeight + gap;

	// Resolve each section's y-range (top edge + height, no trailing margin).
	const geo = c.sections.map((s) => {
		const rows = Math.ceil(Math.max(0, s.count) / columns);
		const gridHeight = (s.leadPad ?? 0) + (rows > 0 ? rows * pitch - gap : 0);
		return { rows, height: s.headerHeight + gridHeight };
	});
	const tops: number[] = [];
	let y = 0;
	for (let i = 0; i < geo.length; i++) {
		tops.push(y);
		y += geo[i].height + sectionGap;
	}
	const totalHeight = y - sectionGap; // last section carries no trailing gap

	const overscanPx = overscan * pitch;
	const windowTop = Math.max(0, c.scrollTop) - overscanPx;
	const windowBottom = Math.max(0, c.scrollTop) + c.viewportHeight + overscanPx;

	const sections: GroupedSectionWindow[] = [];
	let firstIdx = -1;
	let lastIdx = -1;
	for (let i = 0; i < geo.length; i++) {
		const top = tops[i];
		const bottom = top + geo[i].height;
		if (bottom <= windowTop || top >= windowBottom) continue;
		if (firstIdx === -1) firstIdx = i;
		lastIdx = i;

		const s = c.sections[i];
		const { rows } = geo[i];
		const leadPad = s.leadPad ?? 0;
		const rowZeroTop = top + s.headerHeight + leadPad;
		let firstRow = Math.max(0, Math.floor((windowTop - rowZeroTop) / pitch));
		let lastRow = Math.min(rows, Math.ceil((windowBottom - rowZeroTop) / pitch));
		// Keep ≥1 row in a section that intersects only via its header, so the
		// pad arithmetic never meets a rendered-nothing grid (see plain variant).
		if (rows > 0 && lastRow <= firstRow) {
			firstRow = Math.min(firstRow, rows - 1);
			lastRow = firstRow + 1;
		}
		sections.push({
			section: i,
			start: firstRow * columns,
			end: Math.min(s.count, lastRow * columns),
			topPad: leadPad + firstRow * pitch,
			bottomPad: (rows - lastRow) * pitch
		});
	}
	// A window past both ends (deep rubber-band) intersects nothing — pin to the
	// nearest edge section rather than rendering an empty screen.
	if (sections.length === 0) {
		const i = windowBottom <= 0 ? 0 : geo.length - 1;
		const s = c.sections[i];
		const rows = geo[i].rows;
		const firstRow = windowBottom <= 0 ? 0 : Math.max(0, rows - 1);
		sections.push({
			section: i,
			start: firstRow * columns,
			end: Math.min(s.count, (firstRow + 1) * columns),
			topPad: (s.leadPad ?? 0) + firstRow * pitch,
			bottomPad: Math.max(0, (rows - firstRow - 1) * pitch)
		});
		firstIdx = lastIdx = i;
	}

	const lastBottom = tops[lastIdx] + geo[lastIdx].height;
	return {
		sections,
		topPad: tops[firstIdx],
		bottomPad: lastIdx >= geo.length - 1 ? 0 : Math.max(0, totalHeight - lastBottom - sectionGap)
	};
}

// ── Where a replace-instrument open lands (ADR-441) ──

/**
 * What a replace-instrument open does once its catalog lookup has answered.
 *
 * - `land`   — open this rail button at this path: the folder holding the
 *              track's own patch.
 * - `reskin` — no folder to land on, but the pane is standing in a SAMPLE tree
 *              while the source has already been flipped to instruments under
 *              it, so re-open this button against instruments.
 * - `none`   — nothing to do; leave the browser where it is.
 */
export type ReplaceLanding =
	| { kind: 'land'; vendorId: string; path: string[] }
	| { kind: 'reskin'; vendorId: string }
	| { kind: 'none' };

/**
 * Decide the above. Pure, because the two ways this goes wrong are both
 * decisions rather than plumbing: landing somewhere the rail has no button for,
 * and leaving a pane among samples after `openForReplace` forced the switch to
 * MIDI — the drift that made a replace open on samples under a "Replace inst"
 * pill.
 *
 * `openShowsSamples` is what the pane on screen was loaded with: a Place's
 * samples and clips (the switch's Simpler or Audio half) rather than its
 * presets. A Place keeps one vendorId in both halves — only the kind filter
 * changes — so the pane itself has to say which half it holds.
 */
export function replaceLanding(input: {
	/** The catalog's answer for the track's recorded patch, or null. */
	found: { typeId: string; path: string[] } | null;
	/** The Places' rail button ids (`place:drum`) — Recent and Scale are not among them. */
	knownTypeIds: readonly string[];
	/** The rail button currently open, or null if the browser has never opened. */
	openButtonId: string | null;
	/** True when the open pane shows a Place's samples, not its presets. */
	openShowsSamples: boolean;
}): ReplaceLanding {
	const { found, knownTypeIds, openButtonId, openShowsSamples } = input;
	if (found && knownTypeIds.includes(found.typeId)) {
		return { kind: 'land', vendorId: found.typeId, path: found.path };
	}
	// Nothing open, or a button with no switch (Recent) — neither can be
	// stranded among samples.
	if (!openButtonId || !knownTypeIds.includes(openButtonId)) return { kind: 'none' };
	if (!openShowsSamples) return { kind: 'none' };
	return { kind: 'reskin', vendorId: openButtonId };
}

/**
 * The Places rail's bands (browser-places plan §2): Recent and the Places,
 * in order, split across the rail's three bands as evenly as they go, the
 * LATER bands taking any extra — 5 → 1/2/2, 7 → 2/2/3, 8 → 2/3/3 (today's
 * rail exactly, with Record leading the first band), 10 → 3/3/4. The bands
 * stay three whatever the count, so their gaps stay level with the main
 * view's three rows; the buttons in a band share its height.
 */
export function railBands<T>(items: readonly T[], bands = 3): T[][] {
	const base = Math.floor(items.length / bands);
	const extra = items.length % bands;
	const out: T[][] = [];
	let at = 0;
	for (let b = 0; b < bands; b++) {
		const size = base + (b >= bands - extra ? 1 : 0);
		out.push(items.slice(at, at + size));
		at += size;
	}
	return out;
}

/**
 * The Places whose catalogs the browser keeps in memory, most recent first:
 * `id` moves to the front and whatever falls past `keep` is evicted, for the
 * caller to drop. A return to a kept Place draws with no fetch and no parse;
 * `keep` bounds the memory at that many Places' trees.
 */
export function keepRecent(list: readonly string[], id: string, keep: number): { list: string[]; evicted: string[] } {
	const next = [id, ...list.filter((x) => x !== id)];
	return { list: next.slice(0, keep), evicted: next.slice(keep) };
}
