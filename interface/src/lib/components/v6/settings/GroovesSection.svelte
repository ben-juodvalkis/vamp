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
		<div class="set-grooves-bar">
			<p class="set-lead" aria-live="polite">
				<strong>{groovesStore.ticked.length}</strong> of {files.length} grooves show in the Groove view. Tick as many as you
				want: they become its tiles, in this order.
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
			{#if !filtering || g.files.length}
				<section class="set-groove-group" data-group={g.id} data-open={isOpen}>
					<button
						class="set-group-toggle"
						aria-expanded={isOpen}
						aria-controls="set-grooves-{g.id}"
						disabled={filtering}
						onclick={() => toggleGroup(g.id)}
					>
						<ChevronRight class="set-group-chevron" aria-hidden="true" />
						<span class="set-group-name">{g.title}</span>
						<span class="set-group-count">{countLabel(g)}</span>
					</button>
					{#if isOpen}
						<ul class="set-groove-grid" id="set-grooves-{g.id}" data-debug="grooves-{g.id}">
							{#each g.files as f (f.name)}
								{@const ticked = tickedSet.has(f.name)}
								<li class="set-groove" class:blocked={!!f.blocked} data-groove={f.name} data-ticked={ticked}>
									<label class="set-groove-tick">
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
										<span class="set-groove-main">
											<span class="set-row-label set-groove-name">{f.name}</span>
											{#if f.blocked}
												<span class="set-groove-nopic">{f.blocked}</span>
											{:else if f.events?.length}
												<span class="set-groove-pic"><GroovePicture events={f.events} /></span>
											{:else if f.events === null}
												<span class="set-groove-nopic">No picture: Live’s own format</span>
											{/if}
										</span>
										{#if f.grid}<span class="set-groove-grid-label">{f.grid}</span>{/if}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/each}

		<p class="set-note">
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
	.set-grooves > .set-note {
		max-width: 46rem;
		overflow-wrap: anywhere;
	}
	.set-grooves-bar {
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
	.set-grooves-bar .set-lead {
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

	.set-groove-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
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

	.set-groove-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
		gap: var(--spacing-xs);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.set-groove {
		min-width: 0;
		background: var(--card);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.set-groove-tick {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		min-height: 3.5rem;
		height: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		cursor: pointer;
	}
	.set-groove-tick input {
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
	.set-groove-tick input:checked + .set-check {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	.set-groove.blocked .set-groove-tick {
		cursor: not-allowed;
	}
	.set-groove.blocked .set-groove-name {
		color: var(--flat-disabled-fg);
	}
	.set-groove-tick input:disabled + .set-check {
		background: transparent;
		border-style: dashed;
	}
	.set-groove-tick input:focus-visible + .set-check {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.set-groove-main {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.set-groove-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.set-groove-pic {
		display: block;
		width: min(100%, 9.5rem);
		--groove-pic-h: 1.125rem;
		--groove-tick: var(--phosphor);
	}
	.set-groove-nopic {
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}
	.set-groove-grid-label {
		flex-shrink: 0;
		align-self: flex-start;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	@media (hover: hover) {
		.set-groove:hover {
			background: var(--secondary);
		}
		.set-group-toggle:not(:disabled):hover .set-group-name {
			text-decoration: underline;
			text-underline-offset: 3px;
		}
	}
	@media (max-width: 759.98px) {
		.set-grooves-bar {
			top: calc(-1 * var(--spacing-lg));
			margin: calc(-1 * var(--spacing-lg)) calc(-1 * var(--spacing-lg)) 0;
			padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md);
		}
		.set-filter {
			flex: 1 1 100%;
		}
	}
</style>
