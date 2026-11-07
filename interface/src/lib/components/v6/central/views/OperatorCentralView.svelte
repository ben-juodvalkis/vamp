<script lang="ts">
  /**
   * Operator in Live's arrangement (ADR-487): Live's oscillator, LFO and
   * pitch-envelope tabs over the middle (each its main knobs and its
   * envelope), the Filter's type, Env and Drive, and Time · Tone · Volume;
   * every eyebrow opens its section's page. The Filter pad with its response
   * curve is the Filter page's picture (`aside`), not the frame's: the chain
   * cell's XY is the same Freq and Res. The panel is data
   * (`panel/operatorPanel.ts`), bound by Live's parameter names; the pad is
   * this view's own (`slots.filter`), bound the same way. Until 2026-10-27 the
   * view was the amp envelope, Feedback, Time, Tone and the Filter pad,
   * bound by index. At full screen it draws the panel's board (ADR-512):
   * the oscillators and the envelopes as tables, every page at once.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import { liveFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import InstrumentPanelView from './panel/InstrumentPanelView.svelte';
  import { usePanelParams } from './panel/usePanelParams.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { OPERATOR_PANEL } from './panel/operatorPanel';
  import { operatorOscStore } from '$lib/stores/v6/operatorOscStore.svelte';
  import { OPERATOR_ENVS, operatorEnvelope } from './panel/operatorPanel';
  import EnvelopeGraph from '../EnvelopeGraph.svelte';
  import ScrubTabs from '../../device-panel/ScrubTabs.svelte';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Operator color scheme — distortion family (the view's old orange on
  // the gap wheel, ADR-400; matches Operator's UI aesthetic).
  const operatorColor = familyScheme('distortion');

  // GRATICULE (§5.5): normalize the per-section palette through trackInk at injection.
  let trackScheme = $derived(selectedTrackScheme());
  let operatorInk = $derived(trackScheme ?? {
    primary: trackInk(operatorColor.primary, paintModeReactive()),
    secondary: operatorColor.secondary,
    accent: trackInk(operatorColor.accent, paintModeReactive())
  });

  const params = usePanelParams(() => device);

  // Cutoff across, resonance up, the filter's response drawn under them.
  // Reaching for the pad is the request to hear the filter, so a drag
  // turns it on (as the Sampler's pad does); it never turns it off.
  let filterOn = $derived(params.isOn('Filter On'));
  let filterCurve = $derived(
    liveFilterCurve(params.raw('Filter Type') ?? 0, params.raw('Filter Slope') ?? 1, params.raw('Filter Morph') ?? 0)
  );

  // The board's envelope (ADR-514): the face's oscillator's until one is
  // picked over the picture, as Live's display shows the shown tab's.
  let envPicked = $state<number | null>(null);
  let envShown = $derived.by(() => {
    if (envPicked !== null) return envPicked;
    const osc = device ? operatorOscStore.oscOf(device.devicePath) : undefined;
    return typeof osc === 'number' && osc >= 0 && osc < 4 ? osc : 0;
  });
  let env = $derived(OPERATOR_ENVS[envShown]);

  function handleFilterXY(x: number, y: number) {
    params.writeUnit('Filter Freq', x, 'Filter On');
    params.writeUnit('Filter Res', y, 'Filter On');
  }
</script>

  {#snippet filterPad()}
    <!-- Ghosted while the filter is off; a drag turns it on. -->
    <div class="h-full min-w-0" style={filterOn ? '' : 'opacity: var(--opacity-ghost);'}>
      <DeviceXY
        xValue={params.unit('Filter Freq') ?? 1}
        yValue={params.unit('Filter Res') ?? 0}
        title="Filter"
        isGhost={!filterOn}
        showCurve={filterOn && filterCurve.curveType !== 'none'}
        curveType={filterCurve.curveType}
        curveOrder={filterCurve.order}
        curveFreqRange={FILTER_FREQ_RANGE.operator}
        onInteraction={handleFilterXY}
        color={operatorInk}
      />
    </div>
  {/snippet}

  {#snippet envelopePanel()}
    <div class="op-env" data-operator-envelope={env.title}>
      <ScrubTabs
        options={OPERATOR_ENVS.map((_, i) => i)}
        selected={envShown}
        onSelect={(i) => (envPicked = i)}
        cols={OPERATOR_ENVS.length}
        tint={operatorInk.primary}
        inked
        label={(i) => OPERATOR_ENVS[i].title}
        groupLabel="Envelope shown"
        style="height: var(--height-touch); --scrub-font-size: 0.8125rem;"
      />
      <div class="op-env-graph">
        <EnvelopeGraph {params} names={operatorEnvelope(env)} ink={operatorInk.primary} sw={env.on} />
      </div>
    </div>
  {/snippet}

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <InstrumentPanelView
      panel={OPERATOR_PANEL}
      {params}
      color={operatorInk}
      slots={{ filter: filterPad, envelope: envelopePanel }}
      board={centralDisplayStore.expanded}
      tabOf={(region) => (region === 0 ? operatorOscStore.oscOf(device.devicePath) : undefined)}
    />
  {:else}
    <!-- Default state when no Operator present -->
    <DeviceEmptyState glyph="~" message="Load Operator to access FM controls" color={operatorInk.primary} />
  {/if}
</div>

<style>
  .op-env {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    height: 100%;
    min-height: 0;
  }
  .op-env-graph {
    flex: 1 1 0;
    min-height: 0;
  }
</style>
