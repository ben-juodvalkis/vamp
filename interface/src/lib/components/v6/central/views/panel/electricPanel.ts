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
						{ kind: 'box', param: 'M Stiffness', title: 'Amount', knobSize: 'xl' },
						{ kind: 'box', param: 'M Stiff < Vel', title: 'Vel', knobSize: 's' },
						{ kind: 'box', param: 'M Stiff < Key', title: 'Key', knobSize: 's' }
					]
				},
				{
					title: 'Force',
					controls: [
						{ kind: 'box', param: 'M Force', title: 'Amount', knobSize: 'xl' },
						{ kind: 'box', param: 'M Force < Vel', title: 'Vel', knobSize: 's' },
						{ kind: 'box', param: 'M Force < Key', title: 'Key', knobSize: 's' }
					]
				},
				{
					title: 'Noise',
					controls: [
						{ kind: 'box', param: 'Noise Amount', title: 'Amount', knobSize: 'l' },
						{ kind: 'box', param: 'Noise Pitch', title: 'Pitch', knobSize: 's' },
						{ kind: 'box', param: 'Noise Decay', title: 'Decay', knobSize: 's' },
						{ kind: 'box', param: 'Noise < Key', title: 'Key', knobSize: 's' }
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
						{ kind: 'box', param: 'F Tine Color', title: 'Color', knobSize: 'xl' },
						{ kind: 'box', param: 'F Tine Decay', title: 'Decay', knobSize: 'xl' },
						{ kind: 'box', param: 'F Tine Vol', title: 'Volume', knobSize: 'm' },
						{ kind: 'box', param: 'F Tine < Key', title: 'Key', knobSize: 's' }
					]
				},
				{
					title: 'Tone',
					controls: [
						{ kind: 'box', param: 'F Tone Vol', title: 'Volume', knobSize: 'm' },
						{ kind: 'box', param: 'F Tone Decay', title: 'Decay', knobSize: 'm' }
					]
				},
				{ title: 'Release', controls: [{ kind: 'box', param: 'F Release', title: 'Release', knobSize: 'm' }] }
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
						{ kind: 'box', param: 'Damp Amount', title: 'Amount', knobSize: 'l' },
						{ kind: 'box', param: 'Damp Tone', title: 'Tone', knobSize: 'm' },
						{ kind: 'box', param: 'Damp Balance', title: 'Balance', knobSize: 's' }
					]
				},
				{
					title: 'Pickup',
					controls: [
						{ kind: 'choice', param: 'Pickup Model', options: ['R', 'W'] },
						{ kind: 'box', param: 'P Distance', title: 'Distance', knobSize: 'xl' },
						{ kind: 'box', param: 'P Symmetry', title: 'Sym', knobSize: 'm' },
						{ kind: 'box', param: 'P Amp In', title: 'Amp In', knobSize: 'm' },
						{ kind: 'box', param: 'P Amp Out', title: 'Amp Out', knobSize: 'm' },
						{ kind: 'box', param: 'P Amp < Key', title: 'Key', knobSize: 's' }
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
						{ kind: 'box', param: 'Semitone', title: 'Semi', knobSize: 's' },
						{ kind: 'box', param: 'Detune', title: 'Detune', knobSize: 's' },
						{ kind: 'box', param: 'KB Stretch', title: 'Stretch', knobSize: 's' }
					]
				},
				{
					title: 'Bend',
					controls: [
						{ kind: 'box', param: 'PB Range', title: 'PB', knobSize: 's' },
						{ kind: 'box', param: 'Note PB Range', title: 'Note PB', knobSize: 's' }
					]
				},
				{ title: 'Output', controls: [{ kind: 'box', param: 'Volume', title: 'Volume', knobSize: 'l' }] }
			]
		]
	}
];

/**
 * How many of each section's controls lead (ADR-515): those stand a column
 * each, the full height, and the rest stack two high beside them. By Live's
 * panel: the hammer's stiffness and force, the tine's color and decay, the
 * damper's amount, the pickup's model and distance and the output lead;
 * their velocity and key amounts, the noise, the tone and the tuning follow.
 */
const LEADS: Record<string, number> = { Stiffness: 1, Force: 1, Noise: 1, Tine: 2, Damper: 1, Pickup: 2 };

/** A page's groups by title, as board sections: the leads a column each, the rest two high. */
const groups = (id: string, titles?: readonly string[]) =>
	PAGES.find((p) => p.id === id)!
		.rows.flat()
		.filter((g) => !titles || titles.includes(g.title ?? ''))
		.map((group) => ({ kind: 'group' as const, stack: 2, lead: LEADS[group.title ?? ''] ?? 0, group }));

/**
 * Electric at full screen (ADR-512, re-laid by ADR-514 and ADR-515): three
 * rows read in the signal's order, the hammer (Stiffness, Force, Noise),
 * the fork and the damper, then the pickup and Global. Each section's
 * leads are large and full height, its secondary controls stacked smaller
 * beside them (ADR-515: by rank, as Live's panel ranks them; every knob
 * large and a column to itself, ADR-514's, left nothing leading).
 */
const BOARD: PanelBoard = {
	rows: [
		{ tiles: [{ id: 'hammer', title: 'Hammer', sections: groups('hammer') }] },
		{ tiles: [{ id: 'fork', title: 'Fork', sections: groups('fork') }, { id: 'damper', title: 'Damper', sections: groups('damper-pickup', ['Damper']) }] },
		{ tiles: [{ id: 'pickup', title: 'Pickup', sections: groups('damper-pickup', ['Pickup']) }, { id: 'global', title: 'Global', sections: groups('global') }] }
	]
};

export const ELECTRIC_PANEL: InstrumentPanel = {
	// Knobs, but an envelope's stages stay boxes: their heights draw it (ADR-509).
	boxFace: 'knob',
	// Live's five sections (2026-11-08; four of two large knobs until then,
	// which left the band's height empty above and below each row): the
	// hammer and the fork two columns of two rows of medium knobs, the
	// damper one column, the pickup its distance over its symmetry beside
	// its model, and Global's volume over its voices. The pages hold the rest.
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
				// Volume over Voices, as the other columns stack two.
				columns: 1,
				controls: [
					{ kind: 'box', param: 'Volume', title: 'Volume' },
					{ kind: 'step', param: 'Voices', title: 'Voices', labels: VOICES }
				]
			}
		}
	],
	pages: PAGES,
	board: BOARD
};
