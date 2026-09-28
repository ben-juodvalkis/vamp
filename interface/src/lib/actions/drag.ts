/**
 * `use:drag` — the continuous half of the pointer primitive.
 *
 * Thin DOM wiring over {@link createDragMachine}, on exactly the same
 * terms as `press.ts`: the machine owns the slop threshold and the axis
 * commit and is unit-tested without a browser; this file owns
 * `touch-action`, the capture-vs-window choice, and teardown.
 *
 * ## Usage
 *
 * ```svelte
 * <div use:drag={{ commit: 'immediate', onMove: ({ dy, height }) => … }}>
 * ```
 *
 * `height` and `width` are the node's measured box at press time, handed
 * back on every callback so a caller can express a drag as a fraction of
 * its own control without re-measuring mid-gesture (which would read a
 * box the drag itself may be resizing).
 */

import {
	createDragMachine,
	type DragMachine,
	type DragEndReason,
	type DragCommit,
	type DragMode
} from './dragMachine';

export interface DragInfo {
	pointerId: number;
	pointerType: string;
	/** Client coordinates of the DOWN point. Hit-test these. */
	downX: number;
	downY: number;
	/** Latest client coordinates. */
	x: number;
	y: number;
	/** Pixels travelled RIGHT from the press point. */
	dx: number;
	/** Pixels travelled UP from the press point (up positive). */
	dy: number;
	/** The node's box, measured once at press time. */
	height: number;
	width: number;
	mode: DragMode;
	event: PointerEvent | null;
}

export interface DragEndInfo extends DragInfo {
	reason: DragEndReason;
}

export interface DragOptions {
	/** Finger down, before any axis is decided. */
	onDown?: (info: DragInfo) => void;
	/** Committed to the drag axis. */
	onStart?: (info: DragInfo) => void;
	/** Every move after `onStart`. */
	onMove?: (info: DragInfo) => void;
	/** Committed to the OTHER axis — this gesture is not ours. */
	onCross?: (info: DragInfo) => void;
	/** Every move after `onCross`. */
	onCrossMove?: (info: DragInfo) => void;
	/** Stayed put past {@link holdMs}, while still down. Consumes the tap. */
	onHold?: (info: DragInfo) => void;
	/** Fires once when the press stops being a candidate tap. */
	onPressEnd?: (info: DragInfo) => void;
	/** Released without committing, and not spent by a hold. */
	onTap?: (info: DragInfo) => void;
	/** A committed drag ended — by release, cancel, or unmount. */
	onEnd?: (info: DragEndInfo) => void;

	commit?: DragCommit;
	threshold?: number;
	holdMs?: number;
	multiPointer?: boolean;
	/**
	 * Written onto the node's inline style. Defaults to `none`: a drag
	 * that has to share an axis with the browser is not a drag. Pass
	 * `pan-x` for a vertical drag inside a horizontally-scrolling row that
	 * must leave the row's own pan alone.
	 */
	touchAction?: string;
	/** See `PressOptions.binding`. Default `window`. */
	binding?: 'window' | 'capture';
	/**
	 * `preventDefault()` on moves once the gesture has committed. Default
	 * true — stops the page scrolling out from under a drag.
	 */
	preventDefaultOnMove?: boolean;
	/** `stopPropagation()` on the `pointerdown`. Default false. */
	stopPropagation?: boolean;
	disabled?: boolean;
}

