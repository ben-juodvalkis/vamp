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
import type { InstrumentPanel, PanelBoard, PanelPage } from './panelTypes';

/** Voices 0..30 reads 2..32 in Live. */
const VOICES = Array.from({ length: 31 }, (_, i) => String(i + 2));

/** Hammer, Fork, Damper / Pickup and Global: the detail Live's display shows for the clicked section. */
const PAGES: PanelPage[] = [
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
						{ kind: 'box', param: 'P Symmetry', title: 'Sym' },
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
];

/** A page's groups by title, as board sections a knob a column (ADR-514). */
const groups = (id: string, titles?: readonly string[]) =>
	PAGES.find((p) => p.id === id)!
		.rows.flat()
		.filter((g) => !titles || titles.includes(g.title ?? ''))
		.map((group) => ({ kind: 'group' as const, stack: 1, group }));

/**
 * Electric at full screen (ADR-512, re-laid by ADR-514): an instrument of
 * 29 controls, so every knob is large and a column to itself, three rows
 * read in the signal's order: the hammer (Stiffness, Force, Noise), the
 * fork and the damper, then the pickup and Global. Two to a column
 * (ADR-512's layout) left most of the screen empty between small knobs.
 */
const BOARD: PanelBoard = {
	rows: [
		{ tiles: [{ id: 'hammer', title: 'Hammer', sections: groups('hammer') }] },
		{ tiles: [{ id: 'fork', title: 'Fork', sections: groups('fork') }, { id: 'damper', sections: groups('damper-pickup', ['Damper']) }] },
		{ tiles: [{ id: 'pickup', sections: groups('damper-pickup', ['Pickup']) }, { id: 'global', title: 'Global', sections: groups('global') }] }
	]
};

export const ELECTRIC_PANEL: InstrumentPanel = {
	// Knobs, but an envelope's stages stay boxes: their heights draw it (ADR-509).
	boxFace: 'knob',
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
					{ kind: 'box', param: 'P Symmetry', title: 'Sym' },
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
	pages: PAGES,
	board: BOARD
};
