<script lang="ts">
	/**
	 * Settings → Library (named Places until ADR-534; its id and address are
	 * still `places`; onboarding.plan.md §2, §6.2, §7): every folder Live's
	 * library offers — the sidebar Places in Live's order, the User Library,
	 * and Live's own categories (Sounds, Drums, Instruments…, from Live's
	 * index), every installed Pack as one more, with a tick each. A ticked one is cataloged on the
	 * Mac and becomes a button on the browser rail; a tick lands on every
	 * client within seconds (`placesLive`).
	 *
	 * Laid out by `placesGroups.ts`: what is in the sidebar first, then the
	 * rest of the Places, the User Library, and the Packs folded away (81 of
	 * them on the rig). A folder stays in the group it was in when the page
	 * opened, so a tick never moves the row under the finger. A filter (name
	 * or path) appears once the list is long enough to need one.
	 *
	 * New Places appear unticked (§2): most people's Places include Desktop
	 * and Downloads. The rig is seeded from `paths.sidebarRoot`, so nothing
	 * changes there. A folder that is not on this Mac right now (a Pack on an
	 * unmounted drive) is listed greyed and cannot be ticked.
	 *
	 * Above the list, the effects folder (ADR-498): the Place + Effect opens
	 * and Vamp's own effects (an amp rack, a Max effect) are found in by
	 * name, or Live's Audio Effects. An effect not in it has no tile.
	 */
	import { untrack } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import type { PlacesSource } from '$lib/services/placesLive';
	import type { PlacesListingState } from './placesListing.svelte';
	import { groupPlaces, parentPath, settleTicks, type PlacesGroupId } from './placesGroups';

	let { places }: { places: PlacesListingState } = $props();

	/** Every installed Pack as one source (ADR-493), the server's `category:Packs`. */
	const PACKS_KEY = 'category:Packs';

	/** Past this many rows the list gets a filter. */
	const FILTER_FROM = 12;

	let filter = $state('');
	let open = $state<Record<PlacesGroupId, boolean>>({ shown: true, categories: true, collections: true, places: true, 'user-library': true });
	let settled = $state.raw<ReadonlyMap<string, boolean>>(new Map());

	$effect(() => {
		const sources = places.listing?.sources;
		if (!sources) return;
		const was = untrack(() => settled);
		const next = settleTicks(was, sources);
		if (next !== was) settled = next;
	});

	const sources = $derived(places.listing?.sources ?? []);
	const filtering = $derived(filter.trim() !== '');
	const groups = $derived(groupPlaces(sources, settled, filter));
	const matches = $derived(groups.reduce((n, g) => n + g.sources.length, 0));

	// A group opened by a tap scrolls up to meet the finger: unfolding one at
	// the foot of the list below the fold looked like nothing happened (the
	// 81 Packs sat there until they became one tick). Reduced motion jumps
	// instead of gliding.
	function toggleGroup(id: PlacesGroupId, event: MouseEvent) {
		open[id] = !open[id];
		if (!open[id]) return;
		const group = (event.currentTarget as HTMLElement).closest('.set-fold');
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		requestAnimationFrame(() => group?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }));
	}

	function countLabel(g: (typeof groups)[number]): string {
		if (filtering) return `${g.sources.length} of ${g.total}`;
		if (g.id === 'shown' || g.ticked === 0) return `${g.total}`;
		return `${g.total} · ${g.ticked} ticked`;
	}

	async function onTick(event: Event, s: PlacesSource) {
		const box = event.currentTarget as HTMLInputElement;
		await places.toggle(s);
		// A save that failed (or was refused mid-save) leaves the listing as it
		// was, and the box must say so rather than what the finger did.
		box.checked = places.listing?.sources.find((x) => x.key === s.key)?.ticked ?? box.checked;
	}

	/** Folders that can be the effects folder: the sidebar Places and the User Library, on this Mac. */
	const effectsChoices = $derived(sources.filter((s) => s.present && (s.kind === 'place' || s.kind === 'user-library')));
	const effectsPlace = $derived(places.listing?.effectsPlace ?? '');

	const sourceLine = $derived.by(() => {
		const l = places.listing;
		if (!l) return '';
		if (l.source === 'index' && l.indexState.ok) return 'A file added to a ticked folder shows up once Live has indexed it.';
		const why = l.source === 'index' ? ` (Live’s index: ${l.indexState.note})` : '';
		return `Folders are read from the disk${why}, so a file added to one shows up the next time the catalog is rebuilt.`;
	});
</script>

