<script lang="ts">
	/**
	 * Settings → General: Behavior, Appearance, Capture and the Foot Switch.
	 * All but Capture left the System view (plan.md §11) on their old
	 * addresses; Capture says what REC records, kept on this screen.
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
	import {
		setAutoArm,
		setAutoCapture,
		setMoveVolumeKnob,
		setFootSwitchEnabled,
		setFootSwitchLearn
	} from '$lib/services/sessionCommands';
	import { theme, resolvedTheme, themeActions, type Theme } from '$lib/stores/theme';
	import {
		captureSettings,
		channelsFor,
		type CaptureSource,
		type ChannelMode,
		type InputDevice
	} from '$lib/stores/v6/captureSettingsStore.svelte';
	import { captureStore } from '$lib/stores/v6/captureStore.svelte';
	import { onMount } from 'svelte';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';

	// --- Behavior ---------------------------------------------------------
	const behaviorToggles: {
		key: string;
		label: string;
		set: (on: boolean) => void;
		what: string;
		enabled: () => boolean;
		shown?: () => boolean;
	}[] = [
		{
			key: 'auto_arm',
			label: 'Auto-Arm',
			set: setAutoArm,
			what: 'Arms the track you select, and disarms the one before.',
			enabled: () => session.autoArmEnabled
		},
		{
			key: 'auto_capture',
			label: 'Auto Rec',
			set: setAutoCapture,
			what: 'Arms arrangement recording when you press play, and asks to Save As when you stop.',
			enabled: () => session.autoCaptureEnabled
		},
		{
			key: 'move_volume_knob',
			label: 'Move Knob',
			set: setMoveVolumeKnob,
			what: 'Ableton Move’s knobs set the volume of the selected track or drum chain.',
			enabled: () => session.moveVolumeKnobEnabled,
			// The Move reaches the surface only through the owner's Max patch,
			// so the switch exists only while that patch does (audit §7b).
			shown: () => bridgeStatus.isFeatureOn('maxUtilityPatch')
		}
	];

	function toggleBehavior(key: string, set: (on: boolean) => void, current: boolean) {
		logger.debug('Toggling session setting', { component: 'SettingsPage', key, from: current });
		set(!current);
	}

	// --- Appearance -------------------------------------------------------
	const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon },
		{ id: 'system', label: 'Auto', icon: Monitor }
	];

	// --- Capture ----------------------------------------------------------
	const CAPTURE_SOURCES: { id: CaptureSource; label: string }[] = [
		{ id: 'track', label: 'Track' },
		{ id: 'input', label: 'Input' }
	];
	const CHANNEL_MODES: { id: ChannelMode; label: string }[] = [
		{ id: 'stereo', label: 'Stereo' },
		{ id: 'mono', label: 'Mono' }
	];

	// The devices Vamp for Mac offers, with the picked one kept while it is
	// not offered (the app stopped, the interface unplugged).
	const offered = $derived(captureStore.inputDevices);
	const picked = $derived(captureSettings.device);
	const deviceChips = $derived<{ device: InputDevice | null; label: string; missing: boolean }[]>([
		{ device: null, label: 'Live', missing: false },
		...offered.map((d) => ({ device: d, label: d.name, missing: false })),
		...(picked && !offered.some((d) => d.uid === picked.uid) ? [{ device: picked, label: picked.name, missing: true }] : [])
	]);
	const channelOptions = $derived(channelsFor(captureSettings.inputs, captureSettings.mode));

	// The picked device's live levels, for the meter under each channel.
	const levels = $derived(
		captureStore.inputLevels?.uid === captureSettings.deviceUid ? captureStore.inputLevels : null
	);
	function channelLevels(ch: string): number[] {
		const l = levels?.levels ?? [];
		return ch.split('/').map((n) => l[Number(n) - 1] ?? 0);
	}

	// While the picker is up on a device, keep asking Vamp for Mac for its
	// levels: the app closes the device a few seconds after the last ask.
	const monitoring = $derived(captureSettings.source === 'input' ? captureSettings.deviceUid : '');
	$effect(() => {
		const uid = monitoring;
		if (!uid) return;
		captureStore.monitorInput(uid);
		const timer = setInterval(() => captureStore.monitorInput(uid), 2000);
		return () => {
			clearInterval(timer);
			captureStore.monitorInput('');
		};
	});

	onMount(() => captureStore.queryInputDevices());

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
		setFootSwitchEnabled(!foot.enabled);
	}

	function toggleFootLearn() {
		setFootSwitchLearn(!footListening);
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
					onclick={() => toggleBehavior(t.key, t.set, t.enabled())}
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

	<section class="set-group" data-debug="settings-capture">
		<h2 class="set-group-title">Capture</h2>
		<div class="set-list">
			<div class="set-row">
				<span class="set-row-main">
					<span class="set-row-label">REC records</span>
					<span class="set-row-sub">
						{captureSettings.source === 'track' ? 'The selected track, after its effects.' : 'An audio input.'}
					</span>
				</span>
				<div class="set-segmented set-segmented-2" role="group" aria-label="REC records">
					{#each CAPTURE_SOURCES as c (c.id)}
						<button
							class="set-segment"
							class:on={captureSettings.source === c.id}
							aria-pressed={captureSettings.source === c.id}
							onclick={() => captureSettings.setSource(c.id)}
							data-capture-source={c.id}
						>
							<span>{c.label}</span>
						</button>
					{/each}
				</div>
			</div>
			{#if captureSettings.source === 'input'}
				<div class="set-capture-input">
					<div class="set-chips" role="group" aria-label="Input device">
						{#each deviceChips as chip (chip.device?.uid ?? '')}
							{@const on = (chip.device?.uid ?? '') === captureSettings.deviceUid}
							<button
								class="set-chip-button"
								class:on
								class:missing={chip.missing}
								aria-pressed={on}
								title={chip.missing ? `${chip.label} (not connected)` : chip.label}
								onclick={() => captureSettings.setDevice(chip.device)}
								data-capture-device={chip.device?.uid ?? ''}
							>
								{chip.label}
							</button>
						{/each}
					</div>
					<div class="set-capture-channels">
						<div class="set-segmented set-segmented-2 set-mode" role="group" aria-label="Mono or stereo">
							{#each CHANNEL_MODES as m (m.id)}
								<button
									class="set-segment"
									class:on={captureSettings.mode === m.id}
									aria-pressed={captureSettings.mode === m.id}
									onclick={() => captureSettings.setMode(m.id)}
									data-capture-mode={m.id}
								>
									<span>{m.label}</span>
								</button>
							{/each}
						</div>
						<div class="set-channel-grid" role="group" aria-label="Input channel">
							{#each channelOptions as ch (ch)}
								<button
									class="set-segment set-channel"
									class:on={captureSettings.channel === ch}
									aria-pressed={captureSettings.channel === ch}
									onclick={() => captureSettings.setChannel(ch)}
									data-capture-channel={ch}
								>
									<span>{ch}</span>
									{#if captureSettings.deviceUid}
										<span class="set-meters" aria-hidden="true">
											{#each channelLevels(ch) as level, i (i)}
												<span class="set-meter"><span class="set-meter-fill" style:width={`${level * 100}%`}></span></span>
											{/each}
										</span>
									{/if}
								</button>
							{/each}
						</div>
					</div>
					<p class="set-capture-note" data-capture-access={levels?.access ?? ''}>
						{#if !captureSettings.deviceUid}
							Live’s own audio input, recorded by Vamp-Capture on the track.
						{:else if picked && !offered.some((d) => d.uid === picked.uid)}
							Not connected, or Vamp for Mac isn’t running.
						{:else if levels?.access === 'denied'}
							Vamp for Mac can’t hear inputs: allow it in System Settings → Privacy &amp; Security → Microphone.
						{:else if levels?.access === 'undetermined'}
							Allow Vamp to use the microphone on the Mac to see levels and record.
						{:else}
							Recorded by Vamp for Mac, beside Live.
						{/if}
					</p>
				</div>
			{/if}
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
						<span class="set-row-sub">Listening for it on Vamp’s MIDI Input. Tap to cancel.</span>
					{:else if footTimedOut}
						<span class="set-row-label">Nothing heard</span>
						<span class="set-row-sub">Set the pedal as Vamp’s Input in Live’s MIDI settings, then tap to try again</span>
					{:else}
						<span class="set-row-label">Learn</span>
						<span class="set-row-sub">Tap, then press and release your pedal.</span>
					{/if}
				</span>
				{#if footListening}<span class="set-chip on" aria-hidden="true">Listening</span>{/if}
			</button>
		</div>
		<p class="set-note">Any MIDI foot switch works once it is the Vamp control surface’s Input, in Live → Settings → Link, Tempo &amp; MIDI.</p>
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
	.set-segmented-2 {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		width: min(100%, 14rem);
	}
	.set-capture-input {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--spacing-md);
		padding: var(--spacing-md) var(--spacing-lg);
		border-top: 1px solid var(--line-strong);
	}
	.set-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
	}
	.set-chip-button {
		min-height: var(--height-touch);
		max-width: 16rem;
		padding: 0 var(--spacing-md, 0.75rem);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: 9999px;
		cursor: pointer;
	}
	.set-chip-button.on {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	.set-chip-button.missing {
		opacity: 0.55;
		border-style: dashed;
	}
	.set-capture-channels {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--spacing-sm);
	}
	.set-mode {
		width: 11rem;
	}
	.set-channel-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4rem, 1fr));
		gap: var(--spacing-xs);
	}
	.set-channel {
		flex-direction: column;
		gap: 3px;
		padding: var(--spacing-xs);
		font-variant-numeric: tabular-nums;
	}
	.set-meters {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
	}
	.set-meter {
		display: block;
		height: 5px;
		border-radius: 2px;
		background: var(--line-strong);
		overflow: hidden;
	}
	.set-meter-fill {
		display: block;
		height: 100%;
		background: var(--phosphor);
		transition: width 80ms linear;
	}
	.set-channel.on .set-meter {
		background: color-mix(in srgb, var(--flat-on-fg) 25%, transparent);
	}
	.set-channel.on .set-meter-fill {
		background: var(--flat-on-fg);
	}
	.set-capture-note {
		margin: 0;
		font-size: 0.8125rem;
		opacity: 0.75;
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
