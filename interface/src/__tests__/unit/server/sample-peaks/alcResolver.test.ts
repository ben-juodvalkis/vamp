import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { isAlc, resolveAlc } from '../../../../routes/api/sample-peaks/alcResolver';

function alcXml(name: string, relDirs: string[], absPath?: string, pack?: string): string {
	const relElems = relDirs
		.map((d) => `<RelativePathElement Dir="${d}" />`)
		.join('');
	const pathTag = (absPath ? `<Path Value="${absPath}" />` : '') + (pack ? `<LivePackName Value="${pack}" />` : '');
	return (
		'<?xml version="1.0" encoding="UTF-8"?>' +
		'<Ableton><LiveSet><AudioClip><SampleRef><FileRef>' +
		'<HasRelativePath Value="true" />' +
		'<RelativePathType Value="5" />' +
		`<RelativePath>${relElems}</RelativePath>` +
		pathTag +
		`<Name Value="${name}" />` +
		'<Type Value="2" />' +
		'</FileRef></SampleRef></AudioClip></LiveSet></Ableton>'
	);
}

let root: string;

beforeEach(async () => {
	// realpath the temp root: resolveAlc now returns symlink-resolved
	// (canonical) paths, and on macOS tmpdir() is `/var/...` → `/private/var/...`.
	// Canonicalizing here keeps every derived expectation in the resolved space.
	root = await realpath(await mkdtemp(path.join(tmpdir(), 'alc-')));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function writeAlc(p: string, xml: string, gzipped = true): Promise<Buffer> {
	const buf = gzipped ? gzipSync(Buffer.from(xml, 'utf-8')) : Buffer.from(xml, 'utf-8');
	await mkdir(path.dirname(p), { recursive: true });
	await writeFile(p, buf);
	return buf;
}

async function touch(p: string): Promise<void> {
	await mkdir(path.dirname(p), { recursive: true });
	await writeFile(p, Buffer.from([0]));
}

describe('resolveAlc', () => {
	it('upward-walks to a sibling Samples/ folder (Forge layout)', async () => {
		const pack = path.join(root, 'The Forge by Hecq');
		const alc = path.join(pack, 'Clips', 'Coil Loops', '01_MacBook1.alc');
		const sample = path.join(pack, 'Samples', 'Coil Pickup', 'iphone 3.aif');
		await touch(sample);
		const raw = await writeAlc(alc, alcXml('iphone 3.aif', ['Samples', 'Coil Pickup']));

		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('drops the private/tmp/trunk absolute-authoring tail', async () => {
		const pack = path.join(root, 'Pack');
		const alc = path.join(pack, 'Clips', 'clip.alc');
		const sample = path.join(pack, 'Samples', 'kick.wav');
		await touch(sample);
		const raw = await writeAlc(
			alc,
			alcXml('kick.wav', ['Samples', 'private', 'tmp', 'trunk', 'Pack', 'Samples'])
		);

		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('resolves a sample beside the .alc', async () => {
		const alc = path.join(root, 'loop.alc');
		const sample = path.join(root, 'loop.wav');
		await touch(sample);
		const raw = await writeAlc(alc, alcXml('loop.wav', []));

		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('follows a symlinked .alc into the Pack tree to find the sample', async () => {
		// Library clips are symlinks: `User Library/.../X.alc` → `Packs/.../X.alc`.
		// The sample lives under the Pack (Samples/...), NOT beside the symlink,
		// so the walk must start from the .alc's REAL (resolved) directory.
		const pack = path.join(root, 'Packs', 'Retro Synths');
		const realAlc = path.join(pack, 'Clips', 'Modular Patterns', '100-Ablaze.alc');
		const sample = path.join(pack, 'Samples', 'Modular Patterns', '100-Ablaze.aif');
		await touch(sample);
		const raw = await writeAlc(realAlc, alcXml('100-Ablaze.aif', ['Samples', 'Modular Patterns']));

		// The scanned path is a symlink in the User Library pointing at the real .alc.
		const linkDir = path.join(root, 'User Library', 'Bass', 'Retro Synths');
		const linkAlc = path.join(linkDir, '100-Ablaze.alc');
		await mkdir(linkDir, { recursive: true });
		await symlink(realAlc, linkAlc);

		// Resolving via the symlink must reach the sample under the Pack — walking
		// from the symlink's own User Library dir would never find it.
		expect(await resolveAlc(linkAlc, raw)).toBe(path.normalize(sample));
	});

	it('reads Dir when Id precedes it in RelativePathElement (attribute order)', async () => {
		// Pack clips emit `<RelativePathElement Id="4" Dir="Samples" />` — Dir is
		// not the first attribute. A `\s+Dir=` anchor misses it, collapsing the
		// relative path to a bare filename and defeating the walk.
		const pack = path.join(root, 'Pack');
		const alc = path.join(pack, 'Clips', 'clip.alc');
		const sample = path.join(pack, 'Samples', 'Modular Patterns', 'snare.aif');
		await touch(sample);
		const xml =
			'<?xml version="1.0" encoding="UTF-8"?>' +
			'<Ableton><LiveSet><AudioClip><SampleRef><FileRef>' +
			'<RelativePath>' +
			'<RelativePathElement Id="4" Dir="Samples" />' +
			'<RelativePathElement Id="5" Dir="Modular Patterns" />' +
			'</RelativePath>' +
			'<Name Value="snare.aif" />' +
			'</FileRef></SampleRef></AudioClip></LiveSet></Ableton>';
		const raw = await writeAlc(alc, xml);

		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('decodes XML entities in the sample name (parity with Python)', async () => {
		// Ableton encodes `&` as `&amp;` in the XML; the resolver must
		// decode it back or the file lookup fails (waveform 404s).
		const alc = path.join(root, 'clip.alc');
		const sample = path.join(root, "Rock & Roll.wav");
		await touch(sample);
		// The .alc XML stores the entity-encoded form.
		const raw = await writeAlc(alc, alcXml('Rock &amp; Roll.wav', []));

		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('decodes entities in a RelativePath dir name too', async () => {
		const alc = path.join(root, 'Clips', 'clip.alc');
		const sample = path.join(root, 'A & B', 'kick.wav');
		await touch(sample);
		const raw = await writeAlc(alc, alcXml('kick.wav', ['A &amp; B']));

		// Upward walk from Clips/ finds ../A & B/kick.wav.
		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('trusts an absolute Path when present and real', async () => {
		const sample = path.join(root, 'elsewhere', 'vox.aif');
		await touch(sample);
		const alc = path.join(root, 'clip.alc');
		const raw = await writeAlc(alc, alcXml('vox.aif', ['nonexistent'], sample));

		expect(await resolveAlc(alc, raw)).toBe(sample);
	});

	it('ignores a dead absolute Path and falls back to the walk', async () => {
		const pack = path.join(root, 'Pack');
		const alc = path.join(pack, 'Clips', 'clip.alc');
		const sample = path.join(pack, 'Samples', 'snare.wav');
		await touch(sample);
		const raw = await writeAlc(
			alc,
			alcXml('snare.wav', ['Samples'], '/private/tmp/trunk/gone/snare.wav')
		);

		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('parses plain (non-gzipped) XML', async () => {
		const alc = path.join(root, 'loop.alc');
		const sample = path.join(root, 'loop.wav');
		await touch(sample);
		const raw = await writeAlc(alc, alcXml('loop.wav', []), false);

		expect(await resolveAlc(alc, raw)).toBe(path.normalize(sample));
	});

	it('returns null when the sample cannot be located', async () => {
		const alc = path.join(root, 'clip.alc');
		const raw = await writeAlc(alc, alcXml('ghost.wav', ['Samples']));
		expect(await resolveAlc(alc, raw)).toBeNull();
	});

	it('returns null on garbage content', async () => {
		const alc = path.join(root, 'clip.alc');
		const raw = Buffer.from('not xml and not gzip');
		await writeFile(alc, raw);
		expect(await resolveAlc(alc, raw)).toBeNull();
	});

	it('returns null when there is no Name', async () => {
		const alc = path.join(root, 'clip.alc');
		const xml =
			'<Ableton><SampleRef><FileRef>' +
			'<RelativePath><RelativePathElement Dir="Samples" /></RelativePath>' +
			'</FileRef></SampleRef></Ableton>';
		const raw = await writeAlc(alc, xml);
		expect(await resolveAlc(alc, raw)).toBeNull();
	});
});

describe('isAlc', () => {
	it.each([
		['/a/b/c.alc', true],
		['/a/b/c.ALC', true],
		['/a/b/c.wav', false],
		['/a/b/c.aif', false],
		['clip.als', false],
		['', false]
	])('isAlc(%s) === %s', (p, expected) => {
		expect(isAlc(p as string)).toBe(expected);
	});
});

/**
 * A pack clip copied out of its pack (the browser's Places are clones,
 * 2026-09-24): the walk from the copy never reaches the pack, so the clip's
 * `LivePackName` under the installed Packs folder does. Measured over the
 * Places' 1,099 clips, 908 resolve only this way — and before it, a cold
 * thumbnail bake tombstoned them all. Mirrors the Python resolver's tests.
 */
describe('resolveAlc — a pack clip copied out of its pack', () => {
	async function copiedOut() {
		const packs = path.join(root, 'Packs');
		const sample = path.join(packs, 'Vinyl Classics', 'Samples', 'Degrees Of Abstract', '098 Lumb Robot', 'FX Whistle.aif');
		await touch(sample);
		const xml = alcXml('FX Whistle.aif', ['Samples', 'Degrees Of Abstract', '098 Lumb Robot', 'private', 'tmp', 'trunk'], undefined, 'Vinyl Classics');
		const inside = path.join(packs, 'Vinyl Classics', 'Clips', 'FX Whistle.alc');
		const copy = path.join(root, 'Sidebar', 'Inst', 'Samples', 'Vinyl Classics', 'FX Whistle.alc');
		return { packs, sample, inside, insideRaw: await writeAlc(inside, xml), copy, copyRaw: await writeAlc(copy, xml) };
	}

	it('resolves inside its pack with no pack roots, as before', async () => {
		const c = await copiedOut();
		expect(await resolveAlc(c.inside, c.insideRaw)).toBe(path.normalize(c.sample));
	});

	it('resolves a copy through the Packs folder, and only with it', async () => {
		const c = await copiedOut();
		expect(await resolveAlc(c.copy, c.copyRaw)).toBeNull();
		expect(await resolveAlc(c.copy, c.copyRaw, [c.packs])).toBe(path.normalize(c.sample));
		expect(await resolveAlc(c.copy, c.copyRaw, ['', c.packs])).toBe(path.normalize(c.sample));
	});

	it('never takes a pack name as a path', async () => {
		const packs = path.join(root, 'r', 'Packs');
		await mkdir(packs, { recursive: true });
		await touch(path.join(root, 'r', 'Samples', 'x.aif')); // where only `<packs>/../` leads
		for (const bad of ['..', '../r', 'a/b', '.']) {
			const alc = path.join(root, 'clipdir', 'bad.alc');
			const raw = await writeAlc(alc, alcXml('x.aif', ['Samples'], undefined, bad));
			expect(await resolveAlc(alc, raw, [packs]), bad).toBeNull();
		}
	});
});
