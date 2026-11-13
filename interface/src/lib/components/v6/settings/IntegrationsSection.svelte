<script lang="ts">
	/**
	 * Settings → Integrations (ADR-534): every feature switch the bridge has
	 * named — each something outside the app the bridge talks to (the RME
	 * mixer, the Max patch, the pedal, the Mac's helpers) — on, off, or
	 * unavailable and why. It was the foot of Connection; it has its own
	 * section so Connection answers one question.
	 *
	 * A switch the bridge never named is off (bridgeStatus's rule), and is
	 * listed as off rather than hidden: the list is the answer to "what is on
	 * here?", so an absent row would be a missing answer. The ones that need
	 * attention come first.
	 */
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';

	const FEATURE_ROWS: { id: string; label: string; what: string }[] = [
		{ id: 'totalmix', label: 'TotalMix', what: 'RME TotalMix monitor faders' },
		{ id: 'maxUtilityPatch', label: 'Max Utility patch', what: 'Ableton Move knobs and pad hold, the piano-pedal looper' },
		{ id: 'expressionPedal', label: 'Expression pedal', what: 'The wah pedal and its toe switch' },
		{ id: 'menubar', label: 'Menu-bar app', what: 'The Mac menu-bar utility' },
		{ id: 'axHelper', label: 'AX helper', what: 'Reverse, Group, Save As and the held pad’s similar samples' },
		{ id: 'captureRecorder', label: 'Recorder', what: 'REC: loads Vamp-Capture onto the track it records' }
	];
	const ORDER = { unavailable: 0, on: 1, off: 2 };
	const featureRows = $derived.by(() => {
		const named = new Set(FEATURE_ROWS.map((r) => r.id));
		const extra = Object.keys(bridgeStatus.features)
			.filter((id) => !named.has(id))
			.map((id) => ({ id, label: id, what: '' }));
		return [...FEATURE_ROWS, ...extra]
			.map((row) => {
				const f = bridgeStatus.feature(row.id);
				const state: 'on' | 'off' | 'unavailable' = !f.enabled ? 'off' : f.available ? 'on' : 'unavailable';
				return { ...row, state, reason: state === 'unavailable' ? bridgeStatus.unavailableReason(row.id) : '' };
			})
			.sort((a, b) => ORDER[a.state] - ORDER[b.state]);
	});
	const counts = $derived({
		on: featureRows.filter((r) => r.state === 'on').length,
		unavailable: featureRows.filter((r) => r.state === 'unavailable').length
	});
	const FEATURE_WORD = { on: 'On', off: 'Off', unavailable: 'Unavailable' };
</script>

<div class="set-section">
	<p class="set-lead">
		What Vamp talks to on this Mac besides Live, and whether each is answering.
		<strong>{counts.on} on</strong>{#if counts.unavailable}, <strong class="int-warn">{counts.unavailable} not answering</strong>{/if}.
	</p>

	<section class="set-group" data-debug="settings-features">
		<h3 class="set-group-title">Features</h3>
		<ul class="set-list">
			{#each featureRows as row (row.id)}
				<li class="set-row" data-feature={row.id} data-state={row.state}>
					<span class="set-row-main">
						<span class="set-row-label">{row.label}</span>
						{#if row.what}<span class="set-row-sub">{row.what}</span>{/if}
						{#if row.state === 'unavailable'}<span class="set-row-sub set-row-reason">{row.reason}</span>{/if}
					</span>
					<span class="set-status" data-state={row.state === 'unavailable' ? 'problem' : row.state}>
						<span class="set-status-dot" aria-hidden="true"></span>{FEATURE_WORD[row.state]}
					</span>
				</li>
			{/each}
		</ul>
		<p class="set-note">All but the Recorder are switched on in the <code>features</code> block of this Mac’s <code>config/constants.local.json</code>, read when the bridge starts. The bridge says whether each answered.</p>
	</section>
</div>

<style>
	.int-warn {
		color: var(--act-warn) !important;
	}
	code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.75rem;
	}
</style>
