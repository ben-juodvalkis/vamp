<script lang="ts">
	/**
	 * Settings → Grooves (2026-09-29): every groove file in Live's Core
	 * Library, grouped as Live groups them, each with its grid and a small
	 * timing picture, and a tick. The ticked ones are the Groove view's tiles
	 * (opened by touching Q), in the order they were ticked; there is no cap.
	 * Mirrors the Places section: the ticks are saved on the Mac
	 * (`logs/grooves.json`), a filter, groups that fold, and a top group that
	 * does not reshuffle under the finger (`groovesGroups.ts`).
	 *
	 * The Logic and Notator grooves and a few others are in Ableton's binary
	 * format, which the Mac cannot read, so they show without a picture.
	 *
	 * "Your grooves" come first: the `.agr` files in the User Library's
	 * `Grooves` folder, named `User: <file>` so each can be ticked beside a
	 * Core Library groove of the same name.
	 */
	import { onMount, untrack } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { groovesStore } from '$lib/stores/v6/groovesStore.svelte';
	import GroovePicture from '$lib/components/v6/clips/GroovePicture.svelte';
	import type { GrooveFile } from '$lib/types/grooves';
	import { SHOWN_GROUP, groupGrooves, settleShown } from './groovesGroups';

	onMount(() => {
		void groovesStore.refresh();
	});

	let filter = $state('');
	let open = $state<Record<string, boolean>>({ [SHOWN_GROUP]: true, User: true, 'Swing/Basic': true });
	let shown = $state.raw<string[]>([]);

	$effect(() => {
		const ticked = groovesStore.listing?.ticked;
		if (!ticked) return;
		const was = untrack(() => shown);
		const next = settleShown(was, ticked);
		if (next !== was) shown = next;
	});

	const files = $derived(groovesStore.listing?.files ?? []);
	const tickedSet = $derived(new Set(groovesStore.ticked));
	const filtering = $derived(filter.trim() !== '');
	const groups = $derived(groupGrooves(files, shown, tickedSet, filter));
	const matches = $derived(groups.filter((g) => g.id !== SHOWN_GROUP).reduce((n, g) => n + g.files.length, 0));

	function countLabel(g: (typeof groups)[number]): string {
		if (filtering) return `${g.files.length} of ${g.total}`;
		if (g.id === SHOWN_GROUP || g.ticked === 0) return `${g.total}`;
		return `${g.total} · ${g.ticked} ticked`;
	}

	function toggleGroup(id: string) {
		open[id] = !open[id];
	}

	async function onTick(event: Event, f: GrooveFile) {
		const box = event.currentTarget as HTMLInputElement;
		await groovesStore.toggle(f.name);
		box.checked = groovesStore.ticked.includes(f.name);
	}
</script>

