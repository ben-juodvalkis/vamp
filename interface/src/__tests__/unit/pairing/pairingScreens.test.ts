/**
 * The two pairing screens (ADR-491): the one an unpaired device sees, and
 * the Allow / Ignore banner a trusted screen answers with.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import PairingScreen from '$lib/components/v6/pairing/PairingScreen.svelte';
import PairingBanner from '$lib/components/v6/pairing/PairingBanner.svelte';
import { pairingStore } from '$lib/stores/pairing.svelte';

type Answer = { status?: number; body: unknown };
let routes: Record<string, (init?: RequestInit) => Answer>;
let calls: { url: string; body?: unknown }[];

beforeEach(() => {
	calls = [];
	pairingStore.required = false;
	pairingStore.requests = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = url.split('?')[0];
			calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			const answer = routes[`${init?.method ?? 'GET'} ${path}`]?.(init) ?? { status: 404, body: {} };
			return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
		})
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('the pairing screen', () => {
	it('stays away from a trusted device', async () => {
		routes = { 'GET /api/pair/state': () => ({ body: { pairing: true, trusted: true } }) };
		const { queryByRole } = render(PairingScreen);
		await waitFor(() => expect(calls.some((c) => c.url === '/api/pair/state')).toBe(true));
		expect(queryByRole('dialog')).toBeNull();
	});

	it('covers the interface for an unpaired device, asks, and sends the code', async () => {
		let polls = 0;
		routes = {
			'GET /api/pair/state': () => ({ body: { pairing: true, trusted: false } }),
			'POST /api/pair/request': () => ({ body: { id: 'req-1', expiresInMs: 120000 } }),
			'GET /api/pair/status': () => (polls++, { body: { state: 'waiting' } }),
			'POST /api/pair/code': () => ({ body: { state: 'wrong', triesLeft: 4 } })
		};
		const { findByRole, getByText, findByPlaceholderText, findByText } = render(PairingScreen);
		expect(await findByRole('dialog')).toBeTruthy();

		await fireEvent.click(getByText('Ask the Mac'));
		const input = (await findByPlaceholderText('000000')) as HTMLInputElement;
		expect(calls.find((c) => c.url === '/api/pair/request')?.body).toMatchObject({ name: expect.any(String) });

		await fireEvent.input(input, { target: { value: '111111' } });
		await fireEvent.click(getByText('Pair'));
		expect(await findByText('Not that code. 4 tries left.')).toBeTruthy();
		expect(calls.find((c) => c.url === '/api/pair/code')?.body).toEqual({ id: 'req-1', code: '111111' });
	});

	it('opens when the bridge login is refused', async () => {
		routes = { 'GET /api/pair/state': () => ({ body: { pairing: true, trusted: true } }) };
		const { findByRole } = render(PairingScreen);
		window.dispatchEvent(new CustomEvent('pairing-required'));
		expect(await findByRole('dialog')).toBeTruthy();
	});

	it('says how long to wait when asked too often', async () => {
		routes = {
			'GET /api/pair/state': () => ({ body: { pairing: true, trusted: false } }),
			'POST /api/pair/request': () => ({ status: 429, body: { ok: false, reason: 'rate-limited', retryInMs: 7000 } })
		};
		const { findByText, getByText } = render(PairingScreen);
		await findByText('Ask the Mac');
		await fireEvent.click(getByText('Ask the Mac'));
		expect(await findByText('Asked too often. Try again in 7 s.')).toBeTruthy();
	});
});

describe('the Allow banner', () => {
	it('shows a request from the bridge, and Allow sends the decision and closes it', async () => {
		routes = { 'POST /api/pair/decide': () => ({ body: { ok: true } }) };
		const { getByText, queryByText } = render(PairingBanner);
		pairingStore.onBridgeMessage(JSON.stringify({ type: 'request', id: 'r1', name: 'iPad Safari', address: '192.168.50.40' }));
		await waitFor(() => expect(getByText('iPad Safari')).toBeTruthy());

		await fireEvent.click(getByText('Allow'));
		await waitFor(() => expect(queryByText('iPad Safari')).toBeNull());
		expect(calls.find((c) => c.url === '/api/pair/decide')?.body).toEqual({ id: 'r1', allow: true });
	});

	it('closes when the request ends elsewhere', async () => {
		const { getByText, queryByText } = render(PairingBanner);
		pairingStore.onBridgeMessage(JSON.stringify({ type: 'request', id: 'r2', name: 'Phone', address: '' }));
		await waitFor(() => expect(getByText('Phone')).toBeTruthy());
		pairingStore.onBridgeMessage(JSON.stringify({ type: 'resolved', id: 'r2', outcome: 'approved' }));
		await waitFor(() => expect(queryByText('Phone')).toBeNull());
	});

	it('is not shown on a device that is itself waiting to pair', async () => {
		pairingStore.required = true;
		const { queryByText } = render(PairingBanner);
		pairingStore.onBridgeMessage(JSON.stringify({ type: 'request', id: 'r3', name: 'Other', address: '' }));
		await new Promise((r) => setTimeout(r, 0));
		expect(queryByText('Other')).toBeNull();
	});
});
