/**
 * useStripGestures — the ADR-384 strip gesture machine, extracted so more
 * than one region can run it.
 *
 * The machine disambiguates four gestures from one press, using the
 * dominant axis of the first few pixels of travel plus how long the
 * finger stays put:
 *
 *   vertical-dominant drag  → the caller's drag action
 *   horizontal-dominant drag → row scroll (never a tap) — or, with
 *                              `crossAxisLive` false, nothing yet: the
 *                              press keeps waiting for the vertical axis
 *   neither, held           → long press, dispatched while still down
 *   neither, released       → tap, dispatched on release
 *
 * TrackStrip runs one instance for its top block (vertical = volume, tap =
 * section dispatch). The session-mode slot zone runs a second, independent
 * instance (vertical = scene scroll, tap = clip launch). Both keep the
 * same horizontal behavior, so a row scroll started anywhere on a strip
 * feels identical.
 *
 * Two semantics here are load-bearing and deliberately preserved from the
 * original inline implementation:
 *
 * 1. **`pointermove`/`pointerup` bind to `window`, not the element, and
 *    `setPointerCapture` is NOT used.** Capturing on a reactive component
 *    whose subtree re-renders mid-drag drops `pointerup` on desktop
 *    Chrome — the drag then never releases. Window listeners always see
 *    the release regardless of cursor position or DOM churn.
 *
 * 2. **A scroll-mode release and any `pointercancel` never dispatch a
 *    tap.** Scrolling the row must not select tracks, toggle mute, or
 *    launch a clip. `pointercancel` means the browser claimed the gesture
 *    (native pan-x, system gesture), which is a scroll by another name.
 *
 * The caller owns what a drag *means*. The machine reports raw deltas
 * plus the element height measured at press time, and never touches the
 * caller's value itself.
 *
 * ## Where the logic actually lives now (ADR-427)
 *
 * The slop threshold, the axis commit, the tap/hold/cancel rules and the
 * per-pointer bookkeeping moved into `$lib/actions/dragMachine` — pure,
 * DOM-free, and shared with `use:drag`, which is what the rest of the
 * interface now uses. Two things stayed here because they are genuinely
 * DOM concerns and nothing else needs them:
 *
 *  - walking up to the nearest horizontally-scrollable ancestor and
 *    driving its `scrollLeft` by hand on a mouse drag;
 *  - the `window`-listener binding described in note 1 above.
 *
 * The public shape of this composable is unchanged; every semantic in
 * this comment is still the semantic, and `useStripGestures.test.ts`
 * drives it end to end as the proof.
 */

import {
	createDragMachine,
	DRAG_THRESHOLD,
	TOUCH_DRAG_THRESHOLD,
	LONG_PRESS_MS,
	type DragEvent
} from '$lib/actions/dragMachine';

/**
 * Gesture constants, re-exported from the machine that owns them.
 *
 * They live in `$lib/actions/dragMachine` now — the same numbers govern
 * `use:drag` everywhere else on the surface, and two copies of a touch
 * slop is exactly the drift this program set out to remove. Re-exported
 * rather than moved outright because `parameters/actions/dragAction.ts`
 * and the strip's own callers import them from here.
 */
export { DRAG_THRESHOLD, TOUCH_DRAG_THRESHOLD, LONG_PRESS_MS };

export interface StripDragInfo {
	/** Pixels travelled UP from the press point (up positive). */
	dy: number;
	/** Pixels travelled RIGHT from the press point. */
	dx: number;
	/** Height of the gesture element, measured once at press time. */
	elementHeight: number;
	event: PointerEvent;
}

export interface StripTapInfo {
	/** Press-point coordinates — hit-test these, not the release point. */
	x: number;
	y: number;
	event: PointerEvent;
}

