# ADR-500: The Installed App: First Launch, Optional Vamp Devices, Updates

## Status
**Accepted** (2026-11-01); where Vamp Devices goes and how it loads amended by
[ADR-501](501-vamp-devices-in-the-user-library.md). Phases 3–5 of
[installer.plan.md](../plans/general-release/installer.plan.md), on
[ADR-499](499-one-data-folder.md)'s three folders. Nothing changes on a
checkout except that REC, the wheels and Permute now hide while Live has no
Vamp Devices Place, which the rig always has.

## Context
A new user should get Vamp from a download, not a clone: no Node, git or
Terminal. Vamp Devices is optional (Ben, 2026-10-31), the user picks where it
goes (2026-11-01), and only Live may change its own control surfaces and
Places.

## Decision
- **Vamp for Mac carries everything:** its own Node (universal, signed with
  the hardened runtime and V8's two entitlements), the standalone server
  (`npm run build:server`), the control surface and Vamp Devices. Installed
  (no checkout recorded, the server inside the bundle), it runs that Node on
  `vamp-server.mjs`; from a checkout it runs `npm run ipad`, as before.
- **First launch** asks once where Vamp Devices goes (the Music folder, the
  User Library, or a folder picked) and copies it there, refreshing what it
  ships and keeping the user's files. It copies the surface into
  `<User Library>/Remote Scripts/Vamp` with `vamp-paths.json`, never over a
  symlink, and only when the version changed. The menu says what Live still
  needs and lists the setup steps, each ticking itself: the surface answering,
  the Place in the listing, an iPad paired.
- **The utilities hide until Vamp Devices is a Place:** REC, the on-screen
  wheels and Permute in + Effect, from the listing's `m4lDevices`
  (`effectSources.vampDevicesAvailable`). Unknown counts as there, so nothing
  flickers on a rig that has the Place. A copy inside the User Library that
  is not a Place counts as missing: the utilities load through the Place.
- **Updates with Sparkle**, prebuilt and pinned (`scripts/fetch-sparkle.sh`;
  Xcode's package fetch of it stalled), started only when installed. The feed
  is the latest GitHub release's `appcast.xml` (the repo is public; no site
  needed), EdDSA-signed with a key kept in the release Mac's keychain. An
  update that changes the surface says "restart Live to finish updating".
- **The release** is `scripts/release-mac.sh`: Developer ID, a dmg with an
  Applications link, notarized and stapled, and the appcast. Publishing is a
  GitHub release tagged `v<version>` with both files, done by hand. It
  replaces fastlane's `mac notarized` lane, which built the app alone.
- The menu also shows the iPad's address as a QR code, and installed,
  Check for Updates and Uninstall (the surface goes, the data folder only if
  the user says, Vamp Devices stays).

## Consequences
- Every app build fetches Sparkle once (16 MB) into `owner/apps/Vendor/`,
  the rig's self-rebuild included.
- The app is 243 MB unpacked, Node 217 MB of it.
- The surface still loads the utilities by the Place's name, so the
  installer's User Library choice still needs the Place added.

## Tags
`installer`, `general-release`, `vamp-for-mac`, `sparkle`
