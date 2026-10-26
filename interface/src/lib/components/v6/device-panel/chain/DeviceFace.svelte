<script lang="ts">
	/**
	 * A chain cell's control for a device the FX grid has no tile for
	 * (2026-10-26): the face its browser preset tiles draw (`presetFaces`),
	 * here at the values Live reports for this device and writing to it, so
	 * the chain and the browser show one control (Pedal's Drive slider).
	 */
	import FaceControl from '$lib/components/v6/browser/FaceControl.svelte';
	import type { Face, LomValues } from '$lib/components/v6/browser/presetFaces';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
	import { sendParam } from '$lib/services/deviceParams';
	import { schemeFromInk } from '$lib/config/devicePresets';

	interface Props {
		device: DeviceRecord;
		face: Face;
		/** The cell's ink, a concrete color. */
		ink: string;
	}

	let { device, face, ink }: Props = $props();

	// A face reads parameters by LOM index; each read is this device's live value.
	const values = $derived(
		new Proxy({} as LomValues, {
			get: (_, key) =>
				typeof key === 'string' ? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, Number(key))) ?? 0) : undefined
		})
	);

	function move(writes: LomValues) {
		for (const [index, value] of Object.entries(writes)) void sendParam({ device }, Number(index), value);
	}
</script>

<FaceControl {face} {values} color={schemeFromInk(ink)} onMove={move} title={face.kind === 'slider' ? (face.title ?? '') : ''} />
