<script lang="ts">
	/**
	 * The MidiWheels tile's face (user, 2026-10-26: "Midiwheels should actually
	 * have the two interactive wheels even in the browser"): Pitch beside Mod,
	 * live. They send to the selected MIDI track as every wheel does
	 * (`api/midiWheels`), and the surface loads the device there on the first
	 * touch, so playing them from the browser is how the device is added; the
	 * tile's name still loads it as saved. The finger's release is `onRelease`:
	 * the browser closes then unless locked, as after any load (user,
	 * 2026-11-16).
	 */
	import MidiWheelsPanel from '$lib/components/v6/midi/MidiWheelsPanel.svelte';

	let { onRelease }: { onRelease?: () => void } = $props();

	// Dimmed at rest, full while a finger is on it, as every live tile is
	// (BrowserPresetFace, user 2026-11-06).
	let touched = $state(false);
	function release() {
		if (!touched) return;
		touched = false;
		onRelease?.();
	}
</script>

<svelte:window onpointerup={release} onpointercancel={release} />

<!-- The tile's own click is a load: a press on the wheels is theirs alone. -->
<div
	class="preset-face wheels-face"
	class:touched
	role="presentation"
	onpointerdowncapture={() => (touched = true)}
	onclick={(e) => e.stopPropagation()}
>
	<MidiWheelsPanel sideBySide />
</div>

<style>
	.wheels-face {
		position: relative;
		display: flex;
		padding: 4px 4px 0;
		--central-gap: 4px;
		opacity: 0.22;
		transition: opacity 120ms ease-out;
	}
	.wheels-face.touched {
		opacity: 1;
		transition: none;
	}
	.wheels-face > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}
</style>
