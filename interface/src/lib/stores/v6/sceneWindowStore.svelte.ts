/**
 * sceneWindowStore — the one shared scene-scroll window for session mode.
 *
 * Every strip's slot zone and the scene rail render the SAME window of
 * scenes: dragging vertically anywhere (any strip's grid, or the rail)
 * scrolls all of them together. That "one window, many viewports" model
 * is why the offset lives in a store instead of per-strip state — N
 * strips reading one number is what keeps their rows aligned with each
 * other and with the rail.
 *
 * Offset is measured in SCENE ROWS, not pixels: it is a float while a
 * drag is in flight and snaps to a whole row on release, so the grid
 * never rests mid-row. Callers do the px→rows conversion themselves
 * (they own the measured row height); the store only ever sees rows.
 *
 * `sceneCount` is derived, not stored. Live's session grid is
 * rectangular, so the scene count is the widest `track.slots` map in the
 * v3 normalized store. Scene add/remove restructures every track's
 * `clip_slots` and arrives as a `state/full` re-ride (ScenesComponent's
 * song-scope `scenes` listener), so deriving means the count follows
 * scene churn with no extra wire and no subscription to maintain.
 *
 * `visibleCount` is derived too, from how many sections the main-area
 * stack is showing — see `visibleCountForSections`.
 *
 * Clamping happens in three places, and each covers a case the others
 * can't:
 *
 *   - on WRITE, against the scene count known at the time
 *   - on READ, because deleting scenes strands a stored offset with
 *     nobody writing; the getter keeps every consumer correct in the
 *     same frame the count drops
 *   - via `clampToSceneCount()`, which persists that read-side clamp.
 *     A getter must not write `$state`, so the read clamp alone leaves
 *     `rawOffset` stale — and a later REGROW would then restore the
 *     pre-shrink row on its own. `SceneRail` drives this off the scene
 *     count AND the visible count while the grid is mounted; both can
 *     shrink the legal range (deleting scenes, or turning a section off
 *     so the window grows to cover more of the set).
 */

import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
import { logger } from '$lib/utils/logger';

/**
 * Scene rows on screen at once, as a function of how many sections the
 * main-area stack is showing (ADR-416: strips · clip grid · central
 * view · FX grid, every visible one an equal share of the height).
 *
 * The clip grid's section is `1/N` of the screen, so hiding the central
 * view and the FX grid roughly doubles its height — and the natural use
 * of that height is more scenes, not taller cells. These numbers keep
 * the row PITCH roughly constant (~48–56px on a 1024px-tall iPad)
 * across every configuration instead:
 *
 *   4 sections → 4 rows   (~244px section ÷ 5 rows ≈ 49px)
 *   3 sections → 6 rows   (~330px ÷ 7 ≈ 47px)
 *   2 sections → 8 rows   (~504px ÷ 9 ≈ 56px)
 *
 * (The divisor is rows + 1 — the stop row takes a share too.) A cell
 * has to stay tall enough for the 3-line clip-name clamp, which is what
 * stops this from simply being height ÷ some minimum: it is a small
 * table of tested configurations, not a formula.
 *
 * Pure and exported so the mapping is testable without a layout.
 */
export function visibleCountForSections(sectionCount: number): number {
	if (sectionCount >= 4) return 4;
	if (sectionCount === 3) return 6;
	return 8;
}

/**
 * Rows the window shows right now. Read fresh on every call, like
 * `computeSceneCount()`, so component `$derived` consumers re-run when
 * a section toggle flips.
 */
function computeVisibleCount(): number {
	return visibleCountForSections(uiPrefsStore.visibleSectionCount);
}

/**
 * Highest legal offset for a given grid — scrolling further would show
 * empty space past the last scene. Zero when the whole grid fits.
 */
export function maxOffsetFor(sceneCount: number, visibleCount: number): number {
	const max = sceneCount - visibleCount;
	return max > 0 ? max : 0;
}

/**
 * Clamp an offset into `[0, maxOffsetFor(...)]`. Non-finite input
 * collapses to 0 — a NaN leaking in from a division by a zero row
 * height would otherwise poison every consumer's transform.
 */
