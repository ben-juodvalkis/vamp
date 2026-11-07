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
import DRIFT from '../../../../../docs/reference/instruments/dumps/Drift.json';
import ANALOG from '../../../../../docs/reference/instruments/dumps/Analog.json';
import WAVETABLE from '../../../../../docs/reference/instruments/dumps/Wavetable.json';
import MELD from '../../../../../docs/reference/instruments/dumps/Meld.json';
import { ELECTRIC_PANEL } from '$lib/components/v6/central/views/panel/electricPanel';
import { COLLISION_PANEL } from '$lib/components/v6/central/views/panel/collisionPanel';
import { OPERATOR_PANEL } from '$lib/components/v6/central/views/panel/operatorPanel';
import { DRIFT_PANEL } from '$lib/components/v6/central/views/panel/driftPanel';
import { ANALOG_PANEL } from '$lib/components/v6/central/views/panel/analogPanel';
import { WAVETABLE_PANEL } from '$lib/components/v6/central/views/panel/wavetablePanel';
import { MELD_PANEL } from '$lib/components/v6/central/views/panel/meldPanel';
import {
	boardParamNames,
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
	['Operator', OPERATOR_PANEL, OPERATOR],
	['Drift', DRIFT_PANEL, DRIFT],
	['Analog', ANALOG_PANEL, ANALOG],
	['Wavetable', WAVETABLE_PANEL, WAVETABLE],
	['Meld', MELD_PANEL, MELD]
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
		const switches = controls.flatMap((c) =>
			c.kind === 'switch' ? [c.param] : c.kind === 'box' && c.toggle ? [c.toggle.param] : []
		);
		for (const name of switches) {
			const p = byName.get(name)!;
			expect([p.min, p.max], name).toEqual([0, 1]);
		}
	});

	it('opens only pages it has', () => {
		const ids = new Set(panel.pages.map((p) => p.id));
		const linked = allGroups(panel).flatMap((g) => (g.page ? [g.page] : []));
		expect(linked.filter((id) => !ids.has(id))).toEqual([]);
	});
});

describe.each([
	['Drift', DRIFT_PANEL, DRIFT],
	['Analog', ANALOG_PANEL, ANALOG],
	['Wavetable', WAVETABLE_PANEL, WAVETABLE],
	['Meld', MELD_PANEL, MELD]
] as const)('%s panel reach', (_name, panel, dump) => {
	it('reaches every parameter but Device On', () => {
		const bound = new Set(panelParamNames(panel));
		const unreached = dump.parameters.map((p) => p.name).filter((n) => n !== 'Device On' && !bound.has(n));
		expect(unreached).toEqual([]);
	});

	it('names a parent page that exists', () => {
		const ids = new Set(panel.pages.map((p) => p.id));
		expect(panel.pages.filter((p) => p.parent && !ids.has(p.parent)).map((p) => p.id)).toEqual([]);
	});
});

/**
 * The full-screen boards (ADR-512): a board binds only what the panel's
 * frame and pages bind, and leaves out exactly what it says it does. The
 * envelopes' loop settings on Operator and the MIDI destinations on
 * Collision stay on the band's pages; Electric's board holds everything.
 */
describe('full-screen boards (ADR-512)', () => {
	const OPERATOR_LOOPS = ['Ae', 'Be', 'Ce', 'De', 'Le', 'Pe', 'Fe'].flatMap((p) => [
		`${p} Mode`,
		`${p} Loop`,
		`${p} Retrig`,
		`${p} R < Vel`
	]);
	const COLLISION_MIDI_DESTS = ['PB Dest A', 'MW Dest A', 'MW Dest B', 'Press Dest A', 'Press Dest B', 'Slide Dest A', 'Slide Dest B'];
	const cases: [string, InstrumentPanel, string[]][] = [
		['Operator', OPERATOR_PANEL, OPERATOR_LOOPS],
		['Electric', ELECTRIC_PANEL, []],
		['Collision', COLLISION_PANEL, COLLISION_MIDI_DESTS]
	];
	for (const [name, panel, omitted] of cases) {
		it(`${name}: binds nothing the panel does not, and leaves out only what it names`, () => {
			const board = new Set(boardParamNames(panel));
			const all = panelParamNames(panel);
			expect([...board].filter((n) => !all.includes(n))).toEqual([]);
			expect(all.filter((n) => !board.has(n)).sort()).toEqual([...omitted].sort());
		});
	}
});
