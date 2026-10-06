import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ControlGlyph from '$lib/components/v6/device-panel/ControlGlyph.svelte';
import { CONTROL_GLYPHS } from '$lib/config/controlGlyphMap';

describe('ControlGlyph', () => {
	it.each(CONTROL_GLYPHS.map((n) => [n]))('draws %s', (name) => {
		const { container } = render(ControlGlyph, { props: { name } });
		const svg = container.querySelector('svg')!;
		expect(svg.children.length).toBeGreaterThan(0);
	});
});
