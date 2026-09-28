# ADR-089: Hybrid Reverb Central View Enhancement

**Date:** 2025-10-27  
**Status:** Implemented  
**Participants:** System Architecture

## Summary

Enhanced the Hybrid Reverb central view with comprehensive reverb type selection and parameter control, implementing both convolution and algorithmic reverb interfaces with color-coded tabs and dynamic parameter sections.

## Context

### Problem

The Hybrid Reverb central view was a basic placeholder with no controls:
- **Limited functionality**: Only basic XY control in FX Grid
- **No reverb type selection**: Could not switch between convolution/algorithmic modes
- **No parameter access**: Algorithmic reverb parameters not exposed
- **No convolution controls**: IR timing properties not accessible

### Previous Implementation

```typescript
// Minimal placeholder view
<div class="text-center">
  <div class="text-4xl mb-4 opacity-30">〰️</div>
  <p class="text-sm font-medium">REVERB</p>
</div>
```

## Decision

**Implement comprehensive reverb control interface** with dynamic parameter sections and color-coded reverb type selection.

### Architecture Pattern

**Reverb Type Classification:**
- **Convolution Types**: Short, Drum, Spring, Plate, Church (IR-based)
- **Algorithmic Types**: Hall, Quartz, Shimmer, Tides, Prism (DSP-based)

**Control Mapping:**
- **Parameter 48**: Reverb mode (2=Algorithmic, 3=Convolution)
- **Parameter 6**: Algorithmic type selection (0-4)
- **Properties**: IR category/file index for convolution selection

## Implementation

### Backend Configuration Enhancement

#### 1. Extended Parameter Coverage
**Added 15 new parameters** to Hybrid device configuration:

```json
// data/device-configs.json
"Hybrid": {
  "parameters": {
    "6": "Algorithmic Type", "11": "Size", "12": "Damping", "13": "Diffusion",
    "14": "Mod", "15": "Shape", "16": "Bass", "18": "Shimmer", "19": "Pitch",
    "20": "Tide", "21": "Rate", "22": "Wave", "23": "Phase", 
    "25": "Distance", "26": "High", "27": "Low"
  },
  "properties": {
    "ir_category_index": "IR category index",
    "ir_file_index": "IR file index", 
    "ir_size_factor": "IR size factor (0.2-5.0)",
    "ir_attack_time": "IR attack time (0.0-3.0 seconds)",
    "ir_decay_time": "IR decay time (0.02-20.0 seconds)"
  }
}
```

#### 2. DeviceXY Component Enhancement
**Extended interface** with release-only callbacks:

```typescript
interface Props {
  onInteraction?: (x: number, y: number) => void;
  onRelease?: (x: number, y: number) => void; // NEW
}

// handlePointerUp implementation
if (onRelease) {
  onRelease(releaseX, releaseY);
}
```

### Frontend Implementation

#### 3. Color-Coded Interface Design
**Unique color schemes** for each reverb type:

```typescript
const REVERB_COLORS = {
  convolution: {
    0: { primary: '#f97316' }, // Short - Orange  
    1: { primary: '#dc2626' }, // Drum - Red
    2: { primary: '#10b981' }, // Spring - Green
    3: { primary: '#8b5cf6' }, // Plate - Purple
    4: { primary: '#0891b2' }  // Church - Cyan
  },
  algorithmic: {
    0: { primary: '#3b82f6' }, // Hall - Blue
    1: { primary: '#06b6d4' }, // Quartz - Cyan  
    2: { primary: '#a855f7' }, // Shimmer - Purple
    3: { primary: '#14b8a6' }, // Tides - Teal
    4: { primary: '#f59e0b' }  // Prism - Amber
  }
};
```

#### 4. Dynamic Parameter Sections
**Algorithmic type-specific controls:**

