/**
 * Booting the headless stack — the part `shot.mjs` and `multitouch.mjs`
 * both need.
 *
 * Both harnesses stand up the same three things and tear them down again:
 * a production preview server, the mock surface in place of the whole
 * downstream stack, and Chromium. Only what they then DO with the page
 * differs — one photographs it, the other plays it with several fingers
 * and reads back what reached the mock.
 *
 * It also owns WHERE the mock listens (`resolveMockPort`), which is the half
 * of the bridge-conflict answer that belongs to the stack; the other half —
 * pointing a page at it — is `startMockSurface`'s `routePage`, so that moving
 * the mock and routing the page cannot be done separately.
 *
 * Extracted when the multitouch harness landed (ADR-427). Two copies of
 * "wait for :4173, then launch Chromium" is exactly the drift this
 * program set out to remove elsewhere, and the preview-server guard (refuse
 * a port something else answers on; trust only the server this run started
 * — `startPreview`) is a single fact that must not get two homes.
 *
 * Deliberately NOT here: the preset-catalog fixture interception and the
 * raster-determinism launch flags. Both belong to the screenshot harness
 * specifically — the flags buy bit-identical pixels, which a harness that
 * never looks at pixels does not need, and `shotFixtures.test.ts` guards
 * the interception where it lives.
 */

import { spawn, execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import {
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	openSync,
	closeSync,
	unlinkSync
} from 'node:fs';
import { createServer, connect } from 'node:net';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INTERFACE_DIR = join(REPO_ROOT, 'interface');
export const BUILD_MARKER = join(INTERFACE_DIR, '.svelte-kit', 'output', 'client');

export const PREVIEW_PORT = Number(process.env.SHOT_PREVIEW_PORT ?? 4173);
/**
 * Where the default dev server listens. Not 3000 (`npm run dev`'s interface)
 * and not 5173 (vite's own default, which a stray `vite dev` elsewhere takes),
 * so a capture never lands on a server it did not start.
 */
export const DEV_PORT = Number(process.env.SHOT_DEV_PORT ?? 5174);

/**
 * The port the built client dials — a fact about the page, not a choice the
 * harness gets to make. The client's one URL is built from it
 * (`WebSocketConnection.ts`: the origin's own host) and there is no runtime
 * override, so a mock that moves off it moves only the server.
 *
 * Read from the CLIENT'S OWN COPY, which is where the everyday claim about
 * this ("`constants.osc.webSocket.port` is compiled in") turns out to be only
 * half true: `WebSocketConnection.ts` does not import the shared config at
 * all — it carries a hardcoded block, deliberately, "to avoid import issues
 * during SSR". Measured: editing `config/constants.json` to 8099 and
 * rebuilding left `webSocket:{port:8081}` in the bundle, so a harness that
 * had trusted the config would have intercepted the wrong port and handed the
 * page straight to the bridge. The config is kept as a cross-check
 * ({@link assertMockPort} fails on drift), not as the source.
 */
const CLIENT_SOURCE = join(
	INTERFACE_DIR,
	'src',
	'lib',
	'api',
	'connection',
	'WebSocketConnection.ts'
);
const CONFIG_WS_PORT = JSON.parse(
	readFileSync(join(REPO_ROOT, 'config', 'constants.json'), 'utf8')
).osc.webSocket.port;
const INLINED_WS_PORT = (() => {
	try {
		const m = /webSocket:\s*\{\s*port:\s*(\d+)\s*\}/.exec(readFileSync(CLIENT_SOURCE, 'utf8'));
		return m ? Number(m[1]) : null;
	} catch {
		return null;
	}
})();
export const CLIENT_WS_PORT = INLINED_WS_PORT ?? CONFIG_WS_PORT;

/**
 * Is something already listening on `port`?
 *
 * A CONNECT probe, deliberately, and this is the one thing about the
 * arrangement below that cannot be reasoned out from first principles.
 * Measured on this Mac, with the bridge listening on `*:8081`: binding a
 * second server to `127.0.0.1:8081` **succeeds** — BSD lets a specific
 * address coexist with a wildcard one — and then WINS every loopback
 * connection, so `ws://127.0.0.1:8081` reaches the mock while
 * `ws://looping-studio.local:8081` still reaches the bridge. So a bind probe
 * reports "free" with a bridge plainly running, and the old harness quietly
 * stole the rig's own loopback traffic for the length of a run (anything on
 * the Mac that reconnected mid-capture landed on the mock) while leaving the
 * page's second and third candidate URLs pointed at the live set.
 */
export function portInUse(port, host = '127.0.0.1') {
	return new Promise((resolveProbe) => {
		const socket = connect({ port, host });
		const done = (answer) => {
			socket.destroy();
			resolveProbe(answer);
		};
		socket.setTimeout(1000);
		socket.on('connect', () => done(true));
		socket.on('timeout', () => done(false));
		socket.on('error', () => done(false));
	});
}

/** An ephemeral port nothing holds, for the mock to take. */
export function freePort() {
	return new Promise((resolveFree, rejectFree) => {
		const server = createServer();
		server.on('error', rejectFree);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolveFree(port));
		});
	});
}

