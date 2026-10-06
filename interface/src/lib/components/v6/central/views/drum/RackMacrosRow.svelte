<script lang="ts">
  /**
   * RackMacrosRow — the `rack-macros` profile's row (2026-09-07; split out
   * of the Drum Rack view on 2026-09-10): a kit whose pads are nested
   * Instrument Racks gets one slider per pad-rack macro name, each writing
   * `vm.macro.<name>` — the surface fans it out to every pad rack's macro
   * of that name. The kit's transpose-named macro is `pitch`'s member, so
   * Trnsp (a snippet the parent supplies) stands in that macro's place.
   *
   * A dumb row: values, states and badges in, a write out.
   */
  import type { Snippet } from 'svelte';
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
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
  }

  let { layout, value, state, badge, coverage, color, onWrite, trnsp }: Props = $props();
</script>

<div class="flex-1 min-h-0 flex gap-(--central-gap) vm-rack-macros">
  {#if trnsp}
    <!-- Trnsp in the transpose macro's place: the same knob, in semitones.
         First, beside the view's Gain, where every kit keeps it (2026-09-27). -->
    <div class="rack-slot rack-slider" data-vm-function="pitch">
      {@render trnsp()}
    </div>
  {/if}
  {#each layout as control (control.name)}
    {@const sliderState = state(control.name)}
    <VmSlot
      state={sliderState}
      class="rack-slot rack-slider"
      macro={control.name}
      badge={badge(control.name)}
      coverage={coverage(control.name)}
    >
      <DeviceSlider
        value={value(control.name)}
        title={control.label}
        icon={glyphForName(control.label)}
        orientation="vertical"
        labelOrientation="horizontal"
        {color}
        isGhost={sliderState === 'none'}
        onInteraction={(t) => onWrite(control.name, t)}
      />
    </VmSlot>
  {/each}
</div>

<style>
  /* ---- Rack-macros profile ------------------------------------------
     One slider per pad-rack macro name. */
  .vm-rack-macros > :global(.rack-slot) {
    display: flex;
    min-height: 0;
    min-width: 0;
    height: 100%;
    flex-shrink: 1;
  }
  .vm-rack-macros > :global(.rack-slider) {
    flex: 1 1 0;
    min-width: 40px;
  }
</style>
