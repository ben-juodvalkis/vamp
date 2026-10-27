# Instrument parameter reference

Every native instrument the app draws a view for, read off the running Live
on the rig (2026-10-27) with `owner/probes/device_dump.js`: each parameter's
LOM index, name, range, default, whether it is quantized and Live's own
labels for it, and every other attribute of the device with whether it is
settable and observable. One page per instrument below, and the raw dumps in
[`dumps/`](dumps/) (the probe's JSON, labels included).

Measured, not read from docs: insert the device on a scratch MIDI track
(`Track.insert_device`), dump it, delete it. The Drum Sampler and the
Multisample-Mode Simpler were read in place on a kit's pad
(`tracks/N/devices/M/pads/<note>/devices/0`). To re-measure one, see the
`device-dump` skill. Plug-ins (Omnisphere, Komplete Kontrol) cannot be
inserted by name and are not here.

| Instrument | Class | Display name | Params | Attributes |
|---|---|---|---|---|
| [Analog](Analog.md) | `UltraAnalog` | Analog | 172 | 11 |
| [Collision](Collision.md) | `Collision` | Collision | 140 | 11 |
| [Drift](Drift.md) | `Drift` | Drift | 66 | 40 |
| [Electric](Electric.md) | `LoungeLizard` | Electric | 34 | 11 |
| [Meld](Meld.md) | `InstrumentMeld` | Meld | 129 | 15 |
| [Operator](Operator.md) | `Operator` | Operator | 195 | 11 |
| [Wavetable](Wavetable.md) | `InstrumentVector` | Wavetable | 93 | 26 |
| [Simpler](Simpler.md) | `OriginalSimpler` | Simpler | 63 | 47 |
| [Simpler (no sample)](Simpler_nosample.md) | `OriginalSimpler` | Simpler | 63 | 25 |
| [Simpler (Multisample Mode)](Simpler_multisample.md) | `OriginalSimpler` | Simpler | 33 | 25 |
| [Sampler](Sampler.md) | `MultiSampler` | Sampler | 70 | 11 |
| [Sampler (every section on)](Sampler_all_sections.md) | `MultiSampler` | Sampler | 157 | 11 |
| [Drum Sampler](Drum_Sampler.md) | `DrumCell` | Drum Sampler | 40 | 12 |
| [Drum Rack](Drum_Rack.md) | `DrumGroupDevice` | Drum Rack | 17 | 22 |
| [Instrument Rack](Instrument_Rack.md) | `InstrumentGroupDevice` | Instrument Rack | 18 | 31 |

## Simpler, Sampler and Multisample Mode

Live's class names are not the names on screen: **Simpler is
`OriginalSimpler`, Sampler is `MultiSampler`**, Drum Sampler is `DrumCell`,
Electric is `LoungeLizard`, Analog `UltraAnalog`, Wavetable
`InstrumentVector`, Meld `InstrumentMeld`.

**A Simpler in Multisample Mode is still `OriginalSimpler`.** Nothing in its
class says it holds several samples. Measured on pad 36 of the 32 Pad Kit
Jazz (31 of its 32 pads are these, the 32nd a Sampler):

| | `class_name` | `multi_sample_mode` | `sample` | Parameters |
|---|---|---|---|---|
| Simpler with a sample | `OriginalSimpler` | False | a `Sample` | 63 |
| Simpler, empty | `OriginalSimpler` | False | None | 63 |
| Simpler in Multisample Mode | `OriginalSimpler` | **True** | **None** | 33 (sections off) |
| Sampler | `MultiSampler` | (no such attribute) | (no such attribute) | 70 → 157 |

- **The tell is `multi_sample_mode`**, not `sample`: an empty Simpler has
  no sample too. A Multisample-Mode Simpler has none of the sample-level
  attributes (`sample.*`: start and end, warp, slices, gain), so anything
  reading the sample (the waveform, slicing, Live's similar-sample swap
  buttons, which are disabled on these pads) has nothing to read.
- Its parameters are a Simpler's, not a Sampler's: no Osc, Shaper, LFO 2–3
  or Aux Env.
- Its 33 parameters are **not** a Multisample-Mode limit: that pad had Pitch
  Env, Filter and LFO switched off, and a Simpler drops a section's
  parameters while it is off (next section).

## Parameter lists that change shape

**Simpler and Sampler list a section's parameters only while that section
is on**, and every index after it shifts. Resolve their parameters by name,
never by an index read off another device or off the same one earlier.

| Device | Section switches (index: name) |
|---|---|
| Simpler, all on (63) | 5 S Loop On, 14 Pe On, 36 F On, 45 Fe On, 54 L On |
| Simpler, Pe / F / L off (33) | 5 S Loop On, 14 Pe On, 31 F On, 32 L On |
| Sampler as inserted (70) | 4 Osc On, 14 Pe On, 37 F On, 46 Fe On, 65 Shaper On, 66–68 L 1–3 On, 69 Ae On |
| Sampler, every section on (157) | 4 Osc On, 9 O Fix On, 37 Pe On, 75 F On, 84 Fe On, 103 Shaper On, 107 L 1 On, 116 L 2 On, 129 L 3 On, 142 Ae On |

Filter on Simpler moves from 36 to 31 when Pitch Env is off; Sampler's
Pitch Env switch moves from 14 to 37 when Osc is on. Whether any other
instrument here changes its list with its settings was not tested: each was
dumped once, at Live's defaults.

The racks' parameters are their macros (Device On, then Macro 1–16, plus
the Instrument Rack's Chain Selector); everything else about them is in
their chains.
