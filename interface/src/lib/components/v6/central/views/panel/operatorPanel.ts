/**
 * Operator in Live's arrangement (ADR-487).
 *
 * Live's panel: the four oscillators down the left, the chosen one's
 * envelope and oscillator settings in the middle display, then LFO, Filter,
 * Pitch Env and the global Time / Tone / Volume down the right. Here Live's
 * oscillators, its LFO and its pitch envelope are tabs over the middle (the
 * display Live swaps), each showing its main knobs and its envelope; the
 * Filter's type and its Env and Drive; Time, Tone and Volume close the
 * frame. Every eyebrow opens its section's page. The filter pad (Freq
 * across, Res up) is not on the frame: the chain cell's XY is the same two
 * parameters (`INSTRUMENT_CONTROLS.operator`), so it is the Filter page's
 * picture (`aside`) instead.
 * Names are Live's (docs/reference/instruments/Operator.md); note Live's
 * trailing space in "A Fix On ".
 */
import { matrixColumn as col, type InstrumentPanel, type PanelBoard, type PanelControl, type PanelEnvelope, type PanelGroup, type PanelPage, type PanelTab } from './panelTypes';

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

/**
 * The envelope a tab or page shows: four stages under one eyebrow, on three
 * of the frame's columns (a stage needs no knob's width, ADR-510).
 */
