/**
 * Format probe for the streaming-peaks Path A.
 *
 * Reads ≤ 4 KB from the head of an open file and returns a `FormatInfo`
 * describing a uniform-PCM WAV/AIFF/AIFC, or `null` for anything else
 * (compressed / unknown / malformed / out-of-spec sizes / RF64 / Wave64).
 *
 * Returning `null` is the signal for the route to fall back to Path B
 * (full-decode `audio-decode`). It must be safe to feed any file here.
 *
 * Reference:
 * - WAV / RIFF: Microsoft "Multimedia Programming Interface and Data
 *   Specifications 1.0", `WAVE_FORMAT_EXTENSIBLE` per Microsoft docs.
 * - AIFF: Apple "Audio Interchange File Format AIFF-C 1.9".
 *
 * SSND data does NOT start at the chunk body — there are 8 bytes of
 * (offset, blockSize), then `offset` more bytes of pad. Forgetting this
 * shifts every AIFF read by 8+ bytes (silent corruption).
 */
import type { FileHandle } from 'node:fs/promises';

export type FormatInfo = {
	kind: 'wav' | 'aiff';
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	sampleFormat: 'int' | 'float';
	byteOrder: 'le' | 'be';
	dataOffset: number;
	dataSize: number;
	totalFrames: number;
};

const HEAD_BYTES = 4096;

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

export async function probeFormat(
	fd: FileHandle,
	sizeBytes: number
): Promise<FormatInfo | null> {
	if (sizeBytes < 12) return null;
	const head = Buffer.alloc(Math.min(HEAD_BYTES, sizeBytes));
	const { bytesRead } = await fd.read(head, 0, head.length, 0);
	if (bytesRead < 12) return null;

	// Plain ASCII magic. Both formats put a 4-byte tag at offset 0,
	// a 4-byte container size at offset 4, and a sub-tag at offset 8.
	const tag = head.toString('ascii', 0, 4);
	const subTag = head.toString('ascii', 8, 12);

	if (tag === 'RIFF' && subTag === 'WAVE') {
		return parseWav(head, bytesRead, sizeBytes);
	}
	if (tag === 'FORM' && (subTag === 'AIFF' || subTag === 'AIFC')) {
		return parseAiff(head, bytesRead, sizeBytes, subTag === 'AIFC');
	}
	// RF64 (`RF64`/`BW64`) deliberately falls through to null — the 32-bit
	// size fields are sentinels (-1) and the real sizes live in a `ds64`
	// chunk. Punting cleanly is safer than misparsing.
	return null;
}

/**
 * The sample rate a WAV or AIFF header declares, and (AIFF) its frame
 * count, whatever the encoding — including the compressed audio
 * `probeFormat` refuses (Ableton's protected `able` AIFC). The transient
 * route needs it to turn Live's `.asd` onset frames into seconds.
 */
export async function probeSampleRate(
	fd: FileHandle,
	sizeBytes: number
): Promise<{ sampleRate: number; frames: number } | null> {
	if (sizeBytes < 12) return null;
	const head = Buffer.alloc(Math.min(HEAD_BYTES, sizeBytes));
	const { bytesRead } = await fd.read(head, 0, head.length, 0);
	if (bytesRead < 12) return null;
	const tag = head.toString('ascii', 0, 4);
	const subTag = head.toString('ascii', 8, 12);
	const wav = tag === 'RIFF' && subTag === 'WAVE';
	const aiff = tag === 'FORM' && (subTag === 'AIFF' || subTag === 'AIFC');
	if (!wav && !aiff) return null;
	let off = 12;
	while (off + 8 <= bytesRead) {
		const id = head.toString('ascii', off, off + 4);
		const chunkSize = wav ? head.readUInt32LE(off + 4) : head.readUInt32BE(off + 4);
		const bodyOff = off + 8;
		if (wav && id === 'fmt ' && bodyOff + 8 <= bytesRead) {
			const sampleRate = head.readUInt32LE(bodyOff + 4);
			return sampleRate >= 1 && sampleRate <= 768000 ? { sampleRate, frames: Infinity } : null;
		}
		if (aiff && id === 'COMM' && bodyOff + 18 <= bytesRead) {
			const frames = head.readUInt32BE(bodyOff + 2);
			const sampleRate = read80BitFloat(head, bodyOff + 8);
			return Number.isFinite(sampleRate) && sampleRate >= 1 && sampleRate <= 768000
				? { sampleRate, frames: frames || Infinity }
				: null;
		}
		const advance = bodyOff + chunkSize + (chunkSize & 1);
		if (advance <= off) return null;
		off = advance;
	}
	return null;
}

