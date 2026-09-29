<script lang="ts">
	/**
	 * Settings — a full-page view for setup (plan.md §11, 2026-09-26).
	 *
	 * Opened from the gear in the master track's central view, or by itself
	 * on a first run (`settingsStore.firstRun`, onboarding.plan.md §7). Its
	 * sections run down a sidebar, or across as tabs on a narrow window
	 * (under 760px: the Mac's half-width window, a phone):
	 *
	 *   Setup       the first-run checklist, only while this visit began as one
	 *   General     Behavior, Appearance, Foot Switch (`GeneralSection`)
	 *   Places      a tick per folder Live lists (`PlacesCard`)
	 *   Grooves     a tick per groove file for the Groove view (`GroovesSection`)
	 *   Connection  Live's surface, the address to open on the iPad, the
	 *               features and why any is unavailable (`ConnectionSection`)
	 *
	 * One long page of equal cards buried everything under the Places list;
	 * each section now scrolls on its own and keeps its place when you switch
	 * away. Every section stays mounted (hidden, not unmounted), so a filter,
	 * a scroll or an open group survives the switch.
	 *
	 * Every address and echo is exactly what the System view sent: the cards
	 * moved, the wire did not. Behavior and the foot switch are echo-confirmed,
	 * not optimistic — they are surface-side state (see the System view's notes
	 * on why). Everything applies as it is changed, so there is nothing to
	 * save: Close only closes. A first run ends with Finish setup, which saves
	 * the ticks as they stand (the Mac's record that setup happened).
	 */
	import { onMount } from 'svelte';
	import { settingsStore, type SettingsSection } from '$lib/stores/v6/settingsStore.svelte';
	import { handshakeState } from '$lib/stores/v3/handshakeState.svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { SlidersHorizontal, FolderOpen, AudioLines, Cable, ListChecks, X } from 'lucide-svelte';
	import GeneralSection from './GeneralSection.svelte';
	import PlacesCard from './PlacesCard.svelte';
	import GroovesSection from './GroovesSection.svelte';
	import { groovesStore } from '$lib/stores/v6/groovesStore.svelte';
	import ConnectionSection from './ConnectionSection.svelte';
	import FirstRunCard from './FirstRunCard.svelte';
	import { createPlacesListing } from './placesListing.svelte';
	import { firstRunSteps, firstRunProgress } from './firstRunSteps';
	import { fetchMacAddresses, ipadAddresses } from './ipadAddress';
	import type { MacAddresses } from '$lib/types/network';

	const places = createPlacesListing();

	let mac = $state<MacAddresses | null>(null);
	let macState = $state<'loading' | 'ready' | 'failed'>('loading');
	onMount(() => {
		fetchMacAddresses()
			.then((m) => {
				mac = m;
				macState = 'ready';
			})
			.catch(() => (macState = 'failed'));
		return places.watch();
	});
	const addresses = $derived(typeof window === 'undefined' ? [] : ipadAddresses(window.location, mac));

	// A visit that began as a first run stays one until the page closes. The
	// Mac's own flag flips the moment the first Place is ticked (the ticks
	// file now exists), and the checklist used to vanish with it, halfway
	// through. A listing that lands after the page opened can still turn it on.
	const openedAsSetup = settingsStore.firstRun;
	let setup = $state(openedAsSetup);
	if (openedAsSetup) settingsStore.section = 'setup';
	else if (settingsStore.section === 'setup') settingsStore.section = 'general';
	$effect(() => {
		if (settingsStore.firstRun && !setup) {
			setup = true;
			settingsStore.section = 'setup';
		}
	});

	const steps = $derived(
		firstRunSteps({
			surfaceProtocol: handshakeState.phase === 'accepted' ? handshakeState.negotiatedVersion : null,
			m4l: places.listing?.m4lDevices ?? null,
			tickedCount: places.tickedCount,
			footLearned: session.footSwitch.cc >= 0,
			recorderReady: bridgeStatus.feature('captureRecorder').available
		})
	);
	const progress = $derived(firstRunProgress(steps));

	// The Connection tab's mark: a problem outranks a wait. The recorder is
	// optional, so its absence is its own row's news, not the tab's.
	const connectionState = $derived.by((): 'ok' | 'waiting' | 'problem' => {
		const anyUnavailable = Object.keys(bridgeStatus.features).some((id) => {
			if (id === 'captureRecorder') return false;
			const f = bridgeStatus.feature(id);
			return f.enabled && !f.available;
		});
		if (handshakeState.phase === 'failed' || anyUnavailable) return 'problem';
		return handshakeState.phase === 'accepted' ? 'ok' : 'waiting';
	});
	const CONNECTION_STATE_LABEL = { ok: 'All connected', waiting: 'Waiting for Live', problem: 'Needs attention' };

	type Tab = { id: SettingsSection; label: string; icon: typeof SlidersHorizontal };
	const tabs = $derived<Tab[]>([
		...(setup ? [{ id: 'setup' as const, label: 'Setup', icon: ListChecks }] : []),
		{ id: 'general', label: 'General', icon: SlidersHorizontal },
		{ id: 'places', label: 'Places', icon: FolderOpen },
		{ id: 'grooves', label: 'Grooves', icon: AudioLines },
		{ id: 'connection', label: 'Connection', icon: Cable }
	]);
	const current = $derived<SettingsSection>(tabs.some((t) => t.id === settingsStore.section) ? settingsStore.section : 'general');

	function select(id: SettingsSection) {
		settingsStore.section = id;
	}

	// Arrow keys move along the tabs (the ARIA tabs pattern), for the Mac.
	function onTabKeydown(event: KeyboardEvent) {
		const i = tabs.findIndex((t) => t.id === current);
		const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
		let next = i;
		if (step) next = (i + step + tabs.length) % tabs.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = tabs.length - 1;
		else return;
		event.preventDefault();
		select(tabs[next].id);
		(event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${tabs[next].id}"]`)?.focus();
	}

	function close() {
		settingsStore.closeSettings();
	}

	// Finish setup: save the ticks as they stand, which is the Mac's record
	// that setup happened — unless a tick already saved them — then close.
	let finishError = $state('');
	async function finishSetup() {
		if (settingsStore.firstRun) {
			const ok = await places.finish();
			if (!ok) {
				finishError = `Couldn’t save on the Mac: ${places.saveError}`;
				return;
			}
		}
		close();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		// Escape in a filled-in field clears the field (its own handler), not the page.
		const t = event.target;
		if (t instanceof HTMLInputElement && t.value) return;
		close();
	}

	function autofocus(node: HTMLElement) {
		node.focus();
	}
</script>

<div
	class="set-page"
	role="dialog"
	aria-modal="true"
	aria-label="Settings"
	tabindex="-1"
	use:autofocus
	onkeydown={onKeydown}
	data-debug="settings-page"
	data-section={current}
>
	<header class="set-head">
		<h1 class="set-title">{setup ? 'Welcome — set up Vamp' : 'Settings'}</h1>
		<div class="set-head-actions">
			{#if finishError}<span class="set-head-error" role="alert">{finishError}</span>{/if}
			{#if !setup}
				<button class="set-btn" aria-label="Close settings" onclick={close} data-debug="settings-close">
					<X class="set-btn-icon" aria-hidden="true" />
					<span>Close</span>
				</button>
			{:else}
				{#if settingsStore.firstRun}
					<button class="set-btn" onclick={close} data-debug="settings-close">Set up later</button>
				{/if}
				<button
					class="set-btn set-btn-primary"
					onclick={finishSetup}
					disabled={places.saving || (settingsStore.firstRun && !places.listing)}
					data-debug="first-run-done"
				>
					Finish setup
				</button>
			{/if}
		</div>
	</header>

	<div class="set-body">
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="set-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical" tabindex="-1" onkeydown={onTabKeydown}>
			{#each tabs as tab (tab.id)}
				{@const Icon = tab.icon}
				<button
					class="set-tab"
					role="tab"
					id="set-tab-{tab.id}"
					aria-selected={current === tab.id}
					aria-controls="set-panel-{tab.id}"
					tabindex={current === tab.id ? 0 : -1}
					data-tab={tab.id}
					onclick={() => select(tab.id)}
				>
					<Icon class="set-tab-icon" aria-hidden="true" />
					<span class="set-tab-label">{tab.label}</span>
					{#if tab.id === 'setup'}
						<span class="set-tab-badge" aria-label="{progress.done} of {progress.total} steps done">{progress.done}/{progress.total}</span>
					{:else if tab.id === 'places' && places.listing}
						<span class="set-tab-badge" aria-label="{places.tickedCount} shown in the browser">{places.tickedCount}</span>
					{:else if tab.id === 'grooves' && groovesStore.listing}
						<span class="set-tab-badge" aria-label="{groovesStore.ticked.length} in the Groove view">{groovesStore.ticked.length}</span>
					{:else if tab.id === 'connection'}
						<span class="set-tab-dot" data-state={connectionState} role="img" aria-label={CONNECTION_STATE_LABEL[connectionState]}></span>
					{/if}
				</button>
			{/each}
		</div>

		{#if setup}
			<div class="set-panel" role="tabpanel" id="set-panel-setup" aria-labelledby="set-tab-setup" hidden={current !== 'setup'} data-debug="settings-first-run">
				<FirstRunCard {steps} {addresses} addressState={macState} />
			</div>
		{/if}
		<div class="set-panel" role="tabpanel" id="set-panel-general" aria-labelledby="set-tab-general" hidden={current !== 'general'} data-debug="settings-general">
			<GeneralSection />
		</div>
		<div class="set-panel set-panel-wide" role="tabpanel" id="set-panel-places" aria-labelledby="set-tab-places" hidden={current !== 'places'} data-debug="settings-places">
			<PlacesCard {places} />
		</div>
		<div class="set-panel set-panel-wide" role="tabpanel" id="set-panel-grooves" aria-labelledby="set-tab-grooves" hidden={current !== 'grooves'} data-debug="settings-grooves">
			<GroovesSection />
		</div>
		<div class="set-panel" role="tabpanel" id="set-panel-connection" aria-labelledby="set-tab-connection" hidden={current !== 'connection'} data-debug="settings-connection">
			<ConnectionSection {addresses} addressState={macState} />
		</div>
	</div>
</div>

<style>
	/* The page covers the whole app, the safe-area status strip included
	   (z-index 1001 in +page.svelte; the expanded browser is 1000): setup is
	   not something you do mid-set with one eye on the strips. Its own top
	   inset clears the iPad's status bar in a home-screen web app. */
	.set-page {
		position: fixed;
		inset: 0;
		z-index: 1002;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		padding-top: env(safe-area-inset-top);
		background: var(--background);
		color: var(--foreground);
	}
	.set-page:focus {
		outline: none;
	}

	/* ---- Header ---- */
	.set-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm) var(--spacing-lg);
		padding: var(--spacing-md) var(--spacing-xl);
		border-bottom: 1px solid var(--line-strong);
	}
	.set-title {
		flex: 1 1 12rem;
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.25;
	}
	.set-head-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-left: auto;
	}
	.set-head-error {
		font-size: 0.8125rem;
		color: var(--act-warn);
	}

	/* ---- Buttons (the header's, and every section's) ---- */
	.set-page :global(.set-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		min-height: var(--height-touch);
		padding: 0 var(--spacing-lg);
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
		white-space: nowrap;
	}
	.set-page :global(.set-btn-primary) {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	.set-page :global(.set-btn:disabled) {
		color: var(--flat-disabled-fg);
		cursor: not-allowed;
	}
	.set-page :global(.set-btn-primary:disabled) {
		background: var(--surface-well);
		border-color: var(--line-strong);
	}
	.set-page :global(.set-btn-icon) {
		width: 1.125rem;
		height: 1.125rem;
		flex-shrink: 0;
	}

	/* ---- Sidebar ---- */
	.set-body {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		min-height: 0;
	}
	.set-nav {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding: var(--spacing-lg) var(--spacing-md);
		border-right: 1px solid var(--line-strong);
		overflow-y: auto;
	}
	.set-nav:focus {
		outline: none;
	}
	.set-tab {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		min-height: 3rem;
		padding: 0 var(--spacing-md);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--foreground);
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		text-align: left;
		cursor: pointer;
	}
	.set-tab[aria-selected='true'] {
		background: var(--flat-selection);
		color: var(--flat-selection-fg);
	}
	.set-tab :global(.set-tab-icon) {
		width: 1.125rem;
		height: 1.125rem;
		flex-shrink: 0;
	}
	.set-tab-label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.set-tab-badge {
		flex-shrink: 0;
		min-width: 1.5rem;
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
		background: var(--surface-well);
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.set-tab[aria-selected='true'] .set-tab-badge {
		background: color-mix(in srgb, var(--flat-selection-fg) 14%, transparent);
		color: var(--flat-selection-fg);
	}
	.set-tab-dot {
		flex-shrink: 0;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 9999px;
		border: 1.5px solid var(--muted-foreground);
	}
	.set-tab-dot[data-state='ok'] {
		background: var(--phosphor);
		border-color: var(--phosphor);
	}
	.set-tab-dot[data-state='problem'] {
		background: var(--act-warn);
		border-color: var(--act-warn);
	}
	.set-tab[aria-selected='true'] .set-tab-dot {
		border-color: var(--flat-selection-fg);
	}
	.set-tab:focus-visible,
	.set-page :global(.set-btn:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	@media (hover: hover) {
		.set-tab:not([aria-selected='true']):hover {
			background: var(--secondary);
		}
	}

	/* ---- Sections ---- */
	.set-panel {
		grid-column: 2;
		grid-row: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--spacing-xl) var(--spacing-xl) 3rem;
	}
	.set-panel[hidden] {
		display: none;
	}
	/* Everything but Places and Grooves reads as one column; those spend the width on
	   more columns of cards. */
	.set-panel > :global(*) {
		max-width: 46rem;
	}
	.set-panel-wide > :global(*) {
		max-width: none;
	}

	/* ---- The sections' grammar (every section's children share it) ----
	   A group is a quiet title over one bordered list; a row is a name,
	   what it does, and its state on the right. A switch is the whole row,
	   so its target is the row, never a small box inside it. */
	.set-page :global(.set-section) {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xl);
	}
	.set-page :global(.set-group) {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	.set-page :global(.set-group-title) {
		padding-inline: 0.125rem;
		font-size: 0.8125rem;
		font-weight: var(--font-weight-medium);
		color: var(--muted-foreground);
	}
	.set-page :global(.set-lead) {
		font-size: 0.9375rem;
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	.set-page :global(.set-lead strong) {
		color: var(--foreground);
		font-weight: var(--font-weight-medium);
	}
	.set-page :global(.set-note) {
		padding-inline: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	.set-page :global(.set-note strong) {
		color: var(--foreground);
		font-weight: var(--font-weight-medium);
	}
	.set-page :global(.set-list) {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		background: var(--card);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.set-page :global(.set-row) {
		display: flex;
		align-items: center;
		gap: var(--spacing-md) var(--spacing-lg);
		min-height: 3.5rem;
		padding: var(--spacing-md) var(--spacing-lg);
	}
	.set-page :global(.set-row + .set-row) {
		border-top: 1px solid var(--line-strong);
	}
	.set-page :global(.set-row-stack) {
		flex-wrap: wrap;
	}
	.set-page :global(.set-row-button) {
		width: 100%;
		background: transparent;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.set-page :global(.set-row-button:active) {
		background: var(--secondary);
	}
	.set-page :global(.set-row-button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	@media (hover: hover) {
		.set-page :global(.set-row-button:hover) {
			background: var(--secondary);
		}
	}
	.set-page :global(.set-row-main) {
		flex: 1 1 14rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.set-page :global(.set-row-label) {
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		color: var(--foreground);
	}
	.set-page :global(.set-row-sub) {
		font-size: 0.8125rem;
		line-height: 1.35;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
	.set-page :global(.set-row-reason) {
		color: var(--foreground);
	}
	.set-page :global(.set-row-detail) {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--fg-tertiary);
	}
	/* A switch's state: ON is Live's orange, OFF a well. */
	.set-page :global(.set-chip) {
		flex-shrink: 0;
		min-width: 3.25rem;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		font-weight: var(--font-weight-medium);
		text-align: center;
		color: var(--muted-foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.set-page :global(.set-chip.on) {
		color: var(--flat-on-fg);
		background: var(--phosphor);
		border-color: var(--phosphor);
	}
	/* A read-only state: a dot and a word, no box, so it never reads as a
	   control. */
	.set-page :global(.set-status) {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: var(--font-weight-medium);
		color: var(--muted-foreground);
	}
	.set-page :global(.set-status-dot) {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		border: 1.5px solid currentColor;
	}
	.set-page :global(.set-status[data-state='on']) {
		color: var(--foreground);
	}
	.set-page :global(.set-status[data-state='on'] .set-status-dot) {
		background: var(--phosphor);
		border-color: var(--phosphor);
	}
	.set-page :global(.set-status[data-state='problem']) {
		color: var(--act-warn);
	}
	.set-page :global(.set-status[data-state='problem'] .set-status-dot) {
		background: currentColor;
	}

	/* ---- Narrow: tabs across the top ---- */
	@media (max-width: 759.98px) {
		.set-head {
			padding: var(--spacing-sm) var(--spacing-lg);
		}
		.set-body {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}
		.set-nav {
			flex-direction: row;
			padding: var(--spacing-sm) var(--spacing-lg);
			border-right: 0;
			border-bottom: 1px solid var(--line-strong);
			overflow: visible;
		}
		.set-tab {
			flex: 1 1 0;
			justify-content: center;
			gap: var(--spacing-sm);
			min-height: var(--height-touch);
			min-width: 0;
			padding: 0 var(--spacing-sm);
		}
		.set-tab-label {
			flex: 0 1 auto;
		}
		.set-panel {
			grid-column: 1;
			grid-row: 2;
			padding: var(--spacing-lg) var(--spacing-lg) 2.5rem;
		}
	}
	/* A phone: the words need the whole tab. */
	@media (max-width: 479.98px) {
		.set-tab :global(.set-tab-icon),
		.set-tab-badge {
			display: none;
		}
		.set-tab {
			font-size: 0.875rem;
		}
	}
</style>