export interface StripGestureConfig {
	/** The gesture element. Read lazily — it binds after init. */
	getElement: () => HTMLElement | null;
	/**
	 * Fired at finger-down, before any axis is decided. Carries the
	 * press point so a caller can light the thing under the finger —
	 * these zones hit-test by geometry, so the elements inside them are
	 * not buttons and have no `:active` of their own.
	 */
	onDown?: (info: StripTapInfo) => void;
	/**
	 * Fired exactly once per press, when it stops being a candidate
	 * tap: on release, on cancel, or the moment it commits to an axis.
	 * The mirror of `onDown` — pair them to hold a pressed state.
	 *
	 * A press that commits to a drag ends here and does NOT end again
	 * on release, so a scroll doesn't leave a cell lit under the
	 * finger for the length of the swipe.
	 */
	onPressEnd?: () => void;
	/** Fired once the gesture commits to the vertical axis. */
	onDragStart?: () => void;
	/** Fired on every move after the vertical commit. */
	onDragMove?: (info: StripDragInfo) => void;
	/** Fired when a vertical drag releases. */
	onDragEnd?: () => void;
	/** Fired on release when the gesture never committed to an axis. */
	onTap?: (info: StripTapInfo) => void;
	/**
	 * Fired while the finger is still down, once it has stayed put for
	 * {@link longPressMs}. The press is consumed: the release that
	 * follows does NOT dispatch a tap, so a long press can carry a
	 * different action from a tap on the same target without the two
	 * ever both firing.
	 *
	 * Fires at the timeout rather than on release on purpose — the
	 * gesture has to announce itself while the finger is down, or it
	 * reads as a tap that did the wrong thing.
	 *
	 * Only committing to an axis cancels it: a drag is a different
	 * gesture, and jitter under the threshold is still a press.
	 */
	onLongPress?: (info: StripTapInfo) => void;
	/** Long-press duration override; defaults to {@link LONG_PRESS_MS}. */
	longPressMs?: number;
	/**
	 * Commit threshold override. When set it applies to every pointer
	 * type; unset, mouse uses {@link DRAG_THRESHOLD} and touch/pen the
	 * looser {@link TOUCH_DRAG_THRESHOLD}.
	 */
	threshold?: number;
	/**
	 * Whether a horizontal-dominant drag scrolls the nearest scrollable
	 * ancestor. Default true. Turning it off still consumes the gesture
	 * (so it can't end as a tap) — it just doesn't move anything.
	 */
	horizontalScroll?: boolean;
	/**
	 * Drive the scroller on touch as well as mouse. Default false, which
	 * is correct for a region with `touch-action: pan-x`: the browser
	 * owns the pan and we must not double-scroll it.
	 *
	 * The slot zone sets `touch-action: none` (it needs the vertical axis
	 * for scene scrolling, so it can't leave pan-x to the browser), which
	 * means no native pan happens there and this machine has to move the
	 * row itself.
	 */
	scrollOnTouch?: boolean;
	/**
	 * Whether the horizontal axis does anything right now, read at every
	 * press. Default: always true — the original rule, where a press whose
	 * first threshold of travel goes sideways is a row scroll for the rest
	 * of its life.
	 *
	 * Return false when there is no row to scroll (TrackStrip: the strips
	 * fit the panel). Sideways travel then still ends the press as a tap,
	 * but no longer locks the vertical drag out: a fader drag that set off
	 * a little sideways — a thumb's arc does exactly that — stays a fader
	 * drag instead of silently doing nothing. See
	 * `DragInput.crossInert`.
	 */
	crossAxisLive?: () => boolean;
	/**
	 * A second finger landed on this region while the first was still a
	 * candidate tap: not yet a drag, a row scroll or a slip. Return true to
	 * claim the two as one chord. The first finger's press is then dropped
	 * without a tap, and every finger on the region belongs to the chord
	 * until the last one lifts ({@link onChordEnd}).
	 *
	 * Return false (or leave unset) and the second finger is ignored, as
	 * it always was. A first finger already moving the fader is never
	 * interrupted: the chord is only offered while nothing has happened yet.
	 */
	onChordStart?: () => boolean;
	/**
	 * The claimed chord is over. `up` when the last finger lifted cleanly;
	 * `cancel` if the browser claimed any of its fingers; `teardown` if the
	 * region unmounted under it. `elapsedMs` runs from the chord's start.
	 */
	onChordEnd?: (info: { reason: 'up' | 'cancel' | 'teardown'; elapsedMs: number }) => void;
}

