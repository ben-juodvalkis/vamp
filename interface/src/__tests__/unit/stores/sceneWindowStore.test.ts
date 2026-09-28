/**
 * Tests for sceneWindowStore — the shared scene-scroll window that keeps
 * every strip's slot zone and the scene rail showing the same rows.
 *
 * The contracts worth pinning are the ones a performer would notice
 * breaking mid-set:
 *
 *  - the window never rests mid-row (drag snaps on release)
 *  - it never scrolls past the last scene
 *  - deleting the scenes you were scrolled to doesn't strand the grid
 *    on an offset that no longer exists
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	sceneWindowStore,
	clampOffset,
	maxOffsetFor,
	visibleCountForSections,
	__resetSceneWindowStoreForTests
} from '$lib/stores/v6/sceneWindowStore.svelte';
import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
import {
	_resetForTests,
	replaceTree,
	type TrackRecord,
	type SlotRecord
} from '$lib/stores/v3/normalized.svelte';
import { SvelteMap } from 'svelte/reactivity';

/** Minimal T-record carrying `slotCount` empty slots. */
function trackWithSlots(index: number, slotCount: number): TrackRecord {
	const trackPath = `tracks/${index}`;
	const slots: SlotRecord[] = Array.from({ length: slotCount }, (_, i) => ({
		slotPath: `${trackPath}/slots/${i}`,
		state: 'empty' as const
	}));
	return {
		trackPath,
		name: `t${index}`,
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap(),
		slots: new SvelteMap(slots.map((s) => [s.slotPath, s]))
	};
}

/** Seed a rectangular grid: `trackCount` tracks × `sceneCount` scenes. */
function seedGrid(trackCount: number, sceneCount: number) {
	replaceTree(
		1,
		Array.from({ length: trackCount }, (_, i) => trackWithSlots(i, sceneCount))
	);
}

/**
 * Put the main-area stack into an N-section configuration, 2..4. The
 * track strips and the central view are always on (the VIEW switch went
 * 2026-09-26), so CLIPS and FX add sections 3 and 4.
 */
function showSections(count: number) {
	uiPrefsStore.sessionMode = count >= 3;
	uiPrefsStore.showFxGrid = count >= 4;
}

/** Window size in the fullest layout — the baseline most tests run in. */
const VISIBLE = visibleCountForSections(4);

beforeEach(() => {
	_resetForTests();
	__resetSceneWindowStoreForTests();
	// Every test that isn't ABOUT the section count runs in the fullest
	// layout, where the window is at its smallest.
	showSections(4);
});

describe('maxOffsetFor', () => {
	it('is zero when the whole grid fits in the window', () => {
		expect(maxOffsetFor(4, 4)).toBe(0);
		expect(maxOffsetFor(2, 4)).toBe(0);
	});

	it('leaves exactly one window of scenes visible at the bottom', () => {
		expect(maxOffsetFor(8, 4)).toBe(4);
		expect(maxOffsetFor(5, 4)).toBe(1);
	});

	it('never goes negative on an empty set', () => {
		expect(maxOffsetFor(0, 4)).toBe(0);
	});
});

describe('clampOffset', () => {
	it('holds an in-range offset unchanged', () => {
		expect(clampOffset(2, 8, 4)).toBe(2);
	});

	it('clamps past-the-end to the last full window', () => {
		expect(clampOffset(99, 8, 4)).toBe(4);
	});

	it('clamps negatives to the top', () => {
		expect(clampOffset(-3, 8, 4)).toBe(0);
	});

	it('collapses any non-finite offset to the top of the grid', () => {
		// A zero row height in the px→rows conversion divides to NaN or
		// ±Infinity. Both are degenerate measurements, and both resolve
		// to 0 rather than to maxOffset on purpose: a mis-measured row
		// should leave the grid where a performer can see scene 1, not
		// fling it to the bottom of the set.
		expect(clampOffset(NaN, 8, 4)).toBe(0);
		expect(clampOffset(Infinity, 8, 4)).toBe(0);
		expect(clampOffset(-Infinity, 8, 4)).toBe(0);
	});

	it('preserves fractional offsets mid-drag', () => {
		expect(clampOffset(1.5, 8, 4)).toBe(1.5);
	});
});

