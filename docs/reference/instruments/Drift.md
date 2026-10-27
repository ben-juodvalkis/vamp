# Drift

`Drift` ("Drift"), Python `DriftDevice`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, factory default. Raw dump: [`dumps/Drift.json`](dumps/Drift.json).

## Parameters (66)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | LP Freq | 0..1 | 1 |  | 0=20.0 Hz · 0.25=112 Hz · 0.5=632 Hz · 0.75=3.56 kHz · 1=20.0 kHz |
| 2 | LP Res | 0..1 | 0 |  | 0=0.00  · 0.25=0.25  · 0.5=0.50  · 0.75=0.76  · 1=1.01  |
| 3 | LP Type | 0..1 |  | q | 0=I · 1=II |
| 4 | HP Freq | 0..1 | 0 |  | 0=10.0 Hz · 0.25=67.3 Hz · 0.5=453 Hz · 0.75=3.04 kHz · 1=20.5 kHz |
| 5 | Key > LPF | 0..1 | 0 |  | 0=0.00  · 0.25=0.25  · 0.5=0.50  · 0.75=0.75  · 1=1.00  |
| 6 | LP Mod Amt 1 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % |
| 7 | LP Mod Amt 2 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % |
| 8 | Osc 1 Flt On | 0..1 |  | q | 0=Off · 1=On |
| 9 | Osc 2 Flt On | 0..1 |  | q | 0=Off · 1=On |
| 10 | Noise Flt On | 0..1 |  | q | 0=Off · 1=On |
| 11 | LFO Mode | 0..3 |  | q | 0=Freq · 1=Time · 2=Ratio · 3=Sync |
| 12 | LFO Freq | 0..1 | 0.0573988 |  | 0=0.17 Hz · 0.25=2.65 Hz · 0.5=20.0 Hz · 0.75=168 Hz · 1=1.70 kHz · 0.113181=0.40 Hz |
| 13 | LFO Ratio | 0..1 | 0.047619 |  | 0=0.25  · 0.25=4.19  · 0.5=8.12  · 0.75=12.06  · 1=16.00  · 0.047619=1.00  |
| 14 | LFO Time | 0..1 | 0.29617 |  | 0=100 ms · 0.25=602 ms · 0.5=5.58 s · 0.75=22.3 s · 1=60.0 s · 0.29617=1.00 s |
| 15 | LFO Synced | 0..21 | 15 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 16 | LFO Amount | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 17 | LFO Wave | 0..8 |  | q | 0=Sine · 1=Triangle · 2=Saw Up · 3=Saw Down · 4=Square · 5=Sample & Hold · 6=Wander · 7=Linear Env · 8=Exponential Env |
| 18 | LFO Mod Amt | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % |
| 19 | LFO Retrig On | 0..1 |  | q | 0=Off · 1=On |
| 20 | Osc 1 Wave | 0..6 |  | q | 0=Sine · 1=Triangle · 2=Shark Tooth · 3=Saturated · 4=Saw · 5=Pulse · 6=Rectangle |
| 21 | Osc 1 Shape | 0..1 | 0 |  | 0=0.00  · 0.25=0.25  · 0.5=0.50  · 0.75=0.75  · 1=1.00  |
| 22 | Osc 1 Oct | -2..3 | 0 |  | -2=-2  · -1=-1  · 0=0  · 1=1  · 2=2  · 3=3  |
| 23 | Osc 1 Shape Mod Amt | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % · 0.525=5.0 % |
| 24 | Osc 2 Wave | 0..4 |  | q | 0=Sine · 1=Triangle · 2=Saturated · 3=Saw · 4=Rectangle |
| 25 | Osc 2 Detune | 0..1 | 0.5 |  | 0=-7.00  · 0.25=-0.88  · 0.5=0.00  · 0.75=0.88  · 1=7.00  |
| 26 | Osc 2 Oct | -3..2 | -1 |  | -3=-3  · -2=-2  · -1=-1  · 0=0  · 1=1  · 2=2  |
| 27 | Pitch Mod Amt 1 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % |
| 28 | Pitch Mod Amt 2 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % |
| 29 | Osc 1 Gain | 0..1 | 0.547833 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-7.9 dB · 0.75=0.4 dB · 1=6.0 dB · 0.547833=-6.0 dB |
| 30 | Osc 2 Gain | 0..1 | 0.547833 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-7.9 dB · 0.75=0.4 dB · 1=6.0 dB |
| 31 | Osc 1 On | 0..1 |  | q | 0=Off · 1=On |
| 32 | Osc 2 On | 0..1 |  | q | 0=Off · 1=On |
| 33 | Noise Gain | 0..1 | 0 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-7.9 dB · 0.75=0.4 dB · 1=6.0 dB |
| 34 | Noise On | 0..1 |  | q | 0=Off · 1=On |
| 35 | Env 1 Attack | 0..1 | 0.110757 |  | 0=0.00 ms · 0.25=58.6 ms · 0.5=1.88 s · 0.75=14.2 s · 1=60.0 s · 0.110757=1.00 ms |
| 36 | Env 1 Decay | 0..1 | 0.397448 |  | 0=5.00 ms · 0.25=63.6 ms · 0.5=1.88 s · 0.75=14.2 s · 1=60.0 s · 0.397448=600 ms |
| 37 | Env 1 Release | 0..1 | 0.396784 |  | 0=10.0 ms · 0.25=68.6 ms · 0.5=1.88 s · 0.75=14.2 s · 1=60.0 s · 0.396784=600 ms |
| 38 | Env 1 Sustain | 0..1 | 0.7 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 39 | Env 2 Attack | 0..1 | 0.110757 |  | 0=0.00 ms · 0.25=58.6 ms · 0.5=1.88 s · 0.75=14.2 s · 1=60.0 s · 0.110757=1.00 ms |
| 40 | Env 2 Decay | 0..1 | 0.397448 |  | 0=5.00 ms · 0.25=63.6 ms · 0.5=1.88 s · 0.75=14.2 s · 1=60.0 s · 0.397448=600 ms |
| 41 | Env 2 Release | 0..1 | 0.396784 |  | 0=10.0 ms · 0.25=68.6 ms · 0.5=1.88 s · 0.75=14.2 s · 1=60.0 s · 0.396784=600 ms |
| 42 | Env 2 Sustain | 0..1 | 0.7 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.2=20 % |
| 43 | Cyc Env Mode | 0..3 |  | q | 0=Freq · 1=Time · 2=Ratio · 3=Sync |
| 44 | Cyc Env Rate | 0..1 | 0.312256 |  | 0=0.17 Hz · 0.25=2.65 Hz · 0.5=20.0 Hz · 0.75=168 Hz · 1=1.70 kHz · 0.312256=5.00 Hz |
| 45 | Cyc Env Ratio | 0..1 | 0.047619 |  | 0=0.25  · 0.25=4.19  · 0.5=8.12  · 0.75=12.06  · 1=16.00  · 0.047619=1.00  |
| 46 | Cyc Env Time | 0..1 | 0.29617 |  | 0=100 ms · 0.25=602 ms · 0.5=5.58 s · 0.75=22.3 s · 1=60.0 s · 0.29617=1.00 s |
| 47 | Cyc Env Synced | 0..21 | 15 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 48 | Cyc Env Tilt | 0..1 | 0.5 |  | 0=0.00  · 0.25=0.25  · 0.5=0.50  · 0.75=0.75  · 1=1.00  |
| 49 | Cyc Env Hold | 0..1 | 0 |  | 0=0.00  · 0.25=0.25  · 0.5=0.50  · 0.75=0.75  · 1=1.00  |
| 50 | Mod Matrix Amt 1 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % · 0.967593=80 % |
| 51 | Mod Matrix Amt 2 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % |
| 52 | Mod Matrix Amt 3 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-9.9 % · 0.5=0.0 % · 0.75=9.9 % · 1=100 % |
| 53 | Vel > Vol | 0..1 | 0.1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 54 | Osc Retrig On | 0..1 |  | q | 0=Off · 1=On |
| 55 | Env 2 Cyc On | 0..1 |  | q | 0=Env · 1=Cyc |
| 56 | Poly Voice Depth | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 57 | Spread | 0..1 | 0.7 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.1=10 % |
| 58 | Strength | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.05=5.0 % |
| 59 | Thickness | 0..1 | 0.3 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 60 | Drift | 0..1 | 0.0725 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.072=7.2 % |
| 61 | Legato On | 0..1 |  | q | 0=Off · 1=On |
| 62 | Note Pitch Bend On | 0..1 |  | q | 0=Off · 1=On |
| 63 | Glide Time | 0..1 | 0 |  | 0=0.00 ms · 0.25=7.81 ms · 0.5=125 ms · 0.75=633 ms · 1=2.00 s |
| 64 | Volume | 0..1 | 0.5 |  | 0=-inf dB · 0.25=-12 dB · 0.5=-6.0 dB · 0.75=-2.5 dB · 1=0.0 dB |
| 65 | Transpose | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=24 st · 48=48 st |

