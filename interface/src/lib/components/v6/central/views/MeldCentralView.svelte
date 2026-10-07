<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR, familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // Track reactive state
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-3.5.2a: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Meld color scheme — timeSpace teal (the view's old teal on the gap
  // wheel, ADR-400; modern synth aesthetic preserved).
  const meldColor = familyScheme('timeSpace');

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let meldInk = $derived(trackScheme ?? {
    primary: trackInk(meldColor.primary, paintModeReactive()),
    secondary: meldColor.secondary,
    accent: trackInk(meldColor.accent, paintModeReactive())
  });

  // MIDI wheel colors (shared across central views)
  let pitchInk = $derived(trackScheme ?? {
    primary: trackInk(PITCH_COLOR.primary, paintModeReactive()),
    secondary: PITCH_COLOR.secondary,
    accent: trackInk(PITCH_COLOR.accent, paintModeReactive())
  });
  let modInk = $derived(trackScheme ?? {
    primary: trackInk(MOD_COLOR.primary, paintModeReactive()),
    secondary: MOD_COLOR.secondary,
    accent: trackInk(MOD_COLOR.accent, paintModeReactive())
  });

  // MIDI wheel handlers
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
  }

  // Filter type options (param 14: 0-16)
  const FILTER_TYPE_OPTIONS: { value: number; label: string }[] = [
    { value: 0, label: 'SVF 12' },
    { value: 1, label: 'SVF 24' },
    { value: 2, label: 'LP 12' },
    { value: 3, label: 'HP 12' },
    { value: 4, label: 'BP 12' },
    { value: 5, label: 'LP Cr' },
    { value: 6, label: 'LP Sw' },
    { value: 7, label: 'Filth' },
    { value: 8, label: 'Peak' },
    { value: 9, label: 'Notch' },
    { value: 10, label: 'Phase' },
    { value: 11, label: 'Redux' },
    { value: 12, label: 'Vowel' },
    { value: 13, label: 'Cmb+' },
    { value: 14, label: 'Cmb-' },
    { value: 15, label: 'Plate' },
    { value: 16, label: 'Membr' }
  ];

  // All parameter values as $derived - always reactive to store changes (ADR-149)
  // Macro: Parameter 8 (Macro 1 / X), Parameter 9 (Macro 2 / Y)
  let macro1 = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 8)) ?? 0 : 0);
  let macro2 = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 9)) ?? 0 : 0);

  // Filter Type: Parameter 14 (0-16)
  let filterType = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 14)) ?? 0 : 0);

  // Filter: Parameter 15 (Cutoff / X), Parameter 16 (Resonance / Y)
  let cutoff = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 15)) ?? 1 : 1);
  let resonance = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 16)) ?? 0 : 0);

  // Time: Parameter 37 (X), Parameter 39 (Y)
  let timeX = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 37)) ?? 0.5 : 0.5);
  let timeY = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 39)) ?? 0.5 : 0.5);

  function handleMacroXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 8);
    const yPath = selectedTrackStore.paramPath(device, 9);
    selectedTrackStore.setParamValue(xPath, x);  // Macro 1
    selectedTrackStore.setParamValue(yPath, y);  // Macro 2
  }

  function handleFilterXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 15);
    const yPath = selectedTrackStore.paramPath(device, 16);
    selectedTrackStore.setParamValue(xPath, x); // Cutoff
    selectedTrackStore.setParamValue(yPath, y); // Resonance
  }

  function handleTimeXYInteraction(x: number, y: number) {
    if (!device) return;
    const xPath = selectedTrackStore.paramPath(device, 37);
    const yPath = selectedTrackStore.paramPath(device, 39);
    selectedTrackStore.setParamValue(xPath, x); // Time X
    selectedTrackStore.setParamValue(yPath, y); // Time Y
  }
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- Layout: Macro XY | Filter Type buttons · Filter XY · Time XY | MIDI wheels.
         The type buttons sat the same gap from the Macro pad as from the
         Filter pad they choose for; the first seam puts them with their
         filter, the second divides the device from the wheels (2026-09-13). -->
    <div class="h-full w-full p-(--central-inset) grid gap-(--central-gap)" style="grid-template-columns: 1fr auto 1fr 1fr 1fr auto auto;">
      <!-- Macro XY, with the swap pill lying across the top of its column
           (user's layout, 2026-09-16). -->
      <div class="min-w-0 h-full flex flex-col gap-(--central-gap)">
        <HostedSwapPill />
        <div class="flex-1 min-h-0">
          <DeviceXY
            xValue={macro1}
            yValue={macro2}
            title="Macro"
            icon="macro"
            onInteraction={handleMacroXYInteraction}
            color={meldInk}
          />
        </div>
      </div>
      <SectionDivider orientation="vertical" />
      <!-- Filter type buttons (4-column grid) -->
      <div class="grid grid-cols-4 gap-1 h-full" style="grid-template-rows: repeat(5, 1fr);">
        {#each FILTER_TYPE_OPTIONS as option}
          <button
            class="physical-button text-xs px-0.5 h-full font-semibold"
            class:active={filterType === option.value}
            style="--btn-tint: {meldInk.primary};"
            onclick={() => {
              if (!device) return;
              selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 14), option.value);
            }}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <!-- Filter XY -->
      <div class="min-w-0 h-full">
        <DeviceXY
          xValue={cutoff}
          yValue={resonance}
          title="Filter"
          icon="filter"
          onInteraction={handleFilterXYInteraction}
          color={meldInk}
        />
      </div>
      <!-- Time XY -->
      <div class="min-w-0 h-full">
        <DeviceXY
          xValue={timeX}
          yValue={timeY}
          title="Time"
          icon="envelope"
          onInteraction={handleTimeXYInteraction}
          color={meldInk}
        />
      </div>
      <SectionDivider orientation="vertical" />
      <!-- MIDI Wheels (pitch + mod) -->
      <div class="flex gap-(--central-gap) min-h-0">
        <div class="w-24 h-full">
          <MidiWheel
            type="pitch"
            onInteraction={handlePitchChange}
            color={pitchInk}
          />
        </div>
        <div class="w-24 h-full">
          <MidiWheel
            type="modwheel"
            onInteraction={handleModChange}
            color={modInk}
          />
        </div>
      </div>
    </div>
  {:else}
    <!-- Default state when no Meld present -->
    <DeviceEmptyState glyph="~" message="Load Meld to access controls" color={meldInk.primary} />
  {/if}
</div>

<style>
  /* ---- Live skin (flat grammar): the three pads are DeviceXY and the
     wheels MidiWheel (flat on their own); the filter-type grid is
     .physical-button (app.css: flat field, ChosenDefault ON). Tailwind's
     font-semibold inlines 600 past the flat --font-weight-semibold token, so the
     grid settles to Live's medium here. Graticule is untouched — the rule
     sits under [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
  }
</style>
