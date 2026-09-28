# ADR-091: Device Observer Suppression Reentrancy Fix

## Status
Accepted

## Context
The device observer system in `liveAPI-v6.js` was experiencing a critical bug where device changes would be permanently suppressed after track selection. Investigation revealed that the suppression counting system had a leak caused by reentrancy issues in `setupDeviceObserver()`.

### Problem Analysis
During track selection, the following sequence occurred:

1. `selectedTrackChanged()` calls `setupDeviceObserver()`
2. `setupDeviceObserver()` calls `startDeviceSuppression()` → count: 1
3. Observer cleanup triggers `devicesChanged()` callbacks
4. Multiple callbacks trigger additional `setupDeviceObserver()` calls  
5. Second `startDeviceSuppression()` call → count: 2
6. Only one `endDeviceSuppression()` executes → count: 1
7. Suppression permanently stuck at count: 1

This resulted in all subsequent device changes being blocked with the message:
```
Device change SUPPRESSED during setup operation (suppression count: 1)
```

### Root Cause
The `setupDeviceObserver()` function was not protected against reentrancy. During the sensitive observer cleanup phase, old observers would fire `devicesChanged()` callbacks which could trigger new calls to `setupDeviceObserver()`, creating a suppression count leak.

## Decision
Implement a reentrancy guard to prevent multiple simultaneous calls to `setupDeviceObserver()`.

### Implementation
1. **Add reentrancy flag**: `var setupDeviceObserverInProgress = false;`
2. **Guard function entry**: Check flag and return early if already in progress
3. **Use try/finally pattern**: Ensure flag is reset even if errors occur
4. **Add debug logging**: Track when duplicate calls are skipped

```javascript
var setupDeviceObserverInProgress = false;

function setupDeviceObserver() {
    // Prevent reentrancy to avoid suppression count leaks
    if (setupDeviceObserverInProgress) {
        log("🔍 DEBUG: setupDeviceObserver() already in progress, skipping");
        return;
    }
    
    setupDeviceObserverInProgress = true;
    
    try {
        startDeviceSuppression("device_observer_setup");
        // ... existing setup logic ...
    } catch (e) {
        // ... existing error handling ...
    } finally {
        // Always reset reentrancy guard
        setupDeviceObserverInProgress = false;
    }
}
```

## Consequences

### Positive
- **Fixes suppression leak**: Ensures 1:1 ratio of start/end suppression calls
- **Maintains robustness**: `finally` block ensures cleanup even with errors
- **Preserves existing logic**: No changes to suppression timing or async Tasks
- **Adds debugging**: Clear logging when reentrancy is detected
- **Prevents race conditions**: Only one observer setup can run at a time

### Negative
- **Slightly more complex**: Additional state variable and logic
- **Could mask other issues**: Reentrancy might indicate deeper problems
- **Performance impact**: Minimal additional overhead per function call

### Alternatives Considered
1. **Suppression stack balancing**: Track operation names in a stack
   - More complex implementation
   - Doesn't address root cause of reentrancy
   
2. **Remove suppression entirely**: Let all callbacks fire during setup
   - Could cause message storms during track changes
   - Breaks existing suppression architecture

3. **Debouncing setupDeviceObserver()**: Add timer-based delays
   - Creates timing dependencies
   - Less reliable than reentrancy guard

## Validation
The fix ensures that after track selection:
- Suppression count returns to 0 (not stuck at 1)
- Device changes are no longer suppressed
- Observer setup is protected from interference
- Debug logs show when duplicate calls are prevented

## Related
- GitHub Issue #132: Device Loading State Message System Issues
- ADR-049: Complete State Architecture 
- ADR-069: Observer Memory Leak Fixes

## Implementation Details
- **File**: `ableton/scripts/liveAPI-v6.js`
- **Functions Modified**: `setupDeviceObserver()`
- **Global Variables Added**: `setupDeviceObserverInProgress`
- **Debug Logging**: Added reentrancy detection and guard reset messages