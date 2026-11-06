<script lang="ts">
	/**
	 * RightControlsSidebar - the clip controls, a row each
	 *
	 * - section="loop": the clip loop brace, level with the FX chain (the
	 *   track's Utility had that row until 2026-11-05, the user's call;
	 *   the Utility is the chain's own now, its ghost always offered).
	 * - section="quantize": Quantize/Groove, level with the central view.
	 *   The two shared that row, half each, from 2026-10-26 until the same
	 *   day.
	 */
	import { clipDisplayCoordinator } from '$lib/services/clipDisplayCoordinator.svelte';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
	import { focusPlayingClipOnSelectedTrack } from '$lib/components/v6/tracks/composables/slotActions';
	import { press } from '$lib/actions/press';

	// Vertical control components
	import VerticalQuantizeControl from '$lib/components/v6/clips/VerticalQuantizeControl.svelte';
	import VerticalLoopControl from '$lib/components/v6/clips/VerticalLoopControl.svelte';

	interface Props {
		section: 'loop' | 'quantize';
	}

	let { section }: Props = $props();

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

{#if section === 'loop'}
	<div class="h-full w-full" use:press={{ onPress: showClip, touchAction: 'none' }} role="region" aria-label="Loop control">
		<VerticalLoopControl />
	</div>
{:else}
	<div class="h-full w-full" use:press={{ onPress: showGroove, touchAction: 'none' }} role="region" aria-label="Quantize control">
		<VerticalQuantizeControl />
	</div>
{/if}
