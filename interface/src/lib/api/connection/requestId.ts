/**
 * The one request-id generator for correlated OSC requests. Import-free,
 * so a service can mint ids without importing the client.
 */

let seq = 0;

/**
 * A request id: `<prefix>-<uuid>`, or `<prefix>-<time>-<seq>-<random>` where
 * `crypto.randomUUID` is missing (jsdom). Unique across clients as well as
 * within one, because the surface's replay LRU is keyed by it.
 */
export function nextRequestId(prefix = 'req'): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	seq = (seq + 1) & 0x7fffffff;
	return `${prefix}-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}
