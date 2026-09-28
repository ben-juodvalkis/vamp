// @vitest-environment node
/**
 * The config is the tracked defaults with a Mac's gitignored
 * `constants.local.json` laid over them (general-release plan.md §3). The
 * bridge and the scripts merge through `bridge/utils/constants.js`, the
 * interface server through `runtimeConfig.ts`, the surface through
 * `config_loader.py` (its own tests): the three must merge alike.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { mergeConstants as serverMerge } from '$lib/server/runtimeConfig';

const require = createRequire(import.meta.url);
const { loadConstants, mergeConstants } = require('../../../../bridge/utils/constants.js');

const BASE = {
	features: { totalmix: false, expressionPedal: false, _note: 'doc' },
	audio: { defaultInputChannel: '1/2', description: 'd' },
	instruments: { transpose: { parameterNames: [{ name: 'pitch' }, { name: 'tune' }] } },
	osc: { webSocket: { port: 8081 } }
};
const LOCAL = {
	features: { expressionPedal: true },
	audio: { defaultInputChannel: '11/12 Guitar Mic' },
	instruments: { transpose: { parameterNames: [{ name: 'custom e' }] } },
	midiPedals: { channel: 10 }
};
const MERGED = {
	features: { totalmix: false, expressionPedal: true, _note: 'doc' },
	audio: { defaultInputChannel: '11/12 Guitar Mic', description: 'd' },
	instruments: { transpose: { parameterNames: [{ name: 'custom e' }] } },
	osc: { webSocket: { port: 8081 } },
	midiPedals: { channel: 10 }
};

describe('mergeConstants', () => {
	it('merges objects key by key and replaces anything else whole', () => {
		expect(mergeConstants(BASE, LOCAL)).toEqual(MERGED);
	});

	it('leaves both arguments as they were', () => {
		const base = structuredClone(BASE);
		const local = structuredClone(LOCAL);
		mergeConstants(base, local);
		expect(base).toEqual(BASE);
		expect(local).toEqual(LOCAL);
	});

	it('merges the same as the interface server', () => {
		expect(serverMerge(BASE, LOCAL)).toEqual(mergeConstants(BASE, LOCAL));
	});
});

describe('loadConstants', () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function files(local?: string) {
		dir = mkdtempSync(join(tmpdir(), 'looping-config-'));
		writeFileSync(join(dir, 'constants.json'), JSON.stringify(BASE));
		if (local !== undefined) writeFileSync(join(dir, 'constants.local.json'), local);
		return { constantsPath: join(dir, 'constants.json'), localPath: join(dir, 'constants.local.json') };
	}

	it('is the tracked file alone on a Mac with no local file', () => {
		expect(loadConstants(files())).toEqual(BASE);
	});

	it('lays the local file over it', () => {
		expect(loadConstants(files(JSON.stringify(LOCAL)))).toEqual(MERGED);
	});

	it('throws on a local file that is not JSON, rather than running the rig as a stranger', () => {
		expect(() => loadConstants(files('{ not json'))).toThrow();
	});
});
