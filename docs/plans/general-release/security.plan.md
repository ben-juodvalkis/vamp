# Device Pairing

**Designed 2026-09-30. The smaller fixes but the recorder's port are done the same day; pairing
is not started.** What is exposed today, and why, is
[../../../SECURITY.md](../../../SECURITY.md). This plan closes the main gap: a device on the same
network can drive Live because `/api/ws-auth` signs the bridge's challenge for any caller.

**Sizes:** **S** is hours, **M** a day or two, **L** a project.

## Decisions

- **Pair devices on Wi-Fi, trust the cable** (Ben, 2026-09-30). The USB-C link and the Mac itself
  are trusted as they are; any other device is approved once.
- **Both ways to approve** (Ben, 2026-09-30): type a code shown on the Mac, or tap **Allow** on a
  screen that is already trusted. Either one completes the pairing.
- **Pairing is on by default in the general edition** (Ben, 2026-09-30). A switch turns it off.
- **The code appears in Live's status bar** (Ben, 2026-09-30). The surface is loaded whenever
  Vamp works, so it can always show it. A Max device can't: Vamp-Recorder is optional, and the
  others sit on tracks.
- **Allow appears as a banner on trusted screens only,** never as a macOS dialog (Ben,
  2026-09-30). A dialog would come up over Live whenever anyone on venue Wi-Fi opened the page,
  and take Live's keyboard focus mid-song.

## The main idea

The bridge's challenge is sound: a fresh random value per connection, answered with an HMAC of a
secret that never crosses the network (`interface/bridge/utils/wsSecret.js`). So the bridge
stays as it is. The gate moves to `/api/ws-auth`, which signs only for a trusted caller. An
untrusted page gets a 401 and shows the pairing screen instead of the controls.

```
iPad opens the page (8889)
   └─ page asks /api/ws-auth to sign the bridge's challenge
        ├─ trusted → signed → bridge (8081) → Live
        └─ not trusted → 401 → "Pair this device"
                ├─ code in Live's status bar, typed on the iPad
                └─ or Allow, tapped on a trusted screen
                     → device cookie issued → trusted from then on
```

The page's HTML and scripts stay open: they hold nothing secret.

## Who is trusted

1. **The Mac itself:** the caller's address is loopback or one of the Mac's own addresses.
2. **The USB-C link:** the caller's address is on the link's subnet, `network.ipad.usbc` /24
   (`192.168.100.0/24` by default). The Mac routes replies to that subnet down the cable, so a
   device on Wi-Fi that gives itself such an address can't finish a connection. **To confirm on
   the rig** from a second device. Link-local addresses (`169.254.x.x`, the cable before its
   address is set by hand) are not trusted: Wi-Fi uses the same range when DHCP fails.
3. **A paired device:** it sends a valid device cookie.
4. **Anything else** gets the pairing screen.

With the switch off, every caller is trusted, as today.

## Pairing

