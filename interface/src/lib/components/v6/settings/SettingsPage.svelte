<script lang="ts">
	/**
	 * Settings — a full-page view for setup (plan.md §11; laid out by task
	 * since ADR-534).
	 *
	 * Opened from the gear in the master track's central view, or by itself
	 * on a first run (`settingsStore.firstRun`, onboarding.plan.md §7). Its
	 * sections run down a sidebar in three groups:
	 *
	 *   Setup         the first-run checklist, only while this visit began as one
	 *   Play          Recording (what REC records, Auto Rec, Auto-Arm),
	 *                 Controllers (the foot switch, Move's knobs)
	 *   Browse        Library (the Places, with the effects folder), Grooves
	 *   System        Connection (Live, the iPad, paired devices),
	 *                 Integrations (the features and why any is unavailable)
	 *
	 * The theme sits at the sidebar's foot, one choice always in reach. The
	 * head is one toolbar: the page's name over the sidebar, the section's
	 * name over the section, and the way out on the right. Under 760px (the
	 * Mac's half-width window, a phone) the page shows the list or one
	 * section, iOS's way, with a back button in the head.
	 *
	 * Every section stays mounted (hidden, not unmounted), so a filter, a
	 * scroll or an open group survives the switch. Every address and echo is
	 * exactly what the System view sent: the cards moved, the wire did not.
	 * Everything applies as it is changed, so there is nothing to save: Close
	 * only closes. A first run ends with Finish setup, which saves the ticks
	 * as they stand (the Mac's record that setup happened).
	 */
	import './settings.css';
	import { onMount } from 'svelte';
	import { settingsStore, type SettingsSection } from '$lib/stores/v6/settingsStore.svelte';
	import { handshakeState } from '$lib/stores/v3/handshakeState.svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { theme, resolvedTheme, themeActions, type Theme } from '$lib/stores/theme';
	import Disc from '@lucide/svelte/icons/disc';
	import Footprints from '@lucide/svelte/icons/footprints';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import AudioLines from '@lucide/svelte/icons/audio-lines';
	import Cable from '@lucide/svelte/icons/cable';
	import Puzzle from '@lucide/svelte/icons/puzzle';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import X from '@lucide/svelte/icons/x';
	import RecordingSection from './RecordingSection.svelte';
	import ControllersSection from './ControllersSection.svelte';
	import PlacesCard from './PlacesCard.svelte';
	import GroovesSection from './GroovesSection.svelte';
	import { groovesStore } from '$lib/stores/v6/groovesStore.svelte';
	import ConnectionSection from './ConnectionSection.svelte';
	import IntegrationsSection from './IntegrationsSection.svelte';
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
	else if (settingsStore.section === 'setup') settingsStore.section = 'recording';
	$effect(() => {
		if (settingsStore.firstRun && !setup) {
			setup = true;
			settingsStore.section = 'setup';
		}
	});

	// A narrow window shows the list of sections or one of them. It opens on
	// the section (the one asked for, or where it was left), with a way back.
	let narrow = $state<'list' | 'panel'>('panel');

	const steps = $derived(
		firstRunSteps({
			surfaceProtocol: handshakeState.phase === 'accepted' ? handshakeState.negotiatedVersion : null,
			m4l: places.listing?.m4lDevices ?? null,
			tickedCount: places.tickedCount,
			footLearned: session.footSwitch.cc >= 0
		})
	);
	const progress = $derived(firstRunProgress(steps));

	// The marks on the System tabs: Connection is Live's handshake, and
	// Integrations warns while any switched-on feature is not answering.
	const connectionState = $derived.by((): 'ok' | 'waiting' | 'problem' => {
		if (handshakeState.phase === 'failed') return 'problem';
		return handshakeState.phase === 'accepted' ? 'ok' : 'waiting';
	});
	const integrationsProblem = $derived(
		Object.keys(bridgeStatus.features).some((id) => {
			const f = bridgeStatus.feature(id);
			return f.enabled && !f.available;
		})
	);
	const CONNECTION_STATE_LABEL = { ok: 'Live connected', waiting: 'Waiting for Live', problem: 'Live refused the connection' };

	type Tab = { id: SettingsSection; label: string; icon: typeof Disc; group: string };
	const tabs = $derived<Tab[]>([
		...(setup ? [{ id: 'setup' as const, label: 'Setup', icon: ListChecks, group: '' }] : []),
		{ id: 'recording', label: 'Recording', icon: Disc, group: 'Play' },
		{ id: 'controllers', label: 'Controllers', icon: Footprints, group: 'Play' },
		{ id: 'places', label: 'Library', icon: FolderOpen, group: 'Browse' },
		{ id: 'grooves', label: 'Grooves', icon: AudioLines, group: 'Browse' },
		{ id: 'connection', label: 'Connection', icon: Cable, group: 'System' },
		{ id: 'integrations', label: 'Integrations', icon: Puzzle, group: 'System' }
	]);
	const current = $derived<SettingsSection>(tabs.some((t) => t.id === settingsStore.section) ? settingsStore.section : 'recording');
	const currentTab = $derived(tabs.find((t) => t.id === current) ?? tabs[0]);
	const pageTitle = $derived(setup ? 'Welcome to Vamp' : 'Settings');

	function select(id: SettingsSection) {
		settingsStore.section = id;
		narrow = 'panel';
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
		settingsStore.section = tabs[next].id;
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

	const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon },
		{ id: 'system', label: 'Auto', icon: Monitor }
	];
