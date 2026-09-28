import { describe, it, expect } from 'vitest';
import { probeFormat } from '../../../../routes/api/sample-peaks/formatProbe';
import { MockFileHandle, buildWav, buildAiff } from './fixtures';

const SR = 44100;

function silenceGen(): (frame: number, channel: number) => number {
	return () => 0;
}

async function probe(buf: Buffer) {
	const fh = new MockFileHandle(buf);
	return probeFormat(fh as unknown as Parameters<typeof probeFormat>[0], fh.size);
}

describe('probeFormat', () => {
	it('parses 16-bit stereo WAV', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 2,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames: 1000,
			gen: silenceGen()
		});
		const info = await probe(buf);
		expect(info).not.toBeNull();
		expect(info).toMatchObject({
			kind: 'wav',
			sampleRate: SR,
			channels: 2,
			bitsPerSample: 16,
			sampleFormat: 'int',
			byteOrder: 'le',
			totalFrames: 1000
		});
		// data chunk body sits at offset 44 in a minimal RIFF/WAVE.
		expect(info!.dataOffset).toBe(44);
		expect(info!.dataSize).toBe(1000 * 2 * 2);
	});

	it('parses 24-bit mono WAV', async () => {
		const buf = buildWav({
			sampleRate: 48000,
			channels: 1,
			bitsPerSample: 24,
			sampleFormat: 'int',
			frames: 500,
			gen: silenceGen()
		});
		const info = await probe(buf);
		expect(info).toMatchObject({
			kind: 'wav',
			channels: 1,
			bitsPerSample: 24,
			sampleFormat: 'int',
			totalFrames: 500
		});
	});

	it('parses 32-bit float WAV', async () => {
		const buf = buildWav({
			sampleRate: 96000,
			channels: 2,
			bitsPerSample: 32,
			sampleFormat: 'float',
			frames: 200,
			gen: silenceGen()
		});
		const info = await probe(buf);
		expect(info).toMatchObject({
			kind: 'wav',
			sampleRate: 96000,
			bitsPerSample: 32,
			sampleFormat: 'float'
		});
	});

	it('parses WAVE_FORMAT_EXTENSIBLE 24-bit as int PCM', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 2,
			bitsPerSample: 24,
			sampleFormat: 'int',
			frames: 100,
			gen: silenceGen(),
			extensible: true
		});
		const info = await probe(buf);
		expect(info).toMatchObject({
			kind: 'wav',
			bitsPerSample: 24,
			sampleFormat: 'int',
			byteOrder: 'le'
		});
	});

	it('parses WAVE_FORMAT_EXTENSIBLE 32-bit as float when sub-format GUID says so', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 32,
			sampleFormat: 'float',
			frames: 100,
			gen: silenceGen(),
			extensible: true
		});
		const info = await probe(buf);
		expect(info!.sampleFormat).toBe('float');
	});

	it('skips unknown chunks (LIST/INFO) before data', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames: 50,
			gen: silenceGen(),
			withListChunk: true
		});
		const info = await probe(buf);
		expect(info).not.toBeNull();
		expect(info!.totalFrames).toBe(50);
		// data offset should be past the LIST chunk now.
		expect(info!.dataOffset).toBeGreaterThan(44);
	});

	it('parses 16-bit AIFF', async () => {
		const buf = buildAiff({
			sampleRate: SR,
			channels: 2,
			sampleSize: 16,
			frames: 300,
			gen: silenceGen(),
			variant: 'AIFF'
		});
		const info = await probe(buf);
		expect(info).toMatchObject({
			kind: 'aiff',
			sampleRate: SR,
			channels: 2,
			bitsPerSample: 16,
			sampleFormat: 'int',
			byteOrder: 'be',
			totalFrames: 300
		});
	});

	it('honors AIFF SSND offset (data does not start at chunk body)', async () => {
		const buf = buildAiff({
			sampleRate: SR,
			channels: 1,
			sampleSize: 16,
			frames: 100,
			gen: silenceGen(),
			variant: 'AIFF',
			ssndOffset: 16
		});
		const info = await probe(buf);
		expect(info).not.toBeNull();
		// dataOffset accounts for the (offset, blockSize) pair (8 bytes)
		// AND the leading pad bytes (16 here).
		const ssndChunkBody = buf.indexOf(Buffer.from('SSND', 'ascii')) + 8;
		expect(info!.dataOffset).toBe(ssndChunkBody + 8 + 16);
	});

	it('parses AIFC sowt (LE PCM)', async () => {
		const buf = buildAiff({
			sampleRate: SR,
			channels: 1,
			sampleSize: 16,
			frames: 100,
			gen: silenceGen(),
			variant: 'AIFC-sowt'
		});
		const info = await probe(buf);
		expect(info).toMatchObject({
			kind: 'aiff',
			byteOrder: 'le',
			sampleFormat: 'int'
		});
	});

	it('parses AIFC fl32 (BE float)', async () => {
		const buf = buildAiff({
			sampleRate: SR,
			channels: 2,
			sampleSize: 32,
			frames: 100,
			gen: silenceGen(),
			variant: 'AIFC-fl32'
		});
		const info = await probe(buf);
		expect(info).toMatchObject({
			kind: 'aiff',
			byteOrder: 'be',
			sampleFormat: 'float'
		});
	});

	it('returns null for non-PCM compressed AIFC (alaw/ulaw)', async () => {
		// Build an AIFC NONE then overwrite the compression tag with
		// 'alaw' so we test the rejection path.
		const buf = buildAiff({
			sampleRate: SR,
			channels: 1,
			sampleSize: 8,
			frames: 100,
			gen: silenceGen(),
			variant: 'AIFC-NONE'
		});
		// COMM body starts at offset 20. compression tag is 18 bytes in.
		const commBody = buf.indexOf(Buffer.from('COMM', 'ascii')) + 8;
		buf.write('alaw', commBody + 18, 'ascii');
		const info = await probe(buf);
		expect(info).toBeNull();
	});

	it('returns null for too-small files', async () => {
		expect(await probe(Buffer.alloc(8))).toBeNull();
	});

	it('returns null for files with no recognized magic (mp3-shaped)', async () => {
		// Fake mp3-ish: ID3v2 header at offset 0.
		const buf = Buffer.alloc(1024);
		buf.write('ID3', 0, 'ascii');
		expect(await probe(buf)).toBeNull();
	});

	it('returns null for FLAC magic', async () => {
		const buf = Buffer.alloc(1024);
		buf.write('fLaC', 0, 'ascii');
		expect(await probe(buf)).toBeNull();
	});

	it('returns null for OGG magic', async () => {
		const buf = Buffer.alloc(1024);
		buf.write('OggS', 0, 'ascii');
		expect(await probe(buf)).toBeNull();
	});

	it('returns null for RF64 (we punt cleanly)', async () => {
		// Construct minimal RF64 magic — probe should not try to parse.
		const buf = Buffer.alloc(64);
		buf.write('RF64', 0, 'ascii');
		buf.writeUInt32LE(0xffffffff, 4);
		buf.write('WAVE', 8, 'ascii');
		expect(await probe(buf)).toBeNull();
	});

	it('clamps AIFF ssndDataSize when chunk size runs past EOF (in-progress recording)', async () => {
		// Live records audio progressively into AIFF; the SSND chunk
		// header may declare the eventual sample count before the file
		// has grown to fit. Probe must clamp to the bytes actually on
		// disk and return a valid FormatInfo so the streaming path can
		// render what's there.
		const buf = buildAiff({
			sampleRate: SR,
			channels: 1,
			sampleSize: 16,
			frames: 100,
			gen: silenceGen(),
			variant: 'AIFF'
		});
		// Bloat the SSND chunk size so dataOffset + dataSize > EOF.
		const ssndIdx = buf.indexOf(Buffer.from('SSND', 'ascii'));
		buf.writeUInt32BE(0xffff_0000, ssndIdx + 4);
		const info = await probe(buf);
		expect(info).not.toBeNull();
		expect(info!.kind).toBe('aiff');
		expect(info!.dataOffset + info!.dataSize).toBeLessThanOrEqual(buf.length);
		expect(info!.totalFrames).toBeGreaterThan(0);
	});

	it('clamps WAV dataSize when chunk size runs past EOF (in-progress recording)', async () => {
		// Mid-recording RIFF/WAVE files declare the eventual `data` chunk
		// size in the header but the file on disk hasn't grown to fit
		// yet. Probe must clamp to available bytes and continue, rather
		// than reject the file.
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames: 100,
			gen: silenceGen()
		});
		const dataIdx = buf.indexOf(Buffer.from('data', 'ascii'));
		buf.writeUInt32LE(0xffff_0000, dataIdx + 4);
		const info = await probe(buf);
		expect(info).not.toBeNull();
		expect(info!.kind).toBe('wav');
		// Available body bytes from `data`+8 to EOF — clamped, not the
		// declared 0xffff_0000.
		expect(info!.dataOffset + info!.dataSize).toBeLessThanOrEqual(buf.length);
		expect(info!.totalFrames).toBeGreaterThan(0);
	});

	it('returns null for a non-PCM WAV format code (e.g. ADPCM = 0x11)', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames: 50,
			gen: silenceGen()
		});
		const fmtIdx = buf.indexOf(Buffer.from('fmt ', 'ascii'));
		buf.writeUInt16LE(0x0011, fmtIdx + 8);
		expect(await probe(buf)).toBeNull();
	});

	it('returns null for unsupported bit depths (e.g. 12-bit)', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames: 50,
			gen: silenceGen()
		});
		const fmtIdx = buf.indexOf(Buffer.from('fmt ', 'ascii'));
		// bitsPerSample lives at fmt body + 14.
		buf.writeUInt16LE(12, fmtIdx + 8 + 14);
		expect(await probe(buf)).toBeNull();
	});

	it('AIFF round-trips a non-integer-rounded sample rate', async () => {
		// 44100.0 should read back as exactly 44100.
		const buf = buildAiff({
			sampleRate: 44100,
			channels: 1,
			sampleSize: 16,
			frames: 50,
			gen: silenceGen(),
			variant: 'AIFF'
		});
		const info = await probe(buf);
		expect(info!.sampleRate).toBe(44100);
	});
});
