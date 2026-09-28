# ADR-386: Broadcast Batching for Surf→UI WebSocket Frames

## Status
**Accepted**

## Context

The bridge fans out one WebSocket frame per OSC message per connected client.
On a steady 30 Hz meter pulse across 8 tracks + master, plus parameter echoes
during a sweep, that lands ~10 individual frames in each ~33 ms window per
client. Each frame costs a `JSON.stringify` and a `client.send` call.

The pattern was reviewed against Zack Steinkamp's "Knobbler OSC Diet" writeup
(2026-05-26), which lays out five chained optimizations on top of a naive
"one message per packet" baseline: (1) baseline, (2) per-address coalescing,
(3) batching, (4) chunking with checksum, (5) columnar encoding.

Audit of Looping against those five:

| # | Knobbler technique | Looping status |
|---|--------------------|----------------|
| 1 | Baseline | Default everywhere — `broadcastToClients` is one-frame-per-message |
| 2 | Per-address coalescing | Already at the producers: 60 Hz rAF in `sliderThrottle.ts`, 30 Hz monotonic in `MetersComponent.py` |
| 3 | Batching | **Missing** |
| 4 | Chunking + checksum | Already in `state/full/{begin,chunk,end}` and `clip/notes/rich/{begin,chunk,end}` with FNV-1a int31 |
| 5 | Columnar | N/A — `state/full`'s tag-prefixed positional records (T/D/P/S/C) sidestep key repetition by construction |

Batching was the one unaddressed slot. The two real costs it targets:

- **Per-frame WS overhead** — separate kernel sends, separate TCP segment
  framing, separate `onmessage` ticks on the client side.
- **Redundant `JSON.stringify` per client** — for N clients × M messages, the
  current path runs N × M serializations of independent message objects.

No existing Looping coalesce solves this. The producer-side throttles
(meters, sliders) limit the per-source rate but don't collapse multiple
distinct messages that arrive at the bridge inside one window.

## Decision

Introduce a 10 ms broadcast batcher inside `broadcastToClients`'s caller
path. Multi-item windows ship as one `/bridge/batch` envelope per client;
single-item windows pass through raw. Surf→UI direction only.

### Wire shape

```json
{
  "address": "/bridge/batch",
  "messages": [
    { "address": "/looping/v3/track/meter", "args": ["tracks/0", 0.5, 0.3], "source": "pythonSurface", "timestamp": ... },
    { "address": "/looping/v3/track/meter", "args": ["tracks/1", 0.4, 0.4], "source": "pythonSurface", "timestamp": ... }
  ],
  "source": "bridge"
}
```

Inner messages are full OSC-shaped frames (`address`, `args`, `source`,
`timestamp`). The client's `WebSocketConnection.ts` checks for the
`/bridge/batch` address, iterates `messages`, and re-dispatches each inner
message through the shared `dispatchInbound` helper. **Downstream handlers
never learn the frame arrived batched.** Documented in
`wire-protocol.md §2.13`.

### Single-item passthrough (Knobbler v59's tweak)

