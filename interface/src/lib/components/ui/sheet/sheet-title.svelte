<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SheetPrimitive.TitleProps = $props();
</script>

<SheetPrimitive.Title
	bind:ref
	data-slot="sheet-title"
	class={cn("text-foreground font-semibold", className)}
	{...restProps}
/>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): titles sit
	   at medium weight — `font-semibold` inlines 600, so it is overridden
	   here. bits-ui renders the element, so the selector is fully global. */
	:global(html[data-grammar="flat"] [data-slot="sheet-title"]) {
		font-weight: var(--font-weight-medium);
	}
</style>
