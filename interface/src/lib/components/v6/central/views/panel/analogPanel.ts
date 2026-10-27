/**
 * Analog (`UltraAnalog`) in Live's arrangement (ADR-487).
 *
 * Live's panel is two synths in signal flow, Osc 1 → Fil 1 → Amp 1 over
 * Osc 2 → Fil 2 → Amp 2, with Noise, the LFOs and Global beside them. Vamp's
 * Analog view already draws one voice at a time in that order (the Voice
 * 1/2 badge), so it keeps that face and its eyebrows open the shown voice's
 * sections as pages: oscillator, filter, envelopes (with each envelope's
 * loop and velocity, and the amp, one more tap in), its LFO, Noise, Global,
 * Vibrato and MPE. Every parameter but Device On, by Live's names
 * (docs/reference/instruments/Analog.md).
 */
import type { InstrumentPanel, PanelGroup, PanelPage } from './panelTypes';

const signed = (lo: number, hi: number) =>
	Array.from({ length: hi - lo + 1 }, (_, i) => {
		const n = lo + i;
		return n > 0 ? `+${n}` : String(n);
	});

const OCTAVES = signed(-3, 3);
const SEMIS = signed(-12, 12);
const FILTER_TYPES = ['LP12', 'LP24', 'BP6', 'BP12', 'Notch2', 'Notch4', 'HP12', 'HP24', 'Form6', 'Form12'];
const DRIVES = ['Off', 'Sym1', 'Sym2', 'Sym3', 'Asym1', 'Asym2', 'Asym3'];
const LOOP_MODES = ['Off', 'AD-R', 'ADR-R', 'ADS-AR'];
const SYNC_RATES = [
	'4d', '4', '4t', '2d', '2', '2t', '1d', '1', '1t', '1/2d', '1/2', '1/2t',
	'1/4d', '1/4', '1/4t', '1/8d', '1/8', '1/8t', '1/16d', '1/16', '1/16t', '1/32d', '1/32', '1/32t'
];
/** Live's MPE destinations, `Press Dest A` and its kin, 0..46. */
const MPE_DESTS = [
	'None', 'Vib Amount', 'Vib Speed', 'Uni Detune', 'Noise Level', 'Noise Bal', 'Noise Color',
	'O1 Pitch', 'O1 LFO > Pitch', 'O1 Pitch Env', 'O1 PW', 'O1 LFO > PW', 'O1 Sub', 'O1 Sync',
	'O1 Level', 'O1 Balance', 'F1 Cutoff', 'F1 LFO > Cut', 'F1 Env > Cut', 'F1 Q', 'F1 LFO > Q',
	'F1 Env > Q', 'A1 Volume', 'A1 LFO > Vol', 'A1 Pan', 'A1 LFO > Pan', 'LFO 1 Rate',
	'O2 Pitch', 'O2 LFO > Pitch', 'O2 Pitch Env', 'O2 PW', 'O2 LFO > PW', 'O2 Sub', 'O2 Sync',
	'O2 Level', 'O2 Balance', 'F2 Cutoff', 'F2 LFO > Cut', 'F2 Env > Cut', 'F2 Q', 'F2 LFO > Q',
	'F2 Env > Q', 'A2 Volume', 'A2 LFO > Vol', 'A2 Pan', 'A2 LFO > Pan', 'LFO 2 Rate'
];

