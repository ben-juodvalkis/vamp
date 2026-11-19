<script lang="ts">
  /**
   * ChainOverview — the FX section's second face: every device on the
   * selected track, in chain order, as wide as their number allows: one
   * row while the chain is short, two once it is long (`chainUnitLayout`).
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
   * A tap on a cell's header bar turns the device on and off (Device On,
   * the user, 2026-11-11, as a tap on a strip's name mutes it), except an
   * instrument's, which opens its view as the rest of its cell does
   * (2026-11-16); a drag from the header still reorders.
   * (Device On, parameter 0). A cell dragged moves the device in Live's
   * chain (`device/move`): the cell rides the finger, the others slide
   * aside to show where it will land, and the new order holds after the
   * drop until Live's republish shows it (or 2 s pass, Live having
   * refused). A drop is one move; drops made while one is in flight
   * queue behind it and go out against the paths Live reports next. Only
   * a lifted finger drops — a cancelled gesture puts the cell back. The
   * instrument stays put and nothing crosses it (`utils/chainDrop`).
   * A dashed + cell after the last device opens the
   * browser on its Effect segment (`openEffectsBrowser`), as the strips
   * row's add buttons end the tracks; a pick joins this chain, the pad's
   * under a pad scope.
   *
   * **A cell carries its tile's control** (2026-10-25): a device the FX
   * grid has a tile for shows that tile — its XY or slider, the grid's own
   * component handed this cell's device — so whatever the grid can do the
   * chain can too. A touch on it drives the device and makes it the pick
   * (the one its tile and view control), and never starts a reorder. Under
   * a pad scope the overview provides the pad's `fxScope`, as the grid
   * does, so the tiles resolve against the pad's chain. MidiWheels carries
   * the pitch and mod wheels (`MidiWheelsPanel`); the wheels' wire names
   * the selected track, so a pad's chain draws its mark instead. A
   * Permute carries its mute and pitch steps (`chain/PermuteStepsFace`),
   * the track's instrument the control its view is known by
   * (`chain/InstrumentFace`: Omnisphere's ORB, Drift's filter), and a
   * Drum Rack its kit's Trnsp (`chain/DrumRackFace`, `vm.pitch`; its pads
   * from 2026-10-27 until 2026-11-05).
   *
   * **A pad follows the Drum Rack view.** While a pad is held or latched
   * on the selected track's Drum Rack, the overview is that pad's chain —
   * its instrument, then its effects (`vm.padFx`, with the records the
   * pad's `vm.padChain` row brings) — framed and chipped in the pad's
   * ink like the grid, and a tap opens the effect's view in the Drum Rack
   * view's pane, as a tile does under the same scope.
   */
  import Box from '@lucide/svelte/icons/box';
  import Plug from '@lucide/svelte/icons/plug';
  import Plus from '@lucide/svelte/icons/plus';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChainListFace from './chain/ChainListFace.svelte';
  import { CHAIN_DEVICES, SHOW_DEVICES, SELECTED_CHAIN, chainAddTarget, chainDevicePathOf, chainPathOf, isChainRack, rackChainsOf, rackFold, setChainSwitch, setChainVolume, type RackChain } from '$lib/services/rackChains.svelte';
  import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';
  import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
  import { setContext } from 'svelte';
  import CellSize from './chain/CellSize.svelte';
  import MidiWheelsFace from './chain/MidiWheelsFace.svelte';
  import RackFace, { type RackMacroGrid } from './chain/RackFace.svelte';
  import { isPatternRackMacroName, liveMacroSlots } from '$lib/utils/macroLayoutUtils';
  import { PICTURE_CONTEXT } from '$lib/components/v6/browser/devicePictures';
  import type { Component } from 'svelte';
  import { FX_GRID_LAYOUT, type DeviceTypeKey } from '$lib/config/fxGridLayout';
  import { provideFxScope } from '$lib/components/v6/central/fxScope';
  import GuitarControl from './GuitarControl.svelte';
  import BassControl from './BassControl.svelte';
  import PitchControl from './PitchControl.svelte';
  import GlitchControl from './GlitchControl.svelte';
  import SquashControl from './SquashControl.svelte';
  import ControlTile from './ControlTile.svelte';
  import PaletteChip from './chain/PaletteChip.svelte';
  import { addEffectToChain, type ChainEffect } from '$lib/services/chainEffects.svelte';
  import { drag as dragGesture } from '$lib/actions/drag';
  import { fitBlocks, paletteBlocks, paletteColumns, paletteLabel, paletteTail, type PaletteKind } from '$lib/services/effectPalette';
  import { controlFor } from './deviceControls';
  import PermuteStepsFace from './chain/PermuteStepsFace.svelte';
  import OperatorHeadAlgorithm from './chain/OperatorHeadAlgorithm.svelte';
  import InstrumentFace, { FACED_INSTRUMENTS } from './chain/InstrumentFace.svelte';
  import DrumRackFace from './chain/DrumRackFace.svelte';
  import { deviceTypeLabel } from './chain/deviceTypeLabel';
  import { schemeFromInk } from '$lib/config/devicePresets';
  import constants from '$config/constants.json';
  import Music from '@lucide/svelte/icons/music';
  import { press } from '$lib/actions/press';
  import { swallowNextClick } from '$lib/utils/swallowNextClick';
  import { drag as dragAction, type DragInfo, type DragEndInfo } from '$lib/actions/drag';
  import { moveDevice } from '$lib/services/deviceMoveService';
  import { isHiddenFromChain, visibleDevices } from '$lib/config/hiddenDevices';
  import {
    arrange,
    chainUnitLayout,
    chainIndexAt,
    type ChainPlace,
    clampChainIndex,
    moved,
    planReorder,
    liveChainIndex,
    REORDER_IDLE,
    sameDevices,
    type ReorderState
  } from '$lib/utils/chainDrop';
  import { onDestroy, tick, untrack } from 'svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { instrumentService } from '$lib/services/instrumentService';
  import { isViewRegistered } from '$lib/components/v6/central/viewRegistry';
  import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
  import { DEVICE_PRESETS, DEVICE_FAMILY_INKS, type DeviceFamily } from '$lib/config/devicePresets';
  import ControlGlyph from './ControlGlyph.svelte';
  import { DEVICE_CLASS_GLYPHS, DEVICE_KEY_GLYPHS, glyphForName, type ControlGlyphName } from '$lib/config/controlGlyphMap';
  import { pickSlotDevice } from '$lib/utils/deviceSlotMatch';
  import { activeDrumRackScope, selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
  import { effectTypeOf, openEffectView } from '$lib/services/effectView.svelte';
  import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
  import { usePadChainRows } from '$lib/components/v6/central/usePadChainRows.svelte';
  import { DEVICE_TYPE_INSTRUMENT, VM_PAD_FX, parseVmPadFx, padTileLabel } from '$lib/services/drumVirtualMacros';
  import { trackDeviceGlance } from '$lib/components/v6/tracks/composables/useTrackDevice.svelte';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { v3Store } from '$lib/stores/v3/normalized.svelte';
  import { landingEffects } from '$lib/stores/v6/landingEffects.svelte';
  import LandingScope from './LandingScope.svelte';
  import TrackDeviceView from '$lib/components/v6/tracks/TrackStrip/components/TrackDeviceView.svelte';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';

  /** The tiles that control a device, by preset key, and what each is called on the grid. */
  // The devices' pictures draw here (devicePictures), not on the FX grid.
  setContext(PICTURE_CONTEXT, true);

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

  /** The grid's tile for a device type, by `DEVICE_PRESETS` key: the layout's slots, then the tiles placed outside it. */
  const TILE_COMPONENTS: Record<string, { Tile: Component<any>; position?: string }> = {
    ...Object.fromEntries(FX_GRID_LAYOUT.map((slot) => [slot.deviceType, { Tile: slot.component, position: slot.position }])),
    guitar: { Tile: GuitarControl },
    bass: { Tile: BassControl },
    octave: { Tile: PitchControl },
    glitchLoop: { Tile: GlitchControl },
    squash: { Tile: SquashControl }
  };

  /** MidiWheels, re-found as the surface finds it: class + the name Live gives the loaded `.amxd`. */
  const MIDI_WHEELS = constants.devices.midiWheels;
  const isMidiWheels = (d: DeviceRecord) => d.className === MIDI_WHEELS.className && d.name === MIDI_WHEELS.deviceName;

  /**
   * What a cell is: only what changes when the chain does. Live values
   * (Device On, a rack's macros) are read in the markup, so a moving
   * parameter repaints its own cell and never rebuilds the list.
   */
  type Cell = {
    /** Stable across Live's renumbering (paths are positions): name, class, and which of those it is. */
    key: string;
    /** Class and name: what the device is, shared by two of a kind. */
    sig: string;
    /** Where Live has it now. */
    path: string;
    device: DeviceRecord;
    kind: 'instrument' | 'rack' | 'max' | 'plugin' | 'effect' | 'chains' | 'add';
    presetKey: string | null;
    tile: string | null;
    ink: string;
    /** The track's Drum Rack, drawn as its Trnsp, and kept first while a pad is scoped. */
    kit: boolean;
    /** A rack Live lets the wire into (ADR-529): it folds and unfolds. */
    foldable?: boolean;
    /** Drawn inside an unfolded rack (ADR-529): the rack, its ink, how deep. */
    inside?: { rackPath: string; ink: string; depth: number; chain: RackChain; chains: number };
    /** The chain list of an unfolded rack: its chains. */
    chains?: RackChain[];
    /** An effect on its way into Live (ADR-540): its load's id. Drawn, editable, not yet a device (no path to move or open). */
    landing?: string;
  };

  // A held strip (`trackHoldScope`) shows ITS chain while the finger stays,
  // without selecting it: the cells, their inks and their tiles are the
  // held track's (the user, 2026-11-16; the cells stayed the selected
  // track's while the tiles in them read the held one's).
  const trackPath = $derived(trackHoldScope.primary ?? selectedTrackStore.selectedTrackPath);
  const chainTrack = $derived(v3Store.tracks.get(trackPath));
  /** The devices of the track the chain shows, in Live's order. */
  const trackDevices = $derived(chainTrack ? [...chainTrack.devices.values()] : []);

  // The pad the Drum Rack view has scoped, as the FX grid reads it: not
  // under a track hold, whose grid is another track's.
  const padScope = $derived(trackHoldScope.active ? null : activeDrumRackScope());
  usePadChainRows(() => selectedDrumRack()?.rackPath, () => padScope?.note);
  // The tiles in the cells resolve against the pad's chain while one is scoped.
  provideFxScope(() => padScope);

  /** The pad's chain in order: its instrument and effects, the records where the pad's row has sent them. */
  const padChain = $derived.by(() => {
    if (!padScope) return null;
    const fx = parseVmPadFx(selectedTrackStore.propertyValue(padScope.rackPath, VM_PAD_FX))?.get(padScope.note) ?? [];
    const records = new Map(selectedTrackStore.padDevices(padScope.padPath).map((d) => [d.devicePath, d]));
    return fx.filter((d) => !isHiddenFromChain(d)).map((d) => {
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

  // Devices Vamp keeps for its own work are never cells (hiddenDevices).
  const liveDevices = $derived(
    padChain
      ? padChain.map((c) => c.device)
      : visibleDevices(trackDevices).sort((a, b) => indexOf(a.devicePath) - indexOf(b.devicePath))
  );

  /*
   * Landing cells (ADR-540): an effect a chip asked for is a ghost cell at
   * once, one per load (`landingEffects`), where Live will put it — a MIDI
   * effect after the MIDI effects, anything else at the end — and its
   * control works before Live has it, on that load's own record. Its key is
   * the one the arriving device's cell takes, so the cell stays mounted and
   * a drag on it carries on into the real device.
   */
  function landingDevices(chainPath: string): { device: DeviceRecord; id: string }[] {
    return landingEffects.inChain(chainPath).map((l) => {
      const config = DEVICE_PRESETS[l.type];
      return {
        id: l.id,
        device: {
          devicePath: landingEffects.ghostPath(chainPath, l.id),
          name: config.defaultName,
          className: config.expectedClassName,
          params: new Map(),
          properties: new Map()
        }
      };
    });
  }
  /** Live's devices with the landing ones put where Live will put them. */
  function withLanding(live: DeviceRecord[], landing: { device: DeviceRecord }[]): DeviceRecord[] {
    if (!landing.length) return live;
    const out = [...live];
    for (const { device: d } of landing) {
      if (!isMidiEffectClass(d.className)) {
        out.push(d);
        continue;
      }
      const at = out.findIndex((x) => !isMidiEffectClass(x.className));
      out.splice(at < 0 ? out.length : at, 0, d);
    }
    return out;
  }
  const isMidiEffectClass = (className: string) => className.startsWith('Midi') || className === 'MxDeviceMidiEffect';
  const landing = $derived(landingDevices(padScope?.padPath ?? trackPath));
  /** The blue hand, a ghost's resolved to the device it became (a chip's pick shows at once). */
  const appointedPath = $derived(landingEffects.resolve(fxChainStore.appointed));
  /** A landing cell's device path → its load's id. */
  const landingIds = $derived(new Map(landing.map((l) => [l.device.devicePath, l.id])));
  const devices = $derived(withLanding(liveDevices, landing));
  const padInk = $derived(padScope && padScope.color !== null ? trackInk(rgbToHex(padScope.color), paintModeReactive()) : null);
  const glance = $derived(trackDeviceGlance(trackPath));
  const paint = $derived(paintModeReactive());
  const trackInkOf = $derived(chainTrack ? trackInk(rgbToHex(chainTrack.color), paintModeReactive()) : null);
  const trackColor = $derived(trackInkOf ?? 'var(--signal-dim)');
  const trackScheme = $derived(trackInkOf ? schemeFromInk(trackInkOf) : null);

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
    devices.map((device, i, all) => {
      const nth = all.slice(0, i).filter((d) => d.name === device.name && d.className === device.className).length;
      const presetKey = presetKeyFor(device);
      const isInstrument = padChain
        ? (padChain.find((c) => c.device === device)?.instrument ?? false)
        : glance.kind === 'instrument' && glance.headPath === device.devicePath;
      const kind: Cell['kind'] = isInstrument
        ? 'instrument'
        : isChainRack(device.className) && !presetKey
          ? 'rack'
          : device.className.startsWith('MxDevice') && !presetKey
            ? 'max'
            : device.className.endsWith('PluginDevice')
              ? 'plugin'
              : 'effect';
      const family = presetKey ? DEVICE_PRESETS[presetKey].color.primary : kind === 'rack' ? DEVICE_FAMILY_INKS.rackVoice.primary : DEVICE_FAMILY_INKS.utility.primary;
      const sig = `${device.className}|${device.name}`;
      return {
        key: `${sig}|${nth}`,
        sig,
        path: device.devicePath,
        device,
        kind,
        presetKey,
        tile: tileOf.get(device.devicePath) ?? null,
        // The instrument, Permute and a Utility wear the track's color
        // (Permute: the user, 2026-10-26, as the strip's own Permute section
        // does; a Utility, 2026-11-15, while its palette chip stays grey);
        // a pad's chain, the pad's.
        ink: isInstrument || presetKey === 'sequencer' || (presetKey && DEVICE_PRESETS[presetKey].trackTint) ? (padChain ? (padInk ?? trackColor) : trackColor) : trackInk(family, paint),
        kit: !padChain && isInstrument && device.className === 'DrumGroupDevice',
        foldable: isChainRack(device.className),
        landing: landingIds.get(device.devicePath)
      };
    })
  );

  /*
   * The kit cell (2026-10-27): while a pad is scoped the chain is the
   * pad's, but the rack's own cell stays first, its Trnsp then the scoped
   * pad's (it carried the pads, held there, until 2026-11-05). Same key as the cell the
   * unscoped chain draws for it, so it is the same cell, never remounted.
   * Outside `cells`: the drops and their positions are the pad chain's.
   */
  const kitCell = $derived.by<Cell | null>(() => {
    if (!padChain || !padScope) return null;
    const all = [...trackDevices].sort((a, b) => indexOf(a.devicePath) - indexOf(b.devicePath));
    const i = all.findIndex((d) => d.devicePath === padScope.rackPath);
    if (i < 0) return null;
    const device = all[i];
    const nth = all.slice(0, i).filter((d) => d.name === device.name && d.className === device.className).length;
    const sig = `${device.className}|${device.name}`;
    return { key: `${sig}|${nth}`, sig, path: device.devicePath, device, kind: 'instrument', presetKey: null, tile: null, ink: trackColor, kit: true };
  });

  function isOn(cell: Cell): boolean {
    return (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(cell.device, 0)) ?? 1) > 0;
  }

  // A pad's instrument has no records on the wire (they are the
  // virtual-macro layer's), so there is no Device On to show.
  function isPowered(cell: Cell): boolean {
    return selectedTrackStore.paramValue(selectedTrackStore.paramPath(cell.device, 0)) !== undefined;
  }

  /**
   * The chain in width units (the user, 2026-11-05): a device its slider
   * draws (Gtr, Bass, a Utility, a Drum Rack's Trnsp) takes one, one with a
   * pad or a picture two. One row holds thirteen: the twelve it had, the +
   * that ended it and the ghost Utility's column, which went up into the
   * palette bar as chips (the user, 2026-11-13); past that the chain
   * takes two rows, as even as the cells allow (`chainUnitLayout`). Reads
   * like Live's chain: left to right, then the next row.
   */
  const ROW_UNITS = 13;
  function unitsOf(cell: Cell): number {
    // The chain list is a slider's width (the user, 2026-11-12).
    if (cell.kind === 'chains' || cell.kind === 'add') return 1;
    if (cell.kit || isMidiWheels(cell.device)) return 1;
    // A rack with no macro assigned is its header and mark alone (Ben, 2026-11-17).
    if (isBareRack(cell)) return 1;
    return cell.presetKey && controlFor(cell.presetKey)?.kind === 'slider' ? 1 : 2;
  }

  function indexOf(path: string): number {
    const m = /\/devices\/(\d+)$/.exec(path);
    return m ? Number(m[1]) : 0;
  }

  const presetKeyFor = (device: DeviceRecord) => effectTypeOf(device);

  /** How many macros Live shows on a rack (its macro count button); subscribed for every rack drawn. */
  const VISIBLE_MACROS = 'visible_macro_count';

  /**
   * A rack's visible macros as Live's macro panel lays them out
   * (`liveMacroSlots`, ADR-532), or null when none is named (the rack keeps
   * its mark). Up to Live's visible count, eight before the row answers.
   */
  function macroGridOf(device: DeviceRecord): RackMacroGrid | null {
    const names = selectedTrackStore.paramNamesForDevice(device as never);
    // A pattern rack's first macro is a chooser its view draws: it keeps its mark.
    if (isPatternRackMacroName(names[1])) return null;
    const visible = selectedTrackStore.propertyValue(device.devicePath, VISIBLE_MACROS);
    const grid = liveMacroSlots(names, typeof visible === 'number' ? visible : undefined);
    return grid.slots.some((m) => m && !m.dim) ? grid : null;
  }

  /**
   * A rack none of whose visible macros is named (every one still "Macro N"),
   * a pattern rack aside (its first macro is the chooser its view draws).
   */
  function isBareRack(cell: Cell): boolean {
    if (!cell.foldable || cell.kind === 'chains') return false;
    const names = selectedTrackStore.paramNamesForDevice(cell.device as never);
    if (isPatternRackMacroName(names[1])) return false;
    return macroGridOf(cell.device) === null;
  }

  /** An open rack with no macros and two chains or more: its chains, which its own cell lists. */
  function bareChains(cell: Cell): RackChain[] | null {
    if (!isBareRack(cell) || !rackFold.isOpen(cell.path)) return null;
    const chains = rackChainsOf(cell.path);
    return chains && chains.length > 1 ? chains : null;
  }

  function macroValue(device: DeviceRecord, index: number): number {
    return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, index)) ?? 0;
  }

  function setMacro(device: DeviceRecord, index: number, value: number) {
    selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), Math.max(0, Math.min(127, value)));
  }

  function togglePower(cell: Cell) {
    const path = selectedTrackStore.paramPath(cell.device, 0);
    selectedTrackStore.setParamValue(path, isOn(cell) ? 0 : 1);
  }

  /*
   * Reordering (2026-10-26). Three layers, each changing only as often as
   * it must:
   *
   * - `reorder` — drops Live has not shown yet (`utils/chainDrop`'s
   *   `planReorder`): the order held on screen, and the one move on the
   *   wire. A move is sent against the paths Live last reported, and the
   *   next waits until Live shows the last, so two quick drops never send
   *   a path the first has shifted.
   * - `drag` — the drag in flight: the order it started from and where it
   *   would land. It changes when the landing changes, not per finger
   *   frame.
   * - The cell itself rides the finger — no copy, no placeholder (the
   *   user's call, 2026-10-26): its own transform is written once a frame,
   *   so the finger never touches reactive state, and it keeps its slot
   *   in the previewed order, which is the gap the others slide around.
   *
   * The list is redrawn only when the order changes, and the cells slide
   * by a FLIP run on exactly those changes (below), not `animate:flip`,
   * which measures every cell on every redraw of the list.
   */
  const MOVE_TIMEOUT_MS = 2000;
  const GRID_GAP = 8;

  let chainEl = $state<HTMLElement | null>(null);
  let reorder = $state<ReorderState>(REORDER_IDLE);

  type Drag = {
    key: string;
    from: number;
    to: number;
    /** The order it started from, as shown then. */
    base: { key: string; sig: string }[];
    /** The instrument's place in that order, or null. */
    instrument: number | null;
    /** The cell's box when lifted, relative to the chain. */
    box: { left: number; top: number; width: number; height: number };
    /** The chain's box in client coordinates, measured once at lift. */
    chain: { left: number; top: number; width: number; height: number };
    /** The grid at lift: its unit columns and each cell's place. */
    cols: number;
    places: ChainPlace[];
  };
  let drag = $state<Drag | null>(null);
  /** The dragged cell's own node. */
  let dragNode: HTMLElement | null = null;

  // Drops on the wire follow Live: each report lands the move in flight
  // (or not), and the next goes out.
  $effect(() => {
    const state = reorder;
    if (!state.desired) return;
    const now = Date.now();
    const { state: next, send } = planReorder(state, cells, now, MOVE_TIMEOUT_MS);
    // `send.to` is a position in the chain as drawn; Live moves by its own index.
    if (send) void moveDevice(send.path, liveChainIndex(cells, send.to)).catch(() => (reorder = REORDER_IDLE));
    if (next !== state) reorder = next;
    if (!next.inflight) return;
    // Wake when the move in flight runs out, if Live never shows it.
    const timer = setTimeout(() => (reorder = { ...reorder }), Math.max(0, next.inflight.until - now));
    return () => clearTimeout(timer);
  });

  // Another track or pad: nothing in flight here means anything there.
  const scopeKey = $derived(`${trackPath}|${padScope?.padPath ?? ''}`);
  let lastScope = '';
  $effect(() => {
    if (scopeKey === lastScope) return;
    lastScope = scopeKey;
    untrack(() => {
      reorder = REORDER_IDLE;
      drag = null;
    });
  });

  // A device added or removed under a drag: its positions mean nothing now.
  $effect(() => {
    if (drag && !sameDevices(cells, drag.base)) untrack(() => (drag = null));
  });

  /** The cells as Live will have them once the drops land. */
  const settled = $derived((reorder.desired && arrange(cells, reorder.desired)) || cells);

  /** The cells in the order to draw them: the drag's preview, else `settled`. */
  const shown = $derived((drag && arrange(cells, moved(drag.base, drag.from, drag.to))) || settled);

  /*
   * Unfolded racks (ADR-529): after a rack's own cell, its chain list (when
   * it has more than one chain) and the chosen chain's devices, as Live's
   * device view shows them; a rack among those unfolds the same way. They
   * belong to the rack: never dragged, and a drop onto one lands at the
   * rack's place. `tops[i]` is the chain position a drawn cell stands for.
   */
  const MAX_DEPTH = 4;
  function expand(cell: Cell, depth: number, out: Cell[]): void {
    out.push(cell);
    if (!cell.foldable || depth >= MAX_DEPTH || !rackFold.isOpen(cell.path)) return;
    const rackPath = cell.path;
    const chains = rackChainsOf(rackPath);
    if (!chains) return;
    const ink = cell.ink;
    // A rack with no macros shows its chain list in its own cell (bareChains).
    if (chains.length > 1 && !isBareRack(cell)) {
      out.push({ ...listCell(cell), chains, inside: { rackPath, ink, depth, chain: chains[0], chains: chains.length } });
    }
    if (chains.length === 0) return;
    const chosen = chains[Math.min(rackFold.chainOf(rackPath), chains.length - 1)];
    const inside = { rackPath, ink, depth, chain: chosen, chains: chains.length };
    // An empty chain draws nothing past the list: its row says it is chosen.
    chosen.devices.forEach((d, i) => {
      // A hidden device (a Tuner) is no cell inside a rack either.
      if (isHiddenFromChain(d)) return;
      const devicePath = chainDevicePathOf(rackPath, chosen.index, d.index);
      const device: DeviceRecord = selectedTrackStore.deviceAt(devicePath) ?? {
        devicePath,
        name: d.name,
        className: d.className,
        params: new Map(),
        properties: new Map()
      };
      const nth = chosen.devices.slice(0, i).filter((x) => x.name === d.name && x.className === d.className).length;
      const presetKey = presetKeyFor(device);
      const kind: Cell['kind'] =
        isChainRack(device.className) && !presetKey
          ? 'rack'
          : device.className.startsWith('MxDevice') && !presetKey
            ? 'max'
            : device.className.endsWith('PluginDevice')
              ? 'plugin'
              : 'effect';
      const family = presetKey ? DEVICE_PRESETS[presetKey].color.primary : kind === 'rack' ? DEVICE_FAMILY_INKS.rackVoice.primary : DEVICE_FAMILY_INKS.utility.primary;
      const sig = `${device.className}|${device.name}`;
      const nested: Cell = {
        key: `${cell.key}|c${chosen.index}|${sig}|${nth}`,
        sig,
        path: devicePath,
        device,
        kind: d.type === 1 ? 'instrument' : kind,
        presetKey,
        tile: null,
        ink: presetKey && DEVICE_PRESETS[presetKey].trackTint ? (padChain ? (padInk ?? trackColor) : trackColor) : trackInk(family, paint),
        kit: false,
        foldable: isChainRack(device.className),
        inside
      };
      expand(nested, depth + 1, out);
    });
    // An effect on its way into this chain (ADR-540): a ghost cell at its end.
    for (const { device, id } of landingDevices(chainPathOf(rackPath, chosen.index))) {
      const presetKey = presetKeyFor(device);
      const sig = `${device.className}|${device.name}`;
      const nth = chosen.devices.filter((x) => x.name === device.name && x.className === device.className).length;
      out.push({
        key: `${cell.key}|c${chosen.index}|${sig}|${nth}`,
        sig,
        path: device.devicePath,
        device,
        kind: 'effect',
        presetKey,
        tile: null,
        ink: presetKey ? trackInk(DEVICE_PRESETS[presetKey].color.primary, paint) : trackColor,
        kit: false,
        inside,
        landing: id
      });
    }
    // The chain's own + (the user, 2026-11-12): a browser pick lands in it.
    out.push({ ...listCell(cell), key: `${cell.key}|c${chosen.index}|add`, kind: 'add', path: chainPathOf(rackPath, chosen.index), inside });
  }
  function listCell(rack: Cell): Cell {
    return { ...rack, key: `${rack.key}|chains`, kind: 'chains', tile: null, presetKey: null, foldable: false, kit: false };
  }

  const expanded = $derived.by(() => {
    const out: Cell[] = [];
    const tops: (number | null)[] = [];
    if (kitCell) {
      out.push(kitCell);
      tops.push(null);
    }
    shown.forEach((cell, i) => {
      const part: Cell[] = [];
      expand(cell, 0, part);
      for (const [j, c] of part.entries()) {
        out.push(c);
        tops.push(j === 0 ? i : null);
      }
    });
    return { cells: out, tops };
  });
  const drawn = $derived(expanded.cells);

  /** The chain position a drawn place stands for: its own, else its rack's. */
  function topAt(drawnIndex: number): number {
    const tops = expanded.tops;
    for (let i = Math.min(drawnIndex, tops.length - 1); i >= 0; i--) {
      if (tops[i] !== null) return tops[i]!;
    }
    return 0;
  }

  /*
   * Each unfolded rack on screen holds its `chain_devices` row: the surface
   * sends the chains and the devices' records and keeps their values live
   * for as long as it is open. Diffed by path, so opening one rack never
   * re-subscribes another.
   */
  const openRacks = $derived(
    drawn.filter((c) => c.foldable && rackFold.isOpen(c.path)).map((c) => c.path)
  );
  const rackRows = new Map<string, () => void>();
  // Every rack drawn follows Live's Show Devices toggle, open or not, so a
  // rack unfolded in Live unfolds here (the fold mirrors it both ways).
  const foldRows = new Map<string, () => void>();
  const drawnRacks = $derived(drawn.filter((c) => c.foldable).map((c) => c.path));
  $effect(() => {
    const want = new Set(drawnRacks);
    untrack(() => {
      for (const [path, release] of [...foldRows]) {
        if (!want.has(path)) {
          release();
          foldRows.delete(path);
        }
      }
      for (const path of want) {
        if (foldRows.has(path)) continue;
        // …and Live's visible macro count, which says how many knobs its face draws.
        const releases = [SHOW_DEVICES, VISIBLE_MACROS].map((row) => selectedTrackStore.subscribeProperty(path, row));
        foldRows.set(path, () => releases.forEach((release) => release()));
      }
    });
  });
  $effect(() => {
    const want = new Set(openRacks);
    untrack(() => {
      for (const [path, release] of [...rackRows]) {
        if (!want.has(path)) {
          release();
          rackRows.delete(path);
        }
      }
      for (const path of want) {
        if (rackRows.has(path)) continue;
        // An open rack's chains, and which of them Live shows (the chosen chain).
        const releases = [CHAIN_DEVICES, SELECTED_CHAIN].map((row) => selectedTrackStore.subscribeProperty(path, row));
        rackRows.set(path, () => releases.forEach((release) => release()));
      }
    });
  });
  onDestroy(() => {
    for (const release of rackRows.values()) release();
    rackRows.clear();
    for (const release of foldRows.values()) release();
    foldRows.clear();
  });

  /*
   * The chain has the section's lower two thirds, under the palette bar
   * (ADR-535), one row up to `ROW_UNITS` and two past it
   * (`chainUnitLayout`). The cells take the whole width: the + that ended
   * the chain is a chip at the bar's right end now (the user, 2026-11-13),
   * so the room a second row leaves widens its last cell, as a row's end
   * always has.
   */
  const layout = $derived.by(() => {
    const widths = drawn.map(unitsOf);
    const laid = chainUnitLayout(widths, 0, ROW_UNITS);
    const places = laid.places.map((p) => ({ ...p }));
    const last = places[places.length - 1];
    if (last && laid.ghost.span > 0 && laid.ghost.row === last.row) last.span += laid.ghost.span;
    return { ...laid, places };
  });
  const grid = $derived({ cols: layout.cols, rows: layout.rows });

  /*
   * An open rack's arm (ADR-529), a group track's panhandle (ADR-413) in
   * the chain: the rack cell's outline continues sideways over everything
   * its unfold drew, which hangs below the arm with a gap and keeps its own
   * outline. One arm per row the unfold reaches; a rack inside a rack sits
   * one step lower and its arm stacks under its parent's. A tap on an arm
   * folds the rack.
   */
  const ARM_STEP = 18;
  function levelOf(cell: Cell): number {
    return cell.inside ? cell.inside.depth + 1 : 0;
  }
  const arms = $derived.by(() => {
    const out: { key: string; path: string; name: string; ink: string; row: number; from: number; to: number; level: number; joined: boolean }[] = [];
    drawn.forEach((cell, i) => {
      if (!cell.foldable || cell.kind === 'chains' || !rackFold.isOpen(cell.path)) return;
      const own = layout.places[i];
      const under = (c: Cell) => !!c.inside && (c.inside.rackPath === cell.path || c.inside.rackPath.startsWith(`${cell.path}/`));
      let j = i + 1;
      while (j < drawn.length && under(drawn[j])) j++;
      const rows = new Map<number, { from: number; to: number }>();
      for (let k = i + 1; k < j; k++) {
        const p = layout.places[k];
        if (!p) continue;
        const r = rows.get(p.row);
        rows.set(p.row, r ? { from: Math.min(r.from, p.col), to: Math.max(r.to, p.col + p.span) } : { from: p.col, to: p.col + p.span });
      }
      for (const [row, { from, to }] of rows) {
        out.push({
          key: `${cell.key}|arm|${row}`,
          path: cell.path,
          name: cell.device.name,
          ink: cell.ink,
          row,
          from,
          to,
          level: levelOf(cell),
          joined: !!own && own.row === row && own.col + own.span === from
        });
      }
    });
    return out;
  });
  /** Racks whose arm grows out of their own cell: their top-right corner squares. */
  const armedRacks = $derived(new Set(arms.filter((a) => a.joined).map((a) => a.path)));

  /*
   * The palette bar (the user, 2026-11-11; `services/effectPalette`): ghost
   * effects across the top in family blocks, each family's main effects on
   * the first row and its others under them, a seam between blocks. The
   * chain's own + is the way to anything else (the user, 2026-11-11). Which effects depends on the kind of track
   * alone; how many blocks fit on the width, chips at least
   * `PALETTE_TILE_MIN` wide (whole blocks, dropped from the end).
   */
  const PALETTE_TILE_MIN = 60;
  let paletteWidth = $state(0);
  const paletteKind = $derived<PaletteKind>(
    padScope || cells.some((c) => c.kind === 'instrument' && c.device.className === 'DrumGroupDevice')
      ? 'kit'
      : !chainTrack?.isFoldable && !chainTrack?.hasMidiInput && chainTrack?.hasAudioInput
        ? 'audio'
        : 'instrument'
  );
  /*
   * The bar is one row (ADR-548): its first row of chips and the chevron,
   * the chain under it taking the rest. The chevron opens it to three rows
   * and closes it, lit while open; a finger on a chip opens it for as long
   * as it is down: slide to any chip and let go to load it, and the bar
   * closes again. The bar has no way to the browser (Ben, 2026-11-18).
   * Open, held or latched, it lies over the chain, which never moves
   * (ADR-549); latched, a touch on the rest of the chain closes it
   * (`.palette-catch`) and presses nothing under it.
   */
  let paletteOpen = $state(false);
  function togglePalette() {
    swallowNextClick();
    paletteOpen = !paletteOpen;
  }
  /* A tap loads the chip it lands on; a release off the
   * chips loads nothing. It opens on a short hold (a quick tap only loads)
   * or at once on a slide; 300ms felt laggy (Ben, 2026-11-18). One gesture
   * on the whole bar, so the chips take no press of their own and the
   * finger can cross them.
   */
  const PEEK_HOLD_MS = 120;
  let palettePeek = $state(false);
  let hotChip = $state<string | null>(null);
  let chipGesture = false;
  const barOpen = $derived(paletteOpen || palettePeek);
  const chipById = $derived.by(() => {
    const map = new Map<string, ChainEffect>();
    for (const { block, start } of placed.blocks) {
      block.rows.forEach((row, r) => row.forEach((fx, i) => fx && map.set(`${r + 1}:${start + i}`, fx)));
    }
    for (const { fx, row } of placed.tailChips) if (fx) map.set(`${row}:${placed.tail}`, fx);
    return map;
  });
  function chipAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-chip-id]');
    return el?.dataset.chipId ?? null;
  }
  function loadChip(id: string | null) {
    const fx = id ? chipById.get(id) : undefined;
    if (fx) void addEffectToChain(fx);
  }
  function endChipGesture(load: boolean) {
    if (chipGesture && load) loadChip(hotChip);
    chipGesture = false;
    palettePeek = false;
    hotChip = null;
  }
  /** The blocks that fit, each placed: its first column, after the seams before it. */
  const placed = $derived.by(() => {
    const all = paletteBlocks(paletteKind);
    const room = paletteColumns(paletteWidth, PALETTE_TILE_MIN, 0);
    // The chevron closes the bar, a chip's width, two chips under it.
    const blocks = paletteWidth > 0 ? fitBlocks(all, room - 1) : all;
    // One grid, no seams between the families: their washes divide them.
    let col = 1;
    const out = blocks.map((block) => {
      const start = col;
      col += block.cols;
      return { block, start };
    });
    const template = `repeat(${col}, minmax(0, 1fr))`;
    const tailChips = paletteTail().map((chip, i) => ({ ...chip, row: i + 2 }));
    return { blocks: out, template, tail: col, tailChips };
  });
  /** A chip's ink: its device's family colour, as the cell it would become wears it. */
  /* A chip's faint wash is its palette block's family colour (ADR-547):
     the raw table, since a preset's scheme answers with the track's ink. */
  const BLOCK_FAMILY: Record<string, DeviceFamily> = {
    midi: 'pitchSeq', guitar: 'guitar', tone: 'filter', dynamics: 'dynamics',
    distortion: 'distortion', modulation: 'modulation', glitch: 'glitch', time: 'timeSpace',
    utility: 'utility'
  };
  function chipInk(blockFamily: string): string | undefined {
    const family = BLOCK_FAMILY[blockFamily];
    return family ? DEVICE_FAMILY_INKS[family].primary : undefined;
  }


  /** The cell position under a point, by the grid's geometry at lift — not the cells, which are sliding. */
  function positionAt(d: Drag, x: number, y: number): number {
    const col = Math.max(0, Math.min(d.cols - 1, Math.floor(((x - d.chain.left) * d.cols) / (d.chain.width + GRID_GAP))));
    const row = grid.rows === 1 ? 0 : y < d.chain.top + d.chain.height / 2 ? 0 : 1;
    return chainIndexAt(d.places, row, col);
  }

  // The dragged cell's offset from where it was lifted, written once a
  // frame as a transform from wherever the previewed order has put its
  // slot (`offsetLeft`/`offsetTop`, which leave the transform out).
  let offset = { dx: 0, dy: 0 };
  let frame = 0;
  function paintDragged() {
    frame = 0;
    const d = drag;
    if (!d || !dragNode) return;
    const x = d.box.left + offset.dx - dragNode.offsetLeft;
    // One row: the cell slides along it, level, wherever the finger goes
    // up or down (Ben, 2026-10-26). Two rows need the vertical.
    const dy = grid.rows === 1 ? 0 : offset.dy;
    // Never past the chain's top or bottom edge: the cell stays whole on
    // screen, however far the finger goes (the user, 2026-11-05).
    const top = Math.max(0, Math.min(d.chain.height - d.box.height, d.box.top - dy));
    const y = top - dragNode.offsetTop;
    dragNode.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  function scheduleDragged() {
    if (!frame) frame = requestAnimationFrame(paintDragged);
  }

  // FLIP: on a change of order, each cell starts where it was drawn and
  // slides to its new place. Measured only when the order changes, and run
  // only for a reorder: the same cells in another order. A cell added or
  // removed (a chip's load, its ghost giving way to the device) or the
  // chain resized under them snaps in one
  // frame; sliding every cell from where the old layout had it read as the
  // chain jumping twice on every load (Ben, 2026-11-18).
  const orderKey = $derived(shown.map((c) => c.key).join('\n'));
  let before = new Map<string, DOMRect>();
  $effect.pre(() => {
    void orderKey;
    if (!chainEl) return;
    before = new Map();
    for (const el of chainEl.querySelectorAll<HTMLElement>(':scope > [data-cell-key]')) {
      if (el !== dragNode) before.set(el.dataset.cellKey!, el.getBoundingClientRect());
    }
  });
  $effect(() => {
    void orderKey;
    if (!chainEl || before.size === 0) return;
    const now = [...chainEl.querySelectorAll<HTMLElement>(':scope > [data-cell-key]')].map((el) => el.dataset.cellKey!);
    const reorder = now.length === before.size + (dragNode ? 1 : 0) && now.every((k) => before.has(k) || dragNode?.dataset.cellKey === k);
    if (!reorder) {
      before = new Map();
      return;
    }
    for (const el of chainEl.querySelectorAll<HTMLElement>(':scope > [data-cell-key]')) {
      const from = before.get(el.dataset.cellKey!);
      if (!from) continue;
      for (const a of el.getAnimations()) a.cancel();
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      });
    }
    before = new Map();
    // Its slot moved under it: keep the dragged cell under the finger
    // before this frame paints.
    if (drag) paintDragged();
  });
  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
  });

  // A press that lands on a cell's tile is the tile's: it picks the device
  // and the cell neither reorders nor taps. Read at finger-down, from the
  // press's own target — Svelte delegates the tiles' pointer handlers to
  // the root, so stopping the event on the way up would starve them.
  let pressInControl = false;
  /** The press landed on the header bar: its tap is Device On. */
  let pressInHead = false;
  /** The press landed on a rack's fold button (ADR-529). */
  let pressInFold = false;
  function pressDown(cell: Cell, info: DragInfo) {
    const target = info.event?.target;
    pressInFold = target instanceof Element && target.closest('.cell-fold') !== null;
    pressInControl = !pressInFold && target instanceof Element && target.closest('.cell-control') !== null;
    pressInHead = !pressInFold && target instanceof Element && target.closest('.cell-head') !== null;
    if (pressInControl && cell.presetKey && !cell.landing) fxChainStore.pick(pickScope, cell.presetKey, cell.device.devicePath);
  }

  /**
   * A tap on a cell's control opens the device too (the user, 2026-10-26:
   * a tap on the Auto Filter's XY did nothing). The XY counts a press as its
   * own tap only under 200 ms and 5 px, which a finger on the iPad often
   * is not; the cell's tap has no time limit and a touch's slop. Every
   * control (the user, 2026-11-10: anywhere on a cell but its header
   * button): Permute's steps toggle and open, the MIDI wheels move and
   * open, a Drum Rack's active pads scope the chain to a pad (a press there is
   * the pad's), anywhere else on the kit opens the Drum Rack view.
   */

  function dragStart(cell: Cell, position: number, info: DragInfo) {
    // A drag on a cell's control is that control's, and it opens the
    // device's view as a tap on the cell does — every control here, not
    // only the grid's tiles, which open their own (2026-10-26).
    if (pressInControl) {
      open(cell, true);
      return;
    }
    // Nothing reorders while an effect is landing: its cell has no place in Live yet.
    if (cell.kind === 'instrument' || cell.inside || cell.kind === 'chains' || pressInFold || !chainEl) return;
    if (cells.some((c) => c.landing)) return;
    const node = chainEl.querySelector<HTMLElement>(`:scope > [data-cell-key="${CSS.escape(cell.key)}"]`);
    if (!node) return;
    // Where it is drawn, mid-slide included, so it lifts from under the finger.
    const r = node.getBoundingClientRect();
    const c = chainEl.getBoundingClientRect();
    for (const a of node.getAnimations()) a.cancel();
    const instrument = shown.findIndex((x) => x.kind === 'instrument');
    dragNode = node;
    offset = { dx: info.dx, dy: info.dy };
    drag = {
      key: cell.key,
      from: position,
      to: position,
      base: shown.map(({ key, sig }) => ({ key, sig })),
      instrument: instrument >= 0 ? instrument : null,
      box: { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height },
      chain: { left: c.left, top: c.top, width: c.width, height: c.height },
      cols: layout.cols,
      places: layout.places.map((p) => ({ ...p }))
    };
    paintDragged();
  }

  function dragMove(info: DragInfo) {
    const d = drag;
    if (!d) return;
    offset = { dx: info.dx, dy: info.dy };
    scheduleDragged();
    // The landing is read at the lifted cell's centre, so it follows the
    // cell wherever it was picked up by.
    const x = d.chain.left + d.box.left + d.box.width / 2 + info.dx;
    const y = d.chain.top + d.box.top + d.box.height / 2 - info.dy;
    const to = clampChainIndex({ from: d.from, to: topAt(positionAt(d, x, y)), count: d.base.length, instrument: d.instrument });
    if (to !== null && to !== d.to) drag = { ...d, to };
  }

  function dragEnd(info: DragEndInfo) {
    const d = drag;
    const node = dragNode;
    drag = null;
    dragNode = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    // Only a finger lifted drops; a cancel or an unmount puts it back.
    if (d && info.reason === 'up' && d.to !== d.from) {
      reorder = { desired: moved(d.base, d.from, d.to), inflight: reorder.inflight };
    }
    if (node) settle(node);
  }

  /** The let-go cell glides from under the finger into its slot. */
  function settle(node: HTMLElement) {
    const from = node.getBoundingClientRect();
    node.style.transform = '';
    void tick().then(() => {
      if (!node.isConnected) return;
      for (const a of node.getAnimations()) a.cancel();
      const to = node.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      });
    });
  }

  /** What the device does, drawn (`ControlGlyph`): by the app's own device, its class, else its name. */
  function glyphOf(cell: Cell): ControlGlyphName | null {
    const { device } = cell;
    return (
      (cell.presetKey ? DEVICE_KEY_GLYPHS[cell.presetKey] : undefined) ??
      DEVICE_CLASS_GLYPHS[device.className] ??
      glyphForName(device.name) ??
      null
    );
  }

  /** The caption under a cell's name: what the device is, where its name does not say (`deviceTypeLabel`). */
  function captionOf(cell: Cell): string | null {
    if (cell.kind === 'chains') return cell.device.name;
    // Inside a rack of several chains: which chain it is on.
    if (cell.inside && cell.inside.chains > 1) return cell.inside.chain.name;
    return deviceTypeLabel(cell.device.className, cell.device.name);
  }

  /** The chain's own +: the browser on Effect, its picks into that chain (ADR-529). */
  function addToChain(chainPath: string) {
    swallowNextClick();
    chainAddTarget.set(chainPath);
    browserModeStore.openEffectsBrowser();
  }
  // A chain is the target only while the browser it opened is up.
  $effect(() => {
    if (!browserModeStore.isInstrumentPersistent) untrack(() => chainAddTarget.clear());
  });

  /** The instrument view type of an instrument on a rack's chain, when it has a face; else null. */
  function innerFaceType(cell: Cell): string | null {
    const { device } = cell;
    if (!instrumentService.isInstrumentClass(device.className)) return null;
    const type = instrumentService.identifyInstrumentType({
      deviceIndex: 0,
      className: device.className,
      name: device.name,
      type: 'instrument',
      devicePath: device.devicePath
    });
    return FACED_INSTRUMENTS.has(type) ? type : null;
  }

  /** `fromControl`: the press landed on the cell's control, not its frame. */
  function open(cell: Cell, fromControl = false) {
    const { device } = cell;
    // Under a held strip the chain is edited in place: opening a view
    // would appoint the device, and Live would select its track. A landing
    // cell has no device to open yet; its tile opens the type's view.
    if (trackHoldScope.active || cell.landing) return;
    if (cell.kind === 'instrument' && !cell.inside) {
      // The kit cell under a pad: back to the kit — from its frame. Its
      // Trnsp is the pad's under the scope, so a touch there keeps it.
      if (cell.kit && padScope) {
        if (fromControl) return;
        drumPadScope.clear();
        return;
      }
      // The pad's instrument is what the Drum Rack view already shows.
      if (padScope) return;
      fxChainStore.appoint(device.devicePath, { force: true });
      if (glance.instrumentViewType) {
        centralDisplayStore.setView('instrument', glance.instrumentViewType, { instrument: glance.instrument });
        return;
      }
    }
    // An instrument on a rack's chain: its own instrument view, the one it
    // would get as the track's instrument (Ben, 2026-11-17), on that device.
    if (cell.inside && !padScope && instrumentService.isInstrumentClass(device.className)) {
      const instrument = {
        deviceIndex: 0,
        className: device.className,
        name: device.name,
        type: 'instrument' as const,
        devicePath: device.devicePath
      };
      const type = instrumentService.identifyInstrumentType(instrument);
      if (isViewRegistered('instrument', type)) {
        fxChainStore.appoint(device.devicePath, { force: true });
        centralDisplayStore.setView('instrument', type, { instrument });
        return;
      }
    }
    // An effect: its view, as a browser load's (`services/effectView`).
    openEffectView(device, { pickScope, padScoped: !!padScope });
  }
