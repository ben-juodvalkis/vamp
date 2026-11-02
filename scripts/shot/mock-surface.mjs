/**
 * Mock surface — a standalone WebSocket server that speaks enough of the
 * v3 wire protocol to make the interface paint a populated performance
 * surface with nothing else running.
 *
 * It stands in for the whole downstream stack:
 *
 *     browser  ─WS:8081─▶  mock-surface.mjs
 *     (real)                (replaces bridge + Python surface + Live)
 *
 * The page's :8081 is compiled in, so when a real bridge already holds that
 * port the server moves to a free one and the arrow becomes a Playwright
 * interception: `routePage` (below) catches the page's socket and hands it
 * here, and never opens one to :8081 at all. That is what makes a screenshot
 * safe to take mid-session — see the README's "Shooting while the rig is
 * running".
 *
 * What it implements, per docs/reference/wire-protocol.md:
 *
 * - §5 handshake: `hello` → `accept` → `state/full` bundle.
 * - §2.2 state/full: one `state/full/tree` message carrying the whole
 *   record stream behind its four-arg header.
 * - §2.4 resync: replays the same bundle on request.
 * - The bridge's own liveness beats (`/bridge/ping`,
 *   `/looping/v3/bridge/heartbeat`), so the client watchdog doesn't
 *   force-close the socket after 12s and the stall detector stays quiet.
 * - The bridge's on-connect status: `/bridge/server_mode`, and from the
 *   scene `/bridge/ax_helper` and `/bridge/features` (the feature switches,
 *   general-release audit §7b — the rig's when the scene names none).
 * - `/looping/v3/param/set` → `/looping/v3/param/value` echo, so knobs
 *   dragged in a `--interactive` session hold their position.
 * - §2.6 device properties: `property/subscribe` is answered with the
 *   scene's value for that property — per device first
 *   (`scene.deviceProperties[devicePath][name]`, which is how two fixture
 *   kits can carry two different `vm.members` censuses), then by name
 *   alone (`scene.properties[name]`, then `PROPERTY_DEFAULTS`) — and
 *   `property/set` is echoed back as `property/value`, so a
 *   property-driven view paints and holds. A per-device `null` is an
 *   answer (the surface's `nil` for a function the kit has no member
 *   for), not a miss.
 * - `track/select` is answered with `selected_track`, the way the surface
 *   echoes Live's selection — so a shot can `--click` a strip and land on
 *   that track's instrument view.
 * - Drum pad chains (issue #491, 3.8.0): `vm.padFx` is answered from the
 *   scene's `padRacks` table, a `vm.padChain.<note>` subscribe with the
 *   pad's presence entry AND a pad-scoped `state/full/tree` (reason
 *   `pad-chain`), and a pad-targeted `device/load` appends the preset's
 *   device to that pad's chain, advances the generation and re-emits
 *   presence and the bundle — the surface's narrower structural
 *   composite, minus the 150 ms it waits for Live.
 *
 * What it does NOT implement: anything else that would need Live. Writes
 * it doesn't recognise are logged and dropped, which is the honest
 * failure mode — the UI applies them optimistically (ADR-358) and simply
 * never hears a confirmation.
 *
 * Usage:
 *   node scripts/shot/mock-surface.mjs [--port 8081] [--scene <path|default>]
 *
 * Normally driven by `scripts/shot/shot.mjs`; run it standalone when you
 * want to poke at the UI in a browser without the bridge.
 *
 * The protocol itself is `mock-engine.mjs`, shared with the browser demo
 * (`interface/src/lib/demo`). This file is its WebSocket server and the
 * Playwright routing that points a page at it.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDefaultScene } from './scene.mjs';
import { createMockEngine } from './mock-engine.mjs';
import { CLIENT_WS_PORT, CLIENT_WS_PATH } from './stack.mjs';

/** Load a scene by name (`default`) or by path to a captured JSON. */
export async function loadScene(ref = 'default') {
	if (!ref || ref === 'default') return buildDefaultScene();
	const raw = await readFile(ref, 'utf8');
	const scene = JSON.parse(raw);
	if (!Array.isArray(scene.treeArgs)) {
		throw new Error(`Scene ${ref} has no treeArgs array`);
	}
	return scene;
}

