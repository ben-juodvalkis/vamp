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

/** Round ticks for a span of seconds: three to six of them, 0 included. */
export function timeTicks(span: number): number[] {
	const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20];
	const step = steps.find((s) => span / s <= 5) ?? 50;
	const ticks: number[] = [];
	for (let t = 0; t <= span + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000);
	return ticks;
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