1. The page posts a request with a device name (the browser's guess, "iPad Safari", editable).
2. The Mac announces it in two places at once:
   - **Live's status bar:** "Vamp: iPad Safari (192.168.1.42) wants to connect. Code 482 913".
   - **A banner on every trusted screen** (the cabled iPad, the Mac's browser), naming the device
     and its address, with **Allow** and **Ignore**.
3. The iPad shows "Waiting for the Mac…" and a code field, and asks about once a second whether
   it has been approved.
4. A correct code, or Allow, answers that question with the device cookie. Both prompts close.

**The code:** 6 digits, good for 2 minutes, one live code per request. Five wrong tries end the
request, and the device has to ask again. Requests are rate-limited per address, so nobody can
flood the status bar or the banner.

**The cookie:** 32 random bytes, `HttpOnly`, `SameSite=Strict`, a year long and renewed on each
use. The server keeps only its SHA-256, with the name, address and first and last use, in
`config/.paired-devices.json` (gitignored, mode 0600, like `.ws-secret`).

**The wiring.** Pairing lives in the interface server, which owns HTTP, cookies and
`/api/ws-auth`. It tells the bridge about a request over loopback; the bridge shows the banner
on its authenticated clients and passes the message to the surface, which calls Live's
`show_message`. New addresses go in [wire-protocol.md](../../reference/wire-protocol.md) in the
same commit. The status bar needs a surface change, so a Live restart.

**The other API routes** get the same check, in `hooks.server.ts`: every `/api/*` route but the
pairing ones. Today `/api/places/rebuild` and `PUT /api/grooves` change things on the Mac, and
`/api/network` lists its addresses, for any caller.

## Not getting locked out

The reason pairing wasn't the default before: a cleared browser would lock a performer out
mid-session. This design answers it:

- **The cable never pairs.** The stage path has nothing to lose.
- **Pairing again takes about 10 seconds,** and the code comes to the Mac's screen without anyone
  looking for it.
- **Forgetting a device doesn't cut an open session.** It applies on the next connection.
- **The switch.** `constants.local.json` can turn pairing off.
- **A home-screen web app keeps its own cookies,** apart from Safari's. Pair it once, from the
  home-screen app.
- **Safari's tracking limits** cap cookies that scripts set at 7 days. A cookie the server sets
  over HTTP from the page's own address should not be capped. **To confirm on the iPad.**

## What it doesn't cover

The page is plain HTTP. Someone on the same Wi-Fi who can watch its traffic could copy a device
cookie. Pairing stops anyone who merely opens the page, not a determined attacker on a network
you don't control. HTTPS on a bare IP address means a certificate the iPad has to be told to
trust, which is out of scope. SECURITY.md keeps telling people to use the cable on networks they
don't trust.

## Smaller fixes, independent of pairing

- **`/api/ws-auth`'s salt-less branch: deleted** (2026-09-30). It returned the raw secret, and
  nothing in the tree asked for it. A request with no salt is a 400 (`wsAuthRoute.test.ts`).
- **The bridge checks `Origin`: done** (2026-09-30, `interface/bridge/utils/originCheck.js`). A
  browser page from anywhere but localhost, an IP address or a `.local` name gets a 401 on the
  upgrade, before any challenge. That is the web server's own rule (Vite's `allowedHosts`),
  which already blocked DNS rebinding against 8889 and 3000. A client with no `Origin` (the
  menu-bar app, the scripts) still has to pass the challenge.
- **Auth on unless explicitly off: done** (2026-09-30). A config with no `auth` block, or one
  the bridge can't read, used to run with no gate; now only `enabled: false` turns it off. A
  secret that can't be made still fails open, as before: that is the deliberate stage trade in
  `WebSocketServer.js`.
- **Vamp-Recorder's port** (**M**). Max's `udpreceive` listens on every interface and can't see
  who sent a message, so anyone on the network can drive a capture. Either the bridge adds a
  per-session token the device checks, or the device learns its commands another way. The rig
  can use a pf rule meanwhile (plan.md §7).

## Order

1. The smaller fixes. Done 2026-09-30 but the recorder's port. No Live restart.
2. Trust by address, the pairing screen, the code and Allow, the gate on the API routes (**M**).
   A protocol bump and a Live restart.
3. **Settings → Devices** on a trusted screen: each device's name and last use, **Forget**, and
   **Forget all** (**S**).

## Tests

- **Unit:** the trust decision (loopback, the Mac's own address, the cable's subnet, a
  link-local address, a good, unknown or forgotten cookie, the switch off); code expiry, the try
  limit and the rate limit; only hashes on disk.
- **On the rig:** the cabled iPad plays with no pairing; a phone on Wi-Fi gets the pairing screen;
  the code shows in the status bar and works; Allow on the cabled iPad works; clearing Safari's
  data asks again; a Wi-Fi device given a `192.168.100.x` address can't connect.

## When it lands, update

README.md (Known gaps), INSTALLATION.md §6, SECURITY.md, the WebSocket `_note` in
`config/constants.json`, the comments in `wsSecret.js` and `/api/ws-auth`, and
[toggles.md](../../reference/toggles.md) for the new switch.
