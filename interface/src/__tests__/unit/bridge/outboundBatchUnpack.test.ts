/**
 * Bridge-side unpacking of the UI→Surf `/bridge/batch` envelope.
 *
 * Targets `interface/bridge/transport/WebSocketServer.js`. Everything
 * here drives the real dispatch path — `handleMessage` parses, routes
 * through the real `ADDRESS_HANDLERS` table and the real
 * `routeMessageToUDP`, and lands on a fake UDP port whose `send` we
 * can observe. Nothing is stubbed between the frame and the port, so a
 * regression in routing shows up here rather than being mocked away.
 *
 * The isolation test is the important one: ableton-js #142 shipped
 * this batching with a shared try/catch and had to go back and fix it,
 * because one bad item silently discarded the rest of the frame.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const nodeRequire = createRequire(import.meta.url);

interface SentMessage {
	address: string;
	args: unknown[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any;

/** A context whose `pythonSurface` port records what reaches it. */
function makeContext(opts: { throwOn?: string } = {}) {
	const sent: SentMessage[] = [];
	const port = {
		send(message: SentMessage) {
			if (opts.throwOn && message.address === opts.throwOn) {
				throw new Error(`UDP send failed for ${message.address}`);
			}
			sent.push(message);
		}
	};
	return {
		sent,
		context: {
			clientId: 'test-client',
			// Every backend target points at the same recording port so a
			// misrouted message still shows up rather than vanishing.
			udpPorts: new Proxy({}, { get: () => port }),
			metrics: { routingErrors: 0, messagesRouted: 0 },
			captureOverride: null,
			totalmixLink: null,
			relayTotalMixLevel: null
		}
	};
}

function frame(messages: Array<{ address: string; args: unknown[] }>) {
	return Buffer.from(
		JSON.stringify({ address: '/bridge/batch', source: 'ui', messages })
	);
}

describe('bridge unpacks the UI→Surf batch envelope', () => {
	beforeEach(() => {
		server = nodeRequire('../../../../bridge/transport/WebSocketServer.js');
	});

	it('routes every inner message, in order', () => {
		const { sent, context } = makeContext();
		server.__testing.handleMessage(
			null,
			frame([
				{ address: '/looping/v3/track/color', args: ['tracks/0', 9] },
				{ address: '/looping/v3/clip/set/color', args: ['tracks/0/slots/0/clip', 9] },
				{ address: '/looping/v3/clip/set/color', args: ['tracks/0/slots/1/clip', 9] }
			]),
			context
		);

		expect(sent.map((m) => m.address)).toEqual([
			'/looping/v3/track/color',
			'/looping/v3/clip/set/color',
			'/looping/v3/clip/set/color'
		]);
		expect(sent[1].args).toEqual(['tracks/0/slots/0/clip', 9]);
	});

	it('an unbatched message still routes exactly as before', () => {
		const { sent, context } = makeContext();
		server.__testing.handleMessage(
			null,
			Buffer.from(
				JSON.stringify({ address: '/looping/v3/track/mute', args: ['tracks/0', 1] })
			),
			context
		);
		expect(sent).toEqual([{ address: '/looping/v3/track/mute', args: ['tracks/0', 1] }]);
	});

	it('isolates a failing item so the rest of the batch still lands', () => {
		// The middle message's port send throws. Without per-item
		// isolation the loop aborts and `/third` never reaches the wire.
		const { sent, context } = makeContext({ throwOn: '/looping/v3/track/solo' });
		server.__testing.handleMessage(
			null,
			frame([
				{ address: '/looping/v3/track/mute', args: ['tracks/0', 1] },
				{ address: '/looping/v3/track/solo', args: ['tracks/0', 1] },
				{ address: '/looping/v3/track/arm', args: ['tracks/0', 1] }
			]),
			context
		);

		expect(sent.map((m) => m.address)).toEqual([
			'/looping/v3/track/mute',
			'/looping/v3/track/arm'
		]);
	});

	it('survives a batch whose every item fails', () => {
		const { sent, context } = makeContext({ throwOn: '/looping/v3/track/mute' });
		expect(() =>
			server.__testing.handleMessage(
				null,
				frame([
					{ address: '/looping/v3/track/mute', args: ['tracks/0', 1] },
					{ address: '/looping/v3/track/mute', args: ['tracks/1', 1] }
				]),
				context
			)
		).not.toThrow();
		expect(sent).toEqual([]);
	});

	it('refuses a nested envelope rather than recursing', () => {
		const { sent, context } = makeContext();
		server.__testing.handleMessage(
			null,
			frame([
				{ address: '/bridge/batch', args: [] },
				{ address: '/looping/v3/track/mute', args: ['tracks/0', 1] }
			]),
			context
		);
		// The nested envelope is dropped; the sibling still routes.
		expect(sent.map((m) => m.address)).toEqual(['/looping/v3/track/mute']);
	});

	it('tolerates a batch with no messages array', () => {
		const { sent, context } = makeContext();
		expect(() =>
			server.__testing.handleMessage(
				null,
				Buffer.from(JSON.stringify({ address: '/bridge/batch', source: 'ui' })),
				context
			)
		).not.toThrow();
		expect(sent).toEqual([]);
	});

	it('skips non-object items without dropping their siblings', () => {
		const { sent, context } = makeContext();
		server.__testing.handleMessage(
			null,
			Buffer.from(
				JSON.stringify({
					address: '/bridge/batch',
					messages: [null, 'nonsense', { address: '/looping/v3/track/mute', args: ['tracks/0', 1] }]
				})
			),
			context
		);
		expect(sent.map((m) => m.address)).toEqual(['/looping/v3/track/mute']);
	});

	it('an empty batch is a no-op', () => {
		const { sent, context } = makeContext();
		server.__testing.handleMessage(null, frame([]), context);
		expect(sent).toEqual([]);
	});
});
