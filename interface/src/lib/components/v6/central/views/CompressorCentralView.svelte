<script lang="ts">
  /**
   * CompressorCentralView — the Compressor's view (slot `compressor`,
   * Compressor2).
   *
   * Every Compressor control the app has: the sidechain source grid and
   * its cutoff, the Makeup auto toggle with its output gain, and the
   * Compressor module itself. Split out of the shared dynamics view
   * (`SquashCentralView`, which also held the Glue, the Gate and the
   * Multiband) when the FX chain overview gave every device its own view
   * (ADR-478).
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import CompressorControl from '../../device-panel/CompressorControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';

  const compressor = useFxGridSlot('compressor');

  // ADR-400: the sidechain, makeup and compressor-module controls drive
  // the COMPRESSOR (Compressor2), so they wear its own (dynamics) ink, already calibrated by the
  // slot chokepoint — and agrees with the `CompressorControl` module
  // beside it. The disabled/idle scheme is the neutral utility family
  // (deviceInk-safe greys).
  const IDLE_SCHEME = { primary: '#a2acb7', secondary: 'color-mix(in oklab, var(--signal-dim) 10%, transparent)', accent: '#bbc5d1' };
  let liveInk = $derived(compressor.color);

  // Mount property subscriptions inline (per useFxGridSlot contract).
  // The $effect re-runs when devicePath changes; teardown releases
  // both props so the refcount manager fires unsubscribe on last release.
  $effect(() => {
    const path = compressor.devicePath;
    if (!path) return;
    const releases = [
      selectedTrackStore.subscribeProperty(path, 'available_input_routing_types'),
      selectedTrackStore.subscribeProperty(path, 'input_routing_type')
    ];
    return () => releases.forEach((fn) => fn());
  });

  // Initial UI state before the first param echo lands. This was a lookup
  // into data/device-configs.json with 0 as the `?? fallback` — but that
  // file's Compressor2 param 7 carries no `default` key at all, so the
  // fallback was the only value it ever produced.
  const compressorDefaults = {
    makeupGain: 0
  };

  // Helper to parse JSON strings from LiveAPI
  function parsePropertyValue(value: any): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  // Live 12's Track.RoutingType proxy exposes display_name but does
  // not expose a stable identifier — the Python surface serializes
  // identifier as null via getattr default. Comparing by identifier
  // alone lit up every button ("null === null"); fall back to
  // display_name when either side's identifier is null/undefined.
  function routingMatches(current: any, candidate: any): boolean {
    if (!current || !candidate) return false;
    const curId = current.identifier;
    const candId = candidate.identifier;
    if (curId != null && candId != null) return curId === candId;
    return (
      current.display_name != null
      && current.display_name === candidate.display_name
    );
  }

  // ===== SIDECHAIN ROUTING - All values as $derived =====
  // Property reads go through v3 propertyValue (path-keyed). Values
  // arrive as JSON strings per ADR-002 amendment.
  let availableTypes = $derived.by(() => {
    const path = compressor.devicePath;
    if (!path) return [] as any[];
    const value = selectedTrackStore.propertyValue(path, 'available_input_routing_types');
    const parsed = parsePropertyValue(value);
    const allTypes = parsed?.available_input_routing_types || parsed;

    if (Array.isArray(allTypes)) {
      return allTypes.filter((track: any) => {
        const name = track.display_name || '';
        return (
          name !== 'No Input' &&
          name !== 'A-AbletonOSC helper' &&
          !name.includes('Return') &&
          !name.startsWith('A-') &&
          !name.startsWith('B-') &&
          !name.startsWith('C-') &&
          !name.startsWith('D-')
        );
      });
    }
    return [] as any[];
  });

  let inputRoutingType = $derived.by(() => {
    const path = compressor.devicePath;
    if (!path) return null;
    const value = selectedTrackStore.propertyValue(path, 'input_routing_type');
    const parsed = parsePropertyValue(value);
    return parsed?.input_routing_type || parsed;
  });

  let sidechainEnabled = $derived(compressor.paramValue(20) === 1);

  // ===== MAKEUP GAIN =====
  const MAKEUP_GAIN_PARAM = 7;
  const MAKEUP_GAIN_MIN = -16;
  const MAKEUP_GAIN_MAX = 16;
  const MAKEUP_AUTO_PARAM = 8;

  let makeupGainValue = $derived(compressor.paramValue(MAKEUP_GAIN_PARAM) ?? compressorDefaults.makeupGain);
  let makeupAutoEnabled = $derived(compressor.paramValue(MAKEUP_AUTO_PARAM) === 1);

  // ===== CUTOFF =====
  const CUTOFF_PARAM = 17;
  const CUTOFF_MIN = 0;
  const CUTOFF_MAX = 1;

  let cutoffValue = $derived(compressor.paramValue(CUTOFF_PARAM) ?? 0);

  function handleCutoffChange(value: number) {
    compressor.sendParam(CUTOFF_PARAM, value);
  }

  // Adaptive grid layout for sidechain buttons
  let sidechainLayout = $derived.by(() => {
    const count = availableTypes.length;
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 9) return { cols: 3, rows: 3 };
    if (count <= 12) return { cols: 4, rows: 3 };
    return { cols: 4, rows: 4 };
  });

  function handleMakeupGainChange(value: number) {
    compressor.sendParam(MAKEUP_GAIN_PARAM, value);
  }

  function toggleMakeupAuto() {
    compressor.sendParam(MAKEUP_AUTO_PARAM, makeupAutoEnabled ? 0 : 1);
  }

  // Sidechain selection: routes through helper for the 15/20 enables,
  // and writes the routing-type property directly when active. Ghost
  // path can't set properties (they need the live device), so it just
  // queues the param writes which trigger load.
  function handleSidechainSelect(track: any) {
    compressor.sendParam(15, 1);
    compressor.sendParam(20, 1);
    const path = compressor.devicePath;
    if (compressor.device && path) {
      selectedTrackStore.setPropertyValue(path, 'input_routing_type', JSON.stringify(track));
    }
  }
</script>

<!-- NO {#if device} gate - always render, handle ghost/loading states.
     sidechain | makeup | compressor: the sidechain grid keeps half the
     width (it is the one section whose content grows with the set) and
     makeup and the compressor module split the rest. -->
<div class="comp-central-layout relative">
  <!-- Sidechain Routing + Cutoff -->
  <div class="device-wrapper sidechain-section" style={compressor.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
    <div class="sidechain-body">
      {#if Array.isArray(availableTypes) && availableTypes.length > 0}
        <!-- Adaptive grid: adjusts rows/columns based on item count -->
        <div class="sidechain-grid" style="grid-template-columns: repeat({sidechainLayout.cols}, 1fr); grid-template-rows: repeat({sidechainLayout.rows}, 1fr);">
          {#each availableTypes as track}
            {@const isSelected = routingMatches(inputRoutingType, track)}
            {@const isActive = sidechainEnabled && isSelected}
            <button
              class="physical-button {sidechainLayout.rows > 2 ? 'text-sm' : 'text-base'} font-medium h-full whitespace-normal text-center leading-tight px-1 py-1 flex items-center justify-center"
              class:active={isActive}
              style="--btn-tint: {sidechainEnabled ? liveInk.primary : 'var(--muted-foreground)'};"
              onclick={() => handleSidechainSelect(track)}
            >
              <span class="w-full break-words">
                {track.display_name || `Track ${track.identifier}`}
              </span>
            </button>
          {/each}
        </div>
      {:else if compressor.isGhost}
        <div class="flex items-center justify-center h-full">
          <p class="text-sm text-muted-foreground">Tap to load compressor</p>
        </div>
      {:else}
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-muted-foreground text-sm">
            <p>No sidechain sources available</p>
          </div>
        </div>
      {/if}

      <!-- Cutoff slider (horizontal) — only "active" when sidechain is enabled -->
      <div
        class="cutoff-slider-wrapper"
        style={compressor.isGhost || !sidechainEnabled ? 'opacity: var(--opacity-ghost);' : ''}
      >
        <DeviceSlider
          value={cutoffValue}
          title="Cutoff"
          icon="cutoff"
          orientation="horizontal"
          min={CUTOFF_MIN}
          max={CUTOFF_MAX}
          isGhost={compressor.isGhost || !sidechainEnabled}
          color={compressor.isGhost || !sidechainEnabled ? IDLE_SCHEME : liveInk}
          readout={compressor.paramDisplay(CUTOFF_PARAM)}
          onInteraction={handleCutoffChange}
        />
      </div>
    </div>
  </div>

  <!-- Makeup Section: Auto toggle + Gain Slider -->
  <div class="device-wrapper makeup-section">
    <!-- Makeup Auto toggle (top) -->
    <button
      onclick={toggleMakeupAuto}
      class="physical-button makeup-toggle text-lg font-bold"
      class:active={makeupAutoEnabled}
      class:is-ghost={compressor.isGhost}
      style="--btn-tint: {liveInk.primary};"
    >
      Makeup
    </button>
    <!-- Makeup Gain Slider (bottom) -->
    <div class="makeup-slider-wrapper">
      <DeviceSlider
        value={makeupGainValue}
        title="Output"
        icon="output"
        orientation="vertical"
        min={MAKEUP_GAIN_MIN}
        max={MAKEUP_GAIN_MAX}
        isGhost={compressor.isGhost}
        color={compressor.isGhost ? IDLE_SCHEME : liveInk}
        readout={compressor.paramDisplay(MAKEUP_GAIN_PARAM)}
        onInteraction={handleMakeupGainChange}
      />
    </div>
  </div>

  <!-- Compressor Control (virtual device - handles its own slot state) -->
  <div class="device-wrapper compressor-wrapper">
    <CompressorControl device={compressor.device} icon="compress" />
  </div>
</div>

<style>
  /* sidechain | makeup | compressor */
  .comp-central-layout {
    display: grid;
    grid-template-columns: 2fr 0.9fr 1fr;
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  .device-wrapper {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0; /* Allow shrinking below content size */
  }

  .sidechain-section {
    overflow: hidden;
  }

  .sidechain-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
  }

  .cutoff-slider-wrapper {
    flex-shrink: 0;
    height: 72px;
  }

  .makeup-section {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
  }

  .makeup-toggle {
    flex-shrink: 0;
    height: 80px;
    min-height: 80px;
  }
  /* Ghost compressor dims the toggle (was inline `opacity: 0.7`; lifted
     onto the .is-ghost class so the flat grammar can re-read it without
     !important). */
  .makeup-toggle.is-ghost {
    opacity: 0.7;
  }

  .makeup-slider-wrapper {
    flex: 1;
    min-height: 0;
  }

  .compressor-wrapper {
    flex: 1;
    min-height: 0;
  }

  /* Adaptive grid for sidechain buttons - rows/cols set via inline style */
  .sidechain-grid {
    display: grid;
    grid-auto-flow: column;
    /* grid-template-columns and grid-template-rows set via inline style */
    gap: var(--spacing-sm);
    flex: 1;
    min-height: 0;
  }

  /* Responsive button text sizing based on grid density */
  .sidechain-grid :global(.btn) {
    font-size: clamp(0.75rem, 2vw, 1rem);
    padding: var(--spacing-xs) var(--spacing-sm);
    min-height: 0;
  }

  /* ---- Live skin (flat grammar) ------------------------------------
     The sidechain sources and the Makeup toggle are shared
     .physical-button toggles (already flat in app.css: OFF field / ON
     ChosenDefault); the sliders and the Compressor module carry their
     own flat overrides. What this view adds is Tailwind `font-bold` on
     the Makeup toggle — Live sets control text medium — and a 0.7
     opacity dim on it while the compressor is a ghost: under the flat
     grammar a disabled control is ControlOffDisabledForeground on the
     same field, never an opacity dim. Nothing below applies outside
     [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .makeup-toggle {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .makeup-toggle.is-ghost {
    opacity: 1;
    color: var(--flat-disabled-fg);
  }
</style>
