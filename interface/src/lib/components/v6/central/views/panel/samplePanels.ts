/**
 * Simpler and Sampler at full screen (ADR-521): every section on one board,
 * as the other instruments' boards are (ADR-512, ADR-516). Their band faces
 * stay hand-laid (the loop brace, the Sampler row), so these panels have a
 * board and no frame or pages of their own: `instrumentPanels.test.ts`
 * checks the board's names against the measured dumps directly.
 *
 * The two share Live's names for the filter, the envelopes and the output
 * (`docs/reference/instruments/Simpler.md`, `Sampler_all_sections.md`). A
 * Sampler lists a section's parameters only while its switch is on, so a
 * tile with a switch ghosts until it is, and touching a ghost turns it on
 * (`PanelParams.write`); the next touch moves the value.
 *
 * Left off both boards: each envelope's loop settings (Mode, Loop, Retrig,
 * R < Vel) and slopes, Sample Selector, and the Sampler's zone editor (not
 * parameters at all). Live keeps them; the board is for the sound.
 */
import type { InstrumentPanel, PanelBoardSection, PanelControl, PanelEnvelope, PanelGroup } from './panelTypes';
import { matrixColumn as col } from './panelTypes';

/** Live's LFO waves, in its order, as both devices list them. */
export const SAMPLE_LFO_WAVES = ['Sine', 'Square', 'Triangle', 'Saw Down', 'Saw Up', 'Random'] as const;

/** "L Sync Rate" 0..21, Live's own labels. */
const SYNC_RATES = ['1/64', '1/48', '1/32', '1/24', '1/16', '1/12', '1/8', '1/6', '3/16', '1/4', '5/16', '1/3', '3/8', '1/2', '3/4', '1', '1.5', '2', '3', '4', '6', '8'];

/** Sampler's "O Type" 0..20. */
const OSC_TYPES = ['Sine', 'Sine 4 Bit', 'Sine 8 Bit', 'Sw 3', 'Sw 4', 'Sw 6', 'Sw 8', 'Sw 16', 'Sw 32', 'Sw 64', 'Sw D', 'Sq 3', 'Sq 4', 'Sq 6', 'Sq 8', 'Sq 16', 'Sq 32', 'Sq 64', 'Sq D', 'Tri', 'Noise'];

/** Sampler's "O Fix Freq Mul" 0..4. */
const FIX_MUL = ['0.001', '0.01', '0.1', '1', '10'];

/** An envelope by its prefix (`Ve`, `Fe`, `Pe`, `Oe`, `Ae`); Sampler's carry their levels too. */
export function sampleEnvelope(prefix: string, levels: boolean): PanelEnvelope {
	return {
		attack: `${prefix} Attack`,
		decay: `${prefix} Decay`,
		sustain: `${prefix} Sustain`,
		release: `${prefix} Release`,
		...(levels ? { initial: `${prefix} Init`, peak: `${prefix} Peak` } : {}),
		// The amp envelope always releases to silence: Sampler lists no `Ve End`.
		...(levels && prefix !== 'Ve' ? { final: `${prefix} End` } : {})
	};
}

const envParams = (prefix: string, levels: boolean) => Object.values(sampleEnvelope(prefix, levels));

/** A board group, its cells `stack` high; every choice a pick, as a tab beside knobs reads as another kind of control. */
const group = (title: string, controls: PanelControl[], extra: Partial<PanelGroup> = {}, stack = 2): PanelBoardSection => ({
	kind: 'group',
	stack,
	tabMax: 1,
	group: { title, controls, ...extra }
});

/** The envelope's picture (`slots[slot]`), `columns` wide. */
const envSlot = (slot: string, prefix: string, levels: boolean, columns = 3, sw?: string): PanelBoardSection => ({
	kind: 'slot',
	slot,
	columns,
	params: [...envParams(prefix, levels), ...(sw ? [sw] : [])]
});