describe('sceneCount derivation', () => {
	it('is zero before any state/full lands', () => {
		expect(sceneWindowStore.sceneCount).toBe(0);
	});

	it('reads the scene count off the track slot maps', () => {
		seedGrid(3, 8);
		expect(sceneWindowStore.sceneCount).toBe(8);
	});

	it('takes the widest track — the grid is rectangular in Live', () => {
		// A track mid-restructure can briefly report fewer slots; the
		// widest map is the authoritative scene count.
		replaceTree(1, [trackWithSlots(0, 8), trackWithSlots(1, 3)]);
		expect(sceneWindowStore.sceneCount).toBe(8);
	});

	it('follows scene churn through a state/full re-ride', () => {
		seedGrid(2, 8);
		expect(sceneWindowStore.sceneCount).toBe(8);
		seedGrid(2, 12);
		expect(sceneWindowStore.sceneCount).toBe(12);
	});
});

describe('window geometry', () => {
	it('exposes the visible count consumers align rows against', () => {
		expect(sceneWindowStore.visibleCount).toBe(VISIBLE);
	});

	it('reports maxOffset against the live scene count', () => {
		seedGrid(2, 10);
		expect(sceneWindowStore.maxOffset).toBe(10 - VISIBLE);
	});

	it('fills the rail thumb when everything fits', () => {
		seedGrid(2, 4);
		expect(sceneWindowStore.visibleFraction).toBe(1);
	});

	it('sizes the rail thumb to the visible share of the grid', () => {
		seedGrid(2, 8);
		expect(sceneWindowStore.visibleFraction).toBe(0.5);
	});
});

describe('window size vs. the section stack', () => {
	// Hiding the central view and the FX grid roughly doubles the clip
	// grid's section, and that height goes into MORE scenes rather than
	// taller ones — which is only correct if the grid and the rail agree
	// on the number, hence one derived value in the store.

	it('maps each section count to its tested row count', () => {
		expect(visibleCountForSections(4)).toBe(4);
		expect(visibleCountForSections(3)).toBe(6);
		expect(visibleCountForSections(2)).toBe(8);
	});

	it('treats a strips-only stack like the two-section one', () => {
		// Unreachable in practice — with the clip grid off there is no
		// window to size — but the mapping must still answer.
		expect(visibleCountForSections(1)).toBe(8);
		expect(visibleCountForSections(0)).toBe(8);
	});

	it('never exceeds the smallest window however many sections appear', () => {
		expect(visibleCountForSections(5)).toBe(4);
	});

	it('grows the live window as sections are switched off', () => {
		seedGrid(2, 16);
		expect(sceneWindowStore.visibleCount).toBe(4);

		showSections(3);
		expect(sceneWindowStore.visibleCount).toBe(6);

		showSections(2);
		expect(sceneWindowStore.visibleCount).toBe(8);
	});

	it('takes maxOffset and the rail thumb with it', () => {
		seedGrid(2, 16);
		expect(sceneWindowStore.maxOffset).toBe(12);
		expect(sceneWindowStore.visibleFraction).toBe(0.25);

		showSections(2);
		expect(sceneWindowStore.maxOffset).toBe(8);
		expect(sceneWindowStore.visibleFraction).toBe(0.5);
	});

	it('re-clamps a bottomed-out window when it grows', () => {
		// Scrolled to the last row of a 4-row window, then the FX grid and
		// the clip grid go away: the window now reaches 4 rows further
		// down the set on its own, so the old offset is past the end.
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);
		expect(sceneWindowStore.offset).toBe(8);

		showSections(2);
		expect(sceneWindowStore.offset).toBe(4);
	});

	it('does not restore the pre-growth row once the clamp is persisted', () => {
		// Same shrink-then-regrow trap the scene count has: the read-side
		// clamp can't write, so without SceneRail's effect calling
		// clampToSceneCount the offset springs back when the sections
		// return.
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);

		showSections(2);
		sceneWindowStore.clampToSceneCount();
		expect(sceneWindowStore.offset).toBe(4);

		showSections(4);
		expect(sceneWindowStore.offset).toBe(4);
	});

	it('draws the whole set as tall rows when it fits the grown window', () => {
		seedGrid(2, 6);
		expect(sceneWindowStore.renderedRows).toBe(4);

		showSections(2);
		expect(sceneWindowStore.renderedRows).toBe(6);
		expect(sceneWindowStore.maxOffset).toBe(0);
	});
});

