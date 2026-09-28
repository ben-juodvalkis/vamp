// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

// `scripts/cleanup.sh` runs on every `npm run dev` / `ipad` / `interface`. Its
// process patterns ("vite preview", "npm.*dev", "concurrently") are substrings
// of a command line, and its port sweep `kill -9`s every socket holder — so
// both halves used to reach processes belonging to other projects and other
// applications entirely. Both are now scoped to processes whose working
// directory is inside this repo, and ports to actual listeners.
//
// `--list` is the non-destructive form: it resolves exactly the same two victim
// sets and prints them instead of signalling them.

function findRepoRoot(): string {
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		if (existsSync(path.join(dir, 'scripts', 'cleanup.sh'))) return dir;
		dir = path.dirname(dir);
	}
	throw new Error(`scripts/cleanup.sh not found above ${process.cwd()}`);
}

const REPO_ROOT = findRepoRoot();
const CLEANUP = path.join(REPO_ROOT, 'scripts', 'cleanup.sh');
const MARKER = `zzCLEANUPSCOPE${process.pid}zz`;

const spawned: ChildProcess[] = [];

/**
 * A long-lived process whose argv contains one of cleanup.sh's own patterns
 * ("vite preview") plus a marker unique to this test run. `node -e` rather than
 * `sh -c` on purpose: a shell exec-optimizes its final command and drops the
 * extra argv that carries the marker.
 */
function decoy(cwd: string, extraArgv: string[] = [`vite preview ${MARKER}`]): ChildProcess {
	const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', ...extraArgv], {
		cwd,
		stdio: 'ignore'
	});
	spawned.push(child);
	return child;
}

function list(): string {
	return execFileSync('/bin/bash', [CLEANUP, '--list'], {
		cwd: REPO_ROOT,
		encoding: 'utf-8',
		timeout: 30_000
	});
}

/** Poll `--list` until `predicate` holds, so we don't race process startup. */
function listUntil(predicate: (out: string) => boolean, tries = 30): string {
	let out = '';
	for (let i = 0; i < tries; i++) {
		out = list();
		if (predicate(out)) return out;
		execFileSync('/bin/sleep', ['0.1']);
	}
	return out;
}

afterAll(() => {
	for (const child of spawned) {
		try {
			child.kill('SIGKILL');
		} catch {
			/* already gone */
		}
	}
});

describe('cleanup.sh process scoping', () => {
	it('matches a dev-pattern process inside the repo but not the identical one outside it', () => {
		const inside = decoy(REPO_ROOT);
		const outside = decoy(os.tmpdir());
		expect(inside.pid).toBeDefined();
		expect(outside.pid).toBeDefined();

		const out = listUntil((o) => o.includes(MARKER));
		const hits = out.split('\n').filter((line) => line.includes(MARKER));

		// Both decoys carry the same marker and the same "vite preview" pattern.
		// The only thing separating them is the working directory.
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatch(new RegExp(`^\\s*${inside.pid}\\b`));
		expect(out).not.toMatch(new RegExp(`^\\s*${outside.pid}\\b`, 'm'));
	});
});

describe('cleanup.sh port scoping', () => {
	// 8890 is the status-page port from the script's own PORTS list. If something
	// already holds it the assertion below can't attribute the hit, so skip.
	const PORT = 8890;
	const portFree = (() => {
		try {
			const held = execFileSync('/bin/bash', ['-c', `lsof -t -i:${PORT} 2>/dev/null | head -1`], {
				encoding: 'utf-8'
			}).trim();
			return held === '';
		} catch {
			return true;
		}
	})();

	it.runIf(portFree)('sweeps the listener on a reserved port but not a client connected to it', async () => {
		const server = spawn(
			process.execPath,
			['-e', `require('net').createServer().listen(${PORT}, '127.0.0.1'); setTimeout(() => {}, 30000)`],
			{ cwd: REPO_ROOT, stdio: 'ignore' }
		);
		spawned.push(server);

		const client = spawn(
			process.execPath,
			[
				'-e',
				`const s = require('net').connect(${PORT}, '127.0.0.1'); s.on('error', () => {}); setTimeout(() => {}, 30000)`
			],
			{ cwd: os.tmpdir(), stdio: 'ignore' }
		);
		spawned.push(client);

		const out = listUntil((o) => new RegExp(`^\\s*${server.pid}\\b`, 'm').test(o));

		// The listener is what occupies the port; the client merely holds a socket
		// to it. Before the -sTCP:LISTEN filter, `lsof -i:<ports>` returned both —
		// which is how `kill -9` reached Chrome's network process (ESTABLISHED to
		// the dev server) on every startup.
		expect(out).toMatch(new RegExp(`^\\s*${server.pid}\\b`, 'm'));
		expect(out).not.toMatch(new RegExp(`^\\s*${client.pid}\\b`, 'm'));

		// Free the port for the next case.
		server.kill('SIGKILL');
		await once(server, 'exit');
	});

	it.runIf(portFree)("names a listener outside the repo but leaves it off the kill list", () => {
		// Someone else's server on a reserved port: another checkout's bridge,
		// or any node app on 3000. The sweep used to kill it.
		const server = spawn(
			process.execPath,
			['-e', `require('net').createServer().listen(${PORT}, '127.0.0.1'); setTimeout(() => {}, 30000)`],
			{ cwd: os.tmpdir(), stdio: 'ignore' }
		);
		spawned.push(server);

		const out = listUntil((o) => new RegExp(`^\\s*${server.pid}\\b`, 'm').test(o));
		const [kill, leftAlone] = out.split(/^left alone.*$/m);

		expect(leftAlone).toMatch(new RegExp(`^\\s*${server.pid}\\b`, 'm'));
		expect(kill).not.toMatch(new RegExp(`^\\s*${server.pid}\\b`, 'm'));
		server.kill('SIGKILL');
	});
});
