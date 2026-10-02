/**
 * The convolution side's picture: the impulse response the Hybrid Reverb
 * has loaded, read from Live's own file (`/api/reverb-ir`), with the
 * envelope its Attack and Decay put on it.
 *
 * Amplitude is drawn on a 48 dB scale — an IR is one loud instant and a
 * long quiet tail, which a linear scale would draw as a spike and a flat
 * line. Time runs linearly over the IR as Size stretches it.
 *
 * The envelope is a drawing of what the two controls do — Attack fades the
 * IR in, Decay shortens its tail (drawn reaching -60 dB at the Decay time)
 * — not Live's own curve, which it does not publish.
 */

/** Live's category name to words: `Chambers_and_Large_Rooms` → "Chambers and Large Rooms". */
export const categoryLabel = (category: string) => category.replace(/_/g, ' ');

/** Live's file name to words, and whether it is a stereo pair ("Blue Room LR"). */
export function irLabel(file: string): { name: string; stereo: boolean } {
	const stereo = file.endsWith(' LR');
	return { name: stereo ? file.slice(0, -3) : file, stereo };
}

export const DB_RANGE = 48;

/** Where the picture's time axis starts and ends across the pad. */
export const IR_X0 = 0.035;
export const IR_X1 = 0.985;

/**
 * The time axis: linear for the first thirtieth of the IR, logarithmic
 * past it (`ln(1 + 30·t/span) / ln 31`), so the first milliseconds — where
 * Attack works, and an IR's early reflections — get room, and the tail
 * still fits. Its shape depends only on t/span, whatever the IR's length.
 */
const KNEE = 30;
export function timeX(t: number, span: number): number {
	const u = Math.max(0, t) / span;
	return IR_X0 + ((IR_X1 - IR_X0) * Math.log1p(KNEE * u)) / Math.log1p(KNEE);
}
export function xTime(x: number, span: number): number {
	const f = (x - IR_X0) / (IR_X1 - IR_X0);
	return (span * Math.expm1(Math.max(0, f) * Math.log1p(KNEE))) / KNEE;
}

/** Round times for the axis — 0, then whichever stand far enough apart on it. */
export function axisTicks(span: number): number[] {
	const candidates = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
	const ticks = [0];
	let lastX = timeX(0, span);
	for (const t of candidates) {
		if (t > span * 1.0001) break;
		const x = timeX(t, span);
		if (x - lastX >= 0.09) {
			ticks.push(t);
			lastX = x;
		}
	}
	return ticks;
}

// ── The pad: Attack across, Decay up, fitted to the IR ─────────────────
// Live's rails, measured by write-and-restore (2026-10-02): Attack 0..3 s,
// Decay 0.02..20 s. Linear over those, a short IR left most of the pad
// doing nothing — on a 0.3 s IR every Decay above ~1 s barely touched it,
// 95 % of the travel. So the pad fits the IR as Size stretches it (`axis`
// seconds): Attack runs along the picture's own time axis, the handle at
// the attack time on the waveform — the axis is logarithmic past its first
// thirtieth, so short attacks get the room, and the pad ends where the IR
// does — and Decay is logarithmic from a twentieth of the IR to four times
// it: past that the envelope barely touches the IR (a 250 ms IR: 1 s). A
// Decay above the rail (a fresh device's 20 s) parks the handle at the top.

export const IR_ATTACK_MAX = 3;
export const IR_DECAY_MIN = 0.02;
export const IR_DECAY_MAX = 20;

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The pad's x (0..1 across it) for an Attack, on the picture's time axis. */
export function attackX(attack: number, axis: number): number {
	return clampTo(timeX(attack, axis), 0, 1);
}
/** The Attack at a pad x, within Live's 0..3 s. */
export function attackAt(x: number, axis: number): number {
	return clampTo(xTime(x, axis), 0, IR_ATTACK_MAX);
}

/** The Decay rail for an IR this long: a twentieth of it to four times it, within Live's range. */
export const decayFloor = (axis: number) => clampTo(axis / 20, IR_DECAY_MIN, 1);
export const decayTop = (axis: number) => clampTo(axis * 4, 0.1, IR_DECAY_MAX);

/** The pad's y (0..1 up) for a Decay. */
export function decayY(decay: number, axis: number): number {
	const lo = decayFloor(axis);
	return clampTo(Math.log(Math.max(decay, lo) / lo) / Math.log(decayTop(axis) / lo), 0, 1);
}
/** The Decay at a pad y. */
export function decayAt(y: number, axis: number): number {
	const lo = decayFloor(axis);
	return clampTo(lo * Math.pow(decayTop(axis) / lo, clampTo(y, 0, 1)), IR_DECAY_MIN, IR_DECAY_MAX);
}

/** A linear amplitude (0..1) to a height on the 48 dB scale (0..1). */
export function ampHeight(amp: number): number {
	if (!(amp > 0)) return 0;
	return Math.max(0, Math.min(1, 1 + (20 * Math.log10(amp)) / DB_RANGE));
}

/** What Attack and Decay do to the IR at `t` seconds, in dB. */
export function envelopeDb(t: number, attack: number, decay: number): number {
	const rise = attack > 0 && t < attack ? 20 * Math.log10(Math.max(1e-6, t / attack)) : 0;
	return rise - (60 * t) / Math.max(0.001, decay);
}

export const tickLabel = (t: number) => (t === 0 ? '0' : t < 1 ? `${Math.round(t * 1000)} ms` : `${t} s`);

/** One channel from several: the louder at each bin (a stereo IR's L and R). */
export function louder(channels: readonly number[][]): number[] {
	if (!channels.length) return [];
	return channels[0].map((_, i) => Math.max(...channels.map((c) => c[i] ?? 0)));
}

export interface IrShape {
	/** Each bin's time, seconds from the start of the stretched IR. */
	times: number[];
	/** The IR as the file holds it, per channel, heights 0..1. */
	raw: number[][];
	/** The IR as Attack and Decay leave it (the raw IR when shaping is off). */
	shaped: number[][];
	/** The envelope itself, 0..1 on the same scale; null when shaping is off. */
	envelope: number[] | null;
	/** The stretched IR's length, seconds. */
	span: number;
}

/**
 * The picture's numbers: every channel's peaks to heights, before and
 * after the envelope, over the IR's length as Size stretches it.
 */
export function irShape(
	channels: readonly (readonly [number, number][])[],
	seconds: number,
	size: number,
	attack: number,
	decay: number,
	shaping: boolean
): IrShape {
	const bins = channels[0]?.length ?? 0;
	const span = seconds * size;
	const times = Array.from({ length: bins }, (_, i) => ((i + 0.5) / Math.max(1, bins)) * span);
	const env = times.map((t) => envelopeDb(t, attack, decay));
	const raw = channels.map((peaks) => peaks.map(([lo, hi]) => ampHeight(Math.max(Math.abs(lo), Math.abs(hi)))));
	const shaped = shaping
		? raw.map((ch) => ch.map((h, i) => Math.max(0, h + env[i] / DB_RANGE)))
		: raw.map((ch) => [...ch]);
	return {
		times,
		raw,
		shaped,
		envelope: shaping ? env.map((db) => Math.max(0, 1 + db / DB_RANGE)) : null,
		span
	};
}
