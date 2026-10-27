# Meld

`InstrumentMeld` ("Meld"), Python `MeldDevice`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, factory default. Raw dump: [`dumps/Meld.json`](dumps/Meld.json).

## Parameters (129)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On [On] | 0..1 |  | q | 0=Off · 1=On |
| 1 | A On [MeldVoice_EngineA_On] | 0..1 |  | q | 0=Off · 1=On |
| 2 | A Keytracking [MeldVoice_EngineA_Oscillator_Pitch_Keytracking] | 0..1 |  | q | 0=Off · 1=On |
| 3 | A Transpose [MeldVoice_EngineA_Oscillator_Pitch_Transpose] | -12..12 | 0 |  | -12=-12 st · -11=-11 st · -10=-10 st · -9=-9 st · -8=-8 st · -7=-7 st · -6=-6 st · -5=-5 st · -4=-4 st · -3=-3 st · -2=-2 st · -1=-1 st · 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st |
| 4 | A Transp Scale [MeldVoice_EngineA_Oscillator_Pitch_TransposeScaleDegrees] | -48..48 | 0 |  | -48=-48 sd · -24=-24 sd · 0=0 sd · 24=24 sd · 48=48 sd |
| 5 | A Octave [MeldVoice_EngineA_Oscillator_Pitch_TransposeOctaves] | -3..3 | 0 |  | -3=-3 oct · -2=-2 oct · -1=-1 oct · 0=0 oct · 1=1 oct · 2=2 oct · 3=3 oct |
| 6 | A Detune [MeldVoice_EngineA_Oscillator_Pitch_Detune] | 0..1 | 0.5 |  | 0=-50 ct · 0.25=-25 ct · 0.5=0 ct · 0.75=25 ct · 1=50 ct |
| 7 | A Osc Type [MeldVoice_EngineA_Oscillator_OscillatorType] | 0..24 |  | q | 0=Basic Shapes · 1=Dual Basic Shapes  (♭♯) · 2=Noisy Shapes · 3=Square Sync · 4=Square 5th · 5=Sub · 6=Swarm Sine  (♭♯) · 7=Swarm Triangle  (♭♯) · 8=Swarm Saw  (♭♯) · 9=Swarm Square  (♭♯) · 10=Harmonic Fm · 11=Fold Fm · 12=Squelch · 13=Simple Fm · 14=Chip  (♭♯) · 15=Shepard's Pi · 16=Tarp · 17=Extratone · 18=Noise Loop · 19=Filtered Noise · 20=Bitgrunge · 21=Crackle · 22=Rain · 23=Bubble · 24=Chord  (♭♯) |
| 8 | A Osc Shape [MeldVoice_EngineA_Oscillator_Macro1] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 9 | A Osc Tone [MeldVoice_EngineA_Oscillator_Macro2] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 10 | A Osc Scale Aware [MeldVoice_EngineA_Oscillator_UseScale] | 0..1 |  | q | 0=Off · 1=On |
| 11 | A Reset [MeldVoice_EngineA_Oscillator_Reset] | 0..1 |  | q | 0=Off · 1=On |
| 12 | A Reset To Voice Offset [MeldVoice_EngineA_Oscillator_ResetToVoiceOffset] | 0..1 |  | q | 0=Off · 1=On |
| 13 | A Filter On [MeldVoice_EngineA_Filter_On] | 0..1 |  | q | 0=Off · 1=On |
| 14 | A Filter Type [MeldVoice_EngineA_Filter_FilterType] | 0..16 |  | q | 0=SVF 12dB · 1=SVF 24dB · 2=LP 12dB MS2 · 3=HP 12dB MS2 · 4=BP 12dB OSR · 5=LP Crunch 12dB · 6=LP Switched Res · 7=Filther · 8=Eq Peak · 9=Eq Notch · 10=Phaser · 11=Redux · 12=Vowel · 13=Comb + · 14=Comb - · 15=Plate Resonator  (♭♯) · 16=Membrane Resonator  (♭♯) |
| 15 | A Filter Freq [MeldVoice_EngineA_Filter_Frequency] | 0..1 | 1 |  | 0=20.0 Hz · 0.25=113 Hz · 0.5=640 Hz · 0.75=3.62 kHz · 1=20.5 kHz |
| 16 | A Filter Q [MeldVoice_EngineA_Filter_Macro1] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 17 | A Filter L-B-H-N [MeldVoice_EngineA_Filter_Macro2] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 18 | A Filter Filter Scale Aware [MeldVoice_EngineA_Filter_UseScale] | 0..1 |  | q | 0=Off · 1=On |
| 19 | A LFO 1 Wave [MeldVoice_EngineA_Lfo1_GeneratorType] | 0..5 |  | q | 0=Basic Shapes · 1=Ramp · 2=Wander · 3=Alternate · 4=Euclid · 5=Pulsate |
| 20 | A LFO 1 Sync [MeldVoice_EngineA_Lfo1_Sync] | 0..1 |  | q | 0=Free · 1=Tempo |
| 21 | A LFO 1 Retrig On [MeldVoice_EngineA_Lfo1_Retrigger] | 0..1 |  | q | 0=Off · 1=On |
| 22 | A LFO 1 Freq [MeldVoice_EngineA_Lfo1_Rate] | 0..1 | 0.23138 |  | 0=0.01 Hz · 0.25=1.26 Hz · 0.5=10.0 Hz · 0.75=26.8 Hz · 1=200 Hz · 0.23138=1.00 Hz |
| 23 | A LFO 1 Synced [MeldVoice_EngineA_Lfo1_SyncedRate] | 0..21 | 15 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 24 | A LFO 1 Offset [MeldVoice_EngineA_Lfo1_PhaseOffset] | 0..1 | 0 |  | 0=0.0° · 0.25=90° · 0.5=180° · 0.75=270° · 1=360° |
| 25 | A LFO 1 Shape [MeldVoice_EngineA_Lfo1_GeneratorMacro1] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 26 | A LFO 1 Fold [MeldVoice_EngineA_Lfo1_GeneratorMacro2] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 27 | A LFO 1 FX 1 Type [MeldVoice_EngineA_Lfo1_Transformer1Type] | 0..18 |  | q | 0=None · 1=Offset · 2=Attenuverter · 3=Gate · 4=Skew Unipolar · 5=Skew Bipolar · 6=Unipolarizer · 7=Quantizer · 8=S&H · 9=Independent S&H · 10=Clipper · 11=Fade In · 12=Fade Out · 13=Slew Down · 14=Slew Up · 15=Slew Up & Down · 16=Trig Env · 17=Comparator · 18=Scrambler |
| 28 | A LFO 1 FX 1 Scale [MeldVoice_EngineA_Lfo1_Transformer1Macro] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 29 | A LFO 1 FX 2 Type [MeldVoice_EngineA_Lfo1_Transformer2Type] | 0..18 |  | q | 0=None · 1=Offset · 2=Attenuverter · 3=Gate · 4=Skew Unipolar · 5=Skew Bipolar · 6=Unipolarizer · 7=Quantizer · 8=S&H · 9=Independent S&H · 10=Clipper · 11=Fade In · 12=Fade Out · 13=Slew Down · 14=Slew Up · 15=Slew Up & Down · 16=Trig Env · 17=Comparator · 18=Scrambler |
| 30 | A LFO 1 FX 2 Ramp [MeldVoice_EngineA_Lfo1_Transformer2Macro] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 31 | A LFO 2 Wave [MeldVoice_EngineA_Lfo2_Waveform] | 0..5 |  | q | 0=Sine · 1=Tri · 2=Saw Up · 3=Saw Down · 4=Rectangle · 5=Random S&H |
| 32 | A LFO 2 Sync [MeldVoice_EngineA_Lfo2_Sync] | 0..1 |  | q | 0=Free · 1=Tempo |
| 33 | A LFO 2 Freq [MeldVoice_EngineA_Lfo2_Rate] | 0..1 | 0.416011 |  | 0=0.01 Hz · 0.25=0.79 Hz · 0.5=12.5 Hz · 0.75=63.3 Hz · 1=200 Hz · 0.416011=6.00 Hz |
| 34 | A LFO 2 Synced [MeldVoice_EngineA_Lfo2_SyncedRate] | 0..21 | 12 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 35 | A LFO 2 Retrig On [MeldVoice_EngineA_Lfo2_Retrigger] | 0..1 |  | q | 0=Off · 1=On |
| 36 | A LFO 2 Offset [MeldVoice_EngineA_Lfo2_PhaseOffset] | 0..1 | 0 |  | 0=0.0° · 0.25=90° · 0.5=180° · 0.75=270° · 1=360° |
| 37 | A Amp Attack [MeldVoice_EngineA_AmpEnvelope_Times_Attack] | 0..1 | 0.0707107 |  | 0=0.00 ms · 0.25=156 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.070711=1.00 ms |
| 38 | A Amp Decay [MeldVoice_EngineA_AmpEnvelope_Times_Decay] | 0..1 | 0.349748 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.349748=600 ms |
| 39 | A Amp Release [MeldVoice_EngineA_AmpEnvelope_Times_Release] | 0..1 | 0.186606 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.186606=50.0 ms |
| 40 | A Amp A Slope [MeldVoice_EngineA_AmpEnvelope_Slopes_Attack] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 41 | A Amp D Slope [MeldVoice_EngineA_AmpEnvelope_Slopes_Decay] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 42 | A Amp R Slope [MeldVoice_EngineA_AmpEnvelope_Slopes_Release] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 43 | A Amp Sustain [MeldVoice_EngineA_AmpEnvelope_Sustain] | 0..1 | 1 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-12 dB · 0.75=-5.0 dB · 1=0.0 dB |
| 44 | A Amp Loop Mode [MeldVoice_EngineA_AmpEnvelope_LoopMode] | 0..3 |  | q | 0=None · 1=Trigger · 2=Loop · 3=AD Loop |
| 45 | A Mod Attack [MeldVoice_EngineA_FilterEnvelope_Times_Attack] | 0..1 | 0.0707107 |  | 0=0.00 ms · 0.25=156 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.070711=1.00 ms |
| 46 | A Mod Decay [MeldVoice_EngineA_FilterEnvelope_Times_Decay] | 0..1 | 0.349748 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.349748=600 ms |
| 47 | A Mod Release [MeldVoice_EngineA_FilterEnvelope_Times_Release] | 0..1 | 0.186606 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.186606=50.0 ms |
| 48 | A Mod Initial [MeldVoice_EngineA_FilterEnvelope_Values_Initial] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 49 | A Mod Peak [MeldVoice_EngineA_FilterEnvelope_Values_Peak] | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 50 | A Mod Sustain [MeldVoice_EngineA_FilterEnvelope_Values_Sustain] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 51 | A Mod Final [MeldVoice_EngineA_FilterEnvelope_Values_Final] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 52 | A Mod A Slope [MeldVoice_EngineA_FilterEnvelope_Slopes_Attack] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 53 | A Mod D Slope [MeldVoice_EngineA_FilterEnvelope_Slopes_Decay] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 54 | A Mod R Slope [MeldVoice_EngineA_FilterEnvelope_Slopes_Release] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 55 | A Mod Loop Mode [MeldVoice_EngineA_FilterEnvelope_LoopMode] | 0..3 |  | q | 0=None · 1=Trigger · 2=Loop · 3=AD Loop |
| 56 | A Tone Filter [MeldVoice_EngineA_ToneFilter] | 0..1 | 0.5 |  | 0=-1.00  · 0.25=-0.50  · 0.5=0.00  · 0.75=0.50  · 1=1.00  |
| 57 | A Pan [MeldVoice_EngineA_Pan] | 0..1 | 0.5 |  | 0=50L · 0.25=25L · 0.5=C · 0.75=25R · 1=50R |
| 58 | A Volume [MeldVoice_EngineA_Volume] | 0..1 | 0.635135 |  | 0=-50 dB · 0.25=-32 dB · 0.5=-13 dB · 0.75=5.5 dB · 1=24 dB · 0.635135=-3.0 dB |
| 59 | A Glide Mode [MeldVoice_EngineA_GlideMode] | 0..1 |  | q | 0=Portamento · 1=Glissando |
| 60 | A Glide Time [MeldVoice_EngineA_GlideTime] | 0..1 | 0 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s |
| 61 | B On [MeldVoice_EngineB_On] | 0..1 |  | q | 0=Off · 1=On |
| 62 | B Keytracking [MeldVoice_EngineB_Oscillator_Pitch_Keytracking] | 0..1 |  | q | 0=Off · 1=On |
| 63 | B Transpose [MeldVoice_EngineB_Oscillator_Pitch_Transpose] | -12..12 | 0 |  | -12=-12 st · -11=-11 st · -10=-10 st · -9=-9 st · -8=-8 st · -7=-7 st · -6=-6 st · -5=-5 st · -4=-4 st · -3=-3 st · -2=-2 st · -1=-1 st · 0=0 st · 1=1 st · 2=2 st · 3=3 st · 4=4 st · 5=5 st · 6=6 st · 7=7 st · 8=8 st · 9=9 st · 10=10 st · 11=11 st · 12=12 st |
| 64 | B Transp Scale [MeldVoice_EngineB_Oscillator_Pitch_TransposeScaleDegrees] | -48..48 | 0 |  | -48=-48 sd · -24=-24 sd · 0=0 sd · 24=24 sd · 48=48 sd |
| 65 | B Octave [MeldVoice_EngineB_Oscillator_Pitch_TransposeOctaves] | -3..3 | 0 |  | -3=-3 oct · -2=-2 oct · -1=-1 oct · 0=0 oct · 1=1 oct · 2=2 oct · 3=3 oct |
| 66 | B Detune [MeldVoice_EngineB_Oscillator_Pitch_Detune] | 0..1 | 0.5 |  | 0=-50 ct · 0.25=-25 ct · 0.5=0 ct · 0.75=25 ct · 1=50 ct |
| 67 | B Osc Type [MeldVoice_EngineB_Oscillator_OscillatorType] | 0..24 |  | q | 0=Basic Shapes · 1=Dual Basic Shapes  (♭♯) · 2=Noisy Shapes · 3=Square Sync · 4=Square 5th · 5=Sub · 6=Swarm Sine  (♭♯) · 7=Swarm Triangle  (♭♯) · 8=Swarm Saw  (♭♯) · 9=Swarm Square  (♭♯) · 10=Harmonic Fm · 11=Fold Fm · 12=Squelch · 13=Simple Fm · 14=Chip  (♭♯) · 15=Shepard's Pi · 16=Tarp · 17=Extratone · 18=Noise Loop · 19=Filtered Noise · 20=Bitgrunge · 21=Crackle · 22=Rain · 23=Bubble · 24=Chord  (♭♯) |
| 68 | B Osc Shape [MeldVoice_EngineB_Oscillator_Macro1] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 69 | B Osc Tone [MeldVoice_EngineB_Oscillator_Macro2] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 70 | B Osc Scale Aware [MeldVoice_EngineB_Oscillator_UseScale] | 0..1 |  | q | 0=Off · 1=On |
| 71 | B Reset [MeldVoice_EngineB_Oscillator_Reset] | 0..1 |  | q | 0=Off · 1=On |
| 72 | B Reset To Voice Offset [MeldVoice_EngineB_Oscillator_ResetToVoiceOffset] | 0..1 |  | q | 0=Off · 1=On |
| 73 | B Filter On [MeldVoice_EngineB_Filter_On] | 0..1 |  | q | 0=Off · 1=On |
| 74 | B Filter Type [MeldVoice_EngineB_Filter_FilterType] | 0..16 |  | q | 0=SVF 12dB · 1=SVF 24dB · 2=LP 12dB MS2 · 3=HP 12dB MS2 · 4=BP 12dB OSR · 5=LP Crunch 12dB · 6=LP Switched Res · 7=Filther · 8=Eq Peak · 9=Eq Notch · 10=Phaser · 11=Redux · 12=Vowel · 13=Comb + · 14=Comb - · 15=Plate Resonator  (♭♯) · 16=Membrane Resonator  (♭♯) |
| 75 | B Filter Freq [MeldVoice_EngineB_Filter_Frequency] | 0..1 | 1 |  | 0=20.0 Hz · 0.25=113 Hz · 0.5=640 Hz · 0.75=3.62 kHz · 1=20.5 kHz |
| 76 | B Filter Q [MeldVoice_EngineB_Filter_Macro1] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 77 | B Filter L-B-H-N [MeldVoice_EngineB_Filter_Macro2] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 78 | B Filter Filter Scale Aware [MeldVoice_EngineB_Filter_UseScale] | 0..1 |  | q | 0=Off · 1=On |
| 79 | B LFO 1 Wave [MeldVoice_EngineB_Lfo1_GeneratorType] | 0..5 |  | q | 0=Basic Shapes · 1=Ramp · 2=Wander · 3=Alternate · 4=Euclid · 5=Pulsate |
| 80 | B LFO 1 Sync [MeldVoice_EngineB_Lfo1_Sync] | 0..1 |  | q | 0=Free · 1=Tempo |
| 81 | B LFO 1 Retrig On [MeldVoice_EngineB_Lfo1_Retrigger] | 0..1 |  | q | 0=Off · 1=On |
| 82 | B LFO 1 Freq [MeldVoice_EngineB_Lfo1_Rate] | 0..1 | 0.23138 |  | 0=0.01 Hz · 0.25=1.26 Hz · 0.5=10.0 Hz · 0.75=26.8 Hz · 1=200 Hz · 0.23138=1.00 Hz |
| 83 | B LFO 1 Synced [MeldVoice_EngineB_Lfo1_SyncedRate] | 0..21 | 15 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 84 | B LFO 1 Offset [MeldVoice_EngineB_Lfo1_PhaseOffset] | 0..1 | 0 |  | 0=0.0° · 0.25=90° · 0.5=180° · 0.75=270° · 1=360° |
| 85 | B LFO 1 Shape [MeldVoice_EngineB_Lfo1_GeneratorMacro1] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 86 | B LFO 1 Fold [MeldVoice_EngineB_Lfo1_GeneratorMacro2] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 87 | B LFO 1 FX 1 Type [MeldVoice_EngineB_Lfo1_Transformer1Type] | 0..18 |  | q | 0=None · 1=Offset · 2=Attenuverter · 3=Gate · 4=Skew Unipolar · 5=Skew Bipolar · 6=Unipolarizer · 7=Quantizer · 8=S&H · 9=Independent S&H · 10=Clipper · 11=Fade In · 12=Fade Out · 13=Slew Down · 14=Slew Up · 15=Slew Up & Down · 16=Trig Env · 17=Comparator · 18=Scrambler |
| 88 | B LFO 1 FX 1 Scale [MeldVoice_EngineB_Lfo1_Transformer1Macro] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 89 | B LFO 1 FX 2 Type [MeldVoice_EngineB_Lfo1_Transformer2Type] | 0..18 |  | q | 0=None · 1=Offset · 2=Attenuverter · 3=Gate · 4=Skew Unipolar · 5=Skew Bipolar · 6=Unipolarizer · 7=Quantizer · 8=S&H · 9=Independent S&H · 10=Clipper · 11=Fade In · 12=Fade Out · 13=Slew Down · 14=Slew Up · 15=Slew Up & Down · 16=Trig Env · 17=Comparator · 18=Scrambler |
| 90 | B LFO 1 FX 2 Ramp [MeldVoice_EngineB_Lfo1_Transformer2Macro] | 0..1 | 0 |  | 0=0.0  · 0.25=25.0  · 0.5=50.0  · 0.75=75.0  · 1=100.0  |
| 91 | B LFO 2 Wave [MeldVoice_EngineB_Lfo2_Waveform] | 0..5 |  | q | 0=Sine · 1=Tri · 2=Saw Up · 3=Saw Down · 4=Rectangle · 5=Random S&H |
| 92 | B LFO 2 Sync [MeldVoice_EngineB_Lfo2_Sync] | 0..1 |  | q | 0=Free · 1=Tempo |
| 93 | B LFO 2 Freq [MeldVoice_EngineB_Lfo2_Rate] | 0..1 | 0.416011 |  | 0=0.01 Hz · 0.25=0.79 Hz · 0.5=12.5 Hz · 0.75=63.3 Hz · 1=200 Hz · 0.416011=6.00 Hz |
| 94 | B LFO 2 Synced [MeldVoice_EngineB_Lfo2_SyncedRate] | 0..21 | 12 |  | 0=8 · 1=6 · 2=4 · 3=3 · 4=2 · 5=1.5 · 6=1 · 7=3/4 · 8=1/2 · 9=3/8 · 10=1/3 · 11=5/16 · 12=1/4 · 13=3/16 · 14=1/6 · 15=1/8 · 16=1/12 · 17=1/16 · 18=1/24 · 19=1/32 · 20=1/48 · 21=1/64 |
| 95 | B LFO 2 Retrig On [MeldVoice_EngineB_Lfo2_Retrigger] | 0..1 |  | q | 0=Off · 1=On |
| 96 | B LFO 2 Offset [MeldVoice_EngineB_Lfo2_PhaseOffset] | 0..1 | 0 |  | 0=0.0° · 0.25=90° · 0.5=180° · 0.75=270° · 1=360° |
| 97 | B Amp Attack [MeldVoice_EngineB_AmpEnvelope_Times_Attack] | 0..1 | 0.0707107 |  | 0=0.00 ms · 0.25=156 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.070711=1.00 ms |
| 98 | B Amp Decay [MeldVoice_EngineB_AmpEnvelope_Times_Decay] | 0..1 | 0.349748 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.349748=600 ms |
| 99 | B Amp Release [MeldVoice_EngineB_AmpEnvelope_Times_Release] | 0..1 | 0.186606 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.186606=50.0 ms |
| 100 | B Amp A Slope [MeldVoice_EngineB_AmpEnvelope_Slopes_Attack] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 101 | B Amp D Slope [MeldVoice_EngineB_AmpEnvelope_Slopes_Decay] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 102 | B Amp R Slope [MeldVoice_EngineB_AmpEnvelope_Slopes_Release] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 103 | B Amp Sustain [MeldVoice_EngineB_AmpEnvelope_Sustain] | 0..1 | 1 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-12 dB · 0.75=-5.0 dB · 1=0.0 dB |
| 104 | B Amp Loop Mode [MeldVoice_EngineB_AmpEnvelope_LoopMode] | 0..3 |  | q | 0=None · 1=Trigger · 2=Loop · 3=AD Loop |
| 105 | B Mod Attack [MeldVoice_EngineB_FilterEnvelope_Times_Attack] | 0..1 | 0.0707107 |  | 0=0.00 ms · 0.25=156 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.070711=1.00 ms |
| 106 | B Mod Decay [MeldVoice_EngineB_FilterEnvelope_Times_Decay] | 0..1 | 0.349748 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.349748=600 ms |
| 107 | B Mod Release [MeldVoice_EngineB_FilterEnvelope_Times_Release] | 0..1 | 0.186606 |  | 0=1.50 ms · 0.25=158 ms · 0.5=2.50 s · 0.75=12.7 s · 1=40.0 s · 0.186606=50.0 ms |
| 108 | B Mod Initial [MeldVoice_EngineB_FilterEnvelope_Values_Initial] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 109 | B Mod Peak [MeldVoice_EngineB_FilterEnvelope_Values_Peak] | 0..1 | 1 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 110 | B Mod Sustain [MeldVoice_EngineB_FilterEnvelope_Values_Sustain] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 111 | B Mod Final [MeldVoice_EngineB_FilterEnvelope_Values_Final] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 112 | B Mod A Slope [MeldVoice_EngineB_FilterEnvelope_Slopes_Attack] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 113 | B Mod D Slope [MeldVoice_EngineB_FilterEnvelope_Slopes_Decay] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 114 | B Mod R Slope [MeldVoice_EngineB_FilterEnvelope_Slopes_Release] | 0..1 | 0.5 |  | 0=-100 % · 0.25=-50 % · 0.5=0.0 % · 0.75=50 % · 1=100 % |
| 115 | B Mod Loop Mode [MeldVoice_EngineB_FilterEnvelope_LoopMode] | 0..3 |  | q | 0=None · 1=Trigger · 2=Loop · 3=AD Loop |
| 116 | B Tone Filter [MeldVoice_EngineB_ToneFilter] | 0..1 | 0.5 |  | 0=-1.00  · 0.25=-0.50  · 0.5=0.00  · 0.75=0.50  · 1=1.00  |
| 117 | B Pan [MeldVoice_EngineB_Pan] | 0..1 | 0.5 |  | 0=50L · 0.25=25L · 0.5=C · 0.75=25R · 1=50R |
| 118 | B Volume [MeldVoice_EngineB_Volume] | 0..1 | 0.635135 |  | 0=-50 dB · 0.25=-32 dB · 0.5=-13 dB · 0.75=5.5 dB · 1=24 dB · 0.635135=-3.0 dB |
| 119 | B Glide Mode [MeldVoice_EngineB_GlideMode] | 0..1 |  | q | 0=Portamento · 1=Glissando |
| 120 | B Glide Time [MeldVoice_EngineB_GlideTime] | 0..1 | 0 |  | 0=0.00 ms · 0.25=78.1 ms · 0.5=1.25 s · 0.75=6.33 s · 1=20.0 s |
| 121 | Engine B Delay [MeldVoice_EngineBDelay] | 0..1 | 0 |  | 0=0.00 ms · 0.25=39.1 ms · 0.5=625 ms · 0.75=3.16 s · 1=10.0 s |
| 122 | Drive [MeldVoice_Drive] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 123 | Limiter On [MeldVoice_LimiterOn] | 0..1 |  | q | 0=Off · 1=On |
| 124 | Link Envelopes [MeldVoice_LinkAmpEnvelopes] | 0..1 |  | q | 0=Off · 1=On |
| 125 | Scale Aware [MeldVoice_UseScale] | 0..1 |  | q | 0=Off · 1=On |
| 126 | Voice Spread [MeldVoice_VoiceSpreadAmount] | 0..1 | 0 |  | 0=0.0 % · 0.25=25 % · 0.5=50 % · 0.75=75 % · 1=100 % |
| 127 | Volume | 0..1 | 0.57544 |  | 0=-inf dB · 0.25=-24 dB · 0.5=-9.1 dB · 0.75=-0.2 dB · 1=6.0 dB · 0.575439=-6.0 dB |
| 128 | Mono Legato [MonoLegato] | 0..1 |  | q | 0=Off · 1=On |

## Other attributes (15)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | True | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | False | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `class_display_name` |  |  | Meld | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | InstrumentMeld | Return const access to the name of the device's class. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_using_compare_preset_b` | S | L | False | Returns whether the Device has loaded the preset in compare slot B. Only relevant if can_compare_ab, otherwise errors. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `mono_poly` | S | L | 1 | Returns the mode of Polyphony |
| `name` | S | L | Meld | Return access to the name of the device. |
| `poly_voices` | S | L | 5 | Return the Poly Voice count |
| `selected_engine` | S | L | False | Return what Voice Engine is selected |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
| `unison_voices` | S | L | 0 | Return the Unison Voice count |