export function drag(node: HTMLElement, options: DragOptions = {}) {
	let opts = options;
	let machine: DragMachine = build(opts);
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let lastEvent: PointerEvent | null = null;
	// Measured once per press, not per move: a drag can resize its own
	// node (a brace, a fader with a growing fill), and re-measuring would
	// make the gain drift under the finger.
	let boxHeight = 0;
	let boxWidth = 0;

	function build(o: DragOptions): DragMachine {
		return createDragMachine({
			commit: o.commit,
			threshold: o.threshold,
			holdMs: o.holdMs,
			multiPointer: o.multiPointer
		});
	}

	function applyTouchAction() {
		node.style.touchAction = opts.touchAction ?? 'none';
	}

	function clearHoldTimer() {
		if (holdTimer !== null) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function info(record: {
		pointerId: number;
		pointerType: string;
		downX: number;
		downY: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
		mode: DragMode;
	}): DragInfo {
		return {
			pointerId: record.pointerId,
			pointerType: record.pointerType,
			downX: record.downX,
			downY: record.downY,
			x: record.x,
			y: record.y,
			dx: record.dx,
			dy: record.dy,
			height: boxHeight,
			width: boxWidth,
			mode: record.mode,
			event: lastEvent
		};
	}

	function drain(events: ReturnType<DragMachine['down']>) {
		for (const ev of events) {
			switch (ev.type) {
				case 'down':
					opts.onDown?.(info(ev.drag));
					break;
				case 'start':
					opts.onStart?.(info(ev.drag));
					break;
				case 'move':
					opts.onMove?.(info(ev.drag));
					break;
				case 'cross':
					opts.onCross?.(info(ev.drag));
					break;
				case 'crossmove':
					opts.onCrossMove?.(info(ev.drag));
					break;
				case 'hold':
					opts.onHold?.(info(ev.drag));
					break;
				case 'pressend':
					opts.onPressEnd?.(info(ev.drag));
					break;
				case 'tap':
					opts.onTap?.(info(ev.drag));
					break;
				case 'end':
					opts.onEnd?.({ ...info(ev.drag), reason: ev.reason });
					break;
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
		if (before === 0) {
			const rect = node.getBoundingClientRect();
			boxHeight = rect.height;
			boxWidth = rect.width;
			attach();
		}
		if ((opts.binding ?? 'window') === 'capture') {
			try {
				node.setPointerCapture(e.pointerId);
			} catch {
				// See press.ts — not fatal, the listeners still see the end.
			}
		}
		if (opts.holdMs !== undefined && holdTimer === null) {
			holdTimer = setTimeout(() => {
				holdTimer = null;
				drain(machine.tick(performance.now()));
			}, opts.holdMs);
		}
		drain(events);
		// No preventDefault at down: that would kill the native horizontal
		// pan before the gesture has decided it isn't one.
	}

	function handlePointerMove(e: PointerEvent) {
		if (!machine.isActive(e.pointerId)) return;
		lastEvent = e;
		const events = machine.move({
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			x: e.clientX,
			y: e.clientY,
			now: performance.now()
		});
		if (events.length > 0 && (opts.preventDefaultOnMove ?? true) && e.cancelable) {
			e.preventDefault();
		}
		drain(events);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!machine.isActive(e.pointerId)) return;
		lastEvent = e;
		const input = {
			pointerId: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			now: performance.now()
		};
		drain(e.type === 'pointercancel' ? machine.cancel(input) : machine.up(input));
	}

	function attach() {
		const target: EventTarget =
			(opts.binding ?? 'window') === 'capture' ? node : window;
		target.addEventListener('pointermove', handlePointerMove as EventListener);
		target.addEventListener('pointerup', handlePointerUp as EventListener);
		target.addEventListener('pointercancel', handlePointerUp as EventListener);
	}

	function detach() {
		for (const target of [node, window] as EventTarget[]) {
			target.removeEventListener('pointermove', handlePointerMove as EventListener);
			target.removeEventListener('pointerup', handlePointerUp as EventListener);
			target.removeEventListener('pointercancel', handlePointerUp as EventListener);
		}
	}

	applyTouchAction();
	node.addEventListener('pointerdown', handlePointerDown);

	return {
		update(next: DragOptions) {
			const rebuild =
				next.commit !== opts.commit ||
				next.threshold !== opts.threshold ||
				next.holdMs !== opts.holdMs ||
				next.multiPointer !== opts.multiPointer;
			const touchChanged = next.touchAction !== opts.touchAction;
			opts = next;
			if (touchChanged) applyTouchAction();
			if (rebuild && machine.openCount === 0) machine = build(opts);
		},
		destroy() {
			lastEvent = null;
			// Close an in-flight drag before dropping the listeners.
			// Callers pair `onStart`/`onEnd` to open and close shared
			// state, so tearing down without the closing half would strand
			// that state open with no gesture left to close it.
			drain(machine.teardown(performance.now()));
			clearHoldTimer();
			detach();
			node.removeEventListener('pointerdown', handlePointerDown);
		},
		/** True while any pointer is committed to the drag axis. */
		get isDragging() {
			return machine.isDragging;
		}
	};
}
