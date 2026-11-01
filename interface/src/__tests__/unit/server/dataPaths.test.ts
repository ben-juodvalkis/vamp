/**
 * The three folders (installer.plan.md Phase 1): the server's
 * `runtimeConfig.ts` and the bridge's `dataPaths.js` give the same answers,
 * from the environment when installed and from the checkout when not.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { dataDir, devicesDir, localConstantsPath, repoRoot, _resetRuntimeConfigForTests } from '$lib/server/runtimeConfig';

const require = createRequire(import.meta.url);
const bridge = require('../../../../bridge/utils/dataPaths.js');

const KEYS = ['VAMP_APP_ROOT', 'VAMP_DATA', 'VAMP_DEVICES'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	_resetRuntimeConfigForTests();
});

describe('data paths', () => {
	it('a clone writes into the checkout, as before', () => {
		for (const k of KEYS) delete process.env[k];
		const root = repoRoot();
		expect(bridge.appRoot()).toBe(root);
		for (const [kind, want] of [
			['config', join(root, 'config')],
			['logs', join(root, 'logs')],
			['cache', join(root, 'scripts', '.cache')]
		] as const) {
			expect(dataDir(kind)).toBe(want);
			expect(bridge.dataDir(kind)).toBe(want);
		}
		expect(devicesDir()).toBe(join(root, 'Vamp Devices'));
		expect(bridge.devicesDir()).toBe(join(root, 'Vamp Devices'));
		expect(localConstantsPath()).toBe(join(root, 'config', 'constants.local.json'));
	});

	it('installed, every folder comes from the environment', () => {
		process.env.VAMP_APP_ROOT = '/App/Vamp.app/Contents/Resources/vamp';
		process.env.VAMP_DATA = '/Users/u/Library/Application Support/Vamp';
		process.env.VAMP_DEVICES = '/Users/u/Music/Vamp/Vamp Devices';
		for (const kind of ['config', 'logs', 'cache'] as const) {
			expect(dataDir(kind)).toBe(join(process.env.VAMP_DATA, kind));
			expect(bridge.dataDir(kind)).toBe(dataDir(kind));
		}
		expect(repoRoot()).toBe(process.env.VAMP_APP_ROOT);
		expect(bridge.appRoot()).toBe(process.env.VAMP_APP_ROOT);
		expect(devicesDir()).toBe(process.env.VAMP_DEVICES);
		expect(bridge.devicesDir()).toBe(process.env.VAMP_DEVICES);
		expect(localConstantsPath()).toBe(join(process.env.VAMP_DATA, 'config', 'constants.local.json'));
	});
});
