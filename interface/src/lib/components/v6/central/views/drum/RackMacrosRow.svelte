<script lang="ts">
  /**
   * RackMacrosRow — the `rack-macros` profile's row (2026-09-07; split out
   * of the Drum Rack view on 2026-09-10): a kit whose pads are nested
   * Instrument Racks gets one knob per pad-rack macro name, each writing
   * `vm.macro.<name>` — the surface fans it out to every pad rack's macro
   * of that name. The kit's transpose-named macro is `pitch`'s member, so
   * Trnsp (a snippet the parent supplies) stands in that macro's place.
   *
   * Trnsp is the full-height column it is on every kit, a slider's width;
   * then the view's Gain and the macros as one grid of knobs (ADR-509),
   * Gain first, filled row by row. The grid takes the rows whose cells hold
   * the knobs at one size with their names whole (`KnobGrid`): the count is
   * the kit's, not a face's, and a kit-maker's "Pitch Amount" beside "Pitch
   * Attack" must not both read "Pitch ...", as they did on two rows of four
   * large knobs. (Two rows filled column by column, ADR-477, until
   * ADR-544.)
   *
   * A dumb row: values, states and badges in, a write out.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import KnobGrid from '../../../device-panel/KnobGrid.svelte';
  import type { KnobSize } from '../../../device-panel/knobLayout';
  import { glyphForName } from '$lib/config/controlGlyphMap';
  import VmSlot from './VmSlot.svelte';
  import type { RackMacroControl, VmState } from '$lib/services/drumVirtualMacros';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';

  interface Props {
    layout: readonly RackMacroControl[];
    /** One macro's `t`, at rest when unknown. */
    value: (name: string) => number;
    state: (name: string) => VmState;
    /** "held by macro" text for one or two names, or nothing. */
    badge: (...names: string[]) => string | null;
    /** "pads reached" text for one or two names, or nothing. */
    coverage: (...names: string[]) => string | null;
    color: DeviceColorScheme;
    onWrite: (name: string, t: number) => void;
    /** Trnsp, drawn in the transpose macro's place when the kit has one. */
    trnsp?: Snippet;
    /** The view's Gain, the grid's first knob, at the grid's size. */
    gain?: Snippet<[knob?: boolean, inside?: boolean, size?: KnobSize]>;
  }

  let { layout, value, state, badge, coverage, color, onWrite, trnsp, gain }: Props = $props();

  let lead = $derived(gain ? 1 : 0);
</script>

<div class="flex-1 min-h-0 gap-(--central-gap) vm-rack-macros">
  <!-- Trnsp first, the full-height column; Gain the first of the knobs
       beside it (user, 2026-11-06), as on every kit. -->
  {#if trnsp}
    <div class="rack-slot rack-slider rack-trnsp" data-vm-function="pitch">
      {@render trnsp()}
    </div>
  {/if}
  <KnobGrid count={layout.length + lead} maxRows={3} ceiling="l">
    {#snippet item(i: number, size: KnobSize)}
      {#if gain && i === 0}
        <div class="rack-slot rack-slider" data-vm-function="gain">
          {@render gain(true, false, size)}
        </div>
      {:else}
        {@const control = layout[i - lead]}
        {@const sliderState = state(control.name)}
        <VmSlot
          state={sliderState}
          class="rack-slot rack-slider"
          macro={control.name}
          badge={badge(control.name)}
          coverage={coverage(control.name)}
          badgeAt="edge"
        >
          <DeviceSlider
            value={value(control.name)}
            title={control.label}
            face="knob"
            knobSize={size}
            icon={glyphForName(control.label)}
            orientation="vertical"
            labelOrientation="horizontal"
            {color}
            isGhost={sliderState === 'none'}
            onInteraction={(t) => onWrite(control.name, t)}
          />
        </VmSlot>
      {/if}
    {/snippet}
  </KnobGrid>
</div>

<style>
  /* ---- Rack-macros profile ------------------------------------------
     Trnsp, a slider's width, then the grid of knobs. */
  .vm-rack-macros {
    display: flex;
  }
  .vm-rack-macros :global(.rack-slot) {
    display: flex;
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .vm-rack-macros :global(.rack-slot > *) {
    flex: 1 1 0;
    min-width: 0;
  }
  .vm-rack-macros > :global(.rack-slot.rack-trnsp) {
    flex: 0 0 var(--vm-slider-w, 56px);
  }
  /* A macro's name is its kit-maker's, not the app's, and as long as it
     likes: the knobs' names take their size from the cell's width (12
     characters fit at any), where a knob's size alone set it and cut
     "Pitch Amount" in a narrow cell. (KnobFace's `--knob-title-fs`, read
     by the name under the knob, whose container is the cell.) */
  .vm-rack-macros :global(.knob-grid .knob) {
    --knob-title-fs: clamp(10px, 12.8cqw, 17px);
  }
</style>
