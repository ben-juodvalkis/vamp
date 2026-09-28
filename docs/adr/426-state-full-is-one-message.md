# ADR-426: `state/full` Is One Message, on an Ordered Transport

## Status
**Accepted** (2026-08-31)

Separate from [ADR-425](425-track-role-recorded-in-the-set.md) although
both shipped the same day and both bumped the protocol. They are
independent decisions with unrelated causes — 425 was enabled by
discovering `Track.set_data`, this one by putting a stream under the
bridge↔surface leg — and only 425 supersedes anything.

## Context

Every piece of framing machinery in the v3 state channel existed for one
reason: **a darwin UDP datagram cannot exceed 9,216 bytes.**

`state/full` is 389 KB on a realistic set (20 tracks × 4 heavy devices,
41,734 elements). So it shipped as ~99 chunks inside a
`begin → chunk… → end` envelope, with an FNV-1a checksum so the UI could
tell a torn bundle from a whole one, and a 453-line reassembler on the
far side to put it back together and reject the torn ones.

None of that was about correctness of the *tree*. It was about the tree
not fitting through the pipe.

Two further costs rode along:

- The checksum was a **cross-language contract**, mirrored byte-for-byte
  by `v3StateFull.ts` and pinned by a parity test. That constraint is
  why it stayed a pure-Python FNV-1a byte loop costing ~35 ms of Live's
  control thread — faster folds were all priced and all rejected for
  needing a bump plus a matching TS rewrite.
- `BrowserProbe` still *truncates* its Places dump at 7,500 bytes for the
  same ceiling (untouched here; noted so the ceiling's remaining tenants
  are on record).

## Decision

**Put an ordered stream under the bridge↔surface leg, then delete the
machinery that existed to work around its absence.**

1. **A length-prefixed TCP transport on port 11022**, bound *beside* the
   UDP pair, not replacing it — fire-and-forget senders on ephemeral
   ports (the Max probe drivers) still need a datagram socket.
   `[4-byte big-endian length][OSC bytes]`; the payload is exactly what
   `osc_codec` already produced, so this is a transport swap and not a
   codec change.
2. **Threadless**, using the same non-blocking drain idiom
   `osc_transport.py` already used. Measured writing only from the
   surface's real 92.8 Hz pump: 389 KB clears in **1 pump / 0.14 ms**,
   the 1.22 MB pathological case in 3 pumps / 24 ms — both inside one
   99.4 ms Live tick. The migration plan had budgeted for a ~1 kHz pump
   and worried 10 Hz would be marginal; at the actual rate the question
   does not arise, because the inner drain-until-EAGAIN loop moves far
   more than one buffer per pump when the reader keeps up.
3. **Protocol 3.6.0 — one message:**
   `/looping/v3/state/full/tree [reason, generation, etag, scope, *tree_args]`.
   `scope` is `""` for whole-song. Deleted with it:
   `_split_into_chunks`, both chunk budgets, `_estimate_arg_bytes`, the
   chunk-gen counter, `_encode_tree_args` / `_fnv1a_31`,
   `v3StateFullReassembler.ts`, `v3ChecksumParity.test.ts`, and
   `awaitNextStateFullEnd` (which had no production callers).
4. **No UDP fallback for `state/full`.** A 389 KB message does not fit a
   datagram; the chunking that made it fit is what was deleted. With no
   peer connected the surface warns, **leaves the memo untouched**, and
   returns — and `on_stream_peer_connected` clears the memo and
   republishes when the bridge dials in.

## Consequences

- **The checksum stops being a contract, and gets 10× cheaper.** With no
  reassembler the client never *computes* it — it stores the token and
  echoes it back as the 3.5.0 ETag. An opaque token has no cross-language
  constraint, so it is now a C-path digest: **40.3 ms → 4.2 ms**
  end-to-end at realistic scale. (Of that 4.2 ms, `repr()` is 3.3 and the
  md5 fold 0.8 — quoting the fold alone would overstate the win by 5×.)
  Only two properties still matter, both local: stable within a session,
  and collision-resistant. Not required: agreement with any other
  implementation, or stability across restarts.
- **`state/full` now depends on TCP being up.** This is the real cost.
  Over UDP a bundle sent with nobody listening was simply lost, and that
  was survivable because the next LOM change resent it. There is no such
  backstop now, which is why `on_stream_peer_connected` exists and why
  the memo must **not** be recorded on a deferred publish — recording it
  would make the republish look "unchanged" and skip. That pairing is the
  entire safety net; a test pins it.
- **Reconnect became the bridge's job.** UDP was connectionless, so a
  Live restart was invisible to the bridge. It now redials with backoff
  (500 ms → 10 s); `ECONNREFUSED` while Live is closed is the expected
  steady state and logs at debug. Measured redial after a bridge bounce:
  **91 ms**, with bundles resuming on the stream.
- **The UI needed no change for the transport step itself.** Before the
  framing was deleted, the same begin/chunk/end protocol simply shipped
  as *one* chunk over the stream, because the reassembler already read
  `totalChunks` off `begin`. That is what made the framing vestigial —
  and let transport and deletion land as separate, separately revertible
  commits.
- **`ClipNotesComponent` keeps its own chunking and its own FNV
  checksum** for the rich-notes blob, and `clipRichNotesService.ts` still
  mirrors that checksum byte-for-byte. That one **is** still a
  cross-language contract. Do not assume this ADR retired it.
- **Never add port 11022 to `scripts/cleanup.sh`'s `PORTS`.** That sweep
  is `kill -9` and, unlike its process sweep, is not filtered by repo
  cwd — the process holding 11022 is Ableton Live. A comment sits where
  someone would go to add it.

## Verification

On the live rig, same tree and same content across the change:

| | messages on the wire |
|---|---|
| chunked UDP | 6 (`chunks=6`) |
| one chunk over TCP | 3 (`begin`+1+`end`) |
| 3.6.0 single message | **1** |

Surface log at 3.6.0, with no `chunks=` or `chunk_gen=` fields left:

```
published v3 state/full (reason=accept, generation=1,
                         tree_args=2532, etag=0x7f30c25c, scope=None)
```

TCP counters read `framesOut: 1, bytesOut: 25580` — whole tree, one
frame — and the peer-connect republish fires as designed.

## Tags
`transport`, `tcp`, `state-full`, `chunking`, `checksum`,
`protocol-3.6.0`, `udp-mtu`, `deletion`