describe('drag → snap', () => {
	beforeEach(() => seedGrid(2, 12));

	it('tracks the finger fractionally while dragging', () => {
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(1.4);
		expect(sceneWindowStore.isDragging).toBe(true);
		expect(sceneWindowStore.offset).toBeCloseTo(1.4);
	});

	it('snaps to the nearest whole row on release', () => {
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(1.4);
		sceneWindowStore.endDrag();
		expect(sceneWindowStore.isDragging).toBe(false);
		expect(sceneWindowStore.offset).toBe(1);
	});

	it('snaps up when the drag passes the halfway point', () => {
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(1.6);
		sceneWindowStore.endDrag();
		expect(sceneWindowStore.offset).toBe(2);
	});

	it('measures each drag from the offset it started at', () => {
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(2);
		sceneWindowStore.endDrag();

		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(1);
		sceneWindowStore.endDrag();
		// Relative, not absolute: 2 + 1, not a re-set to 1.
		expect(sceneWindowStore.offset).toBe(3);
	});

	it('clamps at the bottom instead of running off the grid', () => {
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(999);
		expect(sceneWindowStore.offset).toBe(sceneWindowStore.maxOffset);
		sceneWindowStore.endDrag();
		expect(sceneWindowStore.offset).toBe(sceneWindowStore.maxOffset);
	});

	it('clamps at the top when dragging back past scene 1', () => {
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(-999);
		expect(sceneWindowStore.offset).toBe(0);
	});
});

describe('scene-count shrink', () => {
	it('re-clamps a stale offset when scenes are deleted', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);
		expect(sceneWindowStore.offset).toBe(8);

		// Performer deletes scenes; nobody writes the offset, so only a
		// read-side clamp can save the grid from rendering past the end.
		seedGrid(2, 6);
		expect(sceneWindowStore.offset).toBe(maxOffsetFor(6, VISIBLE));
	});

	it('collapses to the top when the grid shrinks inside one window', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);
		seedGrid(2, 3);
		expect(sceneWindowStore.offset).toBe(0);
	});

	it('survives the set being emptied entirely', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);
		replaceTree(2, []);
		expect(sceneWindowStore.sceneCount).toBe(0);
		expect(sceneWindowStore.offset).toBe(0);
	});
});

describe('clampToSceneCount — shrink then REGROW', () => {
	// The read-side clamp keeps the CURRENT frame correct but can't write
	// back (a getter must not mutate $state), so without this the stored
	// offset stays stale and a regrow silently restores the old row.
	// SceneRail drives this off the scene count; these pin the method.

	it('holds the window at the top when scenes come back', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);
		expect(sceneWindowStore.offset).toBe(8);

		// Performer deletes scenes — the rail's effect clamps.
		seedGrid(2, 3);
		sceneWindowStore.clampToSceneCount();
		expect(sceneWindowStore.offset).toBe(0);

		// ...then undoes, or re-adds them. The window must stay put.
		seedGrid(2, 12);
		expect(sceneWindowStore.offset).toBe(0);
	});

	it('does not walk the grid down as scenes are re-added one at a time', () => {
		// The scenario that makes this a bug rather than a quirk: each
		// added scene raises maxOffset, so an un-persisted stale offset
		// scrolls the grid a row on its own with no gesture behind it.
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);

		seedGrid(2, 2);
		sceneWindowStore.clampToSceneCount();

		for (let count = 3; count <= 12; count++) {
			seedGrid(2, count);
			sceneWindowStore.clampToSceneCount();
			expect(sceneWindowStore.offset).toBe(0);
		}
	});

	it('leaves a legal offset untouched', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(5);
		sceneWindowStore.clampToSceneCount();
		expect(sceneWindowStore.offset).toBe(5);
	});

	it('still lets a deliberate scroll move the window afterwards', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(8);
		seedGrid(2, 3);
		sceneWindowStore.clampToSceneCount();
		seedGrid(2, 12);

		sceneWindowStore.scrollToRow(5);
		expect(sceneWindowStore.offset).toBe(5);
	});

	it('is a no-op on an empty set', () => {
		replaceTree(1, []);
		sceneWindowStore.clampToSceneCount();
		expect(sceneWindowStore.offset).toBe(0);
	});
});

