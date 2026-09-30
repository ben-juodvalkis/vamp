/**
 * The device band's hand-drawn marks — the instruments lucide has no icon
 * for, drawn in lucide's own 24-unit grid and handed to its `Icon`, which
 * gives them the same svg, stroke and 1px weight as every lucide mark
 * beside them. Pure data, so a sheet of every mark can be rendered outside
 * the app to judge them side by side at strip size.
 *
 * `Icon` renders each node as one flat element — there is no `<g>` — so a
 * mark drawn on a slant carries its `transform` on every piece.
 */

import type { IconNode } from '@lucide/svelte';

/**
 * A shaker: a maraca — an oval head on the diagonal, a short round-ended
 * handle continuing its axis, and two arcs off the head's far end for the
 * shake. A tube shaker would be lucide's pill, and an egg shaker only an egg.
 */
export const SHAKER: IconNode = [
	['ellipse', { cx: '13', cy: '11', rx: '6.5', ry: '5', transform: 'rotate(-45 13 11)' }],
	['path', { d: 'M7.89 14.97 2.96 19.9a0.8 0.8 0 0 0 1.14 1.14l4.93-4.93' }],
	['path', { d: 'M15.20 2.79A8.5 8.5 0 0 1 21.21 8.80' }],
	['path', { d: 'M17.77 1.64A10.5 10.5 0 0 1 22.36 6.23' }]
];

/**
 * One octave of keys from above, seven white and five black, in a box of
 * the given top and height. The black keys are OUTLINED, not filled: a
 * filled one was drawn and compared on a sheet at strip size, and five
 * solid blocks made Keys and Synth the loudest marks in the band, which
 * holds every mark at one weight. The 2 + 3 pattern still says "keyboard".
 * A white-key seam runs full height only where no black key sits on it
 * (E–F); elsewhere it starts under the black key.
 */
function octave(top: number, height: number): IconNode {
	const left = 1.5;
	const key = 3; // seven white keys across 21 units
	const blackDepth = height * 0.58;
	const nodes: IconNode = [['rect', { x: `${left}`, y: `${top}`, width: '21', height: `${height}`, rx: '1.5' }]];
	for (let i = 1; i < 7; i++) {
		const x = left + i * key;
		const black = i !== 3; // no black key between E and F
		const from = black ? top + blackDepth : top;
		nodes.push(['path', { d: `M${x} ${from}V${top + height}` }]);
		if (black) {
			nodes.push([
				'rect',
				{ x: `${x - 0.9}`, y: `${top}`, width: '1.8', height: `${blackDepth}` }
			]);
		}
	}
	return nodes;
}

/** Keys: a keyboard and nothing else — the Key category's mark. */
export const KEYBOARD: IconNode = octave(6, 12);

/**
 * Synth: the same octave, shallower, under a row of four knobs — "a
 * keyboard with knobs", so it reads as kin to the Keys mark and
 * never as the same one.
 */
export const SYNTH: IconNode = [
	['rect', { x: '1.5', y: '3', width: '21', height: '18', rx: '1.5' }],
	['circle', { cx: '5.4', cy: '7', r: '1.6' }],
	['circle', { cx: '10', cy: '7', r: '1.6' }],
	['circle', { cx: '14.6', cy: '7', r: '1.6' }],
	['circle', { cx: '19.2', cy: '7', r: '1.6' }],
	...octave(11, 10).slice(1)
];

/**
 * Upright bass: standing straight up on its endpin, which is what keeps it
 * from reading as the guitar (lucide's leans at 45°). Sloped shoulders into
 * the neck — the double bass's, not the violin's square ones — a scroll,
 * a bridge and two f-holes.
 */
