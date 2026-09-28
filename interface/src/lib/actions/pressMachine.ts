/**
 * The pure half of `use:press` — one discrete press, tracked per pointer.
 *
 * ## Why this exists
 *
 * The interface used to speak four input dialects, two of which could not
 * carry two fingers: `event.touches[0]` (which tracks *the first finger on
 * the glass*, not the finger that started this gesture) and `onclick`
 * (which iOS synthesizes at most once per gesture). Both produce a control
 * that either follows the wrong hand or does nothing at all when the
 * performer is using two.
 *
 * The invariant everything here is built to hold:
 *
 * > Every interaction is owned by exactly one pointer, identified by its
 * > `pointerId`, from the moment it starts to the moment it ends. No
 * > handler ever asks "where is the finger" — only "where is *my* finger."
 *
 * ## Why it is pure
 *
 * No DOM, no `window`, no timers, no `performance.now()`. Every input
 * carries its own `now`, and the hold threshold is crossed by an explicit
 * {@link PressMachine.tick} rather than by a `setTimeout` firing inside.
 * Two reasons, both load-bearing:
 *
 *  1. Multitouch scenarios become table tests. "Finger A goes down on
 *     strip 1, finger B goes down on strip 2, A releases" is three calls
 *     and one array comparison — not an iPad and a pair of hands.
 *  2. The synthetic multitouch harness (`scripts/shot/multitouch.mjs`)
 *     runs its preview **hidden**, where `requestAnimationFrame` never
 *     fires and `setTimeout` is throttled. A machine that owned its own
 *     clock could not be driven there at all.
 *
 * The house pattern — a pure, table-testable rule plus thin DOM wiring —
 * is the one `TrackStrip/utils/momentaryPress.ts` and
 * `TrackStrip/utils/slotActionZone.ts` already follow.
 */

/**
 * How long a finger must stay put before a press also reports a hold.
 *
 * Matches {@link LONG_PRESS_MS} in the drag machine, which in turn is
 * matched to the strip gestures it replaced: comfortably above iOS's own
 * ~500ms touch-and-hold callout, and well below the 800ms *confirm* holds
 * in the clip view.
 */
export const HOLD_MS = 500;

/**
 * Travel (px) after which a press abandons itself.
 *
 * Deliberately the touch figure rather than the mouse one, because the
 * abandonment this guards is a touch gesture: a horizontal pan that
 * started on a control and means to scroll the row. 6 CSS px is ~1.1 mm
 * on the iPad — inside the roll of an ordinary tap — and a press that
 * abandoned there would read as a control that "did nothing".
 *
 * A press with `touch-action: pan-x` normally abandons on the browser's
 * own `pointercancel` when it claims the pan; this is the backstop for
 * the mouse, and for the borderline diagonal the browser does not claim.
 */
export const PRESS_SLOP = 12;

/**
 * Why a press ended.
 *
 * `up`        the finger lifted — the only reason that can mean "act"
 * `cancel`    the browser claimed the gesture (native pan, system
 *             gesture). The performer never released, so a press that
 *             acts on release must NOT act.
 * `teardown`  the node went away mid-press. Same rule as `cancel`, for a
 *             worse failure: `TracksPanelV6` keys its strips by track
 *             index, so folding a group or removing an empty track
 *             destroys the component under the finger. Before the strip's
 *             Solo learned this, an interrupted press left a track soloed
 *             with no finger on it and nothing left to undo it.
 * `slop`      the press travelled past {@link PressMachineConfig.slop};
 *             it is a pan, not a tap.
 */
export type PressReleaseReason = 'up' | 'cancel' | 'teardown' | 'slop';

export interface PressRecord {
	readonly pointerId: number;
	readonly pointerType: string;
	/**
	 * Client coordinates of the DOWN point.
	 *
	 * Hit-test these, never the release point: a finger that rolled 8px
	 * across a seam still meant the thing it landed on.
	 */
	readonly x: number;
	readonly y: number;
	readonly downAt: number;
	/** Furthest travel from the down point so far, in CSS px. */
	travel: number;
	/** True once this press has crossed the hold threshold. */
	held: boolean;
}

export type PressEvent =
	| { type: 'down'; press: PressRecord }
	| { type: 'hold'; press: PressRecord }
	| {
			type: 'release';
			press: PressRecord;
			reason: PressReleaseReason;
			elapsedMs: number;
	  };

export interface PressInput {
	pointerId: number;
	pointerType?: string;
	x?: number;
	y?: number;
	now: number;
}

