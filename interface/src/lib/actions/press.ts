/**
 * `use:press` — the discrete half of the pointer primitive.
 *
 * Thin DOM wiring over {@link createPressMachine}. Everything that decides
 * *what a press means* lives in the machine and is unit-tested there; this
 * file owns only the three things that need a real node:
 *
 *  1. **`touch-action`, written onto the node the handler is attached to.**
 *     This is the fix for the trap that broke mute. `.header-name`
 *     computed `touch-action: auto` — nothing set it, and `touch-action`
 *     does not inherit, so the `manipulation` declared on `html, body` in
 *     `app.css` never reached it. Inside a horizontally-scrolling panel
 *     `auto` hands the gesture to the browser, which is then free to
 *     suppress the click. Any control whose CSS and whose handler are
 *     authored in different places will eventually drift apart exactly
 *     like that one did; an action that sets both cannot.
 *  2. **Choosing between pointer capture and window listeners** — see
 *     {@link PressOptions.binding}.
 *  3. **Teardown.** An action owns its own `destroy`, so a node that
 *     unmounts mid-press closes that press instead of leaking it. That
 *     kills a bug class this repo has already been bitten by: the strip's
 *     Solo used to leave a track soloed with no finger on it when
 *     `TracksPanelV6` destroyed the strip under the hand.
 *
 * ## Usage
 *
 * ```svelte
 * <div use:press={{ onPress: mute, touchAction: 'pan-x' }}>…</div>
 * ```
 *
 * The default (`fireOn: 'up'`) is the `click` replacement: same timing as
 * a click, but owned by one `pointerId` and abandoned explicitly on
 * `pointercancel` rather than silently swallowed by the browser.
 */

import {
	createPressMachine,
	type PressMachine,
	type PressReleaseReason
} from './pressMachine';

export interface PressInfo {
	pointerId: number;
	pointerType: string;
	/** Client coordinates of the DOWN point. Hit-test these. */
	x: number;
	y: number;
	/**
	 * The event that produced this callback.
	 *
	 * Null for a `teardown` release: the node went away and no event
	 * caused it, so there is nothing honest to hand back. Callers that
	 * only need to know *what* ended read `reason`, never this.
	 */
	event: PointerEvent | KeyboardEvent | null;
}

export interface PressReleaseInfo extends PressInfo {
	reason: PressReleaseReason;
	elapsedMs: number;
	/** True if this press had already reported a hold. */
	held: boolean;
	/** True if this release is the one that fired `onPress`. */
	fired: boolean;
}

