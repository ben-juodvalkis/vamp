/**
 * Meld (`InstrumentMeld`) in Live's arrangement (ADR-487).
 *
 * Live's panel is Engines A and B (tabs A · B · Settings), their envelopes,
 * the filters, the mix and Global, with Envelopes · LFOs · Matrix · MIDI ·
 * MPE tabs under it. Vamp's Meld view draws one engine at a time in that
 * order, with the oscillator and filter type grids a rule would lose, so it
 * keeps that face and its eyebrows open the shown engine's pages (its
 * oscillator, filter, envelopes and LFOs, each with a detail page one tap
 * in) and Global with the mix of both. Every parameter but Device On, by
 * Live's names (docs/reference/instruments/Meld.md). The matrix, MIDI and
 * MPE tabs are not parameters.
 */
import type { InstrumentPanel, PanelGroup, PanelPage } from './panelTypes';

export type MeldEngineId = 'a' | 'b';

const signed = (lo: number, hi: number) =>
	Array.from({ length: hi - lo + 1 }, (_, i) => {
		const n = lo + i;
		return n > 0 ? `+${n}` : String(n);
	});

const SYNCED = [
	'8', '6', '4', '3', '2', '1.5', '1', '3/4', '1/2', '3/8', '1/3',
	'5/16', '1/4', '3/16', '1/6', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64'
];
const OSC_TYPES = [
	'Basic', 'Dual Basic', 'Noisy', 'Sq Sync', 'Sq 5th', 'Sub', 'Swarm Sine', 'Swarm Tri',
	'Swarm Saw', 'Swarm Sq', 'Harm FM', 'Fold FM', 'Squelch', 'Simple FM', 'Chip', "Shepard's Pi",
	'Tarp', 'Extratone', 'Noise Loop', 'Filt Noise', 'Bitgrunge', 'Crackle', 'Rain', 'Bubble', 'Chord'
];
const FILTER_TYPES = [
	'SVF 12', 'SVF 24', 'LP MS2', 'HP MS2', 'BP OSR', 'LP Crunch', 'LP Sw Res', 'Filther', 'Eq Peak',
	'Eq Notch', 'Phaser', 'Redux', 'Vowel', 'Comb +', 'Comb -', 'Plate', 'Membrane'
];
const LFO_FX = [
	'None', 'Offset', 'Attenuvert', 'Gate', 'Skew Uni', 'Skew Bi', 'Unipolar', 'Quantizer', 'S&H',
	'Indep S&H', 'Clipper', 'Fade In', 'Fade Out', 'Slew Down', 'Slew Up', 'Slew U&D', 'Trig Env',
	'Comparator', 'Scrambler'
];
const LOOP_MODES = ['None', 'Trigger', 'Loop', 'AD Loop'];

const ads = (E: string): PanelGroup['controls'] => [
	{ kind: 'box', param: `${E} Attack`, title: 'A' },
	{ kind: 'box', param: `${E} Decay`, title: 'D' },
	{ kind: 'box', param: `${E} Sustain`, title: 'S' },
	{ kind: 'box', param: `${E} Release`, title: 'R' }
];

const slopesAndLoop = (E: string): PanelGroup[] => [
	{
		title: 'Slopes',
		controls: [
			{ kind: 'box', param: `${E} A Slope`, title: 'A' },
			{ kind: 'box', param: `${E} D Slope`, title: 'D' },
			{ kind: 'box', param: `${E} R Slope`, title: 'R' }
		]
	},
	{ title: 'Loop', controls: [{ kind: 'choice', param: `${E} Loop Mode`, options: LOOP_MODES }] }
];

