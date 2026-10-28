# Security

Vamp is a web page that the Mac running Live serves to your iPad. Anything that can reach that
page over the network can play your Live set. This page says what that exposes today, how to
play safely, and what is coming.

## The short version

- **A device has to be approved once before it can play** (pairing, ADR-491). It asks; the Mac
  shows a 6-digit code in Live's status bar and an **Allow** banner on screens already connected;
  the code typed on the device, or Allow, pairs it, and it is remembered. Settings → Connection →
  Devices forgets one. `osc.webSocket.auth.pairing: false` turns pairing off.
- **The Mac itself and Vamp for iPad on the USB cable never pair.** The app reaches the Mac through
  Apple's device channel over the cable, which nothing on a network can. Play over it whenever you
  can. Safari over the cable pairs once, like Wi-Fi: its link can't be told from Wi-Fi by address.
- **On Wi-Fi, prefer a network you trust.** The page is plain HTTP, so someone who can watch the
  network's traffic could copy a paired device's cookie. Pairing stops anyone who merely opens the
  page, not that. The design is
  [docs/plans/general-release/security.plan.md](docs/plans/general-release/security.plan.md).

## What the network can reach today

| Port | What | Who can use it |
|---|---|---|
| 8889 (`npm run ipad`), 3000 (`npm run dev`) | The web page (anyone) and its API (the Mac and paired devices) | The page: anyone who can reach the Mac |
| 8081 | The bridge's WebSocket, which carries every command to Live | The Mac and paired devices (below) |
| 11016 (UDP) | Vamp-Recorder's control port, when the device is in your set | Anyone who can reach the Mac |

Every other port Vamp opens listens on the Mac only (`127.0.0.1`).
[docs/reference/architecture.md](docs/reference/architecture.md) §3 has the full list.

**Why the WebSocket's password doesn't stop a stranger.** The bridge challenges every
connection with a fresh random value and accepts only an answer signed with a secret that
never crosses the network (`interface/bridge/utils/wsSecret.js`). But the page has to get that
answer from somewhere, and it asks the web server (`/api/ws-auth`), which since pairing (ADR-491)
signs only for the Mac itself and paired devices. An unpaired device gets the pairing screen
instead, and a 401 from every API route but pairing's own. The bridge also refuses a browser page served from any other website, so a
site you visit can't reach it through your browser.

**Vamp-Recorder's port** is a Max `udpreceive`, which can't be limited to the Mac. A device on
the network can arm, start and stop a capture and choose the folder it records into.

## What someone on your network could do

- Everything the iPad can: record, launch, stop and clear clips, load instruments and effects,
  change volume, tempo and device settings, create tracks.
- List your library and draw waveforms. The file routes answer only for sample files under your
  library, Live's Places, Packs and Core Library, the capture folder and Live projects, and
  refuse any other path (`interface/src/lib/server/sampleRoots.ts`).
- With the owner-only **AX helper** switched on, also click and type in Live on the Mac. It is
  off unless `config/constants.local.json` turns it on
  ([docs/reference/toggles.md](docs/reference/toggles.md)).

## Keeping your secret

The WebSocket secret is made on first run and kept in `config/.ws-secret`, readable only by
your user and never committed. You can set your own with the `LOOPING_WS_SECRET` environment
variable instead. To make a new one, delete the file and restart Vamp; open pages pick it up
on their next connection.

## Reporting a vulnerability

Please report it privately, through GitHub: this repository's **Security** tab →
**Report a vulnerability**. Don't open a public issue. Vamp is maintained by one person, so
expect a reply within a couple of weeks, not hours.
