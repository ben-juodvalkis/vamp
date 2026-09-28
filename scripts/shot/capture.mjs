#!/usr/bin/env node
/**
 * Capture a real scene off a running bridge, for later headless replay.
 *
 * Run this once on the Mac with `npm run dev` and Live open. It connects
 * to the bridge as if it were the interface, performs the v3 handshake,
 * records the `state/full/tree` message and the session scalars, and writes a
 * scene JSON that `mock-surface.mjs` replays byte-for-byte.
 *
 *     npm run shot:capture -- my-set
 *
 * The result is a frozen photograph of that Live set: the same tracks,
 * devices, parameter values, clip names and slot states, replayable
 * forever on any machine with no Live in sight. That is the whole point
 * — the synthetic scene in `scene.mjs` is good enough for layout work,
 * but only a capture tells you how the UI handles *your* set, with your
 * plugin names and your 200-parameter racks.
 *
 * Scenes are small (tens of KB of JSON) and worth committing under
 * `scripts/shot/scenes/`, unlike the screenshots they produce.
 *
 * Usage:
 *   node scripts/shot/capture.mjs [name] [--url ws://localhost:8081] [--wait 4000]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCENES_DIR = join(REPO_ROOT, 'scripts', 'shot', 'scenes');

/** Mirrors `UI_SUPPORTED_VERSIONS` — we must negotiate like the real UI. */
const UI_SUPPORTED_VERSIONS = ['3.11.0'];

/**
 * Session scalars worth freezing. These arrive as init-emits after
 * accept rather than inside the tree, so they need collecting
 * separately (wire-protocol §2.12).
 */
const SESSION_PREFIX = '/looping/v3/session/';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};

const name = argv.find((a) => !a.startsWith('--')) ?? 'captured';
const url = flag('url', 'ws://localhost:8081');
const waitMs = Number(flag('wait', 4000));
const outPath = join(SCENES_DIR, `${name}.json`);

console.log(`[capture] connecting to ${url}`);

const ws = new WebSocket(url);

const scene = {
	name,
	version: null,
	generation: 1,
	session: {},
	treeArgs: []
};

let sawTree = false;

const send = (address, args) => ws.send(JSON.stringify({ address, args }));

ws.on('open', () => {
	console.log('[capture] connected — sending handshake hello');
	send('/looping/v3/handshake/hello', UI_SUPPORTED_VERSIONS);
});

ws.on('message', (raw) => {
	let msg;
	try {
		msg = JSON.parse(raw.toString());
	} catch {
		return;
	}

	// The bridge coalesces frames into `/bridge/batch` envelopes; unpack
	// them the way WebSocketConnection.ts does.
	const messages =
		msg?.address === '/bridge/batch' && Array.isArray(msg.messages) ? msg.messages : [msg];

	for (const m of messages) {
		if (!m?.address) continue;
		const { address, args = [] } = m;

		if (address === '/looping/v3/handshake/accept') {
			scene.version = String(args[0]);
			scene.generation = Number(args[2]) || 1;
			console.log(`[capture] accepted on ${scene.version}, generation ${scene.generation}`);
			continue;
		}

		if (address.startsWith(SESSION_PREFIX)) {
			scene.session[address] = args;
			continue;
		}

		if (address === '/looping/v3/state/full/tree') {
			// Protocol 3.6.0 header: reason, generation, etag, scope.
			// Only whole-song bundles are worth capturing — a scoped one
			// carries a single track and would overwrite the real scene.
			if (String(args[3] ?? '') !== '') continue;
			sawTree = true;
			scene.generation = Number(args[1]) || scene.generation;
			scene.treeArgs = args.slice(4);
			console.log(
				`[capture] state/full/tree — reason=${args[0]}, ${scene.treeArgs.length} tree args`
			);
			continue;
		}
	}
});

ws.on('error', (err) => {
	console.error(`[capture] websocket error: ${err.message}`);
	console.error('[capture] is the bridge running? try `npm run dev` (or `npm run bridge`)');
	process.exit(1);
});

setTimeout(async () => {
	ws.close();

	if (!sawTree || scene.treeArgs.length === 0) {
		console.error(
			'[capture] no state/full/tree arrived. The bridge answered but the ' +
				'Python surface may not be loaded in Live — check Live\'s control-surface slot.'
		);
		process.exit(2);
	}

	await mkdir(SCENES_DIR, { recursive: true });
	await writeFile(outPath, `${JSON.stringify(scene, null, '\t')}\n`);
	console.log(`[capture] wrote ${outPath}`);
	console.log(`[capture] replay it with:  npm run shot -- session --scene ${outPath}`);
	process.exit(0);
}, waitMs);
