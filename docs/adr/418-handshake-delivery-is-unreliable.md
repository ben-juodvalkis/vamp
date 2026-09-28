# ADR-418: The handshake hello is retried, and accepts are not ours by default

## Status
**Accepted** (2026-08-24)

## Context

A UI that had been running for a while would stop updating: meters
frozen, playheads parked, clip state stale — while moving a fader still
moved Ableton. Reloading the page fixed it, for a while.

The two halves of that symptom point in opposite directions, which is
what made it hard to place. Outbound writes worked, so the WebSocket was
open and the surface was listening. Inbound display was dead, so
something upstream of rendering had stopped. Both were true at once
because **the UI had never completed its handshake**.

`/looping/v3/handshake/hello` was sent exactly once per WebSocket
connect (`simpleClient.onConnected`, and again from `v3SurfaceHello` on
detected surface restart). There was no timeout, no acknowledgement
check, and no resend. But the hello does not travel over the WebSocket
end-to-end — the bridge relays it onto **UDP port 11020**, which is
unacknowledged. A single dropped datagram there is silent and
permanent:

- no `accept`,
- therefore no `state/full` (§5.5 — accept is what drives the tree),
- therefore no tracks, no meters, no playheads,
- while `param/set`, `track/volume` and every other write kept working,
  because control and value writes are fire-and-forget and need no
  negotiated session to succeed.

The conditions that drop it are already recorded in `bridge.log`:
`tick-stall:pythonSurface` warnings show the surface's inbound drain
pausing for 3.4s, 7.5s and 12s at a time. The surface only drains its
socket on a Live tick, so a stalled tick plus a full socket buffer
loses whatever arrived meanwhile. Reconnect churn supplies the
opportunities — tab suspend/resume, bridge restarts, link-local route
changes — and every reconnect is one more chance to lose the one hello
that mattered.

A second defect sat next to it. **Accepts are broadcast to every
WebSocket client**, because the bridge is a pure router and the
surface's UDP reply carries no client identity. Clients negotiate
independently: the web UI advertises `["3.4.0"]`, while the menubar
utility (`owner/menubar` `Wire.swift`) advertises `["3.3.0"]`. So the
menubar's accept arrived at the web UI, which treated it as *its own*
handshake being answered at a version it could not speak — logged
`unexpected version`, called `markFailed()`, and returned early past
`setHandshake()`, leaving a stale `sessionId` / `generation`.

Two dead ends are worth recording so they are not re-run. Neither
holds:

- **The 3.3.0 dump is not mis-parsed.** The obvious follow-on theory —
  that a 3.3.0-negotiated `state/full` carries shorter records that the
  3.4.0 parser over-reads — is wrong. The surface emits the current
  record shape regardless of negotiated version; T records were
  measured at 13 fields under both 3.3.0 and 3.4.0, field-for-field
  identical. The version mismatch was noise in the log, not corruption
  on the wire.
- **Vite dep re-optimization is not involved.** A mid-session
  re-optimization can leave two copies of the Svelte runtime live and
  corrupt effect teardown, which produces a similar-looking freeze. But
  every bare specifier the browser loads is already in the optimizer's
  pre-bundled set, so nothing the app reaches at runtime can trigger
  one.

## Decision

**1. The hello repeats until it is answered.** `sendHandshakeHello()`
arms a 2s retry that resends while the handshake is not `accepted`,
bounded at 8 attempts (~16s). A caller-initiated hello starts a fresh
sequence; a retry continues the current one. The bound matters: a
genuinely absent surface (Live closed) should stop the UI talking to
nothing, and is picked up later by the reconnect path or by
`surface/hello`, both of which begin a new sequence.

Retry rather than acknowledge-and-repair because the hello is
idempotent — a duplicate produces another accept and another
`state/full`, which is exactly the recovery we want anyway.

**2. An accept for a version we never advertised is not ours.** It is
ignored at debug level, and the retry keeps running. This is sound
rather than merely pragmatic: the surface only ever picks from the
versions the client sent it, and a genuine no-common-version is
signalled as `/looping/v3/error` with `handshake-version-mismatch` —
**never** as an accept (`HandshakeComponent._pick_version` returns
`None` and the caller emits the error). So an accept naming a version
we do not support can only belong to another client.

The `markFailed()` path stays, driven by the error address, which is
where a real mismatch actually arrives.

**3. Uncaught errors and reactivity stalls are reported.** The
freeze had no fingerprint — `clientWatchdog` logged rAF stalls and
visibility but never errors. It now reports `uncaught-error` /
`unhandled-rejection` (message, stack, source) and `reactivity-stall`
to `bridge.log`. The stall probe is a plain interval ticking a counter
that an `$effect` in `+layout.svelte` echoes back; divergence means the
Svelte effect scheduler stopped flushing while the event loop kept
running. Counters rather than clocks, so a throttled background tab
cannot false-positive.

That last signal earns its place independently: an error thrown inside
any Svelte 5 effect escapes `Batch.process()`, and `flush_effects()`
restores `is_flushing` but not `queued_root_effects`, `current_batch`,
or the root effect's `CLEAN` bit — so every later `schedule_effect()`
bails as "already scheduled" against a queue nothing will drain.
Reactivity dies app-wide until reload while DOM handlers keep firing,
which is the *same* observable signature as a lost hello and needs to
be told apart from it.

## Consequences

**Positive.**
- A dropped hello self-heals in ~2s instead of requiring a reload.
- Multi-client setups stop interfering. The menubar can keep
  advertising 3.3.0; clients negotiating different versions is now
  explicitly legal rather than accidentally destructive.
- The two freezes that look identical from the driver's seat — no
  handshake vs. dead effect scheduler — are now distinguishable from
  `bridge.log` alone, without reproducing anything.

**Negative / accepted.**
- A retry sequence can emit up to 8 extra hellos, each producing an
  accept and a full `state/full` if several land. Harmless (the tree
  is idempotent) but visible as burst traffic during recovery.
- `attemptCount` now counts retries, inflating it relative to
  "connects". It is telemetry, and hellos-sent is the more useful
  reading.
- A foreign accept is no longer surfaced at error level. If a *real*
  version mismatch ever arrived as an accept the UI would sit quiet —
  but the surface cannot produce that, per the Decision.

**Not done.** The menubar still advertises `3.3.0`. With accepts no
longer cross-talking there is no correctness reason to bump it, and it
needs a Swift rebuild. Worth doing when that app is next touched, to
stop the surface minting a session and re-emitting a whole tree on the
menubar's behalf.

## Tags
`handshake`, `wire-protocol`, `reliability`, `udp`, `websocket`,
`multi-client`, `svelte-reactivity`, `watchdog`, `freeze`
