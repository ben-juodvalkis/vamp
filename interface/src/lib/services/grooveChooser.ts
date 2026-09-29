/**
 * Touching Q on a clip with no groove puts it on the Groove view's first tile
 * (2026-09-29, the user's call), so the view opens with a groove lit and the
 * Amount slider has a pattern to move toward. Amount starts at 0: the clip
 * sounds as it did until Amount is raised. A clip that has a groove — any
 * groove, a tile or not — keeps it.
 *
 * Acts only on the clip that was already focused, and only once the surface
 * has said it has no groove (`hasGrooveKnown`): a clip focused by this very
 * touch, or one whose `has_groove` echo is still on its way, is left alone,
 * so a groove is never replaced on a guess.
 */
import { send } from '$lib/api/simpleClient';
import { V3_CLIP_GROOVE_SET_FILE_ADDRESS, V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS } from '$lib/api/handlers/v3ClipGroove';
import { clipGrooveStore } from '$lib/stores/v6/clipGrooveStore.svelte';
import { groovesStore } from '$lib/stores/v6/groovesStore.svelte';
import { session } from '$lib/stores/session.svelte';

/** The groove file sent, or null when the clip was left as it was. */
export function loadFirstGrooveIfNone(clipPath: string | null): string | null {
	if (!clipPath || clipPath !== session.focusedClipPath) return null;
	if (!clipGrooveStore.hasGrooveKnown || clipGrooveStore.hasGroove) return null;
	const first = groovesStore.tickedFiles[0];
	if (!first) return null;
	clipGrooveStore.chooseFile(first.name);
	send(V3_CLIP_GROOVE_SET_FILE_ADDRESS, [clipPath, first.name]);
	send(V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS, [clipPath, 0]);
	return first.name;
}
