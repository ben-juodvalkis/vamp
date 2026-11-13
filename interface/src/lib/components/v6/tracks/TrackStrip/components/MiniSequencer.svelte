<script lang="ts">
	import type { TinySequencerState } from '../../composables/useTinySequencer.svelte';

	interface Props {
		sequencerState: TinySequencerState | null;
		color?: string;
		dimmed?: boolean;
		/** ADR-435: the pad this section is scoped to, named for the title; null for the track's own. */
		scopeLabel?: string | null;
		/** The scoped pad's ink for the frame (its chain colour, else the track's). */
		scopeInk?: string | null;
	}

	let { sequencerState, color, dimmed = false, scopeLabel = null, scopeInk = null }: Props = $props();

	let isGhost = $derived(!sequencerState || !sequencerState.active);
	let scoped = $derived(scopeLabel !== null);
	let title = $derived(
		scoped
			? (isGhost ? `No Permute on ${scopeLabel} — edit a step to add one` : `Permute on ${scopeLabel}`)
			: (isGhost ? 'No sequencer on this track' : 'Permute')
	);

	// Mute row (top) uses the track ink; greys to signal-dim when dimmed/muted.
	let muteColor = $derived(dimmed ? 'var(--signal-dim)' : (color ?? 'var(--signal-dim)'));

	function isCurrent(position: number, stepIndex: number): boolean {
		return position === stepIndex && position >= 0;
	}
</script>

<!-- Presentational only. The parent TrackStrip owns all pointer gestures. -->
<div
	class="mini-sequencer w-full touch-manipulation"
	class:ghost={isGhost}
	class:scoped
	style="--mute-color: {muteColor}; --scope-ink: {scopeInk ?? muteColor};"
	{title}
	data-permute-scope={scoped ? scopeLabel : undefined}
