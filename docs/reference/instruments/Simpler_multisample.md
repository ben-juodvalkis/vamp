# Simpler (Multisample Mode)

`OriginalSimpler` ("Simpler"), Python `SimplerDevice`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: pad 36 of the library's 32 Pad Kit Jazz (Pitch Env, Filter and LFO off). Raw dump: [`dumps/Simpler_multisample.json`](dumps/Simpler_multisample.json).

## Parameters (33)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Snap | 0..1 |  | q | 0=Off · 1=On |
| 2 | Sample Selector | 0..127 | 0 |  | 0=00 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 3 | S Start | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 4 | S Length | 0..1 | 1 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 5 | S Loop On | 0..1 |  | q | 0=Off · 1=On |
| 6 | S Loop Length | 0..1 | 1 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 7 | S Loop Fade | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 8 | Spread | 0..100 | 0 |  | 0=0 % · 25=25 % · 50=50 % · 75=75 % · 100=100 % |
| 9 | Glide Mode | 0..2 |  | q | 0=Off · 1=Portamento · 2=Glide |
| 10 | Glide Time | 0..1 | 0.539794 |  | 0=0.10 ms · 0.25=1.78 ms · 0.5=31.6 ms · 0.75=562 ms · 1=10.0 s · 0.539794=50.0 ms |
| 11 | Transpose | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=+24 st · 48=+48 st |
| 12 | Detune | -50..50 | 0 |  | -50=-50 ct · -25=-25 ct · 0=0 ct · 25=+25 ct · 50=+50 ct |
| 13 | Pitch < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=6.25 % · 0.5=25.0 % · 0.75=56.2 % · 1=100 % |
| 14 | Pe On | 0..1 |  | q | 0=Off · 1=On |
| 15 | Volume | -36..36 | -12 |  | -36=-36.0 dB · -18=-18.0 dB · 0=0.00 dB · 18=18.0 dB · 36=36.0 dB · 1=1.00 dB |
| 16 | Vol < Vel | 0..1 | 0.35 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 17 | Vol < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 18 | Pan | -1..1 | 0 |  | -1=50L · 0=C · 1=50R |
| 19 | Pan < Rnd | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 20 | Pan < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 21 | Ve Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 22 | Ve Decay | 0..1 | 0.581428 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s |
| 23 | Ve Sustain | 0..1 | 1 |  | 0=-inf dB · 0.25=-35 dB · 0.5=-20 dB · 0.75=-10 dB · 1=0.0 dB |
| 24 | Ve Release | 0..1 | 0.355571 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s |
| 25 | Ve Mode | 0..4 |  | q | 0=None · 1=Loop · 2=Beat · 3=Sync · 4=Trigger |
| 26 | Ve Loop | 0..1 | 0.539794 |  | 0=0.20 ms · 0.25=3.56 ms · 0.5=63.2 ms · 0.75=1.12 s · 1=20.0 s · 0.539794=100 ms |
| 27 | Ve Retrig | 0..14 | 3 |  | 0=1/48 · 1=1/32 · 2=1/24 · 3=1/16 · 4=1/12 · 5=1/8 · 6=1/6 · 7=1/4 · 8=1/3 · 9=1/2 · 10=1 · 11=1.5 · 12=2 · 13=3 · 14=4 |
| 28 | Fade In | 0..1 | 0 |  | 0=0.00 ms · 0.25=31.2 ms · 0.5=250 ms · 0.75=844 ms · 1=2.00 s · 0.03684=0.10 ms |
| 29 | Trigger Mode | 0..1 |  | q | 0=Trigger · 1=Gate |
| 30 | Fade Out | 0..1 | 0.135721 |  | 0=0.00 ms · 0.25=31.2 ms · 0.5=250 ms · 0.75=844 ms · 1=2.00 s · 0.03684=0.10 ms |
| 31 | F On | 0..1 |  | q | 0=Off · 1=On |
| 32 | L On | 0..1 |  | q | 0=Off · 1=On |

## Other attributes (25)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `can_warp_as` |  | L | False | Returns true if warp_as is available. |
| `can_warp_double` |  | L | False | Returns true if warp_double is available. |
| `can_warp_half` |  | L | False | Returns true if warp_half is available. |
| `class_display_name` |  |  | Simpler | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | OriginalSimpler | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `multi_sample_mode` |  | L | True | Returns whether Simpler is in mulit-sample mode. |
| `name` | S | L | Kick Mid Tune Jazz | Return access to the name of the device. |
| `note_pitch_bend_range` | S | L | 48 | Access to the Note Pitch Bend Range in Simpler. |
| `pad_slicing` | S | L | False | When set to true, slices can be added in slicing mode by playing notes |
| `pitch_bend_range` | S | L | 5 | Access to the Pitch Bend Range in Simpler. |
| `playback_mode` | S | L | 0 | Access to Simpler's playback mode. |
| `playing_position` |  | L | 0 | Constant access to the current playing position in the sample. |
| `playing_position_enabled` |  | L | False | Returns whether Simpler is showing the playing position. |
| `retrigger` | S | L | False | Access to Simpler's retrigger mode. |
| `sample` |  | L | None | Get the loaded Sample. |
| `slicing_playback_mode` | S | L | 0 | Access to Simpler's slicing playback mode. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
| `voices` | S | L | 8 | Access to the number of voices in Simpler. |
