/**
 * A mark for each of Meld's 25 oscillator types (`MELD_OSC_TYPES`, A/B Osc
 * Type 0..24), in the order Live lists them. Hand-drawn line art on a
 * 48-unit square after the pictures Live's own oscillator panel shows for
 * each type: SVG markup drawn in `currentColor` by `MeldOscIcon`, stroked
 * unless an element says otherwise.
 */

const S = 48;

/** A motif repeated over a loose cloud of positions: the Swarm types. */
const SWARM_AT: ReadonlyArray<[number, number]> = [
	[8, 14], [24, 12], [14, 23], [30, 21], [8, 32], [24, 30], [16, 41], [32, 39]
];
const swarm = (motif: (x: number, y: number) => string) =>
	`<path d="${SWARM_AT.map(([x, y]) => motif(x, y)).join(' ')}"/>`;

/** An Archimedean spiral out from the middle: Shepard's Pi. */
function spiral(): string {
	let d = '';
	const turns = 3.25;
	const steps = 120;
	for (let i = 0; i <= steps; i++) {
		const a = (i / steps) * turns * 2 * Math.PI;
		const r = 1 + (i / steps) * 17;
		const x = S / 2 + r * Math.cos(a);
		const y = S / 2 + r * Math.sin(a);
		d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
	}
	return `<path d="${d}"/>`;
}

/** Rays from a hollow middle, every other one dashed: Extratone. */
function burst(): string {
	const ray = (k: number) => {
		const a = (k / 12) * 2 * Math.PI;
		const [c, s] = [Math.cos(a), Math.sin(a)];
		const r1 = 4;
		const r2 = k % 2 ? 14 : 19;
		return `<path d="M${(24 + r1 * c).toFixed(1)} ${(24 + r1 * s).toFixed(1)}L${(24 + r2 * c).toFixed(1)} ${(24 + r2 * s).toFixed(1)}"${k % 3 === 1 ? ' stroke-dasharray="3 3"' : ''}/>`;
	};
	return Array.from({ length: 12 }, (_, k) => ray(k)).join('') + '<circle cx="24" cy="24" r="1.5"/>';
}

/** Rows of bits, a 0 a box and a 1 a bar: Bitgrunge. */
function bits(): string {
	const rows = ['0100', '1010', '0110', '1101'];
	let out = '';
	rows.forEach((row, r) =>
		[...row].forEach((b, c) => {
			const x = 9 + c * 9;
			const y = 8 + r * 9;
			out += b === '0' ? `<rect x="${x}" y="${y}" width="4" height="6" rx="1"/>` : `<path d="M${x + 2} ${y}v6"/>`;
		})
	);
	return out;
}

/** Flat lines, each broken by a spike somewhere along it: Crackle. */
function crackle(): string {
	const at = [26, 14, 30, 20];
	return at
		.map((x, i) => {
			const y = 11 + i * 9;
			return `<path d="M6 ${y}H${x}l2-5 2 9 2-4H42"/>`;
		})
		.join('');
}

/** Sine rows, `n` cycles across 36 units starting at x 6. */
function sineRow(y: number, cycles: number, amp = 4, x0 = 6, w = 36): string {
	const half = w / (cycles * 2);
	let d = `M${x0} ${y}`;
	for (let i = 0; i < cycles * 2; i++) {
		const dir = i % 2 ? amp : -amp;
		d += ` q${half / 2} ${dir * 2} ${half} 0`;
	}
	return `<path d="${d}"/>`;
}