export function clampOffset(offset: number, sceneCount: number, visibleCount: number): number {
	if (!Number.isFinite(offset) || offset < 0) return 0;
	const max = maxOffsetFor(sceneCount, visibleCount);
	return offset > max ? max : offset;
}

/**
 * Widest slot map across all tracks = the scene count. Read fresh on
 * every call (the clipStateStore pattern) so component `$derived`
 * consumers re-run when the tree changes; no cached copy to invalidate.
 */
function computeSceneCount(): number {
	let max = 0;
	for (const track of v3Store.tracks.values()) {
		const n = track.slots.size;
		if (n > max) max = n;
	}
	return max;
}

/** Raw, unclamped offset in scene rows. Always read through the getter. */
let rawOffset = $state(0);
let dragging = $state(false);
/** Offset captured at drag start — `dragByRows` is relative to this. */
let dragAnchor = 0;

/**
 * Who currently owns the window.
 *
 * There is ONE window but many gesture instances driving it — one per
 * `SlotGrid` column plus the `SceneRail` — and `useStripGestures`
 * deliberately lets each instance own a finger at the same time
 * ("multitouch across strips"). Without an owner, a second finger's
 * `beginDrag()` re-anchors the first finger's drag mid-travel (so the
 * window jumps by that finger's accumulated distance a second time),
 * and whichever finger lifts first ends the drag for both — snapping
 * to a whole row and re-enabling the 140 ms transition while the other
 * finger is still moving.
 *
 * First claimant wins; later ones are ignored until it releases. That
 * is not full multi-pointer arbitration, but the window is a single
 * scalar — there is no coherent meaning for two fingers scrolling it
 * to different places at once.
 */
const DEFAULT_DRAG_OWNER: unknown = Symbol('default-drag-owner');
let dragOwner: unknown = null;

