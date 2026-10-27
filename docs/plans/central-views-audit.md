# Central views: layout and UX audit (2026-10-27)

Every view registered in `central/viewRegistry.ts`, judged from the
mock-surface screenshots at the 12.9-inch iPad (1366x1024) and the three
smaller ones (mini 1133x744, 10.2-inch 1080x810, 11-inch 1180x820). No Live,
bridge or iPad: layout and presentation only, so a value the mock does not
carry (a GlitchLoop preset bank, a Comb's real rate) can draw emptier than
on the rig.

## Reproducing the pictures

The PNGs are gitignored; these commands rebuild them.

```bash
npm run shot:tour -- central                                    # screenshots/tour/central/
npm run shot:tour -- central --viewport 1133x744 --out-dir screenshots/audit/central-1133x744
npm run shot:tour -- central --viewport 1080x810 --out-dir screenshots/audit/central-1080x810
npm run shot:tour -- central --only view- --out-dir screenshots/audit/views-1366x1024
npm run shot:tour -- central --only view- --viewport 1133x744 --out-dir screenshots/audit/views-1133x744
```

Paths below are relative to `screenshots/`. Pixel sizes are CSS px (a
capture is 2x): the central band is about 1062 x 330 at 1366x1024 and
850 x 236 on the mini.

**New tour states (this branch, before the audit).** Nineteen views were
reachable only through the `chain` tour's full-screen shots, or not at all:
Compressor, Gate, Phaser, Utility, Arpeggiator, Velocity, Tone Shaper, Blur,
Digital, Wah, Bass Amp and the Pedal had no state anywhere. They are now
`view-<key>` states of the `central` tour, cropped and layout-checked like
the rest (`CHAIN_VIEW_DEVICES` and `VIEW_ONLY_DEVICES` in
`scripts/shot/views.mjs`, opened from their chain cell). Their scenes carry
little more than Device On, so they show layout, not values.

## What runs through many views

1. **A label struck through by the fill line.** When a box's value sits near
   the label's middle, the fill edge cuts the word in half (Glitch "Clock",
   Random "Choices 12", Sampler kit "Spread", Echo "Mix", Wavetable "Time",
   Meld "Spread", Drift "Noise", every Komplete Kontrol and Instrument Rack
   macro in the mock, Clip "Pitch 0", Pedal "Tone"). The two-layer label
   inverts correctly, but a word split at its x-height reads as struck out.
   This is `DeviceSlider`'s, not any one view's. *Not fixed here*: it wants
   one decision (nudge the label off the fill edge, or draw the fill edge
   behind a gap as `handleLine` does) and touches every slider in the app.
2. **Values you can't read without dragging.** Most value boxes are titled
   with the parameter's name, and `readout` (Live's own string) only shows
   while a finger drags it. Chord, Reverb, Echo's Time and Rate, the Clip
   view's Pitch and System's transport are the exceptions, formatting the
   value themselves. Turning a name into a value needs a formatter per
   parameter, which belongs in `deviceControls.ts` / `*Params.ts` (house
   rule), so it is listed, not done.
3. **Wide-and-short value boxes** (the failure mode ChordCentralView just
   fixed). Worst: Channel EQ (a 1000 x 120 switch over a 1000 x 120
   slider), Instrument Rack (six macros 320 x 115), Komplete Kontrol (eight
   params 226 x 140), Operator (ADSR 105 x 75, then 145 x 95; 50 tall on the
   mini, the glyph colliding with the letter), Utility and Chance (one
   slider the whole band wide), Analog's Level row (185 x 37).
4. **Small iPads.** At 1133x744 the band is 236 tall and every view goes
   compact (ADR-476). What breaks there: Drift's Time pad clips its own
   label, Operator's envelope boxes reach 50px tall, Analog's VOICE badge
   overflows its circle and its Sub/Sync and Level rows fall to ~30-38px,
   the Auto Filter's Time chip pokes over the frame's top edge, a Drum Rack
   pad strip's "Bar" caption sits on its box's border (a layout-check
   failure), and preset pills truncate to "Auror…" / "N…".
