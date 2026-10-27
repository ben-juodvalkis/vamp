# Collision

`Collision` ("Collision"), Python `Device`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, factory default. Raw dump: [`dumps/Collision.json`](dumps/Collision.json).

## Parameters (140)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Structure | 0..1 |  | q | 0=1 > 2 · 1=1 + 2 |
| 2 | PB Range | 0..24 | 5 |  | 0=0 st · 1=+1 st · 2=+2 st · 3=+3 st · 4=+4 st · 5=+5 st · 6=+6 st · 7=+7 st · 8=+8 st · 9=+9 st · 10=+10 st · 11=+11 st · 12=+12 st · 13=+13 st · 14=+14 st · 15=+15 st · 16=+16 st · 17=+17 st · 18=+18 st · 19=+19 st · 20=+20 st · 21=+21 st · 22=+22 st · 23=+23 st · 24=+24 st |
| 3 | Voices | 0..8 |  | q | 0=Mono · 1=2 · 2=4 · 3=6 · 4=8 · 5=10 · 6=12 · 7=14 · 8=16 |
| 4 | Retrig On | 0..1 |  | q | 0=Off · 1=On |
| 5 | Volume | 0..1 | 0.704789 |  | 0=-inf dB · 0.25=-18 dB · 0.5=-6.0 dB · 0.75=1.0 dB · 1=6.0 dB · 0.704789=-0.1 dB |
| 6 | Note PB Range | 0..48 | 0 |  | 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st · 13=13 st · 14=14 st · 15=15 st · 16=16 st · 17=17 st · 18=18 st · 19=19 st · 20=20 st · 21=21 st · 22=22 st · 23=23 st · 24=24 st · 25=25 st · 26=26 st · 27=27 st · 28=28 st · 29=29 st · 30=30 st · 31=31 st · 32=32 st · 33=33 st · 34=34 st · 35=35 st · 36=36 st · 37=37 st · 38=38 st · 39=39 st · 40=40 st · 41=41 st · 42=42 st · 43=43 st · 44=44 st · 45=45 st · 46=46 st · 47=47 st · 48=48 st |
| 7 | Mallet On/Off | 0..1 |  | q | 0=Off · 1=On |
| 8 | Mallet Volume | 0..1 | 0.5 |  | 0=-60 dB · 0.25=-45 dB · 0.5=-30 dB · 0.75=-15 dB · 1=0.0 dB |
| 9 | Mallet Volume < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 10 | Mallet Volume < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 11 | Mallet Stiffness | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 12 | Mallet Stiffness < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 13 | Mallet Stiffness < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 14 | Mallet Noise Amount | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 15 | Mallet Noise Amount < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 16 | Mallet Noise Amount < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 17 | Mallet Noise Color | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 18 | Noise On/Off | 0..1 |  | q | 0=Off · 1=On |
| 19 | Noise Volume | 0..1 | 0.5 |  | 0=-60 dB · 0.25=-45 dB · 0.5=-30 dB · 0.75=-15 dB · 1=0.0 dB |
| 20 | Noise Volume < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 21 | Noise Volume < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 22 | Noise Filter Type | 0..3 |  | q | 0=LP · 1=HP · 2=BP · 3=LP+HP |
| 23 | Noise Filter Freq | 0..1 | 0.5 |  | 0= 50 Hz · 0.25=218 Hz · 0.5=949 Hz · 0.75=4.1 kHz · 1=18.0 kHz |
| 24 | Noise Freq < Vel | -8..8 | 0 |  | -8=-100 % · -7=-88 % · -6=-75 % · -5=-62 % · -4=-50 % · -3=-38 % · -2=-25 % · -1=-12 % · 0=0.0 % · 1=12 % · 2=25 % · 3=38 % · 4=50 % · 5=62 % · 6=75 % · 7=88 % · 8=100 % |
| 25 | Noise Freq < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 26 | Noise Freq < Env | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 27 | Noise Filter Q | 0..1 | 0 |  | 0=0.20 · 0.25=0.39 · 0.5=0.77 · 0.75=1.52 · 1=3.00 |
| 28 | Noise Attack | 0..1 | 0 |  | 0=0 ms · 0.25=7 ms · 0.5=100 ms · 0.75=1.41 s · 1=20.0 s |
| 29 | Noise Decay | 0..1 | 0.2 |  | 0=2 ms · 0.25=26 ms · 0.5=346 ms · 0.75=4.56 s · 1=60.0 s · 0.2=16 ms |
| 30 | Noise Sustain | 0..1 | 0 |  | 0=0.00 · 0.25=25.00 · 0.5=50.00 · 0.75=75.00 · 1=100.00 |
| 31 | Noise Release | 0..1 | 0.2 |  | 0=2 ms · 0.25=26 ms · 0.5=346 ms · 0.75=4.56 s · 1=60.0 s · 0.2=16 ms |
| 32 | Res 1 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 33 | Res 1 Type | 0..6 |  | q | 0=Beam · 1=Marimba · 2=String · 3=Membrane · 4=Plate · 5=Pipe · 6=Tube |
| 34 | Res 1 Quality | 0..3 |  | q | 0=Eco · 1=Low · 2=Med · 3=High |
| 35 | Res 1 Tune | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=+24 st · 48=+48 st |
| 36 | Res 1 Fine Tune | -50..50 | 0 |  | -50=-50 ct · -25=-25 ct · 0=0 ct · 25=25 ct · 50=50 ct |
| 37 | Res 1 Tune < Key | -2..2 | 1 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 38 | Res 1 Pitch Env. | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 39 | Res 1 Pitch Env. < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 40 | Res 1 Pitch Env. Time | 0..1 | 0.5 |  | 0=1 ms · 0.25=10 ms · 0.5=100 ms · 0.75=1.00 s · 1=10.0 s |
| 41 | Res 1 Decay | 0..1 | 0.5 |  | 0=50 ms · 0.25=257 ms · 0.5=1.32 s · 0.75=6.80 s · 1=35.0 s |
| 42 | Res 1 Decay < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 43 | Res 1 Decay < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 44 | Res 1 Off Decay | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 45 | Res 1 Material | -1..1 | 0 |  | -1=-100.00 · 0=0.00 · 1=100.00 |
| 46 | Res 1 Material < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 47 | Res 1 Material < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 48 | Res 1 Radius | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 49 | Res 1 Radius < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 50 | Res 1 Radius < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 51 | Res 1 Ratio | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 52 | Res 1 Brightness | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 53 | Res 1 Bleed | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 54 | Res 1 Inharmonics | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 55 | Res 1 Inharmonics < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 56 | Res 1 Opening | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 57 | Res 1 Opening < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 58 | Res 1 Hit | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 59 | Res 1 Hit < Random | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 60 | Res 1 Listening L | 0..1 | 0.1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.1=10 % |
| 61 | Res 1 Listening R | 0..1 | 0.9 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.9=90 % |
| 62 | Res 1 Pan | -1..1 | 0 |  | -1=50L · 0=C · 1=50R |
| 63 | Res 1 Pan < Key | -1..1 | 0 |  | -1=-500 % · 0=0.0 % · 1=500 % |
| 64 | Res 1 Volume | 0..1 | 0.5 |  | 0=-inf dB · 0.25=-18 dB · 0.5=-6.0 dB · 0.75=1.0 dB · 1=6.0 dB |
| 65 | Res 2 On/Off | 0..1 |  | q | 0=Off · 1=On |
| 66 | Res 2 Type | 0..6 |  | q | 0=Beam · 1=Marimba · 2=String · 3=Membrane · 4=Plate · 5=Pipe · 6=Tube |
| 67 | Res 2 Quality | 0..3 |  | q | 0=Eco · 1=Low · 2=Med · 3=High |
| 68 | Res 2 Tune | -48..48 | 0 |  | -48=-48 st · -24=-24 st · 0=0 st · 24=+24 st · 48=+48 st |
| 69 | Res 2 Fine Tune | -50..50 | 0 |  | -50=-50 ct · -25=-25 ct · 0=0 ct · 25=25 ct · 50=50 ct |
| 70 | Res 2 Tune < Key | -2..2 | 1 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 71 | Res 2 Pitch Env. | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 72 | Res 2 Pitch Env. < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 73 | Res 2 Pitch Env. Time | 0..1 | 0.5 |  | 0=1 ms · 0.25=10 ms · 0.5=100 ms · 0.75=1.00 s · 1=10.0 s |
| 74 | Res 2 Decay | 0..1 | 0.5 |  | 0=50 ms · 0.25=257 ms · 0.5=1.32 s · 0.75=6.80 s · 1=35.0 s |
| 75 | Res 2 Decay < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 76 | Res 2 Decay < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 77 | Res 2 Off Decay | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 78 | Res 2 Material | -1..1 | 0 |  | -1=-100.00 · 0=0.00 · 1=100.00 |
| 79 | Res 2 Material < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 80 | Res 2 Material < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 81 | Res 2 Radius | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 82 | Res 2 Radius < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 83 | Res 2 Radius < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 84 | Res 2 Ratio | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 85 | Res 2 Brightness | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 86 | Res 2 Bleed | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 87 | Res 2 Inharmonics | -1..1 | 0 |  | -1=-100 % · 0=0.0 % · 1=100 % |
| 88 | Res 2 Inharmonics < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 89 | Res 2 Opening | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 90 | Res 2 Opening < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 91 | Res 2 Hit | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 92 | Res 2 Hit < Random | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 93 | Res 2 Listening L | 0..1 | 0.1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.1=10 % |
| 94 | Res 2 Listening R | 0..1 | 0.9 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % · 0.9=90 % |
| 95 | Res 2 Pan | -1..1 | 0 |  | -1=50L · 0=C · 1=50R |
| 96 | Res 2 Pan < Key | -1..1 | 0 |  | -1=-500 % · 0=0.0 % · 1=500 % |
| 97 | Res 2 Volume | 0..1 | 0.5 |  | 0=-inf dB · 0.25=-18 dB · 0.5=-6.0 dB · 0.75=1.0 dB · 1=6.0 dB |
| 98 | LFO 1 On | 0..1 |  | q | 0=Off · 1=On |
| 99 | LFO 1 Wave | 0..6 |  | q | 0=Sine · 1=Square · 2=Triangle · 3=SawUp · 4=SawDown · 5=Sample & Hold · 6=Random Ramp |
| 100 | LFO 1 Retrig On | 0..1 |  | q | 0=Off · 1=On |
| 101 | LFO 1 Sync | 0..1 |  | q | 0=Free · 1=Sync |
| 102 | LFO 1 Freq | 0..1 | 0.5 |  | 0=0.0 Hz · 0.25=0.1 Hz · 0.5=0.3 Hz · 0.75=1.8 Hz · 1= 10 Hz |
| 103 | LFO 1 Synced | 0..21 | 4 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 104 | LFO 1 Rate < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 105 | LFO 1 Offset | 0..360 | 0 |  | 0=0.00° · 90=90.0° · 180=180° · 270=270° · 360=360° |
| 106 | LFO 1 Amount | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 107 | LFO 1 Depth < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 108 | LFO 1 Dest A | 0..16 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 2 Frequency · 16=LFO 2 Amount |
| 109 | LFO 1 Amt A | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 110 | LFO 1 Dest B | 0..16 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 2 Frequency · 16=LFO 2 Amount |
| 111 | LFO 1 Amt B | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 112 | LFO 2 On | 0..1 |  | q | 0=Off · 1=On |
| 113 | LFO 2 Wave | 0..6 |  | q | 0=Sine · 1=Square · 2=Triangle · 3=SawUp · 4=SawDown · 5=Sample & Hold · 6=Random Ramp |
| 114 | LFO 2 Retrig On | 0..1 |  | q | 0=Off · 1=On |
| 115 | LFO 2 Sync | 0..1 |  | q | 0=Free · 1=Sync |
| 116 | LFO 2 Freq | 0..1 | 0.5 |  | 0=0.0 Hz · 0.25=0.1 Hz · 0.5=0.3 Hz · 0.75=1.8 Hz · 1= 10 Hz |
| 117 | LFO 2 Synced | 0..21 | 4 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 118 | LFO 2 Rate < Key | -2..2 | 0 |  | -2=-200 % · -1=-100 % · 0=0.0 % · 1=100 % · 2=200 % |
| 119 | LFO 2 Offset | 0..360 | 0 |  | 0=0.00° · 90=90.0° · 180=180° · 270=270° · 360=360° |
| 120 | LFO 2 Amount | 0..1 | 0.5 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 121 | LFO 2 Depth < Vel | -5..5 | 0 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % |
| 122 | LFO 2 Dest A | 0..16 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency |
| 123 | LFO 2 Amt A | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 124 | LFO 2 Dest B | 0..16 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency |
| 125 | LFO 2 Amt B | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 126 | PB Dest A | 0..17 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency · 17=LFO 2 Amount |
| 127 | PB Amt A | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 128 | MW Dest A | 0..17 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency · 17=LFO 2 Amount |
| 129 | MW Amt A | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 130 | MW Dest B | 0..17 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency · 17=LFO 2 Amount |
| 131 | MW Amt B | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 132 | Press Dest A | 0..17 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency · 17=LFO 2 Amount |
| 133 | Press Amt A | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 134 | Press Dest B | 0..17 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency · 17=LFO 2 Amount |
| 135 | Press Amt B | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 136 | Slide Dest A | 0..17 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency · 17=LFO 2 Amount |
| 137 | Slide Amt A | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |
| 138 | Slide Dest B | 0..17 |  | q | 0=No Destination · 1=Mallet Stiffness · 2=Noise Freq · 3=Noise Volume · 4=Res 1 Pitch · 5=Res 1 Hit · 6=Res 1 Pan · 7=Res 1 Pipe Opening · 8=Res 2 Input · 9=Res 2 Pitch · 10=Res 2 Hit · 11=Res 2 Pan · 12=Res 2 Pipe Opening · 13=Volume · 14=LFO 1 Frequency · 15=LFO 1 Amount · 16=LFO 2 Frequency · 17=LFO 2 Amount |
| 139 | Slide Amt B | -5..5 | 2.5 |  | -5=-100 % · -4=-80 % · -3=-60 % · -2=-40 % · -1=-20 % · 0=0.0 % · 1=20 % · 2=40 % · 3=60 % · 4=80 % · 5=100 % · 2.5=50 % |

## Other attributes (11)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Collision | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | Collision | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 1.3333333333333333 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 64 | Returns the latency of the device in samples. |
| `name` | S | L | Collision | Return access to the name of the device. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
