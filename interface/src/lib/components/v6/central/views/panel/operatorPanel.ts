/**
 * Operator in Live's arrangement (ADR-487).
 *
 * Live's panel: the four oscillators down the left, the chosen one's
 * envelope and oscillator settings in the middle display, then LFO, Filter,
 * Pitch Env and the global Time / Tone / Volume down the right. Here Live's
 * oscillators, its LFO and its pitch envelope are tabs over the middle (the
 * display Live swaps), each showing its main boxes and its envelope; the
 * Filter is the view's own XY pad with its response curve (`slot`); Time,
 * Tone and Volume close the frame. Every eyebrow opens its section's page.
 * Names are Live's (docs/reference/instruments/Operator.md); note Live's
 * trailing space in "A Fix On ".
 */
import type { InstrumentPanel, PanelGroup, PanelPage, PanelTab } from './panelTypes';

type Osc = 'A' | 'B' | 'C' | 'D';

const WAVES = [
	'Sine', 'Sine 4 Bit', 'Sine 8 Bit', 'Saw 3', 'Saw 4', 'Saw 6', 'Saw 8', 'Saw 16', 'Saw 32', 'Saw 64', 'Saw D',
	'Square 3', 'Square 4', 'Square 6', 'Square 8', 'Square 16', 'Square 32', 'Square 64', 'Square D',
	'Triangle', 'Noise Looped', 'Noise White', 'User'
];
const FIX_MUL = ['0', '0.001', '0.01', '0.1', '1', '10'];
const ENV_MODES = ['None', 'Loop', 'Beat', 'Sync', 'Trigger'];
const RETRIG = ['1/48', '1/32', '1/24', '1/16', '1/12', '1/8', '1/6', '1/4', '1/3', '1/2', '1', '1.5', '2', '3', '4'];
const DESTS = [
	'Off', 'Osc Vol A', 'Osc Vol B', 'Osc Vol C', 'Osc Vol D', 'X-fade A/C', 'X-fade B/D', 'Osc Feedback',
	'Osc Fix Freq', 'FM Drive', 'Filter Freq', 'Filter Q', 'Filter Res', 'Filter Morph', 'Filter Drive',
	'Filter Env', 'Shaper Drive', 'LFO Rate', 'LFO Amount', 'Aux Env', 'Volume', 'Panorama', 'Tone', 'Time'
];
const ALGORITHMS = Array.from({ length: 11 }, (_, i) => `Alg. ${i + 1}`);

/** The envelope a tab or page shows: four stages under one eyebrow. */
function adsr(prefix: string, page: string, switchParam?: string): PanelGroup {
	return {
		title: 'Envelope',
		page,
		switchParam,
		controls: [
			{ kind: 'box', param: `${prefix} Attack`, title: 'A' },
			{ kind: 'box', param: `${prefix} Decay`, title: 'D' },
			{ kind: 'box', param: `${prefix} Sustain`, title: 'S' },
			{ kind: 'box', param: `${prefix} Release`, title: 'R' }
		]
	};
}

function oscTab(o: Osc): PanelTab {
	const on = `Osc-${o} On`;
	return {
		title: `Osc ${o}`,
		switchParam: on,
		groups: [
			{
				title: `Oscillator ${o}`,
				page: `osc-${o}`,
				switchParam: on,
				controls: [
					{ kind: 'box', param: `${o} Coarse`, title: 'Coarse' },
					{ kind: 'box', param: `Osc-${o} Level`, title: 'Level' },
					{ kind: 'box', param: `Osc-${o} Feedb`, title: 'Feedback' }
				]
			},
			adsr(`${o}e`, `osc-${o}-env`, on)
		]
	};
}

