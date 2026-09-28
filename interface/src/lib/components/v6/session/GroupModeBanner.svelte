<script lang="ts">
	/**
	 * Group mode banner (2026-09-20).
	 *
	 * The held-modifier gesture (`groupGestureStore`) changes what every
	 * track tap means across the whole app — a strip, the session grid, even
	 * the master track go quiet and stop selecting or switching views (see
	 * `interceptForGroupGesture`). A mode with that much reach needs
	 * something on screen saying so, or a tap that visibly does nothing
	 * reads as the app being broken rather than as the gesture working.
	 *
	 * Fixed-position, same recipe as `V3ErrorBanner`, but persistent for as
	 * long as the gesture is open rather than a timed toast — it IS the
	 * mode indicator, not a notification about one. `--phosphor` is the flat
	 * grammar's own "on" ink, the same one `TrackStrip`'s tapped-track ring
	 * uses, so the banner and the rings it's naming read as one system.
	 *
	 * Also the answer to "how do you cancel a latched gesture" — there is
	 * no drag-off once the finger has already left the button, so this is
	 * the only way out once latched.
	 */
	import { groupGestureStore } from '$lib/stores/v6/groupGestureStore.svelte';
	import { press } from '$lib/actions/press';

	let count = $derived(groupGestureStore.memberPaths.size);
	let guidance = $derived(
		groupGestureStore.latched
			? 'Tap tracks to add — tap Group again to finish'
			: 'Tap other tracks — release Group to finish'
	);
</script>

{#if groupGestureStore.active}
	<div class="group-mode-banner fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3" role="status">
		<span class="group-mode-count font-bold text-lg num">{count}</span>
		<div class="flex-1">
			<div class="group-mode-title font-bold text-sm uppercase tracking-wide">Group Mode</div>
			<div class="text-sm">{guidance}</div>
		</div>
		<button
			use:press={{ onPress: () => groupGestureStore.cancel(), touchAction: 'none' }}
			class="group-mode-cancel px-2 py-1 font-bold text-sm"
			aria-label="Cancel grouping"
		>
			Cancel
		</button>
	</div>
{/if}

<style>
	/* GRATICULE: same slab-and-shadow recipe as V3ErrorBanner, in phosphor
	   rather than the alert ink — this names a mode, not a problem. */
	.group-mode-banner {
		border-radius: var(--radius-md);
		background: var(--popover);
		border: 1px solid var(--phosphor);
		color: var(--foreground);
		box-shadow: 0 24px 48px oklch(0 0 0 / 0.5), 0 0 0 1px var(--phosphor);
	}
	.group-mode-count {
		color: var(--phosphor);
		min-width: 1.5em;
		text-align: center;
	}
	.group-mode-title {
		color: var(--phosphor);
	}
	.group-mode-cancel {
		color: var(--fg-tertiary);
	}
	.group-mode-cancel:active {
		color: var(--foreground);
	}

	/* Flat grammar (ui-architecture §8.1): a DetailViewBackground panel —
	   2px corners, no drop shadow, the phosphor frame kept as the state
	   read, title at normal case/medium weight rather than tracked caps. */
	:global([data-grammar="flat"]) .group-mode-banner {
		border-radius: 2px;
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .group-mode-title {
		text-transform: none;
		letter-spacing: 0;
		font-weight: var(--font-weight-medium);
	}
</style>
