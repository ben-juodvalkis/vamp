<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.TriggerProps = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn(
		"data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 text-sm font-medium transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
	{...restProps}
/>

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): a tab is a
	   segment — OFF = control text on the well, ON = ChosenDefault fill with
	   the dark ON glyph, no shadow, 2px corners; disabled = disabled-fg on
	   the same field, never opacity. Light keeps the dark frame on the ON
	   fill (≈1:1 luminance against the light ladder). Fully global because
	   bits-ui renders the element; (0,3,1) outranks the inlined
	   `dark:data-[state=active]:` utilities at (0,3,0). */
	:global(html[data-grammar="flat"] [data-slot="tabs-trigger"]) {
		border-radius: 2px;
		color: var(--foreground);
		box-shadow: none;
	}
	:global(html[data-grammar="flat"] [data-slot="tabs-trigger"][data-state="active"]) {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
		box-shadow: none;
	}
	:global(html.light[data-grammar="flat"] [data-slot="tabs-trigger"][data-state="active"]) {
		border-color: var(--line-strong);
	}
	:global(html[data-grammar="flat"] [data-slot="tabs-trigger"]:disabled) {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
</style>
