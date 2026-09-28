/**
 * Group Track tree math (ADR-410).
 *
 * Pure functions over the group fields the T record carries
 * (`isFoldable` / `foldState` / `groupTrackIndex`). Kept out of the
 * stores so the rules are unit-testable without a reactive harness —
 * the store layer supplies the lookup and these decide the shape.
 *
 * The central rule: **a track is hidden when ANY ancestor group is
 * folded**, not just its immediate parent. Folding an outer group
 * hides inner groups *and* their children, so visibility is an upward
 * walk rather than a single bit. That's why `groupTrackIndex` rides
 * the wire instead of a bare `isGrouped` flag, and why the UI derives
 * visibility rather than reading Live's `Track.is_visible` — that LOM
 * property has no listener (verified against Live 12.4.5b8), so a
 * derived tree is what lets one `fold_state` echo update every
 * descendant without a state/full republish.
 *
 * Cycle safety: `groupTrackIndex` comes from Live, which cannot
 * produce a cycle — but a torn state/full mid-restructure could
 * momentarily yield one, and an unbounded parent walk would hang the
 * render loop. Every walk here is depth-capped.
 */

/** The only fields the tree math reads. */
export interface GroupNode {
	isFoldable: boolean;
	foldState: boolean;
	/** Parent group's LOM index, or -1 at top level. */
	groupTrackIndex: number;
}

/** Resolves a track index to its group fields, or `undefined`. */
export type GroupLookup = (trackIndex: number) => GroupNode | undefined;

/**
 * Hard cap on ancestor walks. Live's own limit is far lower; this
 * exists purely so a malformed/torn tree can't spin forever.
 */
const MAX_GROUP_DEPTH = 32;

/**
 * True when `trackIndex` is inside at least one folded group.
 *
 * Note the asymmetry: a folded group is itself **visible** — it's its
 * *children* that hide. That's what makes the fold reversible from the
 * UI; a group that hid itself when folded could never be reopened.
 */
export function isTrackHidden(trackIndex: number, lookup: GroupLookup): boolean {
	const node = lookup(trackIndex);
	if (!node) return false;
	let parentIndex = node.groupTrackIndex;
	for (let depth = 0; depth < MAX_GROUP_DEPTH; depth++) {
		if (parentIndex < 0) return false;
		const parent = lookup(parentIndex);
		// A parent we can't resolve (torn tree) means "don't hide" —
		// showing a strip that should be hidden is recoverable, hiding
		// one that shouldn't be loses access to the track.
		if (!parent) return false;
		if (parent.foldState) return true;
		parentIndex = parent.groupTrackIndex;
	}
	return false;
}

/**
 * Nesting depth: 0 at top level, 1 inside one group, and so on.
 * Used for indenting strips so nesting reads at a glance.
 */
export function trackGroupDepth(trackIndex: number, lookup: GroupLookup): number {
	const node = lookup(trackIndex);
	if (!node) return 0;
	let depth = 0;
	let parentIndex = node.groupTrackIndex;
	while (parentIndex >= 0 && depth < MAX_GROUP_DEPTH) {
		const parent = lookup(parentIndex);
		if (!parent) break;
		depth++;
		parentIndex = parent.groupTrackIndex;
	}
	return depth;
}

/**
 * Direct and indirect children of the group at `groupIndex`, in index
 * order. Empty for a non-group track.
 */
export function groupMemberIndices(
	groupIndex: number,
	trackIndices: readonly number[],
	lookup: GroupLookup
): number[] {
	const group = lookup(groupIndex);
	if (!group?.isFoldable) return [];
	const members: number[] = [];
	for (const idx of trackIndices) {
		if (idx === groupIndex) continue;
		if (hasAncestor(idx, groupIndex, lookup)) members.push(idx);
	}
	return members;
}

/**
 * Visual cap on stacked group bands. Deeper nesting flattens onto the
 * innermost band rather than eating more of the strip — the bands sit
 * on top of the strips, so an uncapped stack would shrink them without
 * limit.
 */
const MAX_GROUP_BANDS = 4;

/** One group bracket ("panhandle") reaching out over a run of columns. */
export interface GroupBand {
	/** LOM index of the group the bracket belongs to. */
	groupIndex: number;
	/** Column position (into `visibleTracks`) of the group's own column — the arm grows rightward from it. */
	start: number;
	/** Columns from `start` inclusive to the last member — so `span - 1` member columns. */
	span: number;
	/** Stacking row, 0 = topmost. A nested group's bracket sits one row lower. */
	band: number;
}

