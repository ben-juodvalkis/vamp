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
   * gesture. Threshold, output, attack, release and ratio are the settings
   * behind it, and they live here. Threshold and output are deliberately
   * reachable from both: the column moves them together as one squash
   * amount, these two sliders set each outright (Threshold added beside
   * Output, user, 2026-09-16).
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import CompressorControl from '../../device-panel/CompressorControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { drag } from '$lib/actions';
  import type { DragInfo } from '$lib/actions/drag';
  import { segmentIndex, scrubBoxOf, type ScrubBox } from '$lib/utils/segmentScrub';

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
  //   4 = Attack  0..6       stepped, ms
  //   5 = Ratio   0..2       stepped
  //   6 = Release 0..6       stepped, s (last step is Auto)
  const squash = useFxGridSlot('squash');

  const GLUE_THRESHOLD_PARAM = 1;
  const GLUE_THRESHOLD_MIN = -40;
  const GLUE_THRESHOLD_MAX = 0;
  const GLUE_OUTPUT_PARAM = 3;
  const GLUE_OUTPUT_MIN = 0;
  const GLUE_OUTPUT_MAX = 20;
  const GLUE_ATTACK_PARAM = 4;
  const GLUE_RATIO_PARAM = 5;
  const GLUE_RELEASE_PARAM = 6;

  // Live's own legends. The LOM value for a stepped param IS the step
  // index, so these are labels only — never a lookup the writer goes
  // through.
  const ATTACK_LABELS = ['.01', '.1', '.3', '1', '3', '10', '30'];
  const RELEASE_LABELS = ['.1', '.2', '.4', '.6', '.8', '1.2', 'A'];
  const RATIO_LABELS = ['2', '4', '10'];

  // Pre-echo fallbacks are the .adv's own stored defaults, so a ghost
  // draws the preset it would load rather than a wrong zero.
  const squashDefaults = { threshold: 0, output: 0, attack: 3, ratio: 1, release: 3 };

  // ADR-400: these controls drive the Glue Compressor, so they wear its
  // ink, not the Compressor2 ink the rest of the view carries. Both are
  // the dynamics family, so they agree.
  let squashInk = $derived(squash.color);

  let glueThreshold = $derived(squash.paramValue(GLUE_THRESHOLD_PARAM) ?? squashDefaults.threshold);
  let glueOutput = $derived(squash.paramValue(GLUE_OUTPUT_PARAM) ?? squashDefaults.output);
  let glueAttack = $derived(Math.round(squash.paramValue(GLUE_ATTACK_PARAM) ?? squashDefaults.attack));
  let glueRatio = $derived(Math.round(squash.paramValue(GLUE_RATIO_PARAM) ?? squashDefaults.ratio));
  let glueRelease = $derived(Math.round(squash.paramValue(GLUE_RELEASE_PARAM) ?? squashDefaults.release));

  // The inverse label layer, clipped to the lit segment — `DeviceSlider`'s
  // trick, with a discrete segment standing in for a travelling fill. The
  // bar is contiguous (no gaps between segments), which is what makes
  // these percentages land exactly on the segment's edges rather than
  // near them. Out of range → fully clipped, i.e. no inverse copy.
  /**
   * The stepped rows SCRUB (user, 2026-09-12), the same gesture Drift's
   * octave strip has: the row owns one pointer through `use:drag`
   * (ADR-427) and resolves which step is under it from geometry, so a
   * finger slides across the whole range instead of tapping each step —
   * and the hairlines between steps belong to a step rather than being
   * dead bands.
   *
   * The box is measured at press time from the pointerdown's own
   * `currentTarget`, keyed by param: the three rows are separate nodes
   * with separate machines, so two fingers on two rows are two live
   * gestures and one shared box would be the wrong one for one of them.
   *
   * The CURRENT step is re-read from the slot on every frame rather than
   * captured in the closure, because `use:drag` takes its options once
   * and a captured value would go stale the moment the scrub moved it.
   */
  const steppedBoxes = new Map<number, ScrubBox>();

  function steppedScrub(param: number, count: number, clientX: number) {
    const box = steppedBoxes.get(param);
    if (!box) return;
    const step = segmentIndex(clientX, box.left, box.width, count);
    if (step === Math.round(squash.paramValue(param) ?? -1)) return;
    squash.sendParam(param, step);
  }

  function steppedDown(param: number, count: number, info: DragInfo) {
    const box = scrubBoxOf(info.event?.currentTarget as Element | null);
    if (box) steppedBoxes.set(param, box);
    else steppedBoxes.delete(param);
    steppedScrub(param, count, info.x);
  }

  function stepClip(step: number, count: number): string {
    if (!Number.isInteger(step) || step < 0 || step >= count) return 'inset(0 100% 0 0)';
    const left = (step / count) * 100;
    const right = 100 - ((step + 1) / count) * 100;
    return `inset(0 ${right}% 0 ${left}%)`;
  }

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
       Threshold and Output, then the three stepped settings. A stepped param's LOM
       value IS its step index, so the writer sends `step` directly and
       the label array is presentation only. `sendParam` is
       fire-and-forget on a ghost — it queues and triggers the load. -->
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
      <div class="glue-rows">
        {@render steppedRow('Attack', ATTACK_LABELS, glueAttack, GLUE_ATTACK_PARAM)}
        {@render steppedRow('Release', RELEASE_LABELS, glueRelease, GLUE_RELEASE_PARAM)}
        {@render steppedRow('Ratio', RATIO_LABELS, glueRatio, GLUE_RATIO_PARAM)}
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

