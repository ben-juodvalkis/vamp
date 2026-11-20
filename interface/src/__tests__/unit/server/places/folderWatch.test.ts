// @vitest-environment node
/**
 * What keeps a disk-built Place current: the tree stamp moves for a change
 * anywhere inside the Place, and the watch reports the folder that changed
 * once it settles (`folderWatch.ts`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderWatch, folderTreeStamp } from '$lib/server/places/folderWatch';

let root: string;
let watch: FolderWatch | null = null;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'folder-watch-'));
	mkdirSync(join(root, 'Synth', 'Pads'), { recursive: true });
	writeFileSync(join(root, 'Synth', 'Pads', 'Warm.adv'), 'x');
});
afterEach(() => {
	watch?.close();
	watch = null;
	rmSync(root, { recursive: true, force: true });
});

/** Put a folder's mtime back, so only what is under it can move the stamp. */
function keepTime(dir: string, run: () => void): void {
	const t = statSync(dir).mtime;
	run();
	utimesSync(dir, t, t);
}

describe('folderTreeStamp', () => {
	it('stays put while nothing changes', () => {
		expect(folderTreeStamp(root)).toBe(folderTreeStamp(root));
	});

	it('moves for a preset moved two folders down, the top folder untouched', () => {
		const before = folderTreeStamp(root);
		keepTime(root, () => {
			mkdirSync(join(root, 'Synth', 'Pads', 'Old'));
			renameSync(join(root, 'Synth', 'Pads', 'Warm.adv'), join(root, 'Synth', 'Pads', 'Old', 'Warm.adv'));
		});
		expect(folderTreeStamp(root)).not.toBe(before);
	});

	it('moves for a folder removed with its newer mtime already past', () => {
		mkdirSync(join(root, 'Synth', 'Gone'));
		const before = folderTreeStamp(root);
		keepTime(join(root, 'Synth'), () => rmSync(join(root, 'Synth', 'Gone'), { recursive: true }));
		// The count drops even when no mtime is newer than before.
		expect(folderTreeStamp(root)).not.toBe(before);
	});

	it("reads 'missing' for a folder that is not there", () => {
		expect(folderTreeStamp(join(root, 'nope'))).toBe('missing');
	});
});

describe('FolderWatch', () => {
	it('reports the watched folder once a change deep inside it settles', async () => {
		const seen: string[][] = [];
		watch = new FolderWatch((roots) => seen.push(roots), 100);
		watch.set([root]);
		expect(watch.watching).toEqual([root]);
		// FSEvents can deliver a beat late; let the watch start first.
		await new Promise((r) => setTimeout(r, 200));
		writeFileSync(join(root, 'Synth', 'Pads', 'Bright.adv'), 'x');
		writeFileSync(join(root, 'Synth', 'Pads', 'Dark.adv'), 'x');
		await expect.poll(() => seen.length, { timeout: 4000, interval: 50 }).toBeGreaterThan(0);
		expect(seen[0]).toEqual([root]);
	});

	it('stops watching a folder dropped from the set', () => {
		watch = new FolderWatch(() => {}, 100);
		const other = join(root, 'Synth');
		watch.set([root, other]);
		watch.set([other]);
		expect(watch.watching).toEqual([other]);
	});
});
