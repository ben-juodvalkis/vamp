/**
 * The ticks file (onboarding.plan.md §2): nothing saved is a first run, seeded
 * from the Sidebar root so the rig keeps its seven; a save, even of nothing,
 * ends it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTicks, seedTicks, writeTicks } from '$lib/server/places/ticks';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'places-ticks-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readTicks / writeTicks', () => {
	it('is a first run with no file, and not after a save of nothing', () => {
		const file = join(dir, 'logs', 'places.json');
		expect(readTicks(file).firstRun).toBe(true);
		writeTicks(file, []);
		const after = readTicks(file);
		expect(after.firstRun).toBe(false);
		expect(after.ticked.size).toBe(0);
		expect(after.mtimeMs).toBeGreaterThan(0);
	});

	it('round-trips the keys, deduplicated and sorted', () => {
		const file = join(dir, 'places.json');
		writeTicks(file, ['place:/b', 'place:/a', 'place:/b']);
		expect([...readTicks(file).ticked]).toEqual(['place:/a', 'place:/b']);
	});

	it('treats an unreadable file as saved once, with nothing ticked', () => {
		const file = join(dir, 'places.json');
		writeFileSync(file, '{not json');
		const t = readTicks(file);
		expect(t.firstRun).toBe(false);
		expect(t.ticked.size).toBe(0);
	});
});

describe('seedTicks', () => {
	const keys = [
		{ key: 'place:/Lib/Sidebar/Drum', path: '/Lib/Sidebar/Drum' },
		{ key: 'place:/Lib/Sidebar', path: '/Lib/Sidebar' },
		{ key: 'place:/Users/me/Desktop', path: '/Users/me/Desktop' },
		{ key: 'place:/Lib/SidebarX/Perc', path: '/Lib/SidebarX/Perc' }
	];
	it('ticks the Places inside the Sidebar root and nothing else', () => {
		expect([...seedTicks(keys, '/Lib/Sidebar/')]).toEqual(['place:/Lib/Sidebar/Drum']);
	});
	it('ticks nothing with no root', () => {
		expect(seedTicks(keys, undefined).size).toBe(0);
	});
});