function enginePages(id: MeldEngineId): PanelPage[] {
	const X = id.toUpperCase();
	return [
		{
			id: `osc-${id}`,
			title: `Engine ${X}`,
			rows: [
				[
					{
						title: `Engine ${X}`,
						switchParam: `${X} On`,
						controls: [
							{ kind: 'switch', param: `${X} On`, title: 'On' },
							{ kind: 'step', param: `${X} Osc Type`, title: 'Type', labels: OSC_TYPES },
							{ kind: 'box', param: `${X} Osc Shape`, title: 'Shape' },
							{ kind: 'box', param: `${X} Osc Tone`, title: 'Tone' },
							{ kind: 'step', param: `${X} Octave`, title: 'Oct', labels: signed(-3, 3) },
							{ kind: 'step', param: `${X} Transpose`, title: 'Semi', labels: signed(-12, 12) },
							{ kind: 'box', param: `${X} Detune`, title: 'Detune' }
						]
					}
				],
				[
					{
						title: 'Pitch',
						controls: [
							{ kind: 'switch', param: `${X} Keytracking`, title: 'Key' },
							{ kind: 'box', param: `${X} Transp Scale`, title: 'Scale St' },
							{ kind: 'switch', param: `${X} Osc Scale Aware`, title: 'Scale' }
						]
					},
					{
						title: 'Reset',
						controls: [
							{ kind: 'switch', param: `${X} Reset`, title: 'Reset' },
							{ kind: 'switch', param: `${X} Reset To Voice Offset`, title: 'Offset' }
						]
					},
					{
						title: 'Glide',
						controls: [
							{ kind: 'choice', param: `${X} Glide Mode`, options: ['Port', 'Gliss'] },
							{ kind: 'box', param: `${X} Glide Time`, title: 'Time' }
						]
					}
				]
			]
		},
		{
			id: `filter-${id}`,
			title: `Filter ${X}`,
			rows: [
				[
					{
						title: `Filter ${X}`,
						switchParam: `${X} Filter On`,
						controls: [
							{ kind: 'switch', param: `${X} Filter On`, title: 'On' },
							{ kind: 'step', param: `${X} Filter Type`, title: 'Type', labels: FILTER_TYPES },
							{ kind: 'box', param: `${X} Filter Freq`, title: 'Freq' },
							{ kind: 'box', param: `${X} Filter Q`, title: 'Q' },
							{ kind: 'box', param: `${X} Filter L-B-H-N`, title: 'L-B-H-N' },
							{ kind: 'switch', param: `${X} Filter Filter Scale Aware`, title: 'Scale' }
						]
					}
				]
			]
		},
		{
			id: `env-${id}`,
			title: `Envelopes ${X}`,
			rows: [
				[{ title: 'Amp Env', page: `amp-${id}`, controls: ads(`${X} Amp`) }],
				[{ title: 'Mod Env', page: `menv-${id}`, controls: ads(`${X} Mod`) }]
			]
		},
		{
			id: `amp-${id}`,
			title: `Amp Env ${X}`,
			parent: `env-${id}`,
			rows: [[{ title: 'Amp Env', controls: ads(`${X} Amp`) }], slopesAndLoop(`${X} Amp`)]
		},
		{
			id: `menv-${id}`,
			title: `Mod Env ${X}`,
			parent: `env-${id}`,
			rows: [
				[
					{
						title: 'Mod Env',
						controls: [
							{ kind: 'box', param: `${X} Mod Initial`, title: 'Initial' },
							{ kind: 'box', param: `${X} Mod Attack`, title: 'A' },
							{ kind: 'box', param: `${X} Mod Peak`, title: 'Peak' },
							{ kind: 'box', param: `${X} Mod Decay`, title: 'D' },
							{ kind: 'box', param: `${X} Mod Sustain`, title: 'S' },
							{ kind: 'box', param: `${X} Mod Release`, title: 'R' },
							{ kind: 'box', param: `${X} Mod Final`, title: 'Final' }
						]
					}
				],
				slopesAndLoop(`${X} Mod`)
			]
		},
		{
			id: `lfo-${id}`,
			title: `LFOs ${X}`,
			rows: [
				[
					{
						title: 'LFO 1',
						page: `lfofx-${id}`,
						controls: [
							{ kind: 'choice', param: `${X} LFO 1 Wave`, options: ['Basic', 'Ramp', 'Wander', 'Altern', 'Euclid', 'Pulsate'] },
							{ kind: 'choice', param: `${X} LFO 1 Sync`, options: ['Free', 'Tempo'] },
							{ kind: 'box', param: `${X} LFO 1 Freq`, title: 'Rate' },
							{ kind: 'step', param: `${X} LFO 1 Synced`, title: 'Sync', labels: SYNCED },
							{ kind: 'switch', param: `${X} LFO 1 Retrig On`, title: 'Retrig' },
							{ kind: 'box', param: `${X} LFO 1 Offset`, title: 'Offset' }
						]
					}
				],
				[
					{
						title: 'LFO 2',
						controls: [
							{ kind: 'choice', param: `${X} LFO 2 Wave`, options: ['Sine', 'Tri', 'Saw Up', 'Saw Dn', 'Rect', 'S&H'] },
							{ kind: 'choice', param: `${X} LFO 2 Sync`, options: ['Free', 'Tempo'] },
							{ kind: 'box', param: `${X} LFO 2 Freq`, title: 'Rate' },
							{ kind: 'step', param: `${X} LFO 2 Synced`, title: 'Sync', labels: SYNCED },
							{ kind: 'switch', param: `${X} LFO 2 Retrig On`, title: 'Retrig' },
							{ kind: 'box', param: `${X} LFO 2 Offset`, title: 'Offset' }
						]
					}
				]
			]
		},
		{
			id: `lfofx-${id}`,
			title: `LFO 1 ${X}`,
			parent: `lfo-${id}`,
			rows: [
				[
					{
						title: 'Shape',
						controls: [
							{ kind: 'box', param: `${X} LFO 1 Shape`, title: 'Shape' },
							{ kind: 'box', param: `${X} LFO 1 Fold`, title: 'Fold' }
						]
					}
				],
				[
					{
						title: 'FX 1',
						controls: [
							{ kind: 'step', param: `${X} LFO 1 FX 1 Type`, title: 'Type', labels: LFO_FX },
							{ kind: 'box', param: `${X} LFO 1 FX 1 Scale`, title: 'Amount' }
						]
					},
					{
						title: 'FX 2',
						controls: [
							{ kind: 'step', param: `${X} LFO 1 FX 2 Type`, title: 'Type', labels: LFO_FX },
							{ kind: 'box', param: `${X} LFO 1 FX 2 Ramp`, title: 'Amount' }
						]
					}
				]
			]
		}
	];
}

