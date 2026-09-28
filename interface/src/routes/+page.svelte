<script lang="ts">
	import { onMount } from 'svelte';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
	import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { logger } from '$lib/utils/logger';

	// V6 Components
	import TracksPanelV6 from '$lib/components/v6/layout/TracksPanelV6.svelte';
	import DevicesPanelV6 from '$lib/components/v6/layout/DevicesPanelV6.svelte';
	import MiddlePanelV6 from '$lib/components/v6/layout/MiddlePanelV6.svelte';
	import DrillDownBrowser from '$lib/components/v6/browser/DrillDownBrowser.v6.svelte';
	import RightControlsSidebar from '$lib/components/v6/layout/RightControlsSidebar.svelte';
	import MasterTrack from '$lib/components/v6/tracks/MasterTrack.svelte';
	import V3ErrorBanner from '$lib/components/v6/session/V3ErrorBanner.svelte';
	import GroupModeBanner from '$lib/components/v6/session/GroupModeBanner.svelte';
	import SessionHeaderV6 from '$lib/components/v6/session/SessionHeaderV6.svelte';
	import SceneRail from '$lib/components/v6/tracks/SceneRail.svelte';
	import TotalMixStrip from '$lib/components/v6/looping/TotalMixStrip.svelte';
	import SettingsPage from '$lib/components/v6/settings/SettingsPage.svelte';
	import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';

	// Initialize on mount
	onMount(async () => {
		// Set default welcome view in central display
		centralDisplayStore.setView('default');

		// Track query now happens automatically in session initialization
		// when WebSocket connects (see simpleClient.ts initializeV6Session)
	});

	// ---- Section stack (ADR-416) ----------------------------------------
	//
	// The main area is a stack of up to FOUR sections in a fixed order,
	// each an equal share of the height:
	//
	//   1. track strips   — always on, always first
	//   2. session clip grid  (CLIPS, default off)
	//   3. central view       — always on (its VIEW switch went 2026-09-26)
	//   4. FX grid            (FX,    default on)
	//
	// Nothing swaps places: a toggle adds or removes a whole section and
	// the survivors re-divide the height. So the default is the familiar
	// three sections, all four is the fullest layout, and strips with the
	// central view is the emptiest. Every visible row is `flex: 1 1 0`, so "equal" needs
	// no arithmetic and holds at any count (ADR-415's `.third` calc, which
	// hard-coded three, is gone).
	//
	// A hidden section is `display: none`, not a zero-height collapse: a
	// zero-height flex item still contributes its gap, which would leave
	// the column one 16px gap taller than its neighbours and offset every
	// row edge. Removing the item keeps the gap count equal across all
	// three columns, and the subtree stays mounted either way so the
	// hidden panel's component state survives the flip.
	//
	// The clip grid is NOT its own DOM row: it is the second row of the
	// tracks panel, inside that panel's single horizontal scroller, so a
	// clip column can't drift out from under its strip (see
	// TracksPanelV6). The panel is therefore worth two sections plus the
	// gap between them when session mode is on — which is exactly
	// `flex: 2 1 var(--spacing-lg)`, since a flex basis is taken off the
	// free space before the grow shares divide it. That lands on the same
	// section height as the single-share rows at ANY section count.
	let sessionMode = $derived(uiPrefsStore.sessionMode);
	// Always true: the VIEW switch went 2026-09-26 and uiPrefsStore pins it.
	// The central rows' `row-hidden` below is UNREACHABLE since 2026-09-26; kept, not
	// deleted, until the flag itself goes.
	let showCentralRow = $derived(uiPrefsStore.showCentralView);
	let showDevicesRow = $derived(uiPrefsStore.showFxGrid);
	// Mirrors the stack bottom-to-top (ADR-421, always on since its FLIP
	// switch went, 2026-09-26): FX grid on
	// top, track strips against the bottom edge where the hands are. Done
	// with `flex-direction: column-reverse` rather than by reordering the
	// markup, which is what makes it free: flex shares, gaps and the
	// measured row pitches above are all direction-agnostic, so every
	// alignment ADR-415/416 buys holds unchanged and no component's state
	// or DOM order moves. The right sidebar takes the same flip, so the
	// two columns still show the same rows in the same order.
	// Always true (pinned in uiPrefsStore): the unflipped order — the base
	// rules without `.stack-flipped` — is UNREACHABLE since 2026-09-26, kept until the
	// flag goes.
	let flipLayout = $derived(uiPrefsStore.flipLayout);
	let showTransportHeader = $derived(uiPrefsStore.showTransportHeader);
	// The RME mirror only exists on a rig that has the mixer: the bridge's
	// `totalmix` switch (general-release audit §7b). Off, nothing is drawn;
	// on but unheard-from, it is drawn greyed out.
	let totalmixOn = $derived(bridgeStatus.isFeatureOn('totalmix'));
	let totalmixUnavailable = $derived(bridgeStatus.unavailableReason('totalmix'));

	// The sidebar mirrors the stack 1:1 — master / scene rail / groove
	// quantize / loop brace — which is what keeps the two columns' row
	// edges together with no measurement: same visible-row count, same
	// gap count, same even split.
	//
	// The section switches are NOT here. They used to ride at the foot of
	// the last visible sidebar row, which meant riding inside a row that
	// is level with a main-area section — and in the CLIPS-only layout the
	// only row left was the scene rail's, whose footer is exactly one
	// scene-row pitch. Once the scene window scaled with the section count
	// that pitch fell to ~56px and there was no longer room for STOP ALL
	// beside them. They live at the top of the browser rail now (left
	// sidebar), which no main-area geometry depends on.
