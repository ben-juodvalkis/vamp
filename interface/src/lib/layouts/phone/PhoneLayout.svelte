<script lang="ts">
	/**
	 * The phone layout (ADR-503): what `routes/+page.svelte` mounts instead
	 * of `layouts/default/Layout.svelte` on a phone-sized screen.
	 *
	 *   transport   SessionHeaderV6, compact: Play · Tempo · Position · Click · Overdub
	 *   ribbon      every track's colour and meter; the frame marks the tracks on screen
	 *   tab         Mix · Clips · Track · Browse, one at a time
	 *   tab bar     the four tabs, Rec in the middle
	 *
	 * Every tab is the iPad's own component, so a strip, a clip cell, the
	 * chain and the browser behave here exactly as they do there.
	 *
	 * The tabs stay mounted and a hidden one is `display: none`, as the
	 * iPad hides a section: what a tab was showing survives a trip to
	 * another. The browser is the exception: it opens as a full-screen
	 * overlay (`position: fixed`), and it has to be able to open from any
	 * tab — the chain's + Effect, the swap pill's name — so off the Browse
	 * tab it is parked in a zero-size box instead of hidden, where its
	 * closed rail is clipped away but its overlay still covers the screen.
	 */
	import { session } from '$lib/stores/session.svelte';
	import { clipStateStore } from '$lib/stores/v6/clipStateStore.svelte';
	import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
	import { selectTrackByIndex } from '$lib/components/v6/tracks/composables/useTrackData.svelte';
	import SessionHeaderV6 from '$lib/components/v6/session/SessionHeaderV6.svelte';
	import DrillDownBrowser from '$lib/components/v6/browser/DrillDownBrowser.v6.svelte';
	import V3ErrorBanner from '$lib/components/v6/session/V3ErrorBanner.svelte';
	import GroupModeBanner from '$lib/components/v6/session/GroupModeBanner.svelte';
	import LiveConnectionBanner from '$lib/components/v6/session/LiveConnectionBanner.svelte';
	import SettingsPage from '$lib/components/v6/settings/SettingsPage.svelte';
	import PhoneTabBar from '$lib/components/v6/phone/PhoneTabBar.svelte';
	import PhoneTrackRibbon from '$lib/components/v6/phone/PhoneTrackRibbon.svelte';
	import PhoneStrips from '$lib/components/v6/phone/PhoneStrips.svelte';
	import PhoneClipGrid from '$lib/components/v6/phone/PhoneClipGrid.svelte';
	import PhoneTrackTab from '$lib/components/v6/phone/PhoneTrackTab.svelte';
	import { PHONE_GEOMETRY_STYLE } from '$lib/components/v6/phone/phoneGeometry';
	import { parsePhoneTab, type PhoneTab } from '$lib/utils/phoneLayout';

	// The last tab, per device: a phone reopened mid-set comes back where it
	// was. A convenience only, so storage that refuses is no error.
	const TAB_KEY = 'phoneLayout.tab';
	function readTab(): PhoneTab {
		try {
			return parsePhoneTab(localStorage.getItem(TAB_KEY));
		} catch {
			return 'mix';
		}
	}

	let tab = $state<PhoneTab>(readTab());

	function selectTab(next: PhoneTab) {
		tab = next;
		try {
			localStorage.setItem(TAB_KEY, next);
		} catch {
			/* private mode or blocked storage: the tab just isn't remembered */
		}
	}

	let tracks = $derived(clipStateStore.getVisibleTracks(session.numTracks, session.selectedTrackIndex));

	// Mix and Clips scroll as one: the columns are the same width at the
	// same pitch, so one scroll position puts the same tracks in front of
	// you on both.
	let sharedScroll = $state(0);
	let ribbonWindow = $state<{ start: number; end: number } | null>(null);

	const showsTracks = $derived(tab === 'mix' || tab === 'clips');
</script>

<div class="phone-root" data-phone-layout data-debug="phone-root" data-phone-tab-shown={tab} style={PHONE_GEOMETRY_STYLE}>
	<div class="top">
		<div class="transport"><SessionHeaderV6 compact /></div>

		{#if tab !== 'browse'}
			<div class="ribbon-row">
				<PhoneTrackRibbon
					{tracks}
					window={showsTracks ? ribbonWindow : null}
					onPick={(i) => selectTrackByIndex(i)}
				/>
			</div>
		{/if}
	</div>

	<div class="body">
		<div class="pane" class:is-hidden={tab !== 'mix'} data-debug="phone-pane-mix">
			<PhoneStrips
				{tracks}
				active={tab === 'mix'}
				scrollLeft={sharedScroll}
				onScroll={(x) => (sharedScroll = x)}
				onWindow={(w) => (ribbonWindow = w)}
			/>
		</div>
		<div class="pane" class:is-hidden={tab !== 'clips'} data-debug="phone-pane-clips">
			<PhoneClipGrid
				{tracks}
				active={tab === 'clips'}
				scrollLeft={sharedScroll}
				onScroll={(x) => (sharedScroll = x)}
				onWindow={(w) => (ribbonWindow = w)}
			/>
		</div>
		<div class="pane" class:is-hidden={tab !== 'track'} data-debug="phone-pane-track">
			<PhoneTrackTab />
		</div>
		<div class="browser-host" class:is-parked={tab !== 'browse'} data-debug="phone-pane-browse">
			<DrillDownBrowser />
		</div>
	</div>

	<div class="tabs"><PhoneTabBar {tab} onSelect={selectTab} /></div>

	<V3ErrorBanner />
	<LiveConnectionBanner />
	<GroupModeBanner />
	{#if settingsStore.open}
		<SettingsPage />
	{/if}
</div>

<style>
	/* The whole screen, inside the phone's safe areas: the island or notch
	   above, the home bar below, and the sides when it is turned over. */
	.phone-root {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--background);
		padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
			env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
		overflow: hidden;
		overscroll-behavior: none;
	}

	.top {
		flex: none;
	}

	.transport {
		padding: 6px var(--phone-inset);
	}

	.ribbon-row {
		flex: none;
		padding: 6px var(--phone-inset) 10px;
	}

	.body {
		position: relative;
		flex: 1 1 0;
		min-height: 0;
		padding-bottom: 8px;
	}

	.pane {
		height: 100%;
		min-height: 0;
	}
	.pane.is-hidden {
		display: none;
	}

	/* The browser's closed rail fills the Browse tab; off it, the box is
	   zero-size so the rail is clipped away, while an open browser — fixed
	   to the viewport — still covers the screen from any tab. */
	.browser-host {
		position: absolute;
		inset: 0 var(--phone-inset) 8px;
	}
	.browser-host.is-parked {
		inset: auto;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	/* Landscape: the tab bar a rail on the left, the transport and the
	   ribbon side by side above the tab. */
	@media (orientation: landscape) {
		.phone-root {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
			grid-template-areas:
				'tabs top'
				'tabs body';
		}
		.tabs {
			grid-area: tabs;
			min-height: 0;
		}
		.top {
			grid-area: top;
			display: flex;
			align-items: center;
			min-width: 0;
		}
		.transport {
			flex: 0 0 58%;
			min-width: 0;
			padding-right: 0;
		}
		/* Browse draws no ribbon: the transport takes the row. */
		.transport:only-child {
			flex-basis: 100%;
			padding-right: var(--phone-inset);
		}
		.ribbon-row {
			flex: 1 1 0;
			min-width: 0;
			padding: 6px var(--phone-inset);
		}
		.body {
			grid-area: body;
		}
	}
</style>