/**
 * Where the mock should listen.
 *
 * {@link CLIENT_WS_PORT} when it is free — so `mock-surface.mjs` is still
 * reachable at the documented port for standalone poking — and a free
 * ephemeral port when a real bridge (or anything else) already holds it.
 *
 * Moving the mock is only half of it: the page still dials :8081, so the
 * caller MUST also route the page's socket to `port`
 * (`startMockSurface`'s `routePage`). The two halves are one decision and
 * neither harness may take just the first — see the note on
 * {@link assertMockPort}.
 */
export async function resolveMockPort({ log = () => {} } = {}) {
	if (!(await portInUse(CLIENT_WS_PORT))) return { port: CLIENT_WS_PORT, moved: false };
	const port = await freePort();
	log(
		`:${CLIENT_WS_PORT} is taken (a bridge is running) — mock on :${port}, ` +
			'page socket routed to it'
	);
	return { port, moved: true };
}

/**
 * Enforce that nobody moves the mock by hand. Call once, early, in every
 * harness.
 *
 * `SHOT_MOCK_PORT` was the trap: moving the mock server left the page still
 * dialling :8081, and with a real bridge there — i.e. exactly when someone
 * reached for the override to dodge the conflict — the run came back
 * silently correct-looking and full of the LIVE Ableton set. The harness now
 * moves the mock ITSELF when it has to, and pairs the move with a
 * `routeWebSocket` interception that hands the page's socket to the mock and
 * never connects it to :8081 at all, so there is nothing left for the env var
 * to fix and honouring it would only re-open the old hole (under `--no-mock`
 * it is not even routed).
 */
export function assertMockPort(harness = 'shot') {
	if (INLINED_WS_PORT === null) {
		console.warn(
			`[${harness}] could not read the client's own WebSocket port out of\n` +
				`       ${CLIENT_SOURCE}\n` +
				`       — falling back to config/constants.json (:${CONFIG_WS_PORT}). If that block was\n` +
				'       reshaped, fix the regex here: the harness routes the page by this port.'
		);
	} else if (INLINED_WS_PORT !== CONFIG_WS_PORT) {
		// Neither copy can be trusted while they disagree, and the failure this
		// prevents is a capture of the live set rather than the scene.
		console.error(
			`[${harness}] the client dials :${INLINED_WS_PORT} (hardcoded in WebSocketConnection.ts)\n` +
				`       but config/constants.json says :${CONFIG_WS_PORT}. Reconcile them before taking\n` +
				'       a screenshot: the harness intercepts one port, and a page dialling the\n' +
				'       other reaches whatever really holds it — a running bridge, i.e. your\n' +
				'       live Ableton set.'
		);
		process.exit(2);
	}
	if (process.env.SHOT_MOCK_PORT && Number(process.env.SHOT_MOCK_PORT) !== CLIENT_WS_PORT) {
		console.error(
			`[${harness}] SHOT_MOCK_PORT=${process.env.SHOT_MOCK_PORT} is not honoured: the built\n` +
				`       client always dials :${CLIENT_WS_PORT} (constants.osc.webSocket.port), so moving\n` +
				'       the mock by hand leaves the page talking to whatever else holds that\n' +
				'       port — a running bridge, which captures your live set. You no longer\n' +
				'       need it: the harness picks a free port itself when the bridge is up\n' +
				"       and routes the page's socket to the mock. Unset it and run again."
		);
		process.exit(2);
	}
}

export const exists = async (p) => {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
};

export function run(cmd, args, opts = {}) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
		child.on('error', rejectRun);
		child.on('exit', (code) =>
			code === 0 ? resolveRun() : rejectRun(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
		);
	});
}

