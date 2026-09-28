import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bakeThumbnails } from '$lib/server/places/audioThumbnailCache';
import { decodeThumbnailPeaks, THUMB_BINS } from '$lib/utils/waveformThumbnail';

/**
 * Bake-pipeline tests for the `.asd`-first ordering + `.alc` resolution
 * (ADR-398/401).
 *
 * `computeThumbnail` privileges Live's `.asd` overview (Path C) over PCM
 * streaming (Path A) — the inverse of the /api/sample-peaks endpoint — and
 * resolves `.alc` clip wrappers to their underlying sample before decoding.
 * These drive `bakeThumbnails` end-to-end against synthetic fixtures.
 */

// A minimal 16-bit mono PCM WAV — Path A reads this.
function writeWav(file: string, freq: number, seconds: number, sampleRate = 44100): void {
	const n = Math.floor(seconds * sampleRate);
	const dataSize = n * 2;
	const buf = Buffer.alloc(44 + dataSize);
	buf.write('RIFF', 0, 'ascii');
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write('WAVE', 8, 'ascii');
	buf.write('fmt ', 12, 'ascii');
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36, 'ascii');
	buf.writeUInt32LE(dataSize, 40);
	for (let i = 0; i < n; i++) {
		const v = Math.sin((i / sampleRate) * freq * Math.PI * 2) * 0.8;
		buf.writeInt16LE(Math.round(v * 0x7fff), 44 + i * 2);
	}
	writeFileSync(file, buf);
}

// buildAsd / floatToHalf mirror asdOverview.test.ts (JS has no native
// float16 writer) — a minimal single-level `.asd` overview block:
//   [MARKER][uint32 levelIndex][uint32 count][float16 min/max pairs...]
const ASD_MARKER = 'SampleOverViewLevel';

function floatToHalf(val: number): number {
	if (val === 0) return 0;
	const sign = val < 0 ? 0x8000 : 0;
	const v = Math.abs(val);
	if (!Number.isFinite(v)) return sign | 0x7c00;
	const exp = Math.floor(Math.log2(v));
	const mant = v / 2 ** exp - 1;
	let e = exp + 15;
	if (e <= 0) return sign | (Math.round(v / 2 ** -24) & 0x03ff);
	if (e >= 0x1f) return sign | 0x7c00;
	let frac = Math.round(mant * 1024);
	if (frac === 1024) {
		frac = 0;
		e += 1;
	}
	return sign | (e << 10) | (frac & 0x03ff);
}

function buildAsd(pairs: [number, number][]): Buffer {
	const flat: number[] = [];
	for (const [lo, hi] of pairs) flat.push(lo, hi);
	const header = Buffer.alloc(ASD_MARKER.length + 8);
	header.write(ASD_MARKER, 0, 'ascii');
	header.writeUInt32LE(0, ASD_MARKER.length);
	header.writeUInt32LE(flat.length, ASD_MARKER.length + 4);
	const body = Buffer.alloc(flat.length * 2);
	for (let i = 0; i < flat.length; i++) body.writeUInt16LE(floatToHalf(flat[i]), i * 2);
	return Buffer.concat([header, body]);
}

function envelopePairs(count: number): [number, number][] {
	return Array.from(
		{ length: count },
		(_, i) => [-Math.abs(Math.sin(i / 5)) * 0.8, Math.abs(Math.cos(i / 5)) * 0.8] as [number, number]
	);
}

// A gzipped-XML `.alc` clip that references `sampleAbsPath` by absolute Path —
// resolveAlc trusts an on-disk absolute `<Path Value>`.
function writeAlc(alcPath: string, sampleAbsPath: string, name: string): void {
	const xml =
		`<?xml version="1.0" encoding="UTF-8"?><Ableton><LiveSet><SampleRef><FileRef>` +
		`<Name Value="${name}"/><Path Value="${sampleAbsPath}"/>` +
		`</FileRef></SampleRef></LiveSet></Ableton>`;
	writeFileSync(alcPath, gzipSync(Buffer.from(xml, 'utf-8')));
}

