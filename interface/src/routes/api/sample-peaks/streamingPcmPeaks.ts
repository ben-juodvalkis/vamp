/**
 * Streaming peaks reducer for the Path A (uniform PCM) flow.
 *
 * Reads the data chunk in 1 MB windows and maintains:
 *   - `2 * bins` floats of running [min, max] per bin
 *   - a small Float32Array per channel covering the first
 *     `transientWindowFrames` frames, fed to `findFirstTransient`
 *
 * Memory is bounded by READ_BUFFER_BYTES + transient window + bins,
 * independent of file size. The hot loop allocates nothing after
 * warmup.
 *
 * Bin assignment matches `reduceToPeaks` exactly: bin `i` covers
 * `[floor(i * fpb), floor((i+1) * fpb))` where `fpb = totalFrames /
 * bins`. We precompute the bin-end boundaries and walk a bin pointer
 * alongside the streaming frame counter — this is NOT the same as
 * `floor(frameIdx / fpb)` when fpb is non-integer (the two schemes
 * disagree at the boundary frames where `floor(f / fpb)` gives a
 * lower bin than the slice-based scheme).
 *
 * Frame-straddling: a frame can split across the 1 MB read boundary,
 * especially with 24-bit samples at odd alignments. We carry up to
 * (frameSize - 1) bytes of tail between reads.
 */
import type { FileHandle } from 'node:fs/promises';
import type { FormatInfo } from './formatProbe.js';
import { findFirstTransient } from './transientDetector.js';

const READ_BUFFER_BYTES = 1 << 20; // 1 MB

// Sentinel for the running min/max pair: any real sample is in
// [-Infinity, Infinity], so we use these as "untouched" markers.
const UNTOUCHED_MIN = Infinity;
const UNTOUCHED_MAX = -Infinity;

export type StreamPeaksResult = {
	peaks: [number, number][];
	firstTransientFrame: number;
	frames: number;
};

