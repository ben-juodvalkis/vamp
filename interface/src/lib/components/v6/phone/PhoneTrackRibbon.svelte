<script lang="ts">
	/**
	 * The phone's colour ribbon (ADR-503): every visible track as one
	 * segment in its colour, its meter rising inside it, greyed while
	 * muted, outlined while selected. A frame marks the tracks the strips
	 * (or the clip columns) are showing, so a twelve-track set always says
	 * where on it you are; a tap on a segment selects that track, and the
	 * tab showing tracks scrolls to it.
	 */
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { meterStore } from '$lib/stores/v3/meters.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { press } from '$lib/actions/press';

	interface Props {
		/** The visible track indices, in column order. */
		tracks: number[];
		/** Tracks on screen, `[start, end)` in columns; `null` draws no frame. */
		window: { start: number; end: number } | null;
		onPick: (trackIndex: number) => void;
	}

	let { tracks, window: shown, onPick }: Props = $props();

	const segments = $derived(
		tracks.map((trackIndex) => {
			const path = `tracks/${trackIndex}`;
			const record = v3Store.tracks.get(path);
			return {
				trackIndex,
				name: record?.name ?? `Track ${trackIndex + 1}`,
				ink: trackInk(rgbToHex(record?.color ?? 0x808080), paintModeReactive()),
				muted: record?.mute ?? false,
				soloed: record?.solo === true,
				level: Math.max(0, Math.min(1, meterStore.get(path)?.left ?? 0)),
				selected: session.selectedTrackIndex === trackIndex
			};
		})
	);

	const frame = $derived(
		shown && tracks.length > 0 && shown.end > shown.start
			? {
					left: (shown.start / tracks.length) * 100,
					width: ((shown.end - shown.start) / tracks.length) * 100
				}
			: null
	);
</script>

<div class="ribbon" data-debug="phone-ribbon" style="--count: {Math.max(1, tracks.length)};">
	{#each segments as s (s.trackIndex)}
		<button
			type="button"
			class="segment"
			class:is-muted={s.muted}
			class:is-soloed={s.soloed}
			class:is-selected={s.selected}
			style="--seg-ink: {s.ink};"
			data-ribbon-track={s.trackIndex}
			aria-label="Select {s.trackIndex + 1} {s.name}"
			aria-pressed={s.selected}
			use:press={{ onPress: () => onPick(s.trackIndex), touchAction: 'manipulation' }}
		>
			<span class="level" style="transform: scaleY({s.level.toFixed(3)});"></span>
		</button>
	{/each}
	{#if frame}
		<span
			class="frame"
			aria-hidden="true"
			style="left: calc({frame.left.toFixed(3)}% - 3px); width: calc({frame.width.toFixed(3)}% + 6px);"
		></span>
	{/if}
</div>

<style>
	.ribbon {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--count), minmax(0, 1fr));
		gap: 3px;
		height: 22px;
	}

	.segment {
		position: relative;
		min-width: 0;
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 3px;
		overflow: hidden;
		background: color-mix(in oklab, var(--seg-ink) 26%, var(--card));
		-webkit-tap-highlight-color: transparent;
		cursor: pointer;
	}

	/* The meter, rising from the foot of the segment in the track's ink. */
	.level {
		position: absolute;
		inset: 0;
		background: var(--seg-ink);
		transform-origin: bottom;
		transform: scaleY(0);
	}

	.segment.is-muted {
		background: var(--muted);
	}
	.segment.is-muted .level {
		background: var(--muted-foreground);
		opacity: 0.5;
	}
	.segment.is-soloed {
		box-shadow: inset 0 0 0 2px var(--act-solo, oklch(0.72 0.13 240));
	}
	.segment.is-selected {
		outline: 2px solid var(--foreground);
		outline-offset: 1px;
	}

	/* The tracks on screen. Drawn over the segments, never in their way. */
	.frame {
		position: absolute;
		top: -4px;
		bottom: -4px;
		border: 1.5px solid color-mix(in oklab, var(--foreground) 80%, transparent);
		border-radius: 5px;
		pointer-events: none;
	}
</style>