describe('audio thumbnail bake — .asd-first ordering + .alc (ADR-398/401)', () => {
	let dir: string;
	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), 'bake-asd-'));
	});
	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('bakes from the .asd overview for an undecodable sample (Path C)', async () => {
		// A file no PCM probe or decoder can read (stands in for protected pack
		// AIFC), but with a valid `.asd` sidecar next to it.
		const sample = join(dir, 'protected.aif');
		writeFileSync(sample, Buffer.from('FORM\0\0\0\0AIFCable-proprietary-not-real-pcm'));
		writeFileSync(`${sample}.asd`, buildAsd(envelopePairs(200)));

		const presets = [{ fullPath: sample, peaks: undefined as string | undefined }];
		const stats = await bakeThumbnails(presets, join(dir, 'cache-asd.json'));

		expect(stats.unavailable).toBe(false);
		expect(stats.decoded).toBe(1);
		expect(stats.tombstoned).toBe(0);

		const decoded = decodeThumbnailPeaks(presets[0].peaks);
		expect(decoded).not.toBeNull();
		expect(decoded).toHaveLength(THUMB_BINS);
		const maxAbs = Math.max(...decoded!.map(([lo, hi]) => Math.max(Math.abs(lo), Math.abs(hi))));
		expect(maxAbs).toBeGreaterThan(0.3); // real dynamics, not a flat line
	});

	it('falls back to Path A for a decodable PCM file with a stale/garbage .asd', async () => {
		const sample = join(dir, 'plain.wav');
		writeWav(sample, 330, 0.2);
		// A `.asd` with no valid SampleOverViewLevel block → readAsdOverview
		// returns null → the bake must still produce a thumbnail via Path A.
		writeFileSync(`${sample}.asd`, Buffer.from('stale asd, no overview marker present here'));

		const presets = [{ fullPath: sample, peaks: undefined as string | undefined }];
		const stats = await bakeThumbnails(presets, join(dir, 'cache-pcm.json'));

		expect(stats.decoded).toBe(1);
		expect(stats.tombstoned).toBe(0);
		expect(decodeThumbnailPeaks(presets[0].peaks)).toHaveLength(THUMB_BINS);
	});

	it('resolves a .alc wrapper to its underlying sample and bakes that', async () => {
		// `.alc` is a gzipped-XML clip pointing at a real sample — computeThumbnail
		// must resolve it (not probe the wrapper, which would tombstone forever).
		const sample = join(dir, 'clip-src.wav');
		writeWav(sample, 210, 0.2);
		const alc = join(dir, 'MyLoop.alc');
		writeAlc(alc, sample, 'clip-src.wav');

		const presets = [{ fullPath: alc, peaks: undefined as string | undefined }];
		const stats = await bakeThumbnails(presets, join(dir, 'cache-alc.json'));

		expect(stats.decoded).toBe(1);
		expect(stats.tombstoned).toBe(0);
		expect(decodeThumbnailPeaks(presets[0].peaks)).toHaveLength(THUMB_BINS);
	});

	it('tombstones with reason "decode-failed" when no path can render (garbage bytes)', async () => {
		// Bytes that look like nothing: not a valid .asd, not PCM (probe → null),
		// and not a codec audio-decode (Path B) will accept. computeThumbnail
		// exhausts C → A → B and tombstones with the concrete reason so the
		// failure log can categorize it. `.bin` avoids any extension-based short
		// circuit — eligibility is decided by decode success, not by extension.
		const sample = join(dir, 'garbage.bin');
		writeFileSync(sample, Buffer.from('not audio, not an .asd, not any codec — pure garbage bytes'));

		const presets = [{ fullPath: sample, peaks: undefined as string | undefined }];
		const stats = await bakeThumbnails(presets, join(dir, 'cache-none.json'));

		expect(stats.decoded).toBe(0);
		expect(stats.tombstoned).toBe(1);
		expect(presets[0].peaks).toBeUndefined();
		expect(stats.failuresByReason['decode-failed']).toBe(1);
		expect(stats.failures).toHaveLength(1);
		expect(stats.failures[0]).toMatchObject({ path: sample, reason: 'decode-failed' });
	});

	it('tombstones an unresolvable .alc with reason "alc-unresolvable" and writes the failure log', async () => {
		// A .alc clip whose referenced sample does not exist on disk — the single
		// largest real-world failure category. resolveAlc returns null → tombstone.
		const alc = join(dir, 'Broken.alc');
		writeAlc(alc, join(dir, 'does-not-exist.wav'), 'does-not-exist.wav');
		const logFile = join(dir, 'failures.json');

		const presets = [{ fullPath: alc, peaks: undefined as string | undefined }];
		const stats = await bakeThumbnails(presets, join(dir, 'cache-alc-broken.json'), logFile);

		expect(stats.decoded).toBe(0);
		expect(stats.tombstoned).toBe(1);
		expect(stats.failuresByReason['alc-unresolvable']).toBe(1);

		// The persistent failure log lists the file with its reason.
		expect(existsSync(logFile)).toBe(true);
		const log = JSON.parse(readFileSync(logFile, 'utf-8'));
		expect(log.total).toBe(1);
		expect(log.byReason['alc-unresolvable']).toBe(1);
		expect(log.failures[0]).toMatchObject({ path: alc, reason: 'alc-unresolvable' });
	});

	it('reuses cached thumbnails on an unchanged rebuild (incremental cache)', async () => {
		const sample = join(dir, 'reuse.wav');
		writeWav(sample, 300, 0.2);
		const cache = join(dir, 'cache-reuse.json');

		const first = await bakeThumbnails([{ fullPath: sample, peaks: undefined }], cache);
		expect(first.decoded).toBe(1);

		const second = [{ fullPath: sample, peaks: undefined as string | undefined }];
		const stats = await bakeThumbnails(second, cache);
		expect(stats.decoded).toBe(0); // unchanged file → no re-decode
		expect(stats.reused).toBe(1);
		expect(second[0].peaks).toBeTruthy(); // thumbnail restored from cache
	});

	it('keepUnseen: baking one Place keeps the thumbnails another Place baked into the same cache', async () => {
		const a = join(dir, 'place-a.wav');
		const b = join(dir, 'place-b.wav');
		writeWav(a, 300, 0.2);
		writeWav(b, 300, 0.3);
		const cache = join(dir, 'cache-shared.json');

		expect((await bakeThumbnails([{ fullPath: a, peaks: undefined }], cache, undefined, { keepUnseen: true })).decoded).toBe(1);
		expect((await bakeThumbnails([{ fullPath: b, peaks: undefined }], cache, undefined, { keepUnseen: true })).decoded).toBe(1);
		const again = await bakeThumbnails([{ fullPath: a, peaks: undefined }], cache, undefined, { keepUnseen: true });
		expect(again.decoded).toBe(0);
		expect(again.reused).toBe(1);
	});

	it('shares one decode across presets with the same fullPath (dedupe)', async () => {
		const sample = join(dir, 'dedupe.wav');
		writeWav(sample, 260, 0.2);
		const presets = [
			{ fullPath: sample, peaks: undefined as string | undefined },
			{ fullPath: sample, peaks: undefined as string | undefined },
			{ fullPath: sample, peaks: undefined as string | undefined }
		];

		const stats = await bakeThumbnails(presets, join(dir, 'cache-dedupe.json'));
		expect(stats.decoded).toBe(1); // one decode for the shared path...
		expect(presets.every((p) => !!p.peaks)).toBe(true); // ...shared onto every preset
	});
});

