/**
 * Geometry of the action strip that sits on the LEADING (left) edge of
 * every session-grid cell and every scene-rail button.
 *
 * A cell body SELECTS (aims the foot pedal at that slot); the strip is
 * the only part that acts. Which of the two a press meant is decided
 * from the press X, in the same arithmetic that decides which row it
 * hit — the grid deliberately does not hit-test the DOM, because a cell
 * is a little smaller than its row and those gaps used to swallow taps
 * (ADR-415).
 *
 * That makes this module the single source of the strip's width: it is
 * read once to paint the strip and again to test a press, and if the
 * two ever disagreed a press landing on the button you can see would do
 * the other thing. Exported and pure so the boundary is testable
 * without a layout.
 *
 * Why a full-height tab rather than a corner button: the row pitch is
 * only 48–56px (see `visibleCountForSections`), so a square target big
 * enough to hit reliably would eat half of a minimum-width (64px) cell.
 * Taking the full row height instead buys the same area off the axis
 * that has room, and leaves the cell's middle — what you aim at to
 * select — the largest thing in the box.
 */

/** Never narrower than this, however tight the column. */
export const ACTION_MIN_PX = 36;
/**
 * Never wider than this, however wide the column.
 *
 * Held down to 40px after seeing it at 48: on a 1366-wide iPad with 8
 * tracks the columns are ~176px, so the cap is what actually binds, and
 * the extra 8px was coming straight out of the clip name — "Root Pulse"
 * wrapped to two lines in a cell that had comfortably fitted it before.
 */
export const ACTION_MAX_PX = 40;
/** Share of the cell the strip takes between those bounds. */
export const ACTION_FRACTION = 0.28;

/**
 * Width of the action strip for a cell of `cellWidthPx`.
 *
 * Returns 0 for a non-positive width so a pre-measurement render draws
 * no strip at all rather than a stray sliver — and, because the same
 * value gates the hit test, a press before the first measurement falls
 * through to "select", which is the safe half of the branch.
 */
export function actionStripWidth(cellWidthPx: number): number {
	if (!Number.isFinite(cellWidthPx) || cellWidthPx <= 0) return 0;
	const proportional = cellWidthPx * ACTION_FRACTION;
	if (proportional < ACTION_MIN_PX) {
		// Never let the strip take the whole cell on an absurdly narrow
		// column: below this the body would have nothing left to aim at,
		// and selecting is the primary action.
		return Math.min(ACTION_MIN_PX, cellWidthPx / 2);
	}
	return Math.min(proportional, ACTION_MAX_PX);
}

/**
 * True when a press at `x` (client coords) landed on the action strip of
 * a cell spanning `[left, right]`.
 *
 * The strip is inclusive of its trailing edge, so the boundary pixel
 * acts rather than selects — matching the painted border, which the
 * strip's own `border-right` draws inside its box.
 */
export function isInActionStrip(x: number, left: number, right: number): boolean {
	const width = actionStripWidth(right - left);
	if (width <= 0) return false;
	return x <= left + width;
}
