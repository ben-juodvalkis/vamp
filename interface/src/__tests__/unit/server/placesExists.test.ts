/**
 * `POST /api/places/exists`: which preset files are on this Mac (ADR-498),
 * preset files only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from '../../../routes/api/places/exists/+server';

let dir = '';
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'places-exists-'));
	writeFileSync(join(dir, 'Here.adg'), '');
	writeFileSync(join(dir, 'notes.txt'), '');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const call = (body: unknown) =>
	(POST as unknown as (e: { request: Request }) => Promise<Response>)({
		request: new Request('http://x/api/places/exists', { method: 'POST', body: JSON.stringify(body) })
	});

describe('/api/places/exists', () => {
	it('answers which preset files are there, and nothing about other files', async () => {
		const here = join(dir, 'Here.adg');
		const gone = join(dir, 'Gone.amxd');
		const res = await call({ paths: [here, gone, join(dir, 'notes.txt'), 'relative.adg'] });
		expect(res.status).toBe(200);
		expect((await res.json()).exists).toEqual({ [here]: true, [gone]: false });
	});

	it('refuses a body that is not a short list of paths', async () => {
		expect((await call({ paths: 'x' })).status).toBe(400);
		expect((await call({ paths: Array(65).fill('/a.adv') })).status).toBe(400);
	});
});