/**
 * Every port a server's startup output says it is listening on — vite's
 * `➜  Local:   http://127.0.0.1:4173/` line, colour codes stripped, since a
 * caller's FORCE_COLOR would otherwise wrap the port in them.
 */
export function announcedPorts(text) {
	const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
	return [...plain.matchAll(/https?:\/\/[^\s/:]+:(\d+)/g)].map((m) => Number(m[1]));
}

/** How much of a child's output an error quotes. */
const OUTPUT_TAIL = 4000;

/**
 * Resolve once `child` has announced it is listening on `port` AND `url`
 * answers. Reject the moment the child exits or fails to spawn first, or
 * when `timeoutMs` passes without both.
 *
 * Both halves, because an answer alone proves nothing about WHO answered.
 * With `--strictPort`, vite that cannot bind prints its error and exits — it
 * never announces a URL — so an announcement of our port means our child
 * holds it. The exit watch turns that bind failure into an error the moment
 * it happens. Before this, `startPreview` polled `url` alone and discarded
 * the child's output, so a preview server some other checkout had left on
 * the port answered the poll and the whole run drove THAT build: measured
 * 2026-09-24, a probe asserted against another session's worktree and every
 * check came back "nothing happened".
 *
 * The child's stdout and stderr stay drained after it resolves (a full pipe
 * would stall its logging); only the last {@link OUTPUT_TAIL} characters
 * are kept, for the error messages.
 */
export function waitForOwnServer(child, { url, port, timeoutMs = 30_000, pollMs = 250 }) {
	return new Promise((resolveOwn, rejectOwn) => {
		let output = '';
		let announced = false;
		let settled = false;
		let timer = null;
		const deadline = Date.now() + timeoutMs;
		const tail = () => (output.trim() ? `\n  its output:\n    ${output.trim().split('\n').join('\n    ')}` : '');
		const finish = (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (err) rejectOwn(err);
			else resolveOwn();
		};
		const onData = (chunk) => {
			output = (output + chunk).slice(-OUTPUT_TAIL);
			if (!announced && announcedPorts(output).includes(port)) announced = true;
		};
		for (const stream of [child.stdout, child.stderr]) {
			stream?.setEncoding?.('utf8');
			stream?.on('data', onData);
		}
		const onExit = (code, signal) =>
			finish(
				new Error(
					`the preview server exited (${code === null ? `signal ${signal}` : `code ${code}`}) ` +
						`before serving :${port}${tail()}\n` +
						`  If the port is taken, SHOT_PREVIEW_PORT=<free port> moves the preview.`
				)
			);
		child.once('exit', onExit);
		child.once('error', (err) =>
			finish(new Error(`the preview server failed to start: ${err.message}${tail()}`))
		);
		if (child.exitCode !== null || child.signalCode !== null) {
			onExit(child.exitCode, child.signalCode);
			return;
		}
		const poll = async () => {
			if (settled) return;
			if (announced) {
				try {
					// Bounded, or a server that accepts and never replies would park
					// this poll — and with it the deadline — forever.
					const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
					if (res.ok) return finish(null);
				} catch {
					/* announced but not answering yet */
				}
			}
			if (settled) return;
			if (Date.now() >= deadline) {
				return finish(
					new Error(
						announced
							? `the preview server announced :${port} but ${url} did not answer within ${timeoutMs} ms${tail()}`
							: `the preview server never announced :${port} within ${timeoutMs} ms — ` +
									`whatever answers there is not the server this run started${tail()}`
					)
				);
			}
			timer = setTimeout(poll, pollMs);
		};
		poll();
	});
}

/**
 * Who holds `port`, best effort: `lsof` names the listening PID, `ps` its
 * command line, `lsof -d cwd` the checkout it runs in — which is the useful
 * part when several worktrees each run their own preview. Null where `lsof`
 * does not exist (a Linux web session) or names nothing.
 */
export function describePortHolder(port) {
	const quiet = { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] };
	try {
		const pid = /^p(\d+)$/m.exec(
			execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], quiet)
		)?.[1];
		if (!pid) return null;
		let command = '';
		let cwd = '';
		try {
			command = execFileSync('ps', ['-o', 'command=', '-p', pid], quiet).trim();
		} catch {
			/* gone, or no ps */
		}
		try {
			cwd = /^n(.+)$/m.exec(execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], quiet))?.[1] ?? '';
		} catch {
			/* gone */
		}
		const short = command.length > 160 ? `${command.slice(0, 157)}...` : command;
		return `PID ${pid}${short ? ` (${short})` : ''}${cwd ? ` in ${cwd}` : ''}`;
	} catch {
		return null;
	}
}