/**
 * Nearest ancestor that can actually scroll horizontally (the tracks
 * panel). Walked lazily at scroll-commit time; null when the row fits
 * (few tracks) — the gesture still consumes the drag so it can't end as
 * a tap.
 */
function findHorizontalScroller(from: HTMLElement | null): HTMLElement | null {
	for (let el = from?.parentElement ?? null; el; el = el.parentElement) {
		if (el.scrollWidth > el.clientWidth) {
			const overflowX = getComputedStyle(el).overflowX;
			if (overflowX === 'auto' || overflowX === 'scroll') return el;
		}
	}
	return null;
}

export function useStripGestures(config: StripGestureConfig) {
	const horizontalScroll = config.horizontalScroll ?? true;
	const scrollOnTouch = config.scrollOnTouch ?? false;

	// Exposed so callers can suppress transitions mid-drag.
	let dragging = $state(false);

	/**
	 * The gesture rules, per pointer. Single-pointer on purpose: each
	 * instance owns at most one finger at a time, but every instance can
	 * own its own finger in parallel (multitouch across strips — volume +
	 * mute on many tracks at once). A second finger on the SAME instance
	 * is ignored until the first releases, unless the caller claims it as
	 * a chord (`onChordStart`), which then owns both outside the machine.
	 *
	 * `e.isPrimary` is NOT used and never was: it is true only for the
	 * first finger of the whole gesture session, which would lock out
	 * every strip except the one the first finger landed on.
	 */
	const machine = createDragMachine({
		commit: 'y',
		threshold: config.threshold,
		holdMs: config.onLongPress ? (config.longPressMs ?? LONG_PRESS_MS) : undefined
	});

	// Element height, measured once at press time so a drag that resizes
	// its own strip can't change its own gain mid-gesture.
	let elementHeight = 0;
	let scroller: HTMLElement | null = null;
	let lastX = 0;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;

	// True from `down` to `pressend`: the open press could still be a tap,
	// which is the only time a second finger may turn it into a chord.
	let pressCandidate = false;

	// The claimed two-finger chord. Lives beside the machine rather than in
	// it: the machine owns one finger per instance, and the chord's job is
	// precisely to take the gesture away from it.
	let chord: { pointers: Set<number>; startAt: number; cancelled: boolean } | null = null;

	function endChord(reason: 'up' | 'cancel' | 'teardown') {
		if (!chord) return;
		const elapsedMs = performance.now() - chord.startAt;
		const finalReason = reason === 'up' && chord.cancelled ? 'cancel' : reason;
		chord = null;
		config.onChordEnd?.({ reason: finalReason, elapsedMs });
	}

	function clearLongPressTimer() {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function drain(events: DragEvent[], e: PointerEvent | null) {
		for (const ev of events) {
			const d = ev.drag;
			switch (ev.type) {
				case 'down':
					pressCandidate = true;
					config.onDown?.({ x: d.downX, y: d.downY, event: e as PointerEvent });
					break;
				case 'pressend':
					pressCandidate = false;
					config.onPressEnd?.();
					break;
				case 'start':
					dragging = true;
					config.onDragStart?.();
					break;
				case 'move':
					config.onDragMove?.({
						dy: d.dy,
						dx: d.dx,
						elementHeight,
						event: e as PointerEvent
					});
					break;
				case 'cross': {
					// Horizontal wins: this gesture is a row scroll, never a
					// tap. Touch scrolls natively (touch-action: pan-x — the
					// browser claims the pan and fires pointercancel); only a
					// mouse drag reaches here still delivering moves, so only
					// a mouse drives scrollLeft. Touch entering this branch
					// (borderline diagonal the browser didn't claim) just
					// suppresses the tap.
					const drivesScroller =
						horizontalScroll && (scrollOnTouch || d.pointerType === 'mouse');
					scroller = drivesScroller ? findHorizontalScroller(config.getElement()) : null;
					lastX = d.x;
					break;
				}
				case 'crossmove':
					if (scroller) {
						scroller.scrollLeft -= d.x - lastX;
						lastX = d.x;
					}
					break;
				case 'hold':
					config.onLongPress?.({
						x: d.downX,
						y: d.downY,
						event: e as PointerEvent
					});
					break;
				case 'tap':
					config.onTap?.({ x: d.downX, y: d.downY, event: e as PointerEvent });
					break;
				case 'end':
					config.onDragEnd?.();
					dragging = false;
					break;
			}
		}
		if (machine.openCount === 0) {
			clearLongPressTimer();
			if (!chord) detach();
			scroller = null;
		}
	}

	function handlePointerMove(e: PointerEvent) {
		if (chord?.pointers.has(e.pointerId)) {
			// The chord owns these fingers outright: no fader, no scroll.
			if (e.cancelable) e.preventDefault();
			return;
		}
		if (!machine.isActive(e.pointerId)) return;
		const events = machine.move({
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			x: e.clientX,
			y: e.clientY,
			now: performance.now()
		});
		// Same policy as before the extraction: preventDefault only once a
		// move has actually produced something, so an undecided press
		// still lets the native horizontal pan through.
		if (events.length > 0 && e.cancelable) e.preventDefault();
		drain(events, e);
	}

	function handlePointerUp(e: PointerEvent) {
		if (chord?.pointers.has(e.pointerId)) {
			if (e.type === 'pointercancel') chord.cancelled = true;
			chord.pointers.delete(e.pointerId);
			// The chord ends with the LAST finger, so one lifted early
			// neither ends it nor turns the other back into a fader.
			if (chord.pointers.size === 0) {
				endChord('up');
				if (machine.openCount === 0) detach();
			}
			return;
		}
		if (!machine.isActive(e.pointerId)) return;
		const input = {
			pointerId: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			now: performance.now()
		};
		drain(e.type === 'pointercancel' ? machine.cancel(input) : machine.up(input), e);
	}

	function attach() {
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerUp);
	}

	function detach() {
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerUp);
	}

	return {
		/** Bind to the gesture element's `onpointerdown`. */
		handlePointerDown(e: PointerEvent): void {
			const el = config.getElement();
			if (!el) return;
			if (chord) {
				// A third finger joins the chord rather than starting a fader.
				chord.pointers.add(e.pointerId);
				return;
			}
			if (machine.openCount > 0) {
				if (!pressCandidate || !config.onChordStart?.()) return;
				const first = machine.activePointers();
				chord = {
					pointers: new Set([...first, e.pointerId]),
					startAt: performance.now(),
					cancelled: false
				};
				// Drop the first finger's press without a tap. Teardown
				// emits `pressend` and nothing else for an undecided press.
				drain(machine.teardown(performance.now()), null);
				return;
			}
			elementHeight = el.getBoundingClientRect().height;
			dragging = false;
			const events = machine.down({
				pointerId: e.pointerId,
				pointerType: e.pointerType,
				x: e.clientX,
				y: e.clientY,
				now: performance.now(),
				crossInert: config.crossAxisLive ? !config.crossAxisLive() : false
			});
			if (events.length === 0) return;
			attach();
			if (config.onLongPress) {
				clearLongPressTimer();
				longPressTimer = setTimeout(
					() => {
						longPressTimer = null;
						// The machine decides whether this still counts: a
						// commit to an axis disqualifies the hold, so
						// reaching the timeout is not on its own enough.
						drain(machine.tick(performance.now()), null);
					},
					config.longPressMs ?? LONG_PRESS_MS
				);
			}
			drain(events, e);
			// No preventDefault yet (lets native horizontal scroll pass)
			// and no work started yet — a pure tap never opens a drag.
		},

		/** True between a vertical commit and its release. */
		get isDragging(): boolean {
			return dragging;
		},

		/**
		 * Drop any in-flight window listeners. Call from an `$effect`
		 * teardown — NOT `onDestroy`, which also runs during SSR where
		 * `window` is undefined.
		 *
		 * Closes an in-flight vertical drag first. Unmounting mid-drag is
		 * reachable (a track removed, a group folded, the mode toggled by
		 * a second finger), and callers pair `onDragStart`/`onDragEnd` to
		 * open and close shared state — so tearing down without the
		 * closing half would strand that state open with no gesture left
		 * to close it.
		 */
		destroy(): void {
			drain(machine.teardown(performance.now()), null);
			endChord('teardown');
			clearLongPressTimer();
			detach();
			dragging = false;
			scroller = null;
		}
	};
}
