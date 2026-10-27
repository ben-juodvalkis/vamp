# Wavetable

`InstrumentVector` ("Wavetable"), Python `WavetableDevice`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, factory default. Raw dump: [`dumps/Wavetable.json`](dumps/Wavetable.json).

## Parameters (93)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Osc 1 On | 0..1 |  | q | 0=Off · 1=On |
| 2 | Osc 1 Transp | -24..24 | 0 |  | -24=-24 st · -23=-23 st · -22=-22 st · -21=-21 st · -20=-20 st · -19=-19 st · -18=-18 st · -17=-17 st · -16=-16 st · -15=-15 st · -14=-14 st · -13=-13 st · -12=-12 st · -11=-11 st · -10=-10 st · -9=-9 st · -8=-8 st · -7=-7 st · -6=-6 st · -5=-5 st · -4=-4 st · -3=-3 st · -2=-2 st · -1=-1 st · 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st · 13=13 st · 14=14 st · 15=15 st · 16=16 st · 17=17 st · 18=18 st · 19=19 st · 20=20 st · 21=21 st · 22=22 st · 23=23 st · 24=24 st |
| 3 | Osc 1 Detune | 0..1 | 0.5 |  | 0=-50 ct · 0.25=-25 ct · 0.5=0 ct · 0.75=25 ct · 1=50 ct |
| 4 | Osc 1 Pos | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 5 | Osc 1 Effect 1 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 6 | Osc 1 Effect 2 | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 7 | Osc 1 Pan | 0..1 | 0.5 |  | 0=50L · 0.25=25L · 0.5=C · 0.75=25R · 1=50R |
| 8 | Osc 1 Gain | 0..1 | 1 |  | 0=-inf dB · 0.25=-12 dB · 0.5=-6.0 dB · 0.75=-2.5 dB · 1=0.0 dB |
| 9 | Osc 2 On | 0..1 |  | q | 0=Off · 1=On |
| 10 | Osc 2 Transp | -24..24 | 0 |  | -24=-24 st · -23=-23 st · -22=-22 st · -21=-21 st · -20=-20 st · -19=-19 st · -18=-18 st · -17=-17 st · -16=-16 st · -15=-15 st · -14=-14 st · -13=-13 st · -12=-12 st · -11=-11 st · -10=-10 st · -9=-9 st · -8=-8 st · -7=-7 st · -6=-6 st · -5=-5 st · -4=-4 st · -3=-3 st · -2=-2 st · -1=-1 st · 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st · 13=13 st · 14=14 st · 15=15 st · 16=16 st · 17=17 st · 18=18 st · 19=19 st · 20=20 st · 21=21 st · 22=22 st · 23=23 st · 24=24 st |
| 11 | Osc 2 Detune | 0..1 | 0.5 |  | 0=-50 ct · 0.25=-25 ct · 0.5=0 ct · 0.75=25 ct · 1=50 ct |
| 12 | Osc 2 Pos | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 13 | Osc 2 Effect 1 | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 14 | Osc 2 Effect 2 | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 15 | Osc 2 Pan | 0..1 | 0.5 |  | 0=50L · 0.25=25L · 0.5=C · 0.75=25R · 1=50R |
| 16 | Osc 2 Gain | 0..1 | 1 |  | 0=-inf dB · 0.25=-12 dB · 0.5=-6.0 dB · 0.75=-2.5 dB · 1=0.0 dB |
| 17 | Sub On | 0..1 |  | q | 0=Off · 1=On |
| 18 | Sub Tone | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 19 | Sub Gain | 0..1 | 0.5 |  | 0=-inf dB · 0.25=-12 dB · 0.5=-6.0 dB · 0.75=-2.5 dB · 1=0.0 dB · 0.501188=-6.0 dB |
| 20 | Sub Transpose | 0..2 |  | q | 0=0 · 1=-1 · 2=-2 |
| 21 | Flt 1 On | 0..1 |  | q | 0=Off · 1=On |
| 22 | Flt 1 Type | 0..4 |  | q | 0=Lowpass · 1=Highpass · 2=Bandpass · 3=Notch · 4=Morph |
| 23 | Flt 1 LP/HP | 0..4 |  | q | 0=Clean · 1=OSR · 2=MS2 · 3=SMP · 4=PRD |
| 24 | Flt 1 BP/NO/MO | 0..1 |  | q | 0=Clean · 1=OSR |
| 25 | Flt 1 Slope | 0..1 |  | q | 0=12 · 1=24 |
| 26 | Flt 1 Freq | 0..1 | 0.996578 |  | 0=20.0 Hz · 0.25=113 Hz · 0.5=640 Hz · 0.75=3.62 kHz · 1=20.5 kHz |
| 27 | Flt 1 Res | 0..1 | 0 |  | 0=0.0 % · 0.25=31 % · 0.5=62 % · 0.75=94 % · 1=125 % |
| 28 | Flt 1 Drive | 0..1 | 0 |  | 0=0.00 dB · 0.25=6.00 dB · 0.5=12.0 dB · 0.75=18.0 dB · 1=24.0 dB |
| 29 | Flt 1 Morph | 0..1 | 0 |  | 0=0 lp/bp · 0.25=0 bp/hp · 0.5=0 hp/no · 0.75=0 no/lp · 1=100 no/lp |
| 30 | Flt 2 On | 0..1 |  | q | 0=Off · 1=On |
| 31 | Flt 2 Type | 0..4 |  | q | 0=Lowpass · 1=Highpass · 2=Bandpass · 3=Notch · 4=Morph |
| 32 | Flt 2 LP/HP | 0..4 |  | q | 0=Clean · 1=OSR · 2=MS2 · 3=SMP · 4=PRD |
| 33 | Flt 2 BP/NO/MO | 0..1 |  | q | 0=Clean · 1=OSR |
| 34 | Flt 2 Slope | 0..1 |  | q | 0=12 · 1=24 |
| 35 | Flt 2 Freq | 0..1 | 0.996578 |  | 0=20.0 Hz · 0.25=113 Hz · 0.5=640 Hz · 0.75=3.62 kHz · 1=20.5 kHz · 2e-06=20.0 Hz |
| 36 | Flt 2 Res | 0..1 | 0 |  | 0=0.0 % · 0.25=31 % · 0.5=62 % · 0.75=94 % · 1=125 % |
| 37 | Flt 2 Drive | 0..1 | 0 |  | 0=0.00 dB · 0.25=6.00 dB · 0.5=12.0 dB · 0.75=18.0 dB · 1=24.0 dB |
| 38 | Flt 2 Morph | 0..1 | 0 |  | 0=0 lp/bp · 0.25=0 bp/hp · 0.5=0 hp/no · 0.75=0 no/lp · 1=100 no/lp |
| 39 | Amp Attack | 0..1 | 0.0840896 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.847826=10.3 s |
| 40 | Amp Decay | 0..1 | 0.415927 |  | 0=1.50 ms · 0.25=79.6 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.380435=420 ms |
| 41 | Amp Release | 0..1 | 0.415927 |  | 0=1.50 ms · 0.25=79.6 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.869565=11.4 s |
| 42 | Amp A Slope | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 43 | Amp D Slope | 0..1 | 0.75 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 44 | Amp R Slope | 0..1 | 0.75 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 45 | Amp Sustain | 0..1 | 0.707107 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-12 dB · 0.75=-5.0 dB · 1=0.0 dB |
| 46 | Amp Loop Mode | 0..2 |  | q | 0=None · 1=Trigger · 2=Loop |
| 47 | Env 2 Attack | 0..1 | 0.0840896 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.08409=1.00 ms |
| 48 | Env 2 Decay | 0..1 | 0.415927 |  | 0=1.50 ms · 0.25=79.6 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.415927=600 ms |
| 49 | Env 2 Release | 0..1 | 0.415927 |  | 0=1.50 ms · 0.25=79.6 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.415927=600 ms |
| 50 | Env 2 A Slope | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 51 | Env 2 D Slope | 0..1 | 0.75 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 52 | Env 2 R Slope | 0..1 | 0.75 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 53 | Env 2 Initial | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 54 | Env 2 Peak | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 55 | Env 2 Sustain | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 56 | Env 2 Final | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 57 | Env 2 Loop Mode | 0..2 |  | q | 0=None · 1=Trigger · 2=Loop |
| 58 | Env 3 Attack | 0..1 | 0.0840896 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.08409=1.00 ms |
| 59 | Env 3 Decay | 0..1 | 0.415927 |  | 0=1.50 ms · 0.25=79.6 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.415927=600 ms |
| 60 | Env 3 Release | 0..1 | 0.415927 |  | 0=1.50 ms · 0.25=79.6 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s · 0.415927=600 ms |
| 61 | Env 3 A Slope | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 62 | Env 3 D Slope | 0..1 | 0.75 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 63 | Env 3 R Slope | 0..1 | 0.75 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 64 | Env 3 Initial | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 65 | Env 3 Peak | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 66 | Env 3 Sustain | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 67 | Env 3 Final | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 68 | Env 3 Loop Mode | 0..2 |  | q | 0=None · 1=Trigger · 2=Loop |
| 69 | LFO 1 Retrig On | 0..1 |  | q | 0=Off · 1=On |
| 70 | LFO 1 Wave | 0..4 |  | q | 0=Sine · 1=Triangle · 2=Sawtooth · 3=Rectangle · 4=Noise |
| 71 | LFO 1 Amount | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 72 | LFO 1 Morph | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 73 | LFO 1 Offset | 0..1 | 0 |  | 0=0.0° · 0.25=90° · 0.5=180° · 0.75=270° · 1=360° |
| 74 | LFO 1 Sync | 0..1 |  | q | 0=Free · 1=Tempo |
| 75 | LFO 1 Freq | 0..1 | 0.320789 |  | 0=0.01 Hz · 0.25=0.48 Hz · 0.5=3.76 Hz · 0.75=12.66 Hz · 1=30.00 Hz · 0.320789=1.00 Hz |
| 76 | LFO 1 Synced | 0..21 | 15 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 77 | LFO 1 Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s |
| 78 | LFO 2 Retrig On | 0..1 |  | q | 0=Off · 1=On |
| 79 | LFO 2 Wave | 0..4 |  | q | 0=Sine · 1=Triangle · 2=Sawtooth · 3=Rectangle · 4=Noise |
| 80 | LFO 2 Amount | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 81 | LFO 2 Morph | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 82 | LFO 2 Offset | 0..1 | 0 |  | 0=0.0° · 0.25=90° · 0.5=180° · 0.75=270° · 1=360° |
| 83 | LFO 2 Sync | 0..1 |  | q | 0=Free · 1=Tempo |
| 84 | LFO 2 Freq | 0..1 | 0.320789 |  | 0=0.01 Hz · 0.25=0.48 Hz · 0.5=3.76 Hz · 0.75=12.66 Hz · 1=30.00 Hz · 0.320789=1.00 Hz |
| 85 | LFO 2 Synced | 0..21 | 15 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 86 | LFO 2 Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s |
| 87 | Time | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 88 | Global Mod Amount | 0..1 | 0.5 |  | 0=0.0 % · 0.25=50 % · 0.5=100 % · 0.75=150 % · 1=200 % |
| 89 | Unison Amount | 0..1 | 0.3 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.3=30 % |
| 90 | Transpose | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=24 st · 48=48 st |
| 91 | Glide | 0..1 | 0 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s |
| 92 | Volume | 0..1 | 0.707107 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-12 dB · 0.75=-5.0 dB · 1=0.0 dB · 0.707107=-6.0 dB |

