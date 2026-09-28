/**
 * `GET /api/places/events` — server-sent events: one `version` event now and
 * one on every change a client should refetch for (a tick, a Place added in
 * Live, the index rewritten, thumbnails baked). The iPad keeps what it has
 * until it hears this, then refetches only what changed (onboarding.plan.md
 * §9). A 20 s comment keeps the connection alive through proxies.
 */
import type { RequestHandler } from '@sveltejs/kit';
import { placesService } from '$lib/server/places/service';

export const GET: RequestHandler = () => {
	const service = placesService();
	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;
	let keepAlive: ReturnType<typeof setInterval> | null = null;
	const stream = new ReadableStream({
		start(controller) {
			const send = (version: number) => {
				try {
					controller.enqueue(encoder.encode(`event: version\ndata: ${version}\n\n`));
				} catch {
					/* closed */
				}
			};
			send(service.currentVersion);
			unsubscribe = service.subscribe(send);
			keepAlive = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': keep-alive\n\n'));
				} catch {
					/* closed */
				}
			}, 20000);
			(keepAlive as { unref?: () => void }).unref?.();
		},
		cancel() {
			unsubscribe?.();
			if (keepAlive) clearInterval(keepAlive);
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }
	});
};
