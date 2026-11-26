<script lang="ts">
	/** A palette chip's picture: what the effect does (`effectGlyphs`). */
	import type { GlyphStroke } from './effectGlyphs';

	let { strokes }: { strokes: GlyphStroke[] } = $props();
</script>

<svg class="effect-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#each strokes as s, i (i)}
		<path
			d={s.d}
			opacity={s.o}
			fill={s.fill ? 'currentColor' : undefined}
			stroke={s.fill ? 'none' : undefined}
			stroke-dasharray={s.dash}
			stroke-width={s.w}
		/>
	{/each}
</svg>
