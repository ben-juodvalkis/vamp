<script lang="ts">
	import { onMount } from 'svelte';
	import { setlist, selectSound, startSetlist, tapArrow } from '$lib/services/setlist.svelte';

	// The old remote's sound column had eight slots; a song uses what it has.
	const SLOTS = 8;

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

	<div class="song" class:idle={setlist.song < 0} data-testid="song">{status || songName}</div>

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
	.song {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #3f3b00;
		border: 1px solid #ffed00;
		border-radius: 10px;
		color: #ff281c;
		font-size: 6.4vh;
		white-space: nowrap;
		overflow: hidden;
	}
	.song.idle {
		opacity: 0.55;
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
