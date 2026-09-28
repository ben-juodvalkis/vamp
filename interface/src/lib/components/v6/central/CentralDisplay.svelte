<script lang="ts">
import { logger } from '$lib/utils/logger';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
	import { resolveViewComponent } from './viewRegistry';
	import { shouldReloadForImportError } from '$lib/utils/chunkReload';
	import { deviceInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { selectedTrackInk } from '$lib/utils/selectedTrackInk';
	import SwapControl from './SwapControl.svelte';
	import { useInstrumentSwap } from './useInstrumentSwap.svelte';
	import { useClipSwap } from './useClipSwap.svelte';
	import { provideSwapHost } from './swapHost.svelte';
	import type { Component } from 'svelte';

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
					ink: trackAccent
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
	{#if pill?.model && !swapHost.claimed}
		<SwapControl
			scopeLabel={pill.model.scopeLabel}
			label={pill.model.label}
			detail={pill.model.detail}
			working={pill.model.working}
			disabled={pill.model.disabled}
			error={pill.model.error}
			ink={trackAccent}
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

<style>
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
		border: 1px solid var(--line-strong);
		border-radius: 2px;
	}
</style>
