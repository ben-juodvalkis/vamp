/**
 * Synthetic WAV/AIFF fixture builders for the streaming-peaks Path A
 * tests. Generates Buffers in-memory so we don't commit binary fixtures
 * into the repo — the formats are simple enough (RIFF/AIFF chunk
 * containers + flat PCM body) to construct directly.
 *
 * `MockFileHandle` mimics the slice of `node:fs/promises` FileHandle
 * that probeFormat / streamPcmPeaks use: `read(buf, off, len, pos)` and
 * `close()`. Anything else throws.
 */

export type MockReadResult = {
	bytesRead: number;
	buffer: Buffer;
};

export class MockFileHandle {
	constructor(public readonly data: Buffer) {}

	async read(
		buffer: Buffer,
		offset: number,
		length: number,
		position: number
	): Promise<MockReadResult> {
		if (position >= this.data.length) {
			return { bytesRead: 0, buffer };
		}
		const end = Math.min(this.data.length, position + length);
		const available = end - position;
		this.data.copy(buffer, offset, position, end);
		return { bytesRead: available, buffer };
	}

	async close(): Promise<void> {
		// no-op
	}

	get size(): number {
		return this.data.length;
	}
}

export type WavOpts = {
	sampleRate: number;
	channels: number;
	bitsPerSample: 8 | 16 | 24 | 32;
	sampleFormat: 'int' | 'float';
	frames: number;
	/**
	 * Per-frame, per-channel sample value generator. Returns a number
	 * in the natural range for the format (int8 unsigned 0..255, int16
	 * signed -32768..32767, int24 signed -2^23..2^23-1, int32 signed,
	 * float32 -1..1). Builder writes the bytes verbatim.
	 */
	gen: (frame: number, channel: number) => number;
	/**
	 * If true, emit a `WAVE_FORMAT_EXTENSIBLE` fmt chunk with a
	 * sub-format GUID matching the requested sampleFormat. Tests the
	 * 0xFFFE branch of the probe.
	 */
	extensible?: boolean;
	/**
	 * Inject an extra LIST/INFO chunk between fmt and data so tests
	 * exercise the unknown-chunk skip path.
	 */
	withListChunk?: boolean;
};

export function buildWav(opts: WavOpts): Buffer {
	const bytesPerSample = opts.bitsPerSample / 8;
	const frameSize = opts.channels * bytesPerSample;
	const dataSize = opts.frames * frameSize;
	const fmtChunkSize = opts.extensible ? 40 : 16;
	const listChunkBody = opts.withListChunk
		? Buffer.from('INFOICMT\x04\x00\x00\x00test', 'binary')
		: null;
	const listChunkSize = listChunkBody ? listChunkBody.length : 0;
	const listChunkTotal = listChunkBody ? 8 + listChunkSize + (listChunkSize & 1) : 0;

	const totalSize = 4 + 8 + fmtChunkSize + listChunkTotal + 8 + dataSize;
	const buf = Buffer.alloc(8 + totalSize);
	let p = 0;

	buf.write('RIFF', p, 'ascii');
	p += 4;
	buf.writeUInt32LE(totalSize, p);
	p += 4;
	buf.write('WAVE', p, 'ascii');
	p += 4;

	buf.write('fmt ', p, 'ascii');
	p += 4;
	buf.writeUInt32LE(fmtChunkSize, p);
	p += 4;
	const audioFormatField = opts.extensible
		? 0xfffe
		: opts.sampleFormat === 'float'
			? 0x0003
			: 0x0001;
	buf.writeUInt16LE(audioFormatField, p);
	p += 2;
	buf.writeUInt16LE(opts.channels, p);
	p += 2;
	buf.writeUInt32LE(opts.sampleRate, p);
	p += 4;
	buf.writeUInt32LE(opts.sampleRate * frameSize, p);
	p += 4;
	buf.writeUInt16LE(frameSize, p);
	p += 2;
	buf.writeUInt16LE(opts.bitsPerSample, p);
	p += 2;
	if (opts.extensible) {
		buf.writeUInt16LE(22, p);
		p += 2;
		buf.writeUInt16LE(opts.bitsPerSample, p);
		p += 2;
		buf.writeUInt32LE(0, p);
		p += 4;
		// Sub-format GUID: first 2 bytes are the standard format code,
		// remaining 14 bytes are the canonical KSDATAFORMAT_SUBTYPE
		// suffix. The probe only inspects the first 2.
		const subCode = opts.sampleFormat === 'float' ? 0x0003 : 0x0001;
		buf.writeUInt16LE(subCode, p);
		p += 2;
		Buffer.from([
			0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71
		]).copy(buf, p);
		p += 14;
	}

	if (listChunkBody) {
		buf.write('LIST', p, 'ascii');
		p += 4;
		buf.writeUInt32LE(listChunkSize, p);
		p += 4;
		listChunkBody.copy(buf, p);
		p += listChunkSize + (listChunkSize & 1);
	}

	buf.write('data', p, 'ascii');
	p += 4;
	buf.writeUInt32LE(dataSize, p);
	p += 4;

	for (let f = 0; f < opts.frames; f++) {
		for (let c = 0; c < opts.channels; c++) {
			const v = opts.gen(f, c);
			writeSample(buf, p, opts.bitsPerSample, opts.sampleFormat, 'le', v);
			p += bytesPerSample;
		}
	}

	return buf;
}

