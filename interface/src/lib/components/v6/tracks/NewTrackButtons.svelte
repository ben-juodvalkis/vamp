<script lang="ts">
	/**
	 * New Audio / New MIDI — the column at the right-hand end of the
	 * strips row (2026-10-23). It took over track creation from the foot
	 * pedal's hold, which now moves the pedal to the next empty slot.
	 *
	 * Each button is one `prepare_for_preset` with no preset: the surface
	 * reuses an empty track of that kind (the selected one first) or
	 * creates one, arms and routes an audio track, appends Permute, and
	 * Live selects it — so the pedal's next tap records there. Rapid
	 * presses of one kind queue in `trackPreparation`, so a second press
	 * finds the track the first one made rather than making another.
	 */
	import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
	import Piano from '@lucide/svelte/icons/piano';
	import Plus from '@lucide/svelte/icons/plus';
	import { press } from '$lib/actions/press';
	import { prepareForPreset, type TrackType } from '$lib/services/trackPreparation';
	import { logger } from '$lib/utils/logger';

	let pending = $state<Record<TrackType, boolean>>({ audio: false, midi: false });

	async function newTrack(kind: TrackType) {
		if (pending[kind]) return;
		pending[kind] = true;
		try {
			await prepareForPreset(kind, '');
		} catch (err) {
			logger.warn('New track failed', { component: 'NewTrackButtons', kind, err });
		} finally {
			pending[kind] = false;
		}
	}

	const BUTTONS = [
		{ kind: 'audio' as const, label: 'Audio', icon: AudioWaveform },
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

	.new-track {
		flex: 1 1 0;
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		padding: 0;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		font-weight: var(--font-weight-medium);
		line-height: 1;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background-color 90ms var(--ease-precise),
			color 90ms var(--ease-precise);
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
			background: var(--card);
		}
		to {
			background: var(--secondary);
		}
	}

	.new-track-icons {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.new-track-icons :global(.new-track-plus) {
		width: 0.875rem;
		height: 0.875rem;
	}

	.new-track-icons :global(.new-track-icon) {
		width: 1.25rem;
		height: 1.25rem;
	}

	.new-track-icons :global(svg) {
		stroke-width: 1.5;
	}

	/* Flat grammar: an empty slot's dashed edge on the card field — the
	   column is somewhere a track will go, not a track. */
	:global([data-grammar="flat"]) .new-track {
		border-radius: 2px;
		border-color: var(--line-strong);
		background: var(--surface-well);
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
