# ADR-505: Pairing Vamp for iPad from a QR Code, over Wi-Fi

## Status
**Proposed** (2026-11-05). Builds on ADR-504 (the link over Wi-Fi) and
ADR-494 (pairing). Vamp for Mac takes it when it is next opened from the
Dock; Vamp for iPad when it is next installed from Xcode. No Live restart.
Not yet run on a real device.

## Context
ADR-504 put the link on Wi-Fi but kept pairing on the cable, because the
six-digit code could be worked out offline by a stand-in for the Mac, and on
Wi-Fi anything on the network could stand in. Ben, 2026-11-05: an iPhone or
iPad must pair without the cable, by scanning a QR code the Mac shows, which
opens the app and starts the link. And someone without the app needs a way
to get it from the Mac: a menu item that opens its App Store page, to share
from there.

A QR code can carry what a typed code cannot: a long secret, seen only by
someone looking at the Mac's screen. Nothing on the network can guess it,
so it can key the pairing's TLS outright.

## Decision
- **Vamp for Mac's menu: "Pair an iPad or iPhone with a QR Code…"** shows
  a window with a QR code of `vamp://pair?s=<secret>`: 32 random bytes made
  fresh each time, good for one pairing within 10 minutes, ended by closing
  the window (`PadLink.showPairingQR`, `QRWindow`). Under the code, a
  button to the App Store; the same is in the menu as **"Get Vamp for iPad
  on the App Store…"**, which opens apps.apple.com/app/id6829034226 (the
  listing is "Vamp for Live").
- **The camera opens Vamp for iPad** through its `vamp` URL scheme
  (`CFBundleURLTypes`). The app checks the link's shape
  (`LinkProtocol.pairingSecret(from:)`) and shows "Pairing with the Mac".
- **The iPad listens for the pairing on Wi-Fi, keyed by the secret**
  (`LinkServer.startPairing`): a second listener, TLS with a pre-shared key
  derived from the secret (`LinkAuth.pairingPSK`,
  `NWParameters.wifiPairing`), advertised as `_vamplink._tcp` with the
  secret's id under `p` (`LinkAuth.pairingId`), for
  `LinkProtocol.pairingLimit` (3 minutes). The secret never crosses the
  network.
- **The Mac that showed the code finds it and dials.** It alone knows the
  id and can make the key; the pairing then runs exactly as on the cable,
  with the secret as the code and one try (`LinkClient` `fixedCode`), so
  both ends prove they hold it before the iPad hands over its key. Nothing
  is shown or typed.
- **That connection only pairs.** The iPad closes it once paired, never
  links over it, and switches on its ordinary Wi-Fi listener (ADR-504); the
  Mac then links there with the key, as for any paired iPad.
- The cable's pairing, with the six-digit code, stays.

## Consequences
- **Measured on this Mac:** 41 link XCTests pass, 4 of them new: a scanned
  code pairs over Wi-Fi and the ordinary Wi-Fi link follows and carries a
  page connection, with no code shown; a wrong secret cannot pair (TLS
  refuses it); a pairing connection never becomes the link, even for a Mac
  already paired; the link is read only from a well-formed `vamp://pair`.
- **Measured in the Simulator:** opening a `vamp://pair` link asked "Open
  in 'Vamp'?", opened the app to "Pairing with the Mac", and `dns-sd` saw
  `Vamp pairing f3ddc3._vamplink._tcp`. The Mac's half (showing the window,
  finding and pairing the iPad) was not run outside the tests: it needs the
  menu clicked and would add the Simulator to this Mac's paired iPads.
- **Not yet measured on a device:** the Camera app's banner, the local
  network prompt arriving mid-pairing, and the whole round trip with the
  iPhone and the iPad (rig checklist §15).
- **Security:** anyone who can see the Mac's screen while the window is up
  can pair, once. Closing the window or pairing ends the code; a photo of
  it is useless afterwards. Unlike the six-digit code, it cannot be worked
  out offline, so ADR-494's accepted weakness does not apply to it.
- An iPad paired from a QR code has no serial on record, so the Mac's
  refusal of the unauthenticated link (keyed by serial, ADR-494) does not
  cover it until it links by cable. Only a Vamp for iPad from before
  version 2 would ever ask for that link.
- If the app is not installed, scanning the code does nothing: hence the
  App Store button. A link on benjuodvalkis.com that falls back to the App
  Store is the later option.

## Tags
`ipad`, `iphone`, `native-app`, `pairing`, `qr-code`, `wifi`, `security`
