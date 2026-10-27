# Analog

`UltraAnalog` ("Analog"), Python `Device`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, factory default. Raw dump: [`dumps/Analog.json`](dumps/Analog.json).

## Parameters (172)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Voices | 0..9 |  | q | 0=Mono · 1=2 · 2=4 · 3=8 · 4=12 · 5=16 · 6=20 · 7=24 · 8=28 · 9=32 |
| 2 | PB Range | 0..1 | 0.166667 |  | 0=0.00 · 0.25=3.00 · 0.5=6.00 · 0.75=9.00 · 1=12.00 · 0.166667=2.00 |
| 3 | Volume | 0..1 | 0.704789 |  | 0=-inf dB · 0.25=-18 dB · 0.5=-6.0 dB · 0.75=1.1 dB · 1=6.0 dB · 0.704789=0.0 dB |
| 4 | Note PB Range | 0..48 | 0 |  | 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st · 13=13 st · 14=14 st · 15=15 st · 16=16 st · 17=17 st · 18=18 st · 19=19 st · 20=20 st · 21=21 st · 22=22 st · 23=23 st · 24=24 st · 25=25 st · 26=26 st · 27=27 st · 28=28 st · 29=29 st · 30=30 st · 31=31 st · 32=32 st · 33=33 st · 34=34 st · 35=35 st · 36=36 st · 37=37 st · 38=38 st · 39=39 st · 40=40 st · 41=41 st · 42=42 st · 43=43 st · 44=44 st · 45=45 st · 46=46 st · 47=47 st · 48=48 st |
| 5 | Press Dest A | 0..46 |  | q | 0=No Destination · 1=Vibrato Amount · 2=Vibrato Speed · 3=Unison Detune · 4=Noise Level · 5=Noise Balance · 6=Noise Color · 7=Osc 1 Pitch · 8=Osc 1 LFO 1 -> Pitch · 9=Osc 1 Pitch Env Depth · 10=Osc 1 Pulse Width · 11=Osc 1 LFO 1 -> Pulse Width · 12=Osc 1 Sub Level · 13=Osc 1 Sync Ratio · 14=Osc 1 Level · 15=Osc 1 Balance · 16=Filter 1 Cutoff · 17=Filter 1 LFO 1 -> Cutoff · 18=Filter 1 Env -> Cutoff · 19=Filter 1 Q · 20=Filter 1 LFO 1 -> Q · 21=Filter 1 Env -> Q · 22=Amp 1 Volume · 23=Amp 1 LFO 1 -> Volume · 24=Amp 1 Pan · 25=Amp 1 LFO 1 -> Pan · 26=LFO 1 Rate · 27=Osc 2 Pitch · 28=Osc 2 LFO 2 -> Pitch · 29=Osc 2 Pitch Env Depth · 30=Osc 2 Pulse Width · 31=Osc 2 LFO 2 -> Pulse Width · 32=Osc 2 Sub Level · 33=Osc 2 Sync Ratio · 34=Osc 2 Level · 35=Osc 2 Balance · 36=Filter 2 Cutoff · 37=Filter 2 LFO 2 -> Cutoff · 38=Filter 2 Env -> Cutoff · 39=Filter 2 Q · 40=Filter 2 LFO 2 -> Q · 41=Filter 2 Env -> Q · 42=Amp 2 Volume · 43=Amp 2 LFO 2 -> Volume · 44=Amp 2 Pan · 45=Amp 2 LFO 2 -> Pan · 46=LFO 2 Rate |
| 6 | Press Amt A | -1..1 | 0.5 |  | -1=-100 % · 0=0.0 % · 1=100 % · 0.5=50 % |
| 7 | Press Dest B | 0..46 |  | q | 0=No Destination · 1=Vibrato Amount · 2=Vibrato Speed · 3=Unison Detune · 4=Noise Level · 5=Noise Balance · 6=Noise Color · 7=Osc 1 Pitch · 8=Osc 1 LFO 1 -> Pitch · 9=Osc 1 Pitch Env Depth · 10=Osc 1 Pulse Width · 11=Osc 1 LFO 1 -> Pulse Width · 12=Osc 1 Sub Level · 13=Osc 1 Sync Ratio · 14=Osc 1 Level · 15=Osc 1 Balance · 16=Filter 1 Cutoff · 17=Filter 1 LFO 1 -> Cutoff · 18=Filter 1 Env -> Cutoff · 19=Filter 1 Q · 20=Filter 1 LFO 1 -> Q · 21=Filter 1 Env -> Q · 22=Amp 1 Volume · 23=Amp 1 LFO 1 -> Volume · 24=Amp 1 Pan · 25=Amp 1 LFO 1 -> Pan · 26=LFO 1 Rate · 27=Osc 2 Pitch · 28=Osc 2 LFO 2 -> Pitch · 29=Osc 2 Pitch Env Depth · 30=Osc 2 Pulse Width · 31=Osc 2 LFO 2 -> Pulse Width · 32=Osc 2 Sub Level · 33=Osc 2 Sync Ratio · 34=Osc 2 Level · 35=Osc 2 Balance · 36=Filter 2 Cutoff · 37=Filter 2 LFO 2 -> Cutoff · 38=Filter 2 Env -> Cutoff · 39=Filter 2 Q · 40=Filter 2 LFO 2 -> Q · 41=Filter 2 Env -> Q · 42=Amp 2 Volume · 43=Amp 2 LFO 2 -> Volume · 44=Amp 2 Pan · 45=Amp 2 LFO 2 -> Pan · 46=LFO 2 Rate |
| 8 | Press Amt B | -1..1 | 0.5 |  | -1=-100 % · 0=0.0 % · 1=100 % · 0.5=50 % |
| 9 | Slide Dest A | 0..46 |  | q | 0=No Destination · 1=Vibrato Amount · 2=Vibrato Speed · 3=Unison Detune · 4=Noise Level · 5=Noise Balance · 6=Noise Color · 7=Osc 1 Pitch · 8=Osc 1 LFO 1 -> Pitch · 9=Osc 1 Pitch Env Depth · 10=Osc 1 Pulse Width · 11=Osc 1 LFO 1 -> Pulse Width · 12=Osc 1 Sub Level · 13=Osc 1 Sync Ratio · 14=Osc 1 Level · 15=Osc 1 Balance · 16=Filter 1 Cutoff · 17=Filter 1 LFO 1 -> Cutoff · 18=Filter 1 Env -> Cutoff · 19=Filter 1 Q · 20=Filter 1 LFO 1 -> Q · 21=Filter 1 Env -> Q · 22=Amp 1 Volume · 23=Amp 1 LFO 1 -> Volume · 24=Amp 1 Pan · 25=Amp 1 LFO 1 -> Pan · 26=LFO 1 Rate · 27=Osc 2 Pitch · 28=Osc 2 LFO 2 -> Pitch · 29=Osc 2 Pitch Env Depth · 30=Osc 2 Pulse Width · 31=Osc 2 LFO 2 -> Pulse Width · 32=Osc 2 Sub Level · 33=Osc 2 Sync Ratio · 34=Osc 2 Level · 35=Osc 2 Balance · 36=Filter 2 Cutoff · 37=Filter 2 LFO 2 -> Cutoff · 38=Filter 2 Env -> Cutoff · 39=Filter 2 Q · 40=Filter 2 LFO 2 -> Q · 41=Filter 2 Env -> Q · 42=Amp 2 Volume · 43=Amp 2 LFO 2 -> Volume · 44=Amp 2 Pan · 45=Amp 2 LFO 2 -> Pan · 46=LFO 2 Rate |
| 10 | Slide Amt A | -1..1 | 0.5 |  | -1=-100 % · 0=0.0 % · 1=100 % · 0.5=50 % |
| 11 | Slide Dest B | 0..46 |  | q | 0=No Destination · 1=Vibrato Amount · 2=Vibrato Speed · 3=Unison Detune · 4=Noise Level · 5=Noise Balance · 6=Noise Color · 7=Osc 1 Pitch · 8=Osc 1 LFO 1 -> Pitch · 9=Osc 1 Pitch Env Depth · 10=Osc 1 Pulse Width · 11=Osc 1 LFO 1 -> Pulse Width · 12=Osc 1 Sub Level · 13=Osc 1 Sync Ratio · 14=Osc 1 Level · 15=Osc 1 Balance · 16=Filter 1 Cutoff · 17=Filter 1 LFO 1 -> Cutoff · 18=Filter 1 Env -> Cutoff · 19=Filter 1 Q · 20=Filter 1 LFO 1 -> Q · 21=Filter 1 Env -> Q · 22=Amp 1 Volume · 23=Amp 1 LFO 1 -> Volume · 24=Amp 1 Pan · 25=Amp 1 LFO 1 -> Pan · 26=LFO 1 Rate · 27=Osc 2 Pitch · 28=Osc 2 LFO 2 -> Pitch · 29=Osc 2 Pitch Env Depth · 30=Osc 2 Pulse Width · 31=Osc 2 LFO 2 -> Pulse Width · 32=Osc 2 Sub Level · 33=Osc 2 Sync Ratio · 34=Osc 2 Level · 35=Osc 2 Balance · 36=Filter 2 Cutoff · 37=Filter 2 LFO 2 -> Cutoff · 38=Filter 2 Env -> Cutoff · 39=Filter 2 Q · 40=Filter 2 LFO 2 -> Q · 41=Filter 2 Env -> Q · 42=Amp 2 Volume · 43=Amp 2 LFO 2 -> Volume · 44=Amp 2 Pan · 45=Amp 2 LFO 2 -> Pan · 46=LFO 2 Rate |
| 12 | Slide Amt B | -1..1 | 0.5 |  | -1=-100 % · 0=0.0 % · 1=100 % · 0.5=50 % |
| 13 | Octave | -3..3 | 0 |  | -3=-3 · -2=-2 · -1=-1 · 0=0 · 1=1 · 2=2 · 3=3 |
| 14 | Semitone | -12..12 | 0 |  | -12=-12 st · -11=-11 st · -10=-10 st · -9=-9 st · -8=-8 st · -7=-7 st · -6=-6 st · -5=-5 st · -4=-4 st · -3=-3 st · -2=-2 st · -1=-1 st · 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st |
| 15 | Detune | 0..1 | 0.5 |  | 0=-0.50 · 0.25=-0.25 · 0.5=0.00 · 0.75=0.25 · 1=0.50 |
| 16 | Unison On/Off | 0..1 |  | q | 0=Off · 1=On |
| 17 | Unison Voices | 0..1 |  | q | 0=2 · 1=4 |
| 18 | Unison Detune | 0..1 | 0 |  | 0=0.00 · 0.25=25.00 · 0.5=50.00 · 0.75=75.00 · 1=100.00 |
| 19 | Unison Delay | 0..1 | 0 |  | 0=0 ms · 0.25=5 ms · 0.5=14 ms · 0.75=38 ms · 1=100 ms |
| 20 | Key Priority | 0..2 |  | q | 0=High · 1=Low · 2=Last |
| 21 | Key Stretch | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0 % · 0.75=50 % · 1=100 % |
| 22 | Key Error | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 23 | Vib On/Off | 0..1 |  | q | 0=Off · 1=On |
| 24 | Vib Speed | 0..1 | 0.5 |  | 0=0.2 Hz · 0.25=2.7 Hz · 0.5=5.1 Hz · 0.75=7.6 Hz · 1= 10 Hz |
| 25 | Vib Fade-In | 0..1 | 0 |  | 0=0 ms · 0.25=160 ms · 0.5=509 ms · 0.75=1.60 s · 1=5.00 s |
| 26 | Vib Amount | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 27 | Vib Error | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 28 | Vib Delay | 0..1 | 0 |  | 0=0 ms · 0.25=160 ms · 0.5=509 ms · 0.75=1.60 s · 1=5.00 s |
| 29 | Vib < ModWh | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 30 | Glide On/Off | 0..1 |  | q | 0=Off · 1=On |
| 31 | Glide Time | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 32 | Glide Mode | 0..1 |  | q | 0=Prop · 1=Const |
| 33 | Glide Legato | 0..1 |  | q | 0=Off · 1=On |
| 34 | Noise On/Off | 0..1 |  | q | 0=Off · 1=On |
| 35 | Noise Color | 0..1 | 0.5 |  | 0= 20 Hz · 0.25=117 Hz · 0.5=682 Hz · 0.75=3.9 kHz · 1=22.0 kHz |
| 36 | Noise Balance | 0..1 | 0.5 |  | 0= F2 · 0.25=25/75 · 0.5=50/50 · 0.75=75/25 · 1= F1 |
| 37 | Noise Level | 0..1 | 0.8062 |  | 0=-40 dB · 0.25=-28 dB · 0.5=-15 dB · 0.75=-2.7 dB · 1=9.5 dB · 0.8062=0.0 dB |
| 38 | OSC1 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 39 | OSC1 Shape | 0..3 |  | q | 0=Sine · 1=Saw · 2=Rect · 3=Noise |
| 40 | OSC1 Octave | -3..3 | 0 |  | -3=-3 · -2=-2 · -1=-1 · 0=0 · 1=1 · 2=2 · 3=3 |
| 41 | OSC1 Semi | -12..12 | 0 |  | -12=-12 st · -11=-11 st · -10=-10 st · -9=-9 st · -8=-8 st · -7=-7 st · -6=-6 st · -5=-5 st · -4=-4 st · -3=-3 st · -2=-2 st · -1=-1 st · 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st |
| 42 | OSC1 Mode | 0..1 |  | q | 0=Sub · 1=Sync |
| 43 | PEG1 Time | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 44 | OSC1 Detune | 0..1 | 0.5 |  | 0=-3.00 · 0.25=-0.75 · 0.5=0.00 · 0.75=0.75 · 1=3.00 |
| 45 | O1 Keytrack | 0..1 | 0.5 |  | 0=0 % · 0.25=50 % · 0.5=100 % · 0.75=150 % · 1=200 % |
| 46 | OSC1 PW | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 47 | O1 Sub/Sync | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 48 | OSC1 Balance | 0..1 | 0.5 |  | 0= F2 · 0.25=25/75 · 0.5=50/50 · 0.75=75/25 · 1= F1 |
| 49 | PEG1 Amount | -1..1 | 0 |  | -1=-100 % · 0=0 % · 1=100 % |
| 50 | OSC1 < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 51 | O1 PW < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 52 | OSC1 Level | 0..1 | 0.8062 |  | 0=-40 dB · 0.25=-28 dB · 0.5=-15 dB · 0.75=-2.7 dB · 1=9.5 dB · 0.8062=0.0 dB |
| 53 | F1 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 54 | F1 Type | 0..9 |  | q | 0=Low-pass 12dB/oct · 1=Low-pass 24dB/oct · 2=Band-pass 6dB/oct · 3=Band-pass 12dB/oct · 4=Notch 2-pole · 5=Notch 4-pole · 6=High-pass 12dB/oct · 7=High-pass 24dB/oct · 8=Formant 6dB/oct · 9=Formant 12dB/oct |
| 55 | F1 Drive | 0..6 |  | q | 0=Off · 1=Sym1 · 2=Sym2 · 3=Sym3 · 4=Asym1 · 5=Asym2 · 6=Asym3 |
| 56 | F1 Freq < Key | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 57 | F1 Freq | 0..1 | 1 |  | 0= 30 · 0.25=158 · 0.5=834 · 0.75=4.3k · 1=22.0k |
| 58 | F1 Reso < Key | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 59 | F1 Resonance | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 60 | F1 To F2 | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 61 | F1 Freq < LFO | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 62 | F1 Freq < Env | -1..1 | 0 |  | -1=-16.00 · 0=0.00 · 1=16.00 · 0.704761=4.00 |
| 63 | F1 Res < LFO | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 64 | F1 Res < Env | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 65 | FEG1 Exp | 0..1 |  | q | 0=Off · 1=On |
| 66 | FEG1 Loop | 0..3 |  | q | 0=Off · 1=AD-R · 2=ADR-R · 3=ADS-AR |
| 67 | FEG1 Free | 0..1 |  | q | 0=Off · 1=On |
| 68 | FEG1 Legato | 0..1 |  | q | 0=Off · 1=On |
| 69 | FEG1 A < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 70 | FEG1 Attack | 0..1 | 0 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s |
| 71 | FEG1 Decay | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.6=626 ms |
| 72 | FEG1 < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 73 | FEG1 Sustain | 0..1 | 0 |  | 0=0.00 · 0.25=0.25 · 0.5=0.50 · 0.75=0.75 · 1=1.00 |
| 74 | FEG1 S Time | 0..1 | 1 |  | 0=100 ms · 0.25=1.02 s · 0.5=10.4 s · 0.75=101.9 s · 1=inf s |
| 75 | FEG1 Rel | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.484784=250 ms |
| 76 | AMP1 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 77 | AMP1 < Key | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 78 | AMP1 Level | 0..1 | 0.869 |  | 0=-inf dB · 0.25=-28 dB · 0.5=-17 dB · 0.75=-5.4 dB · 1=6.0 dB · 0.474312=-18 dB |
| 79 | A1 Pan < Key | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 80 | AMP1 Pan | 0..1 | 0.5 |  | 0= 50L · 0.25= 25L · 0.5=C · 0.75= 25R · 1= 50R |
| 81 | AMP1 < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 82 | A1 Pan < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 83 | A1 Pan < Env | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 84 | AEG1 Exp | 0..1 |  | q | 0=Off · 1=On |
| 85 | AEG1 Loop | 0..3 |  | q | 0=Off · 1=AD-R · 2=ADR-R · 3=ADS-AR |
| 86 | AEG1 Free | 0..1 |  | q | 0=Off · 1=On |
| 87 | AEG1 Legato | 0..1 |  | q | 0=Off · 1=On |
| 88 | AEG1 A < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 89 | AEG1 Attack | 0..1 | 0 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s |
| 90 | AEG1 Decay | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.6=626 ms |
| 91 | AEG1 < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 92 | AEG1 Sustain | 0..1 | 0 |  | 0=0.00 · 0.25=0.25 · 0.5=0.50 · 0.75=0.75 · 1=1.00 |
| 93 | AEG1 S Time | 0..1 | 1 |  | 0=100 ms · 0.25=1.02 s · 0.5=10.4 s · 0.75=101.9 s · 1=inf s |
| 94 | AEG1 Rel | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.571805=500 ms |
| 95 | LFO1 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 96 | LFO1 Shape | 0..4 |  | q | 0=Sine · 1=Tri · 2=Rect · 3=Noise1 · 4=Noise2 |
| 97 | LFO1 SncRate | 0..23 | 13 |  | 0=4d · 1=4 · 2=4t · 3=2d · 4=2 · 5=2t · 6=1d · 7=1 · 8=1t · 9=1/2d · 10=1/2 · 11=1/2t · 12=1/4d · 13=1/4 · 14=1/4t · 15=1/8d · 16=1/8 · 17=1/8t · 18=1/16d · 19=1/16 · 20=1/16t · 21=1/32d · 22=1/32 · 23=1/32t |
| 98 | LFO1 Sync | 0..1 |  | q | 0=Hertz · 1=Beat |
| 99 | LFO1 Retrig | 0..1 |  | q | 0=Off · 1=On |
| 100 | LFO1 PW | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 101 | LFO1 Speed | 0..1 | 0.5 |  | 0=0.1 Hz · 0.25=0.2 Hz · 0.5=0.9 Hz · 0.75=3.9 Hz · 1= 17 Hz |
| 102 | LFO1 Phase | 0..1 | 0 |  | 0=  0° · 0.25= 90° · 0.5=180° · 0.75=270° · 1=360° |
| 103 | LFO1 Delay | 0..1 | 0 |  | 0=0 ms · 0.25=450 ms · 0.5=1.01 s · 0.75=2.25 s · 1=5.00 s |
| 104 | LFO1 Fade In | 0..1 | 0 |  | 0=0 ms · 0.25=450 ms · 0.5=1.01 s · 0.75=2.25 s · 1=5.00 s |
| 105 | OSC2 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 106 | OSC2 Shape | 0..3 |  | q | 0=Sine · 1=Saw · 2=Rect · 3=Noise |
| 107 | OSC2 Octave | -3..3 | 0 |  | -3=-3 · -2=-2 · -1=-1 · 0=0 · 1=1 · 2=2 · 3=3 |
| 108 | OSC2 Semi | -12..12 | 0 |  | -12=-12 st · -11=-11 st · -10=-10 st · -9=-9 st · -8=-8 st · -7=-7 st · -6=-6 st · -5=-5 st · -4=-4 st · -3=-3 st · -2=-2 st · -1=-1 st · 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st |
| 109 | OSC2 Mode | 0..1 |  | q | 0=Sub · 1=Sync |
| 110 | PEG2 Time | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 111 | OSC2 Detune | 0..1 | 0.5 |  | 0=-3.00 · 0.25=-0.75 · 0.5=0.00 · 0.75=0.75 · 1=3.00 |
| 112 | O2 Keytrack | 0..1 | 0.5 |  | 0=0 % · 0.25=50 % · 0.5=100 % · 0.75=150 % · 1=200 % |
| 113 | OSC2 PW | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 114 | O2 Sub/Sync | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 115 | OSC2 Balance | 0..1 | 0.5 |  | 0= F2 · 0.25=25/75 · 0.5=50/50 · 0.75=75/25 · 1= F1 |
| 116 | PEG2 Amount | -1..1 | 0 |  | -1=-100 % · 0=0 % · 1=100 % |
| 117 | OSC2 < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 118 | O2 PW < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 119 | OSC2 Level | 0..1 | 0.8062 |  | 0=-40 dB · 0.25=-28 dB · 0.5=-15 dB · 0.75=-2.7 dB · 1=9.5 dB · 0.8062=0.0 dB |
| 120 | F2 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 121 | F2 Type | 0..9 |  | q | 0=Low-pass 12dB/oct · 1=Low-pass 24dB/oct · 2=Band-pass 6dB/oct · 3=Band-pass 12dB/oct · 4=Notch 2-pole · 5=Notch 4-pole · 6=High-pass 12dB/oct · 7=High-pass 24dB/oct · 8=Formant 6dB/oct · 9=Formant 12dB/oct |
| 122 | F2 Drive | 0..6 |  | q | 0=Off · 1=Sym1 · 2=Sym2 · 3=Sym3 · 4=Asym1 · 5=Asym2 · 6=Asym3 |
| 123 | F2 Freq < Key | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 124 | F2 Freq | 0..1 | 1 |  | 0= 30 · 0.25=158 · 0.5=834 · 0.75=4.3k · 1=22.0k |
| 125 | F2 Reso < Key | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 126 | F2 Resonance | 0..1 | 0 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 127 | F2 Slave | 0..1 |  | q | 0=Off · 1=On |
| 128 | F2 Freq < LFO | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 129 | F2 Freq < Env | -1..1 | 0 |  | -1=-16.00 · 0=0.00 · 1=16.00 · 0.704761=4.00 |
| 130 | F2 Res < LFO | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 131 | F2 Res < Env | -1..1 | 0 |  | -1=-4.00 · 0=0.00 · 1=4.00 |
| 132 | FEG2 Exp | 0..1 |  | q | 0=Off · 1=On |
| 133 | FEG2 Loop | 0..3 |  | q | 0=Off · 1=AD-R · 2=ADR-R · 3=ADS-AR |
| 134 | FEG2 Free | 0..1 |  | q | 0=Off · 1=On |
| 135 | FEG2 Legato | 0..1 |  | q | 0=Off · 1=On |
| 136 | FEG2 A < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 137 | FEG2 Attack | 0..1 | 0 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s |
| 138 | FEG2 Decay | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.6=626 ms |
| 139 | FEG2 < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 140 | FEG2 Sustain | 0..1 | 0 |  | 0=0.00 · 0.25=0.25 · 0.5=0.50 · 0.75=0.75 · 1=1.00 |
| 141 | FEG2 S Time | 0..1 | 1 |  | 0=100 ms · 0.25=1.02 s · 0.5=10.4 s · 0.75=101.9 s · 1=inf s |
| 142 | FEG2 Rel | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.484784=250 ms |
| 143 | AMP2 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 144 | AMP2 < Key | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 145 | AMP2 Level | 0..1 | 0.869 |  | 0=-inf dB · 0.25=-28 dB · 0.5=-17 dB · 0.75=-5.4 dB · 1=6.0 dB · 0.474312=-18 dB |
| 146 | A2 Pan < Key | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 147 | AMP2 Pan | 0..1 | 0.5 |  | 0= 50L · 0.25= 25L · 0.5=C · 0.75= 25R · 1= 50R |
| 148 | AMP2 < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 149 | A2 Pan < LFO | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 150 | A2 Pan < Env | -1..1 | 0 |  | -1=-1.00 · 0=0.00 · 1=1.00 |
| 151 | AEG2 Exp | 0..1 |  | q | 0=Off · 1=On |
| 152 | AEG2 Loop | 0..3 |  | q | 0=Off · 1=AD-R · 2=ADR-R · 3=ADS-AR |
| 153 | AEG2 Free | 0..1 |  | q | 0=Off · 1=On |
| 154 | AEG2 Legato | 0..1 |  | q | 0=Off · 1=On |
| 155 | AEG2 A < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 156 | AEG2 Attack | 0..1 | 0 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s |
| 157 | AEG2 Decay | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.6=626 ms |
| 158 | AEG2 < Vel | 0..1 | 0 |  | 0=0.00 · 0.25=2.02 · 0.5=4.00 · 0.75=6.02 · 1=8.00 |
| 159 | AEG2 Sustain | 0..1 | 0 |  | 0=0.00 · 0.25=0.25 · 0.5=0.50 · 0.75=0.75 · 1=1.00 |
| 160 | AEG2 S Time | 0..1 | 1 |  | 0=100 ms · 0.25=1.02 s · 0.5=10.4 s · 0.75=101.9 s · 1=inf s |
| 161 | AEG2 Rel | 0..1 | 0.6 |  | 0=5 ms · 0.25=38 ms · 0.5=283 ms · 0.75=2.06 s · 1=15.0 s · 0.571805=500 ms |
| 162 | LFO2 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 163 | LFO2 Shape | 0..4 |  | q | 0=Sine · 1=Tri · 2=Rect · 3=Noise1 · 4=Noise2 |
| 164 | LFO2 SncRate | 0..23 | 13 |  | 0=4d · 1=4 · 2=4t · 3=2d · 4=2 · 5=2t · 6=1d · 7=1 · 8=1t · 9=1/2d · 10=1/2 · 11=1/2t · 12=1/4d · 13=1/4 · 14=1/4t · 15=1/8d · 16=1/8 · 17=1/8t · 18=1/16d · 19=1/16 · 20=1/16t · 21=1/32d · 22=1/32 · 23=1/32t |
| 165 | LFO2 Sync | 0..1 |  | q | 0=Hertz · 1=Beat |
| 166 | LFO2 Retrig | 0..1 |  | q | 0=Off · 1=On |
| 167 | LFO2 PW | 0..1 | 0.5 |  | 0=0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 168 | LFO2 Speed | 0..1 | 0.5 |  | 0=0.1 Hz · 0.25=0.2 Hz · 0.5=0.9 Hz · 0.75=3.9 Hz · 1= 17 Hz |
| 169 | LFO2 Phase | 0..1 | 0 |  | 0=  0° · 0.25= 90° · 0.5=180° · 0.75=270° · 1=360° |
| 170 | LFO2 Delay | 0..1 | 0 |  | 0=0 ms · 0.25=450 ms · 0.5=1.01 s · 0.75=2.25 s · 1=5.00 s |
| 171 | LFO2 Fade In | 0..1 | 0 |  | 0=0 ms · 0.25=450 ms · 0.5=1.01 s · 0.75=2.25 s · 1=5.00 s |

## Other attributes (11)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Analog | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | UltraAnalog | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `name` | S | L | Analog | Return access to the name of the device. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
