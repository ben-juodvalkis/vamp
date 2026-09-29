<script lang="ts">
  /**
   * Instrument Rack Pattern Central View
   *
   * For instrument racks where the first macro is "Pattern XX" (where XX is an
   * integer) — in practice the Skaka Metronome Rack.
   *
   * A fixed 2 x 3 picker beside the remaining named macros (3-16) as sliders:
   *
   *     16th | 8th | Offbeat
   *     4th  | 6/4 | Auto
   *
   * Five of those cells are macro 1's five-state `live.tab` inside the rack's
   * Skaka Metronome Picker, spread across the whole 0-127 (0, 32, 64, 95, 127)
   * with **auto first** — so the four pattern cells write states 1-4 and Auto
   * writes 0. In auto the picker's v8 chooses from tempo and meter; the other
   * four force. Offbeat is macro 2's toggle (0 / 127) and is not a state.
   *
   * Superseded (2026-09-17) the twelve-slot chain-selector grid whose shape was
   * measured from the space the sliders left. The slot count, the measured
   * shape and the rack's "Pattern XX" count no longer decide the layout: the
   * picker has five states and six cells whatever the rack names, so the grid
   * is a literal. `patternCountFromName` survives only as the "is this a
   * pattern rack" gate, which is also how the view is routed
   * (`useTrackDevice`). No MIDI wheels and no swap pill.
   */
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { getControlColor, familyScheme } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import { claimSwapHost } from '../swapHost.svelte';
  import { press } from '$lib/actions/press';
  import { buildMacroLayout, patternCountFromName, pickerSlotValue, pickerSlotAt } from '$lib/utils/macroLayoutUtils';

  // Import constants
  import constants from '$config/constants.json';

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // No next/prev pill here (2026-09-17): holding the swap host's claim for the
  // view's lifetime keeps CentralDisplay's column down, and nothing draws the
  // pill in its place — the pattern buttons take the whole band.
  claimSwapHost();

  // Track reactive state
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);

  // PR-4a-6a1: path-keyed device lookup (v3 tree, chain-order indexed).
  // Returns `undefined` on cold start — same "show ghost" posture as
  // the v2 .find() it replaces.
  let device = $derived(selectedTrackStore.devicesByPath[deviceIndex]);

  // Device configuration constants
  const MACRO_COUNT = constants.devices.audioEffectRack?.macroCount ?? 16;
  const MACRO_MAX = constants.devices.audioEffectRack?.macroRange?.max ?? 127;

  // Macro 1 is the picker's five-state live.tab: auto, then the four
  // patterns. Not `ui.patternSlots` (12) — that counted chain-selector
  // zones, and the picker is an enumerated parameter whose ends are real
  // positions. See pickerSlotValue's note on why the arithmetic differs.
  const PICKER_STATES = 5;

  /** Macro 1's state for pattern `i` (0-based) — auto holds state 0. */
  const patternState = (i: number) => i + 1;
  const AUTO_STATE = 0;

  /**
   * The picker's six cells in grid order, filling 2 rows x 3 columns:
   *
   *     16th | 8th | Offbeat
   *     4th  | 6/4 | Auto
   *
   * A `pattern` cell carries the 0-based pattern index, which indexes
   * `ui.patternLabels` and `ui.patternRhythms` and maps to macro 1 via
   * `patternState`. The layout is a literal rather than derived from the
   * rack's "Pattern XX" count: the rack the picker lives in has four
   * patterns and the tab has five states, and a grid that reshaped itself
   * would put Offbeat and Auto somewhere different on every rack.
   */
  type PickerCell =
    | { kind: 'pattern'; pattern: number }
    | { kind: 'auto' }
    | { kind: 'offbeat' };

  const CELLS: PickerCell[] = [
    { kind: 'pattern', pattern: 0 },
    { kind: 'pattern', pattern: 1 },
    { kind: 'offbeat' },
    { kind: 'pattern', pattern: 2 },
    { kind: 'pattern', pattern: 3 },
    { kind: 'auto' }
  ];

  const PICKER_COLS = 3;
  const PICKER_ROWS = 2;

  // Pattern labels from config (falls back to numbers if not enough labels)
  const patternLabels: string[] = constants.ui?.patternLabels ?? [];

  // The rhythm drawn in each button, by index beside the labels (a button
  // past the list shows its label alone).
  const patternRhythms: { steps: number; hits: number[]; accents?: number[] }[] = constants.ui?.patternRhythms ?? [];

  // Pattern button color — the rack theme (rackVoice rose, ADR-400;
  // matches InstrumentRackCentralView's getControlColor(0) theme).
  let trackScheme = $derived(selectedTrackScheme());
  let patternInk = $derived(trackScheme ?? {
    primary: trackInk(familyScheme('rackVoice').primary, paintModeReactive()),
    secondary: familyScheme('rackVoice').secondary,
    accent: trackInk(familyScheme('rackVoice').accent, paintModeReactive())
  });

  // Per-control macro palette, normalized through the calibrated ink layer.
  const ctlInk = (i: number) => {
    const c = getControlColor(i);
    return { primary: trackInk(c.primary, paintModeReactive()), secondary: c.secondary, accent: trackInk(c.accent, paintModeReactive()) };
  };

  // Parameter state
  let macroValues = $state(Array(MACRO_COUNT).fill(0));
  // PR-3.5.4: parameter names are a pure read off the v3 store now —
  // `paramNamesForDevice` is sync, the v2 fetch+cache scaffolding is
  // gone. `$derived` re-runs on preset swaps too, so a rack reload
  // refreshes labels without a manual debounce.
  let parameterNames = $derived(
    device ? selectedTrackStore.paramNamesForDevice(device) : []
  );

  // Is this a pattern rack at all — the same test that routes the view
  // (`useTrackDevice`). The count itself no longer shapes the grid; only
  // "greater than zero" is read, so a rack naming more patterns than the
  // picker has states still draws the picker rather than a broken grid.
  let isPatternRack = $derived(() => patternCountFromName(parameterNames[1], PICKER_STATES) > 0);

  // The picker state macro 1 currently sits on: 0 auto, 1-4 the patterns.
  let selectedState = $derived(() => pickerSlotAt(macroValues[0], PICKER_STATES, MACRO_MAX));

  // Macros 3-16 (macro 1 is the pattern selector, macro 2 the Offset button).
  const controlLayout = $derived(buildMacroLayout(parameterNames, 3, MACRO_COUNT));

  // Update macro values
  $effect(() => {
    if (device) {
      macroValues = Array.from({ length: MACRO_COUNT }, (_, i) =>
        selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, i + 1)) ?? 0
      );
    } else {
      macroValues = Array(MACRO_COUNT).fill(0);
    }
  });

  // Pick a picker state — macro 1 to that state's value (0, 32, 64, 95, 127).
  function handleStateSelect(state: number) {
    if (!device) return;
    const value = pickerSlotValue(state, PICKER_STATES, MACRO_MAX);
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 1), value);
  }

  // Handle slider changes
  function handleSliderChange(paramIndex: number, normalizedValue: number) {
    if (device) {
      selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, paramIndex), normalizedValue * MACRO_MAX);
    }
  }

  function getNormalizedValue(macroIndex: number): number {
    return macroValues[macroIndex - 1] / MACRO_MAX;
  }

  // Offbeat: macro 2 as a toggle — lit past halfway, a tap sends the other
  // end. The rack still NAMES macro 2 "Offset"; the cell is labelled for
  // what it does to the pattern.
  let offbeatOn = $derived(macroValues[1] > MACRO_MAX / 2);

  function handleOffbeatToggle() {
    if (!device) return;
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, 2), offbeatOn ? 0 : MACRO_MAX);
  }

  // The picker takes the row's width after the sliders, each slider keeping
  // a twelfth of it — so a rack with no other macros is all
  // picker. Its shape is fixed at 3 x 2, so nothing is measured: Offbeat and
  // Auto keep the same corners at every width.
  const ROW_UNITS = 12;
  let sliderUnits = $derived(controlLayout.length);
  let gridGrow = $derived(Math.max(ROW_UNITS - sliderUnits, 6));
