<script lang="ts">
	/**
	 * ChanceCentralView — Note Chance's own view: one slider, the odds an
	 * incoming note survives, the `chance` control (`deviceControls`,
	 * ADR-479; it rests at 100, since a pulled-down chance means silence).
	 * It sat at the end of the Arpeggiator view until the chain overview
	 * (ADR-478) opened every device by its own type. A tap on a ghost loads
	 * it; so does a drag.
	 */
	import ControlTile from '../../device-panel/ControlTile.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const chance = useFxGridSlot('chance');
</script>

<div class="h-full w-full flex p-(--central-inset) gap-(--central-gap)">
	<div class="flex-1">
		<ControlTile type="chance" device={chance.device} icon="chance" disableCentralViewOnTap tapLoads />
	</div>
</div>
