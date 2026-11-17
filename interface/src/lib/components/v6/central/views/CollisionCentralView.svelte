<script lang="ts">
  /**
   * Collision in Live's arrangement (ADR-487): Mallet · Noise, Live's tabs
   * (Resonator 1 · Resonator 2 · LFO · MIDI) swapping the middle, and Global
   * (how the resonators are joined, over the volume). A resonator's tab is
   * what is struck, one touch row, over its six knobs in one row; every knob
   * on the face is one size (ADR-544). A section's eyebrow is its name; the
   * band opens no page (ADR-513). The panel is data
   * (`panel/collisionPanel.ts`), bound by Live's parameter names. Until
   * 2026-10-27 the view was one XY pad per resonator, bound by index, and
   * Resonator 2's had Decay and Material swapped. At full screen it draws
   * the panel's board (ADR-512): the resonators, the LFOs and the MIDI
   * sources as tables, no tab strip and no page to open.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { selectedAmountScheme } from '$lib/utils/selectedTrackInk';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { COLLISION_PANEL } from './panel/collisionPanel';
  import EnvelopeGraph from '../EnvelopeGraph.svelte';

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

  // Every amount is the selected track's ink (ADR-544): the view has no
  // colour of its own.
  let collisionInk = $derived(selectedAmountScheme());

  const params = usePanelParams(() => device);
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    {#snippet noiseEnvelope()}
      <EnvelopeGraph {params} ink={collisionInk.primary} sw="Noise On/Off" names={{ attack: 'Noise Attack', decay: 'Noise Decay', sustain: 'Noise Sustain', release: 'Noise Release' }} />
    {/snippet}
    <InstrumentPanelView panel={COLLISION_PANEL} {params} color={collisionInk} board={centralDisplayStore.expanded} slots={{ noiseEnvelope }} />
  {:else}
    <DeviceEmptyState glyph="~" message="Load Collision to access resonator controls" color={collisionInk.primary} />
  {/if}
</div>