// Real Ableton pack fixture — a protected-pack AIFC that Path A/B can't
// decode, so its thumbnail can ONLY come from `.asd` (Path C). Guarded on
// the file existing so CI / machines without the pack stay hermetic. This
// sample would have been a tombstone before ADR-398.
const REAL_ASD =
	'/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/Packs/Chop and Swing/' +
	'Samples/Loops and Chords/Drum Loops/Full Loops/LL Loop 79 BPM.aif.asd';
const REAL_SAMPLE = REAL_ASD.replace(/\.asd$/, '');

describe.runIf(existsSync(REAL_SAMPLE) && existsSync(REAL_ASD))(
	'audio thumbnail bake — real pack AIFC (.asd)',
	() => {
		it('bakes a non-empty thumbnail that would have been a tombstone pre-ADR-398', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'bake-real-'));
			try {
				const presets = [{ fullPath: REAL_SAMPLE, peaks: undefined as string | undefined }];
				const stats = await bakeThumbnails(presets, join(dir, 'cache.json'));
				expect(stats.decoded).toBe(1);

				const decoded = decodeThumbnailPeaks(presets[0].peaks);
				expect(decoded).toHaveLength(THUMB_BINS);
				const span = Math.max(...decoded!.map(([, hi]) => hi));
				expect(span).toBeGreaterThan(0.3);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	}
);
