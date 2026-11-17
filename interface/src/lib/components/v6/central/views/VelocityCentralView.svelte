<script lang="ts">
	/**
	 * VelocityCentralView — the Velocity MIDI effect's own view: the Random
	 * amount (Rand Vel) and the Out Low / Out Hi range brace. Until the chain
	 * overview (ADR-478) opened every device by its own type, both sat in the
	 * Arpeggiator view past a seam.
	 *
	 *   Random [Rand Vel] | Notes: a bar of velocities | Out [Low..Hi brace]
	 *
	 * On the face grid (ADR-510), sections [1, 3, 1], in the device's order
	 * (ADR-544 rollout; two half-width boxes until then, each wider than it
	 * is tall, so Rand Vel's name sat in the middle of its own fill). Rand
	 * Vel is the amount ridden: a box one column wide, its mark over its
	 * name at its head. The brace is one column at the far end. Between
	 * them, what the two do, drawn and not touched: a bar of sixteenths on
	 * the brace's own scale, so the notes stand between its two handles,
	 * their tops more uneven the more Random there is. A picture, not a
	 * measurement: the pattern is fixed and the device rolls for every note.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import ControlTile from '../../device-panel/ControlTile.svelte';
	import VelocityRangeBrace from '../../controls/VelocityRangeBrace.svelte';
	import { controlFor, resolveParam } from '../../device-panel/deviceControls';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import FaceGrid from '../FaceGrid.svelte';
	import FaceSection from '../FaceSection.svelte';
	import FaceSeam from '../FaceSeam.svelte';
	import PanelEyebrow from './panel/PanelEyebrow.svelte';

	const velocity = useFxGridSlot('velocity');
	// One ink (ADR-544): the selected track's, as the slot's scheme hands it over.
	let ink = $derived(velocity.color);

	// Random as the box reads it (the `velocity` control's own read, off the
	// device or off what was written while it loads), and the brace's two
	// ends as the brace reads them: Out Hi 6, Out Low 7, each 1..127.
	const control = controlFor('velocity');
	const random = $derived.by(() => {
		if (control?.kind !== 'slider') return 0;
		const live = velocity.device;
		const names = live ? selectedTrackStore.paramNamesForDevice(live) : [];
		return control.read((ref) => {
			const index = resolveParam(ref, names);
			return live ? velocity.paramValue(index) : velocity.slot.pendingParams?.get(index);
		});
	});
	const low = $derived(((velocity.paramValue(7) ?? 1) - 1) / 126);
	const high = $derived(((velocity.paramValue(6) ?? 127) - 1) / 126);

	const NOTES = 16;
	/** What is played into it: a beat's note hard, the offbeat softer, the sixteenths between softer still. */
	const PLAYED = [1, 0.5, 0.72, 0.5];
	/** A fixed -1..1 per note (the golden ratio's multiples), so the picture holds still between frames. */
	const roll = (i: number) => (((i + 1) * 0.6180339887) % 1) * 2 - 1;
	/** Live's Random reaches 64 of the 127 velocities. */
	const RANDOM_REACH = 64 / 126;
	const heights = $derived(
		Array.from({ length: NOTES }, (_, i) => {
			const out = low + PLAYED[i % 4] * (high - low);
			// Kept inside the brace's two ends, so the picture and the brace agree.
			return Math.max(low, 0.02, Math.min(high, out + roll(i) * random * RANDOM_REACH));
		})
	);
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="h-full w-full" data-view="velocity">
	<FaceGrid sections={[1, 3, 1]}>
		<!-- Rand Vel, the `velocity` control (deviceControls, ADR-479): Live's
		     Random is 0..64 (measured 2026-10-26); this slider scaled it to 127,
		     so its top half clamped. -->
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Random" color={ink.primary} />{/snippet}
			<div class="flex min-h-0 min-w-0">
				<ControlTile type="velocity" device={velocity.device} icon="randvel" disableCentralViewOnTap />
			</div>
		</FaceSection>
		<FaceSeam ink={ink.primary} />

		<FaceSection span={3}>
			{#snippet head()}<PanelEyebrow title="Notes" color={ink.primary} />{/snippet}
			<div class="lane face-span-all" class:slot-ghost={velocity.isGhost} aria-hidden="true">
				{#each heights as h, i (i)}
					<span class="note" style="height: {(h * 100).toFixed(1)}%;"></span>
				{/each}
			</div>
		</FaceSection>
		<FaceSeam ink={ink.primary} />

		<!-- Velocity Range Brace (Out Low / Out Hi) -->
		<FaceSection span={1}>
			{#snippet head()}<PanelEyebrow title="Out" color={ink.primary} />{/snippet}
			<div class="flex min-h-0 min-w-0">
				<VelocityRangeBrace
					device={velocity.device}
					isGhost={velocity.isGhost}
					color={velocity.color}
					onInteraction={() => velocity.loadIfGhost()}
				/>
			</div>
		</FaceSection>
	</FaceGrid>
</div>

<style>
	/* A bar of sixteenths on the brace's scale: the lane is as tall as the
	   brace's, a note's height its velocity, all on one baseline. */
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
		background: var(--amount);
		border-radius: 1px;
	}
</style>
