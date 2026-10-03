<script lang="ts">
	/**
	 * VerticalQuantizeControl - Vertical quantization slider
	 * Simplified: tap or drag anywhere to set value
	 * Uses requestAnimationFrame-based throttling for smooth response.
	 *
	 * Touching it also opens the Groove view in the central display
	 * (2026-09-29), the clip's groove: which file it swings to, Random,
	 * Velocity and Amount. The well wears the selection edge while that
	 * view is up, so the two read as one control. On a clip with no groove
	 * the touch also puts it on the view's first tile at Amount 0
	 * (`services/grooveChooser`).
	 */
	import { browser } from '$app/environment';
	import { clipGrooveStore } from '$lib/stores/v6/clipGrooveStore.svelte';
	import { onMount } from 'svelte';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
	import { groovesStore } from '$lib/stores/v6/groovesStore.svelte';
	import { loadFirstGrooveIfNone } from '$lib/services/grooveChooser';
	import { focusPlayingClipOnSelectedTrack } from '$lib/components/v6/tracks/composables/slotActions';
	import { createSliderThrottle } from '$lib/utils/sliderThrottle';
	import { drag as dragAction, type DragInfo } from '$lib/actions/drag';
	import { setClipGrooveQuantizationAmount } from '$lib/services/clipCommands';

	// A clip with no groove (or no clip at all) has no quantize: Q reads 0.
	let quantizationAmount = $derived(clipGrooveStore.hasGroove ? clipGrooveStore.quantizationAmount : 0);

	// UI state
	let containerRef = $state<HTMLElement | null>(null);
	let isDragging = $state(false);
	let optimisticValue = $state<number | null>(null);

	// Use optimistic value during drag, otherwise use actual value
	let displayValue = $derived(optimisticValue ?? quantizationAmount);

	let grooveViewUp = $derived(centralDisplayStore.view.type === 'groove');

	// The tiles, so a touch on a clip with no groove knows the first one.
	onMount(() => {
		if (!groovesStore.listing) void groovesStore.refresh();
	});

	// Calculate handle position percentage (inverted for vertical - 0 at bottom, 100 at top)
	let handlePercentage = $derived(100 - (displayValue / 100) * 100);

	/**
	 * The clip this gesture writes to, resolved once at touch-down.
	 *
	 * Held for the gesture rather than read per write: when the fallback
	 * fires it focuses a clip, and the echo landing mid-drag must not
	 * move which clip the rest of the drag is writing to.
	 */
	let gestureClipPath: string | null = null;

	// Send quantization change (called by throttle). Assignment-on-
	// first-write happens server-side in GrooveComponent.
	function setQuantization(value: number) {
		if (!gestureClipPath) return;
		setClipGrooveQuantizationAmount(gestureClipPath, value);
	}

	// Frame-synchronized throttle for smooth updates
	const throttle = createSliderThrottle((value: number) => {
		setQuantization(value);
	});

	// Convert screen position to percentage value (vertical)
	function screenToValue(screenY: number): number {
		if (!containerRef) return 0;

		const rect = containerRef.getBoundingClientRect();
		// Invert: top of container = 100%, bottom = 0%
		const percentage = 1 - (screenY - rect.top) / rect.height;
		return Math.max(0, Math.min(100, percentage * 100));
	}

	/**
	 * One press, one pointer, absolute: the value follows wherever the
	 * finger is, from touch-down onward (ADR-427, `commit: 'immediate'` —
	 * this control has no tap/drag distinction to make, and waiting for a
	 * slop threshold would drop the first 12px of every gesture).
	 *
	 * It used to read `event.touches[0].clientY`, which is *the first
	 * finger on the glass* rather than the finger that started this drag.
	 * Dragging the quantize slider while the other hand held anything at
	 * all made it follow the other hand — a wrong VALUE, silently, not a
	 * dead control.
	 */
	const quantizeDrag: Parameters<typeof dragAction>[1] = {
		commit: 'immediate',
		touchAction: 'none',
		stopPropagation: true,
		onStart: () => {
			// Nothing focused: fall back to the clip running on the
			// selected track, focusing it on the way past so the central
			// view and this slider's own readout follow. Q needs no clip
			// data to write — the value is the finger's position — so the
			// very first touch both aims and sets.
			gestureClipPath = focusPlayingClipOnSelectedTrack({ showClip: false });
			centralDisplayStore.setView('groove');
			// Ahead of the first quantize write, so that write lands on it.
			loadFirstGrooveIfNone(gestureClipPath);
			isDragging = true;
			throttle.start();
		},
		onMove: ({ y }: DragInfo) => {
			const val = Math.round(screenToValue(y));
			// Update UI immediately, queue for the frame-synchronised send.
			optimisticValue = val;
			throttle.push(val);
		},
		onEnd: () => {
			isDragging = false;
			// Send the final value immediately.
			throttle.flush();
			optimisticValue = null;
			gestureClipPath = null;
		}
	};
