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
   * the user, 2026-11-11, as a tap on a strip's name mutes it); a drag
   * from the header still reorders.
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
  import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';
  import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
  import { setContext } from 'svelte';
  import CellSize from './chain/CellSize.svelte';
  import MidiWheelsFace from './chain/MidiWheelsFace.svelte';
  import RackFace from './chain/RackFace.svelte';
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
  import RecentEffectButton from './chain/RecentEffectButton.svelte';
  import { fitBlocks, paletteBlocks, paletteColumns, paletteLabel, type PaletteKind } from '$lib/services/effectPalette';
  import { controlFor } from './deviceControls';
  import PermuteStepsFace from './chain/PermuteStepsFace.svelte';
  import OperatorHeadAlgorithm from './chain/OperatorHeadAlgorithm.svelte';
  import InstrumentFace, { FACED_INSTRUMENTS } from './chain/InstrumentFace.svelte';
  import DrumRackFace from './chain/DrumRackFace.svelte';
  import { deviceTypeLabel } from './chain/deviceTypeLabel';
  import { schemeFromInk } from '$lib/config/devicePresets';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
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
  import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
  import { DEVICE_PRESETS, DEVICE_FAMILY_INKS } from '$lib/config/devicePresets';
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
  import { selectedTrackInk } from '$lib/utils/selectedTrackInk';
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
    kind: 'instrument' | 'rack' | 'max' | 'plugin' | 'effect';
    presetKey: string | null;
    tile: string | null;
    ink: string;
    /** The track's Drum Rack, drawn as its Trnsp, and kept first while a pad is scoped. */
    kit: boolean;
  };

  const trackPath = $derived(selectedTrackStore.selectedTrackPath);

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
  const devices = $derived(
    padChain
      ? padChain.map((c) => c.device)
      : visibleDevices([...selectedTrackStore.devicesByPath]).sort((a, b) => indexOf(a.devicePath) - indexOf(b.devicePath))
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
    devices.map((device, i, all) => {
      const nth = all.slice(0, i).filter((d) => d.name === device.name && d.className === device.className).length;
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
      const sig = `${device.className}|${device.name}`;
      return {
        key: `${sig}|${nth}`,
        sig,
        path: device.devicePath,
        device,
        kind,
        presetKey,
        tile: tileOf.get(device.devicePath) ?? null,
        // The instrument and Permute wear the track's color (Permute: the
        // user, 2026-10-26, as the strip's own Permute section does); a
        // pad's chain, the pad's.
        ink: isInstrument || presetKey === 'sequencer' ? (padChain ? (padInk ?? trackColor) : trackColor) : trackInk(family, paint),
        kit: !padChain && isInstrument && device.className === 'DrumGroupDevice'
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
    const all = [...selectedTrackStore.devicesByPath].sort((a, b) => indexOf(a.devicePath) - indexOf(b.devicePath));
    const i = all.findIndex((d) => d.devicePath === padScope.rackPath);
    if (i < 0) return null;
    const device = all[i];
    const nth = all.slice(0, i).filter((d) => d.name === device.name && d.className === device.className).length;
    const sig = `${device.className}|${device.name}`;
    return { key: `${sig}|${nth}`, sig, path: device.devicePath, device, kind: 'instrument', presetKey: null, tile: null, ink: trackColor, kit: true };
  });
  /** How many cells the kit cell puts ahead of the chain's own. */
  const kitLead = $derived(kitCell ? 1 : 0);

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
   * pad or a picture two, the ghost section four. One row holds twelve, the
   * room it had for four devices and the ghost section; past that the chain
   * takes two rows, as even as the cells allow (`chainUnitLayout`). Reads
   * like Live's chain: left to right, then the next row.
   */
  const ROW_UNITS = 12;
  function unitsOf(cell: Cell): number {
    if (cell.kit || isMidiWheels(cell.device)) return 1;
    return cell.presetKey && controlFor(cell.presetKey)?.kind === 'slider' ? 1 : 2;
  }

  function indexOf(path: string): number {
    const m = /\/devices\/(\d+)$/.exec(path);
    return m ? Number(m[1]) : 0;
  }

  const presetKeyFor = (device: DeviceRecord) => effectTypeOf(device);

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

  const drawn = $derived(kitCell ? [kitCell, ...shown] : shown);

  /*
   * The chain has the section's height under the palette bar, one row up to
   * `ROW_UNITS` and two past it (`chainUnitLayout`), and always ends in a +
   * one unit wide, a slider's width (the user, 2026-11-11): `spare`. The
   * cells take the rest of the width, however few there are; on two rows
   * the + is the last cell of the second, half the chain's height.
   */
  const layout = $derived.by(() => {
    const widths = drawn.map(unitsOf);
    const laid = chainUnitLayout(widths, 1, ROW_UNITS);
    const spare = { ...laid.ghost };
    const places = laid.places.map((p) => ({ ...p }));
    // A + wider than a unit gives its room to the cell before it on its row.
    if (spare.span > 1) {
      const last = places.findLast((p) => p.row === spare.row);
      if (last) {
        last.span += spare.span - 1;
        spare.col += spare.span - 1;
        spare.span = 1;
      }
    }
    return { ...laid, places, spare };
  });
  const grid = $derived({ cols: layout.cols, rows: layout.rows });

  /*
   * The palette bar (the user, 2026-11-11; `services/effectPalette`): ghost
   * effects across the top in family blocks, each family's main effects on
   * the first row and its others under them, a seam between blocks. The
   * chain's own + is the way to anything else (the user, 2026-11-11). Which effects depends on the kind of track
   * alone; how many blocks fit on the width, chips at least
   * `PALETTE_TILE_MIN` wide (whole blocks, dropped from the end).
   */
  const PALETTE_TILE_MIN = 60;
  const PALETTE_GAP = 6;
  /** The seam between two family blocks, a column of its own. */
  const PALETTE_SEAM = 4;
  let paletteWidth = $state(0);
  const paletteKind = $derived<PaletteKind>(
    padScope || cells.some((c) => c.kind === 'instrument' && c.device.className === 'DrumGroupDevice')
      ? 'kit'
      : selectedTrackStore.trackType === 'audio'
        ? 'audio'
        : 'instrument'
  );
  /** Two rows of chips while the chain is one row; one once it splits (the user, 2026-11-11). */
  const paletteRows = $derived(grid.rows === 1 ? 2 : 1);
  /** The blocks that fit, each placed: its first column, after the seams before it. */
  const placed = $derived.by(() => {
    const all = paletteBlocks(paletteKind);
    const room = paletteColumns(paletteWidth - all.length * (PALETTE_SEAM + PALETTE_GAP), PALETTE_TILE_MIN, PALETTE_GAP);
    const blocks = paletteWidth > 0 ? fitBlocks(all, room) : all;
    let col = 1;
    const out = blocks.map((block) => {
      const start = col;
      col += block.cols + 1; // its columns, then a seam
      return { block, start };
    });
    const template = blocks.map((b) => `repeat(${b.cols}, minmax(0, 1fr))`).join(` ${PALETTE_SEAM}px `);
    return { blocks: out, template };
  });
  /** A chip's ink: its device's family colour, as the cell it would become wears it. */
  function chipInk(effect: { preset?: string }): string | undefined {
    const preset = effect.preset ? DEVICE_PRESETS[effect.preset] : undefined;
    return preset ? trackInk(preset.color.primary, paint) : undefined;
  }

  /*
   * The ghost Utility (the user, 2026-11-05; ADR-482's column, back from the
   * right sidebar): the ghost section's last column, narrow, the track's
   * meter under a Gain fader, whose first drag adds a Utility to the chain. Shown while
   * the chain holds none, and kept under the finger through the drag that
   * loads one; the loaded Utility is then a cell of the chain.
   */
  const UTILITY_TILE = TILE_COMPONENTS.utility;
  const hasUtility = $derived(cells.some((c) => c.presetKey === 'utility'));
  let utilityHeld = $state(false);
  function holdUtility() {
    utilityHeld = true;
    const release = () => {
      utilityHeld = false;
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  }
  const showGhostUtility = $derived(!!UTILITY_TILE && (!hasUtility || utilityHeld));

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
  // slides to its new place. Measured only when the order changes.
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
  function pressDown(cell: Cell, info: DragInfo) {
    const target = info.event?.target;
    pressInControl = target instanceof Element && target.closest('.cell-control') !== null;
    pressInHead = target instanceof Element && target.closest('.cell-head') !== null;
    if (pressInControl && cell.presetKey) fxChainStore.pick(pickScope, cell.presetKey, cell.device.devicePath);
  }

  /**
   * A tap on a cell's control opens the device too (the user, 2026-10-26:
   * a tap on the Auto Filter's XY did nothing). The XY counts a press as its
   * own tap only under 200 ms and 5 px, which a finger on the iPad often
   * is not; the cell's tap has no time limit and a touch's slop. Every
   * control (the user, 2026-11-10: anywhere on a cell but its header
   * button): Permute's steps toggle and open, the MIDI wheels move and
   * open, a Drum Rack's Trnsp opens the Drum Rack view. (A kit's face was
   * its pads until 2026-11-05, whose tap was the pad's alone.)
   */

  function dragStart(cell: Cell, position: number, info: DragInfo) {
    // A drag on a cell's control is that control's, and it opens the
    // device's view as a tap on the cell does — every control here, not
    // only the grid's tiles, which open their own (2026-10-26).
    if (pressInControl) {
      open(cell, true);
      return;
    }
    if (cell.kind === 'instrument' || !chainEl) return;
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
    const to = clampChainIndex({ from: d.from, to: Math.max(0, positionAt(d, x, y) - kitLead), count: d.base.length, instrument: d.instrument });
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
    return deviceTypeLabel(cell.device.className, cell.device.name);
  }

  /**
   * + Effect: the browser on its Effect segment. Under a pad scope the pad
   * is latched first (user, 2026-10-26): the browser covers the Drum Rack
   * view, a held pad's tile unmounts and its hold ends, and the pick must
   * still land in the pad the chain was showing.
   */
  function addEffect() {
    swallowNextClick();
    if (padScope) drumPadScope.latch(padScope.rackPath, padScope.note);
    browserModeStore.openEffectsBrowser();
  }

  /** `fromControl`: the press landed on the cell's control, not its frame. */
  function open(cell: Cell, fromControl = false) {
    const { device } = cell;
    if (cell.kind === 'instrument') {
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
          <span class="name" lang="en">{cell.device.name}</span>
          {#if caption}<span class="caption">{caption}</span>{/if}
        </span>
        <span class="head-end">
        {#if cell.kind === 'instrument' && glance.instrumentViewType === 'operator'}<OperatorHeadAlgorithm device={cell.device} />{/if}
        </span>
      </div></CellSize>

      {#if cell.kit}
        <!-- A Drum Rack: the kit's Trnsp. -->
        <div class="cell-control" role="presentation"><CellSize>
          <DrumRackFace device={cell.device} color={selectedTrackScheme() ?? schemeFromInk(cell.ink)} />
        </CellSize></div>
      {:else if cell.presetKey === 'sequencer'}
        <!-- Permute: its mute and pitch steps, on this device. -->
        <div class="cell-control" role="presentation"><CellSize><PermuteStepsFace device={cell.device} color={cell.ink} /></CellSize></div>
      {:else if !padScope && cell.kind === 'instrument' && glance.instrumentViewType && FACED_INSTRUMENTS.has(glance.instrumentViewType)}
        <!-- The instrument's signature control, as its view draws it. -->
        <div class="cell-control" role="presentation"><CellSize>
          <InstrumentFace device={cell.device} type={glance.instrumentViewType} color={selectedTrackScheme() ?? schemeFromInk(cell.ink)} />
        </CellSize></div>
      {:else if !padScope && isMidiWheels(cell.device)}
        <!-- The pitch and mod wheels, as the instrument views draw them:
             side by side, stacked only in a narrow cell. -->
        <div class="cell-control" role="presentation"><CellSize><MidiWheelsFace /></CellSize></div>
      {:else if tile}
        <!-- The grid's own tile, on this device. A touch here is the
             control's: it picks this device and never starts a reorder. -->
        <div class="cell-control" role="presentation"><CellSize>
          <tile.Tile device={cell.device} position={tile.position} />
        </CellSize></div>
      {:else if controlFor(cell.presetKey)}
        <!-- No grid tile: the device's control (deviceControls), the one its
             browser preset tiles and its view draw, on this device. -->
        <div class="cell-control" role="presentation"><CellSize>
          <ControlTile type={cell.presetKey as DeviceTypeKey} device={cell.device} />
        </CellSize></div>
      {:else}
      {#snippet mark()}
        {#if cell.kind === 'instrument'}
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
      {@const macros = cell.kind === 'rack' ? macrosOf(cell.device) : []}
      {#if macros.length > 0}
        <!-- A rack: its mark over its named macros, which fill a tall cell. -->
        <div class="cell-face"><CellSize><RackFace {macros}>{@render mark()}</RackFace></CellSize></div>
      {:else}
        <div class="mark" aria-hidden="true">{@render mark()}</div>
      {/if}
      {/if}
{/snippet}

<div class="chain-wrap" style:--palette-h={paletteRows === 2 ? '94px' : '44px'} class:two-rows={grid.rows > 1} class:has-utility={showGhostUtility} class:pad-scoped={padScope !== null} style={padInk ? `--scope-ink: ${padInk}` : undefined}>
<!-- The palette bar: family blocks, a seam between them. Every chip in a
     fixed place; the chain's own + adds anything else. -->
<div
  class="palette"
  bind:clientWidth={paletteWidth}
  style:--palette-rows={paletteRows}
  style:grid-template-columns={placed.template}
  data-debug="chain-palette"
  data-palette-kind={paletteKind}
  role="group"
  aria-label="Effects to add"
>
  {#each placed.blocks as { block, start } (block.family)}
    {#each [block.top, ...(paletteRows === 2 ? [block.bottom] : [])] as row, r (r)}
      {#each Array.from({ length: block.cols }, (_, i) => row[i] ?? null) as fx, i (i)}
        <div class="palette-slot" class:blank={!fx} style:grid-column={start + i} style:grid-row={r + 1} data-family={block.family}>
          {#if fx}<RecentEffectButton recent={fx} compact label={paletteLabel(fx)} ink={chipInk(fx)} />{/if}
        </div>
      {/each}
    {/each}
  {/each}
</div>
<div
  class="chain"
  style:--chain-cols={grid.cols}
  style:--chain-rows={grid.rows}
  data-debug="chain-overview"
  data-chain-scope={padScope?.note}
  bind:this={chainEl}
>
  {#each drawn as cell, position (cell.key)}
    <div
      class="chain-cell"
      class:off={!isOn(cell)}
      class:dragging={drag?.key === cell.key}
      class:appointed={fxChainStore.appointed === cell.device.devicePath}
      aria-current={fxChainStore.appointed === cell.device.devicePath ? 'true' : undefined}
      class:instrument={cell.kind === 'instrument'}
      class:half={layout.places[position]?.span === 1}
      style="--cell-ink: {cell.ink};"
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
          // The header is the device's switch, as a strip's name is its
          // mute; the kit's under a pad scope still leads back to the kit.
          if (pressInHead && isPowered(cell) && !(cell.kit && padScope)) togglePower(cell);
          else open(cell, pressInControl);
        },
        onStart: (info) => dragStart(cell, position - kitLead, info),
        onMove: dragMove,
        onEnd: dragEnd
      }}
    >
      {@render cellBody(cell, position)}
    </div>
  {/each}
  {#if layout.spare.span > 0}
    <!-- The room the cells leave: a +, the browser on Effect. -->
    <button
      type="button"
      class="chain-add chain-spare"
      style:grid-column="{layout.spare.col + 1} / span {layout.spare.span}"
      style:grid-row={layout.spare.row + 1}
      aria-label="Add an effect"
      data-debug="chain-add"
      use:press={{ onPress: addEffect, touchAction: 'none' }}
    >
      <span class="chain-add-plus" aria-hidden="true"><Plus /></span>
    </button>
  {/if}
  {#if padScope}
    <!-- Whose chain this is, as the grid's scope chip says it. -->
    <div class="pad-chip chain-scope-chip" aria-label="Chain of pad {padScope.note}">
      {padTileLabel(padScope.name) || `Pad ${padScope.note}`}
    </div>
  {/if}
</div>
{#if showGhostUtility && UTILITY_TILE}
  <!-- The ghost Utility: all the way on the right, the full height, the
       track's meter under a Gain fader; its first drag adds a Utility. -->
  <div
    class="ghost-utility"
    data-debug="chain-ghost-utility"
    role="presentation"
    onpointerdowncapture={holdUtility}
  >
    <div class="cell-control" role="presentation"><CellSize>
      <UTILITY_TILE.Tile position={UTILITY_TILE.position} />
    </CellSize></div>
  </div>
{/if}
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
    grid-template-rows: var(--palette-h) minmax(0, 1fr);
    gap: 8px;
    min-width: 0;
  }
  /* The ghost Utility: a narrow column all the way on the right, the
     full height (the user, 2026-11-10). */
  .chain-wrap.has-utility {
    grid-template-columns: minmax(0, 1fr) 72px;
  }
  /* The real devices' height, under the bar (the user, 2026-11-11). */
  .chain-wrap > .ghost-utility {
    grid-column: 2;
    grid-row: 2;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .ghost-utility > .cell-control {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    padding: 0;
  }
  .chain-wrap.pad-scoped {
    outline: 2px solid var(--scope-ink, var(--track-ink, var(--phosphor)));
    outline-offset: -2px;
    border-radius: var(--cell-radius);
  }
  .chain {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--chain-cols, 10), minmax(0, 1fr));
    grid-template-rows: repeat(var(--chain-rows, 2), minmax(0, 1fr));
    gap: 8px;
  }
  /* A pad's chain wears the pad's frame and chip, as the scoped grid does
     (FXGrid's .fx-scoped: drawn inside, since the section clips). */
  .chain {
    position: relative;
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
  /* The bar runs to the right edge, over the ghost Utility's column too. */
  .palette {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: repeat(var(--palette-rows, 1), minmax(0, 1fr));
    gap: 6px;
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
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: var(--strip-band-h, 56px);
    /* Across its CellSize: the whole width, the switch in the corner. */
    flex: 1 1 auto;
    padding-inline: 10px 6px;
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
  /* Two rows of cells: half that, so the controls keep their height
     (the user, the same day). */
  .chain-wrap.two-rows .cell-head {
    height: calc(var(--strip-band-h, 56px) / 2);
    padding-inline: 8px 3px;
    gap: 4px;
  }
  .head-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
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
    padding-inline: 8px 4px;
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
  :global(.light[data-skin='hybrid']) .name {
    color: color-mix(in oklab, var(--cell-ink) 55%, var(--foreground));
  }
  /* One frame round a tile's field: the tile's, in its ink; the control's
     own hairline inside it goes. */
  :global([data-grammar='flat']) .cell-control :global(.device-control .xy-container),
  :global([data-grammar='flat']) .cell-control :global(.device-control .slider-container) {
    border-color: transparent;
    border-radius: 3px;
  }
  /* The ghost Utility: the ghosts' dashed line and no fill, not a tile's
     slab (BaseDeviceControl's ghost is a solid-framed module; !important
     because that rule is). */
  :global([data-grammar='flat']) .ghost-utility :global(.device-control.device-ghost) {
    background: transparent !important;
    border: 1px dashed var(--ghost-line) !important;
    border-radius: var(--ghost-radius);
  }

</style>