## Other attributes (40)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Drift | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | Drift | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0.0625 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 3 | Returns the latency of the device in samples. |
| `mod_matrix_filter_source_1_index` | S | L | 1 | Return the filter mod source 1 index |
| `mod_matrix_filter_source_1_list` |  |  | <Base.StringVector object at 0x17a26c440> | Return the filter mod source 1 list |
| `mod_matrix_filter_source_2_index` | S | L | 6 | Return the filter mod source 2 index |
| `mod_matrix_filter_source_2_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the filter mod source 2 list |
| `mod_matrix_lfo_source_index` | S | L | 5 | Return the lfo mod source index |
| `mod_matrix_lfo_source_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the lfo mod source list |
| `mod_matrix_pitch_source_1_index` | S | L | 1 | Return the pitch mod source 1 index |
| `mod_matrix_pitch_source_1_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the pitch mod source 1 list |
| `mod_matrix_pitch_source_2_index` | S | L | 2 | Return the pitch mod source 2 index |
| `mod_matrix_pitch_source_2_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the pitch mod source 2 list |
| `mod_matrix_shape_source_index` | S | L | 6 | Return the shape mod source index |
| `mod_matrix_shape_source_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the shape mod source list |
| `mod_matrix_source_1_index` | S | L | 5 | Return the custom mod source 1 index |
| `mod_matrix_source_1_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the custom mod source 1 list |
| `mod_matrix_source_2_index` | S | L | 4 | Return the custom mod source 2 index |
| `mod_matrix_source_2_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the custom mod source 2 list |
| `mod_matrix_source_3_index` | S | L | 6 | Return the custom mod source 3 index |
| `mod_matrix_source_3_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the custom mod source 3 list |
| `mod_matrix_target_1_index` | S | L | 8 | Return the custom mod target 1 index |
| `mod_matrix_target_1_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the custom mod target 1 list |
| `mod_matrix_target_2_index` | S | L | 0 | Return the custom mod target 2 index |
| `mod_matrix_target_2_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the custom mod target 2 list |
| `mod_matrix_target_3_index` | S | L | 0 | Return the custom mod target 3 index |
| `mod_matrix_target_3_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the custom mod target 3 list |
| `name` | S | L | Drift | Return access to the name of the device. |
| `pitch_bend_range` | S | L | 12 | Return the Pitch Bend Range |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
| `voice_count_index` | S | L | 4 | Return the voice count index |
| `voice_count_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the voice count list |
| `voice_mode_index` | S | L | 0 | Return the voice mode index |
| `voice_mode_list` |  |  | <Base.StringVector object at 0x17a203f40> | Return the voice mode list |