export const UPRIGHT_BASS: IconNode = [
	['circle', { cx: '12', cy: '2.1', r: '1.1' }],
	['path', { d: 'M12 3.2V17' }],
	[
		'path',
		{
			d: 'M12 8C13.8 8 17 10.4 17 12.6C17 14 15.6 14.4 15.6 15.3C15.6 16.2 19 16.8 19 19C19 21.4 16 22.2 12 22.2C8 22.2 5 21.4 5 19C5 16.8 8.4 16.2 8.4 15.3C8.4 14.4 7 14 7 12.6C7 10.4 10.2 8 12 8Z'
		}
	],
	['path', { d: 'M10.4 18h3.2' }],
	['path', { d: 'M9.7 14.4c-.5.9.5 1.9 0 2.8' }],
	['path', { d: 'M14.3 14.4c.5.9-.5 1.9 0 2.8' }],
	['path', { d: 'M12 22.2V23.6' }]
];

/**
 * Violin: the violin family's square-shouldered body on the slant, scroll
 * to the upper left, with a bow across it — the bow is what separates it
 * from the upright bass and the guitar at a glance.
 */
const VIOLIN_TILT = 'rotate(-40 12 12)';
export const VIOLIN: IconNode = [
	['circle', { cx: '12', cy: '1.6', r: '1', transform: VIOLIN_TILT }],
	['path', { d: 'M12 2.6V7.2', transform: VIOLIN_TILT }],
	[
		'path',
		{
			d: 'M12 7.2C14.4 7.2 16.3 7.7 16.3 10C16.3 11.8 14.8 12.2 14.8 13.4C14.8 14.7 17.2 15.2 17.2 17.8C17.2 20.6 15 21.8 12 21.8C9 21.8 6.8 20.6 6.8 17.8C6.8 15.2 9.2 14.7 9.2 13.4C9.2 12.2 7.7 11.8 7.7 10C7.7 7.7 9.6 7.2 12 7.2Z',
			transform: VIOLIN_TILT
		}
	],
	['path', { d: 'M10.8 16.6h2.4', transform: VIOLIN_TILT }],
	['path', { d: 'M2.5 19.5 21.5 4.5' }]
];

/**
 * Trumpet (Brass): leadpipe along the top into the bell on the right, the
 * tuning loop underneath, three valve casings with their buttons standing
 * up. Drawn for the Brass half of the Wind folder today and for a Brass
 * folder of its own once Wind is split.
 */
export const TRUMPET: IconNode = [
	['path', { d: 'M1.5 9.5v2' }],
	['path', { d: 'M1.5 10.5H16.5C18.6 10.5 20.6 8.7 22 6.8V17.2C20.6 15.3 18.6 13.5 16.5 13.5' }],
	['path', { d: 'M16.5 13.5H7a2 2 0 0 0 0 4h8' }],
	['rect', { x: '8.2', y: '8', width: '1.8', height: '5.5', rx: '.5' }],
	['rect', { x: '11.1', y: '8', width: '1.8', height: '5.5', rx: '.5' }],
	['rect', { x: '14', y: '8', width: '1.8', height: '5.5', rx: '.5' }],
	['path', { d: 'M9.1 8V6.2' }],
	['path', { d: 'M12 8V6.2' }],
	['path', { d: 'M14.9 8V6.2' }]
];

/**
 * Saxophone (Wind): the woodwind silhouette that reads at strip size — a
 * flute or clarinet is a stick at 60px. Gooseneck and mouthpiece at the
 * top left, a tube widening down into the U-bend and up into the bell,
 * three key cups along the body.
 */
export const SAXOPHONE: IconNode = [
	['path', { d: 'M4.5 2.5 6.2 3.4C7.6 4.1 9 5 9 6.5' }],
	['path', { d: 'M8.4 6.5H10.4' }],
	['path', { d: 'M8.4 6.5V16.2C8.4 21.8 19.4 21.8 19.4 16.2L21.2 10' }],
	['path', { d: 'M10.4 6.5V15.9C10.4 19.3 17.2 19.3 17.2 15.9L15.8 10' }],
	['path', { d: 'M15.8 10H21.2' }],
	['circle', { cx: '12.3', cy: '10', r: '.8' }],
	['circle', { cx: '12.3', cy: '12.8', r: '.8' }],
	['circle', { cx: '12.3', cy: '15.6', r: '.8' }]
];

