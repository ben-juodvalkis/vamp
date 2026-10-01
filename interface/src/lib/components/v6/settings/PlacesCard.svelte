<script lang="ts">
	/**
	 * Settings → Places (onboarding.plan.md §2, §6.2, §7): every folder Live's
	 * library offers — the sidebar Places in Live's order, the User Library,
	 * the installed Packs — with a tick each. A ticked one is cataloged on the
	 * Mac and becomes a button on the browser rail; a tick lands on every
	 * client within seconds (`placesLive`).
	 *
	 * Laid out by `placesGroups.ts`: what is in the browser first, then the
	 * rest of the Places, the User Library, and the Packs folded away (81 of
	 * them on the rig). A folder stays in the group it was in when the page
	 * opened, so a tick never moves the row under the finger. A filter (name
	 * or path) appears once the list is long enough to need one.
	 *
	 * New Places appear unticked (§2): most people's Places include Desktop
	 * and Downloads. The rig is seeded from `paths.sidebarRoot`, so nothing
	 * changes there. A folder that is not on this Mac right now (a Pack on an
	 * unmounted drive) is listed greyed and cannot be ticked.
	 */
	import { untrack } from 'svelte';
	import Check from 'lucide-svelte/icons/check';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Search from 'lucide-svelte/icons/search';
	import X from 'lucide-svelte/icons/x';
	import type { PlacesSource } from '$lib/services/placesLive';
	import type { PlacesListingState } from './placesListing.svelte';
	import { groupPlaces, parentPath, settleTicks, type PlacesGroupId } from './placesGroups';

	let { places }: { places: PlacesListingState } = $props();

	/** Past this many folders the list gets a filter. */
	const FILTER_FROM = 12;

	let filter = $state('');
	let open = $state<Record<PlacesGroupId, boolean>>({ shown: true, places: true, 'user-library': true, packs: false });
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

	// A group opened by a tap scrolls up to meet the finger: the Packs sit at
	// the foot of the list, and unfolding them below the fold looked like
	// nothing happened. Reduced motion jumps instead of gliding.
	function toggleGroup(id: PlacesGroupId, event: MouseEvent) {
		open[id] = !open[id];
		if (!open[id]) return;
		const group = (event.currentTarget as HTMLElement).closest('.set-place-group');
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
		<div class="set-places-bar">
			<p class="set-lead" aria-live="polite">
				{#if places.tickedCount === 0}
					<strong>Nothing is ticked yet.</strong> Tick a folder to give it a button on the browser’s rail.
				{:else}
					<strong>{places.tickedCount}</strong> of {sources.length} folders show in the browser. Tick a folder to give it a
					button on the browser’s rail.
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
						placeholder="Filter {sources.length} folders"
						aria-label="Filter folders by name or path"
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
			<p class="set-lead">No folder matches “{filter.trim()}”.</p>
		{/if}

		{#each groups as g (g.id)}
			{@const isOpen = filtering || open[g.id]}
			{#if !filtering || g.sources.length}
				<section class="set-place-group" data-group={g.id} data-open={isOpen}>
					<button
						class="set-group-toggle"
						aria-expanded={isOpen}
						aria-controls="set-places-{g.id}"
						disabled={filtering}
						onclick={(e) => toggleGroup(g.id, e)}
					>
						<ChevronRight class="set-group-chevron" aria-hidden="true" />
						<span class="set-group-name">{g.title}</span>
						<span class="set-group-count">{countLabel(g)}</span>
					</button>
					{#if isOpen}
						<ul class="set-place-grid" id="set-places-{g.id}" data-debug="places-{g.id}">
							{#each g.sources as s (s.key)}
								<li class="set-place" class:absent={!s.present} data-place-key={s.key} data-ticked={s.ticked}>
									<label class="set-place-tick">
										<input
											type="checkbox"
											checked={s.ticked}
											disabled={!s.present}
											onclick={(e) => {
												if (places.saving) e.preventDefault();
											}}
											onchange={(e) => onTick(e, s)}
											aria-label={`Show ${s.kind === 'pack' ? 'the Pack ' : ''}${s.name} in the browser`}
										/>
										<span class="set-check" aria-hidden="true"><Check class="set-check-icon" /></span>
										<span class="set-row-main">
											<span class="set-row-label set-place-name">{s.name}</span>
											{#if !s.present}
												<span class="set-row-sub">Not on this Mac right now</span>
											{:else if s.kind !== 'pack'}
												<span class="set-place-path" dir="rtl"><bdi dir="ltr">{parentPath(s)}</bdi></span>
											{/if}
										</span>
										{#if s.totalItems !== null}
											<span class="set-place-count" title="Items cataloged">{s.totalItems.toLocaleString()}</span>
										{/if}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/each}

		<p class="set-note">
			To add a folder, add it to Places in Live’s browser (Places → Add Folder…); it appears here within seconds.
			{sourceLine}
		</p>
	{/if}
</div>

<style>
	.set-places {
		gap: var(--spacing-lg);
	}
	.set-places > .set-note {
		max-width: 46rem;
	}
	/* The count and the filter stay put while the folders scroll under them. */
	.set-places-bar {
		position: sticky;
		top: calc(-1 * var(--spacing-xl));
		z-index: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-md) var(--spacing-xl);
		margin: calc(-1 * var(--spacing-xl)) calc(-1 * var(--spacing-xl)) 0;
		padding: var(--spacing-xl) var(--spacing-xl) var(--spacing-md);
		background: var(--background);
		border-bottom: 1px solid var(--line-strong);
	}
	.set-places-bar .set-lead {
		flex: 1 1 22rem;
	}
	.set-saving {
		margin-left: var(--spacing-sm);
		color: var(--fg-tertiary);
	}
	.set-save-error {
		display: block;
		color: var(--act-warn);
	}
	.set-filter {
		position: relative;
		flex: 0 1 22rem;
		min-width: 12rem;
		display: flex;
		align-items: center;
	}
	.set-filter :global(.set-filter-icon) {
		position: absolute;
		left: var(--spacing-md);
		width: 1rem;
		height: 1rem;
		color: var(--muted-foreground);
		pointer-events: none;
	}
	.set-filter input {
		width: 100%;
		min-height: var(--height-touch);
		padding: 0 var(--height-touch) 0 2.25rem;
		font-size: 1rem; /* 16px or iOS zooms the page on focus */
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		appearance: none;
	}
	.set-filter input::-webkit-search-cancel-button {
		display: none;
	}
	.set-filter input::placeholder {
		color: var(--fg-tertiary);
	}
	.set-filter input:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	.set-filter-clear {
		position: absolute;
		right: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--height-touch);
		height: var(--height-touch);
		color: var(--muted-foreground);
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	/* ---- Groups ---- */
	.set-place-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		/* Clear of the sticky count-and-filter bar when scrolled to. */
		scroll-margin-top: 6.5rem;
	}
	.set-group-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		min-height: var(--height-touch);
		padding: 0 var(--spacing-xs);
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--line-strong);
		color: var(--foreground);
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		text-align: left;
		cursor: pointer;
	}
	.set-group-toggle:disabled {
		cursor: default;
	}
	.set-group-toggle :global(.set-group-chevron) {
		width: 1.125rem;
		height: 1.125rem;
		flex-shrink: 0;
		color: var(--muted-foreground);
		transition: transform 0.15s ease;
	}
	.set-group-toggle[aria-expanded='true'] :global(.set-group-chevron) {
		transform: rotate(90deg);
	}
	.set-group-name {
		flex: 0 1 auto;
	}
	.set-group-count {
		flex-shrink: 0;
		margin-left: var(--spacing-xs);
		font-size: 0.8125rem;
		font-weight: 400;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.set-group-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	/* ---- Folders: as many columns as fit ---- */
	.set-place-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
		gap: var(--spacing-xs);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.set-place {
		min-width: 0;
		background: var(--card);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.set-place-tick {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		min-height: 3.25rem;
		height: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		cursor: pointer;
	}
	.set-place.absent .set-place-tick {
		cursor: not-allowed;
	}
	.set-place.absent .set-place-name {
		color: var(--flat-disabled-fg);
	}
	/* The box is drawn, not the browser's: a white system checkbox was the
	   brightest thing on a dark page. The input stays under it, the whole row
	   its label. */
	.set-place-tick input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}
	.set-check {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.375rem;
		height: 1.375rem;
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		color: transparent;
	}
	.set-check :global(.set-check-icon) {
		width: 1rem;
		height: 1rem;
		stroke-width: 3;
	}
	.set-place-tick input:checked + .set-check {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	.set-place-tick input:disabled + .set-check {
		background: transparent;
		border-style: dashed;
	}
	.set-place-tick input:focus-visible + .set-check {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.set-place-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* One line, cut from the START: the end of a path is what tells two
	   folders apart. */
	.set-place-path {
		display: block;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		text-align: left;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.set-place-count {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--fg-tertiary);
		font-variant-numeric: tabular-nums;
	}
	@media (hover: hover) {
		.set-place:not(.absent):hover {
			background: var(--secondary);
		}
		.set-group-toggle:not(:disabled):hover .set-group-name {
			text-decoration: underline;
			text-underline-offset: 3px;
		}
	}

	@media (max-width: 759.98px) {
		.set-places-bar {
			top: calc(-1 * var(--spacing-lg));
			margin: calc(-1 * var(--spacing-lg)) calc(-1 * var(--spacing-lg)) 0;
			padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md);
		}
		.set-filter {
			flex: 1 1 100%;
		}
	}
</style>
