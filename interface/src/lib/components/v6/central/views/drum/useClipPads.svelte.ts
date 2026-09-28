/**
 * useClipPads — the playing clip on the pad grid (2026-09-08; split out
 * of the Drum Rack view on 2026-09-10).
 *
 * A drum clip's notes ARE the pads it uses. While the track's clip plays
 * (`playingClipsStore`), the notes are fetched through the strip's own
 * cheap blob (`clipNotesService.requestNotes`, re-fetched on
 * `notes/changed`) and `clipNotes` is the distinct pitches, ascending —
 * what the grid draws. `litNotes` are the pads the 30 Hz playhead just
 * crossed (`notesCrossed`, following the loop round), each lit for
 * `PAD_FLASH_MS`; a later trigger of the same pad extends it by token.
 *
 * Nothing here reaches the surface. Live's LOM exposes no per-pad
 * trigger event and the surface never sees the track's MIDI input, so a
 * pad played live on a keyboard or the Move does not flash: this is the
 * clip's own timeline. The 30 Hz effect reads only the position
 * (`untrack` around the rest), so nothing else re-ticks it.
 */

import { SvelteMap } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { playingClipsStore } from '$lib/stores/v6/playingClipsStore.svelte';
import { requestNotes, subscribeNotesChanged, type MidiNote } from '$lib/services/clipNotesService';
import { clipPadNotes, notesCrossed, PAD_FLASH_MS } from '$lib/services/drumVirtualMacros';
import { logger } from '$lib/utils/logger';

export interface ClipPadsHandle {
	/** The pitches the playing clip uses, ascending; null while nothing plays. */
	readonly clipNotes: number[] | null;
	/** The pads the playhead just crossed. */
	readonly litNotes: ReadonlySet<number>;
}

export function useClipPads(getTrackPath: () => string | undefined): ClipPadsHandle {
	const trackPath = $derived(getTrackPath());
	const playing = $derived(trackPath ? playingClipsStore.get(trackPath) : undefined);
	const playingClipPath = $derived(playing && playing.status > 0 && playing.clipPath ? playing.clipPath : '');
	let clipNoteList = $state<MidiNote[]>([]);

	$effect(() => {
		const clipPath = playingClipPath;
		if (!clipPath) {
			clipNoteList = [];
			return;
		}
		let cancelled = false;
		const fetch = () => {
			requestNotes(clipPath)
				.then((result) => {
					if (!cancelled) clipNoteList = result;
				})
				.catch((err: Error) => {
					if (cancelled) return;
					logger.debug('useClipPads: clip notes fetch failed', { clipPath, error: err.message });
					clipNoteList = [];
				});
		};
		fetch();
		const release = subscribeNotesChanged(clipPath, fetch);
		return () => {
			cancelled = true;
			release();
		};
	});

	const clipNotes = $derived(playingClipPath ? clipPadNotes(clipNoteList) : null);

	// The flash: pitch → a token for the latest trigger, so a pad hit twice
	// inside PAD_FLASH_MS stays lit until the later one expires.
	const lit = new SvelteMap<number, number>();
	const litNotes = $derived(new Set(lit.keys()));
	let litToken = 0;
	let prevPos: number | null = null;
	let prevClipPath = '';

	function flash(pitch: number) {
		const token = ++litToken;
		lit.set(pitch, token);
		setTimeout(() => {
			if (lit.get(pitch) === token) lit.delete(pitch);
		}, PAD_FLASH_MS);
	}

	$effect(() => {
		const path = trackPath;
		if (!path) return;
		const pos = playingClipsStore.position(path); // the 30 Hz channel — the only dependency that should tick this
		untrack(() => {
			const entry = playing;
			const clipPath = playingClipPath;
			if (!entry || !clipPath || entry.status <= 0) {
				prevPos = null;
				prevClipPath = clipPath;
				return;
			}
			if (clipPath !== prevClipPath) {
				prevClipPath = clipPath;
				prevPos = pos;
				return;
			}
			const loopStart = entry.looping ? entry.loopStartBeats : 0;
			const loopEnd = entry.looping ? entry.loopEndBeats : entry.lengthBeats;
			if (prevPos !== null && pos !== prevPos) {
				for (const pitch of notesCrossed(clipNoteList, prevPos, pos, loopStart, loopEnd)) flash(pitch);
			}
			prevPos = pos;
		});
	});

	return {
		get clipNotes() { return clipNotes; },
		get litNotes() { return litNotes; }
	};
}
