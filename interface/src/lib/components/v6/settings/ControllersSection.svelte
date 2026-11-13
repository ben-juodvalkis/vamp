<script lang="ts">
	/**
	 * Settings → Controllers (ADR-534): the hardware you play Vamp with.
	 *
	 * **Pedals** (ADR-538): every pedal is read by the bridge from any MIDI
	 * input, nothing set up in Live — the loop trigger (one or more pedals:
	 * on/off, Learn adds one, Forget clears them) and, while the
	 * `expressionPedal` switch is on, the wah's toe switch and sweep (Learn
	 * each). State is `/bridge/pedals`; writes `/bridge/pedals/{enabled,
	 * learn,forget}`. **Ableton Move**: its knob switch, while the bridge
	 * reads the owner's Move (`midiControllers`, ADR-537).
	 *
	 * Every row is its own button, echo-confirmed: it shows what the bridge
	 * or the surface says, not what was tapped. A Learn row draws its action
	 * on the right (Learn, Cancel, Try again) so it reads as one; the whole
	 * row still takes the tap.
	 */
	import { logger } from '$lib/utils/logger';
	import { session } from '$lib/stores/session.svelte';
	import { bridgeStatus, type Pedal, type PedalRole } from '$lib/stores/bridgeStatus.svelte';
	import { setMoveVolumeKnob, setLoopPedalsEnabled, setPedalLearn, forgetPedals } from '$lib/services/sessionCommands';

	const pedals = $derived(bridgeStatus.pedals);
	const loop = $derived(pedals.loop);
	const loopLearned = $derived(loop.pedals.length > 0);

	function describe(p: Pedal): string {
		const ch = p.channel === 0 ? 'Any ch' : `Ch ${p.channel}`;
		return `CC ${p.cc} · ${ch}${p.mode === 'latching' ? ' · Latch' : ''}`;
	}

	const learning = (role: PedalRole) => pedals.learn?.role === role && pedals.learn.state === 'listening';
	const timedOut = (role: PedalRole) => pedals.learn?.role === role && pedals.learn.state === 'timeout';

	const loopState = $derived(
		!loopLearned
			? 'Learn one below: a foot switch or a keyboard’s pedal.'
			: !loop.enabled
				? 'Off: the pedals are ignored.'
				: loop.heard
					? 'Heard since Vamp started.'
					: 'Not heard yet: press a pedal to check it.'
	);

	const wahRows = $derived([
		{ role: 'wahToe' as const, label: 'Wah toe switch', what: 'Loads the wah, then steps its sound.', ...pedals.wahToe },
		{ role: 'wahSweep' as const, label: 'Wah sweep', what: 'Sweeps the wah, or MidiWheels’ mod wheel on a synth.', ...pedals.wahSweep }
	]);

	function toggleLearn(role: PedalRole) {
		setPedalLearn(role, !learning(role));
	}

	// --- Ableton Move --------------------------------------------------------
	// The Move reaches Vamp only through the bridge's own MIDI inputs, so its
	// switch exists only while that switch is on (audit §7b).
	const moveShown = $derived(bridgeStatus.isFeatureOn('midiControllers'));
	function toggleMoveKnob() {
		logger.debug('Toggling session setting', { component: 'ControllersSection', key: 'move_volume_knob' });
		setMoveVolumeKnob(!session.moveVolumeKnobEnabled);
	}
</script>