export interface PressOptions {
	/**
	 * The action. Fired once per press — at `pointerdown` or at the
	 * release, per {@link fireOn}.
	 */
	onPress?: (info: PressInfo) => void;
	/** Finger down, before any decision. Pair with `onRelease` to light a state. */
	onDown?: (info: PressInfo) => void;
	/** The press stayed put past {@link holdMs}, while still down. */
	onHold?: (info: PressInfo) => void;
	/**
	 * Every ending, whatever the reason — including the abandonments
	 * (`cancel`, `teardown`, `slop`) that must NOT act.
	 */
	onRelease?: (info: PressReleaseInfo) => void;
	/**
	 * `up` (default) fires the action on release, and abandons on
	 * `pointercancel`. This is the `click` replacement: a horizontal pan
	 * starting on the control still scrolls the row natively (given
	 * `touch-action: pan-x`), and the cancel the browser sends when it
	 * claims that pan is the abandon signal.
	 *
	 * `down` fires at true finger-down — zero latency, no intent gate.
	 * Correct only for a control that also sets `touch-action: none`, so
	 * no pan can ever start on it and there is nothing to abandon. Anything
	 * else gets a control that acts and then un-acts on every row pan
	 * crossing it, which on mute is an audible blip mid-performance.
	 */
	fireOn?: 'down' | 'up';
	/** Hold threshold in ms. Omit for a press with no hold concept. */
	holdMs?: number;
	/** Travel (px) past which the press abandons. See `PRESS_SLOP`. */
	slop?: number;
	/**
	 * Written onto the node's inline style. Defaults to `manipulation`
	 * (taps and pans, no double-tap zoom).
	 *
	 * Declare it explicitly whenever the answer is not the default —
	 * `pan-x` for a control inside the horizontally-scrolling tracks row
	 * that must let the row scroll, `none` for one that owns the gesture
	 * outright.
	 */
	touchAction?: string;
	/**
	 * Where the move/up listeners live.
	 *
	 * `window` (default) — window listeners filtered by `pointerId`.
	 * Correct when the element can unmount or re-render mid-press, which
	 * on this surface is most of them: `TracksPanelV6` keys its strips by
	 * track index, so folding a group or removing an empty track destroys
	 * the component under the finger. `useStripGestures`'s header comment
	 * records the other half of the reason — capturing on a reactive
	 * component whose subtree re-renders mid-drag drops `pointerup` on
	 * desktop Chrome, and the gesture then never releases.
	 *
	 * `capture` — `setPointerCapture` on the node. The browser routes the
	 * pointer, so N stable elements take N fingers with no bookkeeping.
	 * Use it only where the target is a single stable element.
	 */
	binding?: 'window' | 'capture';
	/** See `PressMachineConfig.multiPointer`. Default false. */
	multiPointer?: boolean;
	/** `stopPropagation()` on the `pointerdown`. Default false. */
	stopPropagation?: boolean;
	/** `preventDefault()` on the `pointerdown`. Default false. */
	preventDefault?: boolean;
	/**
	 * Keyboard equivalence: Enter / Space fire `onPress`. Default true, so
	 * replacing an `onclick` with this action does not silently drop the
	 * keyboard path an `onclick` had for free.
	 */
	keyboard?: boolean;
	/** When true the node ignores pointers entirely. */
	disabled?: boolean;
}

