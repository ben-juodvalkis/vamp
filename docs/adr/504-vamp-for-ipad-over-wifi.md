# ADR-504: Vamp for iPad over Wi-Fi Too, Once Paired by Cable

## Status
**Proposed** (2026-11-05). Pairing without the cable, from a QR code: ADR-505. Builds on ADR-488 (the cable link) and ADR-494
(the link proves itself). Vamp for Mac takes it when it is next opened from
the Dock (it rebuilds itself); Vamp for iPad when it is next installed from
Xcode. No Live restart. Not yet run on a real iPad.

## Context
Vamp for iPad reached the Mac only over the cable (ADR-488). Over Wi-Fi the
only way in was Safari, which loses what the app gives: no Safari chrome,
the iPad kept awake, "Reconnecting to the Mac…" over a loaded page, a cable
replug in ~2 s. Ben, 2026-11-05: Wi-Fi is for home and the studio; the
cable stays the way for gigs and anything that matters, and when Wi-Fi
misbehaves (a venue's network, a hotel's) the answer is the cable. Wi-Fi's
jitter and the battery it costs are accepted. Going from Wi-Fi to the cable
may cost a brief reconnect, but never an audio glitch.

What a reconnect does to Live was read before deciding: the page's hello
brings back a `state/full` (a read), the bridge replays its caches to the
page, and nothing is written to Live. The one audible risk is a connection
cut mid-gesture (a pitch wheel held bent, a fader mid-sweep), whose release
then never arrives.

The link's security changes on a network. Everything over it reaches the
page server as the Mac itself (ADR-491). On the cable only another app on
the iPad could reach the link; on Wi-Fi any device on the network can.

## Decision
- **The same link, also on Wi-Fi, inside TLS keyed by the pair's key.**
  Vamp for iPad listens on Wi-Fi as well as on the cable's loopback port, on
  a port of the system's choosing, advertised with Bonjour as
  `_vamplink._tcp` with its key's id in the TXT record
  (`LinkProtocol.bonjourType`, `txtKeyId`). The TLS is Network.framework's,
  TLS 1.2 with a pre-shared key derived from the pair's key
  (`LinkAuth.wifiPSK`, `NWParameters.wifiLink`): a device without the key
  cannot finish the handshake, and everything between the two is
  encrypted. Inside it the version 2 handshake runs as on the cable. No
  other cryptography, and no new protocol version.
- **The Mac dials, as on the cable.** Vamp for Mac browses for the service
  (`PadLink`), and dials only an iPad whose key id it has paired with: the
  Mac opens no port, so there is no firewall question on the Mac.
- **The Wi-Fi link never pairs** (a QR code pairs on a listener of its own,
  ADR-505). Both ends refuse it on the Wi-Fi link: the Mac
  denies an unknown key there instead of showing a code (`allowPairing:
  false`), the iPad closes a `PAIR` there and never sends its key. The
  unauthenticated version 1 link is never spoken there either
  (`legacyAllowed: { false }`). So ADR-494's accepted weakness (a stand-in
  for the Mac learning the code offline) stays confined to the cable.
- **Vamp for iPad listens on Wi-Fi only after it has linked by cable once**
  (`wifiLinkOn` in its defaults): iPadOS asks for the local network then,
  when there is a paired Mac to find, not at first launch. On the iPad it
  listens on the Wi-Fi interface only (any interface in the Simulator,
  whose network is the Mac's). Never on peer-to-peer Wi-Fi: a shared
  network only, as Ben's home and studio have.
- **The cable and Wi-Fi each hold their own control connection on the
  iPad** (`LinkServer.Transport`). A new page connection goes over the
  cable when it is linked, else Wi-Fi. **One already open is never moved:**
  plugging the cable in cuts nothing, so no gesture is cut mid-way by the
  switch; the page's socket moves to the cable only when it next
  reconnects. When Wi-Fi's control connection goes (silent 6 s, or ended),
  the page connections it carried are ended at once, so the page reconnects
  over the cable if it is there instead of waiting on a half-open socket.
- **Where it shows:** Vamp for Mac's menu says "iPad: connected by cable",
  "connected over Wi-Fi" or "connected by cable and Wi-Fi", and logs an
  unpaired iPad seen on Wi-Fi once ("plug it in once to pair"). Vamp for
  iPad's waiting screen, once Wi-Fi is on, says the cable or the Mac's
  Wi-Fi network will do.

## Consequences
- **Measured on this Mac:** 37 XCTests pass, 5 of them new
  (`WifiLinkTests`, over loopback): the link carries a page connection over
  Wi-Fi's TLS; plain TCP to the Wi-Fi port is never answered with the link
  (boringssl: `WRONG_VERSION_NUMBER`); a Mac holding another key cannot get
  through (`PSK_IDENTITY_NOT_FOUND`); neither end pairs over Wi-Fi; with
  Wi-Fi linked and a page connection held open, linking the cable leaves it
  working and the next connection takes the cable; switching Wi-Fi off ends
  its page connections in under a second.
- **Measured with the Simulator:** Vamp for iPad listened on Wi-Fi and
  advertised; `dns-sd` saw `Vamp 105526._vamplink._tcp` with its key id;
  Vamp for Mac (run with `VAMP_FROM_NPM=1`) found it and logged it as not
  paired, dialling nothing. The Simulator was not paired with this Mac, so
  a whole link through Bonjour was not run.
- **Not yet measured on a real iPad:** the iPadOS local network prompt,
  the link over the home network, a walk out of range and back, the cable
  plugged in mid-set, and latency over Wi-Fi against the cable. The rig
  checklist (§15) has the steps.
- macOS may ask Vamp for Mac for the local network when it first browses;
  an ad-hoc signed build from a checkout may be asked again after it
  rebuilds itself.
- With two paired Macs running Vamp on one network, the first to reach the
  iPad over Wi-Fi holds it; the other retries every 5 s (a link the iPad
  drops within 3 s redials slowly, `slowAfterShortLink`) and logs each try.
- `ITSAppUsesNonExemptEncryption` stays false: the encryption is Apple's own
  TLS in the operating system, which is exempt. App Store Connect's export
  question is answered the same way.
- An iPad that has linked by cable keeps listening on Wi-Fi when it is
  forgotten on the Mac; the Mac then sees an unpaired iPad and dials
  nothing until it pairs again by cable.

## Tags
`ipad`, `native-app`, `wifi`, `link`, `security`, `bonjour`, `tls`
