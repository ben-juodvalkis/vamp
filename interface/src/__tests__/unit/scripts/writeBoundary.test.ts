/**
 * The write-boundary gate (issue #7): no component imports the OSC client.
 *
 * `scripts/check-write-boundary.mjs` runs here, so it runs in the gate
 * and in CI with vitest. These pin the two things it has to get right:
 * every way of spelling the import is caught, and an import named in
 * prose is not.
 */

import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
	violationsIn,
	scan,
	COMPONENTS_ROOT
} from '../../../../../scripts/check-write-boundary.mjs';

describe('violationsIn', () => {
	it('catches the alias import', () => {
		const src = "import { send } from '$lib/api/simpleClient';";
		expect(violationsIn(src, '.ts', 'x.ts')).toHaveLength(1);
	});

	it('catches a relative path, a .js suffix, double quotes', () => {
		const src = [
			"import { send } from '../../api/simpleClient';",
			'import { send as s } from "$lib/api/simpleClient.js";'
		].join('\n');
		const hits = violationsIn(src, '.ts', 'x.ts');
		expect(hits.map((h) => h.line)).toEqual([1, 2]);
	});

	it('catches dynamic and side-effect imports', () => {
		const src = [
			"const m = await import('$lib/api/simpleClient');",
			"import '$lib/api/simpleClient';"
		].join('\n');
		expect(violationsIn(src, '.ts', 'x.ts')).toHaveLength(2);
	});

	it('catches the import inside a .svelte script', () => {
		const src = [
			'<script lang="ts">',
			"\timport { send } from '$lib/api/simpleClient';",
			'</script>',
			"<p>It's fine</p>"
		].join('\n');
		const hits = violationsIn(src, '.svelte', 'X.svelte');
		expect(hits).toHaveLength(1);
		expect(hits[0].line).toBe(2);
	});

	it('ignores the import named in a comment or in markup prose', () => {
		const src = [
			'<script lang="ts">',
			"\t// used to: import { send } from '$lib/api/simpleClient';",
			"\timport { setTempo } from '$lib/services/sessionCommands';",
			'</script>',
			"<!-- import { send } from '$lib/api/simpleClient' -->"
		].join('\n');
		expect(violationsIn(src, '.svelte', 'X.svelte')).toEqual([]);
	});

	it('leaves other api modules and look-alikes alone', () => {
		const src = [
			"import { V3_CLIP_SET_LOOP_END_ADDRESS } from '$lib/api/handlers/v3Clip';",
			"import { x } from '$lib/api/simpleClientMock';"
		].join('\n');
		expect(violationsIn(src, '.ts', 'x.ts')).toEqual([]);
	});
});

describe('the repository itself', () => {
	it('scans a components directory that exists', () => {
		// A moved directory would make the scan below pass on nothing.
		expect(existsSync(COMPONENTS_ROOT)).toBe(true);
	});

	it('has no component importing the OSC client', async () => {
		const hits = await scan();
		expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
	});
});