/**
 * Start the mock surface. Resolves once the server is listening.
 * Returns a handle with `close()` and the resolved port.
 *
 * `onInbound(address, args)` is called for every message the UI sends,
 * already unwrapped from any `/bridge/batch` envelope and before the
 * dispatch below sees it. That is what makes the surface a recorder as
 * well as a stand-in: `multitouch.mjs` replays concurrent pointer streams
 * against the real interface and asserts on exactly this stream, which is
 * the only place the whole question — "did two fingers produce two
 * writes?" — is actually answerable without Live.
 */
export async function startMockSurface({
	port = 8081,
	scene,
	log = () => {},
	onInbound = null
} = {}) {
	const resolved = scene ?? buildDefaultScene();
	const engine = createMockEngine({ scene: resolved, log, onInbound });

	const wss = new WebSocketServer({ port, host: '127.0.0.1' });

	/**
	 * Point a Playwright context's :8081 socket at THIS mock, wherever it
	 * happens to be listening.
	 *
	 * The page's port is compiled in (`CLIENT_WS_PORT`), so when a real
	 * bridge holds it the mock has to move — and the page has to be lied to
	 * about where it went, or it talks to the bridge and photographs the live
	 * set. The client dials its own origin at `CLIENT_WS_PATH`
	 * (`WebSocketConnection.ts`), which the dev server would pass through to
	 * the real bridge, so the pattern takes that path as well as the port; the
	 * interception is what makes the run safe rather than merely lucky:
	 * `route.connectToServer()` is never called, so there is no socket to the
	 * real port at all. Nothing the page does — a watchdog force-close, a
	 * stall, the reconnect backoff — can reach the bridge.
	 *
	 * A method on the mock rather than a free function so the port and the
	 * route cannot disagree: moving the mock and routing the page are one
	 * decision (see `resolveMockPort`).
	 */
	const routePage = async (context) => {
		// The page dials its own origin at `osc.webSocket.path`, which the dev
		// server would pass through to a real bridge; the port is kept for
		// any client that still dials it directly.
		await context.routeWebSocket(new RegExp(`:${CLIENT_WS_PORT}|${CLIENT_WS_PATH}`), (route) => {
			const upstream = new WebSocket(`ws://127.0.0.1:${port}`);
			const queued = [];
			upstream.on('open', () => {
				for (const m of queued.splice(0)) upstream.send(m);
			});
			upstream.on('message', (data, isBinary) => {
				try {
					route.send(isBinary ? data : data.toString());
				} catch {
					/* the page's socket closed first */
				}
			});
			upstream.on('close', () => route.close().catch(() => {}));
			upstream.on('error', () => {});
			route.onMessage((m) =>
				upstream.readyState === WebSocket.OPEN ? upstream.send(m) : queued.push(m)
			);
			route.onClose(() => upstream.close());
		});
	};

	wss.on('connection', (ws) => {
		const client = engine.connect(ws);
		ws.on('message', (raw) => client.receive(raw));
		ws.on('close', () => client.close());
	});

	await new Promise((resolve, reject) => {
		wss.once('listening', resolve);
		wss.once('error', reject);
	});
	log(`listening on ws://127.0.0.1:${port}`);

	return {
		port,
		/**
		 * How many clients have EVER connected. A capture harness checks this
		 * after the page settles: zero means the picture is not of this mock,
		 * which is the only cheap way to catch the page having found some
		 * other answer on :8081 — the live Ableton set, which photographs as
		 * a perfectly plausible screenshot. See `routePage`.
		 */
		clientCount: engine.clientCount,
		routePage,
		close: () =>
			new Promise((resolve) => {
				engine.stop();
				for (const client of wss.clients) client.terminate();
				wss.close(resolve);
			})
	};
}

// ---- CLI ---------------------------------------------------------------

const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => {
		const i = argv.indexOf(`--${name}`);
		return i === -1 ? fallback : argv[i + 1];
	};
	const port = Number(flag('port', 8081));
	const scene = await loadScene(flag('scene', 'default'));
	await startMockSurface({ port, scene, log: (m) => console.log(`[mock-surface] ${m}`) });
	console.log(`[mock-surface] scene "${scene.name ?? 'unnamed'}" ready — Ctrl-C to stop`);
}
