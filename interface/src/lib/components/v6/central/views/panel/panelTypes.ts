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

/** One control, bound to one parameter by its Live name. */
export type PanelControl =
	/** A value box over the parameter's own range; centre-origin when the range spans 0. */
	| { kind: 'box'; param: string; title: string }
	/** A quantized parameter with few values: one cell a value, its labels Live's own. */
	| { kind: 'choice'; param: string; options: readonly string[] }
	/** A quantized parameter with many values: a value box that steps, naming the value. */
	| { kind: 'step'; param: string; title: string; labels?: readonly string[] }
	/** An on/off parameter: one cell, lit while on. */
	| { kind: 'switch'; param: string; title: string };

export interface PanelGroup {
	/** The eyebrow: Live's section name. Omitted, the group draws an empty eyebrow line. */
	title?: string;
	controls: readonly PanelControl[];
	/** The section's on/off parameter: while off its other controls are ghosted, and touching one turns it on. */
	switchParam?: string;
	/** A page id: the eyebrow opens it ("Hammer ›"). */
	page?: string;
	/**
	 * How the group's value boxes draw, over the panel's `boxFace` (ADR-508):
	 * an envelope's stages stay boxes, since their heights draw its shape.
	 */
	face?: PanelFace;
	/**
	 * Its share of the row, in boxes, where counting its controls would
	 * mis-state it: three knobs that wrap two to a row want two boxes' width.
	 */
	units?: number;
}

/** A value box drawn as a box or as a knob (ADR-508). */
export type PanelFace = 'slider' | 'knob';

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
	| { kind: 'slot'; slot: string; title?: string; page?: string; units: number; params: readonly string[] };

export interface PanelPage {
	id: string;
	title: string;
	/** The page this one is opened from: its way back leads there, not to the frame. */
	parent?: string;
	/** One or two rows of groups, seamed within a row. */
	rows: readonly (readonly PanelGroup[])[];
}

export interface InstrumentPanel {
	frame: readonly PanelRegion[];
	pages: readonly PanelPage[];
	/** How its value and stepping boxes draw unless a group says otherwise; unset, as boxes. */
	boxFace?: PanelFace;
}

/**
 * How many columns a choice's cells take so each stays on the 44px touch
 * floor: five cells stand in a full-height row, two in one of a two-row
 * page's rows (about 95px), and more options spill into more columns.
 */
export function choiceColumns(options: number, pageRows = 1): number {
	return Math.ceil(options / (pageRows >= 2 ? 2 : 5));
}

/**
 * A box among knobs is thinner than a knob's cell (ADR-508): it reads tall
 * and narrow, and the width it gives up goes to the knobs beside it.
 */
export const THIN_BOX_UNITS = 0.5;

/** How a group's value boxes draw: its own `face`, else the panel's. */
export function groupFace(group: PanelGroup, boxFace?: PanelFace): PanelFace {
	return group.face ?? boxFace ?? 'slider';
}

/** A control's width in boxes: what a group's share of its row is counted in. */
export function controlUnits(control: PanelControl, pageRows = 1, thinBoxes = false): number {
	if (control.kind === 'choice') return Math.max(1, choiceColumns(control.options.length, pageRows) * 0.9);
	return thinBoxes && (control.kind === 'box' || control.kind === 'step') ? THIN_BOX_UNITS : 1;
}

/** Boxes go thin in a knob panel, where a group keeps them as boxes. */
function thinBoxes(group: PanelGroup, boxFace?: PanelFace): boolean {
	return boxFace === 'knob' && groupFace(group, boxFace) === 'slider';
}

export function groupUnits(group: PanelGroup, pageRows = 1, boxFace?: PanelFace): number {
	if (group.units !== undefined) return group.units;
	const thin = thinBoxes(group, boxFace);
	return group.controls.reduce((n, c) => n + controlUnits(c, pageRows, thin), 0);
}

export function regionUnits(region: PanelRegion, boxFace?: PanelFace): number {
	if (region.kind === 'group') return groupUnits(region.group, 1, boxFace);
	if (region.kind === 'slot') return region.units;
	return Math.max(...region.tabs.map((t) => t.groups.reduce((n, g) => n + groupUnits(g, 1, boxFace), 0)));
}

/** A group drawn as a grid of knobs: every control a value or stepping box, drawn as a knob. */
export function isKnobGroup(group: PanelGroup, boxFace?: PanelFace): boolean {
	return groupFace(group, boxFace) === 'knob' && group.controls.every((c) => c.kind === 'box' || c.kind === 'step');
}

/**
 * The rows a grid of `count` knobs takes in a `width` x `height` box so each
 * knob is as large as it can be: a knob is as wide as its cell less a little,
 * and as tall as its cell less its caption. Ties go to fewer rows.
 */
export function knobGridRows(count: number, width: number, height: number, gap = 16, caption = 52): number {
	let best = 1;
	let bestD = -Infinity;
	for (let rows = 1; rows <= count; rows++) {
		const cols = Math.ceil(count / rows);
		const w = (width - gap * (cols - 1)) / cols;
		const h = (height - gap * (rows - 1)) / rows;
		const d = Math.min(w - 8, h - caption);
		if (d > bestD + 0.5) {
			best = rows;
			bestD = d;
		}
	}
	return best;
}

/** Every parameter name a panel binds: its controls' and its switches'. */
export function panelParamNames(panel: InstrumentPanel): string[] {
	const names = new Set<string>();
	const addGroup = (g: PanelGroup) => {
		if (g.switchParam) names.add(g.switchParam);
		for (const c of g.controls) names.add(c.param);
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
	for (const page of panel.pages) page.rows.forEach((row) => row.forEach(addGroup));
	return [...names];
}
