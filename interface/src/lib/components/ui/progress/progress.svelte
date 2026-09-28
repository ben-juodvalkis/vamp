<script lang="ts">
	import { Progress as ProgressPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		...restProps
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	class={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)}
	{value}
	{max}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		class="bg-primary h-full w-full flex-1 transition-all"
		style="transform: translateX(-{100 - (100 * (value ?? 0)) / (max ?? 1)}%)"
	></div>
</ProgressPrimitive.Root>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): a square
	   ControlBackground lane in a 1px dark frame (border-box — h-2 holds)
	   with a RangeDefault fill; no primary/20 wash. bits-ui renders the
	   root, so both selectors are fully global. */
	:global(html[data-grammar="flat"] [data-slot="progress"]) {
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: 0;
	}
	:global(html[data-grammar="flat"] [data-slot="progress-indicator"]) {
		background: var(--act-monitor);
	}
</style>
