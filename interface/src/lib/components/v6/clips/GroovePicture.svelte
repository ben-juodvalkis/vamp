<script lang="ts">
	/**
	 * A groove's timing picture: its first 8 note events as ticks over faint
	 * straight-grid lines (one per eighth of the picture), x = time, height =
	 * velocity. `amount` (0–100) draws the ticks that far from straight toward
	 * the file's pattern — the Groove view's lit tile follows its Amount;
	 * everything else shows the whole pattern. The events come from
	 * `$lib/server/grooves` (`x` already over the picture's span).
	 *
	 * Colors are the host's: `--groove-tick` for the ticks, `--groove-line`
	 * for the grid; `--groove-pic-h` its height.
	 */
	import type { GrooveEvent } from '$lib/types/grooves';

	let { events, amount = 100 }: { events: GrooveEvent[]; amount?: number } = $props();

	/** Ticks below this height would vanish at a soft velocity. */
	const MIN_HEIGHT = 18;

	const ticks = $derived(
		events.map((e, i) => {
			const straight = i / events.length;
			const x = straight + ((e.x - straight) * amount) / 100;
			return { left: Math.max(0, Math.min(1, x)) * 100, height: Math.max(MIN_HEIGHT, Math.round(e.v * 100)) };
		})
	);
</script>

<span class="groove-pic" aria-hidden="true">
	{#each ticks as t, i (i)}
		<i class="groove-tick" style:left="min({t.left}%, calc(100% - 2px))" style:height="{t.height}%"></i>
	{/each}
</span>

<style>
	.groove-pic {
		position: relative;
		display: block;
		flex: none;
		height: var(--groove-pic-h, 1.5rem);
		background-image: repeating-linear-gradient(
			to right,
			var(--groove-line, color-mix(in srgb, var(--foreground) 16%, transparent)) 0 1px,
			transparent 1px 12.5%
		);
	}
	.groove-tick {
		position: absolute;
		bottom: 0;
		width: 2px;
		background: var(--groove-tick, var(--phosphor));
	}
</style>
