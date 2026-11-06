<script lang="ts">
	/**
	 * An instrument in Live's own arrangement (ADR-487): the panel's frame,
	 * left to right in Live's signal order with Global at the right edge,
	 * seams between its sections and Live's tab strip over the region Live
	 * swaps; or, after a tap on a section's eyebrow, that section's page,
	 * every control of it, with the way back to the panel at its left.
	 *
	 * A page is laid on the face grid too, as Drift's hand-laid pages are: a
	 * section a group, every row's groups in one row; ten cells or fewer
	 * stand in one row, a column each, their knobs as large as the column
	 * holds, and more stack two high, medium (`pageGroupGrid`); a long pick
	 * is a `ChoicePicker`. The first section's header line is the way back,
	 * "‹ Page", and its group's own name only where that differs and the
	 * section has the width for both.
	 *
	 * Which page or tab is up is view state: it never writes to Live, and a
	 * view arrives on its frame.
	 *
	 * The frame is laid on the face grid (ADR-510): a section a region (a
	 * tab strip whose tabs share their shape, a section a group), its
	 * eyebrow on the one header line, every column one width and every seam
	 * the same. A tab strip lies over the top of its sections' controls,
	 * under the header line, which names the shown tab's groups.
	 */
	import type { Snippet } from 'svelte';
	import FaceGrid from '../../FaceGrid.svelte';
	import FaceSection from '../../FaceSection.svelte';
	import FaceSeam from '../../FaceSeam.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import PanelGroupView from './PanelGroupView.svelte';
	import PanelTabs from './PanelTabs.svelte';
	import PanelEyebrow from './PanelEyebrow.svelte';
	import { groupColumns, pageGroupGrid, pageOneRow, pageSections, regionSections, tabsByPosition, type InstrumentPanel, type PanelGroup, type PanelPage, type PanelTab } from './panelTypes';
	import type { PanelParams } from './usePanelParams.svelte';

	interface Props {
		panel: InstrumentPanel;
		params: PanelParams;
		color: DeviceColorScheme;
		/** The device's own controls for the panel's `slot` regions, by slot name. */
		slots?: Record<string, Snippet>;
		/**
		 * A hand-laid face in place of the frame (a view whose layout carries
		 * widgets of its own: Drift's oscillator card, Analog's voice switch).
		 * It is handed the way to open a page, for its `PanelEyebrow`s.
		 */
		face?: Snippet<[(page: string) => void]>;
	}

	let { panel, params, color, slots = {}, face }: Props = $props();

	let pageId = $state<string | null>(null);
	let tabSelected = $state<Record<number, number>>({});

	/**
	 * The widest a page's column grows: a page of few cells (Operator's
	 * Shaper) stops at this and centres, rather than spreading three knobs
	 * over the whole view. Every page the tour shoots fills the width.
	 */
	const PAGE_COLUMN_MAX = 160;

	let page = $derived(pageId ? panel.pages.find((p) => p.id === pageId) : undefined);

	function openPage(id: string) {
		if (panel.pages.some((p) => p.id === id)) pageId = id;
	}

	// The frame's sections, region by region, and where each region's
	// columns start on the face (a grid line: a column a track, a seam a
	// track), for the tab strip that lies across a region's sections.
	let regionCols = $derived(panel.frame.map((r) => regionSections(r)));
	let sections = $derived(regionCols.flat());
	let regionLines = $derived.by(() => {
		const lines: { start: number; end: number }[] = [];
		let line = 1;
		for (const cols of regionCols) {
			const start = line;
			for (const n of cols) line += n + 1;
			lines.push({ start, end: line - 1 });
		}
		return lines;
	});

	/** A tab's groups with the face columns each takes in its one section. */
	function tabColumns(tab: PanelTab, span: number): { group: PanelGroup; cols: number }[] {
		if (tab.groups.length === 1) return [{ group: tab.groups[0], cols: span }];
		return tab.groups.map((group) => ({ group, cols: groupColumns(group) }));
	}
</script>

