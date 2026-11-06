/**
 * How an instrument panel lays out its knobs (ADR-509): a group of knobs
 * wraps into the grid that gives each knob the most room, and boxes kept as
 * boxes in a knob panel go thin so the knobs beside them get the width.
 */
import { describe, it, expect } from 'vitest';
import {
	controlUnits,
	groupUnits,
	isKnobGroup,
	knobGridRows,
	knobSizeFor,
	controlKnobSize,
	panelParamNames,
	tabOptions,
	TAB_MAX_OPTIONS,
	type PanelGroup
} from '$lib/components/v6/central/views/panel/panelTypes';
import { DRIFT_PANEL } from '$lib/components/v6/central/views/panel/driftPanel';
import { OPERATOR_PANEL } from '$lib/components/v6/central/views/panel/operatorPanel';
import { ELECTRIC_PANEL } from '$lib/components/v6/central/views/panel/electricPanel';
import { COLLISION_PANEL } from '$lib/components/v6/central/views/panel/collisionPanel';
import { ANALOG_PANEL } from '$lib/components/v6/central/views/panel/analogPanel';
import { WAVETABLE_PANEL } from '$lib/components/v6/central/views/panel/wavetablePanel';
import { MELD_PANEL } from '$lib/components/v6/central/views/panel/meldPanel';

const knobs: PanelGroup = {
	title: 'Global',
	controls: [
		{ kind: 'box', param: 'Time', title: 'Time' },
		{ kind: 'box', param: 'Tone', title: 'Tone' },
		{ kind: 'box', param: 'Volume', title: 'Volume' }
	]
};
const envelope: PanelGroup = { ...knobs, title: 'Envelope', face: 'slider' };

describe('knobGridRows', () => {
	it('stands knobs side by side in a wide, short box', () => {
		expect(knobGridRows(3, 600, 160)).toBe(1);
	});
	it('wraps them two to a row in a box as tall as it is wide', () => {
		expect(knobGridRows(3, 260, 300)).toBe(2);
	});
	it('stacks them in a tall, narrow one', () => {
		expect(knobGridRows(3, 160, 520)).toBe(3);
	});
	it('picks the grid whose knobs are largest, counting the caption under each', () => {
		// 4 in 400 x 300: one row gives 80px cells but 248px of height; two
		// rows give 192px cells and 142px of height less the caption.
		expect(knobGridRows(4, 400, 300)).toBe(2);
	});
});

describe('which groups are knob grids', () => {
	it('is a group of value boxes drawn as knobs', () => {
		expect(isKnobGroup(knobs, 'knob')).toBe(true);
		expect(isKnobGroup(knobs, undefined)).toBe(false);
		expect(isKnobGroup(envelope, 'knob')).toBe(false);
	});
	it('is not a group with a switch or a chooser in it', () => {
		const mixed: PanelGroup = { controls: [...knobs.controls, { kind: 'switch', param: 'On', title: 'On' }] };
		expect(isKnobGroup(mixed, 'knob')).toBe(false);
	});
});

describe('a group’s share of its row', () => {
	it('stacks knobs two high on a full-height band: half as many columns as knobs', () => {
		expect(groupUnits(knobs, 1, 'knob')).toBe(2);
		expect(groupUnits({ ...knobs, controls: [...knobs.controls, knobs.controls[0]] }, 1, 'knob')).toBe(2);
	});
	it('stands them in one row on a two-row page, where there is no height to stack in', () => {
		expect(groupUnits(knobs, 2, 'knob')).toBe(3);
	});
	it('gives boxes their full width, knob panel or not', () => {
		expect(groupUnits(envelope, 1, 'knob')).toBe(3);
		expect(groupUnits(envelope, 1, undefined)).toBe(3);
		expect(controlUnits({ kind: 'switch', param: 'On', title: 'On' }, 1)).toBe(1);
	});
	it('takes a group’s own units over its count', () => {
		expect(groupUnits({ ...knobs, units: 1 }, 1, 'knob')).toBe(1);
	});
});