function oscPage(v: 1 | 2): PanelPage {
	const O = `OSC${v}`;
	const o = `O${v}`;
	return {
		id: `osc${v}`,
		title: `Osc ${v}`,
		rows: [
			[
				{
					title: `Oscillator ${v}`,
					switchParam: `${O} On/Off`,
					controls: [
						{ kind: 'switch', param: `${O} On/Off`, title: 'On' },
						{ kind: 'choice', param: `${O} Shape`, options: ['Sine', 'Saw', 'Rect', 'Noise'] },
						{ kind: 'step', param: `${O} Octave`, title: 'Oct', labels: OCTAVES },
						{ kind: 'step', param: `${O} Semi`, title: 'Semi', labels: SEMIS },
						{ kind: 'box', param: `${O} Detune`, title: 'Detune' },
						{ kind: 'box', param: `${O} PW`, title: 'PW' },
						{ kind: 'choice', param: `${O} Mode`, options: ['Sub', 'Sync'] },
						{ kind: 'box', param: `${o} Sub/Sync`, title: 'Sub/Sync' }
					]
				}
			],
			[
				{
					title: 'Out',
					controls: [
						{ kind: 'box', param: `${O} Level`, title: 'Level' },
						{ kind: 'box', param: `${O} Balance`, title: 'F1 / F2' },
						{ kind: 'box', param: `${o} Keytrack`, title: 'Key' }
					]
				},
				{
					title: 'Pitch Env',
					controls: [
						{ kind: 'box', param: `PEG${v} Amount`, title: 'Amount' },
						{ kind: 'box', param: `PEG${v} Time`, title: 'Time' }
					]
				},
				{
					title: `LFO ${v}`,
					page: `lfo${v}`,
					controls: [
						{ kind: 'box', param: `${O} < LFO`, title: 'Pitch' },
						{ kind: 'box', param: `${o} PW < LFO`, title: 'PW' }
					]
				}
			]
		]
	};
}

function filterPage(v: 1 | 2): PanelPage {
	const F = `F${v}`;
	const first: PanelGroup = {
		title: `Filter ${v}`,
		switchParam: `${F} On/Off`,
		controls: [
			{ kind: 'switch', param: `${F} On/Off`, title: 'On' },
			{ kind: 'step', param: `${F} Type`, title: 'Type', labels: FILTER_TYPES },
			{ kind: 'box', param: `${F} Freq`, title: 'Freq' },
			{ kind: 'box', param: `${F} Resonance`, title: 'Res' },
			{ kind: 'step', param: `${F} Drive`, title: 'Drive', labels: DRIVES },
			// Filter 1 feeds Filter 2; Filter 2's cutoff can follow Filter 1's.
			v === 1
				? { kind: 'box', param: 'F1 To F2', title: 'To F2' }
				: { kind: 'switch', param: 'F2 Slave', title: 'Follow F1' }
		]
	};
	return {
		id: `filter${v}`,
		title: `Filter ${v}`,
		rows: [
			[first],
			[
				{
					title: 'Key',
					controls: [
						{ kind: 'box', param: `${F} Freq < Key`, title: 'Freq' },
						{ kind: 'box', param: `${F} Reso < Key`, title: 'Res' }
					]
				},
				{
					title: `LFO ${v}`,
					page: `lfo${v}`,
					controls: [
						{ kind: 'box', param: `${F} Freq < LFO`, title: 'Freq' },
						{ kind: 'box', param: `${F} Res < LFO`, title: 'Res' }
					]
				},
				{
					title: 'Envelope',
					page: `feg${v}`,
					controls: [
						{ kind: 'box', param: `${F} Freq < Env`, title: 'Freq' },
						{ kind: 'box', param: `${F} Res < Env`, title: 'Res' }
					]
				}
			]
		]
	};
}

/** An envelope's stages, the row the Envelopes page shows for each. */
function stages(E: string): PanelGroup['controls'] {
	return [
		{ kind: 'box', param: `${E} Attack`, title: 'A' },
		{ kind: 'box', param: `${E} Decay`, title: 'D' },
		{ kind: 'box', param: `${E} Sustain`, title: 'S' },
		{ kind: 'box', param: `${E} S Time`, title: 'S Time' },
		{ kind: 'box', param: `${E} Rel`, title: 'R' }
	];
}

