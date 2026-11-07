<script lang="ts">
	// Import central display component
	import CentralDisplay from '$lib/components/v6/central/CentralDisplay.svelte';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';

	let expanded = $derived(centralDisplayStore.expanded);
</script>

<!-- Central Display takes full width and height. Expanded (ADR-511) the
     same element is lifted out over the whole screen, so the view is not
     remounted and keeps its page, half and picker; its row keeps its share
     of the stack, so nothing behind it reflows. -->
<div
	class="central-host h-full w-full"
	class:central-expanded={expanded}
	style="touch-action: none;"
	data-debug="central-host"
	data-expanded={expanded ? '' : undefined}
>
	<CentralDisplay />
</div>

<style>
	/* The whole screen inside the page's margins: the status strip's band
	   above (edge-top), the root's 16px sides and its bottom edge. Over the
	   stack, the sidebars and the transport header; under the connection
	   and error banners (z-50), the browser opened from the view (1000) and
	   the Settings page (1002). */
	.central-expanded {
		position: fixed;
		top: var(--edge-top);
		left: 16px;
		right: 16px;
		bottom: var(--edge-bottom);
		width: auto;
		height: auto;
		z-index: 40;
	}
</style>