export function press(node: HTMLElement, options: PressOptions = {}) {
	let opts = options;
	let machine: PressMachine = build(opts);
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * The `fireOn` each open press was claimed under, resolved once at
	 * `pointerdown` and kept for that press.
	 *
	 * `fireOn` is reactive on some controls — mute reads it from whether
	 * the tracks row can actually scroll (ADR-427 addendum 2), which can
	 * change while a finger is down if another client adds a track. Read
	 * live at both ends, a press that started as `down` and ended as `up`
	 * would fire twice: once at finger-down and again on release. Pinning
	 * it per press makes a timing policy a property of the gesture rather
	 * than of the moment it is asked about.
	 */
	const claimedFireOn = new Map<number, 'down' | 'up'>();
	/**
	 * The event currently being processed. Null while draining a
	 * teardown, which no event caused.
	 */
	let lastEvent: PointerEvent | KeyboardEvent | null = null;

	function build(o: PressOptions): PressMachine {
		return createPressMachine({
			slop: o.slop,
			holdMs: o.holdMs,
			multiPointer: o.multiPointer
		});
	}

	function applyTouchAction() {
		node.style.touchAction = opts.touchAction ?? 'manipulation';
	}

	function clearHoldTimer() {
		if (holdTimer !== null) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function info(
		press_: { pointerId: number; pointerType: string; x: number; y: number },
		event: PointerEvent | KeyboardEvent | null
	): PressInfo {
		return {
			pointerId: press_.pointerId,
			pointerType: press_.pointerType,
			x: press_.x,
			y: press_.y,
			event
		};
	}

	function drain(events: ReturnType<PressMachine['down']>) {
		const event = lastEvent;
		for (const ev of events) {
			if (ev.type === 'down') {
				const mode = opts.fireOn ?? 'up';
				claimedFireOn.set(ev.press.pointerId, mode);
				opts.onDown?.(info(ev.press, event));
				if (mode === 'down') opts.onPress?.(info(ev.press, event));
			} else if (ev.type === 'hold') {
				opts.onHold?.(info(ev.press, event));
			} else {
				const mode = claimedFireOn.get(ev.press.pointerId) ?? opts.fireOn ?? 'up';
				claimedFireOn.delete(ev.press.pointerId);
				const fired = mode === 'up' && ev.reason === 'up' && !ev.press.held;
				if (fired) opts.onPress?.(info(ev.press, event));
				opts.onRelease?.({
					...info(ev.press, event),
					reason: ev.reason,
					elapsedMs: ev.elapsedMs,
					held: ev.press.held,
					fired
				});
			}
		}
		if (machine.openCount === 0) {
			clearHoldTimer();
			detach();
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (opts.disabled) return;
		if (opts.stopPropagation) e.stopPropagation();
		if (opts.preventDefault) e.preventDefault();
		lastEvent = e;
		const before = machine.openCount;
		const events = machine.down({
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			x: e.clientX,
			y: e.clientY,
			now: performance.now()
		});
		if (events.length === 0) return;
		if (before === 0) attach();
		// Capture is claimed per POINTER, not per press session: with
		// `multiPointer` two fingers on the same node are two captures.
		if ((opts.binding ?? 'window') === 'capture') capturePointer(e);
		if (opts.holdMs !== undefined && holdTimer === null) {
			holdTimer = setTimeout(() => {
				holdTimer = null;
				drain(machine.tick(performance.now()));
			}, opts.holdMs);
		}
		drain(events);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!machine.isActive(e.pointerId)) return;
		lastEvent = e;
		drain(
			machine.move({
				pointerId: e.pointerId,
				x: e.clientX,
				y: e.clientY,
				now: performance.now()
			})
		);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!machine.isActive(e.pointerId)) return;
		lastEvent = e;
		const input = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, now: performance.now() };
		drain(e.type === 'pointercancel' ? machine.cancel(input) : machine.up(input));
	}

	function capturePointer(e: PointerEvent) {
		try {
			node.setPointerCapture(e.pointerId);
		} catch {
			// A pointer that ended between dispatch and here throws
			// NotFoundError, and jsdom has no capture at all. Neither is
			// fatal: the listeners below still see the release, they just
			// see it wherever it lands rather than retargeted here.
		}
	}

	function attach() {
		// Capture routes move/up back to this node, so the listeners can
		// be the node's own and the browser does the pointer filtering.
		const target: EventTarget =
			(opts.binding ?? 'window') === 'capture' ? node : window;
		target.addEventListener('pointermove', handlePointerMove as EventListener);
		target.addEventListener('pointerup', handlePointerUp as EventListener);
		target.addEventListener('pointercancel', handlePointerUp as EventListener);
	}

	function detach() {
		// Both targets unconditionally: `binding` can change between an
		// attach and its detach, and removing a listener that was never
		// added is free.
		for (const target of [node, window] as EventTarget[]) {
			target.removeEventListener('pointermove', handlePointerMove as EventListener);
			target.removeEventListener('pointerup', handlePointerUp as EventListener);
			target.removeEventListener('pointercancel', handlePointerUp as EventListener);
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (opts.disabled) return;
		if ((opts.keyboard ?? true) === false) return;
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		lastEvent = e;
		const synthetic = {
			pointerId: -1,
			pointerType: 'key',
			x: 0,
			y: 0
		};
		opts.onPress?.(info(synthetic, e));
	}

	applyTouchAction();
	node.addEventListener('pointerdown', handlePointerDown);
	node.addEventListener('keydown', handleKeyDown);

	return {
		update(next: PressOptions) {
			const rebuild =
				next.slop !== opts.slop ||
				next.holdMs !== opts.holdMs ||
				next.multiPointer !== opts.multiPointer;
			const touchChanged = next.touchAction !== opts.touchAction;
			opts = next;
			if (touchChanged) applyTouchAction();
			// Only rebuild when the machine's own configuration moved, and
			// never mid-press: swapping the machine under a live finger
			// would drop the release that closes it.
			if (rebuild && machine.openCount === 0) machine = build(opts);
		},
		destroy() {
			// No event caused this, so callbacks get `event: null`.
			lastEvent = null;
			// Close every open press before dropping the listeners. An
			// unmount mid-press is an interrupted gesture, not a completed
			// one — the caller's `onRelease` is what puts the pre-press
			// state back.
			drain(machine.teardown(performance.now()));
			clearHoldTimer();
			detach();
			node.removeEventListener('pointerdown', handlePointerDown);
			node.removeEventListener('keydown', handleKeyDown);
		}
	};
}
