<script lang="ts">
	/**
	 * A guitar tuner the height of the TotalMix bars, over the left sidebar in
	 * the status strip (ADR-539). It tunes the input the sidebar's REC records
	 * (Settings → Recording): Vamp for Mac hears the device and names the
	 * pitch; this draws the note, and a needle that sits on the centre line
	 * when the note is in tune, left of it flat, right of it sharp.
	 *
	 * Live's own input (no device picked) reaches nothing Vamp for Mac can
	 * hear, so the bar says so instead of tuning.
	 */
	import { captureStore } from '$lib/stores/v6/captureStore.svelte';
	import { captureSettings } from '$lib/stores/v6/captureSettingsStore.svelte';
	import { noteOf, IN_TUNE_CENTS, type TunerNote } from '$lib/utils/tuner';

	let uid = $derived(captureSettings.deviceUid);
	let channel = $derived(captureSettings.channel);

	// Keep the app listening, and tuning this channel, while the bar is up.
	$effect(() => {
		if (!uid || !channel) return;
		return captureStore.holdInputMonitor(uid, channel);
	});

	let pitch = $derived.by(() => {
		const p = captureStore.inputPitch;
		return p && p.uid === uid && p.channel === channel ? p : null;
	});
	let heard = $derived(pitch ? noteOf(pitch.hz) : null);

	// The last note stays up, dimmed, after the string stops, so a glance
	// between plucks still reads.
	let held = $state<TunerNote | null>(null);
	$effect(() => {
		if (heard) held = heard;
	});
	$effect(() => {
		// A different input forgets the last one's note.
		void uid;
		void channel;
		held = null;
	});

	let note = $derived(heard ?? held);
	let live = $derived(heard !== null);
	let inTune = $derived(live && note !== null && Math.abs(note.cents) <= IN_TUNE_CENTS);
	let flat = $derived(live && note !== null && note.cents < -IN_TUNE_CENTS);
	let sharp = $derived(live && note !== null && note.cents > IN_TUNE_CENTS);
	let access = $derived(captureStore.inputLevels?.uid === uid ? captureStore.inputLevels.access : 'granted');
	let offered = $derived(captureStore.inputDevices.some((d) => d.uid === uid));

	let message = $derived(
		!uid
			? 'Tuner: pick an input'
			: !offered
				? 'Tuner: no Vamp for Mac'
				: access === 'denied'
					? 'Tuner: no mic access'
					: null
	);
	let title = $derived(
		message ?? `Tuning ${captureSettings.device?.name ?? 'the input'} ${channel} (Settings → Recording)`
	);
</script>

<div
	class="tuner"
	class:in-tune={inTune}
	class:flat
	class:sharp
	class:stale={!live}
	class:off={message !== null}
	role="meter"
	aria-label="Tuner"
	aria-valuemin={-50}
	aria-valuemax={50}
	aria-valuenow={note ? Math.round(note.cents) : 0}
	aria-valuetext={message ?? (note ? `${note.name} ${Math.round(note.cents)} cents` : 'No note')}
	{title}
	data-testid="input-tuner"
>
	{#if message}
		<span class="label">{message}</span>
	{:else}
		<span class="centre" aria-hidden="true"></span>
		{#if note}
			<span class="needle" aria-hidden="true" style="left: {50 + note.cents}%"></span>
		{/if}
		<span class="label">
			{#if note}
				<span class="flat-mark" aria-hidden="true">♭</span>
				<span class="name">{note.name}</span>
				<span class="sharp-mark" aria-hidden="true">♯</span>
			{:else}
				Tuner
			{/if}
		</span>
	{/if}
</div>

<style>
	/* Built as a TotalMix bar is: the strip stretches it to its height, a
	   well with a hairline border, and the word inside it. */
	.tuner {
		position: relative;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		border-radius: 2px;
		border: 1px solid var(--line);
		background: var(--surface-well);
		transition: background-color 0.08s linear;
	}
	.tuner.in-tune {
		background: color-mix(in oklab, var(--act-play) 35%, var(--surface-well));
		border-color: var(--act-play);
	}
	/* The centre line: where the needle sits in tune. */
	.centre {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
		transform: translateX(-50%);
		background: var(--line-strong);
	}
	/* Moves at the 15 Hz the app reports; the sanctioned 0.08s smoothing. */
	.needle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 3px;
		transform: translateX(-50%);
		background: var(--act-warn);
		box-shadow:
			1px 0 0 var(--card),
			-1px 0 0 var(--card);
		transition: left 0.08s linear;
		z-index: 1;
	}
	.in-tune .needle {
		background: var(--act-play);
	}
	.stale .needle {
		opacity: 0.35;
	}

	.label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		font-size: 0.625rem; /* 10px, as the TotalMix bars' words */
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.02em;
		white-space: nowrap;
		pointer-events: none;
		user-select: none;
		color: var(--foreground);
		z-index: 2;
	}
	.off .label,
	.stale .label {
		color: var(--signal-dim);
	}
	.in-tune .label {
		color: var(--act-play);
	}
	/* Which way to turn the peg, lit on the side the note is off to. */
	.flat-mark,
	.sharp-mark {
		color: var(--signal-dim);
		opacity: 0.35;
	}
	.flat .flat-mark,
	.sharp .sharp-mark {
		color: var(--act-warn);
		opacity: 1;
	}
</style>
