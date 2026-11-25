/**
 * Row windowing for the browser's preset grids (ADR-404).
 *
 * Only the preset rows intersecting the viewport (± overscan) are in the
 * DOM; grid padding stands in for the rest, so a multi-thousand-sample flat
 * leaf scrolls like a short one. Geometry is exact (uniform --tile-h rows
 * from the solver), so the window is pure arithmetic —
 * `computeVisibleWindow` / `computeGroupedVisibleWindow` in drillDownModel.
 * Folder grids stay unwindowed (their counts are bounded by catalog
 * structure, not library size).
 *
 * The host binds its two scrollers (`bind:this={windows.presetGridEl}`,
 * `windows.groupedScrollEl`), calls `schedule()` on their scroll, and reads
 * `presetWindow` / `groupedWindow`. The window recomputes whenever the
 * inputs change (level load, resize, scroller mount) and at most once a
 * frame on scroll; state only changes when the window crosses a row
 * boundary, so plain scrolling re-renders nothing.
 */
import { untrack } from 'svelte';
import {
	computeVisibleWindow,
	computeGroupedVisibleWindow,
	windowsEqual,
	groupedWindowsEqual,
	type VirtualWindow,
	type GroupedVirtualWindow,
	type GroupedSectionSpec
} from './utils/drillDownModel';

const OVERSCAN_ROWS = 3;

/** What to window, decided by the host for the screen on show. */
export type WindowInput =
	| { kind: 'none' }
	/** One flat grid in `presetGridEl`. */
	| { kind: 'flat'; count: number; viewportHeight: number; columns: number; tileHeight: number; gap: number }
	/** Headed sections in `groupedScrollEl`. */
	| {
			kind: 'grouped';
			sections: GroupedSectionSpec[];
			viewportHeight: number;
			columns: number;
			tileHeight: number;
			gap: number;
			sectionGap: number;
	  };

export class VirtualWindows {
	presetGridEl = $state<HTMLDivElement | undefined>(undefined);
	groupedScrollEl = $state<HTMLDivElement | undefined>(undefined);
	presetWindow = $state<VirtualWindow>({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
	groupedWindow = $state<GroupedVirtualWindow>({ sections: [], topPad: 0, bottomPad: 0 });

	private raf = 0;

	/** Call during component initialisation: it owns an `$effect`. */
	constructor(private input: () => WindowInput) {
		// The update reads every input, so this effect tracks them.
		$effect(() => {
			this.update();
		});
	}

	/** Scroll → recompute at most once per frame. */
	schedule = () => {
		if (this.raf) return;
		this.raf = requestAnimationFrame(() => {
			this.raf = 0;
			this.update();
		});
	};

	destroy() {
		// Guarded: onDestroy also runs during SSR, where cAF doesn't exist
		// (and `raf` is always 0 there — nothing schedules frames server-side).
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private update() {
		const input = this.input();
		if (input.kind === 'grouped') {
			const next = computeGroupedVisibleWindow({
				scrollTop: this.groupedScrollEl?.scrollTop ?? 0,
				viewportHeight: input.viewportHeight,
				sections: input.sections,
				columns: input.columns,
				tileHeight: input.tileHeight,
				gap: input.gap,
				sectionGap: input.sectionGap,
				overscanRows: OVERSCAN_ROWS
			});
			// untrack: the compare must not make the recompute effect depend on
			// the window it writes (one wasted re-run per commit otherwise).
			if (!groupedWindowsEqual(next, untrack(() => this.groupedWindow))) this.groupedWindow = next;
		} else if (input.kind === 'flat') {
			const next = computeVisibleWindow({
				scrollTop: this.presetGridEl?.scrollTop ?? 0,
				viewportHeight: input.viewportHeight,
				count: input.count,
				columns: input.columns,
				tileHeight: input.tileHeight,
				gap: input.gap,
				overscanRows: OVERSCAN_ROWS
			});
			if (!windowsEqual(next, untrack(() => this.presetWindow))) this.presetWindow = next;
		}
	}
}
