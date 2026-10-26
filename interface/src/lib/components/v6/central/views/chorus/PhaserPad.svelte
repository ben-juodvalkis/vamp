<script lang="ts">
	/**
	 * PhaserPad — the Phaser-Flanger's XY (X: LFO speed, Y: feedback), the
	 * `phaser` control (`deviceControls`). Drawn by the Chorus view, or by
	 * the Auto Pan view's Chorus group on a drum track (2026-10-23).
	 *
	 * 2026-10-26: Live reports LFO 1 Freq on a 0..1 rail (0.01 Hz · 4000^v,
	 * measured); this pad read it as hertz and wrote hertz back, so the right
	 * half of its sweep all clamped to 40 Hz. A first drag loads it, as every
	 * tile does; a tap on a ghost loads it too, as it did.
	 */
	import ControlTile from '$lib/components/v6/device-panel/ControlTile.svelte';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

	const phaser = useFxGridSlot('phaser');
</script>

<ControlTile type="phaser" device={phaser.device} icon="phaser" disableCentralViewOnTap tapLoads />
