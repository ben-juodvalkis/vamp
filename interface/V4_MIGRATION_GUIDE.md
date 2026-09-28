# V4 Migration Guide

## Overview

The V4 migration brings major improvements to the LiveAPI client interface through:
- **Svelte 5 Runes** - Modern reactive patterns with `$state`, `$derived`, and `$effect`
- **Embedded Data Structures** - Complete track/device/clip data in single messages
- **Zero Manual Subscriptions** - All state management through reactive composition
- **Feedback Prevention** - Source tags prevent UI feedback loops

## Quick Start

### 1. Access the V4 Interface

Navigate to `/v4` in your browser to see the fully migrated V4 interface running alongside the legacy version.

### 2. Key Architectural Changes

#### Before (Legacy)
```svelte
<script>
  import { onMount } from 'svelte';
  import { trackInventory, selectedTrack } from '$lib/stores/live';

  let tracks = [];
  let selected = -1;

  onMount(() => {
    const unsubTracks = trackInventory.subscribe(t => tracks = t);
    const unsubSelected = selectedTrack.subscribe(s => selected = s);

    return () => {
      unsubTracks();
      unsubSelected();
    };
  });
</script>
```

#### After (V4)
```svelte
<script>
  import { createV4SessionView } from '$lib/stores/v4StateComposition.svelte';

  const session = createV4SessionView();

  // Reactive properties - no manual subscriptions!
  let tracks = $derived(session.tracks);
  let selectedTrackIndex = $derived(session.selectedTrackIndex);
</script>
```

## Component Migration Patterns

### 1. Eliminate Manual Subscriptions

**Pattern:** Replace all `onMount` + `subscribe` patterns with `$derived` runes.

```svelte
// ❌ OLD - Manual subscription
let deviceReady = false;
onMount(() => {
  const unsub = deviceLoadingStates.subscribe(states => {
    deviceReady = isDeviceReady(trackIndex, deviceIndex, states);
  });
  return unsub;
});

// ✅ NEW - Reactive composition
const deviceState = createV4DeviceState(trackId, deviceIndex);
let isReady = $derived(deviceState.isLoaded);
```

### 2. Use State Composition

**Pattern:** Create composed state instead of combining multiple stores.

```svelte
// ❌ OLD - Multiple store subscriptions
import { trackInventory, deviceInventory, parameterValues } from '$lib/stores/live';

// ✅ NEW - Single composed state
const trackState = createV4TrackState(trackId);
// Access everything through trackState
let devices = $derived(trackState.devices);
let volume = $derived(trackState.volume);
```

### 3. Simplify Props

**Pattern:** Pass IDs instead of full objects, let components fetch their own data.

```svelte
// ❌ OLD - Prop drilling
<ClipGrooveControls
  trackIndex={selectedTrack}
  timingAmount={groove?.timing || 0}
  quantizationAmount={groove?.quantization || 0}
  hasGroove={!!groove}
  grooveName={groove?.name}
/>

// ✅ NEW - ID-based with composition
<ClipGrooveControlsV4
  trackId={track.id}
  clipSlotIndex={clip.slotIndex}
/>
```

## V4 Composition Functions

### `createV4SessionView()`
Complete session overview with all tracks, scenes, and selection state.

```svelte
const session = createV4SessionView();

// Access everything reactively
let tempo = $derived(session.tempo);
let isPlaying = $derived(session.isPlaying);
let tracks = $derived(session.tracks);
let selectedTrack = $derived(session.selectedTrack);
```

### `createV4TrackState(trackId)`
Complete track state with embedded devices and clips.

```svelte
const trackState = createV4TrackState(trackId);

let devices = $derived(trackState.devices);
let volume = $derived(trackState.volume);
let isMuted = $derived(trackState.isMuted);
```

### `createV4DeviceState(trackId, deviceIndex)`
Device state with all parameters.

```svelte
const deviceState = createV4DeviceState(trackId, deviceIndex);

let parameters = $derived(deviceState.parameters);
let hasCustomUI = $derived(deviceState.hasCustomUI);
```

### `createV4ClipState(trackId, slotIndex)`
Clip state with properties and groove.

```svelte
const clipState = createV4ClipState(trackId, slotIndex);

let isPlaying = $derived(clipState.isPlaying);
let loopStart = $derived(clipState.loopStart);
let hasGroove = $derived(clipState.hasGroove);
```

## Feedback Prevention

V4 implements source tags to prevent feedback loops during bidirectional control:

```typescript
// Command execution with suppression
liveClientV4.setParameter(deviceIndex, paramIndex, value);
// 1. Adds suppression key
// 2. Sends optimistic update with 'optimistic' tag
// 3. Sends command to Live
// 4. Ignores Live callback for 1000ms

// Messages include source tags
{
  address: '/parameter/value',
  args: [trackId, deviceIndex, paramIndex, value, paramName, deviceName, source],
  source: 'live' | 'optimistic' | 'ui'
}
```

## Performance Benefits

### Before (Legacy)
- Multiple API calls for track → devices → parameters
- Manual subscription management with memory leaks
- Race conditions during device loading
- Complex prop drilling through component tree

### After (V4)
- Single message with embedded data
- Automatic subscription cleanup with `$effect`
- Atomic updates prevent race conditions
- Direct data access through composition

## Migration Checklist

- [ ] Replace manual subscriptions with `$derived` runes
- [ ] Convert `$:` reactive statements to `$derived` or `$derived.by()`
- [ ] Use V4 state composition functions
- [ ] Update imports to use V4 components
- [ ] Test feedback prevention with parameter changes
- [ ] Verify embedded data is being used (check network tab)
- [ ] Remove unnecessary prop drilling
- [ ] Update WebSocket client to V4 version

## Testing

1. **Start the V4 interface:**
   ```bash
   npm run dev
   # Navigate to http://localhost:3000/v4
   ```

2. **Verify embedded data:**
   - Open browser DevTools
   - Check WebSocket messages
   - Look for `/v4/` prefixed messages with embedded data

3. **Test feedback prevention:**
   - Adjust a parameter slider
   - Verify no oscillation occurs
   - Check for 'optimistic' tagged messages

## Troubleshooting

### Components not updating
- Ensure you're using `$derived` not plain variables
- Check that composition functions are called at component root
- Verify WebSocket connection is established

### Feedback loops
- Check source tag filtering is enabled
- Verify suppression keys are correct format
- Ensure suppression window is adequate (default 1000ms)

### Missing data
- Verify V4 messages are being sent from backend
- Check that embedded data parsing is correct
- Ensure track IDs match between frontend and backend

## Resources

- **V4 Components:** `/lib/components/v4/`
- **V4 Stores:** `/lib/stores/v4/`
- **V4 Route:** `/routes/v4/+page.svelte`
- **API Documentation:** `/documentation/API-v4.md`