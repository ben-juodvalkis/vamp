<script lang="ts">
	/**
	 * One chip of the chain's palette bar (ADR-523): an effect a tap adds to
	 * this chain, its short name over nothing, in its family's colour. Quiet
	 * at rest (a hairline and the name), so the bar never competes with the
	 * chain under it; the colour fills in under the finger.
	 */
	import { addEffectToChain, type ChainEffect } from '$lib/services/chainEffects.svelte';
	import { press } from '$lib/actions/press';
	import EffectGlyph from './EffectGlyph.svelte';
	import { effectGlyph } from './effectGlyphs';

	// Not `effect`: a variable of that name turns `$effect` into a store read.
	// `passive`: the palette's own gesture reads the chip (ADR-548's hold),
	// so the chip takes no press of its own; `hot` is the one under the finger.
	let { fx, label, ink, passive = false, hot = false }: { fx: ChainEffect; label: string; ink?: string; passive?: boolean; hot?: boolean } = $props();

	// What it does, drawn beside the name (2026-11-25): its preset key, else its file's name.
	const glyph = $derived(effectGlyph(fx.preset ?? fx.name));
</script>

<button
	type="button"
	class="palette-chip"
	class:hot
	style:--chip-ink={ink ?? 'var(--fg-tertiary)'}
	aria-label="Add {fx.name}"
	data-debug="chain-chip"
	use:press={{ onPress: () => void addEffectToChain(fx), touchAction: 'none', stopPropagation: true, disabled: passive }}
>
	{#if glyph}<span class="chip-glyph"><EffectGlyph strokes={glyph} /></span>{/if}
	<span class="chip-name">{label}</span>
</button>

<style>
	.palette-chip {
		min-height: 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 2px 4px;
		container-type: inline-size;
		/* Not on the chain yet, so an outline where a device on it is a
		   slab. A faint wash of its family's colour (ADR-547) tells the
		   blocks apart; the name stays plain. */
		border: 1px solid color-mix(in srgb, var(--chip-ink) 38%, var(--line));
		border-radius: var(--ghost-radius, 4px);
		background: color-mix(in srgb, var(--chip-ink) 11%, transparent);
		color: var(--muted-foreground);
		font: inherit;
		text-align: center;
		cursor: pointer;
		overflow: hidden;
		-webkit-tap-highlight-color: transparent;
		transition: background-color var(--t-fast) var(--ease-precise), color var(--t-fast) var(--ease-precise);
	}
	.palette-chip.hot,
	.palette-chip:active {
		border-color: var(--foreground);
		background: color-mix(in srgb, var(--chip-ink) 30%, var(--secondary));
		color: var(--foreground);
	}
	/* The picture in the family's colour, the name plain beside it. */
	.chip-glyph {
		flex: none;
		display: flex;
		width: 20px;
		height: 20px;
		color: color-mix(in srgb, var(--chip-ink) 75%, var(--foreground));
	}
	.chip-glyph :global(svg) {
		width: 100%;
		height: 100%;
	}
	/* A chip too narrow for both keeps the name. */
	@container (max-width: 96px) {
		.chip-glyph {
			display: none;
		}
	}
	/* A long name (Drum Buss, Pitch Hack) wraps to two lines, between words. */
	.chip-name {
		max-width: 100%;
		min-width: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.005em;
		line-height: 1.1;
		white-space: normal;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
</style>