/** The filter: its pad (`slots.filter`), its type and circuit, what moves it. */
function filterSections(): PanelBoardSection[] {
	return [
		{ kind: 'slot', slot: 'filter', columns: 2, params: ['F On', 'Filter Freq', 'Filter Res', 'Filter Type', 'Filter Slope', 'Filter Morph'] },
		group(
			'Type · Circuit',
			[
				{ kind: 'choice', param: 'Filter Type', title: 'Type', options: ['LP', 'HP', 'BP', 'Notch', 'Morph'] },
				{ kind: 'choice', param: 'Filter Slope', title: 'Slope', options: ['12 dB', '24 dB'] },
				{ kind: 'choice', param: 'Filter Circuit - LP/HP', title: 'LP / HP', options: ['Clean', 'OSR', 'MS2', 'SMP', 'PRD'] },
				{ kind: 'choice', param: 'Filter Circuit - BP/NO/Morph', title: 'BP / Morph', options: ['Clean', 'OSR'] },
				{ kind: 'box', param: 'Filter Morph', title: 'Morph' },
				{ kind: 'box', param: 'Filter Drive', title: 'Drive' }
			],
			{ switchParam: 'F On' }
		),
		group(
			'Mod',
			[
				{ kind: 'box', param: 'Filt < Key', title: 'Key' },
				{ kind: 'box', param: 'Filt < Vel', title: 'Vel' },
				{ kind: 'box', param: 'Filt < LFO', title: 'LFO' }
			],
			{ switchParam: 'F On' }
		)
	];
}

/** An LFO's controls by its prefix (`L` on Simpler, `L 1` on Sampler). */
const lfoControls = (p: string): PanelControl[] => [
	{ kind: 'choice', param: `${p} Wave`, title: 'Wave', options: SAMPLE_LFO_WAVES },
	{ kind: 'choice', param: `${p} Sync`, title: 'Sync', options: ['Free', 'Sync'] },
	{ kind: 'box', param: `${p} Rate`, title: 'Rate' },
	{ kind: 'step', param: `${p} Sync Rate`, title: 'Sync Rate', labels: SYNC_RATES },
	{ kind: 'box', param: `${p} R < Key`, title: 'Key' },
	{ kind: 'box', param: `${p} Attack`, title: 'Attack' },
	{ kind: 'switch', param: `${p} Retrig`, title: 'Retrig' },
	{ kind: 'box', param: `${p} Offset`, title: 'Offset' }
];

/**
 * Simpler at full screen: the sample across the top (the loop brace with
 * its mode, warp, gain and actions, from the view's `slots.sample`), then
 * the amp envelope beside the filter, then the filter and pitch envelopes
 * beside the LFO, then Global.
 */
export const SIMPLER_PANEL: InstrumentPanel = {
	frame: [],
	pages: [],
	boxFace: 'knob',
	board: {
		rows: [
			{
				weight: 2.6,
				tiles: [
					{
						id: 'sample',
						title: 'Sample',
						sections: [
							// The brace and the view's own sample controls (properties, not parameters).
							{ kind: 'slot', slot: 'sample', columns: 11, params: ['S Start', 'S Length', 'S Loop On'] },
							group('Loop', [
								{ kind: 'box', param: 'S Loop Length', title: 'Length' },
								{ kind: 'box', param: 'S Loop Fade', title: 'Fade' }
							]),
							group('Fades', [
								{ kind: 'box', param: 'Fade In', title: 'In' },
								{ kind: 'box', param: 'Fade Out', title: 'Out' },
								{ kind: 'choice', param: 'Trigger Mode', title: 'Mode', options: ['Trigger', 'Gate'] }
							])
						]
					}
				]
			},
			{
				weight: 2.2,
				tiles: [
					{
						id: 'amp',
						title: 'Amp',
						sections: [
							envSlot('amp', 'Ve', false, 4),
							group('Output', [
								{ kind: 'box', param: 'Volume', title: 'Volume' },
								{ kind: 'box', param: 'Vol < Vel', title: 'Vel' },
								{ kind: 'box', param: 'Pan', title: 'Pan' },
								{ kind: 'box', param: 'Pan < Rnd', title: 'Rnd' }
							])
						]
					},
					{ id: 'filter', title: 'Filter', switchParam: 'F On', sections: filterSections() }
				]
			},
			{
				weight: 2,
				tiles: [
					{
						id: 'filter-env',
						title: 'Filter Env',
						switchParam: 'Fe On',
						sections: [envSlot('filterEnv', 'Fe', false), group('', [{ kind: 'box', param: 'Fe < Env', title: 'Amount' }], { switchParam: 'Fe On' }, 1)]
					},
					{
						id: 'pitch-env',
						title: 'Pitch Env',
						switchParam: 'Pe On',
						sections: [envSlot('pitchEnv', 'Pe', false), group('', [{ kind: 'box', param: 'Pe < Env', title: 'Amount' }], { switchParam: 'Pe On' }, 1)]
					},
					{
						id: 'lfo',
						title: 'LFO',
						switchParam: 'L On',
						sections: [
							{ kind: 'slot', slot: 'lfo', columns: 2, params: ['L On', 'L Wave', 'L Sync', 'L Rate', 'L Sync Rate'] },
							group('', lfoControls('L'), { switchParam: 'L On' }),
							group('To', [
								{ kind: 'box', param: 'Vol < LFO', title: 'Vol' },
								{ kind: 'box', param: 'Pan < LFO', title: 'Pan' },
								{ kind: 'box', param: 'Pitch < LFO', title: 'Pitch' }
							])
						]
					}
				]
			},
			{
				weight: 1.5,
				tiles: [
					{
						id: 'global',
						title: 'Global',
						sections: [
							group('Pitch', [
								{ kind: 'box', param: 'Transpose', title: 'Transpose' },
								{ kind: 'box', param: 'Detune', title: 'Detune' }
							], {}, 1),
							group('Glide', [
								{ kind: 'choice', param: 'Glide Mode', title: 'Glide', options: ['Off', 'Porta', 'Glide'] },
								{ kind: 'box', param: 'Glide Time', title: 'Time' }
							], {}, 1),
							group('Voices', [
								{ kind: 'box', param: 'Spread', title: 'Spread' },
								{ kind: 'switch', param: 'Snap', title: 'Snap' }
							], {}, 1)
						]
					}
				]
			}
		]
	}
};