</script>

<div
	class="fixed inset-0 flex flex-col bg-background main-performance-area"
	data-debug="root"
	style="
		padding-top: 0;
		padding-left: 16px;
		padding-right: 16px;
		padding-bottom: 0;
	"
>
	<!-- Status strip. The safe-area gutter, spent instead of padded away.
	     It is exactly `env(safe-area-inset-top)` tall and carries no
	     margin, so it occupies the identical box the root's old
	     `padding-top` did: every section height below is unchanged, and
	     off-device (harness, desktop) the inset is 0 and this row
	     vanishes entirely. See `.status-strip` for what may go in it. -->
	<div class="flex-shrink-0 status-strip" data-debug="status-strip">
		{#if totalmixOn}
			<TotalMixStrip unavailableReason={totalmixUnavailable} />
		{/if}
	</div>

	<!-- Optional slim transport header (ADR-415). Independent of session
	     mode; fixed height, so enabling it simply compresses the flex rows
	     below rather than reflowing them. -->
	{#if showTransportHeader}
		<div class="flex-shrink-0" data-debug="transport-header" style="margin-bottom: var(--spacing-lg);">
			<SessionHeaderV6 />
		</div>
	{/if}

	<!-- Main three-column row. Carries the horizontal gap; the outer
	     column exists only to hang the header above it, so with the
	     header off this is geometrically identical to the old root. -->
	<div class="flex-1 min-h-0 flex" style="gap: var(--spacing-lg);">
		<!-- Left: Browser Sidebar (full height, spans all 3 rows) -->
		<div class="w-[var(--sidebar-width)] flex-shrink-0 h-full" data-debug="unified-browser-sidebar">
			<DrillDownBrowser />
		</div>

		<!-- Middle: Main content area (3 rows stacked vertically). min-w-0 so the
		     tracks row's min-width strips overflow into the panel's own scroll
		     instead of widening this column and pushing the right sidebar off. -->
		<div
			class="flex-1 min-w-0 min-h-0 flex flex-col"
			class:stack-flipped={flipLayout}
			style="gap: var(--spacing-lg);"
		>
			<!-- Sections 1–2: the track strips, plus the clip grid as this
			     panel's own second row when session mode is on (one scroller
			     — see TracksPanelV6). Two grow shares and a gap's worth of
			     basis in that case, one share otherwise, so its inner rows
			     land on the same height as every other section. -->
			<div
				class="min-h-0 layout-row"
				data-debug="tracks-panel"
				style="flex: {sessionMode ? '2 1 var(--spacing-lg)' : '1 1 0'}; overflow: auto;"
			>
				<TracksPanelV6
					onTrackSelect={(id) => logger.debug('Track selected', { component: 'page', trackIndex: id })}
				/>
			</div>

			<!-- Section 3: Central Display. -->
			<div
				class="min-h-0 layout-row section"
				class:row-hidden={!showCentralRow}
				data-debug="middle-panel"
				style="overflow: auto;"
			>
				<MiddlePanelV6 />
			</div>

			<!-- Section 4: Devices Panel (FX grid). -->
			<div
				class="min-h-0 layout-row section"
				class:row-hidden={!showDevicesRow}
				data-debug="devices-panel"
				style="overflow: auto;"
			>
				<DevicesPanelV6 />
			</div>
		</div>

		<!-- Right: Master + Controls Sidebar. One row per main-area section,
		     shown and hidden by the same flags, so the two columns' row edges
		     agree by construction rather than by measurement. -->
		<div
			class="w-[var(--sidebar-width)] flex-shrink-0 flex flex-col"
			class:stack-flipped={flipLayout}
			data-debug="right-sidebar"
			style="gap: var(--spacing-lg);"
		>
			<!-- Section 1: the master strip, level with the track strips.
			     Always visible, like the strips. Nothing else rides in this
			     section: the TotalMix mirror was here as its own first row
			     (which took height off the top of the master column), then
			     inside MasterTrack's key block, and is now in the status
			     strip — where it costs this column nothing at all. -->
			<div class="min-h-0 layout-row section">
				<MasterTrack
					onSelect={() => logger.debug('Master selected', { component: 'page' })}
				/>
			</div>

			<!-- Section 2: the scene-launch rail, level with the clip grid —
			     same section height, same row count, so the rail's rows land
			     on the grid's without either side measuring the other. It now
			     has the full sidebar width to itself (ADR-416), so no compact
			     variant and no split with the quantize slider.

			     Nothing may be added to this row: it divides its own box by
			     the scene-row count to get its pitch, so anything that
			     shortens the box desyncs it from the grid. Its footer row
			     (level with the grid's per-track stop row) is STOP ALL's
			     alone. -->
			<div class="min-h-0 layout-row section" class:row-hidden={!sessionMode} style="overflow: visible;">
				<SceneRail />
			</div>

			<!-- Section 3: groove quantize, level with the central view. -->
			<div
				class="min-h-0 layout-row section flex flex-col"
				class:row-hidden={!showCentralRow}
				style="overflow: visible;"
			>
				<div class="flex-1 min-h-0">
					<RightControlsSidebar section="quantize" />
				</div>
			</div>

			<!-- Section 4: the clip loop brace, level with the FX grid. -->
			<div class="min-h-0 layout-row section flex flex-col" class:row-hidden={!showDevicesRow}>
				<div class="flex-1 min-h-0">
					<RightControlsSidebar section="loop" />
				</div>
			</div>
		</div>
	</div>

	<!-- V3 transient error banner (e.g. pool-exhausted) -->
	<V3ErrorBanner />

	<!-- Group mode: a held-modifier gesture that changes what every track
	     tap means app-wide, so it needs its own persistent, unmissable
	     indicator rather than a timed toast. -->
	<GroupModeBanner />

	<!-- Settings: the full-page setup view (plan.md §11), opened from the
	     gear in the master track's central view, or by itself on a first
	     run. Mounted here rather than in the System view so it survives a
	     change of central view. -->
	{#if settingsStore.open}
		<SettingsPage />
	{/if}
</div>

<!-- Keyboard shortcuts -->
<svelte:window
	on:keydown={(e) => {
		if (e.ctrlKey && e.key === 'd') {
			e.preventDefault();
			// Debug toggle removed
		}
	}}
/>

<style>
	/* One section of the stack (ADR-416). Equal shares of whatever is
	   left after the gaps, so N sections are equal at any N with no
	   arithmetic — and the middle column and the right sidebar stay level
	   because they show the same rows and therefore the same gaps.

	   The tracks panel is the one row that does NOT carry this class: in
	   session mode it is worth two sections plus the gap between them
	   (`flex: 2 1 var(--spacing-lg)`, set inline), because it carries the
	   clip grid as its own second row. */
	/* The safe-area gutter, now a paintable row rather than root padding.
	   Full-bleed (negative margins cancel the root's 16px sides) because
	   the zones iOS reserves are in screen coordinates, not padded ones.

	   Measured 2026-09-04, iPadOS 18.6, iPad Pro landscape, home-screen
	   web app — this strip IS inside the page (the status bar is
	   transparent under `black-translucent`, set in app.html) and iOS
	   draws over three parts of it:

	     clock + date       ~14–127pt
	     multitasking pill  ~677–699pt   (a live tap target)
	     wifi + battery     ~1270–1359pt

	   so content belongs in ~130–670pt and ~710–1265pt. Keep it
	   read-only: a downward drag from the top edge is Notification
	   Center. The bottom edge has no equivalent — the home-indicator band
	   is outside the viewport entirely and cannot be drawn in.

	   z-index clears the expanded browser overlay (z-index 1000), which
	   is fixed to the viewport and would otherwise cover this. */
	/* The strip runs the FX grid's own column ruler, so each monitor bar
	   sits directly over the tile it shares a column with. That means
	   three things have to agree with `FXGrid.svelte`: TWELVE equal
	   columns, its 8px `gap-2` trough, and the inset of the middle column
	   the grid lives in — the root's 16px side padding, plus a sidebar,
	   plus the gap between them. The strip is full-bleed (negative
	   margins cancel that root padding), so it re-adds the whole inset
	   itself. If the FX grid's column count or gap ever changes, this
	   changes with it; there is no shared constant because the two are
	   different components and a token would hide the coupling rather
	   than document it.

	   `overflow: hidden` matters off-device, where the height is 0 and
	   the bars must not spill. */
	.status-strip {
		height: env(safe-area-inset-top);
		margin-left: -16px;
		margin-right: -16px;
		position: relative;
		z-index: 1001;
		overflow: hidden;
		display: grid;
			grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 0.5rem;
		/* Stretch, not center: each bar takes the strip's height now that
		   the label lives inside it, less a 2px breather top and bottom so
		   the bars don't butt against the screen edge above or the FX grid
		   below. */
		align-items: stretch;
		padding-block: 2px;
		padding-inline: calc(16px + var(--sidebar-width) + var(--spacing-lg));
	}

	/* Channel → FX tile. Addressed by name, not position: the mapping is
	   a statement about which tile each monitor belongs over, and
	   `nth-child` would re-point it silently if the channel order moved.

	     room     → the two left columns  (1–2)
	     playback → EQ                    (3–4)
	     click    → Filter                (5–6)
	     phones   → Pedal                 (7–8)
	     main     → Drum                  (9–10)

	   Columns 11–12 (Squash, Gain) stay clear, as the level columns always
	   have: five channels do not tile a grid that keeps them back.

	   Every bar is two columns again (2026-09-15, twelve columns). Room was
	   one column wide for the few hours the grid was ten: the two left
	   columns are one XY width together on every track kind (Rand Oct +
	   Variation on MIDI, Guitar + Bass/Variation on audio), so no bar
	   straddles a tile seam, which is the one thing this ruler exists to
	   prevent.

	   One collision worth knowing: iPadOS draws its multitasking pill at
	   roughly 677–699pt in landscape, which lands inside the Filter
	   column, so `click`'s bar passes under it. The clock (~14–127pt) and
	   the battery cluster (~1270–1359pt) both fall outside the FX grid's
	   152–1214pt band, so this ruler clears them by construction. */
	.status-strip :global([data-channel='room']) {
		grid-column: 1 / span 2;
	}
	.status-strip :global([data-channel='playback']) {
		grid-column: 3 / span 2;
	}
	.status-strip :global([data-channel='click']) {
		grid-column: 5 / span 2;
	}
	.status-strip :global([data-channel='phones']) {
		grid-column: 7 / span 2;
	}
	.status-strip :global([data-channel='main']) {
		grid-column: 9 / span 2;
	}

	.section {
		flex: 1 1 0;
	}

	.layout-row {
		min-height: 0;
	}

	/* Flipped stack (ADR-421). Order only — `column-reverse` reverses the
	   visual order of the flex line and nothing else: shares, gaps, and
	   `.row-hidden`'s gap-count argument below all behave identically, so
	   the middle column and the sidebar stay level exactly as before.
	   Applied to BOTH columns, so they still show the same rows in the
	   same order as each other. */
	.stack-flipped {
		flex-direction: column-reverse;
	}

	/* `display: none`, not a zero-height collapse. A zero-height flex item
	   still contributes a gap, which would make one column a gap taller
	   than its neighbour and offset every row by 16px. Removing the item
	   keeps the gap count equal across the columns. The subtree stays
	   mounted either way, so component state survives the flip. */
	.row-hidden {
		display: none !important;
	}
</style>
