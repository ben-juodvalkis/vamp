import { getContext, setContext, type Snippet } from 'svelte';

/**
 * Pictures for a panel's long picks, by parameter name: a view that can
 * draw a value (Operator's algorithms) hands the snippet to its panel, and
 * the pick's open grid draws it in each cell over the value's name.
 */
export type PickArt = Readonly<Record<string, Snippet<[number]>>>;

const KEY = Symbol('panel-pick-art');

export function providePickArt(art: PickArt): void {
	setContext(KEY, art);
}

export function usePickArt(): PickArt | undefined {
	return getContext<PickArt | undefined>(KEY);
}