const mix = (X: 'A' | 'B'): PanelGroup => ({
	title: `Mix ${X}`,
	controls: [
		{ kind: 'box', param: `${X} Volume`, title: 'Volume' },
		{ kind: 'box', param: `${X} Pan`, title: 'Pan' },
		{ kind: 'box', param: `${X} Tone Filter`, title: 'Tone' }
	]
});

export const MELD_PANEL: InstrumentPanel = {
	// Drawn by the view's own face.
	frame: [],
	pages: [
		...enginePages('a'),
		...enginePages('b'),
		{
			id: 'global',
			title: 'Global',
			rows: [
				[mix('A'), mix('B'), { title: 'Out', controls: [{ kind: 'box', param: 'Volume', title: 'Volume' }] }],
				[
					{
						title: 'Global',
						controls: [
							{ kind: 'box', param: 'Drive', title: 'Drive' },
							{ kind: 'box', param: 'Voice Spread', title: 'Spread' },
							{ kind: 'box', param: 'Engine B Delay', title: 'B Delay' },
							{ kind: 'switch', param: 'Limiter On', title: 'Limiter' },
							{ kind: 'switch', param: 'Link Envelopes', title: 'Link Env' },
							{ kind: 'switch', param: 'Scale Aware', title: 'Scale' },
							{ kind: 'switch', param: 'Mono Legato', title: 'Legato' }
						]
					}
				]
			]
		}
	]
};
