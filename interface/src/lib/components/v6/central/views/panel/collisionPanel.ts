/**
 * Collision in Live's arrangement (ADR-487).
 *
 * Live's panel: Mallet · Noise, then Resonator 1 · Resonator 2 · LFO ·
 * MIDI/MPE as tabs over the middle, then Global. Here Mallet and Noise keep
 * their columns, Live's tabs swap the middle, Volume closes the frame, and
 * every eyebrow opens its section's page; a resonator's Body opens its
 * velocity and key amounts. Names are Live's
 * (docs/reference/instruments/Collision.md): every parameter but Device On.
 */
import type { InstrumentPanel, PanelGroup, PanelPage } from './panelTypes';

const RES_TYPES = ['Beam', 'Marimba', 'String', 'Membrane', 'Plate', 'Pipe', 'Tube'];
const QUALITY = ['Eco', 'Low', 'Med', 'High'];
const LFO_WAVES = ['Sine', 'Square', 'Tri', 'Saw Up', 'Saw Dn', 'S & H', 'Ramp'];
const VOICES = ['Mono', '2', '4', '6', '8', '10', '12', '14', '16'];

// Modulation destinations, Live's lists: an LFO cannot target its own rate.
const DESTS = [
	'None', 'Mallet Stiff', 'Noise Freq', 'Noise Vol', 'Res 1 Pitch', 'Res 1 Hit', 'Res 1 Pan', 'Res 1 Opening',
	'Res 2 Input', 'Res 2 Pitch', 'Res 2 Hit', 'Res 2 Pan', 'Res 2 Opening', 'Volume'
];
const MOD_DESTS = [...DESTS, 'LFO 1 Freq', 'LFO 1 Amt', 'LFO 2 Freq', 'LFO 2 Amt'];
const LFO1_DESTS = [...DESTS, 'LFO 1 Freq', 'LFO 2 Freq', 'LFO 2 Amt'];
const LFO2_DESTS = [...DESTS, 'LFO 1 Freq', 'LFO 1 Amt', 'LFO 2 Freq'];

/** A resonator's frame group: the six Live shows around its display. */
function resonatorGroup(n: 1 | 2): PanelGroup {
	const r = `Res ${n}`;
	return {
		title: `Resonator ${n}`,
		page: `res${n}`,
		switchParam: `${r} On/Off`,
		controls: [
			{ kind: 'box', param: `${r} Decay`, title: 'Decay' },
			{ kind: 'box', param: `${r} Material`, title: 'Material' },
			{ kind: 'box', param: `${r} Brightness`, title: 'Bright' },
			{ kind: 'box', param: `${r} Inharmonics`, title: 'Inharm' },
			{ kind: 'box', param: `${r} Tune`, title: 'Tune' },
			{ kind: 'box', param: `${r} Volume`, title: 'Gain' }
		]
	};
}

function resonatorPage(n: 1 | 2): PanelPage {
	const r = `Res ${n}`;
	const switchParam = `${r} On/Off`;
	return {
		id: `res${n}`,
		title: `Resonator ${n}`,
		rows: [
			[
				{
					title: `Resonator ${n}`,
					switchParam,
					controls: [
						{ kind: 'switch', param: switchParam, title: 'On' },
						{ kind: 'choice', param: `${r} Type`, options: RES_TYPES },
						{ kind: 'choice', param: `${r} Quality`, options: QUALITY }
					]
				},
				{
					title: 'Body',
					page: `res${n}-mod`,
					switchParam,
					controls: [
						{ kind: 'box', param: `${r} Decay`, title: 'Decay' },
						{ kind: 'box', param: `${r} Material`, title: 'Material' },
						{ kind: 'box', param: `${r} Brightness`, title: 'Bright' },
						{ kind: 'box', param: `${r} Inharmonics`, title: 'Inharm' },
						{ kind: 'box', param: `${r} Ratio`, title: 'Ratio' }
					]
				}
			],
			[
				{
					title: 'Tuning',
					switchParam,
					controls: [
						{ kind: 'box', param: `${r} Tune`, title: 'Tune' },
						{ kind: 'box', param: `${r} Fine Tune`, title: 'Fine' },
						{ kind: 'box', param: `${r} Pitch Env.`, title: 'Env' },
						{ kind: 'box', param: `${r} Pitch Env. Time`, title: 'Time' }
					]
				},
				{
					title: 'Hit',
					switchParam,
					controls: [
						{ kind: 'box', param: `${r} Hit`, title: 'Hit' },
						{ kind: 'box', param: `${r} Hit < Random`, title: 'Rnd' },
						{ kind: 'box', param: `${r} Radius`, title: 'Radius' },
						{ kind: 'box', param: `${r} Opening`, title: 'Opening' }
					]
				},
				{
					title: 'Mix',
					switchParam,
					controls: [
						{ kind: 'box', param: `${r} Pan`, title: 'Pan' },
						{ kind: 'box', param: `${r} Bleed`, title: 'Bleed' },
						{ kind: 'box', param: `${r} Volume`, title: 'Gain' }
					]
				}
			]
		]
	};
}

