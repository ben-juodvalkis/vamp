/**
 * Wavetable (`InstrumentVector`) in Live's arrangement (ADR-487).
 *
 * Live's panel is Osc 1 · Osc 2 (tabs) and Sub, Filter 1 · Filter 2, the
 * modulation sources Amp · Env 2 · Env 3 · LFO 1 · LFO 2 (tabs), and Global.
 * Vamp's Wavetable view draws that order already, one oscillator and one
 * filter at a time, with the wavetable display and filter curve a rule
 * would lose, so it keeps that face and its eyebrows open these pages:
 * the shown oscillator, the shown filter, the modulation sources (each one
 * a page of its own one tap in) and Global. Every parameter but Device On,
 * by Live's names (docs/reference/instruments/Wavetable.md).
 */
import type { InstrumentPanel, PanelGroup, PanelPage } from './panelTypes';

const SYNCED = [
	'8', '6', '4', '3', '2', '1.5', '1', '3/4', '1/2', '3/8', '1/3',
	'5/16', '1/4', '3/16', '1/6', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64'
];
const LOOP_MODES = ['None', 'Trigger', 'Loop'];

const SUB: PanelGroup = {
	title: 'Sub',
	switchParam: 'Sub On',
	controls: [
		{ kind: 'switch', param: 'Sub On', title: 'On' },
		{ kind: 'box', param: 'Sub Gain', title: 'Gain' },
		{ kind: 'box', param: 'Sub Tone', title: 'Tone' },
		{ kind: 'choice', param: 'Sub Transpose', options: ['0', '-1', '-2'] }
	]
};

function oscPage(v: 1 | 2): PanelPage {
	const O = `Osc ${v}`;
	return {
		id: `osc${v}`,
		title: O,
		rows: [
			[
				{
					title: O,
					switchParam: `${O} On`,
					controls: [
						{ kind: 'switch', param: `${O} On`, title: 'On' },
						{ kind: 'box', param: `${O} Pos`, title: 'Position' },
						{ kind: 'box', param: `${O} Effect 1`, title: 'Effect 1' },
						{ kind: 'box', param: `${O} Effect 2`, title: 'Effect 2' },
						{ kind: 'box', param: `${O} Transp`, title: 'Semi' },
						{ kind: 'box', param: `${O} Detune`, title: 'Detune' }
					]
				}
			],
			[
				{
					title: 'Out',
					switchParam: `${O} On`,
					controls: [
						{ kind: 'box', param: `${O} Gain`, title: 'Gain' },
						{ kind: 'box', param: `${O} Pan`, title: 'Pan' }
					]
				},
				SUB
			]
		]
	};
}

function filterPage(v: 1 | 2): PanelPage {
	const F = `Flt ${v}`;
	return {
		id: `filter${v}`,
		title: `Filter ${v}`,
		rows: [
			[
				{
					title: `Filter ${v}`,
					switchParam: `${F} On`,
					controls: [
						{ kind: 'switch', param: `${F} On`, title: 'On' },
						{ kind: 'box', param: `${F} Freq`, title: 'Freq' },
						{ kind: 'box', param: `${F} Res`, title: 'Res' },
						{ kind: 'box', param: `${F} Drive`, title: 'Drive' },
						{ kind: 'box', param: `${F} Morph`, title: 'Morph' }
					]
				}
			],
			[
				{
					title: 'Type',
					switchParam: `${F} On`,
					controls: [
						{ kind: 'choice', param: `${F} Type`, options: ['LP', 'HP', 'BP', 'Notch', 'Morph'] },
						{ kind: 'choice', param: `${F} Slope`, options: ['12', '24'] }
					]
				},
				{
					title: 'Circuit',
					switchParam: `${F} On`,
					controls: [
						{ kind: 'step', param: `${F} LP/HP`, title: 'LP / HP', labels: ['Clean', 'OSR', 'MS2', 'SMP', 'PRD'] },
						{ kind: 'choice', param: `${F} BP/NO/MO`, options: ['Clean', 'OSR'] }
					]
				}
			]
		]
	};
}

const adsr = (E: string): PanelGroup['controls'] => [
	{ kind: 'box', param: `${E} Attack`, title: 'A' },
	{ kind: 'box', param: `${E} Decay`, title: 'D' },
	{ kind: 'box', param: `${E} Sustain`, title: 'S' },
	{ kind: 'box', param: `${E} Release`, title: 'R' }
];

const slopes = (E: string): PanelGroup => ({
	title: 'Slopes',
	controls: [
		{ kind: 'box', param: `${E} A Slope`, title: 'A' },
		{ kind: 'box', param: `${E} D Slope`, title: 'D' },
		{ kind: 'box', param: `${E} R Slope`, title: 'R' }
	]
});

