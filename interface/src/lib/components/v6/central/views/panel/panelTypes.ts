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
}

export interface PanelTab {
	title: string;
	/** Drawn as the tab's dot: filled while on, hollow while off (Sampler's tabs). */
	switchParam?: string;
	groups: readonly PanelGroup[];
}

export type PanelRegion =
	| { kind: 'group'; group: PanelGroup }
	| { kind: 'tabs'; tabs: readonly PanelTab[] };

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
}

/**
 * How many columns a choice's cells take so each stays on the 44px touch
 * floor: five cells stand in a full-height row, two in one of a two-row
 * page's rows (about 95px), and more options spill into more columns.
 */
export function choiceColumns(options: number, pageRows = 1): number {
	return Math.ceil(options / (pageRows >= 2 ? 2 : 5));
}

/** A control's width in boxes: what a group's share of its row is counted in. */
export function controlUnits(control: PanelControl, pageRows = 1): number {
	if (control.kind !== 'choice') return 1;
	return Math.max(1, choiceColumns(control.options.length, pageRows) * 0.9);
}

export function groupUnits(group: PanelGroup, pageRows = 1): number {
	return group.controls.reduce((n, c) => n + controlUnits(c, pageRows), 0);
}

export function regionUnits(region: PanelRegion): number {
	if (region.kind === 'group') return groupUnits(region.group);
	return Math.max(...region.tabs.map((t) => t.groups.reduce((n, g) => n + groupUnits(g), 0)));
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
		else
			for (const tab of region.tabs) {
				if (tab.switchParam) names.add(tab.switchParam);
				tab.groups.forEach(addGroup);
			}
	}
	for (const page of panel.pages) page.rows.forEach((row) => row.forEach(addGroup));
	return [...names];
}
