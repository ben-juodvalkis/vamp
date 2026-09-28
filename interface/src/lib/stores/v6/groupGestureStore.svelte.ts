/**
 * The "hold Group, tap track strips, release" gesture's local state.
 *
 * **Nothing touches Live until the gesture ends** (2026-09-20 rewrite). The
 * first version clicked each tapped track into Live's real selection as the
 * tap happened, on the theory that Live's own `AXSelectedRows` could serve as
 * the pending state and save this store from tracking it. That made every
 * tap a real Accessibility round trip racing the *next* tap, and a `commit`/
 * `cancel` landing mid-flight (the bridge nulls its gesture record at the
 * start of both) crashed the in-flight tap outright — reproduced live,
 * single client, no exotic interleaving required. It also meant a tap that
 * happened to switch the central view (a device band tap, a session-grid
 * cell) could unmount `ClipCentralView` and fire its own `onDestroy` cancel
 * *while a click was in flight*. None of that is fixable by hardening one
 * more await boundary — the design was doing real, order-sensitive work on
 * every tap of what is supposed to be a quiet selection gesture.
 *
 * So taps are now pure bookkeeping — an id in a `Set`, nothing more — and
 * every track named by the finished set (the anchor plus every tap that
 * stuck) is sent to the bridge **once**, on `commit`, which is the only
 * point real Accessibility clicks and the ⌘G keystroke happen. `cancel` is
 * now genuinely free: nothing happened on Live's side to undo.
 */

import { commitGroupGesture } from '$lib/services/trackOperations';
import { logger } from '$lib/utils/logger';

class GroupGestureStore {
	active = $state(false);
	/** Released quickly once already: no pointer needs to stay down any more,
	 * and the next tap on the Group button commits rather than starting over. */
	latched = $state(false);
	anchorPath = $state<string | null>(null);
	anchorName = $state('');
	tapped = $state<Map<string, string>>(new Map());

	/** Every path currently part of the pending group: the anchor plus every
	 * tap that has stuck. */
	get memberPaths(): Set<string> {
		const set = new Set(this.tapped.keys());
		if (this.anchorPath) set.add(this.anchorPath);
		return set;
	}

	/** Begin the gesture. Purely local — the anchor is just remembered for
	 * `commit`, and Live is not touched until then. */
	start(trackPath: string, trackName: string): void {
		this.active = true;
		this.latched = false;
		this.anchorPath = trackPath;
		this.anchorName = trackName;
		this.tapped = new Map();
	}

	/** A quick first release: leave the gesture open with no pointer down. */
	latch(): void {
		this.latched = true;
	}

	/** Toggle `trackPath` into or out of the pending group. Local only —
	 * Live's selection is not touched until `commit`. */
	tap(trackPath: string, trackName: string): void {
		if (!this.active || trackPath === this.anchorPath) return;
		const next = new Map(this.tapped);
		if (next.has(trackPath)) next.delete(trackPath);
		else next.set(trackPath, trackName);
		this.tapped = next;
	}

	/** Button released (or tapped again while latched): send the whole
	 * pending set to the bridge in one call — every real click and the ⌘G
	 * keystroke happen here, and only here. */
	async commit(): Promise<void> {
		if (!this.active || !this.anchorPath) return;
		const members = [
			{ path: this.anchorPath, name: this.anchorName },
			...[...this.tapped.entries()].map(([path, name]) => ({ path, name }))
		];
		try {
			await commitGroupGesture(members);
		} catch (error) {
			logger.error('Group gesture: commit failed', { component: 'groupGestureStore', error });
		} finally {
			this.reset();
		}
	}

	/** Button dragged off before release, or Cancel tapped on the banner.
	 * Nothing happened on Live's side yet, so there is nothing to undo. */
	cancel(): void {
		this.reset();
	}

	private reset(): void {
		this.active = false;
		this.latched = false;
		this.anchorPath = null;
		this.anchorName = '';
		this.tapped = new Map();
	}
}

export const groupGestureStore = new GroupGestureStore();
