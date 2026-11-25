/**
 * One request/reply round trip over the OSC bus, and the one request-id
 * generator.
 *
 * Every request the UI correlates by id has the same shape: send
 * `[requestId, ...args]`, listen on the bus (`oscMessageBus`) for a reply
 * address whose first arg is that id, settle once, remove the listener and
 * the timer. Six services each wrote that out by hand (track prepare,
 * duplicate, group, kit transpose, pad swap, clip file swap), with small
 * differences in how they matched the id and cleaned up; `oscRequest` is
 * that loop once.
 *
 * The pull services that keep their own pending table keyed by id
 * (`clipNotesService`, `clipSampleService`, `clipRichNotesService`, whose
 * replies reach them through their handlers rather than the bus) share
 * only `nextRequestId` (`requestId.ts`, import-free so they need not pull
 * in the client).
 */

import { send as clientSend } from '$lib/api/simpleClient';
import { addOscMessageListener, removeOscMessageListener, type OscBusMessage } from './oscMessageBus';

export { nextRequestId } from './requestId';
import { nextRequestId } from './requestId';

/** What a reply means: settle with a value or an error, or not ours after all (`null`). */
export type OscReplyOutcome<T> = { value: T } | { error: Error } | null;

export interface OscRequestOptions<T> {
	/** The address the request goes out on. */
	address: string;
	/** The arguments after the request id. */
	args: unknown[];
	/** The addresses a reply may arrive on. */
	replies: readonly string[];
	/** How long to wait for a reply. */
	timeoutMs: number;
	/** Read a reply (its full args, the id first). */
	onReply: (address: string, args: unknown[]) => OscReplyOutcome<T>;
	/** What a timeout settles with (default: an Error naming the address). */
	onTimeout?: () => { value: T } | { error: Error };
	/** Use this id rather than minting one (the caller logged it already). */
	requestId?: string;
	/** Id prefix when minting one. */
	idPrefix?: string;
	/** The sender (default `simpleClient.send`); stores inject one in tests. */
	send?: (address: string, args: unknown[]) => void;
}

/**
 * Send a request and settle on the first reply carrying its id, or on the
 * timeout. The listener and the timer are removed on settle, whichever
 * comes first.
 */
export function oscRequest<T>(options: OscRequestOptions<T>): Promise<T> {
	const id = options.requestId ?? nextRequestId(options.idPrefix);
	const replies = new Set(options.replies);
	const sender = options.send ?? ((address: string, args: unknown[]) => clientSend(address, args as never));
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = (outcome: { value: T } | { error: Error }) => {
			if (settled) return;
			settled = true;
			removeOscMessageListener(listener);
			clearTimeout(timer);
			if ('error' in outcome) reject(outcome.error);
			else resolve(outcome.value);
		};
		const listener = (message: OscBusMessage) => {
			if (!message?.address || !message.args || !replies.has(message.address)) return;
			if (String(message.args[0]) !== id) return;
			const outcome = options.onReply(message.address, message.args);
			if (outcome) settle(outcome);
		};
		addOscMessageListener(listener);
		// The timer before the send, so a reply delivered synchronously
		// (a test's sender) still finds it to clear.
		timer = setTimeout(() => {
			settle(
				options.onTimeout?.() ?? {
					error: new Error(`${options.address} timeout (${options.timeoutMs}ms)`)
				}
			);
		}, options.timeoutMs);
		sender(options.address, [id, ...options.args]);
	});
}
