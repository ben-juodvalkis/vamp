<script lang="ts">
	/**
	 * Settings → Controllers (ADR-534): the hardware you play Vamp with. The
	 * foot switch (on/off and Learn, the surface's
	 * `/looping/v3/session/foot_switch`) and, while the owner's Max patch is
	 * up, Ableton Move's knobs. Both were in General; the Move switch sat
	 * among Behavior's.
	 *
	 * Every row is its own button, echo-confirmed: it shows what the surface
	 * says, not what was tapped. Learn's row draws its action as a button on
	 * the right (Learn, Cancel, Try again) so it reads as one; the whole row
	 * still takes the tap.
	 */
	import { logger } from '$lib/utils/logger';
	import { session } from '$lib/stores/session.svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { setMoveVolumeKnob, setFootSwitchEnabled, setFootSwitchLearn } from '$lib/services/sessionCommands';

	// --- Foot switch ---------------------------------------------------------
	const foot = $derived(session.footSwitch);
	const footLearned = $derived(foot.cc >= 0);
	const footListening = $derived(foot.learn === 'listening');
	const footTimedOut = $derived(foot.learn === 'timeout');
	const footMapping = $derived(
		footLearned
			? `CC ${foot.cc} · ${foot.channel === 0 ? 'Any ch' : `Ch ${foot.channel}`}${foot.mode === 'latching' ? ' · Latch' : ''}`
			: 'Not learned'
	);
	const footState = $derived(
		!footLearned
			? 'Learn one below: turning it on learns one too.'
			: !foot.enabled
				? 'Off: the surface ignores the pedal.'
				: foot.heard
					? 'Heard since Live loaded the set.'
					: 'Not heard yet: press the pedal to check it.'
	);

	function toggleFootSwitch() {
		setFootSwitchEnabled(!foot.enabled);
	}

	function toggleFootLearn() {
		setFootSwitchLearn(!footListening);
	}

	// --- Ableton Move --------------------------------------------------------
	// The Move reaches the surface only through the owner's Max patch, so the
	// switch exists only while that patch does (audit §7b).
	const moveShown = $derived(bridgeStatus.isFeatureOn('maxUtilityPatch'));
	function toggleMoveKnob() {
		logger.debug('Toggling session setting', { component: 'ControllersSection', key: 'move_volume_knob' });
		setMoveVolumeKnob(!session.moveVolumeKnobEnabled);
	}
</script>

<div class="set-section">
	<p class="set-lead">The pedals and hardware you play Vamp with.</p>

	<section class="set-group" data-debug="settings-foot-switch">
		<h3 class="set-group-title">Foot switch</h3>
		<div class="set-list">
			<button
				class="set-row set-row-button"
				aria-pressed={foot.enabled}
				aria-label={`Foot switch ${foot.enabled ? 'on' : 'off'}, ${footMapping}`}
				onclick={toggleFootSwitch}
				data-debug="foot-switch-toggle"
			>
				<span class="set-row-main">
					<span class="set-row-label">Foot switch</span>
					<span class="foot-mapping" class:unlearned={!footLearned}>{footMapping}</span>
					<span class="set-row-sub foot-state">
						{#if foot.enabled && footLearned}<span class="foot-dot" class:heard={foot.heard} aria-hidden="true"></span>{/if}
						{footState}
					</span>
				</span>
				<span class="set-chip" class:on={foot.enabled} aria-hidden="true">{foot.enabled ? 'On' : 'Off'}</span>
			</button>
			<button
				class="set-row set-row-button"
				aria-pressed={footListening}
				onclick={toggleFootLearn}
				data-debug="foot-switch-learn"
				data-learn={foot.learn}
			>
				<span class="set-row-main">
					{#if footListening}
						<span class="set-row-label">Press your pedal…</span>
						<span class="set-row-sub">Listening for it on Vamp’s MIDI Input.</span>
					{:else if footTimedOut}
						<span class="set-row-label">Nothing heard</span>
						<span class="set-row-sub set-row-reason">Set the pedal as Vamp’s Input in Live’s MIDI settings, then try again.</span>
					{:else}
						<span class="set-row-label">{footLearned ? 'Learn another pedal' : 'Learn your pedal'}</span>
						<span class="set-row-sub">Tap, then press and release the pedal.</span>
					{/if}
				</span>
				<span class="set-chip action" class:on={footListening} class:pulse={footListening} aria-hidden="true">
					{footListening ? 'Cancel' : footTimedOut ? 'Try again' : 'Learn'}
				</span>
			</button>
		</div>
		<p class="set-note">
			Any MIDI foot switch works once it is the Vamp control surface’s Input, in Live → Settings → Link, Tempo &amp; MIDI.
		</p>
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
						<span class="set-row-sub">Move’s knobs set the volume of the selected track or drum chain.</span>
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
	.foot-mapping {
		align-self: flex-start;
		margin: 0.125rem 0;
		padding: 0.125rem 0.5rem;
		font-size: 0.875rem;
		font-weight: var(--font-weight-medium);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.foot-mapping.unlearned {
		color: var(--muted-foreground);
		border-style: dashed;
	}
	.foot-state {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
	}
	.foot-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		border: 1px solid currentColor;
		flex-shrink: 0;
	}
	.foot-dot.heard {
		background: var(--act-play);
		border-color: var(--act-play);
	}
</style>