/**
 * The `node_modules/.bin/vite` nearest above `from` — the file `npx vite` ran,
 * found by the same upward walk (with the workspace's hoisting, the repo
 * root's). Null when there is none: `npm install` has not run.
 *
 * Run with this process's own node it is ONE process, so the child
 * {@link startPreview} returns is the server itself — see
 * {@link stopPreview} for what the `npx` in between used to cost. The path
 * keeps the command line's `…/.bin/vite preview --port N` shape, which is
 * what `pgrep -f 'vite preview'` matches and {@link describePortHolder} prints.
 */
export function findViteBin(from = INTERFACE_DIR) {
	for (let dir = from; ; dir = dirname(dir)) {
		const bin = join(dir, 'node_modules', '.bin', 'vite');
		if (existsSync(bin)) return bin;
		if (dirname(dir) === dir) return null;
	}
}

/**
 * Start `vite preview` on `port` ({@link PREVIEW_PORT} unless a caller says
 * otherwise), building first if there is no build yet. Stop it with
 * {@link stopPreview}, never `kill()` alone.
 *
 * Two guards, so that a preview this run did not start can never stand in
 * for it:
 *  - **Refuse a port something already answers on**, before anything else —
 *    before a ~45 s build, too. A {@link portInUse} CONNECT probe, not a bind:
 *    on macOS a `127.0.0.1` bind succeeds beside a `*:PORT` listener, so a
 *    bind probe would call the port free.
 *  - **Trust only the server that says it is ours** ({@link waitForOwnServer}):
 *    `--strictPort` makes vite exit rather than move when it cannot bind,
 *    and its announcement and its exit are both watched, so a server that
 *    takes the port between the probe and the bind fails the run too.
 * Either way the error says which port, who holds it, and how to move.
 * See the README's "Pixel diffs" section for what a foreign or leftover
 * server used to cost.
 */
export async function startPreview({ log = () => {}, quiet = false, port = PREVIEW_PORT } = {}) {
	if (await portInUse(port)) {
		const holder = describePortHolder(port);
		throw new Error(
			`:${port} is already answering${holder ? ` — held by ${holder}` : ''}.\n` +
				'  A preview server this run did not start would be driven as if it were this\n' +
				"  checkout's build. Stop it, or move this run: SHOT_PREVIEW_PORT=<free port>."
		);
	}
	if (!(await exists(BUILD_MARKER))) {
		log('no production build found — running npm run build (one-off, ~45s)');
		await run('npm', ['run', 'build'], {
			cwd: REPO_ROOT,
			stdio: quiet ? 'ignore' : 'inherit'
		});
	}
	const viteBin = findViteBin();
	if (!viteBin) throw new Error(`no node_modules/.bin/vite above ${INTERFACE_DIR} — run npm install`);
	log(`starting preview server on :${port}`);
	const child = spawn(
		process.execPath,
		[viteBin, 'preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'],
		{
			cwd: INTERFACE_DIR,
			// Piped, not ignored: the announcement is how we know the server is
			// ours, and the error text is what a bind failure gets reported with.
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, NO_COLOR: '1' },
			// In this process's group on purpose: a Ctrl-C at the terminal signals
			// the whole foreground group, so the preview dies with a run that never
			// reached its teardown. Detached, it would outlive every such run.
			detached: false
		}
	);
	try {
		await waitForOwnServer(child, { url: `http://127.0.0.1:${port}/`, port });
	} catch (err) {
		await stopPreview(child);
		throw err;
	}
	return child;
}

/**
 * Start the server a capture drives, and say where it is.
 *
 * **`dev` (the default since 2026-09-26):** `vite dev` on {@link DEV_PORT},
 * started once and LEFT RUNNING, so the next run finds it warm
 * ({@link ensureDevServer}). No build: the page is the source as it stands,
 * and vite's file watcher keeps it so between runs. Measured on a Linux
 * container: a production build is 41 s of every ~60 s edit-and-look round; a
 * cold dev server is no better (~30 s to compile the page the first time), but
 * a warm one loads it in ~3 s. `npm run shot:stop` stops it.
 *
 * **`prod`:** the production build under `vite preview` on
 * {@link PREVIEW_PORT} — what `npm run ipad` serves and what the iPad runs.
 * It photographs the LAST build (building only when there is none), so run
 * `npm run build` after a source change. Use it to check the shipped bundle
 * itself: minification, the PWA service worker, code splitting. It is stopped
 * when the run ends.
 *
 * @returns {Promise<{ baseUrl: string, mode: 'dev'|'prod', stop: () => Promise<void> }>}
 */