function adsr(prefix: string, page: string, switchParam?: string): PanelGroup {
	return {
		title: 'Envelope',
		page,
		switchParam,
		face: 'slider',
		columns: 3,
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
				// Three knobs stacked over two columns, names beside, as Global's
				// (2026-11-08): a row of three under the tabs left the band's
				// height empty above and below them.
				columns: 2,
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
				}
				// The oscillator's envelope is its own page, opened from the
				// frame's Envelope: drawn here too it took four of fourteen
				// columns and left every knob too narrow (2026-11-06).
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
					face: 'slider',
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
						{ kind: 'choice', param: `${prefix} Mode`, title: 'Mode', options: ENV_MODES },
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

/** The envelopes' rows on the board: the four oscillators', the LFO's, the pitch envelope and the filter's. */
export const OPERATOR_ENVS = [
	{ title: 'A', prefix: 'Ae', on: 'Osc-A On', end: false },
	{ title: 'B', prefix: 'Be', on: 'Osc-B On', end: false },
	{ title: 'C', prefix: 'Ce', on: 'Osc-C On', end: false },
	{ title: 'D', prefix: 'De', on: 'Osc-D On', end: false },
	{ title: 'LFO', prefix: 'Le', on: 'LFO On', end: true },
	{ title: 'Pitch', prefix: 'Pe', on: 'Pe On', end: true },
	{ title: 'Filter', prefix: 'Fe', on: 'Filter On', end: true }
] as const;
const ENVS = OPERATOR_ENVS;

/** The envelope a row of `OPERATOR_ENVS`, by Live's names, as `EnvelopeGraph` draws it (ADR-514). */
export function operatorEnvelope(e: (typeof OPERATOR_ENVS)[number]): PanelEnvelope {
	return {
		attack: `${e.prefix} Attack`,
		decay: `${e.prefix} Decay`,
		sustain: `${e.prefix} Sustain`,
		release: `${e.prefix} Release`,
		initial: `${e.prefix} Init`,
		peak: `${e.prefix} Peak`,
		final: e.end ? `${e.prefix} End` : undefined
	};
}

/** The sections the LFO and the two envelopes beyond the oscillators shape, a row each in the modulation table. */
const MODS = ['LFO', 'Pitch', 'Filter'] as const;
type Mod = (typeof MODS)[number];
const by = (m: Mod, table: Partial<Record<Mod, PanelControl>>) => table[m];

/** Algorithm's eleven values by number: "Alg. 11" does not fit a board column. */
const ALGORITHM_NUMBERS = ALGORITHMS.map((_, i) => String(i + 1));

/**
 * Operator at full screen (ADR-512). The four oscillators are a table, a
 * row each with every control of their pages. Under them the seven
 * envelopes' stages, a row each, beside the Filter (its pad, type,
 * circuits and Shaper) and the LFO; then a table of what the LFO, the
 * pitch envelope and the filter envelope reach (their slopes, amounts,
 * destination and scaling) beside Global. Each envelope's loop (Mode,
 * Loop, Retrig, R Vel) stays on its page: seven rows of four more
 * columns do not fit beside the stages at a touchable size.
 */
const OPERATOR_BOARD: PanelBoard = {
	rows: [
		{
			weight: 2.95,
			tiles: [
				{
					id: 'oscillators',
					title: 'Oscillators',
					sections: [
						{
							kind: 'matrix',
							matrix: {
								title: 'Osc',
								rows: OSCS.map((o) => ({ title: o, switchParam: `Osc-${o} On` })),
								groups: [
									{
										title: 'Wave · Pitch',
										columns: [
											col('Wave', OSCS, (o) => ({ kind: 'step', param: `Osc-${o} Wave`, title: 'Wave', labels: WAVES }), { span: 2 }),
											col('Coarse', OSCS, (o) => ({ kind: 'box', param: `${o} Coarse`, title: 'Coarse' })),
											col('Fine', OSCS, (o) => ({ kind: 'box', param: `${o} Fine`, title: 'Fine' })),
											col('Freq Vel', OSCS, (o) => ({ kind: 'box', param: `${o} Freq<Vel`, title: 'Freq Vel' })),
											col('Quant', OSCS, (o) => ({ kind: 'switch', param: `${o} Quantize`, title: 'Quant' })),
											col('Fixed', OSCS, (o) => ({ kind: 'switch', param: `${o} Fix On `, title: 'Fixed' })),
											col('Freq', OSCS, (o) => ({ kind: 'box', param: `${o} Fix Freq`, title: 'Freq' })),
											col('Mul', OSCS, (o) => ({ kind: 'step', param: `${o} Fix Freq Mul`, title: 'Mul', labels: FIX_MUL }))
										]
									},
									{
										title: 'Level',
										columns: [
											col('Level', OSCS, (o) => ({ kind: 'box', param: `Osc-${o} Level`, title: 'Level' })),
											col('Vel', OSCS, (o) => ({ kind: 'box', param: `Osc-${o} Lev < Vel`, title: 'Vel' })),
											col('Key', OSCS, (o) => ({ kind: 'box', param: `Osc-${o} Lev < Key`, title: 'Key' }))
										]
									},
									{
										title: 'Tone · Mod',
										columns: [
											col('Feedback', OSCS, (o) => ({ kind: 'box', param: `Osc-${o} Feedb`, title: 'Feedback' })),
											col('Phase', OSCS, (o) => ({ kind: 'box', param: `Osc-${o} Phase`, title: 'Phase' })),
											col('Retrig', OSCS, (o) => ({ kind: 'switch', param: `Osc-${o} Retrig`, title: 'Retrig' })),
											col('Pitch Env', OSCS, (o) => ({ kind: 'switch', param: `Osc-${o} < Pe`, title: 'Pitch Env' })),
											col('LFO', OSCS, (o) => ({ kind: 'switch', param: `Osc-${o} < LFO`, title: 'LFO' }))
										]
									}
								]
							}
						}
					]
				}
			]
		},
		{
			weight: 3.6,
			tiles: [
				{
					id: 'envelopes',
					title: 'Envelopes',
					sections: [
						{
							// One envelope as Live draws it (ADR-514), the one picked over it
							// (the face's oscillator until another is picked), its stages
							// dragged on the picture.
							kind: 'slot',
							slot: 'envelope',
							title: 'Envelope',
							columns: 9,
							params: OPERATOR_ENVS.flatMap((e) => Object.values(operatorEnvelope(e)).filter((n): n is string => !!n))
						},
						{
							kind: 'matrix',
							matrix: {
								title: 'Env',
								// Each row's switch is drawn elsewhere on the board: here it only ghosts the row.
								rows: ENVS.map((e) => ({ title: e.title, switchParam: e.on, quiet: true })),
								groups: [
									{
										// Each envelope's loop (ADR-513: on the board, since the band opens no page).
										title: 'Loop',
										columns: [
											col('Mode', ENVS, (e) => ({ kind: 'choice', param: `${e.prefix} Mode`, title: 'Mode', options: ENV_MODES })),
											col('Loop', ENVS, (e) => ({ kind: 'box', param: `${e.prefix} Loop`, title: 'Loop' })),
											col('Retrig', ENVS, (e) => ({ kind: 'step', param: `${e.prefix} Retrig`, title: 'Retrig', labels: RETRIG })),
											col('R Vel', ENVS, (e) => ({ kind: 'box', param: `${e.prefix} R < Vel`, title: 'R Vel' }))
										]
									}
								]
							}
						}
					]
				}
			]
		},
		{
			// The filter, its LFO and pan, under the envelopes: the envelopes take the
			// full width with their loop settings (ADR-513).
			weight: 2.55,
			tiles: [
				{
					id: 'filter',
					title: 'Filter',
					// Its switch is on the tile's bar (ADR-516).
					switchParam: 'Filter On',
					// The pad near square on the left, its type, circuit and shaper in
					// columns on its right (user, 2026-11-07: "make the filter XY taller
					// and narrower so it's more square ... controls to the right side").
					sections: [
						{
							kind: 'slot',
							slot: 'filter',
							title: 'Filter',
							columns: 2,
							params: ['Filter On', 'Filter Freq', 'Filter Res']
						},
						{
							kind: 'group',
							stack: 2,
							// Every choice a pick: tabs beside picks read as two kinds of control.
							tabMax: 1,
							group: {
								title: 'Type · Circuit',
								switchParam: 'Filter On',
								controls: [
									{ kind: 'choice', param: 'Filter Type', title: 'Type', options: ['LP', 'HP', 'BP', 'Notch', 'Morph'] },
									{ kind: 'choice', param: 'Filter Slope', title: 'Slope', options: ['12 dB', '24 dB'] },
									{ kind: 'switch', param: 'Filt < LFO', title: 'LFO' },
									{ kind: 'choice', param: 'Filter Circuit - LP/HP', title: 'LP / HP', options: ['Clean', 'OSR', 'MS2', 'SMP', 'PRD'] },
									{ kind: 'choice', param: 'Filter Circuit - BP/NO/Morph', title: 'BP / Morph', options: ['Clean', 'OSR'] },
									{ kind: 'box', param: 'Filter Morph', title: 'Morph' },
									{ kind: 'box', param: 'Filter Drive', title: 'Drive' }
								]
							}
						},
						{
							kind: 'group',
							stack: 2,
							// Every choice a pick: tabs beside picks read as two kinds of control.
							tabMax: 1,
							group: {
								title: 'Shaper',
								controls: [
									{ kind: 'choice', param: 'Shaper Type', title: 'Type', options: ['Off', 'Soft', 'Hard', 'Sine', '4Bit'] },
									{ kind: 'box', param: 'Shaper Mix', title: 'Mix' },
									{ kind: 'box', param: 'Shaper Drive', title: 'Drive' }
								]
							}
						}
					]
				},
				{
					id: 'lfo',
					title: 'LFO',
					// Its switch is on the tile's bar (ADR-516).
					switchParam: 'LFO On',
					sections: [
						{
							// Its wave as Live draws it (ADR-514), rate across and amount up.
							kind: 'slot',
							slot: 'lfo',
							columns: 2,
							params: ['LFO On', 'LFO Type', 'LFO Range', 'LFO Rate', 'LFO Sync', 'LFO Amt']
						},
						{
							kind: 'group',
							stack: 3,
							group: {
								title: 'LFO',
								switchParam: 'LFO On',
								controls: [
									{ kind: 'choice', param: 'LFO Type', title: 'Wave', options: ['Sine', 'Square', 'Tri', 'Saw Up', 'Saw Dn', 'S&H', 'Noise'] },
									{ kind: 'choice', param: 'LFO Range', title: 'Range', options: ['Low', 'High', 'Sync'] },
									{ kind: 'switch', param: 'LFO Retrigger', title: 'Retrig' },
									{ kind: 'box', param: 'LFO Rate', title: 'Rate', knobSize: 'l' },
									{ kind: 'step', param: 'LFO Sync', title: 'Sync', labels: RETRIG },
									{ kind: 'switch', param: 'LFO < Pe', title: 'Pitch Env' }
								]
							}
						}
					]
				},
				{
					id: 'pan',
					title: 'Pan',
					sections: [
						{
							kind: 'group',
							stack: 3,
							group: {
								title: 'Pan',
								controls: [
									{ kind: 'box', param: 'Panorama', title: 'Pan', knobSize: 'm' },
									{ kind: 'box', param: 'Pan < Key', title: 'Key', knobSize: 's' },
									{ kind: 'box', param: 'Pan < Rnd', title: 'Rnd', knobSize: 's' }
								]
							}
						}
					]
				}
			]
		},
		{
			weight: 2.4,
			tiles: [
				{
					id: 'modulation',
					title: 'Modulation',
					sections: [
						{
							kind: 'matrix',
							matrix: {
								rows: [
									// The LFO's switch is on its tile's bar (ADR-516), as the filter's is.
										{ title: 'LFO', switchParam: 'LFO On', quiet: true },
									{ title: 'Pitch', switchParam: 'Pe On' },
									// The filter's switch is on its tile.
									{ title: 'Filter', switchParam: 'Filter On', quiet: true }
								],
								groups: [
									{
										title: 'Modulation',
										columns: [
											...(['A', 'D', 'R'] as const).map((k) =>
												col(`${k} Slope`, MODS, (m) => by(m, { Pitch: { kind: 'box', param: `Pe ${k} Slope`, title: `${k} Slope` }, Filter: { kind: 'box', param: `Fe ${k} Slope`, title: `${k} Slope` } }))
											),
											col('Amount', MODS, (m) =>
												by(m, { LFO: { kind: 'box', param: 'LFO Amt', title: 'Amount' }, Pitch: { kind: 'box', param: 'Pe Amount', title: 'Amount' }, Filter: { kind: 'box', param: 'Fe Amount', title: 'Env' } })
											),
											col('Amt A', MODS, (m) => by(m, { LFO: { kind: 'box', param: 'LFO Amt A', title: 'Amt A' }, Pitch: { kind: 'box', param: 'Pe Amt A', title: 'Amt A' } })),
											col('Dest B', MODS, (m) => by(m, { LFO: { kind: 'step', param: 'LFO Dst B', title: 'Dest B', labels: DESTS }, Pitch: { kind: 'step', param: 'Pe Dst B', title: 'Dest B', labels: DESTS } }), { span: 2 }),
											col('Amt B', MODS, (m) => by(m, { LFO: { kind: 'box', param: 'LFO Amt B', title: 'Amt B' }, Pitch: { kind: 'box', param: 'Pe Amt B', title: 'Amt B' } })),
											col('Vel', MODS, (m) => by(m, { LFO: { kind: 'box', param: 'LFO < Vel', title: 'Vel' }, Filter: { kind: 'box', param: 'Filt < Vel', title: 'Vel' } })),
											col('Key', MODS, (m) => by(m, { LFO: { kind: 'box', param: 'LFO R < K', title: 'Key' }, Filter: { kind: 'box', param: 'Filt < Key', title: 'Key' } }))
										]
									}
								]
							}
						}
					]
				},
				{
					id: 'global',
					title: 'Global',
					sections: [
						{
							kind: 'group',
							stack: 2,
							group: {
								title: 'Global',
								controls: [
									{ kind: 'step', param: 'Algorithm', title: 'Algorithm', labels: ALGORITHM_NUMBERS },
									{ kind: 'switch', param: 'Glide On', title: 'Glide' },
									{ kind: 'box', param: 'Glide Time', title: 'Glide', knobSize: 's' },
									{ kind: 'box', param: 'Transpose', title: 'Transp', knobSize: 's' },
									{ kind: 'box', param: 'Spread', title: 'Spread', knobSize: 'm' },
									{ kind: 'box', param: 'PB Range', title: 'PB', knobSize: 's' }
								]
							}
						},
						{
							kind: 'group',
							stack: 2,
							group: {
								title: 'Output',
								controls: [
									{ kind: 'box', param: 'Time', title: 'Time', knobSize: 's' },
									{ kind: 'box', param: 'Time < Key', title: 'Key', knobSize: 's' },
									{ kind: 'box', param: 'Tone', title: 'Tone', knobSize: 'm' },
									{ kind: 'box', param: 'Volume', title: 'Volume', knobSize: 'l' }
								]
							}
						}
					]
				}
			]
		}
	]
};

export const OPERATOR_PANEL: InstrumentPanel = {
	// Knobs, but an envelope's stages stay boxes: their heights draw it (ADR-509).
	boxFace: 'knob',
	board: OPERATOR_BOARD,
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
							columns: 2,
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
			kind: 'group',
			group: {
				title: 'Filter',
				page: 'filter',
				switchParam: 'Filter On',
				// Two face columns: the type's tab, then Env over Drive (`frameColumns`).
				columns: 2,
				controls: [
					{ kind: 'choice', param: 'Filter Type', title: 'Type', options: ['LP', 'HP', 'BP', 'Notch', 'Morph'] },
					{ kind: 'box', param: 'Fe Amount', title: 'Env' },
					{ kind: 'box', param: 'Filter Drive', title: 'Drive' }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Global',
				page: 'global',
				// Three knobs stacked over two columns, names beside: medium (ADR-510).
				columns: 2,
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
							{ kind: 'choice', param: 'LFO Type', title: 'Wave', options: ['Sine', 'Square', 'Tri', 'Saw Up', 'Saw Dn', 'S&H', 'Noise'] },
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
							{ kind: 'choice', param: 'Pe Mode', title: 'Mode', options: ENV_MODES },
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
						face: 'slider',
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
			// The pad, two columns as on any face (ADR-510): Freq across, Res up,
			// its response under them (the view's `slots.filter`).
			aside: { slot: 'filter', units: 2, params: ['Filter On', 'Filter Freq', 'Filter Res'] },
			rows: [
				[
					{
						title: 'Filter',
						switchParam: 'Filter On',
						controls: [
							{ kind: 'switch', param: 'Filter On', title: 'On' },
							{ kind: 'choice', param: 'Filter Type', title: 'Type', options: ['LP', 'HP', 'BP', 'Notch', 'Morph'] },
							{ kind: 'choice', param: 'Filter Slope', options: ['12 dB', '24 dB'] },
							// Live's circuit, by the type it applies to.
							{ kind: 'choice', param: 'Filter Circuit - LP/HP', title: 'LP / HP', options: ['Clean', 'OSR', 'MS2', 'SMP', 'PRD'] },
							{ kind: 'choice', param: 'Filter Circuit - BP/NO/Morph', title: 'BP / Morph', options: ['Clean', 'OSR'] }
						]
					},
					{
						// The whole Shaper here: a page of its three controls alone
						// left most of the view empty (2026-11-06).
						title: 'Shaper',
						controls: [
							{ kind: 'choice', param: 'Shaper Type', title: 'Type', options: ['Off', 'Soft', 'Hard', 'Sine', '4Bit'] },
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