const SAMPLER_LFOS = [1, 2, 3] as const;

/**
 * Sampler at full screen: the oscillator and the pitch beside it, the
 * filter, shaper and filter envelope, the amp with its output and the aux
 * envelope beside Global, and the three LFOs as one table (a row an LFO).
 */
export const SAMPLER_PANEL: InstrumentPanel = {
	frame: [],
	pages: [],
	boxFace: 'knob',
	board: {
		rows: [
			{
				weight: 2,
				tiles: [
					{
						id: 'osc',
						title: 'Oscillator',
						switchParam: 'Osc On',
						sections: [
							group('Wave', [
								{ kind: 'choice', param: 'O Mode', title: 'Mode', options: ['FM', 'AM'] },
								{ kind: 'step', param: 'O Type', title: 'Type', labels: OSC_TYPES },
								{ kind: 'box', param: 'O Volume', title: 'Volume' },
								{ kind: 'box', param: 'O Vol < Vel', title: 'Vel' }
							], { switchParam: 'Osc On' }),
							group('Frequency', [
								{ kind: 'box', param: 'O Coarse', title: 'Coarse' },
								{ kind: 'box', param: 'O Fine', title: 'Fine' },
								{ kind: 'switch', param: 'O Fix On', title: 'Fixed' },
								{ kind: 'box', param: 'O Fix Freq', title: 'Freq' },
								{ kind: 'step', param: 'O Fix Freq Mul', title: 'Mul', labels: FIX_MUL }
							], { switchParam: 'Osc On' }),
							envSlot('oscEnv', 'Oe', true, 3, 'Osc On')
						]
					},
					{
						id: 'pitch-env',
						title: 'Pitch Env',
						switchParam: 'Pe On',
						sections: [envSlot('pitchEnv', 'Pe', true), group('', [{ kind: 'box', param: 'Pe < Env', title: 'Amount' }], { switchParam: 'Pe On' }, 1)]
					},
					{
						id: 'pitch',
						title: 'Pitch',
						sections: [
							group('', [
								{ kind: 'box', param: 'Transpose', title: 'Transpose' },
								{ kind: 'box', param: 'Detune', title: 'Detune' },
								{ kind: 'box', param: 'Key Zone Shift', title: 'Zone' },
								{ kind: 'box', param: 'Pitch < LFO', title: 'LFO' }
							])
						]
					}
				]
			},
			{
				weight: 2.2,
				tiles: [
					{ id: 'filter', title: 'Filter', switchParam: 'F On', sections: filterSections() },
					{
						id: 'shaper',
						title: 'Shaper',
						switchParam: 'Shaper On',
						sections: [
							group('', [
								{ kind: 'choice', param: 'Shaper Type', title: 'Type', options: ['Soft', 'Hard', 'Sine', '4Bit'] },
								{ kind: 'box', param: 'Shaper Amt', title: 'Amount' },
								{ kind: 'switch', param: 'Shaper Pre-Filter', title: 'Pre' }
							], { switchParam: 'Shaper On' })
						]
					},
					{
						id: 'filter-env',
						title: 'Filter Env',
						switchParam: 'Fe On',
						sections: [envSlot('filterEnv', 'Fe', true), group('', [{ kind: 'box', param: 'Fe < Env', title: 'Amount' }], { switchParam: 'Fe On' }, 1)]
					}
				]
			},
			{
				weight: 2.2,
				tiles: [
					{
						id: 'amp',
						title: 'Amp',
						sections: [
							envSlot('amp', 'Ve', true, 4),
							group('Output', [
								{ kind: 'box', param: 'Volume', title: 'Volume' },
								{ kind: 'box', param: 'Vol < Vel', title: 'Vel' },
								{ kind: 'box', param: 'Pan', title: 'Pan' },
								{ kind: 'box', param: 'Pan < Rnd', title: 'Rnd' },
								{ kind: 'box', param: 'Vol < LFO', title: 'Vol LFO' },
								{ kind: 'box', param: 'Pan < LFO', title: 'Pan LFO' }
							])
						]
					},
					{ id: 'aux-env', title: 'Aux Env', switchParam: 'Ae On', sections: [envSlot('auxEnv', 'Ae', true, 3, 'Ae On')] },
					{
						id: 'global',
						title: 'Global',
						sections: [
							group('', [
								{ kind: 'choice', param: 'Glide Mode', title: 'Glide', options: ['Off', 'Porta', 'Glide'] },
								{ kind: 'box', param: 'Glide Time', title: 'Time' },
								{ kind: 'box', param: 'Spread', title: 'Spread' },
								{ kind: 'switch', param: 'Reverse', title: 'Reverse' },
								{ kind: 'box', param: 'Time', title: 'Stretch' },
								{ kind: 'box', param: 'Time < Key', title: 'Key' },
								{ kind: 'box', param: 'Fade In', title: 'Fade In' },
								{ kind: 'box', param: 'Fade Out', title: 'Fade Out' },
								{ kind: 'choice', param: 'Trigger Mode', title: 'Mode', options: ['Trigger', 'Gate'] },
								{ kind: 'switch', param: 'Snap', title: 'Snap' }
							])
						]
					}
				]
			},
			{
				weight: 1.8,
				tiles: [
					{
						id: 'lfos',
						title: 'LFOs',
						sections: [
							{
								kind: 'matrix',
								matrix: {
									title: 'LFO',
									rows: SAMPLER_LFOS.map((n) => ({ title: String(n), switchParam: `L ${n} On` })),
									groups: [
										{
											title: 'Wave · Rate',
											columns: [
												col('Wave', SAMPLER_LFOS, (n) => ({ kind: 'choice', param: `L ${n} Wave`, title: 'Wave', options: SAMPLE_LFO_WAVES }), { span: 2 }),
												col('Sync', SAMPLER_LFOS, (n) => ({ kind: 'choice', param: `L ${n} Sync`, title: 'Sync', options: ['Free', 'Sync'] })),
												col('Rate', SAMPLER_LFOS, (n) => ({ kind: 'box', param: `L ${n} Rate`, title: 'Rate' })),
												col('Sync Rate', SAMPLER_LFOS, (n) => ({ kind: 'step', param: `L ${n} Sync Rate`, title: 'Sync Rate', labels: SYNC_RATES })),
												col('Key', SAMPLER_LFOS, (n) => ({ kind: 'box', param: `L ${n} R < Key`, title: 'Key' })),
												col('Attack', SAMPLER_LFOS, (n) => ({ kind: 'box', param: `L ${n} Attack`, title: 'Attack' })),
												col('Retrig', SAMPLER_LFOS, (n) => ({ kind: 'switch', param: `L ${n} Retrig`, title: 'Retrig' })),
												col('Offset', SAMPLER_LFOS, (n) => ({ kind: 'box', param: `L ${n} Offset`, title: 'Offset' }))
											]
										},
										{
											// LFO 2 and 3 only: LFO 1 is mono.
											title: 'Stereo',
											columns: [
												col('Stereo', SAMPLER_LFOS, (n) => (n === 1 ? undefined : { kind: 'choice', param: `L ${n} St Mode`, title: 'Stereo', options: ['Phase', 'Spin'] }), { span: 2 }),
												col('Phase', SAMPLER_LFOS, (n) => (n === 1 ? undefined : { kind: 'box', param: `L ${n} Phase`, title: 'Phase' })),
												col('Spin', SAMPLER_LFOS, (n) => (n === 1 ? undefined : { kind: 'box', param: `L ${n} Spin`, title: 'Spin' })),
												col('Width', SAMPLER_LFOS, (n) => (n === 1 ? undefined : { kind: 'box', param: `L ${n} Width`, title: 'Width' }))
											]
										}
									]
								}
							}
						]
					}
				]
			}
		]
	}
};
