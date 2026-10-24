<script lang="ts">
	/**
	 * New Audio / New MIDI — the column at the right-hand end of the
	 * strips row (2026-10-23). It took over track creation from the foot
	 * pedal's hold, which now moves the pedal to the next empty slot.
	 *
	 * Each button is one `prepare_for_preset` with no preset and the target
	 * `new`: the surface always creates a track of that kind (2026-10-24,
	 * the user's call; it reused an empty one before), arms and routes an
	 * audio track, appends Permute, and Live selects it — so the pedal's
	 * next tap records there. Every press is a new track; presses of one
	 * kind queue in `trackPreparation`, one create at a time.
	 */
	import Mic from '@lucide/svelte/icons/mic';
	import Piano from '@lucide/svelte/icons/piano';
	import Plus from '@lucide/svelte/icons/plus';
	import { press } from '$lib/actions/press';
	import { prepareForPreset, NEW_TRACK_TARGET, type TrackType } from '$lib/services/trackPreparation';
	import { logger } from '$lib/utils/logger';

	let pending = $state<Record<TrackType, boolean>>({ audio: false, midi: false });

	async function newTrack(kind: TrackType) {
		if (pending[kind]) return;
		pending[kind] = true;
		try {
			await prepareForPreset(kind, '', NEW_TRACK_TARGET);
		} catch (err) {
			logger.warn('New track failed', { component: 'NewTrackButtons', kind, err });
		} finally {
			pending[kind] = false;
		}
	}

	const BUTTONS = [
		{ kind: 'audio' as const, label: 'Audio', icon: Mic },
		{ kind: 'midi' as const, label: 'MIDI', icon: Piano }
	];
</script>

<div class="new-tracks" data-debug="new-track-buttons">
	{#each BUTTONS as b (b.kind)}
		{@const Icon = b.icon}
		<button
			type="button"
			class="new-track"
			class:is-pending={pending[b.kind]}
			aria-label="New {b.label} track"
			aria-busy={pending[b.kind]}
			data-new-track={b.kind}
			use:press={{ onPress: () => newTrack(b.kind), touchAction: 'pan-x' }}
		>
			<span class="new-track-icons" aria-hidden="true">
				<Plus class="new-track-plus" />
				<Icon class="new-track-icon" />
			</span>
			<span class="new-track-label">{b.label}</span>
		</button>
	{/each}
</div>

<style>
	.new-tracks {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	/* Each button is a size container, so its marks scale with the box
	   the column gets: a strip's width across, half the row's height.
	   Container units resolve against an ANCESTOR container, so only the
	   button's children size in cqmin, never the button itself. */
	.new-track {
		flex: 1 1 0;
		min-height: 0;
		min-width: 0;
		container-type: size;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--muted-foreground);
		font-weight: var(--font-weight-medium);
		line-height: 1;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background-color 90ms var(--ease-precise),
			color 90ms var(--ease-precise);
	}

	/* Ghost text: the marks sit at the ghost weight an unloaded device
	   wears, and come up to full under the finger. */
	.new-track-icons,
	.new-track-label {
		opacity: var(--opacity-ghost);
		transition: opacity 90ms var(--ease-precise);
	}

	.new-track:active .new-track-icons,
	.new-track:active .new-track-label,
	.new-track.is-pending .new-track-icons,
	.new-track.is-pending .new-track-label {
		opacity: 1;
	}

	.new-track:active {
		background: var(--secondary);
		color: var(--foreground);
	}

	/* A load is in flight: a second press of this kind is ignored until
	   it lands, so say so rather than look dead. */
	.new-track.is-pending {
		color: var(--foreground);
		border-style: solid;
		animation: new-track-pending 900ms ease-in-out infinite alternate;
	}

	@keyframes new-track-pending {
		from {
			background: transparent;
		}
		to {
			background: var(--secondary);
		}
	}

	.new-track-icons {
		display: flex;
		align-items: center;
		gap: 2cqmin;
		margin-bottom: 6cqmin;
	}

	.new-track-label {
		font-size: clamp(0.75rem, 16cqmin, 1.25rem);
	}

	.new-track-icons :global(.new-track-plus) {
		width: clamp(0.75rem, 20cqmin, 1.75rem);
		height: clamp(0.75rem, 20cqmin, 1.75rem);
	}

	.new-track-icons :global(.new-track-icon) {
		width: clamp(1.125rem, 36cqmin, 3.5rem);
		height: clamp(1.125rem, 36cqmin, 3.5rem);
	}

	.new-track-icons :global(svg) {
		stroke-width: 1.5;
	}

	/* Flat grammar: an empty slot's dashed edge and no field — the
	   column is somewhere a track will go, not a track. */
	:global([data-grammar="flat"]) .new-track {
		border-radius: 2px;
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .new-track:active,
	:global([data-grammar="flat"]) .new-track.is-pending {
		background: var(--secondary);
	}
	:global([data-grammar="flat"]) .new-track.is-pending {
		animation: none;
		border-color: var(--phosphor);
	}
</style>
