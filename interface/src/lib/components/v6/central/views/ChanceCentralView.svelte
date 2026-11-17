<script lang="ts">
	/**
	 * ChanceCentralView — Note Chance's own view: one amount, the odds an
	 * incoming note survives, the `chance` control (`deviceControls`,
	 * ADR-479; it rests at 100, since a pulled-down chance means silence).
	 * It sat at the end of the Arpeggiator view until the chain overview
	 * (ADR-478) opened every device by its own type. A tap on a ghost loads
	 * it; so does a drag.
	 *
	 *   [Chance] | two bars of notes, the ones that pass standing
	 *
	 * On the face grid (ADR-510), sections [1, 4], no header line: the box
	 * names itself and the title band names the device. The box is one
	 * column, as the Random view's Chance (ADR-544 rollout: one box across
	 * the whole band until then, wider than tall, so its name sat in the
	 * middle of its own fill). Beside it, what the amount does, drawn and not
	 * touched: two bars of sixteenths, as many of them standing as the odds
	 * let through and the rest fallen to a stub. Which ones stand is fixed
	 * (`ORDER`), so raising the odds only ever adds notes and the picture
	 * holds still between frames. A picture, not a measurement: the device
	 * rolls for every note.
	 */
	import ControlTile from '../../device-panel/ControlTile.svelte';
	import { controlFor, resolveParam } from '../../device-panel/deviceControls';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';

	const chance = useFxGridSlot('chance');

	// The odds as the box beside it reads them: the `chance` control's own
	// read, off the device, or off what was written to it while it loads.
	const control = controlFor('chance');
	const level = $derived.by(() => {
		if (control?.kind !== 'slider') return 1;
		const live = chance.device;
		const names = live ? selectedTrackStore.paramNamesForDevice(live) : [];
		return control.read((ref) => {
			const index = resolveParam(ref, names);
			return live ? chance.paramValue(index) : chance.slot.pendingParams?.get(index);
		});
	});

	const NOTES = 32;
	/**
	 * Each note's place in the order they fall: note `i` stands while
	 * `ORDER[i]` is under the count that pass. Ranked by the golden ratio's
	 * multiples, so at any odds the notes left standing are spread across
	 * the two bars and never in a regular pattern (a hash's order left
	 * whole beats empty beside whole beats full).
	 */
	const ORDER = (() => {
		const key = (i: number) => (i * 0.6180339887 + 0.37) % 1;
		const byKey = Array.from({ length: NOTES }, (_, i) => i).sort((a, b) => key(a) - key(b));
		const order = new Array<number>(NOTES);
		byKey.forEach((note, rank) => (order[note] = rank));
		return order;
	})();
	const passing = $derived(Math.round(Math.max(0, Math.min(1, level)) * NOTES));
</script>

<div class="h-full w-full" data-view="chance">
	<FaceGrid sections={[1, 4]} heads={false}>
		<FaceSection span={1}>
			<div class="box">
				<ControlTile type="chance" device={chance.device} icon="chance" disableCentralViewOnTap tapLoads />
			</div>
		</FaceSection>
		<FaceSeam />

		<FaceSection span={4}>
			<div class="lane face-span-all" class:slot-ghost={chance.isGhost} aria-hidden="true" data-passing={passing}>
				{#each ORDER as rank, i (i)}
					<span class="note" class:beat={i % 4 === 0} class:fallen={rank >= passing}></span>
				{/each}
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	.box {
		display: flex;
		min-width: 0;
		min-height: 0;
	}

	/* Two bars of sixteenths across the section, a note a slot: a beat's
	   note the lane's height, the others three quarters of it, standing on
	   one baseline. A fallen note keeps its place as a stub. */
	.lane {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		min-width: 0;
		min-height: 0;
		pointer-events: none;
	}
	.note {
		flex: 0 0 auto;
		width: 10px;
		height: 74%;
		background: var(--amount);
		border-radius: 1px;
	}
	.note.beat {
		height: 100%;
	}
	.note.fallen {
		height: 6px;
		background: var(--line-strong);
	}
</style>
