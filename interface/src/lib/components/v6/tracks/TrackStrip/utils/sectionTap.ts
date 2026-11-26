/**
 * A strip tap: which section of the Card it landed on, and what that
 * section does.
 *
 * ## `sectionAt` — no dead bands
 *
 * `elementFromPoint` alone left DEAD BANDS. The Card is a flex column with a
 * gap, so there are seams between the sections (plus the 1px border ring)
 * where the topmost element is the Card itself — no `[data-section]`
 * ancestor, so the tap resolved to nothing and the strip visibly did
 * nothing. Measured on a 1366x1024 iPad layout that was ~16px of a 331px
 * strip: roughly one tap in twenty, concentrated exactly at the seams a
 * finger aims for.
 *
 * So the seam belongs to its nearest neighbour: fall back to the section
 * closest on the Y axis. Same move ADR-417 made in the slot grid, where
 * `--session-row-gap` was swallowing clip launches — a gap is spacing, not a
 * meaning. A tap on the fader's slop beside the Card (`.fader::before`) is
 * outside every section by construction and resolves the same way.
 *
 * ## `dispatchSectionTap` — the meaning
 *
 * While the Group button is held, every ordinary "select this track" tap
 * means "toggle this track into the pending group" instead, on every
 * section that would otherwise select (including a group strip's own
 * `group-body`: grouping the group itself, i.e. merging into it, is exactly
 * the gesture's other job). Fold is left alone: it changes what is visible,
 * not the selection.
 *
 * There is no `header` or `solo` case: both live OUTSIDE the Card, so their
 * presses never reach this dispatch. A tap on the background (no section at
 * all) does nothing.
 */

export type StripSection = 'clip' | 'permute' | 'device' | 'fold' | 'group-body';

/** The `[data-section]` under (x, y), else the nearest one on the Y axis. */
export function sectionAt(
	x: number,
	y: number,
	card: HTMLElement | null,
	doc: Pick<Document, 'elementFromPoint'> = document
): string | null {
	const hit = doc
		.elementFromPoint(x, y)
		?.closest('[data-section]')
		?.getAttribute('data-section');
	if (hit) return hit;
	if (!card) return null;
	let best: string | null = null;
	let bestDistance = Infinity;
	for (const el of card.querySelectorAll('[data-section]')) {
		const rect = el.getBoundingClientRect();
		const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = el.getAttribute('data-section');
		}
	}
	return best;
}

export interface SectionTapHandlers {
	/** The Group button is held. */
	groupGestureActive: boolean;
	/** Toggle this track into the pending group. */
	groupTap: () => void;
	fold: () => void;
	clip: () => void;
	permute: () => void;
	device: () => void;
	/** A group strip's body: its only select affordance. */
	groupBody: () => void;
}

export function dispatchSectionTap(section: string | null, h: SectionTapHandlers): void {
	if (section === null) return;
	if (h.groupGestureActive && section !== 'fold') {
		h.groupTap();
		return;
	}
	switch (section) {
		// Fold occupies the Permute third on a group strip.
		case 'fold':
			h.fold();
			break;
		case 'clip':
			h.clip();
			break;
		case 'permute':
			h.permute();
			break;
		case 'device':
			h.device();
			break;
		// No view routing: a group has no instrument and no clip, so the
		// central view stays put.
		case 'group-body':
			h.groupBody();
			break;
	}
}
