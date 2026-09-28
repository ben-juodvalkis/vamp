#!/usr/bin/env node
/**
 * Analyzer for the bridge profile dump (logs/bridge-profile.ndjson)
 * and the surface profile dump (logs/surface-profile.ndjson).
 *
 * Aggregates every JSON record in the file into per-address rates,
 * fanout cost, and top-N tables. Optional time window via --since /
 * --until (ms epoch) lets you slice a single scenario out of a longer
 * run.
 *
 * Usage:
 *   node scripts/perf/analyze.mjs [path]
 *   node scripts/perf/analyze.mjs --bridge logs/bridge-profile.ndjson
 *   node scripts/perf/analyze.mjs --surface logs/surface-profile.ndjson
 *   node scripts/perf/analyze.mjs --since 1714325000000 --until 1714325030000
 *
 * If neither --bridge nor --surface is passed, both default paths are
 * read when present.
 */

import { readFileSync, existsSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');

const args = argv.slice(2);
const opts = {
	bridge: null,
	surface: null,
	since: null,
	until: null
};

for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === '--bridge') opts.bridge = args[++i];
	else if (a === '--surface') opts.surface = args[++i];
	else if (a === '--since') opts.since = parseInt(args[++i], 10);
	else if (a === '--until') opts.until = parseInt(args[++i], 10);
	else if (!opts.bridge && !opts.surface && !a.startsWith('--')) {
		// Bare path — guess by suffix or default to bridge.
		if (a.includes('surface')) opts.surface = a;
		else opts.bridge = a;
	}
}

if (!opts.bridge && !opts.surface) {
	const bridgeDefault = resolve(REPO_ROOT, 'logs', 'bridge-profile.ndjson');
	const surfaceDefault = resolve(REPO_ROOT, 'logs', 'surface-profile.ndjson');
	if (existsSync(bridgeDefault)) opts.bridge = bridgeDefault;
	if (existsSync(surfaceDefault)) opts.surface = surfaceDefault;
}

if (!opts.bridge && !opts.surface) {
	console.error('No profile files found and no path given.');
	console.error('Run with BRIDGE_PROFILE=1 / LOOPING_SURFACE_PROFILE=1 first.');
	exit(1);
}

function* records(path) {
	if (!path || !existsSync(path)) return;
	const text = readFileSync(path, 'utf8');
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		try {
			yield JSON.parse(line);
		} catch {
			// Skip malformed lines (bridge crashed mid-write etc.)
		}
	}
}

function inWindow(rec) {
	if (opts.since && rec.ts < opts.since) return false;
	if (opts.until && rec.ts > opts.until) return false;
	return true;
}

