<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.TitleProps = $props();
</script>

<DialogPrimitive.Title
	bind:ref
	data-slot="dialog-title"
	class={cn("text-lg font-semibold leading-none", className)}
	{...restProps}
/>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): titles sit
	   at medium weight — `font-semibold` inlines 600, so it is overridden
	   here. bits-ui renders the element, so the selector is fully global. */
	:global(html[data-grammar="flat"] [data-slot="dialog-title"]) {
		font-weight: var(--font-weight-medium);
		color: var(--foreground);
	}
</style>
