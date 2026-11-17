/**
 * Electric (`LoungeLizard`) in Live's arrangement (ADR-487).
 *
 * Live's panel is five sections, Hammer · Fork · Damper · Pickup · Global,
 * over a display showing the clicked section's detail; here the five are
 * the frame, two rows of knobs each, and the pages hold the detail. Names are Live's (docs/reference/instruments/Electric.md):
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
						{ kind: 'box', param: 'F Tine Color', title: 'Color' },
						{ kind: 'box', param: 'F Tine Decay', title: 'Decay' },
						{ kind: 'box', param: 'F Tine Vol', title: 'Volume' },
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
						{ kind: 'box', param: 'Damp Amount', title: 'Amount' },
						{ kind: 'box', param: 'Damp Tone', title: 'Tone' },
						{ kind: 'box', param: 'Damp Balance', title: 'Balance' }
					]
				},
				{
					title: 'Pickup',
					controls: [
						{ kind: 'choice', param: 'Pickup Model', options: ['R', 'W'] },
						{ kind: 'box', param: 'P Distance', title: 'Distance' },
						{ kind: 'box', param: 'P Symmetry', title: 'Sym' },
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
				{
					title: 'Pitch',
					controls: [
						{ kind: 'box', param: 'Semitone', title: 'Semi' },
						{ kind: 'box', param: 'Detune', title: 'Detune' }
					]
				},
				{
					// The keyboard's stretch tuning over how many notes it sounds.
					title: 'Keyboard',
					controls: [
						{ kind: 'box', param: 'KB Stretch', title: 'Stretch' },
						{ kind: 'step', param: 'Voices', title: 'Voices', labels: VOICES }
					]
				},
				{
					title: 'Bend',
					controls: [
						{ kind: 'box', param: 'PB Range', title: 'PB' },
						{ kind: 'box', param: 'Note PB Range', title: 'Note PB', whole: true }
					]
				},
				{ title: 'Output', controls: [{ kind: 'box', param: 'Volume', title: 'Volume' }] }
			]
		]
	}
];

/** A page's groups by title, as board sections, their cells `stack` high. */
const groups = (id: string, stack: number, titles?: readonly string[]) =>
	PAGES.find((p) => p.id === id)!
		.rows.flat()
		.filter((g) => !titles || titles.includes(g.title ?? ''))
		.map((group) => ({ kind: 'group' as const, stack, group }));

/**
 * Electric at full screen (ADR-512): three rows read in the signal's order,
 * the hammer (Stiffness, Force, Noise), the fork and the damper, then the
 * pickup and Global. Every knob on the board is one size (ADR-544: knobs
 * that sit together are one size; ADR-515 had ranked each section's leads
 * large and stacked the rest small beside them). So the hammer's ten knobs
 * and the fork's and damper's ten each stand in one row, a column a knob,
 * on the same ten columns, and the pickup and Global stack two high on a
 * taller row: the model over its distance, the keyboard's stretch over its
 * voices, the volume a column of its own.
 */
const BOARD: PanelBoard = {
	rows: [
		{ tiles: [{ id: 'hammer', title: 'Hammer', sections: groups('hammer', 1) }] },
		{ tiles: [{ id: 'fork', title: 'Fork', sections: groups('fork', 1) }, { id: 'damper', title: 'Damper', sections: groups('damper-pickup', 1, ['Damper']) }] },
		{
			weight: 1.5,
			tiles: [{ id: 'pickup', title: 'Pickup', sections: groups('damper-pickup', 2, ['Pickup']) }, { id: 'global', title: 'Global', sections: groups('global', 2) }]
		}
	]
};

export const ELECTRIC_PANEL: InstrumentPanel = {
	// Knobs, but an envelope's stages stay boxes: their heights draw it (ADR-509).
	boxFace: 'knob',
	// Live's five sections (2026-11-08; four of two large knobs until then,
	// which left the band's height empty above and below each row): the
	// hammer and the fork two columns of two rows of medium knobs, the
	// damper one column, the pickup its distance over its symmetry beside
	// its model, and Global's voices over its volume. The pages hold the rest.
	frame: [
		{
			kind: 'group',
			group: {
				title: 'Hammer',
				page: 'hammer',
				columns: 2,
				controls: [
					{ kind: 'box', param: 'M Stiffness', title: 'Stiffness' },
					{ kind: 'box', param: 'M Force', title: 'Force' },
					{ kind: 'box', param: 'Noise Amount', title: 'Noise' },
					{ kind: 'box', param: 'Noise Decay', title: 'Decay' }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Fork',
				page: 'fork',
				columns: 2,
				controls: [
					{ kind: 'box', param: 'F Tine Vol', title: 'Tine' },
					{ kind: 'box', param: 'F Tone Vol', title: 'Tone' },
					{ kind: 'box', param: 'F Tine Color', title: 'Color' },
					{ kind: 'box', param: 'F Tine Decay', title: 'Decay' }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Damper',
				page: 'damper-pickup',
				columns: 1,
				controls: [
					{ kind: 'box', param: 'Damp Amount', title: 'Amount' },
					{ kind: 'box', param: 'Damp Tone', title: 'Tone' }
				]
			}
		},
		{
			kind: 'group',
			group: {
				title: 'Pickup',
				page: 'damper-pickup',
				// Distance over Symmetry, the model's R | W beside them (`frameColumns`).
				columns: 2,
				controls: [
					{ kind: 'box', param: 'P Distance', title: 'Distance' },
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
				// Voices over Volume, as the other columns stack two: the voices'
				// count hangs under its name, which wants the room between the
				// rows (ADR-544; it was the lower knob, its count in the inset),
				// and the volume ends the face as Operator's and Collision's do.
				columns: 1,
				controls: [
					{ kind: 'step', param: 'Voices', title: 'Voices', labels: VOICES },
					{ kind: 'box', param: 'Volume', title: 'Volume' }
				]
			}
		}
	],
	pages: PAGES,
	board: BOARD
};