export async function streamPcmPeaks(
	fd: FileHandle,
	info: FormatInfo,
	bins: number,
	transientWindowFrames: number
): Promise<StreamPeaksResult> {
	const safeBins = Math.max(1, Math.floor(Number(bins) || 1));
	const totalFrames = info.totalFrames;
	const framesPerBin = totalFrames / safeBins;
	const channels = info.channels;
	const bytesPerSample = info.bitsPerSample / 8;
	const frameSize = channels * bytesPerSample;

	const minPerBin = new Float32Array(safeBins);
	const maxPerBin = new Float32Array(safeBins);
	minPerBin.fill(UNTOUCHED_MIN);
	maxPerBin.fill(UNTOUCHED_MAX);

	// Bin-end frame indices: bin i owns frames [binEnd[i-1] .. binEnd[i]).
	// Matches reduceToPeaks's `Math.floor((i + 1) * framesPerBin)` end
	// computation. We walk binIdx forward as frameIdx crosses each end.
	// Int32Array is safe: WAV/AIFF cap totalFrames at < 2^31 since the
	// data-chunk size field is 32-bit.
	const binEnd = new Int32Array(safeBins);
	for (let i = 0; i < safeBins; i++) {
		const e = Math.floor((i + 1) * framesPerBin);
		binEnd[i] = e > totalFrames ? totalFrames : e;
	}

	// Transient window: we only need the first N frames per channel.
	const twFrames = Math.min(
		transientWindowFrames > 0 ? transientWindowFrames : 0,
		totalFrames
	);
	const transientChannels: Float32Array[] = [];
	for (let c = 0; c < channels; c++) {
		transientChannels.push(new Float32Array(twFrames));
	}

	const decodeSample = pickDecoder(info);
	const readBuf = Buffer.alloc(READ_BUFFER_BYTES);
	// Tail buffer carries an unfinished frame across read boundaries.
	const tailBuf = Buffer.alloc(frameSize);
	let tailLen = 0;

	let bytesRemaining = info.dataSize;
	let position = info.dataOffset;
	let frameIdx = 0;
	let binIdx = 0;

	while (bytesRemaining > 0 && frameIdx < totalFrames) {
		const wantBytes = Math.min(
			READ_BUFFER_BYTES - tailLen,
			bytesRemaining
		);
		const { bytesRead } = await fd.read(
			readBuf,
			tailLen,
			wantBytes,
			position
		);
		if (bytesRead <= 0) break;
		position += bytesRead;
		bytesRemaining -= bytesRead;

		// Prepend the carried tail (already at offset 0) and treat
		// [0, tailLen + bytesRead) as the working window.
		if (tailLen > 0) {
			tailBuf.copy(readBuf, 0, 0, tailLen);
		}
		const winLen = tailLen + bytesRead;
		const fullFrames = Math.floor(winLen / frameSize);
		const consumedBytes = fullFrames * frameSize;

		let off = 0;
		for (let f = 0; f < fullFrames; f++) {
			let sum = 0;
			for (let c = 0; c < channels; c++) {
				const sample = decodeSample(readBuf, off);
				off += bytesPerSample;
				sum += sample;
				if (frameIdx < twFrames) {
					transientChannels[c][frameIdx] = sample;
				}
			}
			const v = sum / channels;
			// Advance binIdx if this frame is at-or-past the current
			// bin's end. `while` (not `if`) handles fpb < 1 (more bins
			// than frames) where multiple bins close on a single frame.
			while (binIdx < safeBins - 1 && frameIdx >= binEnd[binIdx]) {
				binIdx++;
			}
			if (v < minPerBin[binIdx]) minPerBin[binIdx] = v;
			if (v > maxPerBin[binIdx]) maxPerBin[binIdx] = v;
			frameIdx++;
			if (frameIdx >= totalFrames) break;
		}

		// Carry remainder to the next read.
		const leftover = winLen - consumedBytes;
		if (leftover > 0) {
			readBuf.copy(tailBuf, 0, consumedBytes, consumedBytes + leftover);
			tailLen = leftover;
		} else {
			tailLen = 0;
		}
	}

	const peaks: [number, number][] = new Array(safeBins);
	for (let i = 0; i < safeBins; i++) {
		let lo = minPerBin[i];
		let hi = maxPerBin[i];
		if (lo === UNTOUCHED_MIN) {
			lo = 0;
			hi = 0;
		}
		peaks[i] = [lo, hi];
	}

	const firstTransientFrame =
		twFrames > 0
			? findFirstTransient(transientChannels, info.sampleRate)
			: 0;

	return {
		peaks,
		firstTransientFrame,
		frames: frameIdx
	};
}

type SampleDecoder = (buf: Buffer, off: number) => number;

function pickDecoder(info: FormatInfo): SampleDecoder {
	const { bitsPerSample, sampleFormat, byteOrder } = info;
	if (sampleFormat === 'float') {
		// Only 32-bit float in scope; probe rejects others.
		if (byteOrder === 'le') return (b, o) => b.readFloatLE(o);
		return (b, o) => b.readFloatBE(o);
	}
	if (bitsPerSample === 8) {
		// WAV 8-bit is unsigned (128 = silence); AIFF 8-bit is signed.
		// Distinguish by the kind tag.
		if (info.kind === 'wav') return (b, o) => (b[o] - 128) / 128;
		return (b, o) => b.readInt8(o) / 128;
	}
	if (bitsPerSample === 16) {
		const norm = 1 / 0x8000;
		if (byteOrder === 'le') return (b, o) => b.readInt16LE(o) * norm;
		return (b, o) => b.readInt16BE(o) * norm;
	}
	if (bitsPerSample === 24) {
		const norm = 1 / 0x800000;
		if (byteOrder === 'le') {
			return (b, o) => {
				const u = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
				// Sign-extend from bit 23.
				const s = u & 0x800000 ? u | 0xff000000 : u;
				return (s | 0) * norm;
			};
		}
		return (b, o) => {
			const u = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
			const s = u & 0x800000 ? u | 0xff000000 : u;
			return (s | 0) * norm;
		};
	}
	if (bitsPerSample === 32) {
		const norm = 1 / 0x80000000;
		if (byteOrder === 'le') return (b, o) => b.readInt32LE(o) * norm;
		return (b, o) => b.readInt32BE(o) * norm;
	}
	throw new Error(`pickDecoder: unsupported bitsPerSample=${bitsPerSample}`);
}
