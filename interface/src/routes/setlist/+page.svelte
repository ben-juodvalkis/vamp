<script lang="ts">
	import { onMount } from 'svelte';
	import { setlist, selectSound, startSetlist, tapArrow } from '$lib/services/setlist.svelte';
	import SongFader from './SongFader.svelte';
	import XYPad from './XYPad.svelte';

	// The old remote's sound column had eight slots; a song uses what it has.
	const SLOTS = 8;

	// The old remote's colors, pad by pad, as [tile, label] (Cyborg Ben 8-11-26.tosc).
	const RED = '#ff281c';
	const GREEN = '#75cc26';
	const PINK = '#ff05f2';
	const YELLOW = '#ffed00';
	const ORANGE = '#f9a01c';
	const WHITE = '#ffffff';
	const TEAL = '#00c4a8';
	const SOUND_PAD_CELLS = [0, 1];
	const PAD_COLORS = [
		[GREEN, RED], [GREEN, RED],
		[PINK, WHITE], [PINK, WHITE], [RED, WHITE], [RED, WHITE],
		[RED, GREEN], [RED, GREEN], [YELLOW, RED], [YELLOW, RED],
		[ORANGE, PINK], [ORANGE, PINK], [WHITE, RED], [WHITE, RED]
	];

	onMount(startSetlist);

	const songName = $derived(setlist.songs[Math.max(setlist.song, 0)] ?? '');
	const status = $derived(
		!setlist.live ? 'Waiting for Live' : !setlist.found ? 'No rack on a track named Keys' : ''
	);
</script>

<svelte:head><title>Setlist</title></svelte:head>

<main>
	<div class="arrows">
		<button
			aria-label="Previous song"
			class:armed={setlist.armed === -1}
			disabled={setlist.song === 0}
			onpointerdown={() => tapArrow(-1)}>&lt;</button
		>
		<button
			aria-label="Next song"
			class:armed={setlist.armed === 1}
			disabled={setlist.song === setlist.songs.length - 1}
			onpointerdown={() => tapArrow(1)}>&gt;</button
		>
	</div>

	<SongFader label={status || songName} idle={setlist.song < 0} />

	<div class="sounds">
		{#each { length: SLOTS } as _, i}
			{@const name = setlist.sounds[i]}
			<button
				class:on={i === setlist.sound}
				disabled={name === undefined}
				onpointerdown={() => selectSound(i)}>{name ?? ''}</button
			>
		{/each}
	</div>

	<div class="pads">
		{#each SOUND_PAD_CELLS as cell}
			{@const pad = setlist.soundPads[cell]}
			{#if pad}
				{#key pad.xKey}
					<XYPad {pad} color={TEAL} labelColor={RED} />
				{/key}
			{:else}
				<div class="empty" style:--color={TEAL}></div>
			{/if}
		{/each}
		{#each setlist.pads as pad, i (pad.xKey)}
			<XYPad {pad} color={PAD_COLORS[i % PAD_COLORS.length][0]} labelColor={PAD_COLORS[i % PAD_COLORS.length][1]} />
		{/each}
	</div>
</main>

<style>
	/* Proportions from the old remote's layout (Cyborg Ben 8-11-26.tosc, 1024 x 768). */
	main {
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-columns: 12% 1fr;
		grid-template-rows: 9.5% 1fr;
		gap: 1.2vh 1vw;
		padding: 0.5vh 0.4vw;
		background: #000;
		font-family: Ubuntu, system-ui, sans-serif;
		user-select: none;
		-webkit-user-select: none;
	}
	button {
		appearance: none;
		border: none;
		font: inherit;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}
	.arrows {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3px;
		padding: 3px;
		border: 1px solid #f9a01c;
		border-radius: 10px;
	}
	.arrows button {
		background: #3f2a0b;
		color: #ff281c;
		border-radius: 8px;
		font-size: 6vh;
		line-height: 1;
	}
	.arrows button.armed {
		background: #f9a01c;
		color: #000;
	}
	.arrows button:disabled {
		opacity: 0.35;
	}
	.pads {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		grid-template-rows: repeat(4, 1fr);
		gap: 2vh 1.3vw;
		min-height: 0;
		/* The right edge stays free for the chain volume. */
		margin-right: 7.5%;
	}
	.empty {
		border: 1px solid color-mix(in srgb, var(--color) 30%, #000);
		border-radius: 10px;
	}
	.sounds {
		display: grid;
		grid-template-rows: repeat(8, 1fr);
		gap: 0.5vh;
		padding: 4px;
		border: 1px solid #ff281c;
		border-radius: 10px;
		min-height: 0;
	}
	.sounds button {
		min-height: 0;
		overflow: hidden;
		padding: 0 4px;
		background: #3f0a07;
		color: #75cc26;
		border-radius: 8px;
		font-size: 2.6vh;
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.sounds button.on {
		background: #ff281c;
	}
</style>
