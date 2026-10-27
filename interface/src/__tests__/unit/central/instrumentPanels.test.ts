/**
 * Instrument panels against the measured reference (ADR-487).
 *
 * A panel binds Live's parameters by name, so a name Live does not list
 * draws a ghost and writes nothing — which no shot would catch on a device
 * the mock gives the right names to. This reads the dumps Live itself
 * produced (docs/reference/instruments/dumps, `device_dump.js`, 2026-10-27)
 * and checks every name each panel binds, and that each chooser's and
 * stepper's labels count the values the parameter really has.
 */

import { describe, it, expect } from 'vitest';
import ELECTRIC from '../../../../../docs/reference/instruments/dumps/Electric.json';
import COLLISION from '../../../../../docs/reference/instruments/dumps/Collision.json';
import OPERATOR from '../../../../../docs/reference/instruments/dumps/Operator.json';
import { ELECTRIC_PANEL } from '$lib/components/v6/central/views/panel/electricPanel';
import { COLLISION_PANEL } from '$lib/components/v6/central/views/panel/collisionPanel';
import { OPERATOR_PANEL } from '$lib/components/v6/central/views/panel/operatorPanel';
import {
	panelParamNames,
	type InstrumentPanel,
	type PanelControl,
	type PanelGroup
} from '$lib/components/v6/central/views/panel/panelTypes';

interface DumpParam {
	name: string;
	min: number;
	max: number;
	is_quantized: boolean;
}

function allGroups(panel: InstrumentPanel): PanelGroup[] {
	const groups: PanelGroup[] = [];
	for (const region of panel.frame) {
		if (region.kind === 'group') groups.push(region.group);
		else if (region.kind === 'tabs') for (const tab of region.tabs) groups.push(...tab.groups);
	}
	for (const page of panel.pages) for (const row of page.rows) groups.push(...row);
	return groups;
}

const PANELS: [string, InstrumentPanel, { parameters: DumpParam[] }][] = [
	['Electric', ELECTRIC_PANEL, ELECTRIC],
	['Collision', COLLISION_PANEL, COLLISION],
	['Operator', OPERATOR_PANEL, OPERATOR]
];

describe.each(PANELS)('%s panel', (_name, panel, dump) => {
	const byName = new Map(dump.parameters.map((p) => [p.name, p]));
	const controls: PanelControl[] = allGroups(panel).flatMap((g) => [...g.controls]);

	it('binds only parameters Live lists', () => {
		const missing = panelParamNames(panel).filter((n) => !byName.has(n));
		expect(missing).toEqual([]);
	});

	it('gives every chooser one label per value', () => {
		for (const c of controls) {
			if (c.kind !== 'choice') continue;
			const p = byName.get(c.param)!;
			expect(p.is_quantized, c.param).toBe(true);
			expect(c.options.length, c.param).toBe(p.max - p.min + 1);
		}
	});

	it('gives every stepper one label per value', () => {
		for (const c of controls) {
			if (c.kind !== 'step' || !c.labels) continue;
			const p = byName.get(c.param)!;
			expect(c.labels.length, c.param).toBe(p.max - p.min + 1);
		}
	});

	it('switches only on/off parameters', () => {
		for (const c of controls) {
			if (c.kind !== 'switch') continue;
			const p = byName.get(c.param)!;
			expect([p.min, p.max], c.param).toEqual([0, 1]);
		}
	});

	it('opens only pages it has', () => {
		const ids = new Set(panel.pages.map((p) => p.id));
		const linked = allGroups(panel).flatMap((g) => (g.page ? [g.page] : []));
		expect(linked.filter((id) => !ids.has(id))).toEqual([]);
	});
});