When a window contains exactly one message, ship the raw message with no
envelope. The latency floor is identical (one window's wait); the bytes and
parse cost drop to the unbatched baseline. The Knobbler changelog calls this
out explicitly: "v59 (2026-05-09) — sending single-item batches as raw OSC
messages, skipping the /batch wrapper overhead."

### Direction policy

- **Surf→UI:** broadcast batcher in the path.
- **UI→Surf:** never. `routeMessageToUDP` is unchanged. Adding window
  latency to a `param/set` would regress click responsiveness — we already
  optimized for instant tactile feedback (see ADR-376).
- **Bridge-internal one-offs:** `/observer/status` (one-time on connect),
  `/bridge/ping` (5 s heartbeat), `/looping/v3/bridge/heartbeat` (1 s) all
  route through the batcher. 10 ms of jitter on these is invisible — the
  health monitor's threshold is 3 s for tick-stall and 12 s for WS silence.

### No capability negotiation

The bridge and the SvelteKit interface ship together as one app; there's no
third-party client to worry about. Both sides know `/bridge/batch` exists
at the same commit. A capability handshake (Knobbler's `/syn`/`/ping`
extension flags) would be dead weight here. If a third client ever appears,
add a capability flag to `surface/hello` then — additive on the wire.

### Killswitch

`BRIDGE_BATCH_WINDOW_MS=0` disables batching entirely (synchronous
passthrough — every enqueue calls send directly). Matches the
`BRIDGE_PROFILE=1` precedent: env-var on the hot path, no constants.json
churn. Use it during diagnosis if a regression seems batch-shaped.

### Lifecycle

The batcher's setTimeout is `unref`'d so it doesn't keep the event loop
alive. SIGINT and SIGTERM handlers both call `broadcastBatcher.flush()`
before closing the WS server so the last window's frames reach the wire
during a `concurrently --restart-tries` cycle.

### Why not coalesce per address inside the batcher too

The producers already throttle at source (meters at 30 Hz, sliders at
60 Hz rAF). Adding a second per-address coalesce in the batcher would be
redundant double-throttling that hides bugs (a chatty listener should be
fixed at its listener, not hidden behind a bridge filter). The batcher
intentionally only does temporal batching — order-preserving FIFO into
the envelope, no dedup.

## Testing Scheme

Four layers of verification, each catching a different class of regression:

### 1. Unit tests with fake timers (`broadcastBatcher.test.ts`)

Vitest with `vi.useFakeTimers()` controls the 10 ms window deterministically.
Six assertions:

- single-item window ships raw, no envelope
- multi-item window ships `/bridge/batch` envelope, FIFO order
- fresh window opens after each flush
- `flush()` drains pending and cancels the pending timer
- `flush()` on empty queue is a no-op
- `windowMs=0` disables batching (synchronous passthrough)

Lives alongside the existing `scopePartition.test.ts` and
`messageRouterPrefix.test.ts` bridge tests and runs as part of `npm run
test:run`. Total bridge test count: 110 across 3 files.

### 2. Bridge boot smoke

Confirms wiring is correct end-to-end at startup. Boot the bridge with
`LOG_LEVEL=INFO`; the log should show `Broadcast batcher enabled
{"windowMs":10}` (or `disabled` with the killswitch). Catches misordered
init (e.g. wiring the batcher before `wss` is created).

### 3. End-to-end smoke with real UDP burst

A standalone Node script (kept in `/tmp` during development, reproducible
from the smoke test below) connects a real WebSocket client, sends a burst
of 5 OSC messages through the bridge's `maxObserver` UDP port (11003), and
asserts the client receives exactly one `/bridge/batch` envelope carrying
all 5 inner messages in FIFO order. Verifies the full path: UDP recv →
`handleIncomingOSC` → `processIncomingMessage` → `broadcastBatcher.enqueue`
→ window timer fires → `broadcastToClients` → `client.send` → client
parse. Catches any bug the unit tests' direct-mock `send` cannot.

### 4. End-to-end smoke with killswitch

Same script run under `BRIDGE_BATCH_WINDOW_MS=0`. Asserts the 5-packet
burst arrives as 5 individual frames (`batched: 0, raw: 5`). Confirms
the killswitch genuinely disables and isn't a no-op.

### Production measurement (operator task)

The unit + smoke layers prove correctness. Real-bandwidth measurement
needs the full stack including Live and is therefore a Mac-side task,
not CI:

```
BRIDGE_PROFILE=1 BRIDGE_BATCH_WINDOW_MS=10 npm run dev   # baseline (batcher on)
BRIDGE_PROFILE=1 BRIDGE_BATCH_WINDOW_MS=0  npm run dev   # comparison (off)
```

For each run, fire `node scripts/perf/scenario.mjs idle 30000` and read
the **scenario summary's inbound total** — that's the WS frame count
the scenario client actually received over 30 s, which is the metric
this change moves. (Note: `analyze.mjs`'s `fanout` column is a
per-inbound-message integral computed pre-batcher, so it does not
shrink with batching on — don't use it as the scoreboard for this
change. The scenario summary's frame count is.)

Keep client topology identical between runs (close any iPad clients
before measuring, or include them in both runs). ADR-355 covers the
harness.

### Measured results

Idle 30s × 2 on 2026-05-26, 16 tracks playing in Live, single WS
client (scenario script):

| Mode | WS frames in 30 s | Frames/sec/client |
|---|---|---|
| Batched (10 ms window) | 1,043 | 34.8 |
| Killswitch (off) | 21,960 | 732.0 |

**21× reduction in WS frames per client** under sustained
playhead + meter traffic. Inbound OSC message rate from the Surface is
similar between modes (~720–740 msg/s) — the bridge isn't dropping
work, it's packaging it more efficiently. Run A also had the iPad
client transiently connected; the headline rate is per-client so the
comparison still holds, but the raw `fanout` column was double-counted
on Run A as a result.

## Consequences

### Positive

- **Frame count drop scales with traffic burstiness.** A 30 Hz meter pulse
  across 9 tracks (8 + master) inside a single window collapses from 9
  frames to 1 envelope. `broadcastToClients` calls `JSON.stringify` once
  per client per call (`WebSocketServer.js:452`), so for N clients × M
  messages the total serializations drop from N×M (one per message per
  client) to N (one per envelope per client) — even though each client
  still pays its own stringify on the larger envelope payload.
- **Backward compatible at the wire.** Old client code that doesn't know
  about `/bridge/batch` would receive an envelope it doesn't understand —
  but bridge and UI ship together, and the killswitch covers the rollback
  case if something unexpected breaks downstream.
- **Disambiguates "broadcast cost" from "producer cost" in the profiler.**
  With batching on, `bridge-profile.ndjson`'s fanout integral represents
  envelope-level fanout, not raw-message fanout. The shape of optimization
  work shifts from "shave broadcast loops" to "shave the producer rate"
  (which is the right place to attack next).

### Negative

- **Up to 10 ms of added latency** on Surf→UI broadcast. Imperceptible for
  meters, parameter echoes, structural events, and state/full chunks. Not
  applied to UI→Surf writes for exactly this reason. Heartbeats and
  liveness signals have thresholds at 3 s and 12 s, so 10 ms is in the noise.
- **The `/bridge/batch` envelope is bridge-specific.** It exists on the
  bridge↔UI wire, not on the surface↔bridge wire. If a future tool replays
  bridge traffic into the UI from a recording, it needs to understand the
  envelope — `oscTap.js` captures pre-batch frames, so replay-into-UI
  should source from the tap, not from a WS recording.
- **No per-address coalescing in the batcher** (deliberate). If a future
  producer chatters faster than it should, the symptom will appear in the
  batcher's envelopes as repeated messages — fix at the producer.

### Neutral

- Health monitor's `recordBroadcastResult` now fires once per envelope
  send instead of once per inner message. Semantically this is per-frame
  rather than per-message, which is arguably more accurate for catching
  buffer-wedged clients (the `bufferedAmount` reaper key). No detection
  thresholds were tuned to per-message semantics, so no recalibration
  needed.
- Capability negotiation deferred. If a third-party client appears, this
  ADR is the place to revisit — add a `surface/hello`-style flag and
  downgrade to the per-message path when absent.

## Tags
`bridge`, `transport`, `websocket`, `performance`, `osc`, `broadcast-batching`,
`knobbler-osc-diet`
