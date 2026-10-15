<script lang="ts">
  /**
   * SquashCentralView — the dynamics view.
   *
   * Every Compressor (Compressor2) control the app has: the sidechain
   * source grid and its cutoff, the Makeup auto toggle with its output
   * gain, and the Compressor module itself. All of it lived in
   * `UtilityCentralView` until 2026-09-11, which left the Gain tile
   * opening a compressor and the Squash tile — the dynamics column —
   * opening the same view by alias. The controls now sit behind the tile
   * they belong to; Utility keeps the Gate.
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   *
   * The Glue Compressor that names this view IS drawn here, but only the
   * half `SquashControl` cannot reach. That tile — a full-height FX-grid
   * column of its own (ADR-431 addendum), directly above this view — is
   * one finger over threshold+makeup together, which is the performance
   * gesture. Threshold and output are the settings behind it, and they
   * live here, each set outright (Threshold added beside Output, user,
   * 2026-09-16).
   *
   * The Gate and the Multiband Dynamics sliders (the Mid band's Below
   * Threshold and Below Ratio, and the device's Output) came here from
   * `UtilityCentralView` on 2026-10-15, the user's call, in the place of
   * the Glue Compressor's Attack, Release and Ratio rows, which went. The
   * Gain tile opens this view too now.
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import CompressorControl from '../../device-panel/CompressorControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import GateControl from '../../device-panel/GateControl.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import {
    MB_BELOW_THRESHOLD_MID,
    MB_THRESHOLD_MIN,
    MB_THRESHOLD_MAX,
    MB_BELOW_RATIO_MID,
    MB_OUTPUT,
    MB_OUTPUT_MIN,
    MB_OUTPUT_MAX,
    ratioFromSlider,
    sliderFromRatio
  } from '../../device-panel/multibandParams';

  const compressor = useFxGridSlot('compressor');

  // ADR-400: the sidechain, makeup and compressor-module controls drive
  // the COMPRESSOR (Compressor2), so they wear its own (dynamics) ink, already calibrated by the
  // slot chokepoint — and agrees with the `CompressorControl` module
  // beside it. In the Utility view these read `useFxGridSlot('utility')`
  // instead, i.e. the focused track's tint, which was the host view's
  // identity rather than the device's. The disabled/idle scheme is the
  // neutral utility family (deviceInk-safe greys).
  const IDLE_SCHEME = { primary: '#a2acb7', secondary: 'color-mix(in oklab, var(--signal-dim) 10%, transparent)', accent: '#bbc5d1' };
  let liveInk = $derived(compressor.color);

  // ===== GLUE COMPRESSOR — a second slot in this view =====
  // Indices and rails measured off `Glue Compressor.adv`: the preset's
  // element order IS LOM order with Device On at 0. Its two nested
  // containers (<SideChain>, <SideChainEq>) sit after every flat param,
  // so unlike Compressor2 nothing here drifts.
  //   1 = Threshold -40..0 dB — SquashControl drives it too
  //   3 = Makeup  0..20 dB   — "Output"; SquashControl drives it too
  const squash = useFxGridSlot('squash');

  const GLUE_THRESHOLD_PARAM = 1;
  const GLUE_THRESHOLD_MIN = -40;
  const GLUE_THRESHOLD_MAX = 0;
  const GLUE_OUTPUT_PARAM = 3;
  const GLUE_OUTPUT_MIN = 0;
  const GLUE_OUTPUT_MAX = 20;

  // Pre-echo fallbacks are the .adv's own stored defaults, so a ghost
  // draws the preset it would load rather than a wrong zero.
  const squashDefaults = { threshold: 0, output: 0 };

  // ADR-400: these controls drive the Glue Compressor, so they wear its
  // ink, not the Compressor2 ink the rest of the view carries. Both are
  // the dynamics family, so they agree.
  let squashInk = $derived(squash.color);

  let glueThreshold = $derived(squash.paramValue(GLUE_THRESHOLD_PARAM) ?? squashDefaults.threshold);
  let glueOutput = $derived(squash.paramValue(GLUE_OUTPUT_PARAM) ?? squashDefaults.output);

  // ===== GATE and MULTIBAND DYNAMICS — two more slots =====
  const gate = useFxGridSlot('gate');
  const multiband = useFxGridSlot('ott');

  // A ghost draws Live's factory defaults (the dump's `default`s).
  let mbThreshold = $derived(multiband.paramValue(MB_BELOW_THRESHOLD_MID) ?? -60);
  let mbRatioPos = $derived(sliderFromRatio(multiband.paramValue(MB_BELOW_RATIO_MID) ?? 0));
  let mbOutput = $derived(multiband.paramValue(MB_OUTPUT) ?? 0);

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

<!-- NO {#if device} gate - always render, handle ghost/loading states -->
<!-- TWO DEVICES, TWO PANELS (user's call, 2026-09-11). The view used to
     be one field of three sections, which read as one device with a
     stray fourth control once the Glue Compressor's settings arrived —
     and left two sliders both titled "Output" with nothing to say which
     compressor each belonged to. The panels answer that: each is named,
     each is framed in its own device's ink, and Squash leads because it
     is the device the tile and the view are named for.

     Inside the compressor panel the old three sections are unchanged —
     the sidechain grid keeps half that panel's width (it is the one
     section whose content grows with the set) and makeup and the
     compressor module split the rest.

     2026-09-13: the frames came off. Each group is still named and still
     inked, but the box around it is a hairline BETWEEN the two instead —
     a card here was a bordered box full of bordered boxes, and its
     padding cost the controls ~20px of a 660px band to say what
     `SectionDivider` says with one line. -->
<div class="squash-central-layout relative">
  <!-- ===== Panel 1 — Glue Compressor (Squash) =====
       Threshold and Output. `sendParam` is fire-and-forget on a ghost —
       it queues and triggers the load. -->
  <section class="dyn-panel glue-panel" style="--panel-ink: {squash.isGhost ? IDLE_SCHEME.primary : squashInk.primary};">
    <div class="panel-title text-xs font-bold tracking-wider">Squash</div>
    <div class="glue-body">
      <!-- Live's own direction: up is a higher threshold, i.e. less
           squash — the opposite of the tile, whose up is MORE. -->
      <div class="glue-slider" class:slot-ghost={squash.isGhost}>
        <DeviceSlider
          value={glueThreshold}
          title="Threshold"
          icon="threshold"
          orientation="vertical"
          labelOrientation="horizontal"
          min={GLUE_THRESHOLD_MIN}
          max={GLUE_THRESHOLD_MAX}
          isGhost={squash.isGhost}
          color={squash.isGhost ? IDLE_SCHEME : squashInk}
          onTap={() => squash.loadIfGhost()}
          onInteraction={(value) => squash.sendParam(GLUE_THRESHOLD_PARAM, value)}
        />
      </div>
      <div class="glue-slider" class:slot-ghost={squash.isGhost}>
        <DeviceSlider
          value={glueOutput}
          title="Output"
          icon="output"
          orientation="vertical"
          labelOrientation="horizontal"
          min={GLUE_OUTPUT_MIN}
          max={GLUE_OUTPUT_MAX}
          isGhost={squash.isGhost}
          color={squash.isGhost ? IDLE_SCHEME : squashInk}
          onTap={() => squash.loadIfGhost()}
          onInteraction={(value) => squash.sendParam(GLUE_OUTPUT_PARAM, value)}
        />
      </div>
    </div>
  </section>

  <SectionDivider orientation="vertical" />

  <!-- ===== Gate ===== -->
  <section class="dyn-panel gate-panel" style="--panel-ink: {gate.isGhost ? IDLE_SCHEME.primary : gate.color.primary};">
    <div class="panel-title text-xs font-bold tracking-wider">Gate</div>
    <div class="device-wrapper gate-body" class:slot-ghost={gate.isGhost}>
      <GateControl device={gate.device} icon="gate" />
    </div>
  </section>

  <SectionDivider orientation="vertical" />

  <!-- ===== Multiband Dynamics: the Mid band's Below Threshold and
       Below Ratio, and the device's Output. A ghost loads it on the first
       drag, inserted by name with the user's own default. ===== -->
  <section class="dyn-panel mb-panel" data-device="multiband" style="--panel-ink: {multiband.isGhost ? IDLE_SCHEME.primary : multiband.color.primary};">
    <div class="panel-title text-xs font-bold tracking-wider">Multiband</div>
    <div class="mb-body">
      <!-- 0 sits at the middle: the bottom half is -3..0, the top 0..1. -->
      <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
        <DeviceSlider
          value={mbRatioPos}
          title="Ratio"
          orientation="vertical"
          labelOrientation="horizontal"
          min={0}
          max={1}
          centerOrigin={true}
          centerValue={0.5}
          isGhost={multiband.isGhost}
          color={multiband.color}
          onTap={() => multiband.loadIfGhost()}
          onInteraction={(value) => multiband.sendParam(MB_BELOW_RATIO_MID, ratioFromSlider(value))}
        />
      </div>
      <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
        <DeviceSlider
          value={mbThreshold}
          title="Threshold"
          icon="threshold"
          orientation="vertical"
          labelOrientation="horizontal"
          min={MB_THRESHOLD_MIN}
          max={MB_THRESHOLD_MAX}
          isGhost={multiband.isGhost}
          color={multiband.color}
          onTap={() => multiband.loadIfGhost()}
          onInteraction={(value) => multiband.sendParam(MB_BELOW_THRESHOLD_MID, value)}
        />
      </div>
      <div class="mb-slider" class:slot-ghost={multiband.isGhost}>
        <DeviceSlider
          value={mbOutput}
          title="Output"
          icon="output"
          orientation="vertical"
          labelOrientation="horizontal"
          min={MB_OUTPUT_MIN}
          max={MB_OUTPUT_MAX}
          centerOrigin={true}
          centerValue={0}
          isGhost={multiband.isGhost}
          color={multiband.color}
          onTap={() => multiband.loadIfGhost()}
          onInteraction={(value) => multiband.sendParam(MB_OUTPUT, value)}
        />
      </div>
    </div>
  </section>

  <SectionDivider orientation="vertical" />

  <!-- ===== Panel 2 — Compressor (Compressor2) ===== -->
  <section class="dyn-panel comp-panel" style="--panel-ink: {liveInk.primary};">
    <div class="panel-title text-xs font-bold tracking-wider">Compressor</div>
    <div class="comp-body">
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
        labelOrientation="horizontal"
        min={MAKEUP_GAIN_MIN}
        max={MAKEUP_GAIN_MAX}
        isGhost={compressor.isGhost}
        color={compressor.isGhost ? IDLE_SCHEME : liveInk}
        onInteraction={handleMakeupGainChange}
      />
    </div>
  </div>

      <!-- Compressor Control (virtual device - handles its own slot state) -->
      <div class="device-wrapper compressor-wrapper">
        <CompressorControl device={compressor.device} icon="compress" />
      </div>
    </div>
  </section>
</div>

<style>
  .squash-central-layout {
    display: grid;
    /* squash | seam | gate | seam | multiband | seam | compressor. The
       Gate and Multiband groups took the width the Glue Compressor's
       Attack/Release/Ratio rows had (2026-10-15). */
    grid-template-columns: 1.6fr auto 1.6fr auto 2.4fr auto 3.9fr;
    height: 100%;
    width: 100%;
    padding: var(--central-inset);
    gap: var(--central-gap);
  }

  /* A group is one device. Its TITLE takes that device's own ink
     (--panel-ink, set inline), so which compressor a control belongs to
     is readable — which matters for the two sliders both called Output.
     No frame: the seam between the two is a `SectionDivider`. */
  .dyn-panel {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-width: 0;
    min-height: 0;
  }

  /* Centred over the group it names (user, 2026-09-13: "I like the labels
     being centered instead of justified to the left"). Left-aligned it sat
     over the first control of the group rather than over the group. */
  .panel-title {
    flex-shrink: 0;
    text-align: center;
    color: var(--panel-ink);
  }

  .glue-body,
  .comp-body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: grid;
    gap: var(--central-gap);
  }

  /* threshold | output */
  .glue-body {
    grid-template-columns: 1fr 1fr;
  }

  .mb-body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--central-gap);
  }

  .gate-body {
    flex: 1;
  }

  .mb-slider {
    min-width: 0;
    min-height: 0;
  }

  .glue-rows {
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-width: 0;
    min-height: 0;
  }

  /* sidechain | makeup | compressor */
  .comp-body {
    grid-template-columns: 2fr 0.9fr 1fr;
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

  .glue-slider {
    min-width: 0;
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
  /* Live sets control text medium and does not letterspace its section
     legends. */
  :global([data-grammar="flat"]) .panel-title {
    font-weight: var(--font-weight-medium);
    letter-spacing: 0;
  }
</style>
