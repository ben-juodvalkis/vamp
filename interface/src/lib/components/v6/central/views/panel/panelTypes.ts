/**
 * An instrument panel, Live's arrangement as data (ADR-487).
 *
 * A panel is a FRAME, read left to right in Live's signal order with Global
 * at the right edge, plus PAGES. A frame region is a named group of controls
 * or a tab strip over groups (Live's own tabs: Collision's Resonator 1 /
 * Resonator 2 / LFO / MIDI). A group's eyebrow can open a page, the section's
 * detail, the way Live's Electric shows the clicked section's detail below its
 * panel. Every control names its parameter as Live lists it; nothing here is an
 * index, so a section whose parameters come and go cannot shift a control onto
 * the wrong one. `InstrumentPanelView` draws a panel; the names are checked
 * against the measured reference (`docs/reference/instruments/dumps`) by
 * `instrumentPanels.test.ts`.
 */

import { KNOB_PX, knobDiameter, knobSizeFits, knobSizeFor, type KnobSize } from '$lib/components/v6/device-panel/knobLayout';

/** One control, bound to one parameter by its Live name. */
export type PanelControl =
	/**
	 * A value box over the parameter's own range; centre-origin when the range
	 * spans 0. `toggle` is the on/off parameter that belongs to it (a source's
	 * switch over its level), drawn small under it (ADR-509).
	 */
	| { kind: 'box'; param: string; title: string; toggle?: PanelToggle; knobSize?: KnobSize; units?: number }
	/**
	 * A quantized parameter with few values: one cell a value, its labels
	 * Live's own. `title` names it over a page's picker (else Live's name).
	 */
	| { kind: 'choice'; param: string; options: readonly string[]; title?: string }
	/** A quantized parameter with many values: a value box that steps, naming the value. */
	| { kind: 'step'; param: string; title: string; labels?: readonly string[]; knobSize?: KnobSize; units?: number }
	/** An on/off parameter: one cell, lit while on. */
	| { kind: 'switch'; param: string; title: string };

/** An on/off parameter drawn small under the box it belongs to. */
export interface PanelToggle {
	param: string;
	title: string;
}

export interface PanelGroup {
	/** The eyebrow: Live's section name. Omitted, the group draws an empty eyebrow line. */
	title?: string;
	controls: readonly PanelControl[];
	/** The section's on/off parameter: while off its other controls are ghosted, and touching one turns it on. */
	switchParam?: string;
	/** A page id: the eyebrow opens it ("Hammer ›"). */
	page?: string;
	/**
	 * How the group's value boxes draw, over the panel's `boxFace` (ADR-509):
	 * an envelope's stages stay boxes, since their heights draw its shape.
	 */
	face?: PanelFace;
	/**
	 * Its share of the row, in boxes, where counting its controls would
	 * mis-state it: three knobs that wrap two to a row want two boxes' width.
	 */
	units?: number;
	/**
	 * How large its knobs draw (ADR-509). Unset, by how many its column
	 * stacks (`knobSizeFor`); a control's own wins.
	 */
	knobSize?: KnobSize;
	/**
	 * How many of the face's columns it takes on a panel's frame (ADR-510),
	 * where its count would mis-state it: three knobs stacked over two
	 * columns, names beside them. Unset, a column a control (`groupColumns`).
	 */
	columns?: number;
}

/** A value box drawn as a box or as a knob (ADR-509). */
export type PanelFace = 'slider' | 'knob';

/**
 * How large a control's knob draws: its own size, else its group's, else by
 * how many knobs its column stacks (`knobSizeFor`, ADR-509).
 */
export function controlKnobSize(control: PanelControl, group: PanelGroup | undefined, stacked: number): KnobSize {
	const own = control.kind === 'box' || control.kind === 'step' ? control.knobSize : undefined;
	return own ?? group?.knobSize ?? knobSizeFor(stacked);
}

export interface PanelTab {
	title: string;
	/** Drawn as the tab's dot: filled while on, hollow while off (Sampler's tabs). */
	switchParam?: string;
	groups: readonly PanelGroup[];
}

