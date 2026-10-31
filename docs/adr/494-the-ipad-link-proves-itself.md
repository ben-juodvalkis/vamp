# ADR-494: The iPad Link Proves Itself: Paired Once, Proved on Every Link

## Status
**Accepted** (2026-10-31). Vamp for Mac takes it when it is next opened
from the Dock (it rebuilds itself). Vamp for iPad takes it when it is next
installed from Xcode. No Live restart.

## Context
Vamp for Mac relays everything that comes over the link from Vamp for iPad
to the page server on loopback, and the page server trusts loopback as the
Mac itself (ADR-491). The native apps audit (2026-10-31) found what the link
trusted in turn: anything that spoke its one-line protocol.

- **Another app on the iPad could stand in for Vamp for iPad.** The Mac
  dialled port 47800 on the iPad every second and adopted whatever answered,
  splicing each `OPEN` to the page server: that app could drive Live.
- **Another app on the iPad could stand in for the Mac.** The newest control
  connection won. Measured over loopback with the real code: a third party's
  `VAMPLINK 1 CONTROL` displaced the Mac, was told `OPEN 3` for the next page
  connection, and could have served anything into Vamp's web view. Stream ids
  counted up from 1.

The audit's first round (54edee1, no protocol change) already refused a second
control connection while the first is working, made stream ids random and
logged the link. This is the rest: the link proves who is on each end.

## Decision
- **Version 2 of the link has a handshake** (`Shared/LinkProtocol.swift`,
  `LinkAuth.swift`). Vamp for iPad makes a 32-byte key once and keeps it in
  its Keychain (`Pad/LinkKeychain.swift`); Vamp for Mac keeps the keys of the
  iPads it has paired with in `~/Library/Application Support/Vamp/
  paired-ipads.json`, mode 0600 (`Mac/PairedIPads.swift`).
  - Every control connection opens with both ends' fresh nonces. The iPad
    proves it holds a key the Mac knows; the Mac proves it back. Each proof
    is an HMAC-SHA256 over its role and both nonces, so none can be replayed
    or passed off as the other end's. Only then is the connection the link.
  - Every stream carries a tag only the paired Mac in this session can make,
    so another app cannot claim a page connection even by guessing its id.
- **An iPad the Mac does not know pairs once.** The Mac shows a six-digit
  code in the menu bar itself, beside a key (Ben, 2026-10-31: no menu to
  open), and in its menu; Vamp for iPad asks for it. Each end proves it knows the code before the iPad hands over its key,
  so a stand-in for the Mac never receives it. Five wrong codes end the
  pairing; the next link brings a new code. "Forget Paired iPads" in the
  menu makes every iPad pair again.
- **The Vamp for iPad already installed keeps working.** It closes on the
  new hello without a word; the Mac then speaks version 1 to it,
  unauthenticated, and the menu says "connected by cable, unauthenticated —
  update Vamp for iPad". Every new link tries version 2 first.
- **An iPad that has paired is never downgraded.** The Mac records the
  iPad's serial number (usbmux's `SerialNumber`) with its key and refuses
  version 1 for it.

## Consequences
- Another app on the iPad gets neither end of the link. The tests cover it
  (`LinkTests`): a stand-in for the Mac without the key is not linked and
  is told of no stream; a stand-in for the iPad naming a known key is denied;
  a stream without the session's tag is closed; pairing with the code links
  and is remembered by serial, on disk; five wrong codes end the pairing;
  an older iPad app gets version 1 and the Mac says so; an iPad that has
  paired is never offered version 1. 26 tests.
- **Accepted:** a stand-in for the Mac that a person feeds the code to could
  learn the code from the iPad's proof (six digits, tried offline). It would
  need the person to type a code the real Mac is showing into a pairing the
  stand-in started, while the real Mac is not linked; the Mac's menu bar and
  menu are the only places a code appears.
- **Not yet done:** version 1 is refused only for iPads that have paired.
  Once the rig's iPad runs the new app, version 1 can be removed outright.
- Not measured on a real iPad: the pairing screen, and the Keychain key
  surviving a reinstall from Xcode. The Simulator (`VAMP_LINK_DIRECT=1`)
  pairs like a device with no serial number.
- `ITSAppUsesNonExemptEncryption` stays false: HMAC authentication is not
  encryption for export purposes.

## Tags
`ipad`, `native-app`, `security`, `link`, `pairing`, `usbmux`
