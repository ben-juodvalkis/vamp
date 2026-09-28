<script lang="ts">
	/**
	 * TotalMix monitor strip: five read-only bars in the safe-area status
	 * strip, mirroring the RME TotalMix levels the bridge relays from the
	 * mixer (`/looping/v3/totalmix/<channel>`). Nothing here writes: the
	 * mixer is driven from TotalMix itself and the Move's knobs.
	 *
	 * Values land via `handleV3TotalMix` → `totalmixStore`; this strip
	 * derives off `totalmixStore.get(channel)`. Store values are **dB**
	 * (ADR-423); the 0..1 the fill needs comes from `dbToFraction`,
	 * which owns that curve so the wire never has to.
	 *
	 * **Legibility over the fill.** The word is drawn TWICE, the inverse
	 * copy clipped to exactly the filled region and inked for on-fill —
	 * the same trick `DeviceSlider` uses for its labels, so a word the
	 * level has swept past flips ink at the boundary instead of
	 * disappearing into the bright end of the ramp.
	 */
	import { totalmixStore } from '$lib/stores/v3/totalmix.svelte';
	import { dbToFraction, MIN_DB } from '$lib/utils/totalmixScale';

	interface Props {
		/**
		 * Why the mixer is not being heard: the bridge's reason for a
		 * `totalmix` feature that is switched on but has not heard from
		 * TotalMix (`/bridge/features`, general-release audit §7b). Non-empty
		 * draws the bars greyed out. Empty is the live strip. Whether it is
		 * drawn at all is the host's call: a switched-off feature mounts
		 * nothing.
		 */
		unavailableReason?: string;
	}

	let { unavailableReason = '' }: Props = $props();

	const unavailable = $derived(unavailableReason !== '');

	// Display order + labels. Channel key must match the OSC address tail,
	// i.e. `osc.totalmix.channels` in constants.json. Playback reads
	// **Track**: the channel carries what the tracks are sending, and
	// "Playback" beside "Room" invites the reading that one of them is the
	// mix and the other is the speakers.
	const CHANNELS: { channel: string; label: string }[] = [
		{ channel: 'room', label: 'Room' },
		{ channel: 'playback', label: 'Track' },
		{ channel: 'click', label: 'Click' },
		{ channel: 'phones', label: 'Phones' },
		{ channel: 'main', label: 'Main' }
	];

	const cells = $derived(
		CHANNELS.map(({ channel, label }) => ({
			channel,
			label,
			// A channel never heard from renders empty rather than at some
			// invented level — an unknown monitor level must not look like
			// a real one.
			level: Math.round(dbToFraction(totalmixStore.get(channel) ?? MIN_DB) * 100)
		}))
	);
</script>

<!-- Thin bars. The ramp is painted on the TRACK and an opaque mask eats
     it from the right, rather than the fill carrying the gradient: a
     gradient on a `level%`-wide fill would stretch, putting the top of
     the scale on top of every reading. Masking keeps one fixed ramp per
     track and needs no knowledge of the track's pixel width. -->
<!-- Unavailable: the words stay (they say what each bar is for) but in
     the disabled ink on a bare well — no ramp, so no bar reads as a
     level. No reason text: this band has no room for a sentence and
     nothing here takes a touch; the aria-label and title carry it. -->
<div
	class="tmh-strip"
	class:is-unavailable={unavailable}
	aria-label={unavailable ? `TotalMix levels: ${unavailableReason}` : 'TotalMix levels'}
	aria-disabled={unavailable || undefined}
