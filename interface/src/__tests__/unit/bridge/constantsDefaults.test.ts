/**
 * `config/constants.json` alone has to be able to boot the bridge: it is what
 * a fresh clone runs on (general-release plan.md §3). A Mac's own values sit
 * in `config/constants.local.json`, gitignored, so nothing the tracked file
 * leaves to it may be something the bridge needs to start.
 *
 * Swap audit H2 was "the documented fresh install kills the bridge at require
 * time": `createAxHelperClient` threw at `enhanced-osc-bridge.js`'s module top
 * level over a missing `axHelper` block, before a single port opened. Running
 * the documented install on the rig (2026-09-15) found the class had survived
 * in three more places, each a module-level read of a block the fresh-install
 * config (then `constants.json.example`, retired 2026-09-27) did not carry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../..');

type Constants = {
	osc: Record<string, Record<string, unknown>> & { webSocket: { port: number } };
	features: Record<string, unknown>;
	paths?: { placesRoots?: Record<string, unknown> };
};
const tracked = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'constants.json'), 'utf8')) as Constants;

describe('config/constants.json', () => {
	it('names the WebSocket port the client dials', () => {
		// `WebSocketConnection.ts` carries its own copy of the port rather than
		// importing the config (SSR). Moving only the config left the bundle
		// dialling the old port, so the two have to agree.
		const client = readFileSync(
			join(REPO_ROOT, 'interface/src/lib/api/connection/WebSocketConnection.ts'),
			'utf8'
		);
		const inlined = /webSocket:\s*\{\s*port:\s*(\d+)\s*\}/.exec(client);
		expect(inlined, 'the hardcoded webSocket port block moved').not.toBe(null);
		expect(Number(inlined?.[1])).toBe(tracked.osc.webSocket.port);
	});

	it('carries the port fields the UDP and TCP transports read', () => {
		const surface = tracked.osc.pythonSurface;
		expect(surface, 'osc.pythonSurface').toBeDefined();
		for (const field of ['host', 'localPort', 'remotePort', 'tcpPort']) {
			expect(surface?.[field], `osc.pythonSurface.${field}`).toBeDefined();
		}
		expect(tracked.osc.loopingRecorder?.localPort, 'osc.loopingRecorder.localPort').toBeDefined();
	});

	it('is the general edition: every owner-only switch off', () => {
		// The owner's rig turns them on in its local file.
		const on = Object.entries(tracked.features).filter(([k, v]) => !k.startsWith('_') && v !== false);
		expect(on).toEqual([]);
	});

	it('no longer needs a Permute Place in the config', () => {
		// `devicePresets.ts` used to build Permute's path from
		// `paths.placesRoots.Permute`. Since 2026-09-26 the load names the
		// "Vamp Devices" Place and the surface, which knows where the checkout
		// is, fills the path in (onboarding.plan.md §6.3).
		expect(tracked.paths?.placesRoots, 'paths.placesRoots').toBeUndefined();
	});
});