export interface GroupBandLayout {
	bands: GroupBand[];
	/** Band rows above each visible column, index-aligned with `visibleTracks`. */
	offsets: number[];
	/** Band rows the row needs overall (0 when no open group is visible). */
	bandCount: number;
}

/**
 * Bracket geometry for an open group and the tracks inside it.
 *
 * The row draws each open group as a horizontal arm reaching out of the
 * top of the group's own strip and over its visible members — a
 * panhandle. The group's strip therefore stays **full height** and the
 * arm is part of its outline; only the member strips start lower, which
 * is what makes the group read as one ⌐-shaped body with its members
 * hanging beneath the arm.
 *
 * That asymmetry is the whole reason `offsets` is not simply "bands
 * covering this column": a band pushes its *members* down but not the
 * group it belongs to, because that arm is beside that column, not above
 * it.
 *
 * Two things this deliberately derives from the *drawn* brackets rather
 * than from raw `trackGroupDepth`:
 *
 * - **Contiguity.** Members are contiguous in LOM order, so they stay
 *   contiguous after filtering: any visible track between two members is
 *   itself a member. That's what lets a span be a simple forward scan.
 * - **Offsets.** In `active` filter mode a group track can be filtered
 *   out while its children survive. Counting ancestors would then push
 *   those children down under a band that was never drawn. Counting
 *   coverage by actual brackets can't drift from what's on screen.
 *
 * An open group with no visible member gets no bracket — there is no
 * membership to draw, and a lone arm over one column reads as noise.
 */
export function groupBandLayout(
	visibleTracks: readonly number[],
	lookup: GroupLookup
): GroupBandLayout {
	const cols = visibleTracks.length;
	const spans: { groupIndex: number; start: number; span: number }[] = [];

	for (let i = 0; i < cols; i++) {
		const groupIndex = visibleTracks[i];
		const node = lookup(groupIndex);
		if (!node?.isFoldable || node.foldState) continue;
		let span = 1;
		while (
			i + span < cols &&
			hasAncestor(visibleTracks[i + span], groupIndex, lookup)
		) {
			span++;
		}
		if (span === 1) continue;
		spans.push({ groupIndex, start: i, span });
	}

	// A bracket's row is how many *other* brackets cover its start column —
	// i.e. how many open groups it sits inside. Containment is nesting, so
	// this is the drawn-bracket equivalent of ancestor depth.
	const bands: GroupBand[] = spans.map((span) => {
		let band = 0;
		for (const other of spans) {
			if (other === span) continue;
			if (other.start <= span.start && span.start < other.start + other.span) band++;
		}
		return { ...span, band: Math.min(band, MAX_GROUP_BANDS - 1) };
	});

	const offsets = new Array<number>(cols).fill(0);
	for (const b of bands) {
		// The group's own column starts LEVEL with its arm, not below it:
		// the arm grows out of that strip's top edge, so the two are one
		// shape and the strip keeps its full height.
		offsets[b.start] = Math.max(offsets[b.start], b.band);
		// Members start below the arm.
		for (let i = b.start + 1; i < b.start + b.span; i++) {
			// max(), not a count: keeps the clamp above consistent when
			// nesting runs deeper than MAX_GROUP_BANDS.
			offsets[i] = Math.max(offsets[i], b.band + 1);
		}
	}

	return {
		bands,
		offsets,
		bandCount: offsets.reduce((max, o) => Math.max(max, o), 0)
	};
}

/** True when `ancestorIndex` is at any depth above `trackIndex`. */
export function hasAncestor(
	trackIndex: number,
	ancestorIndex: number,
	lookup: GroupLookup
): boolean {
	const node = lookup(trackIndex);
	if (!node) return false;
	let parentIndex = node.groupTrackIndex;
	for (let depth = 0; depth < MAX_GROUP_DEPTH; depth++) {
		if (parentIndex < 0) return false;
		if (parentIndex === ancestorIndex) return true;
		const parent = lookup(parentIndex);
		if (!parent) return false;
		parentIndex = parent.groupTrackIndex;
	}
	return false;
}