export interface PressMachineConfig {
	/**
	 * Travel (px) past which a press abandons itself. Defaults to
	 * {@link PRESS_SLOP}; pass `0` to disable — correct for a control that
	 * sets `touch-action: none` and therefore owns the gesture outright.
	 */
	slop?: number;
	/**
	 * Hold threshold in ms. Undefined means this press has no hold
	 * concept and {@link PressMachine.tick} never reports one.
	 */
	holdMs?: number;
	/**
	 * Whether one machine may hold several presses at once.
	 *
	 * Default `false`, which is right for a button: a second finger
	 * landing on the same button while the first is down is a fumble, not
	 * a second press, and acting on it would double-toggle. Independence
	 * *between* controls does not come from this flag — it comes from
	 * each node owning its own machine.
	 *
	 * `true` is for one machine serving many targets (a grid whose cells
	 * are hit-tested by geometry rather than by the DOM), where two
	 * fingers genuinely are two presses.
	 */
	multiPointer?: boolean;
}

export interface PressMachine {
	down(input: PressInput): PressEvent[];
	move(input: PressInput): PressEvent[];
	up(input: PressInput): PressEvent[];
	cancel(input: PressInput): PressEvent[];
	/**
	 * Advance the clock. Reports a `hold` for every open press that has
	 * been down at least `holdMs` and has not reported one yet.
	 *
	 * A hold does NOT end the press — it marks it. What a marked press
	 * does on release is the caller's policy, not the machine's.
	 */
	tick(now: number): PressEvent[];
	/** Abandon every open press. For an unmount, or an explicit reset. */
	teardown(now: number): PressEvent[];
	isActive(pointerId: number): boolean;
	/** The pointer ids currently held, in the order they arrived. */
	activePointers(): number[];
	readonly openCount: number;
}

export function createPressMachine(config: PressMachineConfig = {}): PressMachine {
	const slop = config.slop ?? PRESS_SLOP;
	const holdMs = config.holdMs;
	const multiPointer = config.multiPointer ?? false;

	/**
	 * Open presses, keyed by pointer id.
	 *
	 * A Map rather than a single `activePointerId`, because the invariant
	 * is per-pointer ownership and a scalar cannot express it. In the
	 * default single-pointer mode the map simply never exceeds one entry —
	 * but the *shape* is the multitouch one, so the concurrent case is
	 * reachable from a test rather than being a different code path.
	 */
	const open = new Map<number, PressRecord>();

	function close(
		record: PressRecord,
		reason: PressReleaseReason,
		now: number
	): PressEvent[] {
		open.delete(record.pointerId);
		return [
			{
				type: 'release',
				press: record,
				reason,
				elapsedMs: now - record.downAt
			}
		];
	}

	function endFor(input: PressInput, reason: PressReleaseReason): PressEvent[] {
		const record = open.get(input.pointerId);
		// Not our finger. This is the whole point: a second finger's
		// release used to be read as the first finger's, because
		// `changedTouches[0]` cannot tell them apart.
		if (!record) return [];
		return close(record, reason, input.now);
	}

	return {
		down(input) {
			if (open.has(input.pointerId)) return [];
			if (!multiPointer && open.size > 0) return [];
			const record: PressRecord = {
				pointerId: input.pointerId,
				pointerType: input.pointerType ?? 'touch',
				x: input.x ?? 0,
				y: input.y ?? 0,
				downAt: input.now,
				travel: 0,
				held: false
			};
			open.set(input.pointerId, record);
			return [{ type: 'down', press: record }];
		},

		move(input) {
			const record = open.get(input.pointerId);
			if (!record) return [];
			const dx = (input.x ?? 0) - record.x;
			const dy = (input.y ?? 0) - record.y;
			const travel = Math.hypot(dx, dy);
			if (travel > record.travel) record.travel = travel;
			if (slop > 0 && record.travel >= slop) {
				return close(record, 'slop', input.now);
			}
			return [];
		},

		up(input) {
			return endFor(input, 'up');
		},

		cancel(input) {
			return endFor(input, 'cancel');
		},

		tick(now) {
			if (holdMs === undefined) return [];
			const events: PressEvent[] = [];
			for (const record of open.values()) {
				if (record.held) continue;
				if (now - record.downAt >= holdMs) {
					record.held = true;
					events.push({ type: 'hold', press: record });
				}
			}
			return events;
		},

		teardown(now) {
			const events: PressEvent[] = [];
			// Snapshot: `close` mutates the map underneath the iteration.
			for (const record of [...open.values()]) {
				events.push(...close(record, 'teardown', now));
			}
			return events;
		},

		isActive(pointerId) {
			return open.has(pointerId);
		},

		activePointers() {
			return [...open.keys()];
		},

		get openCount() {
			return open.size;
		}
	};
}