/** A resonator's velocity and key amounts and its listening positions. */
function resonatorModPage(n: 1 | 2): PanelPage {
	const r = `Res ${n}`;
	const switchParam = `${r} On/Off`;
	return {
		id: `res${n}-mod`,
		title: `Resonator ${n} Vel / Key`,
		parent: `res${n}`,
		rows: [
			[
				{
					title: 'Velocity',
					switchParam,
					controls: [
						{ kind: 'box', param: `${r} Decay < Vel`, title: 'Decay' },
						{ kind: 'box', param: `${r} Material < Vel`, title: 'Material' },
						{ kind: 'box', param: `${r} Radius < Vel`, title: 'Radius' },
						{ kind: 'box', param: `${r} Inharmonics < Vel`, title: 'Inharm' },
						{ kind: 'box', param: `${r} Opening < Vel`, title: 'Opening' },
						{ kind: 'box', param: `${r} Pitch Env. < Vel`, title: 'Env' }
					]
				}
			],
			[
				{
					title: 'Key',
					switchParam,
					controls: [
						{ kind: 'box', param: `${r} Tune < Key`, title: 'Tune' },
						{ kind: 'box', param: `${r} Decay < Key`, title: 'Decay' },
						{ kind: 'box', param: `${r} Material < Key`, title: 'Material' },
						{ kind: 'box', param: `${r} Radius < Key`, title: 'Radius' },
						{ kind: 'box', param: `${r} Pan < Key`, title: 'Pan' }
					]
				},
				{
					title: 'Listening',
					switchParam,
					controls: [
						{ kind: 'box', param: `${r} Off Decay`, title: 'Note Off' },
						{ kind: 'box', param: `${r} Listening L`, title: 'Pos L' },
						{ kind: 'box', param: `${r} Listening R`, title: 'Pos R' }
					]
				}
			]
		]
	};
}

function lfoGroup(n: 1 | 2): PanelGroup {
	const l = `LFO ${n}`;
	return {
		title: `LFO ${n}`,
		page: `lfo${n}`,
		switchParam: `${l} On`,
		controls: [
			{ kind: 'box', param: `${l} Freq`, title: 'Rate' },
			{ kind: 'box', param: `${l} Amount`, title: 'Amount' },
			{ kind: 'box', param: `${l} Amt A`, title: 'Amt A' }
		]
	};
}