export const MELD_OSC_ICONS: readonly string[] = [
	// Basic Shapes: a square and a saw over two sines.
	`<path d="M6 17V8h10v9l14-9v9h12"/>${sineRow(28, 2)}${sineRow(38, 2)}`,
	// Dual Basic Shapes: the same, twice over.
	`<path d="M6 16V8h5v8l8-8v8h4V8h5v8l8-8v8h3"/>${sineRow(25, 3, 3)}${sineRow(29, 3, 3, 9, 33)}${sineRow(37, 3, 3)}${sineRow(41, 3, 3, 9, 33)}`,
	// Noisy Shapes: a sine shaken into noise, standing up.
	`<path d="M18 6l5 2-3 3 6 1-4 3 7 2-5 3 6 3-3 2 4 3-6 2 3 3-5 2 5 3-4 2 3 3-6 2"/>`,
	// Square Sync: a square and the dashed saw it resets.
	`<path d="M8 40V10h15v30h17"/><path d="M23 40L39 10" stroke-dasharray="3 3"/>`,
	// Square 5th: a square with a fifth in a box.
	`<path d="M8 40V14h15v26h17"/><rect x="28" y="6" width="13" height="14" rx="1"/><path d="M37.5 9.5h-5v4h2.5a2.5 2.5 0 0 1 0 5h-3"/>`,
	// Sub: a speaker cabinet.
	`<rect x="10" y="5" width="28" height="35" rx="2"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="4"/><circle cx="14.5" cy="9.5" r="1"/><circle cx="33.5" cy="9.5" r="1"/><path d="M13 40v3M35 40v3"/>`,
	// Swarm Sine, Triangle, Saw, Square: a cloud of the shape.
	swarm((x, y) => `M${x} ${y}q2.5-6 5 0q2.5-6 5 0`),
	swarm((x, y) => `M${x} ${y}l2.5-5 2.5 5 2.5-5 2.5 5`),
	swarm((x, y) => `M${x} ${y}l5-5v5l5-5v5`),
	swarm((x, y) => `M${x} ${y}v-5h3.5v5h3.5v-5`),
	// Harmonic Fm: two crossed loops.
	`<ellipse cx="24" cy="24" rx="8" ry="17" transform="rotate(32 24 24)"/><ellipse cx="24" cy="24" rx="8" ry="17" transform="rotate(-32 24 24)"/>`,
	// Fold Fm: a wave folded into points.
	`<path d="M6 25C14 25 17 23 19 8C21 22 24 24 42 23C27 25 23 27 21 42C19 28 15 25 6 25Z"/>`,
	// Squelch: wavy lines growing wilder.
	`${sineRow(10, 2, 1.5)}${sineRow(19, 2, 2.5)}${sineRow(28, 2, 3.5)}${sineRow(37, 2, 4.5)}`,
	// Simple Fm: a sine squeezing tighter.
	`<path d="M6 24c1-18 7-18 8 0s5 16 6 0 4-14 5 0 3 12 4 0 3-11 3 0 2 10 3 0 2-9 3 0 2 7 2 0"/>`,
	// Chip: a joystick.
	`<path d="M8 32l16-8 16 8-16 8z"/><path d="M8 32v4l16 8 16-8v-4"/><path d="M24 32V16"/><circle cx="24" cy="11" r="5"/><ellipse cx="33" cy="32" rx="2.5" ry="1.2"/>`,
	// Shepard's Pi: a spiral.
	spiral(),
	// Tarp: a lightning bolt with speed lines.
	`<path d="M31 5L15 26h10l-6 17 19-23H27l9-15z"/><path d="M7 23l6-4M9 31l6-4M32 35l6-4"/>`,
	// Extratone: a starburst.
	burst(),
	// Noise Loop: noise inside a looping arrow.
	`<path d="M38 15a16 16 0 1 0 3 11"/><path d="M40 7v8h-8"/><path d="M15 24l3-5 2 10 3-14 3 17 2-11 3 8 2-5 2 3"/>`,
	// Filtered Noise: a bell with noise under it.
	`<path d="M5 41c11 0 11-31 19-31s8 31 19 31"/><path d="M17 37l2-4 2 6 2-11 3 9 2-6 2 6"/>`,
	// Bitgrunge: rows of bits.
	bits(),
	// Crackle: lines with spikes.
	crackle(),
	// Rain: drops on an umbrella.
	`<path d="M8 31a16 15 0 0 1 32 0z"/><path d="M24 31v9a3 3 0 0 1-6 0"/><path d="M13 5l-2 4M21 3l-2 4M29 5l-2 4M37 7l-2 4"/>`,
	// Bubble: bubbles.
	`<circle cx="19" cy="30" r="12"/><circle cx="34" cy="13" r="6"/><circle cx="36" cy="28" r="3"/><path d="M12 27a8 8 0 0 1 5-5"/>`,
	// Chord: three notes stacked on a staff.
	`<path d="M8 10h32M8 17h32M8 24h32M8 31h32M8 38h32"/><path d="M28 6v32"/><ellipse cx="23.5" cy="27.5" rx="4.5" ry="3.3" fill="currentColor"/><ellipse cx="23.5" cy="34.5" rx="4.5" ry="3.3" fill="currentColor"/><ellipse cx="23.5" cy="20.5" rx="4.5" ry="3.3" fill="currentColor"/>`
];

export const MELD_OSC_ICON_VIEWBOX = `0 0 ${S} ${S}`;
