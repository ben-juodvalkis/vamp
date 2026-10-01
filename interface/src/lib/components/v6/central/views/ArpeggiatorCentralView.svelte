<script lang="ts">
  /**
   * ArpeggiatorCentralView - Slot-Aware Version
   *
   * Self-contained central view that queries its own slot state.
   * Uses SlotAware components to render immediately with ghost/loading/active states.
   *
   * NO {#if device} gate - always renders, controls handle their own state.
   * NO props required - all controls query their slots internally.
   */

  import { logger } from '$lib/utils/logger';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import VelocityRangeBrace from '../../controls/VelocityRangeBrace.svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Check from 'lucide-svelte/icons/check';
  import X from 'lucide-svelte/icons/x';
  import { selectDevice, moveDeviceToTop, moveDeviceToEnd } from '$lib/services/deviceMoveService';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import SectionDivider from '../SectionDivider.svelte';

  const arp = useFxGridSlot('arpeggiator');
  const velocity = useFxGridSlot('velocity');
  const chord = useFxGridSlot('chord');
  const chance = useFxGridSlot('chance');

  // Calibrated ink twins (GRATICULE §2.5). primary/accent normalized through
  // trackInk; secondary (low-alpha wash) untouched. Used for all chrome styled
  // in THIS file; child components keep receiving the raw `.color` scheme.
  let arpInk = $derived({
    primary: trackInk(arp.color.primary, paintModeReactive()),
    secondary: arp.color.secondary,
    accent: trackInk(arp.color.accent, paintModeReactive()),
  });
  let chordInk = $derived({
    primary: trackInk(chord.color.primary, paintModeReactive()),
    secondary: chord.color.secondary,
    accent: trackInk(chord.color.accent, paintModeReactive()),
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
  let rateTitle = $derived(
    rateDisplay ?? (syncIsOn ? (RATE_LABELS[Math.round(rateValue)] ?? 'Rate') : 'Free')
  );
  let gateDisplay = $derived(arp.paramDisplay(ARP_PARAMS.GATE));
  let gateTitle = $derived(gateDisplay ? `Gate · ${gateDisplay}` : 'Gate');

  function handleSyncToggle() {
    arp.sendParam(ARP_PARAMS.SYNCED_RATE, syncIsOn ? 0 : 1);
  }

  const VELOCITY_PARAMS = {
    RANDOM: 3,
    OUT_HI: 6,
    OUT_LOW: 7
  } as const;

  let velocityRandom = $derived(velocity.paramValue(VELOCITY_PARAMS.RANDOM) ?? 0);

  const CHORD_PARAMS = {
    SHIFT_1: 1,
    SHIFT_2: 5,
    SHIFT_3: 9,
    SHIFT_4: 13
  } as const;

  const CHORD_BUTTONS: { paramIndex: number; onValue: number; label: string }[] = [
    { paramIndex: CHORD_PARAMS.SHIFT_1, onValue: 12, label: '+1' },
    { paramIndex: CHORD_PARAMS.SHIFT_2, onValue: 24, label: '+2' },
    { paramIndex: CHORD_PARAMS.SHIFT_3, onValue: -12, label: '-1' },
    { paramIndex: CHORD_PARAMS.SHIFT_4, onValue: -24, label: '-2' }
  ];

  function getChordParamValue(paramIndex: number): number {
    return chord.paramValue(paramIndex) ?? 0;
  }

  function handleChordToggle(paramIndex: number, onValue: number) {
    const current = getChordParamValue(paramIndex);
    chord.sendParam(paramIndex, current !== 0 ? 0 : onValue);
  }

  // Note Chance — a Max MIDI effect with exactly one parameter, so the
  // LOM order is forced: [0] Device On, [1] Chance. 0-100 %, 101 steps
  // (the dial's own `parameter_steps`), polyphonic — at 60 % roughly
  // six notes of every ten get through, chords included.
  const CHANCE_PARAM = 1;
  const CHANCE_MAX = 100;

  // The rest value is 100, not 0: silence is what a *pulled-down* chance
  // means, so a ghost slider sitting at zero would read as "this device
  // mutes the track". The library copy of the .amxd defaults to 100 as
  // well, so the ghost and the freshly-loaded device agree.
  let chanceValue = $derived(chance.paramValue(CHANCE_PARAM) ?? CHANCE_MAX);
  let chanceDisplay = $derived(chance.paramDisplay(CHANCE_PARAM));
  let chanceTitle = $derived(chanceDisplay ? `Chance · ${chanceDisplay}` : 'Chance');

  let patternPickerOpen = $state(false);

  // ===== MOVE ARP DEVICE FUNCTIONALITY =====
  let isMovingArpLeft = $state(false);
  let moveArpLeftResult = $state<'idle' | 'success' | 'error'>('idle');
  let isMovingArpRight = $state(false);
  let moveArpRightResult = $state<'idle' | 'success' | 'error'>('idle');

  function getMoveButtonClasses(position: 'left' | 'right', isMoving: boolean, result: 'idle' | 'success' | 'error') {
    const side = position === 'left' ? 'left-2' : 'right-2';
    const base = `absolute top-2 ${side} z-10 p-1.5 rounded transition-colors duration-200`;

    // Status inks are tokens for every skin (Graticule-equivalent fallbacks
    // for the old text-green-500 / text-red-500 literals — see the style block).
    if (result === 'success') return `${base} move-ok`;
    if (result === 'error') return `${base} move-err`;
    if (isMoving) return `${base} text-muted-foreground`;
    return `${base} text-muted-foreground hover:text-foreground cursor-pointer`;
  }

  async function handleMoveArpToTop() {
    const d = arp.device;
    if (isMovingArpLeft || !d) return;
    isMovingArpLeft = true;
    moveArpLeftResult = 'idle';
    try {
      await moveDeviceToTop(d.devicePath);
      await selectDevice(d.devicePath);
      moveArpLeftResult = 'success';
      setTimeout(() => { moveArpLeftResult = 'idle'; }, 1000);
    } catch (error) {
      logger.error('Failed to move arp device to top:', { component: 'ArpeggiatorCentralView', error });
      moveArpLeftResult = 'error';
      setTimeout(() => { moveArpLeftResult = 'idle'; }, 1000);
    } finally {
      isMovingArpLeft = false;
    }
  }

  async function handleMoveArpToEnd() {
    const d = arp.device;
    if (isMovingArpRight || !d) return;
    isMovingArpRight = true;
    moveArpRightResult = 'idle';
    try {
      await moveDeviceToEnd(d.devicePath);
      await selectDevice(d.devicePath);
      moveArpRightResult = 'success';
      setTimeout(() => { moveArpRightResult = 'idle'; }, 1000);
    } catch (error) {
      logger.error('Failed to move arp device to end:', { component: 'ArpeggiatorCentralView', error });
      moveArpRightResult = 'error';
      setTimeout(() => { moveArpRightResult = 'idle'; }, 1000);
    } finally {
      isMovingArpRight = false;
    }
  }
</script>

<!-- NO {#if device} gate - always render, each control handles its own state -->
<div class="arp-root h-full w-full flex p-(--central-inset) gap-(--central-gap) relative">
  {#if arp.device}
    <button
      class={getMoveButtonClasses('left', isMovingArpLeft, moveArpLeftResult)}
      onclick={handleMoveArpToTop}
      disabled={isMovingArpLeft || moveArpLeftResult !== 'idle'}
      aria-label="Move arp device to first position"
    >
      {#if isMovingArpLeft}
        <div class="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
      {:else if moveArpLeftResult === 'success'}
        <Check class="w-4 h-4" />
      {:else if moveArpLeftResult === 'error'}
        <X class="w-4 h-4" />
      {:else}
        <ArrowLeft class="w-4 h-4" />
      {/if}
    </button>

    <button
      class={getMoveButtonClasses('right', isMovingArpRight, moveArpRightResult)}
      onclick={handleMoveArpToEnd}
      disabled={isMovingArpRight || moveArpRightResult !== 'idle'}
      aria-label="Move arp device to last position"
    >
      {#if isMovingArpRight}
        <div class="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
      {:else if moveArpRightResult === 'success'}
        <Check class="w-4 h-4" />
      {:else if moveArpRightResult === 'error'}
        <X class="w-4 h-4" />
      {:else}
        <ArrowRight class="w-4 h-4" />
      {/if}
    </button>
  {/if}

  <!-- Pattern (Style param) — tap to open full-view picker -->
  <div class="flex-1 flex flex-col">
    <button
      class="pattern-button w-full h-full rounded-lg flex flex-col items-center justify-center gap-2 p-2"
      style={`--pattern-ink: ${arpInk.primary}; opacity: ${arp.isGhost ? 'var(--opacity-ghost)' : 1}; transition: background-color var(--t-fast) var(--ease-precise), border-color var(--t-fast) var(--ease-precise), color var(--t-fast) var(--ease-precise), opacity var(--t-fast) var(--ease-precise);`}
      onclick={() => { patternPickerOpen = true; }}
    >
      <span class="pattern-eyebrow text-xs uppercase opacity-70">Pattern</span>
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
  </div>

  <!-- Rate with Sync button above -->
  <div class="flex-1 flex flex-col gap-(--central-gap)">
    <!-- Sync button -->
    <button
      class="physical-button arp-caps w-full text-sm font-bold h-16"
      class:active={syncIsOn}
      style="--btn-tint: {arpInk.primary};{arp.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
      onclick={handleSyncToggle}
    >
      Sync
    </button>
    <!-- Rate slider -->
    <div class="flex-1">
      <DeviceSlider
        value={rateValue / 13}
        title={rateTitle}
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

  <!-- Steps (octave repeat, 0-2 int) — segmented tabs matching SimplerCentralView's warp control -->
  <div
    class="flex-1 device-segmented grid grid-rows-3 min-h-0"
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

  <!-- ARP Gate slider (controls arpeggiator gate parameter) -->
  <div class="flex-1">
    <DeviceSlider
      value={gateValue / 200}
      title={gateTitle}
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

  <!-- FOUR DEVICES IN ONE ROW (2026-09-13). Pattern, Rate, Steps and Gate
       are the Arpeggiator; Rand Vel and the brace are Velocity; the Oct
       buttons are Chord; Chance is its own. Every one of them used to
       abut the next at the same 16px gap that separates two of the
       Arpeggiator's OWN controls, so the row read as one long device with
       an odd set of parameters. The hairlines say where each one starts;
       each carries its device's ink, matching the controls after it. -->
  <SectionDivider orientation="vertical" ink={velocity.color.primary} />

  <!-- Velocity Random slider -->
  <div class="flex-1">
    <DeviceSlider
      value={velocityRandom / 127}
      title="Rand Vel"
      orientation="vertical"
      labelOrientation="horizontal"
      labelSize="small"
      isGhost={velocity.isGhost}
      color={velocity.color}
      onInteraction={(value) => {
        const intValue = Math.round(value * 127);
        velocity.sendParam(VELOCITY_PARAMS.RANDOM, intValue);
      }}
    />
  </div>

  <!-- Velocity Range Brace (Out Low / Out Hi) -->
  <div class="flex-1">
    <VelocityRangeBrace
      device={velocity.device}
      isGhost={velocity.isGhost}
      color={velocity.color}
      onInteraction={() => velocity.loadIfGhost()}
    />
  </div>

  <SectionDivider orientation="vertical" ink={chordInk.primary} />

  <!-- Chord octave shift buttons -->
  <div class="flex-1 flex flex-col gap-(--central-gap) min-h-0">
    {#each CHORD_BUTTONS as btn}
      {@const isOn = getChordParamValue(btn.paramIndex) !== 0}
      <button
        class="physical-button arp-caps w-full flex-1 min-h-0 text-base font-bold"
        class:active={isOn}
        style="--btn-tint: {chordInk.primary};{chord.isGhost ? ' opacity: var(--opacity-ghost);' : ''}"
        onclick={() => handleChordToggle(btn.paramIndex, btn.onValue)}
      >
        Oct {btn.label}
      </button>
    {/each}
  </div>

  <SectionDivider orientation="vertical" ink={chance.color.primary} />

  <!-- Note Chance: the odds an incoming note survives. A drag loads the
       device if the slot is a ghost; so does a tap, which has no value of
       its own to send (DeviceSlider drags are relative). -->
  <div class="flex-1">
    <DeviceSlider
      value={chanceValue / CHANCE_MAX}
      title={chanceTitle}
      orientation="vertical"
      labelOrientation="horizontal"
      labelSize="small"
      isGhost={chance.isGhost}
      color={chance.color}
      onTap={() => chance.loadIfGhost()}
      onInteraction={(value) => {
        chance.sendParam(CHANCE_PARAM, Math.round(value * CHANCE_MAX));
      }}
    />
  </div>

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
  /* Move-button status inks — tokens for EVERY skin. Graticule-equivalent
     replacements for the old text-green-500 / text-red-500 literals so the
     Graticule render is unchanged while the flat skins get ChosenPlay /
     ChosenRecord. */
  .move-ok { color: var(--act-play); }
  .move-err { color: var(--act-rec); }

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

  /* Sync / Oct toggles are authored mixed-case and up-cased here for the
     HUD voice. */
  .arp-caps {
    text-transform: uppercase;
  }

  /* ---- Live skin: every arp control is a flat ControlBackground field in a
     1px dark frame (the shared .physical-button / .device-segmented classes
     already are); the pattern chooser drops its ink frame for the same
     field, the eyebrow reads like a Live device title (normal case, grey, no
     opacity dim), bold literals settle to medium, and the picker overlay
     matches the DetailViewBackground the view sits on. */
  :global([data-grammar="flat"]) .pattern-button {
    background-color: var(--surface-well);
    border-color: var(--line-strong);
    color: var(--foreground);
  }
  :global([data-grammar="flat"]) .pattern-eyebrow {
    text-transform: none;
    letter-spacing: 0;
    opacity: 1;
    color: var(--muted-foreground);
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
    border-color: color-mix(in srgb, var(--pattern-ink) 40%, var(--line-strong));
  }
</style>
