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
import { matrixColumn as col, type InstrumentPanel, type PanelBoard, type PanelControl, type PanelGroup, type PanelPage } from './panelTypes';

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
					// The type and its shape (Ratio sets a membrane's or a
					// plate's proportions): two columns, as each group here,
					// so the page is ten columns of medium knobs (ADR-510).
					title: `Resonator ${n}`,
					switchParam,
					controls: [
						{ kind: 'switch', param: switchParam, title: 'On' },
						{ kind: 'choice', param: `${r} Type`, title: 'Type', options: RES_TYPES },
						{ kind: 'choice', param: `${r} Quality`, options: QUALITY },
						{ kind: 'box', param: `${r} Ratio`, title: 'Ratio' }
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
						{ kind: 'box', param: `${r} Inharmonics`, title: 'Inharm' }
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
						{ kind: 'choice', param: `${l} Wave`, title: 'Wave', options: LFO_WAVES },
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

const RES = [1, 2] as const;
/** The MIDI page's sources: a row's name, its parameters' prefix, and whether it has a B. */
const MIDI_SOURCES = [
	['Bend', 'PB', false],
	['Wheel', 'MW', true],
	['Press', 'Press', true],
	['Slide', 'Slide', true]
] as const;
const LFOS = [1, 2] as const;
const box = (param: string, title: string): PanelControl => ({ kind: 'box', param, title });
/** A resonator's column: `name` is its parameter's name after "Res N ". */
const res = (title: string, name: string) => col(title, RES, (n) => box(`Res ${n} ${name}`, title));
const lfo = (title: string, name: string) => col(title, LFOS, (n) => box(`LFO ${n} ${name}`, title));

/**
 * Collision at full screen (ADR-512). The two resonators are a table, a
 * row each, over two rows of the board: the type, body, tuning and hit,
 * then the mix, the velocity and key amounts and the listening positions
 * (under their groups' names: Decay is a column of both). The two LFOs
 * another, every control of their pages. Under them Mallet, Noise (its
 * envelope's stages as knobs: four boxes over the touch floor want a
 * column the row does not have), the MIDI amounts (a source a row) and
 * Global, three to a column. The MIDI page's destinations (which parameter each of Bend,
 * Wheel, Pressure and Slide reaches) stay on that page: a destination's
 * names want two columns each, and the row has none to spare.
 */
const COLLISION_BOARD: PanelBoard = {
	rows: [
		{
			weight: 1.92,
			tiles: [
				{
					id: 'resonators',
					sections: [
						{
							kind: 'matrix',
							matrix: {
								title: 'Res',
								rows: RES.map((n) => ({ title: String(n), switchParam: `Res ${n} On/Off` })),
								groups: [
									{
										title: 'Resonator',
										columns: [
											col('Type', RES, (n) => ({ kind: 'choice', param: `Res ${n} Type`, title: 'Type', options: RES_TYPES }), { span: 2 }),
											col('Quality', RES, (n) => ({ kind: 'choice', param: `Res ${n} Quality`, title: 'Quality', options: QUALITY })),
											res('Ratio', 'Ratio')
										]
									},
									{ title: 'Body', columns: [res('Decay', 'Decay'), res('Material', 'Material'), res('Bright', 'Brightness'), res('Inharm', 'Inharmonics')] },
									{ title: 'Tuning', columns: [res('Tune', 'Tune'), res('Fine', 'Fine Tune'), res('Pitch Env', 'Pitch Env.'), res('Env Time', 'Pitch Env. Time')] },
									{ title: 'Hit', columns: [res('Hit', 'Hit'), res('Hit Rnd', 'Hit < Random'), res('Radius', 'Radius'), res('Opening', 'Opening')] }
								]
							}
						}
					]
				}
			]
		},
		{
			weight: 2.16,
			tiles: [
				{
					id: 'resonators-mod',
					sections: [
						{
							kind: 'matrix',
							matrix: {
								title: 'Res',
								groupLine: true,
								// Their switches are on the row above: here they only ghost the row.
								rows: RES.map((n) => ({ title: String(n), switchParam: `Res ${n} On/Off`, quiet: true })),
								groups: [
									{ title: 'Mix', columns: [res('Pan', 'Pan'), res('Bleed', 'Bleed'), res('Gain', 'Volume')] },
									{
										title: 'Velocity',
										columns: [
											res('Decay', 'Decay < Vel'),
											res('Material', 'Material < Vel'),
											res('Radius', 'Radius < Vel'),
											res('Inharm', 'Inharmonics < Vel'),
											res('Opening', 'Opening < Vel'),
											res('Pitch Env', 'Pitch Env. < Vel')
										]
									},
									{
										title: 'Key',
										columns: [res('Tune', 'Tune < Key'), res('Decay', 'Decay < Key'), res('Material', 'Material < Key'), res('Radius', 'Radius < Key'), res('Pan', 'Pan < Key')]
									},
									{ title: 'Listening', columns: [res('Note Off', 'Off Decay'), res('Pos L', 'Listening L'), res('Pos R', 'Listening R')] }
								]
							}
						}
					]
				}
			]
		},
		{
			weight: 1.92,
			tiles: [
				{
					id: 'lfos',
					sections: [
						{
							kind: 'matrix',
							matrix: {
								title: 'LFO',
								rows: LFOS.map((n) => ({ title: String(n), switchParam: `LFO ${n} On` })),
								groups: [
									{
										title: 'Shape',
										columns: [
											col('Wave', LFOS, (n) => ({ kind: 'choice', param: `LFO ${n} Wave`, title: 'Wave', options: LFO_WAVES }), { span: 2 }),
											col('Sync', LFOS, (n) => ({ kind: 'choice', param: `LFO ${n} Sync`, title: 'Sync', options: ['Free', 'Sync'] })),
											col('Retrig', LFOS, (n) => ({ kind: 'switch', param: `LFO ${n} Retrig On`, title: 'Retrig' }))
										]
									},
									{ title: 'Rate', columns: [lfo('Freq', 'Freq'), lfo('Synced', 'Synced'), lfo('Rate Key', 'Rate < Key')] },
									{ title: 'Depth', columns: [lfo('Amount', 'Amount'), lfo('Vel', 'Depth < Vel'), lfo('Offset', 'Offset')] },
									{
										title: 'Destinations',
										columns: [
											col('Dest A', LFOS, (n) => ({ kind: 'step', param: `LFO ${n} Dest A`, title: 'Dest A', labels: n === 1 ? LFO1_DESTS : LFO2_DESTS }), { span: 2 }),
											lfo('Amt A', 'Amt A'),
											col('Dest B', LFOS, (n) => ({ kind: 'step', param: `LFO ${n} Dest B`, title: 'Dest B', labels: n === 1 ? LFO1_DESTS : LFO2_DESTS }), { span: 2 }),
											lfo('Amt B', 'Amt B')
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
			weight: 4.21,
			tiles: [
				{
					id: 'mallet',
					sections: [
						{
							kind: 'group',
							stack: 3,
							group: {
								title: 'Mallet',
								switchParam: 'Mallet On/Off',
								controls: [
									{ kind: 'switch', param: 'Mallet On/Off', title: 'On' },
									box('Mallet Volume', 'Volume'),
									box('Mallet Stiffness', 'Stiffness'),
									box('Mallet Noise Amount', 'Noise'),
									box('Mallet Noise Color', 'Color')
								]
							}
						},
						{
							kind: 'group',
							stack: 3,
							group: {
								title: 'Velocity',
								switchParam: 'Mallet On/Off',
								controls: [box('Mallet Volume < Vel', 'Volume'), box('Mallet Stiffness < Vel', 'Stiffness'), box('Mallet Noise Amount < Vel', 'Noise')]
							}
						},
						{
							kind: 'group',
							stack: 3,
							group: {
								title: 'Key',
								switchParam: 'Mallet On/Off',
								controls: [box('Mallet Volume < Key', 'Volume'), box('Mallet Stiffness < Key', 'Stiffness'), box('Mallet Noise Amount < Key', 'Noise')]
							}
						}
					]
				},
				{
					id: 'noise',
					sections: [
						{
							kind: 'group',
							stack: 3,
							group: {
								title: 'Noise',
								switchParam: 'Noise On/Off',
								controls: [
									{ kind: 'switch', param: 'Noise On/Off', title: 'On' },
									{ kind: 'choice', param: 'Noise Filter Type', title: 'Filter', options: ['LP', 'HP', 'BP', 'LP+HP'] },
									box('Noise Volume', 'Volume'),
									box('Noise Filter Freq', 'Freq'),
									box('Noise Filter Q', 'Res'),
									box('Noise Freq < Env', 'Env Amt')
								]
							}
						},
						{
							kind: 'group',
							stack: 3,
							group: {
								// Knobs here, where the page draws boxes (ADR-509): four boxes
								// over the touch floor take a column more than the row has.
								title: 'Envelope',
								switchParam: 'Noise On/Off',
								controls: [box('Noise Attack', 'Attack'), box('Noise Decay', 'Decay'), box('Noise Sustain', 'Sustain'), box('Noise Release', 'Release')]
							}
						},
						{
							kind: 'group',
							stack: 3,
							group: { title: 'Velocity', switchParam: 'Noise On/Off', controls: [box('Noise Volume < Vel', 'Volume'), box('Noise Freq < Vel', 'Freq')] }
						},
						{
							kind: 'group',
							stack: 3,
							group: { title: 'Key', switchParam: 'Noise On/Off', controls: [box('Noise Volume < Key', 'Volume'), box('Noise Freq < Key', 'Freq')] }
						}
					]
				},
				{
					id: 'midi',
					sections: [
						{
							kind: 'matrix',
							matrix: {
								// A source a row, its two amounts across: what the frame's MIDI tab shows.
								title: 'MIDI',
								rows: MIDI_SOURCES.map(([title]) => ({ title })),
								groups: [
									{
										title: 'Amounts',
										columns: [
											col('Amt A', MIDI_SOURCES, ([, s]) => box(`${s} Amt A`, 'Amt A')),
											col('Amt B', MIDI_SOURCES, ([, s, both]) => (both ? box(`${s} Amt B`, 'Amt B') : undefined))
										]
									}
								]
							}
						}
					]
				},
				{
					id: 'global',
					sections: [
						{
							kind: 'group',
							stack: 3,
							group: {
								title: 'Global',
								controls: [
									{ kind: 'choice', param: 'Structure', title: 'Structure', options: ['1 > 2', '1 + 2'] },
									{ kind: 'step', param: 'Voices', title: 'Voices', labels: VOICES },
									{ kind: 'switch', param: 'Retrig On', title: 'Retrig' },
									box('PB Range', 'PB'),
									box('Note PB Range', 'Note PB'),
									box('Volume', 'Volume')
								]
							}
						}
					]
				}
			]
		}
	]
};

export const COLLISION_PANEL: InstrumentPanel = {
	// Knobs, but an envelope's stages stay boxes: their heights draw it (ADR-509).
	boxFace: 'knob',
	board: COLLISION_BOARD,
	frame: [
		{
			kind: 'group',
			group: {
				title: 'Mallet',
				page: 'mallet',
				switchParam: 'Mallet On/Off',
				// One column, its two knobs stacked (ADR-510).
				columns: 1,
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
				columns: 1,
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
						face: 'slider',
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
				[midiGroup('Bend', 'PB', false), midiGroup('Mod Wheel', 'MW', true)],
				[midiGroup('Pressure', 'Press', true), midiGroup('Slide', 'Slide', true)]
			]
		},
		{
			id: 'global',
			title: 'Global',
			rows: [
				[
					{
						// Under the page's own name: the header line is its way back.
						title: 'Global',
						controls: [
							{ kind: 'choice', param: 'Structure', options: ['1 > 2', '1 + 2'] },
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
