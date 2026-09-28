/**
 * Which Live `npm run dev` and `npm run ipad` open (plan.md §2). They used to
 * open 'Ableton Live 12 Beta' by name, the owner's; the setup check stood in
 * the last Live in /Applications by name, which on a Mac with a Suite and a
 * Beta is the Suite even while the Beta is the one in use.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '../../../../..');
const { findLiveApp } = require(resolve(ROOT, 'scripts/open-live.js'));

let scratch: string;
let apps: string;
let prefs: string;

function app(name: string, version: string): string {
	const dir = join(apps, name, 'Contents');
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'Info.plist'),
		`<?xml version="1.0"?>\n<plist><dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>${version} (2026-09-17_a0ac16f342)</string>\n</dict></plist>\n`
	);
	return join(apps, name);
}

function used(version: string, ageSeconds: number) {
	const dir = join(prefs, `Live ${version}`);
	mkdirSync(dir, { recursive: true });
	const when = new Date(Date.now() - ageSeconds * 1000);
	utimesSync(dir, when, when);
}

const find = (configured?: string) => findLiveApp({ configured, applicationsDir: apps, prefsDir: prefs });

describe('findLiveApp', () => {
	beforeEach(() => {
		scratch = mkdtempSync(join(tmpdir(), 'looping-live-'));
		apps = join(scratch, 'Applications');
		prefs = join(scratch, 'Prefs');
		mkdirSync(apps);
		mkdirSync(prefs);
	});

	afterEach(() => {
		rmSync(scratch, { recursive: true, force: true });
	});

	it('opens the Live whose version names the preferences folder written last', () => {
		app('Ableton Live 12 Suite.app', '12.4.2');
		const beta = app('Ableton Live 12 Beta.app', '12.4.15b4');
		used('12.4.2', 60 * 60 * 24 * 30);
		used('12.4.15b4', 60);

		expect(find()).toMatchObject({ app: beta, version: '12.4.15b4', why: 'last used' });
	});

	it('follows the preferences, not the name, when the Suite is the one in use', () => {
		const suite = app('Ableton Live 12 Suite.app', '12.4.2');
		app('Ableton Live 12 Beta.app', '12.4.15b4');
		used('12.4.15b4', 60 * 60 * 24 * 30);
		used('12.4.2', 60);

		expect(find()).toMatchObject({ app: suite, why: 'last used' });
	});

	it('takes the highest version when no preferences folder matches an app', () => {
		app('Ableton Live 12 Suite.app', '12.4.2');
		const newer = app('Ableton Live 12 Standard.app', '12.4.10');

		expect(find()).toMatchObject({ app: newer, why: 'newest installed' });
	});

	it('takes a configured app only when it is on this Mac', () => {
		const suite = app('Ableton Live 12 Suite.app', '12.4.2');
		const beta = app('Ableton Live 12 Beta.app', '12.4.15b4');
		used('12.4.15b4', 60);

		expect(find(suite)).toMatchObject({ app: suite, why: 'configured' });
		expect(find(join(apps, 'Ableton Live 12 Gone.app'))).toMatchObject({ app: beta, why: 'last used' });
	});

	it('finds nothing on a Mac without Live', () => {
		expect(find()).toBeNull();
	});
});
