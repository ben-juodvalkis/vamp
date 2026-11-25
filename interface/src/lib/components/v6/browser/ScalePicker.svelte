<script lang="ts">
	/**
	 * The browser's Key mode: what the surface detected (ADR-446), then the
	 * twelve roots and the scale names. Its controls in the bar (Following /
	 * Locked, Detect key) are `ScaleKeyControls`; the two share `KeyDetect`.
	 *
	 * A key picked by hand is a key to keep (ADR-447). The surface turns
	 * Follow off itself when a `scale_root` / `scale_name` write arrives from
	 * any client, before the write, so a pick locks the key without this
	 * component saying so, and a pick of the key already set locks too.
	 */
	import { session } from '$lib/stores/session.svelte';
	import { pickRootNote, pickScaleName, pickKey } from '$lib/services/sessionCommands';
	import { ROOT_NOTES, SCALE_NAMES, getScaleIndex } from '$lib/data/scales';
	import type { KeyDetect } from './keyDetect.svelte';

	let { keyDetect }: { keyDetect: KeyDetect } = $props();

	const detected = $derived(session.scaleDetected);
	/** The vote ladder, one line per vote. */
	const reasons = $derived(detected ? detected.reasons.split(' | ') : []);
	// "set" is a claim about NOW: shown only while Live's key is still the one
	// the detection wrote, not after a hand pick or a new set moved it.
	const detectedIsCurrent = $derived(
		!!detected &&
			detected.applied &&
			session.rootNote === detected.root &&
			session.scaleName === getScaleIndex(detected.scale)
	);

	// Root and scale together — the runner-up chip: one write each, one mode.
	function applyRunnerUp() {
		if (!detected || detected.runnerRoot < 0 || !detected.runnerScale) return;
		pickKey(detected.runnerRoot, detected.runnerScale);
	}
</script>