</script>

{#snippet cellBody(cell: Cell, position: number)}
  {@const glyph = glyphOf(cell)}
  {@const tile = cell.kind !== 'instrument' && cell.presetKey ? TILE_COMPONENTS[cell.presetKey] : undefined}
  {@const caption = captionOf(cell)}
      <!-- The header bar (2026-11-08, ADR-518): the panels' bar (ADR-516)
           at the height of a strip's name band, so there is room to grab
           the cell (the user, 2026-10-26). The name in the device's ink
           over a wash of it, what the device IS under it where the name
           does not say, and Device On at the right as every section's
           switch sits on its bar, lit in the ink while on. The blue hand
           is the cell's frame alone (2026-11-05). Measured as the faces
           are (ADR-492), so a narrow cell's name steps down a size. -->
      <CellSize><div class="cell-head">
        <span class="head-text">
          <span class="name" lang="en">{cell.kind === 'chains' ? 'Chains' : cell.device.name}</span>
          {#if caption}<span class="caption">{caption}</span>{/if}
        </span>
        {#if cell.kind === 'instrument' && !cell.inside && glance.instrumentViewType === 'operator'}<span class="head-end"><OperatorHeadAlgorithm device={cell.device} /></span>{/if}
        {#if cell.foldable && cell.kind !== 'chains'}
          <!-- Fold / unfold the rack's chains (ADR-529): down while folded,
               right while open, toward the chains it has opened (Ben,
               2026-11-17), at the bar's left end, ahead of the name. -->
          <span
            class="cell-fold"
            role="button"
            tabindex="-1"
            aria-label="{rackFold.isOpen(cell.path) ? 'Fold' : 'Unfold'} {cell.device.name}"
            aria-expanded={rackFold.isOpen(cell.path)}
            data-debug="chain-fold"
          >{#if rackFold.isOpen(cell.path)}<ChevronRight />{:else}<ChevronDown />{/if}</span>
        {/if}
      </div></CellSize>

      {#if cell.kind === 'chains' && cell.inside && cell.chains}
        <!-- An unfolded rack's chains: a tap chooses the one shown, the dot
             is its activator (ADR-529). -->
        <div class="cell-face" role="presentation"><ChainListFace
          chains={cell.chains}
          selected={rackFold.chainOf(cell.inside.rackPath)}
          onSelect={(i) => rackFold.selectChain(cell.inside!.rackPath, i)}
          onMute={(i, on) => setChainSwitch(cell.inside!.rackPath, i, 'mute', on)}
          onVolume={(i, v) => setChainVolume(cell.inside!.rackPath, i, v)}
        /></div>
      {:else if bareChains(cell)}
        <!-- A rack with no macros, open, of two chains or more: its own
             cell is its chain list (Ben, 2026-11-17), in place of the
             separate list cell. -->
        <div class="cell-face" role="presentation"><ChainListFace
          chains={bareChains(cell) ?? []}
          selected={rackFold.chainOf(cell.path)}
          onSelect={(i) => rackFold.selectChain(cell.path, i)}
          onMute={(i, on) => setChainSwitch(cell.path, i, 'mute', on)}
          onVolume={(i, v) => setChainVolume(cell.path, i, v)}
        /></div>
      {:else if cell.kit}
        <!-- A Drum Rack: the pads its playing clip has notes on. -->
        <div class="cell-control" role="presentation"><CellSize>
          <DrumRackFace device={cell.device} color={trackScheme ?? schemeFromInk(cell.ink)} />
        </CellSize></div>
      {:else if cell.presetKey === 'sequencer'}
        <!-- Permute: its mute and pitch steps, on this device. -->
        <div class="cell-control" role="presentation"><CellSize><PermuteStepsFace device={cell.device} color={cell.ink} /></CellSize></div>
      {:else if !padScope && !cell.inside && cell.kind === 'instrument' && glance.instrumentViewType && FACED_INSTRUMENTS.has(glance.instrumentViewType) && !isBareRack(cell)}
        <!-- The instrument's signature control, as its view draws it. -->
        <div class="cell-control" role="presentation"><CellSize>
          <InstrumentFace device={cell.device} type={glance.instrumentViewType} color={trackScheme ?? schemeFromInk(cell.ink)} />
        </CellSize></div>
      {:else if !padScope && cell.inside && innerFaceType(cell)}
        <!-- An instrument on a rack's chain: the same signature control it
             draws as the track's instrument, on this device. -->
        <div class="cell-control" role="presentation"><CellSize>
          <InstrumentFace device={cell.device} type={innerFaceType(cell) ?? ''} color={trackScheme ?? schemeFromInk(cell.ink)} />
        </CellSize></div>
      {:else if !padScope && isMidiWheels(cell.device)}
        <!-- The pitch and mod wheels, as the instrument views draw them:
             side by side, stacked only in a narrow cell. -->
        <div class="cell-control" role="presentation"><CellSize><MidiWheelsFace /></CellSize></div>
      {:else if tile}
        <!-- The grid's own tile, on this device. A touch here is the
             control's: it picks this device and never starts a reorder. -->
        <div class="cell-control" role="presentation"><CellSize>
          <LandingScope id={cell.landing}><tile.Tile device={cell.landing ? undefined : cell.device} position={tile.position} /></LandingScope>
        </CellSize></div>
      {:else if controlFor(cell.presetKey)}
        <!-- No grid tile: the device's control (deviceControls), the one its
             browser preset tiles and its view draw, on this device. -->
        <div class="cell-control" role="presentation"><CellSize>
          <LandingScope id={cell.landing}><ControlTile type={cell.presetKey as DeviceTypeKey} device={cell.landing ? undefined : cell.device} /></LandingScope>
        </CellSize></div>
      {:else}
      {#snippet mark()}
        {#if cell.kind === 'instrument' && !cell.inside}
          <!-- The strip's own mark for the instrument, so the two agree. -->
          <span class="instrument-mark"><TrackDeviceView {glance} color={cell.ink} /></span>
        {:else if glyph}
          <span class="glyph"><ControlGlyph name={glyph} /></span>
        {:else if cell.kind === 'max'}
          <Box />
        {:else if cell.kind === 'plugin'}
          <Plug />
        {:else}
          <Music />
        {/if}
      {/snippet}
      {@const macroGrid = cell.foldable ? macroGridOf(cell.device) : null}
      {#if macroGrid}
        <!-- A rack: its visible macros as knobs, laid out as Live's panel, as much of it as the cell holds. -->
        <div class="cell-control" role="presentation"><CellSize><RackFace
          grid={macroGrid}
          valueOf={(i) => macroValue(cell.device, i)}
          color={cell.kind === 'instrument' ? (trackScheme ?? schemeFromInk(cell.ink)) : schemeFromInk(cell.ink)}
          onChange={(i, v) => setMacro(cell.device, i, v)}
        /></CellSize></div>
      {:else}
        <div class="mark" aria-hidden="true">{@render mark()}</div>
      {/if}
      {/if}
{/snippet}

<div class="chain-wrap" class:palette-open={barOpen} class:two-rows={grid.rows > 1} class:pad-scoped={padScope !== null} style={padInk ? `--scope-ink: ${padInk}` : undefined}>
<!-- The palette bar: family blocks, a seam between them. Every chip in a
     fixed place; the + at its end opens the second and third rows, Gain
     beside it. -->
<div
  class="palette"
  bind:clientWidth={paletteWidth}
  style:grid-template-columns={placed.template}
  data-debug="chain-palette"
  data-palette-kind={paletteKind}
  data-palette-open={barOpen}
  role="group"
  aria-label="Effects to add"
  use:dragGesture={{
    commit: 'either',
    holdMs: PEEK_HOLD_MS,
    onDown: ({ downX, downY }) => {
      hotChip = chipAt(downX, downY);
      chipGesture = hotChip !== null;
    },
    onHold: () => {
      if (chipGesture) palettePeek = true;
    },
    onStart: () => {
      if (chipGesture) palettePeek = true;
    },
    onMove: ({ x, y }) => {
      if (chipGesture) hotChip = chipAt(x, y);
    },
    onTap: () => endChipGesture(true),
    onEnd: ({ reason }) => endChipGesture(reason === 'up'),
    onPressEnd: ({ mode, event }) => {
      // A hold let go without moving: the release is here, not in onEnd.
      if (mode === 'undecided' && palettePeek && event?.type === 'pointerup') endChipGesture(true);
      else if (mode === 'undecided' && event?.type === 'pointercancel') endChipGesture(false);
    }
  }}
>
  {#each placed.blocks as { block, start } (block.family)}
    {#each barOpen ? block.rows : block.rows.slice(0, 1) as row, r (r)}
      {#each Array.from({ length: block.cols }, (_, i) => row[i] ?? null) as fx, i (i)}
        <div class="palette-slot" class:blank={!fx} class:family-head={r === 0} style:grid-column={start + i} style:grid-row={r + 1} data-family={block.family} data-chip-id={fx ? `${r + 1}:${start + i}` : undefined}>
          {#if fx}<PaletteChip {fx} label={paletteLabel(fx)} ink={chipInk(block.family)} passive hot={hotChip === `${r + 1}:${start + i}`} />{/if}
        </div>
      {/each}
    {/each}
  {/each}
  {#if barOpen}
    {#each placed.tailChips as { family, fx, row } (row)}
      <div class="palette-slot" class:blank={!fx} style:grid-column={placed.tail} style:grid-row={row} data-family={family} data-chip-id={fx ? `${row}:${placed.tail}` : undefined}>
        {#if fx}<PaletteChip {fx} label={paletteLabel(fx)} ink={chipInk(family)} passive hot={hotChip === `${row}:${placed.tail}`} />{/if}
      </div>
    {/each}
  {/if}
  <div class="palette-slot" style:grid-column={placed.tail} style:grid-row="1">
    <button
      type="button"
      class="chain-add palette-add"
      class:open={paletteOpen}
      aria-label={paletteOpen ? 'Fewer effects' : 'More effects'}
      aria-expanded={paletteOpen}
      data-debug="chain-add"
      use:press={{ onPress: togglePalette, touchAction: 'none', stopPropagation: true }}
    >
      <span class="chain-add-plus" aria-hidden="true"><ChevronDown /></span>
    </button>
  </div>
</div>
{#if paletteOpen}
  <div
    class="palette-catch"
    aria-hidden="true"
    data-debug="chain-palette-catch"
    use:press={{ onPress: togglePalette, touchAction: 'none', fireOn: 'down', stopPropagation: true }}
  ></div>
{/if}
<div
  class="chain"
  style:--chain-cols={grid.cols}
  style:--chain-rows={grid.rows}
  data-debug="chain-overview"
  data-chain-scope={padScope?.note}
  bind:this={chainEl}
>
  {#each drawn as cell, position (cell.key)}
    {#if cell.kind === 'add'}
    <button
      type="button"
      class="chain-add chain-add-inner"
      class:targeted={chainAddTarget.path === cell.path}
      style="--rack-ink: {cell.inside?.ink ?? cell.ink};{levelOf(cell) ? ` margin-top: ${levelOf(cell) * ARM_STEP}px;` : ''}"
      style:grid-column={layout.places[position] ? `${layout.places[position].col + 1} / span ${layout.places[position].span}` : undefined}
      style:grid-row={layout.places[position] ? `${layout.places[position].row + 1}` : undefined}
      aria-label="Add an effect to {cell.inside?.chain.name || 'the chain'}"
      data-debug="chain-add-inner"
      data-chain-path={cell.path}
      use:press={{ onPress: () => addToChain(cell.path), touchAction: 'none' }}
    >
      <span class="chain-add-plus" aria-hidden="true"><Plus /></span>
    </button>
    {:else}
    <div
      class="chain-cell"
      class:off={!isOn(cell)}
      class:landing={!!cell.landing}
      class:dragging={drag?.key === cell.key}
      class:appointed={appointedPath === cell.device.devicePath}
      aria-current={appointedPath === cell.device.devicePath ? 'true' : undefined}
      class:instrument={cell.kind === 'instrument' && !cell.inside}
      class:inside={!!cell.inside}
      class:unfolded={cell.foldable && rackFold.isOpen(cell.path)}
      class:armed={cell.kind !== 'chains' && armedRacks.has(cell.path)}
      class:half={layout.places[position]?.span === 1}
      style="--cell-ink: {cell.ink};{levelOf(cell) ? ` margin-top: ${levelOf(cell) * ARM_STEP}px;` : ''}"
      style:grid-column={layout.places[position] ? `${layout.places[position].col + 1} / span ${layout.places[position].span}` : undefined}
      style:grid-row={layout.places[position] ? `${layout.places[position].row + 1}` : undefined}
      data-cell-key={cell.key}
      data-device-path={cell.device.devicePath}
      data-kind={cell.kind}
      role="button"
      tabindex="0"
      aria-label="{cell.device.name}{cell.tile ? `, the ${cell.tile} tile's` : ''}"
      use:dragAction={{
        commit: 'either',
        onDown: (info) => pressDown(cell, info),
        onTap: () => {
          if (pressInFold) {
            rackFold.toggle(cell.path);
            return;
          }
          // The chain list answers its own taps.
          if (cell.kind === 'chains') return;
          // The header is the device's switch, as a strip's name is its
          // mute; the kit's under a pad scope still leads back to the kit.
          // An instrument's header opens its view instead (the user,
          // 2026-11-16): switching the voice off is never what a tap there meant.
          if (pressInHead && isPowered(cell) && cell.kind !== 'instrument') togglePower(cell);
          else open(cell, pressInControl);
        },
        onStart: (info) => dragStart(cell, topAt(position), info),
        onMove: dragMove,
        onEnd: dragEnd
      }}
    >
      {@render cellBody(cell, position)}
    </div>
    {/if}
  {/each}
  {#each arms as arm (arm.key)}
    <button
      type="button"
      class="rack-arm"
      class:joined={arm.joined}
      style:grid-column="{arm.from + 1} / {arm.to + 1}"
      style:grid-row={arm.row + 1}
      style:margin-top="{arm.level * ARM_STEP}px"
      style="--arm-ink: {arm.ink};"
      data-debug="rack-arm"
      data-rack-path={arm.path}
      aria-label="Fold {arm.name}"
      use:press={{ onPress: () => rackFold.toggle(arm.path), touchAction: 'none' }}
    ></button>
  {/each}
  {#if padScope}
    <!-- Whose chain this is, as the grid's scope chip says it. -->
    <div class="pad-chip chain-scope-chip" aria-label="Chain of pad {padScope.note}">
      {padTileLabel(padScope.name) || `Pad ${padScope.note}`}
    </div>
  {/if}
</div>
</div>

<style>
  /* As many unit columns and rows as the chain needs (`chainUnitLayout`), on the FX
     grid's 8px trough. */
  /* The chain's frame: the pad scope's outline and the two-row header. */
  .chain-wrap {
    /* The cells are panels (ADR-518, after the boards' tiles, ADR-516):
       a surface a shade off the page, a hairline, soft corners. The
       ghosts (the palette, +, the ghost Utility) are the same
       shape drawn in a dashed line and no fill. */
    --cell-radius: 6px;
    --cell-line: var(--line);
    --ghost-radius: 4px;
    --ghost-line: color-mix(in oklab, var(--fg-tertiary) 45%, transparent);
    --ghost-line-strong: color-mix(in oklab, var(--fg-tertiary) 70%, transparent);
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* Sixths (ADR-548, after ADR-535's thirds): a row of chips is one,
       half the rail's Record tile, as the two rows were. The palette is
       the first and the chain the other five; open, the palette covers
       the first three, over the chain (ADR-549). Same row gap as the
       rail's buttons, so the open bar ends on the seam under Record's
       neighbour. */
    grid-template-rows: repeat(6, minmax(0, 1fr));
    row-gap: var(--spacing-xs);
    column-gap: 8px;
    min-width: 0;
  }
  /* The phone has no rail to line up with, and a whole tab of height: the
     palette's rows of chips are a fixed height, one or three. */
  :global([data-phone-layout]) .chain-wrap {
    grid-template-rows: 44px repeat(2, minmax(0, 1fr));
    row-gap: 8px;
  }
  :global([data-phone-layout]) .chain-wrap .chain {
    grid-row: 2 / span 2;
  }
  .chain-wrap.pad-scoped {
    outline: 2px solid var(--scope-ink, var(--track-ink, var(--phosphor)));
    outline-offset: -2px;
    border-radius: var(--cell-radius);
  }
  .chain {
    grid-column: 1;
    grid-row: 2 / span 5;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--chain-cols, 10), minmax(0, 1fr));
    grid-template-rows: repeat(var(--chain-rows, 2), minmax(0, 1fr));
    /* A two-row chain's rows sit on the rail's second and third buttons. */
    row-gap: var(--spacing-xs);
    column-gap: 8px;
  }
  /* A pad's chain wears the pad's frame and chip, as the scoped grid does
     (FXGrid's .fx-scoped: drawn inside, since the section clips). */
  .chain {
    position: relative;
    /* Its own stacking context, so nothing raised inside a cell (a pad's
       dot) draws over the open palette lying on it (ADR-549). */
    isolation: isolate;
  }
  .chain-scope-chip {
    --chip-ink: var(--scope-ink, var(--track-ink));
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 3;
    pointer-events: none;
  }
  /* The + cell: the strips row's add buttons' dashed ghost (NewTrackButtons),
     the firmest of the ghosts, since it is the one that always does
     something. */
  .chain-add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 1px dashed var(--ghost-line-strong);
    border-radius: var(--ghost-radius);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--t-fast) var(--ease-precise), color var(--t-fast) var(--ease-precise);
  }
  .chain-add > span {
    opacity: 0.7;
  }
  .chain-add:active {
    background: var(--secondary);
    color: var(--foreground);
  }
  .chain-add:active > span {
    opacity: 1;
  }
  /* A chain's own + (ADR-529): the dashed ghost in the rack's ink, lit
     while the browser it opened is adding to that chain. */
  .chain-add-inner {
    border-color: color-mix(in oklab, var(--rack-ink) 60%, var(--ghost-line-strong));
    color: var(--rack-ink);
  }
  .chain-add-inner.targeted {
    border-style: solid;
    background: color-mix(in oklab, var(--rack-ink) 18%, transparent);
  }
  .chain-add-inner.targeted > span {
    opacity: 1;
  }
  /* A big +, as tall as the tile allows (the user, 2026-11-05). */
  .chain-add-plus {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  .chain-add-plus :global(svg) {
    width: auto;
    height: min(60%, 56px);
    aspect-ratio: 1;
    stroke-width: 1.5;
  }
  /* The chevron: a chip's height, its mark sized to the chip; lit while
     the bar is open (on has no hue, ADR-544). */
  .palette-add .chain-add-plus :global(svg) {
    height: min(70%, 32px);
  }
  .palette-add.open {
    border-style: solid;
    border-color: var(--on-bg);
    background: var(--on-bg);
    color: var(--on-fg);
  }

  /* A cell is a panel: the strips' own surface on the page, a hairline,
     the header bar across its top and its face in the field below. */
  .chain-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--cell-line);
    border-radius: var(--cell-radius);
    background: var(--card);
    color: var(--cell-ink);
    cursor: pointer;
    user-select: none;
    /* The bar's wash and the face's frame stop at the corners. */
    overflow: hidden;
    transition: border-color var(--t-fast) var(--ease-precise), box-shadow var(--t-fast) var(--ease-precise);
  }
  /* The palette bar: the MIDI chips, a seam, the audio chips and +, one
     row of chips of one size, each placed by its slot. */
  /* The bar runs to the right edge, its + and Gain chips last. */
  /* One grid with no gaps (ADR-548, the experiment): a finger sliding
     across it never falls between two chips. Each chip draws half a
     hairline on its own edges, so two together make one line. */
  .palette {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    gap: 0;
    border-radius: var(--ghost-radius);
    overflow: hidden;
  }
  .palette :global(.palette-chip) {
    border: 0;
    border-radius: 0;
    box-shadow: inset 0 0 0 0.5px var(--line);
  }
  /* Each family's column wears a stripe of its ink across the top of its
     first-row chips, so the blocks read at a glance while the chips stay
     quiet. */
  .palette .palette-slot.family-head :global(.palette-chip) {
    box-shadow:
      inset 0 3px 0 color-mix(in srgb, var(--chip-ink) 85%, transparent),
      inset 0 0 0 0.5px var(--line);
  }
  .palette .palette-slot.blank {
    border: 0;
    border-radius: 0;
    box-shadow: inset 0 0 0 0.5px var(--line);
  }
  .palette .chain-add {
    border-radius: 0;
  }
  /* Three rows and the two gaps they replace, so the bar still ends on
     the section's third sixth. */
  /* Open, the bar lies OVER the chain (ADR-549): the chain keeps its five
     sixths and never moves, held or latched. The bar is opaque and casts
     a shadow on the chain's cells under it. */
  .chain-wrap.palette-open .palette {
    grid-row: 1 / span 3;
    grid-template-rows: repeat(3, minmax(0, 1fr));
    position: relative;
    z-index: 3;
    background: var(--background);
    box-shadow: 0 6px 16px -4px color-mix(in srgb, black 55%, transparent);
  }
  :global([data-phone-layout]) .chain-wrap.palette-open .palette {
    grid-row: 1;
    align-self: start;
    height: 140px;
  }
  /* Under the open bar the chain dims, held or latched (Ben, 2026-11-19):
     it is out of play, its names at the cells' feet still read. Quick,
     since a hold opens the bar for under a second. */
  .chain {
    transition: opacity 80ms ease-out;
  }
  .chain-wrap.palette-open .chain {
    opacity: 0.6;
  }
  /* A latched bar: the rest of the chain takes one tap, which closes the
     bar and presses nothing under it. */
  .palette-catch {
    grid-column: 1;
    grid-row: 2 / span 5;
    position: relative;
    z-index: 2;
  }
  :global([data-phone-layout]) .palette-catch {
    grid-row: 2 / span 2;
  }
  .palette-slot {
    min-width: 0;
    min-height: 0;
    display: grid;
  }
  /* A slot a block leaves empty (a shorter row, an effect not on this
     Mac): a faint outline, so the chips beside it read as where they are. */
  .palette-slot.blank {
    border: 1px dashed color-mix(in oklab, var(--ghost-line) 45%, transparent);
    border-radius: var(--ghost-radius);
  }
  /* Bypassed: the bar keeps its name, its wash goes and the face dims, as
     a board's tile ghosts its body when its section is off (ADR-516). */
  /* An effect on its way into Live (2026-11-16, the user's call): a
     ghost until Live has it — the dashed edge and grey name a ghost tile
     wears, its control drawn as a ghost but still showing what was set. */
  .chain-cell.landing {
    border-style: dashed;
  }
  .chain-cell.landing .cell-head {
    background: transparent;
  }
  .chain-cell.landing .name {
    color: var(--muted-foreground);
  }
  .chain-cell.off .cell-head {
    background: transparent;
  }
  .chain-cell.off .name {
    color: var(--muted-foreground);
  }
  .chain-cell.off > .cell-control,
  .chain-cell.off > .cell-face,
  .chain-cell.off > .mark {
    opacity: var(--opacity-ghost);
  }
  /* The cell under the finger rides it, over the others. */
  .chain-cell.dragging {
    z-index: 4;
    will-change: transform;
    border-color: var(--line-strong);
  }
  /* The blue hand: the device Live's controllers follow, framed in the
     selection ink the selected strip wears, so one colour means "Live's
     selection" across the screen. */
  .chain-cell.appointed {
    border-color: var(--flat-selection);
    box-shadow: inset 0 0 0 1px var(--flat-selection);
  }

  /* The header bar: the name over a wash of its ink, a hairline under it,
     the switch at its end. A band the strips' name band's height
     (--strip-band-h), a handle to drag by. */
  .cell-head {
    /* Above the face: a short cell's glyph (a rack's mark has a 40px floor)
       overflowed up over the bar and took the fold chevron's taps. */
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: var(--strip-band-h, 56px);
    /* Across its CellSize: the whole width, the switch in the corner. */
    flex: 1 1 auto;
    padding-inline: 8px;
    /* On: the bar washed in the ink, the switch's lit state; off, bare. */
    background: color-mix(in oklab, var(--cell-ink) 20%, transparent);
    border-bottom: 1px solid var(--cell-line);
    transition: background-color var(--t-standard) var(--ease-settle);
  }
  /* The chain's head wears its track's colour a shade deeper, the way the
     strip's name block does, so the chain reads as that strip's. */
  .chain-cell.instrument .cell-head {
    background: color-mix(in oklab, var(--cell-ink) 28%, transparent);
  }
  .chain-cell > :global(.cell-size:has(> .cell-head)) {
    flex: none;
  }
  /* Every cell's bar sits at its foot (the user, 2026-11-18): the face
     first, the name and its handle under it, nearest the strips. */
  .chain-cell > :global(.cell-size:has(> .cell-head)) {
    order: 1;
  }
  .chain-cell .cell-head {
    border-bottom: none;
  }
  /* Two rows of cells: half that, so the controls keep their height
     (the user, the same day). */
  .chain-wrap.two-rows .cell-head {
    height: calc(var(--strip-band-h, 56px) / 2);
    padding-inline: 6px;
    gap: 4px;
  }
  /* The name centered on its bar (the user, 2026-11-11), with no switch
     beside it since a tap on the bar is the switch. */
  .head-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 1px;
  }
  /* Operator's algorithm closes the row. */
  .head-end {
    flex: 0 0 auto;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* A rack's fold button (ADR-529): the bar's left end, ahead of the name
     (Ben, 2026-11-17; the right end until then), a 40px target, a chevron
     down while folded and right, toward the chains, while open. */
  .cell-fold {
    order: -1;
    flex: 0 0 40px;
    align-self: stretch;
    margin-left: -8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cell-ink);
    border-right: 1px solid var(--cell-line);
    cursor: pointer;
  }
  .cell-fold :global(svg) {
    width: 20px;
    height: 20px;
    stroke-width: 2;
  }
  .chain-wrap.two-rows .cell-fold {
    flex-basis: 32px;
    margin-left: -6px;
  }
  .chain-cell.unfolded .cell-fold {
    background: color-mix(in oklab, var(--cell-ink) 30%, transparent);
  }
  /* An open rack's arm (ADR-529): the group panhandle's material
     (TracksPanelV6's .group-band) in the rack's ink — the rack cell's
     outline continuing sideways, its left edge open where it joins, a
     thin band its unfold hangs under. */
  .rack-arm {
    align-self: start;
    position: relative;
    z-index: 1;
    height: 12px;
    min-height: 0;
    min-width: 0;
    padding: 0;
    border: 1px solid color-mix(in oklab, var(--arm-ink) 55%, transparent);
    border-radius: var(--cell-radius);
    background: color-mix(in oklab, var(--arm-ink) 20%, var(--card));
    cursor: pointer;
  }
  /* Grown out of the rack cell: across the gap and a pixel into it, so its
     right border is covered for the arm's height and the two are one shape. */
  .rack-arm.joined {
    margin-left: calc(-1 * 8px - 2px);
    border-left: none;
    border-radius: 0 var(--cell-radius) var(--cell-radius) 0;
  }
  .chain-cell.armed {
    border-top-right-radius: 0;
  }

  /* The face: the cell's rest, inset from the panel's edge so its own
     frame reads as a field sunk into it. */
  .mark {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 6px;
    container-type: size;
  }
  /* A mark alone (a plug-in, a Max device) is drawn to the cell, so a
     tall cell is not a glyph in a void. */
  .mark :global(svg) {
    width: clamp(28px, 30cqmin, 72px);
    height: clamp(28px, 30cqmin, 72px);
    stroke-width: 1.25;
  }
  /* A tile in a cell: the grid's XY or slider, minus its reorder arrows
     (the cell's drag moves the device here). */
  .cell-control {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    padding: 6px;
  }
  .chain-wrap.two-rows .cell-control,
  .chain-wrap.two-rows .cell-face,
  .chain-wrap.two-rows .mark {
    padding: 4px;
  }
  .cell-control > :global(*) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  .cell-control :global(.move-btn) {
    display: none;
  }
  /* The tile's own frame, in the device's ink, is the field's; its
     control's hairline inside it would be a second line. */
  .cell-control :global(.device-control) {
    border-radius: 4px;
  }
  .glyph {
    display: flex;
    width: clamp(40px, 44cqmin, 96px);
    height: clamp(40px, 44cqmin, 96px);
  }
  .glyph :global(svg) {
    width: 100%;
    height: 100%;
    stroke-width: 1.25;
  }
  .instrument-mark {
    width: 100%;
    height: clamp(48px, 40cqmin, 96px);
  }

  /* A rack's face (`chain/RackFace`): its mark and macros, the cell's rest. */
  .cell-face {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    padding: 6px;
  }
  .cell-face > :global(*) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  /* The name keeps its room; the switch takes only what it needs. */
  .name {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color var(--t-standard) var(--ease-settle);
  }
  /* What the device is, under its name, small and quiet; only on a
     one-row chain's full band, which has the line. */
  .caption {
    min-width: 0;
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.01em;
    line-height: 1.2;
    color: var(--fg-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chain-wrap.two-rows .caption,
  .chain-cell.half .caption,
  :global([data-cell-width='narrow']) .cell-head .caption {
    display: none;
  }
  /* A one-row chain's band has room for two lines: a long name wraps
     (hyphenated where the browser can, else broken where it must) rather
     than losing its end. */
  .chain-wrap:not(.two-rows) .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    hyphens: auto;
    overflow-wrap: anywhere;
  }
  /* A one-unit cell (a slider's): a size smaller, broken only between
     words, so "Pedal" stays whole (the user, 2026-11-05). */
  .chain-cell.half .name {
    font-size: 0.8125rem;
    overflow-wrap: normal;
    hyphens: manual;
  }
  .chain-cell.half .cell-head {
    gap: 3px;
    padding-inline: 6px;
  }
  /* A narrow cell leaves the name what the switch does not: a size
     smaller. */
  :global([data-cell-width='narrow']) .cell-head .name {
    font-size: 0.8125rem;
  }
  .chain-wrap.two-rows .name {
    font-size: 0.8125rem;
  }

  /* ---- Flat grammar (the shipped skin). The cells' material above is
     already Live's: flat surfaces, hairlines, the ink in the text and the
     fills. What the tokens cannot say sits here. */
  /* On the light ladder the inks are too pale for text: pull a name
     toward the foreground, hue kept, as the sliders' labels are. */
  /* ---- Ink (ADR-544). A cell is a slab with no drawn edge; its head is
     plain, the device's name in plain ink. The one cell whose view is open
     below (`appointed`) wears the selected track's band, the same band the
     central view's title is: one colour says "this is what you are
     looking at". The family ink (`--cell-ink`) colours nothing here. */
  :global([data-skin='hybrid']) .chain-cell {
    border-color: transparent;
  }
  :global([data-skin='hybrid']) .chain-cell .cell-head {
    background: transparent;
    border-bottom-color: transparent;
  }
  :global([data-skin='hybrid']) .chain-cell .cell-head .name {
    color: var(--foreground);
    font-weight: 700;
  }
  :global([data-skin='hybrid']) .chain-cell.off .name,
  :global([data-skin='hybrid']) .chain-cell.landing .name {
    color: var(--muted-foreground);
  }
  :global([data-skin='hybrid']) .chain-cell.appointed {
    border-color: transparent;
    box-shadow: none;
  }
  :global([data-skin='hybrid']) .chain-cell.appointed .cell-head {
    background: var(--sel-track, var(--secondary));
  }
  :global([data-skin='hybrid']) .chain-cell.appointed .cell-head .name,
  :global([data-skin='hybrid']) .chain-cell.appointed .cell-fold {
    color: var(--sel-track-fg, var(--foreground));
  }
  /* The fold's chevron and hairline are the name's ink on the open band:
     in the track's colour, they vanished into a bar filled with it. */
  :global([data-skin='hybrid']) .chain-cell.appointed .cell-fold {
    border-right-color: color-mix(in oklab, var(--sel-track-fg, var(--foreground)) 35%, transparent);
  }
  /* One frame round a tile's field: the tile's, in its ink; the control's
     own hairline inside it goes. */
  :global([data-grammar='flat']) .cell-control :global(.device-control .xy-container),
  :global([data-grammar='flat']) .cell-control :global(.device-control .slider-container) {
    border-color: transparent;
    border-radius: 3px;
  }

</style>
