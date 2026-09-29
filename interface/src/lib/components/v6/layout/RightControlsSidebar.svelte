<script lang="ts">
	/**
	 * RightControlsSidebar - Individual clip control sections
	 *
	 * Renders either:
	 * - Quantize/Groove control (section="quantize")
	 * - Clip Loop control (section="loop")
	 *
	 * Adapted for vertical 120px-wide layout
	 * Each section aligns with a main content row
	 */
	import { clipDisplayCoordinator } from '$lib/services/clipDisplayCoordinator.svelte';
	import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
	import { focusPlayingClipOnSelectedTrack } from '$lib/components/v6/tracks/composables/slotActions';
	import { press } from '$lib/actions/press';

	// Vertical control components
	import VerticalQuantizeControl from '$lib/components/v6/clips/VerticalQuantizeControl.svelte';
	import VerticalLoopControl from '$lib/components/v6/clips/VerticalLoopControl.svelte';

	interface Props {
		section: 'quantize' | 'loop';
	}

	let { section }: Props = $props();

	/**
	 * A tap anywhere in the rail shows the current clip in the central view.
	 *
	 * The press abandons past its slop (ADR-427), which is what finally
	 * makes the old comment here true: it claimed the region "only
	 * triggers if clicking directly on the sidebar container, not on child
	 * controls", but a `click` bubbles, so dragging a loop brace or a
	 * quantize handle inside this box switched the central view on release
	 * as well. A drag is not a tap, and now it cannot be read as one.
	 */
	function showClip() {
		// With nothing focused this used to open an EMPTY clip view, and
		// the loop brace above it stayed the inert 30%-opacity well it
		// draws with no clip — the tap its own aria-label advertises as
		// "tap to show clip" showed none. It now aims at the clip running
		// on the selected track first, which focuses it; the brace comes
		// alive when the property echo lands, and the next drag moves a
		// real loop. (`focusPlayingClipOnSelectedTrack` shows the clip
		// itself on that path; with a clip already focused it is a no-op
		// and the call below is the whole behavior, unchanged.)
		// The quantize row shows the Groove view, as a touch on Q does.
		if (section === 'quantize') {
			focusPlayingClipOnSelectedTrack({ showClip: false });
			centralDisplayStore.setView('groove');
			return;
		}
		focusPlayingClipOnSelectedTrack();
		clipDisplayCoordinator.showCurrentClip();
	}
</script>

<div
	class="h-full w-full"
	use:press={{ onPress: showClip, touchAction: 'none' }}
	role="region"
	aria-label="{section === 'quantize' ? 'Quantize' : 'Loop'} control"
>
	{#if section === 'quantize'}
		<VerticalQuantizeControl />
	{:else}
		<VerticalLoopControl />
	{/if}
</div>