function lfoPage(n: 1 | 2): PanelPage {
	const l = `LFO ${n}`;
	const switchParam = `${l} On`;
	const dests = n === 1 ? LFO1_DESTS : LFO2_DESTS;
	return {
		id: `lfo${n}`,
		title: `LFO ${n}`,
		rows: [
			[
				{
					title: `LFO ${n}`,
					switchParam,
					controls: [
						{ kind: 'switch', param: switchParam, title: 'On' },
						{ kind: 'choice', param: `${l} Wave`, options: LFO_WAVES },
						{ kind: 'choice', param: `${l} Sync`, options: ['Free', 'Sync'] },
						{ kind: 'switch', param: `${l} Retrig On`, title: 'Retrig' }
					]
				},
				{
					title: 'Rate',
					switchParam,
					controls: [
						{ kind: 'box', param: `${l} Freq`, title: 'Freq' },
						{ kind: 'box', param: `${l} Synced`, title: 'Synced' },
						{ kind: 'box', param: `${l} Rate < Key`, title: 'Key' }
					]
				}
			],
			[
				{
					title: 'Depth',
					switchParam,
					controls: [
						{ kind: 'box', param: `${l} Amount`, title: 'Amount' },
						{ kind: 'box', param: `${l} Depth < Vel`, title: 'Vel' },
						{ kind: 'box', param: `${l} Offset`, title: 'Offset' }
					]
				},
				{
					title: 'Destination A',
					switchParam,
					controls: [
						{ kind: 'step', param: `${l} Dest A`, title: 'Dest A', labels: dests },
						{ kind: 'box', param: `${l} Amt A`, title: 'Amt A' }
					]
				},
				{
					title: 'Destination B',
					switchParam,
					controls: [
						{ kind: 'step', param: `${l} Dest B`, title: 'Dest B', labels: dests },
						{ kind: 'box', param: `${l} Amt B`, title: 'Amt B' }
					]
				}
			]
		]
	};
}

/** A MIDI source's destination and amount, A and optionally B. */
function midiGroup(title: string, source: string, both: boolean): PanelGroup {
	return {
		title,
		controls: [
			{ kind: 'step', param: `${source} Dest A`, title: 'Dest A', labels: MOD_DESTS },
			{ kind: 'box', param: `${source} Amt A`, title: 'Amt A' },
			...(both
				? ([
						{ kind: 'step', param: `${source} Dest B`, title: 'Dest B', labels: MOD_DESTS },
						{ kind: 'box', param: `${source} Amt B`, title: 'Amt B' }
					] as const)
				: [])
		]
	};
}

