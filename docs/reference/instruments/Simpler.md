# Simpler

`OriginalSimpler` ("Simpler"), Python `SimplerDevice`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, a one-shot WAV loaded with `replace_sample`. Raw dump: [`dumps/Simpler.json`](dumps/Simpler.json).

## Parameters (63)

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
| 15 | Pe < Env | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=+24 st · 48=+48 st |
| 16 | Pe Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 17 | Pe Decay | 0..1 | 0.581428 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.581428=600 ms |
| 18 | Pe Sustain | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 19 | Pe Release | 0..1 | 0.355571 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.355571=50.0 ms |
| 20 | Volume | -36..36 | -12 |  | -36=-36.0 dB · -18=-18.0 dB · 0=0.00 dB · 18=18.0 dB · 36=36.0 dB · -12=-12.0 dB |
| 21 | Vol < Vel | 0..1 | 0.35 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.35=35 % |
| 22 | Vol < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 23 | Pan | -1..1 | 0 |  | -1=50L · 0=C · 1=50R |
| 24 | Pan < Rnd | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 25 | Pan < LFO | 0..1 | 0 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 26 | Ve Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 27 | Ve Decay | 0..1 | 0.581428 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.581428=600 ms |
| 28 | Ve Sustain | 0..1 | 1 |  | 0=-inf dB · 0.25=-35 dB · 0.5=-20 dB · 0.75=-10 dB · 1=0.0 dB |
| 29 | Ve Release | 0..1 | 0.355571 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.355571=50.0 ms |
| 30 | Ve Mode | 0..4 |  | q | 0=None · 1=Loop · 2=Beat · 3=Sync · 4=Trigger |
| 31 | Ve Loop | 0..1 | 0.539794 |  | 0=0.20 ms · 0.25=3.56 ms · 0.5=63.2 ms · 0.75=1.12 s · 1=20.0 s · 0.539794=100 ms |
| 32 | Ve Retrig | 0..14 | 3 |  | 0=1/48 · 1=1/32 · 2=1/24 · 3=1/16 · 4=1/12 · 5=1/8 · 6=1/6 · 7=1/4 · 8=1/3 · 9=1/2 · 10=1 · 11=1.5 · 12=2 · 13=3 · 14=4 |
| 33 | Fade In | 0..1 | 0 |  | 0=0.00 ms · 0.25=31.2 ms · 0.5=250 ms · 0.75=844 ms · 1=2.00 s · 0.03684=0.10 ms |
| 34 | Trigger Mode | 0..1 |  | q | 0=Trigger · 1=Gate |
| 35 | Fade Out | 0..1 | 0.135721 |  | 0=0.00 ms · 0.25=31.2 ms · 0.5=250 ms · 0.75=844 ms · 1=2.00 s · 0.03684=0.10 ms |
| 36 | F On | 0..1 |  | q | 0=Off · 1=On |
| 37 | Filter Type | 0..4 |  | q | 0=Lowpass · 1=Highpass · 2=Bandpass · 3=Notch · 4=Morph |
| 38 | Filter Circuit - LP/HP | 0..4 |  | q | 0=Clean · 1=OSR · 2=MS2 · 3=SMP · 4=PRD |
| 39 | Filter Circuit - BP/NO/Morph | 0..1 |  | q | 0=Clean · 1=OSR |
| 40 | Filter Slope | 0..1 |  | q | 0=12 dB · 1=24 dB |
| 41 | Filter Freq | 0..1 | 1 |  | 0=30.0 Hz · 0.25=156 Hz · 0.5=812 Hz · 0.75=4.23 kHz · 1=22.0 kHz |
| 42 | Filter Res | 0..1.25 | 0 |  | 0=0.0 % · 0.3125=31 % · 0.625=62 % · 0.9375=94 % · 1.25=125 % |
| 43 | Filter Morph | 0..1 | 0 |  | 0=0 lp/bp · 0.25=0 bp/hp · 0.5=0 hp/no · 0.75=0 no/lp · 1=100 no/lp |
| 44 | Filter Drive | 0..24 | 0 |  | 0=0.00 dB · 1=1.00 dB · 2=2.00 dB · 3=3.00 dB · 4=4.00 dB · 5=5.00 dB · 6=6.00 dB · 7=7.00 dB · 8=8.00 dB · 9=9.00 dB · 10=10.0 dB · 11=11.0 dB · 12=12.0 dB · 13=13.0 dB · 14=14.0 dB · 15=15.0 dB · 16=16.0 dB · 17=17.0 dB · 18=18.0 dB · 19=19.0 dB · 20=20.0 dB · 21=21.0 dB · 22=22.0 dB · 23=23.0 dB · 24=24.0 dB |
| 45 | Fe On | 0..1 |  | q | 0=Off · 1=On |
| 46 | Fe < Env | -72..72 | 0 |  | -72=-72 · -36=-36 · 0=0 · 36=36 · 72=72 |
| 47 | Fe Attack | 0..1 | 0 |  | 0=0.00 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 48 | Fe Decay | 0..1 | 0.581428 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.581428=600 ms |
| 49 | Fe Sustain | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 50 | Fe Release | 0..1 | 0.355571 |  | 0=1.00 ms · 0.25=15.7 ms · 0.5=245 ms · 0.75=3.83 s · 1=60.0 s · 0.355571=50.0 ms |
| 51 | Filt < Key | 0..1 | 1 |  | 0=0.00 % · 0.25=25.0 % · 0.5=50.0 % · 0.75=75.0 % · 1=100 % |
| 52 | Filt < Vel | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 53 | Filt < LFO | 0..24 | 0 |  | 0=0.00 · 1=1.00 · 2=2.00 · 3=3.00 · 4=4.00 · 5=5.00 · 6=6.00 · 7=7.00 · 8=8.00 · 9=9.00 · 10=10.0 · 11=11.0 · 12=12.0 · 13=13.0 · 14=14.0 · 15=15.0 · 16=16.0 · 17=17.0 · 18=18.0 · 19=19.0 · 20=20.0 · 21=21.0 · 22=22.0 · 23=23.0 · 24=24.0 |
| 54 | L On | 0..1 |  | q | 0=Off · 1=On |
| 55 | L Wave | 0..5 |  | q | 0=Sine · 1=Square · 2=Triangle · 3=Saw Down · 4=Saw Up · 5=Random |
| 56 | L Sync | 0..1 |  | q | 0=Free · 1=Sync |
| 57 | L Rate | 0..1 | 0.575188 |  | 0=0.01 Hz · 0.25=0.07 Hz · 0.5=0.55 Hz · 0.75=4.05 Hz · 1=30.0 Hz · 0.575188=1.00 Hz |
| 58 | L Sync Rate | 0..21 | 4 |  | 0=1/64 · 1=1/48 · 2=1/32 · 3=1/24 · 4=1/16 · 5=1/12 · 6=1/8 · 7=1/6 · 8=3/16 · 9=1/4 · 10=5/16 · 11=1/3 · 12=3/8 · 13=1/2 · 14=3/4 · 15=1 · 16=1.5 · 17=2 · 18=3 · 19=4 · 20=6 · 21=8 |
| 59 | L R < Key | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 60 | L Attack | 0..1 | 0 |  | 0=0.10 ms · 0.25=2.11 ms · 0.5=44.7 ms · 0.75=946 ms · 1=20.0 s |
| 61 | L Retrig | 0..1 |  | q | 0=Off · 1=On |
| 62 | L Offset | 0..360 | 0 |  | 0=0.00° · 90=90.0° · 180=180° · 270=270° · 360=360° |

