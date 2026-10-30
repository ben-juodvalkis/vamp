# ADR-491: Pairing: the Cable Is Trusted, Wi-Fi Pairs Once

## Status
**Accepted** (2026-10-28): an iPhone paired on the rig (below). Proposed
2026-10-27 on `bj/native-ipad-app`. Builds `docs/plans/general-release/security.plan.md`
(designed 2026-09-30). Needs a full Live restart for the status-bar line.

## Context
Anyone who could open the page could drive Live: `/api/ws-auth` signed the
bridge's challenge for any caller. The plan of 2026-09-30 was "trust the
cable, pair Wi-Fi devices once". On 2026-10-27 Ben confirmed it ("cable is
enough for trust", and Wi-Fi must stay usable with a way to authenticate),
and the same day changed what "the cable" can mean: macOS now keeps the
iPad's USB network private and self-assigned (ADR-488), so the plan's rule
of trusting the cable's fixed `192.168.100.0/24` subnet can no longer hold.

## Decision
- **Trusted:** the Mac itself — loopback or one of its own addresses, which
  includes Vamp for iPad, whose connections reach the page server from Vamp
  for Mac's relay on loopback — and any device holding a paired cookie.
  Everyone, with `osc.webSocket.auth.pairing: false`. Safari over the
  cable's `169.254` link is not recognizable by address and pairs once.
- **The gate** is `hooks.server.ts`: every `/api/*` route but the pairing
  flow (`/api/pair/state|request|status|code`) answers 401 to anyone else.
  `/api/ws-auth` is one of them, so an unpaired device gets no proof for the
  bridge and cannot drive Live. The page and its scripts stay open.
- **Pairing** (`$lib/server/pairing/`): the device asks with a name; a
  6-digit code good for 2 minutes and 5 tries; one live request per device,
  at most one every 10 s and 6 in 10 minutes; a request answers only the
  address that made it. The code is typed on the device, or **Allow** is
  tapped on a trusted screen's banner. The poll that finds it approved sets
  a 32-byte token as an HttpOnly, SameSite=Strict, year-long cookie, renewed
  on each use. Only its SHA-256 is stored, in `config/.paired-devices.json`
  (gitignored, 0600).
- **Where it is seen:** the interface server POSTs each request and outcome
  to the bridge's `/pairing` route — loopback only, with the WebSocket
  secret as a bearer token, since the bridge's port is on every interface —
  which sends `/bridge/pairing` to the authenticated clients (the banner,
  without the code) and `/looping/v3/session/show_message` to the surface
  (Live's status bar, with the code; `StatusMessageComponent`).
- **Settings → Connection → Devices** lists the paired devices with Forget
  and Forget all. Forgetting applies on a device's next connection.
- **The page:** a 401 from `/api/ws-auth` shows the pairing screen and stops
  the socket redialling until the page reloads paired.

## Consequences
- On the rig: the Mac's browser and Vamp for iPad work as before. Safari on
  the iPad, on the cable or Wi-Fi, pairs once from its home-screen app.
- The page is plain HTTP: someone who can watch the network's traffic could
  copy a cookie. Pairing stops anyone who merely opens the page, as the plan
  says; SECURITY.md keeps recommending the cable.
- No protocol bump: `/bridge/*` is outside v3 negotiation, and an older
  surface ignores `show_message` ("no handler"). The status-bar line needs a
  full Live restart.
- Not built: Safari over the cable told apart by the interface it arrived
  on; Vamp-Recorder's UDP port, still open to the network.
- **Measured on a real device (2026-10-28):** Safari on an iPhone over the
  cable's self-assigned link (`169.254.133.62`, in airplane mode) got the
  pairing screen, asked at 09:34:45 and was paired at 09:34:51 with the code
  from Live's status bar, then played.
- Measured on this Mac: from the Mac, `/api/pair/state` answers
  `trusted: true via mac`; the relay answers 204 with the secret and 401
  without; the banner and the pairing screen render. An untrusted device
  could not be produced from the Mac (it is the Mac); unit and route tests
  cover that path (`pairing.test.ts`, `pairingGate.test.ts`).

## Tags
`security`, `pairing`, `auth`, `ipad`, `wifi`, `settings`
