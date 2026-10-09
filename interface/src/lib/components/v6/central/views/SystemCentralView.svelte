<script lang="ts">
import { logger } from '$lib/utils/logger';
	import { Button } from '$lib/components/ui/button';
	import { session } from '$lib/stores/session.svelte';
	import {
		toggleMetronome as sendMetronomeToggle,
		setTempo,
		setSignatureNumerator,
		setSignatureDenominator,
		setClipTriggerQuantization,
		setKeyFollow
	} from '$lib/services/sessionCommands';
	import { LAUNCH_QUANTIZATIONS, getLaunchQuantizationName } from '$lib/data/launchQuantization';
	import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
	import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
	import Settings from '@lucide/svelte/icons/settings';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { drag as dragAction, type DragInfo, type DragOptions } from '$lib/actions/drag';
	import SectionDivider from '../SectionDivider.svelte';

	// GRATICULE (§5.5): system accent calibrated through trackInk; the local
	// --sys / --sys-dim / --sys-bg mechanism is preserved, alpha variants now
	// layered via color-mix off the calibrated base instead of raw rgba literals.
	let sysInk = $derived(trackInk('#ff8800', paintModeReactive()));

	/**
	 * Tempo and time-signature drag digits (ADR-427).
	 *
	 * Both used to read `event.touches[0].clientY` — the first finger on
	 * the glass, not the finger that started this drag — with their own
	 * pair of `$effect`s adding and removing four window listeners each.
	 * Nudging the tempo while the other hand held a track name meant the
	 * tempo followed the name.
	 *
	 * `commit: 'immediate'` and `touch-action: none`: a drag digit is the
	 * value from touch-down, and there is nothing else these could be.
	 */
	let isDraggingTimeSignature = $state(false);
	let dragStartNumerator = $state(4);
	let dragStartDenominator = $state(4);
	let timeSignatureDragMode = $state<'numerator' | 'denominator' | null>(null);
	let lastTimeSignatureValue = $state<number | null>(null);

	let isDraggingTempo = $state(false);
	let tempoDragStartValue = $state(120);
	let lastTempoValue = $state<number | null>(null);

	// Valid denominators for time signature
	const validDenominators = [1, 2, 4, 8, 16];

	/** `deltaY` is pixels travelled UP from the press point. */
	function applyTimeSignatureDrag(deltaY: number) {
		if (!isDraggingTimeSignature || !timeSignatureDragMode) return;
		const sensitivity = 0.05; // Lower sensitivity for large display

		if (timeSignatureDragMode === 'numerator') {
			const rawValue = dragStartNumerator + deltaY * sensitivity;
			const newNumerator = Math.max(1, Math.min(32, Math.round(rawValue)));

			if (newNumerator !== lastTimeSignatureValue) {
				lastTimeSignatureValue = newNumerator;
				logger.debug('Setting numerator', { component: 'SystemCentralView', value: newNumerator });
				setSignatureNumerator(newNumerator);
			}
		} else if (timeSignatureDragMode === 'denominator') {
			const currentIndex = validDenominators.indexOf(dragStartDenominator);
			const rawIndexChange = deltaY * sensitivity * 0.3; // Slower for discrete stepping
			const newIndex = Math.max(0, Math.min(validDenominators.length - 1, Math.round(currentIndex + rawIndexChange)));
			const newDenominator = validDenominators[newIndex];

			if (newDenominator !== lastTimeSignatureValue) {
				lastTimeSignatureValue = newDenominator;
				logger.debug('Setting denominator', { component: 'SystemCentralView', value: newDenominator });
				setSignatureDenominator(newDenominator);
			}
		}
	}

	function timeSignatureDrag(mode: 'numerator' | 'denominator'): DragOptions {
		return {
			commit: 'immediate',
			touchAction: 'none',
			onStart: () => {
				isDraggingTimeSignature = true;
				timeSignatureDragMode = mode;
				dragStartNumerator = session.timeSignature.numerator;
				dragStartDenominator = session.timeSignature.denominator;
			},
			onMove: ({ dy }: DragInfo) => applyTimeSignatureDrag(dy),
			onEnd: () => {
				isDraggingTimeSignature = false;
				timeSignatureDragMode = null;
				lastTimeSignatureValue = null;
			}
		};
	}

	const numeratorDrag: DragOptions = $derived(timeSignatureDrag('numerator'));
	const denominatorDrag: DragOptions = $derived(timeSignatureDrag('denominator'));

	const tempoDrag: DragOptions = {
		commit: 'immediate',
		touchAction: 'none',
		onStart: () => {
			isDraggingTempo = true;
			tempoDragStartValue = Math.round(session.tempo);
		},
		onMove: ({ dy }: DragInfo) => {
			if (!isDraggingTempo) return;
			const sensitivity = 0.1; // Low sensitivity for fine-tuning
			const rawValue = tempoDragStartValue + dy * sensitivity;
			const newTempo = Math.max(20, Math.min(999, Math.round(rawValue)));

			if (newTempo !== lastTempoValue) {
				lastTempoValue = newTempo;
				logger.debug('Setting tempo', { component: 'SystemCentralView', value: newTempo });
				setTempo(newTempo);
			}
		},
		onEnd: () => {
			isDraggingTempo = false;
			lastTempoValue = null;
		}
	};

	// Launch quantization — Live's global clip-trigger grid. Tap-to-set
	// rather than a drag-digit: 14 discrete values are miserable to drag
	// through mid-set, and the one you want is usually a jump away
	// (1 Bar → None), not a neighbor.
	//
	// The 14 chips used to sit permanently across the foot of the view,
	// spending a whole row on a control that is set once and then left
	// alone for the rest of a set. They now live behind the value itself:
	// the current setting reads as a third transport digit beside tempo
	// and time signature, and tapping it opens the picker.
	let launchQuantOpen = $state(false);
	const launchQuantLabel = $derived(getLaunchQuantizationName(session.clipTriggerQuantization));

	function setLaunchQuantization(value: number) {
		launchQuantOpen = false;
		if (value === session.clipTriggerQuantization) return;
		logger.debug('Setting launch quantization', { component: 'SystemCentralView', value });
		setClipTriggerQuantization(value);
	}

	function onModalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') launchQuantOpen = false;
	}

	// Focus the panel on open so Escape reaches it without a tap first
	// (the iPad has no keyboard, but a Mac browser session does).
	function autofocus(node: HTMLElement) {
		node.focus();
	}

	// Metronome toggle
	function toggleMetronome() {
		const newState = session.metronome ? 0 : 1;
		logger.debug('Toggling metronome', { component: 'SystemCentralView', currentState: session.metronome, newState });
		sendMetronomeToggle();
	}

	// Follow Key stays beside Transport: it is musical (the key follows the
	// loops), where the setup switches — Auto-Arm, Auto Rec, the Move Knob,
	// the theme and the foot switch — moved to Settings (plan.md §11,
	// 2026-09-26), behind the gear in the view's top-right corner. Same address, same
	// echo as before.
	//
	// The write is **echo-confirmed, not optimistic** (deliberately unlike
	// metronome above, which is a LOM attr Live answers for). It is a
	// surface-side bool: a write sent mid-set-load — old surface torn
	// down, new one not yet up — reaches nobody, and an optimistic flip
	// would leave the button lying about a behavior that didn't change.
	// The echo lands in ~90ms, well under the eye's notice.
	const keyFollowTitle =
		'Re-detect the key and set it whenever what is playing changes. Picking a key by hand, here or in Live, turns it off until Live restarts or a set loads.';

	// The "what is on screen" switches, in the order the things they
	// control sit DOWN the (flipped) screen (Ben, 2026-09-26): the
	// transport header on the top edge, the FX grid under it, the clip
	// grid above the strips. Reading order is layout order, so the list is
	// a picture of the screen it builds. All three are persisted display prefs; none touch
	// Live.
	//
	// VIEW, PADS, FLIP and INST are gone (Ben, 2026-09-26): the central
	// view, the Drum Rack's pad column, the flipped stack and the strips'
	// device band are simply always on (`uiPrefsStore`). SOLO went
	// 2026-10-01: two fingers on a strip solo it, so there is no button.
	//
	// There is no MINI row. The mini session column — the selected
	// track's clip slots in the clip view's leading rail column — used to
	// have one, and the only layout it bought was "no clips visible
	// anywhere", which nobody wants. It is now simply the complement of
	// CLIPS (`uiPrefsStore.miniSessionActive`): full grid up, or clips in
	// miniature, never neither.
	const surfaceToggles = [
		{
			label: 'Header',
			ariaLabel: 'Show the transport header across the top',
			title: 'Show tempo, transport, metronome and stop-all across the top',
			on: () => uiPrefsStore.showTransportHeader,
			toggle: () => uiPrefsStore.toggleTransportHeader()
		},
		{
			label: 'FX',
			ariaLabel: 'FX grid section',
			title: 'Show the FX device grid section',
			on: () => uiPrefsStore.showFxGrid,
			toggle: () => uiPrefsStore.toggleFxGrid()
		},
		{
			label: 'Clips',
			ariaLabel: 'Session clip grid section',
			title: 'Show the session clip grid above the track strips',
			on: () => uiPrefsStore.sessionMode,
			toggle: () => uiPrefsStore.toggleSessionMode()
		}
	];

	function toggleKeyFollow() {
		const current = session.keyFollowEnabled;
		logger.debug('Toggling session setting', {
			component: 'SystemCentralView', setting: 'key_follow', from: current
		});
		setKeyFollow(!current);
	}
