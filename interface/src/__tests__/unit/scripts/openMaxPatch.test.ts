/**
 * The owner's standalone Max patch opens only while `features.maxUtilityPatch`
 * is on (general-release audit §7b). On a stranger's Mac the patch switches
 * Max's audio on at load and its omni `ctlin` turns a piano's soft pedal into
 * looper taps, so a general edition must never open it.
 *
 * Both launch sites go through `scripts/open-max-patch.js`: `npm run dev` as
 * `open:max`, `npm run ipad` by requiring it. These pin the switch's reading
 * and that neither site opens the patch around it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '../../../../..');
const { maxPatchEnabled, MAX_PATCH_PATH } = require(resolve(ROOT, 'scripts/open-max-patch.js'));


describe('open-max-patch', () => {
	it('opens the patch only for an explicit true', () => {
		expect(maxPatchEnabled({ features: { maxUtilityPatch: true } })).toBe(true);
		expect(maxPatchEnabled({ features: { maxUtilityPatch: false } })).toBe(false);
		expect(maxPatchEnabled({ features: {} })).toBe(false);
		expect(maxPatchEnabled({})).toBe(false);
	});

	it('points at the patch in the repo', () => {
		expect(existsSync(MAX_PATCH_PATH)).toBe(true);
	});

	it('is the only way either launch site opens the patch', () => {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		expect(pkg.scripts['open:max']).toContain('node scripts/open-max-patch.js');
		expect(JSON.stringify(pkg.scripts)).not.toContain('.maxpat');

		const ipad = readFileSync(resolve(ROOT, 'scripts/setup-ipad.js'), 'utf8');
		expect(ipad).toContain("require('./open-max-patch.js')");
		expect(ipad).toContain('maxPatchEnabled(constants)');
		expect(ipad).not.toContain('.maxpat');
	});

	it('is off in the tracked config: the rig turns it on in its local file', () => {
		const tracked = JSON.parse(readFileSync(resolve(ROOT, 'config/constants.json'), 'utf8'));
		expect(maxPatchEnabled(tracked)).toBe(false);
	});
});
