<script lang="ts">
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import DeviceEmptyState from '../DeviceEmptyState.svelte';

	const fx = useFxGridSlot('redux');
</script>

{#if fx.device}
	<div class="h-full w-full flex flex-col items-center justify-center relative">
		<!-- ◐ rides an opacity-based ghost ramp rather than device ink. -->
		<div class="redux-glyph text-4xl mb-4">◐</div>
		<p class="redux-title text-sm font-medium">Redux</p>
		<p class="redux-name text-xs mt-2 opacity-50">{fx.device.name}</p>
	</div>
{:else if fx.isGhost}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="h-full w-full flex flex-col items-center justify-center relative slot-ghost"
		onclick={() => fx.loadIfGhost()}
	>
		<div class="text-4xl mb-4" style="opacity: var(--opacity-ghost);">◐</div>
		<p class="redux-title text-sm font-medium" style="opacity: var(--opacity-ghost);">Redux</p>
		<p class="text-xs mt-2 opacity-30">Tap to load</p>
	</div>
{:else}
	<DeviceEmptyState glyph="◐" message="No device loaded" />
{/if}

<style>
	/* GRATICULE: the loaded glyph sits at 0.3 (was inline; lifted onto the
	   class so the flat grammar can re-read it without !important) and the
	   device title is authored mixed-case, up-cased here for the HUD voice. */
	.redux-glyph {
		opacity: 0.3;
	}
	.redux-title {
		text-transform: uppercase;
	}

	/* ---- Flat grammar: the loaded state's secondary text is Live's
	   disabled/tertiary text on the same field — a solid TextDisabled grey,
	   not a half-transparent foreground (opacity dims wash under the flat
	   ladder). The ghost branch keeps the shared .slot-ghost /
	   --opacity-ghost ramp (an app-wide idiom, not touched here). Graticule
	   is untouched — every rule sits under [data-grammar="flat"]. */
	:global([data-grammar="flat"]) .redux-glyph {
		opacity: 1;
		color: var(--fg-tertiary);
	}
	:global([data-grammar="flat"]) .redux-title {
		text-transform: none;
	}
	:global([data-grammar="flat"]) .redux-name {
		opacity: 1;
		color: var(--muted-foreground);
	}
</style>
