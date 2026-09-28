<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	class={cn(
		"bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
		className
	)}
	{...restProps}
/>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): the tab
	   strip is a ControlBackground well in a 1px dark frame, 2px corners —
	   the same idiom as `.device-segmented`. Height stays h-9 (border-box).
	   bits-ui renders the element, so the selector is fully global. */
	:global(html[data-grammar="flat"] [data-slot="tabs-list"]) {
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		color: var(--foreground);
	}
</style>
