<script lang="ts">
	/**
	 * Audio Effect Rack Central View: the rack's variations down the left
	 * (ADR-531) and its macros as Live's macro panel lays them out, two rows
	 * numbered row by row (ADR-532).
	 */
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { familyScheme, type DeviceColorScheme } from '$lib/config/devicePresets';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import DeviceEmptyState from '../DeviceEmptyState.svelte';
	import RackVariations from '../RackVariations.svelte';
	import RackMacroPanel from '../RackMacroPanel.svelte';

	interface Props {
		color?: DeviceColorScheme;
	}

	let { color }: Props = $props();

	// The rack the chain overview picked (path-keyed, off the v3 tree).
	const audioEffectRack = $derived(selectedTrackStore.audioEffectRackByPath);

	// Rack theme (rackVoice rose, ADR-400), calibrated through trackInk (§5.5).
	const defaultColor: DeviceColorScheme = familyScheme('rackVoice');
	let rawColor = $derived(color || defaultColor);
	let effectiveColor = $derived({
		primary: trackInk(rawColor.primary, paintModeReactive()),
		secondary: rawColor.secondary,
		accent: trackInk(rawColor.accent, paintModeReactive())
	});
</script>

{#if audioEffectRack}
	<div class="audio-effect-rack-view" data-density="compact">
		<!-- Which rack: a track can carry several, and the chain overview picks one. -->
		<div class="rack-name">{audioEffectRack.name}</div>
		<div class="rack-body">
			<RackVariations rack={audioEffectRack} ink={effectiveColor.primary} />
			<RackMacroPanel rack={audioEffectRack} colorAt={() => effectiveColor} />
		</div>
	</div>
{:else}
	<DeviceEmptyState glyph="◌" message="No Audio Effect Rack detected" color={effectiveColor.primary} />
{/if}

<style>
	.rack-name {
		text-align: center;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}

	.audio-effect-rack-view {
		padding: var(--central-inset);
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
	}

	.rack-body {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		gap: var(--central-gap);
	}
</style>
