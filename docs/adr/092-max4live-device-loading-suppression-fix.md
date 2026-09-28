# ADR-092: Max4Live Device Loading and Suppression Compatibility Fix

## Status
Accepted

## Context
Max4Live devices (`.amxd` files) were experiencing loading issues when triggered from the browser interface. Investigation revealed multiple problems preventing successful device loading and state updates:

### Problem Analysis
1. **Extension Validation Issue**: `.amxd` files were not included in `validPresetExts`, causing "⚠️ WARNING: Unexpected file extension" messages
2. **Observer Suppression Conflict**: Device loading operations during track selection periods resulted in suppressed device change notifications
3. **Missing State Updates**: Frontend never received device load completion notifications due to suppressed observers

### User Impact
- Max4Live devices would load in Ableton but frontend state wouldn't update
- Users saw persistent "ghost" device states in the interface
- Device controls remained non-functional until manual refresh

## Decision
Implement a **smart suppression management system** for device loading that temporarily clears suppression during load operations while preserving the existing observer suppression architecture.

### Technical Solution

#### 1. Max4Live Extension Support
Add `.amxd` to the valid preset extensions list and provide specific logging:

```javascript
// Valid preset extensions
var validPresetExts = [".adg", ".adv", ".aupreset", ".vstpreset", ".fxp", ".amxd"];

// Max4Live-specific validation
if (extension === ".amxd") {
    log("✓ Loading Max4Live device: " + extension);
}
```

#### 2. Smart Suppression Clearing
Detect active suppression before device loading and temporarily clear it:

```javascript
// Smart suppression handling
var suppressionWasActive = isDeviceSuppressionActive();
var suppressionCount = 0;

if (suppressionWasActive) {
    log("🔧 Device suppression detected before loading - temporarily clearing for device load");
    suppressionCount = deviceSuppressionCount;
    // Clear all suppression
    for (var i = 0; i < suppressionCount; i++) {
        endDeviceSuppression("cleared_for_device_load");
    }
}
```

#### 3. Automatic Suppression Restoration
Restore original suppression state after allowing observer to fire:

```javascript
// Restore suppression after device loads
if (suppressionWasActive) {
    var restoreTask = new Task(function() {
        log("🔧 Restoring device suppression after device load (count: " + suppressionCount + ")");
        for (var j = 0; j < suppressionCount; j++) {
            startDeviceSuppression("restored_after_device_load");
        }
    });
    restoreTask.schedule(150); // Allow observer to fire
}
```

#### 4. Error Handling
Ensure suppression is restored even if device loading fails:

```javascript
} catch (e) {
    // Restore suppression immediately on error
    if (suppressionWasActive) {
        log("🔧 Restoring device suppression after error (count: " + suppressionCount + ")");
        for (var k = 0; k < suppressionCount; k++) {
            startDeviceSuppression("restored_after_error");
        }
    }
    // ... existing error handling
}
```

## Implementation Details

### Modified Files
- **File**: `ableton/scripts/liveAPI-v6.js`
- **Functions Modified**: `loadDevice()` (lines 1713, 1722-1724, 1731-1760, 1845-1852)
- **New Logic**: Smart suppression management with automatic restoration

### Integration with Existing Systems
- **Preserves ADR-091**: Track selection suppression remains intact
- **Compatible with observer architecture**: Uses existing suppression functions
- **Maintains timing**: 150ms window allows natural observer firing

## Consequences

### Positive
- **✅ Max4Live device support**: `.amxd` files load without warnings
- **✅ Immediate state updates**: Frontend receives device notifications instantly
- **✅ Preserved suppression benefits**: Track selection operations remain protected from observer storms
- **✅ Robust error handling**: Suppression restored even on failures
- **✅ Non-intrusive**: No changes to existing suppression logic for other operations

### Negative
- **Minor complexity**: Additional state tracking for suppression management
- **Timing dependency**: 150ms restoration window (though natural observer firing is typically immediate)

### Alternatives Considered

#### 1. Remove Suppression Entirely for Device Loading
- **Rejected**: Could cause observer storms during complex loading operations
- **Risk**: Potential race conditions with multiple device loads

#### 2. Manual State Updates Instead of Observer Reliance  
- **Rejected**: Less reliable than natural observer firing
- **Risk**: Timing issues and potential state inconsistencies

#### 3. Longer Fixed Delays
- **Rejected**: Arbitrary timing less reliable than suppression management
- **Risk**: Either too short (missing notifications) or too long (delayed UI updates)

## Validation

### Success Criteria
- ✅ `.amxd` files load without extension warnings
- ✅ Device observer fires immediately after loading
- ✅ Frontend receives complete device state updates
- ✅ Suppression system remains functional for track operations
- ✅ Error conditions properly restore suppression state

### Test Cases
1. **Max4Live Device Loading**: Load Sequencer.amxd from browser → immediate state update
2. **Suppression During Track Changes**: Switch tracks during device load → suppression properly managed
3. **Error Scenarios**: Invalid device paths → suppression correctly restored
4. **Multiple Device Loads**: Rapid device loading → no suppression leaks

## Related
- **ADR-091**: Device Observer Suppression Reentrancy Fix (preserved and enhanced)
- **ADR-069**: Observer Memory Leak Fixes (complementary observer improvements)
- **ADR-087**: Tap-to-Load Device Functionality (frontend device loading triggers)

## Benefits
This fix enables seamless Max4Live device integration while maintaining the robust observer suppression system. Users can now load `.amxd` devices from the browser with immediate feedback, improving the live performance workflow.

The smart suppression approach ensures compatibility with existing suppression-dependent operations while providing the observer notifications necessary for device loading feedback.

## Date
2025-10-28