- **Hall**: Size, Damping, Mod, Shape, Bass (5 controls)
- **Quartz**: Size, Damping, Mod, Diffusion, Distance (5 controls)
- **Shimmer**: Size, Damping, Mod, Diffusion, Pitch, Shimmer (6 controls)
- **Tides**: Size, Damping, Tide, Rate, Wave, Phase (6 controls)
- **Prism**: Size, Low, High (3 controls)

#### 5. Convolution IR Controls
**Impulse response timing control:**

```typescript
// X-Axis: IR Attack Time (0.0-3.0 seconds)
// Y-Axis: IR Decay Time (0.02-20.0 seconds)
// Updates: Release-only (expensive operations)

onRelease={(x, y) => {
  const attackTime = mapToIRAttackTime(x);
  const decayTime = mapToIRDecayTime(y);
  selectedTrackStore.setProperty(device.id, 'ir_attack_time', attackTime);
  selectedTrackStore.setProperty(device.id, 'ir_decay_time', decayTime);
}}
```

## Consequences

### Performance Benefits ✅

- **Expensive operations** limited to finger release events
- **Smooth interaction** during drag (no property updates)
- **Optimistic updates** for immediate visual feedback
- **Cache-based reading** following established pattern

### User Experience Improvements ✅

- **Visual consistency**: Each reverb type has unique color identity
- **Dynamic interface**: Parameter controls change based on selected type
- **Professional control**: Access to all algorithmic parameters
- **Precise timing control**: Direct IR manipulation for convolution

### Technical Architecture ✅

- **Unified pattern**: Follows Simpler property cache migration architecture
- **Release-only updates**: Proper touch event handling for expensive operations
- **Color coordination**: Tabs and controls share visual identity
- **Extensible design**: Easy to add new reverb types or parameters

## Layout Design

### Two-Column Structure
**Left Column (200px):** 2x5 reverb type tab grid
**Right Column (flex):** Dynamic parameter section

### Responsive Parameter Display
- **Grid layout**: 2 columns for optimal parameter density
- **Vertical sliders**: Touch-friendly DeviceSlider components
- **Color inheritance**: All controls match selected reverb type

### Text Readability Enhancement
- **Smart contrast**: Light colors (Short/Prism) use black text
- **Typography**: Larger fonts (`text-base`) with proper weight
- **Visual hierarchy**: Clear distinction between active/inactive states

## Implementation Notes

### Property Ranges
- **IR Size Factor**: 0.2-5.0 (1.0 at center) - exponential mapping
- **IR Attack Time**: 0.0-3.0 seconds - linear mapping  
- **IR Decay Time**: 0.02-20.0 seconds - linear mapping
- **Rate Parameter**: 0-29 integers (special handling for Tides)

### Reverse Detection Logic
Essential for proper tab highlighting:
```typescript
function isConvolutionTypeActive(index: number): boolean {
  return reverbMode === 3 && 
         CONVOLUTION_TYPES[index].ir_category === irCategoryIndex && 
         CONVOLUTION_TYPES[index].ir_file === irFileIndex;
}
```

## Testing Validation

### Functional Testing ✅
- **Tab switching**: Proper visual feedback and backend sync
- **Parameter controls**: All algorithmic parameters responsive
- **IR timing**: Attack/decay time control working on release
- **Color coordination**: Tabs and controls share color schemes

### Performance Testing ✅
- **Drag responsiveness**: Smooth interaction during manipulation
- **Release handling**: Property updates only on finger lift
- **Memory usage**: No observer overhead (cache-based pattern)

## Future Extensions

This enhancement pattern can be applied to:
- **Other effect devices** requiring mode-specific controls
- **Complex instruments** with multiple operational modes
- **Advanced device interfaces** requiring precise parameter grouping

## References

- **Component**: `interface/src/lib/components/v6/central/views/ReverbCentralView.svelte`
- **Configuration**: `data/device-configs.json` (Hybrid device)
- **Pattern Reference**: ADR-088 (Simpler Property Cache Migration)
- **DeviceXY Enhancement**: Added `onRelease` callback support
- **FX Grid Integration**: `interface/src/lib/components/v6/device-panel/ReverbControl.svelte`