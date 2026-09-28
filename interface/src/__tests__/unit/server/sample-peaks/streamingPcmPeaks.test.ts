import { describe, it, expect } from 'vitest';
import { probeFormat } from '../../../../routes/api/sample-peaks/formatProbe';
import { streamPcmPeaks } from '../../../../routes/api/sample-peaks/streamingPcmPeaks';
import { MockFileHandle, buildWav, buildAiff } from './fixtures';

const SR = 44100;

/**
 * Reference implementation matching reduceToPeaks in
 * routes/api/sample-peaks/+server.ts. Kept inline (not exported from
 * +server.ts) so the parity test pins the streaming reducer to the
 * exact semantics the route currently produces.
 */
function referencePeaks(
	channelData: Float32Array[],
	bins: number
): [number, number][] {
	const channels = channelData.length;
	const frames = channels > 0 ? channelData[0].length : 0;
	const safeBins = Math.max(1, Math.floor(Number(bins) || 1));
	const out: [number, number][] = new Array(safeBins);
	const framesPerBin = frames / safeBins;
	for (let i = 0; i < safeBins; i++) {
		const start = Math.floor(i * framesPerBin);
		const end = Math.min(frames, Math.floor((i + 1) * framesPerBin));
		let min = Infinity;
		let max = -Infinity;
		for (let f = start; f < end; f++) {
			let sum = 0;
			for (let c = 0; c < channels; c++) sum += channelData[c][f];
			const v = sum / channels;
			if (v < min) min = v;
			if (v > max) max = v;
		}
		if (min === Infinity) {
			min = 0;
			max = 0;
		}
		out[i] = [min, max];
	}
	return out;
}

async function probeAndStream(
	buf: Buffer,
	bins: number,
	transientWindowFrames: number = Math.round(SR * 0.2)
) {
	const fh = new MockFileHandle(buf);
	const info = await probeFormat(
		fh as unknown as Parameters<typeof probeFormat>[0],
		fh.size
	);
	expect(info).not.toBeNull();
	const result = await streamPcmPeaks(
		fh as unknown as Parameters<typeof streamPcmPeaks>[0],
		info!,
		bins,
		transientWindowFrames
	);
	return { info: info!, result };
}

function expectClose(
	actual: [number, number][],
	expected: [number, number][],
	tol = 1e-6
) {
	expect(actual.length).toBe(expected.length);
	for (let i = 0; i < actual.length; i++) {
		expect(Math.abs(actual[i][0] - expected[i][0])).toBeLessThanOrEqual(tol);
		expect(Math.abs(actual[i][1] - expected[i][1])).toBeLessThanOrEqual(tol);
	}
}