<!-- One setting as a horizontal bar: the NAME reads inside the control
     and the steps are positions, not numbers (user's call, 2026-09-11).
     Live's legends are still the truth about what each step is, so they
     ride on `title` and in the accessible name — available to a hover
     and to a screen reader, off the glass. Three steps therefore draw
     three wide segments and seven draw seven narrow ones, which is the
     resolution of the control read as width. -->
{#snippet steppedRow(label: string, labels: string[], current: number, param: number)}
  {@const ink = squash.isGhost ? IDLE_SCHEME.primary : squashInk.primary}
  <div class="stepped-row" style={squash.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
    <div
      class="device-segmented stepped-stack"
      style="--btn-tint: {ink}; grid-template-columns: repeat({labels.length}, 1fr);"
      use:drag={{
        commit: 'immediate',
        onDown: (info) => steppedDown(param, labels.length, info),
        onMove: (info) => steppedScrub(param, labels.length, info.x)
      }}
    >
      {#each labels as stepLabel, step}
        <button
          class="device-segment stepped-step"
          class:active={current === step}
          title={stepLabel}
          aria-label="{label} {stepLabel}"
          aria-pressed={current === step}
          onclick={() => squash.sendParam(param, step)}
        ></button>
      {/each}
      <!-- Two stacked copies of the name: the base reads on the unlit
           segments, the inverse is clipped to the lit one and inked for
           on-fill, so the word flips ink at the segment's edge instead of
           disappearing into it. -->
      <div class="stepped-label text-lg font-bold tracking-wider" style="color: {ink};">{label}</div>
      <div
        class="stepped-label stepped-label--inverse text-lg font-bold tracking-wider"
        style="clip-path: {stepClip(current, labels.length)};"
        aria-hidden="true"
      >{label}</div>
    </div>
  </div>
{/snippet}

<style>
  .squash-central-layout {
    display: grid;
    /* squash | seam | compressor. The compressor group carries three
       sections to the squash group's five narrower ones, hence the wider
       share; the middle track is the hairline's own width. Squash went
       2.4fr → 3fr with the Threshold slider, so its Output kept most of
       its width. */
    grid-template-columns: 3fr auto 3.9fr;
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

  /* threshold | output | the three stacked setting bars. */
  .glue-body {
    grid-template-columns: 1fr 1fr 2.6fr;
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

  .stepped-row {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
  }

  /* The house segmented control (app.css §.device-segmented) turned on its
     side: it divides with `border-top` between siblings, a horizontal bar
     wants `border-left`. Contiguous by construction — the label's clip
     math is in bar percentages, so a gap between segments would put the
     ink flip a gap's width away from the edge it belongs to.
     Steps share the width, so Ratio's three are wider than Attack's
     seven — the target size reads the resolution of the control. */
  .stepped-stack {
    position: relative;
    flex: 1;
    min-width: 0;
    display: grid;
  }

  .stepped-step {
    min-width: 0;
  }

  /* The row owns the pointer; the steps are its face. Keyboard focus and
     Enter still activate one. */
  .stepped-step {
    pointer-events: none;
  }
  .stepped-stack .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-faint);
  }
  .stepped-stack .device-segment.active,
  .stepped-stack .device-segment.active + .device-segment {
    border-left-color: transparent;
  }

  /* Name layers. Kept un-rotated so the clip-path is in screen space. */
  .stepped-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 10;
  }
  .stepped-label--inverse {
    z-index: 11;
    color: var(--flat-on-fg);
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
  /* Same two corrections for the glue stacks: Live sets control text
     medium and does not letterspace its section legends. */
  :global([data-grammar="flat"]) .panel-title,
  :global([data-grammar="flat"]) .stepped-label {
    font-weight: var(--font-weight-medium);
    letter-spacing: 0;
  }
  /* The flat grammar divides its segments with --line-strong. */
  :global([data-grammar="flat"]) .stepped-stack .device-segment + .device-segment {
    border-top: 0;
    border-left: 1px solid var(--line-strong);
  }
  :global([data-grammar="flat"]) .stepped-stack .device-segment.active,
  :global([data-grammar="flat"]) .stepped-stack .device-segment.active + .device-segment {
    border-left-color: transparent;
  }
</style>
