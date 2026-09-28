/**
 * The pure half of `use:drag` — one continuous drag, tracked per pointer.
 *
 * This is the axis-commit logic proven in
 * `components/v6/tracks/composables/useStripGestures.svelte.ts` (ADR-384),
 * lifted out of that composable so there is one implementation of it and
 * so it can be driven without a DOM. `useStripGestures` now runs on this
 * machine and keeps only what is genuinely a DOM concern: finding the
 * horizontal scroller, and the window-listener binding its header comment
 * explains.
 *
 * The rules it encodes, all of which are felt live:
 *
 *  - **A gesture commits to an axis, once, after a slop threshold.** The
 *    threshold is looser for touch than for mouse: a cursor goes exactly
 *    where it is put, a finger rolls.
 *  - **A committed gesture is never a tap.** Scrolling the tracks row must
 *    not select tracks, toggle mute, or launch a clip.
 *  - **A cancelled gesture is never a tap.** `pointercancel` means the
 *    browser claimed the gesture — a scroll by another name.
 *  - **A press that already fired as a hold is spent.** Letting it also
 *    tap would launch the clip the hold just opened.
 *  - **A cross axis with nothing to scroll locks nothing out**
 *    (`DragInput.crossInert`). Sideways travel still means "not a tap",
 *    but a fader drag that set off a little sideways stays a fader drag.
 *
 * Purity, and why the clock is injected rather than owned, are covered in
 * `pressMachine.ts`.
 */

/**
 * Travel (px) before a MOUSE gesture commits to an axis. A cursor goes
 * exactly where it is put, so this can stay tight.
 */
export const DRAG_THRESHOLD = 6;

/**
 * Travel (px) before a TOUCH gesture commits to an axis.
 *
 * Deliberately looser than the mouse value: 6 CSS px is ~1.1 mm on the
 * iPad, which is well inside the roll of an ordinary finger tap. At that
 * threshold a tap that rolled a hair committed to an axis and was
 * therefore never dispatched as a tap — the strip "did nothing" (or
 * nudged volume by ~1%). 12px is close to the platform's own touch slop
 * and still far below any drag a performer means.
 */
export const TOUCH_DRAG_THRESHOLD = 12;

/**
 * How long a finger must stay put before a press becomes a long press.
 *
 * Matched to the hold buttons in the clip view (`HOLD_DURATION = 800`
 * there is a *confirm* hold, deliberately slower) and comfortably above
 * iOS's own ~500ms touch-and-hold, so a long press here doesn't race
 * Safari's callout on the rare element that still has one.
 */
export const LONG_PRESS_MS = 500;

/**
 * Which axis a gesture is allowed to commit to.
 *
 * `y`          vertical-dominant commits to the drag; horizontal goes
 *              `cross` (the strip fader: vertical = volume, horizontal =
 *              row scroll)
 * `x`          the mirror of `y`
 * `either`     whichever axis passes the threshold first is the drag, and
 *              nothing is ever `cross` (a free 2-D drag: XY pads, braces
 *              that track both axes)
 * `immediate`  no threshold at all — the drag opens at pointerdown. For a
 *              control whose whole surface IS the value (a loop brace
 *              handle), where waiting 12px means the first 12px of the
 *              gesture are silently dropped.
 */
export type DragCommit = 'y' | 'x' | 'either' | 'immediate';

export type DragMode = 'undecided' | 'drag' | 'cross';

export type DragEndReason = 'up' | 'cancel' | 'teardown';

export interface DragRecord {
	readonly pointerId: number;
	pointerType: string;
	/** Client coordinates of the DOWN point. Hit-test these. */
	readonly downX: number;
	readonly downY: number;
	readonly downAt: number;
	/** Latest client coordinates. */
	x: number;
	y: number;
	/** Pixels travelled RIGHT from the press point. */
	dx: number;
	/**
	 * Pixels travelled UP from the press point (up positive).
	 *
	 * Inverted relative to client coordinates on purpose: every consumer
	 * of this is a fader or a value, and "up is more" is the thing they
	 * all want. Flipping it here means no call site does the subtraction
	 * backwards.
	 */
	dy: number;
	mode: DragMode;
	held: boolean;
}

export type DragEvent =
	/** Finger down. Fired before any axis is decided. */
	| { type: 'down'; drag: DragRecord }
	/** Committed to the drag axis. */
	| { type: 'start'; drag: DragRecord }
	/** Every move after `start`. */
	| { type: 'move'; drag: DragRecord }
	/** Committed to the OTHER axis — this gesture is not ours. */
	| { type: 'cross'; drag: DragRecord }
	/** Every move after `cross`. Lets a caller drive a scroller by hand. */
	| { type: 'crossmove'; drag: DragRecord }
	/** Stayed put past the hold threshold, while still down. */
	| { type: 'hold'; drag: DragRecord }
	/**
	 * Fired exactly once per press, when it stops being a candidate tap:
	 * on release, on cancel, or the moment it commits to an axis. The
	 * mirror of `down` — pair them to hold a pressed state.
	 */
	| { type: 'pressend'; drag: DragRecord }
	/** Released without ever committing, and not spent by a hold. */
	| { type: 'tap'; drag: DragRecord }
	/** A committed drag ended. Only fires when `mode === 'drag'`. */
	| { type: 'end'; drag: DragRecord; reason: DragEndReason };

