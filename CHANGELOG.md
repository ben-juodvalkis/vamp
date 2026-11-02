# Changelog

All notable changes to Vamp are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Vamp continues a private project, Looping, whose history stays there. This repository's history
starts on 2026-09-27. These versions are Vamp for Mac's; Vamp for iPad keeps its own (1.0 on the
App Store).

## [1.1] - 2026-11-01

### Changed

- Vamp for Mac puts the Vamp Devices folder in Live's User Library without asking where it goes,
  and Live reaches it there with nothing to add to the browser. A 1.0 install keeps the folder it
  chose.
- Permute, the on-screen wheels, the recorder and Random Start load from a "Vamp Devices" Place if
  Live has one, otherwise from the User Library copy (ADR-501).
- Setup in Live is two steps: pick Vamp as a Control Surface, then restart Live. Adding Vamp Devices
  to Places is optional.
- In a medium or narrow effect-chain cell, Permute draws its mute row alone, at a size you can tap;
  a wide, tall cell keeps the pitch row too.

### Fixed

- The release build copies Vamp Devices without Finder metadata.

Vamp 1.0 updates itself to 1.1 (Check for Updates… in Vamp's menu). Restart Live afterwards to load
the new control surface.

## [1.0] - 2026-11-01

The first downloadable Vamp: live looping for Ableton Live, played from an iPad.

### Added

- Vamp.dmg: Vamp for Mac, notarized by Apple, for Apple Silicon and Intel on macOS 14 or later. It
  lives in the menu bar, carries its own Node and server, checks for updates itself and has
  Uninstall in its menu. Needs Ableton Live 12.4 Suite.
- On first launch it puts the control surface and Vamp Devices in place (ADR-499, ADR-500).
- Vamp for iPad pairs with Vamp for Mac once over USB-C; Safari on the iPad can open the interface
  from the QR code in Vamp's menu instead.

[Unreleased]: https://github.com/ben-juodvalkis/vamp/compare/v1.1...HEAD
[1.1]: https://github.com/ben-juodvalkis/vamp/compare/v1.0...v1.1
[1.0]: https://github.com/ben-juodvalkis/vamp/releases/tag/v1.0