function oscPage(o: Osc): PanelPage {
	const on = `Osc-${o} On`;
	return {
		id: `osc-${o}`,
		title: `Oscillator ${o}`,
		rows: [
			[
				{
					title: `Oscillator ${o}`,
					switchParam: on,
					controls: [
						{ kind: 'switch', param: on, title: 'On' },
						{ kind: 'step', param: `Osc-${o} Wave`, title: 'Wave', labels: WAVES },
						{ kind: 'switch', param: `Osc-${o} Retrig`, title: 'Retrig' }
					]
				},
				{
					title: 'Pitch',
					switchParam: on,
					controls: [
						{ kind: 'box', param: `${o} Coarse`, title: 'Coarse' },
						{ kind: 'box', param: `${o} Fine`, title: 'Fine' },
						{ kind: 'box', param: `${o} Freq<Vel`, title: 'Vel' },
						{ kind: 'switch', param: `${o} Quantize`, title: 'Quant' },
						{ kind: 'switch', param: `${o} Fix On `, title: 'Fixed' },
						{ kind: 'box', param: `${o} Fix Freq`, title: 'Freq' },
						{ kind: 'step', param: `${o} Fix Freq Mul`, title: 'Mul', labels: FIX_MUL }
					]
				}
			],
			[
				{
					title: 'Level',
					switchParam: on,
					controls: [
						{ kind: 'box', param: `Osc-${o} Level`, title: 'Level' },
						{ kind: 'box', param: `Osc-${o} Lev < Vel`, title: 'Vel' },
						{ kind: 'box', param: `Osc-${o} Lev < Key`, title: 'Key' }
					]
				},
				{
					title: 'Tone',
					switchParam: on,
					controls: [
						{ kind: 'box', param: `Osc-${o} Feedb`, title: 'Feedback' },
						{ kind: 'box', param: `Osc-${o} Phase`, title: 'Phase' }
					]
				},
				{
					title: 'Mod',
					switchParam: on,
					controls: [
						{ kind: 'switch', param: `Osc-${o} < Pe`, title: 'Pitch Env' },
						{ kind: 'switch', param: `Osc-${o} < LFO`, title: 'LFO' }
					]
				},
				adsr(`${o}e`, `osc-${o}-env`, on)
			]
		]
	};
}

/** An envelope's whole page: its stages, then its loop. */
function envPage(id: string, title: string, prefix: string, parent: string, extra: { end?: boolean; slopes?: boolean } = {}): PanelPage {
	return {
		id,
		title,
		parent,
		rows: [
			[
				{
					title: 'Stages',
					controls: [
						{ kind: 'box', param: `${prefix} Attack`, title: 'Attack' },
						{ kind: 'box', param: `${prefix} Init`, title: 'Initial' },
						{ kind: 'box', param: `${prefix} Decay`, title: 'Decay' },
						{ kind: 'box', param: `${prefix} Peak`, title: 'Peak' },
						{ kind: 'box', param: `${prefix} Sustain`, title: 'Sustain' },
						{ kind: 'box', param: `${prefix} Release`, title: 'Release' },
						...(extra.end ? ([{ kind: 'box', param: `${prefix} End`, title: 'End' }] as const) : [])
					]
				}
			],
			[
				{
					title: 'Loop',
					controls: [
						{ kind: 'choice', param: `${prefix} Mode`, options: ENV_MODES },
						{ kind: 'box', param: `${prefix} Loop`, title: 'Loop' },
						{ kind: 'step', param: `${prefix} Retrig`, title: 'Retrig', labels: RETRIG },
						{ kind: 'box', param: `${prefix} R < Vel`, title: 'R Vel' }
					]
				},
				...(extra.slopes
					? [
							{
								title: 'Slopes',
								controls: [
									{ kind: 'box', param: `${prefix} A Slope`, title: 'A' },
									{ kind: 'box', param: `${prefix} D Slope`, title: 'D' },
									{ kind: 'box', param: `${prefix} R Slope`, title: 'R' }
								]
							} as const
						]
					: [])
			]
		]
	};
}

const OSCS: Osc[] = ['A', 'B', 'C', 'D'];

