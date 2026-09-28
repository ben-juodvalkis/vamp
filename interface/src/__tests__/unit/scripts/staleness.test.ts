/**
 * `scripts/staleness.mjs` had no test file at all, which is how it shipped a
 * fingerprint that could not see 93% of the library it was fingerprinting.
 *
 * `hashTree` branched on `entry.isDirectory()` and `entry.isFile()` and nothing
 * else. A `Dirent` for a symlink answers **false to both**, so every symlinked
 * entry contributed nothing to the digest. The audio browser root is a symlink
 * farm by construction — `build-pack-symlinks.ts` mirrors each installed Pack
 * as real directories full of symlinked audio leaves — and measured on this
 * machine it holds 53,907 symlinks against 3,922 real files.
 *
 * The user-visible failure: drop new samples in, and `npm run dev` prints
 * "⚡ Catalog up to date — inputs unchanged" and ships the *old* catalog.
 * Deleted samples stay listed and fail to load. On stage that reads as "the
 * browser is broken", and `FORCE=1` is undiscoverable.
 *
 * These build a real temp tree rather than mocking `fs`: the bug was in what
 * `readdir`'s Dirent reports about a symlink, and a mock would have been
 * written against the same wrong assumption as the code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fingerprint } from '../../../../../scripts/staleness.mjs';

let tmp: string;
let tree: string;
let real: string;

const digest = () => fingerprint([{ path: tree, tree: true }]).digest;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staleness-'));
	tree = path.join(tmp, 'tree');
	real = path.join(tmp, 'real');
	fs.mkdirSync(tree);
	fs.mkdirSync(real);
	fs.writeFileSync(path.join(real, 'a.wav'), 'a');
	fs.writeFileSync(path.join(real, 'b.wav'), 'bb');
	fs.writeFileSync(path.join(tree, 'base.wav'), 'base');
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe('fingerprint — symlinked entries', () => {
	it('is the premise of the bug: a symlink Dirent is neither file nor directory', () => {
		fs.symlinkSync(path.join(real, 'a.wav'), path.join(tree, 'a.wav'));
		const entry = fs
			.readdirSync(tree, { withFileTypes: true })
			.find((e) => e.name === 'a.wav')!;

		expect(entry.isSymbolicLink()).toBe(true);
		expect(entry.isFile()).toBe(false);
		expect(entry.isDirectory()).toBe(false);
	});

	it('changes when a symlinked sample is added', () => {
		const before = digest();
		fs.symlinkSync(path.join(real, 'a.wav'), path.join(tree, 'a.wav'));
		expect(digest()).not.toBe(before);
	});

	it('changes again for a second symlinked sample', () => {
		fs.symlinkSync(path.join(real, 'a.wav'), path.join(tree, 'a.wav'));
		const one = digest();
		fs.symlinkSync(path.join(real, 'b.wav'), path.join(tree, 'b.wav'));
		expect(digest()).not.toBe(one);
	});

	it('changes when a symlinked sample is removed', () => {
		fs.symlinkSync(path.join(real, 'a.wav'), path.join(tree, 'a.wav'));
		const before = digest();
		fs.unlinkSync(path.join(tree, 'a.wav'));
		expect(digest()).not.toBe(before);
	});

	it('changes when a link is retargeted under the same name', () => {
		// mtime alone would not necessarily catch this; readlink does.
		const link = path.join(tree, 'a.wav');
		fs.symlinkSync(path.join(real, 'a.wav'), link);
		const before = digest();
		fs.unlinkSync(link);
		fs.symlinkSync(path.join(real, 'b.wav'), link);
		expect(digest()).not.toBe(before);
	});

	it('sees a symlink pointing into a directory of samples', () => {
		// build-pack-symlinks links leaves, but nothing stops a hand-made
		// directory link, and lstat must not follow it into a walk.
		const before = digest();
		fs.symlinkSync(real, path.join(tree, 'linked-pack'));
		expect(digest()).not.toBe(before);
	});

	it('survives a broken link without throwing, and still records it', () => {
		const before = digest();
		expect(() => {
			fs.symlinkSync(path.join(tmp, 'does-not-exist.wav'), path.join(tree, 'broken.wav'));
		}).not.toThrow();

		let after: string | undefined;
		expect(() => {
			after = digest();
		}).not.toThrow();
		expect(after).not.toBe(before);
	});
});

describe('fingerprint — general', () => {
	it('is stable across repeated runs over an unchanged tree', () => {
		fs.symlinkSync(path.join(real, 'a.wav'), path.join(tree, 'a.wav'));
		expect(digest()).toBe(digest());
	});

	it('still notices a real file, which was never broken', () => {
		const before = digest();
		fs.writeFileSync(path.join(tree, 'new.wav'), 'n');
		expect(digest()).not.toBe(before);
	});

	it('distinguishes a symlink from a real file of the same name', () => {
		const linkTarget = path.join(real, 'a.wav');
		fs.symlinkSync(linkTarget, path.join(tree, 'x.wav'));
		const asLink = digest();

		fs.unlinkSync(path.join(tree, 'x.wav'));
		// A real file whose contents are exactly the target path — same byte
		// length as the symlink's own st_size, which is what makes this a
		// collision worth guarding.
		fs.writeFileSync(path.join(tree, 'x.wav'), linkTarget);
		expect(digest()).not.toBe(asLink);
	});
});