function parseWav(
	head: Buffer,
	bytesRead: number,
	sizeBytes: number
): FormatInfo | null {
	let off = 12;
	let fmt: {
		audioFormat: number;
		channels: number;
		sampleRate: number;
		bitsPerSample: number;
	} | null = null;
	let dataOffset = -1;
	let dataSize = -1;

	while (off + 8 <= bytesRead) {
		const id = head.toString('ascii', off, off + 4);
		const chunkSize = head.readUInt32LE(off + 4);
		const bodyOff = off + 8;
		// Chunks are zero-padded to even length on disk but the size
		// field reports the real size.
		const advance = bodyOff + chunkSize + (chunkSize & 1);

		if (id === 'fmt ') {
			if (bodyOff + 16 > bytesRead) return null;
			let audioFormat = head.readUInt16LE(bodyOff + 0);
			const channels = head.readUInt16LE(bodyOff + 2);
			const sampleRate = head.readUInt32LE(bodyOff + 4);
			// bytesPerSec, blockAlign skipped — not authoritative.
			const bitsPerSample = head.readUInt16LE(bodyOff + 14);

			if (audioFormat === WAVE_FORMAT_EXTENSIBLE) {
				// Extensible header: cbSize (2) + validBitsPerSample (2)
				// + channelMask (4) + subFormat GUID (16). The GUID's
				// first 2 bytes mirror the standard format codes for
				// PCM (0x0001) and IEEE float (0x0003).
				if (chunkSize < 40 || bodyOff + 26 > bytesRead) return null;
				audioFormat = head.readUInt16LE(bodyOff + 24);
			}

			if (
				audioFormat !== WAVE_FORMAT_PCM &&
				audioFormat !== WAVE_FORMAT_IEEE_FLOAT
			) {
				return null;
			}
			if (channels < 1 || channels > 32) return null;
			if (sampleRate < 1 || sampleRate > 768000) return null;
			if (
				bitsPerSample !== 8 &&
				bitsPerSample !== 16 &&
				bitsPerSample !== 24 &&
				bitsPerSample !== 32
			) {
				return null;
			}
			if (audioFormat === WAVE_FORMAT_IEEE_FLOAT && bitsPerSample !== 32) {
				return null;
			}
			fmt = { audioFormat, channels, sampleRate, bitsPerSample };
		} else if (id === 'data') {
			dataOffset = bodyOff;
			dataSize = chunkSize;
			break;
		}
		// Unknown chunks (LIST, INFO, bext, ...) — skip via `advance`.
		if (advance <= off) return null;
		off = advance;
	}

	if (!fmt || dataOffset < 0 || dataSize < 0) return null;
	// In-progress recordings have a declared `dataSize` that runs past
	// EOF because Live writes the audio progressively. Clamp to what's
	// actually on disk so the streaming path can render the bytes that
	// exist; subsequent fetches will pick up more of the file as it
	// grows. We still reject if `dataOffset` itself is out of bounds
	// (genuinely malformed header).
	if (dataOffset >= sizeBytes) return null;
	const availableSize = sizeBytes - dataOffset;
	if (dataSize > availableSize) dataSize = availableSize;
	const frameSize = fmt.channels * (fmt.bitsPerSample / 8);
	if (frameSize <= 0) return null;
	const totalFrames = Math.floor(dataSize / frameSize);
	if (totalFrames <= 0) return null;

	return {
		kind: 'wav',
		sampleRate: fmt.sampleRate,
		channels: fmt.channels,
		bitsPerSample: fmt.bitsPerSample,
		sampleFormat: fmt.audioFormat === WAVE_FORMAT_IEEE_FLOAT ? 'float' : 'int',
		byteOrder: 'le',
		dataOffset,
		dataSize,
		totalFrames
	};
}

