<script lang="ts">
	import ChainOverview from '$lib/components/v6/device-panel/ChainOverview.svelte';
	import { usePadHand } from '$lib/components/v6/device-panel/usePadHand.svelte';

	// The blue hand follows the Drum Rack view's pad scope.
	usePadHand();
</script>

<!-- The FX section: the selected track's chain, in order (ChainOverview).
     The FX grid and the switch between the two went with ADR-485. The
     chain's cells carry the structure, so the panel's outer frame + fill
     are hidden (a transparent border keeps the 1px box; inline overrides
     so the shared .glass-panel-subtle class stays intact elsewhere). -->
<div
	class="glass-panel-subtle h-full flex flex-col relative"
	style="border-color: transparent; background: transparent; backdrop-filter: none;"
>
	<ChainOverview />
</div>
