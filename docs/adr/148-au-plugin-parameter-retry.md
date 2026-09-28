# ADR-148: AU Plugin Parameter Retry Mechanism

## Status
Accepted

## Date
2025-12-30

## Context

When switching instrument types on a track (e.g., Omnisphere → Komplete Kontrol), the `devicesChanged()` callback in Max queries device parameters immediately. AU plugins need time to initialize their parameter interfaces, resulting in `0 parameters` being reported in the initial `complete_state` message.

**Evidence:**
- Switching from Omnisphere to Komplete Kontrol: `0 parameters` received initially
- Loading KK preset on existing KK device: `8 parameters` received correctly
- The existing 500ms delay in `loadDevice()` helps, but `devicesChanged()` fires immediately when the device list changes

### Why This Happens

1. User loads a different instrument type (e.g., .aupreset for Komplete Kontrol)
2. Ableton removes the old device → `devicesChanged()` fires
3. Ableton adds the new AU device → `devicesChanged()` fires again
4. Max immediately queries parameters via LiveAPI
5. AU plugin hasn't finished initializing → reports 0 parameters
6. Client receives incomplete state

## Decision

Implement server-side retry with exponential backoff in `liveAPI-v6.js`.

### Why Server-Side (Not Client-Side)

A client-side approach was initially considered but rejected due to:

1. **Race conditions**: Multiple sources of `complete_state` (observer callback + 500ms checkTask) cause stale retries
2. **Track index staleness**: Browser module-level state can query the wrong track if user switches during retry
3. **Missing cancellation**: No clean way to cancel pending retries when valid state arrives
4. **Multiple clients**: Each browser client would retry independently, creating duplicate queries

Server-side benefits:
- **Single source of truth**: All clients receive the same retried data
- **Natural cancellation**: Max Task API allows clean cancellation when new device changes occur
- **Track isolation**: Closure captures `trackPath`, verified before each retry
- **Visibility**: Retry activity visible in Max console with `🔌` prefix

## Implementation

### Module-Level Variables

```javascript
var auPluginRetryTimer = null;
var auPluginRetryCount = 0;
var AU_PLUGIN_MAX_RETRIES = 3;
var AU_PLUGIN_RETRY_DELAYS = [400, 800, 1600]; // Exponential backoff (ms)
```

### Helper Functions

- `checkAuPluginsNeedRetry(state)` - Returns true if any `AuPluginDevice` has 0 parameters
- `scheduleAuPluginRetry(trackPath)` - Schedules retry Task with captured trackPath
- `cancelAuPluginRetry()` - Cancels pending retry and resets counter

### Modified `devicesChanged()`

```javascript
function devicesChanged(args) {
    if (isDeviceSuppressionActive()) return;

    cancelAuPluginRetry();  // Cancel stale retries

    var state = buildCompleteDeviceState(trackPath);
    if (state) {
        var needsRetry = checkAuPluginsNeedRetry(state);
        sendCompleteDeviceState(state);  // Always send immediately

        if (needsRetry) {
            scheduleAuPluginRetry(trackPath);
        }
    }
}
```

### Retry Timeline

```
t=0ms     devicesChanged fires, AU plugin has 0 params
          → Send partial state, schedule retry #1
t=400ms   Retry #1: rebuild state
          → If still 0 params, schedule retry #2
t=1200ms  Retry #2: rebuild state
          → If still 0 params, schedule retry #3
t=2800ms  Retry #3: rebuild state
          → Give up if still 0 params
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User switches tracks during retry | Verify `trackPath` matches current track before retry |
| New device change during retry | `cancelAuPluginRetry()` cancels pending retry |
| Multiple AU plugins on track | Check ALL AU devices, retry if any have 0 params |
| Plugin never initializes | Cap at 3 retries (~2.8s), then give up gracefully |
| Rapid preset loading | Each device change cancels previous retry |

## Consequences

### Positive
- AU plugin parameters now appear reliably after instrument type switches
- No changes required to client code
- Retry mechanism is self-healing and self-limiting
- Debug logs (`🔌` prefix) make troubleshooting easy

### Negative
- Slight increase in Max console logging (acceptable for debugging)
- Potential for 2-3 extra `complete_state` messages during slow plugin loads

### Neutral
- Existing 500ms delay in `loadDevice()` still helps for preset-only loads
- Both mechanisms complement each other

## Related

- `ableton/scripts/liveAPI-v6.js` - Implementation location
- `documentation/current/au-plugin-retry-fix.md` - Original investigation and design notes