export type PanelRegion =
	| { kind: 'group'; group: PanelGroup }
	| { kind: 'tabs'; tabs: readonly PanelTab[] }
	/**
	 * A device's own control the rule cannot draw (Operator's filter pad and
	 * its response curve), passed to the view as a snippet under `slot`; it
	 * takes `units` boxes of width, under an eyebrow like a group's. `params`
	 * names what it binds, for the reference test.
	 */
	| { kind: 'slot'; slot: string; title?: string; page?: string; units: number; columns?: number; params: readonly string[] };

export interface PanelPage {
	id: string;
	title: string;
	/** The page this one is opened from: its way back leads there, not to the frame. */
	parent?: string;
	/** One or two rows of groups, seamed within a row. */
	rows: readonly (readonly PanelGroup[])[];
	/**
	 * A device's own control drawn full height left of the rows (Drift's
	 * filter pad on its Filter page), from the view's `slots`; it takes
	 * `units` boxes of width. `params` names what it binds, for the
	 * reference test.
	 */
	aside?: { slot: string; units: number; params: readonly string[] };
}

export interface InstrumentPanel {
	frame: readonly PanelRegion[];
	pages: readonly PanelPage[];
	/** How its value and stepping boxes draw unless a group says otherwise; unset, as boxes. */
	boxFace?: PanelFace;
	/**
	 * The instrument at full screen (ADR-512): every control its frame and
	 * pages hold, on screen at once, in rows of tiles. Unset, full screen
	 * draws the frame as the band does.
	 */
	board?: PanelBoard;
}

/**
 * A full-screen board (ADR-512): rows of tiles, each tile a face grid of
 * sections, seamed, with no tab strip and no page to open. Twin sections
 * (Operator's four oscillators, Collision's two resonators and two LFOs)
 * are a `matrix`: a row a section, a column a control, each column's name
 * said once over it, so its knobs need no caption and four oscillators
 * take the height of four knobs. The rest are groups whose cells stack
 * `stack` high, column after column, with their captions.
 */
export interface PanelBoard {
	rows: readonly PanelBoardRow[];
}

export interface PanelBoardRow {
	tiles: readonly PanelBoardTile[];
	/** Its share of the board's height (1). */
	weight?: number;
}

export interface PanelBoardTile {
	/** The tile's name, `data-board-tile`. */
	id: string;
	/** The section it shows, named on the tile's header bar (ADR-516). */
	title?: string;
	/**
	 * The section's on/off parameter, drawn as the switch on the tile's bar
	 * (ADR-516): the Filter's, the LFO's, the mallet's. Counted among the
	 * board's parameters (`boardSwitches`), so the groups need no On of
	 * their own.
	 */
	switchParam?: string;
	sections: readonly PanelBoardSection[];
	/**
	 * How wide its columns come out against the row's others, px at the
	 * board's `BOARD_COLUMN_PX`: a tile whose captions are long (Collision's
	 * "Stiffness") takes a little from its neighbours.
	 */
	columnPx?: number;
}

export type PanelBoardSection =
	/**
	 * A group's cells `stack` high, column after column, each knob as large
	 * as its cell holds; an envelope's stages (`face: 'slider'`) a column
	 * each, full height, over `columns` face columns.
	 */
	| {
			kind: 'group';
			group: PanelGroup;
			stack: number;
			columns?: number;
			/** Options a choice may have and still be a tab; more is a pick (1: every choice a pick). */
			tabMax?: number;
			/**
			 * Its first `lead` controls each stand a column, the full height,
			 * the rest `stack` high after them (ADR-515: a section's primary
			 * controls large, its secondary ones stacked small beside them).
			 */
			lead?: number;
	  }
	/** Twin sections as a table: a section a group of its columns (ADR-512). */
	| { kind: 'matrix'; matrix: PanelMatrix }
	/** A device's own control (Operator's filter pad), from the view's `slots`. */
	/**
	 * The view's own control (`slots`), `columns` wide; `below` lays groups
	 * under it across the same columns, each `columns` of them and its cells
	 * `stack` high (Operator's filter: the pad over its type and shaper,
	 * 2026-11-07).
	 */
	| {
			kind: 'slot';
			slot: string;
			title?: string;
			columns: number;
			params: readonly string[];
			below?: readonly { group: PanelGroup; columns: number; stack: number }[];
	  };

