<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import { liveFilterCurve, FILTER_FREQ_RANGE } from '$lib/utils/instrumentFilterCurves';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme } from '$lib/config/devicePresets';
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

  // Operator LOM parameter indices — read off the running device
  // (tracks/N/devices/0 `parameters[i].name`, 2026-09-07), not the .adv:
  // Operator's XML nests every section, so document order is not LOM order.
  const AE_ATTACK = 29;      // 'Ae Attack'    0..1
  const AE_DECAY = 31;       // 'Ae Decay'
  const AE_SUSTAIN = 33;     // 'Ae Sustain'
  const AE_RELEASE = 34;     // 'Ae Release'   0..1
  const OSC_A_FEEDBACK = 26; // 'Osc-A Feedb'  0..100
  const TONE = 8;            // 'Tone'         0..1   (global)
  const TIME = 120;          // 'Time'      -100..100 (global envelope-time scale)

  // The filter, read off the running device 2026-10-22 (Live 12.4.15):
  // Freq 30 Hz..18.5 kHz on a log sweep, Res 0..1.25 (Live's 0..125 %),
  // Type 0..4 Lowpass/Highpass/Bandpass/Notch/Morph, Slope 12/24 dB.
  const FILTER_ON = 165;     // 'Filter On'
  const FILTER_TYPE = 166;   // 'Filter Type'
  const FILTER_SLOPE = 169;  // 'Filter Slope'
  const FILTER_FREQ = 170;   // 'Filter Freq'  0..1
  const FILTER_RES = 171;    // 'Filter Res'   0..1.25
  const FILTER_MORPH = 172;  // 'Filter Morph' 0..1

  // The amp envelope, four sliders in ADSR order (user's call and user's
  // indices, 2026-09-12). It was an XY pad reading Attack across and
  // Release up, which reached neither Decay nor Sustain at all.
  //
  // Read and written through the parameter's OWN range rather than raw:
  // Attack and Release are 0..1, but Decay and Sustain have never been
  // measured on this device and a raw pass-through would silently write
  // the wrong units if either is not. `paramRange` is Live's own answer,
  // so this is right whatever they turn out to be, and a no-op on the two
  // that were already 0..1.
  const ENVELOPE = [
    { index: AE_ATTACK, title: 'A', icon: 'attack', atRest: 0.5 },
    { index: AE_DECAY, title: 'D', icon: 'decay', atRest: 0.5 },
    { index: AE_SUSTAIN, title: 'S', icon: 'sustain', atRest: 1 },
    { index: AE_RELEASE, title: 'R', icon: 'release', atRest: 0.5 }
  ] as const;

  function envValue(index: number, atRest: number): number {
    if (!device) return atRest;
    const path = selectedTrackStore.paramPath(device, index);
    const raw = selectedTrackStore.paramValueArmed(path);
    if (raw === undefined) return atRest;
    const range = selectedTrackStore.paramRange(path);
    if (!range || range.max <= range.min) return Math.max(0, Math.min(1, raw));
    return Math.max(0, Math.min(1, (raw - range.min) / (range.max - range.min)));
  }

  function writeEnv(index: number, value: number) {
    if (!device) return;
    const path = selectedTrackStore.paramPath(device, index);
    const range = selectedTrackStore.paramRange(path);
    const raw = range && range.max > range.min ? range.min + value * (range.max - range.min) : value;
    selectedTrackStore.setParamValue(path, raw);
  }

  let envelopeValues = $derived(ENVELOPE.map((stage) => envValue(stage.index, stage.atRest)));

  function rawValue(index: number, atRest: number): number {
    if (!device) return atRest;
    return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? atRest;
  }

  // Cutoff across, resonance up, the filter's response drawn under them.
  // Reaching for the pad is the request to hear the filter, so a drag
  // turns it on (as the Sampler's pad does); it never turns it off.
  let filterOn = $derived(rawValue(FILTER_ON, 1) >= 0.5);
  let filterCurve = $derived(
    liveFilterCurve(rawValue(FILTER_TYPE, 0), rawValue(FILTER_SLOPE, 1), rawValue(FILTER_MORPH, 0))
  );

  function handleFilterXY(x: number, y: number) {
    if (!device) return;
    if (!filterOn) selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, FILTER_ON), 1);
    writeEnv(FILTER_FREQ, x);
    writeEnv(FILTER_RES, y);
  }

  // Feedback (range 0-100, normalized to 0-1 for slider)
  let feedbackValue = $derived(device ? (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, OSC_A_FEEDBACK)) ?? 0) / 100 : 0);

  // Time and Tone ride the slider in raw Live units (the wire carries raw
  // units, wire-protocol §2): Time is bipolar -100..100 around 0, Tone 0..1.
  let timeValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, TIME)) ?? 0 : 0);
  let toneValue = $derived(device ? selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, TONE)) ?? 0.7 : 0.7);

  // Feedback slider handler (scale 0-1 slider to 0-100 parameter)
  function handleFeedbackInteraction(value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, OSC_A_FEEDBACK), value * 100);
  }

  function handleTimeInteraction(value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, TIME), Math.max(-100, Math.min(100, value)));
  }

  function handleToneInteraction(value: number) {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, TONE), Math.max(0, Math.min(1, value)));
  }

  /** Live's own value, a box's readout while it is dragged (ADR-477); sent only while the UI writes. */
  function display(index: number): string | undefined {
    if (!device) return undefined;
    return selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, index));
  }
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- One ruler of tall value boxes (ADR-477): the swap pill over the amp
         envelope's four stages and Feedback, Time and Tone, then the Filter
         pad. Until 2026-10-27 the boxes were two short rows filling the
         left half (ADSR 105 x 75, 50 tall on the iPad mini) beside a
         half-width pad. The wheels left for the MidiWheels device's chain
         cell (user, 2026-10-26). -->
    <div class="h-full w-full p-(--central-inset) grid gap-(--central-gap)" style="grid-template-columns: minmax(0, 7fr) auto minmax(0, 3fr);">
      <div class="min-w-0 min-h-0 h-full flex flex-col gap-(--central-gap)">
        <!-- The swap pill lies across the top, over the boxes it leads
             (user's layout, 2026-09-16). -->
        <HostedSwapPill />
        <div class="flex-1 min-h-0 flex gap-(--central-gap)">
          <!-- The amp envelope, one box a stage, reading A → D → S → R. The
               bracket's label names the section, which lets the boxes inside
               be one letter each; its trailing hairline is the seam to
               Feedback. -->
          <div class="min-w-0 h-full flex gap-(--central-gap)" style="flex: 4 1 0;">
            <EnvelopeGroup ink={operatorInk.primary} edges="trailing">
              {#each ENVELOPE as stage, i}
                <div class="min-w-0 h-full flex-1">
                  <DeviceSlider
                    value={envelopeValues[i]}
                    title={stage.title}
                    icon={stage.icon}
                    orientation="vertical"
                    color={operatorInk}
                    readout={display(stage.index)}
                    onInteraction={(value) => writeEnv(stage.index, value)}
                  />
                </div>
              {/each}
            </EnvelopeGroup>
          </div>
          <!-- Feedback, Time, Tone: under an empty eyebrow line, so their
               tops sit level with the stages'. -->
          <div class="min-w-0 h-full flex flex-col tone-group" style="flex: 3 1 0;">
            <span class="eyebrow-spacer" aria-hidden="true">&nbsp;</span>
            <div class="flex-1 min-h-0 flex gap-(--central-gap)">
              <div class="flex-1 min-w-0 h-full">
                <DeviceSlider
                  value={feedbackValue}
                  title="Feedback"
                  icon="feedback"
                  orientation="vertical"
                  color={operatorInk}
                  readout={display(OSC_A_FEEDBACK)}
                  onInteraction={handleFeedbackInteraction}
                />
              </div>
              <!-- Time: the global envelope-time scale, bipolar around 0 -->
              <div class="flex-1 min-w-0 h-full">
                <DeviceSlider
                  value={timeValue}
                  title="Time"
                  icon="envelope"
                  orientation="vertical"
                  color={operatorInk}
                  min={-100}
                  max={100}
                  centerOrigin={true}
                  centerValue={0}
                  readout={display(TIME)}
                  onInteraction={handleTimeInteraction}
                />
              </div>
              <div class="flex-1 min-w-0 h-full">
                <DeviceSlider
                  value={toneValue}
                  title="Tone"
                  icon="tone"
                  orientation="vertical"
                  color={operatorInk}
                  readout={display(TONE)}
                  onInteraction={handleToneInteraction}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <SectionDivider orientation="vertical" ink={operatorInk.primary} />
      <!-- FILTER: cutoff across, resonance up, the response curve beneath.
           Ghosted while the filter is off; a drag turns it on. -->
      <div class="h-full min-w-0" style={filterOn ? '' : 'opacity: var(--opacity-ghost);'}>
        <DeviceXY
          xValue={envValue(FILTER_FREQ, 1)}
          yValue={envValue(FILTER_RES, 0)}
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
    </div>
  {:else}
    <!-- Default state when no Operator present -->
    <DeviceEmptyState glyph="~" message="Load Operator to access FM controls" color={operatorInk.primary} />
  {/if}
</div>

<style>
  /* The eyebrow's line (EnvelopeGroup's 0.75rem title and its gap), drawn
     empty so Feedback, Time and Tone start level with the stages. */
  .tone-group {
    gap: var(--spacing-xs);
  }
  .eyebrow-spacer {
    flex: 0 0 auto;
    font-size: 0.75rem;
    font-weight: 700;
  }
</style>
