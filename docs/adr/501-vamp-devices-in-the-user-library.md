# ADR-501: Vamp Devices in the User Library, No Place Needed

## Status
**Accepted** (2026-11-01). Amends [ADR-500](500-the-installed-app.md): the
installed app no longer asks where Vamp Devices goes, and the utilities load
without a Place. The surface half takes effect after a full Live restart.

## Context
Vamp's utilities (Permute, MidiWheels, the recorder, Random Start, the groove)
loaded only through a Place named "Vamp Devices", so every user had a manual
step in Live's browser, and without it those features hid. The installer asked
where the folder should go and needed the Place either way. Ben chose, of
three: search on load, with the User Library as the installed default (over
User Library only, which would strand the rig's Place, and over keeping the
choice, which kept the step).

## Decision
- **A load names the Place, and finds the User Library copy without one.**
  `BrowserCache.root_path("place:Vamp Devices")` answers the Place's folder
  when Live lists one, else `<User Library>/Vamp Devices` when it exists;
  Live's browser lists the User Library, so the path lookup that follows a
  named miss finds the file. Every load of a utility goes through it: the
  surface's own (Permute on prep, MidiWheels), and the page's and the bridge's
  `place:Vamp Devices` + `rel` loads (Permute in + Effect, Random Start, the
  recorder), whose empty preset path is filled from it.
- **The server says the same.** The listing's `m4lDevices` counts the User
  Library copy (`place: "User Library"`, `exact: false`) when no Place holds
  the folder, so REC, the wheels and Permute show.
- **The installed app always copies Vamp Devices into the User Library**,
  with no question. A 1.0 install that chose another folder keeps it (and its
  Place).
- **Settings counts the step optional** and names both ways in: a Place, or
  the folder in the User Library.

## Consequences
- An installed Vamp needs two steps in Live: pick the control surface,
  restart. Nothing to add to Places.
- The rig keeps its Place, which wins over any User Library copy.
- **Not yet measured:** whether Live lists and loads a file copied into the
  User Library while it runs, without a restart (the surface's cache rewalks a
  root at most every 10 s on a miss).

## Tags
`installer`, `vamp-devices`, `places`, `general-release`
