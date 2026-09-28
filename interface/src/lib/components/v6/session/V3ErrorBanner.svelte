<script lang="ts">
	/**
	 * V3 Error Banner (PR-5e2)
	 *
	 * Fixed-position toast that surfaces transient v3 errors (today:
	 * pool-exhausted from GroovePoolComponent). Subscribes to
	 * `v3ErrorBannerStore`; auto-dismissed by the store after 6s.
	 */
	import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
	import { press } from '$lib/actions/press';

	let banner = $derived(v3ErrorBannerStore.banner);

	function messageFor(code: string, detail: string): string {
		if (code === 'pool-exhausted') {
			return detail || 'Groove pool full — free a slot to assign more grooves.';
		}
		if (code === 'preset-load-failed') {
			// The browser closes optimistically, so this banner is the ONLY
			// report a failed load gets — the browser is already gone by the
			// time we know. Detail carries the nack code or the prepare
			// timeout verbatim; it's diagnostic on purpose.
			return detail
				? `Preset didn't load — ${detail}`
				: "Preset didn't load.";
		}
		return detail || code;
	}
</script>

{#if banner}
	<div
		class="v3-banner fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md px-4 py-3 flex items-center gap-3"
		role="alert"
	>
		<span class="text-xl" style="color: var(--act-warn);">!</span>
		<div class="flex-1">
			<div class="v3-banner-code font-bold text-sm uppercase tracking-wide" style="color: var(--act-warn);">
				{banner.code.replace(/-/g, ' ')}
			</div>
			<div class="text-sm">
				{messageFor(banner.code, banner.detail)}
			</div>
			{#if banner.path}
				<div class="v3-banner-path text-xs opacity-60 mt-1 num">{banner.path}</div>
			{/if}
		</div>
		<button
			use:press={{ onPress: () => v3ErrorBannerStore.clear(), touchAction: 'none' }}
			class="px-2 py-1"
			style="color: var(--fg-tertiary);"
			aria-label="Dismiss"
		>
			×
		</button>
	</div>
{/if}

<style>
	/* GRATICULE toast: popover slab in the alert-ink frame with the system's
	   one ambient drop shadow (§2.9). Authored here rather than inline so
	   the flat grammar can re-shape it by plain specificity. */
	.v3-banner {
		border-radius: var(--radius-md);
		background: var(--popover);
		border: 1px solid var(--act-warn-line);
		color: var(--foreground);
		box-shadow: 0 24px 48px oklch(0 0 0 / 0.5), 0 0 0 1px var(--line-strong);
	}

	/* Flat grammar (ui-architecture §8.1): the toast is a
	   DetailViewBackground panel — 2px corners, no drop shadow, the
	   alert-ink frame kept as the state read; the code line is normal case
	   at medium weight and the path is tertiary text rather than an opacity
	   dim. Nothing here matches without data-grammar="flat", so GRATICULE
	   is untouched. */
	:global([data-grammar="flat"]) .v3-banner {
		border-radius: 2px;
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .v3-banner-code {
		text-transform: none;
		letter-spacing: 0;
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .v3-banner-path {
		opacity: 1;
		color: var(--fg-tertiary);
	}
</style>
