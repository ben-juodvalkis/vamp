# ADR-090: FX Grid Layout Optimization

**Date:** 2025-01-27  
**Status:** Implemented  
**Participants:** System Architecture

## Summary

Optimized FX Grid layout by repositioning Guitar/Bass sliders to bottom row and moving EQ to top row for improved workflow and visual balance. This change supports the saturator-to-virtual-device migration and enhances the instrument processing section grouping.

## Context

### Previous Layout Issues

**Row 1**: Filter (2-col) | Guitar (1-col) | Bass (1-col) | Tremolo (2-col) | Comb (2-col) | Delay (2-col) | Variation (1-col) | Redux (1-col)

**Row 2**: EQ (2-col) | Pedal (2-col) | Drum (2-col) | Smudge (2-col) | Reverb (2-col) | Compressor (1-col) | Utility (1-col)

### Problems Identified

1. **Workflow Disruption**: Guitar/Bass (instrument processing) separated from Pedal (instrument amplification)
2. **Visual Imbalance**: Row 1 had mixed XY and slider controls creating inconsistent visual rhythm
3. **Logical Grouping**: EQ (frequency shaping) better suited near Filter (frequency manipulation)
4. **Instrument Chain**: Guitar→Bass→Pedal natural signal flow broken across rows

## Decision

**Implement optimized layout** that groups related effects and creates better visual balance.

### New Layout Strategy

**Row 1 (Processing)**: Filter (2-col) | EQ (2-col) | Tremolo (2-col) | Comb (2-col) | Delay (2-col) | Variation (1-col) | Redux (1-col)

**Row 2 (Instruments)**: Guitar (1-col) | Bass (1-col) | Pedal (2-col) | Drum (2-col) | Smudge (2-col) | Reverb (2-col) | Compressor (1-col) | Utility (1-col)

### Layout Benefits

#### 1. Logical Effect Grouping
- **Frequency Processing**: Filter + EQ adjacent (both frequency manipulation)
- **Instrument Chain**: Guitar→Bass→Pedal creates natural signal flow
- **Time Effects**: Tremolo, Delay maintain proximity
- **Single-Param Effects**: Variation, Redux, Compressor, Utility grouped on right

#### 2. Visual Balance
- **Row 1**: Consistent 2-column XY controls with single-param controls on right
- **Row 2**: Instrument processing section flows naturally left-to-right
- **Column Consistency**: Both rows maintain 12-column grid structure

#### 3. Workflow Enhancement
- **Instrument Processing**: All guitar/bass/amp controls on same row
- **Frequency Shaping**: Filter and EQ controls accessible together
- **Effect Categories**: Clear separation between processing (row 1) and instruments (row 2)

## Implementation

### Grid Layout Changes

```svelte
<!-- Row 1: Frequency & Time Processing -->
<div class="col-span-2"><AutoFilterControl device={filterDevice} /></div>
<div class="col-span-2"><EQControl device={eqDevice} /></div>            <!-- MOVED FROM ROW 2 -->
<div class="col-span-2"><AutoPanLegacyControl device={tremoloDevice} /></div>
<div class="col-span-2"><CombControl device={combDevice} /></div>
<div class="col-span-2"><DelayControl device={delayDevice} /></div>
<div class="col-span-1"><VariationControl device={variationDevice} /></div>
<div class="col-span-1"><ReduxControl device={reduxDevice} /></div>

<!-- Row 2: Instrument Processing & Final Effects -->
<div class="col-span-1"><GuitarControl device={guitarDevice} /></div>    <!-- MOVED FROM ROW 1 -->
<div class="col-span-1"><BassControl device={bassDevice} /></div>        <!-- MOVED FROM ROW 1 -->
<div class="col-span-2"><PedalControl device={pedalDevice} /></div>
<div class="col-span-2"><DrumControl device={drumDevice} /></div>
<div class="col-span-2"><SmudgeControl device={smudgeDevice} /></div>
<div class="col-span-2"><ReverbControl device={reverbDevice} /></div>
<div class="col-span-1"><CompressorControl device={compressorDevice} /></div>
<div class="col-span-1"><ArpeggiatorControl device={utilityDevice} /></div>
```

### Component Organization
- **No Component Changes**: All device controls work unchanged
- **Slot Registry**: Unchanged - components reference same slot keys
- **Central Views**: All existing central view integrations maintained

## Consequences

### Positive Benefits ✅

#### User Experience
- **Instrument Workflow**: Guitar→Bass→Pedal creates logical processing chain
- **Frequency Control**: Filter and EQ adjacent for comprehensive frequency shaping
- **Visual Consistency**: Row 1 emphasizes XY controls, Row 2 balances instrument and effect processing
- **Cognitive Load**: Related controls grouped together reduce mental mapping

#### Technical Architecture
- **Zero Breaking Changes**: All existing functionality preserved
- **Component Reusability**: Layout change demonstrates flexible grid system
- **Logical Organization**: Effect categories clearly defined by row position

### Minor Considerations

#### User Adaptation
- **Muscle Memory**: Users familiar with previous layout need brief adjustment period
- **Documentation**: Usage guides may need layout screenshots updated

#### Layout Density
- **Row 2 Capacity**: 8 columns filled vs Row 1's 12 columns (acceptable distribution)
- **Future Expansion**: Row 2 has 4 columns available for additional instrument effects

## Technical Impact

### Performance
- **Zero Impact**: Layout changes don't affect component performance
- **Memory Usage**: No change in component instantiation or reactivity

### Maintainability
- **Component Independence**: Each control remains self-contained
- **Grid Flexibility**: Demonstrates easy repositioning without component modification

## Validation

### Layout Verification ✅
- **Column Math**: Row 1: 2+2+2+2+2+1+1 = 12 ✓
- **Column Math**: Row 2: 1+1+2+2+2+2+1+1 = 12 ✓
- **Visual Balance**: Both rows maintain consistent spacing and proportion

### Functional Testing ✅
- **All Controls**: Maintain existing parameter mapping and central view integration
- **Device Loading**: No changes to device detection or slot management
- **User Interaction**: Touch, parameter control, and visual feedback unchanged

## Future Considerations

### Potential Enhancements
1. **Row Themes**: Consider visual styling to emphasize row categorization
2. **Effect Categories**: Potential for expandable sections based on effect type
3. **Custom Layouts**: User-configurable grid arrangements for different workflows

### Related Improvements
- **Virtual Device Integration**: This layout supports future virtual device expansions
- **Central View Grouping**: Related effects in same row could share central view real estate
- **Touch Optimization**: Row-based layouts may enable gesture-based row selection

## Context Integration

This layout optimization builds upon:
- **ADR-088**: Virtual Device Slots (saturator moved to PedalCentralView)
- **FX Grid Architecture**: 12×2 grid system flexibility
- **Component State Management**: Independent device control architecture

The optimized layout creates a more intuitive and workflow-oriented effect organization while maintaining all existing functionality and performance characteristics.