</script>

<div
	class="h-full w-full overflow-hidden relative sys-root"
	style="
		--sys: {sysInk};
		--sys-dim: color-mix(in srgb, {sysInk}, transparent 60%);
		--sys-hover: color-mix(in srgb, {sysInk}, transparent 40%);
		--sys-bg: color-mix(in srgb, {sysInk}, transparent 90%);
		--sys-bg-active: color-mix(in srgb, {sysInk}, transparent 80%);
	"
>
	<!-- The gear: Settings' door, in the view's top-right corner, level with
	     the section labels. Absolute, so it costs the grid no row and sits
	     outside the layout check (an overlay). -->
	<button
		class="sys-gear"
		aria-label="Open Settings"
		title="Settings: behavior, appearance, foot switch, Places, features, connection"
		onclick={() => settingsStore.openSettings()}
		data-debug="settings-gear"
	>
		<Settings class="h-6 w-6" />
	</button>

	<!-- Two groups in the Settings page's grammar (Ben, 2026-09-26): a quiet
	     title over each, the transport's values in fields, and every switch
	     a row that says its name and its state — On in Live's orange, Off a
	     frame — rather than a block that is orange or not. The setup that
	     used to share this row (Behavior, Appearance, Foot Switch) lives in
	     the full-page Settings behind the gear in the corner (plan.md §11).
	     The launch-quantization strip used to take a second row for 14
	     chips; it is a value beside tempo, and the picker opens on demand. -->
	<div
		class="h-full w-full p-(--central-inset) grid gap-(--central-gap)"
		style="grid-template-columns: minmax(0, 2fr) auto minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);"
	>
		<!-- Transport: the three global values Live snaps everything to, at
		     a size you can read from across a room, over the two musical
		     switches — the click, and the key following what plays. -->
		<section class="sys-group sys-transport">
			<h2 class="sys-section-label">Transport</h2>
			<div class="sys-transport-body">
				<div class="sys-field-row">
					<!-- Tempo -->
					<div class="sys-field select-none">
						<button
							class="sys-drag-digit"
							class:active={isDraggingTempo}
							use:dragAction={tempoDrag}
						>
							{Math.round(session.tempo)}
						</button>
						<span class="sys-label">BPM</span>
					</div>

					<!-- Time Signature -->
					<div class="sys-field select-none">
						<div class="flex items-center justify-center min-w-0">
							<button
								class="sys-drag-digit sys-num"
								class:active={timeSignatureDragMode === 'numerator'}
								use:dragAction={numeratorDrag}
							>
								{session.timeSignature.numerator}
							</button>
							<span class="sys-sep">/</span>
							<button
								class="sys-drag-digit sys-den"
								class:active={timeSignatureDragMode === 'denominator'}
								use:dragAction={denominatorDrag}
							>
								{session.timeSignature.denominator}
							</button>
						</div>
						<span class="sys-label">Time</span>
					</div>

					<!-- Launch quantization — a value, not a digit: it is a
					     14-step enum, so it opens the picker rather than dragging. -->
					<div class="sys-field select-none">
						<button
							class="sys-value-digit"
							class:active={launchQuantOpen}
							aria-haspopup="dialog"
							aria-expanded={launchQuantOpen}
							title="Global launch quantization — the grid clip launch and loop record snap to"
							onclick={() => (launchQuantOpen = true)}
						>
							{launchQuantLabel}
						</button>
						<span class="sys-label">Launch Q</span>
					</div>
				</div>

				<div class="sys-list sys-list-row">
					<button class="sys-switch" aria-pressed={session.metronome} onclick={toggleMetronome}>
						<span class="sys-switch-label">Click</span>
						<span class="sys-chip" class:on={session.metronome} aria-hidden="true">{session.metronome ? 'On' : 'Off'}</span>
					</button>
					<button class="sys-switch" aria-pressed={session.keyFollowEnabled} title={keyFollowTitle} onclick={toggleKeyFollow}>
						<span class="sys-switch-label">Follow Key</span>
						<span class="sys-chip" class:on={session.keyFollowEnabled} aria-hidden="true">{session.keyFollowEnabled ? 'On' : 'Off'}</span>
					</button>
				</div>
			</div>
		</section>

		<SectionDivider orientation="vertical" />

		<!-- Sections: what is on screen, in the order it sits down it. -->
		<section class="sys-group">
			<h2 class="sys-section-label">Sections</h2>
			<div class="sys-list sys-sections">
				{#each surfaceToggles as t (t.label)}
					<button
						class="sys-switch"
						aria-pressed={t.on()}
						aria-label={t.ariaLabel}
						title={t.title}
						onclick={t.toggle}
						data-section-switch={t.label.toLowerCase()}
					>
						<span class="sys-switch-label">{t.label}</span>
						<span class="sys-chip" class:on={t.on()} aria-hidden="true">{t.on() ? 'On' : 'Off'}</span>
					</button>
				{/each}
			</div>
		</section>
	</div>

	<!-- Launch-quantization picker. Scoped to the central view rather than
	     the whole window: the track strips above stay visible, which is what
	     you are reasoning about when you change the launch grid mid-set. -->
	{#if launchQuantOpen}
		<div
			class="quant-modal-backdrop"
			role="presentation"
			onclick={() => (launchQuantOpen = false)}
		></div>
		<div
			class="quant-modal"
			role="dialog"
			aria-modal="true"
			aria-label="Global launch quantization"
			tabindex="-1"
			use:autofocus
			onkeydown={onModalKeydown}
		>
			<div class="quant-modal-head">
				<span class="sys-section-label">Launch Q</span>
				<button
					class="sys-toggle-box quant-close"
					aria-label="Close"
					onclick={() => (launchQuantOpen = false)}
				>
					Close
				</button>
			</div>
			<div class="quant-grid" role="radiogroup" aria-label="Global launch quantization">
				{#each LAUNCH_QUANTIZATIONS as label, value (value)}
					<button
						class="sys-toggle-box quant-chip"
						class:active={session.clipTriggerQuantization === value}
						role="radio"
						aria-checked={session.clipTriggerQuantization === value}
						onclick={() => setLaunchQuantization(value)}
					>
						{label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

</div>

<style>
	/* The central view is one section of a stack whose height changes with
	   how many sections are on (ADR-416) — half the screen with the FX grid
	   off, a third with it on. The readouts size off that height (`cqh`)
	   rather than a fixed rem, so the same digits fill a tall card and
	   still fit a short one. */
	.sys-root {
		container-type: size;
	}

	/* ---- The Settings page's grammar (2026-09-26) ----
	   A quiet title over each group; values in fields; every switch a row
	   carrying its name and its state. */
	.sys-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
		min-height: 0;
	}
	/* Left, over the list it names, as in Settings. Centred (2026-09-13)
	   because the groups had lost their frames; the lists are frames again. */
	.sys-section-label {
		padding-inline: 0.125rem;
		font-size: 1rem;
		line-height: 1.25rem;
		font-weight: var(--font-weight-medium);
		color: var(--muted-foreground);
	}
	.sys-transport-body {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	/* The transport's three values, each in a field of its own: equal
	   thirds, a big value over its caption. */
	.sys-field-row {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		gap: var(--spacing-xs);
	}
	.sys-field {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		/* The anchor for the digits' hit areas below. */
		position: relative;
	}
	/* Each value's touch target is its whole field, not the digits drawn
	   in it (Ben, 2026-10-09): the button stays its own size so its hover
	   and drag wash still sit on the number, and an invisible ::after
	   stretches its hit area over the field. The time signature splits
	   its field down the middle — numerator left, denominator right. */
	.sys-field :is(.sys-drag-digit, .sys-value-digit)::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.sys-field .sys-drag-digit.sys-num::after {
		right: 50%;
	}
	.sys-field .sys-drag-digit.sys-den::after {
		left: 50%;
	}
	.sys-list {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--card);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	/* Click and Follow Key side by side, one touch row tall: sized off the
	   view's height like the digits, never under the 44px floor. */
	.sys-list-row {
		flex: 0 0 clamp(var(--height-touch), 22cqh, 4rem);
		flex-direction: row;
	}
	.sys-sections {
		flex: 1 1 0;
	}
	.sys-switch {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		padding: 0 var(--spacing-lg);
		background: transparent;
		border: 0;
		color: var(--foreground);
		font-size: 1.125rem;
		font-weight: var(--font-weight-medium);
		text-align: left;
		cursor: pointer;
	}
	.sys-switch + .sys-switch {
		border-top: 1px solid var(--line-strong);
	}
	.sys-list-row .sys-switch + .sys-switch {
		border-top: 0;
		border-left: 1px solid var(--line-strong);
	}
	.sys-switch:active {
		background: var(--secondary);
	}
	.sys-switch:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	@media (hover: hover) {
		.sys-switch:hover {
			background: var(--secondary);
		}
	}
	.sys-switch-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A switch's state: ON is Live's orange, OFF a well. */
	.sys-chip {
		flex-shrink: 0;
		min-width: 3.25rem;
		padding: 0.25rem 0.625rem;
		font-size: 1rem;
		font-weight: var(--font-weight-medium);
		text-align: center;
		color: var(--muted-foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.sys-chip.on {
		color: var(--flat-on-fg);
		background: var(--phosphor);
		border-color: var(--phosphor);
	}

	/* Shared label style */
	.sys-label {
		font-size: 0.9375rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--sys-dim);
	}

	/* Large draggable digits (tempo, time sig) */
	.sys-drag-digit {
		font-size: clamp(max(var(--type-min), calc(36 * var(--fluid-px))), 14cqh, 5rem);
		font-weight: 300;
		color: var(--sys);
		text-align: center;
		cursor: ns-resize;
		padding: var(--spacing-xs) var(--spacing-xs);
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		line-height: 1;
		transition: background-color 0.15s ease;
	}

	.sys-drag-digit:hover {
		background: var(--sys-bg);
	}

	.sys-drag-digit.active {
		background: var(--sys-bg-active);
	}

	/* Launch Q reads at digit scale but is a tap target, not a drag —
	   smaller type because the labels are words ("1/16T"), not numerals,
	   and they have to survive the narrowest column this card ever gets. */
	.sys-value-digit {
		font-size: clamp(max(var(--type-min), calc(24 * var(--fluid-px))), 10cqh, 3.5rem);
		font-weight: 300;
		color: var(--sys);
		text-align: center;
		cursor: pointer;
		padding: var(--spacing-xs) var(--spacing-md);
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		line-height: 1;
		white-space: nowrap;
		transition: background-color 0.15s ease;
	}

	.sys-value-digit:hover {
		background: var(--sys-bg);
	}

	.sys-value-digit.active {
		background: var(--sys-bg-active);
	}

	/* The "/" between numerator and denominator rides the dim ink wash
	   (was inline; lifted onto the class so the flat grammar can re-read
	   it without !important). */
	.sys-sep {
		color: var(--sys-dim);
		font-size: clamp(max(var(--type-min), calc(24 * var(--fluid-px))), 10cqh, 3.5rem);
		font-weight: 200;
		line-height: 1;
	}

	/* Toggle box (metronome, filter, theme) */
	.sys-toggle-box {
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--sys-dim);
		padding: var(--spacing-md) var(--spacing-lg);
		border-radius: var(--radius-sm);
		border: 1px solid var(--sys-dim);
		background: transparent;
		cursor: pointer;
		transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
	}

	.sys-toggle-box:hover {
		background: var(--sys-bg);
		color: var(--sys-hover);
		border-color: var(--sys-hover);
	}

	.sys-toggle-box.active {
		color: var(--sys);
		border-color: var(--sys);
		background: var(--sys-bg-active);
	}

	.sys-toggle-box:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* The gear: Settings' door, in the view's top-right corner (Ben,
	   2026-09-26: it sat in Transport's corner, over the Launch Q field).
	   Its 52px box, over the 44px touch floor (Ben, 2026-10-09: bigger),
	   is centered on the section labels' line and hangs in the view's
	   inset, so it crosses the Sections list by a corner at most. */
	.sys-gear {
		position: absolute;
		--gear-box: 3.25rem;
		top: calc(var(--central-inset) + 0.625rem - var(--gear-box) / 2);
		right: calc(var(--central-inset) + 0.875rem - var(--gear-box) / 2);
		width: var(--gear-box);
		height: var(--gear-box);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--sys-dim);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		z-index: 1;
	}
	.sys-gear:hover {
		color: var(--sys);
		background: var(--sys-bg);
	}
	/* Launch-quantization picker. Both the backdrop and the panel are
	   absolute inside the central view's own relative box, so the picker
	   dims this section and nothing else — the track strips above stay
	   readable while you change the grid. */
	.quant-modal-backdrop {
		position: absolute;
		inset: 0;
		background: rgb(0 0 0 / 0.55);
		z-index: 20;
	}

	.quant-modal {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		z-index: 21;
		width: min(44rem, calc(100% - 2rem));
		max-height: calc(100% - 2rem);
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-lg);
		border-radius: var(--radius-lg);
		border: 1px solid var(--sys-dim);
		background: var(--background);
		box-shadow: 0 1.5rem 3rem rgb(0 0 0 / 0.5);
	}

	.quant-modal:focus {
		outline: none;
	}

	.quant-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
	}

	.quant-close {
		padding: var(--spacing-sm) var(--spacing-xl);
		font-size: 0.875rem;
		min-height: 2.75rem; /* 44px — iPad minimum touch target */
	}

	/* Seven across — 14 values land as two full rows with no ragged tail,
	   and the break falls exactly where Live's own list turns from bar
	   lengths into note divisions (1/2T | 1/4). */
	.quant-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: var(--spacing-sm);
	}

	.quant-chip {
		padding: var(--spacing-sm) var(--spacing-xs);
		font-size: 1rem;
		letter-spacing: 0.05em;
		min-height: 3.25rem; /* comfortably over the 44px iPad minimum */
		white-space: nowrap;
	}

	/* ---- Live skin (flat grammar) ------------------------------------
	   The System view is Live's Preferences / transport bar: matte cards,
	   control fields in a 1px dark frame, and the ONE idiom that carries
	   state — OFF = field with light text, ON = solid ChosenDefault with
	   dark text. The GRATICULE --sys orange ink washes (--sys-bg /
	   --sys-bg-active / --sys-dim borders) step aside: nothing here is a
	   track voice, so nothing is tinted. Labels drop the HUD upper-casing
	   and tracking — the literals are already mixed case ("Time",
	   "Click", "Launch Q"), the transform did the shouting. Nothing below
	   applies outside [data-grammar="flat"]. */

	/* Section labels: secondary text, normal case, no tracking. */
	:global([data-grammar="flat"]) .sys-label {
		text-transform: none;
		letter-spacing: 0;
		font-weight: var(--font-weight-medium);
		color: var(--muted-foreground);
	}

	/* Draggable digits: a numeric field in the body foreground, regular
	   weight — Live's tempo/time-sig display is text, not an accent —
	   with a control-field surface while hovered / being dragged
	   instead of the orange wash. */
	:global([data-grammar="flat"]) .sys-drag-digit {
		font-weight: var(--font-weight-regular);
		color: var(--foreground);
	}
	:global([data-grammar="flat"]) .sys-drag-digit:hover {
		background: var(--surface-well);
	}
	:global([data-grammar="flat"]) .sys-drag-digit.active {
		background: var(--secondary);
	}
	/* The "/" between numerator and denominator drops the ink wash. */
	:global([data-grammar="flat"]) .sys-sep {
		color: var(--muted-foreground);
	}

	:global([data-grammar="flat"]) .sys-gear {
		color: var(--muted-foreground);
	}
	:global([data-grammar="flat"]) .sys-gear:hover {
		color: var(--foreground);
		background: var(--surface-well);
	}

	/* Toggle boxes (Click, Follow Key, Header, the
	   launch-quantization chips): the shared flat toggle. */
	:global([data-grammar="flat"]) .sys-toggle-box {
		text-transform: none;
		letter-spacing: 0;
		font-weight: var(--font-weight-medium);
		color: var(--foreground);
		border: 1px solid var(--line-strong);
		background: var(--surface-well);
	}
	:global([data-grammar="flat"]) .sys-toggle-box:hover {
		background: var(--secondary);
		color: var(--foreground);
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .sys-toggle-box.active {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	/* Light: an ON fill sits at ~1:1 luminance against the light ladder,
	   so the frame stays dark for the control's boundary to survive. */
	:global(.light[data-grammar="flat"]) .sys-toggle-box.active {
		border-color: var(--line-strong);
	}
	/* Disabled = Live's idiom (ControlOffDisabledForeground on the same
	   field), never an opacity dim. */
	:global([data-grammar="flat"]) .sys-toggle-box:disabled {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
	:global([data-grammar="flat"]) .quant-chip {
		letter-spacing: 0;
	}

	/* Launch Q's value carries the same flat treatment as the drag digits:
	   body foreground text on a control field, not an accent. */
	:global([data-grammar="flat"]) .sys-value-digit {
		font-weight: var(--font-weight-regular);
		color: var(--foreground);
	}
	:global([data-grammar="flat"]) .sys-value-digit:hover {
		background: var(--surface-well);
	}
	:global([data-grammar="flat"]) .sys-value-digit.active {
		background: var(--secondary);
	}

	/* Value fields are Live's display material: a control field in a 1px
	   frame, same as the switches beside them. */
	:global([data-grammar="flat"]) .sys-field {
		border-color: var(--line-strong);
		background: var(--surface-well);
	}

	/* The picker is Live's own modal material: a matte card in a 1px frame. */
	:global([data-grammar="flat"]) .quant-modal {
		background: var(--card);
		border-color: var(--line-strong);
	}
</style>