export async function startServer({ mode = 'dev', log = () => {}, quiet = false } = {}) {
	if (mode === 'prod') {
		const child = await startPreview({ log, quiet });
		return { baseUrl: `http://127.0.0.1:${PREVIEW_PORT}`, mode, stop: () => stopPreview(child) };
	}
	const baseUrl = await ensureDevServer({ log });
	return { baseUrl, mode: 'dev', stop: async () => {} };
}

const CACHE_DIR = join(REPO_ROOT, 'scripts', '.cache');
const DEV_STATE = join(CACHE_DIR, 'shot-dev-server.json');
const DEV_LOG = join(CACHE_DIR, 'shot-dev-server.log');

/** The warm dev server this checkout left running, or null. */
function ownDevServer() {
	let state;
	try {
		state = JSON.parse(readFileSync(DEV_STATE, 'utf8'));
	} catch {
		return null;
	}
	if (!Number.isInteger(state?.pid) || state.port !== DEV_PORT) return null;
	try {
		process.kill(state.pid, 0);
	} catch {
		return null;
	}
	// The pid alone could be recycled: its command line must still be our
	// vite, on our port.
	try {
		const args = execFileSync('ps', ['-p', String(state.pid), '-o', 'args='], { encoding: 'utf8' });
		if (!args.includes('vite') || !args.includes(' dev ') || !args.includes(`--port ${DEV_PORT}`)) return null;
	} catch {
		return null;
	}
	return state;
}

/**
 * The dev server's URL, starting it when this checkout has none running.
 *
 * Detached, with its output in `scripts/.cache/shot-dev-server.log`, so it
 * outlives the run that started it; its pid and port go in
 * `scripts/.cache/shot-dev-server.json`, which is how a later run knows the
 * server on {@link DEV_PORT} is this checkout's and not someone else's — the
 * same refusal {@link startPreview} makes, kept for a server that persists.
 * Each run then loads the page once before its captures start, which is where
 * a cold server spends its ~30 s.
 */
export async function ensureDevServer({ log = () => {} } = {}) {
	const baseUrl = `http://127.0.0.1:${DEV_PORT}`;
	if (ownDevServer()) {
		log(`dev server already running on :${DEV_PORT} (npm run shot:stop stops it)`);
		return baseUrl;
	}
	if (await portInUse(DEV_PORT)) {
		const holder = describePortHolder(DEV_PORT);
		throw new Error(
			`:${DEV_PORT} is already answering${holder ? ` — held by ${holder}` : ''}, and not by a dev server\n` +
				"  this checkout started. It would be driven as if it were this checkout's source.\n" +
				'  Stop it, or move this run: SHOT_DEV_PORT=<free port>.'
		);
	}
	const viteBin = findViteBin();
	if (!viteBin) throw new Error(`no node_modules/.bin/vite above ${INTERFACE_DIR} — run npm install`);
	mkdirSync(CACHE_DIR, { recursive: true });
	const out = openSync(DEV_LOG, 'w');
	log(`starting dev server on :${DEV_PORT} — left running for the next run`);
	const child = spawn(
		process.execPath,
		[viteBin, 'dev', '--port', String(DEV_PORT), '--host', '127.0.0.1', '--strictPort'],
		{
			cwd: INTERFACE_DIR,
			stdio: ['ignore', out, out],
			env: { ...process.env, NO_COLOR: '1' },
			detached: true
		}
	);
	child.unref();
	closeSync(out);
	writeFileSync(DEV_STATE, JSON.stringify({ pid: child.pid, port: DEV_PORT, started: new Date().toISOString() }));

	const deadline = Date.now() + 60_000;
	const logTail = () => {
		try {
			return readFileSync(DEV_LOG, 'utf8').slice(-OUTPUT_TAIL).trim();
		} catch {
			return '';
		}
	};
	for (;;) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`the dev server exited before serving :${DEV_PORT}\n  its output:\n    ${logTail().split('\n').join('\n    ')}`);
		}
		if (announcedPorts(logTail()).includes(DEV_PORT)) break;
		if (Date.now() >= deadline) {
			throw new Error(`the dev server never announced :${DEV_PORT} within 60 s — see ${DEV_LOG}`);
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	return baseUrl;
}