5. **Overlays on controls.** The Clip view's pencil (top right) covers the
   corner of the rightmost control (Temp / Gain); the Auto Filter's Time
   chip covers the LFO pad's corner; the Arpeggiator's swap arrows sit on
   its Pattern pad's border.
6. **House-rule debt** (not layout, listed for the record): parameter
   indices written in components — `EQCentralView` (`PARAM_CONFIG`),
   `RandomCentralView`, `ReduxCentralView`, `PedalCentralView`; Komplete
   Kontrol paints a hard-coded `#00D4FF`; Glitch and Variation set
   `data-density="compact"` though their control count is fixed (ADR-434
   reserves it for counts that come from what is loaded).

## Per view, ranked

Rank 1 = fix now (a clear failure of the stated rules); 2 = worth doing,
smaller; 3 = minor or cosmetic; — = fine.

| Rank | View | Problems (PNG) |
|---|---|---|
| 1 | **Channel EQ** `EQCentralView` | Two full-width rows: Low Cut a 1000 x 120 switch, Output a 1000 x 120 value box sweeping sideways. The most extreme wide-and-short in the app; on the mini both are ~95 tall. An "EQ" eyebrow over a one-device view says nothing the ink does not. (`tour/central/fx-eq.png`, `audit/central-1133x744/fx-eq.png`) |
| 1 | **Instrument Rack** `InstrumentRackCentralView` | Macros in two rows filled column by column even when there are six: 320 x 115 boxes, labels split by the fill. One row of tall boxes fits up to eight. (`inst-instrument-rack.png`) |
| 1 | **Komplete Kontrol** `KompleteKontrolCentralView` | Eight params as 4 x 2 boxes of 226 x 140; in one row they are 120 x 300, Chord's shape. (`inst-komplete-kontrol.png`) |
| 1 | **Operator** `OperatorCentralView` | Left half: pill, then ADSR as 105 x 75 boxes, then Feedback / Time / Tone as 145 x 95 with "Feedback" clipped at the box edge; on the mini the ADSR boxes are 50 tall and each glyph sits on its letter. The right half is one Filter pad. Seven value boxes and a pad fit one ruler of tall boxes. (`inst-operator.png`, `audit/central-1133x744/inst-operator.png`) |
| 1 | **Drift** `DriftCentralView` | The Time and Filter pads are stacked wide-and-short (370 x 100; 325 x 75 on the mini), and the Time pad's label is cut off by its own bottom edge at both sizes. (`inst-drift.png`, `audit/central-1133x744/inst-drift.png`) |
| 1 | **Groove** `GrooveCentralView` | Empty state ("No grooves are ticked") is a paragraph that stops short of the Amount seam: the layout check fails (552px against a 16px gap) at every size. (`groove.png`) |
| 2 | **Analog** `AnalogCentralView` | Densest view. At 1366: Sub/Sync chips, the → F1 chip and Level row are 37-40 tall (under the 44 floor), Level sweeps sideways; preset pill truncates. On the mini the VOICE badge overflows its circle and Level is ~30 tall. (`inst-analog.png`, `audit/central-1133x744/inst-analog.png`) |
| 2 | **Auto Filter** `AutoFilterCentralView` | The Time chip floats over the LFO pad's top-right corner and, on the mini, over the frame's edge; the "12" value box is a lone stub under the type column. (`fx-filter.png`) |
| 2 | **Clip** `ClipCentralView` | The editor pencil overlaps the rightmost control's corner on every clip state; "Pitch 0" is struck through by its centre line. (`clip-midi.png`, `clip-audio.png`) |
| 2 | **Tremolo** `AutoPanCentralView` | Rate is a 475 x 220 box under a 475 x 44 Sync bar; shape options are 475 x 60 rows. A "Tremolo" eyebrow on a one-device view. Usable, but the widest controls in the FX set after EQ. (`fx-tremolo.png`) |
| 2 | **Utility** `UtilityCentralView`, **Note Chance** `ChanceCentralView`, **Wah** `WahCentralView` | One slider across the whole band (1000 x 290), sweeping sideways. A single value box could stand narrower, but then the band is mostly empty: the honest fix is a decision about one-control views, not a layout tweak. (`audit/views-1366x1024/view-utility.png`, `view-chance.png`, `view-wah.png`) |
| 2 | **Compressor** `CompressorCentralView` | Half the view is the sidechain chooser's empty state ("No sidechain sources available", a line of text in 480 x 200 of dead space) over a ghosted sidechain Cutoff bar of 480 x 70 sweeping sideways. (`audit/views-1366x1024/view-compressor.png`) |
| 2 | **Drum Rack** `DrumRackCentralView` | Mini, pad latched on a 2-bar clip: the "Bar" caption sits on its box's top border (layout check fails). The pad mixer's M chip is 42 tall. Simpler/rack kits truncate the preset pill to "N…". (`audit/central-1133x744/drumrack-pad-notes-2bars.png`, `drumrack-pad-mixer.png`) |
| 3 | **Glitch** `GlitchCentralView` | The preset bank is an empty framed box when no bank is loaded (no empty state); compact density on a fixed count; Clock's label struck at the fill. (`fx-glitch.png`) |
| 3 | **Wavetable** `WavetableCentralView` | Dense but legible; "Time" and "Filter 1" struck by their lines; Fx 1 a narrow stub. (`inst-wavetable.png`) |
| 3 | **Velocity** `VelocityCentralView` | Rand Vel a wide box beside the output range; fine at 1366. (`view-velocity.png`) |
| 3 | **Simpler** `SimplerCentralView` | Preset pill "A…"; Rev a lone small label among big ones. (`inst-simpler.png`) |
| 3 | **Echo**, **Random**, **Reverse**, **Sampler kit** | Fill line through a label (above, item 1). Otherwise sound. |
| 3 | **Tone Shaper** `ToneShaperCentralView` | Graph captions (band frequencies, Amount 0.0) are ~8px: unreadable at arm's length. (`view-tone-shaper.png`) |
| — | Chord, Shifter, Reverb (all tabs), Saturator ("fx-pedal"), Pedal, Guitar, Drum Buss, Glue, Multiband, Pitch, Variation, Random, Permute, System, Meld, Omnisphere, Sampler, Collision, Electric, Pattern Rack, Comb, Chorus, Redux, Arpeggiator, Gate, Phaser, Blur, Digital, Bass Amp | No problem beyond the cross-cutting ones. Single-XY views (Gate, Phaser, Blur, Digital, Bass, Collision) are one pad the band wide, which is what an XY should be. |

## Missing controls (listed, not added)

- Channel EQ: Low, Mid (with Mid Freq) and High gains, Live's three bands,
  are not drawn; the view has Low Cut and Output only.
- Tremolo (Auto Pan): Amount lives only on the chain cell's Y axis; the view
  has no Amount box (nor Phase / Offset).
- Compressor: no Ratio, Attack or Release in the view (the chain cell's
  transfer curve is the only reading of the ratio).
- Utility: Width and Mono/Bass Mono are not drawn.

## Fix plan (Phase 2, one view per commit)

Rank 1, in order: Channel EQ, Instrument Rack, Komplete Kontrol, Operator,
Drift, Groove. Then rank 2 where the fix is local and safe: Auto Filter's
Time chip, the Clip view's pencil, Analog's sub-44 rows, the Drum Rack's
Bar caption. Left alone: the fill-line label (item 1)
and readouts at rest (item 2), both `DeviceSlider`-wide decisions for Ben;
one-control views (Utility, Chance, Wah), which need a decision rather than
a layout.
