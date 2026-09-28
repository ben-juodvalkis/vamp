#!/usr/bin/env node
/**
 * Replay scenario harness for the perf audit.
 *
 * Connects to the bridge's WebSocket, runs a named traffic-shape, and
 * counts inbound messages by address while emitting outbound. Prints a
 * compact summary on exit.
 *
 * Requires the bridge to be running (npm run dev:bridge or full
 * npm run dev). For full-pipeline measurement, also start Live with
 * the Looping control surface — without Live, only outbound-direction
 * traffic and bridge-side logging are exercised.
 *
 * Usage:
 *   node scripts/perf/scenario.mjs <name> [durationMs]
 *
 * Names:
 *   idle        — connect and sit for N ms (default 30s)
 *   tempo-sweep — drag tempo 60 → 180 BPM at 60 Hz for N ms (default 5s)
 *   param-storm — emit a parameter set at 60 Hz for N ms (default 5s)
 *   clip-launch — launch a clip and observe the inbound burst for N ms
 *   track-storm — issue a sequence of track create/delete pairs
 *
 * Pair this with BRIDGE_PROFILE=1 on the bridge so each scenario lands
 * a marker window in logs/bridge-profile.ndjson; see scripts/perf/analyze.mjs.
 *
 * Node 21+ required (global WebSocket).
 */

import { argv, exit } from 'node:process';

const args = argv.slice(2);
if (args.length === 0) {
	console.error(
		'usage: node scripts/perf/scenario.mjs <name> [durationMs]\n' +
		'  names: idle | tempo-sweep | param-storm | clip-launch | track-storm'
	);
	exit(1);
}

const name = args[0];
const durationMs = args[1] ? parseInt(args[1], 10) : null;

const BRIDGE_URL = process.env.BRIDGE_URL || 'ws://127.0.0.1:8081';

if (typeof WebSocket === 'undefined') {
	console.error(
		'No global WebSocket — Node 21+ required. ' +
		'Run with newer Node, or add `import WebSocket from "ws"` and install ws.'
	);
	exit(2);
}

/** @type {Map<string, number>} */
const inboundCounts = new Map();
/** @type {Map<string, number>} */
const outboundCounts = new Map();

function note(map, address) {
	map.set(address, (map.get(address) || 0) + 1);
}

async function connect() {
	const ws = new WebSocket(BRIDGE_URL);
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', () => resolve(undefined), { once: true });
		ws.addEventListener('error', (e) => reject(e), { once: true });
	});
	console.log(`[scenario] connected to ${BRIDGE_URL}`);
	ws.addEventListener('message', (event) => {
		try {
			noteInbound(JSON.parse(event.data.toString()));
		} catch {}
	});
	return ws;
}

// Generation, learned from the wire. `/looping/v3/param/set` is
// generation-checked at DevicesComponent.py:200 and a stale value is
// rejected before the write, so a scenario that guesses gets nothing.
let currentGeneration = null;

/**
 * Ask for a `state/full` and wait for the generation it carries.
 *
 * Writes are generation-checked, and a fresh WebSocket learns nothing on
 * its own — the surface volunteers a `state/full` only on a structural
 * change. Without this the counter sat on its initial value and every
 * write came back `generation-stale ui=1, surf=N`.
 */
async function learnGeneration(ws, timeoutMs = 4000) {
	send(ws, '/looping/v3/state/resync', []);
	const deadline = Date.now() + timeoutMs;
	while (currentGeneration === null && Date.now() < deadline) await sleep(50);
	if (currentGeneration === null) {
		console.warn('[scenario] no generation seen; writes will be rejected as stale');
		currentGeneration = 1;
	} else {
		console.log(`[scenario] generation ${currentGeneration}`);
	}
}

/**
 * Count one inbound frame, descending into batch envelopes.
 *
 * The bridge coalesces surface frames into
 * `{ address: '/bridge/batch', messages: [...] }` (broadcastBatcher.js:12),
 * and only single-item windows ship raw. Counting the envelope meant every
 * inbound tally was a handful of `/bridge/batch` rows and none of the real
 * addresses — so no scenario has ever measured the traffic it reports.
 */
function noteInbound(msg) {
	if (!msg || !msg.address) return;
	if (msg.address === '/bridge/batch') {
		for (const inner of msg.messages ?? []) noteInbound(inner);
		return;
	}
	note(inboundCounts, msg.address);
	if (msg.address === '/looping/v3/state/full/tree' && Array.isArray(msg.args)) {
		if (typeof msg.args[1] === 'number') currentGeneration = msg.args[1];
	}
	if (msg.address === '/looping/v3/handshake/accept' && Array.isArray(msg.args)) {
		if (typeof msg.args[2] === 'number') currentGeneration = msg.args[2];
	}
}