function envPages(v: 1 | 2): PanelPage[] {
	const detail = (E: string, id: string, title: string): PanelPage => ({
		id,
		title,
		parent: `env${v}`,
		rows: [
			[{ title, controls: stages(E) }],
			[
				{ title: 'Loop', controls: [{ kind: 'choice', param: `${E} Loop`, options: LOOP_MODES }] },
				{
					title: 'Mode',
					controls: [
						{ kind: 'switch', param: `${E} Exp`, title: 'Exp' },
						{ kind: 'switch', param: `${E} Free`, title: 'Free' },
						{ kind: 'switch', param: `${E} Legato`, title: 'Legato' }
					]
				},
				{
					title: 'Velocity',
					controls: [
						{ kind: 'box', param: `${E} A < Vel`, title: 'Attack' },
						{ kind: 'box', param: `${E} < Vel`, title: 'Level' }
					]
				}
			]
		]
	});
	return [
		{
			id: `env${v}`,
			title: `Envelopes ${v}`,
			rows: [
				[
					{ title: 'Amp Env', page: `aeg${v}`, controls: stages(`AEG${v}`) },
					{
						title: `Amp ${v}`,
						page: `amp${v}`,
						controls: [
							{ kind: 'box', param: `AMP${v} Level`, title: 'Level' },
							{ kind: 'box', param: `AMP${v} Pan`, title: 'Pan' }
						]
					}
				],
				[{ title: 'Filter Env', page: `feg${v}`, controls: stages(`FEG${v}`) }]
			]
		},
		detail(`AEG${v}`, `aeg${v}`, 'Amp Env'),
		detail(`FEG${v}`, `feg${v}`, 'Filter Env'),
		{
			id: `amp${v}`,
			title: `Amp ${v}`,
			parent: `env${v}`,
			rows: [
				[
					{
						title: `Amp ${v}`,
						switchParam: `AMP${v} On/Off`,
						controls: [
							{ kind: 'switch', param: `AMP${v} On/Off`, title: 'On' },
							{ kind: 'box', param: `AMP${v} Level`, title: 'Level' },
							{ kind: 'box', param: `AMP${v} Pan`, title: 'Pan' },
							{ kind: 'box', param: `AMP${v} < Key`, title: 'Level < Key' },
							{ kind: 'box', param: `A${v} Pan < Key`, title: 'Pan < Key' }
						]
					}
				],
				[
					{
						title: `LFO ${v}`,
						page: `lfo${v}`,
						controls: [
							{ kind: 'box', param: `AMP${v} < LFO`, title: 'Level' },
							{ kind: 'box', param: `A${v} Pan < LFO`, title: 'Pan' }
						]
					},
					{ title: 'Envelope', controls: [{ kind: 'box', param: `A${v} Pan < Env`, title: 'Pan' }] }
				]
			]
		}
	];
}

function lfoPage(v: 1 | 2): PanelPage {
	const L = `LFO${v}`;
	return {
		id: `lfo${v}`,
		title: `LFO ${v}`,
		rows: [
			[
				{
					title: `LFO ${v}`,
					switchParam: `${L} On/Off`,
					controls: [
						{ kind: 'switch', param: `${L} On/Off`, title: 'On' },
						{ kind: 'choice', param: `${L} Shape`, options: ['Sine', 'Tri', 'Rect', 'Noise1', 'Noise2'] },
						{ kind: 'choice', param: `${L} Sync`, options: ['Hz', 'Beat'] },
						{ kind: 'box', param: `${L} Speed`, title: 'Speed' },
						{ kind: 'step', param: `${L} SncRate`, title: 'Rate', labels: SYNC_RATES }
					]
				}
			],
			[
				{
					switchParam: `${L} On/Off`,
					controls: [
						{ kind: 'box', param: `${L} PW`, title: 'PW' },
						{ kind: 'box', param: `${L} Phase`, title: 'Phase' },
						{ kind: 'box', param: `${L} Delay`, title: 'Delay' },
						{ kind: 'box', param: `${L} Fade In`, title: 'Fade In' },
						{ kind: 'switch', param: `${L} Retrig`, title: 'Retrig' }
					]
				}
			]
		]
	};
}