function parseAiff(
	head: Buffer,
	bytesRead: number,
	sizeBytes: number,
	isAifc: boolean
): FormatInfo | null {
	let off = 12;
	let comm: {
		channels: number;
		numSampleFrames: number;
		sampleSize: number;
		sampleRate: number;
		compression: 'NONE' | 'sowt' | 'fl32';
	} | null = null;
	let ssndDataOffset = -1;
	let ssndDataSize = -1;

	while (off + 8 <= bytesRead) {
		const id = head.toString('ascii', off, off + 4);
		const chunkSize = head.readUInt32BE(off + 4);
		const bodyOff = off + 8;
		const advance = bodyOff + chunkSize + (chunkSize & 1);

		if (id === 'COMM') {
			if (bodyOff + 18 > bytesRead) return null;
			const channels = head.readInt16BE(bodyOff + 0);
			const numSampleFrames = head.readUInt32BE(bodyOff + 2);
			const sampleSize = head.readInt16BE(bodyOff + 6);
			const sampleRate = read80BitFloat(head, bodyOff + 8);
			let compression: 'NONE' | 'sowt' | 'fl32' = 'NONE';
			if (isAifc) {
				if (chunkSize < 22 || bodyOff + 22 > bytesRead) return null;
				const tag = head.toString('ascii', bodyOff + 18, bodyOff + 22);
				if (tag === 'NONE') compression = 'NONE';
				else if (tag === 'sowt') compression = 'sowt';
				else if (tag === 'fl32' || tag === 'FL32') compression = 'fl32';
				else return null;
			}
			if (channels < 1 || channels > 32) return null;
			// numSampleFrames is read via readUInt32BE so it cannot be
			// negative — `=== 0` is the actual check (no frames means
			// nothing to stream).
			if (numSampleFrames === 0) return null;
			if (
				sampleSize !== 8 &&
				sampleSize !== 16 &&
				sampleSize !== 24 &&
				sampleSize !== 32
			) {
				return null;
			}
			if (compression === 'fl32' && sampleSize !== 32) return null;
			if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 768000) {
				return null;
			}
			comm = { channels, numSampleFrames, sampleSize, sampleRate, compression };
		} else if (id === 'SSND') {
			if (bodyOff + 8 > bytesRead) return null;
			const ssndOffset = head.readUInt32BE(bodyOff + 0);
			// blockSize at bodyOff + 4 — not used for uncompressed.
			ssndDataOffset = bodyOff + 8 + ssndOffset;
			ssndDataSize = chunkSize - 8 - ssndOffset;
			// Malformed: `ssndOffset` larger than the chunk body produces
			// a negative dataSize. The downstream `totalFrames <= 0`
			// guard would catch it, but reject explicitly here so the
			// failure mode is local to where it's caused.
			if (ssndDataSize < 0) return null;
			break;
		}
		if (advance <= off) return null;
		off = advance;
	}

	if (!comm || ssndDataOffset < 0 || ssndDataSize < 0) return null;
	// In-progress AIFF recordings declare the final `ssndDataSize` /
	// `numSampleFrames` in the header but the file is still growing on
	// disk. Clamp to available bytes so the streaming path renders the
	// portion that exists; subsequent fetches see more as the recording
	// progresses. Reject only if the SSND offset itself is past EOF.
	if (ssndDataOffset >= sizeBytes) return null;
	const availableSsndBytes = sizeBytes - ssndDataOffset;
	if (ssndDataSize > availableSsndBytes) ssndDataSize = availableSsndBytes;

	const frameSize = comm.channels * (comm.sampleSize / 8);
	if (frameSize <= 0) return null;
	// Trust COMM.numSampleFrames over SSND size — the spec says COMM is
	// authoritative and SSND can be padded. For in-progress files the
	// SSND-size-derived frame count will be smaller (file still growing);
	// `min` picks that up automatically.
	const totalFrames = Math.min(
		comm.numSampleFrames,
		Math.floor(ssndDataSize / frameSize)
	);
	if (totalFrames <= 0) return null;

	const sampleFormat: 'int' | 'float' = comm.compression === 'fl32' ? 'float' : 'int';
	const byteOrder: 'le' | 'be' = comm.compression === 'sowt' ? 'le' : 'be';

	return {
		kind: 'aiff',
		sampleRate: Math.round(comm.sampleRate),
		channels: comm.channels,
		bitsPerSample: comm.sampleSize,
		sampleFormat,
		byteOrder,
		dataOffset: ssndDataOffset,
		dataSize: ssndDataSize,
		totalFrames
	};
}

/**
 * AIFF stores sample rate as an IEEE 754 80-bit extended-precision
 * float (Apple/SANE format): 1 sign bit, 15 exponent bits (bias 16383),
 * 64 explicit mantissa bits (no implicit leading 1, unlike 32/64-bit
 * IEEE). Standard library audio rates (44100, 48000, 96000) are exact
 * integers in this representation.
 */
function read80BitFloat(buf: Buffer, off: number): number {
	const sign = (buf[off] & 0x80) !== 0 ? -1 : 1;
	const exponent = ((buf[off] & 0x7f) << 8) | buf[off + 1];
	const hiMantissa =
		(buf[off + 2] << 24) |
		(buf[off + 3] << 16) |
		(buf[off + 4] << 8) |
		buf[off + 5];
	const loMantissa =
		(buf[off + 6] << 24) |
		(buf[off + 7] << 16) |
		(buf[off + 8] << 8) |
		buf[off + 9];
	if (exponent === 0 && hiMantissa === 0 && loMantissa === 0) return 0;
	if (exponent === 0x7fff) return sign * Infinity;
	// `>>> 0` is load-bearing: when the high byte is >= 0x80, the
	// `<< 24` above produces a negative signed int32. Reinterpreting
	// as unsigned before the float64 multiply keeps the mantissa right.
	const mantissa = (hiMantissa >>> 0) * 2 ** 32 + (loMantissa >>> 0);
	return sign * mantissa * 2 ** (exponent - 16383 - 63);
}
