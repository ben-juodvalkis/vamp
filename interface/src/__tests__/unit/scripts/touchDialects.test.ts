/**
 * The pointer-invariant gate (ADR-427), and the masking it depends on.
 *
 * `scripts/check-touch-dialects.mjs` runs in `.githooks/pre-push`. What
 * makes it worth anything is that it distinguishes CODE from PROSE:
 * several of the components this program touched now carry a comment
 * saying exactly what they used to read and why it was wrong, and a
 * `grep` counts those as violations. A gate that cries wolf on its own
 * documentation is a gate everybody passes with `--no-verify`.
 *
 * The other half is that it still catches the real thing. The end-to-end
 * proof of that is not repeatable from here — it was running the scanner
 * over `main`'s tree, where it found all 17 `touches[0]` sites and all 12
 * performance-surface `onclick`s at their exact lines — so these pin the
 * behaviours that made it possible.
 */

import { describe, it, expect } from 'vitest';
import {
	maskScript,
	maskMarkup,
	maskStyle,
	maskSource,
	violationsIn,
	scan,
	PERFORMANCE_SURFACE
} from '../../../../../scripts/check-touch-dialects.mjs';

/** Every mask must preserve length and newlines, or line numbers lie. */
function expectSameShape(masked: string, source: string) {
	expect(masked).toHaveLength(source.length);
	expect(masked.split('\n')).toHaveLength(source.split('\n').length);
}

describe('maskScript', () => {
	it('masks line comments', () => {
		const src = "const a = 1; // touches[0]\nconst b = 2;";
		const out = maskScript(src);
		expect(out).not.toContain('touches[0]');
		expect(out).toContain('const b = 2;');
		expectSameShape(out, src);
	});

	it('masks block comments across lines', () => {
		const src = "/*\n * touches[0] was wrong\n */\nconst c = 3;";
		const out = maskScript(src);
		expect(out).not.toContain('touches[0]');
		expect(out).toContain('const c = 3;');
		expectSameShape(out, src);
	});

	it('masks string contents but keeps the quotes', () => {
		const src = `const s = 'touches[0]';`;
		const out = maskScript(src);
		expect(out).not.toContain('touches[0]');
		expect(out).toContain("'");
		expectSameShape(out, src);
	});

	it('does not let a URL inside a string swallow the rest of the line', () => {
		// The `//` in `https://` is the classic false positive for a naive
		// comment stripper: it would blank everything after it.
		const src = `const url = 'https://x'; const y = event.touches[0];`;
		const out = maskScript(src);
		expect(out).toContain('touches[0]');
		expectSameShape(out, src);
	});

	it('respects escapes inside strings', () => {
		const src = `const s = 'a\\'b'; const y = touches[0];`;
		expect(maskScript(src)).toContain('touches[0]');
	});

	it('leaves real code alone', () => {
		const src = 'const y = event.touches[0].clientY;';
		expect(maskScript(src)).toBe(src);
	});
});

describe('maskMarkup / maskStyle', () => {
	it('masks HTML comments', () => {
		const src = '<!-- it used to be onclick -->\n<div use:press></div>';
		const out = maskMarkup(src);
		expect(out).not.toContain('onclick');
		expect(out).toContain('use:press');
		expectSameShape(out, src);
	});

	it('masks CSS block comments', () => {
		const src = '/* onclick lived here */\n.a { color: red; }';
		const out = maskStyle(src);
		expect(out).not.toContain('onclick');
		expect(out).toContain('color: red');
		expectSameShape(out, src);
	});
});

describe('maskSource on .svelte', () => {
	const svelte = [
		'<script lang="ts">',
		"  // the old read was touches[0]",
		'  const ok = 1;',
		'</script>',
		'',
		'<!-- this used to be onclick -->',
		"<div>Live's own browser</div>",
		'<button onclick={go}>go</button>',
		'',
		'<style>',
		'  /* onclick */',
		'  .a { color: red; }',
		'</style>'
	].join('\n');

	it('masks each region with the right lexer', () => {
		const out = maskSource(svelte, '.svelte');
		expectSameShape(out, svelte);
		// Comment occurrences in all three regions are gone…
		expect(out.split('onclick')).toHaveLength(2); // exactly one survivor
		expect(out).not.toContain('touches[0]');
		// …and the one real attribute survives.
		expect(out).toContain('onclick={go}');
	});

	it('does not treat an apostrophe in markup as a string literal', () => {
		// This is why a .svelte file is lexed in three parts. One JS lexer
		// over the whole file reads `Live's` as an unterminated string and
		// masks everything after it — including the onclick two lines down.
		const out = maskSource(svelte, '.svelte');
		expect(out).toContain('onclick={go}');
		expect(out).toContain('color: red');
	});
});

describe('violationsIn', () => {
	it('flags touches[0] anywhere in lib', () => {
		const hits = violationsIn('const y = e.touches[0].clientY;', 'services/whatever.ts');
		expect(hits.map((h) => h.rule)).toEqual(['touches-index']);
	});

	it('flags changedTouches[0] too', () => {
		const hits = violationsIn('e.changedTouches[0]', 'utils/x.ts');
		expect(hits).toHaveLength(1);
	});

	it('tolerates whitespace inside the index', () => {
		expect(violationsIn('touches [ 0 ]', 'utils/x.ts')).toHaveLength(1);
	});

	it('does not flag a different index', () => {
		expect(violationsIn('touches[1]', 'utils/x.ts')).toEqual([]);
		expect(violationsIn('touches.length', 'utils/x.ts')).toEqual([]);
	});

	it('flags onclick only under the performance surface', () => {
		const inside = violationsIn('<button onclick={go}>', 'components/v6/tracks/A.svelte');
		expect(inside.map((h) => h.rule)).toEqual(['onclick-performance-surface']);

		// Central views are one-at-a-time device panels — tier 4, and
		// deliberately out of scope. A gate that failed on 81 sites nobody
		// has a reason to change is a gate everybody bypasses.
		expect(violationsIn('<button onclick={go}>', 'components/v6/central/views/A.svelte')).toEqual(
			[]
		);
	});

	it('flags the legacy on:click spelling as well', () => {
		expect(violationsIn('<button on:click={go}>', 'components/v6/session/A.svelte')).toHaveLength(
			1
		);
	});

	it('reports the line the hit is on', () => {
		const hits = violationsIn('a\nb\nconst y = touches[0];', 'utils/x.ts');
		expect(hits[0].line).toBe(3);
	});

	it('names all five performance-surface directories', () => {
		// The list is the gate's whole scope; a directory quietly dropped
		// from it is a silent hole.
		expect(PERFORMANCE_SURFACE).toEqual([
			'components/v6/tracks',
			'components/v6/layout',
			'components/v6/session',
			'components/v6/clips',
			'components/v6/controls'
		]);
	});
});

describe('the repository itself', () => {
	it('has no banned dialect left in interface/src/lib', async () => {
		const hits = await scan();
		expect(
			hits.map((h) => `${h.file}:${h.line} ${h.rule}`),
			'ADR-427: use `use:press` / `use:drag` from $lib/actions'
		).toEqual([]);
	});
});