<div class="set-section set-grooves" data-debug="grooves">
	{#if groovesStore.failed && !groovesStore.listing}
		<p class="set-lead">No listing from the Mac ({groovesStore.failed}). Is Vamp running there (npm run dev)?</p>
	{:else if !groovesStore.listing}
		<p class="set-lead">Reading Live’s grooves…</p>
	{:else if !groovesStore.listing.root}
		<p class="set-lead">No Live app found on this Mac, so there are no groove files to list.</p>
	{:else}
		<p class="set-lead">
			The tiles of the Groove view, opened by touching Q. Tick as many as you want: they become its tiles, in the order you
			ticked them.
		</p>

		<div class="set-listbar">
			<p class="set-listbar-count" aria-live="polite">
				<strong>{groovesStore.ticked.length}</strong> of {files.length} in the Groove view
				{#if groovesStore.saving}<span class="set-saving">Saving…</span>{/if}
				{#if groovesStore.saveError}<span class="set-save-error" role="alert">Not saved: {groovesStore.saveError}</span>{/if}
			</p>
			<div class="set-filter">
				<Search class="set-filter-icon" aria-hidden="true" />
				<input
					type="search"
					bind:value={filter}
					placeholder="Filter {files.length} grooves"
					aria-label="Filter grooves by name"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					onkeydown={(e) => {
						if (e.key === 'Escape' && filter) filter = '';
					}}
				/>
				{#if filter}
					<button class="set-filter-clear" aria-label="Clear the filter" onclick={() => (filter = '')}>
						<X class="set-btn-icon" aria-hidden="true" />
					</button>
				{/if}
			</div>
		</div>

		{#if filtering && matches === 0}
			<p class="set-lead">No groove matches “{filter.trim()}”.</p>
		{/if}

		{#each groups as g (g.id)}
			{@const isOpen = filtering || !!open[g.id]}
			{@const ordered = g.id === SHOWN_GROUP}
			{#if !filtering || g.files.length}
				<section class="set-fold" data-group={g.id} data-open={isOpen}>
					<button
						class="set-fold-toggle"
						aria-expanded={isOpen}
						aria-controls="set-grooves-{g.id}"
						disabled={filtering}
						onclick={() => toggleGroup(g.id)}
					>
						<ChevronRight class="set-fold-chevron" aria-hidden="true" />
						<span class="set-fold-name">{g.title}</span>
						<span class="set-fold-count">{countLabel(g)}</span>
						<span class="set-fold-rule" aria-hidden="true"></span>
					</button>
					{#if isOpen}
						<ul class="set-tick-grid" id="set-grooves-{g.id}" data-debug="grooves-{g.id}">
							{#each g.files as f, i (f.name)}
								{@const ticked = tickedSet.has(f.name)}
								<li class="set-tick-card" class:absent={!!f.blocked} data-groove={f.name} data-ticked={ticked}>
									<label class="set-tick groove-tick">
										<input
											type="checkbox"
											checked={ticked}
											disabled={!!f.blocked}
											onclick={(e) => {
												if (groovesStore.saving) e.preventDefault();
											}}
											onchange={(e) => onTick(e, f)}
											aria-label={`Show ${f.name} in the Groove view`}
										/>
										<span class="set-check" aria-hidden="true"><Check class="set-check-icon" /></span>
										<span class="groove-main">
											<span class="groove-title">
												{#if ordered}<span class="groove-order" title="Tile {i + 1} in the Groove view">{i + 1}</span>{/if}
												<span class="set-row-label set-tick-name">{f.name}</span>
											</span>
											{#if f.blocked}
												<span class="groove-nopic">{f.blocked}</span>
											{:else if f.events?.length}
												<span class="groove-pic"><GroovePicture events={f.events} /></span>
											{:else if f.events === null}
												<span class="groove-nopic">No picture: Live’s own format</span>
											{/if}
										</span>
										{#if f.grid}<span class="groove-grid">{f.grid}</span>{/if}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/each}

		<p class="set-note grooves-foot">
			From Live’s Core Library ({groovesStore.listing.root}){#if groovesStore.listing.userRoot}
				and your User Library ({groovesStore.listing.userRoot}){/if}. To add one of your own, extract it from a clip in
			Live (right-click the clip → Extract Groove), then save it from the Groove Pool into your User Library’s Grooves
			folder; it shows up here as “User: …” the next time this page opens.
		</p>
	{/if}
</div>

<style>
	.set-grooves {
		gap: var(--spacing-lg);
	}
	.grooves-foot {
		max-width: 46rem;
		margin-top: var(--spacing-md);
		overflow-wrap: anywhere;
	}
	.groove-tick {
		min-height: 3.5rem;
	}
	.groove-main {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.groove-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		min-width: 0;
	}
	.groove-order {
		flex-shrink: 0;
		min-width: 1.375rem;
		padding: 0 0.3125rem;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.groove-pic {
		display: block;
		width: min(100%, 9.5rem);
		--groove-pic-h: 1.125rem;
		--groove-tick: var(--phosphor);
	}
	.groove-nopic {
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}
	.groove-grid {
		flex-shrink: 0;
		align-self: flex-start;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
</style>
