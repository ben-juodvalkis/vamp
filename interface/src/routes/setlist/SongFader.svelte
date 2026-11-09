<script lang="ts">
	import {
		MACRO_MAX,
		holdControl,
		moveControl,
		releaseControl,
		setlist
	} from '$lib/services/setlist.svelte';

	let { label, idle = false }: { label: string; idle?: boolean } = $props();

	const key = $derived(setlist.outputKey);
	const fraction = $derived(key ? (setlist.values[key] ?? 0) / MACRO_MAX : 0);

	let pointerId: number | null = null;
	let heldKey = '';
	let startX = 0;
	let startValue = 0;

	function down(event: PointerEvent) {
		if (!key || pointerId !== null) return;
		pointerId = event.pointerId;
		heldKey = key;
		startX = event.clientX;
		startValue = setlist.values[key] ?? 0;
		(event.currentTarget as HTMLElement).setPointerCapture(pointerId);
		holdControl(key);
	}

	function move(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		const width = (event.currentTarget as HTMLElement).clientWidth;
		moveControl(heldKey, startValue + ((event.clientX - startX) / width) * MACRO_MAX);
	}

	function up(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		pointerId = null;
		releaseControl(heldKey);
	}
</script>

<div
	class="fader"
	class:idle
	role="slider"
	aria-label="Output"
	aria-valuemin="0"
	aria-valuemax={MACRO_MAX}
	aria-valuenow={Math.round(fraction * MACRO_MAX)}
	tabindex="-1"
	data-testid="song"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
>
	{#if key}
		<div class="bar" style:width="{fraction * 100}%"></div>
		<div class="thumb" style:left="{fraction * 100}%"></div>
	{/if}
	<span class="name">{label}</span>
</div>

<style>
	.fader {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		background: #3f3b00;
		border: 1px solid #ffed00;
		border-radius: 10px;
		touch-action: none;
	}
	.bar {
		position: absolute;
		inset: 0 auto 0 0;
		background: #807700;
	}
	.thumb {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2.4%;
		transform: translateX(-50%);
		background: #ffed00;
		border-radius: 8px;
	}
	.name {
		position: relative;
		color: #ff281c;
		font-size: 6.4vh;
		white-space: nowrap;
		pointer-events: none;
	}
	.idle .name {
		opacity: 0.55;
	}
</style>