export interface DragInput {
	pointerId: number;
	/**
	 * Optional on `move`: when present it refreshes the record.
	 *
	 * A real `PointerEvent` carries the same `pointerType` for the whole
	 * life of a pointer id, so in a browser this changes nothing. It is
	 * read live rather than only at `down` because that is what the strip
	 * machine did before the extraction, and the threshold choice is the
	 * one place the difference would be visible.
	 */
	pointerType?: string;
	x: number;
	y: number;
	now: number;
	/**
	 * Read on `down` only, and only by `commit: 'y' | 'x'`: the cross axis
	 * does nothing for THIS press — there is nothing for it to scroll.
	 *
	 * By default a press whose first threshold of travel goes the cross
	 * way commits to `cross` for the rest of its life, which is right
	 * when that axis pans a row: the performer asked for the scroll.
	 * When the row cannot scroll, the same rule only throws the gesture
	 * away — a fader drag that started a little sideways never became a
	 * drag, and nothing else moved either. With this set, cross-axis
	 * travel still ends the press (no tap, no hold: the finger plainly
	 * moved) but the drag axis stays open, and the press commits the
	 * moment it passes the threshold and dominates on that axis, exactly
	 * as an undecided press does. Nothing is ever `cross`.
	 *
	 * Per press rather than per machine because whether the row can
	 * scroll changes while the machine lives.
	 */
	crossInert?: boolean;
}

export interface DragMachineConfig {
	commit?: DragCommit;
	/** Threshold override applied to EVERY pointer type. */
	threshold?: number;
	/** Mouse threshold; defaults to {@link DRAG_THRESHOLD}. */
	mouseThreshold?: number;
	/** Touch/pen threshold; defaults to {@link TOUCH_DRAG_THRESHOLD}. */
	touchThreshold?: number;
	/** Hold threshold in ms. Undefined = this gesture has no hold. */
	holdMs?: number;
	/** See {@link PressMachineConfig.multiPointer}. Default false. */
	multiPointer?: boolean;
}

export interface DragMachine {
	down(input: DragInput): DragEvent[];
	move(input: DragInput): DragEvent[];
	up(input: DragInput): DragEvent[];
	cancel(input: DragInput): DragEvent[];
	tick(now: number): DragEvent[];
	teardown(now: number): DragEvent[];
	isActive(pointerId: number): boolean;
	activePointers(): number[];
	/** True while any pointer is committed to the drag axis. */
	readonly isDragging: boolean;
	readonly openCount: number;
}