/**
 * Twin sections as a table (ADR-512). A row a section, named at its left
 * (the section's switch, where it has one, is that name: lit while on); a
 * column a control of each, its name over it on the header line, columns
 * in groups with a seam between two (a group's name is drawn only with
 * `groupLine`: the header line has room for one line of names). A knob draws
 * no caption, a pick is a `ChoicePicker` naming its value, a switch a
 * touch row; a row a control does not apply to leaves its cell empty.
 */
export interface PanelMatrix {
	/** Over the rows' names, on the header line. */
	title?: string;
	/**
	 * The groups' names on the header line and the columns' on a line under
	 * it: where a column's name repeats across groups (a resonator's Decay
	 * under Velocity and under Key).
	 */
	groupLine?: boolean;
	rows: readonly PanelMatrixRow[];
	groups: readonly PanelMatrixGroup[];
}

export interface PanelMatrixRow {
	title: string;
	/** The row's section switch: its name is the switch, and its cells ghost while it is off. */
	switchParam?: string;
	/** Its switch only ghosts the row; the name stays text (the switch is drawn elsewhere on the board). */
	quiet?: boolean;
}

export interface PanelMatrixGroup {
	title: string;
	columns: readonly PanelMatrixColumn[];
}

export interface PanelMatrixColumn {
	title: string;
	/** A control a row, in the matrix's row order; none where it does not apply. */
	cells: readonly (PanelControl | undefined)[];
	/** Face columns it spans (a pick of long names: 2). */
	span?: number;
	/** Its value boxes' face, over the panel's `boxFace` (an envelope's stages: 'slider'). */
	face?: PanelFace;
}

/** An envelope's parameters by Live name, as `EnvelopeGraph` draws it (ADR-514). */
export interface PanelEnvelope {
	attack: string;
	decay: string;
	sustain: string;
	release: string;
	initial?: string;
	peak?: string;
	final?: string;
}

/**
 * How many columns a choice's cells take so each stays on the 44px touch
 * floor: five cells stand in a full-height row, two in one of a two-row
 * page's rows (about 95px), and more options spill into more columns.
 */
export function choiceColumns(options: number, pageRows = 1): number {
	return Math.ceil(options / (pageRows >= 2 ? 2 : 5));
}

/** How a group's value boxes draw: its own `face`, else the panel's. */
export function groupFace(group: PanelGroup, boxFace?: PanelFace): PanelFace {
	return group.face ?? boxFace ?? 'slider';
}

/**
 * A stepped control with this many named values or fewer is a tab of its
 * values, scrubbed like Echo's LFO wave; one with more, or with none
 * named, is a knob with a detent a value (ADR-509).
 */
export const TAB_MAX_OPTIONS = 8;

/** The values a control draws as a tab, or nothing for a control that is not one. */
export function tabOptions(control: PanelControl): readonly string[] | undefined {
	if (control.kind === 'choice') return control.options;
	if (control.kind === 'step' && control.labels && control.labels.length <= TAB_MAX_OPTIONS) return control.labels;
	return undefined;
}

/** A control's width in boxes: what a group's share of its row is counted in. */
export function controlUnits(control: PanelControl, pageRows = 1): number {
	const options = tabOptions(control);
	// A knob beside tabs can need more than one box's width to hold its size (ADR-509).
	if (!options) return control.kind === 'box' || control.kind === 'step' ? (control.units ?? 1) : 1;
	// Names ("Shark Tooth", "Rectangle") want wider cells than numbers.
	const perColumn = Math.max(...options.map((o) => o.length)) > 5 ? 1.4 : 0.9;
	return Math.max(1, choiceColumns(options.length, pageRows) * perColumn);
}

