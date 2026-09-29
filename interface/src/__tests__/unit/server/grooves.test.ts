import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
	DEFAULT_TICKS,
	groovesListing,
	parseAgr,
	readGrooveLibrary,
	readGrooveTicks,
	writeGrooveTicks
} from '$lib/server/grooves';

function agr(times: number[], opts: { grid?: number; vel?: number[] } = {}): string {
	const notes = times
		.map((t, i) => `<MidiNoteEvent Time="${t}" Duration="0.0625" Velocity="${opts.vel?.[i] ?? 127}" IsEnabled="true" />`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton><Groove><Clip><Notes>${notes}</Notes>
<Grid><GridIntervalPixel Value="20" /><SnapToGrid Value="true" /></Grid></Clip>
<Grid Value="${opts.grid ?? 3}" /><QuantizationAmount Value="0" /><TimingAmount Value="100" /></Groove></Ableton>`;
}

describe('parseAgr', () => {
	it('reads the grid and the first 8 events over 8 steps, gzipped or plain', () => {
		const xml = agr([0, 0.285, 0.5, 0.785, 1, 1.285, 1.5, 1.785, 2, 2.285], { vel: [127, 64] });
		for (const bytes of [Buffer.from(xml), gzipSync(Buffer.from(xml))]) {
			const p = parseAgr(bytes)!;
			expect(p.grid).toBe('1/16');
			expect(p.events).toHaveLength(8);
			expect(p.events[1]).toEqual({ x: 0.285 / 2, v: 64 / 127 });
			expect(p.events[7].x).toBeCloseTo(1.785 / 2);
		}
	});

	it('takes the span from the notes, not the grid', () => {
		// Hip Hop Late 8ths: gridded 1/16, played in 8ths — four beats wide.
		const p = parseAgr(Buffer.from(agr([0, 0.529, 0.997, 1.528, 2, 2.527, 3, 3.525], { grid: 3 })))!;
		expect(p.events[2].x).toBeCloseTo(0.997 / 4);
	});

	it('maps 1 / 3 / 5 to 1/8, 1/16, 1/32', () => {
		const grid = (g: number) => parseAgr(Buffer.from(agr([0, 0.5], { grid: g })))!.grid;
		expect([grid(1), grid(3), grid(5)]).toEqual(['1/8', '1/16', '1/32']);
	});

	it('gives nothing for a binary file', () => {
		expect(parseAgr(Buffer.from([0xab, 0x1e, 0x56, 0x78, 0x03, 0x00]))).toBeNull();
	});
});

describe('the library and its ticks', () => {
	it('groups files by folder in Live order and keeps unreadable ones without a picture', () => {
		const root = mkdtempSync(join(tmpdir(), 'grooves-'));
		mkdirSync(join(root, 'Utility'));
		mkdirSync(join(root, 'Swing', 'Logic'), { recursive: true });
		mkdirSync(join(root, 'Swing', 'Basic'), { recursive: true });
		writeFileSync(join(root, 'Utility', 'Quantize 16.agr'), agr([0, 0.25]));
		writeFileSync(join(root, 'Swing', 'Logic', 'Swing Logic 8ths 51.agr'), Buffer.from([0xab, 0x1e, 0x56, 0x78]));
		writeFileSync(join(root, 'Swing', 'Basic', 'Swing 16ths 57.agr'), gzipSync(Buffer.from(agr([0, 0.285]))));
		const files = readGrooveLibrary(root);
		expect(files.map((f) => [f.group, f.name, f.grid !== null])).toEqual([
			['Swing/Basic', 'Swing 16ths 57', true],
			['Swing/Logic', 'Swing Logic 8ths 51', false],
			['Utility', 'Quantize 16', true]
		]);
		expect(files[1].events).toBeNull();
	});

	it('saves ticks in tick order and starts a first run from the defaults', () => {
		const dir = mkdtempSync(join(tmpdir(), 'grooves-ticks-'));
		const file = join(dir, 'logs', 'grooves.json');
		expect(readGrooveTicks(file)).toEqual({ ticked: [...DEFAULT_TICKS], firstRun: true });
		writeGrooveTicks(file, ['b', 'a', 'b']);
		expect(readGrooveTicks(file)).toEqual({ ticked: ['b', 'a'], firstRun: false });
		writeGrooveTicks(file, []);
		expect(readGrooveTicks(file)).toEqual({ ticked: [], firstRun: false });
	});
});

// The real Core Library, where this Mac has one (measured, not assumed).
const LIVE_GROOVES = '/Applications/Ableton Live 12 Beta.app/Contents/App-Resources/Core Library/Grooves';

describe.skipIf(!existsSync(LIVE_GROOVES))('the Core Library on this Mac', () => {
	const files = readGrooveLibrary(LIVE_GROOVES);

	it('lists 219 files: Swing 137, Style 58, Percussion 12, Utility 12, unique by name', () => {
		const top = (g: string) => files.filter((f) => f.group.split('/')[0] === g).length;
		expect(files).toHaveLength(219);
		expect([top('Swing'), top('Style'), top('Percussion'), top('Utility')]).toEqual([137, 58, 12, 12]);
		expect(new Set(files.map((f) => f.name)).size).toBe(219);
	});

	it('reads 116, and the binary 103 are Logic, Notator and a few others', () => {
		const unread = files.filter((f) => f.events === null);
		const by = (g: string) => unread.filter((f) => f.group === g).length;
		expect(files.length - unread.length).toBe(116);
		expect([by('Swing/Logic'), by('Swing/Notator'), by('Swing/MPC'), by('Percussion'), by('Style'), by('Utility')]).toEqual([
			64, 10, 9, 10, 9, 1
		]);
	});

	it('has every default tick, readable', () => {
		for (const name of DEFAULT_TICKS) expect(files.find((f) => f.name === name)?.events?.length).toBe(8);
	});

	it('Swing 16ths 57 is 1/16 with its off-beats at 0.285 of a beat', () => {
		const g = files.find((f) => f.name === 'Swing 16ths 57')!;
		expect(g.grid).toBe('1/16');
		expect(g.events![1].x).toBeCloseTo(0.285 / 2, 3);
	});

	it('Quantize 4, 8T and 16T read 1/4, 1/8T and 1/16T', () => {
		const grid = (n: string) => files.find((f) => f.name === n)?.grid;
		expect([grid('Quantize 4'), grid('Quantize 8T'), grid('Quantize 16T')]).toEqual(['1/4', '1/8T', '1/16T']);
	});

	it('a listing keeps only ticks that are files', () => {
		const dir = mkdtempSync(join(tmpdir(), 'grooves-listing-'));
		const ticks = join(dir, 'grooves.json');
		writeGrooveTicks(ticks, ['Swing 8ths 73', 'Nope', 'Swing 16ths 57']);
		expect(groovesListing(LIVE_GROOVES, ticks).ticked).toEqual(['Swing 8ths 73', 'Swing 16ths 57']);
	});
});

describe('your own grooves', () => {
	it('lists the User Library’s grooves as “User: <file>”, first, beside a Core groove of the same name', () => {
		const core = mkdtempSync(join(tmpdir(), 'grooves-core-'));
		mkdirSync(join(core, 'Swing', 'Basic'), { recursive: true });
		writeFileSync(join(core, 'Swing', 'Basic', 'Swing 16.agr'), agr([0, 0.25]));
		const mine = mkdtempSync(join(tmpdir(), 'grooves-user-'));
		mkdirSync(join(mine, 'Old'));
		writeFileSync(join(mine, 'Swing 16.agr'), agr([0, 0.3]));
		writeFileSync(join(mine, 'Old', 'Late #2.agr'), agr([0, 0.3]));
		const ticks = join(mkdtempSync(join(tmpdir(), 'grooves-ut-')), 'grooves.json');
		writeGrooveTicks(ticks, ['User: Swing 16', 'Swing 16', 'User: Late #2']);

		const l = groovesListing(core, ticks, mine);
		expect(l.userRoot).toBe(mine);
		expect(l.files.map((f) => [f.group, f.name, !!f.blocked])).toEqual([
			['User', 'User: Late #2', true],
			['User', 'User: Swing 16', false],
			['Swing/Basic', 'Swing 16', false]
		]);
		// A name the pool cannot carry is listed, never ticked.
		expect(l.ticked).toEqual(['User: Swing 16', 'Swing 16']);
	});

	it('has no user group without a User Library', () => {
		const ticks = join(mkdtempSync(join(tmpdir(), 'grooves-ut-')), 'grooves.json');
		expect(groovesListing(null, ticks, null)).toMatchObject({ files: [], userRoot: null });
	});
});

const MY_GROOVES = '/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/Grooves';

describe.skipIf(!existsSync(MY_GROOVES))('the User Library on this Mac', () => {
	it('lists its grooves as User: …, all readable', () => {
		const files = readGrooveLibrary(MY_GROOVES, { user: true });
		expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(['User: Swing 16', 'User: Swing 8']));
		expect(files.every((f) => f.group === 'User' && f.events !== null)).toBe(true);
	});
});
