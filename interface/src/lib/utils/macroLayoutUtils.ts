/**
 * Macro Layout Utilities
 *
 * Shared logic for building a rack's macro layout from its macro names:
 * one slider per named macro, in rack order. Empty/unnamed macros (`.`,
 * `-`, `Macro N`) are skipped. Used by every rack view.
 */

// Types for dynamic layout
export type SliderControl = {
  type: 'slider';
  macroIndex: number;
  name: string;
};

export type ControlLayout = SliderControl[];

/**
 * Clean parameter names by stripping leading number prefix (e.g., "1 Drive" → "Drive")
 */
export function cleanParameterName(name: string): string {
  const match = name.match(/^\d+\s+(.+)$/);
  return match ? match[1] : name;
}

/**
 * Check if a macro name is "empty" (should be skipped)
 * Empty macros: undefined, null, '.', '-', or default 'Macro N' names
 */
export function isEmptyMacroName(name: string | undefined | null): boolean {
  if (!name) return true;
  if (name === '.' || name === '-') return true;
  if (/^Macro\s*\d+$/i.test(cleanParameterName(name))) return true;
  return false;
}

/**
 * Pattern rack (first macro "Pattern N"): how many pattern buttons to
 * show — N, capped at `slots`. 0 when the name is not a pattern name.
 */
export function patternCountFromName(name: string | undefined | null, slots: number): number {
  const match = name?.match(/^Pattern\s+(\d+)$/i);
  return match ? Math.min(parseInt(match[1], 10), slots) : 0;
}

/**
 * Is `name` a pattern rack's macro-1 name ("Pattern N")? The `slots` cap
 * in {@link patternCountFromName} only affects the *count* it returns,
 * never whether the name matched at all, so this is the same test with
 * no picker size to thread through — just "is this the rack at all".
 *
 * This is also the "does this track hold the metronome rack" test
 * (in practice the Skaka Metronome Rack, which generates its own notes
 * off the transport and so carries no clips of its own): protecting a
 * track by its *position* (track 0, the long-standing "keep the first
 * track clean" policy — ADR-385) breaks the moment that track is grouped
 * or reordered, which is exactly what happened to it. This structural
 * test travels with the rack instead, wherever it ends up. Mirrored in
 * Python at `TrackPrepareComponent._is_metronome_track` — keep both in
 * step if the rack's own macro-1 naming convention ever changes.
 */
export function isPatternRackMacroName(name: string | undefined | null): boolean {
  return patternCountFromName(name, 1) > 0;
}

/**
 * Macro value for pattern slot `index` (0-based). The 0..max range is
 * always cut into `slots` equal steps, however many patterns the rack
 * shows: with 12 slots over 127 that is 0, 11, 21, 32 … 116.
 */
export function patternSlotValue(index: number, slots: number, max: number): number {
  return Math.round((index * max) / slots);
}

/**
 * The pattern button a macro value lights: the nearest slot (the top of
 * the range, past the last slot's value, is still the last slot), or -1
 * when that slot is past the `count` buttons shown (a 4-pattern rack
 * whose macro sits at 127 lights nothing).
 */
export function patternSlotAt(value: number, count: number, slots: number, max: number): number {
  const slot = Math.min(Math.round((value * slots) / max), slots - 1);
  return slot < count ? slot : -1;
}

/**
 * Rows × columns for `count` pattern buttons filling a `width` × `height`
 * area: the row count whose cells come closest to `aspect` (cell width /
 * height), never leaving a whole row empty. Unmeasured (0 × 0) is one row.
 */
export function patternGridShape(
  count: number,
  width: number,
  height: number,
  aspect: number = 1.5
): { rows: number; cols: number } {
  if (count <= 0) return { rows: 0, cols: 0 };
  if (width <= 0 || height <= 0) return { rows: 1, cols: count };
  let best = { rows: 1, cols: count };
  let bestScore = Infinity;
  for (let rows = 1; rows <= count; rows++) {
    const cols = Math.ceil(count / rows);
    if ((rows - 1) * cols >= count) continue;
    const score = Math.abs(Math.log((width / cols) / (height / rows) / aspect));
    if (score < bestScore) {
      best = { rows, cols };
      bestScore = score;
    }
  }
  return best;
}

/**
 * One slider per named macro between `startIndex` and `endIndex`, in rack
 * order.
 *
 * @param names - Array of parameter names (index 0 is typically device on/off, macros start at index 1)
 * @param startIndex - First macro index to consider (1-based, e.g., 1 for all macros, 2 to skip first)
 * @param endIndex - Last macro index to consider (1-based, inclusive)
 */
