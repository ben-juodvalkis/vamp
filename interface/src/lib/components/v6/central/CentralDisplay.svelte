<script lang="ts">
import { logger } from '$lib/utils/logger';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
	import { selectedTrackStore, type SlotKey } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { DEVICE_PRESETS } from '$lib/config/devicePresets';
	import { effectAvailable } from '$lib/services/effectSources.svelte';
	import { resolveViewComponent, hasFullScreenBoard } from './viewRegistry';
	import { shouldReloadForImportError } from '$lib/utils/chunkReload';
	import { deviceInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { selectedTrackInk } from '$lib/utils/selectedTrackInk';
	import SwapControl from './SwapControl.svelte';
	import { useInstrumentSwap } from './useInstrumentSwap.svelte';
	import { useClipSwap } from './useClipSwap.svelte';
	import { provideSwapHost } from './swapHost.svelte';
	import { provideValueBoxes } from './valueBox';
	import { press } from '$lib/actions/press';
	import Maximize from '@lucide/svelte/icons/maximize';
	import Minimize from '@lucide/svelte/icons/minimize';
	import type { Component } from 'svelte';
	import { session } from '$lib/stores/session.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';

	// The view's title line: whose it is and what it is. Read from the same
	// records the strips and the chain draw from, so it cannot disagree.
	let headTrack = $derived.by(() => {
		if (session.selectedTrackIndex < 0) return 'Main';
		return v3Store.tracks.get('tracks/' + session.selectedTrackIndex)?.name ?? '';
	});
	let headDevice = $derived.by(() => {
		const v = centralDisplayStore.view;
		switch (v.type) {
			case 'device': {
				// The device the chain picked for this view, by what Live calls
				// it; else the preset's own name. Never the view's key
				// ("chain-device" is a key, not a name).
				const trackPath = selectedTrackStore.selectedTrackPath;
				const picked = fxChainStore.pickFor(trackPath, v.subType ?? '');
				const device = picked
					? (selectedTrackStore.devicesByPath.find((d) => d.devicePath === picked) ??
						(picked.startsWith(`${trackPath}/`) ? selectedTrackStore.deviceAt(picked) : undefined))
					: undefined;
				return device?.name ?? v.data?.device?.name ?? DEVICE_PRESETS[v.subType ?? '']?.defaultName ?? v.title ?? '';
			}
			case 'instrument':
				return v.data?.instrument?.name ?? v.subType ?? 'Instrument';
			case 'clip':
				return 'Clip';
			case 'permute':
				return 'Permute';
			case 'groove':
				return 'Groove';
			case 'system':
				return 'Set';
			default:
				return v.title ?? '';
		}
	});

	// Component loading state
	let isLoadingComponent = $state(false);
	let loadError = $state<Error | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let ViewComponent = $state<Component<any> | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let componentCache = new Map<string, Component<any>>();
	// Tracks the most recently requested cache key so stale async resolutions
	// from rapid view switches are discarded rather than flashing the wrong component.
	let latestCacheKey = '';

	// Get reactive view state
	let view = $derived(centralDisplayStore.view);

	// Track only type/subType for component loading decisions
	// This prevents component reload when only view.data changes (e.g., during XY drag)
	let viewType = $derived(view.type);
	let viewSubType = $derived(view.subType);

	// One of Vamp's own effects (ADR-498) is offered only when its file is in
	// the effects folder: a view of one that is neither on the chain nor in
	// the folder would draw ghost controls for a file that is not there, so
	// it is left.
	$effect(() => {
		const type = viewType === 'device' ? viewSubType : undefined;
		if (!type || !DEVICE_PRESETS[type]?.effect) return;
		if (selectedTrackStore.getFxGridSlot(type as SlotKey).device || effectAvailable(type)) return;
		centralDisplayStore.clearView();
	});

	// Extract props to pass to the view component (reactive to data changes)
	let viewProps = $derived(view.data || {});

	// Extract color from view data if available
	let color = $derived(view.data?.color);

	// Selected-track ink — the fallback accent for views that carry no device
	// color of their own (clip / permute / instrument), so they frame in the
	// focused track's color instead of neutral grey. Shared recipe with the
	// fx-grid chokepoints (utils/selectedTrackInk).
	let trackAccent = $derived(selectedTrackInk());

	// Zone accent (§5.4): device color for device views, else focused-track ink,
	// else the neutral line. Drives the frame's colored border echoing the strip.
	// The deviceInk pass is defensive (ADR-400): the chokepoints already ship
	// calibrated schemes, but stray setView callers with raw literals get
	// normalized here too. deviceInk passes non-color strings through untouched.
	let zoneAccent = $derived(
		color?.primary
			? deviceInk(color.primary, paintModeReactive())
			: (trackAccent ?? 'var(--line-strong)')
	);

	// The swap pill every instrument view shares (ADR-439), and the clip view's
	// for an audio clip (ADR-440): a column down the left of the view, so the
	// views keep the whole band's height they were laid out for — unless the
	// view places it itself, lying flat over a group of its own controls
	// (`HostedSwapPill`, 2026-09-16), which claims the host and keeps the
	// column down.
	// Every slider in a central view is a value box: it sweeps over a fixed
	// finger travel at least, its label upright (ADR-477).
	provideValueBoxes();

	const swap = useInstrumentSwap(() => viewType === 'instrument');
	const clipSwap = useClipSwap(() => viewType === 'clip');
	let pill = $derived(swap.model ? swap : clipSwap.model ? clipSwap : null);
	const swapHost = provideSwapHost(() =>
		pill
			? {
					model: pill.model,
					act: (direction) => pill?.act(direction),
					// The name's door to the browser (ADR-442). Both hooks answer null
					// when there is no track (or clip) to open the browser onto, so
					// the name is only a button while there is a door behind it.
					open: pill.canOpen ? () => pill?.open() : null,
					// The pill names a preset or a clip: a label, in plain ink
					// (ADR-544).
					ink: null
				}
			: null
	);

	// The pill sits outside the view, so it takes the view's density from the
	// view's own root: under a compact view its inset, and the view's own inset
	// beside it, are the view's, and the content still sits one inset from the
	// frame on all four sides (ADR-434).
	let viewHost = $state<HTMLElement | null>(null);
	let viewDensity = $state<string | null>(null);
	$effect(() => {
		const host = viewHost;
		if (!host) return;
		const read = () => {
			viewDensity = host.querySelector<HTMLElement>('[data-density]')?.dataset.density ?? null;
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-density'] });
		return () => observer.disconnect();
	});

	// Full screen (ADR-511): the corner icon blows the view up over the whole
	// screen and brings it back. Only on a view with a board of its own for
	// the full screen (ADR-519); a jump to any other view while expanded
	// lands it back in the stack, since its corner would offer no way out.
	let expandable = $derived(hasFullScreenBoard(viewType, viewSubType));
	let expanded = $derived(centralDisplayStore.expanded);
	$effect(() => {
		if (expanded && !expandable) centralDisplayStore.setExpanded(false);
	});

	// Reactive effect to load the appropriate component when view type/subType changes
	// Note: Only depends on viewType and viewSubType, not the full view object
	$effect(() => {
		// Capture dependencies explicitly
		const type = viewType;
		const subType = viewSubType;
		const cacheKey = `${type}:${subType ?? ''}`;
		latestCacheKey = cacheKey;

		// If already cached, swap synchronously — no spinner, no remount flash
		const cached = componentCache.get(cacheKey);
		if (cached) {
			ViewComponent = cached;
			isLoadingComponent = false;
			loadError = null;
			return;
		}

		// Keep current ViewComponent visible while loading — no spinner flash
		loadError = null;

		logger.debug('Loading view:', { component: 'CentralDisplay', type, subType });

		// Resolve the component from the registry
		const componentLoader = resolveViewComponent(type, subType);

		if (!componentLoader) {
			// Should never happen due to fallback logic in resolveViewComponent
			loadError = new Error(`No component found for view type: ${type}`);
			isLoadingComponent = false;
			return;
		}

		// Only show spinner if there's nothing to display yet (very first load)
		if (!ViewComponent) {
			isLoadingComponent = true;
		}

		// Load the component asynchronously — swap in once ready.
		// Discard the result if a newer view was requested while this was in flight.
		componentLoader()
			.then((module) => {
				if (cacheKey !== latestCacheKey) return;
				logger.debug('Successfully loaded view', { component: 'CentralDisplay', type, subType });
				const loaded = module.default;
				componentCache.set(cacheKey, loaded);
				ViewComponent = loaded;
				isLoadingComponent = false;
			})
			.catch((error) => {
				if (cacheKey !== latestCacheKey) return;
				logger.error('Failed to load view component:', {
					component: 'CentralDisplay',
					type,
					subType,
					error: error?.message
				});
				if (shouldReloadForImportError(error)) {
					logger.warn('Reloading page once to recover from chunk-load failure', {
						component: 'CentralDisplay',
						type,
						subType
					});
					location.reload();
					return;
				}
				loadError = error;
				isLoadingComponent = false;
			});
	});
</script>

<!-- The zone accent rides `--zone-accent` (read by .central-frame) rather
     than an inline border, so the flat grammar can drop the coloured ring
     by plain specificity. -->
<div
	class="glass-panel central-frame h-full w-full rounded-lg overflow-hidden flex relative"
	style="
		background: var(--central-display-default-bg);
		--zone-accent: {zoneAccent};
	"
>
	<div class="cv-head" data-central-head>
		<span class="cv-track">{headTrack}</span>
		<span class="cv-device">{headDevice}</span>
	</div>
	<div class="cv-body" data-central-body>
	{#if pill?.model && !swapHost.claimed}
		<SwapControl
			scopeLabel={pill.model.scopeLabel}
			label={pill.model.label}
			detail={pill.model.detail}
			working={pill.model.working}
			disabled={pill.model.disabled}
			error={pill.model.error}
			ink={null}
			density={viewDensity}
			onPrev={() => pill?.act('prev')}
			onNext={() => pill?.act('next')}
			onOpen={pill.canOpen ? () => pill?.open() : null}
		/>
	{/if}
	<div class="flex-1 min-w-0" bind:this={viewHost}>
		{#if isLoadingComponent}
			<!-- Loading state -->
			<div class="h-full w-full flex items-center justify-center">
				<div class="flex flex-col items-center gap-3">
					<div class="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"></div>
					<p class="text-sm text-muted-foreground">Loading view...</p>
				</div>
			</div>
		{:else if loadError}
			<!-- Error state -->
			<div class="h-full w-full flex items-center justify-center">
				<div class="flex flex-col items-center gap-3 text-center px-4">
					<svg class="w-12 h-12 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
					<div>
						<p class="text-sm font-medium text-destructive mb-1">Failed to load view</p>
						<p class="text-xs text-muted-foreground">{loadError.message}</p>
					</div>
				</div>
			</div>
		{:else if ViewComponent}
			<ViewComponent {...viewProps} />
		{/if}
	</div>
	</div>

	{#if expandable}
		<!-- Full screen and back (ADR-511), in the frame's top-right corner,
		     over the view: absolute, so it costs no view any room. -->
		<button
			type="button"
			class="central-expand"
			aria-label={expanded ? 'Exit full screen' : 'Full screen'}
			aria-pressed={expanded}
			data-central-expand
			use:press={{ onPress: () => centralDisplayStore.toggleExpanded(), touchAction: 'none' }}
		>
			{#if expanded}
				<Minimize class="h-4 w-4" />
			{:else}
				<Maximize class="h-4 w-4" />
			{/if}
		</button>
	{/if}

</div>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && expanded) centralDisplayStore.setExpanded(false);
	}}
/>

<style>
	/* The full-screen switch (ADR-511): a 16px glyph at the title band's
	   right end, in the band's own text colour, in a 44px-wide touch box
	   the band's height. Over the view (z-index). */
	.central-expand {
		position: absolute;
		top: 0;
		right: 0;
		width: var(--height-touch, 44px);
		/* The touch floor's height: 4px past the band, into the view's
		   inset, where no control sits. The glyph is centred on the band. */
		height: var(--height-touch, 44px);
		padding: calc((var(--title-band-h, 40px) - 16px) / 2) 10px 0 0;
		display: inline-flex;
		align-items: flex-start;
		justify-content: flex-end;
		color: var(--sel-track-fg, var(--foreground));
		opacity: 1;
		border: none;
		background: transparent;
		cursor: pointer;
		z-index: 30;
	}


	/* The title band (ADR-544): whose view this is and what it is, in the
	   selected track's own name-block colour, so the band and the strip's
	   name read as one object. The body under it is the frame's row, as the
	   frame itself was before the band. */
	.central-frame {
		flex-direction: column;
	}
	.cv-head {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0;
		height: var(--title-band-h, 40px);
		background: var(--sel-track, var(--secondary));
		color: var(--sel-track-fg, var(--foreground));
		font-size: 19px;
		line-height: 1;
		white-space: nowrap;
	}
	.cv-track,
	.cv-device {
		padding: 0 0 0 12px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cv-track {
		flex: 0 1 auto;
		font-weight: 800;
	}
	.cv-device {
		flex: 0 1 auto;
		font-weight: 500;
	}
	.cv-body {
		display: flex;
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
	}

	/* Zone frame (§5.4): 2px ring in the zone accent — device colour, else
	   the focused track's ink — echoing the strip. Set here (over
	   .glass-panel's 1px hairline) from the inline `--zone-accent`. */
	.central-frame {
		border: 2px solid var(--zone-accent);
	}

	/* Flat grammar: the detail view is a flat DetailViewBackground panel in a
	   1px dark frame — the accent no longer rings the whole zone (Live keeps
	   colour in the title chip, not the frame). Outranks the .rounded-lg
	   utility and app.css's flat .glass-panel by specificity. */
	:global([data-grammar="flat"]) .central-frame {
		border: 1px solid transparent;
		border-radius: 2px;
	}
</style>
