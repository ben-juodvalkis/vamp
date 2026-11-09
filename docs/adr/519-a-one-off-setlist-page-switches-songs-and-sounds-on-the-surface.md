# ADR-519: A setlist page switches songs and sounds through the surface

## Status
**Accepted** (2026-11-08), on the `cyborg` branch only. Needs a Live restart
for the surface part.

## Context

Ben's Battlehooch keys set holds every song in one Instrument Rack on the
`Keys` track: a chain per song, holding a rack with a chain per sound. It has
been played from TouchOSC through a Max for Live patch, which he finds too
unstable. He wants the same remote served from Vamp, built in steps, starting
with choosing a song and a sound. The other controls come later.

## Decision

`SetlistComponent` does the switching in the surface, and `/setlist` is a page
of its own. The Max patch and TouchOSC take no part.

Taken from the patch, measured from its object graph: the song's sounds come
from `chains[n].devices[0]`, a sound's switch is that device's Device On, a song
change lands on its first sound, the song arrows clamp rather than wrap and act
on two taps within 500 ms, and the tempo comes from the end of the song chain's
name.

Different from the patch:

- Other songs' racks are switched off too, as Ben asked. The patch only
  switched sounds; the rig's song racks all read on.
- Nothing happens when the page opens. The patch selected song 1, sound 1 on
  load; here a reconnecting iPad must never change what is sounding.
- The new sound goes on before the old goes off.
- `Pommel Horse160` yields a tempo. The patch split on spaces, so it could not.

The selection is never stored: Live's Device On values are read on each
request. The surface's replies are loopback UDP, so the page polls and re-asks
after an unanswered select rather than trusting one reply.

## Not yet

The effect pads, chain volume, song fader, per-sound XY pads and arpeggiator,
the foot switch on CC 67 that steps sounds, and resetting a sound's macros and
volume when leaving it, all of which the patch does.
