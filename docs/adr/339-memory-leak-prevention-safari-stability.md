# ADR-339: Memory Leak Prevention for Safari Stability

## Status
**Accepted**

## Context

The looping interface running on iPad Safari was experiencing random crashes and page reloads during extended sessions. Safari on iPad enforces strict memory limits (~512MB vs. Chrome's 1GB+), making it particularly sensitive to unbounded memory growth.

Investigation identified several collections in the codebase that grew without limit over the course of a session:

1. **LiveObjectAPI** (`liveObjectAPI.ts`) — `cache`, `subscriptions`, and `pendingRequests` Maps had no size limits or eviction. The cache had a 100ms TTL on reads but never proactively evicted stale entries.

2. **DeviceParameterStorage** (`deviceParameterStorage.svelte.ts`) — Retained every device parameter ever touched across all tracks. The `cleanupForTrackChange()` method was intentionally empty, so parameters accumulated indefinitely as the user switched tracks.

3. **AllTracksDeviceCache** (`allTracksDeviceCache.svelte.ts`) — Cached full device state for every track the user visited, with no size limit. A session touching 50+ tracks would hold 50 full device snapshots in memory.

4. **WebSocketConnection** (`WebSocketConnection.ts`) — The `recentMessages` debug array used `Array.shift()` to maintain a fixed size, which is O(n) per message and causes array reallocation and GC pressure on every incoming OSC message.

These issues compound: high-frequency OSC traffic (parameter updates, transport state, listener confirmations) continuously feeds all of these systems. Over a 10-20 minute session with active track switching and device browsing, memory grows steadily until Safari terminates the page.

## Decision

Added bounded sizes and LRU eviction to all unbounded collections:

### 1. WebSocketConnection — Circular Buffer
Replaced the `shift()`-based `recentMessages` array with a true circular buffer using an index pointer. The array is pre-allocated at startup and entries are overwritten in place — no array reallocation, no GC pressure.

### 2. LiveObjectAPI — Cache Eviction
- Added periodic cache eviction every 30 seconds, removing entries older than 5 seconds
- Added a hard cap of 500 cache entries with oldest-first eviction when exceeded
- Added on-write eviction trigger when cache hits the limit during `handleOSCMessage`

### 3. DeviceParameterStorage — LRU Pruning
- Added `lastAccess` tracking per device ID
- Capped at 200 cached devices
- When over limit, evicts the least-recently-used half of devices not on the current track
- Updated `clearAll()` and `cleanupDevice()` to also clean access tracking

### 4. AllTracksDeviceCache — LRU Eviction
- Added `lastAccessed` timestamp to `CachedTrackDeviceState`
- Capped at 30 cached tracks
- When over limit, evicts the bottom 25% by access time
- Master track (index -1) is always preserved

All eviction events are logged at DEBUG level for observability.

## Consequences

**Positive:**
- Memory usage plateaus instead of growing indefinitely during long sessions
- Safari crashes should be significantly reduced on iPad
- No behavioral change for typical sessions (limits are generous enough that eviction rarely triggers during normal use)
- Circular buffer eliminates per-message GC pressure from the WebSocket debug tracking
- All evictions are logged for debugging if cache misses increase

**Negative:**
- After eviction, switching back to an evicted track requires re-querying device state from Max (brief loading delay)
- Periodic eviction timer in LiveObjectAPI adds a small background task (30s interval, negligible cost)
- LRU tracking adds a small per-access overhead (timestamp write)

## Tags
`memory`, `safari`, `ipad`, `performance`, `cache`, `stability`
