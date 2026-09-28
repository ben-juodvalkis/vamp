<script lang="ts">
	/**
	 * Settings → General: Behavior, Appearance and the Foot Switch, the cards
	 * that left the System view (plan.md §11) on their old addresses.
	 *
	 * Each switch is a whole row — the name, what it does, and its state on
	 * the right — so what a switch does is on the glass rather than in a
	 * tooltip an iPad never shows. Behavior and the foot switch are
	 * echo-confirmed: the row shows what the surface says, not what was
	 * tapped.
	 */
	import { logger } from '$lib/utils/logger';
	import { session } from '$lib/stores/session.svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { send } from '$lib/api/simpleClient';
	import {
		V3_SESSION_AUTO_ARM_ADDRESS,
		V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
		V3_SESSION_AUTO_CAPTURE_ADDRESS,
		V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS,
		V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS
	} from '$lib/api/handlers/v3Session';
	import { theme, resolvedTheme, themeActions, type Theme } from '$lib/stores/theme';
	import { Sun, Moon, Monitor } from 'lucide-svelte';

	// --- Behavior ---------------------------------------------------------
	const behaviorToggles: {
		key: string;
		label: string;
		address: string;
		what: string;
		enabled: () => boolean;
		shown?: () => boolean;
	}[] = [
		{
			key: 'auto_arm',
			label: 'Auto-Arm',
			address: V3_SESSION_AUTO_ARM_ADDRESS,
			what: 'Arms the track you select, and disarms the one before.',
			enabled: () => session.autoArmEnabled
		},
		{
			key: 'auto_capture',
			label: 'Auto Rec',
			address: V3_SESSION_AUTO_CAPTURE_ADDRESS,
			what: 'Arms arrangement recording when you press play, and asks to Save As when you stop.',
			enabled: () => session.autoCaptureEnabled
		},
		{
			key: 'move_volume_knob',
			label: 'Move Knob',
			address: V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
			what: 'Ableton Move’s knobs set the volume of the selected track or drum chain.',
			enabled: () => session.moveVolumeKnobEnabled,
			// The Move reaches the surface only through the owner's Max patch,
			// so the switch exists only while that patch does (audit §7b).
			shown: () => bridgeStatus.isFeatureOn('maxUtilityPatch')
		}
	];

	function toggleBehavior(address: string, current: boolean) {
		logger.debug('Toggling session setting', { component: 'SettingsPage', address, from: current });
		send(address, [current ? 0 : 1]);
	}

	// --- Appearance -------------------------------------------------------
	const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon },
		{ id: 'system', label: 'Auto', icon: Monitor }
	];

	// --- Foot switch ------------------------------------------------------
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
		send(V3_SESSION_FOOT_SWITCH_ENABLED_ADDRESS, [foot.enabled ? 0 : 1]);
	}

	function toggleFootLearn() {
		send(V3_SESSION_FOOT_SWITCH_LEARN_ADDRESS, [footListening ? 0 : 1]);
	}
</script>

<div class="set-section">
	<section class="set-group" data-debug="settings-behavior">
		<h2 class="set-group-title">Behavior</h2>
		<div class="set-list">
			{#each behaviorToggles.filter((t) => t.shown?.() ?? true) as t (t.key)}
				<button
					class="set-row set-row-button"
					aria-pressed={t.enabled()}
					onclick={() => toggleBehavior(t.address, t.enabled())}
					data-setting={t.key}
				>
					<span class="set-row-main">
						<span class="set-row-label">{t.label}</span>
						<span class="set-row-sub">{t.what}</span>
					</span>
					<span class="set-chip" class:on={t.enabled()} aria-hidden="true">{t.enabled() ? 'On' : 'Off'}</span>
				</button>
			{/each}
		</div>
	</section>

	<section class="set-group" data-debug="settings-appearance">
		<h2 class="set-group-title">Appearance</h2>
		<div class="set-list">
			<div class="set-row set-row-stack">
				<span class="set-row-main">
					<span class="set-row-label">Theme</span>
					<span class="set-row-sub">Auto follows this device’s light or dark setting ({$resolvedTheme} now).</span>
				</span>
				<div class="set-segmented" role="group" aria-label="Theme">
					{#each THEMES as t (t.id)}
						{@const Icon = t.icon}
						<button class="set-segment" class:on={$theme === t.id} aria-pressed={$theme === t.id} onclick={() => themeActions.set(t.id)}>
							<Icon class="set-btn-icon" aria-hidden="true" />
							<span>{t.label}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	</section>

	<section class="set-group" data-debug="settings-foot-switch">
		<h2 class="set-group-title">Foot Switch</h2>
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
					<span class="set-row-sub">
						<span class="set-foot-mapping">{footMapping}</span>
						<span class="set-foot-state">
							{#if foot.enabled && footLearned}<span class="set-foot-dot" class:heard={foot.heard} aria-hidden="true"></span>{/if}
							{footState}
						</span>
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
						<span class="set-row-sub">Listening for it on Looping’s MIDI Input. Tap to cancel.</span>
					{:else if footTimedOut}
						<span class="set-row-label">Nothing heard</span>
						<span class="set-row-sub">Set the pedal as Looping’s Input in Live’s MIDI settings, then tap to try again</span>
					{:else}
						<span class="set-row-label">Learn</span>
						<span class="set-row-sub">Tap, then press and release your pedal.</span>
					{/if}
				</span>
				{#if footListening}<span class="set-chip on" aria-hidden="true">Listening</span>{/if}
			</button>
		</div>
		<p class="set-note">Any MIDI foot switch works once it is the Looping control surface’s Input, in Live → Settings → Link, Tempo &amp; MIDI.</p>
	</section>
</div>

<style>
	.set-foot-mapping {
		display: block;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.set-foot-state {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
	}
	.set-foot-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		border: 1px solid currentColor;
		flex-shrink: 0;
	}
	.set-foot-dot.heard {
		background: var(--phosphor);
		border-color: var(--phosphor);
	}
	.set-segmented {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--spacing-xs);
		flex-shrink: 0;
		width: min(100%, 21rem);
	}
	.set-segment {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		min-height: var(--height-touch);
		padding: 0 var(--spacing-sm);
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.set-segment.on {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	:global(.light) .set-segment.on {
		border-color: var(--line-strong);
	}
	.set-segment:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
</style>
