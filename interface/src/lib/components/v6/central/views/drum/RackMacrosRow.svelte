<script lang="ts">
  /**
   * RackMacrosRow — the `rack-macros` profile's row (2026-09-07; split out
   * of the Drum Rack view on 2026-09-10): a kit whose pads are nested
   * Instrument Racks gets one slider per pad-rack macro name, each writing
   * `vm.macro.<name>` — the surface fans it out to every pad rack's macro
   * of that name. The kit's transpose-named macro is `pitch`'s member, so
   * Trnsp (a snippet the parent supplies) stands in that macro's place.
   *
   * Two rows of value boxes, filled column by column (ADR-477), the view's
   * Gain first so it sits over Trnsp as it does on every other kit.
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
    /** The view's Gain, the first box. */
    gain?: Snippet;
  }

  let { layout, value, state, badge, coverage, color, onWrite, trnsp, gain }: Props = $props();
</script>

<div class="flex-1 min-h-0 gap-(--central-gap) vm-rack-macros">
  {#if gain}
    <div class="rack-slot rack-slider" data-vm-function="gain">
      {@render gain()}
    </div>
  {/if}
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
     One box per pad-rack macro name, two rows filled column by column. */
  .vm-rack-macros {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    grid-auto-columns: minmax(0, 1fr);
  }
  .vm-rack-macros > :global(.rack-slot) {
    display: flex;
    min-height: 0;
    min-width: 0;
  }
</style>
