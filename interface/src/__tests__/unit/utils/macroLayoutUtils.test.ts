import { describe, it, expect } from 'vitest';
import {
  cleanParameterName,
  isEmptyMacroName,
  buildMacroLayout,
  patternCountFromName,
  isPatternRackMacroName,
  patternSlotValue,
  patternSlotAt,
  patternGridShape,
  pickerSlotValue,
  pickerSlotAt,
  pairMacros,
  pairXYPrefixedMacros,
  type SliderControl
} from '$lib/utils/macroLayoutUtils';

describe('macroLayoutUtils', () => {
  describe('cleanParameterName', () => {
    it('should strip leading number prefix', () => {
      expect(cleanParameterName('1 Drive')).toBe('Drive');
      expect(cleanParameterName('12 Filter Cut')).toBe('Filter Cut');
    });

    it('should return original name if no prefix', () => {
      expect(cleanParameterName('Drive')).toBe('Drive');
      expect(cleanParameterName('Filter Cut')).toBe('Filter Cut');
    });

    it('should handle edge cases', () => {
      expect(cleanParameterName('')).toBe('');
      expect(cleanParameterName('123')).toBe('123'); // Just a number, no space
      expect(cleanParameterName('1  Double Space')).toBe('Double Space'); // Whitespace after number stripped
    });
  });

  describe('isEmptyMacroName', () => {
    it('should return true for null/undefined', () => {
      expect(isEmptyMacroName(null)).toBe(true);
      expect(isEmptyMacroName(undefined)).toBe(true);
    });

    it('should return true for placeholder names', () => {
      expect(isEmptyMacroName('.')).toBe(true);
      expect(isEmptyMacroName('-')).toBe(true);
    });

    it('should return true for default Macro N names', () => {
      expect(isEmptyMacroName('Macro 1')).toBe(true);
      expect(isEmptyMacroName('Macro 16')).toBe(true);
      expect(isEmptyMacroName('Macro1')).toBe(true); // No space variant
      expect(isEmptyMacroName('macro 5')).toBe(true); // Case insensitive
    });

    it('should return true for prefixed Macro N names', () => {
      expect(isEmptyMacroName('1 Macro 1')).toBe(true);
      expect(isEmptyMacroName('8 Macro 8')).toBe(true);
    });

    it('should return false for actual names', () => {
      expect(isEmptyMacroName('Drive')).toBe(false);
      expect(isEmptyMacroName('Filter Cut')).toBe(false);
      expect(isEmptyMacroName('1 Drive')).toBe(false);
      expect(isEmptyMacroName('My Macro')).toBe(false); // Contains "Macro" but has prefix
    });
  });

  describe('buildMacroLayout', () => {
    it('should create sliders for single macros', () => {
      const names = ['Device On', 'Drive', 'Mix', 'Tone'];
      const layout = buildMacroLayout(names, 1, 3);

      expect(layout).toHaveLength(3);
      expect(layout.every(c => c.type === 'slider')).toBe(true);

      const sliders = layout as SliderControl[];
      expect(sliders[0].name).toBe('Drive');
      expect(sliders[0].macroIndex).toBe(1);
      expect(sliders[1].name).toBe('Mix');
      expect(sliders[2].name).toBe('Tone');
    });

    it('should keep macros that share a first word as separate sliders', () => {
      const names = ['Device On', 'Filter Cut', 'Filter Res', 'Drive'];
      const layout = buildMacroLayout(names, 1, 3);

      expect(layout).toEqual([
        { type: 'slider', macroIndex: 1, name: 'Filter Cut' },
        { type: 'slider', macroIndex: 2, name: 'Filter Res' },
        { type: 'slider', macroIndex: 3, name: 'Drive' }
      ]);
    });

    it('should skip empty/unnamed macros', () => {
      const names = ['Device On', 'Drive', '.', 'Macro 3', '-', 'Mix'];
      const layout = buildMacroLayout(names, 1, 5);

      expect(layout).toHaveLength(2);

      const sliders = layout as SliderControl[];
      expect(sliders[0].name).toBe('Drive');
      expect(sliders[0].macroIndex).toBe(1);
      expect(sliders[1].name).toBe('Mix');
      expect(sliders[1].macroIndex).toBe(5);
    });

    it('should respect startIndex and endIndex boundaries', () => {
      const names = ['Device On', 'Macro1', 'Filter Cut', 'Filter Res', 'Drive', 'Tone', 'Mix', 'Depth', 'Amount'];

      // Only look at indices 2-8 (skip macro 1, like GuitarCentralView)
      const layout = buildMacroLayout(names, 2, 8);

      // Should include indices 2-8 only
      const allIndices = layout.map((c) => c.macroIndex);

      expect(allIndices.every(i => i >= 2 && i <= 8)).toBe(true);
      expect(allIndices).not.toContain(1);
    });

    it('should return empty array when no valid macros', () => {
      const names = ['Device On', '.', '-', 'Macro 2', 'Macro 3'];
      const layout = buildMacroLayout(names, 1, 4);

      expect(layout).toHaveLength(0);
    });

    it('should handle number-prefixed names correctly', () => {
      const names = ['Device On', '1 Filter Cut', '2 Filter Res', '3 Drive'];
      const layout = buildMacroLayout(names, 1, 3);

      expect(layout.map((c) => c.name)).toEqual(['Filter Cut', 'Filter Res', 'Drive']);
    });

    it('should handle empty names array', () => {
      const layout = buildMacroLayout([], 1, 8);
      expect(layout).toHaveLength(0);
    });

    it('should handle sparse names array', () => {
      const names: string[] = [];
      names[1] = 'Drive';
      names[5] = 'Mix';

      const layout = buildMacroLayout(names, 1, 8);

      expect(layout).toHaveLength(2);
      expect((layout[0] as SliderControl).macroIndex).toBe(1);
      expect((layout[1] as SliderControl).macroIndex).toBe(5);
    });

  });

  describe('pattern rack slots', () => {
    const SLOTS = 12;
    const MAX = 127;

    it('shows N buttons from "Pattern N", capped at the slot count', () => {
      expect(patternCountFromName('Pattern 4', SLOTS)).toBe(4);
      expect(patternCountFromName('pattern 12', SLOTS)).toBe(12);
      expect(patternCountFromName('Pattern 16', SLOTS)).toBe(12);
      expect(patternCountFromName('Cutoff', SLOTS)).toBe(0);
      expect(patternCountFromName(undefined, SLOTS)).toBe(0);
    });

    it('isPatternRackMacroName is the same test with no picker size to thread through', () => {
      // The structural "is this the metronome track" test
      // (`clipStateStore.svelte.ts`'s `isMetronomeTrackFromV3`, Python's
      // `TrackPrepareComponent._is_metronome_track`) reuses this, not a
      // literal name match on the rack or the track.
      expect(isPatternRackMacroName('Pattern 4')).toBe(true);
      expect(isPatternRackMacroName('pattern 1')).toBe(true);
      expect(isPatternRackMacroName('Cutoff')).toBe(false);
      expect(isPatternRackMacroName(undefined)).toBe(false);
      expect(isPatternRackMacroName(null)).toBe(false);
    });

    it('steps macro 1 by 127/12 whatever the pattern count', () => {
      const values = Array.from({ length: SLOTS }, (_, i) => patternSlotValue(i, SLOTS, MAX));
      expect(values).toEqual([0, 11, 21, 32, 42, 53, 64, 74, 85, 95, 106, 116]);
    });

    it('lights the slot a button sent', () => {
      for (let i = 0; i < SLOTS; i++) {
        expect(patternSlotAt(patternSlotValue(i, SLOTS, MAX), SLOTS, SLOTS, MAX)).toBe(i);
      }
    });

    it('lights the nearest slot for an in-between value', () => {
      expect(patternSlotAt(5, 4, SLOTS, MAX)).toBe(0);
      expect(patternSlotAt(6, 4, SLOTS, MAX)).toBe(1);
    });

    it('lights the last slot for the top of the range', () => {
      expect(patternSlotAt(127, 12, SLOTS, MAX)).toBe(11);
      expect(patternSlotAt(122, 12, SLOTS, MAX)).toBe(11);
    });

    it('lights nothing when the value is past the buttons shown', () => {
      expect(patternSlotAt(42, 4, SLOTS, MAX)).toBe(-1);
      expect(patternSlotAt(127, 4, SLOTS, MAX)).toBe(-1);
      expect(patternSlotAt(32, 4, SLOTS, MAX)).toBe(3);
    });

    it('lays the buttons out to fill the area without an empty row', () => {
      for (let count = 1; count <= SLOTS; count++) {
        for (const [w, h] of [[1000, 330], [500, 330], [200, 600]]) {
          const { rows, cols } = patternGridShape(count, w, h);
          expect(rows * cols).toBeGreaterThanOrEqual(count);
          expect((rows - 1) * cols).toBeLessThan(count);
        }
      }
    });

    it('uses one row across a wide area and one column down a tall one', () => {
      expect(patternGridShape(4, 1000, 330)).toEqual({ rows: 1, cols: 4 });
      expect(patternGridShape(3, 150, 600)).toEqual({ rows: 3, cols: 1 });
    });

  describe('picker states (the metronome picker\'s live.tab on macro 1)', () => {
    const STATES = 5;

    it('spreads the states across the WHOLE range, ends included', () => {
      const values = Array.from({ length: STATES }, (_, i) => pickerSlotValue(i, STATES, MAX));
      expect(values).toEqual([0, 32, 64, 95, 127]);
    });

    it('is not the chain-selector arithmetic — that never reaches the top', () => {
      // The bug this guards: reusing patternSlotValue for a 5-state tab
      // would put the last state at 102, which reads back as state 3.
      expect(pickerSlotValue(STATES - 1, STATES, MAX)).toBe(MAX);
      expect(patternSlotValue(STATES - 1, STATES, MAX)).toBe(102);
      expect(pickerSlotAt(patternSlotValue(STATES - 1, STATES, MAX), STATES, MAX)).toBe(3);
    });

    it('round-trips every state', () => {
      for (let i = 0; i < STATES; i++) {
        expect(pickerSlotAt(pickerSlotValue(i, STATES, MAX), STATES, MAX)).toBe(i);
      }
    });

    it('reads a value between states as the nearer one', () => {
      expect(pickerSlotAt(15, STATES, MAX)).toBe(0);
      expect(pickerSlotAt(17, STATES, MAX)).toBe(1);
      expect(pickerSlotAt(80, STATES, MAX)).toBe(3);
    });

    it('clamps past either end rather than naming a state that is not there', () => {
      expect(pickerSlotAt(-20, STATES, MAX)).toBe(0);
      expect(pickerSlotAt(999, STATES, MAX)).toBe(STATES - 1);
    });

    it('auto is state 0, so the four patterns are states 1-4', () => {
      // What the view's `patternState` relies on: pattern i writes state
      // i+1, and macro 1 at 0 reads back as auto.
      expect(pickerSlotAt(0, STATES, MAX)).toBe(0);
      expect(pickerSlotValue(1, STATES, MAX)).toBe(32);
      expect(pickerSlotValue(4, STATES, MAX)).toBe(127);
    });

    it('degenerates safely for a one-state picker', () => {
      expect(pickerSlotValue(0, 1, MAX)).toBe(0);
      expect(pickerSlotAt(64, 1, MAX)).toBe(0);
    });
  });

    it('stacks rows once one row would make the cells too narrow', () => {
      expect(patternGridShape(8, 500, 330)).toEqual({ rows: 3, cols: 3 });
      expect(patternGridShape(12, 1000, 330)).toEqual({ rows: 2, cols: 6 });
    });

    it('uses one row before the area is measured', () => {
      expect(patternGridShape(4, 0, 0)).toEqual({ rows: 1, cols: 4 });
      expect(patternGridShape(0, 1000, 330)).toEqual({ rows: 0, cols: 0 });
    });
  });

  describe('XY pairing', () => {
    const layoutOf = (names: string[]) => buildMacroLayout(['Device On', ...names], 1, names.length);
    const shape = (items: ReturnType<typeof pairMacros>) =>
      items.map((i) => (i.kind === 'xy' ? `${i.title}:${i.x.macroIndex}x${i.y.macroIndex}` : i.control.name));

    it('pairs XY-prefixed macros in order, titled by the rest of their names', () => {
      const items = pairXYPrefixedMacros(layoutOf(['Attack', 'XY Cutoff', 'Release', 'XY Res']));
      expect(shape(items)).toEqual(['Attack', 'Cutoff/Res:2x4', 'Release']);
    });

    it('makes two pads from four XY macros and leaves a fifth as a slider', () => {
      const items = pairXYPrefixedMacros(layoutOf(['XY A', 'XY B', 'XY C', 'XY D', 'XY E']));
      expect(shape(items)).toEqual(['A/B:1x2', 'C/D:3x4', 'XY E']);
    });

    it('only matches XY as a whole first word', () => {
      const items = pairXYPrefixedMacros(layoutOf(['XYZ', 'Xylo Tone', 'xy Pan', 'Width']));
      expect(shape(items)).toEqual(['XYZ', 'Xylo Tone', 'xy Pan', 'Width']);
    });

    it('pairs by rule only when both names are present', () => {
      const rules = [{ title: 'Tremolo', x: /^tremolo rate$/i, y: /^tremolo amount$/i }];
      expect(shape(pairMacros(layoutOf(['Gain', 'Tremolo Rate', 'Tremolo Amount']), rules))).toEqual([
        'Gain',
        'Tremolo:2x3'
      ]);
      expect(shape(pairMacros(layoutOf(['Gain', 'Tremolo Rate', 'Depth']), rules))).toEqual([
        'Gain',
        'Tremolo Rate',
        'Depth'
      ]);
    });
  });
});
