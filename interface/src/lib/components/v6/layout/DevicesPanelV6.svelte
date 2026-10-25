<script lang="ts">
	import FXGrid from '$lib/components/v6/device-panel/FXGrid.svelte';
	import ChainOverview from '$lib/components/v6/device-panel/ChainOverview.svelte';
	import FxPanelSwitch from '$lib/components/v6/device-panel/FxPanelSwitch.svelte';
	import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
</script>

<!-- The FX grid's own slot cards carry the structure, so the panel's outer
     frame + fill are redundant — hide both (transparent border keeps the 1px
     box so there's no layout shift; transparent background/backdrop drops the
     grey wash behind the grid). Inline overrides so the shared
     .glass-panel-subtle class stays intact elsewhere.

     Two faces behind one tiny switch: the grid, or the selected track's
     chain in order (ChainOverview). The switch is out of flow in the
     corner, so neither face gives up a cell for it. -->
<div
	class="glass-panel-subtle h-full flex flex-col relative"
	style="border-color: transparent; background: transparent; backdrop-filter: none; --fx-switch-w: 76px;"
>
	{#if fxChainStore.mode === 'chain'}
		<ChainOverview />
	{:else}
		<FXGrid />
	{/if}
	<FxPanelSwitch />
</div>