/**
 * A group's share of its row, in boxes. A group of knobs on a full-height
 * band stacks them two high (ADR-509), so it takes half as many columns as
 * it has knobs, and the boxes beside it (an envelope's stages) keep their
 * width; on a two-row page there is no height to stack in.
 */
export function groupUnits(group: PanelGroup, pageRows = 1, boxFace?: PanelFace): number {
	if (group.units !== undefined) return group.units;
	if (pageRows < 2 && isKnobGroup(group, boxFace)) return Math.ceil(group.controls.length / 2);
	return group.controls.reduce((n, c) => n + controlUnits(c, pageRows), 0);
}

export function regionUnits(region: PanelRegion, boxFace?: PanelFace): number {
	if (region.kind === 'group') return groupUnits(region.group, 1, boxFace);
	if (region.kind === 'slot') return region.units;
	return Math.max(...region.tabs.map((t) => t.groups.reduce((n, g) => n + groupUnits(g, 1, boxFace), 0)));
}

/** A group drawn as a grid of knobs: every control a value or stepping box, drawn as a knob. */
export function isKnobGroup(group: PanelGroup, boxFace?: PanelFace): boolean {
	return (
		groupFace(group, boxFace) === 'knob' &&
		group.controls.every((c) => c.kind === 'box' || (c.kind === 'step' && !tabOptions(c)))
	);
}

/**
 * How many of the face's columns a group takes on a panel's frame (ADR-510):
 * its own `columns`, else one a control, a tab of values as many as its
 * cells want (`controlUnits`, rounded).
 */
export function groupColumns(group: PanelGroup): number {
	if (group.columns !== undefined) return group.columns;
	return group.controls.reduce((n, c) => n + controlColumns(c), 0);
}

/** A control's columns on the face grid: one, or a tab's rounded width. */
export function controlColumns(control: PanelControl): number {
	return Math.max(1, Math.round(controlUnits(control, 1)));
}

/**
 * A frame region's sections on the face grid (ADR-510), each a column
 * count. A group or a slot is one section. A tab strip whose every tab
 * has the same number of groups (Operator's: its main knobs, then its
 * envelope) is a section a group, each as wide as its widest tab's, with
 * a seam between, since its knobs and boxes mix only across a seam
 * (ADR-509); one whose tabs differ (Collision's) is one section as wide as
 * its widest tab. Either way a tab switch moves no column.
 */
export function regionSections(region: PanelRegion): number[] {
	if (region.kind === 'group') return [groupColumns(region.group)];
	if (region.kind === 'slot') return [region.columns ?? region.units];
	return tabsByPosition(region.tabs)
		? region.tabs[0].groups.map((_, k) => Math.max(...region.tabs.map((t) => groupColumns(t.groups[k]))))
		: [Math.max(...region.tabs.map((t) => t.groups.reduce((n, g) => n + groupColumns(g), 0)))];
}

/** Whether a tab strip's tabs share their shape: as many groups each, more than one. */
export function tabsByPosition(tabs: readonly PanelTab[]): boolean {
	const n = tabs[0]?.groups.length ?? 0;
	return n > 1 && tabs.every((t) => t.groups.length === n);
}

/**
 * How a group of `count` knobs lays out over `cols` face columns `colW`
 * wide, in a box `height` tall (ADR-510 with ADR-509's sizes): each knob
 * column spans a whole number of face columns (the counts that divide
 * `cols`, or a knob a column in one row, any columns left over empty at
 * the end), and of those the one whose cells draw the largest size at its
 * full diameter. A row count's size is at most what its column stacks
 * (`knobSizeFor`), or `ceiling`. Ties go to one row (knobs in a row on one
 * line, as Drift's pages), then to a grid with no empty cell (three knobs
 * over two columns stack three high, names beside, rather than two and an
 * orphan: Operator's groups, 2026-11-08), then to the roomier cell.
 */
