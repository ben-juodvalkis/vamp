# ADR-538: The Bridge Reads Every Pedal

## Status
**Accepted** (2026-11-13). Supersedes ADR-422 (pedal MIDI direct to the
surface) and ADR-537's piano pedal. **Needs a Live restart**: the surface
stops claiming MIDI.

## Context
Two ways in for one gesture. The USB foot switch and the wah's two pedals
were MIDI on the Vamp control surface's own Input in Live (ADR-422), learned
on the surface (`FootSwitchComponent`, `logs/foot-switch.json`). The piano
pedal, since that morning, was MIDI the bridge read from any input
(ADR-537). Two Settings cards did one job, and the surface path needed a
step only the user can take: pick the pedal as Vamp's Input in Live's MIDI
settings. Ben asked for one control in the app, the wah included.

Measured before moving the wah, since its sweep is a stream: 200 round
trips into the running surface (`owner/probes/inbound_latency_run.js`,
Live 12.4.25b1) took **6.9 ms mean, 15.9 ms p99, 20.3 ms max**, against the
surface drain pump's 5.6 / 10.3 ms of 2026-08-31. That is a round trip, so
one way is less; the bridge's own MIDI hop adds under a millisecond.

## Decision
**The bridge opens every MIDI input in every edition and owns every pedal**
(`interface/bridge/handlers/pedals.js`). Three roles, each a user setting
with Learn on one **Pedals** card in Settings → Controllers, saved to
`logs/pedals.json`:

- **Loop pedal** — one or more pedals into `/looping/v3/foot/tap` and
  `/foot/hold`, each a channel (0 = any) and CC, momentary or latching.
  Learn adds one and tells the two apart by the surface's rule (the opposite
  side of 64 on the same CC within 1.5 s is a release; the first side is the
  press). On/off and Forget.
- **Wah toe switch** and **wah sweep** — into `/looping/v3/wah/engage` (on
  either edge: the toe latches) and `/looping/v3/wah/freq`, only while
  `features.expressionPedal` is on.

The Move's own ports never reach a pedal, Learn included; its External Port
does, because a pedal plugged into the Move arrives there (the rig's foot
switch: CC 23 ch 10 on `Ableton Move External Port`, measured 2026-11-13
while it did nothing, the first cut having ignored every Move port). With nothing saved,
`midiPedals` seeds the roles (`footSwitchCC` on `channel`, `pianoPedalCC` on
any channel, `wahToeSwitchCC`, `wahExpressionCC`); naming none is no pedal.
Wire: `/bridge/pedals [json]` out, on change and with the 5 s ping;
`/bridge/pedals/{enabled,learn,forget}` in.

**The surface claims no MIDI.** `MidiPedalInput`, `FootSwitchComponent`,
the `build_midi_map` / `receive_midi` overrides, `config_loader.feature_on`
and `/looping/v3/session/foot_switch*` are deleted; `FootTriggerComponent`
and `WahPedalComponent` keep their OSC wires and their logic.

The installed app ships the MIDI library (`@julusian/midi`, macOS binaries
only, kept out of the bundle by `build-server.mjs`) and signs its binaries
(`package-mac-app.sh`).

## Consequences
- No step in Live for any pedal. Vamp's Input in Live's MIDI settings can go
  back to None; left on the pedal it does nothing.
- On the rig the first start seeds CC 23 ch 10 and CC 67 any channel as loop
  pedals and CC 21 / CC 20 ch 10 as the wah's, as before. A foot switch
  learned on the surface (`logs/foot-switch.json`) is not carried over.
- A CC learned for two roles fires both.
- Not measured yet: the wah sweep through the bridge by ear, and the pedals
  on the rig by hand.

## Tags
`pedals`, `midi`, `bridge`, `foot-switch`, `wah`, `learn`, `settings`
