<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	type InputType = Exclude<HTMLInputTypeAttribute, "file">;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type"> &
			({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		...restProps
	}: Props = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			"selection:bg-primary dark:bg-input/30 selection:text-primary-foreground border-input ring-offset-background placeholder:text-muted-foreground shadow-xs flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 pt-1.5 text-sm font-medium outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
			"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
			"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			"border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-background placeholder:text-muted-foreground shadow-xs flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
			"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
			"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}

<style>
	/* Flat grammar (Live / Hybrid skins, ui-architecture §8.1): a text field
	   is a ControlBackground well in a 1px dark frame, 2px corners, no
	   shadow; focus = SelectionBackground hairline instead of the 3px ring;
	   disabled = ControlOffDisabledForeground on the same field, not opacity.
	   Fully global (html[…] …) so it outranks the inlined `dark:` utilities. */
	:global(html[data-grammar="flat"] [data-slot="input"]) {
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		box-shadow: none;
		color: var(--foreground);
	}
	:global(html[data-grammar="flat"] [data-slot="input"]:focus-visible) {
		border-color: var(--flat-selection);
		box-shadow: 0 0 0 1px var(--flat-selection);
	}
	:global(html[data-grammar="flat"] [data-slot="input"]:disabled) {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
</style>
