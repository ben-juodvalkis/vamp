<script lang="ts">
  /**
   * Collision in Live's arrangement (ADR-487): Mallet · Noise, Live's tabs
   * (Resonator 1 · Resonator 2 · LFO · MIDI) swapping the middle, and Global;
   * every section's eyebrow opens its page. The panel is data
   * (`panel/collisionPanel.ts`), bound by Live's parameter names. Until
   * 2026-10-27 the view was one XY pad per resonator, bound by index, and
   * Resonator 2's had Decay and Material swapped.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { COLLISION_PANEL } from './panel/collisionPanel';

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

  // Collision color scheme — distortion family (the view's old orange on
  // the gap wheel, ADR-400; physical-modeling aesthetic preserved).
  const collisionColor = familyScheme('distortion');

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let collisionInk = $derived(trackScheme ?? {
    primary: trackInk(collisionColor.primary, paintModeReactive()),
    secondary: collisionColor.secondary,
    accent: trackInk(collisionColor.accent, paintModeReactive())
  });

  const params = usePanelParams(() => device);
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <InstrumentPanelView panel={COLLISION_PANEL} {params} color={collisionInk} />
  {:else}
    <DeviceEmptyState glyph="~" message="Load Collision to access resonator controls" color={collisionInk.primary} />
  {/if}
</div>
