<script lang="ts">
	/**
	 * RightControlsSidebar - the clip controls and the track's Utility
	 *
	 * Renders either:
	 * - The clip row (section="clip"): the clip loop brace over
	 *   Quantize/Groove, each half the row (the user, 2026-10-26), in the
	 *   order they stood in the flipped layout. They had a row
	 *   each until the Utility took the brace's.
	 * - The track's Utility (section="utility"): the FX grid's Gain tile,
	 *   a ghost until the track has one, whose first drag loads it. It was
	 *   a column at the end of the FX chain overview (ADR-482) until the
	 *   same day.
	 *
	 * Adapted for vertical 120px-wide layout
	 * Each section aligns with a main content row
	 */
	import { clipDisplayCoordinator } from '$lib/services/clipDisplayCoordinator.svelte';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
	import { focusPlayingClipOnSelectedTrack } from '$lib/components/v6/tracks/composables/slotActions';
	import { press } from '$lib/actions/press';
	import { getSlotByDeviceType } from '$lib/config/fxGridLayout';

	// Vertical control components
	import VerticalQuantizeControl from '$lib/components/v6/clips/VerticalQuantizeControl.svelte';
	import VerticalLoopControl from '$lib/components/v6/clips/VerticalLoopControl.svelte';

	interface Props {
		section: 'clip' | 'utility';
	}

	let { section }: Props = $props();

	const utility = getSlotByDeviceType('utility');

	/**
	 * A tap anywhere in a clip control shows its view: the Groove view for
	 * Q, the current clip for the brace.
	 *
	 * The press abandons past its slop (ADR-427), so dragging a loop brace
	 * or a quantize handle inside this box does not also switch the central
	 * view on release: a drag is not a tap.
	 */
	function showGroove() {
		focusPlayingClipOnSelectedTrack({ showClip: false });
		centralDisplayStore.setView('groove');
	}

	function showClip() {
		// With nothing focused this used to open an EMPTY clip view, and
		// the loop brace stayed the inert 30%-opacity well it draws with no
		// clip. It aims at the clip running on the selected track first,
		// which focuses it; the brace comes alive when the property echo
		// lands, and the next drag moves a real loop. With a clip already
		// focused that is a no-op and the call below is the whole behavior.
		focusPlayingClipOnSelectedTrack();
		clipDisplayCoordinator.showCurrentClip();
	}
</script>

{#if section === 'clip'}
	<div class="clip-pair h-full w-full">
		<div class="half" use:press={{ onPress: showClip, touchAction: 'none' }} role="region" aria-label="Loop control">
			<VerticalLoopControl />
		</div>
		<div class="half" use:press={{ onPress: showGroove, touchAction: 'none' }} role="region" aria-label="Quantize control">
			<VerticalQuantizeControl />
		</div>
	</div>
{:else if utility}
	<div class="h-full w-full flex" role="region" aria-label="Utility" data-debug="sidebar-utility">
		<utility.component position={utility.position} />
	</div>
{/if}

<style>
	/* The brace over Q, each half the row, the stack's own gap between. */
	.clip-pair {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm, 8px);
	}
	.half {
		flex: 1 1 0;
		min-height: 0;
	}
</style>
