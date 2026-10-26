<script lang="ts">
	/**
	 * ChordCentralView — the Chord MIDI effect's own view: four octave
	 * switches (Oct +1, +2, -1, -2), each one of Chord's Shift params set to
	 * its interval or back to 0. They sat in the Arpeggiator view past a seam
	 * until the chain overview (ADR-478) opened every device by its own type.
	 *
	 * Self-contained: queries its own slot and renders through
	 * ghost/loading/active without a `{#if device}` gate.
	 */

	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	const chord = useFxGridSlot('chord');

	// Calibrated ink twins (GRATICULE §2.5). primary/accent normalized through
	// trackInk; secondary (low-alpha wash) untouched.
	let chordInk = $derived({
		primary: trackInk(chord.color.primary, paintModeReactive()),
		secondary: chord.color.secondary,
		accent: trackInk(chord.color.accent, paintModeReactive())
	});

	const CHORD_PARAMS = {
		SHIFT_1: 1,
		SHIFT_2: 5,
		SHIFT_3: 9,
		SHIFT_4: 13
	} as const;

	const CHORD_BUTTONS: { paramIndex: number; onValue: number; label: string }[] = [
		{ paramIndex: CHORD_PARAMS.SHIFT_1, onValue: 12, label: '+1' },
		{ paramIndex: CHORD_PARAMS.SHIFT_2, onValue: 24, label: '+2' },
		{ paramIndex: CHORD_PARAMS.SHIFT_3, onValue: -12, label: '-1' },
		{ paramIndex: CHORD_PARAMS.SHIFT_4, onValue: -24, label: '-2' }
	];

	function getChordParamValue(paramIndex: number): number {
		return chord.paramValue(paramIndex) ?? 0;
	}

	function handleChordToggle(paramIndex: number, onValue: number) {
		const current = getChordParamValue(paramIndex);
		chord.sendParam(paramIndex, current !== 0 ? 0 : onValue);
	}
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="chord-root h-full w-full flex p-(--central-inset) gap-(--central-gap)">
	<!-- Chord octave shift buttons -->
	<div class="flex-1 flex flex-col gap-(--central-gap) min-h-0">
		{#each CHORD_BUTTONS as btn}
			{@const isOn = getChordParamValue(btn.paramIndex) !== 0}
			<button
				class="physical-button chord-caps w-full flex-1 min-h-0 text-base font-bold"
				class:active={isOn}
				style="--btn-tint: {chordInk.primary};{chord.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
				onclick={() => handleChordToggle(btn.paramIndex, btn.onValue)}
			>
				Oct {btn.label}
			</button>
		{/each}
	</div>
</div>

<style>
	/* The Oct toggles are authored mixed-case and up-cased here for the
	   HUD voice. */
	.chord-caps {
		text-transform: uppercase;
	}

	/* ---- Live skin: the toggles are flat ControlBackground fields (the shared
	   .physical-button class already is); bold literals settle to medium and
	   the labels keep their authored case. */
	:global([data-grammar="flat"]) .chord-root .physical-button {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .chord-caps {
		text-transform: none;
	}
</style>
