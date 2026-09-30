/**
 * Live's own transients for a sample, read from its `.asd` analysis
 * sidecar — the ticks Live draws in its clip view. The Live API has no
 * transient list for a clip (probed 2026-09-30: `Clip` offers warp
 * markers and time conversions only), so this file is the only place
 * Live's answer can be had.
 *
 * ## Format (reverse-engineered 2026-09-30, see asdOverview.ts for the container)
 *
 * The onset block sits in the data section, ending a fixed distance
 * before the ASCII type tag `0x0a "OnsetEvent"`:
 *
 *   uint32 LE  n
 *   uint32[n]  onset positions, sample frames, strictly increasing
 *   uint32 LE  n            (repeated)
 *   float32[n] strengths, in [0, 1]
 *   trailer    10 bytes (current Live) or 14 (older files, one more float)
 *
 * It is found by reading backward from each `OnsetEvent` tag: the two
 * counts must agree, the positions increase and the strengths sit in
 * [0, 1], which no other data in the file satisfies at that spot.
 * Measured on 2,000 `.asd` files from the library: 1,533 answer with
 * onsets, 380 with none, 87 not at all (mostly Pack preview `.ogg`s).
 * The rig's "Retrograze Beat 128bpm" reads 32 onsets 0.234 s apart —
 * one per eighth at 128 BPM.
 */
import { readFile } from 'node:fs/promises';

const TAG = Buffer.from('\x0aOnsetEvent', 'latin1');
const TRAILERS = [10, 14, 11, 12, 13];
const MAX_ONSETS = 1 << 16;

/** Onset frames from `.asd` bytes; null when the file carries none. */
export function parseAsdOnsets(buf: Buffer, maxFrames = Infinity): number[] | null {
	let from = 0;
	for (;;) {
		const tag = buf.indexOf(TAG, from);
		if (tag < 0) return null;
		from = tag + 1;
		for (const trailer of TRAILERS) {
			const found = readBackward(buf, tag - trailer, maxFrames);
			if (found) return found;
		}
	}
}

function readBackward(buf: Buffer, end: number, maxFrames: number): number[] | null {
	for (let n = 1; n <= MAX_ONSETS; n++) {
		const count2 = end - 4 * n - 4;
		const count1 = count2 - 4 * n - 4;
		if (count1 < 0) return null;
		if (buf.readUInt32LE(count2) !== n || buf.readUInt32LE(count1) !== n) continue;
		const frames: number[] = new Array(n);
		let ok = true;
		for (let i = 0; i < n && ok; i++) {
			const f = buf.readUInt32LE(count1 + 4 + 4 * i);
			const s = buf.readFloatLE(count2 + 4 + 4 * i);
			ok = f < maxFrames && (i === 0 || f > frames[i - 1]) && s >= 0 && s <= 1.0001;
			frames[i] = f;
		}
		if (ok) return frames;
	}
	return null;
}

/** Onset frames from the `.asd` beside `audioPath`, trying each spelling. */
export async function readAsdOnsets(audioPaths: string[], maxFrames: number): Promise<number[] | null> {
	for (const p of audioPaths) {
		let buf: Buffer;
		try {
			buf = await readFile(`${p}.asd`);
		} catch {
			continue;
		}
		const onsets = parseAsdOnsets(buf, maxFrames);
		if (onsets) return onsets;
	}
	return null;
}
