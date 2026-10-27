# Drum Sampler

`DrumCell` ("Drum Sampler"), Python `DrumCellDevice`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: pad 36 of the rig set's Memphis Studio + Plymouth kit. Raw dump: [`dumps/Drum_Sampler.json`](dumps/Drum_Sampler.json).

## Parameters (40)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Transpose | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=24 st · 48=48 st |
| 2 | Detune | 0..1 | 0.5 |  | 0=-50 ct · 0.25=-25 ct · 0.5=0 ct · 0.75=25 ct · 1=50 ct |
| 3 | Vel > Vol | 0..1 | 0.35 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.35=35 % |
| 4 | Mod Src | 0..1 |  | q | 0=Velocity · 1=Slide |
| 5 | Mod Dest | 0..5 |  | q | 0=Filter · 1=Attack · 2=Hold · 3=Decay · 4=FX 1 · 5=FX 2 |
| 6 | Mod Amt | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 7 | Filter On | 0..1 |  | q | 0=Off · 1=On |
| 8 | Filter Freq | 0..1 | 1 |  | 0=30.0 Hz · 0.25=156 Hz · 0.5=812 Hz · 0.75=4.23 kHz · 1=22.0 kHz |
| 9 | Filter Res | 0..1 | 0 |  | 0=0.0 % · 0.25=22 % · 0.5=45 % · 0.75=67 % · 1=90 % |
| 10 | Filter Type | 0..3 |  | q | 0=Low-Pass 12dB · 1=Low-Pass 24dB · 2=High-Pass 24dB · 3=Peak |
| 11 | Filter Gain | 0..1 | 0.5 |  | 0=-12 dB · 0.25=-6.0 dB · 0.5=0.0 dB · 0.75=6.0 dB · 1=12 dB |
| 12 | Attack | 0..1 | 0 |  | 0=0.10 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 13 | Hold | 0..1 | 0.518427 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=Inf · 0.518427=300 ms |
| 14 | Decay | 0..1 | 0.627858 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s |
| 15 | Env Mode | 0..1 |  | q | 0=Trigger · 1=Gate |
| 16 | Start | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 17 | Length | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 18 | Volume | 0..1 | 0.333333 |  | 0=-36 dB · 0.25=-18 dB · 0.5=0.0 dB · 0.75=18 dB · 1=36 dB · 0.330709=-12 dB |
| 19 | Pan | 0..1 | 0.5 |  | 0=50L · 0.25=25L · 0.5=C · 0.75=25R · 1=50R |
| 20 | FX On | 0..1 |  | q | 0=Off · 1=On |
| 21 | FX Type | 0..8 |  | q | 0=Stretch · 1=Loop · 2=Pitch Env · 3=Punch · 4=8-Bit · 5=FM · 6=Ring Mod · 7=Sub Osc · 8=Noise |
| 22 | Pitch Env Amt | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 23 | Pitch Env Decay | 0..1 | 0.528802 |  | 0=5.00 ms · 0.25=36.2 ms · 0.5=254 ms · 0.75=847 ms · 1=2.00 s |
| 24 | Sub Amt | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 25 | Sub Freq | 0..1 | 0.5 |  | 0=30.0 Hz · 0.25=42.4 Hz · 0.5=60.0 Hz · 0.75=84.9 Hz · 1=120 Hz |
| 26 | Noise Amt | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 27 | Noise Color | 0..1 | 0.814014 |  | 0=180 Hz · 0.25=1.11 kHz · 0.5=3.89 kHz · 0.75=8.52 kHz · 1=15.0 kHz |
| 28 | Loop Offset | 0..1 | 0.141421 |  | 0=0.0 % · 0.25=6.2 % · 0.5=25 % · 0.75=56 % · 1=100 % |
| 29 | Loop Length | 0..1 | 0.769309 |  | 0=10.0 ms · 0.25=40.6 ms · 0.5=133 ms · 0.75=286 ms · 1=500 ms |
| 30 | Stretch Factor | 0..1 | 0 |  | 0=1.00  · 0.25=2.19  · 0.5=5.75  · 0.75=11.69  · 1=20.00  |
| 31 | Grain Size | 0..1 | 0.56748 |  | 0=5.00 ms · 0.25=23.4 ms · 0.5=78.8 ms · 0.75=171 ms · 1=300 ms |
| 32 | Punch Amt | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 33 | Punch Release | 0..1 | 0.4 |  | 0=60.0 ms · 0.25=74.7 ms · 0.5=178 ms · 0.75=457 ms · 1=1.00 s · 0.5=177 ms |
| 34 | 8-Bit Rate | 0..1 | 0.777595 |  | 0=1.00 kHz · 0.25=2.34 kHz · 0.5=5.48 kHz · 0.75=12.8 kHz · 1=30.0 kHz |
| 35 | 8-Bit Flt Decay | 0..1 | 1 |  | 0=10.0 ms · 0.25=47.3 ms · 0.5=224 ms · 0.75=1.06 s · 1=Off |
| 36 | FM Amt | 0..1 | 0 |  | 0=0.0 % · 0.25=1.6 % · 0.5=12 % · 0.75=42 % · 1=100 % |
| 37 | FM Freq | 0..1 | 0.753803 |  | 0=10.0 Hz · 0.25=46.1 Hz · 0.5=212 Hz · 0.75=977 Hz · 1=4.50 kHz |
| 38 | RM Amt | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 39 | RM Freq | 0..1 | 0.724664 |  | 0=1.00 Hz · 0.25=5.88 Hz · 0.5=157 Hz · 0.75=1.19 kHz · 1=5.00 kHz |

## Other attributes (12)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Drum Sampler | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | DrumCell | Return const access to the name of the device's class. |
| `gain` | S | L | 0.5011501312255859 | Return the Gain value |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `name` | S | L | Kick-SessionDry-Felt-Soft | Return access to the name of the device. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
