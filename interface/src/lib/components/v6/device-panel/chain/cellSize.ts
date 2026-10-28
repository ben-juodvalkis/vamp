/**
 * How much room a chain cell gives its face, across and down (ADR-492,
 * 2026-10-28).
 *
 * The chain overview's cells are as wide as the chain leaves them: a short
 * chain gives each device a broad cell, a long one or a two-row chain a
 * narrow one. A face that can draw itself more than one way reads its
 * cell's size here and picks the way that fits, instead of measuring
 * itself. `CellSize` provides it around every face in the chain; anywhere
 * else (a browser tile, a central view) there is none, and a face draws
 * its default.
 */
import { getContext, setContext } from 'svelte';

/** A cell's width, in three steps. */
export type CellWidthClass = 'narrow' | 'medium' | 'wide';
/** A cell's height, in two: a two-row chain's cells are short. */
export type CellHeightClass = 'short' | 'tall';

export interface CellSize {
	/** CSS px of the face's area; 0 until measured. */
	readonly width: number;
	readonly height: number;
	/** `width` in steps (`cellWidthClass`); null until measured. */
	readonly widthClass: CellWidthClass | null;
	/** `height` in steps (`cellHeightClass`); null until measured. */
	readonly heightClass: CellHeightClass | null;
}

/**
 * The steps' lower bounds. Wide is room for four 56px tiles side by side
 * (a Drum Rack's row of pads, as Live draws it); medium for two controls.
 */
export const CELL_WIDTH_STEPS = { medium: 120, wide: 236 } as const;

/**
 * Tall's lower bound. On the iPad a one-row chain leaves a face about
 * 260px, a two-row chain about 115px; this sits between them.
 */
export const CELL_TALL_MIN = 180;

export function cellWidthClass(width: number): CellWidthClass | null {
	if (!(width > 0)) return null;
	if (width >= CELL_WIDTH_STEPS.wide) return 'wide';
	if (width >= CELL_WIDTH_STEPS.medium) return 'medium';
	return 'narrow';
}

export function cellHeightClass(height: number): CellHeightClass | null {
	if (!(height > 0)) return null;
	return height >= CELL_TALL_MIN ? 'tall' : 'short';
}

const KEY = Symbol('chain-cell-size');

/** For `CellSize`: provide a getter, since the size changes under a mounted face. */
export function provideCellSize(get: () => CellSize): void {
	setContext(KEY, get);
}

/** The cell's size, or null outside a chain cell. Call during component init; read the getter in a `$derived`. */
export function useCellSize(): () => CellSize | null {
	const get = getContext<(() => CellSize) | undefined>(KEY);
	return () => get?.() ?? null;
}