</script>

<div class="h-full w-full flex flex-col" data-density="compact">
  {#if instrument}
    <div class="flex-1 min-h-0 flex gap-(--central-gap) p-(--central-inset) controls-panel">
      <!-- The picker: 16th | 8th | Offbeat over 4th | 6/4 | Auto -->
      {#if isPatternRack()}
        <div
          class="pattern-grid"
          style="flex-grow: {gridGrow}; grid-template-columns: repeat({PICKER_COLS}, minmax(0, 1fr)); grid-template-rows: repeat({PICKER_ROWS}, minmax(0, 1fr));"
        >
          {#each CELLS as cell}
            {#if cell.kind === 'offbeat'}
              <button
                class="physical-button pattern-button offbeat-button"
                class:active={offbeatOn}
                aria-pressed={offbeatOn}
                use:press={{ onPress: handleOffbeatToggle, touchAction: 'none' }}
                style="--btn-tint: {patternInk.primary};"
              >
                <span class="pattern-face">Offbeat</span>
              </button>
            {:else if cell.kind === 'auto'}
              <button
                class="physical-button pattern-button auto-button"
                class:active={selectedState() === AUTO_STATE}
                onclick={() => handleStateSelect(AUTO_STATE)}
                style="--btn-tint: {patternInk.primary};"
              >
                <span class="pattern-face">Auto</span>
              </button>
            {:else}
              {@const rhythm = patternRhythms[cell.pattern]}
              <button
                class="physical-button pattern-button"
                class:active={selectedState() === patternState(cell.pattern)}
                onclick={() => handleStateSelect(patternState(cell.pattern))}
                style="--btn-tint: {patternInk.primary};"
              >
                <span class="pattern-face">
                  <span class="pattern-label">{patternLabels[cell.pattern] ?? (cell.pattern + 1)}</span>
                  {#if rhythm}
                    <span class="pattern-rhythm" aria-hidden="true">
                      {#each rhythm.hits as hit}
                        <span
                          class="pattern-hit"
                          class:accent={rhythm.accents?.includes(hit)}
                          style="left: {(hit / rhythm.steps) * 100}%;"
                        ></span>
                      {/each}
                    </span>
                  {/if}
                </span>
              </button>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- The picker chooses WHAT plays; the macros shape it — the
           Reverb view's type picker | sliders, and the same seam (2026-09-13).
           Only when there is something on the other side: the real rack
           names no macros past Offbeat, and a divider against the panel
           edge is a rule with nothing to separate (caught by the tour's
           layout check, ADR-434). Offbeat used to hold that side up; it
           sits inside the picker now. -->
      {#if isPatternRack() && controlLayout.length > 0}
        <SectionDivider orientation="vertical" />
      {/if}

      <!-- A slider for each named macro 3-16 -->
      {#each controlLayout as control, i}
        <div class="control-slot slider-slot">
          <DeviceSlider
            value={getNormalizedValue(control.macroIndex)}
            title={control.name}
            orientation="vertical"
            color={ctlInk(i)}
            onInteraction={(val) => handleSliderChange(control.macroIndex, val)}
          />
        </div>
      {/each}

    </div>
  {:else}
    <DeviceEmptyState glyph="🎹" message="Load an Instrument Rack with Pattern macro" color={patternInk.primary} />
  {/if}
</div>

<style>
  .pattern-grid {
    /* flex-grow is set inline from the slider count */
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    height: 100%;
    display: grid;
    gap: var(--central-gap);
  }

  .pattern-button {
    min-width: 0;
    min-height: 0;
    /* The label, the rhythm and the space between them scale with the
       button, so four buttons across the band read large and eight beside
       sliders still fit. The sizes sit on .pattern-face, not here: a
       container's own cq units measure the container ABOVE it (with none,
       the viewport), which pinned every label at the clamp's max. */
    container-type: size;
    display: flex;
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color, border-color, color, opacity, transform;
    transition-duration: 0.15s;
    text-align: center;
    line-height: 1.1;
    padding: var(--spacing-xs);
    overflow: hidden;
  }

  .pattern-button.active {
    font-weight: 700;
  }

  .pattern-face {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(0.75rem, 9cqb, 2rem);
    font-size: clamp(max(var(--type-min), calc(24 * var(--fluid-px))), min(20cqi, 24cqb), 3.5rem);
  }

  /* The rhythm: a lane across the button, a thin tick at each hit, in the
     label's ink — the clip previews' look (2026-09-17). An accented hit
     takes the lane's full height, the rest 70% of it, both centered. */
  .pattern-rhythm {
    position: relative;
    align-self: stretch;
    height: clamp(1.25rem, 13cqb, 2.25rem);
    margin-inline: 4%;
  }

  .pattern-hit {
    position: absolute;
    top: 15%;
    bottom: 15%;
    width: 2px;
    background: currentColor;
    opacity: 0.8;
  }

  .pattern-hit.accent {
    top: 0;
    bottom: 0;
  }

  .controls-panel {
    flex: 1;
    display: flex;
    flex-direction: row;
    gap: var(--central-gap);
    min-height: 0;
    overflow: hidden;
  }

  .control-slot {
    display: flex;
    min-height: 0;
    min-width: 0;
    height: 100%;
    flex-shrink: 1;
  }

  .slider-slot {
    flex: 1 1 0;
    min-width: 40px;
  }


  /* ---- Live skin (flat grammar) ------------------------------------
     Pattern buttons wear the focused track's ink (ADR-402) and keep it
     under the flat grammar — but as label and solid fill, never as the
     GRATICULE wash: an unselected pattern is a control field with the
     ink as its label; the selected one is a solid block of the ink with
     Live's ClipText (like a session slot), inside the same 1px dark
     frame. Weights come down to medium — Live never bolds a pad. The
     .physical-button base in app.css supplies the field / frame; this
     block only re-routes the ink and the selected fill. Nothing below
     applies outside [data-grammar="flat"]. */
  :global([data-grammar="flat"]) .pattern-button {
    font-weight: var(--font-weight-medium);
    color: var(--btn-tint, var(--foreground));
  }
  :global([data-grammar="flat"]) .pattern-button.active {
    font-weight: var(--font-weight-medium);
    background: var(--btn-tint, var(--phosphor));
    border-color: var(--btn-tint, var(--phosphor));
    color: var(--flat-clip-text);
  }
  /* Light: the ink's fill envelope is too pale for TEXT on paper — pull
     the OFF label toward the foreground (hue kept), and keep the ON
     frame dark so the block's boundary survives at ~1:1 luminance. */
  :global(.light[data-grammar="flat"]) .pattern-button:not(.active) {
    color: color-mix(in oklab, var(--btn-tint, var(--foreground)) 55%, var(--foreground));
  }
  :global(.light[data-grammar="flat"]) .pattern-button.active {
    border-color: var(--line-strong);
  }
</style>
