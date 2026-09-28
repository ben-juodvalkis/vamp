<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SheetPrimitive.OverlayProps = $props();
</script>

<SheetPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	class={cn(
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
		className
	)}
	{...restProps}
/>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): the sheet
	   scrim is background-alpha (--scrim-strong), never black-alpha. Flat
	   only — GRATICULE keeps bg-black/50, which no scrim token equals.
	   bits-ui renders the element, so the selector is fully global. */
	:global(html[data-grammar="flat"] [data-slot="sheet-overlay"]) {
		background: var(--scrim-strong);
	}
</style>