export function faceKnobFit(
	count: number,
	cols: number,
	colW: number,
	height: number,
	gap = 8,
	ceiling?: KnobSize
): { knobCols: number; rows: number; size: KnobSize } {
	const most = Math.max(1, Math.min(count, cols));
	let best = { knobCols: most, rows: Math.ceil(count / most), size: ceiling ?? knobSizeFor(Math.ceil(count / most)), px: -1, full: false, room: -Infinity };
	for (let k = 1; k <= most; k++) {
		if (cols % k && k !== count) continue;
		const rows = Math.ceil(count / k);
		const span = Math.floor(cols / k);
		const w = span * colW + (span - 1) * gap;
		const h = (height - gap * (rows - 1)) / rows;
		const size = knobSizeFits(ceiling ?? knobSizeFor(rows), w, h);
		const px = knobDiameter(size, w, h) >= KNOB_PX[size] - 0.5 ? KNOB_PX[size] : 0;
		const full = count % k === 0;
		const room = Math.min(w, h);
		const better =
			px > best.px ||
			(px === best.px && rows === 1 && best.rows > 1) ||
			(px === best.px && (rows === 1) === (best.rows === 1) && full && !best.full) ||
			(px === best.px && (rows === 1) === (best.rows === 1) && full === best.full && room > best.room + 0.5);
		if (better) best = { knobCols: k, rows, size, px, full, room };
	}
	return { knobCols: best.knobCols, rows: best.rows, size: best.size };
}

/** A control drawn as a knob in a knob-faced group: a value box, or a stepper with no tab. */
export function isKnobControl(control: PanelControl): boolean {
	return control.kind === 'box' || (control.kind === 'step' && !tabOptions(control));
}

/**
 * A mixed group's columns on a frame (ADR-510), when its `columns` is fewer
 * than a column a control: its knobs pair up, two to a column, first to
 * last, until the group fits (Operator's Filter: its type's tab, then Env
 * over Drive). Each entry is one column's controls and the columns it spans.
 */
export function frameColumns(group: PanelGroup, columns: number): { controls: PanelControl[]; span: number }[] {
	const cols = group.controls.map((c) => ({ controls: [c], span: controlColumns(c) }));
	let total = cols.reduce((n, c) => n + c.span, 0);
	for (let i = 0; i < cols.length - 1 && total > columns; ) {
		const a = cols[i];
		const b = cols[i + 1];
		if (a.controls.length === 1 && isKnobControl(a.controls[0]) && isKnobControl(b.controls[0])) {
			a.controls.push(b.controls[0]);
			cols.splice(i + 1, 1);
			total -= b.span;
		}
		i++;
	}
	return cols;
}

/**
 * On a section page (ADR-510) a tab holds this many values at most: a
 * two-high page cell is about 127px tall, room for two rows of two touch
 * cells; a one-row page's cell is the page's height, room for a column of
 * five. A longer pick is a `ChoicePicker` that opens over the view.
 */
export const PAGE_TAB_MAX = 4;
export const PAGE_TAB_MAX_ONE_ROW = 5;

/** Whether a control draws on a page as a `ChoicePicker`: a pick too long for a page's tab. */
export function pagePicks(control: PanelControl, oneRow = false): boolean {
	const max = oneRow ? PAGE_TAB_MAX_ONE_ROW : PAGE_TAB_MAX;
	if (control.kind === 'choice') return control.options.length > max;
	return control.kind === 'step' && !!control.labels && control.labels.length > max;
}

/**
 * One cell of a page's group: a control, or an amount with the pick that
 * names what it reaches under it as its caption (Collision's Dest A over
 * Amt A: a knob with its mark, the picker under it, Drift's pages' rule).
 */
export interface PageCell {
	control: PanelControl;
	picker?: PanelControl;
	mark?: string;
}

/**
 * A group's cells on a page, each pick paired with the amount after it that
 * it names: a destination and its amount end on the same letter ("Dest B"
 * over "Amt B"). A pick and an unrelated box (a loop's Retrig, then R Vel)
 * stay two cells.
 */
