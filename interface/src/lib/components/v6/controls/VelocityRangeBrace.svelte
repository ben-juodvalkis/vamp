<script lang="ts">
	import { familyScheme } from '$lib/config/devicePresets';
	/**
	 * VelocityRangeBrace - Vertical range control for Velocity Out Low/Out Hi
	 *
	 * Features:
	 * - Bottom handle: Out Low (param 7)
	 * - Top handle: Out Hi (param 6)
	 * - Middle drag: Move entire range
	 * - Vertical orientation (0 at bottom, 127 at top)
	 */
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { drag as dragAction, type DragInfo, type DragOptions } from '$lib/actions/drag';

	// Velocity parameter indices
	const VELOCITY_PARAMS = {
		OUT_LOW: 7,
		OUT_HI: 6
	} as const;

	interface Props {
		device: DeviceRecord | null;
		isGhost?: boolean;
		color?: { primary: string; secondary: string; accent: string };
		onInteraction?: () => void;
	}

	let { device, isGhost = false, color, onInteraction }: Props = $props();

	// Read parameters (1-127 range)
	let outLow = $derived(
		device ? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, VELOCITY_PARAMS.OUT_LOW)) ?? 1) : 1
	);
	let outHi = $derived(
		device ? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, VELOCITY_PARAMS.OUT_HI)) ?? 127) : 127
	);

	// Normalize to 0-1 for display (1-127 → 0-1)
	let normalizedLow = $derived((outLow - 1) / 126);
	let normalizedHi = $derived((outHi - 1) / 126);

	// UI state
	let containerRef = $state<HTMLElement | null>(null);
	let isDragging = $state<'low' | 'high' | 'range' | null>(null);
	let dragStartValues = $state({ low: 0, high: 1 });

	// Display values
	let displayLow = $derived(normalizedLow);
	let displayHi = $derived(normalizedHi);

	// Calculate positions as percentages (0% = bottom, 100% = top)
	let lowPercentage = $derived(displayLow * 100);
	let highPercentage = $derived(displayHi * 100);
	let heightPercentage = $derived(Math.max(0, highPercentage - lowPercentage));

	// Convert normalized (0-1) to parameter value (1-127)
	function normalizedToParam(normalized: number): number {
		return Math.round(normalized * 126 + 1);
	}

	// Set Out Low
	function setLow(normalized: number) {
		const clamped = Math.max(0, Math.min(normalizedHi - 0.01, normalized));
		const paramValue = normalizedToParam(clamped);
		if (device) {
			selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, VELOCITY_PARAMS.OUT_LOW), paramValue);
		}
	}

	// Set Out Hi
	function setHigh(normalized: number) {
		const clamped = Math.max(normalizedLow + 0.01, Math.min(1, normalized));
		const paramValue = normalizedToParam(clamped);
		if (device) {
			selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, VELOCITY_PARAMS.OUT_HI), paramValue);
		}
	}

	/**
	 * The three brace drags (ADR-427).
	 *
	 * They used to read `event.touches[0].clientY` — the first finger on the
	 * glass, not the finger that started this drag — so dragging a velocity
	 * bound while the other hand held anything made the bound follow the
	 * other hand. A wrong value, written to Live, with nothing on screen
	 * saying so.
	 *
	 * `commit: 'immediate'` because a brace handle has no tap meaning to
	 * disambiguate from: the whole control is the value.
	 */
	function braceDrag(type: 'low' | 'high' | 'range'): DragOptions {
		return {
			commit: 'immediate',
			touchAction: 'none',
			stopPropagation: true,
			onStart: () => {
				onInteraction?.();
				isDragging = type;
				dragStartValues = { low: normalizedLow, high: normalizedHi };
			},
			onMove: ({ dy }: DragInfo) => applyDrag(dy),
			onEnd: () => {
				isDragging = null;
			}
		};
	}

	/** `deltaY` is pixels travelled UP from the press point. */
	function applyDrag(deltaY: number) {
		if (!isDragging || !containerRef) return;

		const rect = containerRef.getBoundingClientRect();
		const deltaNormalized = deltaY / rect.height;

		if (isDragging === 'low') {
			// Drag bottom handle
			const newLow = Math.max(0, Math.min(dragStartValues.high - 0.01, dragStartValues.low + deltaNormalized));
			setLow(newLow);
		} else if (isDragging === 'high') {
			// Drag top handle
			const newHigh = Math.max(dragStartValues.low + 0.01, Math.min(1, dragStartValues.high + deltaNormalized));
			setHigh(newHigh);
		} else if (isDragging === 'range') {
			// Drag middle - move both
			const range = dragStartValues.high - dragStartValues.low;
			let newLow = dragStartValues.low + deltaNormalized;
			let newHigh = dragStartValues.high + deltaNormalized;

			// Clamp to bounds
			if (newLow < 0) {
				newLow = 0;
				newHigh = range;
			}
			if (newHigh > 1) {
				newHigh = 1;
				newLow = 1 - range;
			}

			setLow(newLow);
			setHigh(newHigh);
		}
	}

	const rangeDrag: DragOptions = $derived(braceDrag('range'));
	const lowDrag: DragOptions = $derived(braceDrag('low'));
	const highDrag: DragOptions = $derived(braceDrag('high'));

	// Default color — dynamics family (velocity IS dynamics; ADR-400)
	const defaultColor = familyScheme('dynamics');
	let effectiveColor = $derived(color ?? defaultColor);
