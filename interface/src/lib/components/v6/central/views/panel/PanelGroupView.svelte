<script lang="ts">
	/**
	 * A named group of an instrument panel (ADR-487): Live's section name as
	 * the eyebrow, its controls side by side under it, each the group's full
	 * height. An eyebrow that leads to the section's detail page is a button
	 * ("Hammer ›"); one with no name still takes its line, so every group in a
	 * row starts its boxes on the same pixel.
	 */
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import PanelControlView from './PanelControlView.svelte';
	import { controlUnits, groupUnits, type PanelGroup } from './panelTypes';
	import type { PanelParams } from './usePanelParams.svelte';

	interface Props {
		group: PanelGroup;
		params: PanelParams;
		color: DeviceColorScheme;
		/** Opens the page the eyebrow names. */
		onOpen?: (page: string) => void;
		/** Draw no eyebrow line (a tab strip above already names the group). */
		bare?: boolean;
		/** Rows on the page the group stands in: a two-row page's choices spread wider. */
		pageRows?: number;
	}

	let { group, params, color, onOpen, bare = false, pageRows = 1 }: Props = $props();
</script>

<div class="panel-group" style="flex: {groupUnits(group, pageRows)} 1 0;" data-group={group.title ?? ''}>
	{#if !bare}
		{#if group.page && onOpen}
			<button class="panel-eyebrow eyebrow-link" style="color: {color.primary};" onclick={() => onOpen?.(group.page!)}>
				{group.title} ›
			</button>
		{:else}
			<span class="panel-eyebrow" style="color: {color.primary};">{group.title ?? ''}&nbsp;</span>
		{/if}
	{/if}
	<div class="panel-row">
		{#each group.controls as control (control.param)}
			<div class="panel-cell" style="flex: {controlUnits(control, pageRows)} 1 0;">
				<PanelControlView {control} {params} {color} switchParam={group.switchParam} {pageRows} />
			</div>
		{/each}
	</div>
</div>

<style>
	.panel-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
		min-height: 0;
	}
	/* The house eyebrow (EnvelopeGroup's): 0.75rem, centred, upright. */
	.panel-eyebrow {
		flex: 0 0 auto;
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1rem;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* A link to the section's page: the eyebrow's line, a touch target's
	   width, underlined so it reads as something to press. */
	.eyebrow-link {
		align-self: center;
		background: none;
		border: 0;
		padding: 0 0.75rem;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.panel-row {
		flex: 1 1 0;
		display: flex;
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.panel-cell {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.panel-cell > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	:global([data-grammar='flat']) .panel-eyebrow {
		font-weight: var(--font-weight-medium);
	}
</style>
