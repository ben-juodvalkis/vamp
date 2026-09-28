# ADR-102: OSC Bridge Error Handling Robustness

**Date**: 2024-11-03  
**Status**: Accepted  
**Context**: OSC Bridge Stability Enhancement  

## Problem

The OSC bridge was experiencing crashes due to malformed OSC data causing `RangeError: Offset is outside the bounds of the DataView` errors. This occurred when the OSC parsing library received corrupted or incomplete UDP packets, causing the entire bridge to crash and interrupting live performance workflows.

### Symptoms Observed
- Bridge crashes with `RangeError: Offset is outside the bounds of the DataView`
- Error originated in `osc.readPrimitive()` → `osc.readInt32()` → `osc.readArgument()` chain
- Complete system failure requiring restart during live sessions
- Loss of communication between interface and Ableton Live

## Decision

Implement comprehensive error handling at multiple levels to provide "extra headroom" for malformed OSC data:

### 1. Message-Level Error Handling
- Wrap all OSC message processing in try-catch blocks
- Continue bridge operation even when individual messages fail
- Log errors for debugging without crashing

### 2. UDP Port-Level Error Handling  
- Add error handlers to all UDP ports (AbletonOSC, Max4Live, Omnisphere, etc.)
- Detect OSC parsing errors specifically (DataView, offset boundary issues)
- Gracefully ignore malformed packets while maintaining connection status

### 3. Error Classification
- Distinguish between parsing errors (non-fatal) and connection errors (potentially fatal)
- Preserve connection status for parsing errors
- Continue normal operation for subsequent valid messages

## Implementation

### Enhanced Error Handling Pattern
```javascript
// Message-level protection
someOSCPort.on("message", (oscMessage) => {
    try {
        // Process message normally
        processIncomingMessage(oscMessage, 'source');
    } catch (error) {
        console.error('❌ Error processing message:', error);
        console.error('Raw message data:', oscMessage);
        // Continue operation - don't crash bridge
    }
});

// Port-level protection
someOSCPort.on("error", (error) => {
    console.error(`❌ UDP error: ${error.toString()}`);
    
    // Check if it's an OSC parsing error
    if (error.message && (error.message.includes('DataView') || 
                         error.message.includes('Offset is outside'))) {
        console.warn('⚠️ Malformed OSC data received - ignoring packet and continuing');
        return; // Don't change connection status
    }
    
    connectionStatus.source = 'error';
});
```

### Applied to All UDP Ports
- **AbletonOSC Port** (11001/11000) - Primary V6 communication
- **Max4Live Port** (9001/9002) - Legacy V5 fallback  
- **Max Observer Port** (11003/11002) - Track change notifications
- **Omnisphere Port** (7401/7400) - Preset server communication
- **Native Instruments Port** (7501/7500) - NI server communication
- **MIDI Converter Port** (11005/11004) - Pitch/mod wheel handling
- **Shell Helper Port** (11007/11006) - Audio clipboard automation

## Benefits

### 1. System Resilience
- Bridge continues operating through network issues
- No more complete system failures from malformed packets
- Maintains communication with valid OSC sources

### 2. Live Performance Reliability
- Eliminates crashes during live sessions
- Provides continuous operation even with network interference
- Maintains audio control continuity

### 3. Debugging Capability
- Detailed error logging for malformed packets
- Preserves raw message data for analysis
- Distinguishes between different error types

### 4. Graceful Degradation
- Individual message failures don't affect system stability
- Connection status preserved for parsing errors
- Automatic recovery when valid messages resume

## Alternatives Considered

### 1. UDP Packet Validation
- **Rejected**: Would require deep OSC protocol knowledge
- **Reason**: OSC library already handles validation; issue is error handling

### 2. Message Queue with Retry Logic
- **Rejected**: Adds complexity and latency
- **Reason**: Real-time audio requires immediate processing

### 3. Separate Process Isolation
- **Rejected**: Over-engineering for this specific issue
- **Reason**: Error handling solution is simpler and more direct

## Testing Results

- ✅ Bridge starts successfully with `npm run ipad`
- ✅ All UDP ports initialize without errors
- ✅ Meter data flows correctly through system
- ✅ No crashes observed during message processing
- ✅ Error handling logs appear for test malformed packets
- ✅ System continues operation after error conditions

## Future Considerations

### Monitoring Improvements
- Add metrics for malformed packet frequency
- Monitor error patterns for network diagnosis
- Consider alerting for excessive error rates

### Network Resilience
- Could extend to other network communication layers
- Apply similar patterns to WebSocket connections
- Consider heartbeat validation enhancements

## References

- **Issue Context**: OSC Bridge crashes during live sessions
- **Root Cause**: Malformed OSC data causing DataView boundary errors
- **Files Modified**: `interface/bridge/enhanced-osc-bridge.js`
- **Testing**: Verified with `npm run ipad` startup and message flow

---

**Tags**: `reliability`, `error-handling`, `osc-bridge`, `live-performance`, `network-resilience`