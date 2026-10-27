# Electric

`LoungeLizard` ("Electric"), Python `Device`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, factory default. Raw dump: [`dumps/Electric.json`](dumps/Electric.json).

## Parameters (34)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Voices | 0..30 |  | q | 0=2 · 1=3 · 2=4 · 3=5 · 4=6 · 5=7 · 6=8 · 7=9 · 8=10 · 9=11 · 10=12 · 11=13 · 12=14 · 13=15 · 14=16 · 15=17 · 16=18 · 17=19 · 18=20 · 19=21 · 20=22 · 21=23 · 22=24 · 23=25 · 24=26 · 25=27 · 26=28 · 27=29 · 28=30 · 29=31 · 30=32 |
| 2 | PB Range | 0..1 | 1 |  | 0=0.00 · 0.25=3.00 · 0.5=6.00 · 0.75=9.00 · 1=12.00 |
| 3 | Note PB Range | 0..48 | 0 |  | 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st · 13=13 st · 14=14 st · 15=15 st · 16=16 st · 17=17 st · 18=18 st · 19=19 st · 20=20 st · 21=21 st · 22=22 st · 23=23 st · 24=24 st · 25=25 st · 26=26 st · 27=27 st · 28=28 st · 29=29 st · 30=30 st · 31=31 st · 32=32 st · 33=33 st · 34=34 st · 35=35 st · 36=36 st · 37=37 st · 38=38 st · 39=39 st · 40=40 st · 41=41 st · 42=42 st · 43=43 st · 44=44 st · 45=45 st · 46=46 st · 47=47 st · 48=48 st |
| 4 | Volume | 0..1 | 0.704789 |  | 0=-inf dB · 0.25=-18 dB · 0.5=-6.0 dB · 0.75=1.1 dB · 1=6.0 dB · 0.704789=0.0 dB |
| 5 | Semitone | 0..24 | 12 |  | 0=-12 st · 1=-11 st · 2=-10 st · 3=-9 st · 4=-8 st · 5=-7 st · 6=-6 st · 7=-5 st · 8=-4 st · 9=-3 st · 10=-2 st · 11=-1 st · 12=0 st · 13=1 st · 14=2 st · 15=3 st · 16=4 st · 17=5 st · 18=6 st · 19=7 st · 20=8 st · 21=9 st · 22=10 st · 23=11 st · 24=12 st |
| 6 | Detune | 0..1 | 0.5 |  | 0=-0.50 · 0.25=-0.25 · 0.5=0.00 · 0.75=0.25 · 1=0.50 |
| 7 | KB Stretch | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0 % · 0.75=50 % · 1=100 % |
| 8 | M Stiffness | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 9 | M Stiff < Key | 0..1 | 0.5 |  | 0=0.0 · 0.25=25 · 0.5=50 · 0.75=75 · 1=100 |
| 10 | M Stiff < Vel | 0..1 | 0.5 |  | 0=0.0 · 0.25=25 · 0.5=50 · 0.75=75 · 1=100 |
| 11 | M Force | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 12 | M Force < Key | 0..1 | 0.5 |  | 0=0.0 · 0.25=25 · 0.5=50 · 0.75=75 · 1=100 |
| 13 | M Force < Vel | 0..1 | 0.5 |  | 0=0.0 · 0.25=25 · 0.5=50 · 0.75=75 · 1=100 |
| 14 | Noise Pitch | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 15 | Noise Decay | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 16 | Noise Amount | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 17 | Noise < Key | 0..1 | 0.5 |  | 0=0.0 · 0.25=25 · 0.5=50 · 0.75=75 · 1=100 |
| 18 | F Release | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 19 | F Tine Decay | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 20 | F Tine Vol | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 21 | F Tine < Key | 0..1 | 0.5 |  | 0=0.0 · 0.25=25 · 0.5=50 · 0.75=75 · 1=100 |
| 22 | F Tine Color | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 23 | F Tone Decay | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 24 | F Tone Vol | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 25 | P Symmetry | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 26 | P Distance | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 27 | Pickup Model | 0..1 |  | q | 0=R · 1=W |
| 28 | P Amp In | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.42=42 % |
| 29 | P Amp Out | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.42=42 % |
| 30 | P Amp < Key | 0..1 | 0.5 |  | 0=0.0 · 0.25=25 · 0.5=50 · 0.75=75 · 1=100 |
| 31 | Damp Tone | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 32 | Damp Amount | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 33 | Damp Balance | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0 % · 0.75=50 % · 1=100 % |

## Other attributes (11)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Electric | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | LoungeLizard | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `name` | S | L | Electric | Return access to the name of the device. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