</script>

{#if browser}
	<div
		bind:this={containerRef}
		class="relative w-full h-full rounded-lg select-none transition-colors duration-100 cursor-pointer quantize-container"
		class:groove-up={grooveViewUp}
		style="overflow: hidden; z-index: 10;"
		use:dragAction={quantizeDrag}
		role="slider"
		tabindex={0}
		aria-label="Quantization amount"
		aria-orientation="vertical"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={displayValue}
	>
		<!-- Filled region (bottom to handle position) -->
		<div
			class="absolute inset-x-0 bottom-0 rounded-md pointer-events-none quantize-fill"
			class:dragging={isDragging}
			style="height: {100 - handlePercentage}%;"
		></div>

		<!-- Handle indicator (visual only) -->
		<div
			class="absolute inset-x-1 h-2 rounded-full pointer-events-none quantize-handle"
			class:dragging={isDragging}
			class:h-3={isDragging}
			style="top: {handlePercentage}%; transform: translateY(-50%);"
		></div>

		<!-- Label -->
		<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
			<span class="font-bold num text-6xl quantize-label">Q</span>
		</div>
	</div>
{:else}
	<div class="h-full flex items-center justify-center text-muted-foreground">
		<div class="loading-pulse-small"></div>
	</div>
{/if}

<style>
	/* Lane = recessed well + act-quant hairline (§5.7). */
	.quantize-container {
		background: var(--surface-well);
		border: 1px solid var(--act-quant-line);
	}

	/* Transitions enabled by default, disabled during drag */
	.quantize-fill {
		background-color: var(--act-quant-fill);
		border: 1px solid var(--act-quant-line);
		transition: height 0.1s ease-out;
	}

	.quantize-handle {
		background-color: var(--act-quant);
		transition: top 0.1s ease-out;
	}

	.quantize-label {
		color: var(--fg-tertiary);
	}

	/* Disable transitions during active dragging for instant response */
	.quantize-fill.dragging,
	.quantize-handle.dragging {
		transition: none;
	}

	/* Flat grammar: a ControlBackground lane in a dark frame, solid RangeDefault
	   fill, grey grip, control-text label. */
	:global([data-grammar="flat"]) .quantize-container {
		border: 1px solid var(--line-strong);
		border-radius: 2px;
	}
	/* The Groove view is up: the selection edge, Live's blue. */
	:global([data-grammar="flat"]) .quantize-container.groove-up {
		border: 2px solid var(--flat-selection);
	}
	:global([data-grammar="flat"]) .quantize-fill {
		background-color: var(--act-monitor);
		border: 0;
		border-radius: 0;
	}
	:global([data-grammar="flat"]) .quantize-handle {
		background-color: var(--flat-handle);
		border-radius: 0;
	}
	:global([data-grammar="flat"]) .quantize-label {
		color: var(--foreground);
		font-weight: var(--font-weight-medium);
	}

	.loading-pulse-small {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background-color: color-mix(in oklab, var(--signal-dim) 50%, transparent);
		animation: undulate 2s ease-in-out infinite;
	}

	@keyframes undulate {
		0%, 100% {
			opacity: 0.2;
			transform: scale(0.8);
		}
		50% {
			opacity: 0.5;
			transform: scale(1.1);
		}
	}
</style>