## Other attributes (47)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `can_warp_as` |  | L | True | Returns true if warp_as is available. |
| `can_warp_double` |  | L | False | Returns true if warp_double is available. |
| `can_warp_half` |  | L | False | Returns true if warp_half is available. |
| `class_display_name` |  |  | Simpler | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | OriginalSimpler | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `multi_sample_mode` |  | L | False | Returns whether Simpler is in mulit-sample mode. |
| `name` | S | L | SLNG_R1TM_CNCL_HT_001_V08_RR01 | Return access to the name of the device. |
| `note_pitch_bend_range` | S | L | 48 | Access to the Note Pitch Bend Range in Simpler. |
| `pad_slicing` | S | L | False | When set to true, slices can be added in slicing mode by playing notes |
| `pitch_bend_range` | S | L | 5 | Access to the Pitch Bend Range in Simpler. |
| `playback_mode` | S | L | 0 | Access to Simpler's playback mode. |
| `playing_position` |  | L | 0 | Constant access to the current playing position in the sample. |
| `playing_position_enabled` |  | L | False | Returns whether Simpler is showing the playing position. |
| `retrigger` | S | L | False | Access to Simpler's retrigger mode. |
| `sample` |  | L | <Sample.Sample object at 0x17a201940> | Get the loaded Sample. |
| `sample.beats_granulation_resolution` | S | L | 6 | Access to the Granulation Resolution parameter in Beats Warp Mode. |
| `sample.beats_transient_envelope` | S | L | 100 | Access to the Transient Envelope parameter in Beats Warp Mode. |
| `sample.beats_transient_loop_mode` | S | L | 2 | Access to the Transient Loop Mode parameter in Beats Warp Mode. |
| `sample.complex_pro_envelope` | S | L | 128 | Access to the Envelope parameter in Complex Pro Mode. |
| `sample.complex_pro_formants` | S | L | 100 | Access to the Formants parameter in Complex Pro Warp Mode. |
| `sample.end_marker` | S | L | 179671 | Access to the position of the sample's end marker. |
| `sample.file_path` |  | L | /Users/Shared/Music/Soundbanks/DrumDrops/2016_11_08_Sling… | Get the path of the sample file. |
| `sample.gain` | S | L | 0.4000000059604645 | Access to the sample gain. |
| `sample.length` |  |  | 179672 | Get the length of the sample file in sample frames. |
| `sample.sample_rate` |  |  | 44100 | Access to the audio sample rate of the sample. |
| `sample.slices` |  | L | [] | Access to the list of slice points in sample time in the sample. |
| `sample.slicing_beat_division` | S | L | 4 | Access to sample's slicing step size. |
| `sample.slicing_region_count` | S | L | 8 | Access to sample's slicing split count. |
| `sample.slicing_sensitivity` | S | L | 1 | Access to sample's slicing sensitivity whose sensitivity is in between 0.0 and 1.0. |
| `sample.slicing_style` | S | L | 0 | Access to sample's slicing style. |
| `sample.start_marker` | S | L | 0 | Access to the position of the sample's start marker. |
| `sample.texture_flux` | S | L | 25 | Access to the Flux parameter in Texture Warp Mode. |
| `sample.texture_grain_size` | S | L | 65 | Access to the Grain Size parameter in Texture Warp Mode. |
| `sample.tones_grain_size` | S | L | 30 | Access to the Grain Size parameter in Tones Warp Mode. |
| `sample.warp_markers` |  | L | <Clip.WarpMarkerVector object at 0x17a2943c0> | Get the warp markers for this sample. |
| `sample.warp_mode` | S | L | 0 | Access to the sample's warp mode. |
| `sample.warping` | S | L | False | Access to the sample's warping property. |
| `slicing_playback_mode` | S | L | 2 | Access to Simpler's slicing playback mode. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
| `voices` | S | L | 32 | Access to the number of voices in Simpler. |