function pad(s, n) {
	const str = String(s);
	return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

function rpad(s, n) {
	const str = String(s);
	return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}

function fmt(n, digits = 1) {
	if (typeof n !== 'number') return String(n);
	return n.toFixed(digits);
}

function analyzeBridge(path) {
	console.log(`\n=== Bridge profile: ${path} ===`);
	const inboundCounts = new Map();
	const inboundBytes = new Map();
	const inboundFanout = new Map();
	const outboundCounts = new Map();
	const outboundBytes = new Map();

	let firstTs = null;
	let lastTs = null;
	let windowsSeen = 0;
	let maxClients = 0;

	for (const rec of records(path)) {
		if (!inWindow(rec)) continue;
		windowsSeen += 1;
		if (firstTs === null) firstTs = rec.ts;
		lastTs = rec.ts;
		if (typeof rec.wsClients === 'number' && rec.wsClients > maxClients) {
			maxClients = rec.wsClients;
		}
		for (const [k, v] of Object.entries(rec.inbound || {})) {
			inboundCounts.set(k, (inboundCounts.get(k) || 0) + v.count);
			inboundBytes.set(k, (inboundBytes.get(k) || 0) + v.bytes);
			inboundFanout.set(k, (inboundFanout.get(k) || 0) + (v.fanout || 0));
		}
		for (const [k, v] of Object.entries(rec.outbound || {})) {
			outboundCounts.set(k, (outboundCounts.get(k) || 0) + v.count);
			outboundBytes.set(k, (outboundBytes.get(k) || 0) + v.bytes);
		}
	}

	if (windowsSeen === 0) {
		console.log('  (no records in window)');
		return;
	}

	const seconds = Math.max(1, ((lastTs ?? 0) - (firstTs ?? 0)) / 1000);
	console.log(
		`  window: ${new Date(firstTs).toISOString()} → ${new Date(lastTs).toISOString()}` +
		` (${seconds.toFixed(1)}s, ${windowsSeen} buckets, max ws clients: ${maxClients})`
	);

	const printTable = (title, counts, bytes, fanout) => {
		console.log(`\n  ${title}:`);
		console.log(
			`    ${pad('addr', 56)}${rpad('count', 8)}${rpad('rate/s', 10)}${rpad('bytes', 10)}${
				fanout ? rpad('fanout', 10) : ''
			}`
		);
		const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
		for (const [k, c] of rows) {
			const b = bytes.get(k) || 0;
			const f = fanout ? fanout.get(k) || 0 : null;
			console.log(
				`    ${pad(k, 56)}${rpad(c, 8)}${rpad(fmt(c / seconds), 10)}${rpad(b, 10)}${
					f !== null ? rpad(f, 10) : ''
				}`
			);
		}
	};

	printTable('inbound (UDP → WS)', inboundCounts, inboundBytes, inboundFanout);
	printTable('outbound (WS → UDP)', outboundCounts, outboundBytes, null);
}

function analyzeSurface(path) {
	console.log(`\n=== Surface profile: ${path} ===`);
	const sendCounts = new Map();
	const inboundCounts = new Map();
	const listenerCounts = new Map();
	const listenerMs = new Map();
	let tickCount = 0;
	let tickTimeMs = 0;
	let tickGapMaxMs = 0;
	let firstTs = null;
	let lastTs = null;
	let windowsSeen = 0;

	for (const rec of records(path)) {
		if (!inWindow(rec)) continue;
		windowsSeen += 1;
		if (firstTs === null) firstTs = rec.ts;
		lastTs = rec.ts;
		tickCount += rec.tickCount || 0;
		tickTimeMs += rec.tickTimeMs || 0;
		if ((rec.tickGapMaxMs || 0) > tickGapMaxMs) tickGapMaxMs = rec.tickGapMaxMs;
		for (const [k, v] of Object.entries(rec.send || {})) {
			sendCounts.set(k, (sendCounts.get(k) || 0) + v);
		}
		for (const [k, v] of Object.entries(rec.inbound || {})) {
			inboundCounts.set(k, (inboundCounts.get(k) || 0) + v);
		}
		for (const [k, v] of Object.entries(rec.listeners || {})) {
			listenerCounts.set(k, (listenerCounts.get(k) || 0) + v);
		}
		for (const [k, v] of Object.entries(rec.listenerMs || {})) {
			listenerMs.set(k, (listenerMs.get(k) || 0) + v);
		}
	}

	if (windowsSeen === 0) {
		console.log('  (no records in window)');
		return;
	}

	const seconds = Math.max(1, ((lastTs ?? 0) - (firstTs ?? 0)) / 1000);
	console.log(
		`  window: ${new Date(firstTs).toISOString()} → ${new Date(lastTs).toISOString()}` +
		` (${seconds.toFixed(1)}s, ${windowsSeen} buckets)`
	);
	console.log(
		`  ticks: ${tickCount} (${(tickCount / seconds).toFixed(1)}/s), ` +
		`time-in-tick: ${tickTimeMs}ms, max gap: ${tickGapMaxMs.toFixed(1)}ms`
	);

	const printList = (title, m) => {
		console.log(`\n  ${title}:`);
		console.log(`    ${pad('key', 56)}${rpad('count', 8)}${rpad('rate/s', 10)}`);
		const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
		for (const [k, c] of rows) {
			console.log(
				`    ${pad(k, 56)}${rpad(c, 8)}${rpad(fmt(c / seconds), 10)}`
			);
		}
	};

	printList('sends (per address)', sendCounts);
	printList('inbound (per address)', inboundCounts);
	printList('LOM listener fires', listenerCounts);
	if (listenerMs.size > 0) {
		console.log('\n  LOM listener time (cumulative ms):');
		for (const [k, v] of listenerMs) {
			console.log(`    ${pad(k, 56)}${rpad(v, 8)}`);
		}
	}
}

if (opts.bridge) analyzeBridge(opts.bridge);
if (opts.surface) analyzeSurface(opts.surface);
