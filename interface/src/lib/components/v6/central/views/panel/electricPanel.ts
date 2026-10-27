/**
 * Electric (`LoungeLizard`) in Live's arrangement (ADR-487).
 *
 * Live's panel is four sections of two knobs each, Hammer · Fork ·
 * Damper/Pickup · Global, over a display showing the clicked section's
 * detail; here the four are the frame and each eyebrow opens that detail
 * as a page. Names are Live's (docs/reference/instruments/Electric.md):
 * the old view wrote these same parameters by index (8, 16, 20, 24), with
 * comments that named two of them wrongly.
 */
import type { InstrumentPanel } from './panelTypes';

/** Voices 0..30 reads 2..32 in Live. */
const VOICES = Array.from({ length: 31 }, (_, i) => String(i + 2));

export const ELECTRIC_PANEL: InstrumentPanel = {
	frame: [
		{
			kind: 'group',
			group: {
				title: 'Hammer',
				page: 'hammer',
				controls: [
					{ kind: 'box', param: 'M Stiffness', title: 'Stiffness' },
					{ kind: 'box', param: 'Noise Amount', title: 'Noise' }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Fork',
				page: 'fork',
				controls: [
					{ kind: 'box', param: 'F Tine Vol', title: 'Tine' },
					{ kind: 'box', param: 'F Tone Vol', title: 'Tone' }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Damper / Pickup',
				page: 'damper-pickup',
				controls: [
					{ kind: 'box', param: 'P Symmetry', title: 'Symmetry' },
					{ kind: 'choice', param: 'Pickup Model', options: ['R', 'W'] }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Global',
				page: 'global',
				controls: [{ kind: 'box', param: 'Volume', title: 'Volume' }]
			}
		}
	],
	pages: [
		{
			id: 'hammer',
			title: 'Hammer',
			rows: [
				[
					{
						title: 'Stiffness',
						controls: [
							{ kind: 'box', param: 'M Stiffness', title: 'Amount' },
							{ kind: 'box', param: 'M Stiff < Vel', title: 'Vel' },
							{ kind: 'box', param: 'M Stiff < Key', title: 'Key' }
						]
					},
					{
						title: 'Force',
						controls: [
							{ kind: 'box', param: 'M Force', title: 'Amount' },
							{ kind: 'box', param: 'M Force < Vel', title: 'Vel' },
							{ kind: 'box', param: 'M Force < Key', title: 'Key' }
						]
					},
					{
						title: 'Noise',
						controls: [
							{ kind: 'box', param: 'Noise Amount', title: 'Amount' },
							{ kind: 'box', param: 'Noise Pitch', title: 'Pitch' },
							{ kind: 'box', param: 'Noise Decay', title: 'Decay' },
							{ kind: 'box', param: 'Noise < Key', title: 'Key' }
						]
					}
				]
			]
		},
		{
			id: 'fork',
			title: 'Fork',
			rows: [
				[
					{
						title: 'Tine',
						controls: [
							{ kind: 'box', param: 'F Tine Vol', title: 'Volume' },
							{ kind: 'box', param: 'F Tine Decay', title: 'Decay' },
							{ kind: 'box', param: 'F Tine Color', title: 'Color' },
							{ kind: 'box', param: 'F Tine < Key', title: 'Key' }
						]
					},
					{
						title: 'Tone',
						controls: [
							{ kind: 'box', param: 'F Tone Vol', title: 'Volume' },
							{ kind: 'box', param: 'F Tone Decay', title: 'Decay' }
						]
					},
					{ title: 'Release', controls: [{ kind: 'box', param: 'F Release', title: 'Release' }] }
				]
			]
		},
		{
			id: 'damper-pickup',
			title: 'Damper / Pickup',
			rows: [
				[
					{
						title: 'Damper',
						controls: [
							{ kind: 'box', param: 'Damp Tone', title: 'Tone' },
							{ kind: 'box', param: 'Damp Amount', title: 'Amount' },
							{ kind: 'box', param: 'Damp Balance', title: 'Balance' }
						]
					},
					{
						title: 'Pickup',
						controls: [
							{ kind: 'choice', param: 'Pickup Model', options: ['R', 'W'] },
							{ kind: 'box', param: 'P Symmetry', title: 'Symmetry' },
							{ kind: 'box', param: 'P Distance', title: 'Distance' },
							{ kind: 'box', param: 'P Amp In', title: 'Amp In' },
							{ kind: 'box', param: 'P Amp Out', title: 'Amp Out' },
							{ kind: 'box', param: 'P Amp < Key', title: 'Key' }
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
					{ title: 'Voices', controls: [{ kind: 'step', param: 'Voices', title: 'Voices', labels: VOICES }] },
					{
						title: 'Pitch',
						controls: [
							{ kind: 'box', param: 'Semitone', title: 'Semi' },
							{ kind: 'box', param: 'Detune', title: 'Detune' },
							{ kind: 'box', param: 'KB Stretch', title: 'Stretch' }
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