describe('streamPcmPeaks', () => {
	it('parity with reduceToPeaks for 16-bit mono WAV', async () => {
		const frames = 4096;
		const norm = 1 / 0x8000;
		const samples = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			samples[f] = Math.sin((f / frames) * 8 * Math.PI) * 0.7;
		}
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames,
			gen: (f) => Math.round(samples[f] / norm)
		});
		const { result } = await probeAndStream(buf, 64);
		// Reference uses the quantized values that round-trip from int16.
		const refSamples = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			refSamples[f] = Math.round(samples[f] / norm) * norm;
		}
		const expected = referencePeaks([refSamples], 64);
		expectClose(result.peaks, expected, 1e-6);
		expect(result.frames).toBe(frames);
	});

	it('parity with reduceToPeaks for 24-bit stereo WAV', async () => {
		const frames = 8192;
		const norm = 1 / 0x800000;
		const left = new Float32Array(frames);
		const right = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			left[f] = Math.sin((f / frames) * 12 * Math.PI) * 0.6;
			right[f] = Math.cos((f / frames) * 12 * Math.PI) * 0.4;
		}
		const buf = buildWav({
			sampleRate: SR,
			channels: 2,
			bitsPerSample: 24,
			sampleFormat: 'int',
			frames,
			gen: (f, c) => Math.round((c === 0 ? left[f] : right[f]) / norm)
		});
		const { result } = await probeAndStream(buf, 128);
		const refL = new Float32Array(frames);
		const refR = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			refL[f] = Math.round(left[f] / norm) * norm;
			refR[f] = Math.round(right[f] / norm) * norm;
		}
		const expected = referencePeaks([refL, refR], 128);
		expectClose(result.peaks, expected, 1e-6);
	});

	it('parity for 32-bit float WAV (no quantization loss)', async () => {
		const frames = 2048;
		const samples = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			samples[f] = Math.sin((f / frames) * 6 * Math.PI) * 0.9;
		}
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 32,
			sampleFormat: 'float',
			frames,
			gen: (f) => samples[f]
		});
		const { result } = await probeAndStream(buf, 32);
		const expected = referencePeaks([samples], 32);
		expectClose(result.peaks, expected, 1e-6);
	});

	it('handles 24-bit sign-extension on negative values', async () => {
		// All samples negative, just below zero. If we forget to
		// sign-extend bit 23, these read as huge positives.
		const frames = 256;
		const intVal = -100; // well within int24 range
		const norm = 1 / 0x800000;
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 24,
			sampleFormat: 'int',
			frames,
			gen: () => intVal
		});
		const { result } = await probeAndStream(buf, 4);
		const expected = intVal * norm;
		for (const [lo, hi] of result.peaks) {
			expect(lo).toBeCloseTo(expected, 6);
			expect(hi).toBeCloseTo(expected, 6);
		}
	});

	it('handles 16-bit AIFF (big-endian)', async () => {
		const frames = 1024;
		const norm = 1 / 0x8000;
		const samples = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			samples[f] = Math.sin((f / frames) * 10 * Math.PI) * 0.5;
		}
		const buf = buildAiff({
			sampleRate: SR,
			channels: 1,
			sampleSize: 16,
			frames,
			gen: (f) => Math.round(samples[f] / norm),
			variant: 'AIFF'
		});
		const { result } = await probeAndStream(buf, 32);
		const ref = new Float32Array(frames);
		for (let f = 0; f < frames; f++) ref[f] = Math.round(samples[f] / norm) * norm;
		const expected = referencePeaks([ref], 32);
		expectClose(result.peaks, expected, 1e-6);
	});

	it('handles AIFC sowt (LE PCM)', async () => {
		const frames = 512;
		const norm = 1 / 0x8000;
		const buf = buildAiff({
			sampleRate: SR,
			channels: 1,
			sampleSize: 16,
			frames,
			gen: (f) => Math.round(Math.sin(f * 0.1) * 16000),
			variant: 'AIFC-sowt'
		});
		const { result } = await probeAndStream(buf, 16);
		const ref = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			ref[f] = Math.round(Math.sin(f * 0.1) * 16000) * norm;
		}
		const expected = referencePeaks([ref], 16);
		expectClose(result.peaks, expected, 1e-6);
	});

	it('honors AIFF SSND offset (non-zero leading pad)', async () => {
		const frames = 512;
		const norm = 1 / 0x8000;
		const buf = buildAiff({
			sampleRate: SR,
			channels: 1,
			sampleSize: 16,
			frames,
			gen: (f) => Math.round(Math.sin(f * 0.05) * 8000),
			variant: 'AIFF',
			ssndOffset: 24
		});
		const { result } = await probeAndStream(buf, 8);
		const ref = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			ref[f] = Math.round(Math.sin(f * 0.05) * 8000) * norm;
		}
		const expected = referencePeaks([ref], 8);
		expectClose(result.peaks, expected, 1e-6);
	});

	it('frame straddling the 1MB read boundary (24-bit, 1 channel)', async () => {
		// 24-bit @ 1ch = 3 bytes/frame. 1 MB / 3 leaves remainder 1, so
		// frame at index 1048575/3 straddles. Build slightly past 1 MB
		// of frames so the boundary is crossed at least once.
		const targetBytes = (1 << 20) + 1024;
		const frames = Math.floor(targetBytes / 3);
		const norm = 1 / 0x800000;
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 24,
			sampleFormat: 'int',
			frames,
			// Distinct value per frame so any misalignment is detected.
			gen: (f) => ((f * 1009) % 0xffff) - 0x8000
		});
		const { result } = await probeAndStream(buf, 256);
		const ref = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			ref[f] = (((f * 1009) % 0xffff) - 0x8000) * norm;
		}
		const expected = referencePeaks([ref], 256);
		expectClose(result.peaks, expected, 1e-5);
		expect(result.frames).toBe(frames);
	});

	it('matches reduceToPeaks bin assignment when frames % bins != 0', async () => {
		const frames = 1000;
		const bins = 64; // 1000 / 64 = 15.625 frames/bin — last-bin behavior
		const norm = 1 / 0x8000;
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames,
			gen: (f) => (f - 500) * 30
		});
		const { result } = await probeAndStream(buf, bins);
		const ref = new Float32Array(frames);
		for (let f = 0; f < frames; f++) ref[f] = (f - 500) * 30 * norm;
		const expected = referencePeaks([ref], bins);
		expectClose(result.peaks, expected, 1e-6);
	});

	it('detects first transient on a kick-after-silence WAV', async () => {
		const lead = Math.round(SR * 0.25); // 250ms silence
		const tail = Math.round(SR * 0.05);
		const frames = lead + tail;
		const norm = 1 / 0x8000;
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames,
			gen: (f) => {
				if (f < lead) return 0;
				const t = (f - lead) / SR;
				const env = Math.exp(-t / (tail / SR / 2.5));
				const v = 0.7 * env * Math.sin(2 * Math.PI * 80 * t);
				return Math.round(v / norm);
			}
		});
		const { result } = await probeAndStream(buf, 64, lead + tail);
		// Marker should land just before `lead` (lookback applied).
		expect(result.firstTransientFrame).toBeGreaterThan(lead - SR * 0.02);
		expect(result.firstTransientFrame).toBeLessThanOrEqual(lead);
	});

	it('returns 0 transient frame on silent buffer', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames: SR,
			gen: () => 0
		});
		const { result } = await probeAndStream(buf, 32);
		expect(result.firstTransientFrame).toBe(0);
	});

	it('produces zero-padded peaks for empty bins (frames < bins)', async () => {
		const buf = buildWav({
			sampleRate: SR,
			channels: 1,
			bitsPerSample: 16,
			sampleFormat: 'int',
			frames: 8,
			gen: () => 100
		});
		const { result } = await probeAndStream(buf, 64);
		expect(result.peaks.length).toBe(64);
		// Most bins are empty -> zero peaks. The first few have data.
		const empties = result.peaks.filter(([lo, hi]) => lo === 0 && hi === 0).length;
		expect(empties).toBeGreaterThan(0);
	});
});