const loop = (E: string): PanelGroup => ({
	title: 'Loop',
	controls: [{ kind: 'choice', param: `${E} Loop Mode`, options: LOOP_MODES }]
});

/** Env 2 and Env 3 are modulation envelopes: Initial → Peak → Final around the ADSR. */
function modEnvPage(n: 2 | 3): PanelPage {
	const E = `Env ${n}`;
	return {
		id: `env${n}`,
		title: E,
		parent: 'mod',
		rows: [
			[
				{
					title: E,
					controls: [
						{ kind: 'box', param: `${E} Initial`, title: 'Initial' },
						{ kind: 'box', param: `${E} Attack`, title: 'A' },
						{ kind: 'box', param: `${E} Peak`, title: 'Peak' },
						{ kind: 'box', param: `${E} Decay`, title: 'D' },
						{ kind: 'box', param: `${E} Sustain`, title: 'S' },
						{ kind: 'box', param: `${E} Release`, title: 'R' },
						{ kind: 'box', param: `${E} Final`, title: 'Final' }
					]
				}
			],
			[slopes(E), loop(E)]
		]
	};
}

function lfoPage(n: 1 | 2): PanelPage {
	const L = `LFO ${n}`;
	return {
		id: `lfo${n}`,
		title: L,
		parent: 'mod',
		rows: [
			[
				{
					title: L,
					controls: [
						{ kind: 'choice', param: `${L} Wave`, options: ['Sine', 'Tri', 'Saw', 'Rect', 'Noise'] },
						{ kind: 'choice', param: `${L} Sync`, options: ['Free', 'Tempo'] },
						{ kind: 'box', param: `${L} Freq`, title: 'Rate' },
						{ kind: 'step', param: `${L} Synced`, title: 'Sync', labels: SYNCED },
						{ kind: 'switch', param: `${L} Retrig On`, title: 'Retrig' }
					]
				}
			],
			[
				{
					title: 'Shape',
					controls: [
						{ kind: 'box', param: `${L} Amount`, title: 'Amount' },
						{ kind: 'box', param: `${L} Morph`, title: 'Morph' },
						{ kind: 'box', param: `${L} Offset`, title: 'Offset' },
						{ kind: 'box', param: `${L} Attack`, title: 'Attack' }
					]
				}
			]
		]
	};
}

export const WAVETABLE_PANEL: InstrumentPanel = {
	// Drawn by the view's own face.
	frame: [],
	pages: [
		oscPage(1),
		oscPage(2),
		filterPage(1),
		filterPage(2),
		{
			id: 'mod',
			title: 'Mod Sources',
			rows: [
				[
					{ title: 'Amp', page: 'amp', controls: adsr('Amp') },
					{ title: 'Env 2', page: 'env2', controls: adsr('Env 2') }
				],
				[
					{ title: 'Env 3', page: 'env3', controls: adsr('Env 3') },
					{
						title: 'LFO 1',
						page: 'lfo1',
						controls: [
							{ kind: 'box', param: 'LFO 1 Amount', title: 'Amount' },
							{ kind: 'box', param: 'LFO 1 Freq', title: 'Rate' }
						]
					},
					{
						title: 'LFO 2',
						page: 'lfo2',
						controls: [
							{ kind: 'box', param: 'LFO 2 Amount', title: 'Amount' },
							{ kind: 'box', param: 'LFO 2 Freq', title: 'Rate' }
						]
					}
				]
			]
		},
		{
			id: 'amp',
			title: 'Amp',
			parent: 'mod',
			rows: [[{ title: 'Amp', controls: adsr('Amp') }], [slopes('Amp'), loop('Amp')]]
		},
		modEnvPage(2),
		modEnvPage(3),
		lfoPage(1),
		lfoPage(2),
		{
			id: 'global',
			title: 'Global',
			rows: [
				[
					{
						title: 'Global',
						controls: [
							{ kind: 'box', param: 'Volume', title: 'Volume' },
							{ kind: 'box', param: 'Transpose', title: 'Transp' },
							{ kind: 'box', param: 'Glide', title: 'Glide' },
							{ kind: 'box', param: 'Unison Amount', title: 'Unison' }
						]
					},
					{
						title: 'Scale',
						controls: [
							{ kind: 'box', param: 'Time', title: 'Time' },
							{ kind: 'box', param: 'Global Mod Amount', title: 'Mod Amt' }
						]
					}
				]
			]
		}
	]
};