export const COLLISION_PANEL: InstrumentPanel = {
	frame: [
		{
			kind: 'group',
			group: {
				title: 'Mallet',
				page: 'mallet',
				switchParam: 'Mallet On/Off',
				controls: [
					{ kind: 'box', param: 'Mallet Volume', title: 'Volume' },
					{ kind: 'box', param: 'Mallet Stiffness', title: 'Stiffness' }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Noise',
				page: 'noise',
				switchParam: 'Noise On/Off',
				controls: [
					{ kind: 'box', param: 'Noise Volume', title: 'Volume' },
					{ kind: 'box', param: 'Noise Filter Freq', title: 'Freq' }
				]
			}
		},
		{
			kind: 'tabs',
			tabs: [
				{ title: 'Res 1', switchParam: 'Res 1 On/Off', groups: [resonatorGroup(1)] },
				{ title: 'Res 2', switchParam: 'Res 2 On/Off', groups: [resonatorGroup(2)] },
				{ title: 'LFO', groups: [lfoGroup(1), lfoGroup(2)] },
				{
					title: 'MIDI',
					groups: [
						{
							title: 'MIDI',
							page: 'midi',
							controls: [
								{ kind: 'box', param: 'PB Amt A', title: 'PB' },
								{ kind: 'box', param: 'MW Amt A', title: 'MW A' },
								{ kind: 'box', param: 'MW Amt B', title: 'MW B' },
								{ kind: 'box', param: 'Press Amt A', title: 'Press' },
								{ kind: 'box', param: 'Slide Amt A', title: 'Slide' }
							]
						}
					]
				}
			]
		},
		{
			kind: 'group',
			group: { title: 'Global', page: 'global', controls: [{ kind: 'box', param: 'Volume', title: 'Volume' }] }
		}
	],
	pages: [
		{
			id: 'mallet',
			title: 'Mallet',
			rows: [
				[
					{
						title: 'Mallet',
						switchParam: 'Mallet On/Off',
						controls: [
							{ kind: 'switch', param: 'Mallet On/Off', title: 'On' },
							{ kind: 'box', param: 'Mallet Volume', title: 'Volume' },
							{ kind: 'box', param: 'Mallet Stiffness', title: 'Stiffness' },
							{ kind: 'box', param: 'Mallet Noise Amount', title: 'Noise' },
							{ kind: 'box', param: 'Mallet Noise Color', title: 'Color' }
						]
					}
				],
				[
					{
						title: 'Velocity',
						switchParam: 'Mallet On/Off',
						controls: [
							{ kind: 'box', param: 'Mallet Volume < Vel', title: 'Volume' },
							{ kind: 'box', param: 'Mallet Stiffness < Vel', title: 'Stiffness' },
							{ kind: 'box', param: 'Mallet Noise Amount < Vel', title: 'Noise' }
						]
					},
					{
						title: 'Key',
						switchParam: 'Mallet On/Off',
						controls: [
							{ kind: 'box', param: 'Mallet Volume < Key', title: 'Volume' },
							{ kind: 'box', param: 'Mallet Stiffness < Key', title: 'Stiffness' },
							{ kind: 'box', param: 'Mallet Noise Amount < Key', title: 'Noise' }
						]
					}
				]
			]
		},
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
							{ kind: 'choice', param: 'Noise Filter Type', options: ['LP', 'HP', 'BP', 'LP+HP'] },
							{ kind: 'box', param: 'Noise Volume', title: 'Volume' },
							{ kind: 'box', param: 'Noise Filter Freq', title: 'Freq' },
							{ kind: 'box', param: 'Noise Filter Q', title: 'Res' },
							{ kind: 'box', param: 'Noise Freq < Env', title: 'Env Amt' }
						]
					}
				],
				[
					{
						title: 'Envelope',
						switchParam: 'Noise On/Off',
						controls: [
							{ kind: 'box', param: 'Noise Attack', title: 'A' },
							{ kind: 'box', param: 'Noise Decay', title: 'D' },
							{ kind: 'box', param: 'Noise Sustain', title: 'S' },
							{ kind: 'box', param: 'Noise Release', title: 'R' }
						]
					},
					{
						title: 'Velocity',
						switchParam: 'Noise On/Off',
						controls: [
							{ kind: 'box', param: 'Noise Volume < Vel', title: 'Volume' },
							{ kind: 'box', param: 'Noise Freq < Vel', title: 'Freq' }
						]
					},
					{
						title: 'Key',
						switchParam: 'Noise On/Off',
						controls: [
							{ kind: 'box', param: 'Noise Volume < Key', title: 'Volume' },
							{ kind: 'box', param: 'Noise Freq < Key', title: 'Freq' }
						]
					}
				]
			]
		},
		resonatorPage(1),
		resonatorModPage(1),
		resonatorPage(2),
		resonatorModPage(2),
		lfoPage(1),
		lfoPage(2),
		{
			id: 'midi',
			title: 'MIDI',
			rows: [
				[midiGroup('Pitch Bend', 'PB', false), midiGroup('Mod Wheel', 'MW', true)],
				[midiGroup('Pressure', 'Press', true), midiGroup('Slide', 'Slide', true)]
			]
		},
		{
			id: 'global',
			title: 'Global',
			rows: [
				[
					{ title: 'Structure', controls: [{ kind: 'choice', param: 'Structure', options: ['1 > 2', '1 + 2'] }] },
					{
						title: 'Voices',
						controls: [
							{ kind: 'step', param: 'Voices', title: 'Voices', labels: VOICES },
							{ kind: 'switch', param: 'Retrig On', title: 'Retrig' }
						]
					},
					{
						title: 'Bend',
						controls: [
							{ kind: 'box', param: 'PB Range', title: 'PB' },
							{ kind: 'box', param: 'Note PB Range', title: 'Note PB' }
						]
					},
					{ title: 'Output', controls: [{ kind: 'box', param: 'Volume', title: 'Volume' }] }
				]
			]
		}
	]
};
