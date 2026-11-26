<script lang="ts">
  import { press } from '$lib/actions/press';
  /**
   * CompressorCentralView — the Compressor's view (slot `compressor`,
   * Compressor2).
   *
   *   Sidechain [the sources · Cutoff]  |  Threshold [the Compressor module]
   *   |  Output [Output / Makeup]
   *
   * On the face grid (ADR-510), sections [3, 2, 1], in Live's order: what
   * the detector hears, the compression, the level out. Every Compressor
   * control the app has: the sidechain source grid and its cutoff, the
   * Compressor module itself (the chain cell's threshold box, which draws
   * Live's activity view over its fill while Live is read, ADR-543), and
   * the output gain over its Makeup auto toggle (a switch at a column's
   * foot, as the Limiter's and the Utility's are).
   *
   * The module is the main gesture and stands on two columns, wide enough
   * for the activity view's whole history (128 columns at 2px). Until
   * ADR-544's rollout it was the last column of four, one column wide,
   * behind a sidechain section that took half the band with its Cutoff
   * knob floating under the sources; the Cutoff now has a column of its
   * own beside them, the size of the Output knob.
   *
   * Split out of the shared dynamics view (`SquashCentralView`, which also
   * held the Glue, the Gate and the Multiband) when the FX chain overview
   * gave every device its own view (ADR-478).
   *
   * Self-contained: queries its own slot state, takes no props, and
   * renders through ghost/loading/active without a `{#if device}` gate.
   */

  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import CompressorControl from '../../device-panel/CompressorControl.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { useDeviceProperties } from '$lib/components/v6/central/useDeviceProperties.svelte';
  import { PICTURE_CONTEXT } from '$lib/components/v6/browser/devicePictures';
  import { setContext } from 'svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const compressor = useFxGridSlot('compressor');

  // The module draws its device's picture, as its chain cell does: the
  // transfer curve, bending at the threshold, which gives way to Live's
  // activity view while there is a reading (ADR-543). Without it the box
  // was a blank slab of ink at a threshold near the top, where a fresh
  // Compressor stands.
  setContext(PICTURE_CONTEXT, true);

  // One ink (ADR-544): the selected track's, as the slot hands it over. A
  // ghost or a switched-off control dims (`isGhost`); it does not change
  // colour (a grey scheme of its own until the rollout).
  let liveInk = $derived(compressor.color);

  // The sidechain routing properties, subscribed while the view is mounted
  // on a device (re-subscribed when its path changes).
  const deviceProps = useDeviceProperties(() => compressor.devicePath, [
    'available_input_routing_types',
    'input_routing_type'
  ]);

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
    if (!compressor.devicePath) return [] as any[];
    const value = deviceProps.raw('available_input_routing_types');
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
    if (!compressor.devicePath) return null;
    const value = deviceProps.raw('input_routing_type');
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
     One face grid (ADR-510), six columns of ~157px at 1366 x 1024:
     sidechain 3 (the sources over two, Cutoff) | compressor 2 | output 1. -->