export const OPERATOR_PANEL: InstrumentPanel = {
	frame: [
		{
			kind: 'tabs',
			tabs: [
				...OSCS.map(oscTab),
				{
					title: 'LFO',
					switchParam: 'LFO On',
					groups: [
						{
							title: 'LFO',
							page: 'lfo',
							switchParam: 'LFO On',
							controls: [
								{ kind: 'box', param: 'LFO Rate', title: 'Rate' },
								{ kind: 'box', param: 'LFO Amt', title: 'Amount' },
								{ kind: 'box', param: 'LFO Amt A', title: 'Amt A' }
							]
						},
						adsr('Le', 'lfo-env', 'LFO On')
					]
				},
				{
					title: 'Pitch',
					switchParam: 'Pe On',
					groups: [
						{
							title: 'Pitch Env',
							page: 'pitch',
							switchParam: 'Pe On',
							controls: [
								{ kind: 'box', param: 'Pe Amount', title: 'Amount' },
								{ kind: 'box', param: 'Pe Amt A', title: 'Amt A' }
							]
						},
						adsr('Pe', 'pitch', 'Pe On')
					]
				}
			]
		},
		{
			kind: 'slot',
			slot: 'filter',
			title: 'Filter',
			page: 'filter',
			units: 2.5,
			params: ['Filter On', 'Filter Type', 'Filter Slope', 'Filter Morph', 'Filter Freq', 'Filter Res']
		},
		{
			kind: 'group',
			group: {
				title: 'Global',
				page: 'global',
				controls: [
					{ kind: 'box', param: 'Time', title: 'Time' },
					{ kind: 'box', param: 'Tone', title: 'Tone' },
					{ kind: 'box', param: 'Volume', title: 'Volume' }
				]
			}
		}
	],
	pages: [
		...OSCS.flatMap((o) => [oscPage(o), envPage(`osc-${o}-env`, `Envelope ${o}`, `${o}e`, `osc-${o}`)]),
		{
			id: 'lfo',
			title: 'LFO',
			rows: [
				[
					{
						title: 'LFO',
						switchParam: 'LFO On',
						controls: [
							{ kind: 'switch', param: 'LFO On', title: 'On' },
							{ kind: 'choice', param: 'LFO Type', options: ['Sine', 'Square', 'Tri', 'Saw Up', 'Saw Dn', 'S&H', 'Noise'] },
							{ kind: 'choice', param: 'LFO Range', options: ['Low', 'High', 'Sync'] },
							{ kind: 'switch', param: 'LFO Retrigger', title: 'Retrig' }
						]
					},
					{
						title: 'Rate',
						switchParam: 'LFO On',
						controls: [
							{ kind: 'box', param: 'LFO Rate', title: 'Rate' },
							{ kind: 'step', param: 'LFO Sync', title: 'Sync', labels: RETRIG },
							{ kind: 'box', param: 'LFO R < K', title: 'Key' }
						]
					}
				],
				[
					{
						title: 'Depth',
						switchParam: 'LFO On',
						controls: [
							{ kind: 'box', param: 'LFO Amt', title: 'Amount' },
							{ kind: 'box', param: 'LFO < Vel', title: 'Vel' },
							{ kind: 'switch', param: 'LFO < Pe', title: 'Pitch Env' }
						]
					},
					{
						title: 'Destinations',
						switchParam: 'LFO On',
						controls: [
							{ kind: 'box', param: 'LFO Amt A', title: 'Amt A' },
							{ kind: 'step', param: 'LFO Dst B', title: 'Dest B', labels: DESTS },
							{ kind: 'box', param: 'LFO Amt B', title: 'Amt B' }
						]
					},
					adsr('Le', 'lfo-env', 'LFO On')
				]
			]
		},
		envPage('lfo-env', 'LFO Envelope', 'Le', 'lfo', { end: true }),
		{
			id: 'pitch',
			title: 'Pitch Env',
			rows: [
				[
					{
						title: 'Pitch Env',
						switchParam: 'Pe On',
						controls: [
							{ kind: 'switch', param: 'Pe On', title: 'On' },
							{ kind: 'box', param: 'Pe Amount', title: 'Amount' },
							{ kind: 'box', param: 'Pe Amt A', title: 'Amt A' },
							{ kind: 'step', param: 'Pe Dst B', title: 'Dest B', labels: DESTS },
							{ kind: 'box', param: 'Pe Amt B', title: 'Amt B' }
						]
					},
					{
						title: 'Loop',
						switchParam: 'Pe On',
						controls: [
							{ kind: 'choice', param: 'Pe Mode', options: ENV_MODES },
							{ kind: 'box', param: 'Pe Loop', title: 'Loop' },
							{ kind: 'step', param: 'Pe Retrig', title: 'Retrig', labels: RETRIG },
							{ kind: 'box', param: 'Pe R < Vel', title: 'R Vel' }
						]
					}
				],
				[
					{
						title: 'Stages',
						switchParam: 'Pe On',
						controls: [
							{ kind: 'box', param: 'Pe Attack', title: 'A' },
							{ kind: 'box', param: 'Pe Init', title: 'Init' },
							{ kind: 'box', param: 'Pe Decay', title: 'D' },
							{ kind: 'box', param: 'Pe Peak', title: 'Peak' },
							{ kind: 'box', param: 'Pe Sustain', title: 'S' },
							{ kind: 'box', param: 'Pe Release', title: 'R' },
							{ kind: 'box', param: 'Pe End', title: 'End' }
						]
					},
					{
						title: 'Slopes',
						switchParam: 'Pe On',
						controls: [
							{ kind: 'box', param: 'Pe A Slope', title: 'A' },
							{ kind: 'box', param: 'Pe D Slope', title: 'D' },
							{ kind: 'box', param: 'Pe R Slope', title: 'R' }
						]
					}
				]
			]
		},
		{
			id: 'filter',
			title: 'Filter',
			rows: [
				[
					{
						title: 'Filter',
						switchParam: 'Filter On',
						controls: [
							{ kind: 'switch', param: 'Filter On', title: 'On' },
							{ kind: 'choice', param: 'Filter Type', options: ['LP', 'HP', 'BP', 'Notch', 'Morph'] },
							{ kind: 'choice', param: 'Filter Slope', options: ['12 dB', '24 dB'] }
						]
					},
					{
						title: 'Circuit',
						switchParam: 'Filter On',
						controls: [
							{ kind: 'choice', param: 'Filter Circuit - LP/HP', options: ['Clean', 'OSR', 'MS2', 'SMP', 'PRD'] },
							{ kind: 'choice', param: 'Filter Circuit - BP/NO/Morph', options: ['Clean', 'OSR'] }
						]
					},
					{
						title: 'Shaper',
						page: 'shaper',
						controls: [
							{ kind: 'box', param: 'Shaper Mix', title: 'Mix' },
							{ kind: 'box', param: 'Shaper Drive', title: 'Drive' }
						]
					}
				],
				[
					{
						title: 'Tone',
						switchParam: 'Filter On',
						controls: [
							{ kind: 'box', param: 'Filter Freq', title: 'Freq' },
							{ kind: 'box', param: 'Filter Res', title: 'Res' },
							{ kind: 'box', param: 'Filter Morph', title: 'Morph' },
							{ kind: 'box', param: 'Filter Drive', title: 'Drive' }
						]
					},
					{
						title: 'Envelope',
						page: 'filter-env',
						switchParam: 'Filter On',
						controls: [
							{ kind: 'box', param: 'Fe Amount', title: 'Env' },
							{ kind: 'box', param: 'Filt < Vel', title: 'Vel' },
							{ kind: 'box', param: 'Filt < Key', title: 'Key' },
							{ kind: 'switch', param: 'Filt < LFO', title: 'LFO' }
						]
					}
				]
			]
		},
		envPage('filter-env', 'Filter Envelope', 'Fe', 'filter', { end: true, slopes: true }),
		{
			id: 'shaper',
			title: 'Shaper',
			parent: 'filter',
			rows: [
				[
					{
						title: 'Shaper',
						controls: [
							{ kind: 'choice', param: 'Shaper Type', options: ['Off', 'Soft', 'Hard', 'Sine', '4Bit'] },
							{ kind: 'box', param: 'Shaper Mix', title: 'Mix' },
							{ kind: 'box', param: 'Shaper Drive', title: 'Drive' }
						]
					}
				]
			]
		},
		{
			id: 'global',
			title: 'Global',
			rows: [
				[
					{ title: 'Algorithm', controls: [{ kind: 'step', param: 'Algorithm', title: 'Algorithm', labels: ALGORITHMS }] },
					{
						title: 'Pitch',
						controls: [
							{ kind: 'box', param: 'Transpose', title: 'Transpose' },
							{ kind: 'box', param: 'Spread', title: 'Spread' },
							{ kind: 'box', param: 'PB Range', title: 'PB' }
						]
					},
					{
						title: 'Glide',
						controls: [
							{ kind: 'switch', param: 'Glide On', title: 'Glide' },
							{ kind: 'box', param: 'Glide Time', title: 'Time' }
						]
					}
				],
				[
					{
						title: 'Pan',
						controls: [
							{ kind: 'box', param: 'Panorama', title: 'Pan' },
							{ kind: 'box', param: 'Pan < Key', title: 'Key' },
							{ kind: 'box', param: 'Pan < Rnd', title: 'Rnd' }
						]
					},
					{
						title: 'Output',
						controls: [
							{ kind: 'box', param: 'Time', title: 'Time' },
							{ kind: 'box', param: 'Time < Key', title: 'Time Key' },
							{ kind: 'box', param: 'Tone', title: 'Tone' },
							{ kind: 'box', param: 'Volume', title: 'Volume' }
						]
					}
				]
			]
		}
	]
};