{#if detected}
	<!-- ADR-446: what the surface heard. The tooltip is the audit
	     trail — every vote that decided it, one per line. -->
	<div class="scale-section detected-section" title={reasons.join('\n')}>
		<button
			class="scale-heading reasons-toggle"
			onclick={() => (keyDetect.showReasons = !keyDetect.showReasons)}
			aria-expanded={keyDetect.showReasons}
			aria-label="Detected key; tap to show why"
		>
			Detected {keyDetect.showReasons ? '▾' : '▸'}
		</button>
		<div class="detected-row">
			{#if detected.band === 'no-key'}
				<span class="detected-key none">No key</span>
				<span class="detected-band">{reasons.at(-1)}</span>
			{:else}
				<span class="detected-key">{ROOT_NOTES[detected.root]} {detected.scale}</span>
				<span class="detected-band {detected.band}">{detected.band}{detectedIsCurrent ? ' · set' : ''}</span>
				{#if detected.runnerRoot >= 0}
					<button class="runner-up" onclick={applyRunnerUp}>
						or {ROOT_NOTES[detected.runnerRoot]} {detected.runnerScale}
					</button>
				{/if}
			{/if}
		</div>
		{#if keyDetect.showReasons}
			<ul class="reasons">
				<!-- Keyed by position: two clips can say the same line, and the list is
				     replaced whole on every answer. -->
				{#each reasons as line, i (i)}
					<li>{line}</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
<div class="scale-section roots-section">
	<div class="scale-heading">Root</div>
	<div class="roots">
		{#each ROOT_NOTES as note, i}
			<button
				class="root-key"
				class:selected={session.rootNote === i}
				onclick={() => pickRootNote(i)}
			>{note}</button>
		{/each}
	</div>
</div>
<div class="scale-section scales-section">
	<div class="scale-heading">Scale</div>
	<div class="scale-grid">
		{#each SCALE_NAMES as name}
			<button
				class="scale-key"
				class:selected={session.scaleName === getScaleIndex(name)}
				onclick={() => pickScaleName(name)}
			>{name}</button>
		{/each}
	</div>
</div>

<style>
	/* Scale grid keeps a simple responsive auto-fill (fixed 32-item list). */
	.scale-grid {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		grid-auto-rows: minmax(96px, 1fr);
		gap: var(--grid-gap, 8px);
		align-content: start;
		scrollbar-width: none;
	}
	.scale-grid::-webkit-scrollbar { display: none; }

	/* The scale grid fills what the roots leave. */
	.scales-section { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
	.scale-heading { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-foreground, #8a8f9c); font-weight: 650; margin-bottom: var(--spacing-sm); }
	/* Roots in two rows of six (matches the request; also gives bigger tap targets
	   than the old single row of twelve). */
	.roots { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--spacing-sm); }

	.reasons-toggle { background: none; border: 0; padding: 0; text-align: left; cursor: pointer; }
	.reasons { margin: var(--spacing-sm) 0 0; padding-left: 1.2em; color: var(--muted-foreground, #8a8f9c); font-size: 14px; line-height: 1.5; }
	.detected-row { display: flex; align-items: baseline; gap: var(--spacing-md); flex-wrap: wrap; }
	.detected-key { font-size: 24px; font-weight: var(--font-weight-semibold); color: var(--foreground, #eef0f4); }
	.detected-key.none { color: var(--muted-foreground, #8a8f9c); }
	.detected-band { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-foreground, #8a8f9c); }
	.detected-band.sure { color: var(--accent); }
	.detected-band.unsure { color: var(--destructive, #e5484d); }
	.runner-up {
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--browser-border, #2a2e37);
		background: transparent;
		color: var(--foreground, #eef0f4);
		font-size: 14px;
		cursor: pointer;
	}
	.runner-up:active { transform: scale(0.96); }

	/* Root notes and scale names share ONE key style so they read identically:
	   neutral dark chip when unselected, solid-orange accent chip when selected. */
	.root-key,
	.scale-key {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 64px;
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: 14px;
		border: 1px solid var(--browser-border, #2a2e37);
		background: var(--browser-bg-secondary, #1d2027);
		color: var(--foreground, #eef0f4);
		font-size: 22px;
		font-weight: 700;
		line-height: 1.15;
		text-wrap: balance;
		cursor: pointer;
		transition: background-color 0.12s, border-color 0.12s, box-shadow 0.12s, color 0.12s;
	}
	/* Scale names are longer than the single-glyph roots — a touch smaller so they
	   fit the chip without wrapping awkwardly. */
	.scale-key { font-size: 18px; }
	.root-key:active,
	.scale-key:active { transform: scale(0.96); }
	/* Selected — filled in the scale accent (orange) with a glow, so the current
	   root / scale reads at a glance. Identical for both. */
	.root-key.selected,
	.scale-key.selected {
		background: #ff9500;
		border-color: #ff9500;
		color: #1a1206;
		box-shadow: 0 0 0 1px #ff9500, 0 0 14px color-mix(in oklab, #ff9500 55%, transparent);
	}

	/* Flat grammar: control fields; the selected root / scale is the one
	   ON colour (ChosenDefault) with dark text — no orange literal, no
	   glow. Heading in normal case, no tracking. */
	:global([data-grammar="flat"]) .scale-heading {
		text-transform: none;
		letter-spacing: 0;
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .root-key,
	:global([data-grammar="flat"]) .scale-key {
		border-radius: 2px;
		border-color: var(--line-strong);
		background: var(--surface-well);
		color: var(--foreground);
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .root-key.selected,
	:global([data-grammar="flat"]) .scale-key.selected {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
		box-shadow: none;
	}
	/* Light: the ON fill sits at ~1:1 luminance against the light ladder,
	   so the frame stays dark. */
	:global(.light[data-grammar="flat"]) .root-key.selected,
	:global(.light[data-grammar="flat"]) .scale-key.selected {
		border-color: var(--line-strong);
	}
</style>