export function pageCells(group: PanelGroup, oneRow = false): PageCell[] {
	const cells: PageCell[] = [];
	const cs = group.controls;
	const last = (title: string) => title.split(' ').at(-1) ?? title;
	for (let i = 0; i < cs.length; i++) {
		const c = cs[i];
		const next = cs[i + 1];
		if (pagePicks(c, oneRow) && c.kind === 'step' && next?.kind === 'box' && !next.toggle && c.title.includes(' ') && last(c.title) === last(next.title)) {
			cells.push({ control: next, picker: c, mark: last(next.title).slice(0, 1) });
			i++;
		} else cells.push({ control: c });
	}
	return cells;
}

/**
 * A page lays its cells in one row, each a column the page's full height
 * (Drift's Envelopes and LFO pages), when it has this many cells or fewer:
 * at 1000px ten columns are ~85px, which holds a medium knob, and seven or
 * fewer hold a large one. A page with more stacks its cells two high.
 */
export const PAGE_ONE_ROW_MAX = 10;

/** Whether a page lays its cells in one row (`PAGE_ONE_ROW_MAX`). */
export function pageOneRow(page: PanelPage): boolean {
	const cells = page.rows.flat().reduce((n, g) => n + pageCells(g, true).length, 0);
	return cells + (page.aside?.units ?? 0) <= PAGE_ONE_ROW_MAX;
}

/**
 * A page group's columns and rows on the face grid (ADR-510). On a one-row
 * page a cell a column. On a two-high page its cells stack two high,
 * column after column, so a medium knob has its caption under it, and an
 * envelope's stages (`face: 'slider'`) stand the page's full height, two to
 * a column (their heights still draw it; a stage needs no knob's width).
 */
export function pageGroupGrid(group: PanelGroup, oneRow = false): { columns: number; rows: number; cells: number } {
	const cells = pageCells(group, oneRow).length;
	if (oneRow) return { columns: Math.max(1, cells), rows: 1, cells };
	if (group.face === 'slider') return { columns: Math.max(1, Math.ceil(cells / 2)), rows: 1, cells };
	if (cells <= 1) return { columns: 1, rows: 1, cells };
	return { columns: Math.ceil(cells / 2), rows: 2, cells };
}

/** A page's sections, its aside's first: one a group, every row's groups in one row. */
export function pageSections(page: PanelPage): number[] {
	const oneRow = pageOneRow(page);
	return [...(page.aside ? [page.aside.units] : []), ...page.rows.flat().map((g) => pageGroupGrid(g, oneRow).columns)];
}

export { knobGridFit, knobGridRows, knobSizeFor, type KnobSize } from '$lib/components/v6/device-panel/knobLayout';

/** Every parameter name a panel binds: its controls' and its switches'. */
export function panelParamNames(panel: InstrumentPanel): string[] {
	const names = new Set<string>();
	const addGroup = (g: PanelGroup) => {
		if (g.switchParam) names.add(g.switchParam);
		for (const c of g.controls) {
			names.add(c.param);
			if (c.kind === 'box' && c.toggle) names.add(c.toggle.param);
		}
	};
	for (const region of panel.frame) {
		if (region.kind === 'group') addGroup(region.group);
		else if (region.kind === 'slot') region.params.forEach((n) => names.add(n));
		else
			for (const tab of region.tabs) {
				if (tab.switchParam) names.add(tab.switchParam);
				tab.groups.forEach(addGroup);
			}
	}
	for (const page of panel.pages) {
		page.rows.forEach((row) => row.forEach(addGroup));
		page.aside?.params.forEach((n) => names.add(n));
	}
	return [...names];
}

/** A matrix column: its name, and each row's control from `make` (none where it returns none). */
export function matrixColumn<R>(title: string, rows: readonly R[], make: (row: R) => PanelControl | undefined, extra: Partial<PanelMatrixColumn> = {}): PanelMatrixColumn {
	return { title, cells: rows.map(make), ...extra };
}

/** Every section of a panel's board, row by row, tile by tile. */
export function boardSections(panel: InstrumentPanel): PanelBoardSection[] {
	return (panel.board?.rows ?? []).flatMap((r) => r.tiles.flatMap((t) => [...t.sections]));
}