export type AiffOpts = {
	sampleRate: number;
	channels: number;
	sampleSize: 8 | 16 | 24 | 32;
	frames: number;
	gen: (frame: number, channel: number) => number;
	/**
	 * AIFF (uncompressed) | AIFC NONE (uncompressed) | AIFC sowt (LE
	 * PCM) | AIFC fl32 (BE float).
	 */
	variant?: 'AIFF' | 'AIFC-NONE' | 'AIFC-sowt' | 'AIFC-fl32';
	/**
	 * SSND `offset` field. Spec allows arbitrary leading pad before the
	 * data — fixture lets us exercise the most common AIFF parser bug.
	 */
	ssndOffset?: number;
};

export function buildAiff(opts: AiffOpts): Buffer {
	const variant = opts.variant ?? 'AIFF';
	const isAifc = variant !== 'AIFF';
	const sampleFormat: 'int' | 'float' = variant === 'AIFC-fl32' ? 'float' : 'int';
	const byteOrder: 'le' | 'be' = variant === 'AIFC-sowt' ? 'le' : 'be';
	const compressionTag =
		variant === 'AIFC-sowt' ? 'sowt' : variant === 'AIFC-fl32' ? 'fl32' : 'NONE';

	const bytesPerSample = opts.sampleSize / 8;
	const frameSize = opts.channels * bytesPerSample;
	const ssndOffset = opts.ssndOffset ?? 0;
	const ssndDataSize = opts.frames * frameSize;
	const ssndChunkSize = 8 + ssndOffset + ssndDataSize;

	// COMM is 18 bytes for AIFF, 22+ for AIFC (compression tag +
	// pascal-string description). For tests we use a zero-length
	// description, so AIFC COMM is exactly 22 bytes (4-byte tag +
	// 1-byte length 0 + 1-byte pad to even).
	const commSize = isAifc ? 24 : 18;

	const formChildSize = 4 + 8 + commSize + (commSize & 1) + 8 + ssndChunkSize;
	const buf = Buffer.alloc(8 + formChildSize);
	let p = 0;

	buf.write('FORM', p, 'ascii');
	p += 4;
	buf.writeUInt32BE(formChildSize, p);
	p += 4;
	buf.write(isAifc ? 'AIFC' : 'AIFF', p, 'ascii');
	p += 4;

	buf.write('COMM', p, 'ascii');
	p += 4;
	buf.writeUInt32BE(commSize, p);
	p += 4;
	buf.writeInt16BE(opts.channels, p);
	p += 2;
	buf.writeUInt32BE(opts.frames, p);
	p += 4;
	buf.writeInt16BE(opts.sampleSize, p);
	p += 2;
	write80BitFloat(buf, p, opts.sampleRate);
	p += 10;
	if (isAifc) {
		buf.write(compressionTag, p, 'ascii');
		p += 4;
		// Pascal string: length-prefixed, padded to even total length.
		buf.writeUInt8(0, p);
		p += 1;
		buf.writeUInt8(0, p);
		p += 1;
	}
	if (commSize & 1) {
		buf.writeUInt8(0, p);
		p += 1;
	}

	buf.write('SSND', p, 'ascii');
	p += 4;
	buf.writeUInt32BE(ssndChunkSize, p);
	p += 4;
	buf.writeUInt32BE(ssndOffset, p);
	p += 4;
	buf.writeUInt32BE(0, p); // blockSize
	p += 4;
	// Leading pad — content irrelevant; all zeros.
	p += ssndOffset;

	for (let f = 0; f < opts.frames; f++) {
		for (let c = 0; c < opts.channels; c++) {
			const v = opts.gen(f, c);
			writeSample(buf, p, opts.sampleSize, sampleFormat, byteOrder, v);
			p += bytesPerSample;
		}
	}

	return buf;
}

