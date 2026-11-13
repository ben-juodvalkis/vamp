<script lang="ts">
	/**
	 * Settings → Recording (ADR-534): everything that records or arms, in one
	 * place. The two REC buttons first (the sidebar's records the input picked
	 * here, the clip view's the track: separate since 2026-11-13, so there is
	 * no Track | Input switch), then the two things
	 * Live does for you: Auto Rec (the arrangement, on Play) and Auto-Arm
	 * (the selected track). They sat in General beside the theme, with REC's
	 * picker two groups away, and "Auto Rec" and "REC records" read as one
	 * thing in two places.
	 *
	 * The input is two dropdowns, the device and the channel (Ben, 2026-11-13:
 * a chip per device and a button per channel was a wall of buttons), with
 * Stereo | Mono beside the channel. The channel's is drawn by the page
 * (`ChannelMenu`), so every row of it carries that input's live level: a
 * system <select> shows text only.
 *
 * Each switch is a whole row — the name, what it does, and its state on
	 * the right — so what a switch does is on the glass rather than in a
	 * tooltip an iPad never shows. Auto Rec and Auto-Arm are echo-confirmed:
	 * the row shows what the surface says, not what was tapped.
	 */
	import { onMount } from 'svelte';
	import { logger } from '$lib/utils/logger';
	import { session } from '$lib/stores/session.svelte';
	import { setAutoArm, setAutoCapture } from '$lib/services/sessionCommands';
	import {
		captureSettings,
		channelsFor,
		type ChannelMode,
		type InputDevice
	} from '$lib/stores/v6/captureSettingsStore.svelte';
	import { captureStore } from '$lib/stores/v6/captureStore.svelte';
	import ChannelMenu from './ChannelMenu.svelte';

	// --- What Live does for you ----------------------------------------------
	const toggles: { key: string; label: string; set: (on: boolean) => void; what: string; enabled: () => boolean }[] = [
		{
			key: 'auto_capture',
			label: 'Auto Rec',
			set: setAutoCapture,
			what: 'Arms arrangement recording when you press Play, and asks to Save As when you stop.',
			enabled: () => session.autoCaptureEnabled
		},
		{
			key: 'auto_arm',
			label: 'Auto-Arm',
			set: setAutoArm,
			what: 'Arms the track you select, and disarms the one before.',
			enabled: () => session.autoArmEnabled
		}
	];

	function toggle(key: string, set: (on: boolean) => void, current: boolean) {
		logger.debug('Toggling session setting', { component: 'RecordingSection', key, from: current });
		set(!current);
	}

	// --- The REC button ------------------------------------------------------
	const CHANNEL_MODES: { id: ChannelMode; label: string }[] = [
		{ id: 'stereo', label: 'Stereo' },
		{ id: 'mono', label: 'Mono' }
	];

	// The devices Vamp for Mac offers, with the picked one kept while it is
	// not offered (the app stopped, the interface unplugged).
	const offered = $derived(captureStore.inputDevices);
	const picked = $derived(captureSettings.device);
	const pickedMissing = $derived(!!picked && !offered.some((d) => d.uid === picked.uid));
	const deviceOptions = $derived<{ device: InputDevice | null; label: string }[]>([
		{ device: null, label: 'Live’s audio input' },
		...offered.map((d) => ({ device: d, label: d.name })),
		...(picked && pickedMissing ? [{ device: picked, label: `${picked.name} (not connected)` }] : [])
	]);
	function pickDevice(uid: string) {
		captureSettings.setDevice(deviceOptions.find((o) => (o.device?.uid ?? '') === uid)?.device ?? null);
	}
	const channelOptions = $derived(channelsFor(captureSettings.inputs, captureSettings.mode));
	const channelLabel = (ch: string) => (ch.includes('/') ? `Inputs ${ch.replace('/', ' + ')}` : `Input ${ch}`);

	// The picked device's live levels, for the picked channel's meter.
	const levels = $derived(
		captureStore.inputLevels?.uid === captureSettings.deviceUid ? captureStore.inputLevels : null
	);
	function channelLevels(ch: string): number[] {
		const l = levels?.levels ?? [];
		return ch.split('/').map((n) => l[Number(n) - 1] ?? 0);
	}

	// While the picker is up on a device, keep its levels coming.
	$effect(() => captureStore.holdInputMonitor(captureSettings.deviceUid));

	onMount(() => captureStore.queryInputDevices());

	// What the picked input is, and whether it can be heard: one line under
	// the picker, a dot saying whether it is good to go.
	const inputNote = $derived.by((): { state: 'on' | 'waiting' | 'problem'; text: string } => {
		if (!captureSettings.deviceUid) return { state: 'on', text: 'Live’s own audio input, recorded by Vamp-Capture on the track.' };
		if (pickedMissing) return { state: 'problem', text: 'Not connected, or Vamp for Mac isn’t running.' };
		if (levels?.access === 'denied')
			return {
				state: 'problem',
				text: 'Vamp for Mac can’t hear inputs: allow it in System Settings → Privacy & Security → Microphone.'
			};
		if (levels?.access === 'undetermined')
			return { state: 'waiting', text: 'Allow Vamp to use the microphone on the Mac to see levels and record.' };
		return { state: 'on', text: 'Recorded by Vamp for Mac, beside Live.' };
	});
