#ADR-072: Vendor State Persistence for Gesture Browser

## Status
Accepted

## Date
2025-10-21

## Context

The gesture browser previously reset navigation state when users closed and reopened vendor browsers (Ableton, Omnisphere, NI, Audio). This created a poor user experience where users lost their position in folder hierarchies when switching between vendors or toggling the browser closed/open.

### Problem
- Tapping a vendor button to close browser, then tapping again to reopen would start from root folder
- No memory of previous navigation state across vendor switches  
- Each vendor shared global state, so switching vendors lost the previous vendor's navigation position

### User Workflow Impact
1. User taps Ableton → navigates to Drums/Hip Hop/Trap
2. User taps Ableton again to close browser
3. User taps Ableton to reopen → **starts at root instead of Drums/Hip Hop/Trap**
4. User has to re-navigate through folders repeatedly

## Decision

Implement per-vendor state persistence in the gesture browser to maintain independent navigation state for each vendor.

### Architecture

**Replace Global State with Vendor State Map:**
```typescript
// Before: Global state
let currentPath = $state<string[]>([]);
let columns = $state<Array<{ folders: string[]; presets: Preset[] }>>([]);
let adapter = $state<any>(null);

// After: Per-vendor state map
type VendorState = {
  currentPath: string[];
  columns: Array<{ folders: string[]; presets: Preset[] }>;
  adapter: any;
  lastPath: string;
};

let vendorStates = $state<Record<string, VendorState>>({
  'ableton': { currentPath: [], columns: [], adapter: null, lastPath: '' },
  'omnisphere': { currentPath: [], columns: [], adapter: null, lastPath: '' },
  'ni': { currentPath: [], columns: [], adapter: null, lastPath: '' },
  'audio': { currentPath: [], columns: [], adapter: null, lastPath: '' }
});
```

**Derived State Management:**
```typescript
let selectedVendor = $derived(selectedVendorId ? vendors.find(v => v.id === selectedVendorId)?.vendorId || null : null);
let currentVendorState = $derived(selectedVendor ? vendorStates[selectedVendor] : null);
let adapter = $derived(currentVendorState?.adapter || null);
let currentPath = $derived(currentVendorState?.currentPath || []);
let columns = $derived(currentVendorState?.columns || []);
```

### Key Changes

1. **Vendor State Isolation**: Each vendor maintains its own navigation state independently
2. **Preserve on Close**: Tap-to-close now calls `closeButPreserveState()` instead of full reset
3. **State Restoration**: Opening a vendor restores its previous navigation state if available
4. **Cross-Vendor Memory**: Users can switch between vendors and return to where they left off

## Consequences

### Positive
- **Enhanced UX**: Users maintain context when closing/reopening browsers
- **Cross-Vendor Navigation**: Each vendor remembers its own state independently  
- **Reduced Re-navigation**: No need to repeatedly navigate through folder hierarchies
- **Backward Compatibility**: All existing functionality preserved

### Considerations
- **Memory Usage**: Vendor states persist in memory throughout session
- **State Complexity**: More complex state management with vendor-specific logic
- **Template Compatibility**: Uses Svelte 5 derived state to maintain template compatibility

### Migration Impact
- **No Breaking Changes**: Existing gesture/persistent mode behavior unchanged
- **Template Updates**: No template changes needed due to derived state approach
- **Function Updates**: Navigation functions updated to work with vendor-specific state

## Alternatives Considered

1. **Global State with History Stack**: Rejected due to complexity and memory overhead
2. **LocalStorage Persistence**: Rejected as session-only persistence was sufficient  
3. **Separate Browser Components**: Rejected due to code duplication and complexity

## Implementation Notes

- Uses Svelte 5 runes (`$state`, `$derived`) for reactive state management
- Maintains compatibility with existing template structure through derived state
- Vendor state initialization happens lazily when vendor is first accessed
- Reset functionality (`closeAndReset`) clears all vendor states when needed

## Verification

The implementation successfully addresses the user workflow:
1. User taps Ableton → navigates to Drums/Hip Hop/Trap
2. User taps Omni → navigates to Synths/Leads  
3. User taps Ableton → **reopens to Drums/Hip Hop/Trap** ✅
4. Each vendor maintains independent navigation memory ✅