>
	{#if isGhost || !sequencerState}
		<div class="ghost-content">
			<div class="ghost-row mute-ghost">
				{#each Array(8) as _, i}
					<div class="ghost-step mute-filled"></div>
					{#if i < 7}
						<div class="ghost-separator"></div>
					{/if}
				{/each}
			</div>
			<div class="ghost-row pitch-ghost">
				{#each Array(8) as _, i}
					<div class="ghost-step pitch-empty"></div>
					{#if i < 7}
						<div class="ghost-separator"></div>
					{/if}
				{/each}
			</div>
		</div>
	{:else}
		{@const mute = sequencerState.mute}
		{@const pitch = sequencerState.pitch}
		<div class="sequencer-content">
			<!-- The two rows carry their inert state independently: mute is
			     inert when no step is off (it never mutes), pitch when no step
			     is on (it never transposes). One can be live while the other
			     sleeps, so the translucency is per-row, never per-sequencer. -->
			<div class="sequencer-row" class:inactive={!mute.enabled}>
				{#each Array(mute.length) as _, i}
					<div
						class="step mute-step"
						class:active={mute.pattern[i]}
						class:current={isCurrent(mute.position, i)}
					></div>
					{#if i < mute.length - 1}
						<div class="step-separator"></div>
					{/if}
				{/each}
			</div>
			<div class="sequencer-row" class:inactive={!pitch.enabled}>
				{#each Array(pitch.length) as _, i}
					<div
						class="step pitch-step"
						class:active={pitch.pattern[i]}
						class:current={isCurrent(pitch.position, i)}
					></div>
					{#if i < pitch.length - 1}
						<div class="step-separator"></div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.mini-sequencer {
		height: 100%;
		width: 100%;
		border-radius: var(--radius-sm);
		padding: 0;
	}
	/* A pad's Permute (ADR-435): the section wears a frame in the pad's
	   ink while a pad is scoped on this track's Drum Rack — the FX grid's
	   own idiom for "this is the held pad's", at strip scale. The rows
	   step in by the frame so the ring never crosses them. */
	.mini-sequencer.scoped {
		padding: 3px;
		box-shadow: inset 0 0 0 2px var(--scope-ink);
	}

	.ghost-content {
		display: flex;
		flex-direction: column;
		gap: 3px;
		height: 100%;
	}

	.sequencer-content {
		display: flex;
		flex-direction: column;
		gap: 3px;
		height: 100%;
		opacity: 0.7;
	}

	.ghost-row {
		display: flex;
		flex: 1;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: transparent;
	}

	.ghost-row.mute-ghost {
		border: 1px dashed color-mix(in srgb, var(--mute-color), transparent 70%);
	}

	.ghost-row.pitch-ghost {
		border: 1px dashed color-mix(in oklab, var(--act-pitch) 30%, transparent);
	}

	.ghost-step {
		flex: 1;
		background: transparent;
	}

	.ghost-step.mute-filled {
		background: color-mix(in srgb, var(--mute-color), transparent 75%);
	}

	.ghost-step.pitch-empty {
		background: color-mix(in oklab, var(--act-pitch) 8%, transparent);
	}

	.ghost-separator {
		width: 1px;
		background: var(--line-faint);
	}

	/* Sequencer rows are recessed wells (§2.9). */
	.sequencer-row {
		display: flex;
		flex: 1;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--surface-well);
		border: 1px solid var(--line);
		transition: opacity 160ms var(--ease-settle);
	}

	/* An inert row recedes as a WHOLE — well, frame and cells together.
	   Fading only the cells (what this used to do) left the well and its
	   border at full strength, so a sequencer that does nothing still drew
	   a solid box at the same weight as one that does; in the flat skin it
	   was worse, since a full mute row painted a solid disabled-grey band
	   that was the loudest mark in the strip. Opacity is the right tool
	   here rather than a recolor: it is the one treatment that reads at
	   thumbnail size without needing a legend. */
	/* GRATICULE's rows already sit under the content's 0.7 veil, so 0.45
	   here lands at ~0.32 on screen — about where the dashed no-Permute
	   ghost sits. Going lower made an inert row FAINTER than a track with
	   no Permute at all, which reads backwards. The flat skin has no veil
	   to compound with and takes 0.3 directly. */
	.sequencer-row.inactive {
		opacity: var(--seq-inactive-opacity, 0.45);
	}

	.step-separator {
		width: 1px;
		background: var(--line-faint);
	}

	/* Current-step cell gets a 120ms background-color decay on its class change —
	   the strip's quiet heartbeat (beat-rate, cold node). Enumerated, never `all`. */
	.step {
		flex: 1;
		background: color-mix(in srgb, var(--muted), transparent 60%);
		transition: background-color 120ms var(--ease-settle);
	}

	.mute-step.active {
		background: var(--mute-color);
	}

	.mute-step.current {
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--mute-color), white 25%);
		background: color-mix(in srgb, var(--muted), transparent 20%);
	}

	/* No glow (GRATICULE bans resting glows) — the inset bracket-style ring carries it. */
	.mute-step.current.active {
		background: color-mix(in srgb, var(--mute-color), white 25%);
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--mute-color), white 45%);
	}

	.pitch-step.active {
		background: var(--act-pitch);
	}

	.pitch-step.current {
		box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--act-pitch) 75%, white);
		background: color-mix(in srgb, var(--muted), transparent 20%);
	}

	.pitch-step.current.active {
		background: color-mix(in oklab, var(--act-pitch) 75%, white);
		box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--act-pitch) 55%, white);
	}

	/* ---- Live skin: two ControlBackground wells in 1px dark frames at full
	   opacity (no 70% veil over the strip); an OFF step is the bare well, an
	   ON step a SOLID block of the track ink / FreezeColor blue, the current
	   step a crisp 1px SelectionBackground frame (no whitened fill, no dark
	   inset ring). An inert row fades with the rest — see the note on
	   --seq-inactive-opacity below for why this one departs from the
	   grammar's no-opacity-dim rule. Ghost rows: solid hairline frames with
	   grey placeholder cells instead of the dashed ink washes. */
	:global([data-grammar="flat"]) .sequencer-content {
		opacity: 1;
	}
	:global([data-grammar="flat"]) .sequencer-row {
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .step {
		background: var(--surface-well);
	}
	:global([data-grammar="flat"]) .mute-step.active {
		background: var(--mute-color);
	}
	:global([data-grammar="flat"]) .pitch-step.active {
		background: var(--act-pitch);
	}
	:global([data-grammar="flat"]) .step.current {
		background: var(--surface-well);
		box-shadow: inset 0 0 0 1px var(--flat-selection);
	}
	:global([data-grammar="flat"]) .mute-step.current.active {
		background: var(--mute-color);
	}
	:global([data-grammar="flat"]) .pitch-step.current.active {
		background: var(--act-pitch);
	}
	/* The flat grammar's usual disabled idiom is ControlOffDisabled ink on
	   the same field, never an opacity dim — but that rule is written for
	   full-size controls with room to be read. At strip-thumbnail scale it
	   inverted the hierarchy: a mute row with every step on became a solid
	   grey band, the highest-contrast mark in a column of live sequencers.
	   The flat skin takes the same per-row translucency, one notch stronger
	   because its rows start at full opacity where GRATICULE's start at 0.7. */
	:global([data-grammar="flat"]) .sequencer-content {
		--seq-inactive-opacity: 0.3;
	}
	:global([data-grammar="flat"]) .ghost-row.mute-ghost,
	:global([data-grammar="flat"]) .ghost-row.pitch-ghost {
		border: 1px solid var(--line);
	}
	:global([data-grammar="flat"]) .ghost-step.mute-filled {
		background: var(--secondary);
	}
	:global([data-grammar="flat"]) .ghost-step.pitch-empty {
		background: transparent;
	}
</style>
