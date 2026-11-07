/**
 * InstrumentBoard (ADR-512): an instrument's pages at full screen, in rows,
 * each tile as wide as its face columns and a hairline between two.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import InstrumentBoard, { boardRowColumns, type BoardRow } from '$lib/components/v6/central/InstrumentBoard.svelte';

afterEach(cleanup);

const ROWS: readonly BoardRow[] = [
	{ tiles: [{ id: 'osc1', cols: 8 }, { id: 'osc2', cols: 8 }], weight: 1.2 },
	{ tiles: [{ id: 'amp', cols: 4 }, { id: 'env2', cols: 6 }, { id: 'global', cols: 3 }] }
];

const tile = createRawSnippet((id: () => string) => ({ render: () => `<div data-page="${id()}">${id()}</div>` }));

describe('InstrumentBoard', () => {
	it('draws every tile once, in row order, each with its page', () => {
		const { container } = render(InstrumentBoard, { rows: ROWS, tile });
		const tiles = [...container.querySelectorAll<HTMLElement>('[data-board-tile]')];
		expect(tiles.map((t) => t.dataset.boardTile)).toEqual(['osc1', 'osc2', 'amp', 'env2', 'global']);
		expect(tiles.map((t) => t.querySelector('[data-page]')?.textContent)).toEqual(['osc1', 'osc2', 'amp', 'env2', 'global']);
	});

	it('gives a tile its face columns as its share of the row, and a row its weight', () => {
		const { container } = render(InstrumentBoard, { rows: ROWS, tile });
		const env2 = container.querySelector<HTMLElement>('[data-board-tile="env2"]')!;
		expect(env2.style.flexGrow).toBe('6');
		const rows = container.querySelectorAll<HTMLElement>('.board-row');
		expect(rows[0].style.flexGrow).toBe('1.2');
		expect(rows[1].style.flexGrow).toBe('1');
	});

	it('puts a hairline between two tiles and between two rows, never at an edge', () => {
		const { container } = render(InstrumentBoard, { rows: ROWS, tile });
		expect(container.querySelectorAll('.board-seam')).toHaveLength(3);
		expect(container.querySelectorAll('.board-rule')).toHaveLength(1);
	});

	it('counts a row by its columns', () => {
		expect(boardRowColumns(ROWS)).toEqual([16, 13]);
	});
});
