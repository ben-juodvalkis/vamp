/**
 * The phone layout's pure decisions (ADR-503), kept out of the components so
 * they are table-tested without a layout.
 */

import constants from '$config/constants.json';

const { maxWidth, maxHeight } = constants.ui.phoneLayout;

/**
 * Does a screen this size get the phone layout? A phone held either way up
 * (393 x 852 portrait, 852 x 393 landscape) does, and so does an iPad's
 * Slide Over column; any iPad window bigger than that keeps the iPad layout.
 */
export function isPhoneViewport(width: number, height: number): boolean {
	return width <= maxWidth || height <= maxHeight;
}

/** The same test as a media query, for `matchMedia`. */
export const PHONE_MEDIA_QUERY = `(max-width: ${maxWidth}px), (max-height: ${maxHeight}px)`;

export type PhoneTab = 'mix' | 'clips' | 'track' | 'browse';

export const PHONE_TABS: readonly PhoneTab[] = ['mix', 'clips', 'track', 'browse'];

/** A stored tab name, or Mix when it is missing or not one of ours. */
export function parsePhoneTab(value: string | null | undefined): PhoneTab {
	return PHONE_TABS.includes(value as PhoneTab) ? (value as PhoneTab) : 'mix';
}

/**
 * Which of the ribbon's tracks the strips (or the clip columns) are showing,
 * as a `[start, end)` range in tracks, fractional at the edges.
 *
 * `pitch` is one column plus its gap; `inset` is the scroller's left padding
 * before the first column; `pinned` is the width a column pinned at the right
 * edge (the scene rail) covers, which hides the tracks scrolling under it.
 */
export function ribbonWindow(args: {
	scrollLeft: number;
	clientWidth: number;
	pitch: number;
	count: number;
	inset?: number;
	pinned?: number;
}): { start: number; end: number } {
	const { scrollLeft, clientWidth, pitch, count, inset = 0, pinned = 0 } = args;
	if (!(pitch > 0) || count <= 0) return { start: 0, end: 0 };
	const clampTracks = (x: number) => Math.min(count, Math.max(0, (x - inset) / pitch));
	const start = clampTracks(scrollLeft);
	const end = clampTracks(scrollLeft + clientWidth - pinned);
	return { start, end: Math.max(start, end) };
}
