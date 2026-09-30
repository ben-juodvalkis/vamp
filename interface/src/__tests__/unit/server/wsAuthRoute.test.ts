// @vitest-environment node
/**
 * `/api/ws-auth` signs the bridge's salt and never hands out the secret.
 *
 * It used to answer a salt-less request with the raw secret, for pages
 * cached before the proof existed. Nothing asked for that any more, and it
 * gave the secret to anyone on the network who did (SECURITY.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { createHmac } from 'node:crypto';
import { GET } from '../../../routes/api/ws-auth/+server';

const SECRET = 'a-very-distinctive-test-secret';
let saved: string | undefined;

beforeEach(() => {
	saved = process.env.LOOPING_WS_SECRET;
	process.env.LOOPING_WS_SECRET = SECRET;
});
afterEach(() => {
	if (saved === undefined) delete process.env.LOOPING_WS_SECRET;
	else process.env.LOOPING_WS_SECRET = saved;
});

async function call(query: string): Promise<{ status: number; text: string }> {
	try {
		const res = await GET({ url: new URL(`http://rig.local/api/ws-auth${query}`) } as unknown as Parameters<
			typeof GET
		>[0]);
		return { status: res.status, text: await res.text() };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, text: JSON.stringify(e.body) };
		throw e;
	}
}

describe('/api/ws-auth', () => {
	it('answers a salt with its HMAC, not the secret', async () => {
		const salt = '0123456789abcdef0123456789abcdef';
		const { status, text } = await call(`?salt=${salt}`);
		expect(status).toBe(200);
		expect(JSON.parse(text)).toEqual({ proof: createHmac('sha256', SECRET).update(salt).digest('hex') });
		expect(text).not.toContain(SECRET);
	});

	it('refuses a request with no salt instead of returning the secret', async () => {
		const { status, text } = await call('');
		expect(status).toBe(400);
		expect(text).not.toContain(SECRET);
	});

	it('refuses a salt that is not the bridge’s hex', async () => {
		expect((await call('?salt=hello')).status).toBe(400);
		expect((await call('?salt=')).status).toBe(400);
		expect((await call('?salt=ABCDEF0123456789')).status).toBe(400);
	});
});
