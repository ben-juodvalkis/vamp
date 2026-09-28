# ADR-143: WebSocket Port 8080 Avoidance

**Status:** Accepted
**Date:** 2025-12-05
**Context:** macOS WebSocket frame corruption on port 8080
**Related:** ADR-037 (Project Constants File)

---

## Summary

Changed WebSocket server port from 8080 to 8081 to avoid RSV1 protocol errors caused by system-level interference on port 8080 on macOS.

---

## Context

WebSocket connections between the SvelteKit interface and the enhanced-osc-bridge were failing with RSV1 protocol errors:

```
RangeError: Invalid WebSocket frame: RSV1 must be clear
Error code: WS_ERR_UNEXPECTED_RSV_1
WebSocket close code: 1002 (protocol error)
```

The RSV1 bit in a WebSocket frame normally indicates per-message compression is in use. However, compression was explicitly disabled on both server and client, yet frames were arriving with RSV1=1.

### Investigation Timeline

1. **Initial hypothesis**: ws library version mismatch between root and bridge `node_modules`
   - Synchronized versions to ws@8.16.0 → Still failing

2. **Second hypothesis**: Node.js v24.7.0 compatibility issue
   - Tested Node.js v20.19.0, v22.12.0, v24.7.0 → All failed the same way

3. **Third hypothesis**: ws client library bug
   - Tested with faye-websocket server → Same error, confirmed client isn't the issue

4. **Fourth hypothesis**: Server configuration issue
   - Switched from standalone WS server to HTTP+WS server → Still failing

5. **Critical discovery**: Raw socket data inspection revealed HTTP request data appearing in WebSocket frames
   - The ws receiver was seeing `0x47 0x45` ("GE" from "GET / HTTP/1.1")
   - Something was injecting HTTP data into the WebSocket connection

6. **Final discovery**: Port-specific testing
   - Same code works perfectly on ports 8081, 8082, 8083, 8084, 8086, 8087
   - Same code fails consistently on port 8080

---

## Decision

**Change the WebSocket server port from 8080 to 8081.**

Additionally, bind to `0.0.0.0` (IPv4 only) instead of `::` (IPv6 dual-stack) to avoid additional complications with dual-stack mode on macOS.

### Configuration Changes

**config/constants.json:**
```json
"webSocket": {
  "port": 8081,
  "host": "0.0.0.0",
  "description": "WebSocket server for interface communication. NOTE: Port 8080 causes RSV1 protocol errors due to system-level interference (see websocket-rsv1-issue.md)"
}
```

**interface/bridge/enhanced-osc-bridge.js:**
```javascript
const wsHost = '0.0.0.0';  // IPv4 only (was '::' for dual-stack)
```

**interface/src/lib/api/simpleClient.ts:**
```typescript
const constants = {
  osc: {
    webSocket: { port: 8081 },  // Was 8080
    // ...
  }
};
```

---

## Root Cause Analysis

Port 8080 has system-level interference on macOS that corrupts WebSocket frames. Possible causes:

1. **Application Firewall** - macOS may inspect or modify traffic on common proxy ports
2. **System proxy settings** - Some macOS configurations route port 8080 through a proxy
3. **Installed software** - Development tools often use 8080 as a default proxy port
4. **TCP traffic shaping** - macOS may apply different handling to well-known ports

The exact cause was not determined, but the symptom (frame corruption with RSV1 bit incorrectly set) is consistent with traffic interception that doesn't properly handle WebSocket's binary framing protocol.

---

## Alternatives Considered

### 1. Downgrade Node.js to LTS
**Rejected:** Testing showed the issue occurs on Node.js v20, v22, and v24 identically.

### 2. Use a different WebSocket library
**Rejected:** The issue is port-specific, not library-specific. Both ws and faye-websocket servers show the same error.

### 3. Investigate and disable macOS interference
**Rejected:** This would require system configuration changes that aren't portable across machines and may have security implications.

### 4. Implement HTTP long polling fallback
**Rejected:** Overengineered solution when simply changing ports works.

### 5. Use a high port number (e.g., 19080)
**Considered but not chosen:** Port 8081 is close to 8080 (easy to remember), still in the user port range, and tests confirmed it works.

---

## Consequences

### Positive

- WebSocket connections work reliably
- No code changes to ws library usage
- No Node.js version constraints
- Simple, portable fix that works across machines
- Documents the issue for future debugging

### Negative

- Port 8081 may conflict with other services (rare)
- Existing documentation/bookmarks pointing to port 8080 need updating
- Users with custom configurations need to update their port settings

### Neutral

- IPv4-only binding may prevent IPv6 connections (acceptable for local development)

---

## Implementation

### Files Modified

1. **config/constants.json** - Changed `osc.webSocket.port` from 8080 to 8081
2. **interface/src/lib/api/simpleClient.ts** - Updated hardcoded port to 8081
3. **interface/bridge/enhanced-osc-bridge.js** - Host changed to `0.0.0.0`

### Verification

```bash
npm run ipad
# Bridge starts on port 8081
# WebSocket connections work without RSV1 errors
```

---

## Documentation

Full investigation report with raw socket traces and systematic test results:
- `documentation/current/websocket-rsv1-issue.md`

---

## Lessons Learned

1. **Port 8080 is a "special" port** - Many tools assume ownership of this port (proxy servers, dev tools, system services)

2. **Port-specific issues are rare but real** - When all code paths work correctly, consider environmental factors

3. **Systematic isolation testing works** - By creating minimal test servers and adding features incrementally, we isolated the variable (port number)

4. **macOS can interfere with network traffic** - Even without explicit configuration, certain ports may receive special handling

5. **Document unusual issues thoroughly** - The next developer hitting this will thank you

---

## Test Scripts Created

For future debugging of similar issues:

- `scripts/test-ws-minimal-server.js` - Minimal standalone WebSocket server
- `scripts/test-ws-minimal-client.js` - Minimal WebSocket client with diagnostics
- `scripts/test-ws-bridge-clone.js` - Bridge logic clone for isolation testing
- `scripts/test-ws-bridge-with-all-udp.js` - Full bridge clone with UDP ports

---

**Last Updated:** 2025-12-05
**Owner:** Infrastructure