</script>

<div class="set-section">
	<p class="set-lead">What the two REC buttons record, and what Live arms for you while you play.</p>

	<section class="set-group" data-debug="settings-capture">
		<h3 class="set-group-title">REC button</h3>
		<div class="set-list">
			<div class="set-row set-row-stack">
				<span class="set-row-main">
					<span class="set-row-label">Two REC buttons</span>
					<span class="set-row-sub">The sidebar’s REC records the input below. The clip view’s REC records the selected track, after its effects.</span>
				</span>
			</div>
				<div class="set-subpanel">
					<label class="set-field">
						<span class="set-field-label">Device</span>
						<select
							class="set-select rec-device"
							aria-label="Input device"
							value={captureSettings.deviceUid}
							onchange={(e) => pickDevice((e.currentTarget as HTMLSelectElement).value)}
							data-capture-device
						>
							{#each deviceOptions as o (o.device?.uid ?? '')}
								<option value={o.device?.uid ?? ''}>{o.label}</option>
							{/each}
						</select>
					</label>
					<div class="set-field">
						<span class="set-field-label">Channel</span>
						<div class="rec-channel-row">
							<div class="set-segmented rec-mode" style:--set-segments={2} role="group" aria-label="Mono or stereo">
								{#each CHANNEL_MODES as m (m.id)}
									<button
										class="set-segment"
										class:on={captureSettings.mode === m.id}
										aria-pressed={captureSettings.mode === m.id}
										onclick={() => captureSettings.setMode(m.id)}
										data-capture-mode={m.id}
									>
										{m.label}
									</button>
								{/each}
							</div>
							<ChannelMenu
								options={channelOptions}
								value={captureSettings.channel}
								label={channelLabel}
								levelsOf={channelLevels}
								meters={!!captureSettings.deviceUid && !pickedMissing}
								disabled={channelOptions.length === 0}
								onpick={(ch) => captureSettings.setChannel(ch)}
							/>
						</div>
					</div>
					<p class="rec-note" data-capture-access={levels?.access ?? ''}>
						<span class="set-status" data-state={inputNote.state}><span class="set-status-dot" aria-hidden="true"></span></span>
						<span>{inputNote.text}</span>
					</p>
				</div>
		</div>
	</section>

	<section class="set-group" data-debug="settings-behavior">
		<h3 class="set-group-title">Automatic</h3>
		<div class="set-list">
			{#each toggles as t (t.key)}
				<button class="set-row set-row-button" aria-pressed={t.enabled()} onclick={() => toggle(t.key, t.set, t.enabled())} data-setting={t.key}>
					<span class="set-row-main">
						<span class="set-row-label">{t.label}</span>
						<span class="set-row-sub">{t.what}</span>
					</span>
					<span class="set-chip" class:on={t.enabled()} aria-hidden="true">{t.enabled() ? 'On' : 'Off'}</span>
				</button>
			{/each}
		</div>
	</section>
</div>

<style>
	.rec-device {
		width: min(100%, 22rem);
	}
	.rec-channel-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-sm) var(--spacing-md);
	}
	.rec-mode {
		width: 11rem;
	}
	.rec-note {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-sm);
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.rec-note .set-status {
		transform: translateY(0.0625rem);
	}
</style>
