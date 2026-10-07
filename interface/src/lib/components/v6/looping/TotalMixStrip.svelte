<script lang="ts">
	/**
	 * TotalMix monitor strip: five read-only bars in the safe-area status
	 * strip, each showing one RME TotalMix channel two ways. The FILL is the
	 * live signal meter (`/looping/v3/totalmix_meters`, 30 fps from the
	 * bridge); the thin LINE is where the channel's fader sits
	 * (`/looping/v3/totalmix/<channel>`). Nothing here writes: the mixer is
	 * driven from TotalMix itself and the Move's knobs.
	 *
	 * Both are **dB** (ADR-423) on the same −65..+6 scale, so a line at the
	 * meter's edge means the signal sits at the fader's own level. The 0..1
	 * comes from `dbToFraction`, which owns that curve so the wire never has
	 * to. With the mixer's Send Level off no meter frame comes and the fill
	 * stays empty; the line still says where the fader is.
	 *
	 * **Dim on purpose.** The meter is a glance, not a readout: a veil
	 * over the ramp lets only part of its colour through, so a moving fill
	 * never pulls the eye off the set. That dimness is also why the word is
	 * drawn once in plain ink — it reads over the dim fill as over the well.
	 */
	import { totalmixMeters, totalmixStore } from '$lib/stores/v3/totalmix.svelte';
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
		CHANNELS.map(({ channel, label }) => {
			// A fader never heard from draws no line rather than one at some
			// invented level — an unknown monitor level must not look like a
			// real one. A meter never heard from is simply an empty fill.
			const fader = totalmixStore.get(channel);
			return {
				channel,
				label,
				level: Math.round(dbToFraction(fader ?? MIN_DB) * 100),
				known: fader !== undefined,
				meter: Math.round(dbToFraction(totalmixMeters.get(channel) ?? MIN_DB) * 1000) / 10
			};
		})
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
	{#each cells as { channel, label, level, known, meter } (channel)}
		<div
			class="tmh-item"
			data-channel={channel}
			aria-label={unavailable ? `${channel}: ${unavailableReason}` : `${channel}: ${level}%`}
			title={unavailable ? unavailableReason : undefined}
		>
			<div class="tmh-mask" style={`width: ${100 - meter}%;`}></div>
			<span class="tmh-label">{label}</span>
			<!-- The fader's position, over everything so the meter never hides it. -->
			{#if known}
				<div class="tmh-fader" style={`left: ${level}%;`} aria-hidden="true"></div>
			{/if}
		</div>
	{/each}
</div>
<style>
	/* Unavailable, the bars keep their words but lose the ramp: a bare well
	   with nothing on it is not a level, an empty ramp could read as one. */
	.tmh-strip.is-unavailable .tmh-item {
		background: var(--surface-well);
	}
	.tmh-strip.is-unavailable .tmh-item::before,
	.tmh-strip.is-unavailable .tmh-mask,
	.tmh-strip.is-unavailable .tmh-fader {
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
	/* The veil that keeps the meter quiet: the well's own colour over the
	   whole ramp, so the fill shows about 40% of it. One number to turn up
	   or down. Painted first, so the mask, the word and the line sit over it. */
	.tmh-item::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--surface-well);
		opacity: 0.6;
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
	/* The fader line: 2px of label ink with a 1px dark edge either side, so
	   it reads on the empty well and on the fill alike. Moves
	   only when a fader does, so no transition. `translateX(-50%)` centres it
	   on its level; at 0% and 100% the item's overflow clips half of it. */
	.tmh-fader {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		transform: translateX(-50%);
		background: var(--foreground);
		box-shadow:
			1px 0 0 var(--card),
			-1px 0 0 var(--card);
		z-index: 2;
		pointer-events: none;
	}

	/* Centred. Never wrap: the bar is one line tall. */
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
