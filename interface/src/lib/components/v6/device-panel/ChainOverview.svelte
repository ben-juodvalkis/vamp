<script lang="ts">
  /**
   * ChainOverview — the FX section's second face: every device on the
   * selected track, in chain order, on the FX grid's own ten-column ruler.
   *
   * A tap appoints the device (Live's blue hand) and opens its controls in
   * the central view, which stays up beside this list — so choosing
   * between two Auto Filters, or among racks, is a tap each with both on
   * screen. A device a grid tile can control takes that tile's view, and
   * becomes what the tile controls (the pick). A rack opens the rack view
   * on that rack; anything with no view of its own opens the generic one.
   *
   * Each cell says which tile controls it, when one does, so the grid's
   * choice is visible here too.
   *
   * The power button in a cell's corner turns the device on and off
   * (Device On, parameter 0). A cell dragged sideways moves the device
   * in Live's chain (`device/move`); the instrument stays put and nothing
   * crosses it (`utils/chainDrop`).
   *
   * **A pad follows the Drum Rack view.** While a pad is held or latched
   * on the selected track's Drum Rack, the overview is that pad's chain —
   * its instrument, then its effects (`vm.padFx`, with the records the
   * pad's `vm.padChain` row brings) — framed and chipped in the pad's
   * ink like the grid, and a tap opens the effect's view in the Drum Rack
   * view's pane, as a tile does under the same scope.
   */
  import Box from '@lucide/svelte/icons/box';
  import Hand from '@lucide/svelte/icons/hand';
  import Layers from '@lucide/svelte/icons/layers';
  import Plug from '@lucide/svelte/icons/plug';
  import Power from '@lucide/svelte/icons/power';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Music from '@lucide/svelte/icons/music';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Waves from '@lucide/svelte/icons/waves';
  import Zap from '@lucide/svelte/icons/zap';
  import { press } from '$lib/actions/press';
  import { drag, type DragInfo } from '$lib/actions/drag';
  import { moveDevice } from '$lib/services/deviceMoveService';
  import { chainDropIndex } from '$lib/utils/chainDrop';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { fxChainStore, RACK_PICK } from '$lib/stores/v6/fxChainStore.svelte';
  import { DEVICE_PRESETS, DEVICE_FAMILY_INKS } from '$lib/config/devicePresets';
  import { DEVICE_GLYPHS, type DeviceGlyph } from '$lib/config/deviceGlyphMap';
  import { matchesSlot, pickSlotDevice } from '$lib/utils/deviceSlotMatch';
  import { openDeviceView, activeDrumRackScope, selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
  import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
  import { usePadChainRows } from '$lib/components/v6/central/usePadChainRows.svelte';
  import { DEVICE_TYPE_INSTRUMENT, VM_PAD_FX, parseVmPadFx, padTileLabel } from '$lib/services/drumVirtualMacros';
  import { isViewRegistered } from '$lib/components/v6/central/viewRegistry';
  import { trackDeviceGlance } from '$lib/components/v6/tracks/composables/useTrackDevice.svelte';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackInk } from '$lib/utils/selectedTrackInk';
  import { CHAIN_DEVICE_VIEW } from '$lib/components/v6/central/views/chainDeviceView';
  import TrackDeviceView from '$lib/components/v6/tracks/TrackStrip/components/TrackDeviceView.svelte';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';

  /** The tiles that control a device, by preset key, and what each is called on the grid. */
  const TILE_LABELS: Record<string, string> = {
    random: 'Rand Oct',
    octave: 'Pitch',
    eq: 'EQ',
    filter: 'Filter',
    drum: 'Drum',
    chorus: 'Chorus',
    glitchLoop: 'Glitch',
    squash: 'Glue',
    guitar: 'Gtr',
    bass: 'Bass',
    saturator: 'Drive',
    tremolo: 'Tremolo',
    echo: 'Echo',
    reverb: 'Reverb',
    variation: 'Stutter',
    utility: 'Gain',
    sequencer: 'Permute'
  };

  /** Live's class as a person would say it, for a device renamed away from its type. */
  const TYPE_LABELS: Record<string, string> = {
    AutoFilter2: 'Auto Filter',
    Hybrid: 'Hybrid Reverb',
    StereoGain: 'Utility',
    AudioEffectGroupDevice: 'Effect Rack',
    InstrumentGroupDevice: 'Instrument Rack',
    MidiEffectGroupDevice: 'MIDI Rack',
    DrumGroupDevice: 'Drum Rack',
    MxDeviceAudioEffect: 'Max Effect',
    MxDeviceMidiEffect: 'Max MIDI',
    MxDeviceInstrument: 'Max Instrument',
    AuPluginDevice: 'Plug-in',
    PluginDevice: 'Plug-in',
    InstrumentVector: 'Wavetable',
    OriginalSimpler: 'Simpler',
    MultiSampler: 'Sampler',
    UltraAnalog: 'Analog',
    InstrumentMeld: 'Meld',
    GlueCompressor: 'Glue',
    Compressor2: 'Compressor',
    ChannelEq: 'Channel EQ',
    Chorus2: 'Chorus',
    PhaserNew: 'Phaser',
    Redux2: 'Redux',
    BeatRepeat: 'Beat Repeat'
  };

  const EFFECT_MARKS = {
    filter: AudioWaveform,
    space: Waves,
    dynamics: Gauge,
    drive: Zap,
    movement: Music,
    gain: SlidersHorizontal
  } as const;

  type Cell = {
    device: DeviceRecord;
    order: number;
    kind: 'instrument' | 'rack' | 'max' | 'plugin' | 'effect';
    presetKey: string | null;
    tile: string | null;
    typeLabel: string | null;
    ink: string;
    on: boolean;
    powered: boolean;
    macros: { name: string; value: number }[];
  };

  const trackPath = $derived(selectedTrackStore.selectedTrackPath);

  // The pad the Drum Rack view has scoped, as the FX grid reads it: not
  // under a track hold, whose grid is another track's.
  const padScope = $derived(trackHoldScope.active ? null : activeDrumRackScope());
  usePadChainRows(() => selectedDrumRack()?.rackPath, () => padScope?.note);

  /** The pad's chain in order: its instrument and effects, the records where the pad's row has sent them. */
  const padChain = $derived.by(() => {
    if (!padScope) return null;
    const fx = parseVmPadFx(selectedTrackStore.propertyValue(padScope.rackPath, VM_PAD_FX))?.get(padScope.note) ?? [];
    const records = new Map(selectedTrackStore.padDevices(padScope.padPath).map((d) => [d.devicePath, d]));
    return fx.map((d) => {
      const devicePath = `${padScope.padPath}/devices/${d.index}`;
      const device: DeviceRecord = records.get(devicePath) ?? {
        devicePath,
        name: d.name,
        className: d.className,
        params: new Map(),
        properties: new Map()
      };
      return { device, instrument: d.type === DEVICE_TYPE_INSTRUMENT };
    });
  });

  /** Picks are the pad's under a pad scope, as the grid's tiles read them. */
  const pickScope = $derived(padScope?.padPath ?? trackPath);

  const devices = $derived(
    padChain
      ? padChain.map((c) => c.device)
      : [...selectedTrackStore.devicesByPath].sort((a, b) => indexOf(a.devicePath) - indexOf(b.devicePath))
  );
  const padInk = $derived(padScope && padScope.color !== null ? trackInk(rgbToHex(padScope.color), paintModeReactive()) : null);
  const glance = $derived(trackDeviceGlance(trackPath));
  const paint = $derived(paintModeReactive());
  const trackColor = $derived(selectedTrackInk() ?? 'var(--signal-dim)');

  /** devicePath → the grid tile that controls it, under the type-first rule and the picks. */
  const tileOf = $derived.by(() => {
    const out = new Map<string, string>();
    for (const [key, label] of Object.entries(TILE_LABELS)) {
      const config = DEVICE_PRESETS[key];
      if (!config) continue;
      const chosen = pickSlotDevice(devices, config, fxChainStore.pickFor(pickScope, key));
      if (chosen && !out.has(chosen.devicePath)) out.set(chosen.devicePath, label);
    }
    return out;
  });

  const cells = $derived<Cell[]>(
    devices.map((device, i) => {
      const presetKey = presetKeyFor(device);
      const isInstrument = padChain
        ? padChain[i].instrument
        : glance.kind === 'instrument' && glance.headPath === device.devicePath;
      const kind: Cell['kind'] = isInstrument
        ? 'instrument'
        : device.className === 'AudioEffectGroupDevice' && !presetKey
          ? 'rack'
          : device.className.startsWith('MxDevice') && !presetKey
            ? 'max'
            : device.className.endsWith('PluginDevice')
              ? 'plugin'
              : 'effect';
      const family = presetKey ? DEVICE_PRESETS[presetKey].color.primary : kind === 'rack' ? DEVICE_FAMILY_INKS.rackVoice.primary : DEVICE_FAMILY_INKS.utility.primary;
      const typeLabel = TYPE_LABELS[device.className] ?? splitCamel(device.className);
      return {
        device,
        order: i + 1,
        kind,
        presetKey,
        tile: tileOf.get(device.devicePath) ?? null,
        typeLabel: typeLabel.toLowerCase() === device.name.toLowerCase() ? null : typeLabel,
        ink: isInstrument ? (padChain ? (padInk ?? trackColor) : trackColor) : trackInk(family, paint),
        on: (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 0)) ?? 1) > 0,
        // A pad's instrument has no records on the wire (they are the
        // virtual-macro layer's), so there is no Device On to show.
        powered: selectedTrackStore.paramValue(selectedTrackStore.paramPath(device, 0)) !== undefined,
        macros: kind === 'rack' ? macrosOf(device) : []
      };
    })
  );

  /** Ten a row, one row tall each while they fit, so a chain reads like Live's: left to right. */
  const tall = $derived(cells.length <= 10);

  function indexOf(path: string): number {
    const m = /\/devices\/(\d+)$/.exec(path);
    return m ? Number(m[1]) : 0;
  }

  function splitCamel(s: string): string {
    return s.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function presetKeyFor(device: DeviceRecord): string | null {
    for (const [key, config] of Object.entries(DEVICE_PRESETS)) {
      if (config.expectedClassName && matchesSlot(device, config)) return key;
    }
    return null;
  }

  function macrosOf(device: DeviceRecord): { name: string; value: number }[] {
    const names = selectedTrackStore.paramNamesForDevice(device as never);
    const out: { name: string; value: number }[] = [];
    for (let i = 1; i < names.length && out.length < 8; i++) {
      const name = names[i];
      if (!name || /^Macro \d+$/.test(name)) continue;
      const value = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, i)) ?? 0;
      out.push({ name, value: Math.max(0, Math.min(1, value / 127)) });
    }
    return out;
  }

  function togglePower(cell: Cell) {
    const path = selectedTrackStore.paramPath(cell.device, 0);
    selectedTrackStore.setParamValue(path, cell.on ? 0 : 1);
  }

  // A drag in flight: which cell, how far it has travelled, and the slot
  // between cells it would land in (0..cells.length).
  let dragging = $state<{ path: string; from: number; dx: number; dy: number } | null>(null);
  let dropSlot = $state<number | null>(null);
  let chainEl = $state<HTMLElement | null>(null);

  const instrumentIndex = $derived(cells.findIndex((c) => c.kind === 'instrument'));

  function slotAt(x: number, y: number): number | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.chain-cell');
    if (!hit || !chainEl?.contains(hit)) return null;
    const index = Number(hit.dataset.index);
    const box = hit.getBoundingClientRect();
    return index + (x > box.left + box.width / 2 ? 1 : 0);
  }

  function landing(): number | null {
    if (!dragging || dropSlot === null) return null;
    return chainDropIndex({
      from: dragging.from,
      slot: dropSlot,
      count: cells.length,
      instrument: instrumentIndex >= 0 ? instrumentIndex : null
    });
  }

  /** The slot the drop marker shows: where the device would really land. */
  const markerSlot = $derived.by(() => {
    const to = landing();
    if (to === null || !dragging) return null;
    return to > dragging.from ? to + 1 : to;
  });

  function dragStart(cell: Cell, index: number, info: DragInfo) {
    if (cell.kind === 'instrument') return;
    dragging = { path: cell.device.devicePath, from: index, dx: info.dx, dy: info.dy };
    dropSlot = null;
  }

  function dragMove(info: DragInfo) {
    if (!dragging) return;
    dragging = { ...dragging, dx: info.dx, dy: info.dy };
    const slot = slotAt(info.x, info.y);
    if (slot !== null) dropSlot = slot;
  }

  function dragEnd() {
    const to = landing();
    const path = dragging?.path;
    dragging = null;
    dropSlot = null;
    if (path && to !== null) void moveDevice(path, to);
  }

  function glyphOf(cell: Cell): DeviceGlyph | null {
    return cell.presetKey ? (DEVICE_GLYPHS[cell.presetKey] ?? null) : null;
  }

  function open(cell: Cell) {
    const { device } = cell;
    fxChainStore.appoint(device.devicePath, { force: true });
    if (padScope) {
      // The pad's instrument is what the Drum Rack view already shows; an
      // effect opens in its pane (the router routes under the scope).
      if (cell.kind === 'instrument') return;
      if (cell.presetKey && isViewRegistered('device', cell.presetKey)) {
        fxChainStore.pick(pickScope, cell.presetKey, device.devicePath);
        openDeviceView(cell.presetKey);
      }
      return;
    }
    if (cell.kind === 'instrument') {
      if (glance.instrumentViewType) {
        centralDisplayStore.setView('instrument', glance.instrumentViewType, { instrument: glance.instrument });
        return;
      }
    } else if (cell.presetKey === 'sequencer') {
      centralDisplayStore.setView('permute', undefined, null, 'Permute');
      return;
    } else if (cell.presetKey && isViewRegistered('device', cell.presetKey)) {
      fxChainStore.pick(trackPath, cell.presetKey, device.devicePath);
      openDeviceView(cell.presetKey);
      return;
    } else if (cell.kind === 'rack') {
      fxChainStore.pick(trackPath, RACK_PICK, device.devicePath);
      openDeviceView('audio-effect-rack');
      return;
    }
    fxChainStore.pick(trackPath, CHAIN_DEVICE_VIEW, device.devicePath);
    openDeviceView(CHAIN_DEVICE_VIEW);
  }
