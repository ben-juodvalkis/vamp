<script lang="ts">
	import FXGrid from '$lib/components/v6/device-panel/FXGrid.svelte';
</script>

<!-- The FX grid's own slot cards carry the structure, so the panel's outer
     frame + fill are redundant — hide both (transparent border keeps the 1px
     box so there's no layout shift; transparent background/backdrop drops the
     grey wash behind the grid). Inline overrides so the shared
     .glass-panel-subtle class stays intact elsewhere. -->
<div
	class="glass-panel-subtle h-full flex flex-col"
	style="border-color: transparent; background: transparent; backdrop-filter: none;"
>
	<FXGrid />
</div>
