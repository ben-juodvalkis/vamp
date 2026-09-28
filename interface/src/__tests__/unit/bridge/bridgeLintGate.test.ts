/**
 * The bridge lint gate must actually be pointed at the bridge.
 *
 * `npm run lint` shells out to ESLint with a glob. A glob that matches
 * *nothing* exits 0, so a scope typo — or a future move of `interface/bridge`
 * — would turn the gate off permanently while every run stayed green. This
 * repo has been bitten by exactly that shape before (`shot:check`, audit
 * finding #18, whose noise floor exceeds its own threshold and so passes
 * captures of a hard-failed app).
 *
 * So these tests assert the three things the hook itself cannot:
 *   1. the config resolves to real files, and to *all* of them;
 *   2. `no-undef` is actually switched on for a bridge path;
 *   3. the bridge is clean right now.
 *
 * (3) is the regression guard; (1) and (2) guard the guard.
 *
 * Rationale for the one-rule scope lives in `eslint.config.mjs`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const BRIDGE_DIR = join(REPO_ROOT, 'interface/bridge');

/**
 * The glob the gate actually runs, read out of the `lint` script rather than
 * duplicated here. Hardcoding it would make this file agree with itself while
 * the real gate pointed somewhere else — which is the failure being guarded
 * against, so it has to come from the same place `npm run lint` gets it.
 */
function lintGlobFromPackageJson(): string {
	const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
	const script: string | undefined = pkg.scripts?.lint;
	if (!script) throw new Error('root package.json has no `lint` script');
	const match = script.match(/'([^']+)'|"([^"]+)"/);
	if (!match) throw new Error(`cannot find a quoted glob in lint script: ${script}`);
	return match[1] ?? match[2];
}

const BRIDGE_GLOB = lintGlobFromPackageJson();

/** Every .js file under interface/bridge, found without going through ESLint. */
function bridgeJsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...bridgeJsFiles(full));
		else if (entry.endsWith('.js')) out.push(full);
	}
	return out;
}

let eslint: ESLint;
beforeAll(() => {
	eslint = new ESLint({ cwd: REPO_ROOT });
});

describe('bridge lint gate', () => {
	it("the lint script's own glob reaches every .js file under interface/bridge", async () => {
		const onDisk = bridgeJsFiles(BRIDGE_DIR).sort();
		expect(onDisk.length).toBeGreaterThan(0);

		const results = await eslint.lintFiles([BRIDGE_GLOB]);
		expect(results.map((r) => r.filePath).sort()).toEqual(onDisk);
	});

	it('has no-undef switched on for bridge files', async () => {
		const config = (await eslint.calculateConfigForFile(
			join(BRIDGE_DIR, 'transport/WebSocketServer.js')
		)) as { rules?: Record<string, unknown[]> };

		// ESLint normalises severities to numbers: 2 === "error".
		expect(config.rules?.['no-undef']?.[0]).toBe(2);
	});

	it('flags an identifier that was never required — the shipped-green bug class', async () => {
		// The real defect this rule exists for: `relayTotalMixLevel is not
		// defined` inside a connection handler. Every pure-function test
		// passed; the bridge logged a ReferenceError on every client connect.
		// See webSocketServerWiring.test.ts.
		const [result] = await eslint.lintText("relayTotalMixLevel(1);\n", {
			filePath: join(BRIDGE_DIR, 'handlers/synthetic.js')
		});

		expect(result.messages.map((m) => m.ruleId)).toContain('no-undef');
	});

	it('reports the bridge as clean', async () => {
		const results = await eslint.lintFiles([BRIDGE_GLOB]);
		const problems = results.flatMap((r) =>
			r.messages.map((m) => `${r.filePath.replace(REPO_ROOT + '/', '')}:${m.line} ${m.ruleId} ${m.message}`)
		);
		expect(problems).toEqual([]);
	});
});
