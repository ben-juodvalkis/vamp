# ADR-489: Bridge → surface rides the TCP leg; UDP is the fallback

## Status
**Accepted** (2026-10-27)

## Context

The bridge and the surface have had two legs since 2026-08-31: UDP
11020/11021 and a TCP stream on 11022 that the surface listens on and
the bridge dials. Only `state/full/tree` used the stream, because only
it outgrew the 9,216-byte darwin datagram.

What actually travelled bridge → surface, read off the code before
changing anything:

- **Every UI write**: `WebSocketServer.routeMessageToUDP` sends whatever
  `backendScope.pythonSurface` matches to `udpPorts.pythonSurface` —
  `param/set`, `property/set`, track and clip writes, and the handshake
  `hello` and `state/resync`.
- **The server-presence heartbeat** (`/looping/v3/server/heartbeat`,
  every 2 s).
- **The similar-sound swap's hops** (`drum/show_for_swap`, `pad_names`,
  `finish_swap`) and **the Group gesture's record-mode bracket**
  (`record_suspend` / `record_resume`), both through `sendToSurface`.
- **The auto_capture override replay** (ADR-405).

All of it was UDP. `SurfaceTcpClient.send()` existed and had no caller,
and the surface's `TCPTransport` had no handler registered for anything:
a frame that did arrive would have been logged `no handler` and dropped.

The surface drains its UDP socket only from Live's pump (the
`FastDrainPump` Timer, with the tick as fallback). A stalled tick —
`tick-stall:pythonSurface`, 3–12 s measured in `bridge.log`, worst
during a set load — plus a full receive buffer loses datagrams with no
error anywhere. ADR-418 was the visible case: a lost `hello` left the UI
with no tree while every fader still reached Live, and the fix was to
retry. Every other bridge → surface message had the same exposure and
no retry.

## Decision

**1. While the TCP leg is connected, every bridge → surface message
rides it.** `transport/SurfaceLink.js` stands in for the UDP port
wherever the bridge sends to the surface: it is `pythonSurface` in the
port map `routeMessageToUDP` is handed, and the swap, Group, replay and
heartbeat senders call it directly. It sends on the stream when
connected and on UDP 11020 when not. One message, one leg: nothing is
sent twice, nothing is queued for the stream while it is down (a write
delivered after an unknown delay is worse than one sent now), and a
frame the stream refuses is not re-sent over UDP, where it would arrive
ahead of the frames still queued. Both legs encode with osc.js and
`metadata: false`, so a typed arg or a blob is the same bytes on either
(pinned by `surfaceLink.test.ts`).

**2. On the surface both legs dispatch through one handler table.**
`TCPTransport` takes the UDP `OSCTransport` as its `router`: an inbound
frame goes to `OSCTransport.dispatch`, the same lookup, guard and reply
check a datagram gets, and a pass that dispatched anything runs the UDP
transport's drain hooks — the drum fan-out applies a coalesced
`property/set` from one (ADR-428), and without this a write that came
over the stream would sit queued until a datagram happened along. A
tuple reply goes back on the stream it came in on, which the bridge
reads into the same `handleIncomingOSC` as a UDP reply. Handlers use
`source_addr` for logging only, so the TCP peer address in its place
changes nothing. Handlers still run on Live's main thread, from the
same pump, as before.

**3. The fallback window is short.** The bridge's redial backs off to
10 s while Live is closed, and every message sent before it lands takes
UDP — right when a set load is stalling the tick. Any datagram from the
surface now kicks a redial at once (`SurfaceTcpClient.kick`, at most
once a second, no-op while connected or dialling): the surface's 1 Hz
heartbeat and its `surface/hello` go out over UDP from the moment it
binds, and it binds 11022 in the same call as 11020.

**4. A surface that stops reading costs dropped frames, not memory.**
Node buffers a write the kernel will not take, without limit. Past
1 MiB queued (`MAX_PENDING_OUT_BYTES`) a frame is dropped, counted as
`droppedOut` and logged once per episode — the fate a datagram met in a
full UDP buffer, reached only after far more backlog than a 12 s stall
at gesture rate produces. The surface's own 8 MB outbox cap already
covers the other direction.

**5. The UDP-loss workarounds stay, because UDP can still drop.**

- **The hello retry (ADR-418)** stays as it is. With the leg up a hello
  is not lost on the way in, so the retry becomes a backstop — but the
  hello still takes UDP while the leg is down, the surface may not be
  running at all, and the `accept` comes back over UDP 11021. The UI
  cannot tell which leg the bridge used, so it keeps retrying on
  silence. Its triage note in `bridge.log` changes meaning: with
  `Surface TCP status connected` logged, repeated resends mean a surface
  that is not answering (a stalled tick) or an accept lost on the way
  back, not a hello lost on the way in.
- **The server-presence grace window** (6 s over a 2 s beat) is
  liveness, not loss recovery, and is unchanged.
- **The auto_capture replay's self-heal** (ADR-405), the swap's and the
  Group bracket's timeouts, and the `prepare_for_preset` LRU against
  retransmits all still guard a surface that does not answer, which a
  stream does not prevent.
- **The UI's guards against a dropped ack** (`clipOperations.ts`,
  `SlotCell`'s re-ask) concern the surface → bridge leg, which this
  does not change.

## Consequences

**Positive.**
- A tick stall no longer loses a bridge → surface message while the
  leg is up: the kernel and the bridge hold it and the pump dispatches
  it in order when it runs. Writes, the hello, the swap hops and the
  heartbeat stop depending on how long Live stalled.
- One handler table, so an address cannot work on one leg and be deaf
  on the other.
- `drain_stats`' `tcp.framesIn` now counts the bridge's traffic, which
  makes "is the bridge reaching us over the stream" a number.

**Negative / accepted.**
- After a long stall the surface runs every write queued during it, in
  one pump — the UDP buffer replayed whatever it had not dropped too,
  but the stream drops nothing until 1 MiB, so a long fader drag during
  a stall replays whole. Writes carry generations (§4.2), so a
  structural change in between still rejects stale ones.
- A message sent in the instant between the surface closing the stream
  and the bridge seeing the close is lost with the socket — the same
  window UDP had with a surface that was gone.
- The surface → bridge direction is unchanged: accepts, acks, meters
  and every emit but the tree still ride UDP 11021. The bridge's Node
  event loop drains that socket continuously, so it is far less exposed
  than the surface's pump-driven drain, but it is not ordered or held.

**Not measured yet.** The surface half runs only after a full Live
restart; nothing here has been watched on the rig. Worth checking after
the restart: `drain_stats`' `tcp.framesIn` climbing with UI use,
`Surface TCP status connected` within a second of a set load, and no
`no accept — resending hello` while the leg is up.

## Tags
`wire-protocol`, `transport`, `tcp`, `udp`, `reliability`, `handshake`,
`bridge`, `surface`