/** Every control a panel's board draws: its groups' and its matrices' cells. */
export function boardControls(panel: InstrumentPanel): PanelControl[] {
	return boardSections(panel).flatMap((s) =>
		s.kind === 'group'
			? [...s.group.controls]
			: s.kind === 'matrix'
				? s.matrix.groups.flatMap((g) => g.columns.flatMap((c) => c.cells.filter((x): x is PanelControl => !!x)))
				: (s.below ?? []).flatMap((b) => [...b.group.controls])
	);
}

/** The on/off parameters a board's tiles, sections and matrix rows switch, and its slots' parameters. */
export function boardSwitches(panel: InstrumentPanel): string[] {
	const tiles = (panel.board?.rows ?? []).flatMap((r) => r.tiles);
	return tiles
		.flatMap((t) => (t.switchParam ? [t.switchParam] : []))
		.concat(boardSections(panel).flatMap((s) =>
		s.kind === 'group'
			? s.group.switchParam
				? [s.group.switchParam]
				: []
			: s.kind === 'matrix'
				? s.matrix.rows.flatMap((r) => (r.switchParam ? [r.switchParam] : []))
				: [...s.params, ...(s.below ?? []).flatMap((b) => (b.group.switchParam ? [b.group.switchParam] : []))]
	));
}

/**
 * Every parameter a board reaches (ADR-512): what a full-screen view puts
 * on screen without a page to open. A board binds nothing its frame and
 * pages do not (so `panelParamNames`, the frame's and pages', is what the
 * reference test checks), and should reach all of them.
 */
export function boardParamNames(panel: InstrumentPanel): string[] {
	const names = new Set<string>();
	for (const c of boardControls(panel)) {
		names.add(c.param);
		if (c.kind === 'box' && c.toggle) names.add(c.toggle.param);
	}
	for (const n of boardSwitches(panel)) names.add(n);
	return [...names];
}

/** A board group's columns: its own, else its stages a column each, else its cells `stack` high. */
export function boardGroupColumns(section: { group: PanelGroup; stack: number; columns?: number; lead?: number }): number {
	if (section.columns !== undefined) return section.columns;
	const n = section.group.controls.length;
	if (section.group.face === 'slider') return n;
	const lead = Math.min(n, section.lead ?? 0);
	return lead + (n > lead ? Math.ceil((n - lead) / section.stack) : 0) || 1;
}

/**
 * Where a board group's control sits (ADR-515): a lead control a column of
 * its own, the full height; the rest `stack` high, column after column.
 * Lines are 1-based grid lines.
 */
export function boardCellPlace(i: number, lead: number, stack: number): { column: number; row: string } {
	if (i < lead) return { column: i + 1, row: '1 / -1' };
	const j = i - lead;
	return { column: lead + 1 + Math.floor(j / stack), row: String((j % stack) + 1) };
}

/**
 * A board tile's share of its row (InstrumentBoard's `cols`): its face
 * columns, plus its inset (two, less a gutter) and its seams (each a seam
 * track and two gutters, less one) in columns of `BOARD_COLUMN_PX` with
 * their gutter, so columns come out one width across a row whatever each
 * tile's count.
 */
export const BOARD_COLUMN_PX = 60;
export function boardTileWeight(sections: readonly number[], columnPx = BOARD_COLUMN_PX): number {
	const cols = sections.reduce((a, b) => a + b, 0);
	const gutter = 8;
	const inset = 16;
	const seam = 17;
	const extra = 2 * inset - gutter + (sections.length - 1) * (seam + gutter);
	return (cols * (columnPx + gutter) + extra) / (BOARD_COLUMN_PX + gutter);
}

/**
 * A board tile's sections on its face grid, each a column count: a group
 * or a slot one section, a matrix a section a group of its columns, the
 * first with the rows' names before it.
 */
export function boardTileSections(tile: PanelBoardTile): number[] {
	return tile.sections.flatMap((s) => {
		if (s.kind === 'group') return [boardGroupColumns(s)];
		if (s.kind === 'slot') return [s.columns];
		return s.matrix.groups.map((g, i) => g.columns.reduce((n, c) => n + (c.span ?? 1), i === 0 ? 1 : 0));
	});
}