<div class="set-section set-places" data-debug="places">
	{#if places.failed}
		<p class="set-lead">No listing from the Mac ({places.failed}). Is Vamp running there (npm run dev)?</p>
	{:else if !places.listing}
		<p class="set-lead">Reading Live’s library…</p>
	{:else}
		<p class="set-lead">
			A ticked folder or category gets a button in the browser’s sidebar, on every screen within seconds.
		</p>

		<section class="set-group places-effects" data-debug="places-effects">
			<h3 class="set-group-title">Effects folder</h3>
			<div class="set-list">
				<label class="set-row set-row-stack">
					<span class="set-row-main">
						<span class="set-row-label">+ Effect opens</span>
						<span class="set-row-sub">
							Where Vamp also looks for its own effects by name (an amp rack, a Max effect). Live’s built-in effects work
							either way.
						</span>
					</span>
					<select
						class="set-select places-select"
						value={effectsPlace}
						disabled={places.saving}
						onchange={(e) => void places.setEffectsPlace((e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="">Live’s Audio Effects</option>
						{#each effectsChoices as s (s.key)}
							<option value={s.name}>{s.name}</option>
						{/each}
					</select>
				</label>
			</div>
		</section>

		<div class="set-listbar">
			<p class="set-listbar-count" aria-live="polite">
				{#if places.tickedCount === 0}
					<strong>Nothing ticked yet.</strong> Tick one to give it a button.
				{:else}
					<strong>{places.tickedCount}</strong> of {sources.length} in the sidebar
				{/if}
				{#if places.saving}<span class="set-saving">Saving…</span>{/if}
				{#if places.saveError}<span class="set-save-error" role="alert">Not saved: {places.saveError}</span>{/if}
			</p>
			{#if sources.length > FILTER_FROM}
				<div class="set-filter">
					<Search class="set-filter-icon" aria-hidden="true" />
					<input
						type="search"
						bind:value={filter}
						placeholder="Filter {sources.length} by name or path"
						aria-label="Filter by name or path"
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
			{/if}
		</div>

		{#if filtering && matches === 0}
			<p class="set-lead">Nothing matches “{filter.trim()}”.</p>
		{/if}

		{#each groups as g (g.id)}
			{@const isOpen = filtering || open[g.id]}
			{#if !filtering || g.sources.length}
				<section class="set-fold" data-group={g.id} data-open={isOpen}>
					<button
						class="set-fold-toggle"
						aria-expanded={isOpen}
						aria-controls="set-places-{g.id}"
						disabled={filtering}
						onclick={(e) => toggleGroup(g.id, e)}
					>
						<ChevronRight class="set-fold-chevron" aria-hidden="true" />
						<span class="set-fold-name">{g.title}</span>
						<span class="set-fold-count">{countLabel(g)}</span>
						<span class="set-fold-rule" aria-hidden="true"></span>
					</button>
					{#if isOpen}
						<ul class="set-tick-grid" id="set-places-{g.id}" data-debug="places-{g.id}">
							{#each g.sources as s (s.key)}
								<li class="set-tick-card" class:absent={!s.present} data-place-key={s.key} data-ticked={s.ticked}>
									<label class="set-tick">
										<input
											type="checkbox"
											checked={s.ticked}
											disabled={!s.present}
											onclick={(e) => {
												if (places.saving) e.preventDefault();
											}}
											onchange={(e) => onTick(e, s)}
											aria-label={`Show ${s.key === PACKS_KEY ? 'every installed Pack' : `${s.kind === 'category' ? 'the category ' : s.kind === 'collection' ? 'the Collection ' : ''}${s.name}`} in the sidebar`}
										/>
										<span class="set-check" aria-hidden="true"><Check class="set-check-icon" /></span>
										<span class="set-row-main">
											<span class="set-row-label set-tick-name">{s.name}</span>
											{#if !s.present}
												<span class="set-row-sub">Not on this Mac right now</span>
											{:else if s.key === PACKS_KEY}
												<span class="set-row-sub">Every installed Pack, one button</span>
											{:else if s.kind === 'category'}
												<span class="set-row-sub">From your Packs and User Library</span>
											{:else if s.kind === 'collection'}
												<span class="set-row-sub">A Collection in Live’s browser</span>
											{:else}
												<span class="places-path" dir="rtl"><bdi dir="ltr">{parentPath(s)}</bdi></span>
											{/if}
										</span>
										{#if s.totalItems !== null}
											<span class="set-tick-count" title="Items cataloged">{s.totalItems.toLocaleString()}</span>
										{/if}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/each}

		<p class="set-note places-foot">
			To add a folder, add it to Places in Live’s browser (Places → Add Folder…); it appears here within seconds.
			{sourceLine}
		</p>
	{/if}
</div>

<style>
	.set-places {
		gap: var(--spacing-lg);
	}
	.places-effects {
		max-width: 50rem;
		margin: var(--spacing-sm) 0 var(--spacing-md);
	}
	.places-foot {
		max-width: 46rem;
		margin-top: var(--spacing-md);
	}
	.places-select {
		flex: 0 1 16rem;
		min-width: 10rem;
	}
	/* One line, cut from the START: the end of a path is what tells two
	   folders apart. */
	.places-path {
		display: block;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		text-align: left;
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}
</style>