{#if page}
	<!-- A section's page on the face grid (ADR-510): a section a group, every
	     row's groups in one row (so its seams run the page's height), the
	     page's way back on the first section's header line. -->
	{@const groups = page.rows.flat()}
	{@const oneRow = pageOneRow(page)}
	{@const secs = pageSections(page)}
	{@const cols = secs.reduce((a, b) => a + b, 0)}
	<!-- A sparse page stops at PAGE_COLUMN_MAX columns and centres: the
	     face's inset, its columns, seams and gutters. -->
	<div class="h-full w-full" data-panel-page={page.id} data-page-rows={oneRow ? 1 : 2}>
		<div class="h-full" style="margin-inline: auto; max-width: calc(2 * var(--central-inset) + {cols} * {PAGE_COLUMN_MAX}px + {secs.length - 1} * max(1px, 2 * var(--central-gap) + 1px - 2 * var(--spacing-sm)) + {cols + secs.length - 2} * var(--spacing-sm));">
		<FaceGrid sections={secs}>
			{#if page.aside}
				<FaceSection span={page.aside.units} data-group={page.aside.slot}>
					{#snippet head()}{@render back(page)}{/snippet}
					<div class="panel-slot-body face-span-all">{@render slots[page.aside.slot]?.()}</div>
				</FaceSection>
				<FaceSeam ink={color.primary} />
			{/if}
			{#each groups as group, g (g)}
				{@const span = pageGroupGrid(group, oneRow).columns}
				{@const first = g === 0 && !page.aside}
				{#if g > 0}<FaceSeam ink={color.primary} />{/if}
				<FaceSection {span} data-group={group.title ?? ''}>
					{#snippet head()}
						{#if first}{@render back(page)}{/if}
						{#if (group.title || group.page) && (!first || group.page || (group.title !== page.title && span >= 2))}<PanelEyebrow title={group.title} page={group.page} onOpen={openPage} color={color.primary} />{/if}
					{/snippet}
					<PanelGroupView {group} {params} {color} onOpen={openPage} boxFace={panel.boxFace} onPage {oneRow} />
				</FaceSection>
			{/each}
		</FaceGrid>
		</div>
	</div>
	{#snippet back(p: PanelPage)}
		<button class="panel-back" style="color: {color.primary};" onclick={() => (pageId = p.parent ?? null)}>‹ {p.title}</button>
	{/snippet}
{:else if face}
	<div class="h-full w-full" data-panel-page="frame">{@render face(openPage)}</div>
{:else}
	<div class="h-full w-full" data-panel-page="frame">
		<FaceGrid {sections} class="panel-face">
			{#each panel.frame as region, i (i)}
				{#if i > 0}<FaceSeam ink={color.primary} />{/if}
				{#if region.kind === 'group'}
					<FaceSection span={regionCols[i][0]} data-group={region.group.title ?? ''}>
						{#snippet head()}<PanelEyebrow title={region.group.title} page={region.group.page} onOpen={openPage} color={color.primary} />{/snippet}
						<PanelGroupView group={region.group} {params} {color} onOpen={openPage} boxFace={panel.boxFace} columns={regionCols[i][0]} />
					</FaceSection>
				{:else if region.kind === 'slot'}
					<FaceSection span={regionCols[i][0]} data-group={region.title ?? region.slot}>
						{#snippet head()}<PanelEyebrow title={region.title} page={region.page} onOpen={openPage} color={color.primary} />{/snippet}
						<div class="panel-slot-body face-span-all">{@render slots[region.slot]?.()}</div>
					</FaceSection>
				{:else}
					{@const sel = Math.min(tabSelected[i] ?? 0, region.tabs.length - 1)}
					{@const tab = region.tabs[sel]}
					{#if tabsByPosition(region.tabs)}
						<!-- A section a group, the shown tab's in each, seamed. -->
						{#each tab.groups as group, g (g)}
							{#if g > 0}<FaceSeam ink={color.primary} />{/if}
							<FaceSection span={regionCols[i][g]} data-group={group.title ?? ''}>
								{#snippet head()}<PanelEyebrow title={group.title} page={group.page} onOpen={openPage} color={color.primary} />{/snippet}
								<PanelGroupView {group} {params} {color} onOpen={openPage} boxFace={panel.boxFace} columns={regionCols[i][g]} underTabs />
							</FaceSection>
						{/each}
					{:else}
						{@const placed = tabColumns(tab, regionCols[i][0])}
						{#if placed.length === 1}
							{@const group = placed[0].group}
							<FaceSection span={regionCols[i][0]} data-group={group.title ?? ''}>
								{#snippet head()}{#if group.page}<PanelEyebrow title={group.title} page={group.page} onOpen={openPage} color={color.primary} />{/if}{/snippet}
								<PanelGroupView {group} {params} {color} onOpen={openPage} boxFace={panel.boxFace} columns={regionCols[i][0]} underTabs />
							</FaceSection>
						{:else}
							<!-- Several groups in one section: each eyebrow over its own columns. -->
							<FaceSection span={regionCols[i][0]}>
								{#snippet head()}
									<div class="head-cols" style="grid-template-columns: repeat({regionCols[i][0]}, minmax(0, 1fr));">
										{#each placed as { group, cols }, g (g)}
											<span class="head-col" style="grid-column: span {cols};" data-group={group.title ?? ''}><PanelEyebrow title={group.title} page={group.page} onOpen={openPage} color={color.primary} /></span>
										{/each}
									</div>
								{/snippet}
								{#each placed as { group, cols }, g (g)}
									<PanelGroupView {group} {params} {color} onOpen={openPage} boxFace={panel.boxFace} columns={cols} underTabs dataGroup={group.title ?? ''} />
								{/each}
							</FaceSection>
						{/if}
					{/if}
					<!-- Live's tabs, across the region's sections under the header line. -->
					<div class="face-tabs" style="grid-column: {regionLines[i].start} / {regionLines[i].end};">
						<PanelTabs tabs={region.tabs} selected={sel} {params} {color} onSelect={(t) => (tabSelected = { ...tabSelected, [i]: t })} />
					</div>
				{/if}
			{/each}
		</FaceGrid>
	</div>
{/if}

<style>
	/* The tab strip lies over its region's controls, out of the grid's
	   flow, so the sections around it place as on any face (ADR-510). */
	:global(.panel-face) {
		position: relative;
	}
	.face-tabs {
		position: absolute;
		grid-row: 2;
		top: 0;
		left: 0;
		right: 0;
		height: var(--height-touch);
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* A section's header line over several groups: each eyebrow over its
	   own columns, on the face's gutters. */
	.head-cols {
		flex: 1 1 auto;
		align-self: stretch;
		display: grid;
		column-gap: var(--face-gutter);
		min-width: 0;
	}
	.head-col {
		display: flex;
		justify-content: center;
		align-items: center;
		min-width: 0;
	}
	.panel-slot-body {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.panel-slot-body > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	/* The way back, on the first section's header line: the page's name,
	   a "‹" before it, as Drift's pages draw it. */
	.panel-back {
		background: none;
		border: 0;
		padding: 0 0.5rem 0 0;
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1rem;
		white-space: nowrap;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