</script>

<div
	class="set-page"
	role="dialog"
	aria-modal="true"
	aria-label={pageTitle}
	tabindex="-1"
	use:autofocus
	onkeydown={onKeydown}
	data-debug="settings-page"
	data-section={current}
	data-narrow={narrow}
>
	<div class="set-nav-head">
		<h1 class="set-title">{pageTitle}</h1>
	</div>

	<header class="set-head">
		<button class="set-btn set-btn-quiet set-back" onclick={() => (narrow = 'list')} data-debug="settings-back">
			<ChevronLeft class="set-btn-icon" aria-hidden="true" />
			<span>{pageTitle}</span>
		</button>
		<h2 class="set-head-title">
			<span class="set-head-title-section">{currentTab.label}</span>
			<span class="set-head-title-page">{pageTitle}</span>
		</h2>
		<div class="set-head-actions">
			{#if finishError}<span class="set-head-error" role="alert">{finishError}</span>{/if}
			{#if setup}
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
			{:else}
				<button class="set-btn set-close" aria-label="Close settings" title="Close (Esc)" onclick={close} data-debug="settings-close">
					<X class="set-btn-icon" aria-hidden="true" />
				</button>
			{/if}
		</div>
	</header>

	<nav class="set-nav" aria-label="Settings sections">
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="set-tabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical" tabindex="-1" onkeydown={onTabKeydown}>
			{#each tabs as tab, i (tab.id)}
				{@const Icon = tab.icon}
				{#if tab.group && tab.group !== tabs[i - 1]?.group}
					<div class="set-nav-heading" aria-hidden="true">{tab.group}</div>
				{/if}
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
						<span class="set-tab-badge" aria-label="{places.tickedCount} in the sidebar">{places.tickedCount}</span>
					{:else if tab.id === 'grooves' && groovesStore.listing}
						<span class="set-tab-badge" aria-label="{groovesStore.ticked.length} in the Groove view">{groovesStore.ticked.length}</span>
					{:else if tab.id === 'connection'}
						<span class="set-tab-dot" data-state={connectionState} role="img" aria-label={CONNECTION_STATE_LABEL[connectionState]}></span>
					{:else if tab.id === 'integrations' && integrationsProblem}
						<span class="set-tab-dot" data-state="problem" role="img" aria-label="An integration is not answering"></span>
					{/if}
					<ChevronRight class="set-tab-chevron" aria-hidden="true" />
				</button>
			{/each}
		</div>

		<div class="set-nav-foot" data-debug="settings-appearance">
			<div class="set-nav-foot-label">
				<span>Theme</span>
				{#if $theme === 'system'}<span>{$resolvedTheme} now</span>{/if}
			</div>
			<div class="set-segmented" role="group" aria-label="Theme">
				{#each THEMES as t (t.id)}
					{@const Icon = t.icon}
					<button
						class="set-segment"
						class:on={$theme === t.id}
						aria-pressed={$theme === t.id}
						title={t.id === 'system' ? 'Follow this device’s light or dark setting' : t.label}
						onclick={() => themeActions.set(t.id)}
						data-theme-choice={t.id}
					>
						<Icon class="set-btn-icon" aria-hidden="true" />
						<span>{t.label}</span>
					</button>
				{/each}
			</div>
		</div>
	</nav>

	{#if setup}
		<div class="set-panel" role="tabpanel" id="set-panel-setup" aria-labelledby="set-tab-setup" hidden={current !== 'setup'} data-debug="settings-first-run">
			<FirstRunCard {steps} {progress} {addresses} addressState={macState} />
		</div>
	{/if}
	<div class="set-panel" role="tabpanel" id="set-panel-recording" aria-labelledby="set-tab-recording" hidden={current !== 'recording'} data-debug="settings-recording">
		<RecordingSection />
	</div>
	<div class="set-panel" role="tabpanel" id="set-panel-controllers" aria-labelledby="set-tab-controllers" hidden={current !== 'controllers'} data-debug="settings-controllers">
		<ControllersSection />
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
	<div class="set-panel" role="tabpanel" id="set-panel-integrations" aria-labelledby="set-tab-integrations" hidden={current !== 'integrations'} data-debug="settings-integrations">
		<IntegrationsSection />
	</div>
</div>
