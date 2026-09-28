<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		"bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-lg dark:shadow-xl light:shadow-md light:border-2",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): a card is a
	   matte SurfaceBackground slab in a 1px dark frame, 2px corners, no
	   shadow — the rounded-xl / shadow-lg / light:border-2 utilities are
	   inlined, so they are overridden here. Fully global (html[…] …) so it
	   also outranks the `dark:` / `light:` variants at (0,2,0); the strips'
	   inline `border-radius` and `.track-selected !important` still win. */
	:global(html[data-grammar="flat"] [data-slot="card"]) {
		background: var(--card);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		box-shadow: none;
	}
</style>
