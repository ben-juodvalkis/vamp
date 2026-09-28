/**
 * Svelte Action for Parameter Drag Interaction
 * Proper Svelte pattern for reusable DOM behavior
 */

import { debounce } from '$lib/utils/performance/debounce';
import {
	DRAG_THRESHOLD,
	TOUCH_DRAG_THRESHOLD
} from '$lib/components/v6/tracks/composables/useStripGestures.svelte';

export interface DragActionOptions {
    orientation: 'vertical' | 'horizontal';
    min: number;
    max: number;
    value: number;
    sensitivity?: number;
    enableJumpToClick?: boolean;
    onChange: (value: number) => void;
    debounceMs?: number;  // Optional debounce for onChange
    onTap?: () => void;  // Optional callback for tap (non-drag) events
    onDragStart?: () => void;  // Called when drag begins
    onDragEnd?: () => void;  // Called when drag ends
}

/**
 * Svelte action for drag interaction
 * Usage: <div use:drag={options}>
 */
export function drag(node: HTMLElement, options: DragActionOptions) {
    let isDragging = false;
    let hasActuallyDragged = false;
    let startPos = 0;
    let startValue = 0;

    // Default options
    const opts = {
        sensitivity: 1,
        enableJumpToClick: true,
        debounceMs: 0,
        ...options
    };

    // Create debounced onChange if requested
    const debouncedOnChange = opts.debounceMs > 0
        ? debounce(opts.onChange, opts.debounceMs, { leading: true, trailing: true })
        : opts.onChange;

    function clamp(value: number): number {
        return Math.max(opts.min, Math.min(opts.max, value));
    }

    function handlePointerDown(e: PointerEvent) {
        // Jump to click if enabled and not shift-clicking
        if (opts.enableJumpToClick && !e.shiftKey) {
            const rect = node.getBoundingClientRect();
            const percent = opts.orientation === 'vertical'
                ? 1 - ((e.clientY - rect.top) / rect.height)
                : (e.clientX - rect.left) / rect.width;

            const newValue = opts.min + (percent * (opts.max - opts.min));
            debouncedOnChange(clamp(newValue));
        }

        // Start drag
        isDragging = true;
        hasActuallyDragged = false;
        startPos = opts.orientation === 'vertical' ? e.clientY : e.clientX;
        startValue = opts.value;

        // Call drag start callback
        opts.onDragStart?.();

        // Capture pointer
        node.setPointerCapture(e.pointerId);
        e.preventDefault();
    }

    function handlePointerMove(e: PointerEvent) {
        if (!isDragging) return;

        const currentPos = opts.orientation === 'vertical' ? e.clientY : e.clientX;

        // A drag has to travel before it counts as one. Any pointermove at
        // all used to set `hasActuallyDragged`, and a finger tap always
        // emits a few — so a tap on a fader was read as a drag, `onTap`
        // never fired, and the tap nudged the value by a fraction of a
        // percent instead. Same slop the strip gestures use, and for the
        // same reason: 6 CSS px is ~1.1 mm on the iPad, well inside the
        // roll of an ordinary tap, so touch gets the looser value.
        if (!hasActuallyDragged) {
            const slop = e.pointerType === 'mouse' ? DRAG_THRESHOLD : TOUCH_DRAG_THRESHOLD;
            if (Math.abs(currentPos - startPos) < slop) return;
            hasActuallyDragged = true;
        }

        const delta = (startPos - currentPos) * opts.sensitivity;
        const rect = node.getBoundingClientRect();
        const size = opts.orientation === 'vertical' ? rect.height : rect.width;

        // Calculate new value
        const percentChange = delta / size;
        const valueChange = percentChange * (opts.max - opts.min);
        const newValue = startValue + valueChange;

        debouncedOnChange(clamp(newValue));
        e.preventDefault();
    }

    function handlePointerUp(e: PointerEvent) {
        if (isDragging) {
            isDragging = false;
            node.releasePointerCapture(e.pointerId);
            
            // Call drag end callback
            opts.onDragEnd?.();
            
            // If we actually dragged, prevent click events from firing
            if (hasActuallyDragged) {
                e.stopPropagation();
                e.preventDefault();
            } else if (opts.onTap) {
                // This was a tap (no drag movement), call the tap handler
                opts.onTap();
                e.stopPropagation();
                e.preventDefault();
            }
        }
    }

    function handlePointerCancel(e: PointerEvent) {
        handlePointerUp(e);
    }

    // Add event listeners
    node.addEventListener('pointerdown', handlePointerDown);
    node.addEventListener('pointermove', handlePointerMove);
    node.addEventListener('pointerup', handlePointerUp);
    node.addEventListener('pointercancel', handlePointerCancel);

    // Make it keyboard accessible
    node.setAttribute('role', 'slider');
    node.setAttribute('tabindex', '0');

    return {
        // Update method - called when options change
        update(newOptions: DragActionOptions) {
            opts.orientation = newOptions.orientation;
            opts.min = newOptions.min;
            opts.max = newOptions.max;
            opts.value = newOptions.value;
            opts.sensitivity = newOptions.sensitivity ?? 1;
            opts.enableJumpToClick = newOptions.enableJumpToClick ?? true;
            opts.onChange = newOptions.onChange;
            opts.onTap = newOptions.onTap;
            opts.onDragStart = newOptions.onDragStart;
            opts.onDragEnd = newOptions.onDragEnd;

            // Update ARIA attributes
            node.setAttribute('aria-valuemin', String(opts.min));
            node.setAttribute('aria-valuemax', String(opts.max));
            node.setAttribute('aria-valuenow', String(opts.value));
        },

        // Destroy method - cleanup
        destroy() {
            node.removeEventListener('pointerdown', handlePointerDown);
            node.removeEventListener('pointermove', handlePointerMove);
            node.removeEventListener('pointerup', handlePointerUp);
            node.removeEventListener('pointercancel', handlePointerCancel);
        }
    };
}