function writeSample(
	buf: Buffer,
	off: number,
	bits: number,
	format: 'int' | 'float',
	byteOrder: 'le' | 'be',
	value: number
): void {
	if (format === 'float') {
		// Only 32-bit float is in scope.
		if (byteOrder === 'le') buf.writeFloatLE(value, off);
		else buf.writeFloatBE(value, off);
		return;
	}
	if (bits === 8) {
		// WAV 8-bit is unsigned (0..255, 128 = silence). AIFF 8-bit is
		// signed (-128..127). Caller passes the natural value for the
		// format; for unsigned 8-bit pass 0..255.
		buf.writeUInt8(value & 0xff, off);
		return;
	}
	if (bits === 16) {
		if (byteOrder === 'le') buf.writeInt16LE(value, off);
		else buf.writeInt16BE(value, off);
		return;
	}
	if (bits === 24) {
		// Three bytes packed; sign-extension is the reader's problem.
		const u = value < 0 ? value + 0x1000000 : value;
		const b0 = u & 0xff;
		const b1 = (u >> 8) & 0xff;
		const b2 = (u >> 16) & 0xff;
		if (byteOrder === 'le') {
			buf[off] = b0;
			buf[off + 1] = b1;
			buf[off + 2] = b2;
		} else {
			buf[off] = b2;
			buf[off + 1] = b1;
			buf[off + 2] = b0;
		}
		return;
	}
	if (bits === 32) {
		if (byteOrder === 'le') buf.writeInt32LE(value, off);
		else buf.writeInt32BE(value, off);
		return;
	}
	throw new Error(`writeSample: unsupported bits=${bits}`);
}

function write80BitFloat(buf: Buffer, off: number, value: number): void {
	if (value === 0) {
		buf.fill(0, off, off + 10);
		return;
	}
	const sign = value < 0 ? 1 : 0;
	const v = Math.abs(value);
	const exp = Math.floor(Math.log2(v));
	const biasedExp = exp + 16383;
	const mantissa = v / 2 ** exp; // 1.x
	const scaled = mantissa * 2 ** 63;
	const hi = Math.floor(scaled / 2 ** 32);
	const lo = Math.floor(scaled - hi * 2 ** 32);
	buf[off] = (sign << 7) | ((biasedExp >> 8) & 0x7f);
	buf[off + 1] = biasedExp & 0xff;
	buf.writeUInt32BE(hi >>> 0, off + 2);
	buf.writeUInt32BE(lo >>> 0, off + 6);
}
