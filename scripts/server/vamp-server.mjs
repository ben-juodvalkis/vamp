/**
 * Vamp's whole server in one Node program, for the installed app
 * (installer.plan.md Phase 2): the page server (SvelteKit's adapter-node
 * handler) on `padLink.pagePort`, the `/bridge-socket` pass-through to the
 * bridge, and the bridge itself as a child it restarts. A checkout keeps
 * `npm run dev` and `npm run ipad`; this is what `scripts/build-server.mjs`
 * lays out, and it runs from that folder only:
 *
 *   VAMP_DATA=… VAMP_DEVICES=… node vamp-server.mjs
 *
 * The same rules as the checkout's `vite preview`, by hand: only localhost,
 * an IP address or a `.local` name may ask (vite's `allowedHosts`, against DNS
 * rebinding), and the Origin header goes through to the bridge untouched so
 * its own origin check still applies.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect, isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.VAMP_APP_ROOT ||= here;
// `vite preview` takes any body; adapter-node stops at 512 kB.
process.env.BODY_SIZE_LIMIT ||= 'Infinity';

// The tracked defaults with this Mac's own file laid over them, as the bridge
// and the interface server read them (`dataPaths.js`).
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const merge = (base, local) =>
	isObject(base) && isObject(local)
		? Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(local)])].map((k) => [k, k in local ? merge(base[k], local[k]) : base[k]]))
		: local;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const localFile = join(process.env.VAMP_DATA || here, 'config', 'constants.local.json');
const constants = existsSync(localFile)
	? merge(readJson(join(here, 'config', 'constants.json')), readJson(localFile))
	: readJson(join(here, 'config', 'constants.json'));
const pagePort = Number(process.env.VAMP_PAGE_PORT) || constants.padLink.pagePort;
const bridgePort = constants.osc.webSocket.port;
const socketPath = constants.osc.webSocket.path;
const RESTART_AFTER_MS = 1500;

function log(line) {
	process.stdout.write(`[vamp-server] ${line}\n`);
}

// --- the bridge ---------------------------------------------------------------

let bridge = null;
let stopping = false;

function startBridge() {
	// The mode and log level `npm run ipad` gives its bridge.
	const env = { LOOPING_SERVER_MODE: 'ipad', LOG_LEVEL: 'WARN', ...process.env };
	bridge = spawn(process.execPath, [join(here, 'bridge', 'bridge.cjs')], { cwd: here, stdio: 'inherit', env });
	log(`bridge started (pid ${bridge.pid})`);
	bridge.on('exit', (code, signal) => {
		bridge = null;
		if (stopping) return;
		log(`bridge exited (${signal ?? code}); restarting in ${RESTART_AFTER_MS} ms`);
		setTimeout(startBridge, RESTART_AFTER_MS);
	});
}

// --- the page server ----------------------------------------------------------

function hostAllowed(header) {
	if (!header) return false;
	const host = header.startsWith('[') ? header.slice(1, header.indexOf(']')) : header.split(':')[0];
	return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host) !== 0;
}

const { handler } = await import(join(here, 'build', 'handler.js'));

const server = createServer((req, res) => {
	if (!hostAllowed(req.headers.host)) {
		res.writeHead(403, { 'content-type': 'text/plain' });
		res.end('Blocked: this host is not allowed.\n');
		return;
	}
	handler(req, res);
});

// The page reaches the bridge on its own origin: pipe the upgrade, headers and
// all, to the bridge's own port.
server.on('upgrade', (req, socket, head) => {
	const path = (req.url ?? '').split('?')[0];
	if (path !== socketPath || !hostAllowed(req.headers.host)) {
		socket.destroy();
		return;
	}
	const upstream = connect(bridgePort, '127.0.0.1', () => {
		const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
		for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
		upstream.write(lines.join('\r\n') + '\r\n\r\n');
		if (head?.length) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
	upstream.on('error', () => socket.destroy());
	socket.on('error', () => upstream.destroy());
});

function stop() {
	stopping = true;
	bridge?.kill('SIGTERM');
	server.close();
	setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

if (process.env.VAMP_NO_BRIDGE !== '1') startBridge();
server.listen(pagePort, '0.0.0.0', () => log(`page server on http://localhost:${pagePort}`));