>
	{#each cells as { channel, label, level } (channel)}
		<div
			class="tmh-item"
			data-channel={channel}
			aria-label={unavailable ? `${channel}: ${unavailableReason}` : `${channel}: ${level}%`}
			title={unavailable ? unavailableReason : undefined}
		>
			<div class="tmh-mask" style={`width: ${100 - level}%;`}></div>
			<span class="tmh-label">{label}</span>
			<!-- Inverse copy, clipped to the filled region — the same trick
			     `DeviceSlider` uses, turned on its
			     side. `inset(0 <uncovered>% 0 0)` measures from the RIGHT,
			     which is what puts the flip exactly on the fill's edge, so
			     a word the level has swept past changes ink mid-letter
			     instead of disappearing into the bright end of the ramp. -->
			<span
				class="tmh-label tmh-label--inverse"
				style={`clip-path: inset(0 ${100 - level}% 0 0);`}
				aria-hidden="true">{label}</span>
		</div>
	{/each}
</div>
<style>
	/* Unavailable, the bars keep their words but lose the ramp: a bare well
	   with nothing on it is not a level, an empty ramp could read as one. */
	.tmh-strip.is-unavailable .tmh-item {
		background: var(--surface-well);
	}
	.tmh-strip.is-unavailable .tmh-mask,
	.tmh-strip.is-unavailable .tmh-label--inverse {
		display: none;
	}
	.tmh-strip.is-unavailable .tmh-label {
		color: var(--signal-dim);
	}

	/* ---- The bars ------------------------------------------------------
	   Built for the safe-area status strip: a 6px bar with its letter
	   beside it, so a 24pt band has room for both without either being
	   cramped.

	   `display: contents` is the load-bearing line. The five items become
	   direct children of the HOST's layout, which is what lets the status
	   strip place each one in an FX-grid column — the alignment is the
	   page's business (it owns that geometry), not this component's, and
	   a wrapper box in between would make it impossible to express. Each
	   item carries `data-channel` so the host addresses them by name
	   rather than by `nth-child`, which would silently re-map if the
	   channel order ever changed. Height and gap come from the host too;
	   off-device it collapses to 0 and these vanish with it. */
	.tmh-strip {
		display: contents;
	}
	/* The bar IS the item: it takes the host row's full height (the strip
	   stretches it), carries the ramp, and the word sits inside it rather
	   than beside it — so the fill sweeps BEHIND the label and the ink
	   flips at the boundary. A label outside the bar cost width the bar
	   wanted and said the same thing less clearly. */
	.tmh-item {
		position: relative;
		min-width: 0;
		overflow: hidden;
		border-radius: 2px;
		border: 1px solid var(--line);
		/* The act-monitor ramp, drawn across the FULL bar (see markup). */
		background: linear-gradient(
			to right,
			color-mix(in oklab, var(--act-monitor) 30%, var(--surface-well)) 0%,
			var(--act-monitor) 100%
		);
	}
	/* Eats the ramp from the right. `.tmh-mask` is the 30Hz node — the width
	   write is what animates; keep ONLY the sanctioned 0.08s smoothing. */
	.tmh-mask {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		background: var(--surface-well);
		transition: width 0.08s linear;
	}
	/* Centred, so the flip lands mid-word as the level crosses the middle —
	   which is the whole reason the two-copy trick is worth its second
	   element. Never wrap: the bar is one line tall. */
	.tmh-label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.625rem; /* 10px — a label, not a readout */
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.02em;
		white-space: nowrap;
		pointer-events: none;
		user-select: none;
		color: var(--foreground);
	}
	/* On-fill ink: dark, so it reads against the bright end of the ramp.
	   Sits above the base copy; the clip is inline. */
	.tmh-label--inverse {
		color: var(--card);
		z-index: 1;
	}

	/* Live skin: Live's VU ramp instead of the act-monitor one, squarer
	   corners, lighter label. The ramp spans the track, so no height maths. */
	:global([data-grammar="flat"]) .tmh-item {
		border-color: var(--line-strong);
		border-radius: 1px;
		background: linear-gradient(
			to right,
			#00f758 0%,
			#00f758 72%,
			#ffd100 84%,
			#ffd100 94%,
			#ff0a0a 94%,
			#ff0a0a 100%
		);
	}
	:global([data-grammar="flat"]) .tmh-label {
		font-weight: var(--font-weight-medium);
	}
	/* Live's dark-on-chosen ink for the part the level has covered. */
	:global([data-grammar="flat"]) .tmh-label--inverse {
		color: var(--flat-on-fg);
	}

	/* Unavailable, flat: the cookbook's disabled rule — the same field in
	   the disabled ink, never an opacity dim — and no VU ramp on a bar that
	   has no level to show. */
	:global([data-grammar="flat"]) .tmh-strip.is-unavailable .tmh-item {
		background: var(--surface-well);
	}
	:global([data-grammar="flat"]) .tmh-strip.is-unavailable .tmh-label {
		color: var(--flat-disabled-fg);
	}
</style>