describe('renderedRows', () => {
	// The divisor both the grid and the rail use to turn their third into
	// a row pitch, so a wrong value here mis-sizes every cell.

	it('falls back to the full window on an empty set', () => {
		// Never zero — the pitch calculation divides by this.
		expect(sceneWindowStore.sceneCount).toBe(0);
		expect(sceneWindowStore.renderedRows).toBe(VISIBLE);
	});

	it('draws only the scenes that exist when there are fewer than the window', () => {
		// Two scenes fill the third as two tall rows, rather than two
		// short rows over dead space.
		seedGrid(2, 2);
		expect(sceneWindowStore.renderedRows).toBe(2);
		seedGrid(2, 1);
		expect(sceneWindowStore.renderedRows).toBe(1);
	});

	it('caps at the window once the set fills it', () => {
		seedGrid(2, VISIBLE);
		expect(sceneWindowStore.renderedRows).toBe(VISIBLE);
		seedGrid(2, 12);
		expect(sceneWindowStore.renderedRows).toBe(VISIBLE);
	});
});

describe('scrollToRow', () => {
	beforeEach(() => seedGrid(2, 12));

	it('jumps the window to a whole row', () => {
		sceneWindowStore.scrollToRow(5);
		expect(sceneWindowStore.offset).toBe(5);
	});

	it('clamps a past-the-end jump', () => {
		sceneWindowStore.scrollToRow(99);
		expect(sceneWindowStore.offset).toBe(sceneWindowStore.maxOffset);
	});
});

describe('reset', () => {
	it('returns the window to the top and ends any drag', () => {
		seedGrid(2, 12);
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(3);
		sceneWindowStore.reset();
		expect(sceneWindowStore.offset).toBe(0);
		expect(sceneWindowStore.isDragging).toBe(false);
	});

	it('drops the drag anchor so the next drag starts from the top', () => {
		seedGrid(2, 12);
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(3);
		sceneWindowStore.reset();

		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(1);
		sceneWindowStore.endDrag();
		expect(sceneWindowStore.offset).toBe(1);
	});
});

describe('ensureRowVisible — keeping the pedal target on screen', () => {
	it('does nothing when the row is already in the window', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(4);
		sceneWindowStore.ensureRowVisible(4 + VISIBLE - 1);
		expect(sceneWindowStore.offset).toBe(4);
	});

	it('scrolls up by exactly one when the row steps off the top', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(4);
		sceneWindowStore.ensureRowVisible(3);
		expect(sceneWindowStore.offset).toBe(3);
	});

	it('scrolls down by exactly one when the row steps off the bottom', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(4);
		// One past the last fully visible row.
		sceneWindowStore.ensureRowVisible(4 + VISIBLE);
		expect(sceneWindowStore.offset).toBe(5);
	});

	it('reveals a far-away row without centring it', () => {
		seedGrid(2, 20);
		sceneWindowStore.scrollToRow(0);
		sceneWindowStore.ensureRowVisible(11);
		// Minimal scroll: the row lands on the LAST visible line, not the
		// middle — re-centring would shift every other row under the hand.
		expect(sceneWindowStore.offset).toBe(11 - VISIBLE + 1);
	});

	it('never scrolls past the last scene', () => {
		seedGrid(2, 6);
		sceneWindowStore.ensureRowVisible(5);
		expect(sceneWindowStore.offset).toBe(maxOffsetFor(6, VISIBLE));
	});

	it('ignores a row outside the set', () => {
		seedGrid(2, 12);
		sceneWindowStore.scrollToRow(2);
		sceneWindowStore.ensureRowVisible(99);
		sceneWindowStore.ensureRowVisible(-1);
		expect(sceneWindowStore.offset).toBe(2);
	});

	it('yields to a drag in flight — the finger owns the window', () => {
		seedGrid(2, 12);
		sceneWindowStore.beginDrag();
		sceneWindowStore.dragByRows(2);
		sceneWindowStore.ensureRowVisible(11);
		expect(sceneWindowStore.offset).toBe(2);
	});
});