/**
 * Harp (Plucked): the pillar on the left, the curved neck across the top,
 * the soundbox on the diagonal, and strings dropped from neck to soundbox.
 */
const HARP_NECK = { x0: 5, y0: 4, cx: 12, cy: 0.5, x1: 20, y1: 5 };
/** Where a vertical string at `x` meets the neck, found by walking the quadratic. */
function neckY(x: number): number {
	const { x0, y0, cx, cy, x1, y1 } = HARP_NECK;
	let best = { dx: Infinity, y: y0 };
	for (let i = 0; i <= 200; i++) {
		const t = i / 200;
		const px = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t * t * x1;
		const py = (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t * t * y1;
		if (Math.abs(px - x) < best.dx) best = { dx: Math.abs(px - x), y: py };
	}
	return Math.round(best.y * 100) / 100;
}
/** The soundbox's inner edge runs (19.5, 5.5) → (7, 21). */
function soundboxY(x: number): number {
	return Math.round((5.5 + ((19.5 - x) * 15.5) / 12.5) * 100) / 100;
}
export const HARP: IconNode = [
	['path', { d: 'M5 4V21.5' }],
	['path', { d: 'M5 4Q12 .5 20 5' }],
	['path', { d: 'M19.5 5.5 7 21M21 6.2 9 21.5' }],
	['path', { d: 'M20 5 21 6.2' }],
	['path', { d: 'M4 21.5H9.5' }],
	...[8.2, 11.1, 14, 16.9].map(
		(x): IconNode[number] => ['path', { d: `M${x} ${neckY(x)}V${soundboxY(x)}` }]
	)
];

/**
 * Hand drum: a djembe — the goblet (bowl, waist, flared foot) under a
 * skin, with the rope lacing zig-zagging down the bowl. The goblet is what
 * tells it from the kit drum; the lacing is what says it is played by hand.
 */
export const HAND_DRUM: IconNode = [
	['ellipse', { cx: '12', cy: '4', rx: '6.5', ry: '1.8' }],
	['path', { d: 'M5.5 4C5.5 8.6 8.6 11.4 9.6 13.2C9.9 15.8 8 18.8 7.6 21.4' }],
	['path', { d: 'M18.5 4C18.5 8.6 15.4 11.4 14.4 13.2C14.1 15.8 16 18.8 16.4 21.4' }],
	['path', { d: 'M7.6 21.4A4.4 1.2 0 0 0 16.4 21.4' }],
	['path', { d: 'M9.6 13.2A2.4 .6 0 0 0 14.4 13.2' }],
	['path', { d: 'M6.3 6.6 8.6 11 10.3 5.8 12 11.4 13.7 5.8 15.4 11 17.7 6.6' }]
];

/**
 * Simpler: its own central view in miniature — a framed waveform display
 * over a row of three knobs, so it reads as half sample, half synth. Kin to
 * the Synth mark (knobs over keys) without being mistaken for it: the knobs
 * here sit below, and carry pointers. The waveform is a hit that decays, a
 * sample's shape rather than an oscillator's.
 */
export const SIMPLER: IconNode = [
	['rect', { x: '1.5', y: '2.5', width: '21', height: '11', rx: '1.5' }],
	['path', { d: 'M3.5 8H5L6 4.5 7 11.5 8 5.5 9 10.5 10 6.5 11 9.5 12 7 13 9 14 7.5 15 8.5 16 7.8 17 8.2 18 8H20.5' }],
	['circle', { cx: '5', cy: '18.5', r: '2.6' }],
	['path', { d: 'M5 18.5 3.3 20.2' }],
	['circle', { cx: '12', cy: '18.5', r: '2.6' }],
	['path', { d: 'M12 18.5V15.9' }],
	['circle', { cx: '19', cy: '18.5', r: '2.6' }],
	['path', { d: 'M19 18.5 20.8 16.7' }]
];