## Other attributes (26)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Wavetable | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | InstrumentVector | Return const access to the name of the device's class. |
| `filter_routing` | S | L | 0 | Return the current filter routing. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `mono_poly` | S | L | 1 | Return the current voicing mode. |
| `name` | S | L | Wavetable | Return access to the name of the device. |
| `oscillator_1_effect_mode` | S | L | 3 | Return the current effect mode of the oscillator 1. |
| `oscillator_1_wavetable_category` | S | L | 0 | Return the current wavetable category of the oscillator 1. |
| `oscillator_1_wavetable_index` | S | L | 0 | Return the current wavetable index of the oscillator 1. |
| `oscillator_1_wavetables` |  | L | <Base.StringVector object at 0x394eafc40> | Get a vector of oscillator 1's wavetable names. |
| `oscillator_2_effect_mode` | S | L | 0 | Return the current effect mode of the oscillator 2. |
| `oscillator_2_wavetable_category` | S | L | 0 | Return the current wavetable category of the oscillator 2. |
| `oscillator_2_wavetable_index` | S | L | 0 | Return the current wavetable index of the oscillator 2. |
| `oscillator_2_wavetables` |  | L | <Base.StringVector object at 0x394eafcc0> | Get a vector of oscillator 2's wavetable names. |
| `oscillator_wavetable_categories` |  |  | <Base.StringVector object at 0x394eafcc0> | Get a vector of the available wavetable categories. |
| `poly_voices` | S | L | 6 | Return the current number of polyphonic voices. Uses the VoiceCount enumeration. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
| `unison_mode` | S | L | 1 | Return the current unison mode. |
| `unison_voice_count` | S | L | 3 | Return the current number of unison voices. |
| `visible_modulation_target_names` |  | L | <Base.StringVector object at 0x394eafcc0> | Get the names of all the visible modulation targets. |