</script>

<div
	class="h-full w-full flex flex-col vel-brace"
	class:is-ghost={isGhost}
	style:opacity={isGhost ? 'var(--opacity-ghost, 0.4)' : '1'}
	style:--vel-ink={effectiveColor.primary}
	style:--vel-accent={effectiveColor.accent}
>
	<!-- Velocity Range Track (vertical) -->
	<div
		bind:this={containerRef}
		class="relative w-full flex-1 rounded-lg select-none border-2 range-lane"
		class:cursor-ns-resize={!isGhost}
		class:dragging={isDragging !== null}
		style="
			touch-action: none;
			overflow: hidden;
		"
		role="slider"
		tabindex={0}
		aria-label="Velocity output range"
		aria-valuemin={1}
		aria-valuemax={127}
		aria-valuenow={outLow}
		aria-valuetext="{outLow}–{outHi}"
	>
		<!-- Active range region -->
		<div
			class="absolute inset-x-0 rounded-md shadow-lg border-2 range-region"
			class:cursor-grab={!isDragging}
			class:cursor-grabbing={isDragging === 'range'}
			class:dragging={isDragging !== null}
			style="
				--range-region-bg: {isDragging === 'range' ? 'var(--vel-ink)' : 'color-mix(in srgb, var(--vel-ink), transparent 50%)'};
				bottom: {lowPercentage}%;
				height: {heightPercentage}%;
				z-index: 50;
			"
			use:dragAction={rangeDrag}
			role="slider"
			tabindex={0}
			aria-label="Velocity range"
			aria-valuemin={1}
			aria-valuemax={127}
			aria-valuenow={outLow}
			aria-valuetext="{outLow}–{outHi}"
		></div>

		<!-- Low handle (bottom) - large touch target -->
		<div
			class="absolute inset-x-0 h-16 range-handle"
			class:cursor-ns-resize={!isGhost}
			class:dragging={isDragging !== null}
			style="bottom: {lowPercentage}%; z-index: 100;"
			use:dragAction={lowDrag}
			role="slider"
			tabindex={0}
			aria-label="Out Low"
			aria-orientation="vertical"
			aria-valuenow={outLow}
		>
			<!-- Visual handle bar at bottom edge -->
			<div
				class="absolute bottom-0 inset-x-1 rounded-t-lg range-handle-bar"
				class:dragging={isDragging !== null}
				class:h-8={!isDragging || isDragging !== 'low'}
				class:h-10={isDragging === 'low'}
			>
				<!-- Grip lines indicator -->
				<div class="absolute inset-x-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 items-center justify-center pointer-events-none">
					<div class="w-8 h-0.5 rounded-full range-grip"></div>
					<div class="w-6 h-0.5 rounded-full range-grip"></div>
				</div>
			</div>
		</div>

		<!-- High handle (top) - large touch target -->
		<div
			class="absolute inset-x-0 h-16 range-handle"
			class:cursor-ns-resize={!isGhost}
			class:dragging={isDragging !== null}
			style="bottom: {highPercentage}%; z-index: 100; transform: translateY(100%);"
			use:dragAction={highDrag}
			role="slider"
			tabindex={0}
			aria-label="Out Hi"
			aria-orientation="vertical"
			aria-valuenow={outHi}
		>
			<!-- Visual handle bar at top edge -->
			<div
				class="absolute top-0 inset-x-1 rounded-b-lg range-handle-bar"
				class:dragging={isDragging !== null}
				class:h-8={!isDragging || isDragging !== 'high'}
				class:h-10={isDragging === 'high'}
			>
				<!-- Grip lines indicator -->
				<div class="absolute inset-x-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 items-center justify-center pointer-events-none">
					<div class="w-6 h-0.5 rounded-full range-grip"></div>
					<div class="w-8 h-0.5 rounded-full range-grip"></div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* Colours are class-owned, all derived from the two custom props on the
	   root (`--vel-ink` = scheme primary, `--vel-accent` = scheme accent), so
	   the flat block below re-skins them by specificity alone. */
	.range-lane {
		border-color: color-mix(in srgb, var(--vel-ink), transparent 50%);
		background: color-mix(in srgb, var(--vel-ink), transparent 85%);
	}

	/* Transitions enabled by default, disabled during drag */
	.range-region {
		background-color: var(--range-region-bg);
		border-color: color-mix(in srgb, var(--vel-ink), transparent 30%);
		transition: bottom 0.1s ease-out, height 0.1s ease-out;
	}

	.range-handle {
		transition: bottom 0.1s ease-out;
	}

	.range-handle-bar {
		background-color: var(--vel-accent);
		box-shadow: 0 0 12px color-mix(in srgb, var(--vel-ink), transparent 30%);
		transition: height 0.1s ease-out;
	}

	.range-grip {
		background-color: color-mix(in srgb, var(--vel-ink), transparent 60%);
	}

	/* Disable transitions during active dragging for instant response */
	.range-region.dragging,
	.range-handle.dragging,
	.range-handle-bar.dragging {
		transition: none;
	}

	/* ---- Live skin (flat grammar, cookbook §8.1): the brace is a flat
	   ControlBackground lane in a 1px dark frame — no ink wash, no 2px
	   tinted border, 2px radius. The range is a SOLID value fill (no
	   translucent block, no border, no drop shadow, square): the device ink
	   under the shared grammar / hybrid (`--vel-ink`, lifted off the inline
	   colour on the root), Live's RangeDefault under the live skin, and the
	   disabled grey when the device is a ghost (the ghost opacity dim itself
	   stays, as DeviceSlider keeps it). Handle bars are square
	   ControlFillHandle grips without the glow; the grip lines take the scrim.
	   Graticule is untouched — everything sits under [data-grammar="flat"] /
	   [data-skin]. */
	:global([data-grammar="flat"]) .range-lane {
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
	}
	:global([data-grammar="flat"]) .range-region {
		background-color: var(--vel-ink);
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}

	:global([data-grammar="flat"]) .range-handle-bar {
		background-color: var(--flat-handle);
		box-shadow: none;
		border-radius: 0;
	}
	:global([data-grammar="flat"]) .range-grip {
		background-color: var(--scrim);
		border-radius: 0;
	}
</style>