function send(ws, address, args = []) {
	const payload = JSON.stringify({ address, args });
	ws.send(payload);
	note(outboundCounts, address);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarize() {
	const top = (m, n = 12) =>
		[...m.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([addr, c]) => `  ${c.toString().padStart(6)}  ${addr}`)
			.join('\n');
	const inboundTotal = [...inboundCounts.values()].reduce((a, b) => a + b, 0);
	const outboundTotal = [...outboundCounts.values()].reduce((a, b) => a + b, 0);
	console.log(
		'\n=== scenario summary ===\n' +
		`scenario      ${name}\n` +
		`inbound total ${inboundTotal}\n` +
		`outbound total ${outboundTotal}\n` +
		`top inbound:\n${top(inboundCounts)}\n` +
		`top outbound:\n${top(outboundCounts)}\n`
	);

	// A scenario that drives a rejected address or arity still produces a
	// clean-looking latency table — which is how the three bugs above
	// survived. Any `/looping/v3/error` on the wire means this run measured
	// something other than what it claims to.
	const errors = inboundCounts.get('/looping/v3/error') ?? 0;
	if (errors > 0) {
		console.error(
			`\n[scenario] FAILED: ${errors} inbound /looping/v3/error frame(s). ` +
			'The surface rejected this run\'s writes, so any number above is ' +
			'measuring rejection, not work. Do not cite it.'
		);
		process.exitCode = 1;
	}
}

async function scenarioIdle(ws, dur) {
	console.log(`[idle] sitting for ${dur} ms…`);
	await sleep(dur);
}

async function scenarioTempoSweep(ws, dur) {
	const stepMs = 1000 / 60;
	const steps = Math.floor(dur / stepMs);
	console.log(`[tempo-sweep] ${steps} steps @ 60 Hz from 60 → 180 BPM`);
	for (let i = 0; i < steps; i++) {
		const bpm = 60 + (i / steps) * 120;
		// `/live/song/set/tempo` is the WRITE address (registered at
		// LoopingSurface.py:454). `/looping/session/tempo` is the observer
		// the surface emits on — sending to it is silently inert, and the
		// v3 spelling this used to send is routed nowhere at all. Neither
		// produces an error, which is why the scenario looked healthy
		// while driving nothing.
		send(ws, '/live/song/set/tempo', [bpm]);
		await sleep(stepMs);
	}
}

async function scenarioParamStorm(ws, dur) {
	const stepMs = 1000 / 60;
	const steps = Math.floor(dur / stepMs);
	console.log(`[param-storm] ${steps} steps @ 60 Hz to /looping/v3/param/set`);
	const path = process.env.PERF_PARAM_PATH || 'tracks/0/devices/0/params/1';
	for (let i = 0; i < steps; i++) {
		const value = (i / steps);
		// [path, value, generation] — DevicesComponent.py:174 rejects a
		// short arg list outright, so the 2-arg form relayed fine and was
		// rejected 1:1 on the surface.
		send(ws, '/looping/v3/param/set', [path, value, currentGeneration]);
		await sleep(stepMs);
	}
}

async function scenarioClipLaunch(ws, dur) {
	const slot = process.env.PERF_CLIP_PATH || 'tracks/0/clip_slots/0';
	console.log(`[clip-launch] launching ${slot} and observing for ${dur} ms`);
	send(ws, '/looping/v3/clip/launch', [slot]);
	await sleep(dur);
}

async function scenarioTrackStorm(ws, dur) {
	console.warn(
		'\n[track-storm] WARNING: this scenario creates new audio tracks in the\n' +
		'  active Live set on every cycle. After the run completes you will need\n' +
		'  to manually remove them. Run only against a throwaway / scratch set.\n'
	);
	console.log(`[track-storm] create/delete pairs for ${dur} ms`);
	const cycleMs = 600;
	const cycles = Math.floor(dur / cycleMs);
	for (let i = 0; i < cycles; i++) {
		send(ws, '/looping/v3/track/prepare_for_preset', [
			`perf-${i}-${Date.now()}`,
			'audio',
			''
		]);
		await sleep(300);
		// no delete address registered as a UI sender — the scenario
		// stresses prepare-only; pair with manual cleanup if needed.
		await sleep(cycleMs - 300);
	}
}

const dispatchers = {
	idle: { fn: scenarioIdle, defaultMs: 30_000 },
	'tempo-sweep': { fn: scenarioTempoSweep, defaultMs: 5_000 },
	'param-storm': { fn: scenarioParamStorm, defaultMs: 5_000 },
	'clip-launch': { fn: scenarioClipLaunch, defaultMs: 8_000 },
	'track-storm': { fn: scenarioTrackStorm, defaultMs: 12_000 }
};

const dispatcher = dispatchers[name];
if (!dispatcher) {
	console.error(`unknown scenario: ${name}`);
	console.error(`available: ${Object.keys(dispatchers).join(', ')}`);
	exit(1);
}

const dur = durationMs ?? dispatcher.defaultMs;

(async () => {
	let ws;
	try {
		ws = await connect();
	} catch (e) {
		console.error(`[scenario] connect failed: ${e?.message ?? e}`);
		console.error('Hint: start the bridge with `npm run dev:bridge` (or `npm run dev` for full stack).');
		exit(3);
	}
	try {
		await learnGeneration(ws);
		await dispatcher.fn(ws, dur);
	} finally {
		try { ws.close(); } catch {}
		summarize();
	}
})();
