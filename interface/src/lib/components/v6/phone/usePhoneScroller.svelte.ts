/**
 * usePhoneScroller — the sideways scroller the phone's Mix and Clips tabs
 * share (ADR-503): one column per track at `PHONE_COLUMN_PITCH`, a scroll
 * position held by the layout so switching tabs keeps the same tracks in
 * front of you, and the ribbon's frame reported from it.
 *
 * Both tabs carried the same four effects; this is them once:
 *
 *  - **restore** — coming on screen, take up the layout's `scrollLeft`
 *    (hidden, the box is `display: none` and has none to keep);
 *  - **report** — the ribbon's window, on every scroll, on resize and when
 *    the column count changes (the tracks arrive after the first paint,
 *    and a rotation re-divides);
 *  - **follow** — the selected track's column scrolls into view (a ribbon
 *    tap, a selection from Live, a fold reshuffling the columns);
 *    `nearest` is a no-op for one already showing.
 *
 * The caller binds the box with `bind:this` and hands it over through
 * `getElement`, and wires `onscroll={scroller.handleScroll}`.
 */

import { tick, untrack } from 'svelte';
import { session } from '$lib/stores/session.svelte';
import { ribbonWindow } from '$lib/utils/phoneLayout';
import { PHONE_COLUMN_PITCH, PHONE_ROW_INSET } from './phoneGeometry';

export interface PhoneScrollerConfig {
	getElement: () => HTMLElement | null;
	/** True while this tab is the one on screen. */
	isActive: () => boolean;
	tracks: () => number[];
	/** The shared scroll position, read when the tab comes on screen. */
	scrollLeft: () => number;
	onScroll: (scrollLeft: number) => void;
	onWindow: (window: { start: number; end: number }) => void;
	/** Width pinned at the right edge (the Clips tab's scene rail). */
	pinned?: number;
}

export function usePhoneScroller(config: PhoneScrollerConfig) {
	function report() {
		const el = config.getElement();
		if (!el) return;
		config.onWindow(
			ribbonWindow({
				scrollLeft: el.scrollLeft,
				clientWidth: el.clientWidth,
				pitch: PHONE_COLUMN_PITCH,
				count: config.tracks().length,
				inset: PHONE_ROW_INSET,
				...(config.pinned !== undefined ? { pinned: config.pinned } : {})
			})
		);
	}

	// Restore on coming on screen.
	$effect(() => {
		const el = config.getElement();
		if (!config.isActive() || !el) return;
		tick().then(() => {
			el.scrollLeft = untrack(() => config.scrollLeft());
			report();
		});
	});

	// The ribbon's frame follows the box's size and the column count.
	$effect(() => {
		void config.tracks().length;
		const el = config.getElement();
		if (!config.isActive() || !el || typeof ResizeObserver === 'undefined') return;
		tick().then(report);
		const ro = new ResizeObserver(() => report());
		ro.observe(el);
		return () => ro.disconnect();
	});

	// The selected track's column stays on screen.
	$effect(() => {
		const idx = session.selectedTrackIndex;
		void config.tracks().join(',');
		const el = config.getElement();
		if (!config.isActive() || !el || idx < 0) return;
		tick().then(() =>
			el
				.querySelector(`[data-track-index="${idx}"]`)
				?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
		);
	});

	return {
		handleScroll(): void {
			const el = config.getElement();
			if (!el) return;
			config.onScroll(el.scrollLeft);
			report();
		}
	};
}
