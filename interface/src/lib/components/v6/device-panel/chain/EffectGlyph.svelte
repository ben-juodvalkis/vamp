<script lang="ts">
	/**
	 * A palette chip's icon (`effectGlyphs`): drawn on the pictures' 100 box
	 * with a margin, every line the same weight whatever the box's scale.
	 */
	import type { GlyphStroke } from './effectGlyphs';

	let { strokes }: { strokes: GlyphStroke[] } = $props();
</script>

<svg class="effect-glyph" viewBox="-6 -6 112 112" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#each strokes as s, i (i)}
		<path
			d={s.d}
			transform={s.t}
			opacity={s.o}
			fill={s.fill ? 'currentColor' : undefined}
			stroke={s.fill ? 'none' : undefined}
			stroke-width="1.5"
			vector-effect="non-scaling-stroke"
		/>
	{/each}
</svg>