export function createDragMachine(config: DragMachineConfig = {}): DragMachine {
	const commit = config.commit ?? 'y';
	const holdMs = config.holdMs;
	const multiPointer = config.multiPointer ?? false;

	// An explicit override applies to every pointer type; otherwise touch
	// gets the looser slop and mouse the tight one.
	const thresholdFor = (pointerType: string) =>
		config.threshold ??
		(pointerType === 'mouse'
			? (config.mouseThreshold ?? DRAG_THRESHOLD)
			: (config.touchThreshold ?? TOUCH_DRAG_THRESHOLD));

	interface Entry {
		record: DragRecord;
		/** True between `down` and `pressend`. */
		pressOpen: boolean;
		/** {@link DragInput.crossInert}, latched at `down`. */
		crossInert: boolean;
		/**
		 * Passed the threshold on an inert cross axis: no longer a tap or
		 * a hold, still free to commit to the drag axis.
		 */
		slipped: boolean;
	}

	const open = new Map<number, Entry>();

	function update(record: DragRecord, input: DragInput) {
		if (input.pointerType !== undefined) record.pointerType = input.pointerType;
		record.x = input.x;
		record.y = input.y;
		record.dx = input.x - record.downX;
		record.dy = record.downY - input.y;
	}

	function endPress(entry: Entry, events: DragEvent[]) {
		if (!entry.pressOpen) return;
		entry.pressOpen = false;
		events.push({ type: 'pressend', drag: entry.record });
	}

	function finish(
		entry: Entry,
		reason: DragEndReason,
		fireTap: boolean
	): DragEvent[] {
		const events: DragEvent[] = [];
		const { record } = entry;
		open.delete(record.pointerId);
		endPress(entry, events);

		if (record.mode === 'drag') {
			events.push({ type: 'end', drag: record, reason });
			return events;
		}
		// A cross-axis gesture is never a tap — scrolling the row must not
		// select a track — and neither is one that travelled that way with
		// nothing to scroll. `cancel`/`teardown` follow the same rule: the
		// browser claimed the gesture, or the node went away, and neither
		// is a performer's deliberate tap.
		if (record.mode === 'cross' || entry.slipped || reason !== 'up') return events;
		// A press that already fired as a hold is spent.
		if (record.held) return events;
		if (fireTap) events.push({ type: 'tap', drag: record });
		return events;
	}

	return {
		down(input) {
			if (open.has(input.pointerId)) return [];
			if (!multiPointer && open.size > 0) return [];
			const record: DragRecord = {
				pointerId: input.pointerId,
				pointerType: input.pointerType ?? 'touch',
				downX: input.x,
				downY: input.y,
				downAt: input.now,
				x: input.x,
				y: input.y,
				dx: 0,
				dy: 0,
				mode: commit === 'immediate' ? 'drag' : 'undecided',
				held: false
			};
			const entry: Entry = {
				record,
				pressOpen: true,
				crossInert: input.crossInert ?? false,
				slipped: false
			};
			open.set(input.pointerId, entry);
			const events: DragEvent[] = [{ type: 'down', drag: record }];
			if (record.mode === 'drag') {
				// `immediate` has no candidate-tap phase at all.
				endPress(entry, events);
				events.push({ type: 'start', drag: record });
			}
			return events;
		},

		move(input) {
			const entry = open.get(input.pointerId);
			if (!entry) return [];
			const { record } = entry;
			update(record, input);
			const events: DragEvent[] = [];

			if (record.mode === 'undecided') {
				const threshold = thresholdFor(record.pointerType);
				const adx = Math.abs(record.dx);
				const ady = Math.abs(record.dy);
				let next: DragMode | null = null;
				if (commit === 'either') {
					if (Math.max(adx, ady) >= threshold) next = 'drag';
				} else if (commit === 'y') {
					// Ties go to the drag axis: `dy >= threshold && dy >= dx`
					// is the original strip rule, and a dead-diagonal press
					// on a fader means the fader.
					if (adx >= threshold && adx > ady) next = 'cross';
					else if (ady >= threshold && ady >= adx) next = 'drag';
				} else {
					if (ady >= threshold && ady > adx) next = 'cross';
					else if (adx >= threshold && adx >= ady) next = 'drag';
				}
				if (next === 'cross' && entry.crossInert) {
					// Nothing to scroll, so nothing to commit to: the press
					// just stops being a tap (and a hold), and stays
					// undecided so the drag axis can still take it. The
					// same test runs on every later move — dominance is
					// measured from the press point — so a start that
					// leaned sideways becomes a drag once the finger has
					// gone further along the drag axis than across it.
					entry.slipped = true;
					endPress(entry, events);
					return events;
				}
				if (!next) return events;
				record.mode = next;
				// Committed to an axis — this press is a drag or a cross,
				// not a hold, and not a press-highlight either. (Below the
				// threshold the finger is still just resting, so jitter
				// must NOT cancel either one.)
				endPress(entry, events);
				events.push({ type: next === 'drag' ? 'start' : 'cross', drag: record });
				// The committing move is ALSO a move. Deliberate, and the
				// behaviour the strip machine always had: `dx`/`dy` already
				// include the threshold travel, so a fader that skipped
				// this event would sit one threshold behind the finger for
				// the rest of the gesture. A cross consumer gets the same
				// event and is expected to anchor on `cross` and treat this
				// first one as a zero delta, so the row does not jump a
				// threshold's worth the instant the gesture resolves.
				events.push({
					type: next === 'drag' ? 'move' : 'crossmove',
					drag: record
				});
				return events;
			}

			events.push({
				type: record.mode === 'drag' ? 'move' : 'crossmove',
				drag: record
			});
			return events;
		},

		up(input) {
			const entry = open.get(input.pointerId);
			if (!entry) return [];
			update(entry.record, input);
			return finish(entry, 'up', true);
		},

		cancel(input) {
			const entry = open.get(input.pointerId);
			if (!entry) return [];
			update(entry.record, input);
			return finish(entry, 'cancel', false);
		},

		tick(now) {
			if (holdMs === undefined) return [];
			const events: DragEvent[] = [];
			for (const entry of open.values()) {
				const { record } = entry;
				// Only committing to an axis cancels a hold: a drag is a
				// different gesture, and jitter under the threshold is
				// still a press. A slip past it on an inert cross axis is
				// travel too, even though it committed to nothing.
				if (record.held || record.mode !== 'undecided' || entry.slipped) continue;
				if (now - record.downAt >= holdMs) {
					record.held = true;
					events.push({ type: 'hold', drag: record });
				}
			}
			return events;
		},

		teardown(now) {
			const events: DragEvent[] = [];
			for (const entry of [...open.values()]) {
				// `now` is unused by `finish` — a teardown carries no
				// elapsed-time decision — but taken so the signature
				// matches the press machine and a caller can't misread it
				// as clock-free.
				void now;
				events.push(...finish(entry, 'teardown', false));
			}
			return events;
		},

		isActive(pointerId) {
			return open.has(pointerId);
		},

		activePointers() {
			return [...open.keys()];
		},

		get isDragging() {
			for (const entry of open.values()) {
				if (entry.record.mode === 'drag') return true;
			}
			return false;
		},

		get openCount() {
			return open.size;
		}
	};
}
