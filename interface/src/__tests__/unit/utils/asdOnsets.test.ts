/**
 * Live's onsets out of an `.asd`: the block ends a fixed trailer before
 * the `0x0a "OnsetEvent"` tag (asdOnsets.ts). Built here in the layout
 * measured on the rig's "Retrograze Beat 128bpm.aif.asd".
 */
import { describe, it, expect } from 'vitest';
import { parseAsdOnsets } from '../../../routes/api/sample-peaks/asdOnsets';
import { detectOnsets } from '../../../routes/api/sample-peaks/onsetDetector.js';

function asd(frames: number[], strengths: number[], trailer: number): Buffer {
	const n = frames.length;
	const body = Buffer.alloc(8 + 8 * n);
	body.writeUInt32LE(n, 0);
	frames.forEach((f, i) => body.writeUInt32LE(f, 4 + 4 * i));
	body.writeUInt32LE(n, 4 + 4 * n);
	strengths.forEach((s, i) => body.writeFloatLE(s, 8 + 4 * n + 4 * i));
	const lead = Buffer.from('\x0aOnsetEvent schema header ... OnsetArray \x00\x01\x00\x00\x00\x00', 'latin1');
	const tail = Buffer.alloc(trailer);
	tail[0] = 1;
	tail[1] = 5;
	return Buffer.concat([lead, body, tail, Buffer.from('\x0aOnsetEvent\x00\x40', 'latin1')]);
}

describe('parseAsdOnsets', () => {
	it('reads the current layout', () => {
		expect(parseAsdOnsets(asd([518, 10842, 21191], [0.72, 0.97, 0.69], 10))).toEqual([518, 10842, 21191]);
	});

	it('reads the older, longer trailer', () => {
		expect(parseAsdOnsets(asd([100, 200], [0.5, 1], 14))).toEqual([100, 200]);
	});

	it('refuses positions past the file', () => {
		expect(parseAsdOnsets(asd([100, 900], [0.5, 0.5], 10), 500)).toBeNull();
	});

	it('answers null for a file with no onset block', () => {
		expect(parseAsdOnsets(Buffer.from('nothing here'))).toBeNull();
	});
});

describe('detectOnsets', () => {
	it('finds each hit of a pulse train, a hop early', () => {
		const hop = 0.01;
		const peaks: [number, number][] = Array.from({ length: 200 }, (_, i) => {
			const since = i % 50; // a hit every 0.5 s, decaying
			const a = 0.9 * Math.exp(-since / 8) + 0.001;
			return [-a, a];
		});
		const hits = detectOnsets(peaks, hop);
		expect(hits.map((t: number) => Math.round(t * 100))).toEqual([49, 99, 149]);
	});

	it('finds nothing in silence', () => {
		expect(detectOnsets(Array.from({ length: 50 }, () => [0, 0]), 0.01)).toEqual([]);
	});
});
