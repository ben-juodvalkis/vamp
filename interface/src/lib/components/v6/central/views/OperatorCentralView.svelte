<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import EnvelopeGroup from './EnvelopeGroup.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import MidiWheel from '../../midi/MidiWheel.svelte';
  import { send } from '$lib/api/simpleClient';
  import { sendPitchWheel, sendModWheel } from '$lib/api/midiWheels';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { PITCH_COLOR, MOD_COLOR, familyScheme } from '$lib/config/devicePresets';
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

  // MIDI wheel colors (match other central views)
  let pitchInk = $derived(trackScheme ?? {
    primary: trackInk(PITCH_COLOR.primary, paintModeReactive()),
    secondary: PITCH_COLOR.secondary,
    accent: trackInk(PITCH_COLOR.accent, paintModeReactive())
  });
  let modInk = $derived(trackScheme ?? {
    primary: trackInk(MOD_COLOR.primary, paintModeReactive()),
    secondary: MOD_COLOR.secondary,
    accent: trackInk(MOD_COLOR.accent, paintModeReactive())
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
    { index: AE_ATTACK, title: 'A', atRest: 0.5 },
    { index: AE_DECAY, title: 'D', atRest: 0.5 },
    { index: AE_SUSTAIN, title: 'S', atRest: 1 },
    { index: AE_RELEASE, title: 'R', atRest: 0.5 }
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

  // MIDI wheel handlers
  function handlePitchChange(value: number) {
    sendPitchWheel(value);
  }

  function handleModChange(value: number) {
    sendModWheel(value);
  }
</script>

<div class="h-full w-full overflow-hidden relative">
  {#if instrument && device}
    <!-- Seven slider columns on one ruler, then the wheels. The envelope
         card is 4fr against the three 1fr sliders beside it, so a stage
         inside the card is the same width as Feedback, Time or Tone
         (bar the card's own frame) instead of twice it — which is what a
         `1fr` card next to three fixed `w-24` columns gave. -->
    <div class="h-full w-full p-(--central-inset) grid gap-(--central-gap)" style="grid-template-columns: 4fr 1fr 1fr 1fr auto auto auto;">
      <!-- The amp envelope, one slider a stage, reading A → D → S → R.
           The bracket's label is what names the section, which is what
           lets the sliders inside it be one letter each. It opens the band,
           so it draws only its trailing hairline — a leading one sat against
           the view's own left edge (2026-09-13). That hairline lives INSIDE
           this cell, so the cell's gap must be the grid's (both --central-gap, ADR-434): at 8px it
           sat 8px from R and 16px from Feedback (measured, 2026-09-14). -->
      <div class="min-w-0 min-h-0 h-full flex gap-(--central-gap)">
        <EnvelopeGroup ink={operatorInk.primary} edges="trailing">
          <!-- The swap pill lies across the top of the envelope, the view's
               leading group (user's layout, 2026-09-16). -->
          {#snippet header()}<HostedSwapPill />{/snippet}
          {#each ENVELOPE as stage, i}
            <div class="min-w-0 h-full flex-1">
              <DeviceSlider
                value={envelopeValues[i]}
                title={stage.title}
                orientation="vertical"
                labelOrientation="horizontal"
                color={operatorInk}
                onInteraction={(value) => writeEnv(stage.index, value)}
              />
            </div>
          {/each}
        </EnvelopeGroup>
      </div>
      <!-- FEEDBACK slider -->
      <div class="h-full min-w-0">
        <DeviceSlider
          value={feedbackValue}
          title="Feedback"
          orientation="vertical"
          labelOrientation="horizontal"
          color={operatorInk}
          onInteraction={handleFeedbackInteraction}
        />
      </div>
      <!-- TIME slider: global envelope-time scale, bipolar around 0 -->
      <div class="h-full min-w-0">
        <DeviceSlider
          value={timeValue}
          title="Time"
          orientation="vertical"
          labelOrientation="horizontal"
          color={operatorInk}
          min={-100}
          max={100}
          centerOrigin={true}
          centerValue={0}
          onInteraction={handleTimeInteraction}
        />
      </div>
      <!-- TONE slider -->
      <div class="h-full min-w-0">
        <DeviceSlider
          value={toneValue}
          title="Tone"
          orientation="vertical"
          labelOrientation="horizontal"
          color={operatorInk}
          onInteraction={handleToneInteraction}
        />
      </div>
      <!-- The wheels send MIDI, not Operator parameters: a seam divides the
           device from them, as in every instrument view (2026-09-13). -->
      <SectionDivider orientation="vertical" />
      <!-- MIDI wheels — fixed, the two `auto` columns; they are not part
           of the slider ruler and never share its width. -->
      <div class="h-full w-24">
        <MidiWheel
          type="pitch"
          onInteraction={handlePitchChange}
          color={pitchInk}
        />
      </div>
      <div class="h-full w-24">
        <MidiWheel
          type="modwheel"
          onInteraction={handleModChange}
          color={modInk}
        />
      </div>
    </div>
  {:else}
    <!-- Default state when no Operator present -->
    <DeviceEmptyState glyph="~" message="Load Operator to access FM controls" color={operatorInk.primary} />
  {/if}
</div>