export const sceneWindowStore = {
	/**
	 * Current scroll offset in scene rows, clamped against the live
	 * scene count. Float mid-drag, whole number at rest.
	 */
	get offset(): number {
		return clampOffset(rawOffset, computeSceneCount(), computeVisibleCount());
	},

	/** Scene rows shown at once. */
	get visibleCount(): number {
		return computeVisibleCount();
	},

	/**
	 * Rows the grid actually draws, which is what its section is divided
	 * by to get the row pitch. A set with fewer scenes than the window
	 * fills the section with the scenes it HAS — taller rows — rather than
	 * drawing short rows over dead space under the last one. Never zero:
	 * an empty set still needs a finite pitch to divide by, and falls back
	 * to the full window.
	 */
	get renderedRows(): number {
		const count = computeSceneCount();
		const visible = computeVisibleCount();
		return count > 0 && count < visible ? count : visible;
	},

	/** Total scenes in the set, derived from the widest track slot map. */
	get sceneCount(): number {
		return computeSceneCount();
	},

	/** Highest legal offset — 0 when the grid fits in the window. */
	get maxOffset(): number {
		return maxOffsetFor(computeSceneCount(), computeVisibleCount());
	},

	/** True while a drag is in flight (offset may be fractional). */
	get isDragging(): boolean {
		return dragging;
	},

	/**
	 * Fraction of the grid currently visible, for the rail's scroll
	 * thumb. 1 when everything fits (thumb fills the track).
	 */
	get visibleFraction(): number {
		const count = computeSceneCount();
		const visible = computeVisibleCount();
		if (count <= visible) return 1;
		return visible / count;
	},

	/**
	 * Claim the window and capture the anchor a subsequent `dragByRows`
	 * is measured from. Returns false when another gesture already owns
	 * it — see the `dragOwner` note.
	 */
	beginDrag(owner: unknown = DEFAULT_DRAG_OWNER): boolean {
		if (dragOwner !== null && dragOwner !== owner) return false;
		dragOwner = owner;
		dragAnchor = this.offset;
		dragging = true;
		return true;
	},

	/**
	 * Move the window `deltaRows` from the drag anchor. Positive scrolls
	 * toward later scenes. Fractional values are expected — the window
	 * tracks the finger and only snaps on release. A non-owner's moves
	 * are ignored.
	 */
	dragByRows(deltaRows: number, owner: unknown = DEFAULT_DRAG_OWNER): void {
		if (dragOwner !== null && dragOwner !== owner) return;
		rawOffset = clampOffset(dragAnchor + deltaRows, computeSceneCount(), computeVisibleCount());
	},

	/**
	 * Snap to the nearest whole row and release the window. A non-owner
	 * calling this is a no-op, so a second finger lifting cannot end the
	 * drag the first one is still driving.
	 */
	endDrag(owner: unknown = DEFAULT_DRAG_OWNER): void {
		if (dragOwner !== null && dragOwner !== owner) return;
		dragOwner = null;
		dragging = false;
		rawOffset = clampOffset(
			Math.round(rawOffset),
			computeSceneCount(),
			computeVisibleCount()
		);
	},

	/** Jump the window so `row` is the top visible scene. */
	scrollToRow(row: number): void {
		rawOffset = clampOffset(Math.round(row), computeSceneCount(), computeVisibleCount());
	},

	/**
	 * Scroll the minimum distance needed to bring `row` on screen, and
	 * nothing if it already is.
	 *
	 * This is what keeps the foot pedal's target visible: the selection
	 * can be moved by the rail's arrows, by a tap in Live, or by a cell
	 * tap on a track whose column is scrolled elsewhere, and a cursor
	 * that walks off the window is exactly the invisible-second-cursor
	 * problem the highlight exists to fix.
	 *
	 * Deliberately minimal rather than centring: a performer's eye is
	 * already on the grid, and re-centring on every arrow press would
	 * move every other row under their hand for no reason. Stepping one
	 * scene past the edge scrolls by exactly one.
	 *
	 * Never scrolls while a drag is in flight — the finger owns the
	 * window then, and a selection echo landing mid-drag would fight it.
	 */
	ensureRowVisible(row: number): void {
		if (!Number.isFinite(row) || row < 0) return;
		if (dragging) return;
		const count = computeSceneCount();
		if (row >= count) return;
		const visible = computeVisibleCount();
		const current = clampOffset(rawOffset, count, visible);
		// `visible` rows are on screen starting at `current`, so the last
		// fully-visible row is `current + visible - 1`.
		const target =
			row < current ? row : row > current + visible - 1 ? row - visible + 1 : current;
		if (target !== current) rawOffset = clampOffset(target, count, visible);
	},

	/**
	 * Persist the read-side clamp into the stored offset.
	 *
	 * The getter clamps on read, which keeps consumers correct in the
	 * same frame the scene count drops — but a getter must not write
	 * `$state` (Svelte forbids mutation during a derived read), so
	 * `rawOffset` stays stale. If the count then GROWS again, the window
	 * would silently restore the pre-shrink row with no drag or tap
	 * behind it: delete scenes, add them back one at a time, and the grid
	 * walks down a row per scene on its own.
	 *
	 * Growing the WINDOW does the same thing from the other side: turning
	 * the central view off takes the window from 4 rows to 6, which drops
	 * maxOffset by 2 with the set unchanged. Turning it back on would
	 * restore the old row for free. So the rail's effect watches both
	 * counts.
	 *
	 * Called from `SceneRail`'s effect — the rail is mounted exactly while
	 * the grid is on screen, which is exactly when this matters. Kept a
	 * plain method rather than a module-level `$effect.root` so it is
	 * directly testable without a component.
	 */
	clampToSceneCount(): void {
		const max = maxOffsetFor(computeSceneCount(), computeVisibleCount());
		if (rawOffset > max) rawOffset = max;
	},

	/** Back to the top of the grid. */
	reset(): void {
		rawOffset = 0;
		dragging = false;
		dragAnchor = 0;
		dragOwner = null;
	}
};

/** Test helper — clears the window without going through a drag. */
export function __resetSceneWindowStoreForTests(): void {
	sceneWindowStore.reset();
}

// A resync re-rides `state/full`, which can restructure the grid
// entirely (different set, different scene count). Same contract
// playingClipsStore uses: drop volatile state and let the fresh
// snapshot rehydrate it. Guarded for SSR.
if (typeof window !== 'undefined') {
	window.addEventListener('bridge-resync', () => {
		logger.debug('sceneWindowStore: resetting window on bridge-resync');
		sceneWindowStore.reset();
	});
}
