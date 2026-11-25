/**
 * The browser's side of the pairing routes (ADR-491, `routes/api/pair/*`),
 * one function per call, so the pairing screen and Settings → Connection
 * speak them the same way. Every call goes out uncached; network errors and
 * non-JSON answers reject, and the callers decide what that means.
 */

export interface PairState {
	pairing?: boolean;
	trusted?: boolean;
}

export interface PairRequestAnswer {
	/** HTTP status: 429 when asked too often. */
	status: number;
	/** This device is already trusted: reload into Vamp. */
	trusted?: boolean;
	/** The request to poll and send the code against. */
	id?: string;
	/** With a 429: how long until another ask is accepted. */
	retryInMs?: number;
}

export interface PairCodeAnswer {
	/** `approved`, `refused`, `expired`, `unknown`, or `wrong`. */
	state?: string;
	/** With `wrong`. */
	triesLeft?: number;
}

export type PairedDevice = { hash: string; name: string; address: string; lastUsed: number };

const NO_STORE: RequestInit = { cache: 'no-store' };

function postJson(url: string, body: unknown): Promise<Response> {
	return fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/** Whether the Mac requires pairing, and whether this device is trusted. */
export async function fetchPairState(): Promise<PairState> {
	return (await fetch('/api/pair/state', NO_STORE)).json();
}

/** Ask the Mac to pair this device under `name`. */
export async function requestPairing(name: string): Promise<PairRequestAnswer> {
	const res = await postJson('/api/pair/request', { name });
	const body = (await res.json()) ?? {};
	return { ...body, status: res.status };
}

/** The request's state: `pending`, `approved`, `refused`, `expired`, `unknown`. */
export async function fetchPairStatus(requestId: string): Promise<string> {
	const res = await fetch(`/api/pair/status?id=${encodeURIComponent(requestId)}`, NO_STORE);
	return (await res.json())?.state ?? '';
}

/** Send the 6-digit code shown on the Mac. */
export async function sendPairCode(requestId: string, code: string): Promise<PairCodeAnswer> {
	return ((await (await postJson('/api/pair/code', { id: requestId, code })).json()) ?? {}) as PairCodeAnswer;
}

/** The devices paired with this Mac. Rejects on a non-OK answer. */
export async function fetchPairedDevices(): Promise<PairedDevice[]> {
	const res = await fetch('/api/pair/devices', NO_STORE);
	if (!res.ok) throw new Error(String(res.status));
	return (await res.json()).devices ?? [];
}

/** Forget a paired device (`hash=…`, or `all=1`). Never rejects. */
export async function forgetPairedDevice(query: string): Promise<void> {
	await fetch(`/api/pair/devices?${query}`, { method: 'DELETE' }).catch(() => {});
}