export function buildMacroLayout(
  names: string[],
  startIndex: number = 1,
  endIndex: number = 16
): ControlLayout {
  const layout: ControlLayout = [];
  for (let idx = startIndex; idx <= endIndex; idx++) {
    const name = names[idx];
    if (isEmptyMacroName(name)) continue;
    layout.push({ type: 'slider', macroIndex: idx, name: cleanParameterName(name) });
  }
  return layout;
}

/** One cell of a macro row: a slider, or an XY pad standing in for two macros. */
export type MacroLayoutItem =
  | { kind: 'slider'; control: SliderControl }
  | { kind: 'xy'; title: string; x: SliderControl; y: SliderControl };

/** Two macros, found by name, that play as one XY pad (X first). */
export type XYPairRule = { title: string; x: RegExp; y: RegExp };

/**
 * Fold macro pairs into XY pads. Each pad sits where the earlier of its two
 * macros was; anything unpaired stays a slider. A rule pairs only when BOTH
 * of its names are present, so a rack that renames or drops one falls back
 * to plain sliders rather than driving the wrong macro.
 */
export function pairMacros(layout: ControlLayout, rules: XYPairRule[]): MacroLayoutItem[] {
  const pads: { title: string; x: SliderControl; y: SliderControl }[] = [];
  for (const rule of rules) {
    const x = layout.find((c) => rule.x.test(c.name));
    const y = layout.find((c) => rule.y.test(c.name));
    if (x && y && x !== y) pads.push({ title: rule.title, x, y });
  }
  return foldPads(layout, pads);
}

const XY_PREFIX = /^xy\s+/i;

/**
 * The rack's own XY convention: a macro whose first word is "XY" pairs with
 * the next one that also starts "XY", in macro order — the first is X, the
 * second Y. The pad is titled by the rest of both names ("XY Cutoff" +
 * "XY Res" → "Cutoff/Res"). A lone XY macro stays a slider under its name.
 */
export function pairXYPrefixedMacros(layout: ControlLayout): MacroLayoutItem[] {
  const tagged = layout.filter((c) => XY_PREFIX.test(c.name));
  const pads: { title: string; x: SliderControl; y: SliderControl }[] = [];
  for (let i = 0; i + 1 < tagged.length; i += 2) {
    const [x, y] = [tagged[i], tagged[i + 1]];
    const title = [x, y].map((c) => c.name.replace(XY_PREFIX, '').trim()).filter(Boolean).join('/');
    pads.push({ title: title || 'XY', x, y });
  }
  return foldPads(layout, pads);
}

function foldPads(
  layout: ControlLayout,
  pads: { title: string; x: SliderControl; y: SliderControl }[]
): MacroLayoutItem[] {
  const at = new Map<number, MacroLayoutItem>();
  const used = new Set<number>();
  for (const pad of pads) {
    at.set(Math.min(pad.x.macroIndex, pad.y.macroIndex), { kind: 'xy', ...pad });
    used.add(pad.x.macroIndex);
    used.add(pad.y.macroIndex);
  }
  const items: MacroLayoutItem[] = [];
  for (const control of layout) {
    const pad = at.get(control.macroIndex);
    if (pad) items.push(pad);
    else if (!used.has(control.macroIndex)) items.push({ kind: 'slider', control });
  }
  return items;
}

/**
 * Macro value that selects state `index` of an `states`-position picker —
 * the Skaka Metronome Picker's five-state `live.tab` on macro 1.
 *
 * The states spread across the WHOLE 0..max: the first sits at 0 and the
 * last at `max`, so the step is `max / (states - 1)`. With 5 states over
 * 127 that is 0, 32, 64, 95, 127.
 *
 * This is deliberately NOT {@link patternSlotValue}'s arithmetic, and the
 * difference is the kind that silently selects the wrong thing. That one
 * divides by the slot count because a chain selector's slots are *zones*
 * — twelve of them tile 0..127 and the twelfth zone's value is never
 * reached. A `live.tab` has no zones: it is an enumerated parameter whose
 * ends are real positions, so the divisor is one less.
 */
export function pickerSlotValue(index: number, states: number, max: number): number {
  if (states <= 1) return 0;
  return Math.round((index * max) / (states - 1));
}

/**
 * The picker state a macro value currently selects — the inverse of
 * {@link pickerSlotValue}, clamped into `0..states-1` so a value past
 * either end reports the nearest real state rather than a position that
 * does not exist.
 */
export function pickerSlotAt(value: number, states: number, max: number): number {
  if (states <= 1) return 0;
  const state = Math.round((value * (states - 1)) / max);
  return state < 0 ? 0 : state > states - 1 ? states - 1 : state;
}
