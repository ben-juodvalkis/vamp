<script lang="ts">
	/**
	 * ChanceCentralView — Note Chance's own view: one slider, the odds an
	 * incoming note survives. It sat at the end of the Arpeggiator view
	 * until the chain overview (ADR-478) opened every device by its own type.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const chance = useFxGridSlot('chance');

	// Note Chance — a Max MIDI effect with exactly one parameter, so the
	// LOM order is forced: [0] Device On, [1] Chance. 0-100 %, 101 steps
	// (the dial's own `parameter_steps`), polyphonic — at 60 % roughly
	// six notes of every ten get through, chords included.
	const CHANCE_PARAM = 1;
	const CHANCE_MAX = 100;

	// The rest value is 100, not 0: silence is what a *pulled-down* chance
	// means, so a ghost slider sitting at zero would read as "this device
	// mutes the track". The library copy of the .amxd defaults to 100 as
	// well, so the ghost and the freshly-loaded device agree.
	let chanceValue = $derived(chance.paramValue(CHANCE_PARAM) ?? CHANCE_MAX);
	let chanceDisplay = $derived(chance.paramDisplay(CHANCE_PARAM));
	let chanceTitle = $derived(chanceDisplay ? `Chance · ${chanceDisplay}` : 'Chance');
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="h-full w-full flex p-(--central-inset) gap-(--central-gap)">
	<!-- Note Chance: the odds an incoming note survives. A drag loads the
	     device if the slot is a ghost; so does a tap, which has no value of
	     its own to send (DeviceSlider drags are relative). -->
	<div class="flex-1" class:slot-ghost={chance.isGhost}>
		<DeviceSlider
			value={chanceValue / CHANCE_MAX}
			title={chanceTitle}
			icon="chance"
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			isGhost={chance.isGhost}
			color={chance.color}
			onTap={() => chance.loadIfGhost()}
			onInteraction={(value) => {
				chance.sendParam(CHANCE_PARAM, Math.round(value * CHANCE_MAX));
			}}
		/>
	</div>
</div>