describe.each([
	['Drift', DRIFT_PANEL],
	['Operator', OPERATOR_PANEL],
	['Electric', ELECTRIC_PANEL],
	['Collision', COLLISION_PANEL],
	['Analog', ANALOG_PANEL],
	['Wavetable', WAVETABLE_PANEL],
	['Meld', MELD_PANEL]
])('%s panel', (_name, panel) => {
	it('draws knobs but keeps every envelope’s stages as boxes', () => {
		expect(panel.boxFace).toBe('knob');
		const groups = [
			...panel.pages.flatMap((p) => p.rows.flat()),
			...panel.frame.flatMap((r) => (r.kind === 'group' ? [r.group] : r.kind === 'tabs' ? r.tabs.flatMap((t) => t.groups) : []))
		];
		// An envelope's stages: an Attack and a Release in one group.
		const stages = groups.filter((g) => g.controls.some((c) => / Attack$/.test(c.param)) && g.controls.some((c) => / (Release|Rel)$/.test(c.param)));
				expect(stages.filter((g) => g.face !== 'slider').map((g) => `${g.title}: ${g.controls.map((c) => c.param).join(', ')}`)).toEqual([]);
	});
});

describe('switches under knobs and a page’s aside', () => {
	it('binds a box’s toggle and a page aside’s parameters, so the reference test reads them', () => {
		const names = panelParamNames(DRIFT_PANEL);
		expect(names).toEqual(expect.arrayContaining(['Osc 1 On', 'Osc 2 On', 'Noise On']));
		expect(DRIFT_PANEL.pages.find((p) => p.id === 'filter')?.aside?.slot).toBe('filter');
	});
	it('draws Drift’s sources as levels with their switch under each', () => {
		const mix = DRIFT_PANEL.pages.flatMap((p) => p.rows.flat()).find((g) => g.title === 'Osc Mix')!;
		expect(mix.controls.map((c) => (c.kind === 'box' ? c.toggle?.param : c.kind))).toEqual(['Osc 1 On', 'Osc 2 On', 'Noise On']);
	});
});

describe('few values are a tab, many a knob (ADR-509)', () => {
	it('draws a stepper with up to eight named values as a tab of them', () => {
		const oct = { kind: 'step', param: 'Osc 1 Oct', title: 'Oct', labels: ['-2', '-1', '0', '+1', '+2', '+3'] } as const;
		expect(tabOptions(oct)).toEqual(oct.labels);
		expect(controlUnits(oct, 1)).toBeGreaterThanOrEqual(1);
	});
	it('keeps a stepper with more values, or none named, a knob', () => {
		const many = { kind: 'step', param: 'Wave', title: 'Wave', labels: Array.from({ length: TAB_MAX_OPTIONS + 1 }, (_, i) => String(i)) } as const;
		expect(tabOptions(many)).toBeUndefined();
		expect(tabOptions({ kind: 'step', param: 'Voices', title: 'Voices' })).toBeUndefined();
	});
	it('takes a group with a tab out of the knob grid: it stands in a row', () => {
		const group: PanelGroup = { controls: [knobs.controls[0], { kind: 'step', param: 'Oct', title: 'Oct', labels: ['0', '1'] }] };
		expect(isKnobGroup(group, 'knob')).toBe(false);
	});
	it('turns Drift’s octaves into a tab and keeps Operator’s 23 waves a knob', () => {
		const steps = (p: typeof DRIFT_PANEL) => p.pages.flatMap((pg) => pg.rows.flat()).flatMap((g) => g.controls).filter((c) => c.kind === 'step');
		expect(steps(DRIFT_PANEL).find((c) => c.title === 'Oct') && tabOptions(steps(DRIFT_PANEL).find((c) => c.title === 'Oct')!)).toHaveLength(6);
		expect(tabOptions(steps(OPERATOR_PANEL).find((c) => c.title === 'Wave')!)).toBeUndefined();
	});
});

describe('a knob’s size, by how many its column stacks', () => {
	it('is large for one or two, medium for three, small for four or more', () => {
		expect([1, 2, 3, 4, 6].map(knobSizeFor)).toEqual(['l', 'l', 'm', 's', 's']);
	});
	it('takes a panel control’s own size, then its group’s, then the count', () => {
		const box = knobs.controls[0];
		expect(controlKnobSize(box, knobs, 3)).toBe('m');
		expect(controlKnobSize(box, { ...knobs, knobSize: 's' }, 1)).toBe('s');
		expect(controlKnobSize({ kind: 'box', param: 'Time', title: 'Time', knobSize: 'l' }, { ...knobs, knobSize: 's' }, 4)).toBe('l');
	});
});
