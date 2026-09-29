/**
 * focusedNotesStore — clip-view-mirror M3 + M4.
 *
 * Id-keyed note model for the central editor's ONE focused clip. Fed by
 * the rich channel (`clipRichNotesService`), it replaces the cheap blob
 * as the editor's note source (the strip thumbnails keep the cheap blob
 * — plan decision 1). Keying by `noteId` is what makes M4 editing
 * possible: an edit references "this note" by id, not by array index.
 *
 * Reconcile model (ADR-358 / plan decision 4): edits apply OPTIMISTICALLY
 * to the local map, the write goes out, and the surface's
 * `notes/changed` poke triggers a fresh rich pull whose result REPLACES
 * the map (`reconcile`). The initiating client suppresses its own poke
 * for a short window (clipRichNotesService.shouldSuppressReconcile) so it
 * doesn't fight its own optimistic state; external edits reconcile
 * normally.
 *
 * Add uses a TEMP NEGATIVE id minted client-side; once the surface
 * replies `notes/added` with the real id, `swapTempId` rekeys the entry.
 */

import type { RichNote } from '$lib/services/clipRichNotesService';

class FocusedNotesStore {
	// noteId → note. A Map keeps id lookup O(1) for edits; the derived
	// array below is what the canvas iterates.
	private _byId = $state<Map<number, RichNote>>(new Map());
	private _loadState = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');
	private _clipPath = $state<string | null>(null);
	// Monotonic temp-id counter (negative, so it never collides with real
	// Live ids which are positive ints).
	private _nextTempId = -1;

	get loadState(): 'idle' | 'loading' | 'loaded' | 'error' {
		return this._loadState;
	}
	get clipPath(): string | null {
		return this._clipPath;
	}
	/** All notes as a fresh array (canvas iterates this). */
	get notes(): RichNote[] {
		return Array.from(this._byId.values());
	}
	get count(): number {
		return this._byId.size;
	}
	has(noteId: number): boolean {
		return this._byId.has(noteId);
	}
	get(noteId: number): RichNote | undefined {
		return this._byId.get(noteId);
	}

	/**
	 * A different clip drops the last one's notes: held through the load,
	 * they drew (and folded to) pitches the new clip may not play at all.
	 * A re-pull of the same clip keeps them on screen.
	 */
	setLoading(clipPath: string): void {
		if (clipPath !== this._clipPath) this._byId = new Map();
		this._clipPath = clipPath;
		this._loadState = 'loading';
	}
	setError(): void {
		this._loadState = 'error';
	}

	/**
	 * Replace the entire map from a fresh rich pull. This is the
	 * reconcile point — external edits and write rejections both land
	 * here, rebuilding the canvas from authoritative surface state.
	 */
	reconcile(clipPath: string, notes: RichNote[]): void {
		const next = new Map<number, RichNote>();
		for (const n of notes) next.set(n.noteId, n);
		this._byId = next;
		this._clipPath = clipPath;
		this._loadState = 'loaded';
	}

	clearAll(): void {
		this._byId = new Map();
		this._loadState = 'idle';
		this._clipPath = null;
	}

	// --- optimistic edits (M4) --------------------------------------------

	/** Mint a fresh temp (negative) id for an optimistic add. */
	nextTempId(): number {
		const id = this._nextTempId;
		this._nextTempId -= 1;
		return id;
	}

	/** Optimistically insert a note (typically with a temp id). */
	optimisticAdd(note: RichNote): void {
		const next = new Map(this._byId);
		next.set(note.noteId, note);
		this._byId = next;
	}

	/** Optimistically patch an existing note's fields by id. */
	optimisticModify(noteId: number, patch: Partial<Omit<RichNote, 'noteId'>>): void {
		const cur = this._byId.get(noteId);
		if (!cur) return;
		const next = new Map(this._byId);
		next.set(noteId, { ...cur, ...patch });
		this._byId = next;
	}

	/** Optimistically remove notes by id. */
	optimisticRemove(noteIds: number[]): void {
		const next = new Map(this._byId);
		for (const id of noteIds) next.delete(id);
		this._byId = next;
	}

	/**
	 * Swap a temp id for the real id the surface assigned (on
	 * `notes/added`). Order-preserving: deletes the temp entry and
	 * re-inserts under the real id with `noteId` updated.
	 */
	swapTempId(tempId: number, realId: number): void {
		const cur = this._byId.get(tempId);
		if (!cur) return;
		const next = new Map(this._byId);
		next.delete(tempId);
		next.set(realId, { ...cur, noteId: realId });
		this._byId = next;
	}
}

export const focusedNotesStore = new FocusedNotesStore();
