<script lang="ts">
  import { sequencerStore, DIVISION_OPTIONS } from '$lib/stores/v6/sequencerStore.svelte';
  import SequencerPatternGrid from './SequencerPatternGrid.svelte';

  interface Props {
    showLengthSlider?: boolean;
    showRateSlider?: boolean;
  }
  let { showLengthSlider = true, showRateSlider = true }: Props = $props();

  // Destructure reactive store values
  let pitchSteps = $derived(sequencerStore.pitchSteps);
  let pitchLength = $derived(sequencerStore.pitchLength);
  let pitchCurrentStep = $derived(sequencerStore.pitchCurrentStep);
  let pitchRate = $derived(sequencerStore.pitchRate);
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
  let rateMode = $derived(pitchRate <= 3 ? 'bars' : '16ths');
  let rateValue = $derived(DIVISION_OPTIONS[pitchRate]?.value || 1);
  let rateDisplayString = $derived(DIVISION_OPTIONS[pitchRate]?.label || '1/16');

  // Active state handlers
  function handleRateChange(mode: string, value: number) {
    const index = DIVISION_OPTIONS.findIndex(opt => opt.mode === mode && opt.value === value);
    if (index >= 0) {
      sequencerStore.handlePitchRateChange(index);
    }
  }

  // Ghost state handlers
  function handleRateChangeGhost(mode: string, value: number) {
    const index = DIVISION_OPTIONS.findIndex(opt => opt.mode === mode && opt.value === value);
    if (index >= 0) {
      sequencerStore.handlePitchRateChangeGhost(index);
    }
  }
</script>

<div class="w-full h-full relative">
  {#if !isGhost && device}
    <SequencerPatternGrid
      steps={pitchSteps}
      length={pitchLength}
      currentStep={pitchCurrentStep}
      playing={isPlaying}
      variant="pitch"
      {showLengthSlider}
      {showRateSlider}
      {rateMode}
      {rateValue}
      {rateDisplayString}
      onStepToggle={sequencerStore.handlePitchStepToggle}
      onStepSet={sequencerStore.handlePitchStepSet}
      onLengthChange={sequencerStore.handlePitchLengthChange}
      onRateChange={handleRateChange}
    />
  {:else}
    <!-- Ghost state -->
    <SequencerPatternGrid
      steps={pitchSteps}
      length={pitchLength}
      currentStep={-1}
      playing={false}
      variant="pitch"
      {showLengthSlider}
      {showRateSlider}
      {rateMode}
      {rateValue}
      {rateDisplayString}
      onStepToggle={sequencerStore.handlePitchStepToggleGhost}
      onStepSet={sequencerStore.handlePitchStepSetGhost}
      onLengthChange={sequencerStore.handlePitchLengthChangeGhost}
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
