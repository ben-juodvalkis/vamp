# Sampler

`MultiSampler` ("Sampler"), Python `Device`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, factory default (Filter and Filter Env on, every other section off). Raw dump: [`dumps/Sampler.json`](dumps/Sampler.json).

## Parameters (70)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Reverse | 0..1 |  | q | 0=Off · 1=On |
| 2 | Snap | 0..1 |  | q | 0=Off · 1=On |
| 3 | Sample Selector | 0..127 | 0 |  | 0=00 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 4 | Osc On | 0..1 |  | q | 0=Off · 1=On |
| 5 | Spread | 0..100 | 0 |  | 0=0 % · 25=25 % · 50=50 % · 75=75 % · 100=100 % |
| 6 | Key Zone Shift | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=+24 st · 48=+48 st |
| 7 | Glide Mode | 0..2 |  | q | 0=Off · 1=Portamento · 2=Glide |
| 8 | Glide Time | 0..1 | 0.539794 |  | 0=0.10 ms · 0.25=1.78 ms · 0.5=31.6 ms · 0.75=562 ms · 1=10.0 s · 0.539794=50.0 ms |
| 9 | Time | -100..100 | 0 |  | -100=-100 % · -50=-50 % · 0=0 % · 50=50 % · 100=100 % |
| 10 | Time < Key | -100..100 | 0 |  | -100=-100 % · -50=-50 % · 0=0 % · 50=50 % · 100=100 % |
| 11 | Transpose | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=+24 st · 48=+48 st |
| 12 | Detune | -50..50 | 0 |  | -50=-50 ct · -25=-25 ct · 0=0 ct · 25=+25 ct · 50=+50 ct |
| 13 | Pitch < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=6.25 % · 0.5=25.0 % · 0.75=56.2 % · 1=100 % |
| 14 | Pe On | 0..1 |  | q | 0=Off · 1=On |
| 15 | Volume | -36..36 | -12 |  | -36=-36.0 dB · -18=-18.0 dB · 0=0.00 dB · 18=18.0 dB · 36=36.0 dB · -12=-12.0 dB |
| 16 | Vol < Vel | 0..1 | 0.35 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 17 | Vol < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 18 | Pan | -1..1 | 0 |  | -1=50L · 0=C · 1=50R |
| 19 | Pan < Rnd | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 20 | Pan < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 21 | Ve Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 22 | Ve Init | 0..1 | 0 |  | 0=-inf dB · 0.25=-35 dB · 0.5=-20 dB · 0.75=-10 dB · 1=0.0 dB |
| 23 | Ve A Slope | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 24 | Ve Decay | 0..1 | 0.581428 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.581428=600 ms |
| 25 | Ve Peak | 0..1 | 1 |  | 0=-inf dB · 0.25=-35 dB · 0.5=-20 dB · 0.75=-10 dB · 1=0.0 dB |
| 26 | Ve D Slope | -1..1 | 1 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 27 | Ve Sustain | 0..1 | 1 |  | 0=-inf dB · 0.25=-35 dB · 0.5=-20 dB · 0.75=-10 dB · 1=0.0 dB |
| 28 | Ve Release | 0..1 | 0.355571 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.355571=50.0 ms |
| 29 | Ve R Slope | -1..1 | 1 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 30 | Ve Mode | 0..4 |  | q | 0=None · 1=Loop · 2=Beat · 3=Sync · 4=Trigger |
| 31 | Ve Loop | 0..1 | 0.539794 |  | 0=0.20 ms · 0.25=3.56 ms · 0.5=63.2 ms · 0.75=1.12 s · 1=20.0 s · 0.539794=100 ms |
| 32 | Ve Retrig | 0..14 | 3 |  | 0=1/48 · 1=1/32 · 2=1/24 · 3=1/16 · 4=1/12 · 5=1/8 · 6=1/6 · 7=1/4 · 8=1/3 · 9=1/2 · 10=1 · 11=1.5 · 12=2 · 13=3 · 14=4 |
| 33 | Ve R < Vel | -100..100 | 0 |  | -100=-100 % · -50=-50 % · 0=0 % · 50=50 % · 100=100 % |
| 34 | Fade In | 0..1 | 0 |  | 0=0.00 ms · 0.25=31.2 ms · 0.5=250 ms · 0.75=844 ms · 1=2.00 s · 0.03684=0.10 ms |
| 35 | Trigger Mode | 0..1 |  | q | 0=Trigger · 1=Gate |
| 36 | Fade Out | 0..1 | 0.135721 |  | 0=0.00 ms · 0.25=31.2 ms · 0.5=250 ms · 0.75=844 ms · 1=2.00 s · 0.03684=0.10 ms |
| 37 | F On | 0..1 |  | q | 0=Off · 1=On |
| 38 | Filter Type | 0..4 |  | q | 0=Lowpass · 1=Highpass · 2=Bandpass · 3=Notch · 4=Morph |
| 39 | Filter Circuit - LP/HP | 0..4 |  | q | 0=Clean · 1=OSR · 2=MS2 · 3=SMP · 4=PRD |
| 40 | Filter Circuit - BP/NO/Morph | 0..1 |  | q | 0=Clean · 1=OSR |
| 41 | Filter Slope | 0..1 |  | q | 0=12 dB · 1=24 dB |
| 42 | Filter Freq | 0..1 | 1 |  | 0=30.0 Hz · 0.25=156 Hz · 0.5=812 Hz · 0.75=4.23 kHz · 1=22.0 kHz |
| 43 | Filter Res | 0..1.25 | 0 |  | 0=0.0 % · 0.3125=31 % · 0.625=62 % · 0.9375=94 % · 1.25=125 % · 0.090909=9.1 % |
| 44 | Filter Morph | 0..1 | 0 |  | 0=0 lp/bp · 0.25=0 bp/hp · 0.5=0 hp/no · 0.75=0 no/lp · 1=100 no/lp |
| 45 | Filter Drive | 0..24 | 0 |  | 0=0.00 dB · 1=1.00 dB · 2=2.00 dB · 3=3.00 dB · 4=4.00 dB · 5=5.00 dB · 6=6.00 dB · 7=7.00 dB · 8=8.00 dB · 9=9.00 dB · 10=10.0 dB · 11=11.0 dB · 12=12.0 dB · 13=13.0 dB · 14=14.0 dB · 15=15.0 dB · 16=16.0 dB · 17=17.0 dB · 18=18.0 dB · 19=19.0 dB · 20=20.0 dB · 21=21.0 dB · 22=22.0 dB · 23=23.0 dB · 24=24.0 dB |
| 46 | Fe On | 0..1 |  | q | 0=Off · 1=On |
| 47 | Fe < Env | -72..72 | 0 |  | -72=-72 · -36=-36 · 0=0 · 36=36 · 72=72 |
| 48 | Fe Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 49 | Fe Init | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 50 | Fe A Slope | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 51 | Fe Decay | 0..1 | 0.581428 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.581428=600 ms |
| 52 | Fe Peak | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 53 | Fe D Slope | -1..1 | 1 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 54 | Fe Sustain | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 55 | Fe Release | 0..1 | 0.355571 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.355571=50.0 ms |
| 56 | Fe End | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 57 | Fe R Slope | -1..1 | 1 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 58 | Fe Mode | 0..4 |  | q | 0=None · 1=Loop · 2=Beat · 3=Sync · 4=Trigger |
| 59 | Fe Loop | 0..1 | 0.539794 |  | 0=0.20 ms · 0.25=3.56 ms · 0.5=63.2 ms · 0.75=1.12 s · 1=20.0 s · 0.539794=100 ms |
| 60 | Fe Retrig | 0..14 | 3 |  | 0=1/48 · 1=1/32 · 2=1/24 · 3=1/16 · 4=1/12 · 5=1/8 · 6=1/6 · 7=1/4 · 8=1/3 · 9=1/2 · 10=1 · 11=1.5 · 12=2 · 13=3 · 14=4 |
| 61 | Fe R < Vel | -100..100 | 0 |  | -100=-100 % · -50=-50 % · 0=0 % · 50=50 % · 100=100 % |
| 62 | Filt < Key | 0..1 | 1 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 63 | Filt < Vel | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 64 | Filt < LFO | 0..24 | 0 |  | 0=0.00 · 1=1.00 · 2=2.00 · 3=3.00 · 4=4.00 · 5=5.00 · 6=6.00 · 7=7.00 · 8=8.00 · 9=9.00 · 10=10.0 · 11=11.0 · 12=12.0 · 13=13.0 · 14=14.0 · 15=15.0 · 16=16.0 · 17=17.0 · 18=18.0 · 19=19.0 · 20=20.0 · 21=21.0 · 22=22.0 · 23=23.0 · 24=24.0 |
| 65 | Shaper On | 0..1 |  | q | 0=Off · 1=On |
| 66 | L 1 On | 0..1 |  | q | 0=Off · 1=On |
| 67 | L 2 On | 0..1 |  | q | 0=Off · 1=On |
| 68 | L 3 On | 0..1 |  | q | 0=Off · 1=On |
| 69 | Ae On | 0..1 |  | q | 0=Off · 1=On |

## Other attributes (11)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Sampler | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | MultiSampler | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `name` | S | L | Sampler | Return access to the name of the device. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