</script>

<div
  class="chain"
  class:tall
  class:pad-scoped={padScope !== null}
  data-debug="chain-overview"
  data-chain-scope={padScope?.note}
  style={padInk ? `--scope-ink: ${padInk}` : undefined}
  bind:this={chainEl}
>
  {#each cells as cell, index (cell.device.devicePath)}
    {@const glyph = glyphOf(cell)}
    {@const lifted = dragging?.path === cell.device.devicePath}
    <div
      class="chain-cell"
      class:off={!cell.on}
      class:lifted
      class:drop-before={markerSlot === index}
      class:drop-after={markerSlot === cells.length && index === cells.length - 1}
      style:translate={lifted ? `${dragging?.dx ?? 0}px ${-(dragging?.dy ?? 0)}px` : undefined}
      data-index={index}
      class:appointed={fxChainStore.appointed === cell.device.devicePath}
      class:instrument={cell.kind === 'instrument'}
      style="--cell-ink: {cell.ink};"
      data-device-path={cell.device.devicePath}
      data-kind={cell.kind}
      role="button"
      tabindex="0"
      aria-label="{cell.device.name}{cell.tile ? `, the ${cell.tile} tile's` : ''}"
      use:drag={{
        commit: 'either',
        onTap: () => open(cell),
        onStart: (info) => dragStart(cell, index, info),
        onMove: dragMove,
        onEnd: dragEnd
      }}
    >
      <div class="cell-head">
        <span class="order">{cell.order}</span>
        {#if fxChainStore.appointed === cell.device.devicePath}
          <span class="hand" aria-label="Selected in Live"><Hand /></span>
        {/if}
        {#if cell.powered}
        <button
          type="button"
          class="power"
          class:on={cell.on}
          aria-label="{cell.on ? 'Turn off' : 'Turn on'} {cell.device.name}"
          aria-pressed={cell.on}
          use:press={{ onPress: () => togglePower(cell), stopPropagation: true }}
        ><Power /></button>
        {/if}
      </div>

      <div class="mark" aria-hidden="true">
        {#if cell.kind === 'instrument'}
          <!-- The strip's own mark for the instrument, so the two agree. -->
          <span class="instrument-mark"><TrackDeviceView {glance} color={cell.ink} /></span>
        {:else if cell.kind === 'rack'}
          <Layers />
        {:else if cell.kind === 'max'}
          <Box />
        {:else if cell.kind === 'plugin'}
          <Plug />
        {:else if glyph && glyph in EFFECT_MARKS}
          {@const Mark = EFFECT_MARKS[glyph as keyof typeof EFFECT_MARKS]}
          <Mark />
        {:else}
          <Music />
        {/if}
      </div>

      {#if cell.macros.length > 0}
        <div class="macros" aria-hidden="true">
          {#each cell.macros as m (m.name)}
            <span class="macro" style="--v: {m.value};" title={m.name}></span>
          {/each}
        </div>
      {/if}

      <div class="cell-foot">
        <span class="name" lang="en">{cell.device.name}</span>
        {#if cell.typeLabel}
          <span class="type">{cell.typeLabel}</span>
        {/if}
        {#if cell.tile}
          <span class="pad-chip tile-chip">{cell.tile}</span>
        {/if}
      </div>
    </div>
  {/each}
  {#if padScope}
    <!-- Whose chain this is, as the grid's scope chip says it. -->
    <div class="pad-chip chain-scope-chip" aria-label="Chain of pad {padScope.note}">
      {padTileLabel(padScope.name) || `Pad ${padScope.note}`}
    </div>
  {/if}
</div>

<style>
  /* The FX grid's ruler: ten columns, two rows, the same 8px trough, so a
     cell lands on the pixels a tile does. */
  .chain {
    height: 100%;
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  /* A pad's chain wears the pad's frame and chip, as the scoped grid does
     (FXGrid's .fx-scoped: drawn inside, since the section clips). */
  .chain {
    position: relative;
  }
  .chain.pad-scoped {
    outline: 2px solid var(--scope-ink, var(--track-ink, var(--phosphor)));
    outline-offset: -2px;
    border-radius: var(--radius-sm, 2px);
  }
  .chain-scope-chip {
    --chip-ink: var(--scope-ink, var(--track-ink));
    position: absolute;
    top: 4px;
    right: calc(4px + var(--fx-switch-w, 0px));
    z-index: 3;
    pointer-events: none;
  }
  .chain.tall .chain-cell {
    grid-row: span 2;
  }

  .chain-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 6px;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--surface-well);
    color: var(--cell-ink);
    cursor: pointer;
    user-select: none;
  }
  .chain-cell.off > :not(.cell-head) {
    opacity: 0.45;
  }
  /* The cell under the finger rides it and lets the cells below be hit. */
  .chain-cell.lifted {
    z-index: 2;
    pointer-events: none;
    box-shadow: 0 6px 18px oklch(0 0 0 / 0.5);
  }
  /* Where it would land: a bar in the trough on that side. */
  .chain-cell.drop-before::before,
  .chain-cell.drop-after::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 2px;
    background: var(--foreground);
  }
  .chain-cell.drop-before::before {
    left: -6px;
  }
  .chain-cell.drop-after::after {
    right: -6px;
  }
  /* The blue hand: the device Live's controllers follow. */
  .chain-cell.appointed {
    border-color: var(--cell-ink);
    box-shadow: inset 0 0 0 1px var(--cell-ink);
    background: color-mix(in oklab, var(--cell-ink) 14%, var(--surface-well));
  }

  /* Order, then the hand beside it, the power button in the corner. */
  .cell-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 18px;
  }
  .order {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted-foreground);
  }
  .hand :global(svg) {
    width: 16px;
    height: 16px;
  }
  /* Device On. Lit while the device runs, dim when bypassed. */
  .power {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin: -6px -4px -6px auto;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .power.on {
    color: var(--cell-ink);
  }
  .power :global(svg) {
    width: 16px;
    height: 16px;
  }

  .mark {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .mark :global(svg) {
    width: 30px;
    height: 30px;
    stroke-width: 1.25;
  }
  .instrument-mark {
    width: 100%;
    height: 56px;
  }

  /* A rack is a box of macros: its named ones, as a tiny meter each. */
  .macros {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 22px;
  }
  .macro {
    flex: 1 1 0;
    height: 100%;
    background: linear-gradient(to top, var(--cell-ink) calc(var(--v) * 100%), color-mix(in oklab, var(--cell-ink) 15%, transparent) 0);
    border-radius: 1px;
  }

  .cell-foot {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-size: 0.8125rem;
    font-weight: var(--font-weight-medium);
    line-height: 1.2;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
    -webkit-hyphens: auto;
    hyphens: auto;
  }
  .type {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Which grid tile controls this device. */
  .tile-chip {
    --chip-ink: var(--cell-ink);
    align-self: flex-start;
    font-size: 10px;
    padding: 1px 6px;
  }
</style>
