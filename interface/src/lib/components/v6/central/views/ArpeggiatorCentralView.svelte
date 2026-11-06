<script lang="ts">
  /**
   * ArpeggiatorCentralView — the Arpeggiator's own view: Pattern (Style),
   * Sync + Rate, Steps and Gate. Velocity, Chord, Note Chance and Random
   * each have their own view since the chain overview (ADR-478) opens a
   * device's view by its own type.
   *
   * Self-contained: queries its own slot state, so it renders immediately
   * with ghost/loading/active states.
   *
   * On the face grid (ADR-510), four one-column sections of about 217px,
   * each named on the header line: Pattern, Rate, Steps, Gate.
   *
   * NO {#if device} gate - always renders, controls handle their own state.
   * NO props required - all controls query their slots internally.
   */

  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const arp = useFxGridSlot('arpeggiator');

  // Calibrated ink twins (GRATICULE §2.5). primary/accent normalized through
  // trackInk; secondary (low-alpha wash) untouched. Used for all chrome styled
  // in THIS file; child components keep receiving the raw `.color` scheme.
  let arpInk = $derived({
    primary: trackInk(arp.color.primary, paintModeReactive()),
    secondary: arp.color.secondary,
    accent: trackInk(arp.color.accent, paintModeReactive()),
  });

  const ARP_PARAMS = {
    DEVICE_ON: 0,    // Device On/Off (0/1)
    STYLE: 1,        // Style (0-17 int)
    SYNCED_RATE: 4,  // Sync switch (0/1)
    RATE: 5,         // Rate (0-13 int)
    FREE_RATE: 7,    // Free Rate (0-1 float) - sent alongside sync rate
    GATE: 8,         // Gate (0-200 float)
    STEPS: 14        // Steps / octave repeat (0-2 int)
  } as const;

  const RATE_LABELS = ["1/128", "1/96", "1/64", "1/48", "1/32", "1/24", "1/16", "1/12", "1/8", "1/6", "1/4", "1/3", "1/2", "1/1"];
  const STYLE_LABELS = ["Up", "Down", "UpDown", "DownUp", "Up & Down", "Down & Up", "Converge", "Diverge", "Con & Diverge", "Pinky Up", "Pinky UpDown", "Thumb Up", "Thumb UpDown", "Play Order", "Chord Trigger", "Random", "Random Other", "Random Once"];

  // Glyph designs for each Style, plotted on a 128×128 viewBox. Mirrors
  // Live's own arp-pattern icons: small vertical bars representing each
  // note in the sequence, arranged across the X axis (time) with Y as
  // pitch. Drawn with currentColor so the button's text color drives the
  // fill. Each bar is roughly w=10 h=22, drawn as an SVG rect.
  // Pre-built bar coordinates for shapes; "extra" carries any custom svg
  // (used for Play Order, Chord Trigger, Random dice glyphs).
  type Bar = { x: number; y: number };
  const STYLE_GLYPHS: { bars?: Bar[]; extra?: string }[] = (() => {
    // Helper: build a list of {x,y} for evenly-spaced bars given pitch
    // levels (0 = lowest, levels[i] is a y-offset multiplier).
    const N = 5;                                // 5 bars across
    const X0 = 18, DX = 22;                     // x positions: 18, 40, 62, 84, 106
    const Y_LO = 80, Y_STEP = 14;               // pitch ladder: 80,66,52,38,24
    const xs = Array.from({ length: N }, (_, i) => X0 + i * DX);
    const yFor = (level: number) => Y_LO - level * Y_STEP;        // 0..4

    const ladder = (levels: number[]) => levels.map((lvl, i) => ({ x: xs[i], y: yFor(lvl) }));

    return [
      { bars: ladder([0, 1, 2, 3, 4]) },                              // Up
      { bars: ladder([4, 3, 2, 1, 0]) },                              // Down
      { bars: ladder([0, 2, 4, 2, 0]) },                              // UpDown (V inverted ⌒)
      { bars: ladder([4, 2, 0, 2, 4]) },                              // DownUp (V)
      { bars: [...ladder([0, 2, 4, 2, 0]), { x: 128, y: yFor(0) }].slice(0, 5) },  // Up & Down (same as UpDown family — slightly elongated peak)
      { bars: [...ladder([4, 2, 0, 2, 4]), { x: 128, y: yFor(4) }].slice(0, 5) },  // Down & Up
      // Converge: outer notes first, working inward (bars positioned
      // outer-to-inner in time).
      { bars: [
          { x: xs[0], y: yFor(0) },
          { x: xs[1], y: yFor(4) },
          { x: xs[2], y: yFor(1) },
          { x: xs[3], y: yFor(3) },
          { x: xs[4], y: yFor(2) }
      ] },
      // Diverge: middle out
      { bars: [
          { x: xs[0], y: yFor(2) },
          { x: xs[1], y: yFor(3) },
          { x: xs[2], y: yFor(1) },
          { x: xs[3], y: yFor(4) },
          { x: xs[4], y: yFor(0) }
      ] },
      // Con & Diverge: outer→inner→outer scatter
      { bars: [
          { x: xs[0], y: yFor(4) },
          { x: xs[1], y: yFor(1) },
          { x: xs[2], y: yFor(2) },
          { x: xs[3], y: yFor(3) },
          { x: xs[4], y: yFor(0) }
      ] },
      // Pinky Up: top note repeated, melody climbing under it
      { bars: [
          { x: xs[0], y: yFor(0) },
          { x: xs[1], y: yFor(4) },
          { x: xs[2], y: yFor(1) },
          { x: xs[3], y: yFor(4) },
          { x: xs[4], y: yFor(2) }
      ] },
      // Pinky UpDown: top note alternating with up-then-down melody
      { bars: [
          { x: xs[0], y: yFor(0) },
          { x: xs[1], y: yFor(4) },
          { x: xs[2], y: yFor(2) },
          { x: xs[3], y: yFor(4) },
          { x: xs[4], y: yFor(1) }
      ] },
      // Thumb Up: bottom (root) repeated, melody climbing above it
      { bars: [
          { x: xs[0], y: yFor(0) },
          { x: xs[1], y: yFor(2) },
          { x: xs[2], y: yFor(0) },
          { x: xs[3], y: yFor(3) },
          { x: xs[4], y: yFor(0) }
      ] },
      // Thumb UpDown: root alternating with up-then-down melody
      { bars: [
          { x: xs[0], y: yFor(0) },
          { x: xs[1], y: yFor(2) },
          { x: xs[2], y: yFor(0) },
          { x: xs[3], y: yFor(3) },
          { x: xs[4], y: yFor(0) }
      ] },
      // Play Order: numbered note boxes (1, 2, 3) along note-input order
      { extra: `
        <rect x="20" y="62" width="22" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="3"/>
        <text x="31" y="78" font-size="14" font-weight="700" fill="currentColor" text-anchor="middle" font-family="sans-serif">1</text>
        <rect x="56" y="38" width="22" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="3"/>
        <text x="67" y="54" font-size="14" font-weight="700" fill="currentColor" text-anchor="middle" font-family="sans-serif">2</text>
        <rect x="86" y="78" width="22" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="3"/>
        <text x="97" y="94" font-size="14" font-weight="700" fill="currentColor" text-anchor="middle" font-family="sans-serif">3</text>
      ` },
      // Chord Trigger: stacked rectangular blocks (chord stack)
      { extra: `
        <rect x="32" y="36" width="64" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="3"/>
        <rect x="32" y="54" width="64" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="3"/>
        <rect x="32" y="72" width="64" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="3"/>
        <rect x="32" y="90" width="64" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="3"/>
      ` },
      // Random: dice icon
      { extra: `
        <rect x="36" y="32" width="56" height="56" rx="8" fill="none" stroke="currentColor" stroke-width="4"/>
        <circle cx="50" cy="46" r="3" fill="currentColor"/>
        <circle cx="78" cy="46" r="3" fill="currentColor"/>
        <circle cx="64" cy="60" r="3" fill="currentColor"/>
        <circle cx="50" cy="74" r="3" fill="currentColor"/>
        <circle cx="78" cy="74" r="3" fill="currentColor"/>
      ` },
      // Random Other: dice + ≠
      { extra: `
        <rect x="30" y="26" width="50" height="50" rx="7" fill="none" stroke="currentColor" stroke-width="4"/>
        <circle cx="42" cy="38" r="2.5" fill="currentColor"/>
        <circle cx="68" cy="38" r="2.5" fill="currentColor"/>
        <circle cx="55" cy="51" r="2.5" fill="currentColor"/>
        <circle cx="42" cy="64" r="2.5" fill="currentColor"/>
        <circle cx="68" cy="64" r="2.5" fill="currentColor"/>
        <line x1="80" y1="86" x2="106" y2="86" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        <line x1="80" y1="98" x2="106" y2="98" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        <line x1="86" y1="78" x2="100" y2="106" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      ` },
      // Random Once: dice + 1×
      { extra: `
        <rect x="30" y="26" width="50" height="50" rx="7" fill="none" stroke="currentColor" stroke-width="4"/>
        <circle cx="42" cy="38" r="2.5" fill="currentColor"/>
        <circle cx="68" cy="38" r="2.5" fill="currentColor"/>
        <circle cx="55" cy="51" r="2.5" fill="currentColor"/>
        <circle cx="42" cy="64" r="2.5" fill="currentColor"/>
        <circle cx="68" cy="64" r="2.5" fill="currentColor"/>
        <text x="100" y="100" font-size="22" font-weight="700" fill="currentColor" text-anchor="middle" font-family="sans-serif">1×</text>
      ` },
    ];
  })();

  let syncValue = $derived(arp.paramValue(ARP_PARAMS.SYNCED_RATE) ?? 1);
  let syncIsOn = $derived(syncValue >= 0.5);
  let styleValue = $derived(arp.paramValue(ARP_PARAMS.STYLE) ?? 14);
  let rateValue = $derived(arp.paramValue(ARP_PARAMS.RATE) ?? 6);
  let gateValue = $derived(arp.paramValue(ARP_PARAMS.GATE) ?? 0);
  let stepsValue = $derived(arp.paramValue(ARP_PARAMS.STEPS) ?? 0);

  // Live's GUI-formatted readout for the rate axis (param 5 in sync,
  // param 7 in free) and gate (param 8, ms in Live's panel). Populated
  // only while the user is actively dragging — see ADR-352. Falls back
  // to the local RATE_LABELS lookup for sync mode (correct) and to a
  // bare "Free" label otherwise (the local code's free-mode label was
  // already wrong — see survey notes).
  let rateDisplay = $derived(
    syncIsOn ? arp.paramDisplay(ARP_PARAMS.RATE) : arp.paramDisplay(ARP_PARAMS.FREE_RATE)
  );
  let gateDisplay = $derived(arp.paramDisplay(ARP_PARAMS.GATE));

  function handleSyncToggle() {
    arp.sendParam(ARP_PARAMS.SYNCED_RATE, syncIsOn ? 0 : 1);
  }

  let patternPickerOpen = $state(false);
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="arp-root h-full w-full relative">
  <FaceGrid sections={[1, 1, 1, 1]}>
  <!-- Pattern (Style param) — tap to open full-view picker -->
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Pattern" color={arpInk.primary} />{/snippet}
    <button
      class="pattern-button w-full h-full rounded-lg flex flex-col items-center justify-center gap-2 p-2"
      style={`--pattern-ink: ${arpInk.primary}; opacity: ${arp.isGhost ? 'var(--opacity-ghost)' : 1}; transition: background-color var(--t-fast) var(--ease-precise), border-color var(--t-fast) var(--ease-precise), color var(--t-fast) var(--ease-precise), opacity var(--t-fast) var(--ease-precise);`}
      aria-label="Pattern"
      onclick={() => { patternPickerOpen = true; }}
    >
      {#if STYLE_GLYPHS[Math.round(styleValue)]}
        {@const currentGlyph = STYLE_GLYPHS[Math.round(styleValue)]}
        <svg viewBox="0 0 128 128" class="w-full max-h-[55%] flex-1" aria-hidden="true">
          {#if currentGlyph.bars}
            {#each currentGlyph.bars as bar}
              <rect x={bar.x - 5} y={bar.y - 11} width="10" height="22" rx="2" fill="currentColor" />
            {/each}
          {/if}
          {#if currentGlyph.extra}
            {@html currentGlyph.extra}
          {/if}
        </svg>
      {/if}
      <span class="pattern-name text-sm font-bold text-center px-1 leading-tight">{STYLE_LABELS[Math.round(styleValue)] ?? 'Style'}</span>
    </button>
  </FaceSection>
  <FaceSeam ink={arpInk.primary} />

  <!-- Rate with Sync button above -->
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Rate" color={arpInk.primary} />{/snippet}
    <div class="flex flex-col gap-(--face-gutter) min-h-0">
    <!-- Sync button -->
    <button
      class="physical-button arp-caps w-full text-sm font-bold h-16 flex-none"
      class:active={syncIsOn}
      style="--btn-tint: {arpInk.primary};{arp.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
      onclick={handleSyncToggle}
    >
      Sync
    </button>
    <!-- Rate knob -->
    <div class="flex-1 min-h-0" class:slot-ghost={arp.isGhost}>
      <DeviceSlider
        value={rateValue / 13}
        title="Rate"
        valueText={rateDisplay ?? (syncIsOn ? RATE_LABELS[Math.round(rateValue)] : 'Free')}
        face="knob"
        knobSize="l"
        icon="rate"
        orientation="vertical"
        labelOrientation="horizontal"
        labelSize="small"
        isGhost={arp.isGhost}
        color={arp.color}
        onInteraction={(value) => {
          const intValue = Math.round(value * 13);
          arp.sendParam(ARP_PARAMS.RATE, intValue);
          arp.sendParam(ARP_PARAMS.FREE_RATE, value);
        }}
      />
    </div>
    </div>
  </FaceSection>
  <FaceSeam ink={arpInk.primary} />

  <!-- Steps (octave repeat, 0-2 int) — segmented tabs matching SimplerCentralView's warp control -->
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Steps" color={arpInk.primary} />{/snippet}
    <div
      class="device-segmented grid grid-rows-3 min-h-0"
      style="--btn-tint: {arpInk.primary}; opacity: {arp.isGhost ? 'var(--opacity-ghost)' : 1};"
      role="radiogroup"
      aria-label="Steps"
    >
      {#each [0, 1, 2] as stepValue}
        <button
          onclick={() => arp.sendParam(ARP_PARAMS.STEPS, stepValue)}
          class="device-segment text-[22px] font-bold uppercase"
          class:active={Math.round(stepsValue) === stepValue}
          role="radio"
          aria-checked={Math.round(stepsValue) === stepValue}
        >
          {stepValue}
        </button>
      {/each}
    </div>
  </FaceSection>
  <FaceSeam ink={arpInk.primary} />

  <!-- ARP Gate knob (controls arpeggiator gate parameter) -->
  <FaceSection span={1}>
    {#snippet head()}<PanelEyebrow title="Gate" color={arpInk.primary} />{/snippet}
    <div class="flex min-h-0" class:slot-ghost={arp.isGhost}>
      <DeviceSlider
        value={gateValue / 200}
        title="Gate"
        valueText={gateDisplay}
        face="knob"
        knobSize="l"
        icon="notelength"
        orientation="vertical"
        labelOrientation="horizontal"
        labelSize="small"
        isGhost={arp.isGhost}
        color={arp.color}
        onInteraction={(value) => {
          const rawValue = Math.round(value * 200);
          const bypassValue = rawValue <= 0 ? 0 : 1;
          arp.sendParam(ARP_PARAMS.DEVICE_ON, bypassValue);
          arp.sendParam(ARP_PARAMS.GATE, rawValue);
        }}
      />
    </div>
  </FaceSection>
  </FaceGrid>

  {#if patternPickerOpen}
    <div class="pattern-picker absolute inset-0 z-20 p-(--central-inset) flex flex-col">
      <div class="grid grid-cols-9 grid-rows-2 gap-2 flex-1 min-h-0">
        {#each STYLE_LABELS as label, idx}
          {@const isOn = Math.round(styleValue) === idx}
          {@const glyph = STYLE_GLYPHS[idx]}
          <button
            class="physical-button min-h-0 text-xs font-bold flex flex-col items-center justify-center text-center gap-1 px-1 py-2 overflow-hidden"
            class:active={isOn}
            style="--btn-tint: {arpInk.primary};"
            onclick={() => {
              arp.sendParam(ARP_PARAMS.STYLE, idx);
              patternPickerOpen = false;
            }}
          >
            <svg viewBox="0 0 128 128" class="w-full min-h-0 flex-1" aria-hidden="true">
              {#if glyph.bars}
                {#each glyph.bars as bar}
                  <rect x={bar.x - 5} y={bar.y - 11} width="10" height="22" rx="2" fill="currentColor" />
                {/each}
              {/if}
              {#if glyph.extra}
                {@html glyph.extra}
              {/if}
            </svg>
            <span class="leading-tight">{label}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Steps segmented chrome now lives in app.css as the shared .device-segmented
     / .device-segment classes (§5.5). -->

<style>
  /* Pattern chooser: the ink that used to be inline (border + glyph colour)
     is lifted into --pattern-ink so the flat skins can re-read it below. Same
     three declarations, same values — Graticule is unchanged. */
  .pattern-button {
    border: 1px solid var(--pattern-ink);
    background-color: transparent;
    color: var(--pattern-ink);
  }

  /* Picker overlay sits on the panel surface (was inline; lifted onto the
     class so the flat grammar can re-read it without !important). */
  .pattern-picker {
    background-color: var(--card);
  }

  /* The Sync toggle is authored mixed-case and up-cased here for the
     HUD voice. */
  .arp-caps {
    text-transform: uppercase;
  }

  /* ---- Live skin: every arp control is a flat ControlBackground field in a
     1px dark frame (the shared .physical-button / .device-segmented classes
     already are); the pattern chooser drops its ink frame for the same
     field (its eyebrow is the face's header line since ADR-510), bold
     literals settle to medium, and the picker overlay matches the DetailViewBackground the view sits on. */
  :global([data-grammar="flat"]) .pattern-button {
    background-color: var(--surface-well);
    border-color: var(--button-frame, var(--line-strong));
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .pattern-name,
  :global([data-grammar="flat"]) .arp-root .physical-button,
  :global([data-grammar="flat"]) .arp-root .device-segment {
    font-weight: var(--font-weight-medium);
  }
  :global([data-grammar="flat"]) .arp-caps {
    text-transform: none;
  }
  :global([data-grammar="flat"]) .pattern-picker {
    background-color: var(--popover);
  }
  /* Hybrid: the device family keeps its voice on the chooser — glyph + name in
     the arp ink, a whisper of it in the frame (mirrors .glass-colored). */
  :global([data-skin="hybrid"]) .pattern-button {
    color: var(--pattern-ink);
    border-color: var(--button-frame, var(--line-strong));
  }
</style>
