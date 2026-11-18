<script lang="ts">
	/**
	 * One chip of the chain's palette bar (ADR-523): an effect a tap adds to
	 * this chain, its short name over nothing, in its family's colour. Quiet
	 * at rest (a hairline and the name), so the bar never competes with the
	 * chain under it; the colour fills in under the finger.
	 */
	import { addEffectToChain, type ChainEffect } from '$lib/services/chainEffects.svelte';
	import { press } from '$lib/actions/press';

	// Not `effect`: a variable of that name turns `$effect` into a store read.
	let { fx, label, ink }: { fx: ChainEffect; label: string; ink?: string } = $props();
</script>

<button
	type="button"
	class="palette-chip"
	style:--chip-ink={ink ?? 'var(--fg-tertiary)'}
	aria-label="Add {fx.name}"
	data-debug="chain-chip"
	use:press={{ onPress: () => void addEffectToChain(fx), touchAction: 'none', stopPropagation: true }}
>
	<span class="chip-name">{label}</span>
</button>

<style>
	.palette-chip {
		min-height: 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px 4px;
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
	.palette-chip:active {
		border-color: var(--foreground);
		background: color-mix(in srgb, var(--chip-ink) 30%, var(--secondary));
		color: var(--foreground);
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
