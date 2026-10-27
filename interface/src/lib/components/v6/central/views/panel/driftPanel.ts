/**
 * Drift in Live's arrangement (ADR-487).
 *
 * Live's panel reads Oscillators · Osc Mix · Filter · Envelopes · LFO/Mod
 * (tabs) · Global. Vamp's Drift view already read that way, with widgets a
 * rule-laid frame would flatten (the oscillator card's waveform grid and
 * OSC 1/2 badge, the source-coloured mixer, the Time and Filter pads), so it
 * keeps that face and its eyebrows open these pages, every parameter but
 * Device On. Names are Live's (docs/reference/instruments/Drift.md).
 */
import type { InstrumentPanel } from './panelTypes';

/** Live's sync divisions, `LFO Synced` / `Cyc Env Synced` 0..21. */
const SYNCED = [
	'8', '6', '4', '3', '2', '1.5', '1', '3/4', '1/2', '3/8', '1/3',
	'5/16', '1/4', '3/16', '1/6', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64'
];
const RATE_MODES = ['Freq', 'Time', 'Ratio', 'Sync'];

export const DRIFT_PANEL: InstrumentPanel = {
	// Drawn by the view's own face; the frame is what a face-less render would show.
	frame: [],
	pages: [
		{
			id: 'oscillators',
			title: 'Oscillators',
			rows: [
				[
					{
						title: 'Osc 1',
						switchParam: 'Osc 1 On',
						controls: [
							{
								kind: 'step',
								param: 'Osc 1 Wave',
								title: 'Wave',
								labels: ['Sine', 'Triangle', 'Shark Tooth', 'Saturated', 'Saw', 'Pulse', 'Rectangle']
							},
							{ kind: 'box', param: 'Osc 1 Shape', title: 'Shape' },
							{ kind: 'step', param: 'Osc 1 Oct', title: 'Oct', labels: ['-2', '-1', '0', '+1', '+2', '+3'] },
							{ kind: 'box', param: 'Osc 1 Shape Mod Amt', title: 'Shape Mod' }
						]
					},
					{
						title: 'Osc 2',
						switchParam: 'Osc 2 On',
						controls: [
							{
								kind: 'step',
								param: 'Osc 2 Wave',
								title: 'Wave',
								labels: ['Sine', 'Triangle', 'Saturated', 'Saw', 'Rectangle']
							},
							{ kind: 'box', param: 'Osc 2 Detune', title: 'Detune' },
							{ kind: 'step', param: 'Osc 2 Oct', title: 'Oct', labels: ['-3', '-2', '-1', '0', '+1', '+2'] }
						]
					},
					{
						title: 'Pitch Mod',
						controls: [
							{ kind: 'box', param: 'Pitch Mod Amt 1', title: 'Amt 1' },
							{ kind: 'box', param: 'Pitch Mod Amt 2', title: 'Amt 2' }
						]
					}
				],
				[
					{
						title: 'Osc Mix',
						controls: [
							{ kind: 'switch', param: 'Osc 1 On', title: 'Osc 1' },
							{ kind: 'box', param: 'Osc 1 Gain', title: 'Gain 1' },
							{ kind: 'switch', param: 'Osc 2 On', title: 'Osc 2' },
							{ kind: 'box', param: 'Osc 2 Gain', title: 'Gain 2' },
							{ kind: 'switch', param: 'Noise On', title: 'Noise' },
							{ kind: 'box', param: 'Noise Gain', title: 'Noise' }
						]
					},
					{
						title: 'To Filter',
						controls: [
							{ kind: 'switch', param: 'Osc 1 Flt On', title: 'Osc 1' },
							{ kind: 'switch', param: 'Osc 2 Flt On', title: 'Osc 2' },
							{ kind: 'switch', param: 'Noise Flt On', title: 'Noise' }
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
						title: 'Low Pass',
						controls: [
							{ kind: 'box', param: 'LP Freq', title: 'Freq' },
							{ kind: 'box', param: 'LP Res', title: 'Res' },
							{ kind: 'choice', param: 'LP Type', options: ['I', 'II'] },
							{ kind: 'box', param: 'Key > LPF', title: 'Key' }
						]
					},
					{
						title: 'High Pass',
						controls: [{ kind: 'box', param: 'HP Freq', title: 'Freq' }]
					},
					{
						title: 'Mod',
						controls: [
							{ kind: 'box', param: 'LP Mod Amt 1', title: 'Amt 1' },
							{ kind: 'box', param: 'LP Mod Amt 2', title: 'Amt 2' }
						]
					}
				]
			]
		},
		{
			id: 'envelopes',
			title: 'Envelopes',
			rows: [
				[
					{
						title: 'Env 1',
						controls: [
							{ kind: 'box', param: 'Env 1 Attack', title: 'A' },
							{ kind: 'box', param: 'Env 1 Decay', title: 'D' },
							{ kind: 'box', param: 'Env 1 Sustain', title: 'S' },
							{ kind: 'box', param: 'Env 1 Release', title: 'R' }
						]
					},
					{
						title: 'Env 2',
						controls: [
							{ kind: 'choice', param: 'Env 2 Cyc On', options: ['Env', 'Cyc'] },
							{ kind: 'box', param: 'Env 2 Attack', title: 'A' },
							{ kind: 'box', param: 'Env 2 Decay', title: 'D' },
							{ kind: 'box', param: 'Env 2 Sustain', title: 'S' },
							{ kind: 'box', param: 'Env 2 Release', title: 'R' }
						]
					}
				],
				[
					{
						title: 'Cycling Env',
						controls: [
							{ kind: 'choice', param: 'Cyc Env Mode', options: RATE_MODES },
							{ kind: 'box', param: 'Cyc Env Rate', title: 'Rate' },
							{ kind: 'box', param: 'Cyc Env Ratio', title: 'Ratio' },
							{ kind: 'box', param: 'Cyc Env Time', title: 'Time' },
							{ kind: 'step', param: 'Cyc Env Synced', title: 'Sync', labels: SYNCED },
							{ kind: 'box', param: 'Cyc Env Tilt', title: 'Tilt' },
							{ kind: 'box', param: 'Cyc Env Hold', title: 'Hold' }
						]
					}
				]
			]
		},
		{
			id: 'lfo-mod',
			title: 'LFO / Mod',
			rows: [
				[
					{
						title: 'LFO',
						controls: [
							{
								kind: 'step',
								param: 'LFO Wave',
								title: 'Wave',
								labels: ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square', 'S & H', 'Wander', 'Lin Env', 'Exp Env']
							},
							{ kind: 'choice', param: 'LFO Mode', options: RATE_MODES },
							{ kind: 'box', param: 'LFO Freq', title: 'Freq' },
							{ kind: 'box', param: 'LFO Ratio', title: 'Ratio' },
							{ kind: 'box', param: 'LFO Time', title: 'Time' },
							{ kind: 'step', param: 'LFO Synced', title: 'Sync', labels: SYNCED },
							{ kind: 'box', param: 'LFO Amount', title: 'Amount' },
							{ kind: 'switch', param: 'LFO Retrig On', title: 'Retrig' }
						]
					}
				],
				[
					{
						title: 'Mod',
						controls: [
							{ kind: 'box', param: 'LFO Mod Amt', title: 'LFO Amt' },
							{ kind: 'box', param: 'Mod Matrix Amt 1', title: 'Matrix 1' },
							{ kind: 'box', param: 'Mod Matrix Amt 2', title: 'Matrix 2' },
							{ kind: 'box', param: 'Mod Matrix Amt 3', title: 'Matrix 3' }
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
						title: 'Voice',
						controls: [
							{ kind: 'box', param: 'Poly Voice Depth', title: 'Depth' },
							{ kind: 'box', param: 'Spread', title: 'Spread' },
							{ kind: 'box', param: 'Strength', title: 'Strength' },
							{ kind: 'box', param: 'Thickness', title: 'Thick' },
							{ kind: 'box', param: 'Glide Time', title: 'Glide' },
							{ kind: 'switch', param: 'Legato On', title: 'Legato' }
						]
					}
				],
				[
					{
						title: 'Play',
						controls: [
							{ kind: 'box', param: 'Drift', title: 'Drift' },
							{ kind: 'box', param: 'Vel > Vol', title: 'Vel > Vol' },
							{ kind: 'switch', param: 'Osc Retrig On', title: 'Retrig' },
							{ kind: 'switch', param: 'Note Pitch Bend On', title: 'Note PB' }
						]
					},
					{
						title: 'Output',
						controls: [
							{ kind: 'box', param: 'Transpose', title: 'Transp' },
							{ kind: 'box', param: 'Volume', title: 'Volume' }
						]
					}
				]
			]
		}
	]
};
