// @vitest-environment node
/**
 * `/api/sample-peaks` and `/api/similar-samples` refuse a path outside the
 * sample roots (general-release audit §5.3), through the real handlers.
 *
 * Both routes are on the interface server, which listens on 0.0.0.0 for the
 * iPad and sits outside the WebSocket's HMAC gate. `sample-peaks` used to open
 * and decode any absolute path a LAN host named; these pin the refusal, and
 * that everything the rig legitimately asks for — a library file, a library
 * symlink pointing anywhere, a recording inside a Live project — still gets
 * its peaks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE_PROJECT_MARKER, _pinSampleRootsForTests } from '$lib/server/sampleRoots';
import { GET as peaksGET } from '../../../routes/api/sample-peaks/+server';
import { GET as similarGET } from '../../../routes/api/similar-samples/+server';
import { buildWav } from './sample-peaks/fixtures';

// No test here should reach Live's real index: "no database" is proof enough
// that a request got past the gate.
vi.mock('../../../routes/api/similar-samples/similarSamples', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../routes/api/similar-samples/similarSamples')>()),
	newestLiveDatabase: () => null
}));

type Answer = { status: number; body: unknown };

async function call(handler: typeof peaksGET, url: string): Promise<Answer> {
	try {
		const res = await handler({ url: new URL(url) } as unknown as Parameters<typeof peaksGET>[0]);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, body: e.body };
		throw e;
	}
}

const peaks = (p: string) =>
	call(peaksGET, `http://rig.local/api/sample-peaks?path=${encodeURIComponent(p)}&bins=64`);
const similar = (p: string) =>
	call(similarGET, `http://rig.local/api/similar-samples?path=${encodeURIComponent(p)}`);

function wav(file: string): string {
	const buf = buildWav({
		sampleRate: 44100,
		channels: 1,
		bitsPerSample: 16,
		sampleFormat: 'int',
		frames: 4410,
		gen: (f) => Math.round(Math.sin(f / 7) * 12000)
	});
	writeFileSync(file, buf);
	return file;
}

let scratch: string;
let library: string;
let outside: string;

beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'sample-gate-'));
	library = join(scratch, 'User Library');
	outside = join(scratch, 'Outside');
	mkdirSync(library);
	mkdirSync(join(outside, 'deep'), { recursive: true });
	_pinSampleRootsForTests([library]);
});

afterEach(() => {
	_pinSampleRootsForTests(null);
	rmSync(scratch, { recursive: true, force: true });
});

describe('/api/sample-peaks', () => {
	it('refuses a path outside every root with 403, before touching it', async () => {
		expect((await peaks('/etc/passwd')).status).toBe(403);
		const secret = wav(join(outside, 'secret.wav'));
		expect((await peaks(secret)).status).toBe(403);
		// A path that does not exist is refused the same way: no existence oracle.
		expect((await peaks(join(outside, 'no-such.wav'))).status).toBe(403);
	});

	it('refuses a file that is not a sample, even inside the library or a project', async () => {
		writeFileSync(join(library, 'notes.txt'), 'not audio');
		expect((await peaks(join(library, 'notes.txt'))).status).toBe(403);
		const project = join(scratch, 'Looping');
		mkdirSync(join(project, LIVE_PROJECT_MARKER), { recursive: true });
		mkdirSync(join(project, 'config'));
		writeFileSync(join(project, 'config', '.ws-secret'), 'deadbeef');
		expect((await peaks(join(project, 'config', '.ws-secret'))).status).toBe(403);
	});

	it('refuses a `..` that climbs out of a root, and a relative path', async () => {
		wav(join(outside, 'secret.wav'));
		expect((await peaks(`${library}/../Outside/secret.wav`)).status).toBe(403);
		expect((await peaks('Outside/secret.wav')).status).toBe(403);
	});

	it('answers for a library file, as before', async () => {
		const kick = wav(join(library, 'kick.wav'));
		const answer = await peaks(kick);
		expect(answer.status).toBe(200);
		const body = answer.body as { path: string; peaks: unknown[] };
		expect(body.path).toBe(realpathSync(kick));
		expect(body.peaks.length).toBe(64);
	});

	it('follows a library symlink wherever it points (Audio Samples is mostly symlinks)', async () => {
		const target = wav(join(outside, 'voice.wav'));
		symlinkSync(target, join(library, 'voice.wav'));
		const answer = await peaks(join(library, 'voice.wav'));
		expect(answer.status).toBe(200);
		expect((answer.body as { path: string }).path).toBe(realpathSync(target));
	});

	it('answers for a recording inside a Live project that is under no root', async () => {
		const project = join(scratch, 'Raw Class Sessions', 'mele 9-17-26 Project');
		mkdirSync(join(project, LIVE_PROJECT_MARKER), { recursive: true });
		mkdirSync(join(project, 'Samples', 'Recorded'), { recursive: true });
		const take = wav(join(project, 'Samples', 'Recorded', '1-Audio 0001.wav'));
		const capture = wav(join(project, 'LOOPING_CAPTURE_20260923_110436.wav'));
		expect((await peaks(take)).status).toBe(200);
		expect((await peaks(capture)).status).toBe(200);
	});

	/*
	 * `<library>/link/../escaped.wav` is `<library>/escaped.wav` as written, so
	 * it passes the check — but resolved physically it is
	 * `<link target>/../escaped.wav`, outside the library. The route must open
	 * the string it checked: here that file does not exist, so 404, not the
	 * outside file's peaks.
	 */
	it('opens the path it checked, not the raw one a symlink would lead out through', async () => {
		wav(join(outside, 'escaped.wav'));
		symlinkSync(join(outside, 'deep'), join(library, 'link'));
		const answer = await peaks(`${library}/link/../escaped.wav`);
		expect(answer.status).toBe(404);
	});
});

describe('/api/similar-samples', () => {
	it('refuses a path outside every root with its own JSON 403', async () => {
		const answer = await similar('/etc/hosts');
		expect(answer.status).toBe(403);
		expect(answer.body).toMatchObject({ ok: false, code: 'forbidden' });
		expect((await similar(`${library}/../Outside/secret.wav`)).status).toBe(403);
	});

	it('keeps its 400 for a relative path', async () => {
		const answer = await similar('Samples/kick.wav');
		expect(answer.status).toBe(400);
		expect(answer.body).toMatchObject({ ok: false, code: 'bad-request' });
	});

	it('lets a library path through to the index', async () => {
		const answer = await similar(join(library, 'kick.wav'));
		expect(answer.status).toBe(503);
		expect(answer.body).toMatchObject({ ok: false, code: 'no-database' });
	});
});
