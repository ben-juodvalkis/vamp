/**
 * focusedNotesStore — clip-view-mirror M3 + M4.
 *
 * Covers the id-keyed note model the central editor uses: reconcile
 * (fresh rich pull replaces the map), the optimistic edits
 * (add/modify/remove), and the temp-id → real-id swap on notes/added.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
import type { RichNote } from '$lib/services/clipRichNotesService';

const CLIP = 'tracks/0/slots/0/clip';

function note(noteId: number, pitch: number, startBeats = 0): RichNote {
	return { noteId, pitch, startBeats, durationBeats: 0.25, velocity: 100, mute: false };
}

describe('focusedNotesStore', () => {
	beforeEach(() => {
		focusedNotesStore.clearAll();
	});

	it('starts empty and idle', () => {
		expect(focusedNotesStore.count).toBe(0);
		expect(focusedNotesStore.loadState).toBe('idle');
		expect(focusedNotesStore.clipPath).toBe(null);
	});

	it('reconcile replaces the map and keys by noteId', () => {
		focusedNotesStore.reconcile(CLIP, [note(1, 60), note(2, 64)]);
		expect(focusedNotesStore.count).toBe(2);
		expect(focusedNotesStore.loadState).toBe('loaded');
		expect(focusedNotesStore.clipPath).toBe(CLIP);
		expect(focusedNotesStore.get(1)?.pitch).toBe(60);
		// A second reconcile fully replaces (external delete reflected).
		focusedNotesStore.reconcile(CLIP, [note(2, 64)]);
		expect(focusedNotesStore.count).toBe(1);
		expect(focusedNotesStore.has(1)).toBe(false);
	});

	it('setLoading / setError transition load state', () => {
		focusedNotesStore.setLoading(CLIP);
		expect(focusedNotesStore.loadState).toBe('loading');
		expect(focusedNotesStore.clipPath).toBe(CLIP);
		focusedNotesStore.setError();
		expect(focusedNotesStore.loadState).toBe('error');
	});

	it('setLoading on another clip drops the last clip\'s notes; a re-pull keeps them', () => {
		focusedNotesStore.reconcile(CLIP, [note(1, 60)]);
		focusedNotesStore.setLoading(CLIP);
		expect(focusedNotesStore.count).toBe(1);
		focusedNotesStore.setLoading('tracks/9/clip_slots/9/clip');
		expect(focusedNotesStore.count).toBe(0);
	});

	describe('optimistic edits', () => {
		beforeEach(() => {
			focusedNotesStore.reconcile(CLIP, [note(1, 60), note(2, 64)]);
		});

		it('optimisticModify patches a single note by id', () => {
			focusedNotesStore.optimisticModify(1, { pitch: 67, startBeats: 1 });
			expect(focusedNotesStore.get(1)?.pitch).toBe(67);
			expect(focusedNotesStore.get(1)?.startBeats).toBe(1);
			// Other fields untouched.
			expect(focusedNotesStore.get(1)?.velocity).toBe(100);
			// Other notes untouched.
			expect(focusedNotesStore.get(2)?.pitch).toBe(64);
		});

		it('optimisticModify on an unknown id is a no-op', () => {
			focusedNotesStore.optimisticModify(999, { pitch: 1 });
			expect(focusedNotesStore.count).toBe(2);
		});

		it('optimisticRemove drops notes by id', () => {
			focusedNotesStore.optimisticRemove([1]);
			expect(focusedNotesStore.has(1)).toBe(false);
			expect(focusedNotesStore.has(2)).toBe(true);
		});

		it('optimisticAdd inserts a note', () => {
			focusedNotesStore.optimisticAdd(note(3, 72));
			expect(focusedNotesStore.count).toBe(3);
			expect(focusedNotesStore.get(3)?.pitch).toBe(72);
		});
	});

	describe('temp-id lifecycle', () => {
		it('nextTempId yields monotonically decreasing negatives', () => {
			const a = focusedNotesStore.nextTempId();
			const b = focusedNotesStore.nextTempId();
			expect(a).toBeLessThan(0);
			expect(b).toBeLessThan(a);
		});

		it('swapTempId rekeys the entry to the real id', () => {
			focusedNotesStore.reconcile(CLIP, []);
			const temp = focusedNotesStore.nextTempId();
			focusedNotesStore.optimisticAdd(note(temp, 60));
			expect(focusedNotesStore.has(temp)).toBe(true);
			focusedNotesStore.swapTempId(temp, 5000);
			expect(focusedNotesStore.has(temp)).toBe(false);
			expect(focusedNotesStore.has(5000)).toBe(true);
			expect(focusedNotesStore.get(5000)?.noteId).toBe(5000);
			expect(focusedNotesStore.get(5000)?.pitch).toBe(60);
		});

		it('swapTempId on an unknown temp id is a no-op', () => {
			focusedNotesStore.reconcile(CLIP, [note(1, 60)]);
			focusedNotesStore.swapTempId(-999, 7000);
			expect(focusedNotesStore.count).toBe(1);
			expect(focusedNotesStore.has(7000)).toBe(false);
		});
	});

	it('clearAll resets everything', () => {
		focusedNotesStore.reconcile(CLIP, [note(1, 60)]);
		focusedNotesStore.clearAll();
		expect(focusedNotesStore.count).toBe(0);
		expect(focusedNotesStore.loadState).toBe('idle');
		expect(focusedNotesStore.clipPath).toBe(null);
	});
});