<div class="comp-central-layout relative">
<FaceGrid sections={[3, 2, 1]}>
  <FaceSection span={3}>
  {#snippet head()}<PanelEyebrow title="Sidechain" color={liveInk.primary} />{/snippet}
  <!-- Sidechain routing: the sources, the one section whose content grows
       with the set. -->
  <div class="device-wrapper sidechain-section face-span-2" style={compressor.isGhost ? 'opacity: var(--opacity-ghost);' : ''}>
    {#if Array.isArray(availableTypes) && availableTypes.length > 0}
      <!-- Adaptive grid: adjusts rows/columns based on item count -->
      <div class="sidechain-grid" style="grid-template-columns: repeat({sidechainLayout.cols}, 1fr); grid-template-rows: repeat({sidechainLayout.rows}, 1fr);">
        {#each availableTypes as track}
          {@const isSelected = routingMatches(inputRoutingType, track)}
          {@const isActive = sidechainEnabled && isSelected}
          <button
            class="physical-button {sidechainLayout.rows > 2 ? 'text-sm' : 'text-base'} font-medium h-full whitespace-normal text-center leading-tight px-1 py-1 flex items-center justify-center"
            class:active={isActive}
            use:press={{ onPress: () => handleSidechainSelect(track) }}
          >
            <span class="w-full break-words">
              {track.display_name || `Track ${track.identifier}`}
            </span>
          </button>
        {/each}
      </div>
    {:else if compressor.isGhost}
      <p class="sidechain-empty">Tap to load compressor</p>
    {:else}
      <p class="sidechain-empty">No sidechain sources available</p>
    {/if}
  </div>

  <!-- Cutoff: live only while the sidechain is on. Its cell leaves the
       foot row free, so the knob stands level with Output's. -->
  <div
    class="device-wrapper knob-cell over-foot"
    style={compressor.isGhost || !sidechainEnabled ? 'opacity: var(--opacity-ghost);' : ''}
  >
    <DeviceSlider
      value={cutoffValue}
      title="Cutoff"
      face="knob"
      knobSize="l"
      knobFit
      knobCaptionBelow
      icon="cutoff"
      orientation="horizontal"
      min={CUTOFF_MIN}
      max={CUTOFF_MAX}
      isGhost={compressor.isGhost || !sidechainEnabled}
      color={liveInk}
      readout={compressor.paramDisplay(CUTOFF_PARAM)}
      onInteraction={handleCutoffChange}
    />
  </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={2}>
  {#snippet head()}<PanelEyebrow title="Threshold" color={liveInk.primary} />{/snippet}
  <!-- Compressor Control (virtual device - handles its own slot state):
       the threshold box. Its picture stands for its name, so the section
       carries it. -->
  <div class="device-wrapper compressor-wrapper face-span-2">
    <CompressorControl device={compressor.device} />
  </div>
  </FaceSection>
  <FaceSeam />

  <FaceSection span={1}>
  {#snippet head()}<PanelEyebrow title="Output" color={liveInk.primary} />{/snippet}
  <!-- Makeup Section: the Output knob over its Auto toggle (one touch row) -->
  <div class="device-wrapper makeup-section">
    <!-- Makeup Gain knob -->
    <div class="device-wrapper knob-cell">
      <DeviceSlider
        value={makeupGainValue}
        title="Output"
        face="knob"
        knobSize="l"
        knobFit
        knobCaptionBelow
        icon="output"
        orientation="vertical"
        min={MAKEUP_GAIN_MIN}
        max={MAKEUP_GAIN_MAX}
        isGhost={compressor.isGhost}
        color={liveInk}
        readout={compressor.paramDisplay(MAKEUP_GAIN_PARAM)}
        onInteraction={handleMakeupGainChange}
      />
    </div>
    <!-- Makeup Auto toggle (the foot) -->
    <button
      use:press={{ onPress: () => toggleMakeupAuto() }}
      class="physical-button btn-toggle makeup-toggle"
      class:active={makeupAutoEnabled}
    >
      Makeup
    </button>
  </div>
  </FaceSection>
</FaceGrid>
</div>

<style>
  /* sidechain | compressor | output, on the FaceGrid (ADR-510). */
  .comp-central-layout {
    height: 100%;
    width: 100%;
    min-height: 0;
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

  /* No sources (or no device yet): the list's own ground, saying why it
     is empty. */
  .sidechain-empty {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--spacing-sm);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    font-size: 0.875rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  /* A knob in its cell: the largest size the cell holds (`knobFit`). */
  .knob-cell {
    flex: 1 1 0;
  }
  .knob-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }

  .knob-cell.over-foot {
    margin-bottom: calc(var(--height-touch) + var(--face-gutter));
  }

  .makeup-section {
    gap: var(--face-gutter);
  }

  /* One touch row under its knob (ADR-509): the knob keeps the height. */
  .makeup-toggle {
    flex-shrink: 0;
    height: var(--height-touch);
    min-height: var(--height-touch);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .compressor-wrapper {
    min-height: 0;
  }

  /* Adaptive grid for sidechain buttons - rows/cols set via inline style */
  .sidechain-grid {
    display: grid;
    grid-auto-flow: column;
    /* grid-template-columns and grid-template-rows set via inline style */
    gap: var(--face-gutter);
    flex: 1;
    min-height: 0;
  }

  /* ---- Live skin (flat grammar) ------------------------------------
     The sidechain sources and the Makeup toggle are shared
     .physical-button toggles (flat in app.css; ON and the label's colour
     are its two laws, ADR-544); the knobs and the Compressor module carry
     their own flat overrides. What this view adds: Live sets control text
     medium. Nothing below applies outside [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .makeup-toggle {
    font-weight: var(--font-weight-medium);
  }
</style>
