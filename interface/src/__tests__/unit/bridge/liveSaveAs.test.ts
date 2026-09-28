/**
 * Unit tests for the bridge Save-As automation.
 *
 * Targets `interface/bridge/handlers/liveSaveAs.js`. Imports follow the same
 * relative-path + CJS-interop pattern as `broadcastBatcher.test.ts`.
 *
 * Coverage:
 * - `formatFilename` — zero-padding, NaN/undefined tempo & meter fall back to
 *   0 (never "NaN"), fractional tempo rounds to a whole number
 * - `nextCounter` — increments across calls, persists, recovers from a
 *   missing/corrupt counter file (restart at 1), honors the filePath override
 * - `todayISO` — zero-padded YYYY-MM-DD for a fixed date
 * - `saveAsCurrentSet` — asks the AX helper (ADR-439) for the panel with the
 *   formatted name; the in-flight guard (an overlapping call is rejected with
 *   `save-as-in-flight` and does not reach the helper); the slot frees once the
 *   helper answers (success or failure); a helper that is absent or not ready
 *   is a named error and costs no counter value
 *
 * `saveAsCurrentSet` takes the AX helper client and a counter-file override,
 * so nothing here touches the rig's real `logs/save-as-counter.json`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import * as liveSaveAs from '../../../../bridge/handlers/liveSaveAs.js';

type Helper = {
	state?: { state: string; detail: string };
	connected?: boolean;
	request: (verb: string, args: { name: string }) => Promise<unknown>;
};

const { formatFilename, nextCounter, todayISO, saveAsCurrentSet } = liveSaveAs as {
	formatFilename: (p: {
		counter: number;
		tempo?: unknown;
		sigNum?: unknown;
		sigDen?: unknown;
		date?: string;
	}) => string;
	nextCounter: (filePath?: string) => number;
	todayISO: (now?: Date) => string;
	saveAsCurrentSet: (
		p?: { tempo?: number; sigNum?: number; sigDen?: number },
		axHelper?: Helper,
		options?: { counterFile?: string; panelPoll?: { pollMs?: number; maxMs?: number } }
	) => Promise<string>;
};

let dir: string;
let counterFile: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saveas-'));
	counterFile = path.join(dir, 'save-as-counter.json');
});

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

const readyHelper = (request: Helper['request']) => ({
	state: { state: 'ready', detail: '' },
	connected: true,
	// Verb-aware, as the real helper is. `panel_state` answers "no panel" by
	// default: `save_as_dialog` succeeds by leaving Live's panel up, so the
	// bridge holds `saveAsInFlight` until this says it is gone (H3), and a fake
	// that answered every verb the same way would hold it forever.
	request: vi.fn((verb: string, args: { name: string }) =>
		verb === 'panel_state' ? Promise.resolve({ open: false }) : request(verb, args)
	)
});

// --- formatFilename -------------------------------------------------------

describe('formatFilename', () => {
	it('builds NNN_YYYY-MM-DD_<tempo>bpm_<num>-<den> with zero-padded counter', () => {
		expect(
			formatFilename({ counter: 1, tempo: 120, sigNum: 4, sigDen: 4, date: '2026-07-06' })
		).toBe('001_2026-07-06_120bpm_4-4');
		expect(
			formatFilename({ counter: 42, tempo: 90, sigNum: 7, sigDen: 8, date: '2026-01-02' })
		).toBe('042_2026-01-02_90bpm_7-8');
	});

	it('rounds a fractional tempo to a whole number', () => {
		expect(
			formatFilename({ counter: 1, tempo: 91.6, sigNum: 4, sigDen: 4, date: '2026-07-06' })
		).toBe('001_2026-07-06_92bpm_4-4');
	});

	it('falls back to 0 for missing/NaN tempo or meter (never "NaN")', () => {
		const name = formatFilename({
			counter: 1,
			tempo: undefined,
			sigNum: NaN,
			sigDen: 'x' as unknown,
			date: '2026-07-06'
		});
		expect(name).toBe('001_2026-07-06_0bpm_0-0');
		expect(name).not.toContain('NaN');
	});
});

// --- nextCounter ----------------------------------------------------------

describe('nextCounter', () => {
	it('starts at 1 when the file is missing and persists the value', () => {
		expect(nextCounter(counterFile)).toBe(1);
		expect(JSON.parse(fs.readFileSync(counterFile, 'utf8')).counter).toBe(1);
	});

	it('increments across calls', () => {
		expect(nextCounter(counterFile)).toBe(1);
		expect(nextCounter(counterFile)).toBe(2);
		expect(nextCounter(counterFile)).toBe(3);
	});

	it('restarts at 1 when the file is corrupt', () => {
		fs.writeFileSync(counterFile, 'not json{', 'utf8');
		expect(nextCounter(counterFile)).toBe(1);
	});

	it('restarts at 1 when the JSON lacks a finite counter', () => {
		fs.writeFileSync(counterFile, JSON.stringify({ counter: 'nope' }), 'utf8');
		expect(nextCounter(counterFile)).toBe(1);
	});

	it('creates the parent directory if missing', () => {
		const nested = path.join(dir, 'deep', 'save-as-counter.json');
		expect(nextCounter(nested)).toBe(1);
		expect(fs.existsSync(nested)).toBe(true);
	});
});

// --- todayISO -------------------------------------------------------------

describe('todayISO', () => {
	it('zero-pads month and day', () => {
		expect(todayISO(new Date(2026, 0, 2))).toBe('2026-01-02');
		expect(todayISO(new Date(2026, 11, 25))).toBe('2026-12-25');
	});
});

// --- saveAsCurrentSet -------------------------------------------------------

describe('saveAsCurrentSet', () => {
	it('asks the AX helper for the Save As panel with the formatted name', async () => {
		const helper = readyHelper(async () => ({ panelMs: 120, helperMs: 400 }));
		const name = await saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, helper, { counterFile });
		expect(name).toMatch(/^001_\d{4}-\d{2}-\d{2}_120bpm_4-4$/);
		expect(helper.request).toHaveBeenCalledWith('save_as_dialog', { name });
	});

	/**
	 * Swap audit H3, the bridge's half. `save_as_dialog` succeeds by leaving
	 * Live's panel up for the performer, so the reply is not the end of the run
	 * — releasing the guard there dropped it while a modal panel was still over
	 * the set, and the next transport stop consumed a counter value and pressed
	 * Save Live Set As again behind it.
	 */
	it('holds the in-flight guard until the helper says the panel has closed', async () => {
		let open = true;
		const helper = {
			state: { state: 'ready', detail: '' },
			connected: true,
			request: vi.fn((verb: string) =>
				verb === 'panel_state' ? Promise.resolve({ open }) : Promise.resolve({ panelMs: 1 })
			)
		};
		const run = saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, helper, {
			counterFile,
			panelPoll: { pollMs: 1, maxMs: 2000 }
		});
		// While the panel is up the slot is still claimed.
		await new Promise((resolve) => setTimeout(resolve, 20));
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, helper, { counterFile })
		).rejects.toMatchObject({ code: 'save-as-in-flight' });

		open = false;
		await run;
		// And released once it is gone.
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, helper, {
				counterFile,
				panelPoll: { pollMs: 1, maxMs: 2000 }
			})
		).resolves.toMatch(/^002_/);
	});

	it('releases the guard when the helper cannot answer panel_state', async () => {
		// An older helper answers `ax-unknown-verb`. A guard held forever would
		// silence Save As for the rest of the session.
		const helper = {
			state: { state: 'ready', detail: '' },
			connected: true,
			request: vi.fn((verb: string) =>
				verb === 'panel_state'
					? Promise.reject(Object.assign(new Error('nope'), { code: 'ax-unknown-verb' }))
					: Promise.resolve({ panelMs: 1 })
			)
		};
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, helper, { counterFile })
		).resolves.toMatch(/^001_/);
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, helper, { counterFile })
		).resolves.toMatch(/^002_/);
	});

	it('rejects an overlapping call with save-as-in-flight without reaching the helper', async () => {
		let finishFirst: (() => void) | undefined;
		const helper = readyHelper(
			() => new Promise((resolve) => (finishFirst = () => resolve({ panelMs: 1 })))
		);
		const first = saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, helper, { counterFile });
		await Promise.resolve();

		const overlap = readyHelper(async () => ({}));
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, overlap, { counterFile })
		).rejects.toMatchObject({ code: 'save-as-in-flight' });
		expect(overlap.request).not.toHaveBeenCalled();
		expect(helper.request).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fs.readFileSync(counterFile, 'utf8')).counter).toBe(1);

		finishFirst!();
		await expect(first).resolves.toMatch(/_120bpm_4-4$/);
	});

	it('frees the slot after the helper fails, passing its named error on', async () => {
		const failing = readyHelper(async () => {
			throw Object.assign(new Error('ax-wait-timeout: no panel'), { code: 'ax-wait-timeout' });
		});
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, failing, { counterFile })
		).rejects.toMatchObject({ code: 'ax-wait-timeout' });

		const ok = readyHelper(async () => ({}));
		await expect(
			saveAsCurrentSet({ tempo: 100, sigNum: 3, sigDen: 4 }, ok, { counterFile })
		).resolves.toMatch(/^002_.*_100bpm_3-4$/);
	});

	it('is a named error, costing no counter value, when the helper is not ready', async () => {
		const untrusted = {
			state: { state: 'ax-untrusted', detail: 'switch on "Looping AX Helper"' },
			connected: true,
			request: vi.fn(async () => ({}))
		};
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, untrusted, { counterFile })
		).rejects.toMatchObject({ code: 'ax-untrusted' });
		expect(untrusted.request).not.toHaveBeenCalled();
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, undefined, { counterFile })
		).rejects.toMatchObject({ code: 'ax-helper-down' });
		expect(fs.existsSync(counterFile)).toBe(false);
	});

	/*
	 * The client publishes `ready` for `downGraceMs` (1.5 s) after the socket
	 * drops — a helper re-executing itself on a granted trust must not paint
	 * `ax-helper-down` on every client. `state` alone therefore says ready
	 * while nothing can be pressed, and this path spends a counter value
	 * BEFORE the verb runs: the number is gone and no dialog opened.
	 */
	it('refuses inside the down grace window, where state still reads ready', async () => {
		const blinking = {
			state: { state: 'ready', detail: '' },
			connected: false,
			request: vi.fn(async () => ({}))
		};
		await expect(
			saveAsCurrentSet({ tempo: 120, sigNum: 4, sigDen: 4 }, blinking, { counterFile })
		).rejects.toMatchObject({ code: 'ax-helper-down' });
		expect(blinking.request).not.toHaveBeenCalled();
		expect(fs.existsSync(counterFile)).toBe(false);
	});
});