export const ANALOG_PANEL: InstrumentPanel = {
	// Drawn by the view's own face.
	frame: [],
	pages: [
		oscPage(1),
		oscPage(2),
		filterPage(1),
		filterPage(2),
		...envPages(1),
		...envPages(2),
		lfoPage(1),
		lfoPage(2),
		{
			id: 'noise',
			title: 'Noise',
			rows: [
				[
					{
						title: 'Noise',
						switchParam: 'Noise On/Off',
						controls: [
							{ kind: 'switch', param: 'Noise On/Off', title: 'On' },
							{ kind: 'box', param: 'Noise Level', title: 'Level' },
							{ kind: 'box', param: 'Noise Color', title: 'Color' },
							{ kind: 'box', param: 'Noise Balance', title: 'F1 / F2' }
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
					{
						title: 'Global',
						controls: [
							{ kind: 'box', param: 'Volume', title: 'Volume' },
							{
								kind: 'step',
								param: 'Voices',
								title: 'Voices',
								labels: ['Mono', '2', '4', '8', '12', '16', '20', '24', '28', '32']
							},
							{ kind: 'step', param: 'Octave', title: 'Oct', labels: OCTAVES },
							{ kind: 'step', param: 'Semitone', title: 'Semi', labels: SEMIS },
							{ kind: 'box', param: 'Detune', title: 'Detune' }
						]
					},
					{
						title: 'Keys',
						controls: [
							{ kind: 'choice', param: 'Key Priority', options: ['High', 'Low', 'Last'] },
							{ kind: 'box', param: 'Key Stretch', title: 'Stretch' },
							{ kind: 'box', param: 'Key Error', title: 'Error' }
						]
					}
				],
				[
					{
						title: 'Unison',
						switchParam: 'Unison On/Off',
						controls: [
							{ kind: 'switch', param: 'Unison On/Off', title: 'On' },
							{ kind: 'choice', param: 'Unison Voices', options: ['2', '4'] },
							{ kind: 'box', param: 'Unison Detune', title: 'Detune' },
							{ kind: 'box', param: 'Unison Delay', title: 'Delay' }
						]
					},
					{
						title: 'Glide',
						switchParam: 'Glide On/Off',
						controls: [
							{ kind: 'switch', param: 'Glide On/Off', title: 'On' },
							{ kind: 'box', param: 'Glide Time', title: 'Time' },
							{ kind: 'choice', param: 'Glide Mode', options: ['Prop', 'Const'] },
							{ kind: 'switch', param: 'Glide Legato', title: 'Legato' }
						]
					},
					{
						title: 'Vibrato',
						page: 'vibrato',
						switchParam: 'Vib On/Off',
						controls: [
							{ kind: 'switch', param: 'Vib On/Off', title: 'On' },
							{ kind: 'box', param: 'Vib Amount', title: 'Amount' }
						]
					},
					{
						title: 'MPE',
						page: 'mpe',
						controls: [{ kind: 'box', param: 'PB Range', title: 'PB' }]
					}
				]
			]
		},
		{
			id: 'vibrato',
			title: 'Vibrato',
			parent: 'global',
			rows: [
				[
					{
						title: 'Vibrato',
						switchParam: 'Vib On/Off',
						controls: [
							{ kind: 'switch', param: 'Vib On/Off', title: 'On' },
							{ kind: 'box', param: 'Vib Amount', title: 'Amount' },
							{ kind: 'box', param: 'Vib Speed', title: 'Speed' },
							{ kind: 'box', param: 'Vib Fade-In', title: 'Fade In' },
							{ kind: 'box', param: 'Vib Delay', title: 'Delay' },
							{ kind: 'box', param: 'Vib Error', title: 'Error' },
							{ kind: 'box', param: 'Vib < ModWh', title: 'Mod Wh' }
						]
					}
				]
			]
		},
		{
			id: 'mpe',
			title: 'MPE',
			parent: 'global',
			rows: [
				[
					{
						title: 'Pressure',
						controls: [
							{ kind: 'step', param: 'Press Dest A', title: 'Dest A', labels: MPE_DESTS },
							{ kind: 'box', param: 'Press Amt A', title: 'Amt A' },
							{ kind: 'step', param: 'Press Dest B', title: 'Dest B', labels: MPE_DESTS },
							{ kind: 'box', param: 'Press Amt B', title: 'Amt B' }
						]
					},
					{
						title: 'Bend',
						controls: [
							{ kind: 'box', param: 'PB Range', title: 'PB' },
							{ kind: 'box', param: 'Note PB Range', title: 'Note PB' }
						]
					}
				],
				[
					{
						title: 'Slide',
						controls: [
							{ kind: 'step', param: 'Slide Dest A', title: 'Dest A', labels: MPE_DESTS },
							{ kind: 'box', param: 'Slide Amt A', title: 'Amt A' },
							{ kind: 'step', param: 'Slide Dest B', title: 'Dest B', labels: MPE_DESTS },
							{ kind: 'box', param: 'Slide Amt B', title: 'Amt B' }
						]
					}
				]
			]
		}
	]
};
