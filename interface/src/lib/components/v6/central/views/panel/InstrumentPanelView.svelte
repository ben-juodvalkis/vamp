<script lang="ts">
	/**
	 * An instrument in Live's own arrangement (ADR-487): the panel's frame,
	 * left to right in Live's signal order with Global at the right edge,
	 * seams between its sections and Live's tab strip over the region Live
	 * swaps; or, after a tap on a section's eyebrow, that section's page,
	 * every control of it, with the way back to the panel at its left.
	 *
	 * Which page or tab is up is view state: it never writes to Live, and a
	 * view arrives on its frame.
	 */
	import SectionDivider from '../../SectionDivider.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import PanelGroupView from './PanelGroupView.svelte';
	import PanelTabs from './PanelTabs.svelte';
	import { groupUnits, regionUnits, type InstrumentPanel } from './panelTypes';
	import type { PanelParams } from './usePanelParams.svelte';

	interface Props {
		panel: InstrumentPanel;
		params: PanelParams;
		color: DeviceColorScheme;
	}

	let { panel, params, color }: Props = $props();

	let pageId = $state<string | null>(null);
	let tabSelected = $state<Record<number, number>>({});

	let page = $derived(pageId ? panel.pages.find((p) => p.id === pageId) : undefined);

	function openPage(id: string) {
		if (panel.pages.some((p) => p.id === id)) pageId = id;
	}
</script>

{#if page}
	<div class="panel-layout" data-panel-page={page.id}>
		<button class="physical-button panel-back" style="--btn-tint: {color.primary};" onclick={() => (pageId = page.parent ?? null)}>
			<span class="back-arrow" aria-hidden="true">‹</span>
			<span class="back-title">{page.title}</span>
		</button>
		<SectionDivider orientation="vertical" ink={color.primary} />
		<div class="panel-rows">
			{#each page.rows as row, r (r)}
				<div class="panel-page-row">
					{#each row as group, g (g)}
						{#if g > 0}<SectionDivider orientation="vertical" ink={color.primary} />{/if}
						<PanelGroupView {group} {params} {color} pageRows={page.rows.length} onOpen={openPage} />
					{/each}
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class="panel-layout" data-panel-page="frame">
		{#each panel.frame as region, i (i)}
			{#if i > 0}<SectionDivider orientation="vertical" ink={color.primary} />{/if}
			{#if region.kind === 'group'}
				<PanelGroupView group={region.group} {params} {color} onOpen={openPage} />
			{:else}
				{@const sel = Math.min(tabSelected[i] ?? 0, region.tabs.length - 1)}
				{@const tab = region.tabs[sel]}
				<div class="panel-tab-region" style="flex: {regionUnits(region)} 1 0;">
					<PanelTabs tabs={region.tabs} selected={sel} {params} {color} onSelect={(t) => (tabSelected = { ...tabSelected, [i]: t })} />
					<div class="panel-tab-body">
						{#each tab.groups as group, g (g)}
							{#if g > 0}<SectionDivider orientation="vertical" ink={color.primary} />{/if}
							<PanelGroupView {group} {params} {color} onOpen={openPage} bare={tab.groups.length === 1 && !group.page} />
						{/each}
						<!-- A tab with fewer boxes than the widest keeps their width. -->
						{#if tab.groups.reduce((n, g) => n + groupUnits(g), 0) < regionUnits(region)}
							<div class="panel-filler" style="flex: {regionUnits(region) - tab.groups.reduce((n, g) => n + groupUnits(g), 0)} 1 0;"></div>
						{/if}
					</div>
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.panel-layout {
		display: flex;
		height: 100%;
		width: 100%;
		padding: var(--central-inset);
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.panel-tab-region {
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.panel-tab-body {
		flex: 1 1 0;
		display: flex;
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.panel-filler {
		min-width: 0;
	}
	.panel-rows {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	.panel-page-row {
		flex: 1 1 0;
		display: flex;
		gap: var(--central-gap);
		min-width: 0;
		min-height: 0;
	}
	/* The way back: a column a box wide, naming the page it leaves. */
	.panel-back {
		flex: 0 0 5.5rem;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 4px;
		color: var(--btn-tint);
	}
	.back-arrow {
		font-size: 1.75rem;
		line-height: 1;
	}
	.back-title {
		font-size: 0.8125rem;
		text-align: center;
		line-height: 1.15;
	}
	:global([data-grammar='flat']) .panel-back {
		color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
	}
</style>
