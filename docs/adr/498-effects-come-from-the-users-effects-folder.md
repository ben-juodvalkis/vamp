# ADR-498: Effects Come From the User's Effects Folder

## Status
**Accepted** (2026-11-01). Amends [ADR-493](493-live-categories-on-the-browser-rail.md)
(the effects Place is now a Settings choice), [ADR-445](445-expression-pedal-rack-on-midi-tracks.md)
(the head-of-chain Wah is matched by file name) and the general-release plan's
"one Place" (Vamp Devices holds utilities only). The interface takes it on its
next load; the surface half (the Wah's path and head placement) after a full
Live restart.

## Context
Every Vamp effect tile — Guitar, Bass Amp, Wah, Tone Shaper, Comb, Pitch Hack,
GlitchLoop, Blur, Pitch Shift (the Octave until today), Note Chance — loaded a
fixed file from "Vamp Devices", the folder that also holds the app's plumbing
(Permute, random start, the recorder, the groove, MidiWheels). Those effects
are the owner's, not central to Vamp. A new user should bring their own
preferred effects and see nothing of the owner's; + Effect could already open
a named folder (`catalog.effectsPlace`), but only from the config file, and the
tiles ignored it.

## Decision
- **Settings → Places has an Effects folder choice**: Live's Audio Effects (the
  default), or any sidebar Place or the User Library. Saved on the Mac in
  `logs/effects.json` beside the ticks (`server/places/effectsChoice.ts`,
  `PUT /api/places/effects`); with nothing saved, `catalog.effectsPlace`
  decides, as before.
- **Vamp's own effects are found by name in that folder.** The places index
  entry for the effects folder carries its files by name
  (`PlaceInfo.devices`, file name without the extension → path inside the
  folder); `services/effectSources` matches a `DEVICE_PRESETS` entry marked
  `effect: true` by its `defaultName` or an alias, and the load names that
  folder and path. Native devices and Permute are unaffected.
- **Nothing is ever offered for a file that is not on the Mac.** An effect not
  in the folder has no chain ghost; a central view of one that is neither on
  the chain nor in the folder is left (`CentralDisplay`); a chain recent whose
  file is gone is dropped from the list at startup and on every catalog change
  (`recentEffects.pruneMissingRecents`, `POST /api/places/exists`, preset files
  only). The load's refusal ("Not in your effects folder") is only a backstop
  for a folder changed mid-tap.
- **Vamp Devices holds only utilities**: Permute, MidiWheels, random start,
  Vamp-Capture, Vamp-Recorder, the groove, the abstractions. The effects left
  the repo; on the owner's Mac they live on the Audio-Midi Effects shelf (which
  already held hard links of the same files), chosen as the effects folder.
- **Names follow the files.** The shelf calls the Tone Shaper "Tone
  Shaper.amxd" (an alias), and the Octave is renamed **Pitch Shift**
  throughout (its shelf file's name; "Octave" stays an alias so devices in
  saved sets are still recognized; the internal key stays `octave`).
- **The Wah at the head of the chain by file name.** A track load of any file
  named `Wah.adg` lands at the head of the audio effects (ADR-445's
  placement), wherever it lives. The pedal's own Wah is `devices.wah.presetPath`
  only (the owner's local config names the shelf's); the checkout fallback is
  gone. The pedal is owner-only (`features.expressionPedal`).

## Consequences
- A general-edition user sees Live's effects and the Vamp utilities; Vamp's
  own effect tiles appear once their files are in the chosen folder.
- Saved sets that pointed at the removed files (37 sets of one project, for
  Tone Shaper, GlitchLoop and Octave) got copies in their project folder, to
  relink with Live's search. The Bass Amp rack references the old Octave path
  and is relinked and re-saved once.
- The owner's Tone Shaper, glitchloop and BensWahPedal builds that copied into
  Vamp Devices now copy to the shelf.

## Tags
`effects`, `places`, `settings`, `vamp-devices`, `general-release`, `wah`