/** Stop the dev server {@link ensureDevServer} left running. True if there was one. */
export async function stopDevServer() {
	const state = ownDevServer();
	try {
		unlinkSync(DEV_STATE);
	} catch {
		/* none recorded */
	}
	if (!state) return false;
	try {
		process.kill(state.pid, 'SIGTERM');
	} catch {
		return false;
	}
	for (let i = 0; i < 40; i++) {
		try {
			process.kill(state.pid, 0);
		} catch {
			return true;
		}
		await new Promise((r) => setTimeout(r, 125));
	}
	try {
		process.kill(state.pid, 'SIGKILL');
	} catch {
		/* gone */
	}
	return true;
}

/**
 * Load the page once and throw the result away: a cold dev server compiles
 * the whole app on the first load (~30 s measured), and a capture that paid
 * for that inside its settle time would photograph a half-styled page.
 * A no-op cost (~3 s) on a warm server.
 */
export async function warmPage(browser, baseUrl, { log = () => {} } = {}) {
	const started = Date.now();
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/`, { waitUntil: 'load', timeout: 180_000 });
		await page.waitForTimeout(500);
	} finally {
		await context.close();
	}
	const ms = Date.now() - started;
	if (ms > 5000) log(`dev server warmed in ${(ms / 1000).toFixed(1)} s (the next run skips this)`);
}

/** Send `signal` to `child`; resolve whether it has exited within `ms`. */
function signalAndWait(child, signal, ms) {
	return new Promise((resolveWait) => {
		if (child.exitCode !== null || child.signalCode !== null) return resolveWait(true);
		const onExit = () => {
			clearTimeout(timer);
			resolveWait(true);
		};
		const timer = setTimeout(() => {
			child.off('exit', onExit);
			resolveWait(false);
		}, ms);
		child.once('exit', onExit);
		child.kill(signal);
	});
}

/**
 * Stop a preview server {@link startPreview} started, and let go of it.
 *
 * SIGTERM — vite's preview closes its server and exits on it — then SIGKILL
 * if it is still running `graceMs` later, so a server stuck in its own close
 * cannot stick the harness instead. Resolves once it has exited.
 *
 * Then its stdout and stderr are destroyed, and that is the half that decides
 * whether this process can exit at all: the read end of a pipe is a live
 * handle, and the event loop waits on it for as long as ANY process holds the
 * write end — not only the child. Measured 2026-09-25 in a Linux container
 * (node 22, npm 10), when the child was still `npx vite preview`: npx forks
 * `sh -c "vite preview …"`, and Debian's sh is dash, which forks vite rather
 * than exec'ing it. `kill()` reached npx, npm passed the signal to sh, sh died
 * without passing it on, and vite was reparented to PID 1 — still serving the
 * port and still holding both pipes. `[shot] wrote …` printed and shot.mjs
 * never exited; tour.mjs, which ends in `process.exit()` (as multitouch.mjs
 * does), exited and left vite on the port, so the next run refused to start. On
 * macOS sh is bash, which execs a lone command, so the kill reached vite and
 * none of it showed. The child is vite itself now ({@link findViteBin}); the
 * destroy keeps anything it starts from doing the same.
 */
export async function stopPreview(child, { graceMs = 5000 } = {}) {
	if (!child) return;
	if (!(await signalAndWait(child, 'SIGTERM', graceMs))) await signalAndWait(child, 'SIGKILL', 2000);
	child.stdout?.destroy();
	child.stderr?.destroy();
}

/**
 * Launch Chromium, falling back to a system install when Playwright's
 * bundled browser is missing (a fresh clone that has not run
 * `npx playwright install`).
 */
export async function launchBrowser(chromium, { args = [], log = () => {} } = {}) {
	try {
		return await chromium.launch({ args });
	} catch (err) {
		const fallback = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
		if (!(await exists(fallback))) throw err;
		log(`bundled Chromium unavailable — falling back to ${fallback}`);
		return await chromium.launch({ executablePath: fallback, args });
	}
}

// `node scripts/shot/stack.mjs stop-dev` — `npm run shot:stop`.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	if (process.argv[2] === 'stop-dev') {
		const stopped = await stopDevServer();
		console.log(stopped ? `[shot] stopped the dev server on :${DEV_PORT}` : '[shot] no dev server running');
	} else {
		console.error('usage: node scripts/shot/stack.mjs stop-dev');
		process.exit(2);
	}
}