<div class="set-section">
	<p class="set-lead">The pedals and hardware you play Vamp with.</p>

	<section class="set-group" data-debug="settings-pedals">
		<h3 class="set-group-title">Pedals</h3>
		{#if !pedals.known}
			<p class="set-note">Waiting for Vamp’s server.</p>
		{:else}
			<div class="set-list">
				{#if !pedals.available}
					<div class="set-row" data-debug="pedals-unavailable">
						<span class="set-row-main">
							<span class="set-row-label">Vamp can’t read MIDI on this Mac</span>
							<span class="set-row-sub set-row-reason">{pedals.reason || 'No MIDI inputs.'}</span>
						</span>
					</div>
				{/if}
				<button
					class="set-row set-row-button"
					aria-pressed={loop.enabled}
					aria-label={`Loop pedal ${loop.enabled ? 'on' : 'off'}${loopLearned ? `, ${loop.pedals.map(describe).join(', ')}` : ', none learned'}`}
					onclick={() => setLoopPedalsEnabled(!loop.enabled)}
					data-debug="loop-pedal-toggle"
				>
					<span class="set-row-main">
						<span class="set-row-label">Loop pedal</span>
						<span class="pedal-mappings">
							{#each loop.pedals as p (`${p.channel}:${p.cc}`)}
								<span class="pedal-mapping">{describe(p)}</span>
							{:else}
								<span class="pedal-mapping unlearned">Not learned</span>
							{/each}
						</span>
						<span class="set-row-sub pedal-state">
							{#if loop.enabled && loopLearned}<span class="pedal-dot" class:heard={loop.heard} aria-hidden="true"></span>{/if}
							{loopState}
						</span>
					</span>
					<span class="set-chip" class:on={loop.enabled} aria-hidden="true">{loop.enabled ? 'On' : 'Off'}</span>
				</button>
				<button
					class="set-row set-row-button"
					aria-pressed={learning('loop')}
					onclick={() => toggleLearn('loop')}
					data-debug="loop-pedal-learn"
					data-learn={pedals.learn?.role === 'loop' ? pedals.learn.state : 'idle'}
				>
					<span class="set-row-main">
						{#if learning('loop')}
							<span class="set-row-label">Press your pedal…</span>
							<span class="set-row-sub">Listening on every MIDI input but the Move’s own.</span>
						{:else if timedOut('loop')}
							<span class="set-row-label">Nothing heard</span>
							<span class="set-row-sub set-row-reason">Check the pedal is plugged in, then try again.</span>
						{:else}
							<span class="set-row-label">{loopLearned ? 'Add another pedal' : 'Learn your pedal'}</span>
							<span class="set-row-sub">Tap, then press and release the pedal.</span>
						{/if}
					</span>
					<span class="set-chip action" class:on={learning('loop')} class:pulse={learning('loop')} aria-hidden="true">
						{learning('loop') ? 'Cancel' : timedOut('loop') ? 'Try again' : 'Learn'}
					</span>
				</button>
				{#if loopLearned}
					<button class="set-row set-row-button" onclick={() => forgetPedals('loop')} data-debug="loop-pedal-forget">
						<span class="set-row-main">
							<span class="set-row-label">Forget {loop.pedals.length === 1 ? 'this pedal' : 'these pedals'}</span>
							<span class="set-row-sub">Then learn the one you play.</span>
						</span>
						<span class="set-chip action" aria-hidden="true">Forget</span>
					</button>
				{/if}
				{#if pedals.wah}
					{#each wahRows as row (row.role)}
						<button
							class="set-row set-row-button"
							aria-pressed={learning(row.role)}
							onclick={() => toggleLearn(row.role)}
							data-debug={`${row.role === 'wahToe' ? 'wah-toe' : 'wah-sweep'}-learn`}
							data-learn={pedals.learn?.role === row.role ? pedals.learn.state : 'idle'}
						>
							<span class="set-row-main">
								<span class="set-row-label">{row.label}</span>
								<span class="pedal-mapping" class:unlearned={!row.pedal}>{row.pedal ? describe(row.pedal) : 'Not learned'}</span>
								{#if learning(row.role)}
									<span class="set-row-sub">Move the pedal… listening on every input but the Move’s own.</span>
								{:else if timedOut(row.role)}
									<span class="set-row-sub set-row-reason">Nothing heard. Check the pedal, then try again.</span>
								{:else}
									<span class="set-row-sub pedal-state">
										{#if row.pedal}<span class="pedal-dot" class:heard={row.heard} aria-hidden="true"></span>{/if}
										{row.what}
									</span>
								{/if}
							</span>
							<span class="set-chip action" class:on={learning(row.role)} class:pulse={learning(row.role)} aria-hidden="true">
								{learning(row.role) ? 'Cancel' : timedOut(row.role) ? 'Try again' : 'Learn'}
							</span>
						</button>
					{/each}
				{/if}
			</div>
			<p class="set-note">Any MIDI input works, with nothing to set up in Live.</p>
		{/if}
	</section>

	{#if moveShown}
		<section class="set-group" data-debug="settings-move">
			<h3 class="set-group-title">Ableton Move</h3>
			<div class="set-list">
				<button
					class="set-row set-row-button"
					aria-pressed={session.moveVolumeKnobEnabled}
					onclick={toggleMoveKnob}
					data-setting="move_volume_knob"
				>
					<span class="set-row-main">
						<span class="set-row-label">Move Knob</span>
						<span class="set-row-sub">Move’s knob sets the volume of the selected track.</span>
					</span>
					<span class="set-chip" class:on={session.moveVolumeKnobEnabled} aria-hidden="true">
						{session.moveVolumeKnobEnabled ? 'On' : 'Off'}
					</span>
				</button>
			</div>
		</section>
	{/if}
</div>

<style>
	.pedal-mappings {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		margin: 0.125rem 0;
	}
	.pedal-mapping {
		align-self: flex-start;
		padding: 0.125rem 0.5rem;
		font-size: 0.875rem;
		font-weight: var(--font-weight-medium);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.pedal-mapping.unlearned {
		color: var(--muted-foreground);
		border-style: dashed;
	}
	.pedal-state {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
	}
	.pedal-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		border: 1px solid currentColor;
		flex-shrink: 0;
	}
	.pedal-dot.heard {
		background: var(--act-play);
		border-color: var(--act-play);
	}
</style>
