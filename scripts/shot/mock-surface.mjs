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
 */

import { WebSocketServer, WebSocket } from 'ws';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildDefaultScene,
	DEFAULT_FEATURES,
	PROPERTY_DEFAULTS,
	HYBRID_IR_LISTS,
	SCENE_ETAG,
	PROTOCOL_VERSION,
	vmPadFx,
	padChainEntry,
	padChainRecords,
	appendPadDevice,
	deviceClassName
} from './scene.mjs';
import { CLIENT_WS_PORT } from './stack.mjs';

const PING_INTERVAL_MS = 5_000;
const SURFACE_HEARTBEAT_MS = 1_000;

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
	const version = resolved.version ?? PROTOCOL_VERSION;
	// `let`: a pad load is a structural change and advances it, exactly as
	// the surface's composite does.
	let generation = resolved.generation ?? 1;
	// Every Drum Rack's pads and chains (issue #491), by rack path. Mutated
	// by a pad load, so a later subscribe sees the grown chain.
	const padRacks = resolved.padRacks ?? {};
	// `/bridge/ax_helper [state, detail]` — the bridge's, not the surface's.
	const axHelper = {
		state: resolved.axHelper?.state ?? 'ready',
		detail: resolved.axHelper?.detail ?? ''
	};
	// `/bridge/features [json]` — the bridge's switches, also not the
	// surface's. A scene captured before they existed names none and gets the
	// rig's, so it draws what it always drew.
	const featuresJson = JSON.stringify(resolved.features ?? DEFAULT_FEATURES);
	const totalmixSwitch = (resolved.features ?? DEFAULT_FEATURES).totalmix;
	const totalmixAnswering = Boolean(totalmixSwitch?.enabled && totalmixSwitch?.available);
	const parsePadPath = (path) => {
		const m = typeof path === 'string' ? /^(.+)\/pads\/(\d{1,3})$/.exec(path) : null;
		return m && padRacks[m[1]] ? { rackPath: m[1], note: Number(m[2]) } : null;
	};

	const wss = new WebSocketServer({ port, host: '127.0.0.1' });
	const timers = new Set();
	let connectionCount = 0;

	/**
	 * Point a Playwright context's :8081 socket at THIS mock, wherever it
	 * happens to be listening.
	 *
	 * The page's port is compiled in (`CLIENT_WS_PORT`), so when a real
	 * bridge holds it the mock has to move — and the page has to be lied to
	 * about where it went, or it talks to the bridge and photographs the live
	 * set. The client dials the origin's own host on `:8081`
	 * (`WebSocketConnection.ts`), so one pattern covers it, and the
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
		await context.routeWebSocket(new RegExp(`:${CLIENT_WS_PORT}`), (route) => {
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

	const send = (ws, address, args = []) => {
		if (ws.readyState !== ws.OPEN) return;
		ws.send(JSON.stringify({ address, args }));
	};

	/**
	 * The value a `property/subscribe` cold-read answers with, or
	 * `undefined` for "no answer". Per device beats per name beats the
	 * synthetic defaults; `null` is a legitimate per-device answer (the
	 * surface's `nil`), which is why this is an own-property check and
	 * not a `??` chain.
	 */
	const has = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
	const propertyAnswer = (devicePath, propertyName) => {
		const perDevice = resolved.deviceProperties?.[devicePath];
		if (has(perDevice, propertyName)) return perDevice[propertyName];
		if (has(resolved.properties, propertyName)) return resolved.properties[propertyName];
		return PROPERTY_DEFAULTS[propertyName];
	};

	/**
	 * The §5.5 cold-start tree — one message since protocol 3.6.0.
	 * `scope` is the empty string: this is a whole-song bundle.
	 */
	const sendStateFull = (ws, reason) => {
		send(ws, '/looping/v3/state/full/tree', [
			reason,
			generation,
			SCENE_ETAG,
			'',
			...resolved.treeArgs
		]);
		log(`state/full sent (reason=${reason}, args=${resolved.treeArgs.length}, etag=${SCENE_ETAG})`);
	};

	/**
	 * A deterministic little MIDI phrase for a clip, so a session cell
	 * has something to draw. Derived from the clipPath, never random:
	 * a `--diff` compares captures byte for byte, so the
	 * same set must produce the same notes on every run.
	 *
	 * Packed the way `ClipNotesComponent._pack_notes_blob` does it —
	 * float32 LE `[pitch, start_beats, duration_beats, velocity]`, the
	 * velocity negated for a muted note (ADR-444) — and shipped as the
	 * Buffer-shaped JSON the bridge puts on the wire.
	 */
	const notesBlobFor = (clipPath, lengthBeats) => {
		let seed = 0;
		for (let i = 0; i < clipPath.length; i++) seed = (seed * 31 + clipPath.charCodeAt(i)) >>> 0;
		const bars = Math.max(1, Math.round(lengthBeats));
		const count = Math.min(16, bars * 2);
		const buf = Buffer.alloc(count * 16);
		for (let i = 0; i < count; i++) {
			// A walking line inside one octave, eighth notes, alternating
			// velocity — enough shape that lanes read as music, not noise.
			const step = (seed >>> (i % 8)) & 0x7;
			const pitch = 48 + step * 2 + (i % 3);
			const start = (i * lengthBeats) / count;
			const dur = Math.max(0.25, lengthBeats / count / 1.5);
			const vel = i % 2 === 0 ? 100 : 72;
			// Every fifth note is muted, so each MIDI thumbnail shows a
			// ghost note or two. The sign is the mute bit (ADR-444).
			const muted = i % 5 === 3;
			buf.writeFloatLE(pitch, i * 16);
			buf.writeFloatLE(start, i * 16 + 4);
			buf.writeFloatLE(dur, i * 16 + 8);
			buf.writeFloatLE(muted ? -vel : vel, i * 16 + 12);
		}
		return { count, blob: { type: 'Buffer', data: [...buf] } };
	};

	/**
	 * `playing_slot` for every track the scene says is playing or
	 * recording. Without it the grid demotes those slots to a plain
	 * chip — `deriveSlotCellState` treats a transport state from the
	 * snapshot as stale unless the live channel confirms it — so the
	 * playing ring and the strip's playhead never appear under the mock,
	 * which is exactly the state a session view most needs to show.
	 */
	const sendPlayingSlots = (ws) => {
		for (const { devicePath, mute, pitch } of resolved.permuteSteps ?? []) {
			send(ws, '/looping/v3/permute/step', [devicePath, 'mute', mute]);
			send(ws, '/looping/v3/permute/step', [devicePath, 'pitch', pitch]);
		}
		for (const { trackPath, slotIdx, isAudio, lengthBeats, status } of resolved.playing ?? []) {
			send(ws, '/looping/v3/track/playing_slot', [
				trackPath,
				slotIdx,
				isAudio ? 1 : 0,
				'',
				lengthBeats,
				0,
				lengthBeats,
				1,
				status,
				// The file's span in clip time. The scene's loops cover their
				// whole take, so it is the loop.
				0,
				lengthBeats
			]);
		}
	};

	/**
	 * The pad-scoped bundle (§2.2, reason `pad-chain`): the four-arg
	 * header with the pad path as scope, then the D/P records of the
	 * effects on that pad's chain. Sent on every `vm.padChain.<note>`
	 * cold read and again after a load into that pad.
	 */
	const sendPadChain = (ws, rackPath, note) => {
		const rack = padRacks[rackPath];
		if (!rack) return;
		const padPath = `${rackPath}/pads/${note}`;
		const records = padChainRecords(rackPath, note, rack);
		send(ws, '/looping/v3/state/full/tree', ['pad-chain', generation, SCENE_ETAG, padPath, ...records]);
		log(`pad-chain sent for ${padPath} (${(rack.chains[note] ?? []).length} effect(s), gen ${generation})`);
	};

	wss.on('connection', (ws) => {
		connectionCount += 1;
		log('client connected');
		// The pads this client holds a `vm.padChain.<note>` row on — the
		// ones whose bundle a load into them must re-send.
		const padSubs = new Set();

		// Launch-mode beacon, sent once per client on connect exactly as
		// the real bridge does.
		send(ws, '/bridge/server_mode', ['dev']);
		// The AX helper's state, as the bridge announces it on connect
		// (ADR-439). From the SCENE, not a literal: hardcoded `ready` made the
		// Drum Rack pill's not-ready branch — `ax-helper-down` / `ax-untrusted`,
		// the states a rig without the helper installed is actually in —
		// unreachable from the harness. Defaults to ready, so every existing
		// scene and capture behaves exactly as before.
		send(ws, '/bridge/ax_helper', [axHelper.state, axHelper.detail]);
		// The feature switches, on connect as the real bridge sends them
		// (general-release audit §7b). The UI draws nothing for a feature
		// until this arrives, so without it every capture would lose the
		// TotalMix strip.
		send(ws, '/bridge/features', [featuresJson]);

		const ping = setInterval(() => send(ws, '/bridge/ping', [Date.now()]), PING_INTERVAL_MS);
		const beat = setInterval(
			() => send(ws, '/looping/v3/bridge/heartbeat', [0, Date.now()]),
			SURFACE_HEARTBEAT_MS
		);
		timers.add(ping);
		timers.add(beat);

		ws.on('message', (raw) => {
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (!msg?.address) return;

			// The UI coalesces every send() in one event-loop turn into a
			// `/bridge/batch` envelope (see api/connection/outboundBatcher.ts).
			// The real bridge unpacks it in WebSocketServer.handleBatch; this
			// mock must too, or every batched UI write lands in the
			// `unhandled` default and is silently dropped while the shot
			// still renders a plausible-looking screenshot. Caught exactly
			// that way: `npm run shot` logged `unhandled /bridge/batch`.
			if (msg.address === '/bridge/batch') {
				for (const inner of Array.isArray(msg.messages) ? msg.messages : []) {
					// Nested envelopes are refused rather than recursed, same
					// as the real bridge — nothing legitimately nests them.
					if (inner?.address && inner.address !== '/bridge/batch') {
						handleInbound(ws, inner);
					}
				}
				return;
			}
			handleInbound(ws, msg);
		});

		/** Dispatch one already-unwrapped inbound message. */
		function handleInbound(ws, msg) {
			const { address, args = [] } = msg ?? {};
			if (!address) return;
			onInbound?.(address, args);

			switch (address) {
				case '/looping/v3/handshake/hello': {
					const offered = args.map(String);
					if (!offered.includes(version)) {
						send(ws, '/looping/v3/error', [
							address,
							'handshake-version-mismatch',
							'',
							`UI: ${offered.join(',')}, Mock: ${version}`
						]);
						log(`handshake rejected — UI offered ${offered.join(',')}, scene is ${version}`);
						return;
					}
					send(ws, '/looping/v3/handshake/accept', [version, 'mock-session', generation]);
					for (const [addr, values] of Object.entries(resolved.session ?? {})) {
						// Monitor levels only come from a mixer the bridge has
						// heard: switched off, or on and not answering, the real
						// bridge has none to send.
						if (addr.startsWith('/looping/v3/totalmix/') && !totalmixAnswering) continue;
						send(ws, addr, values);
					}
					sendStateFull(ws, 'accept');
					sendPlayingSlots(ws);
					return;
				}

				case '/looping/v3/state/resync':
					sendStateFull(ws, 'resync');
					sendPlayingSlots(ws);
					return;

				case '/looping/v3/clip/sample/get': {
					// [requestId, clipPath] → /looping/v3/clip/sample.
					// This reply is what tells a cell whether to draw a
					// waveform or note lanes — a slot with no answer draws
					// NOTHING, which is why the grid looked contentless
					// under the mock. MIDI tracks answer isAudioClip=0 and
					// go on to pull notes; audio tracks answer with the
					// scene's file for that slot.
					//
					// That used to be the empty string — there is no real
					// file to read peaks from here — but an empty path is
					// *provisional* to every reader of this reply, and
					// `useClipSwap` bails on one before the clip view's
					// swap pill can mount at all (ADR-440). The waveform
					// still does not paint, because the path names no file
					// on this machine; the pill now does.
					const [requestId, clipPath] = args;
					if (typeof requestId !== 'string' || typeof clipPath !== 'string') return;
					const file = resolved.audioClips?.[clipPath];
					send(ws, '/looping/v3/clip/sample', [
						requestId,
						clipPath,
						file ? 1 : 0,
						typeof file === 'string' ? file : '',
						// The file's span: unknown here, which is what the
						// real surface answers for a take it can't read.
						0,
						0
					]);
					return;
				}

				case '/looping/v3/clip/notes/get': {
					// [requestId, clipPath] → /looping/v3/clip/notes
					const [requestId, clipPath] = args;
					if (typeof requestId !== 'string' || typeof clipPath !== 'string') return;
					const lengthBeats = resolved.clipLengths?.[clipPath] ?? 8;
					const { count, blob } = notesBlobFor(clipPath, lengthBeats);
					send(ws, '/looping/v3/clip/notes', [requestId, clipPath, count, blob]);
					return;
				}

				case '/looping/v3/clip/notes/rich/get': {
					// [requestId, clipPath] → rich/begin · chunk · end — the note
					// editor's channel (the pencil). The same phrase as
					// `clip/notes/get`, repacked as `<iffffi>` (note_id, pitch,
					// start, duration, velocity, mute) in one chunk, with the
					// surface's FNV-1a checksum as its `0x%08x` string. Without it the editor sits on
					// "Loading notes…" in every shot.
					const [requestId, clipPath] = args;
					if (typeof requestId !== 'string' || typeof clipPath !== 'string') return;
					const lengthBeats = resolved.clipLengths?.[clipPath] ?? 8;
					const { count, blob } = notesBlobFor(clipPath, lengthBeats);
					const src = Buffer.from(blob.data);
					const rich = Buffer.alloc(count * 24);
					for (let i = 0; i < count; i++) {
						const vel = src.readFloatLE(i * 16 + 12);
						rich.writeInt32LE(i + 1, i * 24);
						rich.writeFloatLE(src.readFloatLE(i * 16), i * 24 + 4);
						rich.writeFloatLE(src.readFloatLE(i * 16 + 4), i * 24 + 8);
						rich.writeFloatLE(src.readFloatLE(i * 16 + 8), i * 24 + 12);
						rich.writeFloatLE(Math.abs(vel), i * 24 + 16);
						rich.writeInt32LE(vel < 0 ? 1 : 0, i * 24 + 20);
					}
					let h = 0x811c9dc5;
					for (const byte of rich) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
					const chunks = count > 0 ? 1 : 0;
					send(ws, '/looping/v3/clip/notes/rich/begin', [requestId, clipPath, count, chunks]);
					if (chunks) {
						send(ws, '/looping/v3/clip/notes/rich/chunk', [requestId, 0, { type: 'Buffer', data: [...rich] }]);
						send(ws, '/looping/v3/clip/notes/rich/end', [requestId, `0x${(h & 0x7fffffff).toString(16).padStart(8, '0')}`]);
					}
					return;
				}

				case '/looping/v3/property/subscribe': {
					// [devicePath, propertyName] → one `property/value` cold-read
					// (§2.6: subscribe is its own cold-read). A scene may carry
					// per-device `deviceProperties` (two kits, two censuses) and
					// per-name `properties`; the synthetic defaults answer the
					// rest. Unknown names stay unanswered, which leaves the view
					// at its `?? default` rest state, exactly as a surface that
					// has no member for the function would.
					const [devicePath, propertyName] = args;
					if (typeof devicePath !== 'string' || typeof propertyName !== 'string') return;
					// The two pad-chain rows (issue #491) answer from the rack's
					// pad table rather than the property tables: presence for
					// the whole rack, and — for one pad — its entry plus the
					// records themselves as a pad-scoped bundle.
					const rack = padRacks[devicePath];
					if (rack && propertyName === 'vm.padFx') {
						send(ws, '/looping/v3/property/value', [devicePath, propertyName, vmPadFx(rack)]);
						return;
					}
					const chainRow = rack && /^vm\.padChain\.(\d{1,3})$/.exec(propertyName);
					if (chainRow) {
						const note = Number(chainRow[1]);
						padSubs.add(`${devicePath}/pads/${note}`);
						send(ws, '/looping/v3/property/value', [devicePath, propertyName, padChainEntry(rack, note)]);
						sendPadChain(ws, devicePath, note);
						return;
					}
					const value = propertyAnswer(devicePath, propertyName);
					if (value === undefined) {
						log(`unhandled property subscribe ${propertyName}`);
						return;
					}
					send(ws, '/looping/v3/property/value', [devicePath, propertyName, value]);
					return;
				}

				case '/looping/v3/property/unsubscribe': {
					const [devicePath, propertyName] = args;
					const chainRow = typeof propertyName === 'string' && /^vm\.padChain\.(\d{1,3})$/.exec(propertyName);
					if (chainRow) padSubs.delete(`${devicePath}/pads/${Number(chainRow[1])}`);
					return;
				}

				case '/looping/v3/device/load': {
					// [trackPath, devicePath, presetPath] — answered only when
					// `devicePath` is a pad on one of the scene's Drum Racks
					// (issue #491). The preset's device joins the end of that
					// pad's chain and the surface's composite follows: the
					// generation advances (a pathless `state/invalidate`),
					// presence is re-emitted, and the pad's bundle is re-sent
					// to a client holding its row. A track-level load still
					// sits unanswered — that needs Live.
					// A native device (3.12.0) names its class and the name it
					// takes instead of a file; the device is named for the tile,
					// which the class table maps back to its class.
					const [, devicePath, filePath, source, rel] = args;
					const native = typeof source === 'string' && source.startsWith('native:');
					const presetPath = native ? rel : filePath;
					const pad = parsePadPath(devicePath);
					if (!pad || typeof presetPath !== 'string') {
						log(`unhandled ${address}${typeof devicePath === 'string' && devicePath ? ` into ${devicePath}` : ''}`);
						return;
					}
					// A plug-in preset (`AuPluginDevice`) goes through
					// Live's browser on the surface, and the mock has none: it
					// answers the scoped `load-failed` the surface sends for a
					// preset the browser cannot find, so a recipe can photograph
					// the tile falling back from loading to ghost for that pad
					// alone (2026-09-12). Native devices insert as before.
					const presetName = presetPath.split('/').pop()?.replace(/\.(adv|adg|aupreset|amxd)$/i, '') ?? '';
					if (deviceClassName(presetName) === 'AuPluginDevice') {
						send(ws, '/looping/v3/error', [address, 'load-failed', presetPath, `not-in-browser;scope=${devicePath}`]);
						log(`device/load into ${devicePath}: ${presetName} is a plug-in preset — load-failed (scoped)`);
						return;
					}
					const rack = padRacks[pad.rackPath];
					const added = appendPadDevice(rack, pad.note, presetPath);
					generation += 1;
					send(ws, '/looping/v3/state/invalidate', [generation, 'pad-chain']);
					send(ws, '/looping/v3/property/value', [pad.rackPath, 'vm.padFx', vmPadFx(rack)]);
					if (padSubs.has(devicePath)) sendPadChain(ws, pad.rackPath, pad.note);
					log(`device/load into ${devicePath}: ${added.name} (${added.className}) at chain index ${added.index}`);
					return;
				}

				case '/looping/v3/property/set': {
					// [devicePath, propertyName, value, generation] → echo as a
					// value event, the same holding role the param echo plays.
					const [devicePath, propertyName, value] = args;
					if (typeof devicePath === 'string' && typeof propertyName === 'string' && value !== undefined) {
						send(ws, '/looping/v3/property/value', [devicePath, propertyName, value]);
						// A Hybrid's new IR category: Live re-sends the category's
						// file names (its `ir_file_list` listener), measured.
						const files = propertyName === 'ir_category_index' ? HYBRID_IR_LISTS.files[Math.round(Number(value))] : null;
						if (files) send(ws, '/looping/v3/property/value', [devicePath, 'ir_file_list', JSON.stringify(files)]);
					}
					return;
				}

				case '/looping/v3/track/select': {
					// [trackPath] → `selected_track [trackPath]`, the surface's
					// echo of Live's selection. Without it a strip tap under the
					// mock selected nothing, so no shot could reach a second
					// track's instrument view.
					const [trackPath] = args;
					if (typeof trackPath !== 'string') return;
					send(ws, '/looping/v3/selected_track', [trackPath]);
					return;
				}

				case '/looping/v3/param/set': {
					// [paramPath, value, generation] → echo as a value event
					// so an interactive session's knobs stay where you put
					// them instead of snapping back on the next repaint.
					const [paramPath, value] = args;
					if (typeof paramPath === 'string' && typeof value === 'number') {
						send(ws, '/looping/v3/param/value', [paramPath, value]);
					}
					return;
				}

				case '/looping/v3/session/foot_switch/learn':
				case '/looping/v3/session/foot_switch/enabled': {
					// The rig's switch from the scene, with the write applied: a
					// learn start answers `listening` (a real surface would then
					// wait for the pedal), a cancel `idle`, and enabled echoes.
					const [v] = args;
					const on = v === 1;
					const learning = address.endsWith('/learn');
					send(ws, '/looping/v3/session/foot_switch', [
						learning ? 1 : on ? 1 : 0, 10, 23, 'momentary',
						learning && on ? 'listening' : 'idle', 1
					]);
					return;
				}

				case '/looping/v3/session/key_follow': {
					// ADR-447: the toggle echoes, the way the surface's settings do.
					const [v] = args;
					send(ws, '/looping/v3/session/key_follow', [v === 1 ? 1 : 0]);
					return;
				}

				case '/looping/v3/session/scale/detect': {
					// ADR-446: the rig's own test set as a canned answer, so the
					// picker's result strip can be shot. apply=1 also echoes the
					// three session writes the surface makes.
					const [apply] = args;
					send(ws, '/looping/v3/session/scale/detected', [
						0, 'Minor', 'sure', 67, 5, 'Dorian', 1453,
						'harmonic cycle 16 beats | pitch classes present: C D D# F G G# A# | '
						+ 'collections that fit: D# Major, C Minor, F Dorian, A# Mixolydian, G# Lydian, G Phrygian, D Locrian | '
						+ 'bass downbeats C(8) D#(4) C(4) D#(4), first note C (2), lowest C (1) | keys chord roots C(6) F(3) G(1) C(3) F(3) G(1) | '
						+ 'synth rests F (2 each), longest A# (1) | tonic votes: C 24, F 8, D# 8, G 2, A# 1, G# 0, D 0 | C Minor (sure, gap 67 %), runner-up F Dorian',
						apply === 1 ? 1 : 0
					]);
					if (apply === 1) {
						send(ws, '/looping/v3/session/scale_root', [0]);
						send(ws, '/looping/v3/session/scale_name', ['Minor']);
						send(ws, '/looping/v3/session/scale_mode', [1]);
					}
					return;
				}

				default:
					log(`unhandled ${address}`);
			}
		}

		ws.on('close', () => {
			clearInterval(ping);
			clearInterval(beat);
			timers.delete(ping);
			timers.delete(beat);
			log('client disconnected');
		});
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
		clientCount: () => connectionCount,
		routePage,
		close: () =>
			new Promise((resolve) => {
				for (const t of timers) clearInterval(t);
				timers.clear();
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
