#!/usr/bin/env node
/**
 * `npm run setlist`: the setlist remote from a production build (ADR-519).
 *
 * Builds if anything changed, serves the page on `setlist.port`, and uses the
 * bridge already running or starts one. Both servers restart if they die, as
 * `npm run ipad`'s do. A build failure stops here, once, instead of retrying.
 */

const { execSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { loadConstants } = require('../interface/bridge/utils/constants');

const constants = loadConstants();
const REPO = path.join(__dirname, '..');
const PORT = constants.setlist.port;
const BRIDGE_PORT = constants.osc.webSocket.port;
const PROBE_MS = 500;

function answering(port) {
	return new Promise((resolve) => {
		const socket = net.connect({ port, host: '127.0.0.1' });
		const finish = (result) => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(PROBE_MS, () => finish(false));
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
	});
}

/** Live only runs this page's surface when its link points at this checkout. */
function warnIfLiveLoadsAnotherSurface() {
	const library = constants.paths?.userLibraryBase;
	if (!library) return;
	const link = path.join(library, 'Remote Scripts', 'Vamp');
	const here = path.join(REPO, 'surface');
	let target;
	try {
		target = fs.realpathSync(link);
	} catch {
		target = null;
	}
	if (target === fs.realpathSync(here)) return;
	console.warn(`\n⚠️  Live loads its surface from ${target ?? 'nowhere'}, which has no setlist.`);
	console.warn(`   ln -sfn "${here}" "${link}"`);
	console.warn('   Then quit and reopen Live.\n');
}

function ipadAddress() {
	try {
		const name = execSync('scutil --get LocalHostName', { encoding: 'utf8' }).trim();
		return `http://${name}.local:${PORT}`;
	} catch {
		return `http://<this Mac's name>.local:${PORT}`;
	}
}

async function main() {
	if (await answering(PORT)) {
		console.error(`❌ Port ${PORT} is already in use. Stop whatever is serving it, then run this again.`);
		process.exit(1);
	}
	warnIfLiveLoadsAnotherSurface();

	console.log('📦 Building the page (skipped if nothing changed)...');
	const build = spawnSync('npm', ['run', 'build:ipad'], { cwd: REPO, stdio: 'inherit' });
	if (build.status !== 0) process.exit(build.status ?? 1);

	const commands = [`"cd interface && npm run preview -- --port ${PORT} --host 0.0.0.0"`];
	const names = ['PAGE'];
	if (await answering(BRIDGE_PORT)) {
		console.log(`🔌 Using the bridge already running on port ${BRIDGE_PORT}.`);
	} else {
		console.log(`🔌 Starting the bridge on port ${BRIDGE_PORT}.`);
		commands.push('"npm run dev:bridge:ipad"');
		names.push('BRIDGE');
	}

	console.log(`\n🎹 Open on the iPad: ${ipadAddress()}\n`);

	const servers = spawn(
		`npx concurrently -n ${names.join(',')} --restart-tries -1 --restart-after 1500 ${commands.join(' ')}`,
		{ cwd: REPO, stdio: 'inherit', shell: true }
	);
	servers.on('close', (code) => process.exit(code ?? 0));
}

main();
