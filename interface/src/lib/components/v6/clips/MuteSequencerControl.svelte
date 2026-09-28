<script lang="ts">
  import { sequencerStore, DIVISION_OPTIONS } from '$lib/stores/v6/sequencerStore.svelte';
  import SequencerPatternGrid from './SequencerPatternGrid.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { v3Store } from '$lib/stores/v3/normalized.svelte';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { TRACK_DEFAULTS } from '$lib/components/v6/tracks/TrackStrip/utils/trackConstants';

  interface Props {
    showLengthSlider?: boolean;
    showRateSlider?: boolean;
  }
  let { showLengthSlider = true, showRateSlider = true }: Props = $props();

  // Mute row follows the selected track's color (greyed when that track is
  // muted), mirroring the strip's MiniSequencer. Pitch row is unaffected.
  let selectedTrackRecord = $derived(
    session.selectedTrackIndex >= 0
      ? v3Store.tracks.get(`tracks/${session.selectedTrackIndex}`)
      : undefined
  );
  // ADR-435: under a pad scope the mute row takes the pad's chain colour
  // through `trackInk` — the same calibration the Permute view's chip and
  // length cells and the Drum Rack view's controls put it through, so one
  // pad's sequencer wears one ink (a raw white pad read as white steps
  // beside an amber chip). The track's own colour where Live left the pad
  // uncoloured, and outside a scope, as before.
  let scope = $derived(sequencerStore.scope);
  let trackColor = $derived(
    scope && scope.color !== null
      ? trackInk(rgbToHex(scope.color), paintModeReactive())
      : rgbToHex(selectedTrackRecord?.color ?? TRACK_DEFAULTS.color)
  );
  let trackMuted = $derived(selectedTrackRecord?.mute ?? false);

  // Destructure reactive store values
  let muteSteps = $derived(sequencerStore.muteSteps);
  let muteLength = $derived(sequencerStore.muteLength);
  let muteCurrentStep = $derived(sequencerStore.muteCurrentStep);
  let muteRate = $derived(sequencerStore.muteRate);
  let isPlaying = $derived(sequencerStore.isPlaying);
  let isGhost = $derived(sequencerStore.isGhost);
  let device = $derived(sequencerStore.device);
  let isLoading = $derived(sequencerStore.isLoading);
  let color = $derived(sequencerStore.color);

  // Sync state when device changes
  // V4.2: State now comes from broadcasts, not parameter cache
  $effect(() => {
    if (device) {
      if (sequencerStore.isLoading) {
        // Fresh load completing - send complete state to Max
        sequencerStore.onDeviceLoaded(device);
      }
      // Normal track switch: state syncs via broadcast listener
    } else {
      sequencerStore.resetToGhost();
    }
  });

  // Rate display
  let rateMode = $derived(muteRate <= 3 ? 'bars' : '16ths');
  let rateValue = $derived(DIVISION_OPTIONS[muteRate]?.value || 1);
  let rateDisplayString = $derived(DIVISION_OPTIONS[muteRate]?.label || '1/16');

  // Active state handlers
  function handleRateChange(mode: string, value: number) {
    const index = DIVISION_OPTIONS.findIndex(opt => opt.mode === mode && opt.value === value);
    if (index >= 0) {
      sequencerStore.handleMuteRateChange(index);
    }
  }

  // Ghost state handlers
  function handleRateChangeGhost(mode: string, value: number) {
    const index = DIVISION_OPTIONS.findIndex(opt => opt.mode === mode && opt.value === value);
    if (index >= 0) {
      sequencerStore.handleMuteRateChangeGhost(index);
    }
  }
</script>

<div class="w-full h-full relative">
  {#if !isGhost && device}
    <SequencerPatternGrid
      steps={muteSteps}
      length={muteLength}
      currentStep={muteCurrentStep}
      playing={isPlaying}
      variant="mute"
      muteColor={trackColor}
      dimmed={trackMuted}
      {showLengthSlider}
      {showRateSlider}
      {rateMode}
      {rateValue}
      {rateDisplayString}
      onStepToggle={sequencerStore.handleMuteStepToggle}
      onStepSet={sequencerStore.handleMuteStepSet}
      onLengthChange={sequencerStore.handleMuteLengthChange}
      onRateChange={handleRateChange}
    />
  {:else}
    <!-- Ghost state -->
    <SequencerPatternGrid
      steps={muteSteps}
      length={muteLength}
      currentStep={-1}
      playing={false}
      variant="mute"
      muteColor={trackColor}
      dimmed={trackMuted}
      {showLengthSlider}
      {showRateSlider}
      {rateMode}
      {rateValue}
      {rateDisplayString}
      onStepToggle={sequencerStore.handleMuteStepToggleGhost}
      onStepSet={sequencerStore.handleMuteStepSetGhost}
      onLengthChange={sequencerStore.handleMuteLengthChangeGhost}
      onRateChange={handleRateChangeGhost}
      onEnable={() => sequencerStore.triggerLoad()}
    />
  {/if}

  {#if isLoading}
    <div class="absolute inset-0 flex items-center justify-center z-10 loading-overlay" style="border-radius: var(--radius-md);">
      <div class="loading-pulse" style="background-color: {color.accent}"></div>
    </div>
  {/if}
</div>

<style>
  .loading-overlay {
    pointer-events: none;
    background-color: rgba(0, 0, 0, var(--opacity-overlay));
  }

  .loading-pulse {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    animation: undulate 2s ease-in-out infinite;
  }

  @keyframes undulate {
    0%, 100% {
      opacity: var(--opacity-subtle);
      transform: scale(0.8);
    }
    50% {
      opacity: var(--opacity-ghost);
      transform: scale(1.1);
    }
  }

  /* ---- Flat grammar: the loading veil is the palette scrim (background-alpha
     under flat, never a black wash). The Graticule black wash is class-owned
     above, so this wins by specificity alone. */
  :global([data-grammar="flat"]) .loading-overlay {
    background-color: var(--scrim);
  }
</style>
